# Final demo rehearsal and README handoff

Verified November 15, 2026, America/Phoenix. This supplements the
[previous audit](FINAL-PRE-DEMO-AUDIT.md); it does not replace its production
configuration warnings. Changes remain uncommitted on `feature/pre-demo-readiness`.
`main` was not changed. No production data, MFA, secrets or protected CSVs were edited.

## Mentor checklist

PASS below describes executed isolated Chrome tests unless stated otherwise.

| Requirement | PASS / FAIL | Evidence |
| --- | --- | --- |
| Live link works | PASS | Fresh Chrome visit to https://colorloop-nu.vercel.app shows dedicated sign-in with the workspace hidden; production writes blocked, none attempted. |
| README Team section complete | FAIL pending confirmation | All three supplied names and proposed roles are included. The team representative explicitly made roles subject to team confirmation. No video URL is available yet. |
| CSV import | PASS locally | Actual original file selected in Chrome, empty PostgreSQL fixture: 11 donors, 11 gifts added, zero reused, zero row errors, USD 2,130. |
| Duplicate merge | PASS locally | Maya Hernandez alternate record merged into Maya Hernandez through server preview and both identity confirmations; alternate archived; 11 original gifts and unrelated donors preserved. |
| Re-import creates zero gifts | PASS locally after approved fix | Exact same file and source: 11 valid rows, 11 existing transactions, zero added gifts, 11 reused gifts; unchanged USD 2,130. Fix is not deployed. |
| Human approval | PASS locally | Reviewed Maya thank-you; explicit approval-only fallback recorded current-revision approver. Unapproved alternate send returned 409. Zero provider requests. Prior audit also tested combined Approve & Send with mocked Resend. |

## Exact file and import decisions

Original, unchanged file:
`/Users/shoryamoses/Downloads/colorloop_demo_ZEFFY_with_OHacks.csv`.
SHA-256: `6d043faf65bc2f1c0b66f5c07ecf9da4188e98f7d0d49a22d9f91efacd742bf7`.

The file contains 11 distinct email identities and 11 distinct
`ZEFFY-SYN-2026-0001` through `ZEFFY-SYN-2026-0011` transactions, USD 2,130,
completed payments dated November 3–13, 2026, and three blank Board Contacts.
All addresses use reserved `example.com`; phone numbers use fictional
202-555-01xx numbers. Names, organizations and transaction labels are consistent
with a synthetic rehearsal file, not evidence of real gifts. The named board
contacts are team names, not fabricated identities. No donor address is suitable
for a real delivery test.

| Campaign | Gifts | USD |
| --- | --- | --- |
| Fall 2026 STEM Access | 6 | 1,285 |
| 2026 Mentor Match | 5 | 845 |

Use these steps in an authorized isolated recording fixture:

1. Today initially shows zero giving and no donors. Open **Imports → Zeffy export**.
2. Select the original file; choose **Upload and inspect**.
3. Under **Optional and unmapped columns**, map **Phone → Donor Phone** and
   **Gift date → Payment Date**. These headings are not auto-detected. Keep
   **Organization name → Organization**. Do not map that column to employer or
   human contact. The file has no employer, human-contact or explicit donor-type column.
4. Review the detected first/last name, donor email, amount, currency, payment status,
   campaign, Board Contact and Transaction ID mappings. Choose **Validate mapping**.
5. Verify **11 valid rows**, **11 donation rows**, **2 campaign names**, **0 errors**.
6. Approve each campaign once: **Create campaign with explicit approval** and its
   checkbox. For later imports leave each **Keep matched campaign** selected.
7. Review Opportunity Hack's suggested type and choose **Organization: I reviewed
   the source**. The file has no explicit type; the organization column alone does
   not establish that Sofia or another named person is an organization. OHacks Team
   has no automatic name suggestion in the current rules and remains Person unless
   deliberately edited after identity review. Do not claim all organizations were
   automatically classified.
8. Choose **Approve All Recognized Board Contacts**. In the isolated fixture the
   three genuine synthetic board accounts are named Shorya Moses, Abbhijit
   Venkatachalam and Oumar Yassir, matching all eight nonblank source contacts.
   Other environments require their actual active accounts or explicit reviewed
   balanced decisions. Never assume a CSV name grants ownership.
9. **Review confirmation → Confirm import**. Read the visible result:
   **11 donors · 11 donations added · 0 existing gifts reused**.
