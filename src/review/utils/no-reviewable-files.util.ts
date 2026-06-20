import { ReviewResult } from 'src/github/interfaces/github.interface';
import { MODEL_DISPLAY_NAME } from 'src/shared/constants/claude-model.constant';

/** GitHub review when there is nothing to send to the model (not the “only ignored patterns” auto-approve case). */
export function buildNoReviewableFilesReviewResult(summary: string): ReviewResult {
  return {
    summary: [
      'ℹ️ **No automated code review** — nothing in this PR is eligible for LLM diff review.',
      '',
      summary,
      '',
      `_${MODEL_DISPLAY_NAME} was not invoked._`,
    ].join('\n'),
    comments: [],
    event: 'COMMENT',
    severityCounts: { critical: 0, high: 0, medium: 0 },
  };
}
