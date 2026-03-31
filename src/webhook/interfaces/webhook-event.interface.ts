export interface PullRequestEvent {
  action: string;
  number: number;
  /** User who triggered the event (e.g. who pushed or opened the PR). */
  sender?: {
    login: string;
  };
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    head: {
      sha: string;
      ref: string;
    };
    base: {
      sha: string;
      ref: string;
    };
    user: {
      login: string;
    };
    html_url: string;
    diff_url: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
}

export interface IssueCommentEvent {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    pull_request?: {
      url: string;
      html_url: string;
      diff_url: string;
    };
    user: {
      login: string;
    };
  };
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
    };
    created_at: string;
  };
  repository: {
    name: string;
    full_name: string;
    owner: {
      login: string;
    };
  };
}
