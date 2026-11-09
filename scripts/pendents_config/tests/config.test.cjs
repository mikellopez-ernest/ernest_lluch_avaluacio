const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function context() {
  const ctx = vm.createContext({
    Date,
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'test@iernestlluch.cat' }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, text) => crypto.createHash('sha256').update(text).digest(), base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Code.js'), 'utf8'), ctx);
  ctx.realReadAuditNames_ = ctx.readAuditNames_;
  ctx.readAuditNames_ = () => ({ 'test@iernestlluch.cat': 'Test Teacher' });
  return ctx;
}
const plain = value => JSON.parse(JSON.stringify(value));
const row = (overrides = {}) => ({ id: '', nivell: '1r ESO', assignatura: 'Matemàtiques', departament: '', criteris_recuperacio: '', ...overrides });

test('import deduplicates classes, handles ESO and BAT, and excludes unsupported groups', () => {
  const ctx = context();
  const result = plain(ctx.buildImportRows_([
    { group: '1ESOA,1ESOB,2ESOA', subject_full_name: ' Matemàtiques ' },
    { group: '1ESOC', subject_full_name: 'matemàtiques' },
    { group: '3A,4B', group_name: '3r ESO A,4t ESO B', subject_full_name: 'Optativa pròpia' },
    { group: '1A', group_name: '1r BAT A', subject_full_name: 'Batxillerat' },
    { group: '1BAT', subject_full_name: 'Batxillerat' },
    { group: '2ESOZ', subject_full_name: '' },
    { group: '2BATX,2BATY', subject_full_name: 'Batxillerat' },
    { group: '3BATX', subject_full_name: 'Invalid' }
  ]));
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(r => r.nivell), ['1r ESO', '2n ESO', '3r ESO', '4t ESO', '1r BAT', '2n BAT']);
  assert.equal(result[0].assignatura, 'Matemàtiques');
});

test('validation retains IDs and allocates IDs to new subjects without teacher fields', () => {
  const ctx = context();
  const existing = [row({ id: '8', criteris_recuperacio: 'Dossier' })];
  const saved = plain(ctx.validateConfigurationRows_([...existing, row({ nivell: '2n ESO' })], existing));
  assert.deepEqual(saved.map(r => r.id), ['8', '9']);
  assert.equal(saved[0].criteris_recuperacio, 'Dossier');
  assert.equal(Object.hasOwn(saved[0], 'professor'), false);
});

test('validation rejects duplicate pairs, invalid departments, levels, and unknown IDs', () => {
  const ctx = context();
  assert.throws(() => ctx.validateConfigurationRows_([row(), row({ assignatura: 'MATEMÀTIQUES' })], [], []), /duplicada/);
  assert.throws(() => ctx.validateConfigurationRows_([row({ departament: 'Invalid' })], [], []), /Departament/);
  assert.throws(() => ctx.validateConfigurationRows_([row({ nivell: '3r BAT' })], [], []), /nivell/);
  assert.throws(() => ctx.validateConfigurationRows_([row({ id: '99' })], [], []), /Identificador/);
});

test('every public data endpoint rejects unauthorized users before reading data', () => {
  const ctx = context();
  ctx.Session.getActiveUser = () => ({ getEmail: () => 'test@example.com' });
  for (const name of ['getPendentsConfigurationData', 'getPendentsImportData', 'savePendentsConfiguration', 'savePendentsRecoveryCriteria', 'grantPermissionsManually']) {
    assert.throws(() => ctx[name](), /Accés restringit/);
  }
});

test('a stale save releases its lock and does not write', () => {
  const ctx = context(); let released = false;
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() { released = true; } }) };
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => null });
  assert.throws(() => ctx.savePendentsConfiguration({ rows: [], revision: 'stale' }), /altre usuari/);
  assert.equal(released, true);
});

test('save creates the destination and persists rows from every level in one batch', () => {
  const ctx = context(); let written; let created; let released = false;
  const sheet = { getMaxRows: () => 1000, getMaxColumns: () => 26, getLastRow: () => written.length,
    getRange: () => ({ setValues(values) { written = plain(values); }, setNumberFormat() {} }), setFrozenRows() {} };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() { released = true; } }) };
  ctx.SpreadsheetApp = { flush() {} };
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => null, insertSheet(name) { created = name; return sheet; } });
  const result = ctx.savePendentsConfiguration({ rows: [row(), row({ nivell: '4t ESO', assignatura: '=formula', criteris_recuperacio: '  Dossier\nExamen  ' })], revision: ctx.revision_([]) });
  assert.equal(created, 'pendents_config');
  assert.equal(written.length, 3);
  assert.deepEqual(written[0], ['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio', 'updated_by', 'updated_at']);
  assert.equal(written[2][2], "'=formula");
  assert.equal(written[2][4], '  Dossier\nExamen  ');
  assert.equal(result.rows.length, 2);
  assert.equal(released, true);
});

