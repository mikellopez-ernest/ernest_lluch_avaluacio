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
  getRequiredSheet_(openLogicalTableSpreadsheet_(GRADES_TABLE_NAME), 'avaluacions')
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
  const sortedCacheRows = sortCacheRowsForDisplay_(cacheRows);
  const groupNames = uniqueInOrder_(cacheRows.reduce((groups, row) => (
    groups.concat(splitGroupCodes_(row.group))
  ), []));
  const subjects = uniqueSorted_(cacheRows.map(row => row.subjectFullName));
  const teachers = uniqueSorted_(cacheRows.map(row => row.teacherFullName));
  const dinantiaGroups = uniqueSorted_(fetchDinantiaGroups_().map(group => group.name));

  return {
    title: 'Configuració',
    groups: groupNames,
    rowsByGroup: groupRowsByGroupCode_(sortedCacheRows),
    options: {
      subjects,
      teachers,
      dinantiaGroups
    }
  };
}

function saveSubjectsCacheEdits(payload) {
  assertAllowedUser_();

  const selectedGroupCode = String(payload && payload.groupName || '').trim();
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const deletedRowIds = new Set((Array.isArray(payload && payload.deletedRowIds) ? payload.deletedRowIds : [])
    .map(id => String(id || '').trim())
    .filter(Boolean));

  if (!selectedGroupCode) {
    throw new Error('Falta el grup.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const existingRows = readSubjectsCacheRows_();
    const groupName = getGroupNameForGroupCode_(selectedGroupCode);
    const rowsById = new Map(existingRows
      .filter(row => !deletedRowIds.has(String(row.id)))
      .map(row => [String(row.id), row]));
    const newRows = [];
    let selectedMateriaClauRow = null;

    rows.forEach(row => {
      const id = String(row.id || '').trim();
      const existingRow = id && rowsById.has(id) ? rowsById.get(id) : null;
      const teacherInfo = findTeacherInfoByName_(row.teacherFullName);
      const updatedRow = {
        id: Number(id) || '',
        group: String(row.group || existingRow && existingRow.group || selectedGroupCode).trim(),
        groupName: String(row.groupName || existingRow && existingRow.groupName || groupName).trim(),
        profReduit: teacherInfo.code,
        teacherFullName: String(row.teacherFullName || '').trim(),
        teacherEmail: teacherInfo.email,
        matReduit: findSubjectCodeByName_(row.subjectFullName),
        subjectFullName: String(row.subjectFullName || '').trim(),
        subjectDinantiaGroupAv: String(row.subjectDinantiaGroupAv || '').trim(),
        materiaClau: parseBoolean_(row.materiaClau),
        order: sanitizeOrder_(row.order)
      };

      if (!updatedRow.subjectFullName && !updatedRow.teacherFullName && !updatedRow.subjectDinantiaGroupAv) {
        return;
      }

      if (updatedRow.materiaClau === true && splitGroupCodes_(updatedRow.group)
        .some(groupCode => normalizeCode_(groupCode) === normalizeCode_(selectedGroupCode))) {
        selectedMateriaClauRow = updatedRow;
      }

      if (id && rowsById.has(id)) {
        rowsById.set(id, updatedRow);
      } else {
        newRows.push(updatedRow);
      }
    });

    const updatedRows = Array.from(rowsById.values()).concat(newRows);
    enforceMateriaClauForGroup_(updatedRows, selectedGroupCode, selectedMateriaClauRow);
    writeSubjectsCacheRows_(normalizeMateriaClauByGroup_(updatedRows));

    return getConfigurationData();
  } finally {
    lock.releaseLock();
  }
}

function getEvaluationCreationStatus(runId) {
  assertAllowedUser_();

  return readEvaluationProgress_(runId);
}

function createEvaluation(payload) {
  assertAllowedUser_();

  const runId = String(payload && payload.runId || Utilities.getUuid()).trim();
  const evaluationName = String(payload && payload.evaluationName || '').trim();
  const selectedGroups = sanitizeOrderedList_(payload && payload.selectedGroups);
  const subjectItems = sanitizeSubjectEvaluationItems_(payload && payload.subjectValues);
  const subjectValues = subjectItems.map(item => item.value);
  const concepts = sanitizeConcepts_(payload && payload.concepts);
  const logPrefix = `createEvaluation:${runId}`;
  const lock = LockService.getScriptLock();
  let lockAcquired = false;

  Logger.log('%s start name="%s" selectedGroups=%s subjectValues=%s concepts=%s', logPrefix, evaluationName, selectedGroups.length, subjectValues.length, concepts.length);
  updateEvaluationProgress_(runId, 'running', "S'ha iniciat la creació de l'avaluació.", {
    stage: 'start',
    evaluationName,
    selectedGroups: selectedGroups.length,
    subjectValues: subjectValues.length,
    concepts: concepts.length
  });

  try {
    if (!evaluationName) {
      Logger.log('%s failed missing evaluation name', logPrefix);
      throw new Error("Falta el nom de l'avaluació.");
    }

    if (!subjectValues.length) {
      Logger.log('%s failed missing subject values', logPrefix);
      throw new Error('Cal afegir com a mínim un valor per avaluar les matèries.');
    }

    if (!selectedGroups.length) {
      Logger.log('%s failed missing selected groups', logPrefix);
      throw new Error('Cal seleccionar com a mínim un grup a avaluar.');
    }

    Logger.log('%s waiting for lock', logPrefix);
    updateEvaluationProgress_(runId, 'running', "Esperant el bloqueig d'escriptura...", { stage: 'lock_wait' });
    lock.waitLock(30000);
    lockAcquired = true;
    Logger.log('%s lock acquired', logPrefix);
    updateEvaluationProgress_(runId, 'running', "Bloqueig adquirit. Preparant els fulls...", { stage: 'lock_acquired' });

    const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
    const sheetName = normalizeSheetName_(evaluationName);
    const configSheetName = `${sheetName}_config`;
    const tutoriaSheetName = `${sheetName}_tutoria`;

    Logger.log('%s normalized sheetName="%s" configSheetName="%s" tutoriaSheetName="%s"', logPrefix, sheetName, configSheetName, tutoriaSheetName);
    updateEvaluationProgress_(runId, 'running', `Creant els fulls ${sheetName}, ${configSheetName} i ${tutoriaSheetName}...`, {
      stage: 'normalized_names',
      sheetName,
      configSheetName,
      tutoriaSheetName
    });

    if (gradesSpreadsheet.getSheetByName(sheetName)) {
      Logger.log('%s failed sheet already exists "%s"', logPrefix, sheetName);
      throw new Error(`Ja existeix el full: ${sheetName}`);
    }

    if (gradesSpreadsheet.getSheetByName(configSheetName)) {
      Logger.log('%s failed config sheet already exists "%s"', logPrefix, configSheetName);
      throw new Error(`Ja existeix el full: ${configSheetName}`);
    }

    if (gradesSpreadsheet.getSheetByName(tutoriaSheetName)) {
      Logger.log('%s failed tutoria sheet already exists "%s"', logPrefix, tutoriaSheetName);
      throw new Error(`Ja existeix el full: ${tutoriaSheetName}`);
    }

    Logger.log('%s inserting sheets', logPrefix);
    const mainSheet = gradesSpreadsheet.insertSheet(sheetName);
    const configSheet = gradesSpreadsheet.insertSheet(configSheetName);
    const tutoriaSheet = gradesSpreadsheet.insertSheet(tutoriaSheetName);

    Logger.log('%s registering evaluation', logPrefix);
    updateEvaluationProgress_(runId, 'running', "Registrant l'avaluació...", { stage: 'registering' });
    registerEvaluation_(gradesSpreadsheet, evaluationName, sheetName);
    Logger.log('%s writing config', logPrefix);
    updateEvaluationProgress_(runId, 'running', 'Escrivint la configuració...', { stage: 'writing_config' });
    writeEvaluationConfig_(configSheet, subjectItems, concepts);
    Logger.log('%s populating main and tutoria sheets', logPrefix);
    updateEvaluationProgress_(runId, 'running', 'Llegint alumnes de Dinantia i generant files...', { stage: 'populating_main' });
    const result = populateEvaluationSheets_(mainSheet, tutoriaSheet, subjectValues, concepts, logPrefix, runId, selectedGroups);
    Logger.log('%s completed rowsWritten=%s tutoriaRowsWritten=%s', logPrefix, result.mainRowsWritten, result.tutoriaRowsWritten);
    updateEvaluationProgress_(runId, 'complete', `Avaluació creada: ${sheetName} (${result.mainRowsWritten} files, ${result.tutoriaRowsWritten} tutoria).`, {
      stage: 'complete',
      sheetName,
      configSheetName,
      tutoriaSheetName,
      rowsWritten: result.mainRowsWritten,
      tutoriaRowsWritten: result.tutoriaRowsWritten
    });

    return {
      runId,
      evaluationName,
      sheetName,
      configSheetName,
      tutoriaSheetName,
      rowsWritten: result.mainRowsWritten,
      tutoriaRowsWritten: result.tutoriaRowsWritten,
      status: 'evaluation created.'
    };
  } catch (error) {
    updateEvaluationProgress_(runId, 'error', error.message || String(error), { stage: 'error' });
    throw error;
  } finally {
    Logger.log('%s releasing lock', logPrefix);
    if (lockAcquired) {
      lock.releaseLock();
    }
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
    const teacherInfoByCode = buildTeacherInfoByCode_(teacherRows);
    const subjectNamesByCode = buildSubjectNamesByCode_(subjectRows);
    const cleanedRows = dedupeGpu001RowsByTeacherGroupSubject_(
      filterGpu001RowsByDominantTeacherForGroupSubject_(gpu001Rows)
    );
    const eventRows = buildGpu001EventRowsFromCleanRows_(cleanedRows);

    const cacheRows = eventRows.map(row => {
      const groupName = resolveGroupNamesForCodes_(row.groups, groupNamesByUntisName);
      const teacherInfo = teacherInfoByCode.get(normalizeCode_(row.profReduit)) || {};
      const teacherFullName = teacherInfo.fullName || '';
      const teacherEmail = teacherInfo.email || '';
      const subjectFullName = subjectNamesByCode.get(normalizeCode_(row.matReduit)) || '';

      return {
        group: row.group,
        groupName,
        profReduit: row.profReduit,
        teacherFullName,
        teacherEmail,
        matReduit: row.matReduit,
        subjectFullName,
        subjectDinantiaGroupAv: groupName,
        materiaClau: normalizeCode_(subjectFullName || row.matReduit) === 'TUTORIA',
        order: normalizeCode_(subjectFullName || row.matReduit) === 'TUTORIA' ? 0 : ''
      };
    }).filter(row => row.groupName);

    writeSubjectsCacheRows_(cacheRows);

    return {
      rowsRead: gpu001Rows.length,
      rowsAfterGroupSubjectCleanup: cleanedRows.length,
      eventRowsWritten: eventRows.length,
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
    teacherEmail: String(getField_(row, 'teacher_email') || '').trim(),
    matReduit: String(getField_(row, 'mat_reduit') || '').trim(),
    subjectFullName: String(getField_(row, 'subject_full_name') || '').trim(),
    subjectDinantiaGroupAv: String(getField_(row, 'subject_dinantia_group_av') || '').trim(),
    materiaClau: parseBoolean_(getField_(row, 'materia_clau')),
    order: sanitizeOrder_(getField_(row, 'order'))
  })).filter(row => row.groupName);
}

