# Email routing and scheduled board reminder handoff

## Verified behavior

- Thank-you and personalized follow-up recipients are read from the current donor
  record (`donors.normalized_email`) when the transactional send is claimed.
  The administrator's address is never a fallback. Exact-revision approval,
  active consent, opt-outs, suppression and verified-gift checks remain required.
- Task reminders resolve the current assigned board account (`users.email`). They
  include donor name, next action, Phoenix due date, reminder category and task link.
  The donor must also be assigned to that board member, preserving donor RBAC and
  ensuring the recipient can open the link. Reassign both donor ownership and the
  follow-up when transferring responsibility. Old reminders cannot send afterward.
- Missing addresses are blocked without fallback. Completed/cancelled tasks,
  unauthorized assignees, invalid dates and empty actions are skipped or blocked.
  Hosted reminders reject localhost origins; an approved link from a different
  deployment origin is blocked rather than silently rewritten.
- Retry/concurrent invocations share the transaction-bound claim and provider
  idempotency key. Delivery history records actual attempts/results; blocked
  messages have audited reasons. Provider acceptance is not delivery evidence.
- The earlier two real tests deliberately used one operator-owned inbox in both
  fictional database records. The application did not substitute the admin email.
  New injected-transport tests use distinct donor, board and admin addresses and
  update donor/board addresses in PostgreSQL to prove dynamic routing.

## Vercel environment variables

Configure server-side variables under Project Settings → Environment Variables.
Use the Production scope for the eventual production scheduler. Never put these
in browser JavaScript, `vercel.json`, Git, screenshots or chat.

| Variable | Initial deployment / required setting |
| --- | --- |
| `DATABASE_URL` | Existing approved Neon connection string; no reset, seeding or new migration needed for this change |
| `MFA_ENCRYPTION_KEY` | Preserve the exact existing stable key; rotation remains a separate approved operation |
| `APP_ORIGIN` | Exact deployed HTTPS origin, e.g. `https://YOUR-PROJECT.vercel.app`, without trailing slash; never localhost |
| `EMAIL_DELIVERY_MODE` | `disabled` initially; `test` only for separately approved allowlisted tests |
| `RESEND_API_KEY` | Existing server credential; Full Access is required for automatic receipt polling |
| `EMAIL_FROM` | Plain verified sender address; default onboarding sender is test-only and limited by Resend to the account owner's inbox |
| `EMAIL_TEST_INBOXES` | Exact comma-separated verified operator inboxes; test mode blocks every other recipient, without rewriting addresses |
| `CRON_SECRET` | Unique random server secret of at least 32 characters; do not reuse an API/MFA key |
| `AUTOMATION_USER_ID` | Genuine active staff/admin account ID with `tasks.manage`, `outreach.write`, `outreach.send`; a board-only account is ineligible |
| `EMAIL_CRON_ENABLED` | **`false`** until unattended sending receives separate approval |
| `CIC_DONOR_AUTOMATION_APPROVED` | **`false`** until CIC explicitly approves live donor automation |
| `CIC_EMAIL_APPROVAL_REFERENCE` | Leave empty until that CIC approval exists |
| `COLORLOOP_DEMO`, `ALLOW_SYNTHETIC_SEED`, `BOOTSTRAP_ADMIN` | **`false`** for the existing persistent database |
| `NODE_ENV` | `production` for deployed functions; local/test delivery remains allowlisted |

An administrator can obtain their own non-secret account ID by signing in with
MFA and visiting `/api/account/profile`; use its `id`, never the email or password,
for `AUTOMATION_USER_ID`. Keep the existing account and MFA enrollment.
Use Node.js 22, the existing `npm run build`, and output directory `dist`.
The compiled build retains five functions and all 43 verified API rewrites.

## Scheduler setup and activation gates

`vercel.json` already declares `/api/jobs/prepare` with `0 16 * * *`: daily at
16:00 UTC, which is 09:00 America/Phoenix throughout the year. On Hobby, execution
may occur within the scheduled hour (09:00–09:59), and only daily frequency is
supported. Cron runs on the production deployment, not Preview or localhost.
Vercel supplies `Authorization: Bearer <CRON_SECRET>` automatically. The endpoint
rejects missing/forged credentials and inactive or unauthorized operator accounts.
See [Vercel cron security](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[UTC schedules](https://vercel.com/docs/cron-jobs), and
[Hobby timing limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Keep both policies OFF in Settings → Outreach settings → Email automation policy.
With `EMAIL_CRON_ENABLED=false`, even an authenticated job only prepares drafts
and tasks; its response includes `email.scheduledDeliveryDisabled=true`. Preparation
can write records, so do not use the shared job as a read-only production probe.
Ordinary UI queue processing remains a separately confirmed administrator action.

After separate deployment approval, configure the environment and inspect the
production project's Cron Jobs page. First verify hosted routing and behavior in
an explicitly approved test database. Do not activate unattended sending as part
of this handoff. Later, after explicit approval, enabling scheduled board delivery
requires all three: a configured transport, `EMAIL_CRON_ENABLED=true`, and an
administrator-approved board template/policy. Environment edits require a new
deployment. Real board delivery outside the test allowlist requires a verified
sender and separately authorized live transport; this does not authorize donor
automation, whose CIC gate and exact-message approval remain independent.

Reminders run once in the approaching window (within three Phoenix calendar
days), once on the due day, then once per overdue week while open. Repeated runs
in the same window cannot resubmit an accepted message. Monitor Outreach history
and Vercel job logs. The response's `email.queued` is provider acceptance;
`messagesSent: 0` is the legacy preparation-only field, not a delivery assertion.
With a sending-only Resend key, application status stays queued until provider
evidence can be retrieved; inspect the dashboard and inbox independently.

## Hackathon demonstration without further real emails

1. Sign in with mandatory MFA. Open a fictional donor and show giving history,
   consent, the linked-gift thank-you draft, exact-message approval and a
   personalized follow-up draft. Explain the recipient comes from that donor.
2. Assign the fictional donor and a due/approaching task to the same board account.
   Show the account email and task name/date; open `#tasks?task=TASK_ID` to show the
   working link. A board account can open only an authorized donor's task.
3. Run `node --test tests/email-routing-scheduler.test.js`: these tests use only
   disposable PostgreSQL and injected transport. Explain the distinct addresses,
   recipient updates, consent blocks, scheduled-job gate and zero duplicate sends.
4. Show the two previously delivered Resend test emails as real-service evidence.
   Do not rerun the real-mail rehearsal script without fresh explicit approval.

Current verification: 24 focused tests passed; full suite 186 passed, zero failed,
one live-Neon check skipped. Real HTTPS and Chrome workflows passed, including
admin/board task links and MFA. Compiled cron authentication/default-OFF and API
routing checks passed. No additional real emails or hosted deployment were run.
All 33 shared Neon tables matched their read-only baseline fingerprints, including
account/MFA records. `.env` and both protected demo CSVs matched their initial
hashes. The tracked-source/build scan found no private credential values or
bundled `.env` files; local demo CSVs were also absent from the packages.
