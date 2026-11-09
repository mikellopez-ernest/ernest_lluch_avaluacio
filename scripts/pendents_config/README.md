# pendents_config

Google Apps Script web app with Assignatures and Alumnes tabs for configuring
pending subjects and matching student assignments.

Canonical behavior: [`docs/pendents-config-spec.md`](../../docs/pendents-config-spec.md).
Shared schema: [`docs/database-spec.md`](../../docs/database-spec.md).

## Data and behavior

- Reads and saves `Grades` -> `pendents_config` with exact headers
  `id`, `nivell`, `assignatura`, `departament`, `criteris_recuperacio`, `updated_by`, `updated_at`.
- Imports unique level/subject pairs from `Grades` -> `subjects_cache` without
  rebuilding it. Import merges in the browser; press `Desar` to persist.
- Supports manual row creation and an X deletion button on row hover/focus.
  Additions and deletions persist only when saved.
- Supports four ESO levels and two BAT levels, editable department selections, and
  combined level/department filters. Row editors and server validation share the
  default departments plus saved column D values. Department filter choices come from distinct
  nonblank column D values. Saves retain rows hidden by either filter.
- The leftmost notebook button opens the multiline criteria editor. Existing-row
  popup saves update criteria and audit columns E:G; new-row criteria are applied locally until
  the main `Desar`. Cancel discards popup edits.
- The rightmost check shows the last editor and datetime. The app appends audit
  headers to old five-column sheets on opening. Blank audit fields are filled only
  by `Desar criteris` on a saved row, including unchanged criteria text. After that,
  actual edits update them.
  Editor names resolve from `Dades de professors` -> `Llista`; unmatched accounts
  display their email.
- Protects concurrent saves with a lock and revision check.

## Student XLSX import

The Alumnes tab reads `Grades` -> `pendents_students_cache`, creating it with the
seven documented headers if absent. The table hides the cache row ID and subject ID and shows
`Curs` immediately after `Assignatura`, using the subject’s configured level.
Name, group, and subject filters combine.
The `Importar XLSX` button is enabled for all school-domain users and opens
the computer’s file selector. Users can select an Esfer@ XLSX with student name, class group,
and pending-subject columns. The app reads only the four identity columns of
`Dinantia` -> `students_cache` and joins subjects by `pendents_config.id`.

Rows missing any of the three required XLSX values are ignored and counted.
The review dialog first groups unknown/ambiguous subjects by pending level,
then groups unknown/ambiguous students by name and class. Choose one searchable
canonical option per group to resolve all its affected rows, or omit the group.
Confirmed manual choices are saved in `Grades` -> `pendents_import_aliases`
and reused on future imports. The app creates this sheet when Alumnes loads.
Relations retain source level/class context, canonical target identity, author,
and datetime. Cancelled or omitted rows are not remembered; invalidated targets
return to review. Delete a relation’s sheet row to forget it.
Matched records are never listed, and resolved groups disappear. Steps without
issues are skipped. If all complete rows match, import proceeds without a dialog. Repeated IDs
across groups are supported; conflicting source names/emails go to review with
distinct selectable entries. Confirming
updates existing student/subject pairs, adds new pairs, and retains unrelated
records. Duplicate pairs are consolidated. Save Assignatures drafts before
importing; new subject names must already exist there.

The XLSX reader is vendored in `src/XlsxLibrary.html`; licensing and integrity
information are in `THIRD_PARTY_NOTICES.md`. No remote script or Drive upload is
used. Local `.xlsx` workbooks are ignored by Git and excluded by clasp.

## Setup and deployment

The local ignored `.clasp.json` connects the project with source root `src`.
The existing `.claspignore` uploads only source and the manifest. Keep all real
project, deployment, and spreadsheet identifiers out of Git.

1. Configure the project-local `db` Script Property with the registry ID.
2. Ensure the owner has read access to the registry, `Grades` -> `subjects_cache`,
   plus write access to `Grades`, read access to `Dades de professors` -> `Llista`,
   and read access to `Dinantia` -> `students_cache`.
3. Push source and run `grantPermissionsManually` as the deployment owner.
4. Deploy with owner execution and domain-restricted access. All users in
   `iernestlluch.cat` can read and edit this configuration and import student XLSX files. Schedule-subject import in
   Assignatures remains restricted to `admindomini`, checked on the server.

The manifest uses V8, Europe/Madrid, spreadsheet read/write, and user email.
`admin_privileges` is not used by this app. No Dinantia API credentials are needed.

From this folder:

```sh
clasp status
clasp push
clasp deployments
clasp deploy --deploymentId <existing-deployment-id> --description "pendents_config update"
```

The initial deployment already exists; update it to preserve its URL.
`clasp pull` replaces local source, so preserve local changes before pulling.

## Local verification

```sh
node --test scripts/pendents_config/tests/*.test.cjs
```

Run that command from the repository root. Tests cover import grouping, payload validation, access control, conflict rejection, and batch saves.
