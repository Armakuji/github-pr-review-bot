import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import {
  PullRequestFile,
  ReviewResult,
} from './interfaces/github.interface';
import { BINARY_EXTENSIONS, IGNORE_PATTERNS, MAX_FILES } from '../shared/constants/ignored-files.constant';

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
    await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: commitSha,
      body: review.summary,
      event: review.event,
      comments: [],
    });
  }
}
