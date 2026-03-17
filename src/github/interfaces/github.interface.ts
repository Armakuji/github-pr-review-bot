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
