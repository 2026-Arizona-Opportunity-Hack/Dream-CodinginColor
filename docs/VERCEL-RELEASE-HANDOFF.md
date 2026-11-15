# ColorLoop release handoff — November 14, 2026 (Arizona)

Current UX review update: the Neon demo is now populated (4 donors, 5 completed
USD gifts totaling $2,600). Do not import either demo CSV into it again as new gifts.
The later [UX polish report](UX-POLISH.md) supersedes empty-dataset setup notes below.
The cached `63fc3e5` release archive predates the uncommitted UX fixes; rebuild from
the newly reviewed commit after approval rather than deploying that old archive.

Status: prepare only. No key rotation, encrypted-data update, real enrollment reset,
commit, push, merge, project creation or deployment is authorized by this handoff.
The screenshot-exposed MFA encryption key must be treated as compromised.

## Verified readiness

- `feature/auth-ui` and `origin/feature/auth-ui`: `63fc3e5db7361b67777eb3c15eb65a87659272a2`.
- Fresh `origin/main`: `38c8ada4b26e3b8cbd2fb4ae32fcd5a2bb5ec088`, exactly the feature commit's parent.
  Main has zero unique commits; the feature has one. The 50-file change can fast-forward
  without conflicts. No branch was switched or merged.
- The 50 committed files include both migrations, MFA/account logic and UI,
  campaign review/presets, locked security dependencies, tests, build tooling and docs.
  The 31 original untracked CSV/backup/duplicate-name files remain outside Git.
- Configured Neon: reachable; all migrations 001 through 007 recorded, including
  001a. One active administrator, all 15 administrator capabilities, one enrolled
  authenticator decryptable by the current key, recovery hashes available, no pending
  enrollments. Only aggregate metadata was printed. No database writes in this audit.
- The real database has **zero donors, gifts and eligible board members**. Login works,
  but a useful donor/follow-up demo needs a genuine approved board account and explicitly
  approved synthetic donor/gift records added through the authenticated UI.
- Expanded Chrome rehearsal: real HTTPS/Secure cookies/TOTP with disposable PostgreSQL;
  donor list/history, save interaction, create follow-up, reports/PDF, refresh, logout
  and subsequent login passed. Zero browser exceptions. HTTP integration smoke passed.
  No critical application bug was found; application source was not changed.
- Full suite: **131 passed, 0 failed, 2 live-Neon tests skipped** (133 total).
  Includes one new disposable-database key-rotation rehearsal. Previous Lighthouse:
  100 accessibility on seven workspace screens; hosted accessibility remains unmeasured.
- Local production build passed: seven allowlisted browser files, five Node 22 functions,
  33 API rewrite checks, packaged XLSX worker and real TOTP/QR dependencies executed.
  `dist` contains no server modules, migration SQL, private .env, or actual MFA key.
- Runtime here is Node 22.23.4; package pins `22.x`. Cookies remain HttpOnly, Secure,
  SameSite=Strict; Origin/CSRF/RBAC checks and mandatory MFA remain enforced.
- Hosted project settings, plan eligibility, domains and provider headers have not
  been verified remotely. Root `.vercel/project.json` is synthetic local-build metadata;
  **do not deploy using it**.

## Approval-ready key rotation plan

The audit snapshot found one enrolled authenticator; refresh that inventory after
any demo-account enrollment. Current exposure affects every seed encrypted with
the exposed key. Do not replace `.env` with a random new
key: the sole administrator's ciphertext would become unreadable. Do not send the
old/new key, QR, TOTP seeds or recovery codes in chat or screenshots.

After explicit approval, perform this short maintenance window:

1. Confirm the administrator can sign in and has saved a recovery code offline.
   Keep their authenticator available. Privately back up the old key and encrypted
   MFA columns, with restricted access, separately from the source repository.
2. Keep deployment paused and stop localhost/all other writers to this database.
   The code currently uses one key, so database re-encryption and environment changes
   cannot be rolled out independently while old instances continue accepting traffic.
