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
