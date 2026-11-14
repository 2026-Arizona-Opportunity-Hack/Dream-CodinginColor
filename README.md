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

<!-- Two or three sentences: the problem, who it helps, what the nonprofit can do now that they couldn't before -->

## Tech stack

- Frontend: vanilla HTML/CSS/JavaScript (planned)
- Backend: Node.js ES modules and Vercel Functions
- Database: Neon PostgreSQL
- Imports: `csv-parse` and `read-excel-file`, with bounded XLSX archive inspection

## Run it locally

```bash
git clone https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor.git
cd Dream-CodinginColor
cp .env.example .env   # fill in your own values — never commit .env
npm install
npm test
npm run db:check  # requires your development Neon DATABASE_URL
```

Use Node.js 22 or newer. The database/API implementation uses server-side Vercel
Functions; the application UI and authentication are being built on teammate
branches. There is currently no `dev` script or bundled Vercel CLI. Protected
endpoints return 401 until the real permission middleware is integrated.
`dotenv` loads `.env` for server scripts; never expose `DATABASE_URL` to browser
JavaScript. Set `APP_ORIGIN` to the exact UI origin for JSON mutations.

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

### Shared package workflow

All teammates use this root `package.json` and `package-lock.json`. Coordinate
package changes in the team channel, use `npm install <package>` to update both
files, and review both in the same PR. Use `npm ci` for a clean install from the
shared lockfile. Server scripts and Vercel Functions use ES module `import`/`export`;
use `<script type="module">` for browser modules. Keep Node-only dependencies in
server code. `npm test` checks import parsing, transactional database services, protected route behavior, and the initial health handler.

### Dependency audit

The existing package graph uses `read-excel-file` instead of vulnerable npm
`xlsx` and excludes the Vercel CLI. A synchronized install and `npm audit` report
zero known advisories. Import limits and formula/XML checks are still enforced;
see the security review for limits and integration checks before launch.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
