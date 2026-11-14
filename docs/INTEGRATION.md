# ColorLoop integration, demo and operational handoff

This is the current integration contract. Older teammate handoffs describe the
original branch boundaries; use this guide and the actual routes after integration.
All work remains in this repository on `feature/integration`.

## Branches and review

Database `1964009` was fast-forwarded. Retention `7f40078` was merged by approved
commit `b5a142f`; frontend `af3d106` by approved commit `5c479ac`. Merge conflicts
were documentation, environment placeholders and scripts. Both `db:check` and
`dev` remain. No teammate branch or `main` was modified; no push/deploy occurred.
Subsequent integration fixes are intentionally uncommitted for review.

Suggested review units (tracking issues can use the same titles):
1. Add normalized authentication and relationship persistence.
2. Preserve assignments, consent and live relationships through donor imports/merges.
3. Connect CIC screens and reporting to shared APIs.
4. Validate synthetic HTTPS demo and document deployment gates.

## What now works

- Scrypt passwords, durable opaque sessions, revocation, CSRF and server permissions.
- Roles use stable text IDs/codes; each user has one role. `user_roles` is a view.
  `permissions` and `role_permissions` normalize grants. The built-in administrator
  role remains protected against self-modification; custom roles are editable.
- SQL-backed assignment, activity revisions, tasks, reminder drafts, templates,
  outreach revision/approval/delivery history, lapse events, settings and audit.
- New donors and import-created donors receive balanced active-board assignments
  inside their creation transaction. With no active board member they remain
  visibly unassigned. Re-import preserves ownership, including inactive owners.
- Reassignments retain history. Merges move live activities/tasks/messages and
  retain original activity revisions, assignment history and donor snapshots.
- Merging ORs opt-outs and ANDs channel consents. Consent is never inferred from
  shared email or silently broadened. Archived donors cannot receive outreach.
- Radar uses explicitly completed gifts with known currency, actual dates and a
  configurable calendar-month threshold. Reasons and proposed tasks/drafts remain
  explainable and events are deduplicated by stable gift UUID.
- Backend-approved revision claims prevent duplicate delivery. Current deployment
  has no provider: attempts return `503 DRAFT_MODE`, never a false sent status.
- Browser API adapter maps existing CIC screens to canonical backend payloads,
  keeps CSRF in memory, follows pagination for SQL collections, and binds approval
  to the revision displayed. It does not create fake production records.
- Reports use actual SQL views and `reports.read`; the machine endpoint uses a
  server-only bearer key and an explicit aggregate field allowlist.
- Funder reports use the browser print/Save as PDF flow. No outcomes are invented.

## Safe local synthetic demo

Node.js 22+, the existing lockfile dependencies, and OpenSSL are required.
Chrome is only needed for automated browser checks.

```sh
npm ci
mkdir -p node_modules/.cache/colorloop
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -keyout node_modules/.cache/colorloop/tls.key \
  -out node_modules/.cache/colorloop/tls.crt
cp .env.example .env
```

Set these privately in the ignored `.env`:

- `COLORLOOP_DEMO=true`
- `DEMO_PASSWORD`: choose at least 15 characters; no password is printed or preset.
- `APP_ORIGIN=https://localhost:3000`
- `LOCAL_TLS_KEY=node_modules/.cache/colorloop/tls.key`
- `LOCAL_TLS_CERT=node_modules/.cache/colorloop/tls.crt`

Run `npm run dev`, open https://localhost:3000 and accept the development-only
certificate warning. Use `admin@example.test` with your chosen password. Synthetic
board accounts are `board-a@example.test` and `board-b@example.test` with the same
chosen demo password. Never reuse a real account password for the demo.

Demo mode creates a fresh ephemeral PGlite PostgreSQL database and applies SQL
migrations only to that in-memory database. It explicitly avoids Neon regardless
of DATABASE_URL. It is disabled on Vercel and when NODE_ENV=production. Restarting
resets demo data. TLS keys/profile/PDF files created by automated smoke scripts
are temporary and removed after the checks.

Suggested recording sequence:

1. Sign in; show the dashboard's actual synthetic giving totals.
2. Open donors; add one and show the automatically selected board member.
3. Record a gift with explicit currency and payment status; show gift history.
4. Import a synthetic CSV/XLSX. Map columns, review warnings/candidate IDs, select
   uncertain donor identities, and explicitly allow a distinct gift if needed.
5. Review a merge preview and retain one donor. Show preserved relationship history.
6. Record a call/note; create and complete a follow-up task.
7. Open outreach; show the lapsed donor's reason and create its task/draft.
8. Edit a thank-you draft, save, then approve the displayed revision. Attempted
   sending clearly reports draft-only mode; no email/SMS is sent.
9. Generate quarterly/overdue reminder drafts; show they still require review.
10. Open Reports; prepare a funder report and print/Save as PDF. Empty verified
    outcomes explicitly say no verified results are available.
11. Sign out and demonstrate protected APIs no longer expose records.

## Neon schema and operator setup

No live database command or migration was executed during this integration.
Review the target environment and obtain approval before applying anything live.
The original migration 001 is unchanged.

- `002_relationship_security.sql`: normalized account/role/session/throttle,
  assignments, activities/history, tasks, templates/messages/revisions/approvals,
  delivery history, settings/events/audit; donor consent, custom-field visibility,
  nullable gift currency/status and user foreign keys. Audit/history rewrite
  triggers reject UPDATE/DELETE. Revoked/expired session credentials can be deleted.
- `003_reporting_views.sql`: verified positive USD gift views, current board-owner
  attribution, activity/donor views and a separate evidence-backed outcome table.

