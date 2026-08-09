# configuration

Google Apps Script web app for configuration workflows.

Canonical behavior is specified in
[`docs/configuration-endpoint-spec.md`](../../docs/configuration-endpoint-spec.md).
Database sheet contracts are specified in
[`docs/database-spec.md`](../../docs/database-spec.md).

## Apps Script

- Script ID: `1qj0U_bBSfrHpxSzXt5goCaloM_npZAZcRiw6IiGdLMI_XrrP595eiehD`

## Endpoint

The script serves an HTML page with `doGet()`.

Page title: `Configuració`

Data source:

- `Grades` -> `subjects_cache`

The page lets users select one group code at a time from `subjects_cache.group`.
If a cache row contains a comma-separated group array such as `1F,2F`, that
same row appears when either `1F` or `2F` is selected.

When a group is selected, the page shows editable dropdown rows for:

- `Assignatura`
- `Professor`
- `Grup d'alumnes per avaluar`

Manual edits are saved directly to `Grades` -> `subjects_cache`.
Rows can also be deleted from the editor and are removed from `subjects_cache` on save.
When saving, loading, rebuilding, or creating evaluations, the page fades behind
a blocking overlay with an animated loading icon and the current status text.

The page includes a floating refresh button that warns users before rebuilding `Grades` -> `subjects_cache` from `Horaris` -> `GPU001`.

The page also includes a floating `Crear avaluació` button. It lets the user
choose the group codes to evaluate, then creates:

- a blank main evaluation sheet
- a `{sheet_name}_config` sheet
- a row in `Grades` -> `avaluacions`
- main-sheet rows by expanding `subjects_cache` through Dinantia students

The create-evaluation modal lets users choose which groups to include.

Evaluation expansion reads Dinantia accounts once, filters `Student` accounts, and indexes them by `account.groups.member`. Those membership values are string group IDs such as `1r ESO A`.

During evaluation creation, the page polls progress by run ID and shows the latest stage in the status area.

Generated evaluation config sheets include subject-evaluation colors in the
`Color` column. Generated evaluation sheets copy the `subjects_cache.group`
array, copy the teacher email next to the teacher name, fill `grup_tutoria`
from each student's `TUTORIA` row, always include a `PI` checkbox column
defaulting to false, and include a hidden `student_account_id` column.

`Grades` -> `avaluacions` stores `Estat = Creada` for new evaluations and validates the status cell against the configured workflow states.

The public cache rebuild function is:

```text
buildSubjectsCache
```

When the cache is rebuilt, the script:

1. Reads `Horaris` -> `GPU001`.
2. First cleans by `group + subject`, keeping only the teacher or tied teachers with the most rows.
3. Collapses repeated `group + teacher + subject` rows.
4. Then groups by `GPU001` column A, the event code.
5. Joins all distinct groups for each kept teacher/subject event into one cache row.
6. Resolves group names from `Dinantia` -> `dinantia_2_dades_alumnes`.
7. Resolves teacher names and emails from `Dades de professors` -> `Llista`.
8. Resolves subject names from `Càrrega lectiva` -> `assignatures`.
9. Rewrites `Grades` -> `subjects_cache` entirely.

The endpoint treats `subjects_cache.group` as a comma-separated array of group
codes. New rows added from the editor use the currently selected group code.
Existing multi-group rows keep their original group array when edited.

The rebuild is dangerous because it can overwrite manual edits in `subjects_cache`.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `buildSubjectsCache` | Full rebuild of `Grades` -> `subjects_cache`. |
| `getConfigurationData` | Frontend data loader. |
| `saveSubjectsCacheEdits` | Saves edited/new `subjects_cache` rows. |
| `createEvaluation` | Creates evaluation sheets and expands them by Dinantia students. |
| `getEvaluationCreationStatus` | Returns progress for a running evaluation creation. |

All implementation helpers should use a trailing underscore.

## Deployment

Deploy as a web app with:

| Setting | Value |
| --- | --- |
| Execute as | Owner / me |
| Who has access | Users in `iernestlluch.cat` |

The script also checks the active user's email domain and rejects users outside `@iernestlluch.cat`.

## Manual Authorization

After pushing the script, the owner should run this function once from the Apps Script editor:

```text
grantPermissionsManually
```

This forces Google to show the authorization prompt before users open the endpoint. It checks access to:

- the database registry from script property `db`
- `Grades` -> `subjects_cache`
- `Grades` -> `avaluacions`
- `Horaris` -> `GPU001`
- `Dinantia` -> `dinantia_2_dades_alumnes`
- `Dades de professors` -> `Llista`
- `Càrrega lectiva` -> `assignatures`

## Common Commands

```sh
clasp pull
clasp push
clasp open
```
