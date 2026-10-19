# Evaluation Session Endpoint Specification

This document defines the `av_session` endpoint for session-mode evaluation
grading, tutor comments, and closed-evaluation bulletin actions.

## Purpose

The evaluation session lets an authorized user work with an evaluation according
to its state:

- during `Avaluació professors`, users can review students/subjects and edit
  tutor comments only
- during `Mode junta`, users can grade either one selected student across
  subjects or one selected subject across students
- during `Tancada`, users can review bulletin-generation and sending status for
  each visible group

## Apps Script

| Field | Value |
| --- | --- |
| Folder | `scripts/av_session` |
| Script ID | Stored only in the local ignored `.clasp.json`; do not commit it. |
| Page title | `Sessió d'avaluació` |

Deploy as a web app, not as a library.

## Authorization And Visibility

The endpoint is restricted to users in `iernestlluch.cat` and identifies the
active user with:

```text
Session.getActiveUser().getEmail()
```

Visible groups are resolved through:

```text
Session.getActiveUser().getEmail()
-> Dades de professors -> Llista.CORREU INSTIT
-> effective teacher full name
-> Càrrega lectiva -> carrecs.asignado?
-> Dinantia -> teachers_2_dinantia.carrec
-> teachers_2_dinantia.dinantia_group_names
```

The `dinantia_group_names` values are Dinantia group IDs. They are split by
comma, trimmed, deduped in first-seen order, and shown in the group selector.

`ADMIN_PRIVILEGES` is not a group and is never shown in the group selector. If
this marker is present, the backend returns `isAdmin = true` and the UI displays
an informational `Admin` badge beside the page title. The marker does not grant
extra group visibility by itself.

The script also reads the comma-separated `admin_privileges` script property.
Email matching is trimmed and case-insensitive. A matching in-domain account is
an administrator even without a row in `Dades de professors` -> `Llista`, and
can access every real group listed in
`Dinantia` -> `teachers_2_dinantia.dinantia_group_names`.
`ADMIN_PRIVILEGES` remains a marker and is excluded from the group selector.
The backend repeats this authorization check for every protected request.

The endpoint does not read `Dinantia -> dinantia_2_dades_alumnes` and does not
resolve Dades alumnes sheet names.

The endpoint does not call the Dinantia API.

If the logged-in teacher is a substitute (`SUBST? = TRUE`), active substitution
resolution uses `Dades de professors -> leave_absence` with `REDUÏT` codes and
today in `Europe/Madrid`.

## Available Evaluations

The endpoint reads `Grades -> avaluacions`.

Rows are selectable in the `Avaluació` combo when `Estat` is exactly one of:

```text
Mode junta
Avaluació professors
Tancada
```

If every evaluation row is in `Creada`, the page must show a clear error
message because no evaluation has started yet. This error is an application-level
state: once at least one evaluation has another state, the page uses the normal
selector flow and does not show the all-`Creada` page-level error.

The selected evaluation state controls editability:

| State | Behavior |
| --- | --- |
| `Mode junta` | Grades and `Comentari_tutor` are editable. |
| `Avaluació professors` | Students and subjects are visible, but grade fields are disabled. Only `Comentari_tutor` is editable. |
| `Tancada` | Student/subject grading UI is hidden. The group selector controls a bulletin-status table. |

## UI Flow

The `Avaluació` selector contains every selectable evaluation state:
`Avaluació professors`, `Mode junta`, and `Tancada`. The rest of the controls
depend on the selected evaluation state.

When the selected evaluation is in `Avaluació professors` or `Mode junta`, the
selector row has four horizontal selectors:

| Selector | Source |
| --- | --- |
| `Avaluació` | `Grades -> avaluacions` rows in `Avaluació professors`, `Mode junta`, or `Tancada`. |
| `Grup` | Visible Dinantia group IDs resolved from the active user. |
| `Alumne` | Unique students from evaluation rows where `grup_tutoria` contains the selected group ID. |
| `Matèria` | Unique subjects from evaluation rows where `grup_tutoria` contains the selected group ID. |

In these two states, `Alumne` and `Matèria` are enabled only after both
`Avaluació` and `Grup` are selected. They are mutually exclusive: selecting one
clears the other.

For `Tancada`, the selector row has only two selectors:

