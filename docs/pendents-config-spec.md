# Pendents Configuration Endpoint Specification

## Purpose and ownership

`pendents_config` configures pending-subject evaluations by ESO or BAT level. It reads
and writes `Grades` -> `pendents_config` using the seven-column contract in
`database-spec.md`. The separate `pendents` sheet is not read or modified.
The configuration app retains ownership of timetable synchronization and
`subjects_cache`; this endpoint only reads that cache.

## Access and deployment

The standalone web app executes as the deployment owner, uses V8 and the
`Europe/Madrid` time zone, and is available to `@iernestlluch.cat` accounts.
Every public endpoint checks the normalized active email; blank and other-domain
emails are rejected. All domain users can read, add, edit, delete, and save the
complete configuration. Only the domain account with local part `admindomini`
can import subjects from the schedule in Assignatures. Student XLSX import in
Alumnes is available to all school-domain users. Schedule import requires the
exact normalized administrator account; broader administrator properties do not
grant schedule-import access.

The bootstrap response supplies `canImport`, computed on the server when the
user accesses Assignatures. Its schedule-import button is hidden by default and shown only when that
flag is true. `getPendentsImportData` repeats the exact email check before any
database read, so a direct browser call cannot bypass the restriction.

Spreadsheet identifiers resolve through the project-local `db` Script Property
and the registry's `tables` sheet. IDs, credentials, and administrator addresses
must not be committed. OAuth scopes are spreadsheet read/write and user email.
The owner must authorize those scopes. Update the existing web-app deployment
to preserve its URL.

## Page layout

Title: `Configuració de pendents`. The page occupies the viewport with a header,
filters, a table frame that fills available height, and a persistent footer with
`Nova assignatura`, authorized-only `Importar`, `Desar`, and an operation status. The table scrolls independently;
column headers remain visible. Narrow screens support horizontal scrolling.
Loading, importing, and saving display a blocking progress overlay. Failures
leave edits intact. Leaving with unsaved changes triggers the browser warning.

Filters:

- `Nivell`: `Tots els nivells`, `1r ESO`, `2n ESO`, `3r ESO`, `4t ESO`, `1r BAT`, `2n BAT`.
- `Departament`: enabled; `Tots els departaments` followed by distinct nonblank
  values from `pendents_config.departament` (column D), trimmed and sorted using
  Catalan collation. Filter options use the complete configuration across all
  levels. Row editors offer the default departments plus nonblank values already
  saved in column D; server validation uses that same set. Rebuild the
  options as rows change, retaining the selected value when still available and
  resetting to all departments when it disappears. Unsaved row edits are included.
- Both filters apply together: a row must match the selected level and department.
  Clearing either filter removes only that condition.

Editable table columns:

| Column | Control |
| --- | --- |
| `Criteris` (first column) | Notebook icon opening the recovery-criteria editor. |
| `Nivell` | One of the four ESO levels or two BAT levels. |
| `Assignatura` | Required subject name, initially imported from the cache. |
| `Departament` | Blank, a default department, or a nonblank department already saved in column D. Options and validation trim whitespace and normalize Unicode NFC. |

Filtering changes only the visible rows; unsaved changes across all levels stay
in memory. `Desar` is disabled until changes exist. Saving retains all rows,
including those hidden by either filter.

## Manual row creation and deletion

`Nova assignatura` is available to every allowed domain user. It appends an
unsaved row using the selected level, or `1r ESO` when the filter is `Tots els
nivells`. Department defaults to the selected department filter, or blank when
all departments are selected. Subject and criteria start blank. The page scrolls the new
row into view and focuses its subject input. The subject must be filled before
saving; existing level/subject uniqueness validation also applies to manual rows.

Each row has an X icon in a narrow action column immediately after the leftmost notebook column. The button appears
on row hover or keyboard focus within the row, and stays visible on touch devices.
It has an accessible deletion label and is keyboard-operable. Clicking removes
that exact row from browser state, including newly created rows with no ID.
Creation and deletion mark the configuration dirty and persist only on `Desar`.
Deleting every row is valid and leaves the sheet's headers after saving. Edits
and deletions in other levels survive filter changes.

