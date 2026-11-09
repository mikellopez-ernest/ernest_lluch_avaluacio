const ALLOWED_EMAIL_DOMAIN = 'iernestlluch.cat';
const PAGE_TITLE = 'Configuració de pendents';
const CONFIG_SHEET = 'pendents_config';
const DATA_HEADERS = ['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio'];
const CONFIG_HEADERS = DATA_HEADERS.concat(['updated_by', 'updated_at']);
const LEVELS = ['1r ESO', '2n ESO', '3r ESO', '4t ESO', '1r BAT', '2n BAT'];
const DEPARTMENTS = ['Català', 'Castellà', 'Llengües extrangeres', 'Matemàtiques',
  'Biologia / FiQ', 'Tecnologia', 'Socials', 'ViP / Música', 'Educació Fisica',
  'Orientació', 'Informàtica'];

function doGet() {
  if (!isAllowedUser_()) {
    return HtmlService.createHtmlOutput(
      '<h1>Accés restringit</h1><p>Cal un compte @iernestlluch.cat.</p>'
    ).setTitle(PAGE_TITLE);
  }
  return HtmlService.createTemplateFromFile('Index').evaluate().setTitle(PAGE_TITLE);
}

function getPendentsConfigurationData() {
  assertAllowedUser_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let rows;
  try {
    const sheet = openLogicalTableSpreadsheet_('Grades').getSheetByName(CONFIG_SHEET);
    ensureAuditColumns_(sheet);
    rows = readConfigurationRows_(sheet);
  } finally {
    lock.releaseLock();
  }
  return { title: PAGE_TITLE, canImport: canImport_(), rows: decorateAuditRows_(rows), revision: revision_(rows),
    levels: LEVELS, departments: configurationDepartments_(rows) };
}

