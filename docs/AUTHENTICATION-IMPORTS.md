# Authentication and reviewed imports

All verification for this change uses synthetic records in disposable PostgreSQL.
No production Neon connection, live migration, deployment or real delivery has
been performed. Continue on `feature/auth-ui`; do not deploy without the separately
approved release checks in [deployment readiness](DEPLOYMENT-READINESS.md).

## Account lifecycle

Sign Up accepts a full name, email and strong password and creates a pending
request. It returns the same acknowledgement for an existing email. An active
administrator reviews requests under Account Settings, chooses a non-administrator
role and board assignment eligibility, and approves or rejects. Approval preserves
the submitted password hash and erases it from the reviewed request. It never
activates an administrator through signup. CIC must communicate approval through
its existing trusted process; the application sends no approval email.

Password authentication creates a restricted five-minute session. It can access
only authentication/setup/logout endpoints, with Origin and CSRF checks still
required. Every donor, task, account, reporting and import API requires completed
MFA. New and existing accounts enroll before accessing the workspace. Verified
sessions last eight hours; refresh checks the server and preserves their state.

Enrollment requires the current password and a genuine six-digit authenticator
code. The private QR is generated locally using `qrcode` and shown only in the
reauthenticated, non-cacheable setup response. The raw Base32 secret and otpauth
URI are never separate API fields. The QR itself carries the enrollment secret:
keep it private and do not capture or log it. Pending enrollment expires in five
minutes. `otpauth` validates 30-second SHA-1 TOTP with a one-step clock tolerance.
Every accepted counter is stored transactionally; accepted codes cannot be reused.
If a code was just accepted, wait for the next code or use a recovery code.

Ten random 128-bit recovery codes appear once. Only user-bound SHA-256 hashes are
stored. Consumption is serialized with the factor verification, so simultaneous
reuse has one winner. Regeneration invalidates the previous set. Password changes,
recovery regeneration, and self/admin authenticator reset require the current
password and a fresh factor. Password changes and resets revoke existing sessions;
self reset immediately returns to mandatory enrollment. Administrator reset also
requires a documented identity verification reason and revokes the target's
sessions. It cannot be used to impersonate the target or disable MFA permanently.

Failed MFA and reauthentication attempts reserve durable account and trusted-client
rate limits even when verification fails. Login keeps its existing independent
account and platform-aware client limits. Forwarding headers never supply an
untrusted client identity. Opaque HttpOnly/Secure/SameSite=Strict cookies, server
RBAC, same-origin mutations, CSRF and audit attribution remain enforced.

My Profile edits the display name only. Email and role remain administrator-managed;
there is no unverified self-service email ownership change. Account Settings saves
a start page and the time zone used for the account security timestamp. Gift dates
keep their source calendar date. Sign Out invalidates the server session, clears
protected UI and caches, and clears modal/form state. Page restoration rechecks the
server before rendering protected content.

## Persistent deployment prerequisites

Migration `006_account_security.sql` adds encrypted/pending TOTP, recovery hashes,
credential versions, preferences, MFA session timestamps, security attempts and
pending account requests. Existing records remain intact; legacy sessions have no
MFA timestamp and cannot access protected APIs. Migration `007_import_presets.sql`
adds attributable saved mappings and a nonunique normalized campaign lookup index.
It preserves legacy ambiguous campaign names for explicit review. Earlier migration
checksums are unchanged. Both clean installs and populated upgrades are tested.

Persistent environments require a stable `MFA_ENCRYPTION_KEY`, the base64 encoding
of 32 cryptographically random bytes, stored server-side with the existing private
configuration. Secrets use Node's AES-256-GCM with random IVs and authenticated
user-specific context. Missing/invalid keys or unreadable ciphertext fail closed.
Back up the key securely and separately from PostgreSQL. Do not replace it on each
restart. Key rotation requires a separately reviewed decrypt/re-encrypt procedure;
changing the value alone makes existing TOTP ciphertext unreadable. A database
snapshot alone cannot restore authenticators without the matching key.

Synthetic demo mode alone generates an ephemeral key because its entire database
is recreated in memory. It cannot run on Vercel or in production. There is no
built-in production password, automatic login, or last-administrator MFA bypass.
If the sole administrator loses all factors and recovery codes, an independently
verified, audited operator recovery procedure is still required; no public reset
or email recovery flow has been invented. Configure at least two approved
administrators and retain their recovery codes through CIC's trusted process.

## Campaign and source review

Preview detects campaign names, case-insensitively ignoring surrounding whitespace.
A unique active match is reused. Missing or ambiguous names require mapping to a
specific active campaign, explicitly approving creation, or leaving the optional
campaign blank. Creating a campaign requires `settings.manage` in addition to import
permission. Preview creates no campaigns. Confirmation holds the existing shared
transaction lock; campaign, donor, gift, assignment, task, draft and row mutations
commit together or roll back together. Normalized name checks prevent duplicates
across campaign editing and imports. Ambiguous historical names are not merged.
Donor matching, transaction-ID safeguards, possible-gift review, currency/status
review and unknown-payment exclusion from verified reports remain enforced.