10. On reimport use **Start another import**, the same file, source and mappings.
    Review Opportunity Hack as Organization again, approve recognized owners, and
    confirm. Result: **11 donors · 0 donations added · 11 existing gifts reused**.

The three blank contacts were assigned by eligible-board workload, with final
donor counts 4/4/3. Existing recognized ownership was retained. Campaign/date,
name/email/phone/organization and transaction values were verified from stored
rows after the real UI import; no SQL inserts substituted for the upload.

## Bug found and approved fix

The first review saved Opportunity Hack as Organization. On reupload, the absent
type column defaulted it to Person. `prepare` rejected the existing transaction
before the reviewer could choose Organization again. This blocked legitimate
reimport; it did not create duplicate gifts.

`lib/import-data.js` now allows that mismatch only in preview, only for an inferred
Person with an Organization suggestion, and only with matching name and nonempty
email against the existing Organization. The reviewer must still choose a type.
Confirmation uses the strict identity check and rejects Person, explicit conflicting
types, changed identity, modified gift data or a forced new donor. Two regression
tests cover successful repeat/retry and these rejection cases. No migration is needed.

## Application verification

| Page | Expected | Actual | PASS / FAIL |
| --- | --- | --- | --- |
| Today | Empty start; updated giving and next steps | USD 0 before upload; USD 2,130 and 11 current-year giving donors afterward. Maya's November 20 task appears after it is created. Import does not invent completed communications. | PASS |
| Donors | Correct identities, gift history and reviewed owners | 11 imported donors/gifts; exact contacts/organizations/dates/campaigns/transaction IDs stored. Maya's giving view shows USD 60. Timeline shows the gift, logged note and created follow-up. | PASS |
| Outreach | Imported recipients, template, review and approval | Maya thank-you has her database email and verified gift. Approved without handoff/send through the optional fallback. Radar draft personalized, edited and approved. No delivery claimed. | PASS |
| Follow-ups | Searchable donor, owner, due date, timeline | Maya's task assigned to Shorya, due November 20. It appears in task list and donor timeline. Quarterly preparation created one draft and task per active donor without sending. | PASS |
| Reports | Verified totals, retention and funder packet | USD 2,130/11 gifts, no prior-year history inferred from CSV. Maya funder packet renders USD 60 and no invented outcomes; Chrome generated a 70,918-byte PDF. Campaigns are retained in gifts; Reports groups by program/board, not a campaign chart. | PASS |
| Imports | Review, history and safe reupload | Two campaign decisions, explicit type/owner decisions, saved batch rows; reimport adds zero gifts. | PASS |
| Settings | Import preserves account/security configuration | Entire isolated user, role and retention-settings snapshots are identical before/after import, including password/MFA/recovery fields. No shared account was changed. | PASS |

Quarterly preparation was exercised after adding the separate radar donor: 12
active donors produced 12 quarterly drafts and 12 tasks. They are not sends.
The original CSV itself contains no previous-year history; it cannot demonstrate
lapsed or returning donors without a separate clearly synthetic historical fixture.

## Lapsed Donor Radar

- Navigation: **Outreach → Needs attention → Matched giving cycle**.
  Direct route: `#outreach?view=attention&mode=cycle`.
- UI: `public/js/outreach-ui.js`, `renderOutreach`. `public/js/api.js` adapts the
  donor name/date returned by the backend. Today links to the separate inactivity view.
- Backend: `lib/retention.js`, `atRisk` and `createReengagement`;
  `lib/retention-api.js` handles GET/POST `/api/retention/at-risk`;
  `lib/api-router.js` registers the route. Templates live in `lib/outreach.js`.
- On November 15, 2026, cycle mode requires a verified completed gift from
  **January 1–November 15, 2025**, and no verified completed gift from
  **January 1–November 15, 2026**. It uses UTC date boundaries and actual valid gift
  history. It is matched calendar year-to-date, not a rolling year or an editable
  fiscal cycle. Current-year lapse status is provisional.
- Separate inactivity mode uses configurable calendar months (default 12).
  Settings → Edit lapse threshold changes that mode, not the cycle definition.
- Synthetic Avery Cycle gave **USD 120 on June 10, 2025**, has no 2026 gift, has
  verified consent in the fixture and is assigned to Shorya. The card shows the
  correct name/date. The giving profile shows the amount; the card does not.
- **Prepare check-in and follow-up** created a Reconnection draft and assigned
  task. The editor showed Avery's name; editing and approval worked. The timeline
  shows the draft subject and follow-up; it does not show the full message body or
  a delivery event for an unsent draft.