| Selector | Source |
| --- | --- |
| `Avaluació` | `Grades -> avaluacions` rows in `Tancada`. |
| `Grup` | Visible Dinantia group IDs resolved from the active user. |

It does not show the `Alumne` or `Matèria` selectors. Once a group is selected,
the page shows the closed-evaluation bulletin table described in
`Closed Evaluation Table`.

If there is only one available evaluation or one visible group, the matching
selector is selected automatically. If both `Avaluació` and `Grup` are available
after auto-selection, the endpoint immediately loads the relevant state-specific
view: student/subject selectors for `Avaluació professors` or `Mode junta`, and
the closed-evaluation bulletin table for `Tancada`.

When the table is visible, the page does not show a title under the selectors.
In student/subject modes, previous/next arrow buttons navigate through the
active selector (`Alumne` or `Matèria`). The left arrow is disabled on the first
item and the right arrow is disabled on the last item. Arrow navigation is
client-side and uses the already-loaded selector values.

In `Avaluació professors` and `Mode junta`, the page has these floating bubble
buttons in the bottom-right corner:

| Button | Behavior |
| --- | --- |
| Save | Saves dirty grade rows and/or the dirty tutor comment. |
| Print | Opens the print menu described below. |

The Save button keeps the existing full-color 3.5-inch disk icon and continues
to save only changed data. The Print button uses a full-color printer icon. Its
menu contains:

| Menu option | Behavior |
| --- | --- |
| `Imprimir butlletí` | Generates the selected student's existing PDF bulletin. It is enabled only when student mode and a student are selected. |
| `Imprimir estadístiques Excel` | Generates the selected group's XLSX acta. |
| `Imprimir acta de junta 1: estadístiques` | Generates the selected group's statistics acta as PDF. |
| `Imprimir acta de junta 2: full signatures` | Generates a PDF with the teachers involved in the group, their subjects, and signature space. |
| `Imprimir acta de junta 3: acords de junta` | Generates a PDF containing the selected group's board agreements. |

The four group-level print options are enabled after an evaluation and visible
group have been loaded. The same two-button surface and the same print menu are
shown in both `Avaluació professors` and `Mode junta`.

For administrators, choosing any of the three group PDF actas opens a second
scope menu:

| Scope | Behavior |
| --- | --- |
| `Aquest grup` | Generates the selected group's PDF exactly as before. |
| `Tots els grups` | Generates one PDF containing the corresponding acta for every group represented in the selected evaluation. Each group starts on a new page. |

The all-groups action is verified again on the server and is rejected unless
the active user resolves as an administrator. Group names are derived from the
selected evaluation's `grup_tutoria` values, not trusted from the browser. The
backend reads the evaluation table, config, tutoria rows, and group comments
once and reuses them while building every group section. Groups without tutoria
rows are omitted because there is no student/tutor dataset from which to build
their acta. The selected-student bulletin stays student-specific, and the Excel
option stays an XLSX export for the selected group.

In `Tancada`, the page has three floating bubble buttons in the bottom-right
corner, ordered from left to right:

| Button | Behavior |
| --- | --- |
| Spreadsheet icon | Generates and downloads the group XLSX acta described in `Group XLSX Acta Export`. |
| PDF icon | Generates PDF bulletins for all remaining students in the selected group whose `Butlletí_url` is blank. |
| Mail icon | Sends bulletin emails for all students in the selected group that do not have a send marker in either `enviat_email_1` or `enviat_email_2`. |

The layout should be vertically compact so the title, selectors, table, and
tutor comment field can fit together on screen. Table rows use reduced padding
and compact controls compared with the teacher panel.

## Data Rules

Generated evaluation sheets are read from `Grades -> {sheet_name}`.

For this endpoint, column G / `grup_tutoria` is treated as the tutoring group
metadata. It may contain one Dinantia group ID or a comma-separated array of
Dinantia group IDs. A row belongs to a group when one split member exactly
matches the selected group ID after trimming, accent-insensitive normalization,
case-insensitive normalization, and whitespace collapsing. Matching remains
item-based; substring matches are not allowed.

For fast performance, both the student selector and the subject selector are
derived from the already-filtered evaluation sheet rows:

1. Read the generated evaluation sheet once.
2. Filter rows by `grup_tutoria`.
3. Build unique sorted students from `student_full_name`.
4. Build unique subjects from `subject_full_name`, sorted by hidden
   `subject_order`, then `subject_full_name`.
