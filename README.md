# Avaluacio GAS Project

This repository contains Google Apps Script projects organized by script.

## Structure

```text
.
├── docs/
│   ├── README.md
│   ├── configuration-endpoint-spec.md
│   ├── database-spec.md
│   ├── dinantia-api-spec.md
│   └── teacher-pannel-spec.md
├── scripts/
│   ├── av_session/
│   │   ├── .clasp.json
│   │   ├── .claspignore
│   │   ├── README.md
│   │   └── src/
│   │       ├── Code.js
│   │       ├── Index.html
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