- The assigned board user accessed Avery in **My donors** and the direct API.
  Another board user saw no Avery row, received 403 from the direct API and could
  not reveal the email through a profile URL. Default board roles lack
  `reports.read`, so their radar API returns 403; staff use radar to prepare their
  assigned work. Do not claim every board account has the radar menu.
- Snooze/dismiss: **missing**; the UI explicitly states snoozing is unavailable.
- Production contains the radar frontend code. Authenticated hosted radar/data was
  not exercised; the complete workflow passed in local Chrome with isolated SQL.

### Radar clip, 25 seconds

Prepare Avery privately in an isolated fixture and verify the June 10 USD 120 gift
in the profile before recording. No historical gift is added to production.

| Time | Exact action | Words to say |
| --- | --- | --- |
| 0–5s | Outreach → Needs attention → Matched giving cycle | “Avery gave last year's matched period and has no gift this year.” |
| 5–9s | Point to Synthetic Avery Cycle and June 10, 2025 | “This is a provisional lapse based on recorded giving.” |
| 9–15s | Prepare check-in and follow-up; allow 2s to load | “One action prepares a personalized draft and an assigned next step.” |
| 15–20s | Review body; expand Optional manual handoff fallback | “A human reviews the content and recipient.” |
| 20–25s | Approve current draft; show approved handoff option | “This records approval only. No email was sent.” |

For a fresh, unedited draft, the approval-only button is **Approve current draft**.
After editing, it becomes **Save edits and approve**. Do not click **Approve & Send
Email** in this no-delivery recording. Do not describe approval-only as a delivery.
The 25-second clip fits only with private sign-in, a prepared donor and a rehearsed
browser; creating the historical fixture is outside that time.

## Reset Demo: blocked by missing isolation

No Reset Demo control or deletion endpoint was added. It is not enabled and no
production reset ran. There are no usage steps for a control that does not exist.

The schema shares donors and related records among accounts. Assignments scope
board access, not separate organizational datasets. Import source and creator
fields are not proof that a record is synthetic. There is no verified demo-run
identifier/manifest covering all related records. Audit, activity, delivery,
revision and approval history also have append-only triggers. A bulk delete or
name-based cleanup would risk shared records and violate history constraints.

Therefore the desired **same Dream login + same website + truly empty Today**
cannot safely be delivered as a small reset button on the present schema.
Nothing would be deleted by this work. Dream login, passwords, MFA, all users,
roles/configuration, schema, donors, gifts, histories and deployment remain intact.

Smallest safe options:

1. For this recording, keep the production Dream login/site unchanged. Show it as a
   read-only deployment introduction and clearly label the isolated application
   capture as a synthetic rehearsal. This is safe now but does not meet the
   same-production-site empty-reset requirement.
2. If that requirement is essential, separately approve a server-scoped demo-run
   workspace behind the existing Dream login on the same website. A guarded admin
   action would switch to a new empty synthetic run, retaining earlier runs rather
   than deleting them. Every domain API/report must enforce that scope, while auth,
   MFA and organization configuration remain shared and untouched. It needs schema,
   authorization, cross-workspace tests and approved deployment; it is not implemented.

A production reset still requires explicit approval plus proven record provenance
and scope. That approval alone cannot establish currently missing isolation.
Reloading, clearing browser storage or hiding existing rows is not a genuine reset.

## Four-minute video script

This script is for an authorized **isolated synthetic recording**. It is not a claim
that the current production Dream account is empty or that the local fix is deployed.
Privately complete MFA before recording; never show factors, recovery codes,
passwords, environment files or API keys. Set a desktop viewport around 1440px.
Have the original file ready, and ensure the three fixture board accounts match
the CSV. Use the approval-only fallback, with transport and automation off.

The merge alias must be created during the recording as below, or prepare that
short clip in advance and label the edit. Avery's separate historical fixture can
be prepared after the four mentor actions; it leaves current-year giving USD 2,130.
Do not imply the 2025 gift came from the original CSV.

