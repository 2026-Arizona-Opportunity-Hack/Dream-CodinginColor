# ColorLoop | Coding in Color

ColorLoop helps Coding in Color keep donor relationships organized across
spreadsheets, giving platforms and board members. It brings giving history,
relationship owners, follow-ups and human-approved outreach into one workspace.

Built by Team Dream at [Opportunity Hack Fall 2026](https://www.ohack.dev/hack/fall-2026)
for **Problem B: Donor Management**. [Coding in Color](https://www.ohack.dev/nonprofit/YIXYdYCoxIZC08uQ5DL3)
is an Arizona nonprofit developing the future digital workforce through digital
skilling, computer science and artificial intelligence education.
[Original problem statement](https://www.ohack.dev/project/e26932c0df1b11f189a8dead68f07eb5).

All project code belongs in this repository. Judges, the Team Dashboard and the
nonprofit use it as the source of record. Keep contributors here; do not create a
second project repository. The project is open source under the [MIT license](LICENSE).

## Live application

[Open ColorLoop](https://colorloop-nu.vercel.app).

The public sign-in screen, assets, API access guards and aggregate reporting API
were checked read-only. Authenticated workflows were tested locally with isolated
PostgreSQL; they were not independently repeated against production. The operator
reports that production login and mandatory MFA work.

## Demo video

**Pending: add the final four-minute demo video URL before submission.**

Use the [final rehearsal, click-by-click script and judge Q&A](docs/FINAL-DEMO-REHEARSAL.md).
It distinguishes the production website from isolated demo evidence. Do not reset
shared production records or send real emails for a recording without approval.

## Features

| Requirement | What works | Scope or remaining setup |
| --- | --- | --- |
| CSV/XLSX imports | Editable mapping, row validation, campaign review, recognized board-contact approval and import history | Zeffy sample headings and synthetic exports are tested. Benevity supports explicit mapping; full provider export compatibility is not certified. |
| Deduplication | Cross-source identity matching, server-issued merge previews, identity confirmation and audited merges | Names alone are not proof of identity. Stable source/transaction IDs prevent repeated gifts; conflicting identities require review. |
| Donor profiles | Contact details, separate organization/employer/contact-person fields, gift history and categorized activity timeline | Manual cash/check gifts and optional initial gifts use the validated gift ledger and retry protection. Donors can exist without gifts. |
| Relationship owners | Reviewed imported contacts, least-loaded assignment with fair tie rotation and admin overrides | Owners must be genuine active board accounts. Board users see only authorized donors and related work. |
| Follow-ups | Searchable donor selection, assigned next step, deadline, open/completed status and due/overdue views | Quarterly donor update drafts/tasks and board summaries can be prepared. Scheduled preparation needs protected job configuration. |
| Thank-you and follow-up outreach | Templates, editable drafts, exact-recipient/revision review and Approve & Send Email through Resend | Consent, opt-outs, suppression, test allowlists and CIC activation gates remain enforced. Manual handoff is an optional fallback; SMS has no integrated provider. |
| Send history | Recipient, approver, timestamp, provider ID, acceptance/failure and confirmed delivery status | Provider acceptance is not delivery. Two separately approved local test emails were received and marked Delivered by the operator; this is not production delivery verification. |
| Retention analytics | Matched year-over-year donors, new/returning/reactivated/increased/decreased/lapsed categories and drill-down | Uses verified completed USD gifts and available history. Missing historical data is not inferred. |
| Lapsed Donor Radar (chosen P1) | Outreach → Needs attention → Matched giving cycle → Prepare check-in and follow-up | Prior-year matched year-to-date giving with no current-year gift; current-year lapses are provisional. Configurable inactivity is a separate view. Default board roles lack reporting permission; assigned profiles, drafts and tasks remain scoped. |
| Funder export | Donor gift history and staff-verified funded outcome evidence in a printable report/PDF | Outcome evidence must be entered and verified; giving alone does not establish program impact. |
| Aggregate read API | Key-authenticated totals/recent activity grouped by period, program and board member; OpenAPI 3.1 | Read-only reporting key stays server-side. CIC's external dashboard integration is not demonstrated. |
| Organization settings | Custom-field add/edit/hide/deactivate, campaigns, accounts, roles and permission controls | Archiving preserves history. The UI does not arbitrarily redefine core database columns or permission capabilities. |

Zeffy remains a donation intake source and Benevity a corporate-giving import/export
source. ColorLoop manages the relationships and reporting around those records; it
does not process payments or replace either platform.

## Security

- Passwords use scrypt. Opaque server-side sessions use Secure, HttpOnly,
  SameSite cookies. Writes require same-origin CSRF validation.
- Authenticator-based TOTP is mandatory. Enrollment QR codes are generated locally;
  secrets are encrypted with AES-256-GCM and recovery codes are hashed and single use.
  Password/factor changes require reauthentication. Preserve the MFA encryption key
  when redeploying; rotation requires a reviewed plan to preserve account access.
- Server-side role and donor-assignment checks protect donor PII. Board members
  cannot access another owner's donors by changing a URL or calling the API directly.
- Donor-facing sends require a permitted human's approval of the current message
  revision and recipient, plus valid consent and suppression checks. Transactional
  claims and provider idempotency keys prevent repeat sends.
- Email transport and unattended sending default off in code. Test mode requires an
  explicit verified-inbox allowlist and blocks reserved synthetic addresses without
  redirecting them. Live donor automation additionally requires CIC approval.
- Static builds expose only allowlisted assets. Server files, migrations, credentials
  and local `.env` files are excluded and checked by the packaging verifier.

These are implemented controls and test results, not compliance certifications.
Never commit credentials, MFA keys, real donor records or private deployment metadata.
The [secret guard](.claude/hooks/guard-secrets.sh) must remain enabled.

## Technology stack

- HTML, CSS and browser JavaScript; CIC green branding, responsive navigation and
  accessible forms/dialogs. No frontend framework.
- Node.js **22.x**, ES modules, Vercel static hosting and five consolidated Functions.
- Neon PostgreSQL with connection-bound transactions and ordered SQL migrations.
- `csv-parse`, `read-excel-file` and `fflate` for bounded spreadsheet parsing.
- `otpauth` and `qrcode` for TOTP and local enrollment; Node crypto for passwords,
  sessions and encrypted factors.
- Resend HTTP API for optional approved email delivery.
- PGlite for disposable local PostgreSQL tests/demos; Node's test runner and Chrome
  for regression and browser checks.

## Setup and development

Use Node.js 22.x and install the locked dependencies:

```sh
npm ci
mkdir -p node_modules/.cache/colorloop
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -keyout node_modules/.cache/colorloop/tls.key \
  -out node_modules/.cache/colorloop/tls.crt
test -e .env || cp .env.example .env
```

Never overwrite an existing `.env`, database URL or MFA key. Refer to
[.env.example](.env.example) for variable names and placeholder values.
For a new local synthetic demo configuration, use `COLORLOOP_DEMO=true`,
`APP_ORIGIN=https://localhost:3000`, the certificate/key paths above in
`LOCAL_TLS_CERT`/`LOCAL_TLS_KEY`, and a private `DEMO_PASSWORD` of at least 15
characters with uppercase/lowercase letters, a number and a special character.
Keep `EMAIL_DELIVERY_MODE=disabled`, `EMAIL_CRON_ENABLED=false` and
`CIC_DONOR_AUTOMATION_APPROVED=false`. Then run:

```sh
npm run dev
```

Open https://localhost:3000, accept the local development certificate warning only
for this demo, sign in as `admin@example.test` with the chosen password, and complete
mandatory authenticator enrollment. Keep the QR and recovery codes off recordings.

Demo mode creates synthetic accounts, donors and gifts in a fresh in-memory SQL
database. It never connects to Neon even if a database URL exists, and is rejected
on Vercel/production. Restarting loses its data and enrollment. It is not a reset
of the existing Dream account on the production website. The exact-file empty-start
rehearsal below uses a separate isolated fixture instead of those seeded donors.

For persistent use, set `COLORLOOP_DEMO=false`, omit `COLORLOOP_STORE=mock`, and
configure private `DATABASE_URL`, exact HTTPS `APP_ORIGIN` and stable
`MFA_ENCRYPTION_KEY` (32 random bytes encoded as base64).
Review [migration and identity-upgrade guidance](docs/PREMERGE-FIXES.md) before any
shared schema change. Nothing migrates or seeds automatically:

- `npm run db:check`: explicit read-only connection check.
- `npm run db:migrate`: applies reviewed additive migrations atomically with checksums.
- `BOOTSTRAP_ADMIN=true node scripts/bootstrap-admin.js`: operator-only bootstrap for
  an empty account store using private `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.
  Remove the bootstrap password afterward. Do not run this against an existing account store.

Sign Up creates a pending request. An administrator approves a non-administrator role
before the user can sign in and enroll MFA. Unavailable persistent storage fails
closed. See [authentication and import operations](docs/AUTHENTICATION-IMPORTS.md).

## Testing

```sh
EMAIL_CRON_ENABLED=false EMAIL_DELIVERY_MODE=disabled RUN_NEON_TESTS=false npm test
npm run build
npm audit
npm audit --omit=dev
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

The final pre-demo audit recorded **200 passed, 0 failed, 1 skipped**. The skipped
test requires explicit live-Neon opt-in. HTTPS/Chrome tests use synthetic isolated
SQL, genuine MFA and mocked provider responses; they send no real emails. Browser
checks require installed Chrome (`CHROME_PATH` can override its location).
After the approved organization-reimport fix, the full suite passed **202 tests,
0 failed, 1 skipped**, including two new classification and retry regressions.
The internal impact-preview sprint passed **207 tests, 0 failed, 1 skipped**,
preserving that baseline and adding five focused presentation/authorization tests.

Local evidence includes 100 Lighthouse accessibility on 19 authenticated views,
75 responsive/keyboard views, zero vulnerabilities in both dependency audits, and
a fresh isolated Vercel build with five Node 22 functions and 43 verified routes.
This does not establish authenticated production accessibility or hosted email delivery.
See the [full audit and evidence scope](docs/FINAL-PRE-DEMO-AUDIT.md).

The exact original file can be rehearsed without modifying it or connecting to Neon:

```sh
node scripts/rehearse-final-demo.mjs /absolute/path/colorloop_demo_ZEFFY_with_OHacks.csv
```

The rehearsal starts empty isolated SQL, uses Chrome's actual file upload, and checks
import, merge, exact-file reimport, approval-only outreach, tasks and Lapsed Donor
Radar. Results and screenshots are written under the OS temporary directory.
See [latest rehearsal results and known blockers](docs/FINAL-DEMO-REHEARSAL.md).
`npm run build` outputs only `dist/index.html` and `dist/public/...` (18 allowlisted
assets including the internal impact preview).
A stale root `.vercel/output` must not be deployed with `--prebuilt`; any approved
release needs a fresh linked-project build. Isolated packaging fixtures are not deploy targets.

## Team

Team Dream. The following roles were supplied by the team representative and remain
**subject to the team's confirmation** before submission.

| Contributor | Proposed role | Responsibilities supplied by the team |
| --- | --- | --- |
| Shorya Azriel Moses | Full-Stack Developer & Deployment Lead | Application architecture, donor management workflows, database integration, authentication, deployment and testing. |
| Oumar Yassir | Frontend Developer & UX Lead | Dashboard, donor profiles, responsive interface, follow-ups and outreach UI. |
| Abbhijit Venkatachalam | Backend Developer & Data Integration Lead | CSV/XLSX imports, Zeffy/Benevity mappings, donor deduplication, retention analytics, reporting API and funder exports. |

[Team page](https://www.ohack.dev/hack/fall-2026/team/ba4e3dd0e05611f1b598deadb145c312) ·
[Repository contributors](https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor/graphs/contributors).

## Current limitations

- The timeboxed enhancement adds **Donors → Giving → Preview donor impact
  (internal)** for users with reporting permission. It reuses authorized gift and
  verified-outcome data, with no inferred impact or public donor access. Donor login,
  secure account linking and publication remain unfinished. Same-login Demo Workspace,
  hosted judge access and signup email verification are also deferred; existing MFA
  and CIC account approval remain unchanged. See the [safe sprint handoff](docs/SPRINT-HANDOFF.md)
  for the local-only judge fallback and validation.
- Full Zeffy/Benevity provider export compatibility is not certified.
- Production email transport is not configured in the inspected Vercel variable
  listing; authenticated hosted delivery has not been verified.
- Scheduled board reminders need an approved internal template/policy, transport,
  `CRON_SECRET`, `AUTOMATION_USER_ID` and deployed URL. Keep unattended sending off
  until activation is explicitly approved. Default code flags are not proof of private runtime values.
- No safe production Reset Demo is available: records are shared and lack a verified
  synthetic dataset boundary. Test-like names are not deletion authorization.
- Radar has no snooze/dismiss action. Voice debriefs, Meet/Gemini extraction,
  calendar-aware next steps, AI-written updates and grant deadlines are not implemented.
- Core schema customization, SMS provider delivery, external CIC dashboard integration
  and production concurrency/load testing remain outside the verified demo scope.

## Nonprofit handoff and submission

Coding in Color should retain the repository, Vercel/Neon ownership and secrets in
organization-controlled accounts. Preserve the MFA key, review database backups and
additive migrations, and keep delivery policies disabled until CIC approves them.
Use GitHub Issues to track changes and keep code in this repository.

Start with [deployment readiness](docs/DEPLOYMENT-READINESS.md),
[release handoff](docs/VERCEL-RELEASE-HANDOFF.md),
[email operations](docs/EMAIL-OPERATIONS.md),
[email deployment settings](docs/EMAIL-DEPLOYMENT-HANDOFF.md),
[backend contracts](docs/MENTOR-BACKEND-CONTRACTS.md), and the
[reporting API guide](docs/DASHBOARD-API.md) / [OpenAPI specification](docs/openapi-readonly.json).
The [requirements matrix](docs/CIC-REQUIREMENTS.md) records acceptance criteria.
Historical teammate handoffs may describe earlier branches.

Record by November 15 at **12:00 PM MST** and submit by **2:00 PM MST**.
On the [Team Dashboard](https://www.ohack.dev/hack/fall-2026/manageteam):

- [ ] Confirm the listed contributor roles.
- [ ] Add the project story.
- [ ] Add the final video URL (four minutes or less) to the dashboard and README.
- [ ] Review and approve intended release changes; do not deploy stale build output.
- [ ] Click Submit before the deadline.

Judges score scope, documentation, polish and security, with an accessibility prize:
[judging rubric](https://www.ohack.dev/hackathon-judging-criteria).
After the event, use the nonprofit's [Definition of Done](https://www.ohack.dev/about/completion)
for sign-off and maintenance. Questions go to
[#npo-coding-in-color](https://opportunity-hack.slack.com/app_redirect?channel=npo-coding-in-color),
[#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream), or
[#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74).
