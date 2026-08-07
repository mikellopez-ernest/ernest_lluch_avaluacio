# teacher_pannel

Google Apps Script web app for teacher-facing evaluation workflows.

## Apps Script

- Script ID: `1CLBSkbrZagzWSX8VxBot_sPZaQVBnexGdocsCm-_xeMTRqoIgI_hpoby`

## Endpoint

The script serves an HTML page with `doGet()`.

Page title: `Avaluació`

Data sources:

- `Grades` -> `avaluacions`
- Generated evaluation sheets referenced by `avaluacions.sheet_name`
- Generated config sheets named `{sheet_name}_config`

The endpoint never reads from or writes to `Grades` -> `subjects_cache`.

## Behavior

On load, the endpoint reads `Grades` -> `avaluacions` and keeps only evaluations where:

```text
Estat = Avaluació professors
```

If no evaluation is available, it shows an error. If one is available, it loads it directly. If multiple are available, it shows an evaluation selector.

After an evaluation is selected, the endpoint:

1. Reads the active user's email.
2. Opens the selected generated evaluation sheet.
3. Filters rows where `teacher_email` matches the active user's email, trimmed and case-insensitive.
4. Shows only groups and subjects present in those filtered rows.
5. Shows the editable table only after both `Grup` and `Matèria` are selected.

If no row matches the teacher email, the endpoint shows:

```text
No tens alumnes assignats en aquesta avaluació.
```

Editable values:

| UI field | Sheet column |
| --- | --- |
| `PI` | `PI` |
| `Avaluació de la matèria` | `Avaluació de la matèria` |
| Custom concept fields | Remaining concept columns, excluding `student_account_id` |

Rows are identified for saving by their original spreadsheet row number, not by student name or display order.

Changed rows are highlighted yellow. The floating save button sends only dirty rows, blocks the page while saving, reloads the data from the spreadsheet, and clears yellow highlighting only after the reload succeeds.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `getTeacherPanelData` | Loads available active evaluations. |
| `getTeacherEvaluationData` | Loads teacher-filtered rows for a selected evaluation. |
| `saveTeacherEvaluationRows` | Saves dirty teacher edits back to the generated evaluation sheet. |

All implementation helpers should use a trailing underscore.

## Deployment

Deploy as a web app with:

| Setting | Value |
| --- | --- |
| Execute as | Owner / `admindomini@iernestlluch.cat` |
| Who has access | Users in `iernestlluch.cat` |

The script also checks the active user's email domain and rejects users outside `@iernestlluch.cat`.

## Manual Authorization

After pushing the script, the owner should run this function once from the Apps Script editor:

```text
grantPermissionsManually
```

This forces Google to show the authorization prompt before users open the endpoint. It checks access to:

- the database registry from script property `db`
- `Grades` -> `avaluacions`

## Common Commands

```sh
clasp pull
clasp push
clasp deploy --description "teacher_pannel web app"
```

The local `.clasp.json` file is intentionally ignored by git, matching the repository's existing clasp-secret policy.
