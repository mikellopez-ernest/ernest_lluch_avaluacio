const AV_JOB_SHEET_NAME = 'av_session_jobs';
const AV_JOB_ITEM_SHEET_NAME = 'av_session_job_items';
const AV_JOB_EVENT_SHEET_NAME = 'av_session_job_events';
const AV_BATCH_TRIGGER_HANDLER = 'processAvSessionBatchJobs';
const AV_BULLETIN_TEST_EMAIL_PROPERTY = 'bulletin_test_email';
const AV_JOB_GENERATE = 'GENERATE_BULLETINS';
const AV_JOB_SEND = 'SEND_BULLETINS';
const AV_JOB_BATCH_GENERATE = 6;
const AV_JOB_BATCH_SEND = 24;
const AV_JOB_RUNTIME_MS = 240000;
const AV_JOB_MAX_ATTEMPTS = 3;
const AV_JOB_QUOTA_RESERVE = 10;

const AV_JOB_HEADERS = [
  'job_id', 'job_type', 'status', 'evaluation_sheet', 'evaluation_name', 'scope',
  'requested_group', 'requested_by', 'created_at', 'started_at', 'finished_at',
  'heartbeat_at', 'total_items', 'pending_items', 'processed_items', 'success_items',
  'skipped_items', 'failed_items', 'needs_review_items', 'current_group',
  'current_student', 'remaining_quota', 'test_email', 'last_error', 'updated_at'
];

const AV_JOB_ITEM_HEADERS = [
  'item_id', 'job_id', 'sequence', 'status', 'evaluation_sheet', 'evaluation_name',
  'group_name', 'tutoria_row', 'student_account_id', 'student_full_name',
  'contact_position', 'contact_id', 'contact_name', 'intended_email',
  'delivery_email', 'bulletin_url', 'draft_id', 'message_id', 'dispatch_token',
  'attempt_count', 'last_error', 'next_attempt_at', 'created_at', 'started_at',
  'finished_at', 'updated_at'
];

const AV_JOB_EVENT_HEADERS = [
  'timestamp', 'job_id', 'item_id', 'event_type', 'status', 'actor', 'message', 'details_json'
];

function setupAvSessionBatchInfrastructure() {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const infrastructure = ensureAvBatchInfrastructure_();
  ensureAvBatchWorkerTrigger_();
  return {
    sheets: infrastructure,
    triggerInstalled: true,
    testEmail: getAvBulletinTestEmail_()
  };
}

function getClosedBatchPreflight(payload) {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const plan = buildClosedBatchPlan_(payload);
  return summarizeClosedBatchPlan_(plan);
}

function createClosedBatchJob(payload) {
  assertAllowedUser_();
  const visibility = assertAvSessionAdmin_();
  const plan = buildClosedBatchPlan_(payload);
  const infrastructure = ensureAvBatchInfrastructure_();
  ensureNoDuplicateActiveJob_(infrastructure.jobs, plan);

  const now = new Date();
  const jobId = `AVJ-${Utilities.getUuid()}`;
  const actor = getActiveUserEmail_() || Session.getEffectiveUser().getEmail();
  const job = {
    job_id: jobId,
    job_type: plan.jobType,
    status: 'QUEUED',
    evaluation_sheet: plan.evaluation.sheetName,
    evaluation_name: plan.evaluation.name,
    scope: plan.scope,
    requested_group: plan.selectedGroup,
    requested_by: actor,
    created_at: now,
    heartbeat_at: now,
    total_items: plan.items.length,
    pending_items: plan.items.filter(item => item.status === 'PENDING').length,
    processed_items: plan.items.filter(item => item.status !== 'PENDING').length,
    success_items: 0,
    skipped_items: plan.items.filter(item => isAvSkippedItemStatus_(item.status)).length,
    failed_items: plan.items.filter(item => isAvFailedItemStatus_(item.status)).length,
    needs_review_items: 0,
    current_group: '',
    current_student: '',
    remaining_quota: '',
    test_email: plan.testEmail,
    last_error: '',
    updated_at: now
  };
  appendAvTableObjects_(infrastructure.jobs, AV_JOB_HEADERS, [job]);

  const items = plan.items.map((item, index) => Object.assign({}, item, {
    item_id: `AVI-${Utilities.getUuid()}`,
    job_id: jobId,
    sequence: index + 1,
    evaluation_sheet: plan.evaluation.sheetName,
    evaluation_name: plan.evaluation.name,
    dispatch_token: `AV-${Utilities.getUuid()}`,
    attempt_count: 0,
    created_at: now,
    updated_at: now
  }));
  appendAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS, items);
  appendAvJobEvent_(infrastructure.events, jobId, '', 'JOB_CREATED', 'QUEUED', actor,
    `Procés creat amb ${items.length} elements.`, {
      scope: plan.scope,
      group: plan.selectedGroup,
      testEmail: plan.testEmail,
      isAdmin: visibility.isAdmin
    });
  ensureAvBatchWorkerTrigger_();
  return getAvBatchJobView_(job, items, plan.testEmail);
}