function getPendentsImportData() {
  assertAllowedUser_();
  if (!canImport_()) throw new Error('No tens permís per importar matèries.');
  const sheet = getRequiredSheet_(openLogicalTableSpreadsheet_('Grades'), 'subjects_cache');
  const rows = readRowsByHeader_(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  ['group', 'group_name', 'subject_full_name'].forEach(header => {
    if (!headers.includes(header)) throw new Error('Missing subjects_cache header: ' + header);
  });
  return buildImportRows_(rows);
}

function savePendentsConfiguration(payload) {
  assertAllowedUser_();
  if (!payload || !Array.isArray(payload.rows) || typeof payload.revision !== 'string') {
    throw new Error('Dades de desament incorrectes.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const grades = openLogicalTableSpreadsheet_('Grades');
    let sheet = grades.getSheetByName(CONFIG_SHEET);
    const existing = readConfigurationRows_(sheet);
    if (payload.revision !== revision_(existing)) {
      throw new Error('Un altre usuari ha modificat la configuració. Recarrega la pàgina abans de desar.');
    }
    const rows = validateConfigurationRows_(payload.rows, existing, reservedPendingSubjectId_(grades));
    applyAuditMetadata_(rows, existing);
    const responseRows = decorateAuditRows_(rows);
    if (!sheet) sheet = grades.insertSheet(CONFIG_SHEET);
    if (sheet.getMaxColumns() < CONFIG_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), CONFIG_HEADERS.length - sheet.getMaxColumns());
    }
    const values = [CONFIG_HEADERS].concat(rows.map(row => CONFIG_HEADERS.map(header => header === 'id' && /^\d+$/.test(row.id) ? Number(row.id)
      : header === 'updated_at' && row.updated_at ? new Date(row.updated_at) : sheetText_(row[header]))));
    if (sheet.getMaxRows() < values.length) sheet.insertRowsAfter(sheet.getMaxRows(), values.length - sheet.getMaxRows());
    sheet.getRange(1, 1, values.length, CONFIG_HEADERS.length).setValues(values);
    if (sheet.getLastRow() > values.length) sheet.getRange(values.length + 1, 1, sheet.getLastRow() - values.length, CONFIG_HEADERS.length).clearContent();
    sheet.setFrozenRows(1);
    sheet.getRange(2, 7, Math.max(1, rows.length), 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    SpreadsheetApp.flush();
    return { rows: responseRows, revision: revision_(rows) };
  } finally {
    lock.releaseLock();
  }
}

function savePendentsRecoveryCriteria(payload) {
  assertAllowedUser_();
  if (!payload || typeof payload.id !== 'string' || !payload.id.trim() || typeof payload.revision !== 'string') {
    throw new Error('Dades dels criteris incorrectes.');
  }
  const text = validateRecoveryCriteria_(payload.criteris_recuperacio);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getRequiredSheet_(openLogicalTableSpreadsheet_('Grades'), CONFIG_SHEET);
    const rows = readConfigurationRows_(sheet);
    if (payload.revision !== revision_(rows)) {
      throw new Error('Un altre usuari ha modificat la configuració. Recarrega la pàgina abans de desar.');
    }
    const matching = rows.filter(row => row.id === payload.id.trim());
    if (matching.length !== 1) throw new Error('No s’ha trobat una assignatura única amb aquest identificador.');
    // Locate the physical row, including any blank rows between records.
    const sheetRow = sheet.getDataRange().getValues().findIndex((row, index) =>
      index > 0 && String(row[0]).trim() === payload.id.trim()) + 1;
    if (sheetRow < 2) throw new Error('No s’ha trobat l’assignatura.');
    if (matching[0].criteris_recuperacio !== text || !matching[0].updated_by || !matching[0].updated_at) {
      const before = Object.assign({}, matching[0]);
      matching[0].criteris_recuperacio = text;
      applyAuditMetadata_([matching[0]], [before], true);
      const decorated = decorateAuditRows_([matching[0]])[0];
      ensureAuditColumns_(sheet);
      sheet.getRange(sheetRow, 5, 1, 3).setValues([[sheetText_(text), matching[0].updated_by, new Date(matching[0].updated_at)]]);
      sheet.getRange(sheetRow, 7).setNumberFormat('dd/MM/yyyy HH:mm:ss');
      SpreadsheetApp.flush();
      return Object.assign(decorated, { revision: revision_(rows) });
    }
    return Object.assign(decorateAuditRows_([matching[0]])[0], { revision: revision_(rows) });
  } finally {
    lock.releaseLock();
  }
}

function validateRecoveryCriteria_(value) {
  if (typeof value !== 'string' || value.length > 50000) {
    throw new Error('Els criteris han de ser un text de com a màxim 50.000 caràcters.');
  }
  return value;
}

function grantPermissionsManually() {
  assertAllowedUser_();
  const grades = openLogicalTableSpreadsheet_('Grades');
  getRequiredSheet_(grades, 'subjects_cache').getRange(1, 1).getValue();
  ensureAuditColumns_(grades.getSheetByName(CONFIG_SHEET));
  readConfigurationRows_(grades.getSheetByName(CONFIG_SHEET));
  readAuditNames_();
  readStudentImportCatalogs_();
  getOrCreateStudentPendingSheet_(grades);
  getOrCreateImportAliasesSheet_(grades);
  return { status: 'Database connections verified.' };
}

function readConfigurationRows_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return [];
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value).trim());
  const expected = headers.length === DATA_HEADERS.length ? DATA_HEADERS : CONFIG_HEADERS;
  if (headers.length !== expected.length || !expected.every((header, index) => headers[index] === header)) {
    throw new Error('pendents_config ha de tenir les columnes: ' + CONFIG_HEADERS.join(', '));
  }
  return values.slice(1).filter(row => row.some(value => value !== '' && value !== null)).map(row => {
    const record = {};
    CONFIG_HEADERS.forEach((header, index) => {
      const cell = row[index];
      const value = header === 'updated_at' && cell instanceof Date ? cell.toISOString() : String(cell == null ? '' : cell);
      record[header] = header === 'criteris_recuperacio' ? value : value.trim();
    });
    return record;
  });
}

