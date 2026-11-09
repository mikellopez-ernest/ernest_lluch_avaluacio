const IMPORT_ALIASES_SHEET = 'pendents_import_aliases';
const IMPORT_ALIASES_HEADERS = ['kind', 'source_key', 'source_name', 'source_group', 'source_subject',
  'target_id', 'target_key', 'updated_by', 'updated_at'];

function getOrCreateImportAliasesSheet_(grades) {
  let sheet = grades.getSheetByName(IMPORT_ALIASES_SHEET);
  if (!sheet) sheet = grades.insertSheet(IMPORT_ALIASES_SHEET);
  if (sheet.getMaxColumns() < IMPORT_ALIASES_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), IMPORT_ALIASES_HEADERS.length - sheet.getMaxColumns());
  }
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, IMPORT_ALIASES_HEADERS.length).setValues([IMPORT_ALIASES_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readImportAliases_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value).trim());
  if (headers.length !== IMPORT_ALIASES_HEADERS.length || !IMPORT_ALIASES_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error('Columnes incorrectes a ' + IMPORT_ALIASES_SHEET + ': ' + IMPORT_ALIASES_HEADERS.join(', '));
  }
  return values.slice(1).filter(row => row.some(value => value !== '' && value !== null)).map(row => {
    const record = {};
    IMPORT_ALIASES_HEADERS.forEach((header, index) => {
      const value = row[index];
      record[header] = value instanceof Date ? value.toISOString() : String(value == null ? '' : value).trim();
    });
    return record;
  });
}

function importAliasTargetKey_(kind, target) {
  return kind === 'student' ? studentChoiceKey_(target)
    : studentImportDigest_([target.id, normalizeStudentImportText_(target.name), target.level]);
}

function applyImportAliases_(rows, aliases, catalogs) {
  const byKey = new Map();
  aliases.forEach(alias => {
    const key = JSON.stringify([alias.kind, alias.source_key]);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(alias);
  });
  rows.forEach(row => {
    ['subject', 'student'].forEach(kind => {
      if (row[kind + 'Id']) return; // Unique canonical matches take precedence.
      const sourceKey = kind === 'subject' ? row.subjectReviewKey : row.studentMatchKey;
      const matches = byKey.get(JSON.stringify([kind, sourceKey])) || [];
      if (matches.length !== 1) return; // Duplicated sheet entries need review.
      const alias = matches[0];
      const targets = kind === 'subject' ? catalogs.subjects : catalogs.students;
      const target = targets.find(item => item.id === alias.target_id && importAliasTargetKey_(kind, item) === alias.target_key);
      if (!target) return; // Deleted/changed identities must be selected again.
      row[kind + 'Id'] = kind === 'subject' ? target.id : studentChoiceKey_(target);
      row[kind + 'Issue'] = '';
    });
  });
}

function prepareImportAliases_(corrections, pairs, catalogs, existing) {
  if (corrections === undefined) corrections = [];
  if (!Array.isArray(corrections) || corrections.length > MAX_STUDENT_IMPORT_ROWS) {
    throw new Error('Equivalències d’importació incorrectes.');
  }
  const selectedPairs = new Set(pairs.map(pair => JSON.stringify([pair && pair.studentId, pair && pair.subjectId])));
  const learned = new Map();
  const updatedBy = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const updatedAt = new Date().toISOString();
  corrections.forEach(correction => {
    const source = validateStudentImportSource_([correction])[0];
    if (!source.name || !source.group || !source.subject ||
      !selectedPairs.has(JSON.stringify([correction.studentId, correction.subjectId])) ||
      typeof correction.rememberStudent !== 'boolean' || typeof correction.rememberSubject !== 'boolean') {
      throw new Error('Equivalència sense una fila vàlida a la importació.');
    }
    const row = buildStudentImportPreview_([source], [], []).rows[0];
    ['subject', 'student'].forEach(kind => {
      if (!correction[kind === 'subject' ? 'rememberSubject' : 'rememberStudent']) return;
      const targets = kind === 'subject' ? catalogs.subjects : catalogs.students;
      const target = targets.find(item => (kind === 'subject' ? item.id : studentChoiceKey_(item)) === correction[kind + 'Id']);
      if (!target) throw new Error('L’equivalència apunta a un alumne o assignatura que ja no existeix.');
      // Recompute keys on the server; never trust client-supplied grouping keys.
      const sourceKey = kind === 'subject' ? row.subjectReviewKey : row.studentMatchKey;
      const key = JSON.stringify([kind, sourceKey]);
      const alias = { kind, source_key: sourceKey, source_name: kind === 'student' ? source.name : '',
        source_group: kind === 'student' ? source.group : row.subjectContext,
        source_subject: kind === 'subject' ? source.subject : '', target_id: target.id,
        target_key: importAliasTargetKey_(kind, target), updated_by: updatedBy, updated_at: updatedAt };
      if (learned.has(key) && learned.get(key).target_key !== alias.target_key) {
        throw new Error('El mateix nom d’origen té equivalències diferents. Revisa la importació.');
      }
      learned.set(key, alias);
    });
  });
  const rows = existing.filter(alias => !learned.has(JSON.stringify([alias.kind, alias.source_key])));
  return { rows: rows.concat(Array.from(learned.values())), count: learned.size };
}

function writeImportAliases_(sheet, rows) {
  const values = [IMPORT_ALIASES_HEADERS].concat(rows.map(row => IMPORT_ALIASES_HEADERS.map(header =>
    header === 'updated_at' && row[header] ? new Date(row[header]) : sheetText_(row[header]))));
  if (sheet.getMaxRows() < values.length) sheet.insertRowsAfter(sheet.getMaxRows(), values.length - sheet.getMaxRows());
  sheet.getRange(1, 1, values.length, IMPORT_ALIASES_HEADERS.length).setValues(values);
  if (sheet.getLastRow() > values.length) sheet.getRange(values.length + 1, 1, sheet.getLastRow() - values.length, IMPORT_ALIASES_HEADERS.length).clearContent();
}
