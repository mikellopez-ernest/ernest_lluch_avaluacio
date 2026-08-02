# Pending Developments

This file tracks pending decisions, redesign notes, and future implementation work.

## Current Mode

- Chat/planning only.
- Do not edit code.
- Do not push with clasp.
- Do not deploy.
- Do not update specs outside this file.

## Pending Items

- Rethink upcoming changes before implementation.
- Remove the `Grades` -> `subjects` table from the future design.
- Remove the old `subjects_cache` cache design that was based on `Grades` -> `subjects`.
- Delete the previously created cache-building code for `subjects_cache`; it is obsolete after removing `Grades` -> `subjects`.
- Add `Horaris` -> `GPU001` as the high school schedule table, session by session.
- Add a public script function that rebuilds the new `Grades` -> `subjects_cache` from `Horaris` -> `GPU001`.

## Pending Data Sources

### `Grades` -> `avaluacions`

Purpose: registers evaluation periods and the sheet where each period's grade data is stored.

The referenced grade-data sheets are always inside the `Grades` spreadsheet.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric value that identifies each register. |
| B | `nom_av` | Name of the evaluation period, for example `1a avaluació`. |
| C | `sheet_name` | Name of the sheet, inside the `Grades` spreadsheet, where that evaluation period's data is stored. |

Note: if the real header is currently `sheet_id`, treat it as a naming error for this workflow and migrate it to `sheet_name` before implementation.

### `Horaris` -> `GPU001`

Purpose: stores the high school schedule, one row per scheduled session.

This sheet has no headers.

| Column | Meaning |
| --- | --- |
| A | `id`: autonumeric row identifier. |
| B | `class_code`: class/group code. |
| C | `teacher_code`: teacher code. |
| D | `subject_code`: subject code. |
| E | `classroom_name`: classroom name. |
| F | `weekday`: day of the week, from `1` Monday to `5` Friday. |
| G | `schedule_hour`: hour of the schedule, from `1` to `12`. |

### `Dinantia` -> `dinantia_2_dades_alumnes`

Purpose: maps group names/codes between Dinantia, student-data sheets, incidences, and Untis/timetable data.

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric row identifier. |
| B | `dinantia_group_name` | Group name in the Dinantia app. |
| C | `dades_alumnes_sheet` | Student-data sheet name. Not used in the current scenario. |
| D | `dinantia_group_name_incidencies` | Dinantia incidences group name. Not used in the current scenario. |
| E | `untis_group_name` | Comma-separated group code aliases used in `Horaris` -> `GPU001`. |

Relationship for the current scenario:

```text
Horaris.GPU001.class_code = any comma-separated alias in Dinantia.dinantia_2_dades_alumnes.untis_group_name
```

Use this relationship to resolve a timetable group/class code into its Dinantia group metadata.

Example: if `untis_group_name` contains `PER1A,PER1B`, both `PER1A` and `PER1B` from `GPU001` resolve to the same `dinantia_group_name`.

## Pending Cache Design

### New `Grades` -> `subjects_cache`

Purpose: derived cache built from timetable sessions in `Horaris` -> `GPU001`, enriched with group, teacher, and subject display data.

The sheet must be rewritten entirely every time the cache-building function is called.

The cache-building function must be public so it can be executed directly.

Output columns:

| Column | Header | Meaning |
| --- | --- | --- |
| A | `id` | Autonumeric value for each cache row. |
| B | `group` | Value from `Horaris` -> `GPU001` column B. |
| C | `group_name` | Resolve `group` through `Dinantia` -> `dinantia_2_dades_alumnes.untis_group_name`; return `dinantia_group_name`. |
| D | `prof_reduit` | Value from `Horaris` -> `GPU001` column C. |
| E | `teacher_full_name` | Resolve `prof_reduit` through `Dades de professors` -> `Llista.REDUÏT`; return `NOM + COGNOM1 + COGNOM2`. |
| F | `mat_reduit` | Value from `Horaris` -> `GPU001` column D. |
| G | `subject_full_name` | Resolve `mat_reduit` through `Càrrega lectiva` -> `assignatures.short_name`; return `full_name`. |
| H | `subject_dinantia_group_av` | Same value as `group_name`. |

Build flow:

1. Read all data from `Horaris` -> `GPU001` into an in-memory array.
2. Delete duplicates before writing the cache.
3. Rows are duplicates when columns B, C, and D from `GPU001` all match at the same time:
   - B: group/class code
   - C: teacher code
   - D: subject code
4. After deduplication, resolve all values.
5. Delete any row without a value in column C, `group_name`.
6. Sort the entire cache table by column C, `group_name`.
7. Write the full cache table with source values and resolved values.

Relationships:

```text
subjects_cache.group = Horaris.GPU001 column B
subjects_cache.group_name = Dinantia.dinantia_2_dades_alumnes.dinantia_group_name
where Horaris.GPU001 column B = any comma-separated alias in Dinantia.dinantia_2_dades_alumnes.untis_group_name

subjects_cache.prof_reduit = Horaris.GPU001 column C
subjects_cache.teacher_full_name = Dades de professors.Llista NOM + COGNOM1 + COGNOM2
where Horaris.GPU001 column C = Dades de professors.Llista.REDUÏT

subjects_cache.mat_reduit = Horaris.GPU001 column D
subjects_cache.subject_full_name = Càrrega lectiva.assignatures.full_name
where Horaris.GPU001 column D = Càrrega lectiva.assignatures.short_name

subjects_cache.subject_dinantia_group_av = subjects_cache.group_name
```
