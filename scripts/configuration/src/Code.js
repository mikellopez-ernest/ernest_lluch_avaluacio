const ALLOWED_EMAIL_DOMAIN = 'iernestlluch.cat';
const CACHE_SHEET_NAME = 'subjects_cache';
const GRADES_TABLE_NAME = 'Grades';
const HORARIS_TABLE_NAME = 'Horaris';
const HORARIS_SHEET_NAME = 'GPU001';
const DINANTIA_TABLE_NAME = 'Dinantia';
const DINANTIA_GROUPS_SHEET_NAME = 'dinantia_2_dades_alumnes';
const TEACHERS_TABLE_NAME = 'Dades de professors';
const TEACHERS_SHEET_NAME = 'Llista';
const SUBJECTS_TABLE_NAME = 'Càrrega lectiva';
const SUBJECTS_SHEET_NAME = 'assignatures';
const DINANTIA_API_BASE_URL = 'https://app.dinantia.com/api/web';

function grantPermissionsManually() {
  const userEmail = Session.getActiveUser().getEmail();
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) {
    throw new Error('Missing script property: db');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(1000);
  lock.releaseLock();

  const registrySpreadsheet = SpreadsheetApp.openById(dbId);
  const tablesSheet = getRequiredSheet_(registrySpreadsheet, 'tables');
  const registryRows = tablesSheet.getDataRange().getValues();

  getRequiredSheet_(openLogicalTableSpreadsheet_(GRADES_TABLE_NAME), CACHE_SHEET_NAME)
    .getDataRange()
    .getValues();
  getRequiredSheet_(openLogicalTableSpreadsheet_(HORARIS_TABLE_NAME), HORARIS_SHEET_NAME)
    .getDataRange()
    .getValues();
  getRequiredSheet_(openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME), DINANTIA_GROUPS_SHEET_NAME)
    .getDataRange()
    .getValues();
  getRequiredSheet_(openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME), TEACHERS_SHEET_NAME)
    .getDataRange()
    .getValues();
  getRequiredSheet_(openLogicalTableSpreadsheet_(SUBJECTS_TABLE_NAME), SUBJECTS_SHEET_NAME)
    .getDataRange()
    .getValues();

  fetchDinantiaGroups_();

  const htmlOutput = HtmlService.createHtmlOutput('<p>Permissions ready.</p>')
    .setTitle('Configuració');

  return {
    userEmail,
    registryRows: Math.max(registryRows.length - 1, 0),
    htmlTitle: htmlOutput.getTitle(),
    status: 'Permissions granted for configuration endpoint.'
  };
}

