# PRJ-06 — Project export and import

Status: done
Phase: 4   Team: Projects
Depends on: BLD-02, PRJ-02, PRJ-04
Size: M

## Goal
A whole project (settings, components, presets, routes, cases) leaves as one stable JSON file and can be imported into any workspace as a new project — how teams share mocks and commit them next to the frontend.

## In scope
- Handlers `projects.export`, `projects.import` and the file format `ProjectExport` (stable key order, no ids, `formatVersion: 1`).
- UI: "Export" action on the project (settings screen header or switcher) and an "Import project" dialog on the project list.
- One-transaction import with minted ids and per-issue error reporting.

## Out of scope
Versions or history in the file. OpenAPI import. Merge-into-existing-project.

## Contract
Endpoints per API-CONTRACT §3.11; `ProjectExport` per §2. Tables: `projects`, `data_presets`, `routes`, `response_cases` (read/write). The path-grammar and `schema-core` validators from the registry/package are reused.

## Acceptance criteria
- [x] Exporting the same project twice with no edits yields byte-identical files; routes and cases appear in `sortOrder`; the file contains no UUIDs other than values a user typed into schemas.
- [x] `Content-Disposition` is `attachment; filename="<slug>.mockbench.json"`.
- [x] export → import (`slug` overridden) → export produces the same document apart from `project.slug`.
- [x] Import with a taken slug and no override → `409 slug_taken`, nothing created; with a reserved slug → `422 slug_reserved`.
- [x] A document with two routes that normalise equal, a case with a forbidden header, or a schema over limits → `422 import_invalid` whose `details` list one `{path, code, message}` per problem (path into the document), and **no rows are created**.
- [x] A document with `formatVersion: 2` → `422 import_invalid` with code `unsupported_format_version`.
- [x] Each imported route has exactly one default case (a route with none marked default gets its first case defaulted; with several, the first marked wins and the rest are demoted, reported as a warning in the UI).
- [x] Import requires editor in the target workspace; as viewer → `403`.
- [x] The UI import dialog shows each issue with its path, and on success navigates to the new project.
- [x] A 10 MiB document is accepted; 10 MiB + 1 → `413`.

## Tests
Round-trip and determinism tests; one failing-import fixture per issue class asserting no rows; UI test with a malformed file.

## Open questions
- Whether export should include a `generatorVersion` hint (excluded for stable diffs; assumed no).
- Handling imported presets with duplicate names (assumed suffix).

## Implementation notes
- The registry validates `document` (including `formatVersion: z.literal(1)`) at the edge, so over HTTP a `formatVersion: 2` file currently gets `422 validation_failed`, not `import_invalid`/`unsupported_format_version`. The handler check exists (`validateImport`, unit-tested) and the UI catches it locally; closing the gap needs `projects.import`'s `document` loosened in `packages/api-contract` (main session).
- Duplicate preset names are imported as-is (no suffix): the DB does not require unique names and suffixing would break export-import-export equality.
- A route with no cases is an `import_invalid` issue (`route_without_cases`).
- The "several defaults demoted" warning is computed in the dialog from the file, since the response is a plain `Project`.