function resolveLevel_(code, displayName) {
  const local = String(code || '').toUpperCase().replace(/\s+/g, '');
  const explicit = local.match(/^([1-4])(?:R|N|T)?(ESO|BAT)(?:[A-Z].*)?$/);
  let match = explicit;
  // Short local codes require an aligned display name to distinguish ESO from BAT.
  if (!match && /^[1-4][A-Z]+$/.test(local)) {
    const display = String(displayName || '').trim().match(/^([1-4])(?:r|n|t)?\s*(ESO|BAT)(?:\s|$)/i);
    if (display && display[1] === local[0]) match = display;
  }
  if (!match) return '';
  const ordinal = { '1': '1r', '2': '2n', '3': '3r', '4': '4t' };
  const level = ordinal[match[1]] + ' ' + match[2].toUpperCase();
  return LEVELS.includes(level) ? level : '';
}

function buildImportRows_(cacheRows) {
  const found = new Map();
  cacheRows.forEach(row => {
    const subject = String(row.subject_full_name || '').trim();
    if (!subject) return;
    const groups = String(row.group || '').split(',');
    const names = String(row.group_name || '').split(',');
    groups.forEach((group, index) => {
      const level = resolveLevel_(group, names[index]);
      if (!level) return;
      const record = { id: '', nivell: level, assignatura: subject, departament: '', criteris_recuperacio: '' };
      const key = rowKey_(record);
      if (!found.has(key)) found.set(key, record);
    });
  });
  return Array.from(found.values()).sort((a, b) => LEVELS.indexOf(a.nivell) - LEVELS.indexOf(b.nivell)
    || a.assignatura.localeCompare(b.assignatura, 'ca'));
}

function rowKey_(row) {
  return JSON.stringify([row.nivell, row.assignatura.normalize('NFC').toLocaleLowerCase('ca')]);
}

function configurationDepartments_(rows) {
  return Array.from(new Set(DEPARTMENTS.concat(rows.map(row => String(row.departament || '').trim().normalize('NFC')))
    .filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ca'));
}

function validateConfigurationRows_(input, existing, reservedSubjectId = 0) {
  const existingIds = new Map(existing.map(row => [row.id, row]));
  const allowedDepartments = new Set(configurationDepartments_(existing));
  const keys = new Set();
  const ids = new Set();
  let nextId = Math.max(Number(reservedSubjectId) || 0, existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)) + 1;
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('Fila incorrecta.');
    const row = {};
    DATA_HEADERS.forEach(header => {
      if (header !== 'criteris_recuperacio') row[header] = String(raw[header] == null ? '' : raw[header]).trim();
    });
    const old = existingIds.get(row.id);
    row.criteris_recuperacio = validateRecoveryCriteria_(raw.criteris_recuperacio == null
      ? (old && old.criteris_recuperacio || '') : raw.criteris_recuperacio);
    if (row.id && (!old || ids.has(row.id))) throw new Error('Identificador de fila incorrecte.');
    if (!LEVELS.includes(row.nivell) || !row.assignatura) throw new Error('Revisa el nivell i la matèria de la fila ' + (index + 1) + '.');
    row.departament = row.departament.normalize('NFC');
    if (row.departament && !allowedDepartments.has(row.departament)) {
      throw new Error('Departament no vàlid a la fila ' + (index + 1) + ': ' + row.departament + '. Recarrega la pàgina i selecciona un departament de la llista.');
    }
    if (keys.has(rowKey_(row))) throw new Error('Matèria duplicada per al nivell: ' + row.assignatura);
    keys.add(rowKey_(row));
    if (!row.id) row.id = String(nextId++);
    ids.add(row.id);
    row.updated_by = old && old.updated_by || '';
    row.updated_at = old && old.updated_at || '';
    return row;
  });
}