3. Generate a fresh 32-byte random key encoded as base64 into private storage only.
   Hold old/new keys in the operator process, never SQL, command arguments or logs.
4. In one database transaction, take advisory lock `78234902` and lock user rows.
   Decrypt active **and pending** TOTP ciphertext with the old key; re-encrypt with
   AES-256-GCM, new random IVs, the new key and the existing user-specific AAD.
   Verify each result decrypts to the same seed before committing. Abort the whole
   transaction on any failure. Preserve user IDs, password hashes, roles, recovery
   hashes, replay counters, preferences, pending expiry and all donor/domain records.
5. Persist the matching new key in ignored private `.env` (0600) and approved Vercel
   environments before starting any instance. Read-only verification must prove that
   the saved key decrypts every enrollment. Restart localhost, then test sign-in.
   If the environment update fails, keep the service stopped and restore the saved
   ciphertext/key pair together; never restore just one side or the whole donor DB.
6. **Then replace the enrolled TOTP seed:** sign in locally and use Security →
   Disable / reset authenticator, with current password and fresh factor. Re-enroll
   using a new QR; save the new recovery codes and verify dashboard access. Self-reset
   revokes existing sessions. Retire the old authenticator entry only after success.
   Repeat for each affected enrollment if the count changes before execution.
7. Verify a new sign-in/refresh/logout and back up the new stable key privately.
   Restrict old-key/ciphertext rollback material and retire it after the controlled
   validation window. Remove/redact the exposed screenshot wherever controlled.

Re-encryption alone preserves access but cannot invalidate a TOTP seed an attacker
may already have recovered. The fresh enrollment in step 6 completes containment.
There is no fake factor, new bypass or permanent MFA-disable option.

`tests/mfa-key-rotation.test.js` rehearses active/pending re-encryption, unchanged
TOTP generation, preserved recovery/replay/session/account data, dry-run rollback,
rejection under the old key and rollback after corrupt ciphertext, using synthetic
keys and disposable PostgreSQL only. It is a rehearsal, not a live operator command.

## Prepare the mentor demo through the UI

`colorloop_demo.csv` was inspected, parsed, and preserved unchanged. It has five
validly parsed gift rows, four email identities and $2,600 in amounts, but contains
a real nonprofit contact name; its donor/company names cannot be certified fictional.
Every row lacks currency, payment status and transaction ID. Original-file imports
therefore require explicit payment/ownership review; reuploads lack transaction-ID
idempotency and instead trigger possible-duplicate gift review. Do not override that
review to demonstrate a repeat import.

A clearly synthetic replacement is prepared locally at
`node_modules/.cache/colorloop_demo_synthetic.csv`, outside the release artifact
and ignored by Git. The original and the synthetic copy are not commit candidates.
The replacement uses Demo names/companies, `example.test` email addresses, 555-01xx
phone numbers, Demo campaign labels, the controlled demo board email below, USD,
simulated completed status and stable `CIC-MENTOR-001` through `CIC-MENTOR-005` IDs.
Only these declared simulation rows are marked completed; no real payment is claimed.

### Create and approve the synthetic board account first

1. Keep the existing administrator signed in in the normal browser window. Do not
   alter its role, password, MFA enrollment, key or recovery codes.
2. Open a private/incognito window at `https://localhost:3000`. Choose Sign Up.
   Enter full name `Demo Board`, email `demo-board@example.test`, and a privately
   chosen strong password (10–128 characters including upper/lowercase, digit and
   special character). Click Request Account. Signup alone cannot access donors.
3. In the administrator window, open the top-right account menu → Account Settings
   → Review account requests. Select that exact email. Choose Approve, role
   **Board member** (`board-member`), and Board assignment eligibility **Active board
   member**. Click Apply reviewed decision. Do not grant Administrator.
4. In the private window, sign in with the demo account. Confirm its password, click
   Create enrollment QR, scan it in an authenticator app, enter a fresh six-digit
   code and click Enable 2FA. Save its recovery codes offline, then acknowledge
   I saved my codes — Continue. Never record the QR/codes/password on screen.
