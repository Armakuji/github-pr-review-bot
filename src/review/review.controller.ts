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
  prUrl: string;
}

@Controller('review')
export class ReviewController {
  private readonly logger = new Logger(ReviewController.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly reviewService: ReviewService,
  ) {}

  @Post('pr')
  @HttpCode(200)
  async reviewPullRequest(@Body() body: ReviewPRRequest) {
    const { prUrl } = body;

    if (!prUrl) {
      throw new BadRequestException('prUrl is required');
    }

    const { owner, repo, prNumber } = this.parsePullRequestUrl(prUrl);

    this.logger.log(`Manual review requested for ${owner}/${repo} PR #${prNumber}`);

    try {
      const prData = await this.githubService.getPullRequest(owner, repo, prNumber);

      const files = await this.githubService.getPullRequestFiles(
        owner,
        repo,
        prNumber,
      );

      if (files.length === 0) {
        return {
          success: false,
          message: `No reviewable files in PR #${prNumber}`,
        };
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

      return {
        success: true,
        message: `Review submitted for PR #${prNumber}`,
        pr: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        severityCounts: reviewResult.severityCounts,
        event: reviewResult.event,
      };
    } catch (error: any) {
      this.logger.error(`Failed to review PR: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to review PR: ${error.message}`);
    }
  }

  private parsePullRequestUrl(url: string): {
    owner: string;
    repo: string;
    prNumber: number;
  } {
    const patterns = [
      /github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/,
      /github\.com\/([^\/]+)\/([^\/]+)\/pulls\/(\d+)/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2],
          prNumber: parseInt(match[3], 10),
        };
      }
    }

    throw new BadRequestException(
      'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123',
    );
  }
}
