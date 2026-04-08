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
5. **Dismissed reviews**: If the discussion includes a previous review marked **[⚠️ DISMISSED]**, the PR author explicitly chose to reject those concerns. This carries strong authoritative weight. Before re-raising the same issue you MUST:
   - Confirm the relevant code has actually changed in a way that introduces a **new** problem not present when the review was dismissed.
   - Verify the author's explanation (in the inline threads or conversation below) does **not** adequately address the concern.
   - Only re-raise if you have fresh, concrete technical evidence from the **current diff**. If the author's explanation is technically sound (e.g. "this version does not exist on npm", "this is intentional for X documented reason", "this library guarantees forward compatibility"), accept it and **APPROVE** — do not manufacture doubt about a technical explanation you cannot disprove from the diff alone.

## MANDATORY: Explain your verdict in the summary (follow-up reviews only)

When this is a follow-up review (discussion is present), the **summary** field MUST include a dedicated section that directly addresses every dismissed review and every challenge/pushback comment, explaining exactly why you reached your verdict:

### If your verdict is APPROVE (after previous CHANGES_REQUESTED or DISMISSED):

Add a **"Why I'm Approving"** section to the summary. For each previously raised concern that is now resolved, state:
- The original concern (one line)
- **Why you agree with the dismissal or challenge** — quote or paraphrase the author's/reviewer's reasoning and confirm it is technically sound
- Example: _"✅ **SWC binary mismatch** — I agree with the dismissal. The author correctly explained that @next/swc-linux-arm64-gnu does not publish a 12.3.5 binary on npm; pinning to 12.3.4 is the only viable workaround for the Yarn 4 node_modules linker. Patch-level SWC binaries are ABI-compatible, so this is safe."_

### If your verdict is still REQUEST_CHANGES (despite dismissal or challenge):

Add a **"Why Previous Dismissal/Challenge Is Insufficient"** section to the summary. For each concern you are re-raising, state:
- A direct acknowledgment of the author's dismissal or challenge argument
- **Specifically why that argument does not resolve the risk** — cite the exact diff lines, file paths, or technical facts that contradict or are not covered by the explanation
- Example: _"⚠️ **SWC binary mismatch** — The author claims 12.3.4 binaries are ABI-compatible with Next.js 12.3.5. While this may be true for minor/patch changes, the CVE patch in 12.3.5 includes a middleware bypass fix that alters request-handling behavior. The 12.3.4 SWC binary processes module transforms that feed into this middleware path (see \`next.config.js:12\`), making binary-version alignment a correctness concern, not just a cosmetic one."_

Do not skip this section. If you are approving, the author and other reviewers deserve to know you read and considered their response. If you are still requesting changes, they deserve to know exactly why the challenge failed.

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
