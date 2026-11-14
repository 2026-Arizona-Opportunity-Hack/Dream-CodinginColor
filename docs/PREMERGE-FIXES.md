# Verified pre-merge fixes

Work remains on `feature/integration`; no push, deployment, production connection
or real message is part of these changes.

## Merge evidence and account-role safety

Donor merges now move `verified_funder_outcomes` inside the same transaction as
gifts and live relationships. The merge audit stores the complete original outcome
rows, including original donor UUID and evidence references. Regression tests use
the actual funder-packet handler, verify rollback on interruption, and reject a
repeated merge without duplicating evidence.

Board-member forms explicitly default to `board-member`. General account forms
start with an empty role choice. Administrator selection prompts for confirmation;
cancelling performs no account write. The backend also requires boolean
`confirmAdministrator: true` on creation/promotion to administrator, checks the
role exists, rejects unknown permission grants, and preserves self-escalation
protections. Bootstrap remains an explicit trusted operator action. The Chrome
smoke check exercises empty selection, cancellation and a confirmed grant.

## Static deployment and function capacity

`npm run build` emits exactly the browser allowlist to `dist/index.html` and
`dist/public/...`. Builds reject symlink sources and recognized server/credential
material. No API, migration, server module, .env or package file is copied.
`vercel.json` selects the Other framework, runs that build, serves `dist`, and
retains native API routing without catch-all rewrites. It explicitly includes the
XLSX worker and applies browser security headers. The HTTPS smoke check now serves
this generated output and verifies API access plus 404s for private source paths.

All **33** API function files were inspected. Their URL/method handlers are
preserved. The smallest function consolidation would be one Node entry point,
reusing the current handler factories plus an explicit dispatcher and rewrites;
no new web framework is necessary. But the repository does not contain a Vercel
routing/build runner, and Vercel CLI installation/deployment was not authorized.
A hand-written rewrite simulation is not enough to verify native route precedence,
parameter forwarding and worker packaging. Therefore consolidation was deliberately
not implemented. The local harness remains a test harness, not an asserted Vercel
routing emulation.

**Remaining hosting decision:** use a Vercel plan that supports 33 frameworkless
functions, or authorize a separately validated consolidation. Frameworkless Hobby
allows 12 functions. Organization-owned Git integration also needs plan/access
confirmation. No plan was purchased/upgraded and no dependencies were added.

References: [Vercel runtimes](https://vercel.com/docs/functions/runtimes),
[build output](https://vercel.com/docs/builds/configure-a-build), and
[project configuration](https://vercel.com/docs/project-configuration/vercel-json).
Hosted preview validation remains required even with the static configuration.

## Safe populated-001 upgrade

The existing `001`, `002`, and `003` files and their checksums are unchanged.
The new ordered path is:

1. `001_donor_core.sql`
2. `001a_preserve_legacy_user_references.sql`
3. `002_relationship_security.sql`
4. `003_reporting_views.sql`
5. `004_legacy_identity_resolution.sql`

When auth tables do not yet exist, 001a preserves the original bare board/import/
merge user UUIDs in dedicated `legacy_*` columns. Unverified current user links
become NULL so migration 002 can add genuine-account foreign keys. New application
rows still require an actor; only rows with preserved historical attribution can
await reconciliation. No identity or account is fabricated, and no donor/gift or
original merge audit is removed. Historical imports cannot be claimed by a new
user until explicitly reconciled. Pending donor ownership is visible as unassigned;
re-import does not automatically replace it. Reconcile before using live ownership.

If auth tables already exist, 001a adds compatibility columns without clearing
existing valid links. Tests cover both populated 001 and an already-applied
001–003 ledger, including unchanged checksums and repeat migration runs.

To reconcile, first create genuine accounts through the approved bootstrap/admin
workflow. Keep a reviewed mapping file private, outside Git; for example, inside
an ignored local directory. Each entry has this shape:

```json
[
  {
    "legacyUserId": "<original historical UUID>",
    "userId": "<genuine existing account UUID>",
    "identityVerified": true
  }
]
```

The resolver never guesses names/emails, creates users or derives identity from
shared email. It requires an active administrator as `LEGACY_RESOLUTION_ACTOR_ID`,
explicit per-entry verification and `RESOLVE_LEGACY_USERS=true` to write. It
records an immutable verified identity mapping, preserves original UUID columns,
audits the resolution and refuses conflicting remaps. Existing post-upgrade donor
ownership is not overwritten. Newly linked assignment history uses the actual
reconciliation date, never an invented historical start date.

After explicit approval against the intended disposable/development database:

```sh
node --env-file=.env.neon-verification scripts/database.js migrate
node --env-file=.env.neon-verification scripts/resolve-legacy-users.js
RESOLVE_LEGACY_USERS=true node --env-file=.env.neon-verification scripts/resolve-legacy-users.js --apply /private/path/reviewed-mappings.json
```

The second command reports unresolved counts only. The final command is an
operator write requiring separate approval for any real target. None of these
commands were executed against Neon during implementation.

## Client identity and throttling

Inside Vercel (`VERCEL=1`, set by the platform), login uses only the ingress-owned
`x-vercel-forwarded-for` value, validated as one IPv4/IPv6 address. It ignores
arbitrary X-Forwarded-For, X-Real-IP, and client-provided platform-marker headers.
Outside Vercel, only the actual socket address is used. IPv4-mapped IPv6 and IPv6
representations normalize consistently. Missing, malformed or multi-valued trusted
identity fails sign-in with 503 before password hashing; it never falls back to a
shared `unknown` bucket. Account-level limits remain shared across client IPs.

Tests cover distinct Vercel clients behind one proxy, forged headers off-platform,
invalid header chains, network throttling, and per-account throttling across IPs.
The ingress overwrite assumption must still be verified on an actual Preview;
setting VERCEL locally is not proof that an arbitrary proxy header is trustworthy.
See [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## Verification

```sh
RUN_NEON_TESTS=false npm test
npm audit
npm audit --omit=dev
npm run build
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

All database writes in verification use disposable in-memory PostgreSQL. Live
Neon stays skipped. The generated assets, route protection, funder evidence,
account-role confirmations and migration upgrades have local regression coverage.
The remaining deployment gates are the hosting-capacity choice, an authorized
Neon rehearsal, and hosted Vercel route/ingress/worker verification.
