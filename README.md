# Avaluacio GAS Project

This repository contains Google Apps Script projects organized by script.

## Structure

```text
.
├── docs/
│   ├── README.md
│   ├── database-spec.md
│   ├── dinantia-api-spec.md
│   └── teacher-pannel-spec.md
├── scripts/
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

| Script | Apps Script ID |
| --- | --- |
| configuration | `1qj0U_bBSfrHpxSzXt5goCaloM_npZAZcRiw6IiGdLMI_XrrP595eiehD` |
| teacher_pannel | `1CLBSkbrZagzWSX8VxBot_sPZaQVBnexGdocsCm-_xeMTRqoIgI_hpoby` |

## Working With A Script

From the script folder:

```sh
cd scripts/configuration
clasp pull
clasp push
```

Keep credentials, local environment files, and generated dependency folders out of git.

Local `.clasp.json` files are ignored by git. Keep one in each script folder so `clasp` knows which Apps Script project to push to.