## Recovery criteria

Column E, `criteris_recuperacio`, is an optional plain string. Reading and saving
preserve whitespace, line breaks, and literal markup; criteria are never rendered
as HTML. New and imported subjects start with an empty string. Import merges
retain existing criteria. The maximum text length is 50,000 characters.

The leftmost table column is `Criteris`. Its always-visible notebook button opens
a modal dialog titled `Criteris de recuperació`, identifying the subject and
level. A tinted icon indicates that text already exists. The dialog contains a
multiline textarea, `Cancel·lar`, and a save action. It traps focus, focuses the
textarea on opening, and supports Escape to cancel. Cancel discards the popup's
unapplied draft. Closing or saving restores focus to the row's notebook button.

For an existing row, `Desar criteris` immediately persists that row's criteria and audit fields.
It does not save pending edits, additions, or deletions elsewhere in the table.
The server checks the domain, text type/length, the row ID, and the current
configuration revision while holding the script lock. It locates the physical
row even when the sheet contains blank rows and writes only columns E:G. It returns
the saved text and new global revision. The browser merges those values while
retaining other pending table edits and their dirty status. A stale revision or
missing/nonunique ID rejects the save. The dialog stays open with the draft and
an error so the user can recover the text. Controls are disabled and Escape is
blocked while a save is in progress.

For a new row without an ID, the action is `Aplicar`: it copies the text into the
unsaved row and marks the configuration dirty. The dialog explicitly says to use
the main `Desar` button to persist the new subject and its criteria together.
The main save always includes criteria, so subsequent table edits retain them.
If a client omits this optional field for an existing record, the server preserves
the record's current criteria. An explicit empty string clears criteria.
Leaving the page warns about unsaved popup text or an in-progress criteria save.

## Import

`Importar` reads `Grades` -> `subjects_cache`, using `subject_full_name`, `group`,
and aligned `group_name` values. It does not read or reinterpret GPU001.

- Split comma-separated local groups before resolving levels.
- Codes `1ESOA`, `1ESOB`, etc. map to `1r ESO`; likewise for 2, 3, and 4.
- Codes `1BATX`, `1BATY`, etc. map to `1r BAT`; `2BATX`, `2BATY`, etc.
  map to `2n BAT`. Ordinal/spaced forms such as `1r BAT X` and `2n BAT x`
  are also accepted, case-insensitively. Different classes share one subject
  record per BAT level. Unsupported BAT years are excluded.
- Level dropdowns in the filter and every editable row use the same server list:
  the four ESO levels followed by `1r BAT` and `2n BAT`.
- Existing short codes such as `1A` are accepted when the aligned Dinantia
  display group identifies the same ESO or BAT level (for example `1r ESO A` or `1r BAT X`).
- Skip unsupported levels, unrecognized group codes, and blank subject names.
- Include custom cache subjects even if their subject code is blank.
- Produce one row per level and trimmed subject name; identity matching is
  case-insensitive with Unicode NFC normalization.
- Import all six levels regardless of the current filter; sort by level and
  Catalan subject name.
- Merge into current browser rows. Preserve existing rows and manual assignments,
  add missing pairs with blank department and criteria, and never remove rows.
- Repeating import adds no duplicates. Import is a preview; only `Desar` persists.

Tutorial/key-subject rows are included when they have a valid ESO or BAT level and a
nonblank subject name, like all other cache subjects.

## Save

The browser sends its complete row collection (including hidden
levels) and the revision received at load or the previous save. Only the five data
fields are accepted as input; audit metadata is controlled by the server. The server:

1. Checks the domain and validates the payload.
2. Acquires a script lock and reads the current destination.
3. Rejects a stale revision rather than overwriting another user's edits.
4. Validates levels, nonblank subjects, unique level/subject pairs, departments,
   and existing IDs. Blank department and criteria are allowed.
5. Preserves existing IDs and assigns increasing numeric IDs to new records.
   IDs still referenced by `pendents_students_cache` are reserved against reuse
   even if their configuration row was deleted.
