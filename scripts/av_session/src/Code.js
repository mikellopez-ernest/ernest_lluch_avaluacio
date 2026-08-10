const ALLOWED_EMAIL_DOMAIN = 'iernestlluch.cat';
const TIMEZONE = 'Europe/Madrid';

const TEACHERS_TABLE_NAME = 'Dades de professors';
const TEACHERS_SHEET_NAME = 'Llista';
const LEAVE_ABSENCE_SHEET_NAME = 'leave_absence';
const TEACHING_LOAD_TABLE_NAME = 'Càrrega lectiva';
const RESPONSIBILITIES_SHEET_NAME = 'carrecs';
const DINANTIA_TABLE_NAME = 'Dinantia';
const TEACHERS_TO_DINANTIA_SHEET_NAME = 'teachers_2_dinantia';
const GRADES_TABLE_NAME = 'Grades';
const EVALUATIONS_SHEET_NAME = 'avaluacions';

const MODE_JUNTA_STATUS = 'Mode junta';
const ADMIN_PRIVILEGES_MARKER = 'ADMIN_PRIVILEGES';
const STUDENT_ACCOUNT_ID_HEADER = 'student_account_id';
const SUBJECT_EVALUATION_HEADER = 'Avaluació de la matèria';
const TUTORING_GROUP_HEADER = 'grup_tutoria';
const TUTOR_COMMENT_HEADER = 'Comentari_tutor';
const TUTORIA_SHEET_SUFFIX = '_tutoria';

function doGet() {
  if (!isAllowedUser_()) {
    return HtmlService.createHtmlOutput(
      '<h1>Accés restringit</h1><p>Aquesta aplicació només està disponible per a usuaris @iernestlluch.cat.</p>'
    )
      .setTitle('Sessió d\'avaluació')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Sessió d\'avaluació')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function grantPermissionsManually() {
  const userEmail = getActiveUserEmail_();
  const teachersSpreadsheet = openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME);
  getRequiredSheet_(teachersSpreadsheet, TEACHERS_SHEET_NAME);
  getRequiredSheet_(teachersSpreadsheet, LEAVE_ABSENCE_SHEET_NAME);
  getRequiredSheet_(openLogicalTableSpreadsheet_(TEACHING_LOAD_TABLE_NAME), RESPONSIBILITIES_SHEET_NAME);
  getRequiredSheet_(openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME), TEACHERS_TO_DINANTIA_SHEET_NAME);
  getRequiredSheet_(openLogicalTableSpreadsheet_(GRADES_TABLE_NAME), EVALUATIONS_SHEET_NAME);

  return HtmlService.createHtmlOutput(
    `<p>Permissions ready for ${userEmail || 'current user'}.</p>`
  )
    .setTitle('Sessió d\'avaluació')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getAvSessionData() {
  assertAllowedUser_();

  const context = resolveUserVisibilityContext_();
  const evaluations = readModeJuntaEvaluationRegisters_();
  if (!evaluations.length) {
    throw new Error(`No hi ha cap avaluació en estat "${MODE_JUNTA_STATUS}".`);
  }

  return {
    title: 'Sessió d\'avaluació',
    userEmail: getActiveUserEmail_(),
    actingTeacher: publicTeacher_(context.actingTeacher),
    effectiveTeacher: publicTeacher_(context.effectiveTeacher),
    isSubstituteActing: context.isSubstituteActing,
    isAdmin: context.isAdmin,
    groups: context.visibleGroups,
    evaluations
  };
}

function getAvSessionEvaluationData(payload) {
  assertAllowedUser_();

  const selectedGroup = String(payload && payload.group || '').trim();
  if (!selectedGroup) throw new Error('Cal seleccionar un grup.');

  const context = resolveUserVisibilityContext_();
  assertAllowedGroup_(selectedGroup, context.visibleGroups);

  const evaluation = getModeJuntaEvaluationFromPayload_(payload);
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const sheet = getRequiredSheet_(gradesSpreadsheet, evaluation.sheetName);
  const config = readEvaluationConfig_(gradesSpreadsheet, evaluation.sheetName);
  const table = readEvaluationTable_(sheet);
  const rowsForGroup = table.rows.filter(row => rowIncludesGroup_(row, selectedGroup));
  const tutorComments = readTutoriaCommentsForGroup_(gradesSpreadsheet, evaluation.sheetName, selectedGroup);

  return {
    evaluation,
    group: selectedGroup,
    students: buildStudentOptions_(rowsForGroup),
    subjects: uniqueSorted_(rowsForGroup.map(row => row.subjectFullName)),
    rows: rowsForGroup,
    tutorCommentsByStudentAccountId: tutorComments.byStudentAccountId,
    tutorCommentsByStudentName: tutorComments.byStudentName,
    subjectEvaluationOptions: config.subjectEvaluationOptions,
    subjectEvaluationColors: config.subjectEvaluationColors,
    conceptColumns: mergeConceptColumns_(table.conceptColumns, config.conceptColumns),
    message: rowsForGroup.length ? '' : 'No hi ha files per a aquest grup en aquesta avaluació.'
  };
}

