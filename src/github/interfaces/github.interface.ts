export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/** Result of classifying PR files for review vs `IGNORE_PATTERNS` / binaries. */
export interface PullRequestFilesForReview {
  reviewableFiles: PullRequestFile[];
  /**
   * True when every changed file that has a diff (not removed) matches `IGNORE_PATTERNS` only —
   * there is no other file left for the LLM to review.
   */
  onlyIgnoredPatternFiles: boolean;
  /**
   * When `onlyIgnoredPatternFiles`, the patch-bearing ignored files (for metrics / log stash).
   * Empty otherwise.
   */
  ignoredPatternFilesWithPatch: PullRequestFile[];
}

export type Severity = 'critical' | 'high' | 'medium';

export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
  severity: Severity;
}

/** Reply in an inline review thread (from follow-up review JSON). */
export interface ReviewReplyToReviewComment {
  review_comment_id: number;
  body: string;
}

/** New timeline comment referencing a prior issue comment (from follow-up review JSON). */
export interface ReviewReplyToIssueComment {
  issue_comment_id: number;
  body: string;
}

export interface ReviewResult {
  summary: string;
  comments: ReviewComment[];
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  severityCounts: {
    critical: number;
    high: number;
    medium: number;
  };
  /** Posted after the main review via GitHub reply APIs when present. */
  repliesToReviewComments?: ReviewReplyToReviewComment[];
  repliesToIssueComments?: ReviewReplyToIssueComment[];
}

/** GitHub pull request review comment (inline on diff). */
export interface GithubPullReviewComment {
  id: number;
  body: string;
  path: string;
  line: number | null;
  user: { login: string } | null;
  in_reply_to_id: number | null;
}

/** GitHub issue comment on a PR. */
export interface GithubIssueComment {
  id: number;
  body: string;
  user: { login: string } | null;
}
