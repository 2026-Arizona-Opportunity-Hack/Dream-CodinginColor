# ColorLoop frontend and reports integration

> Integration update: see [INTEGRATION.md](INTEGRATION.md) for current persistence,
> shared API mappings, synthetic HTTPS demo and deployment gates. Branch-specific
> status and proposed interfaces below describe the original teammate handoff.

## Status and proposed PR split

All code remains in this repository on `feature/frontend`. Proposed review units:
1. CIC shell, login, donors, import preview, follow-ups and outreach.
2. Retention calculations, authenticated reports, funder printing and aggregate API.
3. Customization, local runner and deployment documentation.

The browser uses real `fetch` calls with same-origin session cookies. There is no
mock adapter, fake donor data, or browser reporting key. The shared database,
authentication, workflow and import implementations are **absent in this checkout**.
Until integrated, screens display errors, and report handlers fail closed with 503.
This is an integration implementation, not a completed deployed donor platform.
The suggested GitHub issue titles match the three review units above; no issues or
PRs have been published from this session.

## Shared module contract to reconcile with teammates

- `lib/db.js` exports `sql`, a Neon-compatible parameterized tagged-template
  query function returning an array of rows. No browser imports this module.
- `lib/auth.js` exports `requirePermission(req, res, permission)`, returning an
  authenticated principal on success, and throwing with status 401/403 or sending
  an error response on denial. A falsy result is denied. Permissions:
  `reports:read` and `reports:funder`. Ensure permissions restrict organizational
  scope in this single-nonprofit deployment. Backend mutation endpoints must also
  enforce authorization, input validation and same-origin/CSRF checks.
- Reporting expects **views supplied by the database owner**. These are integration
  contracts, not claims about an existing schema. Reconcile names before deploying:

| View | Columns |
| --- | --- |
| `reporting_gifts` | `donor_id`, `donated_at` (date), `amount_cents` (integer), `program` (text), `board_member_id` (ID) |
| `reporting_activities` | `occurred_at`, `program`, `board_member_id` |
| `reporting_donors` | `id`, `name` |
| `reporting_outcomes` | `donor_id`, `description`, `verified_at`, `evidence_reference`, `period_start`, `period_end`, `program`, `board_member_id` |

Views must expose canonical merged donor IDs, deduplicated settled positive USD
contributions, and consistent program/board attribution. Exclude voided, refunded,
zero and non-USD transactions (or reconcile net amounts in the view). Never count
archived aliases as additional donors. Outcomes must link the funder to the funded
program with genuine verification evidence, not automatically inferred impact.
A verified outcome must fall wholly inside the selected reporting period; larger
outcome periods are deliberately excluded rather than prorated without evidence.
Reporting retrieves available history through the selected end date. For larger
datasets, move the same tested classifications to database aggregate queries.

## Browser endpoints and payloads

All responses use `{ "data": ... }` or
`{ "error": { "code": "...", "message": "..." } }`. Collections may be arrays
or `{items:[...]}`. Current UI expects complete collections; paginated APIs must
be integrated before claiming complete histories on large datasets. Date values
use ISO format, money uses USD decimal amounts except reporting views (cents).
IDs are opaque strings. This table specifies the frontend adapter expectations;
endpoints beyond the supplied shared contract require teammate agreement.

