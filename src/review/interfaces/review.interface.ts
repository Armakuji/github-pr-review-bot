import {
  PullRequestFile,
  ReviewResult,
} from 'src/github/interfaces/github.interface';

/**
 * A prior critical/high inline comment posted by the bot on this PR.
 * Used for server-side deduplication and AI status-check table generation.
 */
export interface PriorBotComment {
  review_comment_id: number;
  severity: 'critical' | 'high' | 'medium';
  path: string;
  line: number | null;
  bodyExcerpt: string;
}

export interface ReviewRequest {
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  files: PullRequestFile[];
  /**
   * When set, enables follow-up mode: reconcile the diff with existing inline + timeline comments
   * and optionally emit `repliesToReviewComments` / `repliesToIssueComments` on the result.
   */
  existingDiscussion?: string;
  /**
   * Prior critical/high inline comments the bot already posted on this PR.
   * Used to skip re-posting duplicates and to generate the status check table.
   */
  priorBotComments?: PriorBotComment[];
  /**
   * True when this bot account has already submitted at least one PR review on this PR.
   * Controls the "Re-Review:" summary heading only.
   */
  isReReview?: boolean;
  /** GitHub login of the PR author — used for the Review Sender intro. */
  prAuthorLogin?: string;
  /**
   * True when only a subset of PR files is sent (changed since last bot review).
   * The prompt includes guidance to reconcile prior issues from discussion/history.
   */
  incrementalReview?: boolean;
  /** Commit SHA of the previous bot review (when `incrementalReview` is true). */
  sinceReviewSha?: string;
}

/** Metrics collected during `reviewChanges` (LLM + diff stats). */
export interface ReviewChangesMetrics {
  /** Seconds spent in Anthropic `messages.create` only. */
  llmSeconds: number;
  /** Approximate input size: user prompt + system prompt character counts. */
  conversationChars: number;
  /** Total patch characters across reviewed files. */
  diffChars: number;
  filesCount: number;
  languages: Record<string, number>;
}

export interface ReviewChangesOutput {
  result: ReviewResult;
  metrics: ReviewChangesMetrics;
}

export { ReviewResult, PullRequestFile };