function writeSubjectsCacheRows_(rows) {
  const cacheHeaders = [
    'id',
    'group',
    'group_name',
    'prof_reduit',
    'teacher_full_name',
    'teacher_email',
    'mat_reduit',
    'subject_full_name',
    'subject_dinantia_group_av',
    'materia_clau',
    'order'
  ];

  const normalizedRows = normalizeMateriaClauByGroup_(rows);
  const sortedRows = normalizedRows
    .filter(row => String(row.groupName || '').trim())
    .sort((a, b) => (
      a.groupName.localeCompare(b.groupName, 'ca') ||
      a.group.localeCompare(b.group, 'ca') ||
      compareOrder_(a.order, b.order) ||
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
    row.teacherEmail || '',
    row.matReduit,
    row.subjectFullName,
    row.subjectDinantiaGroupAv,
    row.materiaClau === true,
    sanitizeOrder_(row.order)
  ]);

  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const cacheSheet = getOrCreateSheet_(gradesSpreadsheet, CACHE_SHEET_NAME);

  cacheSheet.clearContents();
  cacheSheet.getRange(1, 1, 1, cacheHeaders.length).setValues([cacheHeaders]);

  if (cacheValues.length > 0) {
    cacheSheet.getRange(2, 1, cacheValues.length, cacheHeaders.length).setValues(cacheValues);
    const checkboxRule = SpreadsheetApp.newDataValidation()
      .requireCheckbox()
      .build();
    cacheSheet.getRange(2, 10, cacheValues.length, 1).setDataValidation(checkboxRule);
  }

  cacheSheet.autoResizeColumns(1, cacheHeaders.length);
}

