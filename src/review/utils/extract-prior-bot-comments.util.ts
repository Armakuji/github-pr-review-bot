import { GithubPullReviewComment } from 'src/github/interfaces/github.interface';
import { PriorBotComment } from 'src/review/interfaces/review.interface';
import {
  SEVERITY_BADGE_CRITICAL,
  SEVERITY_BADGE_HIGH,
  SEVERITY_BADGE_MEDIUM,
} from 'src/shared/constants/severity-badges.constant';

function parseSeverityFromCommentBody(
  body: string,
): 'critical' | 'high' | 'medium' | null {
  if (body.startsWith(SEVERITY_BADGE_CRITICAL)) return 'critical';
  if (body.startsWith(SEVERITY_BADGE_HIGH)) return 'high';
  if (body.startsWith(SEVERITY_BADGE_MEDIUM)) return 'medium';
  return null;
}

function extractCommentBodyExcerpt(body: string): string {
  const lines = body.split('\n');
  const withoutBadge = lines.slice(2).join('\n');
  return withoutBadge.slice(0, 200).trim();
}

/**
 * Prior inline comments by the bot (deduped by path:line, newest id wins).
 */
export function extractPriorBotComments(
  reviewComments: GithubPullReviewComment[],
  botLogin: string,
): PriorBotComment[] {
  const byLocation = new Map<string, PriorBotComment>();

  for (const c of reviewComments) {
    if (c.user?.login !== botLogin || c.in_reply_to_id != null) continue;
    const severity = parseSeverityFromCommentBody(c.body);
    if (!severity) continue;
    const key = `${c.path}:${c.line}`;
    const existing = byLocation.get(key);
    if (!existing || c.id > existing.review_comment_id) {
      byLocation.set(key, {
        review_comment_id: c.id,
        severity,
        path: c.path,
        line: c.line,
        bodyExcerpt: extractCommentBodyExcerpt(c.body),
      });
    }
  }

  return [...byLocation.values()];
}
