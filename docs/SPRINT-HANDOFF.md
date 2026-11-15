# Safe enhancement sprint handoff

Local `main`; recovery commit `34ef91e` retained. No commits, pushes, deployments,
shared migrations, shared data edits or real email sends were performed.

## Status

- Demo Workspace: **deferred**. Domain tables, SQL store, raw donor/import queries,
  reporting views/key API and scheduled jobs lack a shared workspace boundary.
  Adding a selector would not isolate them. Complete server-side isolation and
  regression coverage cannot safely fit the ten-minute allocation. No reset or
  workspace selector was added; Main Workspace and existing accounts are unchanged.
- Hosted Judge Demo: **deferred with a manual local fallback** below. No judge
  account may be provisioned on the shared production database without isolation.
- Donor Impact Feed: **internal reusable preview implemented**. On Donors, open a
  donor's Giving tab and choose **Preview donor impact (internal)**. Existing MFA,
  reporting permission and server-side board assignments protect the funder API.
  Lifetime/YTD verified USD giving, dates, recorded programs and chronological
  verified outcome evidence appear. No metrics or exact dollar allocations are
  inferred. Evidence references are not rendered in this component. Other currencies
  remain visible in the existing giving view. No new API or publication workflow.
- Donor portal/linking: **unfinished**. No public route or donor role was added.
- Email verification: **deferred**, since the preceding priorities are incomplete.
  Existing pending CIC approval and mandatory MFA continue to apply.

No new migrations, dependencies or environment variables are required. Do not
run a migration command against the configured Neon database for this change.
Validation: full suite **207 passed, 0 failed, 1 skipped**; focused checks **7/7**;
Chrome passed all seven screens, including recording synthetic outcome evidence
and opening the impact preview. Isolated Vercel packaging passed with 18 static
assets, five Node 22 functions and 43 verified routes; no private environment files.

## Manual local judge fallback

This uses the existing disposable local fixture, **not** the requested same-login
hosted workspace. It contains separate synthetic accounts and resets on restart.
Do not share the production Dream credentials or expose localhost through a tunnel.

1. Use Node 22 and the existing TLS files from README setup. Set and export a strong
   private `DEMO_PASSWORD` in your terminal (15+ characters, upper/lowercase, number,
   special character); never put it in docs or a recorded terminal.
2. Start the synthetic instance with the existing configuration file ignored:

```sh
DOTENV_CONFIG_PATH=/dev/null COLORLOOP_DEMO=true PORT=3001 \
APP_ORIGIN=https://localhost:3001 \
LOCAL_TLS_KEY=node_modules/.cache/colorloop/tls.key \
LOCAL_TLS_CERT=node_modules/.cache/colorloop/tls.crt \
EMAIL_DELIVERY_MODE=disabled EMAIL_CRON_ENABLED=false \
CIC_DONOR_AUTOMATION_APPROVED=false npm run dev
```

3. Open https://localhost:3001. Sign in as the fixture `admin@example.test` with
   your private password and enroll MFA off camera. This mode rejects production
   hosting and never uses the Neon connection. Its seeded board accounts are
   fictional; it does not preserve the three real board accounts.
4. In Settings → Create role, create a local judge review role with these
   identifiers, one per line: `donors.read`, `donors.write`, `donations.write`,
   `imports.manage`, `assignments.manage`, `activities.write`, `tasks.manage`,
   `outreach.write`, `outreach.approve`, `reports.read`, `settings.manage`.
   Omit `outreach.send`, `users.manage` and `roles.manage`.
5. Settings → Manage user account: choose Create new, a private judge email/name,
   a unique password from your password manager, the new role, Active and Board
   member No. Hand credentials privately to one judge. MFA enrollment is required.
6. This account can review synthetic workflows and impact, but cannot send emails
   or administer users/roles. Repeat with individual accounts for other judges;
   local judges still share synthetic records, so use sequential sessions. Restart
   the local fixture to discard/revoke all its credentials/data. This is not hosted
   judge provisioning and must never be copied into production without isolation.

## Recording and release

Use the existing [four-minute script and Q&A](FINAL-DEMO-REHEARSAL.md). Replace
about 10 seconds of radar detail with Maya's Giving → Preview donor impact
(internal): “This staff-only preview reuses recorded giving and verified outcome
evidence. We do not infer impact. Donor account linking is future work.” Show its
empty evidence state honestly. Do not depict an implemented workspace, judge portal
or donor login. Retain the PII, board-access and human-approval security statement.

Review `git diff` and test results before any commit. A release needs separate
approval, a fresh Vercel build with the new allowlisted asset, and hosted smoke
checks. This change does not make the deferred features ready for deployment.