5. Return the filtered rows to the browser so switching between `Alumne` and
   `Matèria` does not require another Apps Script call.

When a student is selected, the table shows evaluation rows matching the
selected group and `student_full_name`. Column indexes are resolved by header.

When a subject is selected, the table matches the teacher panel layout for that
subject and group.

After the group-filtered rows are loaded, changing between students, changing
between subjects, and using the arrow buttons must filter locally in the browser
without additional Apps Script calls.

When the selected evaluation is in `Avaluació professors`, all grade controls in
the table are rendered disabled. The user can still navigate the same visible
students and subjects and can still edit `Comentari del tutor` in student mode.
The shared `Acords de junta del grup {group}` field is not loaded or shown in
this state.

When the selected evaluation is in `Tancada`, the endpoint reads
`Grades -> {sheet_name}_tutoria` for the selected group. It does not load or
show the normal grading table, tutor-comment editor, save bubble, print bubble,
student selector, subject selector, or previous/next arrows.

## Table Columns

Student mode columns:

| UI column | Source |
| --- | --- |
| `Matèria` | `subject_full_name` |
| `PI` | `PI` |
| `Avaluació de la matèria` | `Avaluació de la matèria` |
| remaining concept headers | matching concept columns |

Subject mode columns:

| UI column | Source |
| --- | --- |
| `Alumne` | `student_full_name` |
| `PI` | `PI` |
| `Avaluació de la matèria` | `Avaluació de la matèria` |
| remaining concept headers | matching concept columns |

`student_account_id` and `subject_order` are hidden and non-writable.
`subject_order` is copied from `subjects_cache.order` when the evaluation is
created and is used to sort subject selectors, student-mode rows, PDFs, and
XLSX/CSV acta exports.

`grup_tutoria` is generated metadata and non-writable. It is not shown as a
normal editable table column.

The config sheet `{sheet_name}_config` is read like the teacher panel: column B
contains subject-evaluation options, optional column C named
`avaluacio_reduit` contains reduced labels, optional column D named `Color`
contains colors, and concept columns start after those metadata columns.
The backend returns these metadata maps as `subjectEvaluationReducedNames` and
`subjectEvaluationColors`.

Below the table, the UI shows a text area titled `Comentari del tutor`. It is
approximately three text rows tall. The field is student-scoped: it is enabled
when the table is filtered by one student and disabled when the table is
filtered by one subject.

Immediately below it, the UI shows another three-row text area titled
`Acords de junta del grup {group}`, where `{group}` is the selected
`grup_tutoria` value; for example, `Acords de junta del grup 4t ESO A`. This
field belongs to the selected evaluation and `grup_tutoria`, not to the
selected student or subject. It is loaded and shown only in `Mode junta`,
remains enabled in both student and subject mode, and keeps the same in-memory
value while the user navigates between students, subjects, or arrow selections
in the same group. It is not loaded or shown in `Avaluació professors`, and it
is hidden with the other editors in `Tancada` mode.

Tutor comments are stored in a companion sheet for the selected evaluation:

`{sheet_name}_tutoria`

Example: if the evaluation sheet is `avaluacio_1`, tutor comments are stored in
`avaluacio_1_tutoria`.

The tutoria sheet has one row per student and these columns:

| Column | Purpose |
| --- | --- |
| `group` | Same generated metadata as the evaluation sheet. |
| `group_name` | Same generated metadata as the evaluation sheet. |
| `teacher_full_name` | Same generated metadata as the evaluation sheet. |
| `teacher_email` | Same generated metadata as the evaluation sheet. |
| `subject_full_name` | Same generated metadata as the evaluation sheet. |
| `student_full_name` | Student display name. |
| `grup_tutoria` | Tutoring group used for visibility/filtering. |
| `student_account_id` | Stable student identifier shared with the evaluation sheet. |
| `subject_order` | Hidden numeric subject order copied from `subjects_cache.order`. |
| `Comentari_tutor` | Value edited in the `Comentari del tutor` textarea. |
| `Butlletí_url` | Report-card URL. |
| `email_1` | First destination email address for bulletin sending. |
| `enviat_email_1` | Send marker/status for `email_1`. |
| `email_2` | Second destination email address for bulletin sending. |
| `enviat_email_2` | Send marker/status for `email_2`. |

