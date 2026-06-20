import { jsonrepair } from 'jsonrepair';
import { extractFirstJsonObject } from 'src/shared/utils/extract-json-object.util';

function stripMarkdownJsonFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? null;
}

function repairJsonLite(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1');
}

function tryParse(json: string): unknown {
  return JSON.parse(json);
}

/**
 * Parses JSON from LLM output. Tries strict parse first, then light repairs,
 * then `jsonrepair` for unescaped quotes/newlines and other common model mistakes.
 */
export function parseModelJsonObject(text: string): unknown {
  const candidates = new Set<string>();

  const fenced = stripMarkdownJsonFence(text);
  if (fenced) candidates.add(fenced);

  const extracted = extractFirstJsonObject(text);
  if (extracted) candidates.add(extracted);

  const trimmed = text.trim();
  if (trimmed.startsWith('{')) candidates.add(trimmed);

  if (candidates.size === 0) {
    throw new Error('No JSON found in response');
  }

  let lastError: Error | undefined;

  for (const candidate of candidates) {
    const attempts = [candidate, repairJsonLite(candidate)];

    for (const attempt of attempts) {
      try {
        return tryParse(attempt);
      } catch (error: unknown) {
        lastError =
          error instanceof Error ? error : new Error(String(error));
      }
    }

    try {
      return tryParse(jsonrepair(candidate));
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    try {
      return tryParse(jsonrepair(repairJsonLite(candidate)));
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('Failed to parse JSON from model response');
}

/** Short snippet around a JSON.parse error position for logs. */
export function jsonParseErrorSnippet(
  json: string,
  error: Error,
  radius = 80,
): string {
  const match = error.message.match(/position (\d+)/i);
  if (!match) return json.slice(0, 240);

  const pos = Number(match[1]);
  if (!Number.isFinite(pos)) return json.slice(0, 240);

  const start = Math.max(0, pos - radius);
  const end = Math.min(json.length, pos + radius);
  return json.slice(start, end);
}
