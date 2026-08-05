# Pending Developments

This file tracks future work and open decisions only. Implemented specifications live in `docs/`.

## Current Status

- `Grades` -> `subjects` is obsolete and must not be used.
- `Grades` -> `subjects_cache` is built from `Horaris` -> `GPU001`.
- The configuration endpoint edits `subjects_cache` directly.
- The endpoint can create evaluation sheets from `subjects_cache`.
- Dinantia student expansion uses `accounts.groups.member` string memberships.
- Evaluation creation exposes progress polling by run ID.
- Generated evaluation sheets are formatted and include a hidden `student_account_id` column.

## Open Items

- Define future workflows for writing attendance or grades back to Dinantia, including teacher account mapping and course mapping.
