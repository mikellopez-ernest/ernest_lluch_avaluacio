# Shared Spreadsheet Database Specification

This project uses Google Drive spreadsheets as a shared database layer for Google Apps Script projects.

Each logical table is represented by a Google Spreadsheet. A central registry spreadsheet maps logical table names to the spreadsheet IDs that store those tables.

## Database Registry

Apps Script projects that use the shared database must define a script property named `db`.

The `db` property value is the spreadsheet ID of the database registry spreadsheet.

### Registry Schema

Sheet name: `tables`

| Column | Header / Value | Meaning |
| --- | --- | --- |
| A | logical table name | Human-readable logical table name. |
| B | spreadsheet ID | Google Spreadsheet ID for that logical table. |

The registry stores spreadsheet IDs, not sheet IDs. The application decides which sheet inside the logical table spreadsheet it needs.

### Connection Flow

1. Read the script property `db`.
2. Open the registry spreadsheet by ID.
3. Open the `tables` sheet.
4. Read all registry rows.
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
| `Grades` | `subjects` |

The logical table name for teaching-load data may be stored with accents as `Càrrega lectiva`. Implementations should use the exact registry value configured in the database.

## Table: Dades De Professors

Logical table name in registry: `Dades de professors`

This logical table contains teacher metadata and leave/substitution data.

### Sheet: Llista

`Llista` contains teacher metadata.

Row 1 contains headers. Data starts in row 2.

The current structure has 16 columns.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `ESP` | Original teacher code. Used by `leave_absence.teacher_code`. |
| B | `DEPT.` | Department code. |
| C | `NOM` | First name. |
| D | `COGNOM1` | First surname. |
| E | `COGNOM2` | Second surname. |
| F | `REDUIT` | Short teacher code used by most timetable and substitution logic. |
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

#### Llista Rules

`REDUIT` is the short teacher code used by normal application, timetable, and substitution operations.

`ESP` is the original teacher code used by `leave_absence.teacher_code`.

Teacher full names are built from:

```text
NOM + " " + COGNOM1 + " " + COGNOM2
```

Blank name parts must be omitted.

Example:

| Field | Value |
| --- | --- |
| `NOM` | `Gemma` |
| `COGNOM1` | `Escudé` |
| `COGNOM2` | `Pont` |

Full name: `Gemma Escudé Pont`

Teacher sorting should normally use:

1. `COGNOM1`
2. `COGNOM2`
3. `NOM`

The boolean fields are:

| Header |
| --- |
| `NOUS` |
| `ACTIU` |
| `BAIXA?` |
| `SUBST?` |

Boolean readers must treat both real boolean `true` and string `"TRUE"` as true.

Boolean writers must write real booleans, not strings.

#### Active Teacher Rule

A teacher is active when:

```text
ACTIU = TRUE
```

#### Substitute Teacher Rule

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

The sheet has 6 columns.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `row_id` | Original row number in `Llista`. |
| B | `teacher_code` | Original teacher `ESP` from `Llista` column A. |
| C | `substitute_code` | Substitute teacher `REDUIT` from `Llista` column F. |
| D | `start_date` | Leave start date. |
| E | `end_date` | Leave end date. Blank means the leave is still active. |
| F | `comments` | Free comments. |

#### leave_absence Rules

`leave_absence.teacher_code` must store the original teacher's `ESP`.

`leave_absence.substitute_code` must store the substitute teacher's `REDUIT`.

Do not store the substitute as `ESP`.

Do not infer substitutes from `SITUACIO`.

#### Active Leave Rule

A leave is active when the relevant date is between the start and end dates, inclusive:

```text
start_date <= relevant_date <= end_date
```

If `end_date` is blank, treat the leave as still active.

For schedule and timetable applications, the relevant date is usually today in timezone `Europe/Madrid`.

#### Starting A Leave

Starting a leave must:

1. Add a row to `leave_absence`.
2. Set `Llista` column `BAIXA?` to `TRUE` for the original teacher.

#### Ending A Leave

Ending a leave must:

1. Fill `leave_absence.end_date`.
2. Set `Llista` column `BAIXA?` to `FALSE` for the original teacher.

#### Resolving A Substitute

When a timetable or source row contains a teacher code:

1. Read the source teacher code.
2. If the source code is a `REDUIT`, find the teacher in `Llista.REDUIT`.
3. Read that teacher's `ESP`.
4. Search active rows in `leave_absence`.
5. Match `leave_absence.teacher_code` against the original teacher's `ESP`.
6. If a matching active leave exists, read `leave_absence.substitute_code`.
7. Find the substitute teacher in `Llista.REDUIT`.
8. Use the substitute as the effective teacher.
9. If no active leave exists, keep the original/source teacher.
10. If the substitute code is invalid or missing, keep the original/source teacher and do not break the application.

Teacher-code comparisons must be normalized before matching.

Correct relationships:

