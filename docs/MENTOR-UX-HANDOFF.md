# Laptop 2 frontend integration handoff

Frontend branch: `feature/mentor-ux`, based on `adeac28`.
Backend contract verified: `origin/feature/mentor-backend`, commit `85b1985`.
No branches were merged and no backend source was modified during this work.

Use the [PDF recommendation matrix](MENTOR-UX-IMPLEMENTATION.md) as the completion
record. Historical `UX-POLISH.md` and `FRONTEND-AUDIT.md` describe earlier passes.

## Required contract connections

- Browser cookie/CSRF/MFA transport is unchanged. No reporting API key appears in
  browser code. Unauthorized/MFA transitions keep using `auth-ui.js` and the server.
- `/merges/preview` is a real POST. Adapter maps chosen donor IDs to
  `canonical_donor_id,merged_donor_id,reason`. UI renders the server's identity,
  affected, blockers, warnings and expiry fields. Confirmation includes the exact
  same identities/reason plus `preview_id,confirmed:true,identity_confirmed:true`.
  Any stale/error result requires new preview/review. Never restore the old local
  comparison adapter or silently omit the confirmation fields.
- Manual donor POSTs use `idempotency_key`, optional `notes` and a reviewed owner.
  A duplicate response offers a deliberately distinct-record decision with a reason;
  there is no automatic override. Donor PATCH keeps the existing fields contract.
- Manual gift POSTs retain one `idempotency_key` through review/retry, use consistent
  cash/check/offline source labels, actual optional transaction references and notes.
  Unknown currency/status are null. A possible duplicate requires independent
  review and explicit distinct-gift confirmation/reason. No transaction reference
  is generated to bypass duplicate detection.
- `mentor-data.js` reads new paginated `{items,has_more}` envelopes completely.
  `/v1/follow-ups` supplies donor/owner names; the legacy task read is used only
  when that route is absent with 404/405. Permission failures are not bypassed.
  `/v1/overview` receives an explicit local `on` and account `time_zone`.
- `/imports/history` and `/imports/{id}` show real paginated batch/row metadata.
  Presets, upload bytes, mapping, payment review and confirmation decision shapes
  remain the same. In-memory wizard retention is not durable file retention.
- The adapter updates its draft-revision cache after a save/approval/handoff, so
  Save edits and approve sends the revision just returned by the server. Handoff
  and human-reported send remain separate. No automatic-send UI calls remain.

Backend reference:
[contracts at 85b1985](https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor/blob/85b1985/docs/MENTOR-BACKEND-CONTRACTS.md),
[OpenAPI at 85b1985](https://github.com/2026-Arizona-Opportunity-Hack/Dream-CodinginColor/blob/85b1985/docs/openapi-readonly.json).

## Changed files

| Area | Files |
| --- | --- |
| Shell and navigation | `index.html`, `public/css/app.css`, `public/js/app.js` |
| Browser transport | `public/js/api.js` |
| Donor views and forms | `public/js/donor-view.js`, `donor-profile.js`, `donor-workflows.js`, `duplicate-review.js` |
| Daily work and outreach | `public/js/mentor-data.js`, `mentor-screens.js`, `followups-ui.js`, `outreach-ui.js` |
| Import presentation | `public/js/imports.js`; existing `import-review.js` decision algorithm is unchanged |
| Build packaging | `scripts/build-static.js`, `scripts/verify-vercel-build.mjs` |
| Frontend validation | `tests/mentor-ux.test.js`, `scripts/smoke-browser.mjs`, `audit-frontend.mjs`, `audit-accessibility.mjs`, `artifacts/accessibility/summary.json` |
| Documentation | README and these two mentor UX documents |

The explicit static allowlist now includes all 17 browser assets. Keep this list
when integrating; do not copy server files or the OpenAPI source into public assets.
The local Vercel build used synthetic ignored metadata, not an actual linked CIC
project. Five functions and the existing shared routing remain unchanged here.
Laptop 2's backend adds its own new route checks; rerun those after integration.

## Reproduce safely

Use Node 22 and existing locked dependencies. Browser tests create fresh isolated
PGlite databases and local HTTPS certificates; do not substitute shared Neon.

```sh
RUN_NEON_TESTS=false npm test
npm run build
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
```

To test the current frontend against backend `85b1985` without merging branches,
fetch it and extract a testing copy inside this repository's ignored cache:

```sh
git fetch origin feature/mentor-backend
mkdir -p node_modules/.cache/mentor-backend
git archive 85b1985 | tar -x -C node_modules/.cache/mentor-backend
COLORLOOP_TEST_BACKEND="$PWD/node_modules/.cache/mentor-backend" \
  RUN_NEON_TESTS=false node scripts/smoke-browser.mjs
```

Use a fresh cache folder when testing another backend revision. The test harness
uses that copy's server with this branch's static frontend. It never merges code,
resets Neon, or deploys. The new manual-entry/merge browser assertions run when
`COLORLOOP_TEST_BACKEND` is set; keep it set for the full integration check.

Lighthouse requires an installed approved Lighthouse 13 module and local Chrome:

```sh
LIGHTHOUSE_MODULE=/absolute/path/to/lighthouse/core/index.js \
  COLORLOOP_TEST_BACKEND="$PWD/node_modules/.cache/mentor-backend" \
  node scripts/audit-accessibility.mjs
```

Chrome can be overridden with `CHROME_PATH`. The audit explicitly asserts its
requested post-upload import stage before reporting a Lighthouse score. It does
not submit the final import or send any message. A local Vercel build should be
followed by `node scripts/verify-vercel-build.mjs`; do not run a deploy command.

## Remaining API enhancements

- Original import-file retrieval, confirmed-by identity and safely resumable
  mapping payloads after reload are not in the current read-only contract.
- Radar snooze needs a genuine permission-checked write endpoint and persisted
  deadline before the UI can offer “Snooze 30 days”.
- Task revision/import event feeds and additional actor names need scoped reads
  before they can become historical timeline events.
- Bounded donor-list last-gift metadata and radar gift/program/owner context would
  avoid per-donor full-history reads. Current UI links to genuine profile data.
- Atomic task completion plus an interaction note needs a transactional endpoint;
  the current UI reports partial failures rather than claiming atomic success.

Review and integrate the two feature branches through the team's normal process.
Then rerun backend tests, these frontend checks, the local production build and
hosted release checks. No main merge or deployment is part of this handoff.