Existing gift currency/status remains NULL. Review/backfill genuine source data
rather than defaulting all historical rows to completed USD. An imported email
retains no automatic consent. Existing actor/board UUIDs must reference genuine
users before adding foreign keys; if a populated database contains orphan actor
IDs, plan a reviewed account backfill/constraint migration with the owners first.
Do not create fake users to make old records pass validation.

After schema approval, the explicit operator commands are:

```sh
npm run db:check
npm run db:migrate
BOOTSTRAP_ADMIN=true node scripts/bootstrap-admin.js
```

Bootstrap reads `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` privately from the
server environment/ignored .env; it requires an empty account store. Remove the
bootstrap password afterward. There is no public registration or default admin.
Never place a real password in a command line, GitHub issue or screenshot.

## Environment

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | Server-only Neon PostgreSQL URL with TLS; normal persistence |
| `APP_ORIGIN` | Exact HTTPS browser origin, including port locally; no trailing slash |
| `REPORTING_API_KEY` | Optional long random server-only bearer credential for `/api/v1/metrics` |
| `COLORLOOP_DEMO` | Local isolated SQL demo only; false/absent on deployment |
| `DEMO_PASSWORD` | Private local synthetic account password |
| `LOCAL_TLS_KEY`, `LOCAL_TLS_CERT` | Local HTTPS files; not deployed or committed |
| `PORT` | Local runner port, default 3000 |
| `BOOTSTRAP_ADMIN`, `ADMIN_*` | Explicit initial operator bootstrap only |
| `RUN_NEON_TESTS` | Live read-only test opt-in; keep false for isolated tests |
| `COLORLOOP_STORE=mock` | Legacy isolated memory tests only; rejected in production/on Vercel |
| `CHROME_PATH` | Optional Chrome executable override for browser scripts |

Do not configure a provider or put credentials in browser code. Every shipped
send handler has no delivery provider and stays draft-only.

## API and data contracts

The original donor APIs retain snake_case SQL responses. `public/js/api.js`
converts them to the existing UI's view models; retention APIs keep camelCase.
`data-mapping.js` performs explicit SQL-to-workflow conversion. Decimal amounts
are converted with integer arithmetic; dates normalize to ISO/UTC.

Use `requirePermission` from `lib/permissions.js`, not `lib/auth.js`.
It returns the authenticated public user plus permissions/administrator, or sends
an error and returns null. Missing/malformed session cookies return 401 before
opening storage. Valid sessions against unavailable storage return a sanitized
503. Donor APIs share the same cookie, permissions, origin and CSRF contract.
Session cookies remain Secure/HttpOnly/SameSite=Strict. Account changes revoke
sessions, and workflow transactions recheck current credentials/permissions.

Reporting uses `reports.read` for both retention and funder reports. Existing
colon-delimited frontend permission names were reconciled. `/api/assignments/members`
returns a limited active-board directory for donor readers and broader public
account fields for administrators; account administration still requires its own
permission and administrator role. All mutations require Origin and session CSRF;
login requires same Origin. Internal account IDs are never accepted as an actor.

The SQL unit of work maps separate normalized tables to workflow DTO snapshots,
then persists changed rows. It never stores the whole application state in JSON.
Writes, imports and merges share advisory transaction lock 78234902. Reads use a
repeatable-read snapshot. This deliberately favors correctness and small nonprofit
workloads; it currently loads full collections and serializes writes. Replace
those scans with targeted repositories if scale requires it. History JSON is only
structured audit metadata, not the primary account/donor/task state.

## Tests and demo validation

```sh
RUN_NEON_TESTS=false npm test
npm audit
npm audit --omit=dev
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

Unit/SQL tests use only synthetic in-memory databases. Integration coverage includes
persistent login/logout/permissions, donor/import assignments, merges, opt-outs,
activity revisions, task links, approval revisions, immutable audit and duplicate
send claims through separate SQL-store objects. PGlite is single-engine; this is
not a live multi-session Neon transport/load test.

The HTTPS smoke test invokes the actual local server with the browser API adapter.
The Chrome smoke test uses the actual HTTPS server/SQL store, verifies seven screens,
secure-cookie authentication, donor profile, funder PDF generation and logout.
The visual/accessibility script is separately fixture-based and checks 28 viewport/
screen combinations, keyboard focus, table scrolling, labels, palette and contrast.

## Deployment gates and known limitations

- No Neon migration/transport, Vercel deployment, hosted route mapping, function
  plan limits or worker bundling has been verified. Use Node runtime; package the
  import worker and its existing dependencies. Do not enable demo/mock mode.
- Role permissions currently apply across this one nonprofit. Board ownership is
  workload responsibility, not a row-level privacy boundary. Confirm that policy
  with CIC before real donor access.
- Socket-IP login throttling is durable, but a production proxy's trusted client-IP
  contract and platform-wide request controls still need configuration. Do not trust
  arbitrary forwarded headers. There is no full account recovery/MFA workflow yet.
- No automatic outbound delivery/scheduler exists. Provider failure or interrupted
  send claims remain failed/uncertain/sending for deliberate reconciliation; do not
  reset them and retry blindly. Real delivery requires a reviewed provider adapter,
  provider-side idempotency and reconciliation before enabling credentials.
- Reports include only explicitly completed USD gifts; radar supports verified
  known currencies. Board grouping reflects current ownership, not invented
  historical attribution. Activities have no verified program association, so
  program-filtered activity counts exclude them. Other report calculations remain
  scoped to actual available history.
- Funder evidence is stored separately; there is no fabricated outcome backfill.
  PDF is browser printing, not a generated email attachment.
- Local private-key/certificate trust is development-only. Do not weaken production
  TLS/cookie settings to avoid a local certificate warning.
- Review migrations and real historical actor references before a production PR
  approval/deployment. The branch is ready for code review and the synthetic demo;
  live deployment sign-off remains separate.
