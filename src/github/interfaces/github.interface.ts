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
   * True when the PR has zero file changes at all — no diff to review.
   * Auto-approve immediately without invoking the LLM.
   */
  zeroFilesChanged: boolean;
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
  /**
   * When `reviewableFiles` is empty and `onlyIgnoredPatternFiles` is false: files that had a patch
   * but were excluded from LLM review (for metrics / log stash).
   */
  skippedPatchFilesForMetrics: PullRequestFile[];
  /**
   * When `reviewableFiles` is empty and `onlyIgnoredPatternFiles` is false: short reason for the PR comment.
   */
  noReviewableFilesSummary?: string;
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

export interface PriorIssueStatus {
  review_comment_id: number;
  severity: Severity;
  title: string;
  resolved: boolean;
  /**
   * True when the PR author explicitly deferred the issue (e.g. "not for this PR",
   * "initial purpose"). The issue is real but intentionally skipped for this iteration.
   * Treated as acceptable for approval (⚠️ Pass with condition) rather than a blocker.
   */
  deferredByAuthor?: boolean;
  status_note?: string;
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
  /** Status of prior bot critical/high inline comments (follow-up reviews only). */
  priorIssuesStatus?: PriorIssueStatus[];
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

export type PrReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';

/** A submitted PR review (verdict + summary body). */
export interface GithubPullRequestReview {
  id: number;
  body: string;
  state: PrReviewState;
  user: { login: string } | null;
}
