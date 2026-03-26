export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export type Severity = 'critical' | 'high' | 'medium';

export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
  severity: Severity;
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