Generic CSV/XLSX automatic detection is retained. The Zeffy starter preset uses the
headings actually supplied by the nonprofit: First name, Last name, Email,
Secondary email, Amount, First payment date (America/Phoenix). Exports vary; review
or save the mapping for the actual file. No full authoritative Benevity workbook
was available, so its starter intentionally requires configuring real export
columns. Saved Generic/Zeffy/Benevity mappings support required donor fields,
contact person, campaign, date, status, currency, external IDs and custom fields.
Synthetic configured CSV/XLSX exports are tested; this is not a claim of universal
vendor schema compatibility. Missing payment status/currency remains unverified
unless an authorized user explicitly reviews it; no successful payment is invented.

## Local verification

```sh
npm ci
RUN_NEON_TESTS=false npm test
npm audit
npm audit --omit=dev
npm run build
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

The suite and smoke scripts set synthetic keys, migrate disposable in-memory
PostgreSQL, and use real TOTP/recovery services. Browser smoke uses Chrome, local
HTTPS and real cookies/CSRF. It exercises signup approval, enrollment, password
and recovery management, reset/re-enrollment, touch and keyboard profile actions,
all seven workspace screens, reviewed campaign creation, repeated import, logout
and expiry. `CHROME_PATH` can override the installed Chrome binary. Live Neon tests
remain opt-in and must stay disabled for these checks.

Optional, already-approved local audit/build tools can also run:

```sh
LIGHTHOUSE_MODULE=/tmp/colorloop-requirements-tools/node_modules/lighthouse/core/index.js \
  A11Y_OUTPUT=/tmp/colorloop-auth-accessibility node scripts/audit-accessibility.mjs
VERCEL_TELEMETRY_DISABLED=1 /tmp/colorloop-requirements-tools/node_modules/.bin/vercel \
  build --yes --global-config /tmp/colorloop-requirements-tools/config
node scripts/verify-vercel-build.mjs
```

The CLI build is local only and needs previously prepared local project settings;
it does not authorize linking a real project or deploying. The static build copies
only seven allowlisted browser files. TOTP libraries, migrations, configuration and
server code remain outside static output. Existing API URLs still use five Vercel
functions, including all new routes through the existing dispatcher.

## Verification results for this change

- Full `RUN_NEON_TESTS=false npm test`: 132 tests, **130 passed, 0 failed,
  2 skipped**. Both skips are opt-in live Neon tests. The isolated suite covers
  populated migration upgrade, API auth/CSRF/RBAC, encrypted MFA, replay,
  one-time/concurrent recovery, reauthentication, approval, campaign rollback,
  CSV/XLSX mappings and import idempotency.
- HTTPS integration smoke: passed against real isolated SQL and Secure cookies.
- Chrome smoke: passed all seven workspace screens, signup/approval, genuine TOTP
  setup, invalid-code rejection, recovery login, mobile profile save, preferences,
  password/recovery rotation, reset/re-enrollment, refresh, Back after logout,
  expiry, campaign creation and repeat-import checks. Zero browser exceptions.
- Responsive/keyboard audit: 28 views; no overflow, contrast, small-text, label or
  rendering failures. All keyboard checks passed.
- Lighthouse: accessibility **100** on dashboard, donors, imports, tasks, outreach,
  reports and settings, using genuine MFA with the isolated application.
- Full and production-only npm audits: **0 vulnerabilities**.
- Static and local Vercel CLI production builds: passed. Compiled output: five
  Node 22 functions, 33 routing checks including new endpoints, executable XLSX
  worker and TOTP/QR dependencies, no private files in static output.
- `git diff --check`: passed. No commit, push, deployment or live migration.

## Files for review

New files:

- `lib/account-security.js`, `lib/totp.js`
- `lib/import-campaigns.js`, `lib/import-presets.js`
- `public/js/auth-ui.js`
- `db/migrations/006_account_security.sql`, `db/migrations/007_import_presets.sql`
- `tests/auth-support.js`, `tests/auth-ui.test.js`, `tests/mfa-security.test.js`,
  `tests/import-campaigns.test.js`
- `docs/AUTHENTICATION-IMPORTS.md`

Updated integration points:

- Authentication/persistence: `lib/auth.js`, `lib/permissions.js`,
  `lib/retention-api.js`, `lib/retention-store.js`, `lib/retention-sql-store.js`,
  `lib/api-router.js`
- Import data/routes: `lib/import-data.js`, `lib/import-parser.js`,
  `lib/custom-field-data.js`, `lib/donor-routes.js`
- Browser: `index.html`, `public/css/app.css`, `public/js/api.js`,
  `public/js/app.js`, `public/js/imports.js`
- Dependencies/configuration: `package.json`, `package-lock.json`, `.env.example`
- Local tooling: `scripts/dev.js`, `scripts/build-static.js`,
  `scripts/smoke-integration.mjs`, `scripts/smoke-browser.mjs`,
  `scripts/audit-frontend.mjs`, `scripts/audit-accessibility.mjs`,
  `scripts/verify-vercel-build.mjs`
- Existing tests adapted to genuine MFA/new migrations: `test/database.test.js`,
  `tests/auth.test.js`, `tests/api.test.js`, `tests/retention-support.js`,
  `tests/sql-integration.test.js`, `tests/merge-outcomes.test.js`,
  `tests/cic-requirements.test.js`, `tests/migration-upgrade.test.js`
- Documentation: `README.md`, `docs/DEPLOYMENT-READINESS.md`,
  `docs/INTEGRATION.md`, `docs/retention-api.md`

The checkout also contains earlier user changes, duplicate-name files and local
samples. They were preserved. This list identifies the authentication/import work;
it does not authorize staging every dirty or untracked file into one commit.
