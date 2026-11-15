# Mentor backend handoff — Laptop 1

Integration update: both mentor branches are combined on `integration/mentor-final`.
See [final integration results](MENTOR-FINAL-INTEGRATION.md) for current validation.
The branch-specific history below is retained for reference.

This backend work starts at approved `main` commit `adeac28` and belongs to
`feature/mentor-backend`. Frontend HTML, CSS, navigation and browser modules are
unchanged. No mentor PDF was available in the repository or supplied attachments;
the supplied backend requirements are the implementation scope.

## Integration priorities

1. Use the existing donor detail, activity, task, outreach, report and import APIs
   below. Preserve the grouped campaign approval and searchable donor selector.
2. Connect manual donor/gift forms to the enhanced existing POST endpoints. Generate
   one stable idempotency key per intended save and reuse it for network retries.
3. **Replace the browser's local merge preview with `POST /api/merges/preview`.**
   Show both identities, affected counts, warnings and blockers. Confirm only after
   independent identity verification, sending the returned `preview_id` and both
   confirmation booleans. A local comparison alone no longer authorizes a merge.
4. Use the paginated read endpoints for Today, follow-up summaries, campaign totals
   and import history. Handle 401 by returning to sign-in and 403 `MFA_REQUIRED`
   through the existing second-factor workflow.

The backend intentionally blocks unsafe old merge requests. Until Laptop 1 wires
the server preview, that UI cannot complete merges. Existing deliberate duplicate
creation also needs the new explicit distinct-record decision; ordinary saves are
compatible. Do not work around either safeguard in the browser.

## Shared transport and security

All paths below start at `/api`. Responses are `{ "data": ... }`, except the raw
OpenAPI document. Errors are `{ "error": { "code": "...", "message": "..." } }`.
Use the existing `__Host-colorloop` Secure/HttpOnly cookie with mandatory verified
MFA. JSON mutations also require exact same-origin `Origin` and the existing
`X-CSRF-Token`. No bearer token grants donor-level access.

400 means invalid/unknown input; 401 means no valid session; 403 means MFA,
permission, ownership or CSRF denial; 404 means missing/inaccessible record;
409 means conflicting or stale data; 429 means a rate limit; 500/503 are safe
server/storage errors. Reload and review conflicts rather than blindly retrying.
New write services recheck current account/role permission inside the transaction.
Board-scoped accounts cannot create directory donors, merge, manage aliases or
view import history, even if a custom role accidentally grants those permissions.
Board gift/history/task/outreach reads and writes remain limited to assigned donors.

## Existing functionality reused

