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
| `Grades` | `subjects_cache`, `avaluacions`, generated evaluation sheets, generated evaluation config sheets |

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
| L | `CORREU` | Email field. Fallback source for `subjects_cache.teacher_email`. |
| varies | `CORREU INSTIT` | Main institutional email field. Preferred source for `subjects_cache.teacher_email`. |
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

Mapping integrity is important. Each normalized `untis_group_name` alias should
belong to only one `dinantia_group_name`. If the same alias appears in more than
one row, the current implementation keeps the first mapping it reads and ignores
later duplicates. If a cache row resolves to an unexpected group name, first
check this mapping table for wrong aliases, duplicate aliases, or aliases stored
under the wrong Dinantia group.

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
| D | `Estat` | Evaluation workflow status. |

#### avaluacions Rules

`id` is the stable row/register identifier.

`nom_av` is the human-readable evaluation period name shown to users.

`sheet_name` stores a sheet name, not a spreadsheet ID. The target sheet must exist inside the `Grades` spreadsheet.

`Estat` must use a validation list with these allowed values:

```text
Creada
Avaluació professors
Mode junta
Tancada
```

When a new evaluation is created, `Estat` must be set to `Creada`.

If an existing header is named `sheet_id`, treat it as a naming error for this workflow and migrate it to `sheet_name` before implementation.

### Sheet: subjects_cache

`subjects_cache` is a derived cache built from timetable sessions in `Horaris` -> `GPU001`, enriched with group, teacher, and subject display data.

The sheet must be rewritten entirely every time the cache-building function is called.

The cache-building function must be public so it can be run directly.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric value for each cache row. |
| B | `group` | One or more values from `Horaris` -> `GPU001` column B. Multi-group events are comma-joined. |
| C | `group_name` | One or more resolved Dinantia group names. Multi-group events are comma-joined. |
| D | `prof_reduit` | Value from `Horaris` -> `GPU001` column C. |
| E | `teacher_full_name` | Resolved teacher full name from `Llista`: `NOM COGNOM1 COGNOM2`. |
| F | `teacher_email` | Resolved teacher email from `Llista.CORREU INSTIT`. |
| G | `mat_reduit` | Value from `Horaris` -> `GPU001` column D. |
| H | `subject_full_name` | Resolved subject display name from `assignatures.full_name`. |
| I | `subject_dinantia_group_av` | Dinantia group ID selected for assessment. Defaults to `group_name` when rebuilt from `GPU001`. |

Important: Dinantia group IDs are strings and can look like human-readable group names, for example `1r ESO A`. Do not assume numeric IDs.

Important: `subjects_cache.group` is a comma-separated array when a single
timetable event affects multiple groups. Consumers must split by comma and match
exact normalized group codes, not use substring matching.

### subjects_cache Build Flow

1. Read all rows from `Horaris` -> `GPU001` into an in-memory array.
2. First pass: group rows by `group + subject`, using `GPU001` column B and column D.
3. Inside each `group + subject`, count how many scheduled rows/hours each teacher has.
4. Keep only the teacher or teachers with the highest row count for that `group + subject`.
5. If multiple teachers are tied for the highest row count, keep all tied teachers.
6. Delete rows for teachers with fewer rows in that `group + subject`.
7. Still in the first pass, collapse repeated rows where `group + teacher + subject` all match, leaving one row per combination.
8. Second pass: group the cleaned rows by `GPU001` column A, the event code.
9. Inside each event-code group, if the same teacher and subject appear in multiple groups, collect those distinct group codes.
10. Write one cache source row per kept `event code + teacher + subject`.
11. In that source row, join collected group codes with commas in `subjects_cache.group`.
12. Resolve each joined group code independently into a Dinantia group name.
13. Join resolved Dinantia group names with comma-space in `subjects_cache.group_name`.
14. Resolve teacher, teacher email, and subject display values.
15. Delete rows without a resolved `group_name`.
16. Sort rows by `group_name`.
17. Clear/rewrite `Grades` -> `subjects_cache` entirely.
18. Write headers and all derived rows.

The first pass uses row counts as the number of scheduled hours for each
teacher inside a `group + subject` combination. A teacher with fewer rows/hours
is discarded for that combination; tied teachers are retained.

Example:

```text
471  2A  LOPINF  DIG  2E  2  6
471  2B  LOPINF  DIG  2E  2  6
471  2C  LOPINF  DIG  2E  2  6
471  2D  LOPINF  DIG  2E  2  6
471  2E  LOPINF  DIG  2E  2  6
```

These rows share the same event code, teacher, and subject, and differ only by group. They produce one cache row:

```text
group = 2A,2B,2C,2D,2E
prof_reduit = LOPINF
mat_reduit = DIG
```

### subjects_cache Field Resolution

`group`:

```text
subjects_cache.group = Horaris.GPU001 column B
```

For multi-group event rows:

```text
subjects_cache.group = comma-joined Horaris.GPU001 column B values for the event
```

`group_name`:

```text
subjects_cache.group_name = Dinantia.dinantia_2_dades_alumnes.dinantia_group_name
where Horaris.GPU001 column B = Dinantia.dinantia_2_dades_alumnes.untis_group_name
```

