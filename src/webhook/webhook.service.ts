import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from 'src/github/github.service';
import { ReviewService } from 'src/review/review.service';
import { LogStashService } from 'src/shared/services/log-stash.service';
import { buildPrDiscussionContext } from 'src/review/utils/build-pr-discussion-context.util';
import {
  buildInstantApproveIgnoredOnlyReviewResult,
  metricsForIgnoredPatternFilesOnly,
} from 'src/review/utils/instant-approve-ignored-only.util';
import { buildNoReviewableFilesReviewResult } from 'src/review/utils/no-reviewable-files.util';
import { PullRequestEvent, IssueCommentEvent } from 'src/webhook/interfaces/webhook-event.interface';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly reviewService: ReviewService,
    private readonly logStashService: LogStashService,
  ) {}

  async processPullRequest(event: PullRequestEvent): Promise<void> {
    const { repository, pull_request } = event;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pull_request.number;
    const startedAt = new Date();
    const requester = this.logStashService.resolveRequester(
      event.sender?.login ?? pull_request.user.login,
    );

    this.logger.log(
      `Reviewing PR #${prNumber} "${pull_request.title}" in ${owner}/${repo}`,
    );

    const {
      reviewableFiles,
      onlyIgnoredPatternFiles,
      ignoredPatternFilesWithPatch,
      skippedPatchFilesForMetrics,
      noReviewableFilesSummary,
    } = await this.githubService.getPullRequestFilesForReview(
      owner,
      repo,
      prNumber,
    );

    if (onlyIgnoredPatternFiles) {
      this.logger.log(
        `PR #${prNumber}: only IGNORE_PATTERNS files with diffs; auto-approving`,
      );
    } else if (reviewableFiles.length === 0) {
      this.logger.log(
        `No reviewable files in PR #${prNumber}: ${noReviewableFilesSummary ?? 'skipped'}`,
      );
    } else {
      this.logger.log(`Reviewing ${reviewableFiles.length} file(s)...`);
    }

    const myLogin = await this.githubService.getAuthenticatedLogin();
    const [reviewComments, issueComments, prReviews, priorReviews] = await Promise.all([
      this.githubService.listPullRequestReviewComments(owner, repo, prNumber),
      this.githubService.listIssueComments(owner, repo, prNumber),
      this.githubService.listPullRequestReviews(owner, repo, prNumber),
      this.githubService.countPullRequestReviewsByUser(
        owner,
        repo,
        prNumber,
        myLogin,
      ),
    ]);
    const isFirstReview = priorReviews === 0;

    const {
      text: discussionText,
      allowedReviewCommentIds,
      allowedIssueCommentIds,
    } = buildPrDiscussionContext(reviewComments, issueComments, prReviews);
    const existingDiscussion =
      discussionText.length > 0 ? discussionText : undefined;

    let reviewResult;
    let metrics;
    if (onlyIgnoredPatternFiles) {
      reviewResult = buildInstantApproveIgnoredOnlyReviewResult();
      metrics = metricsForIgnoredPatternFilesOnly(
        ignoredPatternFilesWithPatch,
      );
    } else if (reviewableFiles.length === 0) {
      reviewResult = buildNoReviewableFilesReviewResult(
        noReviewableFilesSummary ??
          'No line-level diff was available for automated review.',
      );
      metrics = metricsForIgnoredPatternFilesOnly(skippedPatchFilesForMetrics);
    } else {
      const rv = await this.reviewService.reviewChanges({
        prTitle: pull_request.title,
        prDescription: pull_request.body || '',
        baseBranch: pull_request.base.ref,
        headBranch: pull_request.head.ref,
        files: reviewableFiles,
        ...(existingDiscussion ? { existingDiscussion } : {}),
      });
      reviewResult = rv.result;
      metrics = rv.metrics;
    }

    await this.githubService.submitReview(
      owner,
      repo,
      prNumber,
      pull_request.head.sha,
      reviewResult,
    );

    await this.githubService.postFollowupReplies(
      owner,
      repo,
      prNumber,
      reviewResult,
      allowedReviewCommentIds,
      allowedIssueCommentIds,
    );

    const endedAt = new Date();
    await this.logStashService.appendReviewEntry(
      this.logStashService.composeReviewEntry({
        startedAt,
        endedAt,
        llmSeconds: metrics.llmSeconds,
        prUrl: pull_request.html_url,
        prOwner: pull_request.user.login,
        requester,
        event: reviewResult.event,
        isFirstReview,
        diffChars: metrics.diffChars,
        conversationChars: metrics.conversationChars,
        filesCount: metrics.filesCount,
        languages: metrics.languages,
      }),
    );

    this.logger.log(`Review submitted for PR #${prNumber}`);
  }

  async processPullRequestFromComment(event: IssueCommentEvent): Promise<void> {
    const { repository, issue } = event;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = issue.number;
    const startedAt = new Date();
    const requester = this.logStashService.resolveRequester(
      event.comment.user.login,
    );

    this.logger.log(
      `Reviewing PR #${prNumber} "${issue.title}" in ${owner}/${repo} (triggered by comment)`,
    );

    const prData = await this.githubService.getPullRequest(owner, repo, prNumber);

    const {
      reviewableFiles,
      onlyIgnoredPatternFiles,
      ignoredPatternFilesWithPatch,
      skippedPatchFilesForMetrics,
      noReviewableFilesSummary,
    } = await this.githubService.getPullRequestFilesForReview(
      owner,
      repo,
      prNumber,
    );

    if (onlyIgnoredPatternFiles) {
      this.logger.log(
        `PR #${prNumber}: only IGNORE_PATTERNS files with diffs; auto-approving`,
      );
    } else if (reviewableFiles.length === 0) {
      this.logger.log(
        `No reviewable files in PR #${prNumber}: ${noReviewableFilesSummary ?? 'skipped'}`,
      );
    } else {
      this.logger.log(`Reviewing ${reviewableFiles.length} file(s)...`);
    }

    const myLogin = await this.githubService.getAuthenticatedLogin();
    const [reviewComments, issueComments, prReviews, priorReviews] = await Promise.all([
      this.githubService.listPullRequestReviewComments(owner, repo, prNumber),
      this.githubService.listIssueComments(owner, repo, prNumber),
      this.githubService.listPullRequestReviews(owner, repo, prNumber),
      this.githubService.countPullRequestReviewsByUser(
        owner,
        repo,
        prNumber,
        myLogin,
      ),
    ]);
    const isFirstReview = priorReviews === 0;

    const {
      text: discussionText,
      allowedReviewCommentIds,
      allowedIssueCommentIds,
    } = buildPrDiscussionContext(reviewComments, issueComments, prReviews);
    const existingDiscussion =
      discussionText.length > 0 ? discussionText : undefined;

    let reviewResult;
    let metrics;
    if (onlyIgnoredPatternFiles) {
      reviewResult = buildInstantApproveIgnoredOnlyReviewResult();
      metrics = metricsForIgnoredPatternFilesOnly(
        ignoredPatternFilesWithPatch,
      );
    } else if (reviewableFiles.length === 0) {
      reviewResult = buildNoReviewableFilesReviewResult(
        noReviewableFilesSummary ??
          'No line-level diff was available for automated review.',
      );
      metrics = metricsForIgnoredPatternFilesOnly(skippedPatchFilesForMetrics);
    } else {
      const rv = await this.reviewService.reviewChanges({
        prTitle: prData.title,
        prDescription: prData.body || '',
        baseBranch: prData.base.ref,
        headBranch: prData.head.ref,
        files: reviewableFiles,
        ...(existingDiscussion ? { existingDiscussion } : {}),
      });
      reviewResult = rv.result;
      metrics = rv.metrics;
    }

    await this.githubService.submitReview(
      owner,
      repo,
      prNumber,
      prData.head.sha,
      reviewResult,
    );

    await this.githubService.postFollowupReplies(
      owner,
      repo,
      prNumber,
      reviewResult,
      allowedReviewCommentIds,
      allowedIssueCommentIds,
    );

    const endedAt = new Date();
    const prUrl = issue.html_url;
    await this.logStashService.appendReviewEntry(
      this.logStashService.composeReviewEntry({
        startedAt,
        endedAt,
        llmSeconds: metrics.llmSeconds,
        prUrl,
        prOwner: prData.authorLogin,
        requester,
        event: reviewResult.event,
        isFirstReview,
        diffChars: metrics.diffChars,
        conversationChars: metrics.conversationChars,
        filesCount: metrics.filesCount,
        languages: metrics.languages,
      }),
    );

    this.logger.log(`Review submitted for PR #${prNumber}`);
  }
}
