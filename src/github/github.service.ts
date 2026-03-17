import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import {
  PullRequestFile,
  ReviewResult,
} from './interfaces/github.interface';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.zip', '.tar', '.gz', '.pdf',
  '.lock',
]);

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

    return data
      .filter((file) => {
        if (!file.patch) return false;
        const ext = file.filename.substring(file.filename.lastIndexOf('.'));
        return !BINARY_EXTENSIONS.has(ext.toLowerCase());
      })
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
          body: this.formatCommentWithSeverity(c.body, c.severity),
        })),
      });
    } catch (error: any) {
      this.logger.error(`Failed to submit review: ${error.message}`);

      this.logger.log('Falling back to comment-only review');
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitSha,
        body: this.buildFallbackBody(review),
        event: 'COMMENT',
        comments: [],
      });
    }
  }

  /**
   * Validates that comment line numbers exist within the actual PR diff hunks.
   * GitHub rejects review comments on lines not part of the diff.
   */
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
      const lines = this.parseDiffLines(file.patch);
      diffLinesByFile.set(file.filename, lines);
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

  private formatCommentWithSeverity(body: string, severity: string): string {
    const badges = {
      critical: '🔴 **CRITICAL**',
      high: '🟠 **HIGH**',
      medium: '🟡 **MEDIUM**',
    };

    const badge = badges[severity as keyof typeof badges] || '🟡 **MEDIUM**';
    return `${badge}\n\n${body}`;
  }

  private buildFallbackBody(review: ReviewResult): string {
    let body = review.summary;

    if (review.comments.length > 0) {
      body += '\n\n---\n\n### Inline Comments\n\n';
      for (const comment of review.comments) {
        const severityBadge = this.getSeverityBadge(comment.severity);
        body += `${severityBadge} **\`${comment.path}\`** (line ${comment.line}):\n${comment.body}\n\n`;
      }
    }

    return body;
  }

  private getSeverityBadge(severity: string): string {
    const badges = {
      critical: '🔴 **CRITICAL**',
      high: '🟠 **HIGH**',
      medium: '🟡 **MEDIUM**',
    };
    return badges[severity as keyof typeof badges] || '🟡 **MEDIUM**';
  }
}
