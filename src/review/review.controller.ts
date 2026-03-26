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
import { ProtectCommentInput } from './interfaces/protect.interface';

interface ReviewPRRequest {
  text: string;
}

/** Max third-party comments to send to the model per request (avoids huge threads). */
const MAX_PROTECT_COMMENTS = 50;

type PrWebhookIntent = 'review' | 'protect';

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

    const intentResult = this.parseIntentAndRemainder(rawText);
    if (!intentResult) {
      return {
        type: 'message',
        text: [
          'Usopp reporting in!',
          '',
          'Start your message with **review** or **protect**, then the PR URL:',
          '',
          '`review https://github.com/owner/repo/pull/123`',
          '`protect https://github.com/owner/repo/pull/123`',
        ].join('\n'),
      };
    }

    const { intent, remainder } = intentResult;
    const prUrl = this.extractPullRequestUrl(remainder);

    if (!prUrl) {
      return {
        type: 'message',
        text: [
          'Usopp reporting in!',
          '',
          'I can’t spot a GitHub Pull Request link after the keyword…',
          '',
          'Examples:',
          '`review https://github.com/owner/repo/pull/123`',
          '`protect https://github.com/owner/repo/pull/123`',
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
          'Use a clean URL like:',
          'https://github.com/owner/repo/pull/123',
        ].join('\n'),
      };
    }

    if (intent === 'review') {
      this.logger.log(`Manual review requested for ${owner}/${repo} PR #${prNumber}`);
      void this.processReviewInBackground(owner, repo, prNumber);
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

    this.logger.log(`Protect mode queued for ${owner}/${repo} PR #${prNumber}`);
    void this.processProtectInBackground(owner, repo, prNumber);
    return {
      type: 'message',
      text: [
        'Shield up! Usopp is reading the battlefield!',
        '',
        `I’m scanning **${owner}/${repo}** PR #${prNumber} for review comments.`,
        'If something’s unfair or nonsense, I’ll clap back on the PR thread.',
        '',
        `PR: https://github.com/${owner}/${repo}/pull/${prNumber}`,
      ].join('\n'),
    };
  }

  /**
   * Single webhook: `review <url>` runs AI review; `protect <url>` runs protect mode.
   */
  private parseIntentAndRemainder(
    trimmed: string,
  ): { intent: PrWebhookIntent; remainder: string } | null {
    const reviewMatch = trimmed.match(/^review\s+([\s\S]+)$/i);
    if (reviewMatch) {
      return { intent: 'review', remainder: reviewMatch[1].trim() };
    }
    const protectMatch = trimmed.match(/^protect\s+([\s\S]+)$/i);
    if (protectMatch) {
      return { intent: 'protect', remainder: protectMatch[1].trim() };
    }
    return null;
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

  private async processProtectInBackground(
    owner: string,
    repo: string,
    prNumber: number,
  ) {
    try {
      const myLogin = await this.githubService.getAuthenticatedLogin();
      const prData = await this.githubService.getPullRequest(owner, repo, prNumber);

      const [reviewRaw, issueRaw] = await Promise.all([
        this.githubService.listPullRequestReviewComments(owner, repo, prNumber),
        this.githubService.listIssueComments(owner, repo, prNumber),
      ]);

      const reviewComments: ProtectCommentInput[] = [];
      for (const c of reviewRaw) {
        if (c.in_reply_to_id != null) continue;
        const login = c.user?.login;
        if (!login || login === myLogin) continue;
        if (!c.body?.trim()) continue;
        reviewComments.push({
          kind: 'review',
          id: c.id,
          author: login,
          path: c.path,
          line: c.line,
          body: c.body,
        });
      }

      const issueComments: ProtectCommentInput[] = [];
      for (const c of issueRaw) {
        const login = c.user?.login;
        if (!login || login === myLogin) continue;
        if (!c.body?.trim()) continue;
        issueComments.push({
          kind: 'issue',
          id: c.id,
          author: login,
          body: c.body,
        });
      }

      const combined = [...reviewComments, ...issueComments];
      if (combined.length === 0) {
        this.logger.log(`Protect mode: no third-party comments on PR #${prNumber}`);
        return;
      }

      const truncated =
        combined.length > MAX_PROTECT_COMMENTS
          ? combined.slice(0, MAX_PROTECT_COMMENTS)
          : combined;

      if (combined.length > MAX_PROTECT_COMMENTS) {
        this.logger.warn(
          `Protect mode: only first ${MAX_PROTECT_COMMENTS} of ${combined.length} comments analyzed`,
        );
      }

      const analysis = await this.reviewService.analyzeProtectComments({
        prTitle: prData.title,
        prDescription: prData.body || '',
        baseBranch: prData.base.ref,
        headBranch: prData.head.ref,
        comments: truncated,
      });

      let repliesPosted = 0;
      for (const item of analysis.items) {
        if (item.stance !== 'pushback' || !item.replyBody) continue;

        try {
          if (item.kind === 'review') {
            await this.githubService.replyToReviewComment(
              owner,
              repo,
              prNumber,
              item.id,
              item.replyBody,
            );
          } else {
            const original = truncated.find(
              (x): x is Extract<ProtectCommentInput, { kind: 'issue' }> =>
                x.kind === 'issue' && x.id === item.id,
            );
            const prefix = original
              ? `**Re:** @${original.author}\n\n`
              : '';
            await this.githubService.createIssueComment(
              owner,
              repo,
              prNumber,
              `${prefix}${item.replyBody}`,
            );
          }
          repliesPosted++;
        } catch (err: any) {
          this.logger.error(
            `Protect mode: failed to post reply for ${item.kind} id=${item.id}: ${err?.message || err}`,
          );
        }
      }

      this.logger.log(
        `Protect mode done for PR #${prNumber}: ${repliesPosted} rebuttal(s) posted`,
      );
    } catch (error: any) {
      this.logger.error(
        `Protect mode failed for ${owner}/${repo} PR #${prNumber}: ${error?.message || error}`,
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
