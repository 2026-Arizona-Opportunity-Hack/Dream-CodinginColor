# Mentor UX implementation

Integration update: both mentor branches are combined on `integration/mentor-final`.
See [final integration results](MENTOR-FINAL-INTEGRATION.md) for current validation.
The branch-specific history below is retained for reference.

Implemented on `feature/mentor-ux`, starting from approved main `adeac28`.
Primary design reference: the supplied 15-page **ColorLoop-UX-Uplevel-Review.pdf**.
The review describes an older UI; existing grouped campaign approvals, donor
selection, date formatting, notifications, responsive rows and MFA are preserved.
Copy follows the mentor's [Unslop guidance](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md).

The frontend targets Laptop 2's backend `85b1985`. That branch was fetched and
read, not merged. Backend integration tests used an ignored, isolated source copy
with the current frontend served as its static root. No backend/authentication
source, migrations, dependencies, keys or shared Neon data were changed.

## PDF recommendation matrix

| PDF pages | Recommendation | Implementation / remaining work |
| --- | --- | --- |
| 2–5, 14 | Start with actionable work | Today prioritizes overdue, today and next-seven-day follow-ups, pending outreach, current import review, saved previews and radar. Every queue item opens work or a donor. YTD verified giving is secondary. No duplicate report filters or floating bar chart. |
| 4, 10 | Frequency-based navigation | Staff order is Today, Donors, Outreach, Follow-ups, Reports, Imports, Settings. Board-scoped accounts, including custom board roles, get My donors, My follow-ups and My drafts. Server authorization remains authoritative. |
| 4, 11 | Remove repetitive decoration | Removed screen eyebrows, poetic subtitles and the inert workspace badge. Black page titles, green section headings, readable copy and primary workflow actions retain CIC branding. |
| 4, 6 | One donor, one navigable page | `#donors/:id?tab=giving` opens a donor page. Giving, Timeline, Outreach, Follow-ups and Details are normal navigation links with active state. URLs, Back, search and sort state are retained. Editing is a focused form rather than a combined history/edit dialog. |
| 6, 13 | Categorized timeline | Gifts/imported gifts, notes/interactions, draft preparation, approval/handoff/delivery events and current follow-up records have text labels, dates and type filters. Names are resolved where supplied or known; missing actor names are stated. Task revision and import-audit event feeds are not exposed by the current APIs. |
| 6 | Donor list hierarchy and context | Donor names link to profiles. Search, owner/name/giving sorting, verified USD totals, permission-scoped YTD retention categories and the next task/draft are shown. Quick actions preselect the donor for drafting, follow-up, gift and edit. Bulk ownership and duplicate comparison are secondary. Last-gift details require opening the profile because the donor list DTO lacks that summary; no per-donor bulk fetch storm was added. |
| 6, 12 | Human-reviewed duplicate comparison | Real server preview supplies side-by-side identities, contact preferences, affected graph counts, blockers, warnings and expiry. Independent identity confirmation and review are explicit. Confirmation sends `preview_id`, `confirmed:true`, `identity_confirmed:true`, unchanged identities and reason. Stale/failed previews disable retry until a new preview is reviewed. No client merge logic or local-preview fallback. |
| 7, 12 | Upload → Map → Review → Confirm | Progress strip, source choices, mapping summaries, collapsed editable matches/optional fields, readable row review, Back controls and a separate final confirmation. Campaign groups, row exceptions, ownership decisions, unknown payment review, presets and stable transaction behavior are preserved. Required decisions disable progression. |
| 7 | Source guidance and identity labels | Zeffy/Benevity choices precede generic/custom sources. Expected columns are explained. Donor and owner choices show readable names; owner choices include genuine active-assignment counts. Source namespace is explicit and rechecked before confirmation. Provider-specific downloadable sample files were not invented without approved samples. |
| 7, 12 | Import memory and audit trail | The active wizard survives navigation in memory and is cleared on sign-out. New paginated import-history/detail APIs display batch status, dates, validation and row results. Original-file downloads and confirmer identity are absent from the backend contract. After reload, mapping reconstruction requires the original file, same source and stable transaction IDs. No false resume/confirm action is offered for metadata-only previews. |
| 8 | Radar starts outreach | Needs attention, Drafts and History views have counts. Inactivity and matched-cycle modes have explicit explanations. Radar cards show known dates, reasons, consent state and contextual next actions. Last-gift amount/program/owner enrichment remains in the donor profile when absent from the radar DTO. Snoozing has no API and is stated as unavailable. |
| 8, 12 | Visible human approval chain | Inline draft review shows Draft → Approved → Handed off → Human-reported sent. Editing warns about renewed approval. Save-and-approve uses the returned revision in the same visit. Handoff is copy-ready; human send needs evidence. Removed the automatic-send button. No provider delivery is claimed or invoked. |
| 8–9, 12 | Replace raw donor ID fields | The existing searchable, keyboard-operable donor picker is reused for outreach, follow-ups and funder packets. Profile/list actions preselect actual donor IDs internally. People see names and emails. |
| 9 | Triage follow-ups | Tasks group by overdue, today, next seven days, later and closed. Donor links, local dates, readable owner names, status and contextual update actions are visible. Me assignment is retained. Notes become real activity records; note/task writes remain separate operations, with partial-save errors explained and saved notes cleared before retry. |
| 9 | Honest reports | Explicit totals and periods, numerical zeroes only when returned, missing-rate “N/A” plus a reason, YTD/history caveats, readable attribution, category donor links and a funder-packet card. Filters collapse on mobile. |
| 9, 12 | Funder packets start with a donor | Donor action or searchable selection → full-history/default or period picker → preview → Print / Save as PDF. Selected scope survives reload in the URL. Verified completed USD gifts and staff-recorded outcome evidence are separately labeled; missing evidence is explicit and impact is never inferred. |
| 4, 11 | Shorter settings pages | Team and roles, Fields and campaigns, and Outreach settings are separate URL-backed views. Existing templates, custom fields, campaigns, roles and account safety policies remain. Restricted administration controls are not rendered for board/non-admin accounts. |
| 10, 13 | Mobile and reflow | Compact initials account control, bottom navigation with More, wrapping profile navigation and complete stacked record rows keep actions reachable without page scrolling sideways. Notices remain in flow, dismissible and automatically expire. 390px, 320px, tablet, desktop and 200% reflow simulation were checked. Primary actions stay in document flow rather than becoming sticky overlays. Native device/browser zoom remains a manual release check. |
| 11 | Design system | Approved seven CIC colors and Arial stack retained. Light gray is decorative, control borders/focus use darker colors, all statuses use words, and errors have strong borders and action text. The PDF's optional amber/red/#111 additions were not used because CIC's supplied official palette is stricter. No logo was invented. |
| 11, 13 | Preserve accessibility | Skip link, visible 3px focus, dialog trapping/return, labels, semantic headings/tables, native donor selection and 44px controls are retained. The existing eight-second, focus-aware notice timer is preserved instead of replacing it with the PDF's older four-second proposal. |
| 14 | Demonstrate outcomes with Diana | Useful-action time, weekly reconnection rates and draft-rework time require nonprofit usability sessions and actual operational observations. No measured impact or usability result is invented. |