6. Creates `pendents_config` if absent, checks the exact header order if present,
   writes headers and all rows in one batch, and clears surplus old data rows.
7. Releases the lock and returns saved rows, resolved audit names, and the new revision.

Text beginning with spreadsheet formula prefixes is escaped before writing.
No other sheet is changed. A missing destination loads as an empty configuration;
an incompatible nonempty destination raises an error rather than being replaced.
New subjects can enter via authorized import or manual row creation.

## Last-change audit

The database appends `updated_by` and `updated_at` after the five existing fields.
When loading an existing five-column sheet, the server acquires the script lock,
validates the schema, and appends the two headers without modifying historical
rows. Main saves also write all seven columns; criteria-only saves append missing
audit headers before writing E:G. No historical author or time is invented.

Audit starts only when `Desar criteris` is clicked for a saved row. If either audit
field is blank, that action fills both with the active-user email and server
datetime even when the criteria text is unchanged or blank. Main table saves,
new records, imports, and applying criteria to an unsaved row leave blank audit
fields blank. A new row must be saved first, then have `Desar criteris` clicked
to initialize its audit.

Once both fields are populated, later actual changes to level, subject,
department, or criteria update the metadata. Unchanged rows and unchanged
criteria saves retain populated metadata. Browser-supplied audit values are
ignored. Audit changes participate in conflict checks; response-only teacher
names are excluded.

A new rightmost column shows a green check only when both audit fields have data.
On hover, its tooltip reads `ultim canvi per {name}, el {datetime}`. It is also
keyboard-focusable and provides that same accessible label. Names resolve by
institutional email against `Dades de professors` -> `Llista`, using the complete
name from C/D/E regardless of current active status. If no name matches, display
the stored email. Dates display in `Europe/Madrid`, with day/month/year, hours,
minutes, and seconds. Unsaved edits show the last persisted audit, and successful
popup/main saves refresh the check immediately.

## Public endpoints

| Function | Purpose |
| --- | --- |
| `doGet` | Domain-restricted HTML entrypoint. |
| `getPendentsConfigurationData` | Saved rows, revision, import permission, levels and departments. |
| `getPendentsImportData` | Restricted-account-only level/subject import candidates from the cache. |
| `savePendentsConfiguration` | Validated, locked save of all seven columns with conflict detection. |
| `savePendentsRecoveryCriteria` | Domain-checked, locked criteria-only save for one existing row with revision validation. |
| `grantPermissionsManually` | Owner authorization probe for all required spreadsheets. |

Private helpers use trailing underscores. Browser/server calls use
`google.script.run` with success and failure handlers. Rendered values use DOM
text/value properties rather than HTML interpolation.


## Assignatures and Alumnes tabs

The app has two tabs. `Assignatures` contains the existing configuration editor,
including department/level filters, notebook popup, row creation/deletion, saves,
restricted schedule-subject import, and audit checks. Its pending edits and
filters stay in memory while switching tabs. `Alumnes` is loaded on first access
and uses the same viewport layout: filters, an independently scrollable table
with sticky headers, and a footer. Both tabs are available to school-domain
accounts. Student XLSX import is available to all `@iernestlluch.cat` users;
each preview and commit endpoint repeats the domain check. The schedule-subject
import in Assignatures retains its separate `admindomini` restriction.

The Alumnes table shows `ID alumne`, `Alumne/a`, `Correu`, `Grup`,
`Assignatura`, and `Curs`, in that order. The cache row ID and subject ID are kept internally but are not displayed.
The subject ID remains available for matching and filtering. `Curs` follows the subject name and
uses that subject ID to look up `pendents_config.nivell`; it shows `—` if the
subject no longer exists in configuration. The cache schema is unchanged.
Filters are:

- Full-name text search: case-insensitive substring matching, also ignoring
  accents, equivalent to an `ILIKE '%text%'` search with literal input.
- Group dropdown: distinct nonblank cached `student_group` values, sorted in
  Catalan order, with an all-groups option.
