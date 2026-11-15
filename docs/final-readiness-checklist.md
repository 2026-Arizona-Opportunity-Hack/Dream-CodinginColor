# Two-hour implementation checkpoints

Branch: `feature/remaining-improvements`, starting at `942b6e2`.
Timebox: November 15, 2026, 04:13–06:13 MST; final verification starts by 05:58.
Only synthetic disposable databases are used. Local CSVs, `.env`, existing MFA
configuration and main remain untouched. No live sending or deployment is implied.

## Milestone 1 — optional initial gift

- Implemented: Add Donor accepts an optional amount, date, currency, payment status,
  cash/check/offline method, reference and campaign. Blank amount creates no gift.
- Implemented: `POST /api/donors` accepts optional `initial_donation` using the same
  fields as a gift except `donor_id`; optional gift notes are supported by the API.
  An initial gift requires `donations.write` and an `idempotency_key`.
- Verified: donor and gift save in one transaction through the existing gift
  service. Failures roll back both. Replays return the same donor/gift; changed
  input with the same key conflicts. Unknown payment data stays outside verified
  totals. Eligible gifts prepare drafts; no message is sent by this operation.
- Focused tests: 21 passed, zero failed (initial donation, existing manual entry,
  and frontend transport regressions).
- Verified in Chrome: actual Add Donor check-gift form, including a
  double submit, and the existing donor-only/manual gift workflows. The complete
  HTTPS/SQL browser smoke passed with zero browser exceptions.

## Remaining checkpoints

- Organization/contact-person storage, reviewed suggestions and independent mapping.
- Fair least-loaded assignment ties and bulk approval of recognized board contacts.
- Real email adapter, safe recipient gates, approved donor dispatch and scheduled
  internal reminders; real delivery requires credentials and verified sender/inbox.
- Full regression suite, HTTPS/Chrome, static build and secret/preservation checks.

Existing human approval, consent, MFA, RBAC, CSRF and manual handoff remain required.
Live donor automation must stay disabled until CIC approves activation.

## Milestone 2 — organization and contact-person data

- `organization_name`, `company` (employer), and `contact_person` are independent
  donor fields in forms, details, merge comparison, API validation and CSV/XLSX
  mapping. `Contact person` no longer silently means board owner. Explicit
  `Contact person (board member)` and `Board contact` still map to ownership.
- Explicit Person/Organization source classifications are retained. Company alone
  never establishes Organization. Names such as Opportunity Hack produce a
  reviewable suggestion; the server requires the review decision and records it.
  Add Donor offers a button to accept a suggestion; it never changes type silently.
- Migration `008_organization_contacts.sql` adds two nullable columns without
  backfilling guesses or changing historical values. Test/demo migrations use only
  disposable databases. **008 has not been applied to shared Neon.**
- A new release must apply reviewed migration 008 before using the new fields on
  persistent storage. Existing donor writes that omit these fields remain compatible.

Organization checkpoint validation: 36 focused tests passed, zero failed; the static
build passed. Coverage includes independent CSV/XLSX fields, approved suggestions,
explicit type preservation and populated 007 → 008 upgrade without historical changes.

## Milestone 3 — fair ownership and bulk approval

- SQL imports/manual entry and state-based assignment use the fewest active donors,
  rotating tied member IDs after the last automatic allocation. A transaction-safe
  sequence in existing audit records survives process restarts and bulk operations.
- Inactive accounts/roles are ineligible. Existing owners and manual overrides
  remain supported. Zero eligible members leaves new imported/manual donors
  visibly unassigned; no account is invented.
- Approve All Recognized Board Contacts fills only unambiguous, undecided matches.
  Existing choices are preserved. Server confirmation revalidates active role,
  identity and membership, rejecting stale/forged choices transactionally.
- Validation: 22 focused tests passed, zero failed; the complete Chrome/HTTPS/SQL
  smoke passed with zero browser exceptions, including bulk approval and the new
  independent organization/contact-person form values. No extra migration needed.

## Milestone 4 — real provider transport and truthful receipt states

- Added a real Resend REST adapter using built-in server-side fetch, fixed HTTPS
  provider URL, bounded timeouts, plain-text content and stable idempotency headers.
  No project dependency or credential was added.
- Delivery is OFF by default. Local/demo/test mail requires an exact operator-
  verified inbox allowlist. Reserved example/test/invalid domains and provider
  simulation addresses are rejected before network access, even if allowlisted.
- API acceptance records `queued`, not delivered. Provider evidence distinguishes
  sent/delivered/bounced/suppressed states. Queued/in-flight outreach blocks merges;
  accepted/delivered messages cannot be edited or sent a second time.
- Migration 009 adds receipt states without changing existing human-send history.
  It is tested only in disposable databases; shared Neon is unchanged.
- Rate-limit rejection is distinguished from ambiguous network outcomes. Errors
  never expose raw provider responses, credentials or recipient addresses.
- Focused provider/outreach/merge/frontend tests passed against an injected HTTP
  transport and real isolated SQL. **No real Resend request or email was sent.**
  Credentials, sender and verified test inboxes are currently absent.
- Scheduling, durable activation policy and delivery reconciliation are the next
  milestone; this transport alone does not automatically dispatch messages.