5. The board account may start on Follow-ups. Its menu should show Board member;
   Security should show Authenticator 2FA Enabled. Sign out and sign in again with
   a fresh TOTP code. Keep the administrator window unchanged for importing/reports.
   Accepted TOTP codes cannot be reused; wait for the next code if necessary.

These are operator UI instructions, not actions performed on Neon by the audit.
The pending key rotation remains unexecuted. If this board account enrolls before
rotation, its new ciphertext must be included along with the administrator's;
refresh the enrollment inventory before the approved maintenance window.

### Import the verified synthetic copy as administrator

1. Open Import center. Keep Source `generic`. Select
   `node_modules/.cache/colorloop_demo_synthetic.csv` and click Upload and inspect.
   In the macOS file picker, Command+Shift+G opens a path entry field; use the full
   repository path plus the relative filename above to access ignored directories.
2. Keep automatically detected columns. Verify first/last name, email, phone,
   company, amount, contact-person → `board_contact`, campaign, donation date,
   currency, payment status → `status`, and transaction ID → `external_transaction_id`.
   Leave other fields unmapped. USD/completed come from the declared simulation file;
   no missing-payment fallback or unknown-payment checkbox is needed.
3. Click Validate mapping. Expect 5 valid rows and 0 errors. On the first import
   into the previously empty database, expect 0 existing transactions. Leave donor
   identity on its unambiguous match; do not choose Create a distinct donor.
4. Campaign choices are now grouped by trimmed, case-insensitive names. For each
   missing campaign group, choose Create campaign with explicit approval and check
   its approval checkbox once. Five rows need only two group approvals. Keep matched
   campaigns where available; Row-specific exceptions allow individual overrides.
5. For each of the five ownership decisions, select Demo Board
   (`demo-board@example.test`). It must be approved, active and board eligible to
   appear. Click Confirm reviewed import. Drafts may be prepared; no real email is sent.
6. Open Donors and inspect the expected records below. Open Demo Alex to show both
   dated gifts in Complete gift history. In Overview and Reports set From
   `2026-01-01`, Through `2026-12-31`, clear Program/Board member filters, and Apply
   filters. Total giving is $2,600 and Active donors is 4 for this dataset.
7. Reupload the same synthetic file with the same `generic` source, Validate mapping,
   and expect 5 existing transactions. Keep matched campaigns and existing donors,
   select the same board owner for each row, and confirm. Expect five duplicate
   results and unchanged totals. Do not change transaction IDs or source on retry.

| Donor | Gifts | Total USD |
| --- | --- | --- |
| Demo Alex | 2 | 1,100 |
| Demo Blair | 1 | 500 |
| Demo Casey | 1 | 250 |
| Demo Drew | 1 | 750 |
| Total | 5 | 2,600 |

Demo Summer campaign: 2 gifts/$600; Demo Fall campaign: 3 gifts/$2,000. These
expectations were proven through actual preview/confirmation/reupload services in
disposable PostgreSQL, including all assignments and unchanged totals on retries.
If the database already contains other gifts, compare the demo subset and baseline;
do not expect global totals to ignore existing data. If the original CSV was already
imported, inspect it before adding the replacement: its different identities and
new IDs deliberately do not claim to deduplicate those earlier records.

For the mentor: Donors → Demo Alex → Add interaction note; then Follow-ups → Create
follow-up and assign Demo Board; finish with administrator Reports. The private
board session can show assigned-donor access, while user/role administration must
remain forbidden. The account will have no assigned donors until import completes.

## Required production environment

Add values privately under Vercel Project → Settings → Environment Variables.
Choose **Production** initially. Mark credentials as Secret/Sensitive where offered.
No secret receives a `PUBLIC_`, `NEXT_PUBLIC_` or browser-build prefix.

