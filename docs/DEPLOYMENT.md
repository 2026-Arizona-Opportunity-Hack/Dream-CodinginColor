# Vercel deployment

> Current requirements-branch behavior and deployment gates: [CIC-REQUIREMENTS.md](CIC-REQUIREMENTS.md), [DASHBOARD-API.md](DASHBOARD-API.md), and [DEPLOYMENT-READINESS.md](DEPLOYMENT-READINESS.md). Status/counts below may describe earlier teammate branches.

> Integration update: see [INTEGRATION.md](INTEGRATION.md) for current persistence,
> shared API mappings, synthetic HTTPS demo and deployment gates. Branch-specific
> status and proposed interfaces below describe the original teammate handoff.

1. Use Node.js 22+. Run `npm ci` and `npm test` from this repository.
2. Integrate teammate database/auth/workflow modules and the view contracts in
   [FRONTEND-INTEGRATION.md](FRONTEND-INTEGRATION.md). Apply migrations using the
   database owner's documented commands against a development Neon database.
3. Import this existing GitHub repository into the team's shared Vercel project.
   Select **Other**, repository root, no build command, output directory `.`.
   `index.html` and `public/` are buildless assets; `api/` contains Node Functions.
   Keep preview branches isolated from production donor data.
4. Configure server-only `DATABASE_URL`, a long random `REPORTING_API_KEY`, and
   teammate auth/email provider variables in Vercel environment settings. Never
   commit real `.env` values. Give preview deployments separate credentials.
5. Deploy `feature/frontend` as a preview. Validate the integration checklist
   below before merging through the repository's PR template. Production branch
   selection and access should follow the team's shared Vercel setup.
6. Add the actual Vercel URL and recorded demo URL to README. Neither exists yet.

`npm run dev` starts a dependency-free local preview at http://127.0.0.1:3000,
loads `.env`, and runs the three implemented reporting functions. Other APIs
return explicit 503 responses. It is a frontend/report harness, not a replacement
for the shared backend. Use the team's Vercel CLI (`vercel dev`) for full function
routing after integration. No production deployment was performed here.

## Integration acceptance checklist

- Sign in using real session auth; logged-out/restricted users cannot retrieve
  retention or funder data. Validate role changes cannot escalate privileges.
- Seed synthetic Neon donor history and compare retention with the definitions
  and automated fixtures. Exercise leap years, empty years and partial years.
- Import CSV/XLSX, map columns, inspect duplicate/error previews, confirm once,
  reload, and verify persistent deduplicated gifts.
- Expand a donor and verify every gift against the database. Confirm pagination
  handling if the shared API paginates. Edit custom values, archive, add a gift
  and note, then reload. Preview a merge and verify canonical combined history.
- Create/reassign/complete a task. Edit an outreach draft, approve the saved
  version, then send; server must reject sending unapproved or modified drafts.
- Create/edit/hide/deactivate custom fields and archive a campaign. Reload to
  verify Neon persistence. Verify members/roles reflect server permissions.
- Prepare funder gift history and verified outcomes; print to PDF. Verify no
  unverified or unrelated outcomes appear and empty evidence is handled honestly.
- Test the aggregate endpoint with missing, wrong and valid bearer credentials;
  inspect response for absence of donor PII. Verify period/program/member filters.
- Test at 375px, tablet and desktop; use keyboard only for navigation/dialogs,
  inspect screen-reader labels and run Lighthouse accessibility (target 95+).
  Browser/Lighthouse checks were not available in this coding environment.
- Verify HTTPS, HttpOnly/Secure/SameSite cookies, request-size limits, import
  validation, CSRF protections and secrets configuration with backend owners.
