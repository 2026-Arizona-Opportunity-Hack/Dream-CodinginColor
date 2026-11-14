# ColorLoop database handoff

Status: implemented locally on `feature/database`; not deployed. Neon connectivity
is **not verified** because no `DATABASE_URL` is configured. Never infer connection
success from unit tests. No production database was modified.

## Setup and commands

Use Node.js 22+ and `npm ci`. Copy `.env.example` to `.env` and supply a Neon
PostgreSQL URL with TLS enabled. Keep it server-side. Run:

```sh
npm run db:check
npm run db:migrate
# Only on a designated development Neon branch/database:
ALLOW_SYNTHETIC_SEED=true npm run db:seed
npm test
RUN_NEON_TESTS=true node --test test/neon.test.js
```

The read-only check issues a real `SELECT 1`; it fails without credentials.
Migrations acquire an advisory transaction lock, use a checksum ledger, and run
atomically. Applied migration files are immutable. An unexpected pre-existing
schema fails rather than being dropped or silently replaced. Seed data uses
stable UUIDs and `example.invalid` addresses; seeds are repeatable and refused
when `NODE_ENV` or `VERCEL_ENV` is `production`. Explicit seed opt-in is still
required on development databases. Never set it for production.

`lib/db.js` exports `query(sql, params)`, `transaction(async query => ...)`, and
`close()`. All queries in a transaction use one connection; failures roll back
before release. Runtime connections use Neon's secure WebSocket transport and a
small pool. Do not make HTTP/database calls from frontend JavaScript.

Tests use a disposable, in-memory PGlite PostgreSQL engine, not mocks of SQL.
They verify constraints, rollbacks, source-scoped transaction uniqueness, merge
history, and import retry behavior. They do not verify Neon transport, independent
concurrent sessions, Vercel bundling/routing, or the future authentication system.
A live read-only Neon test is opt-in and skipped without a URL.

## Schema ownership and proposed integration

Migration `001_donor_core.sql` creates donors, donations, campaigns,
program_outcomes, donor_aliases, import_batches, import_rows, custom_fields, and
donor_merge_history. Shared emails intentionally have no uniqueness constraint.
Financial foreign keys restrict deletion. Normal APIs never delete donors or gifts.

Teammate 2's final auth schema is pending. This branch deliberately does **not**
create users, roles, permissions, role_permissions, user_roles, activities, tasks,
outreach_messages, or message_templates. Coordinate these tables before writing
migration 002; the provisional proposal is UUID users, UUID roles, unique text
permission names, role_permissions, and optional user_roles. Do not create a
parallel authentication schema. Teammate 2 should confirm:

- UUID semantics for users and whether roles are singular or multiple.
- Foreign keys from `donors.assigned_board_member_id`,
  `import_batches.importing_user_id`, and
  `donor_merge_history.authorized_actor_id` to `users.id`. They are UUIDs without
  user foreign keys until that agreement; actors come only from middleware.
- Donor FKs and retention semantics for activities/tasks/outreach. Once those
  tables exist, extend merges in the same transaction to repoint their donor
  associations, while retaining original references in the audit. Do not enable
  production merging across those features until that integration is tested.
- Whether report queries should include archived donors or resolve donor aliases.
  Gifts are already moved to the canonical donor; never sum both donors' history
  by joining through merge history.

Board contact strings from spreadsheets are retained in import audit data and
reported as warnings. They do not automatically assign a user or bypass
`assignments.manage`. Teammate 2 owns that workflow.

The supplied provisional permission names are used by `lib/donor-routes.js`.
`lib/data-api.js` looks for `requirePermission(req, res, permission)` exported by
`lib/permissions.js`. It must return a server-authenticated user with UUID `id`
and role information, or write 401/403 and return null. Missing middleware
returns 401 without touching the database. Broken middleware fails closed.
If Teammate 2 exports it elsewhere, adjust this one adapter after agreeing on the
location. No auth-owned files are modified; no fake users or bypasses exist.

Set `APP_ORIGIN` to the exact application origin (scheme and host, no trailing
slash). All mutations require that Origin and `application/json`. This enforces
same-origin cookie requests while the CSRF contract is pending; a trusted
non-browser caller must also send Origin. Never use a wildcard origin. No CORS
allow headers are emitted. Teammate 2 remains responsible for session verification,
cookie flags, session expiry/revocation, permission evaluation, and login limits.

## Suggested review splits

Keep everything in this repository; no commits or pushes were made by the agent.
Split review into database setup/schema, donor services/routes, bounded parsing,
import persistence/idempotency, merges, and custom-field/campaign management.
The root package changes only add `fflate` (archive validation), development-only
PGlite tests, and `db:check`. Existing shared dependencies/scripts are preserved.
Coordinate these shared changes and README updates before merging. Suggested
tracking issues can follow the same split.
