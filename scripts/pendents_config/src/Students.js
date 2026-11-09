const STUDENT_PENDING_SHEET = 'pendents_students_cache';
const STUDENT_PENDING_HEADERS = ['id', 'student_id', 'student_name', 'student_email', 'student_group', 'subject_id', 'subject_name'];
const MAX_STUDENT_IMPORT_ROWS = 20000;

function getPendentsStudentsData() {
  assertAllowedUser_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const grades = openLogicalTableSpreadsheet_('Grades');
    const sheet = getOrCreateStudentPendingSheet_(grades);
    getOrCreateImportAliasesSheet_(grades);
    const rows = readStudentPendingRows_(sheet);
    const config = readConfigurationRows_(getRequiredSheet_(openLogicalTableSpreadsheet_('Grades'), CONFIG_SHEET));
    return { rows, revision: studentImportDigest_(rows), canImport: true,
      subjectLevels: Object.fromEntries(config.map(row => [row.id, row.nivell])) };
  } finally {
    lock.releaseLock();
  }
}

function previewPendentsStudentsImport(payload) {
  assertStudentImportUser_();
  const sourceRows = validateStudentImportSource_(payload && payload.rows);
  if (!sourceRows.some(row => row.name && row.group && row.subject)) {
    return buildStudentImportPreview_(sourceRows, [], []);
  }
  const catalogs = readStudentImportCatalogs_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let cacheRows; let aliases;
  try {
    const grades = openLogicalTableSpreadsheet_('Grades');
    cacheRows = readStudentPendingRows_(getOrCreateStudentPendingSheet_(grades));
    aliases = readImportAliases_(getOrCreateImportAliasesSheet_(grades));
  } finally {
    lock.releaseLock();
  }
  const result = buildStudentImportPreview_(sourceRows, catalogs.students, catalogs.subjects);
  applyImportAliases_(result.rows, aliases, catalogs);
  result.issues = result.rows.filter(row => !row.studentId || !row.subjectId).length;
  return Object.assign(result, {
    students: catalogs.students, subjects: catalogs.subjects,
    sourceRevision: studentImportDigest_(catalogs), cacheRevision: studentImportDigest_(cacheRows),
    aliasesRevision: studentImportDigest_(aliases)
  });
}

function commitPendentsStudentsImport(payload) {
  assertStudentImportUser_();
  if (!payload || !Array.isArray(payload.pairs) || !payload.pairs.length || payload.pairs.length > MAX_STUDENT_IMPORT_ROWS
    || typeof payload.sourceRevision !== 'string' || typeof payload.cacheRevision !== 'string') {
    throw new Error('La importació no conté parelles vàlides.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const catalogs = readStudentImportCatalogs_();
    if (studentImportDigest_(catalogs) !== payload.sourceRevision) {
      throw new Error('Les dades d’alumnes o assignatures han canviat. Torna a importar el fitxer.');
    }
    const grades = openLogicalTableSpreadsheet_('Grades');
    const sheet = getOrCreateStudentPendingSheet_(grades);
    const existing = readStudentPendingRows_(sheet);
    if (studentImportDigest_(existing) !== payload.cacheRevision) {
      throw new Error('La taula ha canviat durant la revisió. Torna a importar el fitxer.');
    }
    const aliasesSheet = getOrCreateImportAliasesSheet_(grades);
    const aliases = readImportAliases_(aliasesSheet);
    if ((payload.aliasesRevision !== undefined || (payload.corrections && payload.corrections.length))
      && payload.aliasesRevision !== studentImportDigest_(aliases)) {
      throw new Error('Les equivalències han canviat durant la revisió. Torna a importar el fitxer.');
    }
    const learned = prepareImportAliases_(payload.corrections, payload.pairs, catalogs, aliases);
    const result = mergeStudentPendingRows_(existing, payload.pairs, catalogs.students, catalogs.subjects);
    const values = [STUDENT_PENDING_HEADERS].concat(result.rows.map(row => STUDENT_PENDING_HEADERS.map(header =>
      header === 'id' ? Number(row.id) : sheetText_(row[header]))));
    if (sheet.getMaxRows() < values.length) sheet.insertRowsAfter(sheet.getMaxRows(), values.length - sheet.getMaxRows());
    sheet.getRange(1, 1, values.length, STUDENT_PENDING_HEADERS.length).setValues(values);
    if (sheet.getLastRow() > values.length) sheet.getRange(values.length + 1, 1, sheet.getLastRow() - values.length, STUDENT_PENDING_HEADERS.length).clearContent();
    SpreadsheetApp.flush();
    let aliasesWarning = '';
    if (learned.count) {
      try { writeImportAliases_(aliasesSheet, learned.rows); SpreadsheetApp.flush(); }
      catch (error) { aliasesWarning = 'La importació s’ha desat, però no s’han pogut desar les equivalències. Torna a importar per memoritzar-les.'; }
    }
    return { aliasesSaved: aliasesWarning ? 0 : learned.count, aliasesWarning, rows: result.rows, revision: studentImportDigest_(result.rows), added: result.added, updated: result.updated,
      duplicates: result.duplicates, canImport: true };
  } finally {
    lock.releaseLock();
  }
}

function assertStudentImportUser_() {
  assertAllowedUser_();
}

function studentImportDigest_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value)));
}