function reservedPendingSubjectId_(grades) {
  const sheet = grades.getSheetByName('pendents_students_cache');
  if (!sheet || sheet.getLastRow() < 2) return 0;
  if (String(sheet.getRange(1, 6).getValue()).trim() !== 'subject_id') {
    throw new Error('No es poden reservar els identificadors de pendents_students_cache: manca subject_id.');
  }
  return sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).getValues()
    .reduce((max, row) => Math.max(max, Number(row[0]) || 0), 0);
}

function revision_(rows) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(rows.map(row => CONFIG_HEADERS.map(header => row[header] || '')))));
}

function ensureAuditColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  readConfigurationRows_(sheet); // Validate before changing an existing schema.
  if (sheet.getDataRange().getValues()[0].length === DATA_HEADERS.length) {
    if (sheet.getMaxColumns() < CONFIG_HEADERS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), CONFIG_HEADERS.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 6, 1, 2).setValues([['updated_by', 'updated_at']]);
  }
}

function applyAuditMetadata_(rows, existing, initialize = false) {
  const oldById = new Map(existing.map(row => [row.id, row]));
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const now = new Date().toISOString();
  rows.forEach(row => {
    const old = oldById.get(row.id);
    const changed = !old || DATA_HEADERS.some(header => header !== 'id' && row[header] !== old[header]);
    const tracked = old && old.updated_by && old.updated_at;
    const stamp = initialize || (tracked && changed);
    row.updated_by = stamp ? email : old && old.updated_by || '';
    row.updated_at = stamp ? now : old && old.updated_at || '';
  });
}

function readAuditNames_() {
  const sheet = getRequiredSheet_(openLogicalTableSpreadsheet_('Dades de professors'), 'Llista');
  const values = sheet.getDataRange().getValues();
  const emailColumn = values[0].findIndex(header => String(header).trim().toUpperCase() === 'CORREU INSTIT');
  const names = Object.create(null);
  if (emailColumn < 0) return names;
  values.slice(1).forEach(row => {
    const email = String(row[emailColumn] || '').trim().toLowerCase();
    const name = [row[2], row[3], row[4]].map(value => String(value || '').trim()).filter(Boolean).join(' ');
    if (email && name) names[email] = name;
  });
  return names;
}

function decorateAuditRows_(rows) {
  const names = rows.some(row => row.updated_by) ? readAuditNames_() : {};
  return rows.map(row => Object.assign({}, row, {
    updated_by_name: names[String(row.updated_by || '').toLowerCase()] || row.updated_by || ''
  }));
}

function sheetText_(value) {
  // Prevent editable subject names from being interpreted as spreadsheet formulas.
  return /^[=+@-]/.test(String(value)) ? "'" + value : value;
}

function canImport_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  return email === 'admindomini@' + ALLOWED_EMAIL_DOMAIN;
}

function isAllowedUser_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  return email.endsWith('@' + ALLOWED_EMAIL_DOMAIN);
}

function assertAllowedUser_() {
  if (!isAllowedUser_()) {
    throw new Error('Accés restringit: cal un compte @iernestlluch.cat.');
  }
}

function openLogicalTableSpreadsheet_(logicalTableName) {
  const dbId = String(PropertiesService.getScriptProperties().getProperty('db') || '').trim();
  if (!dbId) throw new Error('Missing script property: db');

  const registry = SpreadsheetApp.openById(dbId);
  const rows = getRequiredSheet_(registry, 'tables').getDataRange().getValues();
  for (let index = 1; index < rows.length; index += 1) {
    const name = String(rows[index][0] || '').trim();
    const spreadsheetId = String(rows[index][1] || '').trim();
    if (name === logicalTableName && spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }
  }
  throw new Error('Logical table not found in registry: ' + logicalTableName);
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Sheet not found: ' + sheetName);
  return sheet;
}

function readRowsByHeader_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(value => String(value || '').trim());
  return values.slice(1)
    .filter(row => row.some(value => value !== '' && value !== null))
    .map(row => {
      const record = {};
      headers.forEach((header, index) => {
        if (header) record[header] = row[index];
      });
      return record;
    });
}
