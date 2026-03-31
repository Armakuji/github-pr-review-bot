import {
  GithubIssueComment,
  GithubPullReviewComment,
} from 'src/github/interfaces/github.interface';
import { sanitizeForPrompt } from 'src/shared/utils/prompt-sanitize.util';

const MAX_BODY_PER_COMMENT = 6_000;
const MAX_TOTAL_CONTEXT = 28_000;

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n…(truncated)`;
}

/**
 * Builds prompt text + id sets for validating model reply targets.
 */
export function buildPrDiscussionContext(
  reviewComments: GithubPullReviewComment[],
  issueComments: GithubIssueComment[],
): {
  text: string;
  allowedReviewCommentIds: Set<number>;
  allowedIssueCommentIds: Set<number>;
} {
  const allowedReviewCommentIds = new Set<number>();
  const allowedIssueCommentIds = new Set<number>();

  const sortedReview = [...reviewComments].sort((a, b) => {
    const pa = a.path.localeCompare(b.path);
    if (pa !== 0) return pa;
    return a.id - b.id;
  });

  let blocks: string[] = [];

  if (sortedReview.length > 0) {
    blocks.push(`### Inline review comments (use \`review_comment_id\` for replies)\n`);
    for (const c of sortedReview) {
      allowedReviewCommentIds.add(c.id);
      const author = c.user?.login ?? 'unknown';
      const replyHint =
        c.in_reply_to_id != null
          ? ` (reply in thread; parent comment id=${c.in_reply_to_id})`
          : '';
      blocks.push(
        `- **review_comment_id=${c.id}** @${author} \`${sanitizeForPrompt(c.path, 500)}\`:${c.line ?? 'n/a'}${replyHint}\n` +
          `${clip(sanitizeForPrompt(c.body, MAX_BODY_PER_COMMENT), MAX_BODY_PER_COMMENT)}\n`,
      );
    }
  }

  if (issueComments.length > 0) {
    blocks.push(`\n### PR conversation / timeline comments (use \`issue_comment_id\` for replies)\n`);
    const sortedIssue = [...issueComments].sort((a, b) => a.id - b.id);
    for (const c of sortedIssue) {
      allowedIssueCommentIds.add(c.id);
      const author = c.user?.login ?? 'unknown';
      blocks.push(
        `- **issue_comment_id=${c.id}** @${author}\n` +
          `${clip(sanitizeForPrompt(c.body, MAX_BODY_PER_COMMENT), MAX_BODY_PER_COMMENT)}\n`,
      );
    }
  }

  let text = blocks.join('\n').trim();
  if (text.length > MAX_TOTAL_CONTEXT) {
    text =
      clip(text, MAX_TOTAL_CONTEXT) +
      '\n\n_(Discussion truncated for size; prioritize items above.)_';
  }

  return {
    text,
    allowedReviewCommentIds,
    allowedIssueCommentIds,
  };
}
