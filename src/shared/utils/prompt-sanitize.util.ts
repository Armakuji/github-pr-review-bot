/**
 * Reduces prompt-injection risk for untrusted text embedded in LLM user prompts.
 * Not a cryptographic guarantee — combines truncation, control-char stripping,
 * and removal of a delimiter string if users try to spoof prompt boundaries.
 */
const BOUNDARY_TOKEN = '[[[PR_BOT_USER_TEXT_BOUNDARY]]]';

export function sanitizeForPrompt(
  input: string | null | undefined,
  maxLen = 16_000,
): string {
  let s = String(input ?? '');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  s = s.split(BOUNDARY_TOKEN).join('[removed_boundary_token]');
  if (s.length > maxLen) {
    s = `${s.slice(0, maxLen)}\n[…truncated for prompt safety]`;
  }
  return s;
}
