import { Module } from '@nestjs/common';
import { GithubService } from 'src/github/github.service';

@Module({
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