| Workflow | Contract | Authorization / important fields |
| --- | --- | --- |
| Find donors | `GET /donors?q=...&limit=25&offset=0` | `donors.read`; name/company/email search; active assigned scope; array of `id, display_name, normalized_email, company, board_member_name, verified_usd_total` |
| Details | `GET /donors/{id}` | `donors.read`; full stored contact/custom/consent fields |
| Edit/archive donor | `PATCH /donors/{id}` | `donors.write`; existing donor fields; merged identities cannot be edited |
| Giving history | `GET /donors/{id}/donations?limit=25&offset=0` | `donors.read`; array of original gift records |
| Activity/history | `GET /activities?donorId={id}&history=true` | `donors.read`; camelCase DTOs, edit history retained |
| Add activity | `POST /activities` | `activities.write`; `donorId,type,content`, optional `occurredAt,program` |
| Edit activity | `PATCH /activities` | `activities.edit`; `id,type,content`, optional `occurredAt,program`; original version preserved |
| Follow-ups | `GET /tasks?donorId={id}` | `donors.read`; optional `assigneeId,view`; camelCase task DTOs |
| Create follow-up | `POST /tasks` | `tasks.manage`; `donorId,assigneeId,nextAction,dueAt`, optional `description`; use authenticated user's actual ID for Assign to me |
| Edit follow-up | `PATCH /tasks` | `tasks.manage`; `id` plus changed fields/status |
| Eligible board roster | `GET /assignments/members` | `donors.read`; real active board accounts; administrator can see inactive entries |
| Assign owner | `POST /assignments` | `assignments.manage`; existing `donorId,assigneeId`; staff/ownership rules remain enforced |
| Donor drafts | `GET /outreach/drafts?donorId={id}` | `donors.read`; optional `audience,status`; current revision, recipient metadata and verified linked gift |
| Create draft | `POST /outreach/drafts` | `outreach.write`; `donorId,templateId`, optional `donationId` |
| Edit draft | `PATCH /outreach/drafts` | `outreach.write`; `id,revision` plus `subject/body`; invalidates approval |
| Approve/handoff | `POST /outreach/approve`, `POST /outreach/handoff` | `outreach.approve` / `outreach.send`; `id,revision`; consent and current revision checked |
| Delivery history | `GET /outreach/history?donorId={id}` | `donors.read`; handoff is not sent; manual send requires separate human evidence |
| Import preview/confirm | `POST /imports/preview`, `POST /imports/confirm` | `imports.manage`; existing upload/mapping and `{batch_id,decisions}` contracts unchanged |
| Import presets | `GET/POST /imports/presets` | `imports.manage`; built-in Zeffy/Benevity and stored custom mappings unchanged |
| Retention | `GET /reports/retention?from=2026-01-01&to=2026-11-15` | `reports.read`; optional `program,boardMember`; matched comparison windows, no invented prior donors |
| Funder evidence | `GET /reports/funder?donorId={id}&fullHistory=true` | `reports.read`; verified giving/outcomes only; respects owner scope |
| Aggregate integration | `GET /v1/metrics?from=2026-01-01&to=2026-11-15` | Existing server-only `REPORTING_API_KEY` bearer credential; no names/emails/gift rows/donor IDs |

Legacy activities/tasks/drafts arrays retain their existing contracts and are not
paginated. Use the new bounded follow-up export for bulk readers. There is no new
general-purpose API-key management system or distributed read rate limiter.

## Manual donor creation

`POST /donors` (`donors.write`, staff directory permission) returns 201 with the
stored donor, `note_activity_id` (nullable) and `replayed` boolean. Only
`display_name` is newly required when using the default `donor_type: person`.
Email, phone, first/last names and company are optional. Existing configured
required custom fields still apply.

```json
{
  "display_name": "Synthetic Alex Example",
  "first_name": "Synthetic Alex",
  "last_name": "Example",
  "normalized_email": "alex@example.test",
  "company": "Synthetic Community Group",
  "email_consent": false,
  "sms_consent": false,
  "opted_out": false,
  "custom_data": {},
  "notes": "Synthetic introduction recorded at the demo.",
  "idempotency_key": "demo-donor-save-0001"
}
```

Other existing donor fields: `donor_type` (`person/organization`), `secondary_email`,
`phone`, `archived`. An optional `owner_id` must be an existing active board
member and also requires `assignments.manage`. Omission uses the existing balanced
assignment logic. Notes become real donor activities, never a hidden UI-only field.

409 `DUPLICATE_DONOR` requires human review. Search donors/details to compare;
do not automatically retry with an override. Only a deliberately distinct identity
may use `allow_duplicate:true` with `duplicate_reason` of 3–500 characters.
No automatic merge occurs. Similar names are candidates, never identity proof.

Idempotency keys are 8–100 ASCII letters/digits/underscore/hyphen. Keys and request
payload fingerprints are hashed in existing audit receipts. Same actor/key/input
replays the stored result, including its canonical donor if later merged. Changed
input with the same key returns 409 `IDEMPOTENCY_CONFLICT`.

## Manual cash/check/offline gift

`POST /donations` (`donations.write`, assigned scope when applicable) returns 201:

