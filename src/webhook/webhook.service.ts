import { Injectable, Logger } from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { ReviewService } from '../review/review.service';
import { PullRequestEvent, IssueCommentEvent } from './interfaces/webhook-event.interface';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly reviewService: ReviewService,
  ) {}

  async processPullRequest(event: PullRequestEvent): Promise<void> {
    const { repository, pull_request } = event;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = pull_request.number;

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

    const reviewResult = await this.reviewService.reviewChanges({
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

    this.logger.log(`Review submitted for PR #${prNumber}`);
  }

  async processPullRequestFromComment(event: IssueCommentEvent): Promise<void> {
    const { repository, issue } = event;
    const owner = repository.owner.login;
    const repo = repository.name;
    const prNumber = issue.number;

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

    const reviewResult = await this.reviewService.reviewChanges({
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

    this.logger.log(`Review submitted for PR #${prNumber}`);
  }
}
