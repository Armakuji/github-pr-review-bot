import {
  PullRequestFile,
  ReviewResult,
} from 'src/github/interfaces/github.interface';
import { MODEL_DISPLAY_NAME } from 'src/shared/constants/claude-model.constant';
import { countLanguagesByFile } from 'src/shared/utils/file-language.util';
import type { ReviewChangesMetrics } from 'src/review/interfaces/review.interface';

/** GitHub review when the PR targets an auto-approved branch route (e.g. beta → develop). */
export function buildInstantApproveBranchRouteReviewResult(
  headBranch: string,
  baseBranch: string,
): ReviewResult {
  return {
    summary: [
      `✅ **Auto-approved** — PRs from \`${headBranch}\` → \`${baseBranch}\` are approved automatically.`,
      '',
      `_${MODEL_DISPLAY_NAME} was not invoked._`,
    ].join('\n'),
    comments: [],
    event: 'APPROVE',
    severityCounts: { critical: 0, high: 0, medium: 0 },
  };
}

/** GitHub review when the PR has zero file changes. */
export function buildInstantApproveZeroFilesReviewResult(): ReviewResult {
  return {
    summary: [
      '✅ **Auto-approved** — this PR has no file changes.',
      '',
      `_${MODEL_DISPLAY_NAME} was not invoked._`,
    ].join('\n'),
    comments: [],
    event: 'APPROVE',
    severityCounts: { critical: 0, high: 0, medium: 0 },
  };
}

/** GitHub review when every patch file matches `IGNORE_PATTERNS` only. */
export function buildInstantApproveIgnoredOnlyReviewResult(): ReviewResult {
  return {
    summary: [
      '✅ **Auto-approved** — all changed files with diffs match configured ignore patterns (e.g. lockfiles, build output).',
      '',
      `_${MODEL_DISPLAY_NAME} was not invoked._`,
    ].join('\n'),
    comments: [],
    event: 'APPROVE',
    severityCounts: { critical: 0, high: 0, medium: 0 },
  };
}

export function metricsForIgnoredPatternFilesOnly(
  files: PullRequestFile[],
): ReviewChangesMetrics {
  let diffChars = 0;
  for (const f of files) {
    diffChars += f.patch?.length ?? 0;
  }
  return {
    llmSeconds: 0,
    conversationChars: 0,
    diffChars,
    filesCount: files.length,
    languages: countLanguagesByFile(files),
  };
}
