import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ReviewRequest } from './interfaces/review.interface';
import { ReviewResult } from '../github/interfaces/github.interface';

const SYSTEM_PROMPT = `You are an expert code reviewer. You review GitHub pull request diffs and provide constructive, actionable feedback.

Your review should focus on:
- Bugs and logical errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Missing error handling
- Potential race conditions or edge cases

Rules:
1. Be concise and specific. Reference exact line numbers from the diff.
2. Only comment on lines that are ADDED or MODIFIED (lines starting with "+" in the diff).
3. Don't nitpick trivial formatting if it's consistent with the codebase style.
4. Praise good patterns when you see them.
5. The "line" field must be the actual line number in the NEW file (shown after the "+" in the @@ hunk header).

Respond ONLY with valid JSON matching this schema:
{
  "summary": "A brief overall assessment of the PR (2-4 sentences)",
  "comments": [
    {
      "path": "path/to/file.ts",
      "line": 42,
      "body": "Your review comment in markdown"
    }
  ],
  "event": "APPROVE | REQUEST_CHANGES | COMMENT"
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

      return {
        summary: parsed.summary || 'Review completed.',
        comments: (parsed.comments || []).map((c: any) => ({
          path: c.path,
          line: Number(c.line),
          side: 'RIGHT' as const,
          body: c.body,
        })),
        event: this.normalizeEvent(parsed.event),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to parse AI response: ${error.message}`);
      return {
        summary: text.slice(0, 2000),
        comments: [],
        event: 'COMMENT',
      };
    }
  }

  private normalizeEvent(
    event: string,
  ): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
    const normalized = event?.toUpperCase?.();
    if (normalized === 'APPROVE') return 'APPROVE';
    if (normalized === 'REQUEST_CHANGES') return 'REQUEST_CHANGES';
    return 'COMMENT';
  }
}