```json
{
  "donor_id": "50000000-0000-4000-8000-000000000001",
  "amount": "25.00",
  "currency": "USD",
  "status": "completed",
  "donation_date": "2026-11-15",
  "source": "check",
  "external_transaction_id": "SYNTHETIC-CHECK-001",
  "program": "Synthetic AI Workshop",
  "notes": "Synthetic offline gift; no bank or card details.",
  "idempotency_key": "demo-gift-save-0001"
}
```

The response is `{data:{donation:{...storedGift},duplicate:false,note_activity_id:...}}`.
Supported optional fields include `campaign_id` and `external_transaction_id`.
`source` is required; use a consistent label such as `cash`, `check`, or `offline`.
Positive amounts allow at most two decimal places; dates must be real YYYY-MM-DD.
Missing currency/status stays unknown and outside verified totals/thank-you drafts.
No currency conversion or invented payment completion occurs. Send `USD/completed`
only after verification. Archived donors and archived/nonexistent campaigns fail.

Same idempotency key/input returns the same gift and `duplicate:true`. Stable
source/transaction IDs also remain globally unique; conflicting gift data returns
409 `TRANSACTION_CONFLICT`. Without a transaction ID, same donor/amount/date/currency
returns 409 `POSSIBLE_DUPLICATE_GIFT`; a deliberately separate gift requires
`allow_duplicate:true` and a meaningful `duplicate_reason`.

Gift notes are stored in a donor activity with gift amount/currency/date context;
the receipt returns its exact activity ID. The existing donation schema has no
notes column. A retry cannot append duplicate notes or prepare a second thank-you.
Changed notes on an existing transaction must use the activity API, not recreate
the gift. Card/bank-detail fields are not accepted. Verified gifts prepare drafts
inside the transaction; nothing is sent.

## Duplicate comparison, merge and aliases

`GET /merges/candidates?q=...&limit=25&offset=0` requires staff `donors.write`.
Pairs have `donor_id,display_name,normalized_email,company,candidate_id,
candidate_name,candidate_email,candidate_company,reason`. Search filters names and
emails; candidates arise from shared email, exact case-insensitive name, or shared
normalized phone (at least seven digits). A name-only reason explicitly warns that
identity is unproven. Different names/emails can also be compared using chosen IDs.

First send `POST /merges/preview`:

```json
{
  "canonical_donor_id": "50000000-0000-4000-8000-000000000001",
  "merged_donor_id": "50000000-0000-4000-8000-000000000002",
  "reason": "Synthetic identity independently verified from source records"
}
```

Response: `preview_id,expires_at,canonical,source,affected,blockers,warnings`.
Identity objects include name, emails, phone, company, custom values, owner and
contact preferences. `affected` counts source gifts, live work, imports, outcomes,
aliases and message histories. Warnings describe canonical-field/ownership
precedence and conservative combined consent. Show all blockers before approval.
Preview is actor/direction/reason-bound, expires after ten minutes, and is limited
to 30 per actor per 15 minutes using the existing audit store.

Then send the exact same identities/reason to `POST /merges`, adding:

```json
{
  "preview_id": "50000000-0000-4000-8000-000000000003",
  "confirmed": true,
  "identity_confirmed": true
}
```

The example above contains only the **additional** fields. The complete request
must include the two donor IDs and reason from the preview. The authenticated
staff member must affirm independent identity evidence; matching names alone do
not meet that requirement.

Confirmation rechecks a full donor-graph fingerprint and uses the shared writer
transaction lock plus ordered donor row locks. Changes to gifts, activities,
history, tasks, ownership, imports, aliases, evidence or outreach invalidate it.
409 codes include `MERGE_PREVIEW_REQUIRED`, `INVALID_MERGE_PREVIEW`,
`STALE_MERGE_PREVIEW`, `MERGE_PREVIEW_CONSUMED`, `MERGE_CONFIRMATION_REQUIRED`.
A fresh preview and human review is required after stale/expired data.

Merges block on `MERGE_AMBIGUOUS_GIFTS` (same amount/date/currency without stable
transaction IDs), `MERGE_EVENT_CONFLICT` (colliding scheduled work), or
`MERGE_OUTREACH_IN_FLIGHT` (sending/unknown delivery). No override silently drops
records. Review source evidence and resolve through supported workflows first.