function groupRowsByGroupCode_(rows) {
  return rows.reduce((groups, row) => {
    splitGroupCodes_(row.group).forEach(groupCode => {
      if (!groups[groupCode]) groups[groupCode] = [];

      groups[groupCode].push({
        id: row.id,
        group: row.group,
        groupName: row.groupName,
        subjectFullName: row.subjectFullName,
        teacherFullName: row.teacherFullName,
        subjectDinantiaGroupAv: row.subjectDinantiaGroupAv,
        materiaClau: row.materiaClau === true,
        order: sanitizeOrder_(row.order)
      });
    });

    return groups;
  }, {});
}

function enforceMateriaClauForGroup_(rows, selectedGroupCode, selectedRow) {
  if (!selectedRow) return;

  const selectedGroup = normalizeCode_(selectedGroupCode);
  rows.forEach(row => {
    if (!splitGroupCodes_(row.group).some(groupCode => normalizeCode_(groupCode) === selectedGroup)) return;

    row.materiaClau = row === selectedRow;
  });
}

function normalizeMateriaClauByGroup_(rows) {
  const chosenRowByGroup = new Map();

  rows.forEach(row => {
    if (row.materiaClau !== true) return;

    splitGroupCodes_(row.group).forEach(groupCode => {
      const key = normalizeCode_(groupCode);
      if (key && !chosenRowByGroup.has(key)) {
        chosenRowByGroup.set(key, row);
      }
    });
  });

  rows.forEach(row => {
    const groupCodes = splitGroupCodes_(row.group).map(normalizeCode_).filter(Boolean);
    row.materiaClau = groupCodes.some(groupCode => chosenRowByGroup.get(groupCode) === row);
  });

  return rows;
}

function sortCacheRowsForDisplay_(rows) {
  return (rows || []).slice().sort((a, b) => (
    compareOrder_(a.order, b.order) ||
    String(a.subjectFullName || '').localeCompare(String(b.subjectFullName || ''), 'ca') ||
    String(a.teacherFullName || '').localeCompare(String(b.teacherFullName || ''), 'ca') ||
    String(a.subjectDinantiaGroupAv || '').localeCompare(String(b.subjectDinantiaGroupAv || ''), 'ca')
  ));
}

function sortCacheRowsForEvaluation_(rows) {
  return (rows || []).slice().sort((a, b) => (
    String(a.groupName || '').localeCompare(String(b.groupName || ''), 'ca') ||
    compareOrder_(a.order, b.order) ||
    String(a.subjectFullName || '').localeCompare(String(b.subjectFullName || ''), 'ca') ||
    String(a.teacherFullName || '').localeCompare(String(b.teacherFullName || ''), 'ca')
  ));
}

