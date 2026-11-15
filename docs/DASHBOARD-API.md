# CIC organizational dashboard read API

`GET /api/v1/metrics` requires a server-only `REPORTING_API_KEY` in an
`Authorization: Bearer ...` header. Never embed this key in a public dashboard's
JavaScript. Call from CIC's dashboard server. Missing/wrong keys fail before DB
access. The endpoint accepts GET only, disables caching and returns no donor names,
addresses, emails, gift rows or donor IDs.

Required parameters: `from` and `to`, real `YYYY-MM-DD` dates within one calendar
year, inclusive. Optional exact-match `program` and `boardMember` filters narrow
both giving and activity counts. Obtain board IDs through an authorized staff
session at `/api/assignments/members`; they are genuine account UUIDs.

```http
GET /api/v1/metrics?from=2026-01-01&to=2026-11-14&program=AI%20Academy
Authorization: Bearer <CIC-server-managed-key>
```

The JSON envelope is `{ "data": ... }`. Fields:

| Field | Meaning |
| --- | --- |
| from, to, program, boardMember | Applied scope |
| currency | USD; no exchange-rate conversion is performed |
| donorTotal | Distinct donors with positive verified completed USD gifts in scope |
| giftTotal | Verified completed USD giving in dollars |
| giftCount | Number of included gifts |
| activityCount | Recorded interactions within the selected dates and filters |
| byProgram | Giving groups `{name,total}`; empty name means unclassified |
| byBoardMember | Giving groups `{name,total}`; name is the board account ID, empty means unassigned |
| monthly | Giving groups `{month,total}` using YYYY-MM |

Activities now accept an optional genuine `program` through staff note entry and
POST/PATCH `/api/activities`. Historical activities with unknown program remain
unknown and are excluded only when a program filter is specified. Board grouping
uses current ownership, not invented historical attribution. API "recent activity"
means a period-filtered aggregate count, not a feed containing private notes.

401: invalid key; 400: invalid dates/filter; 405: wrong method; 503: missing key,
invalid stored report data or unavailable configuration; 500: safe report failure.
Errors use `{ "error": { "code": "...", "message": "..." } }`.

Use one query for each desired reporting period. To show program/member-specific
activity counts, repeat with that filter; gift breakdown arrays are returned in the
same response. Partial-year comparisons and classifications belong to the
session-protected `/api/reports/retention`; this machine endpoint intentionally
returns aggregates only. Keep the reporting key separate from session cookies,
CSRF tokens and the preparation job's `CRON_SECRET`.
