import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewLogStashEntry } from 'src/shared/interfaces/review-log-stash.interface';
import { formatZonedIso } from 'src/shared/utils/zoned-iso.util';
import {
  REVIEW_LOG_STASH_CSV_HEADER,
  formatReviewLogStashCsvRow,
} from 'src/shared/utils/review-log-stash-csv.util';

@Injectable()
export class LogStashService {
  private readonly logger = new Logger(LogStashService.name);
  private readonly timeZone: string;
  private readonly baselineSeconds: number;
  private readonly logDir: string;
  private readonly defaultRequester: string;
  private readonly csvAgent: string;

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
    this.csvAgent =
      this.configService.get<string>('logStash.csvAgent') ?? 'Claude Sonnet 4';
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
    llmSeconds: number;
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
      llm_seconds: params.llmSeconds,
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
   * Appends one row to `logStash/mm_yyyy.csv`. If the CSV is missing but a legacy
   * `mm_yyyy.json` exists, that file is converted into the CSV first (same month).
   */
  async appendReviewEntry(entry: ReviewLogStashEntry): Promise<void> {
    const now = new Date();
    const fileName = this.monthYearCsvFileName(now);
    const dir = path.isAbsolute(this.logDir)
      ? this.logDir
      : path.join(process.cwd(), this.logDir);
    const csvPath = path.join(dir, fileName);
    const legacyJsonPath = csvPath.replace(/\.csv$/i, '.json');
    const agent = this.csvAgent;

    try {
      await fs.mkdir(dir, { recursive: true });

      let csvHasRows = false;
      try {
        const st = await fs.stat(csvPath);
        csvHasRows = st.size > 0;
      } catch (e: any) {
        if (e?.code !== 'ENOENT') {
          throw e;
        }
      }

      const row = formatReviewLogStashCsvRow(entry, agent);

      if (csvHasRows) {
        await fs.appendFile(csvPath, `${row}\n`, 'utf8');
        return;
      }

      const prior = await this.tryReadLegacyJsonEntries(legacyJsonPath);
      const lines = [REVIEW_LOG_STASH_CSV_HEADER];
      for (const e of prior) {
        lines.push(formatReviewLogStashCsvRow(e, agent));
      }
      lines.push(row);
      await fs.writeFile(csvPath, `${lines.join('\n')}\n`, 'utf8');
    } catch (err: any) {
      this.logger.warn(
        `LogStash: failed to write ${csvPath}: ${err?.message ?? err}`,
      );
    }
  }

  private async tryReadLegacyJsonEntries(
    jsonPath: string,
  ): Promise<ReviewLogStashEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(jsonPath, 'utf8');
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        return [];
      }
      throw e;
    }
    return this.parseJsonLogContent(raw.trim());
  }

  private parseJsonLogContent(trimmed: string): ReviewLogStashEntry[] {
    if (!trimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => coerceLogEntry(x))
          .filter((x): x is ReviewLogStashEntry => x !== null);
      }
      if (typeof parsed === 'object' && parsed !== null) {
        const one = coerceLogEntry(parsed);
        return one ? [one] : [];
      }
    } catch {
      const out: ReviewLogStashEntry[] = [];
      for (const line of trimmed.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          const one = coerceLogEntry(JSON.parse(t));
          if (one) out.push(one);
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

  /** File name `mm_yyyy.csv` using calendar month/year in `logStash.timeZone`. */
  private monthYearCsvFileName(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const get = (t: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === t)?.value ?? '01';
    return `${get('month')}_${get('year')}.csv`;
  }
}

/** Drops JSON/NDJSON objects that are not shaped like `ReviewLogStashEntry`. */
function coerceLogEntry(raw: unknown): ReviewLogStashEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.llm_seconds !== 'number') {
    return null;
  }
  return o as unknown as ReviewLogStashEntry;
}

function mapGithubEvent(
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
): ReviewLogStashEntry['decision'] {
  if (event === 'REQUEST_CHANGES') return 'request_changes';
  if (event === 'APPROVE') return 'approve';
  return 'comment';
}
