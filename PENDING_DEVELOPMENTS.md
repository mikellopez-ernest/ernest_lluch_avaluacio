# Pending Developments

This file tracks future work and open decisions only. Implemented specifications live in `docs/`.

## Current Status

- `Grades` -> `subjects` is obsolete and must not be used.
- `Grades` -> `subjects_cache` is built from `Horaris` -> `GPU001`.
- The cache builder first keeps the dominant teacher or tied teachers for each
  `group + subject`, then collapses repeated `group + teacher + subject` rows.
- The cache builder then groups cleaned rows by `GPU001` event code and stores
  multi-group events as comma-separated values in `subjects_cache.group`.
- `subjects_cache.materia_clau` marks the key/tutorial subject row. Rebuilds
  check TUTORIA by default, but the configuration endpoint can change it.
- The configuration endpoint edits `subjects_cache` directly.
- The configuration endpoint saves only dirty/new/deleted rows and disables the
  page while saving.
- The endpoint can create evaluation sheets from `subjects_cache`.
- Evaluation creation lets users choose which group codes are included.
- Dinantia student expansion uses `accounts.groups.member` string memberships.
- Generated main evaluation sheets include `group`, `teacher_email`,
  `grup_tutoria`, `PI`, and hidden `student_account_id` columns.
- Rows where `subjects_cache.materia_clau` is true are generated into
  `{sheet_name}_tutoria`, not into the main evaluation sheet.
- `grup_tutoria` is generated from the student's tutoria row, not from a
  hardcoded subject name.
- Shared group rows are visible in every display group listed in `group_name`,
  while saving still updates one spreadsheet row.
- Evaluation creation exposes progress polling by run ID.
- `teacher_pannel` has a first deployed version for teacher evaluation editing.

## Open Items

- Define workflows for writing attendance or grades back to Dinantia, including teacher account mapping and course mapping.
- Confirm the exact Dinantia attendance `groups` payload shape before writing attendance records.