```text
leave_absence.teacher_code = Llista.ESP
leave_absence.substitute_code = Llista.REDUIT
```

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

#### assignatures Rules

Timetable/source rows usually contain the subject short code.

To display a subject:

1. Read the source subject code.
2. Match it against `assignatures.short_name`.
3. If a match exists and `assignatures.full_name` is not blank, use `assignatures.full_name`.
4. If no match exists, or `full_name` is blank, fall back to the raw subject code.

Example:

| Field | Value |
| --- | --- |
| Source subject code | `ANG` |
| `assignatures.short_name` | `ANG` |
| `assignatures.full_name` | `ANGLÈS` |

Display value: `ANGLÈS`

Recommended usage:

| Purpose | Field |
| --- | --- |
| Stable internal subject value | `short_name` / raw subject code |
| User-facing subject name | `full_name` |

This keeps filters, joins, and comparisons stable even if the displayed subject name changes.

## Table: Grades

Logical table name in registry: `Grades`

This logical table contains student group subject assignments.

### Sheet: subjects

`subjects` maps student groups to the teachers and subjects assigned to them.

Row 1 contains headers. Data starts in row 2.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric row identifier. |
| B | `grup` | Student group name. |
| C | `prof_reduit` | Teacher code. Matches `Dades de professors` -> `Llista.REDUIT`. |
| D | `mat_reduit` | Subject code. Matches `Càrrega lectiva` -> `assignatures.short_name`. |

#### subjects Rules

`id` is an autonumeric value used to identify each row.

`grup` stores the student group name exactly as used by the application.

`prof_reduit` stores the teacher's reduced code. To resolve complete teacher information:

1. Read `subjects.prof_reduit`.
2. Match it against `Dades de professors` -> `Llista.REDUIT`.
3. Use the matching `Llista` row as the complete teacher record.

`mat_reduit` stores the subject's reduced code. To resolve complete subject information:

1. Read `subjects.mat_reduit`.
2. Match it against `Càrrega lectiva` -> `assignatures.short_name`.
3. Use the matching `assignatures` row as the complete subject record.

Teacher-code comparisons should use `normalizeCode`.

Subject-code comparisons should trim surrounding spaces and use the same casing convention as `assignatures.short_name`.

## Cache: subjects_cache

The `subjects_cache` sheet is a derived cache used by endpoint scripts that need group, teacher, and subject display data without repeatedly joining multiple spreadsheets at request time.

The cache is rebuilt from:

| Source | Purpose |
| --- | --- |
| `Grades` -> `subjects` | Base group/teacher/subject assignment rows. |
| `Dades de professors` -> `Llista` | Teacher full-name resolution by `REDUIT` / `REDUÏT`. |
| `Càrrega lectiva` -> `assignatures` | Subject full-name resolution by `short_name`. |

### Cache Sheet Contract

Sheet name: `subjects_cache`

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Original `Grades.subjects.id`. |
| B | `grup` | Original `Grades.subjects.grup`. |
| C | `prof_reduit` | Original `Grades.subjects.prof_reduit`. |
| D | `teacher_full_name` | Resolved teacher full name from `Llista`: `NOM COGNOM1 COGNOM2`. |
| E | `mat_reduit` | Original `Grades.subjects.mat_reduit`. |
| F | `subject_full_name` | Resolved subject display name from `assignatures.full_name`. Falls back to `mat_reduit`. |

### Cache Rules

The cache should be rebuilt manually from a spreadsheet menu before endpoint data is consumed, or automatically by a trigger if the endpoint requires fresh data.

The menu item is:

```text
Cache -> Rebuild subjects cache
```

Teacher resolution:

1. Read `subjects.prof_reduit`.
2. Normalize it with `normalizeCode_`.
3. Match it against `Llista.REDUIT` or `Llista.REDUÏT`, also normalized.
4. Build `teacher_full_name` from `NOM`, `COGNOM1`, and `COGNOM2`.
5. Omit blank name parts.

Subject resolution:

1. Read `subjects.mat_reduit`.
2. Normalize it with `normalizeCode_`.
3. Match it against `assignatures.short_name`, also normalized.
4. Use `assignatures.full_name` when present.
5. Fall back to the raw `mat_reduit` when no subject match or full name exists.

If a teacher cannot be resolved, `teacher_full_name` should be blank. The cache rebuild must not fail just because a teacher or subject reference is missing.

### Spreadsheet GAS Function

This function can be pasted into the spreadsheet-bound Apps Script project that owns the cache sheet.

The script requires the `db` script property described in the Database Registry section.

