# Scripts

Each folder in this directory is a separate Google Apps Script project.

Script-specific `.clasp.json` files stay inside their own folder so each script can be pushed and pulled independently.

## Scripts

| Folder | Purpose |
| --- | --- |
| `configuration` | Configuration endpoint for `subjects_cache` and evaluation creation. |
| `teacher_pannel` | Teacher-facing endpoint for generated evaluation sheets. |
| `av_session` | Evaluation session workflow script. |

Canonical contracts and their ownership order are indexed in
[`docs/README.md`](../docs/README.md). Each script README is an operational
summary and must remain consistent with its endpoint spec and the shared
database contract.