| Variable | Value/purpose |
| --- | --- |
| `DATABASE_URL` | Existing authorized Neon pooled TLS URL, copied privately; do not create/reset/seed another database |
| `MFA_ENCRYPTION_KEY` | New approved, persisted key matching the re-encrypted records; never the screenshot-exposed key |
| `APP_ORIGIN` | Exact canonical HTTPS URL opened by the user, e.g. `https://your-chosen-project.vercel.app`; no trailing slash/path |
| `COLORLOOP_DEMO` | `false` (or unset) |
| `ALLOW_SYNTHETIC_SEED` | `false` (or unset) |
| `BOOTSTRAP_ADMIN` | `false` (or unset); existing admin must be retained |
| `RUN_NEON_TESTS` | `false` (or unset) |

Leave `COLORLOOP_STORE`, `DEMO_PASSWORD`, `ADMIN_PASSWORD`, `LOCAL_TLS_KEY`,
`LOCAL_TLS_CERT`, `RESOLVE_LEGACY_USERS` and local-only configuration unset on Vercel.
Vercel supplies its runtime/platform flags; do not fake `VERCEL` locally.

Optional, not needed for browser dashboard/reports: `REPORTING_API_KEY` enables
server-to-server `/api/v1/metrics`. Leave unset unless needed. `CRON_SECRET` plus a
real active `AUTOMATION_USER_ID` enables daily draft/task preparation; leave both
unset for the first demo if unnecessary. Preparation sends no messages. The existing
cron will return a configuration-unavailable response until deliberately configured;
it is not a login/database outage. Do not put a reporting key in browser JavaScript.

Production and Preview must not share an arbitrary global `APP_ORIGIN`: each
origin is exact. Do not enable previews against this live database casually. All
instances accessing its encrypted factors must use the same matching key. Changing
an environment variable affects new deployments, not existing instances.

## Beginner deployment steps — execute only after approval

Only a Hobby account is available. Vercel's limits page excludes organization-owned
Git repository connections on Hobby, while its Git page describes narrower private
repository restrictions. Do not depend on automatic Git import, fork/move this repo,
purchase a plan, or remove access checks to evade a rejection. Vercel documents a
manual CLI project workflow with Git connection optional. That is the proposed demo
route; actual account acceptance has not been exercised. Confirm noncommercial
Hobby eligibility with the account owner; if Vercel rejects it, stop and request an
organizer-supported eligible account rather than spending money automatically.

1. Approve and complete the rotation and fresh enrollment above first. Keep localhost
   as the working fallback. Resolve permission to add synthetic demo data separately.
2. Approve the merge separately. Refresh refs again before merging; if main moved,
   reassess it. Pause any existing automatic deployment before merging. The prepared
   target is `63fc3e5`; new local rehearsal/docs changes are uncommitted and not included
   in that 50-file commit. Do not stage the 31 excluded files.
3. A verified package is already prepared at
   `node_modules/.cache/colorloop-release-63fc3e5` (127 tracked files; all 31 original
   local-only files absent). To use it, skip the archive/extract commands below and
   change into that directory. To reproduce it in a fresh directory, package the
   published commit from this same repository. These commands copy tracked
   source into an ignored release artifact inside the repository, not a second repo.
   They exclude private `.env`, local TLS files, root synthetic `.vercel` metadata,
   and every untracked file. Do not deploy the dirty workspace directly.

   ```sh
   cd /Users/shoryamoses/Desktop/Dream-CodinginColor
   mkdir -p node_modules/.cache
   git archive --format=tar --output=node_modules/.cache/colorloop-release-63fc3e5.tar 63fc3e5
   mkdir node_modules/.cache/colorloop-release-63fc3e5
   tar -xf node_modules/.cache/colorloop-release-63fc3e5.tar -C node_modules/.cache/colorloop-release-63fc3e5
   cd node_modules/.cache/colorloop-release-63fc3e5
   COLORLOOP_CLI=/tmp/colorloop-requirements-tools/node_modules/.bin/vercel
   ```

   The pinned CLI is already installed on this machine. `mkdir` intentionally stops
   on an existing release directory: use the verified prepared artifact or a new
   empty release directory, rather than mixing old files into it.
