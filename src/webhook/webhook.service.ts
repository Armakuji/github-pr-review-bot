import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from 'src/github/github.service';
import { ReviewService } from 'src/review/review.service';
import { LogStashService } from 'src/shared/services/log-stash.service';
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

    const files = await this.githubService.getPullRequestFiles(
      owner,
      repo,
      prNumber,
    );

    if (files.length === 0) {
      this.logger.log(`No reviewable files in PR #${prNumber}`);
      return;
    }

    this.logger.log(`Reviewing ${files.length} file(s)...`);

    const myLogin = await this.githubService.getAuthenticatedLogin();
    const priorReviews = await this.githubService.countPullRequestReviewsByUser(
      owner,
      repo,
      prNumber,
      myLogin,
    );
    const isFirstReview = priorReviews === 0;

    const { result: reviewResult, metrics } = await this.reviewService.reviewChanges({
      prTitle: pull_request.title,
      prDescription: pull_request.body || '',
      baseBranch: pull_request.base.ref,
      headBranch: pull_request.head.ref,
      files,
    });

    await this.githubService.submitReview(
      owner,
      repo,
      prNumber,
      pull_request.head.sha,
      reviewResult,
    );

    const endedAt = new Date();
    await this.logStashService.appendReviewEntry(
      this.logStashService.composeReviewEntry({
        startedAt,
        endedAt,
        codexSeconds: metrics.llmSeconds,
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

    const files = await this.githubService.getPullRequestFiles(
      owner,
      repo,
      prNumber,
    );

    if (files.length === 0) {
      this.logger.log(`No reviewable files in PR #${prNumber}`);
      return;
    }

    this.logger.log(`Reviewing ${files.length} file(s)...`);

    const myLogin = await this.githubService.getAuthenticatedLogin();
    const priorReviews = await this.githubService.countPullRequestReviewsByUser(
      owner,
      repo,
      prNumber,
      myLogin,
    );
    const isFirstReview = priorReviews === 0;

    const { result: reviewResult, metrics } = await this.reviewService.reviewChanges({
      prTitle: prData.title,
      prDescription: prData.body || '',
      baseBranch: prData.base.ref,
      headBranch: prData.head.ref,
      files,
    });

    await this.githubService.submitReview(
      owner,
      repo,
      prNumber,
      prData.head.sha,
      reviewResult,
    );

    const endedAt = new Date();
    const prUrl = issue.html_url;
    await this.logStashService.appendReviewEntry(
      this.logStashService.composeReviewEntry({
        startedAt,
        endedAt,
        codexSeconds: metrics.llmSeconds,
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
