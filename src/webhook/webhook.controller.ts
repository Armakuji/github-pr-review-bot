import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UseGuards,
  Logger,
  Get,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookService } from './webhook.service';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard';
import { PullRequestEvent, IssueCommentEvent } from './interfaces/webhook-event.interface';

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly triggerMode: string;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly configService: ConfigService,
  ) {
    this.triggerMode = this.configService.get<string>('review.triggerMode', 'both');
  }

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Post('github')
  @HttpCode(202)
  @UseGuards(WebhookSignatureGuard)
  async handleGithubWebhook(
    @Headers('x-github-event') event: string,
    @Body() payload: PullRequestEvent | IssueCommentEvent,
  ) {
    this.logger.log(`Received GitHub event: ${event}`);

    if (event === 'issue_comment') {
      return this.handleCommentEvent(payload as IssueCommentEvent);
    }

    if (event === 'pull_request') {
      // Only review when explicitly requested via comment command.
      return { message: 'Ignoring pull_request event (comment-only mode)' };
    }

    return { message: `Ignoring event: ${event}` };
  }

  private async handleCommentEvent(payload: IssueCommentEvent) {
    if (this.triggerMode === 'auto') {
      return { message: 'Comment triggers are disabled (trigger mode: auto)' };
    }

    if (payload.action !== 'created') {
      return { message: `Ignoring comment action: ${payload.action}` };
    }

    if (!payload.issue.pull_request) {
      return { message: 'Ignoring comment on non-PR issue' };
    }

    // Only trigger on explicit command: "@Armakuji /review" (case-insensitive, whitespace-tolerant).
    const commentBody = payload.comment.body || '';
    const normalized = commentBody.toLowerCase();
    const hasMention = normalized.includes('@armakuji');
    const hasCommand = normalized.includes('/review');
    const shouldTrigger = hasMention && hasCommand;

    if (!shouldTrigger) {
      return { message: 'Ignoring comment: missing "@Armakuji /review" trigger' };
    }

    this.logger.log(
      `Triggered by comment from ${payload.comment.user.login} on PR #${payload.issue.number}`
    );

    this.webhookService.processPullRequestFromComment(payload).catch((error) => {
      this.logger.error(
        `Failed to process PR #${payload.issue.number}: ${error.message}`,
        error.stack
      );
    });

    return {
      message: `Processing PR #${payload.issue.number} review`,
      pr: payload.issue.html_url,
    };
  }

  private async handlePullRequestEvent(payload: PullRequestEvent) {
    if (this.triggerMode === 'comment') {
      return { message: 'Auto triggers are disabled (trigger mode: comment)' };
    }

    const validActions = ['opened', 'synchronize', 'reopened'];
    if (!validActions.includes(payload.action)) {
      return { message: `Ignoring PR action: ${payload.action}` };
    }

    this.webhookService.processPullRequest(payload).catch((error) => {
      this.logger.error(
        `Failed to process PR #${payload.number}: ${error.message}`,
        error.stack
      );
    });

    return {
      message: `Processing PR #${payload.number} review`,
      pr: payload.pull_request.html_url,
    };
  }
}
