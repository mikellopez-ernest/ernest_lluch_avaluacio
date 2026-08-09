const ALLOWED_EMAIL_DOMAIN = 'iernestlluch.cat';
const GRADES_TABLE_NAME = 'Grades';
const EVALUATIONS_SHEET_NAME = 'avaluacions';
const ACTIVE_EVALUATION_STATUS = 'Avaluació professors';
const GRUP_TUTORIA_HEADER = 'grup_tutoria';
const STUDENT_ACCOUNT_ID_HEADER = 'student_account_id';
const SUBJECT_EVALUATION_HEADER = 'Avaluació de la matèria';

function doGet() {
  if (!isAllowedUser_()) {
    return HtmlService.createHtmlOutput(
      '<h1>Accés restringit</h1><p>Aquesta aplicació només està disponible per a usuaris @iernestlluch.cat.</p>'
    )
      .setTitle('Avaluació')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Avaluació')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function grantPermissionsManually() {
  const userEmail = Session.getActiveUser().getEmail();
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) {
    throw new Error('Missing script property: db');
  }

  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  getRequiredSheet_(gradesSpreadsheet, EVALUATIONS_SHEET_NAME);

  return HtmlService.createHtmlOutput(
    `<p>Permissions ready for ${userEmail || 'current user'}.</p>`
  )
    .setTitle('Avaluació')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getTeacherPanelData() {
  assertAllowedUser_();

  const evaluations = readActiveEvaluationRegisters_();
  if (!evaluations.length) {
    throw new Error(`No hi ha cap avaluació en estat "${ACTIVE_EVALUATION_STATUS}".`);
  }

  return {
    title: 'Avaluació',
    userEmail: getActiveUserEmail_(),
    evaluations
  };
}

function getTeacherEvaluationData(payload) {
  assertAllowedUser_();

  const evaluation = getActiveEvaluationFromPayload_(payload);
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const sheet = getRequiredSheet_(gradesSpreadsheet, evaluation.sheetName);
  const config = readEvaluationConfig_(gradesSpreadsheet, evaluation.sheetName);
  const userEmail = normalizeEmail_(getActiveUserEmail_());
  const table = readEvaluationTable_(sheet);
  const teacherRows = table.rows
    .filter(row => normalizeEmail_(row.teacherEmail) === userEmail)
    .sort((a, b) => compareText_(a.studentFullName, b.studentFullName));

  if (!teacherRows.length) {
    return {
      evaluation,
      userEmail: getActiveUserEmail_(),
      groups: [],
      rows: [],
      subjectEvaluationOptions: config.subjectEvaluationOptions,
      subjectEvaluationColors: config.subjectEvaluationColors,
      conceptColumns: mergeConceptColumns_(table.conceptColumns, config.conceptColumns),
      message: 'No tens alumnes assignats en aquesta avaluació.'
    };
  }

  return {
    evaluation,
    userEmail: getActiveUserEmail_(),
    groups: uniqueSorted_(teacherRows.reduce((groups, row) =>
      groups.concat(row.groupNames || []), [])),
    rows: teacherRows,
    subjectEvaluationOptions: config.subjectEvaluationOptions,
    subjectEvaluationColors: config.subjectEvaluationColors,
    conceptColumns: mergeConceptColumns_(table.conceptColumns, config.conceptColumns),
    message: ''
  };
}

function saveTeacherEvaluationRows(payload) {
  assertAllowedUser_();

  const evaluation = getActiveEvaluationFromPayload_(payload);
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  if (!rows.length) {
    return getTeacherEvaluationData({ sheetName: evaluation.sheetName });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const activeEvaluation = findActiveEvaluationBySheetName_(evaluation.sheetName);
    if (!activeEvaluation) {
      throw new Error(`L'avaluació ja no està en estat "${ACTIVE_EVALUATION_STATUS}".`);
    }

    const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
    const sheet = getRequiredSheet_(gradesSpreadsheet, activeEvaluation.sheetName);
    const table = readEvaluationTable_(sheet);
    const headers = table.headers;
    const userEmail = normalizeEmail_(getActiveUserEmail_());
    const columnIndexes = getWritableColumnIndexes_(headers);

    rows.forEach(row => {
      const sheetRow = Number(row.sheetRow);
      if (!Number.isFinite(sheetRow) || sheetRow < 2 || sheetRow > table.values.length) {
        throw new Error('Fila no vàlida.');
      }

      const values = table.values[sheetRow - 1];
      const currentTeacherEmail = normalizeEmail_(values[table.headerIndexes.teacherEmail]);
      if (currentTeacherEmail !== userEmail) {
        throw new Error('No tens permís per modificar una o més files.');
      }

      values[columnIndexes.pi] = row.pi === true;
      values[columnIndexes.subjectEvaluation] = String(row.subjectEvaluation || '').trim();

      const concepts = row.concepts && typeof row.concepts === 'object' ? row.concepts : {};
      columnIndexes.concepts.forEach(concept => {
        if (Object.prototype.hasOwnProperty.call(concepts, concept.header)) {
          values[concept.index] = String(concepts[concept.header] || '').trim();
        }
      });
    });

    const firstWritableColumn = getFirstWritableColumn_(headers);
    const lastWritableColumn = getLastWritableColumn_(headers);
    const writableWidth = lastWritableColumn - firstWritableColumn + 1;
    const bodyRowCount = table.values.length - 1;
    if (bodyRowCount > 0 && writableWidth > 0) {
      const writableValues = table.values.slice(1).map(row =>
        row.slice(firstWritableColumn - 1, lastWritableColumn)
      );
      sheet.getRange(2, firstWritableColumn, bodyRowCount, writableWidth).setValues(writableValues);
    }

    return getTeacherEvaluationData({ sheetName: activeEvaluation.sheetName });
  } finally {
    lock.releaseLock();
  }
}

function readActiveEvaluationRegisters_() {
  return readEvaluationRegisters_()
    .filter(evaluation => evaluation.status === ACTIVE_EVALUATION_STATUS);
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

function getActiveEvaluationFromPayload_(payload) {
  const sheetName = String(payload && payload.sheetName || '').trim();
  const id = Number(payload && payload.id);
  const activeEvaluations = readActiveEvaluationRegisters_();
  const evaluation = activeEvaluations.find(item =>
    (sheetName && item.sheetName === sheetName) ||
    (Number.isFinite(id) && id && item.id === id)
  );

  if (!evaluation) {
    throw new Error(`L'avaluació seleccionada no està disponible en estat "${ACTIVE_EVALUATION_STATUS}".`);
  }

  return evaluation;
}

function findActiveEvaluationBySheetName_(sheetName) {
  const cleanSheetName = String(sheetName || '').trim();
  return readActiveEvaluationRegisters_().find(evaluation => evaluation.sheetName === cleanSheetName) || null;
}

function readEvaluationTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    throw new Error(`El full ${sheet.getName()} està buit.`);
  }

  const headers = values[0].map(header => String(header || '').trim());
  const indexes = buildHeaderIndexMap_(headers);
  const requiredHeaders = [
    'group_name',
    'teacher_email',
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

  const conceptColumns = getConceptColumnsFromHeaders_(headers);
  const headerIndexes = {
    groupName: indexes.get(normalizeHeader_('group_name')),
    teacherEmail: indexes.get(normalizeHeader_('teacher_email')),
    subjectFullName: indexes.get(normalizeHeader_('subject_full_name')),
    studentFullName: indexes.get(normalizeHeader_('student_full_name')),
    grupTutoria: indexes.get(normalizeHeader_(GRUP_TUTORIA_HEADER)),
    pi: indexes.get(normalizeHeader_('PI')),
    subjectEvaluation: indexes.get(normalizeHeader_(SUBJECT_EVALUATION_HEADER))
  };

  const rows = values.slice(1)
    .map((row, index) => ({
      sheetRow: index + 2,
      groupName: String(row[headerIndexes.groupName] || '').trim(),
      groupNames: splitCommaValues_(row[headerIndexes.groupName]),
      teacherEmail: String(row[headerIndexes.teacherEmail] || '').trim(),
      subjectFullName: String(row[headerIndexes.subjectFullName] || '').trim(),
      studentFullName: String(row[headerIndexes.studentFullName] || '').trim(),
      grupTutoria: headerIndexes.grupTutoria === undefined ? '' : String(row[headerIndexes.grupTutoria] || '').trim(),
      pi: row[headerIndexes.pi] === true || String(row[headerIndexes.pi]).trim().toUpperCase() === 'TRUE',
      subjectEvaluation: String(row[headerIndexes.subjectEvaluation] || '').trim(),
      concepts: conceptColumns.reduce((result, concept) => {
        result[concept.header] = String(row[concept.index] || '').trim();
        return result;
      }, {})
    }))
    .filter(row => row.groupNames.length && row.subjectFullName && row.studentFullName);

  return {
    values,
    headers,
    rows,
    headerIndexes,
    conceptColumns: conceptColumns.map(concept => ({ header: concept.header }))
  };
}

function readEvaluationConfig_(gradesSpreadsheet, evaluationSheetName) {
  const configSheetName = `${evaluationSheetName}_config`;
  const sheet = getRequiredSheet_(gradesSpreadsheet, configSheetName);
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return {
      subjectEvaluationOptions: [],
      subjectEvaluationColors: {},
      conceptColumns: []
    };
  }

  const headers = values[0].map(header => String(header || '').trim());
  const hasColorColumn = normalizeHeader_(headers[2]) === normalizeHeader_('Color');
  const firstConceptIndex = hasColorColumn ? 3 : 2;
  const subjectEvaluationOptions = uniqueSorted_(values.slice(1)
    .map(row => String(row[1] || '').trim())
    .filter(Boolean));
  const subjectEvaluationColors = values.slice(1)
    .reduce((colors, row) => {
      const option = String(row[1] || '').trim();
      const color = hasColorColumn ? String(row[2] || '').trim() : '';
      if (option && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colors[option] = color.toUpperCase();
      }
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

  return {
    subjectEvaluationOptions,
    subjectEvaluationColors,
    conceptColumns
  };
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

  return {
    pi,
    subjectEvaluation,
    concepts
  };
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

function buildHeaderIndexMap_(headers) {
  const indexes = new Map();
  headers.forEach((header, index) => {
    const key = normalizeHeader_(header);
    if (key && !indexes.has(key)) {
      indexes.set(key, index);
    }
  });
  return indexes;
}

function openLogicalTableSpreadsheet_(logicalTableName) {
  const dbId = PropertiesService.getScriptProperties().getProperty('db');
  if (!dbId) {
    throw new Error('Missing script property: db');
  }

  const registrySpreadsheet = SpreadsheetApp.openById(dbId);
  const tablesSheet = getRequiredSheet_(registrySpreadsheet, 'tables');
  const rows = tablesSheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i += 1) {
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

function uniqueSorted_(values) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))
    .sort(compareText_);
}

function splitCommaValues_(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function compareText_(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'ca', { sensitivity: 'base' });
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function getActiveUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim();
}

function isAllowedUser_() {
  const email = normalizeEmail_(getActiveUserEmail_());
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
    throw new Error(`Missing sheet: ${sheetName}`);
  }
  return sheet;
}
