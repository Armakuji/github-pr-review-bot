/** User-visible explanation when the PR has nothing the LLM can review. */
export function buildNoReviewableFilesSummary(
  totalChangedFiles: number,
  filesWithPatchCount: number,
): string {
  if (totalChangedFiles === 0) {
    return 'This pull request has no changed files.';
  }
  if (filesWithPatchCount === 0) {
    return (
      'There is no line-level diff to review (for example only file removals, renames without content, ' +
      'or GitHub omitted patches because the change is very large).'
    );
  }
  return (
    'Every changed file with a diff is skipped for automated review: it matches an ignore pattern ' +
    'or is treated as binary (non-diffable) for this bot.'
  );
}
