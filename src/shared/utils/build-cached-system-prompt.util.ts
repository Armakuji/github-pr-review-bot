import type { TextBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';

/** Anthropic system blocks with ephemeral prompt caching on the stable prefix. */
export function buildCachedSystemPrompt(
  basePrompt: string,
  optionalAppend?: string,
): TextBlockParam[] {
  const blocks: TextBlockParam[] = [
    {
      type: 'text',
      text: basePrompt,
      cache_control: { type: 'ephemeral' },
    },
  ];
  if (optionalAppend?.trim()) {
    blocks.push({ type: 'text', text: optionalAppend });
  }
  return blocks;
}
