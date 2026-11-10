# Insights Studio: reporting and review

## Product behavior

Both customer apps use the same workflow and retain their own analytics, templates, and logins.

- Operations starter templates default to a daily review window.
- Task-focused starter templates include a decision question, relevant metrics, and an interpretation prompt. Existing template IDs and saved-report URLs remain valid. Blank reports stay blank.
- The Report details icon opens a compact drawer with Data, Review, Comments, and Actions tabs. The speech-bubble Comments icon opens the comments tab directly, including a save-first prompt for a new report. Toolbar icons have hover/focus labels and fixed dimensions through saving and saved states.
- Data notes record the sources, grouping timezone, retrieved time, observed window, input-row count, and displayed bucket availability. Unknown coverage stays unknown. No sensor uptime or completeness percentage is inferred. Daily summary data cannot prove within-day coverage.
- Sources and metric definitions live in Report details, without an extra data-notes page in the report or PDF. Older generated data-notes widgets are omitted when opened and on the next manual save; pages containing other report content are retained. Historical snapshots are not rewritten. Refresh chart data clears cached chart and metric snapshots; save afterward to preserve the new evidence.
- A meaningful report save creates an immutable draft version. Save timestamps and sharing-only changes do not manufacture new versions. History begins when the migration is installed.
- Request review saves the current working copy and snapshots the database report. The reviewer must be a different editor with access to that report. The UI requires opening the exact saved version before approval.
- Metric definitions and their version are saved with the report, so frozen versions retain their original explanatory text and units. Refreshing chart data refreshes the current draft definitions.
- An edit supersedes a pending review. An approved version must still match the current saved report before its owner can publish it. Earlier publications keep their original numbers and metadata.
- Saved-version links use `/insights-studio/solo?id=REPORT_ID&version=VERSION_ID` (or comparison). They use saved widget snapshots and do not query fresh analytics data for missing modules. Current report sharing governs access to all versions.
- Restore replaces the working draft and preserves current sharing and history. The UI confirms before replacing unsaved work.
- Editors can attach comments to a version and/or module. Follow-up actions have an owner, due date, optional intervention date, baseline version, outcome, and optional follow-up version. Marking an action Done requires an outcome.
- Compare results uses matching saved numeric summary metrics. It flags scope/filter changes and makes no causal claim about an intervention. It never substitutes missing values with zero.

Scheduled delivery and automatic previous-week traffic comparisons are not included.

Transportation report buckets sum movement counts and calculate volume-weighted speeds. Speeds below 1 mph retain their numeric value, and periods with zero movements have no measured speed.

## Database rollout

Installed on the Transportation Supabase project on November 9, 2026, and recorded in its migration history. Verified the five tables have RLS, anonymous access is denied, authenticated direct writes are denied, both public RPCs run as invokers, and no new workflow security-advisor findings were reported. The frontend changes remain local until pushed.

The single additive migration is `supabase/migrations/20261109200710_insights_report_workflow.sql`. It was prepared against the real saved_reports/profile column definitions shared by both projects. It adds five report tables, scoped read policies, private authorization/command functions, two public invoker RPCs, and report save/history triggers. Authenticated clients receive SELECT only on the new tables; mutations go through checked commands. Existing ingestion and saved-report sharing policies are not replaced.

Apply this one migration to the matching product database after reviewing it. **Do not run all pending migrations**: the repos contain separately deferred telemetry/security work. Run the migration before shipping the frontend. It is transactional with short lock/statement timeouts. No production data is included in this repo or its tests.

The public API is `insights_report_workspace(report_id)` and `insights_report_command(report_id, command, payload)`. Commands: submit, approve, request_changes, publish, comment, add_action, update_action, restore. Reads of individual frozen snapshots use insight_report_versions with RLS.

If the database update is unavailable, normal report editing/saving remains available and the workspace displays a setup message.

## Validation

`npm test` in the website folder includes Studio interaction, routing, sanitization, evidence, and comparison tests. Run ESLint for changed files and build each website sequentially.

The PostgreSQL test script is `supabase/tests/insights_report_workflow.sql`. Run only in an isolated PostgreSQL database named checkit_insights_test. It creates a minimal auth/profile/report fixture and applies a migration via the psql migration_file variable. Example:

```sh
psql -h 127.0.0.1 -p 55438 -d checkit_insights_test \
  -v migration_file=/absolute/path/to/supabase/migrations/20261109200710_insights_report_workflow.sql \
  -f supabase/tests/insights_report_workflow.sql
```

Checks cover viewer and cross-institute denials, independent review, owner-only publication, immutable snapshots, automatic draft history, stale-review rejection, comments, actions, and preserved sharing on restore. Supabase advisors on the isolated fixture reported no findings for the new workflow objects (the fixture's legacy saved-report policies had existing initplan warnings).