If an older `{sheet_name}_tutoria` sheet is missing any of the bulletin/email
columns, the backend creates the missing headers automatically before writing
PDF URLs, destination email addresses, or send markers.

When loading a group in `Avaluació professors` or `Mode junta`, the endpoint
reads `{sheet_name}_tutoria` and returns the tutor comments for that visible
group. The browser keeps them cached by `student_account_id` and by
`student_full_name`, so changing between students does not require another
server call.

Only in `Mode junta`, the same group load also reads the single matching row
from:

`{sheet_name}_tutoria_grups`

Required headers are `grup_tutoria`, `Comentari_grup`, `updated_at`, and
`updated_by`. The row is matched by normalized `grup_tutoria`. The browser
loads `Comentari_grup` once and retains it while navigating locally, so student
or subject changes do not trigger another read and do not cause repeated group
comment writes.

Existing evaluations created before this schema may not have
`{sheet_name}_tutoria_grups`. They must continue to load normally; for those
evaluations the backend returns no group-comment model and the browser hides
`Acords de junta del grup {group}`. The evaluation-session endpoint does not
create or migrate this sheet implicitly.

`DRIVE_FOLDER_TUTOR` is a script property containing the Drive base folder ID
for tutor bulletin storage. The actual folder ID must not be committed to
source or docs.

## Closed Evaluation Table

When the selected evaluation is in `Tancada` and a group is selected, the page
shows a table built from `Grades -> {sheet_name}_tutoria` rows whose
`grup_tutoria` matches the selected visible group.

The table columns are:

| UI column | Source / behavior |
| --- | --- |
| student name | `student_full_name` |
| `Butlletí` | If `Butlletí_url` has a value, show a PDF icon linked to that Drive/download URL. If it is blank, show `Generar` as a link pointing to `#`; clicking it generates and stores the bulletin PDF as described in `Closed Bulletin Storage`. |
| `Enviat` | If at least one of `enviat_email_1` or `enviat_email_2` has a value, show a check icon. If both are blank, show `Enviar` as a link pointing to `#`; clicking it sends the bulletin link as described in `Closed Bulletin Email Sending`. |

The closed table is a status/action surface, not a grading surface. It must not
show grade controls or tutor-comment editing.

Closed-mode row actions and closed-mode floating bubble actions must use the
same backend rules. Row links operate on one student. Floating bubbles operate
on every applicable remaining student in the selected group.

## Bulk Action Loading State

Group XLSX and PDF acta generation can take time in `Avaluació professors` and
`Mode junta`. The three closed-evaluation bulk processes exist in `Tancada`:

- group XLSX or PDF acta generation
- missing PDF bulletin generation
- missing email sending

While any of these processes is running, the page must look disabled. It should
show the centered animated loading indicator used elsewhere in the app, with a
short information message below the icon explaining the current process, for
example:

- `Generant l'acta del grup...`
- `Generant butlletins pendents...`
- `Enviant correus pendents...`

During missing PDF bulletin generation, the browser processes students
sequentially and updates the loading message with the current student's full
name under the generic progress message.

The user must not be able to change selectors, click table actions, or launch
another floating action until the running process finishes or fails.

## Group XLSX Acta Export

When the user selects `Imprimir estadístiques Excel` from the print menu in
`Avaluació professors` or `Mode junta`, or clicks the spreadsheet-style bubble
button in `Tancada`, the app generates an XLSX file with the grades of all
students in the selected group.

The XLSX uses data from:

- `Grades -> {sheet_name}` for subject grades, filtered by `grup_tutoria`
- `Grades -> {sheet_name}_tutoria` for `Comentari_tutor`, filtered by
  `grup_tutoria`
- `Grades -> {sheet_name}_config` for reduced grade labels and configured
  colors

