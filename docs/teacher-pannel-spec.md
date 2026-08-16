# Teacher Panel Endpoint Specification

This document defines the teacher-facing endpoint that consumes evaluation sheets created by the `configuration` script.

## Purpose

The teacher panel lets teachers fill in generated evaluation tables without using the configuration endpoint.

The endpoint must not interact with `Grades` -> `subjects_cache`. That cache is only an input used earlier by the configuration script when creating a generated evaluation sheet.

For teacher workflows, the main database is always the generated evaluation sheet:

```text
Grades -> {sheet_name}
```

The endpoint must always read `Grades` -> `avaluacions` first to know which generated sheet can be used.

## Apps Script

| Field | Value |
| --- | --- |
| Folder | `scripts/teacher_pannel` |
| Script ID | Stored only in the local ignored `.clasp.json`; do not commit it. |
| Page title | `Avaluació` |

## Deployment

Deploy as a web app.

| Setting | Value |
| --- | --- |
| Execute as | Owner / me |
| Who has access | Users in `iernestlluch.cat` |

The script also checks the active user's email domain and rejects users outside `@iernestlluch.cat`.

Local `.clasp.json` files are intentionally ignored by git. The script folder
must keep a local `.clasp.json` pointing to the correct Apps Script project so
`clasp push` and `clasp deploy` target the right script.

## Data Sources

Logical table name in registry:

```text
Grades
```

Required sheets:

| Sheet | Purpose |
| --- | --- |
| `avaluacions` | Lists available evaluation periods and their generated sheet names. |
| `{sheet_name}` | Main evaluation sheet and only writable teacher-panel database. |
| `{sheet_name}_config` | Reference sheet for dropdown values and custom concept options. |

## Evaluation Registry

The endpoint reads `Grades` -> `avaluacions`.

Expected columns:

| Header | Meaning |
| --- | --- |
| `id` | Stable evaluation register id. |
| `nom_av` | Human-readable evaluation name. |
| `sheet_name` | Generated main evaluation sheet name inside the `Grades` spreadsheet. |
| `Estat` | Workflow status. |

If an old header named `sheet_id` exists, readers may treat it as `sheet_name` for compatibility.

Only evaluations where `Estat` is exactly:

```text
Avaluació professors
```

are available in the teacher panel.

If no evaluation is in that state, the endpoint shows a clear error. If one evaluation is available, it is loaded directly. If more than one is available, the endpoint shows an evaluation selector.

Before saving, the endpoint re-checks `avaluacions` and rejects the save if the selected evaluation is no longer in `Avaluació professors`.

## Main Evaluation Sheet

Generated evaluation sheets contain:

| Header | Purpose |
| --- | --- |
| `group` | Canonical local group code array copied from `subjects_cache.group`. It may contain comma-separated values such as `1F,2F`. |
| `group_name` | Display group name or comma-separated display group names. |
| `teacher_full_name` | Teacher name. |
| `teacher_email` | Teacher email. |
| `subject_full_name` | Subject name. |
| `student_full_name` | Student name. |
| `grup_tutoria` | Tutorial group display value for the student. |
| `PI` | Editable checkbox column. |
| `Avaluació de la matèria` | Editable subject evaluation dropdown. |
| custom concept columns | Editable configured concepts. |
| `student_account_id` | Hidden Dinantia student account id reserved for sync workflows. |
| `subject_order` | Hidden numeric subject order copied from `subjects_cache.order`. |

`group_name` can contain a single display group, such as:

```text
2n ESO A
```

or a comma-separated group array, such as:

```text
2n ESO A, 2n ESO B, 2n ESO C, 2n ESO D, 2n ESO E
```

When a row has a group array, it is one unique grade record and must still be saved only once. The row is visible when the selected `Grup` matches any comma-separated value in `group_name`.

The teacher panel uses `group_name`, not `group`, to build the visible `Grup` selector. The `group` column remains non-writable local metadata.

The endpoint identifies writable rows by their original spreadsheet row number, `sheetRow`. It must never use student name, group, subject, selected group, or visible row order as the write identity.

Teacher-specific views match the active user's email against `teacher_email`. Email matching is trimmed and case-insensitive.

If the active teacher email does not appear in the selected evaluation sheet, show:

```text
No tens alumnes assignats en aquesta avaluació.
```

## Config Sheet

The endpoint reads `{sheet_name}_config` for dropdown values.

| Column | Purpose |
| --- | --- |
| B | Values for `Avaluació de la matèria`. |
| C | Optional `avaluacio_reduit` column with reduced labels for the subject-evaluation values in column B. |
| D | Optional `Color` column with hex colors for the subject-evaluation values in column B. |
| E onward | Concept names and optional dropdown values. |

New config sheets have `avaluacio_reduit` as the header in column C and `Color`
as the header in column D. Old config sheets may not. The backend must inspect
the config headers:

- If column C is `avaluacio_reduit` and column D is `Color`, read reduced
  labels from C, colors from D, and treat concept columns as starting at E.
- If column C is `Color`, treat the sheet as the previous color-only layout:
  read colors from C and treat concept columns as starting at D.
