import { Module } from '@nestjs/common';
import { WebhookController } from 'src/webhook/webhook.controller';
import { WebhookService } from 'src/webhook/webhook.service';
import { GithubModule } from 'src/github/github.module';
import { ReviewModule } from 'src/review/review.module';

@Module({
  imports: [GithubModule, ReviewModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}
