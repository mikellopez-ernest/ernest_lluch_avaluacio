# Configuration Endpoint Specification

This document defines the `configuration` Apps Script web app. Database schemas
and generated sheet layouts are defined in [database-spec.md](database-spec.md).
Dinantia request rules are defined in [dinantia-api-spec.md](dinantia-api-spec.md).

## Identity

| Field | Value |
| --- | --- |
| Folder | `scripts/configuration` |
| Script ID | Stored only in the local ignored `.clasp.json`; do not commit it. |
| Page title | `Configuració` |
| Execute as | Owner / me |
| Access | Users in `iernestlluch.cat` |

The script also rejects active users whose email is not in
`@iernestlluch.cat`.

## Public Functions

Only these functions may be public:

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `buildSubjectsCache` | Full rebuild of `Grades` -> `subjects_cache`. |
| `getConfigurationData` | Frontend data loader. |
| `saveSubjectsCacheEdits` | Saves dirty/new/deleted cache rows. |
| `createEvaluation` | Creates the registry row, config sheet, main evaluation sheet, tutoria sheet, and generated student rows. |
| `getEvaluationCreationStatus` | Polling endpoint for long evaluation creation progress. |

All other functions must be private helpers with a trailing `_`.

## Data Dependencies

| Source | Usage |
| --- | --- |
| `Grades` -> `subjects_cache` | Editable subject/teacher/group assessment cache. |
| `Grades` -> `avaluacions` | Evaluation registry. |
| `Horaris` -> `GPU001` | Timetable source for cache rebuild. |
| `Dinantia` -> `dinantia_2_dades_alumnes` | Local group-code to Dinantia display-name mapping. |
| `Dinantia` -> `teachers_2_dinantia` | Responsibility-to-visible-groups mapping and `ADMIN_PRIVILEGES` marker. |
| `Dades de professors` -> `Llista` | Teacher names, codes, and institutional emails. |
| `Dades de professors` -> `leave_absence` | Substitute-to-original-teacher resolution. |
| `Càrrega lectiva` -> `assignatures` | Subject display names. |
| `Càrrega lectiva` -> `carrecs` | Teacher responsibility lookup. |
| Dinantia API `/v1/groups/index` | Group IDs for `Grup d'alumnes per avaluar`. |
| Dinantia API `/v1/accounts/index` | Student expansion for generated evaluation sheets. |

## Permissions

The web app deployment may be opened by any `@iernestlluch.cat` account, but
the configuration data exposed inside the page is responsibility-filtered.

Permission resolution must match the evaluation-session app:

1. Read the active user email from `Session.getActiveUser().getEmail()`.
2. Find the teacher in `Dades de professors` -> `Llista` by `CORREU INSTIT`.
3. If the teacher is a substitute (`SUBST? = TRUE`), resolve the original
   teacher through an active row in `Dades de professors` -> `leave_absence`.
4. Read the effective teacher responsibilities from `Càrrega lectiva` -> `carrecs`.
5. Match those responsibilities against `Dinantia` -> `teachers_2_dinantia.carrec`.
6. Split `teachers_2_dinantia.dinantia_group_names` by comma.
7. Values equal to `ADMIN_PRIVILEGES` grant admin privileges and are never
   treated as visible groups.
8. All other values are visible Dinantia groups for the current user.

The configuration group selector is still built from local timetable group
codes in `subjects_cache.group` (`1A`, `2B`, etc.). To apply Dinantia
permissions, the server maps visible Dinantia groups to cache group codes by
reading each cache row's `group` and aligned `group_name` values. A cache group
code is visible when either:

1. The local code itself is listed in the resolved visible groups, or
2. The corresponding value in `subjects_cache.group_name` is listed in the
   resolved visible groups.

For multi-group rows, alignment is positional. For example:

```text
group = 2A,2B
group_name = 2n ESO A, 2n ESO B
```

A user allowed to see `2n ESO A` can see/edit `2A`; that does not automatically
grant access to `2B`.

Server-side enforcement is mandatory:

1. `getConfigurationData` only returns visible group codes and rows for those
   group codes.
2. `saveSubjectsCacheEdits` rejects saves for non-visible group codes.
3. `buildSubjectsCache`, `createEvaluation`, and
   `getEvaluationCreationStatus` require `ADMIN_PRIVILEGES`.
4. `createEvaluation` also rejects selected group codes not visible to the
   admin user.

## Page Behavior

The first screen is the editable configuration tool, not a landing page.

The page shows:

1. A group-code selector, empty by default.
2. Editable rows for the selected group code.
3. A floating refresh button for rebuilding `subjects_cache`, visible only to
   users with `ADMIN_PRIVILEGES`.
4. A floating `Crear avaluació` button, visible only to users with
   `ADMIN_PRIVILEGES`.
5. A row-level red delete button that appears on hover/focus.
6. `+` and save buttons under the editable rows.

Blocking operations must fade the entire page, block interaction, show a centered
animated loading icon, and show the current status text below the icon. This
applies to initial loading, saving, cache rebuild, and evaluation creation.

