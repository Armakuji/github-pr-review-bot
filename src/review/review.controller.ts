import {
  Controller,
  Post,
  Body,
  Headers,
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
  @HttpCode(200)
  async reviewPullRequest(
    @Body() body: ReviewPRRequest,
  ) {

    this.logger.log(`Incoming request body: ${JSON.stringify(body)}`);
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    const prUrl = this.extractPullRequestUrl(rawText);

    if (!prUrl) {
      // MS Teams requires type+text even for errors
      return {
        type: 'message',
        text: [
          'Usopp reporting in!',
          '',
          'I can’t spot a GitHub Pull Request link in that message… and my legendary sniper eyes never miss!',
          '',
          'Please paste a PR link like:',
          'https://github.com/owner/repo/pull/123',
        ].join('\n'),
      };
    }

    let owner: string, repo: string, prNumber: number;
    try {
      ({ owner, repo, prNumber } = this.parsePullRequestUrl(prUrl));
    } catch {
      return {
        type: 'message',
        text: [
          'Whoa there—Usopp almost tripped!',
          '',
          `That link looks suspicious: \`${prUrl}\``,
          '',
          'Give me a clean GitHub PR link like:',
          'https://github.com/owner/repo/pull/123',
        ].join('\n'),
      };
    }

    this.logger.log(`Manual review requested for ${owner}/${repo} PR #${prNumber}`);

    void this.processReviewInBackground(owner, repo, prNumber);

    // MS Teams outgoing webhook requires { type: "message", text: "..." }
    return {
      type: 'message',
      text: [
        'Usopp the Great has accepted your quest!',
        '',
        `I’m queuing a review for **${owner}/${repo}** PR #${prNumber}.`,
        'I’ll fire my comments straight onto the PR in a moment—BANG!',
        '',
        `PR: https://github.com/${owner}/${repo}/pull/${prNumber}`,
      ].join('\n'),
    };
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

  /**
   * Extracts a GitHub PR URL from either a plain URL string or an MS Teams
   * HTML message where the URL appears in an <a href="..."> attribute.
   * The text node may contain spaces (e.g. "https: //...") so we prefer href.
   */
  private extractPullRequestUrl(text: string): string {
    // 1. Try href attributes first (MS Teams outgoing webhook format)
    const hrefMatch = text.match(/href="(https:\/\/github\.com\/[^"]+\/pull\/\d+)"/i);
    if (hrefMatch) {
      return hrefMatch[1];
    }

    // 2. Try a plain URL anywhere in the text (strip spaces that Teams may inject)
    const normalised = text.replace(/https\s*:\s*\/\//g, 'https://');
    const plainMatch = normalised.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i);
    if (plainMatch) {
      return plainMatch[0];
    }

    // 3. Return the original text and let parsePullRequestUrl throw a clear error
    return text;
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
