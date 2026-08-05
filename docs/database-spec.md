# Shared Spreadsheet Database Specification

This project uses Google Drive spreadsheets as a shared database layer for Google Apps Script projects.

Each logical table is represented by a Google Spreadsheet. A central registry spreadsheet maps logical table names to spreadsheet IDs.

## Database Registry

Apps Script projects that use the shared database must define a script property named `db`.

The `db` property value is the spreadsheet ID of the database registry spreadsheet.

### Registry Schema

Sheet name: `tables`

| Column | Value | Meaning |
| --- | --- | --- |
| A | logical table name | Human-readable logical table name. |
| B | spreadsheet ID | Google Spreadsheet ID for that logical table. |

The registry stores spreadsheet IDs, not sheet IDs. The application decides which sheet inside the logical table spreadsheet it needs.

### Connection Flow

1. Read script property `db`.
2. Open the registry spreadsheet by ID.
3. Open sheet `tables`.
4. Read all rows.
5. Find the row where column A matches the requested logical table name.
6. Use column B as the spreadsheet ID for that logical table.
7. Open the logical table spreadsheet by ID.
8. Open the required sheet inside that spreadsheet.

```js
const dbId = PropertiesService.getScriptProperties().getProperty('db');
const registrySpreadsheet = SpreadsheetApp.openById(dbId);
const tablesSheet = registrySpreadsheet.getSheetByName('tables');
```

### Logical Tables

| Logical table | Sheets used |
| --- | --- |
| `Dades de professors` | `Llista`, `leave_absence` |
| `Càrrega lectiva` | `assignatures` |
| `Horaris` | `GPU001` |
| `Dinantia` | `dinantia_2_dades_alumnes` |
| `Grades` | `subjects_cache`, `avaluacions` |

The old `Grades` -> `subjects` table is obsolete and must not be used for the new configuration workflow.

## Table: Dades De Professors

Logical table name in registry: `Dades de professors`

This logical table contains teacher metadata and leave/substitution data.

### Sheet: Llista

`Llista` contains teacher metadata.

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `ESP` | Original teacher code. Used by `leave_absence.teacher_code`. |
| B | `DEPT.` | Department code. |
| C | `NOM` | First name. |
| D | `COGNOM1` | First surname. |
| E | `COGNOM2` | Second surname. |
| F | `REDUIT` / `REDUÏT` | Short teacher code used by timetable and substitution logic. |
| G | `SITUACIO` | Employment/status description. Do not infer substitute status from this field. |
| H | `JORNADA` | Workload or schedule fraction. |
| I | `DNI` | ID document value. |
| J | `TELF` | Phone number. |
| K | `XTEC` | XTEC email. |
| L | `CORREU` | Institutional/main email. Preferred source for `subjects_cache.teacher_email`. |
| M | `NOUS` | New teacher boolean flag. |
| N | `ACTIU` | Active teacher boolean flag. |
| O | `BAIXA?` | Leave-of-absence boolean flag. |
| P | `SUBST?` | Substitute boolean flag. This is the only source of substitute status. |

### Teacher Rules

`REDUIT` / `REDUÏT` is the short teacher code used by normal application, timetable, and substitution operations.

`ESP` is the original teacher code used by `leave_absence.teacher_code`.

Teacher full names are built from:

```text
NOM + " " + COGNOM1 + " " + COGNOM2
```

Blank name parts must be omitted.

Teacher sorting should normally use:

1. `COGNOM1`
2. `COGNOM2`
3. `NOM`

Boolean readers must treat both real boolean `true` and string `"TRUE"` as true.

Boolean writers must write real booleans, not strings.

### Active Teacher Rule

A teacher is active when:

```text
ACTIU = TRUE
```

### Substitute Teacher Rule

A teacher is an eligible substitute when:

```text
ACTIU = TRUE
AND
SUBST? = TRUE
```

Do not infer substitute status from `SITUACIO`. `SUBST?` is the only source of substitute status.

### Sheet: leave_absence

