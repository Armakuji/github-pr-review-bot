import { Module } from '@nestjs/common';
import { ReviewService } from 'src/review/review.service';
import { ReviewController } from 'src/review/review.controller';
import { GithubModule } from 'src/github/github.module';

@Module({
  imports: [GithubModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
