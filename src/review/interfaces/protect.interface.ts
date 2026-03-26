/** Inline PR review comment (thread root) from another user. */
export interface ProtectReviewCommentInput {
  kind: 'review';
  id: number;
  author: string;
  path: string;
  line: number | null;
  body: string;
}

/** Conversation comment on the PR issue. */
export interface ProtectIssueCommentInput {
  kind: 'issue';
  id: number;
  author: string;
  body: string;
}

export type ProtectCommentInput =
  | ProtectReviewCommentInput
  | ProtectIssueCommentInput;

export interface ProtectAnalysisInput {
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  comments: ProtectCommentInput[];
}

export interface ProtectAnalysisItem {
  kind: 'review' | 'issue';
  id: number;
  stance: 'accept' | 'pushback';
  replyBody: string | null;
}

export interface ProtectAnalysisResult {
  items: ProtectAnalysisItem[];
}
