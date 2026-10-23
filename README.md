# Avaluacio GAS Project

This repository contains Google Apps Script projects organized by script.

## Structure

```text
.
├── docs/
│   ├── README.md
│   ├── admin-privileges.md
│   ├── av-session-spec.md
│   ├── configuration-endpoint-spec.md
│   ├── database-spec.md
│   ├── dinantia-api-spec.md
│   └── teacher-pannel-spec.md
├── scripts/
│   ├── av_session/
│   │   ├── .clasp.json
│   │   ├── .claspignore
│   │   ├── README.md
│   │   ├── img/
│   │   │   └── logo_nou_transp.png
│   │   └── src/
│   │       ├── ActaAgreements.html
│   │       ├── ActaSignatures.html
│   │       ├── ActaStatistics.html
│   │       ├── BatchJobs.js
│   │       ├── Code.js
│   │       ├── EmailBulletin.html
│   │       ├── Index.html
│   │       ├── PdfReport.html
│   │       └── appsscript.json
│   ├── configuration/
│   │   ├── .clasp.json
│   │   ├── .claspignore
│   │   ├── README.md
│   │   └── src/
│   │       ├── Code.js
│   │       ├── Index.html
│   │       └── appsscript.json
│   └── teacher_pannel/
│       ├── .clasp.json
│       ├── .claspignore
│       ├── README.md
│       └── src/
│           ├── Code.js
│           ├── Index.html
│           └── appsscript.json
├── .gitignore
├── PENDING_DEVELOPMENTS.md
└── README.md
```

## Scripts

| Script | Local folder |
| --- | --- |
| av_session | `scripts/av_session` |
| configuration | `scripts/configuration` |
| teacher_pannel | `scripts/teacher_pannel` |

Apps Script project IDs are intentionally not stored in public documentation.
Keep them only in each local, ignored `.clasp.json` file.

The canonical contracts live in [`docs/`](docs/README.md). Shared spreadsheet
schemas belong to `database-spec.md`; each endpoint spec owns that web app's
authorization, UI, reads, writes, and operations. Script READMEs are operational
summaries rather than competing specifications.

## Security

Do not commit Apps Script IDs, deployment IDs, spreadsheet IDs, Drive folder
IDs, API credentials, `.clasp.json`, `.clasprc.json`, or local environment
files. Runtime identifiers and credentials must live in local ignored files or
Apps Script project properties.

## Working With A Script

From the script folder:

```sh
cd scripts/configuration
clasp pull
clasp push
```

Keep credentials, local environment files, and generated dependency folders out of git.

Local `.clasp.json` files are ignored by git. Keep one in each script folder so `clasp` knows which Apps Script project to push to.

For an existing web app, update its existing deployment so its URL remains
stable. Resolve the private deployment ID locally with `clasp deployments`,
then pass it to `clasp deploy --deploymentId ...`. A bare `clasp deploy` is only
for creating an intentionally new deployment.