function doGet() {
  if (!isAllowedUser_()) {
    return HtmlService.createHtmlOutput(
      '<h1>Accés restringit</h1><p>Aquesta aplicació només està disponible per a usuaris @iernestlluch.cat.</p>'
    )
      .setTitle('Configuració')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Configuració')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getConfigurationData() {
  assertAllowedUser_();

  const cacheRows = readSubjectsCacheRows_();
  const groupNames = uniqueSorted_(cacheRows.map(row => row.groupName));
  const subjects = uniqueSorted_(cacheRows.map(row => row.subjectFullName));
  const teachers = uniqueSorted_(cacheRows.map(row => row.teacherFullName));
  const dinantiaGroups = uniqueSorted_(fetchDinantiaGroups_().map(group => group.name));

  return {
    title: 'Configuració',
    groups: groupNames,
    rowsByGroup: groupRowsByName_(cacheRows),
    options: {
      subjects,
      teachers,
      dinantiaGroups
    }
  };
}

function saveSubjectsCacheEdits(payload) {
  assertAllowedUser_();

  const groupName = String(payload && payload.groupName || '').trim();
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];

  if (!groupName) {
    throw new Error('Falta el grup.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const existingRows = readSubjectsCacheRows_();
    const sourceGroup = existingRows.find(row => row.groupName === groupName);
    const groupCode = sourceGroup ? sourceGroup.group : '';
    const rowsById = new Map(existingRows.map(row => [String(row.id), row]));
    const newRows = [];

    rows.forEach(row => {
      const id = String(row.id || '').trim();
      const updatedRow = {
        id: Number(id) || '',
        group: String(row.group || groupCode || '').trim(),
        groupName,
        profReduit: findTeacherCodeByName_(row.teacherFullName),
        teacherFullName: String(row.teacherFullName || '').trim(),
        matReduit: findSubjectCodeByName_(row.subjectFullName),
        subjectFullName: String(row.subjectFullName || '').trim(),
        subjectDinantiaGroupAv: String(row.subjectDinantiaGroupAv || '').trim()
      };

      if (!updatedRow.subjectFullName && !updatedRow.teacherFullName && !updatedRow.subjectDinantiaGroupAv) {
        return;
      }

      if (id && rowsById.has(id)) {
        rowsById.set(id, updatedRow);
      } else {
        newRows.push(updatedRow);
      }
    });

    writeSubjectsCacheRows_(Array.from(rowsById.values()).concat(newRows));

    return getConfigurationData();
  } finally {
    lock.releaseLock();
  }
}

function buildSubjectsCache() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const horarisSpreadsheet = openLogicalTableSpreadsheet_(HORARIS_TABLE_NAME);
    const gpu001Sheet = getRequiredSheet_(horarisSpreadsheet, HORARIS_SHEET_NAME);
    const gpu001Rows = readGpu001Rows_(gpu001Sheet);

    const dinantiaRows = readRowsByHeader_(
      getRequiredSheet_(openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME), DINANTIA_GROUPS_SHEET_NAME)
    );
    const teacherRows = readRowsByHeader_(
      getRequiredSheet_(openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME), TEACHERS_SHEET_NAME)
    );
    const subjectRows = readSubjectCatalogRows_(
      getRequiredSheet_(openLogicalTableSpreadsheet_(SUBJECTS_TABLE_NAME), SUBJECTS_SHEET_NAME)
    );

    const groupNamesByUntisName = buildGroupNamesByUntisName_(dinantiaRows);
    const teacherNamesByCode = buildTeacherNamesByCode_(teacherRows);
    const subjectNamesByCode = buildSubjectNamesByCode_(subjectRows);
    const dedupedRows = dedupeGpu001Rows_(gpu001Rows);

    const cacheRows = dedupedRows.map(row => {
      const groupName = groupNamesByUntisName.get(normalizeCode_(row.group)) || '';
      const teacherFullName = teacherNamesByCode.get(normalizeCode_(row.profReduit)) || '';
      const subjectFullName = subjectNamesByCode.get(normalizeCode_(row.matReduit)) || '';

      return {
        group: row.group,
        groupName,
        profReduit: row.profReduit,
        teacherFullName,
        matReduit: row.matReduit,
        subjectFullName,
        subjectDinantiaGroupAv: groupName
      };
    }).filter(row => row.groupName);

    writeSubjectsCacheRows_(cacheRows);

    return {
      rowsRead: gpu001Rows.length,
      rowsWritten: cacheRows.length,
      status: 'subjects_cache rebuilt.'
    };
  } finally {
    lock.releaseLock();
  }
}

function readSubjectsCacheRows_() {
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const cacheSheet = getRequiredSheet_(gradesSpreadsheet, CACHE_SHEET_NAME);

  return readRowsByHeader_(cacheSheet).map(row => ({
    id: Number(getField_(row, 'id')) || '',
    group: String(getField_(row, 'group') || '').trim(),
    groupName: String(getField_(row, 'group_name') || '').trim(),
    profReduit: String(getField_(row, 'prof_reduit') || '').trim(),
    teacherFullName: String(getField_(row, 'teacher_full_name') || '').trim(),
    matReduit: String(getField_(row, 'mat_reduit') || '').trim(),
    subjectFullName: String(getField_(row, 'subject_full_name') || '').trim(),
    subjectDinantiaGroupAv: String(getField_(row, 'subject_dinantia_group_av') || '').trim()
  })).filter(row => row.groupName);
}

