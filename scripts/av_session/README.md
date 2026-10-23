# av_session

Google Apps Script web app for session-mode evaluation grading.

Canonical behavior is specified in
[`docs/av-session-spec.md`](../../docs/av-session-spec.md).

## Apps Script

- Script ID: stored only in the local ignored `.clasp.json`; do not commit it.
- Deployment type: web app, executed as the owner and restricted to users in
  `iernestlluch.cat`.

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

The endpoint lets authorized users select an evaluation in `Avaluació
professors`, `Mode junta`, or `Tancada`, select one of their visible Dinantia
group IDs, and enter or review the corresponding session data.

For performance, student and subject selectors are derived from the selected
evaluation sheet filtered by `grup_tutoria`; this endpoint does not call the
Dinantia API while loading the session table.

The save flow is also screen-scoped for performance: it reads and writes only
the dirty `sheetRow` values currently visible in the table and returns
`updatedRows` for the browser to merge locally.

In `Mode junta`, the group load also reads the selected row from
`{sheet_name}_tutoria_grups`. The three-row `Acords de junta del grup {group}`
editor keeps that value in browser memory while the user navigates between
students and subjects. Saving writes `Comentari_grup`, `updated_at`, and
`updated_by` only when the shared comment actually changed. The editor is not
loaded or shown in `Avaluació professors` or `Tancada`. Older evaluations
without the new sheet still load normally and simply hide this editor.

In `Avaluació professors` and `Mode junta`, the bottom-right action area has the
existing Save button and one full-color Print button. The Print button opens a
menu for the selected-student bulletin, the group XLSX acta, and three group PDF
actas: statistics, full signatures, and board agreements. In `Tancada`, that
same Print button is shown without the student-bulletin option; it retains the
selected-group XLSX acta and the three group PDF actas. Their layouts live in
`PdfReport.html`, `ActaStatistics.html`, `ActaSignatures.html`, and
`ActaAgreements.html` so they can be edited without changing data-access code.
Each acta header identifies the group's main tutor as `Tutor: {name}`, using
the teacher assigned to the `Tutoria` subject in the evaluation sheet and the
matching `_tutoria` data as a fallback.
The statistics PDF is a single compact landscape table with abbreviated subject
headers and a full abbreviation legend; it intentionally omits tutor comments
and `Recompte NA`. Its 10.25 pt compact layout is applied to every group and was
calibrated against the current largest class (28 students) and widest subject
set (21 subjects) so the complete acta remains on one A4 landscape page.
The signatures PDF uses a 7.75 pt, four-column grid with up to 24 teachers per
page; `4t ESO B` is the current one-page boundary case.

For administrators, each of the three group PDF acta options opens a second
scope menu with `Aquest grup` and `Tots els grups`. The all-groups choice is
authorized on the server and downloads one PDF containing every group in the
selected evaluation, with each group starting on a new page. The student
bulletin remains student-specific and the Excel option remains a selected-group
XLSX export.

In `Tancada`, administrator bulk PDF and email buttons also offer `Aquest grup`
and `Tots els grups`. These operations are persistent jobs rather than one long
web request. Their state and full audit are stored in `Grades` sheets
`av_session_jobs`, `av_session_job_items`, and `av_session_job_events`; a single
one-minute trigger runs `processAvSessionBatchJobs`. The page shows live
progress and supports pause, resume, retry, and audit CSV download. Email work
uses one Gmail draft/message per contact, records draft and message IDs, waits
for recipient quota when needed, and never automatically resends an uncertain
delivery.

The special marker `ADMIN_PRIVILEGES` enables admin-only actions but is not a
real group and is never shown in the group selector. When present, the UI shows
an informational `Admin` badge beside the title.

The comma-separated `admin_privileges` script property is an additional
server-side override. Matching is trimmed and case-insensitive. A matching
`@iernestlluch.cat` account can access every real group represented in
`Dinantia` -> `teachers_2_dinantia`, even when it has no teacher row. The
`ADMIN_PRIVILEGES` marker itself is never shown as a group.

## Private Script Properties

These values must be configured in Apps Script project properties and must not
be committed:

- `db`: database registry spreadsheet ID
- `DRIVE_FOLDER_TUTOR`: Drive folder ID used for generated tutor bulletins
- `admin_privileges`: optional comma-separated administrator emails for this
  Apps Script project
- `bulletin_test_email`: optional safety address. When set, all bulletin emails
  are redirected there and real `_tutoria` send markers are not changed.

These properties are project-local and must not be committed. The
responsibility-derived `ADMIN_PRIVILEGES` marker also enables administrator
actions, but only the `admin_privileges` property broadens the normal group
selector to every mapped real group.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `grantBulletinReplacementPermissions` | Drive-only create/read/share/trash permission probe using a temporary personal-Drive file. |
| `authorizeAvSessionDriveAccess` | Returns Google's full-scope consent link when the executing account still needs project authorization. |
| `getAvSessionData` | Loads active-user context, visible groups, and evaluations in `Avaluació professors`, `Mode junta`, or `Tancada`. |
| `getAvSessionEvaluationData` | Loads students and subjects for a selected evaluation and group. |
| `getAvSessionRows` | Loads table rows for the selected student or subject. |
| `saveAvSessionRows` | Saves dirty grades, individual tutor comments, and shared group comments. |
| `createAvSessionStudentReportPdf` | Generates the selected student's PDF bulletin. |
| `createClosedGroupXlsx` | Generates the selected group's XLSX acta in any session-available state. |
| `createGroupStatisticsPdf` | Generates the selected group's statistics PDF acta. |
| `createGroupSignaturesPdf` | Generates the selected group's teacher/signature PDF acta. |
| `createGroupAgreementsPdf` | Generates the selected group's board-agreements PDF acta. |
| `createAllGroupsActaPdf` | Generates one admin-only PDF containing the selected acta type for every evaluation group. |
| `generateClosedBulletin` / `sendClosedBulletinEmail` | Generates or sends one closed-evaluation student's bulletin. |
| `replaceClosedBulletinV2` | Regenerates a closed bulletin by overwriting the existing Drive PDF whenever editing is allowed, preserving its link. |
| `getClosedBulletinContacts` / `resendClosedBulletinEmail` | Loads the first two valid contacts for a sent bulletin and resends only to the checked contacts. |
| `generateMissingClosedBulletins` / `sendPendingClosedBulletinEmails` | Legacy selected-group bulk handlers used for non-admin closed-mode actions. |
| `setupAvSessionBatchInfrastructure` | Creates/repairs the bulk-job sheets and installs the worker trigger. |
| `getClosedBatchPreflight` | Calculates exact admin bulk-job totals before confirmation. |
| `createClosedBatchJob` | Queues group or all-groups PDF/email work. |
| `getClosedBatchJobs` | Loads job-monitor data. |
| `pauseClosedBatchJob` / `resumeClosedBatchJob` / `retryClosedBatchJob` | Operates a persistent job. |
| `exportClosedBatchAuditCsv` | Downloads the job's item and event audit. |
| `processAvSessionBatchJobs` | Time-driven batch worker. |

All implementation helpers should use a trailing underscore.

## Common Commands

```sh
clasp pull
clasp push
clasp deployments
clasp deploy --deploymentId <existing-deployment-id> --description "av_session web app"
```

Use the existing deployment ID for routine releases so the web-app URL remains
unchanged. Do not commit that ID. The local `.clasp.json` file is intentionally
ignored by git, matching the repository's existing clasp-secret policy.