| Time | Page, click and expected result | Spoken narration, word for word |
| --- | --- | --- |
| 0:00–0:15 | Production sign-in, then clearly labeled isolated Today with USD 0. Allow 3s transition. | “ColorLoop is Team Dream's donor relationship platform for Coding in Color. The deployed site protects its workspace behind sign-in and two-factor authentication. This demonstration uses isolated synthetic records.” |
| 0:15–0:35 | Imports → Zeffy export → select original file → Upload and inspect. Allow 3s upload. | “Zeffy and Benevity stay in the nonprofit's giving workflow. ColorLoop imports their records and organizes the relationships. This synthetic Zeffy file has eleven donors and eleven completed gifts totaling two thousand one hundred thirty dollars.” |
| 0:35–0:53 | Expand Optional and unmapped columns; select Phone/Donor Phone and Gift date/Payment Date; verify Organization name; Validate mapping. Allow 2s. | “The mappings remain visible and editable. I map the payment date and phone explicitly. Organization, employer, human contact and board owner are separate fields.” |
| 0:53–1:15 | Approve two new campaigns and checkboxes; Opportunity Hack → Organization; Approve All Recognized Board Contacts; Review confirmation → Confirm import. Allow 3s. | “We approve each campaign once. I review Opportunity Hack's classification and the recognized board contacts. Blank contacts receive balanced assignments. Confirmation shows eleven gifts added with no messages sent.” |
| 1:15–1:37 | Donors → Add donor. Enter Maya Hernandez alternate record and maya-alternate@example.com, no gift, optional synthetic identity note → Create donor. Allow 2s. | “Here is a controlled alternate record for our fictional Maya. It has no additional donation. We will review it before combining identities.” |
| 1:37–2:00 | Donors → Compare donor records. Retain this donor: Maya Hernandez; Archive this donor: Maya Hernandez alternate record. Enter synthetic identity-review reason → Get server merge preview → both confirmation checkboxes → Confirm reviewed merge. Allow 3s. | “The server builds a merge preview. A human confirms the identity evidence and the records to retain. Maya's original gift remains, the alternate is archived, and the merge is audited.” |
| 2:00–2:29 | Imports → Start another import; same file/source/mappings; Validate mapping. Keep matched campaigns; review Organization again; approve recognized contacts; Review confirmation → Confirm import. Allow 4s across requests. | “Now I upload the identical file with the same source. Existing transaction IDs are recognized. After review, the result is zero donations added and eleven existing gifts reused. Giving has not increased.” |
| 2:29–2:51 | Donors → Maya Hernandez → Details → Edit donor details; record verified consent only for this fictional fixture; Save donor details. Draft email → Thank-you email → Prepare draft. Allow 3s. | “For this fictional donor I record the test's verified consent, then prepare the thank-you linked to her sixty-dollar gift. We review Maya's actual recipient, subject and message.” |
| 2:51–3:08 | Expand Optional manual handoff fallback → Approve current draft. Show approved state and stop. Allow 2s. | “The normal Approve and Send action requires human approval and delivery gates. For this recording I use approval only. The current revision is approved; no email has been sent.” |
| 3:08–3:27 | Maya profile → Schedule follow-up. Title Invite Maya to the next CIC update; November 20, 2026; assigned Shorya Moses → Save follow-up. Open Timeline. Allow 3s. | “Each relationship has an owner and a dated next step. Maya's gift, outreach draft and follow-up appear together. Quarterly update drafts and tasks can also be prepared for review.” |
| 3:27–3:48 | Preprepared Avery fixture: Outreach → Needs attention → Matched giving cycle → Prepare check-in and follow-up. Show draft; no sending. Allow 3s. | “Our chosen P1 is Lapsed Donor Radar. Avery gave in the matched prior-year period and has not given this year. The lapse is provisional. Preparing a check-in creates a personalized draft and assigned follow-up.” |
| 3:48–4:00 | Reports: current-year USD 2,130; briefly show already-open Maya funder packet or closing screen. | “We reviewed Coding in Color's security requirements. ColorLoop protects donor information, restricts board-member access to authorized donors, and requires human approval before outbound messages.” |

This is a dense four-minute sequence. Use pre-rehearsed screen clips, quiet loading
cuts and a voiceover if necessary; captions must identify the isolated environment.
Do not type new fixture values for the first time while recording. The final exact
security sentence is supported by local authorization/approval tests, not a
compliance certification. Keep a final closing card visible until 4:00.

Fallbacks: if upload fails, stop and correct mappings; do not call invalid data a
successful import. If a merge preview conflicts, refresh the preview and recheck
identity; do not skip its confirmations. If reimport does not say zero added,
stop and use the captured verified isolated clip, labeled as such. If production
is slow, use the verified sign-in screenshot with its timestamp. If a draft fails,
show its error; never substitute a claimed sent/delivered status. No fallback is
permission to modify shared data or send email.