For multi-group event rows, resolve each comma-separated `subjects_cache.group` code separately and join the resolved names with comma-space.

`subjects_cache.group` must be treated as a comma-separated array of group codes by consumers. For example, if `subjects_cache.group = 1F,2F`, the same cache row belongs to both `1F` and `2F`.

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
subjects_cache.teacher_email = Dades de professors.Llista.CORREU INSTIT
where Horaris.GPU001 column C = Dades de professors.Llista.REDUIT / REDUÏT
```

If `CORREU INSTIT` is blank or unavailable, the implementation may fall back to other email-like teacher fields, including `CORREU` and `XTEC`, and finally the first value in the teacher row that looks like an email address.

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

For compatibility, any process that consumes `subject_dinantia_group_av` must resolve each comma-separated value against Dinantia group `id`, `name`, and `tag`. The resolved group IDs are the values used to match students.

When a cache row contains multiple local groups, `group_name` and the fallback
`subject_dinantia_group_av` may contain multiple comma-separated display names.
Before creating evaluations, the configuration UI may be used to choose a
specific Dinantia group ID to assess whenever the fallback is ambiguous. If the
fallback remains a comma-separated group list, evaluation generation must expand
students from every resolved group in that list.

If group, teacher, or subject references cannot be resolved, the cache builder should preserve the source code and leave the unresolved display value blank or fall back to the source code when a user-facing value is required.

## Generated Evaluation Sheets

Generated evaluation sheets are created by the configuration endpoint and later
edited by the teacher panel. Their layout is part of the database contract
because multiple scripts depend on it.

### Evaluation Registry Row

Append one row to `Grades` -> `avaluacions`:

| Column | Value |
| --- | --- |
| `id` | Next autonumeric value. |
| `nom_av` | Original evaluation name entered by the user. |
| `sheet_name` | Normalized main evaluation sheet name. |
| `Estat` | `Creada`, with validation applied to the cell. |

### Config Sheet Layout

Config sheet name:

```text
{evaluation_sheet_name}_config
```

| Column | Header | Values |
| --- | --- | --- |
| A | `data de creació` | Row 2 contains creation datetime formatted as `yyyymmdd:HHmm`. |
| B | `Avaluació de les matèries` | Row 2 onward contains the subject-evaluation values. |
| C onward | Concept name | Row 2 onward contains allowed option values. Blank/no values means open text. |

### Main Evaluation Sheet Layout

The main evaluation sheet is generated from `Grades` -> `subjects_cache`.

For each `subjects_cache` row:

1. Skip the row if `subjects_cache.group` does not contain one of the selected group codes.
2. Read `subject_dinantia_group_av`.
3. Split it by comma.
4. Resolve each value against Dinantia groups by `id`, `name`, or `tag`.
5. Prefer storing and using resolved Dinantia group IDs.
6. Use an in-memory student index built from Dinantia accounts.
7. Match the resolved Dinantia group IDs against each student account's `groups.member` values.
8. Dedupe students per cache row by Dinantia account ID.
9. Create one main-sheet row per matched student.

Main sheet columns:

| Column | Header | Source / Behavior |
| --- | --- | --- |
| A | `group` | Exact `subjects_cache.group` value. This may be a comma-separated array such as `1F,2F`. |
| B | `group_name` | `subjects_cache.group_name`. |
| C | `teacher_full_name` | `subjects_cache.teacher_full_name`. |
| D | `teacher_email` | `subjects_cache.teacher_email`. |
| E | `subject_full_name` | `subjects_cache.subject_full_name`. |
| F | `student_full_name` | Full student name from Dinantia. |
| G | `PI` | Boolean checkbox column. Always created. Default value `false`. |
| H | `Avaluació de la matèria` | User-editable dropdown using config column B values. |
| I onward | Extra concept name | One column per extra concept from the config sheet. Dropdown validation when the concept has options; open text when it has none. |
| Last hidden column | `student_account_id` | Dinantia student account ID. Hidden from normal users and reserved for sync workflows. |

`group` is the canonical local group-code membership for the generated
evaluation row. When a source cache row belongs to multiple local groups, write
the full comma-separated array to the evaluation sheet. Consumers that need
local group codes must split this column by comma.

`group_name` is the corresponding display membership. When `group` contains
multiple local group codes, `group_name` should contain the matching display
group names joined with comma-space. Teacher-facing readers use `group_name`,
not `group`, to build visible group selectors; they split `group_name` by comma
so one generated grade can be reached from any included display group.

The main sheet must be written in bulk, not row by row.

The main evaluation sheet must be formatted after writing:

1. Freeze the header row.
2. Bold the header row.
3. Apply a light header background.
4. Wrap cell text.
5. Auto-resize columns.
6. Apply checkbox validation to `PI`.
7. Hide `student_account_id`.

Teacher-facing UIs should render `PI` as a fixed narrow checkbox column rather
than an adaptive text column.

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

Detailed configuration endpoint behavior is specified in
[Configuration Endpoint Specification](configuration-endpoint-spec.md).

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
