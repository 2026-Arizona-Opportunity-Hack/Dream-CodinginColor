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

## Remaining external gates

- Review and separately approve shared application of migrations 008–010. They
  have only been exercised in disposable databases. New field/policy operations
  report the required migration; blank optional fields preserve legacy donor entry.
- Configure the real provider credential, verified sender and independently owned
  test inbox allowlist. No external email has been sent or certified.
- CIC must approve live donor activation. Default transport/policies remain off.
- Hosted scheduler/provider/Neon checks and deployment remain unperformed; no
  deployment, shared migration, push or main merge is authorized by this work.

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
  milestone described below; transport alone does not automatically dispatch mail.

## Milestone 5 — approved automation and reminders

- Added MFA/CSRF/administrator-protected policy and explicit queue-processing UI/API.
  Policy updates record a reason, confirmation, approver and fixed board template
  version. Migration 010 persists the policy OFF by default.
- Existing authenticated preparation cron now processes eligible approved donor
  email and internal reminders. Daily timing is 09:00 America/Phoenix. Internal
  windows cover three-day approach, due day and weekly overdue follow-ups, with
  stable task/recipient/deadline/window keys and current ownership/task rechecks.
- Donor messages require approval of the exact current revision, current approver
  authority, valid consent, active donor, verified linked gift and no suppression.
  Live sending additionally requires the independent CIC environment approval gate.
- Known rate-limit rejection retries with backoff using the same key, at most
  three attempts. Unknown outcomes are held for human review. Queued messages are
  never resubmitted. API acceptance and provider delivery remain distinct.
- Real provider status retrieval records delivery/bounce/complaint evidence and
  suppresses bounced/complaining recipients. Polling is bounded and auditable; no
  webhook or instant-delivery claim was added. No private provider response is logged.
- Fixed date-only follow-ups displaying the prior day in Phoenix and preserved
  original revision approvals during retries. New email failures appear in the app.
- [Exact setup, API contracts and rehearsal](EMAIL-OPERATIONS.md). No credentials,
  private `.env`, MFA key, existing donor data or external services were modified.

## Final measured verification

| Check | Result |
| --- | --- |
| `RUN_NEON_TESTS=false npm test` | 180 tests: **179 passed, 0 failed, 1 live Neon test skipped** |
| Real HTTPS API integration smoke | Passed against disposable synthetic SQL; no live database/provider |
| Real Chrome workflow | Passed with zero browser exceptions; initial check gift, donor-only creation, reviewer-approved organization suggestion, independent contact fields, bulk recognized owners, import/reimport, safe merges, approvals, MFA and disabled email-policy controls |
| Responsive/keyboard audit | 75 views passed, including 320px, 390px and 200% reflow simulation; zero overflow/contrast/label/render failures |
| Lighthouse 13 | 100 accessibility on all 19 audited views; measured November 15, 2026, 05:38 MST |
| Local Vercel build/output verification | Five Node 22 functions, 43 rewritten paths, packaged OpenAPI/email auth guards, XLSX/TOTP/QR execution; current 17 browser assets, no private static material |
| OpenAPI validation | Valid OAS 3.1.1; 13 documented read paths, 175 Schema Objects checked; negative checks pass |
| Dependency audit | Zero vulnerabilities; no project dependency changes |
| Secret/preservation checks | Guard passed; rebuilt function packages exclude `.env*`; 388 generated files scanned with zero current private-secret literal matches; source `.env`, local CSVs, MFA configuration and main unchanged |

Email tests use the real HTTP request/receipt contract with an **injected synthetic
HTTP transport** and isolated PostgreSQL. No real Resend send, real mailbox delivery,
shared Neon connection, shared migration, hosted cron or deployment was verified.
Lighthouse is a local automated measurement, not full screen-reader certification.

The responsive audit originally mistook the new persistent `role=status` region
for a loading indicator. Its readiness check now targets `.loading`; the rerun
passes without removing accessible live regions. Existing duplicate-donor guards
also correctly rejected two deliberate shared-inbox test identities; that fixture
now records the explicit distinct-record decision rather than weakening matching.

The final packaging scan found dotenv tracing had copied the local `.env` into
four private function bundles. Nothing was deployed or published. Vercel function
configuration now explicitly excludes `**/.env*`; the output verifier rejects any
environment file in a function bundle. A clean rebuild removed those copies, and
the follow-up private-literal scan found zero matches across 388 generated files.
Original private configuration was never edited, rotated or printed.

## Local milestone commits

| Commit | Checkpoint |
| --- | --- |
| `08b4892` | Atomic optional initial donation and browser coverage |
| `5a63530` | Independent organization/contact-person fields and reviewed classification |
| `3a7dff0` | Durable fair assignment rotation and bulk owner approval |
| `a7be018` | Disabled real-provider transport and truthful receipt states |
| `08c2d76` | Legacy-schema donor-entry compatibility and employer-only safeguards |
| `7862fd7` | Explicit Person/Organization export label casing |
| `b713836` | Approved automation, reminder scheduling, delivery reconciliation and safety tests |

These checkpoints supersede earlier branch handoff limitations about fixed-ID
assignment ties, missing provider transport and optional initial gifts. Historical
handoff documents remain as records of their original branches.

## Operator next steps

1. Review and approve persistent application of additive migrations 008–010. No
   reset/seed is needed. Restart the local backend after the reviewed upgrade.
2. Configure real Resend credentials, verified sender and owned verified test inboxes
   privately; use test mode first. Follow `EMAIL-OPERATIONS.md` for the exact flow.
3. Complete a real verified-inbox delivery/receipt test. Failed/unverified provider
   behavior must remain visible; never substitute synthetic success receipts.
4. Keep live donor automation disabled until CIC approval and explicit admin policy
   activation. Do not change MFA keys as part of this setup.
5. Push/merge/deploy only through separately authorized release steps. All changes
   from this task are local commits on `feature/remaining-improvements`.
