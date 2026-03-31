/** One review metrics row (written to `logStash/mm_yyyy.csv` after a completed PR review). */
export interface ReviewLogStashEntry {
  timestamp: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  /** Wall-clock time spent in the LLM API call (round-trip). */
  llm_seconds: number;
  /** Rough estimate of human review time from diff size (chars/sec heuristic). */
  estimated_human_seconds: number;
  pr_url: string;
  /** PR author GitHub login. */
  pr_owner: string;
  /** Who triggered the review (display name or login), if known. */
  requester: string;
  decision: 'approve' | 'request_changes' | 'comment';
  is_first_review: boolean;
  diff_chars: number;
  conversation_chars: number;
  files_count: number;
  languages: Record<string, number>;
  baseline_seconds: number;
  time_saved_seconds: number;
}
