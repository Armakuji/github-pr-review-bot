# GitHub PR Review Bot

An automated code review bot that uses **Claude AI** to review GitHub pull requests. Built with **NestJS**, **Octokit**, and the **Anthropic SDK**.

When a pull request is opened or updated, the bot receives a webhook event, fetches the diff, sends it to Claude for analysis, and posts a structured review with file-by-file feedback directly on the PR.

## Architecture

```
GitHub / Manual Request
  │
  │  ┌─ Pull Request Event (opened / synchronize / reopened) [AUTO MODE]
  │  ├─ Issue Comment Event (with trigger keyword) [COMMENT MODE]
  │  └─ Manual API Call (POST /review/pr: `review <url>` or `protect <url>`) [MANUAL MODE]
  ▼:
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
  │  generate structured review (summary + file-by-file comments with severity)
  ▼
GitHub Review API (Octokit)
  │
  │  post review with file-by-file feedback on the PR
  ▼
Done ✓
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
3. **Manual (API call)**: Send a POST request to `/review/pr` with `**review <url>`** (AI review) or `**protect <url>**` (push back on unfair comments) — same path, keyword picks the mode (see API Endpoints section)

## API Endpoints


| Method | Path              | Description                                                      |
| ------ | ----------------- | ---------------------------------------------------------------- |
| `GET`  | `/webhook/health` | Health check                                                     |
| `POST` | `/webhook/github` | GitHub webhook receiver                                          |
| `POST` | `/review/pr`      | Manual review (`review <url>`) or protect mode (`protect <url>`) |


### Manual PR Review & Protect

Use the same endpoint; the **first word** selects the mode, then paste the PR URL:

- `**review https://github.com/owner/repo/pull/123`** — run the AI code review on the PR.
- `**protect https://github.com/owner/repo/pull/123**` — analyze others’ comments and reply when they deserve pushback.

**Endpoint:** `POST /review/pr`

**Examples using curl:**

```bash
# AI review
curl -X POST http://localhost:3000/review/pr \
  -H "Content-Type: application/json" \
  -d '{"text": "review https://github.com/Armakuji/github-pr-review-bot/pull/8"}'

# Protect mode (rebut unfair review comments)
curl -X POST http://localhost:3000/review/pr \
  -H "Content-Type: application/json" \
  -d '{"text": "protect https://github.com/Armakuji/github-pr-review-bot/pull/8"}'
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

### Severity Levels

The bot categorizes issues into three severity levels:


| Severity        | Description                                                                       | Badge      |
| --------------- | --------------------------------------------------------------------------------- | ---------- |
| 🔴 **Critical** | Security vulnerabilities, data loss risks, critical bugs causing crashes/failures | `CRITICAL` |
| 🟠 **High**     | Major bugs, significant performance issues, missing critical error handling       | `HIGH`     |
| 🟡 **Medium**   | Moderate issues, code quality problems, potential bugs, minor performance issues  | `MEDIUM`   |


### Automatic Decision Making

The bot automatically determines the review verdict based on severity:

- **REQUEST_CHANGES**: If any **critical** or **high** severity issues are found
- **APPROVE**: If only **medium** severity issues are found (or no issues are found)

### Review Format

Each review includes:

- **Summary** with severity breakdown and conclusion
- **Inline comments** on the PR diff (each comment includes severity)
- **Automatic verdict** (Approve/Request Changes)

## License

MIT