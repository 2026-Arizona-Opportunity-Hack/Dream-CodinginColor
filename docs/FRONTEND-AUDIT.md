# ColorLoop visual and accessibility audit

Audited November 14, 2026 on `feature/frontend` against the CIC guidelines supplied
by the user. No push or deployment was performed. Changes in this audit are limited
to frontend HTML/CSS/JavaScript, the frontend audit runner, and documentation;
teammate database and authentication files were not changed.

## Results

| Check | Result |
| --- | --- |
| CSS palette | Pass: only the seven approved color values are declared; transparent borders and a translucent black dialog backdrop add no new brand hue |
| Green usage | Pass: primary green is confined to primary buttons; headings, navigation emphasis, table headings, charts and focus outlines use dark green |
| Typography | Pass: Arial/Helvetica sans-serif stack, 16px base, 1.5 body line height, 12–13px supporting copy, 11pt print body |
| Controls and spacing | Pass: consistent button borders/padding, minimum 44px button dimensions, readable field borders and stable active navigation alignment |
| Responsive layout | Pass: all seven screens checked at 1440×1000, 768×1024, 375×812 and 320×800; no document-level horizontal overflow |
| Tables | Pass: readable column widths, contained horizontal scrolling, visible mobile instructions, named keyboard-focusable scroll regions and arrow-key scrolling |
| Keyboard | Pass: skip link, navigation focus, visible 3px focus outlines, initial dialog focus, trapped dialog tabbing, Escape dismissal and focus return |
| Form labels | Pass: no unlabeled visible inputs/selects/textareas detected in the 28 screen checks; login inputs are explicitly labeled |
| Text contrast | Pass in tested views: no computed text pairs below WCAG AA thresholds |
| CIC logo | Not used: no approved asset exists in this checkout; ColorLoop and Coding in Color remain plain text, with no fabricated logo |
| Existing tests | Pass: `npm test`: 9 tests, 0 failures |
| Syntax/whitespace | Pass: browser module and audit runner syntax checks; `git diff --check` |

Representative contrast ratios:

| Foreground / background | Ratio |
| --- | --- |
| Dark green / white | 5.45:1 |
| Dark green / light green tint | 4.81:1 |
| Medium gray / white | 7.00:1 |
| Medium gray / light green tint | 6.18:1 |
| Black / primary green | 6.72:1 |

Light gray is used for supporting borders, not readable text or essential form
control boundaries. Primary buttons retain black text because white text on
primary green would not meet normal-text AA contrast.

## Fixes made

- Replaced off-palette table shading, input borders and red error text with CIC
  colors. Errors still have readable messages and alert semantics.
- Added explicit focus outlines, stronger control borders, larger supporting
  copy, line spacing, touch targets, responsive grids and long-content wrapping.
- Preserved readable mobile table columns using contained scrolling instead of
  squeezing words and action labels into narrow columns.
- Fixed the skip link so it focuses the current screen without routing to Overview.
- Moved focus to main content on navigation and into the first field when opening
  a dialog; restored focus after closing a dialog.
- Added contextual accessible names to repeated row actions and named table scroll
  regions. Empty action-column headers now read “Actions”.
- Set dynamically created action buttons to `type="button"` so dialog actions do
  not accidentally submit their containing form.
- Removed whitespace from the initially empty status element, eliminating an
  empty green notification square that appeared in screenshots.

## Reproduce the browser audit

```sh
npm test
node scripts/audit-frontend.mjs
```

Requires Node.js 22+ and local Google Chrome. On macOS the runner uses the standard
Chrome application path; elsewhere set `CHROME_PATH` to the Chrome executable.
Local server/browser permissions may be required. The runner starts a temporary
local fixture server and headless Chrome, checks all 28 screen/viewport pairs,
exercises keyboard behavior, and exits nonzero for detected failures. Screenshots
and `results.json` are written to the `colorloop-visual-audit` folder in the OS
temporary directory. The runner stops its server and Chrome when it finishes.

All records are synthetic audit fixtures; they are never part of the production
UI or database. Screenshots were also visually inspected for desktop, tablet and
mobile readability. This is a focused audit, not a full WCAG certification.

## Remaining checks before describing the app as production-ready

- Real backend/authentication modules and Neon reporting views are still missing
  in this checkout. Validate live permission-dependent screens, persistent donor
  data, imports, long histories and real error states after integration.
- Lighthouse/axe and manual screen-reader testing were not run. No 95+ Lighthouse
  accessibility score is claimed. Browser automation used local desktop Chrome;
  native iOS/Android behavior and other browsers remain unverified.
- If an official logo is later supplied, verify asset provenance and preserve
  its aspect ratio and colors. Render its icon at least 24px and reserve clear
  space equal to the height of the “C” in “Coding” on every side. The screenshot
  of the guidelines was not treated as a production logo asset.
- Changes remain local and uncommitted, including pre-existing untracked source
  files. Review the intended files and the proposed PR split before committing.
