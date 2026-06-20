import { Logger } from '@nestjs/common';
import { GithubService } from 'src/github/github.service';
import { PullRequestFile } from 'src/github/interfaces/github.interface';
import { PriorBotComment } from 'src/review/interfaces/review.interface';
import { selectIncrementalReviewFiles } from 'src/review/utils/select-incremental-review-files.util';

export interface ResolvedReviewFiles {
  files: PullRequestFile[];
  incrementalReview?: boolean;
  sinceReviewSha?: string;
}

/**
 * On re-review, narrows reviewable files to those changed since the bot's last review.
 */
export async function resolveIncrementalReviewFiles(
  githubService: GithubService,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  botLogin: string,
  allReviewableFiles: PullRequestFile[],
  priorBotComments: PriorBotComment[],
  isReReview: boolean,
  logger: Logger,
  latestCommitSha?: string | null,
): Promise<ResolvedReviewFiles> {
  if (!isReReview) {
    return { files: allReviewableFiles };
  }

  const sinceSha =
    latestCommitSha ??
    (
      await githubService.getBotReviewHistory(
        owner,
        repo,
        prNumber,
        botLogin,
      )
    ).latestCommitSha;

  if (!sinceSha) {
    logger.log(
      'Incremental re-review: no prior bot review commit; using full PR diff',
    );
    return { files: allReviewableFiles };
  }

  const changedFilenames =
    sinceSha === headSha
      ? new Set<string>()
      : await githubService.getChangedFilenamesBetween(
          owner,
          repo,
          sinceSha,
          headSha,
        );

  const selection = selectIncrementalReviewFiles(
    allReviewableFiles,
    changedFilenames,
    priorBotComments.map((c) => c.path),
    sinceSha,
    isReReview,
  );

  if (selection.incremental) {
    logger.log(
      `Incremental re-review: ${selection.files.length}/${selection.totalReviewable} file(s) since ${sinceSha.slice(0, 7)}`,
    );
  } else if (changedFilenames === null) {
    logger.warn(
      'Incremental re-review: compare failed; falling back to full PR diff',
    );
  }

  return {
    files: selection.files,
    ...(selection.incremental
      ? {
          incrementalReview: true,
          sinceReviewSha: selection.sinceReviewSha,
        }
      : {}),
  };
}
