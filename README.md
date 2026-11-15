# Dream — Coding in Color

Built at [ASU Fall Hackathon 2026 | Phoenix Hackathon for Nonprofits: Nov 14-15](https://www.ohack.dev/hack/fall-2026) for the public good (MIT license).

> **⚠️ This is your team's ONE repository — all code goes here.** Please don't create
> another repo (personal or org). Judges, the Team Dashboard's code-activity card,
> the public project page and the nonprofit all read **this** repo; work pushed
> anywhere else is invisible to them and won't count. Everyone on the team should be
> a collaborator here — ask an organizer in Slack if someone can't push.

| | |
|---|---|
| **Nonprofit** | [Coding in Color](https://www.ohack.dev/nonprofit/YIXYdYCoxIZC08uQ5DL3) |
| **Problem statement** | [Donor & Funder Relationship Platform (CIC Problem 2)](https://www.ohack.dev/project/e26932c0df1b11f189a8dead68f07eb5) |
| **Team page** | [Dream](https://www.ohack.dev/hack/fall-2026/team/ba4e3dd0e05611f1b598deadb145c312) · [Team Dashboard](https://www.ohack.dev/hack/fall-2026/manageteam) (story, demo video, submit) |
| **Slack** | team: [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) · nonprofit: [#npo-coding-in-color](https://opportunity-hack.slack.com/app_redirect?channel=npo-coding-in-color) · help: [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) |
| **Created by** | Oumar Yassir |

## Final day

Start recording your demo video by **Sun Nov 15, 12:00 PM MST** — hacking ends at **Sun Nov 15, 2:00 PM MST**, and a demo you recorded with time to spare beats a feature you finished at 1:59.

- Sun Nov 15, 11:00 AM MST — Presentation Feedback Hour
- **Sun Nov 15, 12:00 PM MST — Start recording your demo video**
- Sun Nov 15, 12:30 PM MST — Judges Arrive
- **Sun Nov 15, 2:00 PM MST — 🛑 Submission Deadline: Hacking ends**
- Sun Nov 15, 2:05 PM MST — Judging Round 1
- Sun Nov 15, 3:40 PM MST — Judging Final Round
- Sun Nov 15, 4:30 PM MST — Closing Ceremony: Winners Announced

## Before hacking ends — the submission checklist

Everything is submitted from your [Team Dashboard](https://www.ohack.dev/hack/fall-2026/manageteam); judges read the dashboard, this README and your demo video.

- [ ] **Code pushed** to this repo, in small PRs (see `AGENTS.md`) — judges and future recruiters read the history
- [ ] **Project story** written on the dashboard (`#project`): the problem, who it helps, what you built, what's next
- [ ] **Demo video** (4 minutes or less) on YouTube, Vimeo, Loom or Google Drive, linked on the dashboard (`#demo`) — show it working, not slides
- [ ] **Submit** on the dashboard (you can keep editing until the close)
- [ ] This README filled in below: team, tech stack, how to run it, live link if you have one
- Optional: a [DevPost entry](https://opportunity-hack-2026-arizona.devpost.com/) — the dashboard is the submission of record.

Judges score **Scope, Documentation, Polish and Security**, plus a separate **Accessibility** prize — the rubric is at [ohack.dev/hackathon-judging-criteria](https://www.ohack.dev/hackathon-judging-criteria). Document your work as GitHub Issues as you go: that's how you get public credit for it.

## Team

<!-- Replace with real people; link GitHub profiles so this repo works as your portfolio -->
- [Name](https://github.com/username) — role
- [Name](https://github.com/username) — role

## What we built

ColorLoop combines Coding in Color's donor records, CSV/XLSX imports, reviewed
merges, board assignments, relationship timelines, follow-up tasks, human-approved
outreach, Lapsed-Donor Radar, retention analytics, and printable funder reports.
Accounts, sessions, permissions, activities, tasks, drafts, approval/delivery
history and audit events now use normalized PostgreSQL tables. The CIC frontend
uses the shared API contracts with secure cookies and CSRF tokens.

The full stack has been tested with an isolated PostgreSQL engine and real local
HTTPS/Chrome. Live Neon migrations, hosted Vercel deployment, and real message
delivery have not been performed. Provider delivery stays disabled.

## Mentor UX update

The `feature/mentor-ux` frontend follows the supplied mentor PDF: an actionable
Today queue, linkable donor profiles, donor-specific quick actions, readable
import review, explicit outreach approval/handoff, and mobile bottom navigation.
It targets backend `85b1985`; the branches have not been merged or deployed here.
See the [recommendation matrix and validation](docs/MENTOR-UX-IMPLEMENTATION.md)
and [Laptop 2 handoff](docs/MENTOR-UX-HANDOFF.md). Local validation measured
Lighthouse accessibility 100 on 19 views and passed 75 responsive/keyboard views.

## Tech stack

- Vanilla HTML/CSS/JavaScript with CIC branding and keyboard-accessible dialogs
- Node.js 22+ ES modules and Vercel Functions
- Neon PostgreSQL, connection-bound transactions, additive SQL migrations
- `csv-parse` and bounded `read-excel-file`/`fflate` XLSX parsing
- Node scrypt, opaque durable sessions, CSRF tokens and server-side RBAC
- Mandatory authenticator TOTP (`otpauth`), local QR generation (`qrcode`),
  AES-256-GCM encrypted secrets and single-use hashed recovery codes
- Development-only PGlite for isolated synthetic SQL tests and demos

## Run a safe synthetic demo

```bash
npm ci
mkdir -p node_modules/.cache/colorloop
openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj /CN=localhost \
  -keyout node_modules/.cache/colorloop/tls.key \
  -out node_modules/.cache/colorloop/tls.crt
cp .env.example .env
```

In your ignored `.env`, set `COLORLOOP_DEMO=true`, a local `DEMO_PASSWORD` of at
least 15 characters containing uppercase/lowercase letters, a number and a special
character, `APP_ORIGIN=https://localhost:3000`, and the TLS paths shown
in `.env.example`. Then run `npm run dev` and open https://localhost:3000.
Accept the local development certificate warning for this synthetic demo only.
Sign in as `admin@example.test` with your chosen demo password.
Confirm your password, scan the private QR with an authenticator app, enter its
six-digit code, and save your recovery codes offline. Enrollment is mandatory.

Demo mode creates a fresh in-memory PostgreSQL database with synthetic accounts,
donors and verified synthetic gifts each run. It never connects to Neon, even if
`DATABASE_URL` exists. It is rejected in production/on Vercel. Secure cookies stay
enabled. See the [demo walkthrough and integration guide](docs/INTEGRATION.md).

When signed out, ColorLoop shows a dedicated sign-in page. The workspace stays
hidden until the server verifies both password and second factor. The account
dropdown shows your real name, email, role and status. My Profile saves your name;
Security changes passwords, regenerates recovery codes and resets authenticators
after password-and-factor reauthentication. Account Settings saves preferences
and gives administrators account-request review and audited MFA recovery controls.
Email and role edits remain administrator-managed.
Session expiry returns to sign-in and clears the visible workspace.
See [authentication and import operations](docs/AUTHENTICATION-IMPORTS.md).

## Neon setup and authentication

Keep `COLORLOOP_DEMO=false` and omit `COLORLOOP_STORE=mock` for persistent use.
Configure the server-only `DATABASE_URL`, exact HTTPS `APP_ORIGIN`, and a stable
private `MFA_ENCRYPTION_KEY` (32 random bytes encoded as base64). Review
the ordered migrations and historical identity reconciliation before applying them. No command
below has been run against a live database during integration:

- `npm run db:check`: explicit read-only connection check.
- `npm run db:migrate`: apply additive migrations atomically with checksum tracking.
- `BOOTSTRAP_ADMIN=true node scripts/bootstrap-admin.js`: explicit operator account
  bootstrap, using private `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values.
  Requires an empty account store; remove the bootstrap password afterward.

Production session/retention storage fails closed when unavailable. There is no
public self-activation or default production password. Sign Up creates a pending
request; an administrator must approve a non-administrator role before sign-in
and mandatory authenticator enrollment. Donor-facing messages remain
unsent without an explicitly integrated provider.

## Verification

```bash
RUN_NEON_TESTS=false npm test
npm audit
npm audit --omit=dev
npm run build
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

The two smoke scripts use only synthetic isolated SQL and temporary HTTPS
certificates. Browser checks require local Chrome (override `CHROME_PATH` when
needed). No Vercel CLI or new package is needed. The live Neon test remains opt-in.
Both npm audits reported zero vulnerabilities during integration.

## Verified pre-merge fixes

See [pre-merge fixes, safe upgrade and hosting decision](docs/PREMERGE-FIXES.md).
Merges preserve verified funder evidence and its original attribution. Account
forms use safe role defaults and require administrator confirmation, enforced by
the backend. New compatibility migrations preserve unresolved historical user
references without inventing accounts; existing migration checksums are unchanged.

`npm run build` produces only `dist/index.html` and `dist/public/...`.
The shared API dispatcher reduces the frameworkless Vercel function count from
33 to **five**, preserving existing URLs and methods. A real local Vercel CLI
build and compiled-output verification pass; no hosted deployment was performed.
Node is pinned to 22.x. The authentication feature adds the approved pinned
`otpauth` and `qrcode` dependencies.

## CIC requirements implementation

See the [requirements matrix and four-minute demo](docs/CIC-REQUIREMENTS.md),
[dashboard API integration](docs/DASHBOARD-API.md), and
[deployment/cost checklist](docs/DEPLOYMENT-READINESS.md).

Imports preserve automatic mappings and expose separate names, primary/secondary
email, phone, company, campaign, board contact and custom fields. Phoenix local
and Excel dates are supported. Missing currency/status requires explicit review;
unknown gifts stay outside verified reports. Stable source/transaction IDs reuse
the original gift, and imported ownership requires review against genuine accounts.

Campaign approvals are grouped by normalized name, with optional row exceptions.
Follow-ups search donors by name/email and can be assigned to the current staff
member. Readable board filters, linked-gift outreach details, localized timelines,
responsive tables and contextual empty states support the mentor demo. See the
[local UX polish review and validation](docs/UX-POLISH.md).

Verified gifts prepare idempotent thank-you drafts. Daily authenticated preparation
creates separate quarterly donor updates/tasks, board assignment summaries and
overdue reminders. Production scheduling needs a real preparation account and
server-only `CRON_SECRET`/`AUTOMATION_USER_ID`; it never sends messages.

Manual handoff locks an approved, consent-checked revision and records `handed_off`.
A separate evidence-backed human attestation records a human-reported send. No
real email/text delivery or provider integration has been performed. Communication
history and gifts appear on the donor profile. Board accounts are restricted on
the backend to their assigned donors and related work. Role retirement reassigns
accounts, revokes sessions and retains audit/history.

Retention reports show the donors behind each category. Cycle-based radar uses
matched year-to-date windows; configurable inactivity radar remains a separate
view. Profile-launched funder packets include full multi-year verified giving and
staff-recorded outcome evidence without inferring impact from donations.

A real Lighthouse 13.0.1 audit measured **100 accessibility on all seven main
screens**. [Measured summary](artifacts/accessibility/summary.json); full local
HTML/JSON reports are retained under the same directory. Keyboard/visual checks
remain separate. Hosted routing, Neon connectivity/concurrency, Vercel ingress
identity, actual provider samples, budget eligibility and final deployment still
require authorized external verification. Local Vercel metadata is synthetic;
replace it through authorized CIC project linking before deployment.

All code stays in this repository. Never commit `.env`, credentials, real donor
records, or local Vercel project credentials. Historical teammate handoff documents
may describe older branches; the requirements matrix above describes current work.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
