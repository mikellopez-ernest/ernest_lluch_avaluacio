# av_session

Google Apps Script web app for session-mode evaluation grading.

Canonical behavior is specified in
[`docs/av-session-spec.md`](../../docs/av-session-spec.md).

## Apps Script

- Script ID: `1I_6-JdbYTk2leRBGJKx-eeEnKxy4EpkJVpS1nApQJRd0OdRZqDyezY8M`

## Endpoint

The script serves an HTML page with `doGet()`.

Page title: `Sessió d'avaluació`

The endpoint resolves the active user's visible groups through:

```text
Session.getActiveUser().getEmail()
-> Dades de professors -> Llista.CORREU INSTIT
-> effective teacher full name
-> Càrrega lectiva -> carrecs.asignado?
-> Dinantia -> teachers_2_dinantia.carrec
-> teachers_2_dinantia.dinantia_group_names
```

If the logged-in teacher is a substitute (`SUBST? = TRUE`), the endpoint uses
`Dades de professors -> leave_absence` to resolve the main teacher whose
responsibilities should be used. The visible acting teacher remains the
logged-in substitute.

The endpoint lets authorized users select an evaluation in `Mode junta`, select
one of their visible Dinantia group IDs, and then grade either by student or by
subject.

For performance, student and subject selectors are derived from the selected
evaluation sheet filtered by `grup_tutoria`; this endpoint does not call the
Dinantia API while loading the session table.

The save flow is also screen-scoped for performance: it reads and writes only
the dirty `sheetRow` values currently visible in the table and returns
`updatedRows` for the browser to merge locally.

The special marker `ADMIN_PRIVILEGES` enables admin-only actions but is not a
real group and is never shown in the group selector. When present, the UI shows
an informational `Admin` badge beside the title.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `getAvSessionData` | Loads active-user context, visible groups, and `Mode junta` evaluations. |
| `getAvSessionEvaluationData` | Loads students and subjects for a selected evaluation and group. |
| `getAvSessionRows` | Loads table rows for the selected student or subject. |
| `saveAvSessionRows` | Saves dirty editable values. |

All implementation helpers should use a trailing underscore.

## Common Commands

```sh
clasp pull
clasp push
clasp deploy --description "av_session web app"
```

The local `.clasp.json` file is intentionally ignored by git, matching the repository's existing clasp-secret policy.