## Cache Editor

The group selector is built from individual visible values in
`subjects_cache.group`. Rows with comma-separated groups, such as `1F,2F`,
appear when either `1F` or `2F` is selected, provided the current user is
allowed to see that specific group code.

Group order is first-appearance order from `subjects_cache`, reading the sheet
top to bottom and splitting comma-separated group arrays left to right. Duplicate
group codes are ignored after their first appearance. Do not sort this group
list alphabetically.

Editable fields:

| UI label | Cache column | Options |
| --- | --- | --- |
| `Tutoria` | `materia_clau` | Radio button. Only one row can be selected per group code. |
| `Ordre` | `order` | Numeric input. Lower values appear first; blank values appear last. |
| `Assignatura` | `subject_full_name` | Unique cache subject names, sorted, plus `Afegir una nova matèria` for custom free-text names. |
| `Professor` | `teacher_full_name` | Unique cache teacher names, sorted. |
| `Grup d'alumnes per avaluar` | `subject_dinantia_group_av` | Dinantia group IDs from `/v1/groups/index`, sorted. |

Save rules:

1. The frontend tracks dirty rows, new rows, and deleted row IDs.
2. Saving sends only dirty rows, new rows, and deleted row IDs.
3. Existing rows are updated by `id`.
4. Existing multi-group rows preserve their original `group` and `group_name`.
5. New rows use the currently selected group code as `group`.
6. New rows resolve `group_name` through `Dinantia.dinantia_2_dades_alumnes`.
7. Deleted row IDs are removed from `subjects_cache`.
8. If a dirty/new row has `materia_clau = TRUE`, the server clears `materia_clau` from every other row containing the selected group code.
9. The server normalizes `materia_clau` so only one row remains checked for each individual group code.
10. The server saves `order` as a number, or blank when the input is empty or invalid.
11. If `Assignatura` is a custom free-text value, save it directly in `subject_full_name`; `mat_reduit` remains blank unless the name matches the subject catalog.
12. The server rewrites `subjects_cache` sorted by `group_name`, then `order`, then subject and teacher.

## Cache Rebuild

`buildSubjectsCache` fully rewrites `Grades` -> `subjects_cache`; manual edits
can be lost.

The refresh button must show this warning before rebuild:

```text
Reconstruir la cache?

Aquesta acció esborrarà totes les dades actuals de la cache i les substituirà amb les dades generades a partir de l'horari GPU001.

Qualsevol canvi manual fet en aquesta pantalla es pot perdre.

Vols continuar?
```

Buttons:

```text
Cancel·lar
Continuar i reconstruir
```

Rebuild algorithm:

1. Read all nonblank rows from `Horaris` -> `GPU001`.
2. Group by local `group + subject`.
3. Within each `group + subject`, count rows/hours by teacher.
4. Keep teacher(s) with the highest count; keep ties.
5. Remove lower-hour teachers.
6. Deduplicate by `group + teacher + subject`.
7. Group the cleaned rows by `GPU001` event code, column A.
8. Within each event, combine distinct groups when teacher and subject match.
9. Resolve `group_name`, `teacher_full_name`, `teacher_email`, and `subject_full_name`.
10. Fill `subject_dinantia_group_av` with `group_name` as the rebuild fallback.
11. Set `materia_clau = TRUE` for TUTORIA rows by default and `FALSE` for all other rows.
12. Keep only one `materia_clau = TRUE` row per individual local group code.
13. Set `order = 0` for TUTORIA rows by default and leave other order values blank.
14. Drop rows without `group_name`.
15. Rewrite `subjects_cache` sorted by `group_name`, then `order`, then subject and teacher.

## Create Evaluation Modal

The `Crear avaluació` modal contains:

| Element | Text / Behavior |
| --- | --- |
| `H1` | `Crear una avaluació` |
| Evaluation name | Label `Nom de l'avaluació`, placeholder `p.e. 1a avaluació`. |
| Group list | `Grups a avaluar`; one checkbox per individual `subjects_cache.group` code, checked by default, using first-appearance order from `subjects_cache`. |
| Subject values | `Avaluació de les matèries`; dynamic list with full text, reduced-name text, color picker, and delete controls. |
| Extra concepts | `Altres conceptes a avaluar`; dynamic concepts, each with dynamic option rows. |

Concept rules:

1. A subject value is a dropdown option for `Avaluació de la matèria`.
2. Each subject value has a `Reduït` textbox to its right.
3. Each subject value has a circular color control to the right of `Reduït`.
4. The color control defaults to white, `#FFFFFF`.
5. Clicking the circle opens the browser color picker.
6. The reduced name is stored in config column C, `avaluacio_reduit`, on the same row as the subject value.
7. The selected color is stored in config column D, `Color`, on the same row as the subject value.
8. An extra concept with options becomes a dropdown column.
9. An extra concept without options becomes an open-text column.
10. There is no `+` button next to the evaluation name.
11. Subject values, concepts, and concept options have red delete controls.

Generated config sheets use this layout:

| Column | Header | Values |
| --- | --- | --- |
| A | `data de creació` | Creation datetime in row 2. |
| B | `Avaluació de les matèries` | Subject-evaluation dropdown values. |
| C | `avaluacio_reduit` | Reduced label for the corresponding value in column B. |
| D | `Color` | Six-digit hex color for the corresponding value in column B. |
| E onward | Concept name | Optional concept dropdown values. Blank means open text. |

Extra concept columns start at E because C is reserved for `avaluacio_reduit`
and D is reserved for `Color`.

## Evaluation Creation

When the user confirms:

1. Normalize the evaluation name to snake_case without accents.
2. Require at least one selected group code.
3. Create the main sheet `{sheet_name}` in `Grades`.
4. Create `{sheet_name}_config`.
5. Create `{sheet_name}_tutoria`.
6. Append `Grades` -> `avaluacions` with `Estat = Creada`.
7. Write the config sheet, including subject-evaluation reduced labels and colors.
8. Populate the main sheet and tutoria sheet from `subjects_cache`.

If `{sheet_name}`, `{sheet_name}_config`, or `{sheet_name}_tutoria` already
exists, fail clearly and do not overwrite existing data.

The popup closes once creation starts. The busy overlay stays visible and polls
`getEvaluationCreationStatus(runId)` until complete or error.

### Student Expansion

For each `subjects_cache` row:

1. Include it if any value in `subjects_cache.group` matches a selected group code.
2. Split `subject_dinantia_group_av` by comma.
3. Resolve each part through Dinantia group `id`, `name`, and `tag`.
4. Read Dinantia accounts once using pagination.
5. Keep accounts whose `roles` contains `Student`.
6. Index students by every string found in `account.groups`.
7. For the cache row, collect students from all resolved Dinantia group IDs.
8. Dedupe students by Dinantia account ID.
9. If `subjects_cache.materia_clau = TRUE`, write the generated rows to `{sheet_name}_tutoria`, not to `{sheet_name}`.
10. If `subjects_cache.materia_clau != TRUE`, write one generated main-sheet row per deduped student.
11. Fill `grup_tutoria` for every generated main row from the student's tutoria row.
12. Copy `subjects_cache.order` into hidden `subject_order` metadata columns so downstream pages and exports can preserve the subject order.

Important invariant: if a source cache row has `group = 2A,2B,2C,2D,2E`, the
generated evaluation rows must preserve that exact group array in the generated
sheet's `group` column.

`grup_tutoria` rule: for each generated student, find that student's row in
`{sheet_name}_tutoria`, copy that row's `group_name`, and write it into
`grup_tutoria` on every row for the same `student_account_id` in both generated
sheets. Do not use visible row order or student name as the identity. `TUTORIA`
is only the rebuild default for checking `materia_clau`; it is not a hardcoded
generation rule.

`{sheet_name}_tutoria` columns:

| Column | Header | Source / Behavior |
| --- | --- | --- |
| A | `group` | Same generated field as the main sheet. |
| B | `group_name` | Same generated field as the main sheet. |
| C | `teacher_full_name` | Same generated field as the main sheet. |
| D | `teacher_email` | Same generated field as the main sheet. |
| E | `subject_full_name` | Same generated field as the main sheet. |
| F | `student_full_name` | Same generated field as the main sheet. |
| G | `grup_tutoria` | Same generated tutorial group metadata. |
| H | `student_account_id` | Dinantia student account ID. |
| I | `subject_order` | Hidden numeric order copied from `subjects_cache.order`. |
| J | `Comentari_tutor` | Blank at creation time. |
| K | `Butlletí_url` | Blank at creation time. |

### Progress Logging

Each run uses a per-run ID. Log and publish progress for:

Progress polling is transient and must use `CacheService`, not script
properties. The configuration data loader deletes legacy
`evaluation_progress_...` script properties if any exist.

| Stage | Meaning |
| --- | --- |
| start | Received payload summary. |
| lock | Script lock waiting/acquired. |
| normalized names | Main, config, and tutoria sheet names. |
| inserting sheets | New sheets are being created. |
| registering evaluation | Registry row is being written. |
| writing config | Config sheet is being written. |
| populating main sheet | Student expansion for main and tutoria sheets has started. |
| cache loaded | Cache rows and Dinantia group count. |
| accounts loaded | Dinantia accounts read. |
| student index built | Matched groups and indexed student rows. |
| writing main | Generated main and tutoria rows being written. |
| complete | Main and tutoria sheet rows written. |
| release | Script lock released. |

## Manual Authorization

The owner should run `grantPermissionsManually` after setup or scope changes.
It must touch:

| Resource |
| --- |
| Script property `db` and the registry spreadsheet. |
| `Grades` -> `subjects_cache`. |
| `Grades` -> `avaluacions`. |
| `Horaris` -> `GPU001`. |
| `Dinantia` -> `dinantia_2_dades_alumnes`. |
| `Dades de professors` -> `Llista`. |
| `Càrrega lectiva` -> `assignatures`. |