| Endpoint | Use / payload |
| --- | --- |
| `POST /api/auth/login` | `{email,password}`; set secure HttpOnly same-origin session cookie |
| `GET /api/auth/me` | `{name,email,role,permissions}` |
| `GET/POST /api/donors` | Query `search`; create `{name,email}`; rows `{id,name,email,board_member_name,total_donated}` |
| `GET/PATCH /api/donors/:id` | Donor details; update `{name,email,custom_fields}` or `{archived:true}` |
| `GET/POST /api/donors/:id/donations` | Entire history `{donated_at,source,amount}`; create `{amount,donated_at,source}` |
| `GET/POST /api/activities` | Query `donorId`; create `{donor_id,note}`; rows `{created_at,note}` |
| `POST /api/imports/preview` | Multipart `{file,source}` returns `{importId,columns}`; JSON `{importId,mapping}` returns `{importId,newTransactions,duplicates,errors,rows}` |
| `POST /api/imports/confirm` | `{importId}`; server binds preview to current user and enforces validation/idempotency |
| `GET /api/merges/candidates` | Candidate donor rows `{id,name}` |
| `POST /api/merges/preview` | `{sourceId,targetId}`; return human-readable affected record counts/conflicts |
| `POST /api/merges` | `{sourceId,targetId,confirmed:true}`; server atomically validates and merges |
| `GET/POST /api/tasks`, `PATCH /api/tasks/:id` | `{title,donor_id,due_date,assignee_id,status}`; statuses `open`/`completed` |
| `GET/POST/PATCH /api/board-members[/:id]` | `{id,name,email,role}`; administrator authorization required |
| `GET /api/retention/at-risk` | `{name,last_gift_date,next_action}` records |
| `GET/POST /api/outreach/drafts` | List drafts or create `{type:'quarterly_board_summary'}` |
| `PATCH /api/outreach/drafts/:id` | `{subject,body}`; server invalidates approval on edit |
| `POST /api/outreach/drafts/:id/approve` | Approve saved draft; permission checked on server |
| `POST /api/outreach/drafts/:id/send` | Send approved saved version; server enforces approval and prevents duplicate sends |
| `GET /api/outreach/history` | `{subject,sent_at,status}` records |
| `GET/POST /api/custom-fields`, `PATCH /api/custom-fields/:id` | `{id,label,type,options,hidden,active}`; types text/number/date/checkbox/dropdown; donor values keyed by field ID |
| `GET/POST /api/campaigns`, `PATCH /api/campaigns/:id` | `{id,name,archived}` |
| `GET /api/roles`, `PATCH /api/roles/:name` | `{name,permissions:[]}`; server prevents privilege escalation |
| `GET/PATCH /api/settings/outreach` | `{follow_up_days,thank_you_template,follow_up_template}` |

Settings re-fetch after mutations and reload; nothing is persisted to browser
storage. Server permission failures are shown to the user. Creating a note and
updating a task are separate operations; backend integration should provide a
transactional workflow if atomicity is required. Do not paste real donor records
into issues, screenshots or fixtures.

## Reporting routes

`GET /api/reports/retention?from=2026-01-01&to=2026-06-30` uses session permission
`reports:read`. Optional `program` and `boardMember` filters apply to both periods
and historical reactivation checks. The compared dates shift back one calendar
year; February 29 clamps to February 28. Select one calendar year at a time.

- Returning: positive gifts in both matched windows.
- New: a gift in the current window and no earlier recorded gift in that scope.
- Reactivated: a current gift, an earlier gift, and none in the prior matched window.
- Increased/decreased/unchanged: compare summed cents for returning donors.
- Lapsed: prior-window donors with no current-window gift. Churn is lapsed / prior
  donors; retention is returning / prior donors. Both rates are null when the
  prior window has no donors. Partial-period lapses remain provisional.
- Missing historical imports limit these classifications; no missing gifts or
  impact metrics are fabricated. Empty data returns zero totals and null rates.

The response includes dates, currency, counts, rates, monthly giving,
`byProgram` and `byBoardMember` groups. These session reports may contain internal
board IDs; they are distinct from the limited machine endpoint below.

`GET /api/reports/funder?donorId=...&from=...&to=...` requires
`reports:funder`. Returns `{name,from,to,currency,gifts:[{donated_at,amount,program}],
outcomes:[{description,verified_at,evidence_reference}]}` plus filter metadata.
The Reports screen prepares an HTML report and opens the browser print flow via
**Print funder report / Save as PDF**. Select Save as PDF in the print dialog.
This is a printable export, not a server-generated PDF attachment. Empty verified
outcomes are explicitly stated and no impact claims are invented.

## Machine metrics API

Set `REPORTING_API_KEY` only in server environment settings. Never put it in
HTML, browser JavaScript, a URL query, or a public-prefixed environment variable.
Consumers call:

```http
GET /api/v1/metrics?from=2026-01-01&to=2026-06-30&program=STEM&boardMember=board-1
Authorization: Bearer <server-managed-reporting-key>
```

```json
{"data":{"from":"2026-01-01","to":"2026-06-30","program":"STEM","boardMember":"board-1","currency":"USD","donorTotal":12,"giftTotal":4200,"giftCount":18,"activityCount":7}}
```

Numbers above illustrate the response shape only. All fields are an explicit
allowlist; no donor names, emails, donor IDs or gift rows are returned. The key
uses a constant-time comparison of SHA-256 digests. Missing/wrong keys return
401; missing configuration returns 503; invalid dates/filters return 400; non-GET
requests return 405. All report responses use `Cache-Control: no-store`.
Rotate the key in Vercel environment settings and update authorized consumers.
Use Vercel firewall/rate limits to control aggregate endpoint usage.
