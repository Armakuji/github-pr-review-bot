import { ReviewLogStashEntry } from 'src/shared/interfaces/review-log-stash.interface';

/** Header row for monthly `mm_yyyy.csv` (review_metrics–compatible columns). */
export const REVIEW_LOG_STASH_CSV_HEADER =
  'timestamp,started_at,ended_at,duration_seconds,agent_seconds,estimated_human_seconds,pr_url,pr_owner,requester,decision,is_first_review,diff_chars,conversation_chars,files_count,languages,agent,baseline_seconds,time_saved_seconds';

function csvEscapeField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function languagesCell(obj: Record<string, number>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, number>>((acc, k) => {
      acc[k] = obj[k];
      return acc;
    }, {});
  let inner = JSON.stringify(sorted);
  inner = inner.replace(/":/g, '": ').replace(/,"/g, ', "');
  return `"${inner.replace(/"/g, '""')}"`;
}

/** One data row (`llm_seconds` maps to `agent_seconds`). */
export function formatReviewLogStashCsvRow(
  entry: ReviewLogStashEntry,
  agentLabel: string,
): string {
  const row: string[] = [
    entry.timestamp,
    entry.started_at,
    entry.ended_at,
    String(entry.duration_seconds),
    String(entry.llm_seconds),
    String(entry.estimated_human_seconds),
    entry.pr_url,
    entry.pr_owner,
    entry.requester,
    entry.decision,
    entry.is_first_review ? 'TRUE' : 'FALSE',
    String(entry.diff_chars),
    String(entry.conversation_chars),
    String(entry.files_count),
    languagesCell(entry.languages),
    agentLabel,
    String(entry.baseline_seconds),
    String(entry.time_saved_seconds),
  ];
  return row
    .map((cell, i) => (i === 13 ? cell : csvEscapeField(cell)))
    .join(',');
}