## Two-minute judge Q&A

Keep each answer around ten seconds, then invite a focused follow-up.

| Question | Defensible answer |
| --- | --- |
| Why not use an existing CRM? | “We focused on CIC's spreadsheet-to-board workflow: reviewed imports, ownership, next steps, retention and funder evidence. CIC should compare long-term maintenance cost with an established CRM before adoption.” |
| How is donor information protected? | “Mandatory MFA, secure server sessions, CSRF protection and server-side roles and donor-assignment checks. Keys stay server-side. These controls are tested; we are not claiming a compliance certification.” |
| Can a board member access another owner's donor? | “No. We tested both the hidden list entry and direct profile/API requests. An unrelated board account received 403.” |
| What happens on repeated Zeffy upload? | “The same source and transaction IDs reuse the original gifts. Our exact-file Chrome reimport added zero and left giving at two thousand one hundred thirty dollars. Conflicting data is rejected.” |
| How do merges work? | “A server preview identifies the records and impact. A human confirms identity and scope. One transaction archives the alternate, transfers related records and preserves original attribution in the audit.” |
| Can email go out without approval? | “Donor messages require approval of the current exact revision and recipient, valid consent and delivery gates. Preparing drafts sends nothing. Internal board reminders require their own approved template/policy and activation.” |
| Does this replace Zeffy or Benevity? | “No. They remain giving/import sources. ColorLoop consolidates donor relationships and reporting; it does not process payments.” |
| What is working and what is next? | “Imports, reviewed merges, assignments, profiles, follow-ups, approved outreach, radar and reporting work in isolated end-to-end tests. Production email/scheduling configuration and broader provider certification remain. Other P1 integrations are not built.” |
| How can CIC maintain it? | “The code, setup, migrations, reporting contracts and operations guides are in one MIT-licensed repository. CIC needs ownership of hosting/database/provider accounts, backups and a maintainer to review releases and permissions.” |

## Validation and remaining release steps

- Complete suite after fix: **202 passed, 0 failed, 1 skipped** (203 tests).
  The skipped test requires explicit live-Neon opt-in. Before this fix the preserved
  audit was 200/0/1. Focused import checks: 13/13 passed.
- Final Chrome rehearsal: real original-file upload, empty PGlite, genuine TOTP,
  all seven pages, merge/reimport, note/task/timeline, approval, radar, quarterly
  preparation, funder PDF and board isolation passed; zero browser exceptions and
  zero provider requests. No SQL donor/gift inserts replaced UI actions.
- Static build: 17 allowlisted public files. Fresh isolated Vercel build:
  five Node 22 functions, 43 verified route rewrites, packaged XLSX/TOTP/QR/OpenAPI
  execution and protected/default-off cron checks passed; no private environment
  or server static assets were bundled. No deployment ran.
- Existing HTTPS integration smoke passed after the fix with isolated SQL and no
  provider. A scan of 195 source/build files found zero configured credential
  values; no private environment file is tracked. Protected environment files,
  the two local CSVs and the user's `.gitignore` matched their starting hashes.
- The previous audit's 19-view Lighthouse scores of 100 and 75 responsive/keyboard
  checks remain prior evidence. This change does not alter frontend behavior/style;
  those broad audits were not repeated unnecessarily.
- README links: nine public links returned 200; three Slack links returned 403
  without authentication and require a signed-in operator check. Relative links
  and Markdown/diff checks are verified after this document is created.
- README contains overview, features/limits, security, verified stack, live link,
  video placeholder, setup, test scopes, supplied proposed team roles and handoff.
  Its final diff is available with `git diff -- README.md`.
- New work: `lib/import-data.js`, `tests/organization-import.test.js`,
  `scripts/rehearse-final-demo.mjs`, this document and README. Earlier audit/copy
  edits remain preserved. No files staged, committed, pushed, merged or deployed.

Before a production recording: approve/review the local fix and release separately,
rebuild the linked Vercel project rather than deploying stale root output, and
rehearse the real authenticated Dream account privately. Do not run the local
reset-to-empty fixture against shared Neon. No migration is needed for this fix.
Production real email remains unverified/unconfigured in the inspected variable
listing; leave transport/automation off and omit delivery from this demo.

Submission blockers: team-role confirmation; final video URL/story and dashboard
Submit; approved release of the reimport fix if demonstrating that path on the
hosted site; and the unmet same-site safe empty-reset requirement. No secret,
production-reset, email-send, commit, push or deployment approval is implied here.
