import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ReviewRequest } from './interfaces/review.interface';
import { ReviewResult } from '../github/interfaces/github.interface';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MODEL_DISPLAY_NAME = 'Claude Sonnet 4';

const SYSTEM_PROMPT = `You are a senior software engineer conducting a thorough pull request review. Your goal is to catch real problems before they reach production and help the author grow.

## What to review

### 🔴 Critical — block merge immediately
- Security vulnerabilities: injection, insecure deserialization, exposed secrets/tokens, broken auth
- Data corruption or silent data loss
- Crashes, panics, or unhandled promise rejections that will reach production
- Breaking changes in public APIs or contracts with no migration path

### 🟠 High — should fix before merge
- Incorrect business logic or wrong algorithm
- Race conditions, deadlocks, or concurrency bugs
- Missing error handling on I/O, network, or DB calls
- N+1 queries or obvious O(n²) loops on unbounded data
- Null/undefined dereferences that tests would miss
- Missing input validation on user-controlled data

### 🟡 Medium — fix if feasible, else track
- Code that is hard to read or maintain and will grow into a bug
- Inadequate test coverage for the changed logic
- Misleading variable/function names that create future confusion
- Duplicated logic that belongs in a shared helper
- Unnecessary complexity (over-engineering or under-engineering)

## Rules
1. Only comment on ADDED lines (starting with "+" in the diff).
2. Line numbers must be the new file line numbers (after the change).
3. Keep each comment to 1–3 sentences: state the problem, explain the risk, and then provide the fix using a GitHub suggestion block (see below).
4. Do NOT comment on formatting, whitespace, or purely stylistic preferences.
5. Do NOT repeat the same issue across multiple files — flag it once on the worst instance.
6. If there are no issues, say so clearly and approve.
7. Whenever you have a concrete, single-line (or few-line) fix, include it as a GitHub suggestion block so the author can apply it with one click. A suggestion block replaces exactly the commented line(s) — write only the replacement lines inside the block, with no extra explanation inside the block.

## How to write a suggestion block
Place this markdown inside the "body" field immediately after your explanation:

\`\`\`suggestion
<replacement line(s) here>
\`\`\`

The block must contain the full replacement for the line(s) at the commented position. Do not include the leading "+" from the diff. If the fix spans multiple lines, include all of them inside a single block. If a fix is too complex or spans non-contiguous areas, describe it in prose instead.

## Output format
Respond ONLY with valid JSON — no markdown fences, no prose outside the JSON:
{
  "summary": "2–4 sentence overall assessment: what the PR does, general quality, and the most important concern if any",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "body": "Concise explanation of the problem and risk.\\n\\n\`\`\`suggestion\\nconst value = input ?? defaultValue;\\n\`\`\`",
      "severity": "critical" | "high" | "medium"
    }
  ]
}`;