function getAvSessionRows(payload) {
  assertAllowedUser_();

  const selectedGroup = String(payload && payload.group || '').trim();
  const selectedStudent = String(payload && payload.student || '').trim();
  const selectedSubject = String(payload && payload.subject || '').trim();
  if (!selectedGroup) throw new Error('Cal seleccionar un grup.');
  if ((selectedStudent && selectedSubject) || (!selectedStudent && !selectedSubject)) {
    throw new Error('Cal seleccionar un alumne o una matèria, però no totes dues opcions.');
  }

  const context = resolveUserVisibilityContext_();
  assertAllowedGroup_(selectedGroup, context.visibleGroups);

  const evaluation = getModeJuntaEvaluationFromPayload_(payload);
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const sheet = getRequiredSheet_(gradesSpreadsheet, evaluation.sheetName);
  const config = readEvaluationConfig_(gradesSpreadsheet, evaluation.sheetName);
  const table = readEvaluationTable_(sheet);
  const rows = table.rows
    .filter(row => rowIncludesGroup_(row, selectedGroup))
    .filter(row => selectedStudent
      ? row.studentFullName === selectedStudent
      : row.subjectFullName === selectedSubject)
    .sort((a, b) => selectedStudent
      ? compareText_(a.subjectFullName, b.subjectFullName)
      : compareText_(a.studentFullName, b.studentFullName));

  return {
    evaluation,
    group: selectedGroup,
    mode: selectedStudent ? 'student' : 'subject',
    selectedStudent,
    selectedSubject,
    rows,
    subjectEvaluationOptions: config.subjectEvaluationOptions,
    subjectEvaluationColors: config.subjectEvaluationColors,
    conceptColumns: mergeConceptColumns_(table.conceptColumns, config.conceptColumns),
    message: rows.length ? '' : 'No hi ha files per a la selecció actual.'
  };
}

