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
});
