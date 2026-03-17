# GitHub PR Review Bot

An automated code review bot that uses **Claude AI** to review GitHub pull requests. Built with **NestJS**, **Octokit**, and the **Anthropic SDK**.

When a pull request is opened or updated, the bot receives a webhook event, fetches the diff, sends it to Claude for analysis, and posts a structured review with inline comments directly on the PR.

## Architecture

```
GitHub / Manual Request
  │
  │  ┌─ Pull Request Event (opened / synchronize / reopened) [AUTO MODE]
  │  ├─ Issue Comment Event (with trigger keyword) [COMMENT MODE]
  │  └─ Manual API Call (POST /review/pr with PR URL) [MANUAL MODE]
  ▼
Webhook Receiver (POST /webhook/github) or Review Controller (POST /review/pr)
  │
  │  verify signature (webhook) / parse PR URL (manual) + fetch PR diff
  ▼
PR Processor (WebhookService / ReviewController)
  │
  │  split changed files + build prompt
  ▼
LLM Reviewer (Claude Sonnet 4)
  │
  │  generate structured review (summary + inline comments with severity)
  ▼
GitHub Review API (Octokit)
  │
  │  post review with inline comments on the PR
  ▼
Done ✓
```

## Project Structure

```
src/
├── main.ts                                # App entry point (rawBody enabled)
├── app.module.ts                          # Root module
├── config/
│   └── configuration.ts                   # Environment-based configuration
├── webhook/
│   ├── webhook.module.ts
│   ├── webhook.controller.ts              # POST /webhook/github, GET /webhook/health
│   ├── webhook.service.ts                 # Review orchestration
│   ├── guards/
│   │   └── webhook-signature.guard.ts     # HMAC-SHA256 verification
│   └── interfaces/
│       └── webhook-event.interface.ts     # GitHub event payload types
├── github/
│   ├── github.module.ts
│   ├── github.service.ts                  # Octokit: fetch files, submit reviews
│   └── interfaces/
│       └── github.interface.ts            # PR file & review types
└── review/
    ├── review.module.ts
    ├── review.service.ts                  # Claude AI integration
    └── interfaces/
        └── review.interface.ts            # Review request types
```

## Prerequisites