test('import is limited to the designated account and rejects other domain users before reading', () => {
  const ctx = context();
  assert.equal(ctx.canImport_(), false);
  assert.throws(() => ctx.getPendentsImportData(), /permís per importar/);
  ctx.Session.getActiveUser = () => ({ getEmail: () => '  ADMINDOMINI@IERNESTLLUCH.CAT  ' });
  assert.equal(ctx.canImport_(), true);
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => ({
    getDataRange: () => ({ getValues: () => [['group', 'group_name', 'subject_full_name'], ['1ESOA', '1r ESO A', 'Matemàtiques']] }),
    getLastColumn: () => 3,
    getRange: () => ({ getValues: () => [['group', 'group_name', 'subject_full_name']] })
  }) });
  assert.equal(ctx.getPendentsImportData().length, 1);
});

test('bootstrap returns import capability for the active account', () => {
  const ctx = context();
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => null });
  assert.equal(ctx.getPendentsConfigurationData().canImport, false);
  ctx.Session.getActiveUser = () => ({ getEmail: () => 'admindomini@iernestlluch.cat' });
  assert.equal(ctx.getPendentsConfigurationData().canImport, true);
});

test('deleting all rows saves only headers and clears old records', () => {
  const ctx = context(); let written; let cleared;
  const existing = [row({ id: '1' }), row({ id: '2', nivell: '2n ESO' })];
  const sheet = { getMaxRows: () => 1000, getMaxColumns: () => 26, getLastRow: () => 3,
    getRange: (...range) => ({ setValues(values) { written = plain(values); }, setNumberFormat() {}, clearContent() { cleared = range; } }), setFrozenRows() {} };
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  ctx.SpreadsheetApp = { flush() {} };
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: name => name === 'pendents_config' ? sheet : null });
  ctx.readConfigurationRows_ = () => existing;
  const result = ctx.savePendentsConfiguration({ rows: [], revision: ctx.revision_(existing) });
  assert.equal(written.length, 1);
  assert.deepEqual(cleared, [2, 1, 2, 7]);
  assert.equal(result.rows.length, 0);
});


test('BAT level detection accepts class codes, ordinal names, case, and aligned short codes', () => {
  const ctx = context();
  for (const [code, name, expected] of [
    ['1BATX', '', '1r BAT'], ['2BATx', '', '2n BAT'],
    ['1r BAT X', '', '1r BAT'], ['2n BAT x', '', '2n BAT'],
    ['1X', '1r BAT X', '1r BAT'], ['2Y', '2n BAT Y', '2n BAT'],
    ['1A', '1r ESO A', '1r ESO'], ['4ESOA', '', '4t ESO'],
    ['3BATX', '', ''], ['2X', '1r BAT X', ''], ['1CFGA', '', '']
  ]) assert.equal(ctx.resolveLevel_(code, name), expected, code);
});

test('bootstrap offers both BAT levels and validation accepts new BAT subjects', () => {
  const ctx = context();
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => null });
  assert.deepEqual(plain(ctx.getPendentsConfigurationData().levels),
    ['1r ESO', '2n ESO', '3r ESO', '4t ESO', '1r BAT', '2n BAT']);
  const saved = plain(ctx.validateConfigurationRows_([
    row({ nivell: '1r BAT' }), row({ nivell: '2n BAT' })
  ], [], []));
  assert.equal(saved.length, 2);
});


test('five-column reading and validation preserve criteria whitespace and multiline text', () => {
  const ctx = context();
  const text = '  Presentar dossier\n\nExamen final.  ';
  const sheet = { getLastRow: () => 2, getDataRange: () => ({ getValues: () => [
    ['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio'],
    ['1', '1r BAT', 'Matemàtiques', '', text]
  ] }) };
  const existing = ctx.readConfigurationRows_(sheet);
  assert.equal(existing[0].criteris_recuperacio, text);
  assert.equal(ctx.validateConfigurationRows_(existing, existing, [])[0].criteris_recuperacio, text);
  const oldClient = plain(existing[0]); delete oldClient.criteris_recuperacio;
  assert.equal(ctx.validateConfigurationRows_([oldClient], existing, [])[0].criteris_recuperacio, text);
  assert.throws(() => ctx.validateRecoveryCriteria_({ text: 'wrong type' }), /text/);
  assert.throws(() => ctx.validateRecoveryCriteria_('a'.repeat(50001)), /50.000/);
  assert.equal(ctx.validateRecoveryCriteria_(''), '');
});