## Validation

All writes used synthetic disposable SQL. There were no shared database resets,
real messages, main merges, deployments or secret rotations.

| Check | Result |
| --- | --- |
| Node 22 full regression suite, `RUN_NEON_TESTS=false` | 132 tests, 131 passed, 0 failed, 1 opt-in Neon test skipped |
| New frontend contract tests | 9 passed: route state, currency/unknown totals, categorized history, local urgency, custom board scope, pagination, server merge contract, draft revision and gift idempotency transport |
| Real Chrome + HTTPS + isolated SQL | Pass against backend `85b1985`; manual donor/gift review, double-submit guard, unknown payments, stale-preview refusal/fresh review, merge graph preservation, inline approval/handoff/human attestation, import/reimport, history, Me follow-up, board/mobile navigation, real MFA/session flows and funder PDF; zero browser exceptions |
| Responsive/keyboard/palette audit | 75 views passed; no page overflow, text-contrast, small-text, label or render errors; skip/dialog/navigation/table checks passed |
| Reflow method | 1440px, 768px, 390px and 320px CSS widths, plus 720px at 2x scale as a 200% desktop reflow simulation |
| Real Lighthouse 13.0.1 | 100 accessibility on 19 views: seven main screens, five donor sections, duplicate review, two additional outreach views, funder packet and three post-upload import stages |
| Build | Static build allowlists 17 browser assets. Real local Vercel CLI build passes with five Node 22 functions; 33 existing routes verified, packaged XLSX/TOTP/QR executed, and packaged browser assets compared with current source |
| API integration smoke | Existing real HTTPS/SQL/adapter smoke passes against the approved baseline; expanded Chrome test covers the new backend integration |
| Protected files | No changes under `api/`, `lib/`, `db/`, auth/MFA modules, package manifests or lockfile |

Measured Lighthouse summary: [accessibility summary](../artifacts/accessibility/summary.json).
Full reports remain ignored local artifacts. These local measurements are not
hosted Vercel or live Neon verification and are not a complete WCAG certification.

## Remaining before a hosted release

- Integration owner must combine this frontend with backend `85b1985` through the
  normal reviewed integration process. This frontend branch alone cannot authorize
  merges or use the enhanced manual-entry contracts against the older backend.
- Add original-file retrieval/retention and confirmer attribution only through an
  approved backend contract. Add snooze and task/import revision feeds before
  presenting those actions or events as available.
- Consider bounded donor-list last-gift summary fields and radar gift/context
  enrichment; avoid loading every donor's full history just to draw a list.
- Complete manual VoiceOver/NVDA, native mobile/browser and real zoom checks,
  hosted Lighthouse/routing/MFA checks, and a usability walkthrough with Diana.
- No approved CIC logo asset was supplied. Current text branding is deliberate.

See [Laptop 2 integration handoff](MENTOR-UX-HANDOFF.md) for exact contracts,
changed files and reproducible validation commands.
