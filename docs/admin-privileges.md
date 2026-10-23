# `admin_privileges` Script Property

This guide explains how the repository's Google Apps Script web apps use the
`admin_privileges` script property, how to configure it, and how to verify that
it is working.

## Purpose

`admin_privileges` is a server-side administrator override. It contains the
email addresses that must receive full access in the Apps Script project where
the property is configured.

Use it for accounts that need project-local administrator access but may not
have:

- a matching teacher row in `Dades de professors` -> `Llista`;
- a responsibility in `Càrrega lectiva` -> `carrecs`; or
- an `ADMIN_PRIVILEGES` entry in
  `Dinantia` -> `teachers_2_dinantia.dinantia_group_names`.

This property belongs only to the Apps Script project where it is configured.
Adding it to one script does not grant privileges in another Apps Script
project unless that project implements and reads the same property.

## Property Format

The property name is exact and case-sensitive:

```text
admin_privileges
```

The value is a comma-separated list of complete email addresses:

```text
admin1@iernestlluch.cat,admin2@iernestlluch.cat
```

Rules:

1. Separate addresses with commas, not semicolons.
2. Spaces surrounding an address are ignored.
3. Email comparison is case-insensitive.
4. Empty comma-separated entries are ignored.
5. Do not use JSON, brackets, or quotation marks.
6. Do not store real administrator emails in repository documentation,
   source code, `.clasp.json`, or another committed file.

## Configure the Property

1. Open the intended Apps Script project in the Google Apps Script editor.
2. Open **Project Settings**.
3. Find **Script properties**.
4. Add or edit a property whose name is exactly `admin_privileges`.
5. Enter the comma-separated administrator emails as its value.
6. Save the property.
7. Reload that project's deployed web app.

Changing a script property does not require `clasp push` or a new deployment.
The server reads the property again on the next request.

## Check the Current Value

The safest check is in the Apps Script editor:

1. Open **Project Settings** for the intended script.
2. Locate **Script properties**.
3. Confirm that the key is exactly `admin_privileges`.
4. Confirm that the expected email appears as a complete comma-separated
   value.
5. Confirm that you are editing the same Apps Script project used by the
   intended live deployment.

Avoid printing the full property value to execution logs because that exposes
the administrator list to everyone who can inspect those logs.

## How Permission Resolution Works

For every protected request, the script performs this sequence:

1. Read the active account with `Session.getActiveUser().getEmail()`.
2. Require the account to end with `@iernestlluch.cat`.
3. Read the `admin_privileges` property from
   `PropertiesService.getScriptProperties()`.
4. Split the property value by commas.
5. Trim and lowercase each configured email.
6. Compare the normalized active email with the normalized list.
7. Apply the administrator behavior defined by that web app.
8. Where responsibility-based privileges exist, combine the property with the
   normal `ADMIN_PRIVILEGES` mapping.

An email listed in `admin_privileges` does not need a matching row in
`Dades de professors` -> `Llista`. If a matching teacher row does exist, the
property-based administrator status is combined with the normal permission
resolution.

## What Administrator Status Grants

A property-based administrator receives the following access:

| Web app | Behavior |
| --- | --- |
| `configuration` | Can read and save every cache group, rebuild `subjects_cache`, and create evaluations. |
| `teacher_pannel` | Can read and save every row in an evaluation in `Avaluació professors`, independently of `teacher_email`. |
| `av_session` | Can use every real group listed in `Dinantia` -> `teachers_2_dinantia.dinantia_group_names`, even without a teacher row. |

The available administrator sources differ by app:

| Web app | `admin_privileges` property | Responsibility-derived `ADMIN_PRIVILEGES` marker |
| --- | --- | --- |
| `configuration` | Grants admin actions and all local cache groups. | Grants admin actions and all local cache groups. |
| `teacher_pannel` | Grants access to every active-evaluation row. | Not read by this app. |
| `av_session` | Grants admin actions and broadens the normal selector to every real mapped group. | Grants admin actions but keeps the normal selector responsibility-scoped; all-groups admin document/batch actions perform their own server-side all-group resolution. |

Access is enforced again in protected server functions; the `Admin` badge and
admin-only controls are only UI indicators, not the security boundary.

## What It Does Not Grant

`admin_privileges` does not:

- allow an account outside `@iernestlluch.cat` to open the app;
- change Google Drive or Spreadsheet sharing permissions;
- make the account an owner or editor of the Apps Script project;
- grant privileges in another project where the property is absent;
- replace the `db` property or any other required script property; or
- change the web-app deployment access settings.

The web app still executes as its configured deployment owner, and the active
user must still pass the domain check.

## Verify Effective Access

After saving the property, reload the matching live web app and verify:

1. The `Admin` indicator or admin-only controls appear where applicable.
2. `configuration` exposes all cache groups and its protected actions.
3. `teacher_pannel` exposes groups and subjects belonging to all teachers when
   the property is configured in that script.
4. `av_session` exposes all real Dinantia groups for a property administrator
   and never includes
   `ADMIN_PRIVILEGES` as a selectable group.

Do not run the refresh action merely as a permission test. Rebuilding the cache
can overwrite manual changes.

## Troubleshooting

### The user still sees no groups

Check the following:

1. The property was added to the same Apps Script project as the live URL.
2. The key is exactly `admin_privileges` in lowercase.
3. The active browser account is the expected account.
4. The email is complete and comma-separated.
5. The account belongs to `@iernestlluch.cat`.
6. The live deployment contains the property-based administrator code.
7. The source table used by that app contains the expected groups or rows; the
   property grants access but does not invent missing data.

### The buttons are visible but an action fails

The property grants application authorization, but the deployment owner must
still have access to the registry and the required spreadsheets. Check the
`db` script property, registry entries, spreadsheet sharing, Apps Script
authorization, and execution logs.

### The wrong account has access

Remove that email from the property value, save the change, and reload the app.
No code deployment is required. Also review who can edit the Apps Script
project because project editors can modify script properties.

## Remove Administrator Access

1. Open **Project Settings** -> **Script properties**.
2. Remove the email from the comma-separated value.
3. Delete the entire `admin_privileges` property if no fixed administrators
   remain.
4. Save and reload the web app.

Normal responsibility-based permissions continue to work even when the
property is missing or empty.

## Implementation Reference

The scripts implement this behavior through:

- `ADMIN_PRIVILEGES_PROPERTY = 'admin_privileges'`;
- `isAdminEmailFromScriptProperty_()` for normalized property matching;
- `resolveUserVisibilityContext_()` in `configuration` and `av_session` for
  combining property and normal privileges;
- `buildAllowedCacheGroupCodeSet_()` for granting administrators every local
  cache group;
- property-aware row filtering and save validation in `teacher_pannel`; and
- server-side group and action validation in the other endpoints.