`leave_absence` tracks original teachers who are, or have been, covered by substitutes.

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `row_id` | Original row number in `Llista`. |
| B | `teacher_code` | Original teacher `ESP` from `Llista` column A. |
| C | `substitute_code` | Substitute teacher `REDUIT` / `REDUÏT` from `Llista` column F. |
| D | `start_date` | Leave start date. |
| E | `end_date` | Leave end date. Blank means the leave is still active. |
| F | `comments` | Free comments. |

### Leave/Substitute Rules

`leave_absence.teacher_code` must store the original teacher's `ESP`.

`leave_absence.substitute_code` must store the substitute teacher's `REDUIT` / `REDUÏT`.

Do not store the substitute as `ESP`.

A leave is active when the relevant date is between the start and end dates, inclusive:

```text
start_date <= relevant_date <= end_date
```

If `end_date` is blank, treat the leave as still active.

For schedule and timetable applications, the relevant date is usually today in timezone `Europe/Madrid`.

When resolving the effective teacher for a timetable row:

1. Read the scheduled teacher code from `Horaris` -> `GPU001` column C.
2. Match it to `Llista.REDUIT` / `Llista.REDUÏT`.
3. Read the matched teacher's `ESP`.
4. Search active rows in `leave_absence`.
5. Match `leave_absence.teacher_code` against the original teacher's `ESP`.
6. If an active leave exists, read `leave_absence.substitute_code`.
7. Match the substitute code to `Llista.REDUIT` / `Llista.REDUÏT`.
8. Use the substitute as the effective teacher.
9. If no active leave exists, keep the original scheduled teacher.
10. If substitute data is invalid or missing, keep the original scheduled teacher and do not break the application.

## Table: Càrrega Lectiva

Logical table name in registry: `Càrrega lectiva`

This logical table contains the subject catalog.

### Sheet: assignatures

`assignatures` translates short subject codes into full subject names.

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `short_name` | Short subject code. This matches timetable subject codes. |
| B | `ETAPA` | Educational stage. |
| C | `full_name` | Full subject name for display. |
| D | `untis_name` | Subject name/code as used by Untis. |
| E | `true_subject` | Canonical or normalized subject value. |

### Subject Rules

To display a subject:

1. Read the source subject code.
2. Match it against `assignatures.short_name`.
3. If a match exists and `assignatures.full_name` is not blank, use `assignatures.full_name`.
4. If no match exists, or `full_name` is blank, fall back to the raw subject code.

Use `short_name` or the raw subject code as the stable internal value.

Use `full_name` as the user-facing display value.

## Table: Horaris

Logical table name in registry: `Horaris`

This logical table contains the high school timetable.

### Sheet: GPU001

`GPU001` stores the schedule session by session.

This sheet has no headers.

| Column | Field | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric row identifier. |
| B | `class_code` | Class/group code. |
| C | `teacher_code` | Teacher code. Matches `Dades de professors` -> `Llista.REDUIT` / `Llista.REDUÏT`. |
| D | `subject_code` | Subject code. Matches `Càrrega lectiva` -> `assignatures.short_name`. |
| E | `classroom_name` | Classroom name. |
| F | `weekday` | Day of the week, from `1` Monday to `5` Friday. |
| G | `schedule_hour` | Schedule hour, from `1` to `12`. |

### GPU001 Rules

Because `GPU001` has no headers, implementations must read this sheet by fixed column position.

Teacher resolution:

```text
Horaris.GPU001 column C = Dades de professors.Llista.REDUIT / REDUÏT
```

Subject resolution:

```text
Horaris.GPU001 column D = Càrrega lectiva.assignatures.short_name
```

Group resolution:

```text
Horaris.GPU001 column B = Dinantia.dinantia_2_dades_alumnes.untis_group_name
```

## Table: Dinantia

Logical table name in registry: `Dinantia`

This logical table maps group names/codes between Dinantia, student-data sheets, incidences, and Untis/timetable data.

### Sheet: dinantia_2_dades_alumnes

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric row identifier. |
| B | `dinantia_group_name` | Group name in the Dinantia app. |
| C | `dades_alumnes_sheet` | Student-data sheet name. Not used by the current configuration workflow. |
| D | `dinantia_group_name_incidencies` | Dinantia incidences group name. Not used by the current configuration workflow. |
| E | `untis_group_name` | Comma-separated group code aliases used in `Horaris` -> `GPU001` column B. |

### Dinantia Group Rules

