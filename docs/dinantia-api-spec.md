# Dinantia API Specification

This document defines the Dinantia API integration rules for this project.

The complete local API notes are summarized from the Dinantia documentation provided to the project. This spec focuses on the parts needed for future attendance and timetable-related workflows.

## Authentication

Dinantia uses Basic Authentication.

Credentials must be stored in Apps Script script properties:

| Script property | Meaning |
| --- | --- |
| `dinantia_api_user` | Dinantia API user from school settings. |
| `dinantia_api_secret` | Dinantia API secret from school settings. |

These properties are already configured in the Apps Script project.

Credentials must never be committed to git, written in source files, printed in logs, included in specs, or returned to the UI.

Missing or blank credentials must produce a clear configuration error.

## Base Request Contract

Base URL used by the configuration script:

```text
https://app.dinantia.com/api/web
```

Required headers:

| Header | Value |
| --- | --- |
| `Accept` | `application/vnd.api+json` |
| `Content-Type` | `application/vnd.api+json` |
| `Authorization` | Basic Auth header built from script properties. |

Do not hardcode credentials in the domain, URL, or request body.

## Pagination

Many index endpoints support:

| Parameter | Meaning |
| --- | --- |
| `limit` | Result count. Defaults to 20. Use `100` when reading full collections. |
| `page` | Page number. Defaults to first page. |

Full collection readers must follow pagination until `pagination.has_next_page` is false.

Common response fields:

| Field | Meaning |
| --- | --- |
| `data` | Returned records. |
| `pagination` | Pagination metadata. |
| `code` | Request status code. |
| `url` | Request URL. |
| `success` | Request success flag. |

## Accounts

Relevant endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1.2/accounts/index` | List accounts. |
| `GET` | `/v1/accounts/index` | List accounts, older API version. |
| `GET` | `/v1.2/accounts/view/:id` | Read one account. |
| `GET` | `/v1/accounts/view/:id` | Read one account, older API version. |
| `POST` | `/v1.2/accounts/update/:id` | Update account. |
| `POST` | `/v1/accounts/update/:id` | Update account, older API version. |
| `DELETE` | `/v1/accounts/delete/:id` | Delete account. |

Account objects may include:

```text
id, name, email, phone, gender, language, avatar, roles, groups,
permissions, parents, fields, created, modified
```

Relevant roles:

```text
Administrator, Staff, Student, Parent, Candidate, CandidateParent
```

Future attendance workflows will need student `account_id` values for attendees.

By now, local teacher records do not need to map to Dinantia `account_id`, but that may change if we create Dinantia classes or attendance records tied to teacher accounts.

### Student Group Membership

Student group membership is not read from `groups/view/:id`.

For the current API responses, student memberships are stored inside each account object:

```json
{
  "roles": ["Student"],
  "groups": {
    "member": ["1r ESO A", "ESO-1R-"]
  }
}
```

Rules:

1. Read all accounts from `GET /v1/accounts/index` using pagination.
2. Keep only accounts where `roles` contains `Student`.
3. Read group IDs from `account.groups.member`.
4. `account.groups.member` is an array of strings.
5. Index students in memory by each membership string.
6. Use the account `id` as the stable student identifier.
7. Use the account `name` as `student_full_name` for evaluation sheets.

The extractor should recurse through `account.groups` so it also supports future group buckets beyond `member`, but string values in `groups.member` are the confirmed source needed today.

## Groups

Relevant endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/groups/index` | List groups. |
| `GET` | `/v1/groups/view/:id` | Read one group. |
| `POST` | `/v1/groups/update/:id` | Update group. |
| `DELETE` | `/v1/groups/delete/:id` | Delete group. |

Group objects may include:

```text
id, name, tag, parent, types, created
```

Group `types` may include:

```text
students, parents
```

The local table `Dinantia` -> `dinantia_2_dades_alumnes` stores `dinantia_group_name`, mapped from local timetable group aliases in `untis_group_name`.

For endpoint editing, use group `id` for the `Grup d'alumnes per avaluar` dropdown. It is the fastest and most stable value to store for later API operations.

Important detail: Dinantia group IDs can be human-readable strings, for example `1r ESO A`, `4t ESO F`, or `BATX 2n B`. Do not assume group IDs are numeric or opaque.

For compatibility, local code may resolve a selected/cache group value through group `id`, `name`, or `tag`, but student membership matching must ultimately use the group ID string found in `account.groups.member`.

For future attendance write operations, confirm whether the `groups` payload expects these IDs directly or a nested/group-specific structure.

## Classes