function compareOrder_(a, b) {
  const orderA = sanitizeOrder_(a);
  const orderB = sanitizeOrder_(b);
  const hasOrderA = orderA !== '';
  const hasOrderB = orderB !== '';

  if (hasOrderA && hasOrderB && orderA !== orderB) return orderA - orderB;
  if (hasOrderA && !hasOrderB) return -1;
  if (!hasOrderA && hasOrderB) return 1;
  return 0;
}

function sanitizeOrder_(value) {
  if (value === '' || value === null || value === undefined) return '';

  const number = Number(value);
  return Number.isFinite(number) ? number : '';
}

function parseBoolean_(value) {
  if (value === true) return true;

  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'TRUE' || normalized === 'VERDADERO' || normalized === 'CERT' || normalized === '1';
}

function updateEvaluationProgress_(runId, status, message, details) {
  const cleanRunId = String(runId || '').trim();
  if (!cleanRunId) return;

  const payload = {
    runId: cleanRunId,
    status,
    message,
    details: details || {},
    updatedAt: Utilities.formatDate(new Date(), 'Europe/Madrid', "yyyy-MM-dd'T'HH:mm:ss")
  };
  const key = evaluationProgressKey_(cleanRunId);
  const json = JSON.stringify(payload);

  CacheService.getScriptCache().put(key, json, 21600);
  PropertiesService.getScriptProperties().setProperty(key, json);
}

function readEvaluationProgress_(runId) {
  const cleanRunId = String(runId || '').trim();
  if (!cleanRunId) {
    throw new Error("Falta l'identificador del procés.");
  }

  const key = evaluationProgressKey_(cleanRunId);
  const json = CacheService.getScriptCache().get(key) ||
    PropertiesService.getScriptProperties().getProperty(key);

  if (!json) {
    return {
      runId: cleanRunId,
      status: 'unknown',
      message: "No s'ha trobat informació del procés.",
      details: {},
      updatedAt: ''
    };
  }

  return JSON.parse(json);
}

function evaluationProgressKey_(runId) {
  return `evaluation_progress_${runId}`;
}

function registerEvaluation_(gradesSpreadsheet, evaluationName, sheetName) {
  const sheet = getRequiredSheet_(gradesSpreadsheet, 'avaluacions');
  ensureEvaluationRegistryHeaders_(sheet);
  const rows = readRowsByHeader_(sheet);
  const nextId = rows.reduce((max, row) => {
    const id = Number(getField_(row, 'id'));
    return Number.isFinite(id) && id > max ? id : max;
  }, 0) + 1;

  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, 4).setValues([[nextId, evaluationName, sheetName, 'Creada']]);
  applyEvaluationStatusValidation_(sheet, nextRow);
}

function ensureEvaluationRegistryHeaders_(sheet) {
  const headers = ['id', 'nom_av', 'sheet_name', 'Estat'];
  const currentHeaders = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    .map(value => String(value || '').trim());

  headers.forEach((header, index) => {
    if (currentHeaders[index] !== header) {
      sheet.getRange(1, index + 1).setValue(header);
    }
  });
}

function applyEvaluationStatusValidation_(sheet, rowNumber) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Creada', 'Avaluació professors', 'Mode junta', 'Tancada'], true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(rowNumber, 4).setDataValidation(rule);
}

function writeEvaluationConfig_(sheet, subjectItems, concepts) {
  const creationDate = Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyyMMdd:HHmm');
  const headers = ['data de creació', 'Avaluació de les matèries', 'avaluacio_reduit', 'Color'].concat(
    concepts.map(concept => concept.name)
  );
  const maxRows = Math.max(
    1,
    subjectItems.length,
    ...concepts.map(concept => concept.options.length)
  );
  const values = [headers];

  for (let index = 0; index < maxRows; index += 1) {
    values.push([
      index === 0 ? creationDate : '',
      subjectItems[index] ? subjectItems[index].value : '',
      subjectItems[index] ? subjectItems[index].reduit : '',
      subjectItems[index] ? subjectItems[index].color : '',
      ...concepts.map(concept => concept.options[index] || '')
    ]);
  }

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  formatEvaluationConfigSheet_(sheet, headers.length);
}

