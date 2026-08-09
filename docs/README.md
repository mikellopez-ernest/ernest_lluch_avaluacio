# Documentation

Project documentation lives here. Specs are source-of-truth contracts, not
scratch notes. Open decisions and unfinished work belong in
[`PENDING_DEVELOPMENTS.md`](../PENDING_DEVELOPMENTS.md).

## Specs

| Spec | Owns |
| --- | --- |
| [Shared Spreadsheet Database Specification](database-spec.md) | Registry, logical tables, sheet schemas, cache shape, generated evaluation sheet layout. |
| [Configuration Endpoint Specification](configuration-endpoint-spec.md) | Configuration UI, cache rebuild, cache editing, evaluation creation. |
| [Dinantia API Specification](dinantia-api-spec.md) | Dinantia authentication, pagination, groups, accounts, and integration rules. |
| [Teacher Panel Endpoint Specification](teacher-pannel-spec.md) | Teacher-facing evaluation UI, filtering, dirty saves, and generated-sheet consumption. |
| [Evaluation Session Endpoint Specification](av-session-spec.md) | Session-mode evaluation UI, group visibility, Dinantia student loading, and dirty saves. |
