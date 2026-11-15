# Separate public Judge Demo

Prepared locally from the existing application. Nothing has been deployed, no
cloud environment variable has been changed, and neither Neon database has been
contacted by this work. The user has created a new empty Neon project; it still
needs private configuration and approved initialization.

## What is ready

The separate judge release uses all seven application pages, existing passwords,
mandatory TOTP, secure cookies, CSRF, roles and the internal impact preview. It is
not `COLORLOOP_DEMO` or a same-login workspace switch.

- The release has an immutable judge build marker. Removing the environment-mode
  variable cannot turn it into Main Workspace mode.
- Only `JUDGE_DATABASE_URL` is accepted. A conventional `DATABASE_URL`, the protected
  main host (including its pooler alias), reused main MFA key, wrong Vercel project,
  missing settings or an unmarked database causes refusal before domain access.
- Each database transaction checks a dedicated environment ID and MFA-key
  fingerprint. Main accounts and sessions are never copied or trusted.
- Email transport is hard-blocked, independent of provider keys/policy settings.
  Jobs are disabled in code and the judge Vercel configuration contains no cron.
- Judges have a restricted staff-review role: imports, donor editing/merges,
  assignments, drafts/approval, tasks, reports and campaign/custom-field settings.
  They cannot administer users/roles, send messages or enable email policies.
- Public signup is disabled. Each judge gets a unique private preapproved account
  and enrolls their own authenticator. There is no shared MFA seed or default password.

Initialization applies existing migrations to a brand-new empty database and adds
only a judge identity-marker table. It creates eight fictional donors, ten
completed gifts, three synthetic campaigns, three synthetic board members, three
judge accounts and one private operator. One donor has prior-cycle giving without
current-cycle giving; another has explicitly fictional outcome evidence. Initial
verified USD giving is 950 this year and 1,225 lifetime. No actual CIC impact is claimed.
Judges share synthetic records, so coordinate destructive edits or imports between
judges. There is no public reset endpoint or per-judge workspace.

## 1. Configure the new Neon connection privately

The prepared credential/configuration file is outside git and the release:

`/private/tmp/colorloop-judge-2026-private.json`

It was created with permissions `0600`. Open it in a local plain-text editor,
off camera. Never paste it into chat, README, terminal output or an issue. Keep a
secure password-manager backup, especially the MFA key. Do not regenerate the key
after enrollment or replace it with the main application's key.

In the new Neon project's Connect dialog, verify that it is the new empty project,
not a branch cloned from production. Copy its PostgreSQL connection string into
`databaseUrl`. Copy only the hostname from that string into `databaseHost`, without
protocol, user information, database name or query parameters. Keep the generated
`environmentId`, `mfaEncryptionKey` and all account credentials unchanged.

Do not edit the existing `.env`, run `neon deploy`, use `db:seed`, or run the usual
database migration command for this setup. The dedicated initializer below refuses
nonempty public schemas and wraps migrations, marker, accounts and seed data in
one transaction. It has no overwrite/reset option.

## 2. Create and link a separate Vercel project

Run from the existing repository. These commands create/link cloud metadata only;
run them when you approve that setup. They do not deploy. The cached CLI below is
already installed on this workstation; use your installed `vercel` elsewhere.

```sh
export VERCEL_CLI=/tmp/colorloop-requirements-tools/node_modules/.bin/vercel
export JUDGE_RELEASE="$PWD/node_modules/.cache/colorloop-judge-release"
export JUDGE_PRIVATE=/private/tmp/colorloop-judge-2026-private.json

"$VERCEL_CLI" project add colorloop-judge-demo-dream-2026 --scope dream-48f9
"$VERCEL_CLI" link --yes --project colorloop-judge-demo-dream-2026 \
  --scope dream-48f9 --cwd "$JUDGE_RELEASE"
```

If the project name is unavailable, choose a new judge-only name and use it in
both commands. Never link the repository root or select the existing `colorloop`
project. Do not connect GitHub automatic deployments to this prepared artifact.

Read the new project ID (metadata, not a credential):

```sh
node --input-type=module -e "import {readFile} from 'node:fs/promises'; const p=JSON.parse(await readFile(process.env.JUDGE_RELEASE+'/.vercel/project.json')); console.log(p.projectId)"
```

