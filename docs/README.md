# Documentation

Project documentation lives here. Specs are source-of-truth contracts, not
scratch notes. Open decisions and unfinished work belong in
[`PENDING_DEVELOPMENTS.md`](../PENDING_DEVELOPMENTS.md).

When documents overlap, ownership is resolved in this order:

1. `database-spec.md` owns shared spreadsheet names, headers, identities, and
   evaluation-state vocabulary.
2. `dinantia-api-spec.md` owns remote API contracts and identifier semantics.
3. Each endpoint spec owns only that app's authorization, UI, reads, writes,
   and operational behavior.
4. Script READMEs are concise operational summaries and must not override a
   canonical spec.

All three scripts are web apps. Routine releases must update each app's existing
deployment so its public URL remains unchanged. Deployment IDs stay private and
must not be written into these documents.

## Specs

| Spec | Owns |
| --- | --- |
| [Shared Spreadsheet Database Specification](database-spec.md) | Registry, logical tables, sheet schemas, cache shape, generated evaluation sheet layout. |
| [Configuration Endpoint Specification](configuration-endpoint-spec.md) | Configuration UI, cache rebuild, cache editing, evaluation creation. |
| [Dinantia API Specification](dinantia-api-spec.md) | Dinantia authentication, pagination, groups, accounts, and integration rules. |
| [Teacher Panel Endpoint Specification](teacher-pannel-spec.md) | Teacher-facing evaluation UI, filtering, dirty saves, and generated-sheet consumption. |
| [Evaluation Session Endpoint Specification](av-session-spec.md) | Session-mode evaluation UI, group visibility, generated-sheet student loading, dirty saves, XLSX acta exports, PDF bulletins, and bulletin email sending. |

## Operational Guides

| Guide | Purpose |
| --- | --- |
| [`admin_privileges` Script Property](admin-privileges.md) | Configure and verify project-local administrators across configuration, teacher panel, and evaluation session. |