function getClosedBatchJobs(payload) {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const evaluationSheet = String(payload && payload.sheetName || '').trim();
  const infrastructure = ensureAvBatchInfrastructure_();
  const jobs = readAvTableObjects_(infrastructure.jobs, AV_JOB_HEADERS)
    .filter(job => !evaluationSheet || job.evaluation_sheet === evaluationSheet)
    .sort((a, b) => avDateValue_(b.created_at) - avDateValue_(a.created_at))
    .slice(0, 12);
  const items = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS);
  return {
    testEmail: getAvBulletinTestEmail_(),
    jobs: jobs.map(job => getAvBatchJobView_(
      job,
      items.filter(item => item.job_id === job.job_id),
      job.test_email
    ))
  };
}

function pauseClosedBatchJob(payload) {
  return changeClosedBatchJobStatus_(payload, 'PAUSED');
}

function resumeClosedBatchJob(payload) {
  return changeClosedBatchJobStatus_(payload, 'QUEUED');
}

function retryClosedBatchJob(payload) {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const jobId = String(payload && payload.jobId || '').trim();
  if (!jobId) throw new Error('Falta l\'identificador del procés.');
  const infrastructure = ensureAvBatchInfrastructure_();
  const jobs = readAvTableObjects_(infrastructure.jobs, AV_JOB_HEADERS);
  const job = jobs.find(candidate => candidate.job_id === jobId);
  if (!job) throw new Error('No s\'ha trobat el procés.');

  const retryStatuses = ['FAILED', 'NEEDS_REVIEW', 'BLOCKED_MISSING_PDF'];
  const items = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS)
    .filter(item => item.job_id === jobId && retryStatuses.includes(item.status));
  const now = new Date();
  items.forEach(item => updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
    status: 'PENDING',
    draft_id: '',
    message_id: '',
    last_error: '',
    next_attempt_at: '',
    finished_at: '',
    updated_at: now
  }));
  updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
    status: 'QUEUED',
    finished_at: '',
    last_error: '',
    updated_at: now
  });
  appendAvJobEvent_(infrastructure.events, jobId, '', 'JOB_RETRIED', 'QUEUED',
    getActiveUserEmail_(), `S'han reactivat ${items.length} elements.`, {});
  ensureAvBatchWorkerTrigger_();
  return { jobId, retriedItems: items.length };
}

function exportClosedBatchAuditCsv(payload) {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const jobId = String(payload && payload.jobId || '').trim();
  const infrastructure = ensureAvBatchInfrastructure_();
  const events = readAvTableObjects_(infrastructure.events, AV_JOB_EVENT_HEADERS)
    .filter(event => event.job_id === jobId);
  const items = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS)
    .filter(item => item.job_id === jobId);
  if (!events.length && !items.length) throw new Error('No hi ha dades d\'auditoria per exportar.');
  const headers = [
    'record_type', 'timestamp', 'job_id', 'item_id', 'event_type', 'status',
    'group_name', 'student_full_name', 'contact_position', 'intended_email',
    'delivery_email', 'bulletin_url', 'draft_id', 'message_id', 'attempt_count',
    'actor', 'message', 'details_json'
  ];
  const records = items.map(item => ({
    record_type: 'ITEM', timestamp: item.updated_at, job_id: item.job_id,
    item_id: item.item_id, event_type: 'ITEM_SNAPSHOT', status: item.status,
    group_name: item.group_name, student_full_name: item.student_full_name,
    contact_position: item.contact_position, intended_email: item.intended_email,
    delivery_email: item.delivery_email, bulletin_url: item.bulletin_url,
    draft_id: item.draft_id, message_id: item.message_id, attempt_count: item.attempt_count,
    actor: '', message: item.last_error, details_json: ''
  })).concat(events.map(event => ({
    record_type: 'EVENT', timestamp: event.timestamp, job_id: event.job_id,
    item_id: event.item_id, event_type: event.event_type, status: event.status,
    group_name: '', student_full_name: '', contact_position: '', intended_email: '',
    delivery_email: '', bulletin_url: '', draft_id: '', message_id: '', attempt_count: '',
    actor: event.actor, message: event.message, details_json: event.details_json
  })));
  const rows = [headers].concat(records.map(record => headers.map(header => (
    formatAvAuditValue_(record[header])
  ))));
  const csv = rows.map(row => row.map(csvEscape_).join(',')).join('\r\n');
  return {
    fileName: `auditoria_${sanitizeFileNamePart_(jobId)}.csv`,
    mimeType: 'text/csv;charset=utf-8',
    base64: Utilities.base64Encode(Utilities.newBlob(`\uFEFF${csv}`, 'text/csv').getBytes())
  };
}