function writeSubjectsCacheRows_(rows) {
  const cacheHeaders = [
    'id',
    'group',
    'group_name',
    'prof_reduit',
    'teacher_full_name',
    'mat_reduit',
    'subject_full_name',
    'subject_dinantia_group_av'
  ];

  const sortedRows = rows
    .filter(row => String(row.groupName || '').trim())
    .sort((a, b) => (
      a.groupName.localeCompare(b.groupName, 'ca') ||
      a.group.localeCompare(b.group, 'ca') ||
      a.subjectFullName.localeCompare(b.subjectFullName, 'ca') ||
      a.teacherFullName.localeCompare(b.teacherFullName, 'ca') ||
      a.subjectDinantiaGroupAv.localeCompare(b.subjectDinantiaGroupAv, 'ca')
    ));

  const cacheValues = sortedRows.map((row, index) => [
    index + 1,
    row.group,
    row.groupName,
    row.profReduit,
    row.teacherFullName,
    row.matReduit,
    row.subjectFullName,
    row.subjectDinantiaGroupAv
  ]);

  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const cacheSheet = getOrCreateSheet_(gradesSpreadsheet, CACHE_SHEET_NAME);

  cacheSheet.clearContents();
  cacheSheet.getRange(1, 1, 1, cacheHeaders.length).setValues([cacheHeaders]);

  if (cacheValues.length > 0) {
    cacheSheet.getRange(2, 1, cacheValues.length, cacheHeaders.length).setValues(cacheValues);
  }

  cacheSheet.autoResizeColumns(1, cacheHeaders.length);
}

function groupRowsByName_(rows) {
  return rows.reduce((groups, row) => {
    if (!groups[row.groupName]) groups[row.groupName] = [];

    groups[row.groupName].push({
      id: row.id,
      group: row.group,
      subjectFullName: row.subjectFullName,
      teacherFullName: row.teacherFullName,
      subjectDinantiaGroupAv: row.subjectDinantiaGroupAv
    });

    return groups;
  }, {});
}

function fetchDinantiaGroups_() {
  const groups = fetchDinantiaCollection_('/v1/groups/index');

  return groups
    .map(group => ({
      id: group.id,
      name: String(group.id || '').trim(),
      tag: group.tag
    }))
    .filter(group => group.name);
}

function fetchDinantiaCollection_(path) {
  const allRecords = [];
  let page = 1;

  while (true) {
    const response = fetchDinantia_(path, {
      limit: 100,
      page
    });

    allRecords.push.apply(allRecords, response.data || []);

    if (!response.pagination || !response.pagination.has_next_page) {
      break;
    }

    page += 1;
  }

  return allRecords;
}

function fetchDinantia_(path, params) {
  const properties = PropertiesService.getScriptProperties();
  const user = String(properties.getProperty('dinantia_api_user') || '').trim();
  const secret = String(properties.getProperty('dinantia_api_secret') || '').trim();

  if (!user || !secret) {
    throw new Error('Missing Dinantia API script properties.');
  }

  const query = params ? '?' + Object.keys(params)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&') : '';
  const url = `${DINANTIA_API_BASE_URL}${path}${query}`;
  const auth = Utilities.base64Encode(`${user}:${secret}`);
  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json'
    }
  });
  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText();
  let body;

  try {
    body = JSON.parse(bodyText);
  } catch (error) {
    throw new Error(`Dinantia API returned invalid JSON for ${path}. Status ${statusCode}.`);
  }

  if (statusCode < 200 || statusCode >= 300 || body.success === false) {
    throw new Error(`Dinantia API request failed for ${path}. Status ${statusCode}.`);
  }

  return body;
}

function findTeacherCodeByName_(teacherFullName) {
  const target = normalizeCode_(teacherFullName);
  if (!target) return '';

  const teacherRows = readRowsByHeader_(
    getRequiredSheet_(openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME), TEACHERS_SHEET_NAME)
  );

  const match = teacherRows.find(row => normalizeCode_(buildTeacherFullName_(row)) === target);
  return match ? String(getField_(match, 'REDUIT', 'REDUÏT') || '').trim() : '';
}

function findSubjectCodeByName_(subjectFullName) {
  const target = normalizeCode_(subjectFullName);
  if (!target) return '';

  const subjectRows = readSubjectCatalogRows_(
    getRequiredSheet_(openLogicalTableSpreadsheet_(SUBJECTS_TABLE_NAME), SUBJECTS_SHEET_NAME)
  );

  const match = subjectRows.find(row => normalizeCode_(
    getField_(row, 'full_name') ||
    getField_(row, 'true_subject') ||
    getField_(row, 'short_name')
  ) === target);

  return match ? String(getField_(match, 'short_name') || '').trim() : '';
}