To resolve a timetable group code into a Dinantia group name:

1. Read `Horaris` -> `GPU001` column B.
2. Split `Dinantia` -> `dinantia_2_dades_alumnes.untis_group_name` by comma.
3. Match the timetable group code against any split alias.
4. Use `dinantia_2_dades_alumnes.dinantia_group_name` as the resolved group name.

Example:

```text
untis_group_name = PER1A,PER1B
```

Both `PER1A` and `PER1B` from `GPU001` resolve to the same `dinantia_group_name`.

Relationship:

```text
Horaris.GPU001.class_code = any comma-separated alias in Dinantia.dinantia_2_dades_alumnes.untis_group_name
```

### subjects_cache Post-Processing Rules

After all substitutions are resolved:

1. Delete any cache row without a value in column C, `group_name`.
2. Sort the entire cache table by column C, `group_name`.

## Table: Grades

Logical table name in registry: `Grades`

The old `Grades` -> `subjects` source table is deleted/obsolete.

The current configuration workflow uses the derived `subjects_cache` sheet. The `Grades` spreadsheet also contains `avaluacions`, which registers evaluation-period grade sheets.

### Sheet: avaluacions

`avaluacions` registers evaluation periods and points to the sheet where each period's grade data is stored.

The referenced grade-data sheets are always inside the same `Grades` spreadsheet.

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric value that identifies each register. |
| B | `nom_av` | Name of the evaluation period, for example `1a avaluació`. |
| C | `sheet_name` | Name of the sheet, inside the `Grades` spreadsheet, where that evaluation period's data is stored. |

#### avaluacions Rules

`id` is the stable row/register identifier.

`nom_av` is the human-readable evaluation period name shown to users.

`sheet_name` stores a sheet name, not a spreadsheet ID. The target sheet must exist inside the `Grades` spreadsheet.

If an existing header is named `sheet_id`, treat it as a naming error for this workflow and migrate it to `sheet_name` before implementation.

### Sheet: subjects_cache

`subjects_cache` is a derived cache built from timetable sessions in `Horaris` -> `GPU001`, enriched with group, teacher, and subject display data.

The sheet must be rewritten entirely every time the cache-building function is called.

The cache-building function must be public so it can be run directly.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric value for each cache row. |
| B | `group` | Value from `Horaris` -> `GPU001` column B. |
| C | `group_name` | Resolved Dinantia group name. |
| D | `prof_reduit` | Value from `Horaris` -> `GPU001` column C. |
| E | `teacher_full_name` | Resolved teacher full name from `Llista`: `NOM COGNOM1 COGNOM2`. |
| F | `teacher_email` | Resolved teacher email from `Llista.CORREU`. |
| G | `mat_reduit` | Value from `Horaris` -> `GPU001` column D. |
| H | `subject_full_name` | Resolved subject display name from `assignatures.full_name`. |
| I | `subject_dinantia_group_av` | Dinantia group ID selected for assessment. Defaults to `group_name` when rebuilt from `GPU001`. |

Important: Dinantia group IDs are strings and can look like human-readable group names, for example `1r ESO A`. Do not assume numeric IDs.

### subjects_cache Build Flow

1. Read all rows from `Horaris` -> `GPU001` into an in-memory array.
2. Group rows by `group + subject`.
3. For each `group + subject`, count how many scheduled rows/hours each teacher has.
4. Keep only the teacher or teachers with the highest hour count for that `group + subject`.
5. If multiple teachers are tied for the highest hour count, keep all tied teachers.
6. Delete rows for teachers with fewer hours in that `group + subject`.
7. Deduplicate the remaining in-memory array before writing the cache.
8. Two remaining `GPU001` rows are duplicates when columns B, C, and D all match at the same time:
   - B: group/class code
   - C: teacher code
   - D: subject code
9. After deduplication, resolve group, teacher, teacher email, and subject display values.
10. Delete rows without a resolved `group_name`.
11. Sort rows by `group_name`.
12. Clear/rewrite `Grades` -> `subjects_cache` entirely.
13. Write headers and all derived rows.

### subjects_cache Field Resolution

`group`:

```text
subjects_cache.group = Horaris.GPU001 column B
```

`group_name`:

```text
subjects_cache.group_name = Dinantia.dinantia_2_dades_alumnes.dinantia_group_name
where Horaris.GPU001 column B = Dinantia.dinantia_2_dades_alumnes.untis_group_name
```

`prof_reduit`:

```text
subjects_cache.prof_reduit = Horaris.GPU001 column C
```

`teacher_full_name`:

```text
subjects_cache.teacher_full_name = Dades de professors.Llista NOM + COGNOM1 + COGNOM2
where Horaris.GPU001 column C = Dades de professors.Llista.REDUIT / REDUÏT
```

`teacher_email`:

```text
subjects_cache.teacher_email = Dades de professors.Llista.CORREU
where Horaris.GPU001 column C = Dades de professors.Llista.REDUIT / REDUÏT
```

If `CORREU` is blank or unavailable, the implementation may fall back to other email-like teacher fields, especially `XTEC`, and finally the first value in the teacher row that looks like an email address.

`mat_reduit`:

```text
subjects_cache.mat_reduit = Horaris.GPU001 column D
```

`subject_full_name`:

```text
subjects_cache.subject_full_name = Càrrega lectiva.assignatures.full_name
where Horaris.GPU001 column D = Càrrega lectiva.assignatures.short_name
```

`subject_dinantia_group_av`:

```text
subjects_cache.subject_dinantia_group_av = Dinantia group id selected in the endpoint
```

When `subjects_cache` is rebuilt from `GPU001`, this field may initially be filled with `group_name` as a fallback. Manual endpoint edits should replace it with a Dinantia group ID.

For compatibility, any process that consumes `subject_dinantia_group_av` must resolve the value against Dinantia group `id`, `name`, and `tag`. The resolved group ID is the value used to match students.

If group, teacher, or subject references cannot be resolved, the cache builder should preserve the source code and leave the unresolved display value blank or fall back to the source code when a user-facing value is required.

## Configuration Endpoint

The configuration endpoint is served by the Apps Script web app.

Page title: `Configuració`

### Public Functions

Only functions with a specific external purpose should remain public.

Public functions:

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the script owner. |
| `buildSubjectsCache` | Dangerous full rebuild of `Grades` -> `subjects_cache` from `Horaris` -> `GPU001`. |
| `getConfigurationData` | Frontend data loader for the configuration endpoint. |
| `saveSubjectsCacheEdits` | Frontend save handler for manual edits to `Grades` -> `subjects_cache`. |
| `createEvaluation` | Frontend handler that creates an evaluation sheet, config sheet, registry row, and student-subject rows. |
| `getEvaluationCreationStatus` | Frontend polling handler for long-running evaluation creation progress. |

All other functions must be private helpers with a trailing `_`.

### Endpoint UI

The endpoint must show:

1. A group dropdown selector, empty by default.
2. When a group is selected, editable rows from `Grades` -> `subjects_cache` for that group.
3. One floating refresh bubble button with a refresh icon in the bottom-right corner.
4. A warning modal before cache rebuild.
5. Two buttons under the editable list:
   - `+` to add a line.
   - 3.5-inch disk icon to save.
6. A second floating bottom-right button, left of the refresh button, with a document/check icon and accessible name `Crear avaluació`.

Editable row fields:

| UI label | Cache column |
| --- | --- |
| `Assignatura` | `subject_full_name` |
| `Professor` | `teacher_full_name` |
| `Grup d'alumnes per avaluar` | `subject_dinantia_group_av` |

Each editable field must be rendered as a dropdown selector.

### Dropdown Data Sources

Dropdown option lists are calculated once when loading the page.

| Dropdown | Source | Sort |
| --- | --- | --- |
| Group selector | Unique `subjects_cache.group_name` values. | Alphabetical. |
| `Assignatura` | Unique `subjects_cache.subject_full_name` values. | Alphabetical. |
| `Professor` | Unique `subjects_cache.teacher_full_name` values. | Alphabetical. |
| `Grup d'alumnes per avaluar` | Dinantia API group IDs from `GET /v1/groups/index`. | Alphabetical. |

The `Grup d'alumnes per avaluar` dropdown displays and saves the Dinantia group ID. This ID may be a readable string such as `1r ESO A`.

