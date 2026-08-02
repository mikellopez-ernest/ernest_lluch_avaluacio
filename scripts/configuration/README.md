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

The public cache rebuild function is:

```text
buildSubjectsCache
```

When the cache is rebuilt, the script:

1. Reads `Horaris` -> `GPU001`.
2. Deduplicates rows by group, teacher, and subject.
3. Resolves group names from `Dinantia` -> `dinantia_2_dades_alumnes`.
4. Resolves teacher names from `Dades de professors` -> `Llista`.
5. Resolves subject names from `Càrrega lectiva` -> `assignatures`.
6. Rewrites `Grades` -> `subjects_cache` entirely.

The rebuild is dangerous because it can overwrite manual edits in `subjects_cache`.

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