The backend creates a temporary Google Spreadsheet, writes and formats the acta,
exports it as `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
returns the file to the browser for download, and trashes the temporary
spreadsheet in Drive.

The first XLSX row is a title row. It must include the school name, the purpose
of the file, the evaluation name, the selected group, and the generation date
and time. This row is merged across the whole acta width. Example shape:

```text
Institut Ernest Lluch i Martín - Acta de la Junta d'Avaluació 2n trimestre curs 2024-25 3r ESO A - 08/04/2026 09:25
```

The second XLSX row is the header row:

```text
Alumnes,Recompte NA,[common subject 1],[common subject 2],...,[non-common subject 1],...,Comentari de tutoria
```

Subject ordering rules:

1. Use the selected evaluation sheet and filter rows by `grup_tutoria`.
2. Determine which subjects are common to every student in the selected group.
3. Put common subjects first.
4. Put non-common subjects after the common subjects.
5. Within each common/non-common band, sort by hidden `subject_order`, then
   `subject_full_name`. Empty `subject_order` values appear last.

Each student row contains:

- student full name
- `Recompte NA`: the count of subject grades equal to `NA`
- one reduced grade value per subject column, using
  `{sheet_name}_config.avaluacio_reduit` for the row's `Avaluació de la
  matèria` value and falling back to the full grade if no reduced label exists;
  blank when the student has no row for that subject
- `Comentari de tutoria`: the student's `Comentari_tutor`

After the student rows, the XLSX includes summary rows for the grade values:

- `NA`
- `AS`
- `AN`
- `AE`

For each subject column, the summary row shows the percentage of students with
that reduced grade in that subject. The comment column is blank in summary rows.

Grade cells are colored with the configured color for the corresponding full
`Avaluació de la matèria` value. When the visible cell contains the reduced
grade, the color still comes from the full grade's config row. Missing or
invalid colors fall back to white.

The XLSX ends with the signature/footer rows shown in the existing acta style,
including `Data de la sessió:`, the director signature text, and tutor signature
text.

All generated XLSX text must be in Catalan.

The backend must validate before generating the XLSX:

- the selected evaluation is still in `Avaluació professors`, `Mode junta`, or
  `Tancada`
- the selected group is still visible to the active user
- the exported rows all belong to the selected `grup_tutoria`

## Evaluation Board PDF Actas

The three group actas are generated from dedicated, human-editable HTML
templates:

| File | Responsibility |
| --- | --- |
| `scripts/av_session/src/ActaStatistics.html` | Statistics acta layout. |
| `scripts/av_session/src/ActaSignatures.html` | Teacher/signature acta layout. |
| `scripts/av_session/src/ActaAgreements.html` | Group-agreements acta layout. |
| `scripts/av_session/src/Code.js` | Authorization, data loading, view-model creation, PDF conversion, and download payloads. |

All three PDFs are in Catalan and share a compact header containing:

- `Institut Ernest Lluch i Martín`
- today's date in Catalan display format
- the selected evaluation name
- the selected group name
- `Tutor: {teacher_full_name}`, resolved from the group's `Tutoria` subject row

Tutor resolution uses the selected evaluation sheet, filters its rows by
`grup_tutoria`, and takes `teacher_full_name` from the first row whose
normalized `subject_full_name` is `Tutoria`. If that row is unavailable, the
matching `{sheet_name}_tutoria` rows provide the fallback teacher name. The
tutor is rendered on the title line so the compact header does not grow taller.

### Acta 1: Statistics

`Imprimir acta de junta 1: estadístiques` contains the same academic data as
the group XLSX acta for students, subject grades, configured grade colors, and
the `NA`, `AS`, `AN`, and `AE` percentage summaries. Unlike the XLSX, this PDF
does not include `Recompte NA` or tutor comments.

The acta is designed as one A4 landscape page with readable table typography.
The PDF uses 3 cm left and right page margins. The report header, statistics
table, and subject legend all use the full width between those margins and are
perfectly aligned. The student-name column occupies 40% of the table; every
other table column shares the remaining 60%, is limited to approximately five
characters, and is headed by a short subject abbreviation. Summary
percentages are rounded to whole percentages so they fit those narrow columns.
The report header has a small top offset. The table body uses 10.25 pt type,
the largest tested size that keeps the current largest class (`2n ESO A`, 28
students) and the current widest curriculum (`4t ESO A`, 21 subjects) on one
page. The same calibrated compact layout is used for every group so page count
does not depend on a size threshold. The full abbreviation-to-subject
translation is printed as a compact legend immediately after the statistics
table on the same centered width.

Known subject families use the configured canonical abbreviations, including
`CA`, `CS`, `AN`, `EF`, `SO`, `ET`, `RE`, `OR`, `MA`, `MB`, `LL`, `MU`, `FQ`,
`EC`, `EM`, `VP`, `FI`, `TE`, `BI`, `DI`, `AR`, `FR`, and `TD`. Subjects outside the known
mapping receive a deterministic abbreviation derived from their significant
words. Automatically derived abbreviations are made unique inside the report,
and every abbreviation is always explained in the legend.

### Acta 2: Full Signatures

`Imprimir acta de junta 2: full signatures` derives the teachers involved in
the selected group from both the group-filtered evaluation rows and the
matching `{sheet_name}_tutoria` rows. Teachers are deduplicated by normalized
full name. All subjects assigned to the same teacher are combined in the same
signature slot and ordered by hidden `subject_order`, then subject name.

The tutor is listed before subject teachers when the available data identifies
that role. The PDF uses an A4 landscape four-column signature grid with room
for a handwritten signature and a maximum of 24 teacher slots per page. The
7.75 pt compact layout and six rows of four slots are calibrated so the current
boundary group, `4t ESO B`, remains on one page.

### Acta 3: Group Agreements

`Imprimir acta de junta 3: acords de junta` prints `Comentari_grup` from the
matching `{sheet_name}_tutoria_grups` row. In `Mode junta`, the current value in
the visible `Acords de junta del grup {group}` textarea is sent to the PDF
generator, so the downloaded document can include an unsaved edit. In
`Avaluació professors`, where the editor is hidden, the report uses the stored
sheet value. If the sheet or value does not exist, the PDF displays a clear
empty-agreements message rather than failing.

Before generating any group acta, the backend revalidates that the evaluation
is session-available, the selected group is visible to the active user, and all
grade/tutoria rows used belong to that group.

## Closed Bulletin Storage

When the user clicks `Generar` in the `Butlletí` column of a `Tancada`
evaluation, the app generates the student PDF bulletin and stores it in Drive.

The storage root is the Drive folder identified by the `DRIVE_FOLDER_TUTOR`
script property.

For the selected student/group:

1. Open `DRIVE_FOLDER_TUTOR`.
2. Look for a child folder whose name is exactly the selected group ID, for
   example `4t ESO A`.
3. If the group folder does not exist, create it.
4. Inside the group folder, look for a child folder whose name is exactly the
   selected student's full name.
5. If the student folder does not exist, create it.
6. Inside the student folder, look for a child folder named `Butlletins`.
7. If the `Butlletins` folder does not exist, create it.
8. Generate the PDF bulletin using the same report template and filename pattern
   already used by the student print action:
   `butlleti_{student_name}_{evaluation_name}.pdf`.
9. Store the PDF file in the `Butlletins` folder.
10. Share the file so anyone with the link can access it.
11. Write the resulting Drive URL into the matching
   `{sheet_name}_tutoria.Butlletí_url` cell for that student.
12. Refresh the closed-evaluation table row so the `Butlletí` column shows the
    linked PDF icon instead of `Generar`.

When the user clicks the PDF floating bubble button in `Tancada`, the app runs
the same generation/storage process for every remaining student in the selected
group whose `Butlletí_url` is blank. Students that already have `Butlletí_url`
are skipped.

The backend must validate before generating/storing:

- the selected evaluation is still in `Tancada`
- the selected group is still visible to the active user
- the selected tutoria row still belongs to the selected group
- the selected tutoria row still identifies the selected student, preferably by
  `student_account_id`, falling back to `student_full_name` if needed

## Closed Bulletin Email Sending

When the user clicks `Enviar` in the `Enviat` column of a `Tancada` evaluation,
the app sends the generated bulletin PDF link to the student's first contacts.

The app must first verify that the selected tutoria row has a value in
`Butlletí_url`. If `Butlletí_url` is blank, it must not send email. It must show
a clear message to the user saying that the documents need to be generated
before sending.

Contacts are read from:

`Dinantia -> contacts_cache`

The `contacts_cache` structure is:

| Column | Purpose |
| --- | --- |
| `student_id` | Student account id. |
| `student_name` | Student display name. |
| `group_name` | Group name/id. |
| `contact_id` | Contact identifier. |
| `contact_position` | Contact order/position. |
| `contact_name` | Contact display name. |
| `contact_email` | Destination email address. |
| `contact_phone` | Contact phone number. |

The relation is:

```text
{sheet_name}_tutoria.student_account_id
=
Dinantia -> contacts_cache.student_id
```

For the selected student:

1. Read matching `contacts_cache` rows by `student_id`.
2. Select the first two contacts for the student.
3. Use only contacts that have a non-empty `contact_email`.
4. Send an email to those contacts with the PDF link from `Butlletí_url`.
5. Write destination emails and send markers/status into the matching tutoria
   row, creating the columns first if needed:
   - `email_1` and `enviat_email_1` for the first emailed contact
   - `email_2` and `enviat_email_2` for the second emailed contact
6. Refresh the closed-evaluation table row so the `Enviat` column shows the
   check icon.

Email content must be defined in a dedicated Apps Script template file so it is
easy to edit without touching backend logic:

| File | Responsibility |
| --- | --- |
| `scripts/av_session/src/EmailBulletin.html` | Human-editable Catalan email subject/body template. |
| `scripts/av_session/src/Code.js` | Contact lookup, permission checks, template data preparation, email sending, and tutoria send-marker updates. |

The sender name/alias must always be:

```text
Institut Ernest Lluch i Martín
```

Default email subject:

```text
Butlletí de la sessió d'avaluació de {{student_name}}
```

Default email body:

```text
Benvolguda família,

