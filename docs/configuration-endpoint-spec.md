# Configuration Endpoint Specification

This document defines the `configuration` Apps Script web app. Database schemas
and generated sheet layouts are defined in [database-spec.md](database-spec.md).
Dinantia request rules are defined in [dinantia-api-spec.md](dinantia-api-spec.md).

## Identity

| Field | Value |
| --- | --- |
| Folder | `scripts/configuration` |
| Script ID | `1qj0U_bBSfrHpxSzXt5goCaloM_npZAZcRiw6IiGdLMI_XrrP595eiehD` |
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
| `createEvaluation` | Creates the registry row, config sheet, main evaluation sheet, and generated student rows. |
| `getEvaluationCreationStatus` | Polling endpoint for long evaluation creation progress. |

All other functions must be private helpers with a trailing `_`.

## Data Dependencies

| Source | Usage |
| --- | --- |
| `Grades` -> `subjects_cache` | Editable subject/teacher/group assessment cache. |
| `Grades` -> `avaluacions` | Evaluation registry. |
| `Horaris` -> `GPU001` | Timetable source for cache rebuild. |
| `Dinantia` -> `dinantia_2_dades_alumnes` | Local group-code to Dinantia display-name mapping. |
| `Dades de professors` -> `Llista` | Teacher names, codes, and institutional emails. |
| `Càrrega lectiva` -> `assignatures` | Subject display names. |
| Dinantia API `/v1/groups/index` | Group IDs for `Grup d'alumnes per avaluar`. |
| Dinantia API `/v1/accounts/index` | Student expansion for generated evaluation sheets. |

## Page Behavior

The first screen is the editable configuration tool, not a landing page.

The page shows:

1. A group-code selector, empty by default.
2. Editable rows for the selected group code.
3. A floating refresh button for rebuilding `subjects_cache`.
4. A floating `Crear avaluació` button.
5. A row-level red delete button that appears on hover/focus.
6. `+` and save buttons under the editable rows.

Blocking operations must fade the entire page, block interaction, show a centered
animated loading icon, and show the current status text below the icon. This
applies to initial loading, saving, cache rebuild, and evaluation creation.

## Cache Editor

The group selector is built from individual values in `subjects_cache.group`.
Rows with comma-separated groups, such as `1F,2F`, appear when either `1F` or
`2F` is selected.

Editable fields:

| UI label | Cache column | Options |
| --- | --- | --- |
| `Assignatura` | `subject_full_name` | Unique cache subject names, sorted. |
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
8. The server rewrites `subjects_cache` sorted by `group_name`.

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
11. Drop rows without `group_name`.
12. Rewrite `subjects_cache`.

## Create Evaluation Modal

The `Crear avaluació` modal contains:

| Element | Text / Behavior |
| --- | --- |
| `H1` | `Crear una avaluació` |
| Evaluation name | Label `Nom de l'avaluació`, placeholder `p.e. 1a avaluació`. |
| Group list | `Grups a avaluar`; one checkbox per individual `subjects_cache.group` code, checked by default. |
| Subject values | `Avaluació de les matèries`; dynamic list with text, color picker, and delete controls. |
| Extra concepts | `Altres conceptes a avaluar`; dynamic concepts, each with dynamic option rows. |

Concept rules:

1. A subject value is a dropdown option for `Avaluació de la matèria`.
2. Each subject value has a circular color control to its right.
3. The color control defaults to white, `#FFFFFF`.
4. Clicking the circle opens the browser color picker.
5. The selected color is stored in config column C, `Color`, on the same row as the subject value.
6. An extra concept with options becomes a dropdown column.
7. An extra concept without options becomes an open-text column.
8. There is no `+` button next to the evaluation name.
9. Subject values, concepts, and concept options have red delete controls.

Generated config sheets use this layout:

| Column | Header | Values |
| --- | --- | --- |
| A | `data de creació` | Creation datetime in row 2. |
| B | `Avaluació de les matèries` | Subject-evaluation dropdown values. |
| C | `Color` | Six-digit hex color for the corresponding value in column B. |
| D onward | Concept name | Optional concept dropdown values. Blank means open text. |

Extra concept columns start at D because C is reserved for `Color`.

## Evaluation Creation

When the user confirms:

1. Normalize the evaluation name to snake_case without accents.
2. Require at least one selected group code.
3. Create the main sheet `{sheet_name}` in `Grades`.
4. Create `{sheet_name}_config`.
5. Append `Grades` -> `avaluacions` with `Estat = Creada`.
6. Write the config sheet, including subject-evaluation colors.
7. Populate the main sheet from `subjects_cache`.

If `{sheet_name}` or `{sheet_name}_config` already exists, fail clearly and do
not overwrite existing data.

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
9. Write one generated sheet row per deduped student.
10. Fill `grup_tutoria` for every generated row from the student's `TUTORIA` row.

Important invariant: if a source cache row has `group = 2A,2B,2C,2D,2E`, the
generated evaluation rows must preserve that exact group array in the generated
sheet's `group` column.

`grup_tutoria` rule: for each generated student, find the row whose
`subject_full_name` normalizes to `TUTORIA`, copy that row's `group_name`, and
write it into `grup_tutoria` on every row for the same `student_account_id`.
Do not use visible row order or student name as the identity.

### Progress Logging

Each run uses a per-run ID. Log and publish progress for:

| Stage | Meaning |
| --- | --- |
| start | Received payload summary. |
| lock | Script lock waiting/acquired. |
| normalized names | Main and config sheet names. |
| inserting sheets | New sheets are being created. |
| registering evaluation | Registry row is being written. |
| writing config | Config sheet is being written. |
| populating main sheet | Student expansion has started. |
| cache loaded | Cache rows and Dinantia group count. |
| accounts loaded | Dinantia accounts read. |
| student index built | Matched groups and indexed student rows. |
| writing main | Generated rows being written. |
| complete | Main sheet rows written. |
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
