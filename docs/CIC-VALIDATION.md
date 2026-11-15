# Local validation results

All records and credentials in validation were synthetic. No Neon/external
database connection, hosted deployment, real message, commit or push occurred.

| Check | Result |
| --- | --- |
| Full `RUN_NEON_TESTS=false npm test` | 112 tests: 110 passed, 0 failed, 2 live-Neon cases skipped |
| New required-field/date/ownership/payment regressions | Pass, including styled numeric Excel dates and actual sample-shaped CSV/XLSX |
| Repeat import/giving totals | Pass; existing source/transaction IDs reuse gifts and drafts |
| Board privacy | Pass for both board-member eligibility flag and board-member role; other owners' donors/tasks/messages/reports rejected |
| Quarterly preparation | Pass: distinct donor/board drafts, dated tasks, retry and quarter-rollover deduplication |
| Manual handoff | Pass: approval/consent enforced, recipient changes rejected, handoff distinct from sent, human attestation retry-safe |
| Full-history packet | Pass through actual authenticated handler across 2026–2027 with verified evidence |
| Role retirement | Pass: users reassigned, sessions revoked, inactive grants rejected |
| Full and production npm audit | Zero known vulnerabilities reported |
| `npm run build` / real Vercel CLI build | Pass, Node 22; five actual frameworkless functions |
| Compiled Vercel output | 20 rewrite paths checked; private static paths excluded; packaged XLSX worker actually executed |
| HTTPS SQL integration smoke | Pass, including filtered program activity and key-authenticated aggregate API |
| Chrome SQL smoke | Pass: seven screens, real sample-shaped mapping/reimport, account safety, donor history, PDF, logout, zero browser exceptions |
| Responsive/keyboard visual audit | Pass: 28 screen/viewport checks, no detected overflow/contrast/label/render errors; all keyboard checks pass |
| Real Lighthouse 13.0.1 | Accessibility 100 on all seven authenticated main screens |
| Credential-pattern and static-output checks | No detected credential patterns in changed source; no `.env` in compiled output; only browser assets public |
| Syntax/whitespace | Pass |

The default test count includes pre-existing duplicate `... 2.js` test copies;
these were preserved rather than silently removed. Lighthouse full HTML/JSON
reports remain local under `artifacts/accessibility`; the compact actual measured
summary is retained at `artifacts/accessibility/summary.json`.

Scope limits: Lighthouse measures the tested main screens, not a complete WCAG
certification of every modal and input state. Local builds and isolated PostgreSQL
cannot certify hosted ingress, genuine provider exports, Neon transport/concurrency,
CIC account eligibility or real delivery. See `DEPLOYMENT-READINESS.md` for release
gates and `CIC-REQUIREMENTS.md` for the full traceability matrix and demo plan.
