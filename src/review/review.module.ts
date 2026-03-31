import { Module } from '@nestjs/common';
import { ReviewService } from 'src/review/review.service';
import { ReviewController } from 'src/review/review.controller';
import { GithubModule } from 'src/github/github.module';
import { LogStashService } from 'src/shared/services/log-stash.service';

@Module({
  imports: [GithubModule],
  controllers: [ReviewController],
  providers: [ReviewService, LogStashService],
  exports: [ReviewService, LogStashService],
})
export class ReviewModule {}