function getOrCreateStudentPendingSheet_(grades) {
  let sheet = grades.getSheetByName(STUDENT_PENDING_SHEET);
  if (!sheet) sheet = grades.insertSheet(STUDENT_PENDING_SHEET);
  if (sheet.getMaxColumns() < STUDENT_PENDING_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), STUDENT_PENDING_HEADERS.length - sheet.getMaxColumns());
  }
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, STUDENT_PENDING_HEADERS.length).setValues([STUDENT_PENDING_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readStudentPendingRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value).trim());
  if (headers.length !== STUDENT_PENDING_HEADERS.length || !STUDENT_PENDING_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error('Columnes incorrectes a ' + STUDENT_PENDING_SHEET + ': ' + STUDENT_PENDING_HEADERS.join(', '));
  }
  const rows = values.slice(1).filter(row => row.some(value => value !== '' && value !== null)).map(row => {
    const record = {};
    STUDENT_PENDING_HEADERS.forEach((header, index) => { record[header] = String(row[index] == null ? '' : row[index]).trim(); });
    return record;
  });
  const ids = new Set(); const pairs = new Set();
  rows.forEach(row => {
    const pair = JSON.stringify([row.student_id, row.subject_id]);
    if (!/^\d+$/.test(row.id) || !row.student_id || !row.subject_id || ids.has(row.id) || pairs.has(pair)) {
      throw new Error('La taula d’alumnes conté identificadors buits o duplicats. Revisa-la abans d’importar.');
    }
    ids.add(row.id); pairs.add(pair);
  });
  return rows;
}

function readStudentImportCatalogs_() {
  const sheet = getRequiredSheet_(openLogicalTableSpreadsheet_('Dinantia'), 'students_cache');
  const values = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 4).getValues();
  const expected = ['student_id', 'student_name', 'student_email', 'group_name'];
  if (!expected.every((header, index) => String(values[0][index]).trim() === header)) {
    throw new Error('students_cache ha de començar amb: ' + expected.join(', '));
  }
  const studentRecords = [];
  values.slice(1).filter(row => row.some(value => value !== '' && value !== null)).forEach((row, index) => {
    const student = { id: String(row[0] == null ? '' : row[0]).trim(), name: String(row[1] || '').trim(),
      email: String(row[2] || '').trim(), group: String(row[3] || '').trim() };
    if (!student.id || !student.name) throw new Error('Alumne sense identificador o nom a students_cache, fila ' + (index + 2) + '.');
    studentRecords.push(student);
  });
  const config = readConfigurationRows_(getRequiredSheet_(openLogicalTableSpreadsheet_('Grades'), CONFIG_SHEET));
  const subjectIds = new Set();
  const subjects = config.map(row => {
    if (!row.id || !row.assignatura || !LEVELS.includes(row.nivell) || subjectIds.has(row.id)) {
      throw new Error('Revisa els identificadors, nivells i noms de pendents_config abans d’importar.');
    }
    subjectIds.add(row.id);
    return { id: row.id, name: row.assignatura, level: row.nivell };
  });
  const students = consolidateStudentChoices_(studentRecords);
  subjects.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.name.localeCompare(b.name, 'ca') || a.id.localeCompare(b.id));
  if (!students.length || !subjects.length) throw new Error('Cal tenir alumnes a students_cache i assignatures desades a pendents_config.');
  return { students, subjects };
}

function studentChoiceKey_(student) {
  return student.key || student.id;
}