function populateEvaluationSheets_(mainSheet, tutoriaSheet, subjectValues, concepts, logPrefix, runId, selectedGroups) {
  const selectedGroupSet = new Set((selectedGroups || []).map(group => normalizeCode_(group)));
  const cacheRows = readSubjectsCacheRows_()
    .filter(row => splitGroupCodes_(row.group).some(groupCode => selectedGroupSet.has(normalizeCode_(groupCode))));
  const groupAliasMap = buildDinantiaGroupAliasMap_();
  const groupIds = uniqueSorted_(cacheRows.reduce((ids, row) => (
    ids.concat(resolveDinantiaGroupIds_(row.subjectDinantiaGroupAv, groupAliasMap))
  ), []));
  Logger.log('%s populate cacheRows=%s uniqueDinantiaGroups=%s sampleGroups=%s', logPrefix, cacheRows.length, groupIds.length, groupIds.slice(0, 10).join(','));
  updateEvaluationProgress_(runId, 'running', `S'han trobat ${cacheRows.length} configuracions i ${groupIds.length} grups de Dinantia.`, {
    stage: 'cache_loaded',
    cacheRows: cacheRows.length,
    dinantiaGroups: groupIds.length
  });
  const studentsByGroupId = fetchStudentsByGroupIds_(groupIds, logPrefix, runId);
  const mainHeaders = [
    'group',
    'group_name',
    'teacher_full_name',
    'teacher_email',
    'subject_full_name',
    'student_full_name',
    'grup_tutoria',
    'PI',
    'Avaluació de la matèria'
  ].concat(concepts.map(concept => concept.name), ['student_account_id', 'subject_order']);
  const tutoriaHeaders = [
    'group',
    'group_name',
    'teacher_full_name',
    'teacher_email',
    'subject_full_name',
    'student_full_name',
    'grup_tutoria',
    'student_account_id',
    'subject_order',
    'Comentari_tutor',
    'Butlletí_url'
  ];
  const mainRows = [];
  const tutoriaRows = [];

  sortCacheRowsForEvaluation_(cacheRows).forEach(cacheRow => {
    const resolvedGroupIds = resolveDinantiaGroupIds_(cacheRow.subjectDinantiaGroupAv, groupAliasMap);
    const students = uniqueStudents_(resolvedGroupIds.reduce((allStudents, groupId) => (
      allStudents.concat(studentsByGroupId.get(groupId) || [])
    ), []));

    students.forEach(student => {
      if (cacheRow.materiaClau === true) {
        tutoriaRows.push([
          cacheRow.group,
          cacheRow.groupName,
          cacheRow.teacherFullName,
          cacheRow.teacherEmail,
          cacheRow.subjectFullName,
          student.name,
          '',
          student.id,
          sanitizeOrder_(cacheRow.order),
          '',
          ''
        ]);
        return;
      }

      mainRows.push([
        cacheRow.group,
        cacheRow.groupName,
        cacheRow.teacherFullName,
        cacheRow.teacherEmail,
        cacheRow.subjectFullName,
        student.name,
        '',
        false,
        '',
        ...concepts.map(() => ''),
        student.id,
        sanitizeOrder_(cacheRow.order)
      ]);
    });
  });

  fillTutoriaGroupsFromTutoriaRows_(mainRows, mainHeaders, tutoriaRows, tutoriaHeaders);
  fillTutoriaGroupsFromTutoriaRows_(tutoriaRows, tutoriaHeaders, tutoriaRows, tutoriaHeaders);
  const mainValues = [mainHeaders].concat(mainRows);
  const tutoriaValues = [tutoriaHeaders].concat(tutoriaRows);

  Logger.log('%s populate generatedRows=%s tutoriaRows=%s', logPrefix, mainRows.length, tutoriaRows.length);
  updateEvaluationProgress_(runId, 'running', `Escrivint ${mainRows.length} files al full principal i ${tutoriaRows.length} files de tutoria...`, {
    stage: 'writing_main',
    generatedRows: mainRows.length,
    tutoriaRows: tutoriaRows.length
  });

  mainSheet.clearContents();
  mainSheet.getRange(1, 1, mainValues.length, mainHeaders.length).setValues(mainValues);
  formatEvaluationMainSheet_(mainSheet, mainHeaders.length, mainValues.length);

  if (mainValues.length > 1) {
    applyEvaluationValidations_(mainSheet, mainValues.length - 1, subjectValues, concepts);
  }

  tutoriaSheet.clearContents();
  tutoriaSheet.getRange(1, 1, tutoriaValues.length, tutoriaHeaders.length).setValues(tutoriaValues);
  formatTutoriaSheet_(tutoriaSheet, tutoriaHeaders.length, tutoriaValues.length);

  return {
    mainRowsWritten: mainRows.length,
    tutoriaRowsWritten: tutoriaRows.length
  };
}

function formatEvaluationConfigSheet_(sheet, columnCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight('bold')
    .setBackground('#e8f0fe')
    .setFontColor('#202124');
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), columnCount)
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.autoResizeColumns(1, columnCount);
}

function formatEvaluationMainSheet_(sheet, columnCount, rowCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight('bold')
    .setBackground('#e8f0fe')
    .setFontColor('#202124');
  sheet.getRange(1, 1, rowCount, columnCount)
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.autoResizeColumns(1, columnCount);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(6, 220);
  sheet.setColumnWidth(7, 150);
  sheet.setColumnWidth(8, 80);
  sheet.setColumnWidth(9, 190);
  if (columnCount >= 2) {
    sheet.hideColumns(columnCount - 1, 2);
  }
}

function formatTutoriaSheet_(sheet, columnCount, rowCount) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight('bold')
    .setBackground('#e8f0fe')
    .setFontColor('#202124');
  sheet.getRange(1, 1, rowCount, columnCount)
    .setVerticalAlignment('middle')
    .setWrap(true);
  sheet.autoResizeColumns(1, columnCount);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 220);
  sheet.setColumnWidth(6, 220);
  sheet.setColumnWidth(7, 150);
  sheet.setColumnWidth(8, 150);
  sheet.setColumnWidth(9, 90);
  sheet.setColumnWidth(10, 260);
  sheet.setColumnWidth(11, 260);
  if (columnCount >= 9) {
    sheet.hideColumns(9);
  }
}

