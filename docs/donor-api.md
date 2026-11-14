# Donor API contract

These are intended file-based Vercel paths, **not verified deployed URLs**. No
frontend or deployment settings were changed. Root `api/` functions use Node.js
ES modules; see [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js).
Index handlers live in their resource folders; `[id].js` uses `req.query.id`.
Each route is protected by the shared auth adapter. All successes use
`{ "data": ... }`, and errors use `{ "error": { "code": "...", "message": "..." } }`.
Responses have `Cache-Control: no-store` and no stack traces or SQL.

| Method and path | Permission | Input / output |
| --- | --- | --- |
| GET `/api/donors` | donors.read | `q`, `limit`, `offset`; summary array without email/phone |
| POST `/api/donors` | donors.write | Donor object; created donor (201) |
| GET `/api/donors/:id` | donors.read | Full donor record including custom values |
| PATCH `/api/donors/:id` | donors.write | Allowlisted donor changes; updated donor |
| GET `/api/donors/:id/donations` | donors.read | `limit`, `offset`; donation array |
| POST `/api/donations` | donations.write | Donation object; `{donation, duplicate}` (201) |
| POST `/api/imports/preview` | imports.manage | File JSON; saved preview (201) |
| POST `/api/imports/confirm` | imports.manage | Batch ID and row decisions; row audit results |
| GET `/api/merges/candidates` | donors.write | `limit`, `offset`; uncertain candidate pairs |
| POST `/api/merges` | donors.write | Canonical/merged IDs and reason; merge summary |
| GET `/api/custom-fields` | donors.read | `limit`, `offset`; field definitions |
| POST `/api/custom-fields` | settings.manage | Field definition; created definition (201) |
| PATCH `/api/custom-fields/:id` | settings.manage | Label, rules, or active flag |
| GET `/api/campaigns` | donors.read | `limit`, `offset`; active campaigns |
| POST `/api/campaigns` | settings.manage | `{name}`; created campaign (201) |
| PATCH `/api/campaigns/:id` | settings.manage | `{name?, archived?}` |

Pagination defaults to 25, max 100, with offset 0–100000. Clients requesting
more than 100 field definitions must paginate. Search is case-insensitive literal
name/company substring matching; `%` and `_` do not become SQL wildcards.

Donor input: `donor_type` (`person`/`organization`), `display_name` (required),
optional `first_name`, `last_name`, `normalized_email`, `phone`, `company`,
`custom_data` object, and boolean `archived`. Unknown keys, IDs, timestamps,
and assignment fields are rejected. Archive with PATCH; no DELETE endpoint exists.
Email is trimmed/lowercased, never used as a unique identifier on its own.

Donation input: `donor_id`, positive `amount` (decimal string recommended),
`donation_date` (`YYYY-MM-DD`), `source`, optional `external_transaction_id`,
`campaign_id`, `program`. Amounts support up to 10 integral digits and 2 decimal
places. Dates must be real ISO calendar dates. Currency-formatted spreadsheet
values must be cleaned before import. Gifts to archived donors/campaigns are
rejected. Source+transaction ID is unique; exact retries return the existing gift,
but conflicting donor/amount/date/campaign/program return 409. Missing external
IDs never imply uniqueness of donor/amount/date.

Custom definition input: `key` (immutable snake_case), `label`, immutable
`field_type` (`text`, `number`, `boolean`, `date`, `select`), `validation_rules`,
optional boolean `active`. Rules support `required`, `max_length` (text, max 2000),
`min`/`max` (number), and `options` (select). Arbitrary regex rules are not accepted.
Deactivation preserves existing JSONB values. New submitted values must use active
keys and the configured types; custom_data replacement is explicit, not a merge.

## Import workflow

Send a JSON upload to preview, not multipart:

```json
{
  "filename": "synthetic.csv",
  "source": "zeffy",
  "content_base64": "<base64 file bytes>",
  "mapping": {
    "display_name": "Supporter",
    "email": "Email Address",
    "amount": "Gross Amount",
    "donation_date": "Gift Date",
    "external_transaction_id": "Transaction ID",
    "custom:interests": "Interests"
  }
}
```

Mapping keys are internal field names and values are exact spreadsheet headers.
Omit mapping to use unambiguous common headers. Supported targets are donor_type,
first_name, last_name, display_name, email, phone, company, amount, donation_date,
board_contact, campaign_id, campaign, program, source, source_donor_id,
external_transaction_id, and `custom:<key>`. The request-level source is
canonical for the whole batch; a mapped source cell never changes transaction
namespace. Use stable, consistently spelled source names. Providers must supply
stable transaction IDs; do not map a donor ID or payment group ID as a gift ID.

Zeffy, Benevity, CIC, and generic spreadsheets use this mapping workflow; their
actual export variants have not been tested without synthetic samples. Map their
column labels explicitly, normalize dates to ISO and amounts to decimal, and
create custom definitions/campaigns before preview. A campaign name must match
exactly one active campaign; campaign_id is preferred. XLSX reads the first sheet.
Organization rows can set donor_type explicitly; company-only records default to
organization. Custom field strings are not implicitly coerced to numbers/booleans.

Preview returns batch_id, expiry, headers/mapping, validation counts, and each
source row number with normalized data, matching candidate UUIDs, reason, and
warnings/errors. A matching UUID refers to `/api/donors/:id` for authorized review.
No raw file is retained. Invalid rows block the whole confirmation: correct the
file and upload a new preview. Expiry is 24 hours.

```json
{
  "batch_id": "<preview UUID>",
  "decisions": {
    "2": { "donor_id": "<candidate UUID>" },
    "3": { "donor_id": "new", "allow_possible_duplicate": true }
  }
}
```

Only the authenticated preview owner can confirm. Confirmation uses saved rows;
clients cannot substitute data. It rechecks definitions and matches under an
advisory transaction lock. Review decisions use source row numbers, including the
header row (first data row is 2). Select a proposed candidate or `new` for uncertain
identities; names alone never auto-link. An unambiguous email **plus donor type and
normalized display identity** may link. Trustworthy scoped source donor identifiers
and existing gift identifiers are also considered, with identity conflicts rejected.

Existing donors' contact/custom data is preserved when linking; edit their profile
separately to apply intentional changes. Importing creates donors or links gifts,
never silently overwrites a profile. Board contacts remain audit-only. For gifts
without source transaction IDs, matching donor+amount+date warns/requires explicit
review, including earlier gifts within the same confirmation. Choosing to allow a
possible duplicate creates a distinct gift. Confirm retries on the same batch
return saved results. Re-uploaded source gift IDs do not duplicate donations.

## Manual merges

POST canonical_donor_id, merged_donor_id, and a 3–500 character reason. Users with
`donors.write` choose the canonical donor. Both must be active. The transaction
moves all gifts and aliases, archives the old donor, and records authorized actor,
original donor, gift IDs and reason. The canonical profile is not overwritten.
The old record cannot be unarchived/edited normally. Names like OHacks/Opportunity
Hack can be merged explicitly even when automatic candidate matching finds no
pair. Extension to Teammate 2's future activity/task/outreach associations is an
integration prerequisite, documented in database-integration.md.

Errors: 400 validation; 401 unauthenticated/missing auth; 403 permission/origin;
404 missing resource; 405 method; 409 review/conflict/expiry; 413 size;
415 content type; 500 safe internal failure; 503 auth integration unavailable.
Clients must render all donor/spreadsheet text using `textContent`, never
`innerHTML`, and never evaluate values or interpolate them into scripts.
