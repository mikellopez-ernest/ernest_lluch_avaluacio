# Evaluation Session Endpoint Specification

This document defines the `av_session` endpoint for session-mode evaluation grading.

## Purpose

The evaluation session lets an authorized user grade either one selected student
across subjects or one selected subject across students.

## Apps Script

| Field | Value |
| --- | --- |
| Folder | `scripts/av_session` |
| Script ID | `1I_6-JdbYTk2leRBGJKx-eeEnKxy4EpkJVpS1nApQJRd0OdRZqDyezY8M` |
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

The endpoint does not read `Dinantia -> dinantia_2_dades_alumnes` and does not
resolve Dades alumnes sheet names.

The endpoint does not call the Dinantia API.

If the logged-in teacher is a substitute (`SUBST? = TRUE`), active substitution
resolution uses `Dades de professors -> leave_absence` with `REDUÏT` codes and
today in `Europe/Madrid`.

## Available Evaluations

The endpoint reads `Grades -> avaluacions`.

Only rows where `Estat` is exactly:

```text
Mode junta
```

are available.

## UI Flow

The first row has four horizontal selectors:

| Selector | Source |
| --- | --- |
| `Avaluació` | `Grades -> avaluacions` rows in `Mode junta`. |
| `Grup` | Visible Dinantia group IDs resolved from the active user. |
| `Alumne` | Unique students from evaluation rows where `grup_tutoria` contains the selected group ID. |
| `Matèria` | Unique subjects from evaluation rows where `grup_tutoria` contains the selected group ID. |

`Alumne` and `Matèria` are enabled only after both `Avaluació` and `Grup` are
selected. They are mutually exclusive: selecting one clears the other.

If there is only one available evaluation or one visible group, the matching
selector is selected automatically. If both `Avaluació` and `Grup` are available
after auto-selection, the endpoint immediately loads the student and subject
selectors.

When the table is visible, the title is flanked by previous/next arrow buttons.
The arrows navigate through the active selector (`Alumne` or `Matèria`). The
left arrow is disabled on the first item and the right arrow is disabled on the
last item. Arrow navigation is client-side and uses the already-loaded selector
values.

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
4. Build unique sorted subjects from `subject_full_name`.
5. Return the filtered rows to the browser so switching between `Alumne` and
   `Matèria` does not require another Apps Script call.

When a student is selected, the table shows evaluation rows matching the
selected group and `student_full_name`. Column indexes are resolved by header.

When a subject is selected, the table matches the teacher panel layout for that
subject and group.

After the group-filtered rows are loaded, changing between students, changing
between subjects, and using the arrow buttons must filter locally in the browser
without additional Apps Script calls.

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

`student_account_id` is hidden and non-writable.

`grup_tutoria` is generated metadata and non-writable. It is not shown as a
normal editable table column.

The config sheet `{sheet_name}_config` is read like the teacher panel: column B
contains subject-evaluation options, optional column C named `Color` contains
colors, and concept columns start after that.

Below the table, the UI shows a text area titled `Comentari del tutor`. It is
approximately three text rows tall. The field is student-scoped: it is enabled
when the table is filtered by one student and disabled when the table is
filtered by one subject.

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
| `Comentari_tutor` | Value edited in the `Comentari del tutor` textarea. |
| `Butlletí_url` | Report-card URL. |

When loading a group, the endpoint also reads `{sheet_name}_tutoria` and returns
the tutor comments for that visible group. The browser keeps them cached by
`student_account_id` and by `student_full_name`, so changing between students
does not require another server call.

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

- the evaluation is still in `Mode junta`
- the selected group is still visible to the active user
- every edited row still belongs to the selected group
- every edited row still belongs to the selected student or subject

Writable fields are:

- `PI`
- `Avaluació de la matèria`
- concept columns after `Avaluació de la matèria`, excluding `student_account_id`
- `Comentari_tutor` in `{sheet_name}_tutoria` when a student is selected

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

## Public Functions

| Function | Purpose |
| --- | --- |
| `doGet` | Web app entrypoint. |
| `grantPermissionsManually` | Manual authorization helper for the owner. |
| `getAvSessionData` | Loads active-user context, visible groups, and `Mode junta` evaluations. |
| `getAvSessionEvaluationData` | Loads students and subjects for a selected evaluation and group. |
| `getAvSessionRows` | Loads table rows for the selected student or subject. |
| `saveAvSessionRows` | Saves dirty editable row values and/or the selected student's tutor comment. |

All implementation helpers should use a trailing underscore.