function criteriaContext() {
  const ctx = context(); let write; let released = false;
  const values = [
    ['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio', 'updated_by', 'updated_at'],
    ['1', '1r ESO', 'Matemàtiques', '', 'Existing criteria', '', ''],
    ['', '', '', '', '', '', ''],
    ['2', '2n BAT', 'Física', '', 'Other criteria', '', '']
  ];
  const sheet = { getLastRow: () => 4, getDataRange: () => ({ getValues: () => values }),
    getRange: (...range) => ({ setValues(values) { write = { range, values }; }, setNumberFormat() {} }) };
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: name => name === 'pendents_config' ? sheet : null });
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() { released = true; } }) };
  ctx.SpreadsheetApp = { flush() {} };
  return { ctx, sheet, getWrite: () => write, isReleased: () => released };
}

test('criteria-only save updates column E at the physical row and returns a fresh revision', () => {
  const fixture = criteriaContext(); const { ctx, sheet } = fixture;
  const rows = ctx.readConfigurationRows_(sheet);
  const result = ctx.savePendentsRecoveryCriteria({ id: '2', criteris_recuperacio: '=Literal\n  text ', revision: ctx.revision_(rows) });
  assert.deepEqual(fixture.getWrite().range, [4, 5, 1, 3]);
  assert.equal(fixture.getWrite().values[0][0], "'=Literal\n  text " );
  assert.equal(result.updated_by, 'test@iernestlluch.cat');
  assert.equal(result.updated_by_name, 'Test Teacher');
  assert.equal(result.criteris_recuperacio, '=Literal\n  text ');
  assert.notEqual(result.revision, ctx.revision_(rows));
  assert.equal(fixture.isReleased(), true);
});

test('criteria-only saves reject conflicts and unknown IDs without writing', () => {
  const fixture = criteriaContext(); const { ctx, sheet } = fixture;
  assert.throws(() => ctx.savePendentsRecoveryCriteria({ id: '2', criteris_recuperacio: '', revision: 'stale' }), /altre usuari/);
  assert.equal(fixture.getWrite(), undefined);
  assert.equal(fixture.isReleased(), true);
  assert.throws(() => ctx.savePendentsRecoveryCriteria({ id: '99', criteris_recuperacio: '', revision: ctx.revision_(ctx.readConfigurationRows_(sheet)) }), /identificador/);
  assert.equal(fixture.getWrite(), undefined);
});


test('table saves preserve blank audit fields and ignore client metadata', () => {
  const ctx = context();
  const old = [row({ id: '1', updated_by: 'original@iernestlluch.cat', updated_at: '2026-01-01T12:00:00.000Z' }), row({ id: '2', nivell: '2n ESO' })];
  const candidate = ctx.validateConfigurationRows_([
    { ...old[0], updated_by: 'forged', updated_at: 'forged' },
    { ...old[1], departament: 'Matemàtiques', updated_by: 'forged' },
    row({ nivell: '1r BAT' })
  ], old);
  ctx.applyAuditMetadata_(candidate, old);
  assert.equal(candidate[0].updated_by, old[0].updated_by);
  assert.equal(candidate[0].updated_at, old[0].updated_at);
  for (const index of [1, 2]) {
    assert.equal(candidate[index].updated_by, '');
    assert.equal(candidate[index].updated_at, '');
  }
});

test('legacy schema migration appends two audit headers without touching existing data', () => {
  const ctx = context(); let write;
  const values = [['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio'], ['1', '1r ESO', 'Matemàtiques', '', 'Dossier']];
  const sheet = { getLastRow: () => 2, getMaxColumns: () => 26,
    getDataRange: () => ({ getValues: () => values }),
    getRange: (...range) => ({ setValues(data) { write = { range, data: plain(data) }; values[0].push(...data[0]); } }) };
  ctx.ensureAuditColumns_(sheet);
  assert.deepEqual(write, { range: [1, 6, 1, 2], data: [['updated_by', 'updated_at']] });
  const rows = ctx.readConfigurationRows_(sheet);
  assert.equal(rows[0].criteris_recuperacio, 'Dossier');
  assert.equal(rows[0].updated_by, '');
  assert.equal(rows[0].updated_at, '');
});

test('Desar criteris initializes empty audit fields even when text is unchanged', () => {
  const fixture = criteriaContext(); const { ctx, sheet } = fixture;
  const revision = ctx.revision_(ctx.readConfigurationRows_(sheet));
  const result = ctx.savePendentsRecoveryCriteria({ id: '2', criteris_recuperacio: 'Other criteria', revision });
  assert.ok(fixture.getWrite());
  assert.notEqual(result.revision, revision);
  assert.equal(result.updated_by, 'test@iernestlluch.cat');
  assert.ok(!Number.isNaN(Date.parse(result.updated_at)));
});