function saveAvSessionRows(payload) {
  assertAllowedUser_();

  const selectedGroup = String(payload && payload.group || '').trim();
  const selectedStudent = String(payload && payload.student || '').trim();
  const selectedSubject = String(payload && payload.subject || '').trim();
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const tutorCommentDirty = payload && payload.tutorCommentDirty === true;
  if (!selectedGroup) throw new Error('Cal seleccionar un grup.');
  if (!rows.length && !tutorCommentDirty) return getAvSessionRows(payload);
  if (tutorCommentDirty && !selectedStudent) {
    throw new Error('El comentari del tutor només es pot desar amb un alumne seleccionat.');
  }

  const context = resolveUserVisibilityContext_();
  assertAllowedGroup_(selectedGroup, context.visibleGroups);
  const evaluation = getModeJuntaEvaluationFromPayload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const activeEvaluation = findModeJuntaEvaluationBySheetName_(evaluation.sheetName);
    if (!activeEvaluation) {
      throw new Error(`L'avaluació ja no està en estat "${MODE_JUNTA_STATUS}".`);
    }

    const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
    const dirtySheetRows = uniqueSortedNumbers_(rows.map(row => row && row.sheetRow));
    let savedTutorComment = null;
    let updatedRows = [];

    if (dirtySheetRows.length) {
      const sheet = getRequiredSheet_(gradesSpreadsheet, activeEvaluation.sheetName);
      const headers = readEvaluationHeaders_(sheet);
      const columnIndexes = getWritableColumnIndexes_(headers);
      const rowContext = readEvaluationRowsBySheetRow_(sheet, headers, dirtySheetRows);
      const tableRowsBySheetRow = new Map(rowContext.rows.map(row => [row.sheetRow, row]));
      const lastRow = sheet.getLastRow();

      rows.forEach(row => {
        const sheetRow = Number(row.sheetRow);
        if (!Number.isFinite(sheetRow) || sheetRow < 2 || sheetRow > lastRow) {
          throw new Error('Fila no vàlida.');
        }

        const modelRow = tableRowsBySheetRow.get(sheetRow);
        if (!modelRow || !rowIncludesGroup_(modelRow, selectedGroup)) {
          throw new Error('No tens permís per modificar una o més files.');
        }
        if (selectedStudent && modelRow.studentFullName !== selectedStudent) {
          throw new Error('Una fila ja no correspon a l\'alumne seleccionat.');
        }
        if (selectedSubject && modelRow.subjectFullName !== selectedSubject) {
          throw new Error('Una fila ja no correspon a la matèria seleccionada.');
        }

        const values = rowContext.valuesBySheetRow.get(sheetRow);
        values[columnIndexes.pi] = row.pi === true;
        values[columnIndexes.subjectEvaluation] = String(row.subjectEvaluation || '').trim();
        modelRow.pi = row.pi === true;
        modelRow.subjectEvaluation = String(row.subjectEvaluation || '').trim();

        const concepts = row.concepts && typeof row.concepts === 'object' ? row.concepts : {};
        columnIndexes.concepts.forEach(concept => {
          if (Object.prototype.hasOwnProperty.call(concepts, concept.header)) {
            const conceptValue = String(concepts[concept.header] || '').trim();
            values[concept.index] = conceptValue;
            modelRow.concepts[concept.header] = conceptValue;
          }
        });
      });

      const firstWritableColumn = getFirstWritableColumn_(headers);
      const lastWritableColumn = getLastWritableColumn_(headers);
      const writableWidth = lastWritableColumn - firstWritableColumn + 1;
      if (writableWidth > 0) {
        getContiguousRuns_(dirtySheetRows).forEach(run => {
          const writableValues = getRunNumbers_(run).map(sheetRow =>
            rowContext.valuesBySheetRow.get(sheetRow).slice(firstWritableColumn - 1, lastWritableColumn)
          );
          sheet.getRange(run.start, firstWritableColumn, run.count, writableWidth).setValues(writableValues);
        });
      }

      updatedRows = rowContext.rows;
    }

    if (tutorCommentDirty) {
      savedTutorComment = saveTutoriaComment_(
        gradesSpreadsheet,
        activeEvaluation.sheetName,
        selectedGroup,
        selectedStudent,
        String(payload && payload.studentAccountId || '').trim(),
        String(payload && payload.tutorComment || '')
      );
    }

    return {
      evaluation: activeEvaluation,
      group: selectedGroup,
      mode: selectedStudent ? 'student' : 'subject',
      selectedStudent,
      selectedSubject,
      updatedRows,
      tutorComment: savedTutorComment,
      message: ''
    };
  } finally {
    lock.releaseLock();
  }
}

function buildRowsResponseFromTable_(evaluation, selectedGroup, selectedStudent, selectedSubject, table) {
  const rows = table.rows
    .filter(row => rowIncludesGroup_(row, selectedGroup))
    .filter(row => selectedStudent
      ? row.studentFullName === selectedStudent
      : row.subjectFullName === selectedSubject)
    .sort((a, b) => selectedStudent
      ? compareText_(a.subjectFullName, b.subjectFullName)
      : compareText_(a.studentFullName, b.studentFullName));

  return {
    evaluation,
    group: selectedGroup,
    mode: selectedStudent ? 'student' : 'subject',
    selectedStudent,
    selectedSubject,
    rows,
    message: rows.length ? '' : 'No hi ha files per a la selecció actual.'
  };
}

function readModeJuntaEvaluationRegisters_() {
  return readEvaluationRegisters_().filter(evaluation => evaluation.status === MODE_JUNTA_STATUS);
}

function readEvaluationRegisters_() {
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const sheet = getRequiredSheet_(gradesSpreadsheet, EVALUATIONS_SHEET_NAME);

  return readRowsByHeader_(sheet).map(row => ({
    id: Number(getField_(row, 'id')) || '',
    name: String(getField_(row, 'nom_av') || '').trim(),
    sheetName: String(getField_(row, 'sheet_name', 'sheet_id') || '').trim(),
    status: String(getField_(row, 'Estat') || '').trim()
  })).filter(row => row.name && row.sheetName);
}

function getModeJuntaEvaluationFromPayload_(payload) {
  const sheetName = String(payload && payload.sheetName || '').trim();
  const id = Number(payload && payload.id);
  const evaluation = readModeJuntaEvaluationRegisters_().find(item =>
    (sheetName && item.sheetName === sheetName) ||
    (Number.isFinite(id) && id && item.id === id)
  );

  if (!evaluation) {
    throw new Error(`L'avaluació seleccionada no està disponible en estat "${MODE_JUNTA_STATUS}".`);
  }

  return evaluation;
}

