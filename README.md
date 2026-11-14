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

ColorLoop brings Coding in Color's donor relationships, giving history, follow-ups,
and reporting into one CIC-branded workspace. The frontend and reporting layer are
implemented; database/auth/workflow integration is still pending in this checkout.
No synthetic donor cards are presented as real data.

See [frontend/API contracts](docs/FRONTEND-INTEGRATION.md) and
[Vercel deployment and acceptance checklist](docs/DEPLOYMENT.md).
The [frontend brand and accessibility audit](docs/FRONTEND-AUDIT.md) records
responsive/keyboard checks, fixes and remaining verification.

## Tech stack

- Frontend: vanilla HTML/CSS/JavaScript
- Backend: Node.js ES modules and Vercel Functions
- Database: Neon PostgreSQL
- Imports: `csv-parse` and `read-excel-file` (backend integration pending)

## Run it locally

```bash
git clone https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor.git
cd Dream-CodinginColor
cp .env.example .env   # fill in your own values — never commit .env
npm install
npm test
npm run dev
```

Use Node.js 22 or newer. `npm run dev` opens a local frontend/report harness at
http://127.0.0.1:3000. The app uses real API calls; missing teammate endpoints
return an explicit unavailable message. Reporting requires the shared `lib/db.js`,
`lib/auth.js` and database views documented in the integration guide. Use Vercel's
full local runner after integrating teammate endpoints. No live deployment or
browser accessibility score has been verified yet.

`dotenv` loads local `.env` values for the local runner. Never expose `DATABASE_URL`
or `REPORTING_API_KEY` to browser JavaScript. `npm test` validates retention
classification, date/filter handling, reporting key authentication, privacy and
failure behavior. Database migration/seed scripts are not present in this checkout;
the existing database script commands require Teammate 1's implementation.

### Shared package workflow

All teammates use this root `package.json` and `package-lock.json`. Coordinate
package changes in the team channel, use `npm install <package>` to update both
files, and review both in the same PR. Use `npm ci` for a clean install from the
shared lockfile. Server scripts and Vercel Functions use ES module `import`/`export`;
use `<script type="module">` for browser modules. Keep Node-only dependencies in
server code. `npm test` runs the available report tests.

### Dependency audit

Use `npm audit` before deploying. No dependencies were added for the frontend or
reporting layer; browser code uses platform APIs and exports use print-to-PDF.

## Links

- Live demo:
- Demo video:
- Design / docs:

## After the hackathon

Winning teams finish the project with the nonprofit — the [Definition of Done](https://www.ohack.dev/about/completion) (deployed, nonprofit sign-off, docs, open source) is tracked on your team page. Keep the repo public and the README honest; recruiters do read these.

Need a hand this weekend? [#ask-a-mentor](https://opportunity-hack.slack.com/archives/C01E5CGDQ74) on Slack, or ask in [#dream](https://opportunity-hack.slack.com/app_redirect?channel=dream) and a mentor will drop in.
