# CIC requirements implementation and handoff

Historical implementation notes. For the current production checks and demo plan,
see [the final pre-demo audit](FINAL-PRE-DEMO-AUDIT.md). Earlier test counts,
database state and deployment limits below describe their original checkpoints.

Scope: Problem 2 only, on `feature/cic-requirements`. The official Fall 2026
brief and nonprofit Slack requirements take precedence over earlier teammate
handoffs. No production database, deployment, or real messaging was used.

## Traceability

COMPLETE below means implemented and locally exercised. Hosted operation is a
separate acceptance gate. No real Zeffy/Benevity export has been certified: tests
use synthetic workbooks with the supplied sanitized Zeffy example's shape.

| Requirement | Status | Implementation files | Test evidence | Remaining blocker |
| --- | --- | --- | --- | --- |
| CSV and XLSX imports | COMPLETE locally | lib/import-parser.js, lib/import-worker.js, public/js/imports.js | test/import-parser.test.js, scripts/smoke-browser.mjs | Actual provider samples remain to be checked |
| Zeffy Phoenix date/header mapping; genuine Excel dates | COMPLETE for supplied shape | lib/import-date.js, lib/import-parser.js | tests/cic-requirements.test.js; real mapping UI smoke | Full provider export certification |
| Configurable Benevity/generic mapping | COMPLETE | public/js/imports.js | Parser explicit-mapping tests; UI mapping smoke | No official Benevity schema/sample supplied |
| First/last name, primary/secondary email, phone, company | COMPLETE | lib/data-validation.js, public/js/app.js, migration 005 | Required-fields SQL and browser regressions | None locally |
| Amount/date/currency/payment status/source/transaction ID | COMPLETE | lib/import-parser.js, lib/donor-data.js | Payment-review and transaction-idempotency regressions | Missing values require explicit review; unknowns remain excluded |
| Campaign and custom-field import | COMPLETE | lib/import-data.js, public/js/imports.js | Typed custom value and campaign SQL regression | Campaigns/definitions must exist before importing |
| Imported board contact and balanced ownership | COMPLETE with genuine active accounts | lib/assignment-sql.js, lib/import-data.js | Ownership conflict/review and workload tests | Configure board accounts; reconcile unassigned legacy donors |
| Cross-source donor dedupe and gift idempotency | COMPLETE | lib/matching.js, lib/import-data.js, lib/donor-data.js | tests/import-idempotency.test.js, test/database.test.js | Ambiguous identities require a human decision |
| Donor add/edit/archive and full multi-year giving history | COMPLETE | public/js/app.js, lib/donor-data.js | SQL multi-year and browser profile checks | Archive preserves financial records; no destructive delete |
| Gifts and communications in one timeline | COMPLETE | public/js/app.js, lib/outreach.js | SQL handoff/history tests; browser profile smoke | Human-attested delivery is explicitly labeled |
| Next step with due date | COMPLETE with active owner | lib/assignment.js, lib/assignment-sql.js | Task status/history and onboarding tests | Exception queue must be balanced after account setup |
| Automatic thank-you preparation | COMPLETE | lib/communication-sql.js, lib/outreach.js, lib/preparation-job.js | New verified gift creates one draft; retries create none | Future/unknown/unverified gifts do not qualify |
| Quarterly donor update/report drafts and dated tasks | COMPLETE with active owner | lib/outreach.js, lib/preparation-job.js | Per-donor/quarter idempotency and rollover tests | Production scheduling requires the genuine automation account and secret |
| Quarterly board assignment-summary drafts | COMPLETE | lib/outreach.js | Existing and new quarterly regressions | Same production scheduling gate |
| Editable templates, email/text drafts, human approval | COMPLETE | lib/outreach.js, public/js/app.js | Revision, approval, consent, concurrent-send tests | No automatic sending |
| Truthful manual sending and communication history | COMPLETE as manual handoff | lib/outreach.js, migration 005, public/js/app.js | Approval/consent/handoff/attestation regression | Actual sending occurs in the human's email/text app; no provider delivery claimed |
| Year-over-year categories with actual donor names | COMPLETE | lib/reporting.js, api/reports/retention.js, public/js/app.js | Category membership and reporting tests | Classifications reflect available history only |
| Full-history profile-launched funder packet and evidence entry | COMPLETE | api/reports/funder.js, lib/evidence-data.js, public/js/app.js | Actual multi-year packet/evidence handler tests; printable PDF smoke | Staff must supply genuine verified evidence |
| Key-authenticated aggregate read API | COMPLETE locally | api/v1/metrics.js, lib/reporting-store.js | Key rejection, filtered totals, no-PII and HTTPS checks | Configure server-only reporting key and CIC dashboard |
| Campaigns, board accounts, custom fields, users | COMPLETE | lib/custom-field-data.js, lib/auth.js, public/js/app.js | SQL/API and browser account regressions | Deactivation/archive preserves history |
| Role creation, permission editing and safe retirement | COMPLETE | lib/auth.js, lib/permissions.js, public/js/app.js | Role reassignment/session revocation/inactive-grant tests | Permission capabilities remain code-reviewed constants |
| P1: cycle-based lapsed-donor radar and deduplicated nudge | COMPLETE | lib/retention.js, public/js/app.js | Matched-cycle vs inactivity regression; existing nudge tests | Current cycle is provisional until year end |
| Individual accounts, RBAC, CSRF, consent, PII protection | COMPLETE locally | lib/auth.js, lib/permissions.js, lib/donor-access.js | Auth, client identity, board isolation, consent and API tests | Hosted proxy/client-IP behavior still requires validation |
| PostgreSQL/Neon | PARTIAL | lib/db.js, migrations 001–005 | Disposable PostgreSQL clean/upgrade tests | No external database connectivity was authorized |
| Vercel routing/static output/function capacity | COMPLETE locally; hosted PARTIAL | api/router.js, lib/api-router.js, vercel.json | Real Vercel CLI build, output verifier, URL/method and HTTPS tests | Deploy/verify only with separate authorization |
| $20/month + $250 setup budget | PARTIAL | docs/DEPLOYMENT-READINESS.md | Five-function build; no purchased services | Verify CIC account eligibility, seat count and usage costs |
| Lighthouse accessibility >=95 and keyboard navigation | COMPLETE in tested local views | scripts/audit-accessibility.mjs, public/css/app.css | Lighthouse 13.0.1: 100 on all seven main screens; keyboard audit | Repeat on hosted app and after substantial UI changes |
| CIC green branding and readable typography | COMPLETE | public/css/app.css, index.html | Palette/contrast/responsive audit | Official logo asset not installed; no fabricated logo |
| Deployed Sunday demo and CIC runnable README | PARTIAL | README.md, docs/DEPLOYMENT-READINESS.md | Local HTTPS/Chrome demo works | Authorized hosted deployment, video and final submission links |