function findModeJuntaEvaluationBySheetName_(sheetName) {
  const cleanSheetName = String(sheetName || '').trim();
  return readModeJuntaEvaluationRegisters_().find(evaluation => evaluation.sheetName === cleanSheetName) || null;
}

function readEvaluationHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error(`El full ${sheet.getName()} està buit.`);

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(header => String(header || '').trim());
  validateEvaluationHeaders_(headers);
  return headers;
}

function readEvaluationRowsBySheetRow_(sheet, headers, sheetRows) {
  const valuesBySheetRow = new Map();
  const rows = [];

  getContiguousRuns_(sheetRows).forEach(run => {
    const values = sheet.getRange(run.start, 1, run.count, headers.length).getValues();
    values.forEach((rowValues, offset) => {
      const sheetRow = run.start + offset;
      valuesBySheetRow.set(sheetRow, rowValues);
      const row = buildEvaluationRow_(headers, rowValues, sheetRow);
      if (row) rows.push(row);
    });
  });

  return { valuesBySheetRow, rows };
}

function readEvaluationTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error(`El full ${sheet.getName()} està buit.`);

  const headers = values[0].map(header => String(header || '').trim());
  validateEvaluationHeaders_(headers);
  const rows = values.slice(1)
    .map((row, index) => buildEvaluationRow_(headers, row, index + 2))
    .filter(Boolean);

  return {
    values,
    headers,
    rows,
    conceptColumns: getConceptColumnsFromHeaders_(headers).map(concept => ({ header: concept.header }))
  };
}

function validateEvaluationHeaders_(headers) {
  const indexes = buildHeaderIndexMap_(headers);
  const requiredHeaders = [
    TUTORING_GROUP_HEADER,
    'subject_full_name',
    'student_full_name',
    'PI',
    SUBJECT_EVALUATION_HEADER
  ];
  requiredHeaders.forEach(header => {
    if (!indexes.has(normalizeHeader_(header))) {
      throw new Error(`Falta la columna obligatòria: ${header}`);
    }
  });
}

function buildEvaluationRow_(headers, row, sheetRow) {
  const indexes = buildHeaderIndexMap_(headers);
  const conceptColumns = getConceptColumnsFromHeaders_(headers);
  const headerIndexes = {
    tutoringGroup: indexes.get(normalizeHeader_(TUTORING_GROUP_HEADER)),
    subjectFullName: indexes.get(normalizeHeader_('subject_full_name')),
    studentFullName: indexes.get(normalizeHeader_('student_full_name')),
    studentAccountId: indexes.get(normalizeHeader_(STUDENT_ACCOUNT_ID_HEADER)),
    pi: indexes.get(normalizeHeader_('PI')),
    subjectEvaluation: indexes.get(normalizeHeader_(SUBJECT_EVALUATION_HEADER))
  };

  const model = {
    sheetRow,
    tutoringGroup: String(row[headerIndexes.tutoringGroup] || '').trim(),
    tutoringGroups: splitCommaValues_(row[headerIndexes.tutoringGroup]),
    subjectFullName: String(row[headerIndexes.subjectFullName] || '').trim(),
    studentFullName: String(row[headerIndexes.studentFullName] || '').trim(),
    studentAccountId: headerIndexes.studentAccountId === undefined
      ? ''
      : String(row[headerIndexes.studentAccountId] || '').trim(),
    pi: row[headerIndexes.pi] === true || String(row[headerIndexes.pi]).trim().toUpperCase() === 'TRUE',
    subjectEvaluation: String(row[headerIndexes.subjectEvaluation] || '').trim(),
    concepts: conceptColumns.reduce((result, concept) => {
      result[concept.header] = String(row[concept.index] || '').trim();
      return result;
    }, {})
  };

  return model.tutoringGroups.length && model.subjectFullName && model.studentFullName ? model : null;
}

function buildStudentOptions_(rows) {
  const studentsByName = new Map();
  (rows || []).forEach(row => {
    const name = String(row.studentFullName || '').trim();
    if (!name || studentsByName.has(name)) return;
    studentsByName.set(name, {
      name,
      accountId: String(row.studentAccountId || '').trim()
    });
  });

  return Array.from(studentsByName.values()).sort((a, b) => compareText_(a.name, b.name));
}