Us fem arribar el butlletí de la sessió d'avaluació de {{student_name}}, corresponent a l'avaluació {{evaluation_name}}.

Podeu consultar-lo en aquest enllaç:

{{butlleti_url}}

Atentament,

Institut Ernest Lluch i Martín
Cunit
```

The template variables are:

| Variable | Value |
| --- | --- |
| `student_name` | `{sheet_name}_tutoria.student_full_name` |
| `evaluation_name` | selected evaluation display name from `Grades -> avaluacions` |
| `butlleti_url` | `{sheet_name}_tutoria.Butlletí_url` |

The backend must validate before sending:

- the selected evaluation is still in `Tancada`
- the selected group is still visible to the active user
- the selected tutoria row still belongs to the selected group
- the selected tutoria row still identifies the selected student by
  `student_account_id`
- `Butlletí_url` is present

When the user clicks the mail floating bubble button in `Tancada`, the app runs
the same sending process for every student in the selected group whose
`enviat_email_1` and `enviat_email_2` are both blank. Students without
`Butlletí_url` are not sent; the UI should report that their documents need to
be generated first.

## Save Rules

The endpoint saves only dirty table rows and the dirty tutor comment, if
present.

For performance, saves must focus only on the rows currently visible on screen,
which are expected to be no more than about 30 rows. They must write only dirty
spreadsheet rows. They must not rewrite the whole editable block of the
generated evaluation sheet after a small edit. The save path reads only the
header row and the dirty `sheetRow` values currently on screen, not the full
evaluation sheet. Adjacent dirty rows may be grouped into contiguous `setValues`
calls.

Before writing, the backend re-checks:

- the evaluation is still in a session-available state (`Mode junta` or
  `Avaluació professors`)
- the selected group is still visible to the active user
- every edited row still belongs to the selected group
- every edited row still belongs to the selected student or subject

Dirty grade rows are accepted only while the evaluation is in `Mode junta`. If
the evaluation is in `Avaluació professors`, the backend rejects grade-row
writes even if a client sends them.

Writable fields are:

- `PI` only in `Mode junta`
- `Avaluació de la matèria` only in `Mode junta`
- concept columns after `Avaluació de la matèria`, excluding `student_account_id`, only in `Mode junta`
- `Comentari_tutor` in `{sheet_name}_tutoria` when a student is selected
- `Comentari_grup` in `{sheet_name}_tutoria_grups` only in `Mode junta`, in either student or subject mode

Column indexes are calculated from headers, not fixed letters.

After saving, the backend returns only the updated row payloads as `updatedRows`.
The browser merges those rows into the already-loaded group-filtered cache and
the currently rendered table. The save response must not force a full sheet
reload.

Tutor-comment saves are optimized separately from table-row saves. If only the
comment changed, the endpoint skips the generated evaluation sheet and writes
only the matched `Comentari_tutor` cell in `{sheet_name}_tutoria`. It locates
the student using `student_account_id` first because that is stable and shared
with the evaluation sheet. If no account id is available, it falls back to
`student_full_name`. Before writing `Comentari_tutor`, the backend validates
that the located tutoria row still matches the selected student and visible
`grup_tutoria`.

Group-comment saves use a separate dirty flag. Navigating between students or
subjects in the same group does not clear that flag or write the sheet. When
Save is pressed, the backend writes only the matching row's `Comentari_grup`,
`updated_at`, and `updated_by` cells in one operation. `updated_at` is stored as
a real spreadsheet datetime and `updated_by` stores the active user's email.
If the group comment did not change, these cells are not written. After a
successful save, the browser merges the returned value into its in-memory
group cache without reloading the evaluation sheet. The backend rejects group
comment writes unless the selected evaluation is still in `Mode junta`.

## Student PDF Report

When a student is selected, the print bubble button generates a PDF report in
Catalan and downloads it in the browser.

The report architecture is split for manual editing:

| File | Responsibility |
| --- | --- |
| `scripts/av_session/src/PdfReport.html` | Human-editable PDF layout, text, CSS, page margins, and pagination rules. |
| `scripts/av_session/src/Code.js` | Permission checks, data validation, report view-model preparation, PDF conversion, and download payload. |

The PDF uses compact typography, approximately two points smaller than the web
table. Top and bottom page margins are compact. Subject sections may split
across pages, but individual evaluation item lines should not be split. Flowing
evaluation item text and tutor-comment text are justified. The tutor-comment
section should not split across pages. The PDF includes:

1. A header table with two columns.
2. In the left header column, the logo from
   `scripts/av_session/img/logo_nou_transp.png`, embedded in the Apps Script
   code as base64 and passed to `PdfReport.html` so the deployed web app can
   render it during PDF generation. The header is compact and uses only a
   bottom border.
3. In the right header column, the text:

```text
Institut Ernest Lluch i Martín
Cunit
```

4. Student data: full name, group, and evaluation name.
5. A subject list, not a table. Subjects are sorted by hidden `subject_order`,
   then `subject_full_name`. Each subject is shown as a heading. If `PI` is
   true, the subject heading adds `(PI)`. Under each subject, `Avaluació de la
   matèria` and the non-empty evaluation items are shown as indented lines.
6. `Comentari del tutor`.
7. Place and date in this format:

```text
Cunit, a dd de mm de yyyy
```

The month name is written in Catalan.

The PDF generator uses the rows currently visible in the browser so unsaved
screen edits can appear in the downloaded report. Before generating the PDF,
the backend still verifies that the selected evaluation is available, the group
is visible to the active user, and every submitted row still belongs to the
selected student and group.

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. It probes spreadsheet access, Drive folder/file creation and sharing, XLSX export through `UrlFetchApp`, external requests, and email sending permissions. |
| `getAvSessionData` | Loads active-user context, visible groups, and session-available evaluations. |
| `getAvSessionEvaluationData` | Loads students and subjects for a selected evaluation and group. |
| `getAvSessionRows` | Loads table rows for the selected student or subject. |
| `saveAvSessionRows` | Saves dirty editable row values, the selected student's tutor comment, and/or the selected group's shared comment. |
| `createAvSessionStudentReportPdf` | Generates a downloadable PDF report for the selected student. |
| `createGroupStatisticsPdf` | Generates the selected group's statistics acta as a downloadable PDF. |
| `createGroupSignaturesPdf` | Generates the selected group's teacher/signature acta as a downloadable PDF. |
| `createGroupAgreementsPdf` | Generates the selected group's board-agreements acta as a downloadable PDF. |
| `createAllGroupsActaPdf` | Admin-only generator that concatenates one selected acta type for every evaluation group into a single PDF. |
| `generateClosedBulletin` | Generates and stores one closed-evaluation student bulletin PDF, then writes `Butlletí_url`. |
| `generateMissingClosedBulletins` | Generates and stores closed-evaluation bulletin PDFs for all selected-group students still missing `Butlletí_url`. |
| `sendClosedBulletinEmail` | Sends one closed-evaluation bulletin email to the student's first available contacts. |
| `sendPendingClosedBulletinEmails` | Sends closed-evaluation bulletin emails for selected-group students that have a PDF URL and no send marker. |
| `createClosedGroupXlsx` | Generates a downloadable XLSX acta for the selected group in `Avaluació professors`, `Mode junta`, or `Tancada`. |
| `createClosedGroupCsv` | Backwards-compatible wrapper that now returns the same XLSX payload as `createClosedGroupXlsx`. |

All implementation helpers should use a trailing underscore.
