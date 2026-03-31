/**
 * Appended to the review system prompt when the PR already has discussion.
 * Instructs the model to reconcile the diff with reviewer feedback and optionally rebut.
 */
export const REVIEW_DISCUSSION_FOLLOWUP_APPEND = `

## Follow-up mode (only when the user message includes "Existing PR discussion")

The PR already has human or bot discussion below. You MUST:

1. **Re-read the diff** in light of every comment. If a reviewer correctly shows that a prior concern was wrong, mistaken, or already addressed, **do not** repeat that finding as a new inline comment.
2. If reviewers convincingly argue the change is correct (e.g. intentional design, false positive), treat those items as **resolved**. Prefer **APPROVE** when no **critical** or **high** severity issues remain after this reconciliation.
3. If you still believe a **critical** or **high** issue is real after considering the discussion, keep or restate it with **specific evidence** from the current diff (cite paths/lines).
4. **Rebuttals**: When a reviewer disputes your stance but you still believe there is a material problem, use the optional reply fields below instead of duplicating the same inline comment on the same line.

## Additional JSON fields (omit entirely if there is nothing to say)

Use **only** \`review_comment_id\` / \`issue_comment_id\` values that appear in the discussion section.

\`\`\`
"replies_to_review_comments": [
  { "review_comment_id": <number>, "body": "<markdown — concise rebuttal or acknowledgment, reference the code>" }
],
"replies_to_issue_comments": [
  { "issue_comment_id": <number>, "body": "<markdown — for timeline / conversation replies>" }
]
\`\`\`

- **replies_to_review_comments**: Reply **in thread** under an existing **inline** review comment (use for line-level disputes). Maximum **5** entries.
- **replies_to_issue_comments**: For **conversation** comments (PR timeline). Maximum **5** entries. Be concise; these post as new timeline comments referencing the discussion.

If you have nothing to add as a reply, omit these keys or use empty arrays. Do not spam; only reply where it clarifies a substantive disagreement.`;