Set private `projectId` to that ID. In the new Vercel project's Settings → Domains,
find its exact production domain. Set private `appOrigin` to `https://` followed by
that domain, without a trailing slash or path. Do not guess if Vercel assigns a
different domain. It must differ from `https://colorloop-nu.vercel.app`.

In the new project, enable **Automatically expose System Environment Variables**.
The runtime requires Vercel's real `VERCEL_PROJECT_ID` to match `JUDGE_PROJECT_ID`.
Use Node.js 22.x, framework Other, build `npm run build`, output `dist`; these are
also specified by the copied project configuration. For judge laptop access,
ensure the new production URL is not restricted to Vercel team members. Application
password authentication and MFA remain mandatory.

## 3. Initialize only the dedicated database

This is an explicit database-writing command. Run it only after approving
initialization of the newly created empty judge database and checking the private
host fields. It does not read the existing `.env` or use `DATABASE_URL`.

```sh
chmod 600 "$JUDGE_PRIVATE"
DOTENV_CONFIG_PATH=/dev/null node scripts/provision-judge-demo.mjs \
  "$JUDGE_PRIVATE" --confirm-new-empty-database
```

Expected output contains counts only: 8 fictional donors, 10 gifts, 3 campaigns.
It never prints passwords, database credentials, MFA secrets or recovery codes.
A second initialization refuses the existing schema without changing records.
If it fails, do not reset a database or alter migrations to force it through.
Errors now print only a sanitized code, fixed operation stage and safe message.
All passwords are checked against the complete existing policy before any database
operation. The third unprovisioned judge password was corrected privately after a
missing special character was diagnosed; use the current private file for handoff.

## 4. Set independent Vercel environment variables

After approving configuration of the new judge project:

```sh
DOTENV_CONFIG_PATH=/dev/null node scripts/configure-judge-vercel.mjs \
  "$JUDGE_PRIVATE" --confirm-judge-project
```

The helper checks the dedicated project link against the private configuration and
the protected main project before doing anything. It passes values through stdin,
marks them sensitive and suppresses CLI diagnostics that could contain values.
Repeating it updates only the explicitly linked judge project's listed variables.

| Variable | Value source |
| --- | --- |
| `COLORLOOP_ENVIRONMENT` | `judge` |
| `JUDGE_DATABASE_URL` | New private Neon connection string |
| `JUDGE_DATABASE_HOST` | Explicitly reviewed new hostname |
| `JUDGE_ENVIRONMENT_ID` | Generated private configuration |
| `MFA_ENCRYPTION_KEY` | Newly generated judge key |
| `APP_ORIGIN` | Exact new judge production origin |
| `JUDGE_PROJECT_ID` | New linked Vercel project ID |
| `EMAIL_DELIVERY_MODE` | `disabled` |
| `EMAIL_CRON_ENABLED` | `false` |
| `CIC_DONOR_AUTOMATION_APPROVED` | `false` |

Do not add `DATABASE_URL`, `RESEND_API_KEY`, `CRON_SECRET`, `AUTOMATION_USER_ID`,
`COLORLOOP_STORE` or `COLORLOOP_DEMO=true`. Do not attach a production Neon
integration that automatically injects `DATABASE_URL`. Do not copy main project
environment variables. Runtime configuration intentionally fails closed on these
conflicts. Reporting in the UI uses the judge role; no external reporting API key
is required for the demo.

## 5. Deploy only after explicit approval

The following publishes the **judge project's production target**, not CIC's main
website. It has not been executed. Use the prepared judge release directory only:

```sh
DOTENV_CONFIG_PATH=/dev/null node scripts/deploy-judge-demo.mjs \
  "$JUDGE_PRIVATE" --check-only

# Only after explicit deployment approval:
DOTENV_CONFIG_PATH=/dev/null node scripts/deploy-judge-demo.mjs \
  "$JUDGE_PRIVATE" --confirm-deploy-judge-only
```

The helper validates the release link again, refuses the main project, and invokes
`vercel deploy --prod --cwd` with the judge project/organization IDs explicitly set.
It cannot inherit a main-project ID from your shell. Check-only does not deploy.

Open the canonical `appOrigin` domain, not a different preview/hash deployment
hostname. Do not use the root project's stale `--prebuilt` output or the separate
synthetic build-verification fixture. Stop if the CLI names the main `colorloop`
project. Private configuration must remain outside the release directory.

