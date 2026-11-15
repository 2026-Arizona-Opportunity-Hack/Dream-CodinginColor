# Approved email delivery and board reminders

Real Resend REST transport is implemented. Local credentials and an operator-owned
test inbox are configured; read-only provider requests confirm a sending-only key.
That key cannot retrieve receipts, so delivery must currently be checked in the
Resend dashboard and actual inbox. Automated tests inject HTTP transport; their
receipts prove application behavior, not external delivery. Real rehearsal sends
require separate operator approval for each message.

On November 15, 2026, the operator separately approved one real synthetic thank-you
and one real board reminder to the sole allowlisted inbox. Resend accepted both.
The thank-you queue rerun and board job rerun each made zero additional send
requests. The operator confirmed both messages arrived in the Inbox and both show
Delivered in the Resend dashboard. This is operator-confirmed external delivery;
the sending-only key cannot independently retrieve that evidence. Application
history truthfully remains `sending` then `queued`, rather than claiming a receipt
it could not retrieve. Both disposable rehearsal
policies were disabled after sending; live donor automation remains disabled.
The board rehearsal verified a one-shot timer invoking the protected job and its
unauthenticated rejection. No hosted recurring scheduler has been activated.
The full automated suite passed: 180 passed, zero failed, one live-Neon check
skipped. All 16 focused provider/automation tests passed. Real follow-up emails
were not sent; that path was covered with injected provider transport, preserving
the approval scope of exactly two real emails.

## Safe defaults and approval

- `EMAIL_DELIVERY_MODE=disabled` is the default. Existing human-approved copy/handoff
  and human-reported send workflows remain available. SMS is not connected.
- Local, synthetic demo and `test` mode enforce an exact verified-inbox allowlist,
  even if someone sets the mode to `live` locally. Reserved example.com/net/org,
  `.test`, `.invalid`, `.localhost`, `.example` and provider simulation addresses
  cannot receive mail, even when included in that list.
- An MFA-authenticated administrator must save the audited policy in **Settings →
  Outreach settings → Email automation policy**. Saving requires a confirmation
  checkbox, reason, current administrator authority and CSRF protection.
- Donor automation sends only the individually approved current draft revision.
  It never automatically approves a thank-you or follow-up. Consent, opt-out,
  active donor, linked verified gift, current approver authority and provider
  suppression are checked again inside the transactional send claim.
- Live donor activation additionally requires CIC approval in server configuration:
  `CIC_DONOR_AUTOMATION_APPROVED=true` plus `CIC_EMAIL_APPROVAL_REFERENCE`. UI/API
  requests cannot set these. Test-mode activation cannot silently authorize live
  delivery after deployment without this independent gate.
- Board reminder activation approves the fixed `board-reminder-v1` internal
  template: donor name, assigned next action, Phoenix due date, reminder category
  and task link. The approving administrator must remain active and authorized.
  Edited reminder content loses approval and is never automatically reapproved.

This is an approved extension to the original human-send requirement. Donor content
still requires individual human approval. CIC approval for live donor automation
has not been obtained or assumed by this implementation.

## Database and server configuration

Review additive migrations **008, 009 and 010** in order before using new features
against persistent storage. They add organization/contact fields, truthful provider
receipt states, and an OFF-by-default JSON activation policy. Existing migrations
are unchanged. **008–010 were applied to the configured shared Neon database on
November 15, 2026, with explicit database-specific approval.** Account, donor,
donation, message and task counts were unchanged; existing MFA data was unchanged.
The new email activation policy remains OFF in that database.
Do not reset, seed or replace the database. Preserve `DATABASE_URL` and the existing
`MFA_ENCRYPTION_KEY`. Apply shared migrations only with explicit database approval.

Configure these privately; never paste credentials into chat, browser code, Git or
the policy reason field:

| Variable | Required value / purpose |
| --- | --- |
| `EMAIL_DELIVERY_MODE` | `disabled` initially; `test` for verified-inbox rehearsal; `live` only for authorized production |
| `RESEND_API_KEY` | Server-only credential permitting sending and receipt retrieval |
| `EMAIL_FROM` | Plain verified sender address; Resend's default onboarding sender is accepted only in effective test mode |
| `EMAIL_TEST_INBOXES` | Comma-separated real inboxes whose ownership the operator has independently verified; exact addresses only |
| `APP_ORIGIN` | Exact HTTPS ColorLoop origin, used in authorized task links |
| `CRON_SECRET` | Existing random preparation-job secret, at least 32 characters |
| `AUTOMATION_USER_ID` | Existing active staff/service account with `tasks.manage`, `outreach.write` and `outreach.send` |
| `CIC_DONOR_AUTOMATION_APPROVED` | Leave `false` until CIC approves live activation |
| `CIC_EMAIL_APPROVAL_REFERENCE` | Non-secret CIC approval reference, required for live donor automation |

The settings page reports configuration presence, not proof of sender/inbox
verification. Resend sender setup, recipient ownership verification, credentials,
hosted configuration and live acceptance testing remain operator tasks.
Vercel function packages explicitly exclude `.env*`; production configuration must
come from server-side deployment environment variables, never a bundled local file.
Resend's default onboarding sender can send only to the email associated with the
Resend account. A different recipient requires a verified sending domain. A
sending-only API key can submit mail but cannot update application delivery states
from provider receipts; use a dedicated Full access key for automatic polling.

