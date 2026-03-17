# GitHub PR Review Bot

An automated code review bot that uses **Claude AI** to review GitHub pull requests. Built with **NestJS**, **Octokit**, and the **Anthropic SDK**.

When a pull request is opened or updated, the bot receives a webhook event, fetches the diff, sends it to Claude for analysis, and posts a structured review with inline comments directly on the PR.

## Architecture

```
GitHub
  │
  │  ┌─ Pull Request Event (opened / synchronize / reopened) [AUTO MODE]
  │  └─ Issue Comment Event (with trigger keyword) [COMMENT MODE]
  ▼
Webhook Receiver (POST /webhook/github)
  │
  │  verify signature + check trigger mode + fetch PR diff
  ▼
PR Processor (WebhookService)
  │
  │  split changed files + build prompt
  ▼
LLM Reviewer (Claude API)
  │
  │  generate structured review (summary + inline comments)
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

The bot can be triggered in two ways:

1. **Automatic (Push action)**: Reviews are automatically posted when a PR is opened, synchronized, or reopened
2. **Manual (Comment trigger)**: Post a comment on any PR containing one of these keywords:
  - `@review-bot`
  - `@bot review`
  - `/review`

### 6. Test it

**Option 1: Automatic trigger**

- Open or update a pull request in the configured repository

**Option 2: Comment trigger**

- Post a comment on any PR with `@review-bot` or `/review`

The bot will post a review with:

- A **summary** with severity breakdown and conclusion
- **Inline comments** on specific lines with severity badges (🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low)
- An **automatic verdict**:
  - `REQUEST_CHANGES` if critical or high severity issues found
  - `COMMENT` if only medium or low severity issues found
  - `APPROVE` if no issues found

## Example Review Output

When the bot reviews a PR, it posts a structured comment like this:

**Summary:**
```
This PR adds authentication middleware but has some security concerns.

## Issue Severity Breakdown

🔴 **Critical**: 1
🟠 **High**: 2
🟡 **Medium**: 1

❌ Conclusion: Changes requested due to critical issues that must be addressed.
```

**Inline Comments:**
- 🔴 **CRITICAL** on line 42: "Password is stored in plain text. Must use bcrypt or similar hashing."
- 🟠 **HIGH** on line 67: "SQL query is vulnerable to injection. Use parameterized queries."
- 🟠 **HIGH** on line 89: "Missing authentication check before accessing user data."
- 🟡 **MEDIUM** on line 103: "Error is not logged. Consider adding logging for debugging."

## API Endpoints


| Method | Path              | Description             |
| ------ | ----------------- | ----------------------- |
| `GET`  | `/webhook/health` | Health check            |
| `POST` | `/webhook/github` | GitHub webhook receiver |


## How the AI Review Works

The bot sends each PR's diff to Claude with a system prompt that instructs it to:

- Identify **bugs**, **security vulnerabilities**, and **performance issues**
- Flag **missing error handling** and **edge cases**
- Provide **constructive, actionable** feedback
- Categorize issues by **severity level**
- Return structured JSON with file paths, line numbers, comments, and severity

### Severity Levels

Each issue is categorized into one of four severity levels:

| Severity | Description | Badge |
|----------|-------------|-------|
| 🔴 **Critical** | Security vulnerabilities, data loss risks, critical bugs causing crashes/failures | `CRITICAL` |
| 🟠 **High** | Major bugs, significant performance issues, missing critical error handling | `HIGH` |
| 🟡 **Medium** | Moderate issues, code quality problems, potential bugs, minor performance issues | `MEDIUM` |
| 🟢 **Low** | Style issues, minor improvements, suggestions for better practices | `LOW` |

### Automatic Decision Making

The bot automatically determines the review verdict based on severity:

- **REQUEST_CHANGES**: If any **critical** or **high** severity issues are found
- **COMMENT**: If only **medium** or **low** severity issues are found
- **APPROVE**: If no issues are found

### Review Format

Each review includes:
- **Summary** with severity breakdown and conclusion
- **Inline comments** on specific lines with severity badges
- **Automatic verdict** (Approve/Request Changes)

Claude responds with a JSON object that maps directly to GitHub's review API, enabling precise inline comments on the exact lines that need attention.

If any inline comments target invalid diff lines, the bot automatically falls back to posting all feedback as a single summary comment — so no review is ever lost.

## License

MIT