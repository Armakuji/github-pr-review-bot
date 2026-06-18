import { PullRequestFile } from 'src/github/interfaces/github.interface';

export interface IncrementalReviewSelection {
  files: PullRequestFile[];
  incremental: boolean;
  sinceReviewSha?: string;
  totalReviewable: number;
}

/**
 * On re-review, narrows files to those changed since the last bot review commit,
 * plus any file with a prior bot inline comment (so resolution can be checked).
 * When `changedFilenames` is null (compare API failed), returns the full file list.
 */
export function selectIncrementalReviewFiles(
  allReviewableFiles: PullRequestFile[],
  changedFilenames: Set<string> | null,
  priorBotCommentPaths: Iterable<string>,
  sinceReviewSha: string | null,
  isReReview: boolean,
): IncrementalReviewSelection {
  const totalReviewable = allReviewableFiles.length;

  if (!isReReview || !sinceReviewSha) {
    return {
      files: allReviewableFiles,
      incremental: false,
      totalReviewable,
    };
  }

  if (changedFilenames === null) {
    return {
      files: allReviewableFiles,
      incremental: false,
      totalReviewable,
    };
  }

  const keepPaths = new Set<string>(changedFilenames);
  for (const path of priorBotCommentPaths) {
    if (path?.trim()) keepPaths.add(path);
  }

  const files =
    keepPaths.size === 0
      ? []
      : allReviewableFiles.filter((f) => keepPaths.has(f.filename));

  return {
    files,
    incremental: true,
    sinceReviewSha,
    totalReviewable,
  };
}