function readTutoriaCommentsForGroup_(gradesSpreadsheet, evaluationSheetName, selectedGroup) {
  const sheet = getRequiredSheet_(gradesSpreadsheet, `${evaluationSheetName}${TUTORIA_SHEET_SUFFIX}`);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { byStudentAccountId: {}, byStudentName: {} };

  const headers = values[0].map(header => String(header || '').trim());
  const indexes = getTutoriaColumnIndexes_(headers);
  const byStudentAccountId = {};
  const byStudentName = {};

  values.slice(1).forEach(row => {
    const tutoringGroups = splitCommaValues_(row[indexes.tutoringGroup]);
    if (!tutoringGroups.some(group => normalizeGroupMatch_(group) === normalizeGroupMatch_(selectedGroup))) return;

    const studentName = String(row[indexes.studentFullName] || '').trim();
    const studentAccountId = String(row[indexes.studentAccountId] || '').trim();
    const comment = String(row[indexes.tutorComment] || '');
    if (studentAccountId) byStudentAccountId[studentAccountId] = comment;
    if (studentName) byStudentName[studentName] = comment;
  });

  return { byStudentAccountId, byStudentName };
}

function saveTutoriaComment_(gradesSpreadsheet, evaluationSheetName, selectedGroup, selectedStudent, studentAccountId, tutorComment) {
  const sheet = getRequiredSheet_(gradesSpreadsheet, `${evaluationSheetName}${TUTORIA_SHEET_SUFFIX}`);
  const headers = readTutoriaHeaders_(sheet);
  const indexes = getTutoriaColumnIndexes_(headers);
  const sheetRow = findTutoriaStudentRow_(sheet, indexes, selectedGroup, selectedStudent, studentAccountId);
  sheet.getRange(sheetRow, indexes.tutorComment + 1).setValue(tutorComment);

  return {
    studentAccountId,
    studentFullName: selectedStudent,
    tutorComment
  };
}

function readTutoriaHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) throw new Error(`El full ${sheet.getName()} està buit.`);
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    .map(header => String(header || '').trim());
}

function getTutoriaColumnIndexes_(headers) {
  const indexes = buildHeaderIndexMap_(headers);
  const requiredHeaders = [
    TUTORING_GROUP_HEADER,
    'student_full_name',
    STUDENT_ACCOUNT_ID_HEADER,
    TUTOR_COMMENT_HEADER
  ];

  requiredHeaders.forEach(header => {
    if (!indexes.has(normalizeHeader_(header))) {
      throw new Error(`Falta la columna obligatòria al full de tutoria: ${header}`);
    }
  });

  return {
    tutoringGroup: indexes.get(normalizeHeader_(TUTORING_GROUP_HEADER)),
    studentFullName: indexes.get(normalizeHeader_('student_full_name')),
    studentAccountId: indexes.get(normalizeHeader_(STUDENT_ACCOUNT_ID_HEADER)),
    tutorComment: indexes.get(normalizeHeader_(TUTOR_COMMENT_HEADER))
  };
}

function findTutoriaStudentRow_(sheet, indexes, selectedGroup, selectedStudent, studentAccountId) {
  const cleanAccountId = String(studentAccountId || '').trim();
  const rowNumbers = cleanAccountId
    ? findSheetRowsByColumnValue_(sheet, indexes.studentAccountId + 1, cleanAccountId)
    : [];
  const fallbackRowNumbers = rowNumbers.length
    ? []
    : findSheetRowsByColumnValue_(sheet, indexes.studentFullName + 1, selectedStudent);
  const candidateRows = rowNumbers.concat(fallbackRowNumbers);
  if (!candidateRows.length) {
    throw new Error('No s\'ha trobat la fila de tutoria per a aquest alumne.');
  }

  const width = sheet.getLastColumn();
  for (const rowNumber of candidateRows) {
    const row = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    const sameStudent = normalizeText_(row[indexes.studentFullName]) === normalizeText_(selectedStudent);
    const sameAccount = !cleanAccountId || String(row[indexes.studentAccountId] || '').trim() === cleanAccountId;
    const sameGroup = splitCommaValues_(row[indexes.tutoringGroup])
      .some(group => normalizeGroupMatch_(group) === normalizeGroupMatch_(selectedGroup));
    if (sameStudent && sameAccount && sameGroup) return rowNumber;
  }

  throw new Error('No s\'ha trobat una fila de tutoria vàlida per a aquest alumne i grup.');
}