- Subject dropdown: cached subject IDs, labelled with subject name and the
  configured level. Same-named subjects at different levels remain distinct.

All filters combine with AND and change only the displayed rows. `Actualitzar`
reloads cache data. `Importar XLSX` is always visible in the Alumnes footer;
it is enabled for every school-domain account. Clicking it opens the native
file picker to choose an XLSX from the computer. The matching/review modal opens
only when complete rows contain unmatched or ambiguous records. Initial access comes from the
server-rendered account check, independently of the student-table data request,
so a load error cannot hide the school user’s import button.
The missing destination sheet is created under a script lock, with headers.
There are no manual student-row editing or deletion actions in this version.

## XLSX input and matching

The three required headers are `Nom complet de l'alumne/a`, `Grup classe`, and
`Matèries/Nivells pendents de cursos anteriors - Nom`. Headers are detected within
the first 30 rows; reordered columns are accepted. Exactly one worksheet must
contain the import table. The browser reads the XLSX using locally bundled
SheetJS CE 0.20.3; no third-party script or upload service receives the file.
The owner authorizes the normal spreadsheet scope; no Drive API scope is needed.
The file itself is neither uploaded to Drive nor stored in Script Properties.
Only extracted source-row numbers and the three source strings are sent to this
Apps Script app. Local XLSX files in this project are ignored by Git.

Blank rows are ignored. Any source row with a blank student name, class group,
or pending-subject cell is skipped before matching; whitespace-only values are
blank. The review summary reports the total incomplete rows skipped. Complete
rows with missing or ambiguous student/subject matches remain available in the
correction popup. Fully matched rows are queued for import but are never shown
in the popup table. If every row
is incomplete, the app reports zero rows to import and opens no review dialog
or assignment writes. Optional blank fields in the canonical caches, such as
student email, are unaffected by this XLSX rule.
Limits: 15 MB per XLSX, 20,000 nonempty source rows, 2,000 characters per input
cell. Unsupported, malformed, or oversized files fail without writing records.

The import reads `Dinantia` -> `students_cache` A:D and persisted `Grades` ->
`pendents_config`, rather than unsaved Assignatures drafts. The UI requires
saving pending Assignatures edits before starting student import.

Matching rules:

1. Normalize accents, case, punctuation, and whitespace. Student names compare
   normalized tokens regardless of given-name/surname order, so `Surname, Name`
   can match `Name Surname`. Unicode names remain supported.
2. Canonicalize source class names such as `ESO LOE 2 B 2N ESO B` to the same
   group key as `2n ESO B`. If a source group is supplied, automatic student
   matching requires it to agree with the cached group.
3. Consolidate equivalent repeated source entries for the same student ID.
   Identical normalized name/group/email duplicates become one choice. For the
   same name and group, a blank email is filled from the sole nonblank email
   when available. Different groups remain selectable entries with the same
   canonical student ID.
4. Automatically select only one unique student entry matching the full-name key
   and group. If a repeated ID has conflicting normalized names or nonblank
   emails, all affected entries require manual review rather than halting the
   entire import or choosing the first/last record. Homonyms, group disagreements, spelling differences, and missing matches
   remain unresolved; no fuzzy name match is silently accepted.
5. Parse trailing subject-year labels such as `Matemàtiques 1r`, `Lectura 1`, or
   `Matemàtiques 1r BAT`. An omitted stage is taken from the source group when
   available; the pending year comes from the subject suffix, not the student's
   current year. Explicit stage/year constraints must agree with the candidate.
6. Match the normalized subject name against saved configuration subjects,
   constrained by any parsed level. Select only a unique candidate. Different
   wording, unknown subjects, and multiple possible matching levels require review.
   Without a level suffix, an exact name can match only when unique.

No new subject is invented by the import. Missing configuration subjects must
first be added and saved in Assignatures, then the import can be restarted.

## Import preview, correction, and persistence

`previewPendentsStudentsImport` returns the matched rows, unresolved reasons,
canonical student/subject options, skipped counts, and source/destination
revision fingerprints. It writes no assignment records. If every complete row
matched uniquely, the browser immediately commits the import without showing a
review modal. Otherwise it shows only the unresolved rows and waits for the user
to correct or explicitly omit them before committing the whole batch.