function processAvSessionBatchJobs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  let infrastructure = null;
  let job = null;
  try {
    infrastructure = ensureAvBatchInfrastructure_();
    const jobs = readAvTableObjects_(infrastructure.jobs, AV_JOB_HEADERS);
    job = jobs
      .filter(candidate => ['QUEUED', 'RUNNING', 'WAITING_QUOTA'].includes(candidate.status))
      .sort((a, b) => avDateValue_(a.created_at) - avDateValue_(b.created_at))[0];
    if (!job) return;
    processAvBatchJob_(infrastructure, job);
  } catch (error) {
    if (infrastructure && job) {
      const message = String(error && error.message || error);
      updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
        status: 'PAUSED',
        last_error: message,
        heartbeat_at: new Date(),
        updated_at: new Date()
      });
      appendAvJobEvent_(infrastructure.events, job.job_id, '', 'JOB_PAUSED_BY_ERROR',
        'PAUSED', 'trigger', message, {});
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function processAvBatchJob_(infrastructure, job) {
  const startedAt = Date.now();
  const now = new Date();
  updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
    status: 'RUNNING',
    started_at: job.started_at || now,
    heartbeat_at: now,
    updated_at: now,
    last_error: ''
  });

  const allItems = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS)
    .filter(item => item.job_id === job.job_id);
  recoverAvSendingItems_(infrastructure, job, allItems);
  const refreshedItems = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS)
    .filter(item => item.job_id === job.job_id);
  const pending = refreshedItems.filter(item => (
    item.status === 'PENDING' && (!item.next_attempt_at || avDateValue_(item.next_attempt_at) <= Date.now())
  ));

  if (job.job_type === AV_JOB_SEND) {
    const activeTestEmail = String(job.test_email || getAvBulletinTestEmail_() || '').trim();
    if (activeTestEmail !== String(job.test_email || '')) {
      job.test_email = activeTestEmail;
      updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
        test_email: activeTestEmail,
        updated_at: new Date()
      });
    }
    const remainingQuota = MailApp.getRemainingDailyQuota();
    updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
      remaining_quota: remainingQuota,
      heartbeat_at: new Date(),
      updated_at: new Date()
    });
    if (remainingQuota <= AV_JOB_QUOTA_RESERVE && pending.length) {
      updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
        status: 'WAITING_QUOTA',
        last_error: 'Quota diària de correu insuficient; el procés es reprendrà automàticament.',
        updated_at: new Date()
      });
      appendAvJobEvent_(infrastructure.events, job.job_id, '', 'QUOTA_WAIT', 'WAITING_QUOTA',
        'trigger', 'Quota diària insuficient.', { remainingQuota });
      refreshAvBatchJobSummary_(infrastructure, job);
      return;
    }
  }

  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const evaluation = getAvEvaluationForJob_(job);
  const context = {
    gradesSpreadsheet,
    evaluation,
    tutoriaRows: readAllTutoriaRows_(gradesSpreadsheet, evaluation.sheetName),
    evaluationTable: job.job_type === AV_JOB_GENERATE
      ? readEvaluationTable_(getRequiredSheet_(gradesSpreadsheet, evaluation.sheetName))
      : null
  };
  const batchLimit = job.job_type === AV_JOB_GENERATE ? AV_JOB_BATCH_GENERATE : AV_JOB_BATCH_SEND;
  let processed = 0;

  for (let index = 0; index < pending.length; index += 1) {
    if (processed >= batchLimit || Date.now() - startedAt >= AV_JOB_RUNTIME_MS) break;
    const item = pending[index];
    updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
      current_group: item.group_name,
      current_student: item.student_full_name,
      heartbeat_at: new Date(),
      updated_at: new Date()
    });
    if (job.job_type === AV_JOB_GENERATE) {
      processAvGenerationItem_(infrastructure, job, item, context);
    } else {
      processAvEmailItem_(infrastructure, job, item, context);
    }
    processed += 1;
  }
  refreshAvBatchJobSummary_(infrastructure, job);
}