function consolidateStudentChoices_(records) {
  const byId = new Map();
  records.forEach(student => {
    if (!byId.has(student.id)) byId.set(student.id, []);
    byId.get(student.id).push(student);
  });
  const choices = [];
  byId.forEach(records => {
    const byNameGroup = new Map();
    records.forEach(student => {
      const key = JSON.stringify([studentNameKey_(student.name), studentGroupKey_(student.group)]);
      if (!byNameGroup.has(key)) byNameGroup.set(key, []);
      byNameGroup.get(key).push(student);
    });
    const names = new Set(records.map(student => studentNameKey_(student.name)));
    const emails = new Set(records.map(student => student.email.toLowerCase()).filter(Boolean));
    const needsReview = names.size > 1 || emails.size > 1;
    const variants = [];
    byNameGroup.forEach(groupRecords => {
      const groupEmails = new Map();
      groupRecords.forEach(student => {
        const email = student.email.toLowerCase();
        if (!groupEmails.has(email)) groupEmails.set(email, student);
      });
      // A blank email is missing information, not a conflict with one known email.
      if (groupEmails.size === 2 && groupEmails.has('')) groupEmails.delete('');
      groupEmails.forEach(student => variants.push(student));
    });
    variants.forEach(student => {
      const choice = Object.assign({}, student);
      choice.key = 'student:' + studentImportDigest_([student.id, studentNameKey_(student.name),
        student.email.toLowerCase(), studentGroupKey_(student.group)]);
      choice.needsReview = needsReview;
      choice.multipleEntries = variants.length > 1;
      choices.push(choice);
    });
  });
  return choices.sort((a, b) => a.name.localeCompare(b.name, 'ca') || a.group.localeCompare(b.group, 'ca')
    || a.email.localeCompare(b.email, 'ca') || a.id.localeCompare(b.id));
}

function validateStudentImportSource_(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_STUDENT_IMPORT_ROWS) {
    throw new Error('El fitxer ha de contenir entre 1 i 20.000 files.');
  }
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new Error('Fila d’importació incorrecta.');
    const record = { sourceRow: Number(row.sourceRow) || index + 2 };
    ['name', 'group', 'subject'].forEach(field => {
      if (typeof row[field] !== 'string' || row[field].length > 2000) throw new Error('Valor massa llarg o incorrecte a la fila ' + record.sourceRow + '.');
      record[field] = row[field].trim();
    });
    return record;
  });
}

function normalizeStudentImportText_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function studentNameKey_(value) {
  return normalizeStudentImportText_(value).split(' ').filter(Boolean).sort().join(' ');
}

function studentGroupKey_(value) {
  const normalized = normalizeStudentImportText_(value);
  const match = normalized.match(/([1-4])(?:r|n|t)?\s*(eso|bat)\s*([a-z0-9]+)$/);
  if (match) return match[1] + ' ' + match[2] + ' ' + match[3];
  const local = normalized.match(/^([1-4])(eso|bat)([a-z0-9]+)$/);
  return local ? local[1] + ' ' + local[2] + ' ' + local[3] : normalized;
}

function parsePendingSubject_(subject, group) {
  const normalized = normalizeStudentImportText_(subject);
  const match = normalized.match(/^(.*?)\s+([1-4])(?:r|n|t)?(?:\s+(eso|bat))?$/);
  if (!match) return { name: normalized, level: '' };
  const groupText = normalizeStudentImportText_(group);
  const stage = match[3] || (/\b(?:bat|batxillerat)\b/.test(groupText) ? 'bat' : /\beso\b/.test(groupText) ? 'eso' : '');
  const ordinal = { '1': '1r', '2': '2n', '3': '3r', '4': '4t' };
  const level = stage ? ordinal[match[2]] + ' ' + stage.toUpperCase() : '';
  return { name: match[1], level: LEVELS.includes(level) ? level : '', year: match[2], stage };
}

