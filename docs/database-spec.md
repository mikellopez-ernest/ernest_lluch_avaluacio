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
| `Grades` | `subjects_cache` |

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
| L | `CORREU` | Institutional/main email. |
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

The current configuration workflow uses only the derived `subjects_cache` sheet.

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
| F | `mat_reduit` | Value from `Horaris` -> `GPU001` column D. |
| G | `subject_full_name` | Resolved subject display name from `assignatures.full_name`. |
| H | `subject_dinantia_group_av` | Dinantia group ID selected for assessment. Defaults to `group_name` when rebuilt from `GPU001`. |

### subjects_cache Build Flow

1. Read all rows from `Horaris` -> `GPU001` into an in-memory array.
2. Deduplicate the in-memory array before writing the cache.
3. Two `GPU001` rows are duplicates when columns B, C, and D all match at the same time:
   - B: group/class code
   - C: teacher code
   - D: subject code
4. After deduplication, resolve group, teacher, and subject display values.
5. Delete rows without a resolved `group_name`.
6. Sort rows by `group_name`.
7. Clear/rewrite `Grades` -> `subjects_cache` entirely.
8. Write headers and all derived rows.

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