function applyEvaluationValidations_(sheet, dataRowCount, subjectValues, concepts) {
  const checkboxRule = SpreadsheetApp.newDataValidation()
    .requireCheckbox()
    .build();
  const subjectRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(subjectValues, true)
    .setAllowInvalid(false)
    .build();

  sheet.getRange(2, 8, dataRowCount, 1).setDataValidation(checkboxRule);
  sheet.getRange(2, 9, dataRowCount, 1).setDataValidation(subjectRule);

  concepts.forEach((concept, index) => {
    if (!concept.options.length) return;

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(concept.options, true)
      .setAllowInvalid(false)
      .build();

    sheet.getRange(2, 10 + index, dataRowCount, 1).setDataValidation(rule);
  });
}

function fillTutoriaGroupsFromTutoriaRows_(rows, headers, tutoriaRows, tutoriaHeaders) {
  const indexes = {
    studentId: headers.indexOf('student_account_id'),
    grupTutoria: headers.indexOf('grup_tutoria')
  };
  const tutoriaIndexes = {
    studentId: tutoriaHeaders.indexOf('student_account_id'),
    groupName: tutoriaHeaders.indexOf('group_name')
  };
  const tutoriaByStudentId = new Map();

  tutoriaRows.forEach(row => {
    const studentId = String(row[tutoriaIndexes.studentId] || '').trim();
    if (!studentId || tutoriaByStudentId.has(studentId)) return;

    const tutoriaGroup = String(row[tutoriaIndexes.groupName] || '').trim();
    if (tutoriaGroup) {
      tutoriaByStudentId.set(studentId, tutoriaGroup);
    }
  });

  rows.forEach(row => {
    const studentId = String(row[indexes.studentId] || '').trim();
    row[indexes.grupTutoria] = tutoriaByStudentId.get(studentId) || '';
  });
}

function fetchStudentsByGroupIds_(groupIds, logPrefix, runId) {
  const wantedIds = new Set(groupIds.map(id => String(id || '').trim()).filter(Boolean));
  const studentsByGroupId = new Map(Array.from(wantedIds).map(id => [id, []]));

  if (!wantedIds.size) {
    Logger.log('%s students no group ids found in subjects_cache', logPrefix);
    return studentsByGroupId;
  }

  const accounts = fetchDinantiaCollection_('/v1/accounts/index');
  Logger.log('%s students all accounts count=%s', logPrefix, accounts.length);
  updateEvaluationProgress_(runId, 'running', `S'han llegit ${accounts.length} comptes de Dinantia.`, {
    stage: 'dinantia_accounts_loaded',
    accounts: accounts.length
  });

  accounts.forEach(account => {
    if (!isStudentAccount_(account)) return;

    const student = {
      id: account.id,
      name: String(account.name || '').trim()
    };

    if (!student.name) return;

    extractAccountGroupIds_(account).map(normalizeDinantiaGroupId_).forEach(groupId => {
      if (!wantedIds.has(groupId)) return;

      studentsByGroupId.get(groupId).push(student);
    });
  });

  sortStudentsByGroup_(studentsByGroupId);
  const matchedGroups = Array.from(studentsByGroupId.values()).filter(students => students.length).length;
  const indexedRows = Array.from(studentsByGroupId.values()).reduce((sum, students) => sum + students.length, 0);
  Logger.log('%s students matched groups=%s rows=%s', logPrefix, matchedGroups, indexedRows);
  updateEvaluationProgress_(runId, 'running', `Alumnes indexats: ${indexedRows} en ${matchedGroups} grups.`, {
    stage: 'student_index_built',
    matchedGroups,
    indexedRows
  });

  return studentsByGroupId;
}

function sortStudentsByGroup_(studentsByGroupId) {
  Array.from(studentsByGroupId.keys()).forEach(groupId => {
    studentsByGroupId.set(groupId, studentsByGroupId.get(groupId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ca')));
  });
}

function extractStudentsFromGroupPayload_(payload) {
  const studentsById = new Map();

  collectStudentAccounts_(payload, '', studentsById);

  return Array.from(studentsById.values());
}

function collectStudentAccounts_(value, contextKey, studentsById) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach(item => collectStudentAccounts_(item, contextKey, studentsById));
    return;
  }

  if (typeof value !== 'object') return;

  const id = String(value.id || value.account_id || '').trim();
  const name = String(value.name || value.full_name || '').trim();
  const key = String(contextKey || '').toLowerCase();
  const isStudentContext = key.indexOf('student') !== -1 || key.indexOf('member') !== -1 || key.indexOf('account') !== -1;

  if (id && name && (isStudentContext || isStudentAccount_(value))) {
    studentsById.set(id, { id, name });
  }

  Object.keys(value).forEach(childKey => {
    collectStudentAccounts_(value[childKey], childKey, studentsById);
  });
}

function isStudentAccount_(account) {
  const roles = Array.isArray(account.roles) ? account.roles : [account.roles];
  return roles.some(role => normalizeCode_(role && (role.name || role.id || role)) === 'STUDENT');
}

function extractAccountGroupIds_(account) {
  const ids = new Set();

  collectGroupIds_(account.groups, ids);

  return Array.from(ids);
}

