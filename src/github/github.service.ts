import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import {
  PullRequestFile,
  ReviewResult,
  GithubPullReviewComment,
  GithubIssueComment,
} from './interfaces/github.interface';
import { BINARY_EXTENSIONS, IGNORE_PATTERNS, MAX_FILES } from '../shared/constants/ignored-files.constant';
import {
  SEVERITY_BADGE_CRITICAL,
  SEVERITY_BADGE_HIGH,
  SEVERITY_BADGE_MEDIUM,
} from '../shared/constants/severity-badges.constant';

@Injectable()
export class GithubService implements OnModuleInit {
  private readonly logger = new Logger(GithubService.name);
  private octokit!: Octokit;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const token = this.configService.get<string>('github.token');
    if (!token) {
      throw new Error('GITHUB_TOKEN is required');
    }
    this.octokit = new Octokit({ auth: token });
  }

  /** Login for the authenticated token (used to skip our own comments). */
  async getAuthenticatedLogin(): Promise<string> {
    const { data } = await this.octokit.users.getAuthenticated();
    return data.login;
  }

  /** All inline review comments on the PR (includes replies). */
  async listPullRequestReviewComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubPullReviewComment[]> {
    const data = await this.octokit.paginate(this.octokit.pulls.listReviewComments, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    return data.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      path: c.path,
      line: c.line ?? null,
      user: c.user ? { login: c.user.login } : null,
      in_reply_to_id: c.in_reply_to_id ?? null,
    }));
  }

  /** Top-level comments on the PR conversation (issue timeline). */
  async listIssueComments(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<GithubIssueComment[]> {
    const data = await this.octokit.paginate(this.octokit.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });

    return data.map((c) => ({
      id: c.id,
      body: c.body ?? '',
      user: c.user ? { login: c.user.login } : null,
    }));
  }

  /** Reply in an inline review thread (GitHub “Apply suggestion” style). */
  async replyToReviewComment(
    owner: string,
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    await this.octokit.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: prNumber,
      comment_id: commentId,
      body,
    });
  }

  /** Post a new comment on the PR conversation timeline. */
  async createIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }

  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ) {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      head: {
        sha: data.head.sha,
        ref: data.head.ref,
      },
      base: {
        sha: data.base.sha,
        ref: data.base.ref,
      },
    };
  }

  async getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestFile[]> {
    const { data } = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const filtered = data.filter((file) => {
      if (!file.patch) return false;
      
      if (file.status === 'removed') return false;
      
      if (IGNORE_PATTERNS.some(pattern => pattern.test(file.filename))) {
        return false;
      }
      
      const ext = file.filename.substring(file.filename.lastIndexOf('.'));
      return !BINARY_EXTENSIONS.has(ext.toLowerCase());
    });

    if (filtered.length > MAX_FILES) {
      this.logger.warn(
        `PR has ${filtered.length} files. Limiting review to first ${MAX_FILES} files.`
      );
    }

    return filtered
      .slice(0, MAX_FILES)
      .map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      }));
  }

  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    review: ReviewResult,
  ): Promise<void> {
    const validComments = await this.filterValidComments(
      owner,
      repo,
      prNumber,
      review.comments,
    );

    try {
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitSha,
        body: review.summary,
        event: review.event,
        comments: validComments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          body: this.formatInlineCommentBody(c.body, c.severity),
        })),
      });
    } catch (error: any) {
      const isOwnPRCannotRequestChanges =
        error?.status === 422 &&
        typeof error?.message === 'string' &&
        error.message.includes('request changes on your own pull request');

      const isOwnPRCannotApprove =
        error?.status === 422 &&
        typeof error?.message === 'string' &&
        error.message.includes('approve your own pull request');

      if (isOwnPRCannotRequestChanges && review.event === 'REQUEST_CHANGES') {
        this.logger.warn('Cannot request changes on own PR. Posting COMMENT instead.');
        await this.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: commitSha,
          body: review.summary,
          event: 'COMMENT',
          comments: validComments.map((c) => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body: this.formatInlineCommentBody(c.body, c.severity),
          })),
        });
        return;
      }

      if (isOwnPRCannotApprove && review.event === 'APPROVE') {
        this.logger.warn('Cannot approve own PR. Posting COMMENT instead.');
        await this.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          commit_id: commitSha,
          body: review.summary,
          event: 'COMMENT',
          comments: validComments.map((c) => ({
            path: c.path,
            line: c.line,
            side: c.side,
            body: this.formatInlineCommentBody(c.body, c.severity),
          })),
        });
        return;
      }

      this.logger.error(`Failed to submit review: ${error?.message || error}`);
      throw error;
    }
  }

  private formatInlineCommentBody(body: string, severity: ReviewResult['comments'][number]['severity']): string {
    const header =
      severity === 'critical'
        ? SEVERITY_BADGE_CRITICAL
        : severity === 'high'
          ? SEVERITY_BADGE_HIGH
          : SEVERITY_BADGE_MEDIUM;

    // Header on first line so it’s always visible in GitHub UI.
    return `${header}\n\n${body}`;
  }

  private async filterValidComments(
    owner: string,
    repo: string,
    prNumber: number,
    comments: ReviewResult['comments'],
  ) {
    if (comments.length === 0) return [];

    const { data: files } = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const diffLinesByFile = new Map<string, Set<number>>();
    for (const file of files) {
      if (!file.patch) continue;
      diffLinesByFile.set(file.filename, this.parseDiffLines(file.patch));
    }

    return comments.filter((comment) => {
      const validLines = diffLinesByFile.get(comment.path);
      if (!validLines) return false;
      return validLines.has(comment.line);
    });
  }

  private parseDiffLines(patch: string): Set<number> {
    const lines = new Set<number>();
    let currentLine = 0;

    for (const line of patch.split('\n')) {
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentLine = parseInt(hunkMatch[1], 10);
        continue;
      }

      if (line.startsWith('-')) continue;

      if (line.startsWith('+') || line.startsWith(' ')) {
        lines.add(currentLine);
        currentLine++;
      }
    }

    return lines;
  }
}
