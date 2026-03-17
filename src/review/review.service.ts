import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ReviewRequest } from './interfaces/review.interface';
import { ReviewResult } from '../github/interfaces/github.interface';

const SYSTEM_PROMPT = `You are an expert code reviewer. You review GitHub pull request diffs and provide constructive, actionable feedback with severity levels.

Your review should focus on:
- Bugs and logical errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Missing error handling
- Potential race conditions or edge cases

Severity Levels:
- **critical**: Security vulnerabilities, data loss risks, critical bugs that will cause crashes or system failures
- **high**: Major bugs, significant performance issues, missing critical error handling, logic errors
- **medium**: Moderate issues, code quality problems, potential bugs, minor performance issues
- **low**: Style issues, minor improvements, suggestions for better practices

Rules:
1. Be concise and specific. Reference exact line numbers from the diff.
2. Only comment on lines that are ADDED or MODIFIED (lines starting with "+" in the diff).
3. Don't nitpick trivial formatting if it's consistent with the codebase style.
4. Praise good patterns when you see them.
5. The "line" field must be the actual line number in the NEW file (shown after the "+" in the @@ hunk header).
6. Every comment MUST include a severity level.

Respond ONLY with valid JSON matching this schema:
{
  "summary": "A brief overall assessment of the PR (2-4 sentences)",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "body": "Your review comment in markdown",
      "severity": "critical" | "high" | "medium" | "low"
    }
  ]
}

Use "APPROVE" only if the code is solid. Use "REQUEST_CHANGES" for bugs or security issues. Use "COMMENT" for suggestions and minor improvements.`;

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
      model: 'claude-sonnet-4-20250514',
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
        summary: this.buildSummaryWithSeverity(parsed.summary || 'Review completed.', severityCounts),
        comments,
        event,
        severityCounts,
      };
    } catch (error: any) {
      this.logger.warn(`Failed to parse AI response: ${error.message}`);
      return {
        summary: text.slice(0, 2000),
        comments: [],
        event: 'COMMENT',
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      };
    }
  }

  private normalizeSeverity(severity: string): 'critical' | 'high' | 'medium' | 'low' {
    const normalized = severity?.toLowerCase?.();
    if (normalized === 'critical') return 'critical';
    if (normalized === 'high') return 'high';
    if (normalized === 'medium') return 'medium';
    return 'low';
  }

  private calculateSeverityCounts(comments: any[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
  } {
    return comments.reduce(
      (counts, comment) => {
        counts[comment.severity]++;
        return counts;
      },
      { critical: 0, high: 0, medium: 0, low: 0 }
    );
  }

  private determineReviewEvent(severityCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  }): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
    if (severityCounts.critical > 0 || severityCounts.high > 0) {
      return 'REQUEST_CHANGES';
    }
    
    if (severityCounts.medium > 0 || severityCounts.low > 0) {
      return 'COMMENT';
    }
    
    return 'APPROVE';
  }

  private buildSummaryWithSeverity(
    summary: string,
    severityCounts: { critical: number; high: number; medium: number; low: number }
  ): string {
    const total = Object.values(severityCounts).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
      return `${summary}\n\n✅ **No issues found** - Code looks good!`;
    }

    let severityBreakdown = '\n\n## Issue Severity Breakdown\n\n';
    
    if (severityCounts.critical > 0) {
      severityBreakdown += `🔴 **Critical**: ${severityCounts.critical}\n`;
    }
    if (severityCounts.high > 0) {
      severityBreakdown += `🟠 **High**: ${severityCounts.high}\n`;
    }
    if (severityCounts.medium > 0) {
      severityBreakdown += `🟡 **Medium**: ${severityCounts.medium}\n`;
    }
    if (severityCounts.low > 0) {
      severityBreakdown += `🟢 **Low**: ${severityCounts.low}\n`;
    }

    const conclusion = this.buildConclusion(severityCounts);
    
    return `${summary}${severityBreakdown}\n${conclusion}`;
  }

  private buildConclusion(severityCounts: { critical: number; high: number; medium: number; low: number }): string {
    if (severityCounts.critical > 0) {
      return '**❌ Conclusion**: Changes requested due to **critical** issues that must be addressed.';
    }
    
    if (severityCounts.high > 0) {
      return '**❌ Conclusion**: Changes requested due to **high severity** issues that should be fixed.';
    }
    
    if (severityCounts.medium > 0) {
      return '**💬 Conclusion**: Code is generally good, but consider addressing the medium severity suggestions.';
    }
    
    if (severityCounts.low > 0) {
      return '**💬 Conclusion**: Minor suggestions provided. Feel free to address them or proceed.';
    }
    
    return '**✅ Conclusion**: Approved! No issues found.';
  }
}