4. Run `"$COLORLOOP_CLI" login`, then `"$COLORLOOP_CLI" link`. Choose your Hobby scope,
   create a uniquely named ColorLoop demo project, and leave Git integration unconnected.
   Linking creates real project metadata in this release directory; it does not deploy.
   Do not select the synthetic `colorloop-local-validation` project from local tests.
5. Open that project in Vercel. Under Settings → Build and Deployment set:
   Framework **Other**, Root Directory **`.`**, Install Command **`npm ci`**,
   Build Command **`npm run build`**, Output Directory **`dist`**, Node.js **22.x**.
   Keep the repository's `vercel.json` API rewrites/functions/security headers.
6. In Settings → Environment Variables enter the Production values above. Open the
   ignored local configuration privately to copy values; never display them in a
   recording, chat or screenshot. Obtain the intended canonical domain from the
   project and set `APP_ORIGIN` to exactly its HTTPS origin. No bootstrap/migrate/seed
   command belongs in Install or Build Command. No new Neon migration is required
   for this already-verified database.
7. Once deployment itself is approved, from the clean linked release directory run
   `"$COLORLOOP_CLI" deploy --prod`. Do not pass secrets as CLI arguments and do not
   use `--public` (source exposure), `--debug`, or the synthetic local build metadata.
   This is a real deployment command and has **not** been run during preparation.
8. Open the canonical Production domain. If Vercel assigned a different domain than
   expected, correct Production `APP_ORIGIN` and redeploy before testing authentication.
   Updating environment values alone does not update an existing deployment. Use
   the canonical domain, not a random deployment/preview URL with a different Origin.
9. Run the short checklist below. Stop if MFA, Origin/CSRF, RBAC, database persistence
   or static private-path checks fail. Keep credentials and authenticator screens out
   of the hackathon recording. Record the real domain/approved commit for handoff.

## Short post-deployment checklist

- Health returns 200. Signed-out visitors see only Sign In/Sign Up; protected donor
  APIs reject requests. `/.env`, `/lib/auth.js`, `/db/migrations/006_account_security.sql`
  and `/package.json` are not downloadable. Never request source-public deployment.
- Existing admin password → required TOTP → dashboard; invalid codes rejected.
  Refresh/new request preserves the verified session. Sign Out then browser Back
  cannot reveal data. Recovery works once; never expose its value in evidence.
- Confirm `__Host-colorloop` is Secure/HttpOnly/SameSite=Strict. Mutation requests
  require exact Origin and CSRF. Verify trusted Vercel client headers and throttling
  in the actual runtime; a forged forwarding header must not change identity.
- Approve/create a genuine board account using the admin UI. It must enroll MFA and
  see only its assigned donors; it cannot administer users/roles or other owners.
- With approved synthetic data, import CSV and XLSX; review missing campaigns and
  payment metadata; reimport the same transaction IDs and confirm totals do not grow.
- Open donor history, save a clearly synthetic interaction, create an assigned
  follow-up, and check dashboard/reports against verified USD gifts. Unknown payments
  stay excluded. Reload to prove persistence. No real emails are sent.
- Run Chrome Lighthouse accessibility on the actual domain and critical screens;
  target the previous local 100 and investigate any score below 95. Local Lighthouse
  results are not proof of hosted scores. Review function logs without logging keys,
  passwords, QR contents, recovery codes or donor details.

## Official references checked

- [CLI project deployment](https://vercel.com/docs/projects/deploy-from-cli)
- [Git connection limits](https://vercel.com/docs/limits#connecting-a-project-to-a-git-repository)
- [Git/Hobby rules](https://vercel.com/docs/git#using-hobby-teams)
- [Hobby eligibility](https://vercel.com/docs/plans/hobby)
- [Build settings](https://vercel.com/docs/builds/configure-a-build)
- [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)
- [Secret environment values](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Vercel client headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)