## Important behavior

- Automatic mapping is retained and editable. The source text is a stable batch
  namespace. A spreadsheet source column cannot silently change transaction scope.
- Missing payment metadata blocks confirmation until the operator supplies reviewed
  values or explicitly retains unknowns. Reviewing unknown values does not make
  them verified. Gift verification changes metadata only, requires an evidence
  reason, and cannot overwrite an existing verified currency or completed status.
- Imported contacts match genuine active board names/emails. A reviewer chooses
  that account or explicitly retains existing/balanced ownership. Unmatched names
  never create users. Administrators can balance donors without active owners.
- No active board account means a donor remains visibly unassigned. Configure
  genuine board accounts first; the system does not invent an owner. New owned
  donors receive a dated onboarding task. Reviewed owner changes update that task.
- Board accounts see assigned donors and their related tasks/messages/activities.
  Direct requests for other donors fail on the server. Organization-wide imports,
  merges and administrative actions require staff privileges. Custom roles never
  create arbitrary new capabilities. Reporting keys return aggregates only.
- A handoff locks the approved revision and records `handed_off`, never `sent`.
  A separate human attestation with a reference records `sent` and labels it
  human-reported. It is not a provider receipt. Consent is rechecked at both steps.
- Quarterly reports use actual verified giving for the current quarter through the
  preparation date, grouped by currency without conversion. Staff review/update
  the message before approval; no program outcome is inferred from a gift.
- Cycle radar compares last year's matched year-to-date window with this year's
  window. Inactivity radar separately uses configurable calendar months. Both
  display their reason; both create idempotent tasks/drafts only after explicit action.
- The funder profile action computes full-history bounds from gifts and outcome
  periods, independent of the retention report's single-year restriction.

## Validation and evidence

See [recorded validation results](CIC-VALIDATION.md) and the [changed-file inventory](CIC-CHANGED-FILES.md).

Run `RUN_NEON_TESTS=false npm test`, `npm run build`, and the existing HTTPS,
Chrome and visual smoke scripts. Tests use isolated memory/PGlite stores only.
Pre-existing untracked `... 2.js` copies were preserved; the default Node test
runner includes their duplicate test cases and the second skipped Neon check.

Real Lighthouse results are retained in `artifacts/accessibility/`: the compact
`summary.json` is source-control eligible; full HTML/JSON reports remain local.
The runner audits the authenticated synthetic app, not the fixture API used by
the visual-layout audit. It requires an approved external Lighthouse installation:

```sh
LIGHTHOUSE_MODULE=/path/to/lighthouse/core/index.js node scripts/audit-accessibility.mjs
```

The real Vercel CLI build uses local synthetic project settings, no credentials,
and emits `.vercel/output`. `node scripts/verify-vercel-build.mjs` checks the CLI's
compiled rewrite, five actual Node 22 functions, browser asset paths, and the XLSX
worker. Source route tests cover allowed methods and auth before database access.

## Scope intentionally not implemented

Problem 1 curriculum/student/instructor functionality is excluded. Optional voice
notes/Meet processing, calendar integration, AI-generated messages, grant tracking,
natural-language queries, donor portals and scoring remain unimplemented. The
chosen P1 is lapsed-donor radar. Outcome evidence is entered by staff; it is not
pulled from a Problem 1 API. No real delivery provider, real sender, external Neon
connection, deployed Vercel environment or production migration has been used.

## Four-minute judging demo

1. 0:00–0:15: CIC's problem and the donor relationship workspace.
2. 0:15–1:00: import synthetic CSV/XLSX, review Phoenix dates/payment/ownership;
   repeat the import and show unchanged gift count and totals.
3. 1:00–1:30: open multi-year giving and communication history; record a note and
   dated next step. Show the assigned board member.
4. 1:30–2:00: add/edit a custom field; prepare and approve a thank-you. Show the
   truthful manual handoff without sending anything during judging.
5. 2:00–2:30: generate separate donor quarterly updates and board summaries; retry
   and show the same draft/task IDs.
6. 2:30–3:00: drill into retention categories, switch cycle/inactivity radar, create
   one reconnection draft and next step.
7. 3:00–3:35: show verified outcome evidence and the profile-launched full-history
   funder packet, then print/save PDF.
8. 3:35–4:00: show board isolation, key-authenticated aggregates without donor PII,
   and the measured accessibility result. State hosted/delivery limits honestly.