## Verified-inbox rehearsal after configuration

1. Use disposable local demo storage or another explicitly approved test database.
   Keep `EMAIL_DELIVERY_MODE=test`. Preserve existing production data and MFA keys.
2. Configure a real verified sender and an operator-owned test inbox in the private
   allowlist. Do not use exported/example/synthetic email addresses.
3. Sign in with MFA. In Settings → Outreach settings, review the policy and enable
   only the workflows being tested. Record the explicit test approval.
4. Create a fictional donor using the real owned test inbox and explicit consent.
   Optionally record a small **synthetic** initial gift in this test database.
5. Review and approve the exact thank-you or follow-up in Outreach. It must not
   send before approval. Choose **Process approved email queue** in Settings and
   confirm the real test-inbox send action.
6. Expect **Provider accepted; delivery pending**, not delivered. Check the actual
   inbox/provider dashboard. Run the queue again to retrieve provider evidence.
   Delivery status must reflect that evidence; a missing receipt is not success.
7. For internal reminders, give an active board test account a real allowlisted
   inbox. Assign the fictional donor and follow-up to that same board member, with
   a deadline today or within three days. Review/enable the fixed internal reminder
   template in the policy. Repeat queue processing and confirm one message/window.
8. Disable the test policies or delivery mode after rehearsal. Do not enable live
   donor automation as a side effect of a successful test.

`node scripts/rehearse-email.mjs` prepares exactly two reviewed real-mail tests in
disposable in-memory PostgreSQL. Startup sends nothing. It uses genuine synthetic
MFA sessions and the existing protected APIs; it never uses the Neon URL or changes
the configured MFA key. Only after separate operator approvals, enter `SEND
THANK-YOU` or `SEND BOARD`. Each command permits at most one provider POST to the
sole allowlisted inbox, reruns the queue/job to check duplicate protection, and
disables both policies afterward. `STATUS` writes a sanitized receipt/history
report to `/tmp/colorloop-real-email-rehearsal.json`; `QUIT` closes the disposable
database. The board command tests the protected job through a one-shot timer.
Its fictional task link does not resolve in the separate persistent localhost app.
This rehearsal is not an installed recurring scheduler or a hosted cron test.

## Scheduling, deduplication and failures

The existing protected `/api/jobs/prepare` job prepares quarterly updates/tasks and
overdue drafts, then processes enabled approved email. Vercel's daily schedule is
**16:00 UTC / 09:00 America/Phoenix**. Hosted invocation has not been verified.
An administrator can explicitly process the queue between daily runs.

Board windows are once when approaching (within three calendar days), once on the
due day, and once per overdue week while still open. Keys include task, assignee,
due timestamp and window. The worker checks current task status, deadline, active
board account and donor ownership before sending. Changed/completed tasks suppress
old reminders. UTC-midnight date-only deadlines retain their calendar date in the
UI, Today counts and reminder calculation.

The existing transaction-bound send claim prevents competing workers from sending
the same revision twice. Resend receives the same draft/revision idempotency key.
Accepted messages are never resubmitted. Definitive HTTP 429 rejection retries
after 15 then 30 minutes, with at most three attempts. The next scheduled/manual
run performs an eligible retry; no long-lived timer is required.

Network timeouts, ambiguous provider responses and crashed in-flight claims require
operator review; they are never automatically resent. Review the provider dashboard
before taking action. Other definitive failures require correcting configuration
or recipient data and a freshly reviewed draft rather than blind retries.

Provider receipt retrieval records actual sent/delivered/bounced/complaint evidence
in communication history. Bounces/complaints suppress that recipient using a private
hashed address. No webhook or instant delivery claim is implemented; polling occurs
during queue runs, with a 30-day reconciliation horizon. Each run bounds provider
work to 25 status reads/25 sends and a 35-second dispatch budget; larger queues need
additional runs. Disabling policy does not erase an already accepted message.
Disabling transport also stops receipt polling until it is re-enabled.

Errors exposed to users are sanitized; raw provider bodies and credentials are
never logged. Outreach shows blocked-recipient/consent/approval issues inline.
Settings queue outcomes/errors remain visible until the user leaves the screen.

## API contracts

- `GET /api/email/settings`: administrator + `settings.manage`; returns policy,
  configuration booleans/mode and migration readiness; no keys or inbox list.
- `POST /api/email/settings`: same authority plus current approval capability;
  JSON `{donorEnabled,boardEnabled,confirmed:true,reason}`. Saves an audited policy.
- `POST /api/email/run`: administrator + `settings.manage`, confirmed JSON body;
  active task/outreach/send permissions required when transport is enabled.
  Returns enabled/queued/failed/blocked/deliveryUpdates counts, not donor data.
- `/api/jobs/prepare`: retains its separate bearer job credential and genuine
  automation-account checks. The reporting bearer key grants none of these writes.

All browser mutations retain session/MFA, same-origin and CSRF enforcement.

Provider contracts were checked against official documentation:
[Send Email](https://resend.com/docs/api-reference/emails/send-email),
[idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), and
[receipt retrieval](https://resend.com/docs/api-reference/emails/retrieve-email).