function processAvGenerationItem_(infrastructure, job, item, context) {
  const attempt = Number(item.attempt_count || 0) + 1;
  const started = new Date();
  updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
    status: 'RUNNING', attempt_count: attempt, started_at: item.started_at || started,
    updated_at: started, last_error: ''
  });
  try {
    const tutoriaRow = context.tutoriaRows.find(row => row.sheetRow === Number(item.tutoria_row));
    if (!tutoriaRow) throw new Error('La fila de tutoria ja no existeix.');
    if (tutoriaRow.bulletinUrl) {
      updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
        status: 'SKIPPED_ALREADY_EXISTS', bulletin_url: tutoriaRow.bulletinUrl,
        finished_at: new Date(), updated_at: new Date()
      });
      return;
    }
    const result = generateAndStoreClosedBulletin_(Object.assign({}, context, {
      selectedGroup: item.group_name
    }), tutoriaRow);
    updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
      status: 'COMPLETED', bulletin_url: result.bulletinUrl,
      finished_at: new Date(), updated_at: new Date()
    });
    appendAvJobEvent_(infrastructure.events, job.job_id, item.item_id, 'PDF_GENERATED',
      'COMPLETED', 'trigger', `Butlletí generat per a ${item.student_full_name}.`, {
        group: item.group_name,
        url: result.bulletinUrl
      });
  } catch (error) {
    handleAvItemFailure_(infrastructure, job, item, attempt, error);
  }
}

function processAvEmailItem_(infrastructure, job, item, context) {
  const attempt = Number(item.attempt_count || 0) + 1;
  try {
    const tutoriaRow = context.tutoriaRows.find(row => row.sheetRow === Number(item.tutoria_row));
    if (!tutoriaRow) throw new Error('La fila de tutoria ja no existeix.');
    const bulletinUrl = tutoriaRow.bulletinUrl || item.bulletin_url;
    if (!bulletinUrl) {
      updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
        status: 'BLOCKED_MISSING_PDF', attempt_count: attempt,
        last_error: 'Cal generar el butlletí abans d\'enviar-lo.',
        finished_at: new Date(), updated_at: new Date()
      });
      return;
    }

    const testEmail = String(job.test_email || '').trim();
    const deliveryEmail = testEmail || item.intended_email;
    const email = buildBulletinEmail_({ evaluation: context.evaluation }, Object.assign({}, tutoriaRow, {
      bulletinUrl
    }));
    const testPrefix = testEmail ? `[PROVA per a ${item.intended_email}] ` : '';
    const reference = `Referència d'auditoria: ${item.dispatch_token}`;
    const htmlBody = `${email.htmlBody}<p style="font-size:9px;color:#666">${escapeHtml_(reference)}</p>`;
    const textBody = buildAvBulletinTextBody_(context.evaluation, tutoriaRow, bulletinUrl, reference);
    const draft = GmailApp.createDraft(deliveryEmail, `${testPrefix}${email.subject}`, textBody, {
      htmlBody,
      name: 'Institut Ernest Lluch i Martín'
    });
    updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
      status: 'SENDING', attempt_count: attempt, delivery_email: deliveryEmail,
      bulletin_url: bulletinUrl, draft_id: draft.getId(), started_at: item.started_at || new Date(),
      updated_at: new Date(), last_error: ''
    });
    const message = draft.send();
    finishAvSentItem_(infrastructure, job, item, tutoriaRow, message.getId(), deliveryEmail,
      testEmail, context.gradesSpreadsheet);
  } catch (error) {
    handleAvItemFailure_(infrastructure, job, item, attempt, error);
  }
}

