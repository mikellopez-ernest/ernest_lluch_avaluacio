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
Group lists keep first-appearance order from `subjects_cache`, reading rows top
to bottom and comma-separated arrays left to right.

When a group is selected, the page shows editable dropdown rows for:

- `Tutoria`
- `Ordre`
- `Assignatura`
- `Professor`
- `Grup d'alumnes per avaluar`

`Tutoria` is a radio button backed by `subjects_cache.materia_clau`. Only one
row can be selected as the key subject for each individual group code.
`Ordre` is a numeric field backed by `subjects_cache.order`; lower values appear
first, and blank values appear last.
`Assignatura` normally uses the subject list, but users can choose `Afegir una
nova matèria` and type a free-text subject name.

Manual edits are saved directly to `Grades` -> `subjects_cache`.
Rows can also be deleted from the editor and are removed from `subjects_cache` on save.
When saving, loading, rebuilding, or creating evaluations, the page fades behind
a blocking overlay with an animated loading icon and the current status text.

The page includes a floating refresh button that warns users before rebuilding `Grades` -> `subjects_cache` from `Horaris` -> `GPU001`.

The page also includes a floating `Crear avaluació` button. It lets the user
choose the group codes to evaluate, then creates:

- a blank main evaluation sheet
- a `{sheet_name}_config` sheet
- a `{sheet_name}_tutoria` sheet
- a row in `Grades` -> `avaluacions`
- main and tutoria rows by expanding `subjects_cache` through Dinantia students

The create-evaluation modal lets users choose which groups to include.

Evaluation expansion reads Dinantia accounts once, filters `Student` accounts, and indexes them by `account.groups.member`. Those membership values are string group IDs such as `1r ESO A`.

During evaluation creation, the page polls progress by run ID and shows the latest stage in the status area.

Generated evaluation config sheets include subject-evaluation reduced labels in
`avaluacio_reduit` and colors in `Color`. Generated evaluation sheets copy the
`subjects_cache.group` array and copy the teacher email next to the teacher name. Rows where
`subjects_cache.materia_clau` is true are written to `{sheet_name}_tutoria`
instead of the main sheet. The main sheet fills `grup_tutoria` from the matching
tutoria row, always includes a `PI` checkbox column defaulting to false, and
includes hidden `student_account_id` and `subject_order` columns.

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
9. Sets `materia_clau` true for TUTORIA rows by default and false for other rows.
10. Sets `order = 0` for TUTORIA rows by default and leaves other order values blank.
11. Rewrites `Grades` -> `subjects_cache` entirely, including checkbox validation on `materia_clau`.

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
