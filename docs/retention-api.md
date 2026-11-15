# ColorLoop retention API and teammate handoff

> Current requirements-branch behavior and deployment gates: [CIC-REQUIREMENTS.md](CIC-REQUIREMENTS.md), [DASHBOARD-API.md](DASHBOARD-API.md), and [DEPLOYMENT-READINESS.md](DEPLOYMENT-READINESS.md). Status/counts below may describe earlier teammate branches.

> Integration update: see [INTEGRATION.md](INTEGRATION.md) for current persistence,
> shared API mappings, synthetic HTTPS demo and deployment gates. Branch-specific
> status and proposed interfaces below describe the original teammate handoff.

Status: executable mock-backed handlers and services on `feature/retention`.
No database schema, `lib/db.js`, frontend, deployment, or delivery credentials
were available in this checkout. These modules do not create production tables.
Production/Vercel requests fail with `503 STORAGE_UNAVAILABLE` until a durable
adapter replaces the default store. No donor messages are sent by default.

## Run and configuration

Use Node.js 22+ and run `npm test`. Tests invoke the actual handlers with synthetic
requests and isolated memory stores; they need no database, packages, or secrets.
No Vercel CLI, development server, or package-script changes are required.

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin, e.g. `https://colorloop.example`; required for writes. No trailing slash. |
| `COLORLOOP_STORE=mock` | Explicitly enable one process's ephemeral local store. Rejected on Vercel or when `NODE_ENV=production`. |
| `DATABASE_URL` | Pending Teammate 1 integration; retention code does not consume it yet. Never expose it to the browser. |

Keep real values in the existing ignored `.env` or hosting environment. These
modules do not load `.env` automatically; a local harness can use Node's
`--env-file=.env`. There is no session signing secret: random opaque session
tokens are stored as SHA-256 hashes. No email/SMS provider variables are consumed
until a verified server-only provider adapter is supplied.

A safe proposed local HTTP approach is a team-owned Node `http`/`https` harness
mounting these handlers in one process. Browser authentication needs HTTPS
because cookies are always Secure. Coordinate this with Teammate 3 before adding
scripts. For now, tests exercise handlers without starting a server.

Bootstrap only through an operator's trusted Node process, using
`bootstrapAdministrator(store, {name, email, password})` from `lib/auth.js`.
It requires an empty account store; there is no public registration or default
password. The caller must use the same store instance as the handlers. Tests
show the complete bootstrap pattern. Do not put real passwords in shell history.
The persistent bootstrap mechanism and account recovery are still team decisions.

## Authentication and frontend contract

Every response is JSON: `{ "data": ... }` or
`{ "error": { "code": "...", "message": "..." } }`. All responses use
`Cache-Control: no-store`. Standard codes: 400 validation, 401 unauthenticated,
403 permission/CSRF/origin denial, 404 absent record, 405 unsupported method,
409 state/revision/consent conflict, 429 sign-in throttling, 502 unconfirmed
delivery, 503 unavailable storage/provider/origin configuration. Creates use 201.

```javascript
const response = await fetch('/api/auth/login', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: enteredEmail, password: enteredPassword }),
});
const result = await response.json();
if (!response.ok) throw new Error(result.error.message);
let csrfToken = result.data.csrfToken; // Keep in memory, never browser storage.

const created = await fetch('/api/tasks', {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ donorId: 'synthetic-donor', assigneeId: 'synthetic-member',
    nextAction: 'Review donor relationship', dueAt: '2026-11-20T18:00:00Z' }),
});
```

The browser supplies `Origin` automatically. All writes, including login, require
an exact `APP_ORIGIN` match. Authenticated writes also require `X-CSRF-Token`.
`GET /api/auth/me` restores the CSRF token after reload and returns current role
permissions. The `__Host-colorloop` cookie is Secure, HttpOnly, SameSite=Strict,
Path=/, and expires after eight hours. Logout revokes the server session. Never
put session tokens or CSRF tokens in localStorage/sessionStorage or logs.