function recoverAvSendingItems_(infrastructure, job, items) {
  const sendingItems = items.filter(item => item.status === 'SENDING');
  if (!sendingItems.length) return;
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const tutoriaRows = readAllTutoriaRows_(gradesSpreadsheet, job.evaluation_sheet);
  sendingItems.forEach(item => {
    try {
      let draft = null;
      try {
        draft = item.draft_id ? GmailApp.getDraft(item.draft_id) : null;
      } catch (ignored) {
        draft = null;
      }
      if (draft) {
        const message = draft.send();
        const tutoriaRow = tutoriaRows.find(row => row.sheetRow === Number(item.tutoria_row));
        finishAvSentItem_(infrastructure, job, item, tutoriaRow, message.getId(),
          item.delivery_email, job.test_email, gradesSpreadsheet);
        return;
      }
      const threads = GmailApp.search(`in:sent "${item.dispatch_token}"`, 0, 5);
      const messages = threads.reduce((all, thread) => all.concat(thread.getMessages()), []);
      if (messages.length === 1) {
        const tutoriaRow = tutoriaRows.find(row => row.sheetRow === Number(item.tutoria_row));
        finishAvSentItem_(infrastructure, job, item, tutoriaRow, messages[0].getId(),
          item.delivery_email, job.test_email, gradesSpreadsheet);
      } else {
        updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
          status: 'NEEDS_REVIEW',
          last_error: 'No es pot confirmar si el missatge es va enviar; no es reenviarà automàticament.',
          finished_at: new Date(), updated_at: new Date()
        });
        appendAvJobEvent_(infrastructure.events, job.job_id, item.item_id, 'DELIVERY_UNCERTAIN',
          'NEEDS_REVIEW', 'trigger', 'Enviament incert; cal revisió manual.', {});
      }
    } catch (error) {
      updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
        status: 'NEEDS_REVIEW', last_error: String(error && error.message || error),
        finished_at: new Date(), updated_at: new Date()
      });
    }
  });
}

function finishAvSentItem_(infrastructure, job, item, tutoriaRow, messageId, deliveryEmail, testEmail, gradesSpreadsheet) {
  if (!testEmail && tutoriaRow) {
    const slot = Number(item.contact_position) === 2 ? 2 : 1;
    const contact = { email: item.intended_email };
    const updates = {};
    updates[`email_${slot}`] = item.intended_email;
    updates[`enviat_email_${slot}`] = buildSentMarker_(contact);
    updateTutoriaCells_(gradesSpreadsheet, job.evaluation_sheet,
      Number(item.tutoria_row), updates);
  }
  const status = testEmail ? 'TEST_SENT' : 'SENT';
  updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
    status,
    delivery_email: deliveryEmail,
    message_id: messageId,
    finished_at: new Date(),
    updated_at: new Date(),
    last_error: ''
  });
  appendAvJobEvent_(infrastructure.events, job.job_id, item.item_id, 'EMAIL_SENT', status,
    'trigger', `${testEmail ? 'Correu de prova' : 'Correu'} enviat per a ${item.student_full_name}.`, {
      intendedEmail: item.intended_email,
      deliveryEmail,
      messageId,
      contactPosition: item.contact_position
    });
}

function handleAvItemFailure_(infrastructure, job, item, attempt, error) {
  const message = String(error && error.message || error);
  const retry = attempt < AV_JOB_MAX_ATTEMPTS;
  updateAvTableObject_(infrastructure.items, AV_JOB_ITEM_HEADERS, item._row, {
    status: retry ? 'PENDING' : 'FAILED',
    attempt_count: attempt,
    last_error: message,
    next_attempt_at: retry ? new Date(Date.now() + 60000 * attempt) : '',
    finished_at: retry ? '' : new Date(),
    updated_at: new Date()
  });
  appendAvJobEvent_(infrastructure.events, job.job_id, item.item_id,
    retry ? 'ITEM_RETRY_SCHEDULED' : 'ITEM_FAILED', retry ? 'PENDING' : 'FAILED',
    'trigger', message, { attempt });
}