- **Node.js** >= 18
- A **GitHub Personal Access Token** with `repo` scope
- An **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)
- A publicly accessible URL (use [ngrok](https://ngrok.com) for local development)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your secrets:

```env
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_WEBHOOK_SECRET=a-random-secret-string
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx
PORT=3000
```


| Variable                | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`          | GitHub Personal Access Token with `repo` scope                                      |
| `GITHUB_WEBHOOK_SECRET` | A random string used to verify webhook payloads                                     |
| `ANTHROPIC_API_KEY`     | Your Anthropic API key                                                              |
| `PORT`                  | Server port (default: `3000`)                                                       |
| `REVIEW_TRIGGER_MODE`   | Trigger mode: `auto` (PR events only), `comment` (manual only), or `both` (default) |


### 3. Start the server

```bash
# Development (with hot reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

### 4. Expose the server publicly (local development)

```bash
npx ngrok http 3000
```

Copy the `https://` forwarding URL from the ngrok output.

### 5. Configure the GitHub webhook

1. Go to your GitHub repository **Settings** > **Webhooks** > **Add webhook**
2. Set the following:


| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| **Payload URL**  | `https://<your-ngrok-url>/webhook/github`                                  |
| **Content type** | `application/json`                                                         |
| **Secret**       | Same value as `GITHUB_WEBHOOK_SECRET` in your `.env`                       |
| **Events**       | Select **"Pull requests"** AND **"Issue comments"** (for comment triggers) |


1. Click **Add webhook**

**Trigger Options:**

The bot can be triggered in three ways:

1. **Automatic (Push action)**: Reviews are automatically posted when a PR is opened, synchronized, or reopened
2. **Manual (Comment trigger)**: Post a comment on any PR containing one of these keywords:
   - `@review-bot`
   - `@bot review`
   - `/review`
3. **Manual (API call)**: Send a POST request to `/review/pr` with the PR URL (see API Endpoints section)

### 6. Test it

**Option 1: Automatic trigger**

- Open or update a pull request in the configured repository

**Option 2: Comment trigger**

- Post a comment on any PR with `@review-bot` or `/review`

**Option 3: Manual API call**

- Send a POST request to `/review/pr` with the PR URL (see API Endpoints section below)

The bot will post a review with:

- A **summary** with severity breakdown and conclusion
- **Inline comments** on specific lines with severity badges (🔴 Critical, 🟠 High, 🟡 Medium)
- An **automatic verdict**:
  - `REQUEST_CHANGES` if critical or high severity issues found
  - `APPROVE` if only medium severity issues found (or no issues found)

## Example Review Output

### Example 1: Critical/High Issues (REQUEST_CHANGES)

**Summary:**
```
This PR adds authentication middleware but has some security concerns.

## Issue Severity Breakdown

| Severity | Count |
|----------|-------|
| 🔴 **Critical** | 1 |
| 🟠 **High** | 2 |
| 🟡 **Medium** | 1 |

❌ Conclusion: Changes requested due to critical issues that must be addressed.

---
*Reviewed by Claude Sonnet 4 🤖*
```

**Inline Comments:**
- 🔴 **CRITICAL** on line 42: "Password is stored in plain text. Must use bcrypt or similar hashing."
- 🟠 **HIGH** on line 67: "SQL query is vulnerable to injection. Use parameterized queries."
- 🟠 **HIGH** on line 89: "Missing authentication check before accessing user data."
- 🟡 **MEDIUM** on line 103: "Error is not logged. Consider adding logging for debugging."

---

### Example 2: Only Medium Issues (APPROVE)

**Summary:**
```
This PR improves error handling in the payment module.

## Issue Severity Breakdown

| Severity | Count |
|----------|-------|
| 🟡 **Medium** | 2 |

✅ Conclusion: Approved with suggestions. Consider addressing the medium severity recommendations.

---
*Reviewed by Claude Sonnet 4 🤖*
```

**Inline Comments:**
- 🟡 **MEDIUM** on line 103: "Error is not logged. Consider adding logging for debugging."
- 🟡 **MEDIUM** on line 142: "Consider extracting this logic into a separate function for better testability."

## API Endpoints

| Method | Path              | Description             |
| ------ | ----------------- | ----------------------- |
| `GET`  | `/webhook/health` | Health check            |
| `POST` | `/webhook/github` | GitHub webhook receiver |
| `POST` | `/review/pr`      | Manual PR review by URL |

### Manual PR Review

You can manually trigger a review by sending a POST request with a GitHub PR URL:

**Endpoint:** `POST /review/pr`

**Request body:**
```json
{
  "prUrl": "https://github.com/owner/repo/pull/123"
}
```

**Example using curl:**
```bash
curl -X POST http://localhost:3000/review/pr \
  -H "Content-Type: application/json" \
  -d '{"prUrl": "https://github.com/Armakuji/github-pr-review-bot/pull/8"}'
```

**Example using fetch:**
```javascript
fetch('http://localhost:3000/review/pr', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prUrl: 'https://github.com/Armakuji/github-pr-review-bot/pull/8'
  })
});
```

**Response:**
```json
{
  "success": true,
  "message": "Review submitted for PR #8",
  "pr": "https://github.com/Armakuji/github-pr-review-bot/pull/8",
  "severityCounts": {
    "critical": 0,
    "high": 0,
    "medium": 2
  },
  "event": "APPROVE"
}
```


## How the AI Review Works

The bot uses **Claude Sonnet 4** to analyze PR diffs. The AI is instructed to:

- Identify **bugs**, **security vulnerabilities**, and **performance issues**
- Flag **missing error handling** and **edge cases**
- Provide **constructive, actionable** feedback
- Categorize issues by **severity level**
- Keep comments **short and concise** (1-2 sentences)
- Return structured JSON with file paths, line numbers, comments, and severity

Each review includes a footer crediting the AI model used: *"Reviewed by Claude Sonnet 4 🤖"*

### Token Optimization

To reduce API costs and improve performance, the bot:

- **Ignores generated/lock files** (case-insensitive):
  - `package-lock.json`, `yarn.lock`
  - Build directories: `dist/`, `build/`, `coverage/`
  - Minified files: `*.min.js`
  - Snapshot files: `*.snap`
  - README files
- **Filters removed files** - Only reviews added/modified files
- **Limits to 20 files** - Reviews up to 20 most relevant files per PR
- **Short comments** - AI generates concise 1-2 sentence feedback
- **No low severity** - Skips style nitpicks and trivial suggestions

### Severity Levels

The bot categorizes issues into three severity levels:

| Severity | Description | Badge |
|----------|-------------|-------|
| 🔴 **Critical** | Security vulnerabilities, data loss risks, critical bugs causing crashes/failures | `CRITICAL` |
| 🟠 **High** | Major bugs, significant performance issues, missing critical error handling | `HIGH` |
| 🟡 **Medium** | Moderate issues, code quality problems, potential bugs, minor performance issues | `MEDIUM` |

### Automatic Decision Making

The bot automatically determines the review verdict based on severity:

- **REQUEST_CHANGES**: If any **critical** or **high** severity issues are found
- **APPROVE**: If only **medium** severity issues are found (or no issues are found)

### Review Format

Each review includes:
- **Summary** with severity breakdown and conclusion
- **Inline comments** on specific lines with severity badges
- **Automatic verdict** (Approve/Request Changes)

Claude responds with a JSON object that maps directly to GitHub's review API, enabling precise inline comments on the exact lines that need attention.

If any inline comments target invalid diff lines, the bot automatically falls back to posting all feedback as a single summary comment — so no review is ever lost.

## License

MIT