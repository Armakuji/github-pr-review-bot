import {
  PullRequestFile,
  ReviewResult,
} from '../../github/interfaces/github.interface';

export interface ReviewRequest {
  prTitle: string;
  prDescription: string;
  baseBranch: string;
  headBranch: string;
  files: PullRequestFile[];
}

export { ReviewResult, PullRequestFile };