function findSheetRowsByColumnValue_(sheet, column, value) {
  const cleanValue = String(value || '').trim();
  const lastRow = sheet.getLastRow();
  if (!cleanValue || lastRow < 2) return [];

  return sheet.getRange(2, column, lastRow - 1, 1)
    .createTextFinder(cleanValue)
    .matchEntireCell(true)
    .findAll()
    .map(cell => cell.getRow());
}

function readEvaluationConfig_(gradesSpreadsheet, evaluationSheetName) {
  const sheet = getRequiredSheet_(gradesSpreadsheet, `${evaluationSheetName}_config`);
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return { subjectEvaluationOptions: [], subjectEvaluationColors: {}, conceptColumns: [] };
  }

  const headers = values[0].map(header => String(header || '').trim());
  const hasColorColumn = normalizeHeader_(headers[2]) === normalizeHeader_('Color');
  const firstConceptIndex = hasColorColumn ? 3 : 2;
  const subjectEvaluationOptions = uniqueSorted_(values.slice(1)
    .map(row => String(row[1] || '').trim())
    .filter(Boolean));
  const subjectEvaluationColors = values.slice(1).reduce((colors, row) => {
    const option = String(row[1] || '').trim();
    const color = hasColorColumn ? String(row[2] || '').trim() : '';
    if (option && /^#[0-9a-fA-F]{6}$/.test(color)) colors[option] = color.toUpperCase();
    return colors;
  }, {});
  const conceptColumns = headers.slice(firstConceptIndex)
    .map((header, offset) => ({
      header,
      options: uniqueSorted_(values.slice(1)
        .map(row => String(row[offset + firstConceptIndex] || '').trim())
        .filter(Boolean))
    }))
    .filter(concept => concept.header);

  return { subjectEvaluationOptions, subjectEvaluationColors, conceptColumns };
}

function getConceptColumnsFromHeaders_(headers) {
  const indexes = buildHeaderIndexMap_(headers);
  const subjectEvaluationIndex = indexes.get(normalizeHeader_(SUBJECT_EVALUATION_HEADER));
  const firstConceptIndex = subjectEvaluationIndex === undefined ? 7 : subjectEvaluationIndex + 1;

  return headers
    .map((header, index) => ({ header, index }))
    .filter(column =>
      column.index >= firstConceptIndex &&
      column.header &&
      normalizeHeader_(column.header) !== normalizeHeader_(STUDENT_ACCOUNT_ID_HEADER)
    );
}

function mergeConceptColumns_(sheetConceptColumns, configConceptColumns) {
  const optionsByHeader = new Map((configConceptColumns || []).map(concept => [
    normalizeHeader_(concept.header),
    concept.options || []
  ]));

  return (sheetConceptColumns || []).map(concept => ({
    header: concept.header,
    options: optionsByHeader.get(normalizeHeader_(concept.header)) || []
  }));
}

function getWritableColumnIndexes_(headers) {
  const indexes = buildHeaderIndexMap_(headers);
  const pi = indexes.get(normalizeHeader_('PI'));
  const subjectEvaluation = indexes.get(normalizeHeader_(SUBJECT_EVALUATION_HEADER));
  const concepts = getConceptColumnsFromHeaders_(headers);
  if (pi === undefined || subjectEvaluation === undefined) {
    throw new Error('No s\'han trobat les columnes editables obligatòries.');
  }
  return { pi, subjectEvaluation, concepts };
}

function getFirstWritableColumn_(headers) {
  const indexes = getWritableColumnIndexes_(headers);
  const writableIndexes = [indexes.pi, indexes.subjectEvaluation]
    .concat(indexes.concepts.map(column => column.index))
    .filter(index => index !== undefined);
  return Math.min.apply(null, writableIndexes) + 1;
}

function getLastWritableColumn_(headers) {
  const indexes = buildHeaderIndexMap_(headers);
  const writableIndexes = [
    indexes.get(normalizeHeader_('PI')),
    indexes.get(normalizeHeader_(SUBJECT_EVALUATION_HEADER))
  ]
    .concat(getConceptColumnsFromHeaders_(headers).map(column => column.index))
    .filter(index => index !== undefined);
  return Math.max.apply(null, writableIndexes) + 1;
}

function rowIncludesGroup_(row, groupName) {
  const targetGroup = normalizeGroupMatch_(groupName);
  return Array.isArray(row.tutoringGroups) &&
    row.tutoringGroups.some(group => normalizeGroupMatch_(group) === targetGroup);
}

