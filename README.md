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
- Imports: `csv-parse` and `xlsx`

## Run it locally

```bash
git clone https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor.git
cd Dream-CodinginColor
cp .env.example .env   # fill in your own values — never commit .env
npm install
npm test
npm run dev
```

Use Node.js 22 or newer. `npm run dev` uses the local Vercel CLI; first-time
setup may prompt you to sign in and link the shared Vercel project. The initial
function is available at `/api/health`; the application UI is not built yet.
`dotenv` loads `.env` for database scripts; Vercel loads local environment values
for functions. Never expose `DATABASE_URL` to browser JavaScript.

### Database commands

Set `DATABASE_URL` in `.env` to your Neon connection string. No schema or seed data
is included yet. Both commands report a successful no-op when their folder has no
SQL files, without connecting to a database.

- `npm run db:migrate`: apply `db/migrations/*.sql` in filename order, tracking
  applied filenames in `colorloop_migrations`. Use names like `001_create_donors.sql`.
  Add new migrations instead of editing applied ones.
- `npm run db:seed`: execute `db/seeds/*.sql` in filename order on every invocation.
  Use repeatable SQL (`ON CONFLICT`, for example) and synthetic development data.

Each command runs its SQL files in one transaction and rolls back on failure.
Do not put transaction statements or commands requiring execution outside a
transaction in these files. Run database commands explicitly against the intended
database; they are not part of application startup or deployment.

### Shared package workflow

All teammates use this root `package.json` and `package-lock.json`. Coordinate
package changes in the team channel, use `npm install <package>` to update both
files, and review both in the same PR. Use `npm ci` for a clean install from the
shared lockfile. Server scripts and Vercel Functions use ES module `import`/`export`;
use `<script type="module">` for browser modules. Keep Node-only dependencies in
server code. `npm test` checks import parsing and the initial health handler.

### Dependency audit

The initial install reports advisories for the npm `xlsx` release (prototype
pollution and regular expression denial of service), with no registry fix, plus
advisories in the Vercel CLI development dependency tree. Review `npm audit`
before enabling uploads of untrusted spreadsheets. No upload endpoint is included
in this setup.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