function collectGroupIds_(value, ids) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach(item => collectGroupIds_(item, ids));
    return;
  }

  if (typeof value === 'string') {
    const id = value.trim();
    if (id) ids.add(id);
    return;
  }

  if (typeof value === 'object') {
    if (value.id) ids.add(String(value.id).trim());
    if (value.group_id) ids.add(String(value.group_id).trim());
    if (value.group && typeof value.group === 'object') collectGroupIds_(value.group, ids);

    Object.keys(value).forEach(key => {
      if (/^\d+$/.test(key)) ids.add(key);
      collectGroupIds_(value[key], ids);
    });
  }
}

function sanitizeList_(values) {
  return Array.isArray(values)
    ? uniqueSorted_(values.map(value => String(value || '').trim()))
    : [];
}

function sanitizeSubjectEvaluationItems_(values) {
  const items = Array.isArray(values) ? values : [];
  const seen = new Set();
  const sanitized = [];

  items.forEach(item => {
    const value = String(item && typeof item === 'object' ? item.value : item || '').trim();
    const key = normalizeCode_(value);
    if (!value || seen.has(key)) return;

    seen.add(key);
    sanitized.push({
      value,
      reduit: String(item && typeof item === 'object' ? item.reduit : '').trim(),
      color: sanitizeHexColor_(item && typeof item === 'object' ? item.color : '')
    });
  });

  return sanitized.sort((a, b) => a.value.localeCompare(b.value, 'ca'));
}

function sanitizeHexColor_(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : '#FFFFFF';
}

function sanitizeOrderedList_(values) {
  const seen = new Set();
  const result = [];

  if (!Array.isArray(values)) return result;

  values.forEach(value => {
    const cleanValue = String(value || '').trim();
    const key = normalizeCode_(cleanValue);
    if (!cleanValue || seen.has(key)) return;

    seen.add(key);
    result.push(cleanValue);
  });

  return result;
}

function sanitizeConcepts_(concepts) {
  if (!Array.isArray(concepts)) return [];

  return concepts
    .map(concept => ({
      name: String(concept && concept.name || '').trim(),
      options: sanitizeOrderedList_(concept && concept.options)
    }))
    .filter(concept => concept.name);
}

function normalizeSheetName_(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    throw new Error("El nom de l'avaluació no genera un nom de full vàlid.");
  }

  return normalized.slice(0, 80);
}

function fetchDinantiaGroups_() {
  const groups = fetchDinantiaCollection_('/v1/groups/index');

  return groups
    .map(group => ({
      id: group.id,
      name: String(group.id || '').trim(),
      rawName: group.name,
      tag: group.tag
    }))
    .filter(group => group.name);
}

function buildDinantiaGroupAliasMap_() {
  const aliases = new Map();

  fetchDinantiaGroups_().forEach(group => {
    const id = normalizeDinantiaGroupId_(group.id);
    if (!id) return;

    [
      group.id,
      group.name,
      group.rawName,
      group.tag
    ].forEach(alias => {
      const key = normalizeGroupAlias_(alias);
      if (key) aliases.set(key, id);
    });
  });

  return aliases;
}

function resolveDinantiaGroupId_(value, groupAliasMap) {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return '';

  return groupAliasMap.get(normalizeGroupAlias_(cleanValue)) || normalizeDinantiaGroupId_(cleanValue);
}

function resolveDinantiaGroupIds_(value, groupAliasMap) {
  return uniqueSorted_(String(value || '')
    .split(',')
    .map(part => resolveDinantiaGroupId_(part, groupAliasMap))
    .filter(Boolean));
}

function uniqueStudents_(students) {
  const studentsById = new Map();

  students.forEach(student => {
    const id = String(student && student.id || '').trim();
    if (!id || studentsById.has(id)) return;

    studentsById.set(id, student);
  });

  return Array.from(studentsById.values())
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ca'));
}

function normalizeDinantiaGroupId_(value) {
  return String(value || '').trim();
}

function normalizeGroupAlias_(value) {
  return normalizeCode_(String(value || '').trim());
}