function buildStudentImportPreview_(sourceRows, students, subjects) {
  const names = new Map();
  students.forEach(student => {
    const key = studentNameKey_(student.name);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(student);
  });
  let skippedNoSubject = 0;
  let skippedIncomplete = 0;
  const rows = [];
  sourceRows.forEach(source => {
    if (['name', 'group', 'subject'].some(field => !String(source[field] || '').trim())) {
      skippedIncomplete += 1;
      if (!String(source.subject || '').trim()) skippedNoSubject += 1;
      return;
    }
    const nameKey = studentNameKey_(source.name);
    const sameName = nameKey ? names.get(nameKey) || [] : [];
    const sameGroup = sameName.filter(student => !source.group || studentGroupKey_(student.group) === studentGroupKey_(source.group));
    const student = sameGroup.length === 1 && !sameGroup[0].needsReview ? sameGroup[0] : null;
    const parsed = parsePendingSubject_(source.subject, source.group);
    // A missing year/stage must not silently pick one of several level-specific subjects.
    const subjectMatches = subjects.filter(subject => normalizeStudentImportText_(subject.name) === parsed.name
      && (!parsed.level || subject.level === parsed.level)
      && (!parsed.year || subject.level[0] === parsed.year)
      && (!parsed.stage || subject.level.endsWith(parsed.stage.toUpperCase())));
    const subject = subjectMatches.length === 1 ? subjectMatches[0] : null;
    rows.push({ sourceRow: source.sourceRow, sourceName: source.name, sourceGroup: source.group, sourceSubject: source.subject,
      studentId: student ? studentChoiceKey_(student) : '', subjectId: subject ? subject.id : '',
      studentIssue: student ? '' : sameName.some(candidate => candidate.needsReview)
        ? 'El mateix identificador té noms o correus diferents a students_cache. Selecciona l’entrada correcta.'
        : !sameName.length ? 'No s’ha trobat el nom' : !sameGroup.length ? 'No s’ha trobat l’alumne en aquest grup' : 'Més d’una entrada d’alumne possible',
      subjectIssue: subject ? '' : subjectMatches.length ? 'Matèria amb més d’un nivell possible' : 'No s’ha trobat la matèria i el nivell',
      studentSuggestions: sameName.map(student => studentChoiceKey_(student)), subjectSuggestions: subjectMatches.map(subject => subject.id),
      studentMatchKey: JSON.stringify([studentNameKey_(source.name), studentGroupKey_(source.group)]),
      subjectLevel: parsed.level,
      subjectContext: parsed.level || 'Nivell pendent no indicat · grup actual: ' + studentGroupKey_(source.group).split(' ').slice(0, 2).join(' ').toUpperCase(),
      subjectReviewKey: JSON.stringify([parsed.name, parsed.level, parsed.year || '', parsed.stage || '',
        parsed.level ? '' : studentGroupKey_(source.group).split(' ').slice(0, 2).join(' ')]),
      subjectMatchKey: JSON.stringify([parsed.name, parsed.level, parsed.year || '', parsed.stage || '']),
      studentCanPropagate: !!nameKey && !!source.group, subjectCanPropagate: !!parsed.level });
  });
  return { rows, skippedNoSubject, skippedIncomplete, totalSourceRows: sourceRows.length,
    issues: rows.filter(row => !row.studentId || !row.subjectId).length };
}

function mergeStudentPendingRows_(existing, pairs, students, subjects) {
  const studentsById = new Map(students.map(student => [studentChoiceKey_(student), student]));
  const subjectsById = new Map(subjects.map(subject => [subject.id, subject]));
  const result = existing.map(row => Object.assign({}, row));
  const byPair = new Map(result.map((row, index) => [JSON.stringify([row.student_id, row.subject_id]), index]));
  let nextId = existing.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
  let added = 0; let updated = 0; let duplicates = 0;
  const seen = new Map();
  pairs.forEach(pair => {
    if (!pair || typeof pair.studentId !== 'string' || typeof pair.subjectId !== 'string') throw new Error('Parelles d’importació incorrectes.');
    const student = studentsById.get(pair.studentId); const subject = subjectsById.get(pair.subjectId);
    if (!student || !subject) throw new Error('Selecciona un alumne i una matèria vàlids per a cada fila.');
    const key = JSON.stringify([student.id, subject.id]);
    if (seen.has(key)) {
      if (seen.get(key) !== studentChoiceKey_(student)) {
        throw new Error('La mateixa parella alumne-matèria té entrades d’alumne diferents. Selecciona la mateixa entrada o omet la fila duplicada.');
      }
      duplicates += 1; return;
    }
    seen.set(key, studentChoiceKey_(student));
    const index = byPair.get(key);
    const row = { id: index === undefined ? String(nextId++) : result[index].id,
      student_id: student.id, student_name: student.name, student_email: student.email, student_group: student.group,
      subject_id: subject.id, subject_name: subject.name };
    if (index === undefined) { byPair.set(key, result.length); result.push(row); added += 1; }
    else { result[index] = row; updated += 1; }
  });
  result.sort((a, b) => a.student_name.localeCompare(b.student_name, 'ca') || a.student_group.localeCompare(b.student_group, 'ca')
    || a.subject_name.localeCompare(b.subject_name, 'ca') || a.subject_id.localeCompare(b.subject_id));
  return { rows: result, added, updated, duplicates };
}
