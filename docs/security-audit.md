# Database/import security review

Checked against the installed lockfile during this implementation. `npm ci` first
removed stale local packages. `npm audit` reports **0 vulnerabilities** for the
current dependency graph; this is advisory database coverage, not proof of safety.
No `npm audit fix --force`, major upgrades, or production changes were performed.

The previous npm `xlsx` release is absent from package.json, the lockfile, and the
clean install. The inherited tests/README still referenced it; those references
were corrected. Its previous [prototype pollution advisory](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)
and [ReDoS advisory](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)
are why the existing `read-excel-file` replacement is preserved. Vercel CLI and its
previously flagged dependency tree are also absent from the shared package graph.
Use the team's reviewed deployment tooling; this change does not reintroduce it.

## Implemented defenses

- Server-only environment credentials; no database URL or PII in logs/fixtures.
- Parameterized values throughout service SQL. Dynamic SQL identifiers come only
  from internal service constants, never spreadsheet headers or request keys.
- Fail-closed permission adapter; no authentication bypass, browser-supplied
  actor, hardcoded admin, or permissive CORS. Per-route permission names are
  provisional until Teammate 2 confirms the contract.
- Mutations require exact configured APP_ORIGIN and JSON; unknown fields are
  rejected, including donor assignment IDs, primary keys, and timestamps.
- UUID, date, numeric amount, custom field/rule, text, and pagination validation.
- 1.5 MB JSON request limit, 1 MB decoded files, UTF-8 CSV validation, strict CSV
  column counts, 1000 data rows, 100 columns, and 2000 characters per cell.
- XLSX checks actual ZIP signature/OOXML content type. Streaming decompression
  counts actual bytes (8 MB total, 100 entries), limits names, rejects duplicate
  entries, and reconstructs only inspected entries before parsing. Sparse sheet
  coordinates are capped. Parsing runs in a worker with a 5-second deadline and
  a 64 MB V8 heap limit. This heap limit alone does not limit ArrayBuffers; the
  independent decompression/output limits are essential.
- XML DTD/entities, formulas, external relationships, macro/binary payloads,
  unsupported file types, and formula-like CSV values are rejected. Numeric phone
  strings beginning with `+` remain text. Formulas are never executed.
- Null-prototype header maps, no header-driven object assignment, and safe custom
  keys prevent prototype pollution. JSON values remain untrusted text; Teammate 3
  must use textContent. There is no HTML renderer in this branch to test.
- Server-stored previews owned by the authenticated actor, 24-hour expiry, and
  confirmation-time revalidation. Raw uploaded files are not persisted. Normalized
  audit rows are PII and stay inside the protected database.
- Atomic imports and merges, advisory locks, scoped transaction-ID uniqueness,
  explicit review for uncertain identities and missing-ID potential duplicates.
  No automatic merge on a name or shared email alone; distinct gifts are retained.
- Donor archiving instead of deletion, restrictive financial foreign keys, original
  donor snapshots and actor-stamped merge history, migration checksum tracking.
- Repeatable synthetic seeds require explicit development opt-in and are blocked
  under production environment flags.

## Remaining verification and integration

1. Supply a development Neon URL, run db:check, then review/apply migration 001.
   Live Neon transport, multi-session races, and hosted performance are unverified.
   Local tests use PGlite PostgreSQL with no external credentials.
2. Integrate real requirePermission and test actual sessions/roles, CSRF/cookie
   settings, board-member data scope, origin configuration, and revocation.
   Current protected routes deliberately return 401 without that middleware.
3. Agree on Teammate 2 tables and add user foreign keys and activity/task/outreach
   merge support. Those owned tables are not fabricated here.
4. Review Vercel deployment output, route mappings, function count/plan limits,
   runtime duration, and worker bundling before publication. Ensure the preview
   bundle includes lib/import-worker.js and its parsing dependencies. No deployment
   was authorized; do not claim these paths were tested on hosted Vercel.
5. Obtain representative **synthetic** provider/CIC spreadsheets. Current tests
   exercise mapping and strict ISO dates/plain decimal amounts, not actual provider
   export variants. Multi-sheet workbooks import the first sheet only.
6. Set an audit retention policy with CIC. Expired preview confirmation is blocked,
   but no automatic retention purge is installed. Purging normalized audit data
   needs a deliberate policy; do not remove financial/import references.
7. Add shared platform/session request-rate controls before public launch. File,
   row, cell, pagination, and JSON size limits here bound individual requests;
   they are not an account/IP rate limiter.

Synthetic tests cover SQL injection as data, unsafe files/headers/formulas,
unauthenticated and permission-denied routes, same-origin checks, safe errors,
repeat imports, interrupted-confirmation retry, and donation history after merges.
No real donor information is used.
