import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { WebhookModule } from './webhook/webhook.module';
import { GithubModule } from './github/github.module';
import { ReviewModule } from './review/review.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    WebhookModule,
    GithubModule,
    ReviewModule,
  ],
})
export class AppModule {}