```js
const CACHE_SHEET_NAME = 'subjects_cache';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Cache')
    .addItem('Rebuild subjects cache', 'rebuildSubjectsCache')
    .addToUi();
}

function rebuildSubjectsCache() {
  const gradesSpreadsheet = openLogicalTableSpreadsheet_('Grades');
  const subjectsSheet = getRequiredSheet_(gradesSpreadsheet, 'subjects');

  const teachersSpreadsheet = openLogicalTableSpreadsheet_('Dades de professors');
  const teachersSheet = getRequiredSheet_(teachersSpreadsheet, 'Llista');

  const subjectsCatalogSpreadsheet = openLogicalTableSpreadsheet_('Càrrega lectiva');
  const assignaturesSheet = getRequiredSheet_(subjectsCatalogSpreadsheet, 'assignatures');

  const subjectRows = readRowsByHeader_(subjectsSheet);
  const teacherRows = readRowsByHeader_(teachersSheet);
  const assignaturaRows = readRowsByHeader_(assignaturesSheet);

  const teachersByReduit = new Map();
  teacherRows.forEach(row => {
    const reduit = normalizeCode_(getField_(row, 'REDUIT', 'REDUÏT'));
    if (!reduit) return;

    teachersByReduit.set(reduit, buildTeacherFullName_(row));
  });

  const subjectsByShortName = new Map();
  assignaturaRows.forEach(row => {
    const shortName = normalizeCode_(getField_(row, 'short_name'));
    if (!shortName) return;

    const fullName = String(getField_(row, 'full_name') || getField_(row, 'short_name') || '').trim();
    subjectsByShortName.set(shortName, fullName);
  });

  const cacheHeaders = [
    'id',
    'grup',
    'prof_reduit',
    'teacher_full_name',
    'mat_reduit',
    'subject_full_name'
  ];

  const cacheValues = subjectRows.map(row => {
    const profReduit = getField_(row, 'prof_reduit');
    const matReduit = getField_(row, 'mat_reduit');

    const teacherFullName = teachersByReduit.get(normalizeCode_(profReduit)) || '';
    const subjectFullName =
      subjectsByShortName.get(normalizeCode_(matReduit)) ||
      String(matReduit || '').trim();

    return [
      getField_(row, 'id'),
      getField_(row, 'grup'),
      profReduit,
      teacherFullName,
      matReduit,
      subjectFullName
    ];
  });

  const targetSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const cacheSheet = getOrCreateSheet_(targetSpreadsheet, CACHE_SHEET_NAME);

  cacheSheet.clearContents();
  cacheSheet.getRange(1, 1, 1, cacheHeaders.length).setValues([cacheHeaders]);

  if (cacheValues.length > 0) {
    cacheSheet
      .getRange(2, 1, cacheValues.length, cacheHeaders.length)
      .setValues(cacheValues);
  }

  cacheSheet.autoResizeColumns(1, cacheHeaders.length);

  SpreadsheetApp.getUi().alert(`Subjects cache rebuilt: ${cacheValues.length} rows.`);
}

function openLogicalTableSpreadsheet_(logicalTableName) {
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) {
    throw new Error('Missing script property: db');
  }

  const registrySpreadsheet = SpreadsheetApp.openById(dbId);
  const tablesSheet = getRequiredSheet_(registrySpreadsheet, 'tables');
  const rows = tablesSheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    const spreadsheetId = String(rows[i][1] || '').trim();

    if (name === logicalTableName && spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  }

  throw new Error(`Logical table not found in registry: ${logicalTableName}`);
}

function readRowsByHeader_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(header => String(header || '').trim());

  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => {
      const record = {};
      headers.forEach((header, index) => {
        if (!header) return;

        record[header] = row[index];
        record[normalizeHeader_(header)] = row[index];
      });
      return record;
    });
}

function buildTeacherFullName_(teacherRow) {
  return [
    getField_(teacherRow, 'NOM'),
    getField_(teacherRow, 'COGNOM1'),
    getField_(teacherRow, 'COGNOM2')
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function getField_(row, ...headers) {
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row, header)) {
      return row[header];
    }

    const normalizedHeader = normalizeHeader_(header);
    if (Object.prototype.hasOwnProperty.call(row, normalizedHeader)) {
      return row[normalizedHeader];
    }
  }

  return '';
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeCode_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  return sheet;
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}
```

## Implementation Requirements

### Header Handling

Always read sheets by header names when possible, not by hardcoded column numbers.

If fixed column positions are required, use the schemas defined in this document.

Header matching should be robust to surrounding spaces.

### Code Normalization

Teacher-code joins must normalize codes before comparison:

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
| `Llista.REDUIT` |
| `leave_absence.teacher_code` |
| `leave_absence.substitute_code` |

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

For most applications:

| Use case | Field |
| --- | --- |
| Normal teacher operations | `Llista.REDUIT` |
| Matching original teachers in leave records | `Llista.ESP` |
| Substitute teacher stored in leave records | `leave_absence.substitute_code` as `REDUIT` |
| Stable subject code | `assignatures.short_name` |
| Display subject name | `assignatures.full_name` |
| Group subject teacher | `subjects.prof_reduit` matched to `Llista.REDUIT` |
| Group subject code | `subjects.mat_reduit` matched to `assignatures.short_name` |
