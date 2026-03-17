import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ReviewRequest } from './interfaces/review.interface';
import { ReviewResult } from '../github/interfaces/github.interface';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MODEL_DISPLAY_NAME = 'Claude Sonnet 4';

const SYSTEM_PROMPT = `You are an expert code reviewer. Analyze PR diffs and provide concise, actionable feedback.

Focus on:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Missing error handling
- Edge cases

Severity:
- **critical**: Security flaws, data loss, crashes
- **high**: Major bugs, performance issues, missing error handling
- **medium**: Code quality, potential bugs, minor issues

Rules:
1. Keep comments SHORT (1-2 sentences max)
2. Only comment on ADDED lines (starting with "+")
3. Line numbers = NEW file line numbers
4. Skip trivial style issues

Respond ONLY with valid JSON:
{
  "summary": "Brief assessment (1-2 sentences)",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "body": "Short, actionable comment",
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
          comments,
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
    severityCounts: { critical: number; high: number; medium: number },
    comments: { path: string; line: number; body: string; severity: string }[]
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

    const fileByFile = this.buildFileByFileComments(comments);
    const conclusion = this.buildConclusion(severityCounts);
    const footer = `\n\n---\n*Reviewed by ${MODEL_DISPLAY_NAME} 🤖*`;
    
    return `${summary}${severityBreakdown}${fileByFile}\n\n${conclusion}${footer}`;
  }

  private buildFileByFileComments(comments: { path: string; line: number; body: string; severity: string }[]): string {
    if (comments.length === 0) return '';

    const byFile = new Map<string, { line: number; body: string; severity: string }[]>();
    for (const c of comments) {
      const list = byFile.get(c.path) || [];
      list.push({ line: c.line, body: c.body, severity: c.severity });
      byFile.set(c.path, list);
    }

    let result = '\n\n## Review by File\n\n';
    for (const [path, items] of byFile) {
      result += `### \`${path}\`\n\n`;
      for (const item of items) {
        const badge = this.getSeverityBadge(item.severity);
        result += `- ${badge} (line ${item.line}): ${item.body}\n\n`;
      }
    }
    return result;
  }

  private getSeverityBadge(severity: string): string {
    const badges = {
      critical: '🔴 **CRITICAL**',
      high: '🟠 **HIGH**',
      medium: '🟡 **MEDIUM**',
    };
    return badges[severity as keyof typeof badges] || '🟡 **MEDIUM**';
  }

  private buildConclusion(severityCounts: { critical: number; high: number; medium: number }): string {
    if (severityCounts.critical > 0) {
      return '**❌ Conclusion**: Changes requested due to **critical** issues that must be addressed.';
    }

    if (severityCounts.high > 0) {
      return '**❌ Conclusion**: Changes requested due to **high severity** issues that should be fixed.';
    }

    if (severityCounts.medium > 0) {
      return '**✅ Conclusion**: Approved with medium severity suggestions. Consider addressing them when possible.';
    }

    return '**✅ Conclusion**: Approved! No issues found.';
  }
}