function resolveUserVisibilityContext_() {
  const userEmail = normalizeEmail_(getActiveUserEmail_());
  const teachersSpreadsheet = openLogicalTableSpreadsheet_(TEACHERS_TABLE_NAME);
  const teachersSheet = getRequiredSheet_(teachersSpreadsheet, TEACHERS_SHEET_NAME);
  const teachers = readRowsByHeader_(teachersSheet);
  const actingTeacher = findTeacherByInstitutionalEmail_(teachers, userEmail);
  if (!actingTeacher) throw new Error('No s\'ha trobat cap tutoria associada al teu correu.');

  const substitution = resolveEffectiveTeacher_(teachersSpreadsheet, teachers, actingTeacher);
  const effectiveTeacher = substitution.effectiveTeacher;
  const responsibilities = readTeacherResponsibilities_(effectiveTeacher.fullName);
  const privileges = readDinantiaPrivilegesForResponsibilities_(responsibilities);
  const visibleGroups = buildVisibleGroups_(privileges.groupNames);
  if (!visibleGroups.length) throw new Error('No s\'ha trobat cap tutoria associada al teu correu.');

  return {
    actingTeacher,
    effectiveTeacher,
    isSubstituteActing: substitution.isSubstituteActing,
    responsibilities,
    isAdmin: privileges.isAdmin,
    visibleGroups
  };
}

function findTeacherByInstitutionalEmail_(teachers, email) {
  return teachers.map(rowToTeacher_).find(teacher => normalizeEmail_(teacher.email) === email) || null;
}

function rowToTeacher_(row) {
  const firstName = String(getField_(row, 'NOM') || '').trim();
  const surname1 = String(getField_(row, 'COGNOM1') || '').trim();
  const surname2 = String(getField_(row, 'COGNOM2') || '').trim();

  return {
    row,
    fullName: joinNameParts_([firstName, surname1, surname2]),
    email: String(getField_(row, 'CORREU INSTIT') || '').trim(),
    code: String(getField_(row, 'REDUÏT', 'REDUIT') || '').trim(),
    isSubstitute: isTruthy_(getField_(row, 'SUBST?')),
    isActive: isTruthy_(getField_(row, 'ACTIU'))
  };
}

function resolveEffectiveTeacher_(teachersSpreadsheet, teachers, actingTeacher) {
  if (!actingTeacher.isSubstitute) {
    return { effectiveTeacher: actingTeacher, isSubstituteActing: false };
  }

  const leaveSheet = getRequiredSheet_(teachersSpreadsheet, LEAVE_ABSENCE_SHEET_NAME);
  const leaveRows = readRowsByHeader_(leaveSheet);
  const today = todayKey_();
  const activeLeave = leaveRows.find(row => {
    const substituteCode = String(getField_(row, 'substitute_code') || '').trim();
    return substituteCode === actingTeacher.code && isActiveLeaveOnDate_(row, today);
  });
  if (!activeLeave) {
    throw new Error('Ets professor/a substitut/a, però no s\'ha trobat cap substitució activa per avui.');
  }

  const mainTeacherCode = String(getField_(activeLeave, 'teacher_code') || '').trim();
  const effectiveTeacher = teachers.map(rowToTeacher_).find(teacher => teacher.code === mainTeacherCode);
  if (!effectiveTeacher) {
    throw new Error('No s\'ha pogut resoldre el professor/a titular de la substitució activa.');
  }

  return { effectiveTeacher, isSubstituteActing: true };
}

function isActiveLeaveOnDate_(row, today) {
  const startDate = dateKey_(getField_(row, 'start_date'));
  const endDate = dateKey_(getField_(row, 'end_date'));
  if (!startDate || startDate > today) return false;
  return !endDate || endDate >= today;
}

function readTeacherResponsibilities_(teacherFullName) {
  const spreadsheet = openLogicalTableSpreadsheet_(TEACHING_LOAD_TABLE_NAME);
  const sheet = getRequiredSheet_(spreadsheet, RESPONSIBILITIES_SHEET_NAME);
  const targetName = normalizeText_(teacherFullName);

  return uniqueInOrder_(readRowsByHeader_(sheet)
    .filter(row => normalizeText_(getField_(row, 'asignado?', 'assignat?', 'asignado')) === targetName)
    .map(row => String(getField_(row, 'carrec') || '').trim())
    .filter(Boolean));
}