## 6. Private judge handoff and hosted checks

1. On the new judge domain, the operator signs in with the private file's operator
   account and completes TOTP enrollment privately. Save recovery codes offline.
2. Deliver one `judges` entry per person through a password manager's private
   sharing feature or direct private handoff. Never send credentials in public
   Slack, the README, a demo recording or this chat. The addresses are generated
   login identifiers; no verification email is sent to their reserved domains.
   Never give judges the whole private file: it also contains database, operator
   and MFA-encryption credentials.
3. Each judge opens the public judge URL on their laptop, enters their own issued
   credentials and enrolls their own authenticator. Password-only access must fail.
   No CIC signup approval is needed because these accounts were privately provisioned.
4. Check Today, Donors, Imports, Outreach, Follow-ups, Reports and Settings. Maya's
   Giving → Preview donor impact (internal) shows clearly synthetic outcome evidence.
   Outreach permits review/approval but no send. Use only synthetic CSVs; repeat
   import must add zero new gifts. Users/roles APIs and cron must reject judge access.
   For approval only: Outreach → Drafts → Review draft → Optional manual handoff
   fallback → Approve current draft. Approval does not mean delivery.
5. Refresh, sign out, then sign in with a fresh authenticator code. Check that the
   main production website continues to use its own accounts. Local tests rejected
   judge sessions/credentials against a separate main-like database; actual hosted
   cross-site behavior is not claimed before approved deployment.
6. To revoke access afterward, the private judge operator uses Settings → Manage
   user account → Inactive. Password changes also revoke that user's sessions.
   Do not reset production accounts or delete either database as a shortcut.

## Validation and Auth0 decision

Local results: full suite **211 passed, zero failed, one live-Neon test skipped**;
four focused judge tests passed. A Chrome run against the actual judge-only source
package and disposable SQL verified all seven pages, private account login,
mandatory TOTP, refresh/logout/relogin with a genuine recovery code, synthetic
impact, CSV import/reimport, denied account administration and denied cron. It made
zero real email requests and had zero browser exceptions. These are not hosted tests.
The local Vercel package verifier additionally checks immutable judge mode, missing
configuration, absent main fallback, email/job blocking and private-file exclusion.
The normal main-mode Chrome regression also passed; a pre-existing polling race
was corrected to wait through draft-review rerenders. No application approval or
delivery check was weakened. Compiled packaging has five Node 22 functions and
19 static assets, and its actual XLSX worker was executed successfully.

Auth0 is **evaluated and deferred**, not installed or enabled. This application uses
opaque PostgreSQL sessions and its own TOTP flow; a safe Auth0 integration needs a
tested server-side OIDC callback/session bridge and explicit identity-to-role mapping.
Adding an untested authentication migration would put the working judge login at risk.

For a later judge-only Auth0 integration:

- Create a separate Regular Web Application using [Universal Login](https://auth0.com/docs/authenticate/login/auth0-universal-login).
  Restrict callback/logout URLs to the judge origin. Planned callback
  `/api/auth0/callback` is not implemented in this release.
- Enable an independent factor, such as OTP, and the **Always** policy in
  [Auth0 MFA settings](https://auth0.com/docs/secure/multi-factor-authentication/enable-mfa).
  Confirm the tenant supports the selected factors/policy before proceeding.
- Configure [email verification](https://auth0.com/docs/manage-users/user-accounts/verify-emails)
  with real judge identities and separately approved verification delivery. Do not
  mark email verified manually as a bypass or use the synthetic login identifiers.
- Proposed future variables: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`,
  `AUTH0_CLIENT_SECRET`, `AUTH0_COOKIE_SECRET`; currently none are consumed.
- Validate issuer, audience, signatures, expiry, state, nonce, MFA evidence and
  server-side sessions. Bind approved `(issuer, subject)` identities to restricted
  judge accounts, never by email alone or user-controlled role claims. Preserve
  existing main authentication, CSRF, revocation and authorization behavior.
- Test login, MFA, email-verification enforcement, logout, session expiry/replay,
  role revocation and cross-environment denial against the actual Auth0 tenant
  before any release. No Auth0 credentials or tenant have been configured here.