Successful result: `canonical_donor_id,merged_donor_id,donations_moved,
outcomes_moved,drafts_requiring_review,history_id,preview_id`. Donation UUIDs,
amounts and transaction/source IDs remain unchanged. Activities, tasks, outreach,
retention events, import row references and verified outcomes follow the canonical
donor. Lapse/cycle/quarterly deduplication keys are updated transactionally.
Source assignment history and activity edit history retain original attribution;
source identity is archived, never deleted. Canonical contact/custom fields win.
Canonical ownership wins, or an eligible source owner transfers if canonical has
none. The audit preserves original donor, evidence and outreach attribution.
Moved unsent approved/handoff/failed messages return to draft with a new revision
and need fresh approval; immutable approval/delivery histories and sent status stay.
Any error rolls back the entire merge and leaves its preview unused.

Optional confirmed source alias: `POST /donors/{canonicalId}/aliases`, staff
`donors.write`, body `{source,source_identifier,original_name,reason,confirmed:true}`.
Use an actual stable provider donor ID, never a guess based on a name. Existing
source-ID mapping to another donor returns 409 `SOURCE_CONFLICT`. Same mapping
is idempotent. Import matching trusts the confirmed source ID, while transaction
uniqueness remains unchanged. Name aliases alone continue to require review.

## New read-only contracts and OpenAPI

All new data GETs run a repeatable-read, read-only transaction. Pagination defaults
to 25; `limit` is 1–100 and `offset` 0–100000. Envelopes use
`{items:[...],limit,offset,has_more}`. Writes return 405. Reads do not create audit
rows or prepare messages. Session/MFA/RBAC still apply to every protected route.

| GET endpoint | Permission | Response / filters |
| --- | --- | --- |
| `/v1/follow-ups` | `donors.read` | Page of `id,donor_id,donor_name,next_action,due_at,status,assignee_id,assignee_name`; optional `donor_id,status`; assigned scope |
| `/v1/campaign-summaries` | `donors.read` | Page of `id,name,verified_usd_gift_count,verified_usd_total`; completed USD only; board sees assigned donor giving |
| `/v1/overview?on=2026-11-15&time_zone=America/Phoenix` | `donors.read` | `on,time_zone,counts:{overdue,due_today,pending_drafts,unassigned_donors},tasks:{items,limit,offset,has_more}`; timezone Phoenix (default) or UTC; caller must supply explicit local day |
| `/imports/history` | Staff `imports.manage` | Page of batch metadata `id,filename,source,status,validation_counts,created_at,confirmed_at`; own batches, administrator all |
| `/imports/{batchId}` | Staff `imports.manage` | `{batch,rows:{items,limit,offset,has_more}}`; row fields `row_number,result,error_details,donor_id,donation_id`; own/admin only, no raw normalized upload |
| `/v1/openapi` | Public schema only | Raw OpenAPI 3.1.1 document; no credentials or runtime donor data |

The [OpenAPI document](openapi-readonly.json) also documents existing paginated
donors/gifts/campaigns, retention/funder reports and machine aggregate metrics.
Amounts retain their actual route-specific number/string representation. See
[dashboard integration](DASHBOARD-API.md) for the existing server bearer endpoint.
Do not embed that key in browser JavaScript.