### Save Behavior

Manual edits are saved directly to `Grades` -> `subjects_cache`.

The page must track which rows have been edited.

Saving should send only edited rows and new rows to the server.

The server should update only the submitted existing row IDs and append submitted new rows while preserving all other rows.

New rows added with `+` are written to `subjects_cache` and assigned new `id` values during save.

While save is running, the page must be disabled so the user cannot change selectors, add rows, save again, or rebuild the cache.

After save, the cache sheet should remain sorted by `group_name`.

### Rebuild Warning

The floating refresh button must show this warning in Catalan before running `buildSubjectsCache`:

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

`buildSubjectsCache` is dangerous because it fully rewrites `subjects_cache` from `GPU001` and can overwrite manual edits.

### Create Evaluation UI

The `Crear avaluació` floating button opens a modal.

Modal content:

| Element | Text / Behavior |
| --- | --- |
| `H1` | `Crear una avaluació` |
| Text input label | `Nom de l'avaluació` |
| Text input placeholder | `p.e. 1a avaluació` |
| `H2` | `Avaluació de les matèries` |
| Subtitle | `Introdueix els valors que podran triar els professors per avaluar cada matèria.` |
| Dynamic inputs | One text input per subject-evaluation value, with `+` to add more. |
| `H2` | `Altres conceptes a avaluar` |
| Subtitle | `A continuació afegeix altres conceptes que vulguis avaluar. Els conceptes poden avaluar-se amb un text obert o amb un desplegable de diferents opcions.` |
| Dynamic concept inputs | One text input per concept name, with `+` to add concepts. |
| Concept option inputs | Under each concept, indented right, one text input per option, with `+` to add more options. |

If a concept has no options, that concept is evaluated with open text.

The modal must include delete controls:

| Item | Delete behavior |
| --- | --- |
| Subject-evaluation value | Red cross button removes that value input. |
| Extra concept | Red cross button removes the concept and its options. |
| Concept option | Red cross button removes that option input. |

There must not be a `+` button beside the evaluation-name input. The only add buttons are:

1. Add subject-evaluation value.
2. Add extra concept.
3. Add option inside each extra concept.

When creation starts, the modal closes and the page shows a short message in Catalan explaining that the process has started and may take a few minutes.

While evaluation creation is running, the frontend must poll `getEvaluationCreationStatus(runId)` and show the latest stage message in the page status area.

### Create Evaluation Behavior

When the user confirms the create-evaluation modal:

1. Normalize `Nom de l'avaluació` to snake_case without accents.
2. Create a blank main evaluation sheet in the `Grades` spreadsheet using the normalized name.
3. Create a config sheet named `{evaluation_sheet_name}_config`.
4. Register the new evaluation in `Grades` -> `avaluacions`.
5. Fill the config sheet.
6. Fill the main evaluation sheet from `Grades` -> `subjects_cache` expanded by Dinantia students.

If either target sheet already exists, the script must fail with a clear error and avoid overwriting existing data.

The process can be long. It must use bulk reads/writes where possible and should log major stages with a per-run identifier:

| Stage | Log purpose |
| --- | --- |
| start | Evaluation name, subject-value count, concept count. |
| lock | Waiting for and acquiring the script lock. |
| normalized names | Main and config sheet names. |
| inserting sheets | New sheet creation started. |
| registering evaluation | `avaluacions` append started. |
| writing config | Config sheet write started. |
| populating main sheet | Student expansion started. |
| student index | Number of accounts read, groups matched, and student rows indexed. |
| completion | Rows written to the main evaluation sheet. |
| release | Lock released. |

#### Evaluation Registry Row

Append one row to `Grades` -> `avaluacions`:

| Column | Value |
| --- | --- |
| `id` | Next autonumeric value. |
| `nom_av` | Original evaluation name entered by the user. |
| `sheet_name` | Normalized main evaluation sheet name. |

#### Config Sheet Layout

Config sheet name:

```text
{evaluation_sheet_name}_config
```

| Column | Header | Values |
| --- | --- | --- |
| A | `data de creació` | Row 2 contains creation datetime formatted as `yyyymmdd:HHmm`. |
| B | `Avaluació de les matèries` | Row 2 onward contains the subject-evaluation values. |
| C onward | Concept name | Row 2 onward contains allowed option values. Blank/no values means open text. |