function fetchDinantiaCollection_(path, baseParams) {
  const allRecords = [];
  let page = 1;

  while (true) {
    const response = fetchDinantia_(path, Object.assign({}, baseParams || {}, {
      limit: 100,
      page
    }));

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
  return findTeacherInfoByName_(teacherFullName).code;
}

function findTeacherInfoByName_(teacherFullName) {
  const target = normalizeCode_(teacherFullName);
  if (!target) return { code: '', email: '' };

  const teacherRows = readRowsByHeader_(
    getRequiredSheet_(openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME), TEACHERS_SHEET_NAME)
  );

  const match = teacherRows.find(row => normalizeCode_(buildTeacherFullName_(row)) === target);
  return match ? {
    code: String(getField_(match, 'REDUIT', 'REDUÏT') || '').trim(),
    email: getTeacherEmail_(match)
  } : { code: '', email: '' };
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

function buildGpu001EventRowsFromCleanRows_(rows) {
  const rowsByEvent = new Map();

  rows.forEach((row, index) => {
    const eventKey = normalizeEventCode_(row.sourceId) || `__ROW_${index}`;
    if (!rowsByEvent.has(eventKey)) {
      rowsByEvent.set(eventKey, []);
    }

    rowsByEvent.get(eventKey).push(row);
  });

  const eventRows = [];

  rowsByEvent.forEach(eventRowsRaw => {
    const groupedRows = new Map();

    eventRowsRaw.forEach(row => {
      const key = [
        normalizeCode_(row.profReduit),
        normalizeCode_(row.matReduit)
      ].join('||');

      if (!groupedRows.has(key)) {
        groupedRows.set(key, {
          sourceId: row.sourceId,
          groups: [],
          profReduit: row.profReduit,
          matReduit: row.matReduit,
          classroomName: row.classroomName,
          weekday: row.weekday,
          scheduleHour: row.scheduleHour
        });
      }

      const groupedRow = groupedRows.get(key);
      if (!groupedRow.groups.some(group => normalizeCode_(group) === normalizeCode_(row.group))) {
        groupedRow.groups.push(row.group);
      }
    });

    groupedRows.forEach(row => {
      eventRows.push(Object.assign({}, row, {
        group: row.groups.join(',')
      }));
    });
  });

  return eventRows;
}

function filterGpu001RowsByDominantTeacherForGroupSubject_(rows) {
  const teacherCountsByGroupSubject = new Map();

  rows.forEach(row => {
    const groupSubjectKey = [
      normalizeCode_(row.group),
      normalizeCode_(row.matReduit)
    ].join('||');
    const teacherKey = normalizeCode_(row.profReduit);

    if (!groupSubjectKey || !teacherKey) return;

    if (!teacherCountsByGroupSubject.has(groupSubjectKey)) {
      teacherCountsByGroupSubject.set(groupSubjectKey, new Map());
    }

    const teacherCounts = teacherCountsByGroupSubject.get(groupSubjectKey);
    teacherCounts.set(teacherKey, (teacherCounts.get(teacherKey) || 0) + 1);
  });

  const keptTeachersByGroupSubject = new Map();

  teacherCountsByGroupSubject.forEach((teacherCounts, groupSubjectKey) => {
    const maxCount = Math.max.apply(null, Array.from(teacherCounts.values()));
    const keptTeachers = new Set();

    teacherCounts.forEach((count, teacherKey) => {
      if (count === maxCount) {
        keptTeachers.add(teacherKey);
      }
    });

    keptTeachersByGroupSubject.set(groupSubjectKey, keptTeachers);
  });

  return rows.filter(row => {
    const groupSubjectKey = [
      normalizeCode_(row.group),
      normalizeCode_(row.matReduit)
    ].join('||');
    const teacherKey = normalizeCode_(row.profReduit);
    const keptTeachers = keptTeachersByGroupSubject.get(groupSubjectKey);

    return !keptTeachers || keptTeachers.has(teacherKey);
  });
}

function dedupeGpu001RowsByTeacherGroupSubject_(rows) {
  const seen = new Set();
  const deduped = [];

  rows.forEach(row => {
    const key = [
      normalizeCode_(row.profReduit),
      normalizeCode_(row.group),
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

function resolveGroupNamesForCodes_(groupCodes, groupNamesByUntisName) {
  const resolvedNames = [];
  const seen = new Set();

  (Array.isArray(groupCodes) ? groupCodes : String(groupCodes || '').split(','))
    .map(groupCode => String(groupCode || '').trim())
    .filter(Boolean)
    .forEach(groupCode => {
      const groupName = groupNamesByUntisName.get(normalizeCode_(groupCode)) || '';
      const key = normalizeCode_(groupName);
      if (!groupName || seen.has(key)) return;

      seen.add(key);
      resolvedNames.push(groupName);
    });

  return resolvedNames.join(', ');
}

function getGroupNameForGroupCode_(groupCode) {
  const dinantiaRows = readRowsByHeader_(
    getRequiredSheet_(openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME), DINANTIA_GROUPS_SHEET_NAME)
  );
  const groupNamesByUntisName = buildGroupNamesByUntisName_(dinantiaRows);

  return resolveGroupNamesForCodes_([groupCode], groupNamesByUntisName);
}

function splitGroupCodes_(value) {
  return String(value || '')
    .split(',')
    .map(groupCode => groupCode.trim())
    .filter(Boolean);
}

function buildTeacherInfoByCode_(rows) {
  const map = new Map();

  rows.forEach(row => {
    const reduit = normalizeCode_(getField_(row, 'REDUIT', 'REDUÏT'));
    if (!reduit) return;

    map.set(reduit, {
      fullName: buildTeacherFullName_(row),
      email: getTeacherEmail_(row)
    });
  });

  return map;
}

function getTeacherEmail_(teacherRow) {
  const preferredEmail = String(getField_(
    teacherRow,
    'CORREU INSTIT',
    'CORREU',
    'EMAIL',
    'E-MAIL',
    'MAIL',
    'CORREU ELECTRONIC',
    'CORREU ELECTRÒNIC',
    'XTEC'
  ) || '').trim();

  if (looksLikeEmail_(preferredEmail)) {
    return preferredEmail;
  }

  const values = Object.keys(teacherRow)
    .map(key => String(teacherRow[key] || '').trim())
    .filter(Boolean);
  const detectedEmail = values.find(looksLikeEmail_);

  return detectedEmail || preferredEmail;
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

function uniqueInOrder_(values) {
  const seen = new Set();

  return values.map(value => String(value || '').trim())
    .filter(value => {
      if (!value || seen.has(value)) return false;

      seen.add(value);
      return true;
    });
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

function normalizeEventCode_(value) {
  return String(value || '').trim();
}

function looksLikeEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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