test('audit names resolve institutional emails without requiring active teacher status', () => {
  const ctx = context();
  ctx.openLogicalTableSpreadsheet_ = () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => [
    ['ESP', 'DEPT.', 'NOM', 'COGNOM1', 'COGNOM2', 'CORREU INSTIT'],
    ['', '', 'Anna', 'Exemple', 'Segon', ' TEST@IERNESTLLUCH.CAT ']
  ] }) }) });
  assert.equal(ctx.realReadAuditNames_()['test@iernestlluch.cat'], 'Anna Exemple Segon');
});

test('dates serialize to ISO and display-only names do not affect revisions', () => {
  const ctx = context(); const date = new Date('2026-11-01T08:00:00.000Z');
  const sheet = { getLastRow: () => 2, getDataRange: () => ({ getValues: () => [
    ['id', 'nivell', 'assignatura', 'departament', 'criteris_recuperacio', 'updated_by', 'updated_at'],
    ['1', '1r ESO', 'Matemàtiques', '', '', 'test@iernestlluch.cat', date]
  ] }) };
  const rows = ctx.readConfigurationRows_(sheet);
  assert.equal(rows[0].updated_at, date.toISOString());
  assert.equal(ctx.revision_(rows), ctx.revision_(ctx.decorateAuditRows_(rows)));
});


test('later actual edits update already populated audit fields', () => {
  const ctx = context();
  const existing = [row({ id: '1', updated_by: 'original@iernestlluch.cat', updated_at: '2026-01-01T12:00:00.000Z' })];
  const changed = ctx.validateConfigurationRows_([{ ...existing[0], departament: 'Matemàtiques' }], existing);
  ctx.applyAuditMetadata_(changed, existing);
  assert.equal(changed[0].updated_by, 'test@iernestlluch.cat');
  assert.notEqual(changed[0].updated_at, existing[0].updated_at);
});

test('unchanged criteria retains populated audit metadata', () => {
  const fixture = criteriaContext(); const { ctx, sheet } = fixture;
  const values = sheet.getDataRange().getValues();
  values[3][5] = 'original@iernestlluch.cat'; values[3][6] = new Date('2026-01-01T12:00:00.000Z');
  const revision = ctx.revision_(ctx.readConfigurationRows_(sheet));
  const result = ctx.savePendentsRecoveryCriteria({ id: '2', criteris_recuperacio: 'Other criteria', revision });
  assert.equal(fixture.getWrite(), undefined);
  assert.equal(result.revision, revision);
  assert.equal(result.updated_by, 'original@iernestlluch.cat');
});


test('new subjects do not reuse an ID still referenced by the student cache', () => {
  const ctx = context();
  const rows = ctx.validateConfigurationRows_([row({ nivell: '1r BAT' })], [row({ id: '2' })], 9);
  assert.equal(rows[0].id, '10');
});

test('department choices and validation share defaults plus saved column D values, with Unicode normalization', () => {
  const ctx = context();
  const existing = [row({id:'1',departament:'Educació Física'}),row({id:'2',nivell:'2n ESO',departament:'  Arts escèniques  '})];
  const choices = plain(ctx.configurationDepartments_(existing));
  assert.ok(choices.includes('Educació Física'));assert.ok(choices.includes('Arts escèniques'));assert.ok(choices.includes('Matemàtiques'));
  const saved = plain(ctx.validateConfigurationRows_([...existing,row({nivell:'3r ESO',departament:'Arts escèniques'.normalize('NFD')})],existing));
  assert.equal(saved[2].departament,'Arts escèniques');assert.equal(saved[1].departament,'Arts escèniques');
  assert.throws(()=>ctx.validateConfigurationRows_([row({departament:'Not in sheet or list'})],existing),/fila 1: Not in sheet or list/);
});

test('new subject saves when another saved row has a department outside the original fixed list', () => {
  const ctx = context();let written;
  const existing = [row({id:'1',departament:'Educació Física'})];
  const sheet = {getMaxRows:()=>1000,getMaxColumns:()=>26,getLastRow:()=>written ? written.length : 2,
    getRange:()=>({setValues(values){written=plain(values);},setNumberFormat(){}}),setFrozenRows(){}};
  ctx.SpreadsheetApp={flush(){}};
  ctx.openLogicalTableSpreadsheet_=()=>({getSheetByName:name=>name==='pendents_config'?sheet:null});
  ctx.readConfigurationRows_=()=>existing;ctx.ensureAuditColumns_=()=>{};
  const bootstrap=ctx.getPendentsConfigurationData();
  assert.ok(bootstrap.departments.includes('Educació Física'));
  for (const department of ['Matemàtiques','Educació Física']) {
    const result=ctx.savePendentsConfiguration({rows:[...existing,row({assignatura:'Nova matèria',departament:department})],revision:ctx.revision_(existing)});
    assert.equal(result.rows.length,2);assert.equal(written[2][3],department);assert.equal(written[1][3],'Educació Física');
  }
});