function readGpu001Rows_(sheet) {
  const values = sheet.getDataRange().getValues();

  return values
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => ({
      sourceId: row[0],
      group: String(row[1] || '').trim(),
      profReduit: String(row[2] || '').trim(),
      matReduit: String(row[3] || '').trim(),
      classroomName: String(row[4] || '').trim(),
      weekday: row[5],
      scheduleHour: row[6]
    }))
    .filter(row => row.group || row.profReduit || row.matReduit);
}

function dedupeGpu001Rows_(rows) {
  const seen = new Set();
  const deduped = [];

  rows.forEach(row => {
    const key = [
      normalizeCode_(row.group),
      normalizeCode_(row.profReduit),
      normalizeCode_(row.matReduit)
    ].join('||');

    if (seen.has(key)) return;

    seen.add(key);
    deduped.push(row);
  });

  return deduped;
}

function buildGroupNamesByUntisName_(rows) {
  const map = new Map();

  rows.forEach(row => {
    const groupName = String(getField_(row, 'dinantia_group_name') || '').trim();
    if (!groupName) return;

    String(getField_(row, 'untis_group_name') || '')
      .split(',')
      .map(value => normalizeCode_(value))
      .filter(Boolean)
      .forEach(untisGroupName => {
        if (!map.has(untisGroupName)) {
          map.set(untisGroupName, groupName);
        }
      });
  });

  return map;
}

function buildTeacherNamesByCode_(rows) {
  const map = new Map();

  rows.forEach(row => {
    const reduit = normalizeCode_(getField_(row, 'REDUIT', 'REDUÏT'));
    if (!reduit) return;

    map.set(reduit, buildTeacherFullName_(row));
  });

  return map;
}

function buildSubjectNamesByCode_(rows) {
  const map = new Map();

  rows.forEach(row => {
    const fullName = String(
      getField_(row, 'full_name') ||
      getField_(row, 'true_subject') ||
      getField_(row, 'short_name') ||
      ''
    ).trim();

    [
      getField_(row, 'short_name'),
      getField_(row, 'untis_name'),
      getField_(row, 'true_subject')
    ].forEach(code => {
      const normalizedCode = normalizeCode_(code);
      if (!normalizedCode || !fullName || map.has(normalizedCode)) return;

      map.set(normalizedCode, fullName);
    });
  });

  return map;
}

function readSubjectCatalogRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(header => String(header || '').trim());

  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => {
      const record = {
        short_name: row[0],
        ETAPA: row[1],
        full_name: row[2],
        untis_name: row[3],
        true_subject: row[4]
      };

      headers.forEach((header, index) => {
        if (!header) return;

        record[header] = row[index];
        record[normalizeHeader_(header)] = row[index];
      });

      return record;
    });
}

function uniqueSorted_(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'ca'));
}

function openLogicalTableSpreadsheet_(logicalTableName) {
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) {
    throw new Error('Missing script property: db');
  }

  const registrySpreadsheet = SpreadsheetApp.openById(dbId);
  const tablesSheet = getRequiredSheet_(registrySpreadsheet, 'tables');
  const rows = tablesSheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const name = String(rows[i][0] || '').trim();
    const spreadsheetId = String(rows[i][1] || '').trim();

    if (name === logicalTableName && spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  }

  throw new Error(`Logical table not found in registry: ${logicalTableName}`);
}

function readRowsByHeader_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(header => String(header || '').trim());

  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => {
      const record = {};
      headers.forEach((header, index) => {
        if (!header) return;

        record[header] = row[index];
        record[normalizeHeader_(header)] = row[index];
      });
      return record;
    });
}

function buildTeacherFullName_(teacherRow) {
  return [
    getField_(teacherRow, 'NOM'),
    getField_(teacherRow, 'COGNOM1'),
    getField_(teacherRow, 'COGNOM2')
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function getField_(row, ...headers) {
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row, header)) {
      return row[header];
    }

    const normalizedHeader = normalizeHeader_(header);
    if (Object.prototype.hasOwnProperty.call(row, normalizedHeader)) {
      return row[normalizedHeader];
    }
  }

  return '';
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeCode_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function isAllowedUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  return email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

function assertAllowedUser_() {
  if (!isAllowedUser_()) {
    throw new Error('Accés restringit.');
  }
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }
  return sheet;
}

function getOrCreateSheet_(spreadsheet, sheetName) {
  return spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
}
