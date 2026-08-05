# configuration

Google Apps Script web app for configuration workflows.

## Apps Script

- Script ID: `1qj0U_bBSfrHpxSzXt5goCaloM_npZAZcRiw6IiGdLMI_XrrP595eiehD`

## Endpoint

The script serves an HTML page with `doGet()`.

Page title: `Configuració`

Data source:

- `Grades` -> `subjects_cache`

The page lets users select one group at a time from `subjects_cache.group_name`.

When a group is selected, the page shows editable dropdown rows for:

- `Assignatura`
- `Professor`
- `Grup d'alumnes per avaluar`

Manual edits are saved directly to `Grades` -> `subjects_cache`.

The page includes a floating refresh button that warns users before rebuilding `Grades` -> `subjects_cache` from `Horaris` -> `GPU001`.

The page also includes a floating `Crear avaluació` button. It creates:

- a blank main evaluation sheet
- a `{sheet_name}_config` sheet
- a row in `Grades` -> `avaluacions`
- main-sheet rows by expanding `subjects_cache` through Dinantia students

Evaluation expansion reads Dinantia accounts once, filters `Student` accounts, and indexes them by `account.groups.member`. Those membership values are string group IDs such as `1r ESO A`.

During evaluation creation, the page polls progress by run ID and shows the latest stage in the status area.

Generated evaluation sheets copy the teacher email next to the teacher name and include a hidden `student_account_id` column for future sync work.

The public cache rebuild function is:

```text
buildSubjectsCache
```

When the cache is rebuilt, the script:

1. Reads `Horaris` -> `GPU001`.
2. For each group/subject, keeps the teacher or tied teachers with the most scheduled hours.
3. Deduplicates rows by group, teacher, and subject.
4. Resolves group names from `Dinantia` -> `dinantia_2_dades_alumnes`.
5. Resolves teacher names and emails from `Dades de professors` -> `Llista`.
6. Resolves subject names from `Càrrega lectiva` -> `assignatures`.
7. Rewrites `Grades` -> `subjects_cache` entirely.

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
