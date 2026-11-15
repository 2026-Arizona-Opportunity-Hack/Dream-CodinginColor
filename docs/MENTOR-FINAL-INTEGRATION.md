# Final mentor integration

Branch: `integration/mentor-final`, in a separate Git worktree at
`/private/tmp/colorloop-mentor-final`. The original checkout remains on
`feature/mentor-ux` at `8df801d` with its files/configuration preserved.

Integration order:

1. Refreshed `origin/main`: `adeac280ae878653960f099e468dc087b867767e`.
2. Merged backend: `85b1985542bcb4a7ebb7b1dc7f1b0f153104207e`.
3. Merged frontend: `8df801d4e2cf04573edab2aedf306231194c0f7e`.

No merge into main, force push, deployment, shared-Neon operation or secret/MFA
configuration change was performed. Tests use isolated synthetic PostgreSQL and
temporary HTTPS certificates. Process-local test encryption keys are generated
only for disposable test accounts; existing account configuration is untouched.

## Conflict resolution

Only two files had content conflicts:

- `scripts/smoke-browser.mjs`: retained the backend's explicit independent-identity
  reason and `allow_duplicate:true` for the intentionally distinct synthetic donor.
  Retained all frontend UI/MFA regression checks. Enhanced mentor scenarios now run
  unconditionally in the integrated suite, so a normal invocation cannot silently
  skip manual entry, gift review, server-preview merges or approval/handoff checks.
- `scripts/verify-vercel-build.mjs`: retained backend checks for all 41 routes,
  executable packaged OpenAPI and anonymous access denial. Retained the frontend's
  complete static allowlist comparison against current source bytes.

README merged automatically. Its current integration status and links were updated;
branch-specific handoff/validation documents are labeled historical. Production
backend/security source exactly matches the reviewed backend branch. No security
requirements were weakened to resolve a test or merge conflict.

## Measured verification

Runtime: Node 22.23.5. Existing lockfile dependencies were installed separately
inside the integration worktree. The install reported zero vulnerabilities.

| Check | Result |
| --- | --- |
| `RUN_NEON_TESTS=false node --test` | 154 tests: 153 passed, 0 failed, 1 opt-in live Neon test skipped |
| `node scripts/smoke-integration.mjs` | Pass, genuine HTTPS/cookie/CSRF/API adapter and isolated SQL |
| `node scripts/smoke-browser.mjs` | Pass, integrated server and UI, zero browser exceptions |
| `node scripts/audit-frontend.mjs` | 75 views passed: desktop, tablet, 390px, 320px and 200% reflow simulation; keyboard, palette, labels and contrast passed |
| Real Lighthouse 13.0.1 | 100 accessibility on all 19 measured views, including donor sections, merge review, outreach, funder packet and post-upload import stages |
| Local Vercel CLI production build | Pass with synthetic ignored project metadata; no real project linked or deployed |
| `node scripts/verify-vercel-build.mjs` | Five Node 22 functions, all 41 routes verified, 17 current browser assets, executable packaged XLSX/TOTP/QR/OpenAPI, protected read rejects anonymous access, no private static assets |
| Whitespace/conflict markers | `git diff --check` and conflict-marker checks passed |
| Preservation | Original untracked/local configuration file fingerprints match the pre-integration snapshot |

[Lighthouse measurements](../artifacts/accessibility/summary.json) were refreshed
from this integrated worktree. Full local reports are ignored artifacts.

The full suite and integrated browser checks cover:

- Manual donor creation, notes, owner assignment, explicit distinct-donor decisions
  and stable save keys.
- Gift review before saving, cash/offline gifts, double-submit protection,
  idempotent retries and conflicting keys, unknown currency/status exclusion.
- Server-issued actor/direction/reason-bound merge previews, independent identity
  confirmation, blockers, expiry/stale graph rejection, fresh review and graph/
  gift/evidence preservation. No local-only preview authorizes a merge.
- Grouped campaign approvals, row exceptions, named ownership decisions, import
  confirmation/history and reimport of five synthetic gifts totaling $2,600 without
  increasing those transaction totals.
- Contextual donor navigation and search preservation, categorized histories,
  named follow-ups and assignment to the signed-in user.
- Edit → approve current revision → locked handoff → evidence-backed human send
  record. No automatic-send API call or external message delivery occurs.
- Verified funder giving/outcomes and a real printable PDF.
- Password and real TOTP/recovery flows, secure sessions, sign-out/Back/session
  expiry, board-scoped navigation/data, administrator role safety, RBAC and CSRF.

## Reproduce on the integrated branch

Use Node 22 and a local Chrome installation. `CHROME_PATH` may override Chrome.
No `COLORLOOP_TEST_BACKEND` override is needed: the integrated checkout is both
server and frontend, and the full browser scenarios always run.

```sh
npm ci
RUN_NEON_TESTS=false npm test
npm run build
node scripts/smoke-integration.mjs
node scripts/smoke-browser.mjs
node scripts/audit-frontend.mjs
LIGHTHOUSE_MODULE=/absolute/path/to/lighthouse/core/index.js \
  node scripts/audit-accessibility.mjs
```

Run the local Vercel build using reviewed local-only project settings, then
`node scripts/verify-vercel-build.mjs`. Do not deploy synthetic local metadata.
None of these checks requires copying the original `.env` or connecting to Neon.

## Remaining limitations

- Hosted Vercel behavior, shared-Neon concurrency and manual screen-reader/native
  device checks remain external release verification; local checks do not certify
  those environments.
- Original import-file downloads, confirmer attribution, radar snooze and complete
  task/import revision feeds remain outside the current backend contract. Their UI
  states are honest and unavailable rather than simulated.
- Some list/radar summary metadata requires opening a donor profile. Task and note
  updates remain separate operations with explicit partial-error handling.
- No approved CIC logo asset was supplied; existing text branding is retained.

The feature branches and main remain intact. Only `integration/mentor-final` is
intended to be pushed from this integration run. Main merge, deployment, production
writes and secret changes still require the user's approval.
