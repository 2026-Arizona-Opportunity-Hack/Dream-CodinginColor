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

## Tech stack

- Vanilla HTML/CSS/JavaScript with CIC branding and keyboard-accessible dialogs
- Node.js 22+ ES modules and Vercel Functions
- Neon PostgreSQL, connection-bound transactions, additive SQL migrations
- `csv-parse` and bounded `read-excel-file`/`fflate` XLSX parsing
- Node scrypt, opaque durable sessions, CSRF tokens and server-side RBAC
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
least 15 characters, `APP_ORIGIN=https://localhost:3000`, and the TLS paths shown
in `.env.example`. Then run `npm run dev` and open https://localhost:3000.
Accept the local development certificate warning for this synthetic demo only.
Sign in as `admin@example.test` with your chosen demo password.

Demo mode creates a fresh in-memory PostgreSQL database with synthetic accounts,
donors and verified synthetic gifts each run. It never connects to Neon, even if
`DATABASE_URL` exists. It is rejected in production/on Vercel. Secure cookies stay
enabled. See the [demo walkthrough and integration guide](docs/INTEGRATION.md).

## Neon setup and authentication

Keep `COLORLOOP_DEMO=false` and omit `COLORLOOP_STORE=mock` for persistent use.
Configure the server-only `DATABASE_URL` and exact HTTPS `APP_ORIGIN`. Review
the ordered migrations and historical identity reconciliation before applying them. No command
below has been run against a live database during integration:

- `npm run db:check`: explicit read-only connection check.
- `npm run db:migrate`: apply additive migrations atomically with checksum tracking.
- `BOOTSTRAP_ADMIN=true node scripts/bootstrap-admin.js`: explicit operator account
  bootstrap, using private `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values.
  Requires an empty account store; remove the bootstrap password afterward.

Production session/retention storage fails closed when unavailable. There is no
public registration or default production password. Donor-facing messages remain
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
`vercel.json` serves that output while preserving native API routes. There are
still **33** frameworkless API functions: deployment requires a compatible Vercel
plan, or separately approved and validated consolidation for Hobby. No plan was
changed, and no deployment was performed.

## Integration and operational limits

See [integration setup, security, demo and limitations](docs/INTEGRATION.md),
[donor/import API contracts](docs/donor-api.md), and
[retention API details](docs/retention-api.md). Earlier teammate handoffs describe
branch-specific contracts; the integration guide takes precedence.

Repeated imports with the same source and transaction IDs reuse existing gifts.
The import preview distinguishes valid rows from existing transactions; its
`possible_duplicate_gift` flag covers amount/date review for missing IDs only.

Unverified currency/payment status is stored as unknown and excluded from verified
radar/reporting. Existing email addresses never imply contact consent. Funder
outcomes require explicit evidence; none are inferred from gifts. PDF export uses
browser printing. Board attribution uses current ownership; activity counts with
program filters exclude unclassified activities. Hosted routing, Neon concurrency,
the Vercel ingress-IP contract and delivery reconciliation need deployment
validation. Current role permissions apply across the single nonprofit; they are
not an assignment-scoped privacy boundary.

All code stays in this repository. Package changes remain coordinated through the
shared manifest/lockfile. Never commit `.env`, credentials, or real donor data.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
