import {
  PullRequestFile,
  ReviewResult,
} from 'src/github/interfaces/github.interface';

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