@Injectable()
export class ReviewService implements OnModuleInit {
  private readonly logger = new Logger(ReviewService.name);
  private client!: Anthropic;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('anthropic.apiKey');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }
    this.client = new Anthropic({ apiKey });
  }

  async reviewChanges(request: ReviewRequest): Promise<ReviewResult> {
    const prompt = this.buildPrompt(request);

    this.logger.log(`Sending ${request.files.length} file(s) for AI review`);

    const message = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: SYSTEM_PROMPT,
    });

    const responseText =
      message.content[0].type === 'text' ? message.content[0].text : '';

    return this.parseResponse(responseText);
  }

  private buildPrompt(request: ReviewRequest): string {
    let prompt = `## Pull Request\n`;
    prompt += `**Title:** ${request.prTitle}\n`;
    prompt += `**Branch:** ${request.headBranch} → ${request.baseBranch}\n`;

    if (request.prDescription) {
      prompt += `**Description:** ${request.prDescription}\n`;
    }

    prompt += `\n## Changed Files\n\n`;

    for (const file of request.files) {
      prompt += `### ${file.filename} (${file.status})\n`;
      prompt += `+${file.additions} -${file.deletions}\n`;
      prompt += `\`\`\`diff\n${file.patch}\n\`\`\`\n\n`;
    }

    prompt += `\nPlease review these changes and respond with the JSON format specified in your instructions.`;

    return prompt;
  }

  private parseResponse(text: string): ReviewResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const comments = (parsed.comments || []).map((c: any) => ({
        path: c.path,
        line: Number(c.line),
        side: 'RIGHT' as const,
        body: c.body,
        severity: this.normalizeSeverity(c.severity),
      }));

      const severityCounts = this.calculateSeverityCounts(comments);
      const event = this.determineReviewEvent(severityCounts);

      return {
        summary: this.buildSummaryWithSeverity(
          parsed.summary || 'Review completed.',
          severityCounts,
        ),
        comments,
        event,
        severityCounts,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to parse AI response: ${error.message}`);
      return {
        summary: `${text.slice(0, 2000)}\n\n---\n*Reviewed by ${MODEL_DISPLAY_NAME} 🤖*`,
        comments: [],
        event: 'COMMENT',
        severityCounts: { critical: 0, high: 0, medium: 0 },
      };
    }
  }

  private normalizeSeverity(severity: string): 'critical' | 'high' | 'medium' {
    const normalized = severity?.toLowerCase?.();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'high') return 'high';
    return 'medium';
  }

  private calculateSeverityCounts(comments: any[]): {
    critical: number;
    high: number;
    medium: number;
  } {
    return comments.reduce(
      (counts, comment) => {
        counts[comment.severity]++;
        return counts;
      },
      { critical: 0, high: 0, medium: 0 }
    );
  }

  private determineReviewEvent(severityCounts: {
    critical: number;
    high: number;
    medium: number;
  }): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
    if (severityCounts.critical > 0 || severityCounts.high > 0) {
      return 'REQUEST_CHANGES';
    }

    return 'APPROVE';
  }

  private buildSummaryWithSeverity(
    summary: string,
    severityCounts: { critical: number; high: number; medium: number }
  ): string {
    const total = Object.values(severityCounts).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
      return `${summary}\n\n✅ **No issues found** - Code looks good!\n\n---\n*Reviewed by ${MODEL_DISPLAY_NAME} 🤖*`;
    }

    let severityBreakdown = '\n\n## Issue Severity Breakdown\n\n';
    severityBreakdown += '| Severity | Count |\n';
    severityBreakdown += '|----------|-------|\n';
    
    if (severityCounts.critical > 0) {
      severityBreakdown += `| 🔴 **Critical** | ${severityCounts.critical} |\n`;
    }
    if (severityCounts.high > 0) {
      severityBreakdown += `| 🟠 **High** | ${severityCounts.high} |\n`;
    }
    if (severityCounts.medium > 0) {
      severityBreakdown += `| 🟡 **Medium** | ${severityCounts.medium} |\n`;
    }

    const conclusion = this.buildConclusion(severityCounts);
    const footer = `\n\n---\n*Reviewed by ${MODEL_DISPLAY_NAME} 🤖*`;
    
    return `${summary}${severityBreakdown}\n${conclusion}${footer}`;
  }

  private buildConclusion(severityCounts: { critical: number; high: number; medium: number }): string {
    if (severityCounts.critical > 0) {
      return [
        '**❌ Conclusion**: REQUEST_CHANGES — critical issues found.',
        '',
        '**Next steps**:',
        '- Fix all **critical** items before merging.',
      ].join('\n');
    }

    if (severityCounts.high > 0) {
      return [
        '**❌ Conclusion**: REQUEST_CHANGES — high severity issues found.',
        '',
        '**Next steps**:',
        '- Fix all **high** items before merging.',
      ].join('\n');
    }

    if (severityCounts.medium > 0) {
      return [
        '**✅ Conclusion**: APPROVE — no critical/high issues.',
        '',
        `**Notes**: ${severityCounts.medium} medium suggestion(s) included.`,
        '',
        '**Recommended**:',
        '- Address medium items if they’re low effort or in a risky area.',
        '- If you’re merging now, ensure tests/CI are green and behavior is unchanged.',
      ].join('\n');
    }

    return [
      '**✅ Conclusion**: APPROVE — no issues found.',
      '',
      '**Recommended**:',
      '- Merge when ready.',
    ].join('\n');
  }
}