Passwords use Node's scrypt (N=131072, r=8, p=1), random salts, and timing-safe
verification, following [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Unknown accounts receive a dummy hash verification. At most five sign-in attempts
per account and 25 per socket address are allowed per rolling 15 minutes, counted
before hashing. Configure trusted proxy IP handling and shared rate limiting
with the production adapter; arbitrary forwarded headers are deliberately ignored.
Session/CSRF choices follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Reusable middleware for Teammate 1:

```javascript
import { requirePermission } from './lib/permissions.js'; // Adjust relative path.
const user = await requirePermission(req, res, 'donors.read');
if (!user) return; // Already sent 401/403, or 503 if persistence is unavailable.
```

Permission vocabulary: `donors.read`, `donors.write`, `donations.write`,
`imports.manage`, `assignments.manage`, `activities.write`, `activities.edit`,
`tasks.manage`, `outreach.write`, `outreach.approve`, `outreach.send`,
`reports.read`, `settings.manage`, `users.manage`, `roles.manage`.
All are granted to the bootstrap administrator. The board-member default grants
only `donors.read`, `activities.write`, `tasks.manage`, and `outreach.write`.
These permissions currently apply across donors; assignment-based access scope
has not been requested or implemented. Setting/role/user administration also
requires the built-in administrator role. An administrator cannot modify their
own role permissions, role, activation, or board status. The built-in admin role
therefore remains fixed while other roles are configurable. User updates revoke
all their sessions; role permission changes apply on the next request.

## Routes and input

Bodies are strict JSON objects, limited to 32 KiB; unknown fields are rejected.
IDs are strings of letters, numbers, underscores, or hyphens, up to 100 characters.
Dates are valid `YYYY-MM-DD` (UTC midnight) or UTC ISO timestamps with seconds.
Provide full timestamps for precise task deadlines. Text is plain text; frontend
code must render user/donor/template content with `textContent`, not `innerHTML`.

| Route | Methods / input | Permission |
| --- | --- | --- |
| `/api/auth/login` | POST `{email,password}` | Public + same origin |
| `/api/auth/logout` | POST `{}` | Signed in |
| `/api/auth/me` | GET | Signed in |
| `/api/users` | GET; POST `{name,email,password,roleId,active?,boardMember?}`; PATCH `{id,...changedFields}` | `users.manage` + admin |
| `/api/roles` | GET; POST `{name,permissions:[]}`; PATCH `{id,name,permissions:[]}` | `roles.manage` + admin |
| `/api/assignments` | GET `?donorId=&assigneeId=&history=true`; POST `{donorId,assigneeId?}` | Read: `donors.read`; write: `assignments.manage` |
| `/api/activities` | GET `?donorId=&history=true`; POST `{donorId,type,content,occurredAt?}`; PATCH `{id,type,content,occurredAt?}` | Read: `donors.read`; create: `activities.write`; edit: `activities.edit` |
| `/api/tasks` | GET `?donorId=&assigneeId=&view=overdue`; POST `{donorId,nextAction,dueAt,assigneeId,description?}`; PATCH `{id,nextAction?,dueAt?,assigneeId?,status?,description?}` | Read: `donors.read`; write: `tasks.manage` |
| `/api/outreach/drafts` | GET `?donorId=&status=&audience=`; POST `{donorId,templateId,donationId?}`; PATCH `{id,revision,subject?,body?}` | Read: `donors.read`; write: `outreach.write` |
| `/api/outreach/approve` | POST `{id,revision}` | `outreach.approve` |
| `/api/outreach/send` | POST `{id,revision}` | `outreach.send` |
| `/api/outreach/history` | GET `?donorId=&draftId=` | `donors.read` |
| `/api/retention/at-risk` | GET; POST `{donorId}` to persist suggestions | Read: `reports.read`; write: `tasks.manage` + `outreach.write` |
| `/api/retention/settings` | GET; PATCH `{inactivityMonths:12}` (1–120) | Read: `reports.read`; write: `settings.manage` + admin |
| `/api/outreach/templates` | GET; POST `{id?,name,channel,requiresDonation,subject,body}` to create/upsert | Read: `outreach.write`; write: `settings.manage` + admin |
| `/api/tasks/reminders` | POST `{kind:"quarterly"}` or `{kind:"overdue"}` | `tasks.manage` + `outreach.write` |

PATCH activities/drafts and the templates/reminders/radar POST routes extend the
requested contract to expose editing and generation. No scheduling service was
added; an authorized staff member triggers reminder generation, then reviews,
approves, and explicitly sends each draft. No automatic outbound messages exist.

Activities: `call`, `meeting`, `email`, `text`, `note`. The server records creator
and timestamps, and stores the previous version for edits. Donor ID is immutable.
Task statuses: `open`, `in_progress`, `completed`, `cancelled`; views: `overdue`,
`upcoming`, `completed`, `cancelled`. Only open/in-progress tasks can be overdue;
due exactly now is upcoming, and overdue means strictly earlier than now.

Default templates: `thank-you-email`, `thank-you-sms`, `quarterly-update`,
`follow-up`, `reconnection`. Placeholders: `{{donorName}}`,
`{{lastDonationDate}}`, `{{lastDonationAmount}}`. Donation values must come from a
verified completed donation for that donor. Generated content makes no claims
about student outcomes or funded results. Human-authored content still needs review.

Radar GET returns each donor's actual last completed donation, threshold date,
plain-language reason, observed donation intervals, separate overdue-task IDs,
proposed task and personalized draft, and existing nudge IDs. No scores are
generated. No donation history means no lapse inference; refunded, future, zero,
or invalid donations are excluded. Calendar-month deadlines clamp to month end.
The POST atomically creates one task/draft per donor + last-donation event, even
after a threshold change or task completion. It requires an active assigned board
member. Opted-out donors can be reviewed, but approval/sending is blocked.

Draft status flow: `draft → approved → sending → sent/failed`. Approval binds
the current revision; editing creates a revision and clears approval. A send
claim is atomic; concurrent requests cannot deliver the same revision twice.
Approval and sending both check current contact preferences, opt-outs, and active
recipients. Missing/false channel consent is a denial. No provider means 503
`DRAFT_MODE`, leaving the message approved and unsent with no fake send history.

Provider integration is injectable through `createHandler(route, {provider})`.
The trusted adapter implements `sendEmail({to,subject,text,idempotencyKey})` and/or
`sendSms(...)`, returning `{status:'sent',id:'provider-receipt'}` only after the
provider confirms acceptance. `sent` means provider acceptance, not inbox delivery.
Use provider-side idempotency with the supplied key. Errors are sanitized; an
ambiguous outcome locks the draft for operator reconciliation. A verified
pre-delivery rejection can throw with `definitelyNotSent=true`, allowing editing
and fresh approval. Process interruption during a send leaves `sending` for
reconciliation; never automatically retry it. A durable outbox/reconciliation
path is needed before enabling real sends. No real provider was configured/tested.

## Teammate 1: pending database contract

`lib/retention-store.js` defines **mock DTOs, not an agreed SQL schema**. These are
the fields used by the services; confirm mappings against your migrations and
`query()` before connecting anything:

| Collection | Required fields / relationships |
| --- | --- |
| `users`, `roles` | User id/name/email/passwordHash/roleId/active/boardMember; role id/name/permissions[] |
| `sessions`, `loginAttempts` | Token hash, user, expiry, CSRF secret/hash; hashed account/IP attempt keys + timestamps |
| `donors` | id, name, active, email/phone, optedOut, contactPreferences `{email:boolean,sms:boolean}` |
| `donations` | id, donorId, status=`completed`, amountCents (positive integer hundredths), currency (uppercase 3-letter), donatedAt |
| `assignments` | id, donorId, assigneeId, active, assignedAt/By, optional endedAt |
| `activities`, `activityHistory` | Current record with donor/creator/time/content; immutable prior versions |
| `tasks` | Donor/assignee, nextAction, dueAt, status, description, timestamps, optional unique eventKey |
| `templates`, `drafts` | Templates + rendered revision, approval metadata, recipient relationship, status, optional unique eventKey |
| `sendHistory` | Immutable claim/outcome events including approved content snapshot and provider receipt |
| `settings`, `events`, `audit` | Inactivity months; nudge/settings events; sensitive action metadata without passwords/keys |

The mock store offers `read(select)` and `transaction(change)` with isolated
snapshots, rollback, and serialized mutations **in one process only**. Do not run
it across Vercel instances or store real donor data in it. Replace/adapt service
operations to real SQL transactions after the schema is agreed; do not persist
the whole mock state as a substitute for normalized tables. No migrations or
Teammate 1-owned files were changed.

Required SQL guarantees: unique normalized account emails and token hashes;
foreign keys; one active assignment per donor; a shared lock around member-load
selection and donor assignment; unique task/draft/event keys; atomic approved-to-
sending compare-and-set; durable rate-limit reservations; transaction rollback
and append-only audit/history. Imports must preserve ownership and call
`assignInTransaction` (or its SQL equivalent) in their donor-upsert transaction.
Existing ownership is preserved even when its board member later becomes inactive;
manual reassignment remains available. New assignments exclude inactive members.

Before deployment: implement the adapter and operator bootstrap, choose account
recovery, reconcile the permission/DTO names with the frontend and imports,
confirm Vercel routing/function limits, and supply a shared throttle plus outbox
if real delivery is enabled. Authentication middleware is ready for integration;
no Slack/team messages have been sent from this session.
