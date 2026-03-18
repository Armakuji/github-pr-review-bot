import {
  Controller,
  Post,
  Body,
  HttpCode,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { ReviewService } from './review.service';

interface ReviewPRRequest {
  text: string;
}

@Controller('review')
export class ReviewController {
  private readonly logger = new Logger(ReviewController.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly reviewService: ReviewService,
  ) {}

  @Post('pr')
  @HttpCode(202)
  async reviewPullRequest(@Body() body: ReviewPRRequest) {

    const prUrl = typeof body?.text === 'string' ? body.text.trim() : '';

    if (!prUrl) {
      throw new BadRequestException('prUrl is required and must be a non-empty string');
    }

    const { owner, repo, prNumber } = this.parsePullRequestUrl(prUrl);

    this.logger.log(`Manual review requested for ${owner}/${repo} PR #${prNumber}`);

    // Fire-and-forget background processing
    // (Do not await; errors are logged inside)
    void this.processReviewInBackground(owner, repo, prNumber);

    return `🤖 Review queued for PR: https://github.com/${owner}/${repo}/pull/${prNumber}`;
  }

  private async processReviewInBackground(owner: string, repo: string, prNumber: number) {
    try {
      const prData = await this.githubService.getPullRequest(owner, repo, prNumber);

      const files = await this.githubService.getPullRequestFiles(owner, repo, prNumber);
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
    } catch (error: any) {
      this.logger.error(
        `Failed background review for ${owner}/${repo} PR #${prNumber}: ${error?.message || error}`,
        error?.stack,
      );
    }
  }

  private parsePullRequestUrl(url: string): {
    owner: string;
    repo: string;
    prNumber: number;
  } {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'github.com') {
        throw new Error('Host must be github.com');
      }
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length < 4) {
        throw new Error('Path too short');
      }
      const owner = pathParts[0];
      const repo = pathParts[1];
      const action = pathParts[2];
      const prNumberStr = pathParts[3];
      if (action !== 'pull' && action !== 'pulls') {
        throw new Error('Path must contain /pull/ or /pulls/');
      }
      const prNumber = parseInt(prNumberStr, 10);
      if (isNaN(prNumber) || prNumber < 1) {
        throw new Error('Invalid PR number');
      }
      return { owner, repo, prNumber };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        error?.message || 'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123',
      );
    }
  }
}
