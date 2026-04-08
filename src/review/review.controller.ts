import {
  Controller,
  Post,
  Body,
  HttpCode,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { GithubService } from 'src/github/github.service';
import { ReviewService } from 'src/review/review.service';
import { ProtectCommentInput } from 'src/review/interfaces/protect.interface';
import { LogStashService } from 'src/shared/services/log-stash.service';
import { buildPrDiscussionContext } from 'src/review/utils/build-pr-discussion-context.util';
import {
  buildInstantApproveIgnoredOnlyReviewResult,
  metricsForIgnoredPatternFilesOnly,
} from 'src/review/utils/instant-approve-ignored-only.util';
import { buildNoReviewableFilesReviewResult } from 'src/review/utils/no-reviewable-files.util';

interface ReviewPRRequest {
  text: string;
  /** Optional display name or login for logstash `requester`. */
  requester?: string;
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
    private readonly logStashService: LogStashService,
  ) {}

  @Post('pr')
  @HttpCode(200)
  reviewPullRequest(
    @Body() body: ReviewPRRequest,
  ) {

    this.logger.log(`Incoming request body: ${JSON.stringify(body)}`);
    const rawText = typeof body?.text === 'string' ? body.text.trim() : '';
    const requester =
      typeof body?.requester === 'string' && body.requester.trim()
        ? body.requester.trim()
        : undefined;

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
      void this.processReviewInBackground(owner, repo, prNumber, requester);
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
   * Also accepts a short prefix (e.g. `Usopp review <url>`) by matching the first
   * whole-word `review` or `protect` before the first GitHub URL only, so repo
   * path segments like `…-protect-…` do not flip intent.
   */
  private parseIntentAndRemainder(
    trimmed: string,
  ): { intent: PrWebhookIntent; remainder: string } | null {
    // Use matched prefix length (handles variable whitespace / casing). Do not truncate
    // before intent — truncation could cut off a PR URL and break remainder extraction.
    const reviewPrefix = trimmed.match(/^review\s+/i);
    if (reviewPrefix) {
      return {
        intent: 'review',
        remainder: trimmed.slice(reviewPrefix[0].length).trim(),
      };
    }
    const protectPrefix = trimmed.match(/^protect\s+/i);
    if (protectPrefix) {
      return {
        intent: 'protect',
        remainder: trimmed.slice(protectPrefix[0].length).trim(),
      };
    }

    const urlIdx = this.findFirstGithubUrlStartIndex(trimmed);
    const beforeUrl = urlIdx === -1 ? trimmed : trimmed.slice(0, urlIdx);

    const reviewMatch = /\breview\s+/i.exec(beforeUrl);
    const protectMatch = /\bprotect\s+/i.exec(beforeUrl);

    if (!reviewMatch && !protectMatch) {
      return null;
    }

    let intent: PrWebhookIntent;
    let keywordEndInTrimmed: number;

    if (reviewMatch && protectMatch) {
      if (reviewMatch.index <= protectMatch.index) {
        intent = 'review';
        keywordEndInTrimmed = reviewMatch.index + reviewMatch[0].length;
      } else {
        intent = 'protect';
        keywordEndInTrimmed = protectMatch.index + protectMatch[0].length;
      }
    } else if (reviewMatch) {
      intent = 'review';
      keywordEndInTrimmed = reviewMatch.index + reviewMatch[0].length;
    } else {
      intent = 'protect';
      keywordEndInTrimmed = protectMatch!.index + protectMatch![0].length;
    }

    return {
      intent,
      remainder: trimmed.slice(keywordEndInTrimmed).trim(),
    };
  }

  /** Start index of the first `https?://github.com` occurrence, or -1. */
  private findFirstGithubUrlStartIndex(s: string): number {
    const a = s.indexOf('https://github.com');
    const b = s.indexOf('http://github.com');
    const candidates = [a, b].filter((i) => i !== -1);
    if (candidates.length === 0) {
      return -1;
    }
    return Math.min(...candidates);
  }

  private async processReviewInBackground(
    owner: string,
    repo: string,
    prNumber: number,
    requester?: string,
  ) {
    const startedAt = new Date();
    try {
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
      const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
      await this.logStashService.appendReviewEntry(
        this.logStashService.composeReviewEntry({
          startedAt,
          endedAt,
          llmSeconds: metrics.llmSeconds,
          prUrl,
          prOwner: prData.authorLogin,
          requester: this.logStashService.resolveRequester(requester),
          event: reviewResult.event,
          isFirstReview,
          diffChars: metrics.diffChars,
          conversationChars: metrics.conversationChars,
          filesCount: metrics.filesCount,
          languages: metrics.languages,
        }),
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
    const maxScan = Math.min(text.length, 32_000);
    const window = text.slice(0, maxScan);

    // 1) MS Teams / HTML: href="https://github.com/..." (bounded scan, no unbounded [^"]+ ReDoS)
    const hrefNeedle = 'href="';
    let hrefIdx = window.indexOf(hrefNeedle);
    while (hrefIdx !== -1) {
      const valueStart = hrefIdx + hrefNeedle.length;
      const valueEnd = window.indexOf('"', valueStart);
      if (valueEnd !== -1 && valueEnd - valueStart <= 512) {
        const href = window.slice(valueStart, valueEnd);
        if (this.isGithubPullRequestUrl(href)) {
          return this.stripUrlHashQuery(href);
        }
      }
      hrefIdx = window.indexOf(hrefNeedle, hrefIdx + 1);
    }

    // 2) Plain text: fix "https: //" only in a short prefix (bounded replaces)
    let candidate = window;
    const schemeFixLen = Math.min(candidate.length, 800);
    candidate =
      candidate.slice(0, schemeFixLen).replace(/https\s*:\s*\/\//gi, 'https://') +
      candidate.slice(schemeFixLen);

    const schemes = ['https://github.com/', 'http://github.com/'];
    for (const prefix of schemes) {
      let at = candidate.indexOf(prefix);
      while (at !== -1) {
        const end = this.endOfUrlInText(candidate, at);
        const slice = candidate.slice(at, end);
        if (this.isGithubPullRequestUrl(slice)) {
          return this.stripUrlHashQuery(slice);
        }
        at = candidate.indexOf(prefix, at + 1);
      }
    }

    // No PR URL found in scanned window — return empty so callers show a clear
    // “no link” message instead of passing a random snippet to URL parsing.
    return '';
  }

  private endOfUrlInText(s: string, start: number): number {
    const max = Math.min(s.length, start + 400);
    for (let i = start; i < max; i++) {
      const c = s[i];
      if (c <= ' ' || c === '"' || c === "'" || c === '<' || c === ')' || c === ']') {
        return i;
      }
    }
    return max;
  }

  private stripUrlHashQuery(url: string): string {
    const q = url.indexOf('?');
    const h = url.indexOf('#');
    let cut = url.length;
    if (q !== -1) cut = Math.min(cut, q);
    if (h !== -1) cut = Math.min(cut, h);
    return url.slice(0, cut);
  }

  private isGithubPullRequestUrl(candidate: string): boolean {
    try {
      const u = new URL(candidate);
      if (u.hostname !== 'github.com') return false;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 4) return false;
      if (parts[2] !== 'pull' && parts[2] !== 'pulls') return false;
      return /^\d+$/.test(parts[3]);
    } catch {
      return false;
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
