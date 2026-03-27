/**
 * Formats a Date as ISO-8601 with explicit offset for a named IANA timezone
 * (e.g. `2026-03-27T03:09:54+07:00`).
 */
export function formatZonedIso(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '00';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');

  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const tzPart =
    offsetFormatter.formatToParts(date).find((p) => p.type === 'timeZoneName')
      ?.value ?? 'GMT+00:00';

  let offset = '+00:00';
  const m = tzPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (m) {
    const sign = m[1];
    const hh = m[2].padStart(2, '0');
    const mm = (m[3] ?? '00').padStart(2, '0');
    offset = `${sign}${hh}:${mm}`;
  }

  return `${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`;
}
