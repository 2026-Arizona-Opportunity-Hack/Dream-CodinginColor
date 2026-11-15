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