#### Main Evaluation Sheet Layout

The main evaluation sheet is generated from `Grades` -> `subjects_cache`.

For each `subjects_cache` row:

1. Read `subject_dinantia_group_av`.
2. Resolve it against Dinantia groups by `id`, `name`, or `tag`.
3. Prefer storing and using the resolved Dinantia group ID.
4. Use an in-memory student index built from Dinantia accounts.
5. Match the resolved Dinantia group ID against each student account's `groups.member` values.
6. Create one main-sheet row per matched student.

Main sheet columns:

| Column | Header | Source / Behavior |
| --- | --- | --- |
| A | `group_name` | `subjects_cache.group_name`. |
| B | `teacher_full_name` | `subjects_cache.teacher_full_name`. |
| C | `teacher_email` | `subjects_cache.teacher_email`. |
| D | `subject_full_name` | `subjects_cache.subject_full_name`. |
| E | `student_full_name` | Full student name from Dinantia. |
| F | `Avaluació de la matèria` | User-editable dropdown using config column B values. |
| G onward | Extra concept name | One column per extra concept from the config sheet. Dropdown validation when the concept has options; open text when it has none. |
| Last hidden column | `student_account_id` | Dinantia student account ID. Hidden from normal users and reserved for future sync workflows. |

The main sheet must be written in bulk, not row by row.

The main evaluation sheet must be formatted after writing:

1. Freeze the header row.
2. Bold the header row.
3. Apply a light header background.
4. Wrap cell text.
5. Auto-resize columns.
6. Hide `student_account_id`.

The config sheet must also freeze and format its header row.

Dinantia students must be indexed by group ID in memory while creating the sheet so the same group is not fetched repeatedly.

Student index flow:

1. Read all Dinantia accounts from `GET /v1/accounts/index` using pagination.
2. Keep only accounts whose `roles` contain `Student`.
3. For each student, recurse through `account.groups`.
4. Collect string values, especially values in `account.groups.member`.
5. Add the student to every collected group ID.
6. Sort students alphabetically by full name inside each group.

Do not call Dinantia once per `subjects_cache` row. Do not depend on `groups/view/:id` containing member lists.

## Implementation Requirements

### Header Handling

Read sheets by header names when possible.

The exception is `Horaris` -> `GPU001`, which has no headers and must be read by fixed column position.

Header matching should be robust to surrounding spaces and accents when needed.

### Code Normalization

Teacher-code and group-code joins must normalize codes before comparison:

```js
function normalizeCode(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}
```

Use `normalizeCode` for joins involving:

| Field |
| --- |
| `Llista.ESP` |
| `Llista.REDUIT` / `Llista.REDUÏT` |
| `leave_absence.teacher_code` |
| `leave_absence.substitute_code` |
| `GPU001.class_code` |
| `GPU001.teacher_code` |
| `GPU001.subject_code` |
| `dinantia_2_dades_alumnes.untis_group_name` |
| `assignatures.short_name` |

### Boolean Parsing

Boolean readers must accept both real booleans and string `"TRUE"`:

```js
function parseBoolean(value) {
  return value === true || String(value).trim().toUpperCase() === 'TRUE';
}
```

### Date Handling

For leave calculations:

1. Compare dates by calendar day.
2. Use timezone `Europe/Madrid`.
3. Treat blank `end_date` as an open-ended active leave.

## Practical Defaults

| Use case | Field |
| --- | --- |
| Normal teacher operations | `Llista.REDUIT` / `Llista.REDUÏT` |
| Matching original teachers in leave records | `Llista.ESP` |
| Substitute teacher stored in leave records | `leave_absence.substitute_code` as `REDUIT` / `REDUÏT` |
| Stable subject code | `assignatures.short_name` |
| Display subject name | `assignatures.full_name` |
| Timetable source group | `GPU001` column B |
| Timetable source teacher | `GPU001` column C |
| Timetable source subject | `GPU001` column D |
| Dinantia display group | `dinantia_2_dades_alumnes.dinantia_group_name` |
| Endpoint/cache group-subject-teacher source | `Grades` -> `subjects_cache` |