function refreshAvBatchJobSummary_(infrastructure, job) {
  const items = readAvTableObjects_(infrastructure.items, AV_JOB_ITEM_HEADERS)
    .filter(item => item.job_id === job.job_id);
  const pending = items.filter(item => ['PENDING', 'RUNNING', 'SENDING'].includes(item.status)).length;
  const success = items.filter(item => ['COMPLETED', 'SENT', 'TEST_SENT'].includes(item.status)).length;
  const skipped = items.filter(item => isAvSkippedItemStatus_(item.status)).length;
  const failed = items.filter(item => isAvFailedItemStatus_(item.status)).length;
  const needsReview = items.filter(item => item.status === 'NEEDS_REVIEW').length;
  const completed = pending === 0;
  const finalStatus = completed
    ? (failed || needsReview ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED')
    : 'QUEUED';
  const updates = {
    status: finalStatus,
    total_items: items.length,
    pending_items: pending,
    processed_items: items.length - pending,
    success_items: success,
    skipped_items: skipped,
    failed_items: failed,
    needs_review_items: needsReview,
    heartbeat_at: new Date(),
    current_group: completed ? '' : job.current_group,
    current_student: completed ? '' : job.current_student,
    finished_at: completed ? new Date() : '',
    updated_at: new Date()
  };
  updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, updates);
  if (completed) {
    appendAvJobEvent_(infrastructure.events, job.job_id, '', 'JOB_FINISHED', finalStatus,
      'trigger', `Procés finalitzat: ${success} correctes, ${skipped} omesos i ${failed + needsReview} incidències.`, {});
  }
}

function buildClosedBatchPlan_(payload) {
  const action = String(payload && payload.action || '').trim().toLowerCase();
  const scope = String(payload && payload.scope || 'group').trim().toLowerCase();
  const selectedGroup = String(payload && payload.group || '').trim();
  if (!['generate', 'send'].includes(action)) throw new Error('Acció massiva no vàlida.');
  if (!['group', 'all'].includes(scope)) throw new Error('Àmbit massiu no vàlid.');
  if (scope === 'group' && !selectedGroup) throw new Error('Cal seleccionar un grup.');

  const evaluation = getAvailableEvaluationFromPayload_(payload);
  if (!isEvaluationClosed_(evaluation)) {
    throw new Error('Els processos massius només estan disponibles amb una avaluació tancada.');
  }
  const gradesSpreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  const allRows = dedupeAvTutoriaRows_(readAllTutoriaRows_(gradesSpreadsheet, evaluation.sheetName));
  const rows = scope === 'all'
    ? allRows
    : allRows.filter(row => rowIncludesGroup_(row, selectedGroup));
  if (!rows.length) throw new Error('No hi ha alumnes per processar en aquest àmbit.');

  const contactsByStudent = action === 'send' ? readAvContactsByStudent_() : new Map();
  const items = buildAvBatchItems_(action, rows, contactsByStudent);
  return {
    action,
    jobType: action === 'generate' ? AV_JOB_GENERATE : AV_JOB_SEND,
    scope,
    selectedGroup: scope === 'group' ? selectedGroup : '',
    evaluation,
    rows,
    items,
    testEmail: getAvBulletinTestEmail_()
  };
}

function buildAvBatchItems_(action, rows, contactsByStudent) {
  const items = [];
  rows.forEach(row => {
    const base = {
      group_name: row.tutoringGroup,
      tutoria_row: row.sheetRow,
      student_account_id: row.studentAccountId,
      student_full_name: row.studentFullName,
      bulletin_url: row.bulletinUrl
    };
    if (action === 'generate') {
      items.push(Object.assign({}, base, {
        status: row.bulletinUrl ? 'SKIPPED_ALREADY_EXISTS' : 'PENDING'
      }));
      return;
    }
    if (!row.bulletinUrl) {
      items.push(Object.assign({}, base, { status: 'BLOCKED_MISSING_PDF' }));
      return;
    }
    const contacts = (contactsByStudent.get(String(row.studentAccountId || '').trim()) || [])
      .filter(contact => contact.email)
      .slice(0, 2);
    if (!contacts.length) {
      items.push(Object.assign({}, base, {
        status: 'FAILED',
        last_error: 'No hi ha cap correu de contacte disponible.'
      }));
      return;
    }
    contacts.forEach((contact, index) => {
      const sentMarker = index === 0 ? row.sentEmail1 : row.sentEmail2;
      items.push(Object.assign({}, base, {
        contact_position: index + 1,
        contact_id: contact.id,
        contact_name: contact.name,
        intended_email: contact.email,
        status: sentMarker ? 'SKIPPED_ALREADY_SENT' : 'PENDING'
      }));
    });
  });
  return items;
}

function summarizeClosedBatchPlan_(plan) {
  const pending = plan.items.filter(item => item.status === 'PENDING').length;
  const skipped = plan.items.filter(item => isAvSkippedItemStatus_(item.status)).length;
  const blocked = plan.items.filter(item => isAvFailedItemStatus_(item.status)).length;
  return {
    action: plan.action,
    scope: plan.scope,
    group: plan.selectedGroup,
    evaluationName: plan.evaluation.name,
    studentCount: plan.rows.length,
    itemCount: plan.items.length,
    pendingCount: pending,
    skippedCount: skipped,
    blockedCount: blocked,
    testEmail: plan.testEmail
  };
}