- If column C is neither `avaluacio_reduit` nor `Color`, treat the sheet as the
  oldest layout and concept columns as starting at C.

Color values are six-digit hex strings, for example `#FFFFFF` or `#2F80ED`.
The default color is `#FFFFFF`.

For custom concept columns:

- Show all remaining main-sheet headers after `Avaluació de la matèria` exactly as they appear.
- Exclude `student_account_id`.
- Exclude `subject_order`.
- Ignore the config `avaluacio_reduit` and `Color` columns when resolving custom concept options.
- If the matching config column has values, render a dropdown.
- If the matching config column has no values, render an open text field.

The backend must expose the subject-evaluation color map with the evaluation
data as `subjectEvaluationColors`. It must also expose reduced labels as
`subjectEvaluationReducedNames`. Example:

```json
{
  "subjectEvaluationReducedNames": {
    "No assolit": "NA",
    "Assoliment satisfactori": "AS"
  },
  "subjectEvaluationColors": {
    "No assolit": "#FFFFFF",
    "Assoliment satisfactori": "#A7F3D0"
  }
}
```

Options without a valid configured color may be omitted from the map or treated
as `#FFFFFF` by the consumer.

## UI Flow

The page title is:

```text
Avaluació
```

After the evaluation is selected or auto-loaded, show:

| Control | Source |
| --- | --- |
| `Grup` | Unique comma-separated values from `group_name` in rows matching the active teacher email. |
| `Matèria` | Unique `subject_full_name` values for the selected group and active teacher email, sorted by `subject_order`, then subject name. |

The table is shown only after both `Grup` and `Matèria` are selected.

The table title is:

```text
{common_group_name} - {subject_full_name}
```

When all matching rows use a group array, `common_group_name` is the common part of the group names. For example, `4t ESO A, 4t ESO B` is displayed as `4t ESO`.

Rows are sorted alphabetically by `student_full_name`. If a combined view ever
shows more than one subject for the same student, sort those subjects by
`subject_order`, then `subject_full_name`.

Table columns:

| UI column | Sheet column |
| --- | --- |
| `Alumne` | `student_full_name` |
| `PI` | `PI` |
| `Avaluació de la matèria` | `Avaluació de la matèria` |
| remaining concept headers | matching concept columns |

The `grup_tutoria` column is metadata and is not editable in the teacher panel.

The `PI` column is mandatory and must be fixed-width. It should be narrow enough to contain only the `PI` header and one checkbox per data row. It must not auto-expand like normal table columns.

Any edited row is highlighted yellow.

When a teacher selects a value in `Avaluació de la matèria`, that dropdown's
background must change to the color configured for that value in
`subjectEvaluationColors`. If the value has no configured valid color, use
`#FFFFFF`. Existing loaded values should be colored when the table first
renders.

Dirty-row highlighting remains a row-level yellow highlight and is independent
from the dropdown color.

## Busy State

For loading, saving, synchronization, and other blocking operations, the page must:

1. Fade the whole page.
2. Block user interaction.
3. Show a centered animated loading icon.
4. Show the current status/progress text below that icon.

During a blocking operation, status text must appear only inside the centered overlay, not below the page title. After the operation finishes, the overlay closes and the normal status area below the title can show the final success or error message.

## Save Flow

The endpoint has a floating save button with a 3.5-inch disk icon.

When saving:

1. Disable the page.
2. Show the full-page busy overlay.
3. Send only dirty rows to the backend.
4. Re-check the selected evaluation status in `avaluacions`.
5. Confirm each edited `sheetRow` still belongs to the active teacher email.
6. Write the values to the selected `Grades` -> `{sheet_name}` sheet.
7. Reload data from the spreadsheet.
8. Re-render the selected group and subject when still available.
9. Clear yellow highlighting only after the reload succeeds.

Writable fields:

| Field | Rule |
| --- | --- |
| `PI` | Boolean checkbox. |
| `Avaluació de la matèria` | String selected from config values. |
| custom concept columns | String from dropdown or open text input. |

Non-writable fields such as group, `grup_tutoria`, teacher, subject, student name, and `student_account_id` must not be changed by this endpoint.

The backend must calculate writable column positions from headers, not from fixed column letters. This keeps saves correct when generated sheets include optional metadata columns such as `group`.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `getTeacherPanelData` | Loads available active evaluations. |
| `getTeacherEvaluationData` | Loads rows for the active teacher in a selected evaluation. |
| `saveTeacherEvaluationRows` | Saves dirty teacher-editable values back to the generated evaluation sheet. |

All other functions must be private helpers with a trailing underscore.

## Implementation Requirements

- Use the shared database registry pattern documented in `database-spec.md`.
- Do not read from or write to `subjects_cache`.
- Do not call Dinantia for teacher-panel reads or saves.
- Use the generated evaluation sheet as the main writable database.
- Preserve generated sheet headers.
- Keep `student_account_id` hidden from the UI and non-writable.
- Keep public functions limited to endpoint entrypoints and frontend handlers.
- Keep helper functions private with a trailing underscore.
- Do not write Dinantia credentials or other secrets to source, docs, logs, or UI.