Validation uses the official OAS 3.1 schema and JSON Schema draft 2020-12. Ajv
8.17.1 was installed only in an approved temporary directory, not app dependencies.
Ajv does not support the official schema's nested dynamic anchor: the validator
asserts the single local anchor's exact object-or-boolean rule, resolves its local
references statically, and separately validates every Schema Object. It rejects
other anchor profiles. Negative checks reject invalid parameter locations and
invalid schema types. See `scripts/validate-openapi.mjs` and
[Ajv's documented limitation](https://ajv.js.org/guide/combining-schemas.html).

```bash
OPENAPI_SCHEMA_PATH=/tmp/colorloop-openapi-3.1-schema.json \
AJV_MODULE_PATH=/tmp/colorloop-openapi-tools/node_modules/ajv/dist/2020.js \
node scripts/validate-openapi.mjs
```

Download the schema from `https://spec.openapis.org/oas/3.1/schema/2022-10-07`
and install pinned `ajv@8.17.1` outside the repository if reproducing this check.
The script fails if those explicit validation inputs are absent.

## Assignment, imports, reports and operational limits

The existing assignment policy is **least active donor workload**, with stable
account-ID tie breaking; it is balanced allocation, not a persistent cyclic cursor.
Zero active board members leaves a donor unassigned; one gets all new donors;
multiple receive balanced loads. Imported contact names still need ownership
review against genuine active board accounts, or explicit balanced assignment.
Manual donor creation uses the same policy. No historical accounts are invented.

Zeffy/Benevity parsing, presets, campaign approvals/row exceptions, unknown-payment
review and transaction idempotency remain unchanged. Existing transaction matches
can correctly have `possible_duplicate_gift:false`: that flag is the heuristic for
gifts **without** transaction IDs, while stable IDs are deduplicated separately.
Tests cover reimport after merge and a confirmed provider alias with changed
name/email; totals do not increase on retries.

Reports use verified completed USD gifts only, current ownership for board
attribution, and existing explicit program values. Missing prior-year data stays
unknown. Verified evidence transfers with original attribution in merge history;
neither manual gifts nor merges invent impact outcomes. Draft/handoff status is
not evidence of delivery. No provider or real email/text was used.

No new schema migration, dependency, environment variable or MFA configuration
change is needed. Existing migrations 001–007 provide all required tables.
Audit receipts provide durable manual idempotency and merge preview storage.
All new record-writing tests use disposable PGlite PostgreSQL; live Neon tests
remain skipped. PGlite serializes local transactions, so actual shared-Neon load
and PostgreSQL lock contention remain external verification, not a claimed result.
No global distributed read limiter was added; use a hosting ingress policy if bulk
external export requires one. Existing login/MFA limits remain intact.

The five-function Vercel dispatcher and static allowlist are preserved. The JSON
spec is bundled server-side, not copied with server files into `dist/public`.
Existing MFA key rotation remains approval-gated; this work neither rotates the
key nor changes any enrollment, private config or shared database record.

## Verified on this branch

| Check | Result |
| --- | --- |
| `RUN_NEON_TESTS=false npm test` | 158 passed, 0 failed, 2 live read-only Neon tests skipped (the pre-existing duplicate test file discovers the opt-in check twice) |
| New mentor regressions | Manual entry/retries/notes, zero/one/multiple board roster, reviewed ownership, merge rollback/staleness/concurrent attempts, graph/evidence preservation, aliases/reimport, scheduled-key collision/rewrite, MFA/CSRF/RBAC and read-only privacy |
| `node scripts/smoke-integration.mjs` | Passed against isolated SQL and real HTTPS; no live database/provider |
| `node scripts/smoke-browser.mjs` | Passed seven screens, real TOTP/cookie/session lifecycle, five synthetic gifts totaling $2,600, grouped campaign review, searchable donor/follow-up, reports; zero browser exceptions |
| OpenAPI validator | 13 paths and 175 Schema Objects validated; both negative checks passed |
| Local Vercel build + `node scripts/verify-vercel-build.mjs` | Five Node 22 functions, 41 routes verified; packaged XLSX/TOTP/QR/OpenAPI executed, protected read route rejects anonymous access, no private static assets |
| `npm audit --json` | Zero vulnerabilities; no project dependency changes |
| Protected-file checks | All 32 pre-existing untracked files and `.env` unchanged; no frontend source changes |

The prior Lighthouse 100 result was not remeasured for this backend-only change.
Hosted Vercel behavior, shared-Neon concurrency and Laptop 1's new frontend wiring
are not covered by these local results. No shared database connection, migration,
MFA rotation, real message, main merge or deployment was performed.
