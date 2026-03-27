export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  github: {
    token: process.env.GITHUB_TOKEN,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  review: {
    triggerMode: process.env.REVIEW_TRIGGER_MODE || 'both',
  },
  logStash: {
    /** IANA timezone for timestamps and monthly log file name (default Asia/Bangkok, +07:00). */
    timeZone: process.env.LOGSTASH_TIMEZONE || 'Asia/Bangkok',
    baselineSeconds: parseInt(process.env.LOGSTASH_BASELINE_SECONDS || '1800', 10),
    /** Directory for `mm_yyyy.json` (relative to cwd unless absolute). */
    dir: process.env.LOGSTASH_DIR || 'logStash',
    /** Default `requester` in log entries when none is provided (e.g. manual review without `requester` in body). */
    defaultRequester: process.env.LOGSTASH_REQUESTER || 'NitiponArm',
  },
});
