import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewLogStashEntry } from 'src/shared/interfaces/review-log-stash.interface';
import { formatZonedIso } from 'src/shared/utils/zoned-iso.util';

@Injectable()
export class LogStashService {
  private readonly logger = new Logger(LogStashService.name);
  private readonly timeZone: string;
  private readonly baselineSeconds: number;
  private readonly logDir: string;
  private readonly defaultRequester: string;

  constructor(private readonly configService: ConfigService) {
    this.timeZone =
      this.configService.get<string>('logStash.timeZone') ?? 'Asia/Bangkok';
    this.baselineSeconds =
      this.configService.get<number>('logStash.baselineSeconds') ?? 1800;
    this.logDir =
      this.configService.get<string>('logStash.dir') ?? 'logStash';
    this.defaultRequester =
      this.configService.get<string>('logStash.defaultRequester') ??
      'NitiponArm';
  }

  /** Use explicit requester when set; otherwise `logStash.defaultRequester`. */
  resolveRequester(explicit?: string | null): string {
    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim();
    }
    return this.defaultRequester;
  }

  /**
   * Builds one log line payload (timestamps use configured `logStash.timeZone`).
   */
  composeReviewEntry(params: {
    startedAt: Date;
    endedAt: Date;
    codexSeconds: number;
    prUrl: string;
    prOwner: string;
    requester: string;
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
    isFirstReview: boolean;
    diffChars: number;
    conversationChars: number;
    filesCount: number;
    languages: Record<string, number>;
  }): ReviewLogStashEntry {
    const durationSeconds =
      (params.endedAt.getTime() - params.startedAt.getTime()) / 1000;
    const estimatedHumanSeconds = this.estimateHumanSeconds(params.diffChars);
    const timeSavedSeconds = estimatedHumanSeconds - durationSeconds;

    return {
      timestamp: this.formatZoned(params.endedAt),
      started_at: this.formatZoned(params.startedAt),
      ended_at: this.formatZoned(params.endedAt),
      duration_seconds: durationSeconds,
      codex_seconds: params.codexSeconds,
      estimated_human_seconds: estimatedHumanSeconds,
      pr_url: params.prUrl,
      pr_owner: params.prOwner,
      requester: params.requester,
      decision: mapGithubEvent(params.event),
      is_first_review: params.isFirstReview,
      diff_chars: params.diffChars,
      conversation_chars: params.conversationChars,
      files_count: params.filesCount,
      languages: params.languages,
      baseline_seconds: this.baselineSeconds,
      time_saved_seconds: timeSavedSeconds,
    };
  }

  /**
   * Appends one entry to a JSON array in `logStash/mm_yyyy.json` (read → push → write).
   * Existing NDJSON lines are migrated into the array when first rewritten.
   */
  async appendReviewEntry(entry: ReviewLogStashEntry): Promise<void> {
    const now = new Date();
    const fileName = this.monthYearFileName(now);
    const dir = path.isAbsolute(this.logDir)
      ? this.logDir
      : path.join(process.cwd(), this.logDir);
    const filePath = path.join(dir, fileName);

    try {
      await fs.mkdir(dir, { recursive: true });
      const existing = await this.readExistingEntries(filePath);
      existing.push(entry);
      await fs.writeFile(
        filePath,
        `${JSON.stringify(existing, null, 4)}\n`,
        'utf8',
      );
    } catch (err: any) {
      this.logger.warn(
        `LogStash: failed to write ${filePath}: ${err?.message ?? err}`,
      );
    }
  }

  private async readExistingEntries(
    filePath: string,
  ): Promise<ReviewLogStashEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        return [];
      }
      throw e;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed as ReviewLogStashEntry[];
      }
      if (typeof parsed === 'object' && parsed !== null) {
        return [parsed as ReviewLogStashEntry];
      }
    } catch {
      // Legacy NDJSON: one JSON object per line
      const out: ReviewLogStashEntry[] = [];
      for (const line of trimmed.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          out.push(JSON.parse(t) as ReviewLogStashEntry);
        } catch {
          /* skip bad line */
        }
      }
      return out;
    }

    return [];
  }

  formatZoned(date: Date): string {
    return formatZonedIso(date, this.timeZone);
  }

  getBaselineSeconds(): number {
    return this.baselineSeconds;
  }

  /** Heuristic: ~4.2 chars/sec sustained read of a diff (tunable). */
  estimateHumanSeconds(diffChars: number): number {
    return Math.round(diffChars / 4.2);
  }

  /** File name `mm_yyyy.json` using calendar month/year in `logStash.timeZone`. */
  private monthYearFileName(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === t)?.value ?? '01';
    return `${get('month')}_${get('year')}.json`;
  }
}

function mapGithubEvent(
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
): ReviewLogStashEntry['decision'] {
  if (event === 'REQUEST_CHANGES') return 'request_changes';
  if (event === 'APPROVE') return 'approve';
  return 'comment';
}
