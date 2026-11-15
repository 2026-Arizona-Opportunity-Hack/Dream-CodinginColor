# Deployment readiness and operating cost

No deployment, external database connection, production migration or real message
was performed. The application remains vanilla HTML/CSS/JS plus Node 22 and Neon
PostgreSQL. Use the CIC-owned repository and hosting accounts.

## Local build evidence

The approved temporary tools were Vercel CLI 48.10.0 and Lighthouse 13.0.1. They
were installed outside the project; no application dependency was added.

A real `vercel build` completed with synthetic local `.vercel/project.json`
settings and an empty preview environment. That configuration is deliberately not
a linked Vercel project and must not be used as a deployment target. It is ignored
by Git. Replace it through authorized project linking before any hosted work.

The output contains five Node 22 functions: the dispatcher, health, retention,
funder and machine metrics handlers. Existing URL/method behavior is preserved;
two-line per-endpoint wrappers were replaced by the shared dispatcher, also used
by the local HTTPS server. Native report/health handlers remain available.
The compiled API rewrite and worker/static paths are checked by:

```sh
node scripts/verify-vercel-build.mjs
```

Only `dist/index.html` and `dist/public/...` are public. Database migrations,
server modules, package files and `.env` are not static assets. Function packages
contain server code as expected; they are not public downloads.

## Cost decision

CIC's cap is $20/month plus $250 setup. Five functions fit the documented Hobby
frameworkless limit of 12. This resolves the previous 33-function capacity issue,
but does not determine account eligibility or guarantee zero hosting cost.

- Confirm whether CIC's organization/account can use an eligible Hobby or sponsored
  arrangement; do not assume personal/noncommercial plan eligibility.
- Alternatively, Vercel Pro has a $20/month base fee including one deploying seat.
  Additional deploying seats, usage and add-ons can exceed the cap. Application
  users/board accounts do not each require a deploying seat.
- Use a suitable free/sponsored Neon allowance only after checking its current
  capacity, retention and usage conditions with CIC. No plan was purchased here.
- Manual handoff requires no delivery-provider subscription. A future provider
  adapter would require a separate cost/security decision.
- Verify the combined hosting/database/delivery cost and configure spending
  controls. The $250 setup allowance is not recurring headroom.

References checked during the audit:
https://vercel.com/docs/functions/runtimes
https://vercel.com/docs/plans/pro-plan
https://vercel.com/docs/plans/hobby

## Configuration

| Server variable | Purpose |
| --- | --- |
| DATABASE_URL | Authorized Neon target, TLS required; never browser-exposed |
| APP_ORIGIN | Exact HTTPS site origin for login, Origin validation and CSRF |
| REPORTING_API_KEY | Long random key for CIC's server-side aggregate dashboard |
| CRON_SECRET | Separate random secret >=32 characters for draft/task preparation |
| AUTOMATION_USER_ID | Genuine active, non-board preparation account with tasks.manage and outreach.write, or an explicitly authorized administrator |

Never deploy with `COLORLOOP_DEMO=true` or `COLORLOOP_STORE=mock`. Demo storage is
rejected on Vercel/production. Local `DEMO_PASSWORD` is synthetic only. No default
production password or invented historical account exists.

The daily cron calls GET `/api/jobs/prepare` at 06:00 UTC using Vercel's configured
Bearer secret. POST is also supported for an authorized operator. It creates
idempotent thank-you, quarterly donor/board and overdue drafts/tasks and never
sends messages. Both secret and genuine account permissions are checked. Leaving
configuration absent keeps the job unavailable; it does not weaken authentication.
Browser mutations continue to require session cookies, exact Origin and CSRF.

## Authorized release checklist

1. Resolve CIC hosting eligibility, budget, ownership and app access policy.
2. Link the actual CIC-owned Vercel project only after authorization; replace the
   local synthetic metadata. Pin runtime to Node 22 and retain the safe build.
3. Create an authorized nonproduction Neon target. Rehearse clean installation and
   a populated-001 upgrade, inspect unresolved historical identities, then bootstrap
   genuine accounts. Do not invent owners or attribute old imports to a new user.
4. Create active board accounts and balance unassigned donors. Create the genuine
   preparation account; grant only its required capabilities.
5. Configure server-only variables. Review ordered checksum-protected migrations
   001, 001a, 002, 003, 004, 005. Apply only to the separately approved target.
6. Deploy an authorized Preview. Verify all existing/new API paths and methods,
   static private-path 404s, XLSX worker, sessions across instances, board isolation,
   CSRF/Origin rejection, and trusted Vercel client-IP behavior.
7. Exercise the daily job twice with synthetic data; verify identical draft/task
   identities, no outbound delivery, and genuine-account authorization.
8. Repeat HTTPS/Chrome, Lighthouse and import tests with sanitized full Zeffy and
   Benevity samples. Do not infer payment metadata or historical identities.
9. Validate manual handoff with CIC. Any real sender/provider integration remains
   a separate reviewed action; a handoff does not prove delivery.
10. Record the <=4 minute video, add actual live/video links to README, complete the
    project story, and submit through the Team Dashboard before the deadline.