The modal resolves issues in two ordered steps, paginated in groups of 15:

1. Unknown or ambiguous subjects, grouped by normalized source subject and
   pending level. If the pending level is absent, groups retain the source
   cohort context so unrelated levels are not combined.
2. Unknown or ambiguous students, grouped by normalized full name and class group.

Each group shows its source text, level or class context, affected row count,
and one searchable canonical selector. A selection applies to every unresolved
row in that group; previously matched choices are retained. Resolved groups
immediately disappear. Successfully matched records never appear. Subject labels
include name, level, and ID. Student labels include canonical name, current group,
and ID, plus email for IDs with multiple source entries. Selection values use
stable entry keys; the stored `student_id` remains the canonical ID. Values must
be complete canonical options.

Users can explicitly mark a problematic group `Ometre`, excluding all its affected
rows from the batch and subsequent steps. Only incomplete XLSX rows are
automatically skipped. The subject step must be completed before continuing to
students; a step with no outstanding issues is skipped. Final import stays
disabled until every non-omitted row has a valid student and subject and at least
one row remains. The summary shows unresolved groups, omitted rows, and
incomplete-row counts. Cancel discards the entire preview. Source files and
other cache records are left unchanged.

Confirmed manual choices are remembered in `Grades -> pendents_import_aliases`
(schema in `database-spec.md`). The sheet is created automatically when Alumnes
loads, preview runs, or setup is executed. Preview applies saved mappings only
to unresolved choices and only while the canonical identity still matches its
stored target key. Subject keys preserve pending level or missing-level cohort;
student keys preserve normalized name and class. Invalid or duplicated mappings
return to the relevant review step. Already matched canonical records take
precedence. The popup explains that confirming will remember the choice.

The client submits source text, selected IDs, and manual-choice flags for
non-omitted corrected rows, along with a mapping revision. The server recomputes
grouping keys, verifies all targets and imported pairs, rejects conflicting
choices or stale mappings, and upserts one relation per kind/source key with
server-controlled user and datetime. No relation is written during preview,
cancellation, or omission. A later confirmed correction replaces the saved
relation. Deleting its sheet row makes that source return to review on the next
import. The success message reports the number of remembered relations.

Assignment data is flushed before remembering corrections. If remembering fails
after the assignments are saved, the result explicitly reports successful import
with a warning that the relations could not be remembered; reimporting is safe.

Confirmation submits selected IDs and these correction records to `commitPendentsStudentsImport`.
The server repeats school-domain authorization, obtains the lock, rereads both
canonical sources and destination, and verifies both fingerprints. Source or
cache changes since preview reject the commit with instructions to reimport.
All submitted IDs must still exist; canonical names, emails, and groups always
come from server data. Client-supplied identity details are never persisted.

If one confirmed import selects different source entries for the same canonical
student/subject pair, the server rejects it and asks the user to select a
consistent entry or omit the duplicate. No arbitrary record is chosen.

The server merges by student ID plus subject ID, updates existing records without
changing their row IDs, adds new pairs with increasing IDs, consolidates duplicate
pairs in the import, and preserves all unrelated records. It sorts the result by
student name, group, and subject and writes once in a batch. An import containing
only incomplete rows performs no assignment writes. A missing
pair in a later XLSX does not delete an existing cache row.

The final status reports added, updated, and duplicate-pair counts. Failures keep
the review selections available. No temporary names or import payloads are logged
or persisted server-side. `parent_ids`, birthdates, documents, ages, photos, and
other source fields beyond student A:D are not read by this workflow.

### Additional public endpoints

| Function | Purpose |
| --- | --- |
| `getPendentsStudentsData` | Domain-checked cache load and missing-sheet creation; returns subject levels for filter labels. |
| `previewPendentsStudentsImport` | School-domain matching and correction preview. |
| `commitPendentsStudentsImport` | School-domain validated upsert under a lock. |
