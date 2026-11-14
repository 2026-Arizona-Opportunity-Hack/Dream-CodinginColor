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

ColorLoop helps Coding in Color track donor ownership, interactions, follow-up
tasks, and reviewed outreach. The retention backend includes secure account and
role management and a configurable Lapsed-Donor Radar with reasons drawn from
actual donation dates. The donor database and mock-backed retention modules are
being combined on `feature/integration`; persistent retention storage and frontend/API wiring are still pending.

See [retention API documentation and teammate handoff](docs/retention-api.md) for
routes, permissions, example requests, mock limitations, and database requirements.

## Tech stack

- Frontend: vanilla HTML/CSS/JavaScript
- Backend: Node.js ES modules and Vercel Functions
- Database: Neon PostgreSQL
- Imports: `csv-parse` and `read-excel-file`, with bounded XLSX archive inspection
- Authentication: Node.js scrypt and opaque server-side sessions

## Run it locally

```bash
git clone https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor.git
cd Dream-CodinginColor
cp .env.example .env   # fill in your own values — never commit .env
npm install
npm test
npm run dev
npm run db:check  # requires your development Neon DATABASE_URL
```

Use Node.js 22 or newer. The database/API implementation uses server-side Vercel
Functions. `npm run dev` starts the frontend/report harness on port 3000;
full API wiring is being integrated. No Vercel CLI is bundled. Authentication and retention require durable
storage integration; production requests currently fail closed with 503.
`dotenv` loads `.env` for server scripts; never expose `DATABASE_URL` to browser
JavaScript. Set `APP_ORIGIN` to the exact UI origin for JSON mutations.
For isolated local retention tests, the explicit `COLORLOOP_STORE=mock` mode is
ephemeral and disabled in production and on Vercel. See the
[retention API guide](docs/retention-api.md) for bootstrap and HTTPS requirements.

### Database commands

Set `DATABASE_URL` to a development Neon connection string, then run
`npm run db:check` to verify a real connection before applying schema changes.
Neon has not been verified in this workspace because credentials are absent.

- `npm run db:migrate`: apply versioned `db/migrations/*.sql` atomically, tracking
  immutable files and checksums in `colorloop_migrations`.
- `ALLOW_SYNTHETIC_SEED=true npm run db:seed`: load repeatable synthetic examples
  from `db/seed.sql` on a designated development database. Production environment
  flags block seeds. Do not point this command at production.
- `npm test`: run isolated PostgreSQL-engine, import, and route-security tests.
- `RUN_NEON_TESTS=true node --test test/neon.test.js`: optional live read-only check.

See [database setup and team schema handoff](docs/database-integration.md),
[donor/import API contracts](docs/donor-api.md), and
[security review and remaining verification](docs/security-audit.md).
The schema covers donors, gifts, campaigns/outcomes, import audit, aliases,
custom definitions, and merge history. Auth/activity/task/outreach tables and user
foreign keys await Teammate 2's final schema; no parallel auth schema is created.
No hosted deployment has been tested or performed by this change.
No retention endpoint currently connects to Neon or creates database tables.

### Shared package workflow

All teammates use this root `package.json` and `package-lock.json`. Coordinate
package changes in the team channel, use `npm install <package>` to update both
files, and review both in the same PR. Use `npm ci` for a clean install from the
shared lockfile. Server scripts and Vercel Functions use ES module `import`/`export`;
use `<script type="module">` for browser modules. Keep Node-only dependencies in
server code. `npm test` checks import parsing, transactional database services,
protected routes, authentication, relationships, outreach, reminders, and radar.
Reporting tests are also included. Some branch-specific expectations still need integration updates.

### Dependency audit

Both feature branches previously reported zero known npm advisories. The combined
dependency graph still needs a fresh audit. It uses `read-excel-file` rather than
`xlsx` and excludes the Vercel CLI. Import limits and formula/XML checks remain
enforced; see the security review for remaining verification before launch.

See [frontend/API contracts](docs/FRONTEND-INTEGRATION.md), the
[brand/accessibility audit](docs/FRONTEND-AUDIT.md), and
[deployment checklist](docs/DEPLOYMENT.md). Reports support print-to-PDF; no
server-generated PDF attachment or hosted deployment has been verified.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