function readAvContactsByStudent_() {
  const sheet = getRequiredSheet_(openLogicalTableSpreadsheet_(DINANTIA_TABLE_NAME), CONTACTS_CACHE_SHEET_NAME);
  const result = new Map();
  readRowsByHeader_(sheet).forEach(row => {
    const studentId = String(getField_(row, 'student_id') || '').trim();
    if (!studentId) return;
    if (!result.has(studentId)) result.set(studentId, []);
    result.get(studentId).push({
      id: String(getField_(row, 'contact_id') || '').trim(),
      position: Number(getField_(row, 'contact_position')) || 999,
      name: String(getField_(row, 'contact_name') || '').trim(),
      email: String(getField_(row, 'contact_email') || '').trim()
    });
  });
  result.forEach(contacts => contacts.sort((a, b) => a.position - b.position));
  return result;
}

function dedupeAvTutoriaRows_(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = `${normalizeGroupMatch_(row.tutoringGroup)}|${row.studentAccountId || normalizeText_(row.studentFullName)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureNoDuplicateActiveJob_(sheet, plan) {
  const duplicate = readAvTableObjects_(sheet, AV_JOB_HEADERS).find(job => (
    ['QUEUED', 'RUNNING', 'WAITING_QUOTA', 'PAUSED'].includes(job.status) &&
    job.job_type === plan.jobType &&
    job.evaluation_sheet === plan.evaluation.sheetName &&
    job.scope === plan.scope &&
    String(job.requested_group || '') === String(plan.selectedGroup || '')
  ));
  if (duplicate) throw new Error(`Ja hi ha un procés actiu amb aquest àmbit (${duplicate.job_id}).`);
}

function changeClosedBatchJobStatus_(payload, status) {
  assertAllowedUser_();
  assertAvSessionAdmin_();
  const jobId = String(payload && payload.jobId || '').trim();
  const infrastructure = ensureAvBatchInfrastructure_();
  const job = readAvTableObjects_(infrastructure.jobs, AV_JOB_HEADERS)
    .find(candidate => candidate.job_id === jobId);
  if (!job) throw new Error('No s\'ha trobat el procés.');
  updateAvTableObject_(infrastructure.jobs, AV_JOB_HEADERS, job._row, {
    status,
    updated_at: new Date()
  });
  appendAvJobEvent_(infrastructure.events, jobId, '', `JOB_${status}`, status,
    getActiveUserEmail_(), status === 'PAUSED' ? 'Procés pausat.' : 'Procés reprès.', {});
  if (status === 'QUEUED') ensureAvBatchWorkerTrigger_();
  return { jobId, status };
}

function assertAvSessionAdmin_() {
  const context = resolveUserVisibilityContext_();
  if (!context.isAdmin) throw new Error('Cal tenir permisos d\'administració per executar aquesta acció.');
  return context;
}

function getAvEvaluationForJob_(job) {
  const evaluation = readAvailableEvaluationRegisters_()
    .find(candidate => candidate.sheetName === job.evaluation_sheet);
  if (!evaluation || !isEvaluationClosed_(evaluation)) {
    throw new Error('L\'avaluació ja no està disponible en estat Tancada.');
  }
  return evaluation;
}

function getAvBulletinTestEmail_() {
  return String(PropertiesService.getScriptProperties()
    .getProperty(AV_BULLETIN_TEST_EMAIL_PROPERTY) || '').trim();
}

function buildAvBulletinTextBody_(evaluation, tutoriaRow, bulletinUrl, reference) {
  return [
    'Benvolguda família,',
    '',
    `Us fem arribar el butlletí de la sessió d'avaluació de ${tutoriaRow.studentFullName}, corresponent a l'avaluació ${evaluation.name}.`,
    '',
    'Podeu consultar-lo en aquest enllaç:',
    bulletinUrl,
    '',
    'Atentament,',
    'Institut Ernest Lluch i Martín',
    'Cunit',
    '',
    reference
  ].join('\n');
}

function ensureAvBatchInfrastructure_() {
  const spreadsheet = openLogicalTableSpreadsheet_(GRADES_TABLE_NAME);
  return {
    jobs: ensureAvTableSheet_(spreadsheet, AV_JOB_SHEET_NAME, AV_JOB_HEADERS),
    items: ensureAvTableSheet_(spreadsheet, AV_JOB_ITEM_SHEET_NAME, AV_JOB_ITEM_HEADERS),
    events: ensureAvTableSheet_(spreadsheet, AV_JOB_EVENT_SHEET_NAME, AV_JOB_EVENT_HEADERS)
  };
}

function ensureAvTableSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const lastColumn = sheet.getLastColumn();
  const existing = lastColumn
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim())
    : [];
  const normalized = new Set(existing.map(normalizeHeader_));
  const missing = headers.filter(header => !normalized.has(normalizeHeader_(header)));
  if (!existing.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function ensureAvBatchWorkerTrigger_() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === AV_BATCH_TRIGGER_HANDLER);
  if (!triggers.length) {
    ScriptApp.newTrigger(AV_BATCH_TRIGGER_HANDLER).timeBased().everyMinutes(1).create();
  }
  triggers.slice(1).forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function readAvTableObjects_(sheet, expectedHeaders) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(value => String(value || '').trim());
  const indexes = new Map(headers.map((header, index) => [normalizeHeader_(header), index]));
  return values.slice(1).map((row, offset) => {
    const result = { _row: offset + 2 };
    expectedHeaders.forEach(header => {
      const index = indexes.get(normalizeHeader_(header));
      result[header] = index === undefined ? '' : row[index];
    });
    return result;
  }).filter(result => expectedHeaders.some(header => result[header] !== '' && result[header] !== null));
}

function appendAvTableObjects_(sheet, headers, objects) {
  if (!objects.length) return;
  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(startRow, 1, objects.length, actualHeaders.length)
    .setValues(objects.map(object => actualHeaders.map(header => (
      object[header] === undefined ? '' : object[header]
    ))));
}

function updateAvTableObject_(sheet, headers, rowNumber, updates) {
  const actualHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
  const headerIndexes = new Map(actualHeaders.map((header, index) => [normalizeHeader_(header), index]));
  const row = sheet.getRange(rowNumber, 1, 1, actualHeaders.length).getValues()[0];
  Object.keys(updates || {}).forEach(header => {
    const index = headerIndexes.get(normalizeHeader_(header));
    if (index !== undefined) row[index] = updates[header];
  });
  sheet.getRange(rowNumber, 1, 1, actualHeaders.length).setValues([row]);
}

function appendAvJobEvent_(sheet, jobId, itemId, eventType, status, actor, message, details) {
  appendAvTableObjects_(sheet, AV_JOB_EVENT_HEADERS, [{
    timestamp: new Date(),
    job_id: jobId,
    item_id: itemId,
    event_type: eventType,
    status,
    actor: actor || '',
    message: message || '',
    details_json: JSON.stringify(details || {})
  }]);
}

function getAvBatchJobView_(job, items, testEmail) {
  const current = items.find(item => ['RUNNING', 'SENDING'].includes(item.status)) ||
    items.find(item => item.status === 'PENDING');
  return {
    jobId: job.job_id,
    type: job.job_type,
    status: job.status,
    scope: job.scope,
    group: job.requested_group,
    requestedBy: job.requested_by,
    createdAt: formatAvAuditValue_(job.created_at),
    heartbeatAt: formatAvAuditValue_(job.heartbeat_at),
    total: Number(job.total_items || items.length || 0),
    pending: Number(job.pending_items || 0),
    processed: Number(job.processed_items || 0),
    success: Number(job.success_items || 0),
    skipped: Number(job.skipped_items || 0),
    failed: Number(job.failed_items || 0),
    needsReview: Number(job.needs_review_items || 0),
    currentGroup: job.current_group || current && current.group_name || '',
    currentStudent: job.current_student || current && current.student_full_name || '',
    remainingQuota: job.remaining_quota === '' ? null : Number(job.remaining_quota),
    testEmail: String(testEmail || ''),
    lastError: String(job.last_error || '')
  };
}

function isAvSkippedItemStatus_(status) {
  return ['SKIPPED_ALREADY_EXISTS', 'SKIPPED_ALREADY_SENT'].includes(status);
}

function isAvFailedItemStatus_(status) {
  return ['FAILED', 'BLOCKED_MISSING_PDF'].includes(status);
}

function avDateValue_(value) {
  if (value instanceof Date) return value.getTime();
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatAvAuditValue_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Utilities.formatDate(value, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value === undefined || value === null ? '' : value);
}