function readDinantiaPrivilegesForResponsibilities_(responsibilities) {
  const spreadsheet = openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME);
  const sheet = getRequiredSheet_(spreadsheet, TEACHERS_TO_DINANTIA_SHEET_NAME);
  const responsibilitySet = new Set(responsibilities.map(normalizeText_));
  const groupNames = [];
  let isAdmin = false;

  readRowsByHeader_(sheet).forEach(row => {
    const carrec = String(getField_(row, 'carrec') || '').trim();
    if (!responsibilitySet.has(normalizeText_(carrec))) return;
    splitCommaValues_(getField_(row, 'dinantia_group_names')).forEach(item => {
      if (item === ADMIN_PRIVILEGES_MARKER) {
        isAdmin = true;
      } else {
        groupNames.push(item);
      }
    });
  });

  return { isAdmin, groupNames: uniqueInOrder_(groupNames) };
}

function buildVisibleGroups_(groupNames) {
  return groupNames.map(groupName => ({ dinantiaGroupName: groupName }));
}

function assertAllowedGroup_(groupName, visibleGroups) {
  const allowed = (visibleGroups || []).some(group => group.dinantiaGroupName === groupName);
  if (!allowed) throw new Error('No tens permís per consultar aquest grup.');
}

function publicTeacher_(teacher) {
  return {
    fullName: teacher.fullName,
    email: teacher.email,
    code: teacher.code,
    isSubstitute: teacher.isSubstitute,
    isActive: teacher.isActive
  };
}

function openLogicalTableSpreadsheet_(logicalTableName) {
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) throw new Error('Missing script property: db');

  const registrySpreadsheet = SpreadsheetApp.openById(dbId);
  const tablesSheet = getRequiredSheet_(registrySpreadsheet, 'tables');
  const rows = tablesSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i += 1) {
    const name = String(rows[i][0] || '').trim();
    const spreadsheetId = String(rows[i][1] || '').trim();
    if (name === logicalTableName && spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
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

function getField_(row, ...headers) {
  for (const header of headers) {
    if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];
    const normalizedHeader = normalizeHeader_(header);
    if (Object.prototype.hasOwnProperty.call(row, normalizedHeader)) return row[normalizedHeader];
  }
  return '';
}

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  return sheet;
}

function buildHeaderIndexMap_(headers) {
  const indexes = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader_(header);
    if (key && !indexes.has(key)) indexes.set(key, index);
  });
  return indexes;
}

function splitCommaValues_(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function uniqueInOrder_(values) {
  const seen = new Set();
  const result = [];
  values.forEach(value => {
    const cleanValue = String(value || '').trim();
    if (!cleanValue || seen.has(cleanValue)) return;
    seen.add(cleanValue);
    result.push(cleanValue);
  });
  return result;
}

function uniqueSorted_(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort(compareText_);
}

function uniqueSortedNumbers_(values) {
  return Array.from(new Set(values.map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
}

function getContiguousRuns_(numbers) {
  const runs = [];
  numbers.forEach(number => {
    const lastRun = runs[runs.length - 1];
    if (lastRun && lastRun.start + lastRun.count === number) {
      lastRun.count += 1;
    } else {
      runs.push({ start: number, count: 1 });
    }
  });
  return runs;
}

function getRunNumbers_(run) {
  return Array.from({ length: run.count }, (_, index) => run.start + index);
}

function joinNameParts_(parts) {
  return parts.map(part => String(part || '').trim()).filter(Boolean).join(' ');
}

function todayKey_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function dateKey_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd');
  const raw = String(value || '').trim();
  if (!raw) return '';
  const dmyMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  const ymdMatch = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return Utilities.formatDate(parsed, TIMEZONE, 'yyyy-MM-dd');
}

function isTruthy_(value) {
  if (value === true) return true;
  const normalized = normalizeText_(value);
  return ['TRUE', 'SI', 'SÍ', 'YES', '1'].includes(normalized);
}

function compareText_(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ca', { sensitivity: 'base' });
}

function normalizeHeader_(value) {
  return normalizeText_(value).replace(/\s+/g, ' ');
}

function normalizeGroupMatch_(value) {
  return normalizeText_(value).replace(/\s+/g, ' ');
}

function normalizeText_(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function getActiveUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim();
}

function isAllowedUser_() {
  return normalizeEmail_(getActiveUserEmail_()).endsWith(`@${ALLOWED_EMAIL_DOMAIN}`);
}

function assertAllowedUser_() {
  if (!isAllowedUser_()) throw new Error('Accés restringit.');
}
