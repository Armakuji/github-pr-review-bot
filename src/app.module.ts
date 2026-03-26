import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from 'src/config/configuration';
import { WebhookModule } from 'src/webhook/webhook.module';
import { GithubModule } from 'src/github/github.module';
import { ReviewModule } from 'src/review/review.module';

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