Relevant endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1.2/classes/index` | List classes. |
| `GET` | `/v1.2/classes/view/:id` | Read one class. |
| `POST` | `/v1.2/classes/update/:id` | Create/update class. |
| `DELETE` | `/v1.2/classes/delete/:id` | Delete class. |

Class objects may include:

```text
id, weekday, school_hour_id, account_id, available_for_substitutions,
course_id, classroom, groups
```

`weekday` uses:

```text
1 = Monday
...
7 = Sunday
```

Regular class creation/update requires:

| Field | Rule |
| --- | --- |
| `account_id` | Required. |
| `school_hour_id` | Required. |
| `weekday` | Required. |
| `course_id` | Required unless the class is a substitution slot. |
| `groups` | Required unless the class is a substitution slot. |
| `available_for_substitutions` | Marks substitution/free slots. |

Future timetable syncing needs mappings for:

| Local value | Dinantia value needed |
| --- | --- |
| `GPU001` teacher code | Dinantia teacher/staff `account_id`. |
| `GPU001` group code | Dinantia group value accepted by the API. |
| `GPU001` schedule hour | Dinantia `school_hour_id`. |
| `GPU001` subject code | Dinantia course or `course_id`. |

## Courses

Relevant endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/courses/index` | List courses. |
| `GET` | `/v1/courses/view/:id` | Read one course. |
| `POST` | `/v1/courses/update/:id` | Create/update course. |
| `DELETE` | `/v1/courses/delete/:id` | Delete course. |

Course objects may include:

```text
id, name, created
```

Deleting a course requires `replacement_id` to replace references in existing attendances.

Future attendance workflows need a reliable mapping from local subject data to Dinantia `course_id` or accepted `course` value.

## School Hours

Relevant endpoint:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1.2/school_hours/index` | List school hours. |

School hour objects may include:

```text
id, name, start, end
```

`start` and `end` use `HH:mm:ss`.

Future timetable/class workflows need a mapping from `GPU001.schedule_hour` values `1` through `12` to Dinantia `school_hour_id`.

## Attendances

Relevant endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/attendances/index` | List attendance records. |
| `GET` | `/v1/attendances/view/:id` | Read one attendance record. |
| `POST` | `/v1/attendances/update/:id` | Create/update attendance record. |
| `DELETE` | `/v1/attendances/delete/:id` | Delete attendance record. |

Attendance objects may include:

```text
id, date, account_id, course_id, groups, attendees
```

Attendee objects include:

```text
account_id, status
```

Creating/updating attendance requires:

| Field | Rule |
| --- | --- |
| `date` | Required. |
| `account_id` | Required. |
| `course` or `course_id` | Required. |
| `groups` | Required. |
| `attendees` | Required. |
| `notify` | Controls parent notification behavior for absent attendees. |

The attendee account must be a member of at least one group specified in the attendance.

## Local Integration Notes

The current local cache `Grades` -> `subjects_cache` provides:

| Cache field | Purpose |
| --- | --- |
| `group` | Local timetable group code from `GPU001`. |
| `group_name` | Dinantia group display name from local mapping table. |
| `prof_reduit` | Local teacher code from `GPU001`. |
| `teacher_full_name` | Local teacher display name. |
| `teacher_email` | Local teacher email from `Dades de professors` -> `Llista.CORREU INSTIT`. |
| `mat_reduit` | Local subject code from `GPU001`. |
| `subject_full_name` | Local subject display name. |
| `subject_dinantia_group_av` | Dinantia group ID selected for assessment. |

For evaluation-sheet generation, student account membership is read from `accounts.groups.member`, which contains Dinantia group IDs as strings. The implementation should fetch all accounts once, filter students, index them by membership group, and then expand `subjects_cache` rows from that in-memory index.

This cache is useful for display and local configuration, but it is not yet sufficient for Dinantia attendance writes.

Before creating attendance records, future development must define or build mappings for:

| Required API value | Needed source/mapping |
| --- | --- |
| Student `account_id` | Dinantia student account lookup. |
| Attendance owner `account_id` | Teacher/staff account mapping if required by workflow. |
| Dinantia group API value | Confirm ID/tag/name contract for `groups`. |
| `course_id` or `course` | Subject/course mapping from local subjects to Dinantia courses. |
| Attendance statuses | Local status vocabulary to Dinantia attendee `status`. |

## Error Handling

Dinantia API callers must:

1. Throw clear configuration errors for missing user or secret.
2. Never log Basic Auth headers or raw secrets.
3. Treat non-2xx responses as errors.
4. Include endpoint path and status code in errors.
5. Avoid including credentials in error messages.
6. Handle pagination for full-list reads.

## Security Rules

- Do not commit Dinantia API credentials.
- Do not store Dinantia credentials in source files.
- Do not write credentials to docs.
- Do not print credentials in logs.
- Do not return credentials to the frontend.
- Treat webhook `signing_secret` as a secret; it is only displayed on creation response.
