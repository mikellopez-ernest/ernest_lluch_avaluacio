const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const plain = value => JSON.parse(JSON.stringify(value));
const student = (id, name, group = '2n ESO A', email = 'example@school.test') => ({ id, name, group, email });
const subject = (id, name = 'Matemàtiques', level = '1r ESO') => ({ id, name, level });
const source = (sourceRow = 2, name = 'Anna Exemple', group = '2n ESO A', subject = 'Matemàtiques 1r') => ({ sourceRow, name, group, subject });
function context(email = 'admindomini@iernestlluch.cat') {
  const ctx = vm.createContext({ Date, Session: { getActiveUser: () => ({ getEmail: () => email }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, SpreadsheetApp: { flush() {} },
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, computeDigest: (_, text) => crypto.createHash('sha256').update(text).digest(), base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') } });
  for (const name of ['Code.js','Students.js','ImportAliases.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),ctx);
  return ctx;
}
function sheet(initial = []) {
  const data = initial.map(row => row.slice());
  return { data, getLastRow: () => data.length, getMaxRows: () => 1000, getMaxColumns: () => 26, setFrozenRows() {},
    getDataRange: () => ({ getValues: () => data }),
    getRange: (r,c,nr=1,nc=1) => ({
      getValues: () => Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>data[r-1+i]?.[c-1+j]??'')),
      setValues(values) { values.forEach((row,i)=>{data[r-1+i]||=[];row.forEach((value,j)=>{data[r-1+i][c-1+j]=value;});}); },
      clearContent() { for(let i=0;i<nr;i++)for(let j=0;j<nc;j++)if(data[r-1+i])data[r-1+i][c-1+j]='';while(data.length&&data.at(-1).every(cell=>cell===''))data.pop(); }
    }) };
}
const headers = ['id','student_id','student_name','student_email','student_group','subject_id','subject_name'];
function setup(email = 'admindomini@iernestlluch.cat') {
  const ctx = context(email); const destination = sheet(); const aliases = sheet();
  const students = sheet([['student_id','student_name','student_email','group_name','birthdate'],
    ['s1','Anna Exemple','anna@school.test','2n ESO A','DO NOT RETURN'],['s2','Marc Exemple','marc@school.test','2n ESO B','DO NOT RETURN']]);
  const subjects = sheet([['id','nivell','assignatura','departament','criteris_recuperacio'],[1,'1r ESO','Matemàtiques','',''],[2,'2n ESO','Matemàtiques','','']]);
  const grades = { getSheetByName: name => name==='pendents_config'?subjects:name==='pendents_students_cache'?(destination.data.length?destination:null):name==='pendents_import_aliases'?(aliases.data.length?aliases:null):null,
    insertSheet: name => {assert.ok(['pendents_students_cache','pendents_import_aliases'].includes(name));return name==='pendents_students_cache'?destination:aliases;} };
  ctx.openLogicalTableSpreadsheet_ = name => name==='Grades'?grades:{getSheetByName:name=>name==='students_cache'?students:null};
  return {ctx,destination,students,subjects,aliases};
}
function payload(preview, studentKey = preview.rows[0].studentId) {
  return {pairs:[{studentId:studentKey,subjectId:'1'}],sourceRevision:preview.sourceRevision,cacheRevision:preview.cacheRevision,aliasesRevision:preview.aliasesRevision};
}

test('names and Esfera group prefixes normalize without confusing homonyms',()=>{
  const ctx=context();
  const result=ctx.buildStudentImportPreview_([source(2,'Exemple, Ànna','ESO LOE 2 A 2N ESO A'),source(3,'Marc Igual','2n ESO A','Matemàtiques'),source(4,'Anna Exemple','2n ESO C')],
    [student('a','Anna Exemple'),student('b','Anna Exemple','2n ESO B'),student('x','Marc Igual'),student('y','Marc Igual')],[subject('1'),subject('2','Matemàtiques','2n ESO')]);
  assert.equal(result.rows[0].studentId,'a');assert.equal(result.rows[0].subjectId,'1');
  assert.equal(result.rows[1].studentId,'');assert.equal(result.rows[1].subjectId,'');assert.equal(result.rows[2].studentId,'');
});
test('subject level comes from the pending subject suffix, not the current student year',()=>{
  const ctx=context(); const result=ctx.buildStudentImportPreview_([source(),source(3,'Anna Exemple','2n ESO A','Mates 1r'),source(4,'Anna Exemple','2n ESO A','Lectura 1'),source(5,'Anna Exemple','2n ESO A','')],
    [student('a','Anna Exemple')],[subject('1'),subject('2','Matemàtiques','2n ESO'),subject('3','Lectura')]);
  assert.equal(result.rows[0].subjectId,'1');assert.equal(result.rows[1].subjectId,'');assert.equal(result.rows[2].subjectId,'3');assert.equal(result.skippedNoSubject,1);
});
test('BAT parsing and unresolved names do not create arbitrary matches',()=>{
  const ctx=context();const result=ctx.buildStudentImportPreview_([source(2,'Unknown','2n BAT X','Matemàtiques 1r BAT'),source(3,'李 明','2n BAT X','Projecte PCT'),source(4,'李 明','2n BAT X','Matemàtiques 1r BAT')],
    [student('x','李 明','2n BAT X')],[subject('1','Matemàtiques','1r BAT'),subject('2','Projecte PCT','1r BAT'),subject('3','Projecte PCT','2n BAT')]);
  assert.equal(result.rows[0].studentId,'');assert.equal(result.rows[0].subjectId,'1');assert.equal(result.rows[1].studentId,'x');assert.equal(result.rows[1].subjectId,'');assert.equal(result.rows[2].subjectId,'1');
});
test('upsert refreshes existing pairs, preserves unrelated rows and IDs, adds missing pairs, and deduplicates imports',()=>{
  const ctx=context();const existing=[{id:'4',student_id:'a',student_name:'Old',student_email:'',student_group:'Old',subject_id:'1',subject_name:'Old'},
    {id:'9',student_id:'b',student_name:'Unrelated',student_email:'',student_group:'Other',subject_id:'1',subject_name:'Matemàtiques'}];
  const result=plain(ctx.mergeStudentPendingRows_(existing,[{studentId:'a',subjectId:'1'},{studentId:'a',subjectId:'2'},{studentId:'a',subjectId:'2'}],[student('a','Anna Exemple')],[subject('1'),subject('2','Català')]));
  assert.equal(result.rows.length,3);assert.equal(result.added,1);assert.equal(result.updated,1);assert.equal(result.duplicates,1);
  assert.equal(result.rows.find(row=>row.student_id==='a'&&row.subject_id==='1').id,'4');assert.equal(result.rows.find(row=>row.subject_id==='2').id,'10');assert.equal(result.rows.find(row=>row.id==='9').student_name,'Unrelated');
  assert.throws(()=>ctx.mergeStudentPendingRows_(existing,[{studentId:'missing',subjectId:'1'}],[],[]),/vàlids/);
});
test('cache is created with exact headers and catalogs expose only the authorized identity fields',()=>{
  const {ctx,destination}=setup();const data=ctx.getPendentsStudentsData();assert.deepEqual(destination.data[0],headers);assert.equal(data.rows.length,0);
  const catalogs=plain(ctx.readStudentImportCatalogs_());assert.deepEqual(Object.keys(catalogs.students[0]).sort(),['email','group','id','key','multipleEntries','name','needsReview']);assert.ok(!JSON.stringify(catalogs).includes('DO NOT RETURN'));
});
test('commit revalidates both sources and destination before writing and is idempotent on repeated imports',()=>{
  const {ctx,destination,students}=setup();const preview=ctx.previewPendentsStudentsImport({rows:[source()]});const request=payload(preview);
  students.data[1][2]='changed@school.test';assert.throws(()=>ctx.commitPendentsStudentsImport(request),/dades d’alumnes/);assert.equal(destination.data.length,1);
  students.data[1][2]='anna@school.test';const result=ctx.commitPendentsStudentsImport(request);assert.equal(result.added,1);assert.equal(result.rows[0].student_email,'anna@school.test');
  assert.throws(()=>ctx.commitPendentsStudentsImport(request),/taula ha canviat/);
  const second=ctx.commitPendentsStudentsImport(payload(ctx.previewPendentsStudentsImport({rows:[source()]})));assert.equal(second.added,0);assert.equal(second.updated,1);assert.equal(second.rows[0].id,result.rows[0].id);
});
test('school accounts can select and import student files, while outside accounts are rejected',()=>{
  const {ctx}=setup('teacher@iernestlluch.cat');assert.equal(ctx.getPendentsStudentsData().canImport,true);
  assert.equal(ctx.commitPendentsStudentsImport(payload(ctx.previewPendentsStudentsImport({rows:[source()]}))).added,1);
  const outside=context('user@outside.test');assert.throws(()=>outside.getPendentsStudentsData(),/Accés restringit/);assert.throws(()=>outside.previewPendentsStudentsImport({}),/Accés restringit/);assert.throws(()=>outside.commitPendentsStudentsImport({}),/Accés restringit/);
});
test('input bounds and an incompatible destination fail without replacing data',()=>{
  const ctx=context();assert.throws(()=>ctx.validateStudentImportSource_([]),/20.000/);assert.throws(()=>ctx.validateStudentImportSource_([{name:123,group:'',subject:''}]),/incorrecte/);assert.throws(()=>ctx.readStudentPendingRows_(sheet([['wrong'],['keep me']])),/Columnes/);
});
test('compacting an existing cache with blank physical rows clears the old tail',()=>{
  const {ctx,destination}=setup();destination.data.push(headers,['1','s1','Anna Exemple','anna@school.test','2n ESO A','1','Matemàtiques'],['','','','','','',''],['2','s2','Marc Exemple','marc@school.test','2n ESO B','2','Matemàtiques']);
  ctx.commitPendentsStudentsImport(payload(ctx.previewPendentsStudentsImport({rows:[source()]})));assert.equal(destination.data.length,3);assert.equal(ctx.readStudentPendingRows_(destination).length,2);
});
test('repeated student IDs across groups remain usable and match the source class',()=>{
  const {ctx,students}=setup();students.data.push(['s1','Anna Exemple','anna@school.test','Optativa de centre','IGNORED'],['s1','ÀNNA EXEMPLE','ANNA@school.test','ESO LOE 2 A 2N ESO A','IGNORED']);
  assert.equal(ctx.readStudentImportCatalogs_().students.filter(student=>student.id==='s1').length,2);
  const preview=ctx.previewPendentsStudentsImport({rows:[source()]});assert.ok(preview.rows[0].studentId);assert.equal(preview.issues,0);
  const result=ctx.commitPendentsStudentsImport(payload(preview));assert.equal(result.rows[0].student_id,'s1');assert.equal(result.rows[0].student_group,'2n ESO A');
});
test('complementary blank emails are consolidated without creating a conflict',()=>{
  const ctx=context();const choices=ctx.consolidateStudentChoices_([student('s1','Anna Exemple','2n ESO A',''),student('s1','Anna Exemple','2n ESO A','anna@school.test')]);
  assert.equal(choices.length,1);assert.equal(choices[0].email,'anna@school.test');assert.equal(choices[0].needsReview,false);
});
test('conflicting emails for a duplicated ID go to review and the chosen variant is persisted',()=>{
  const {ctx,students}=setup();students.data.push(['s1','Anna Exemple','another@school.test','2n ESO A','IGNORED']);const preview=ctx.previewPendentsStudentsImport({rows:[source()]});
  assert.equal(preview.rows[0].studentId,'');assert.equal(preview.issues,1);assert.match(preview.rows[0].studentIssue,/noms o correus diferents/);
  const choices=preview.students.filter(student=>student.id==='s1');assert.equal(choices.length,2);assert.notEqual(choices[0].key,choices[1].key);
  const result=ctx.commitPendentsStudentsImport(payload(preview,choices.find(student=>student.email==='another@school.test').key));assert.equal(result.rows[0].student_id,'s1');assert.equal(result.rows[0].student_email,'another@school.test');
});
test('different names for one ID require review instead of choosing one arbitrarily',()=>{
  const ctx=context();const choices=ctx.consolidateStudentChoices_([student('s1','Anna Exemple'),student('s1','Altra Persona')]);assert.equal(ctx.buildStudentImportPreview_([source()],choices,[subject('1')]).rows[0].studentId,'');
});
test('different variants for the same student-subject pair cannot silently overwrite each other',()=>{
  const ctx=context();const choices=ctx.consolidateStudentChoices_([student('s1','Anna Exemple','2n ESO A'),student('s1','Anna Exemple','Optativa')]);
  assert.throws(()=>ctx.mergeStudentPendingRows_([],[{studentId:choices[0].key,subjectId:'1'},{studentId:choices[1].key,subjectId:'1'}],choices,[subject('1')]),/entrades d’alumne diferents/);
});
test('rows missing any required XLSX cell are skipped before matching',()=>{
  const ctx=context();const input=ctx.validateStudentImportSource_([source(2,'  '),source(3,'Anna Exemple',''),source(4,'Anna Exemple','2n ESO A',' '),source(5)]);
  const result=ctx.buildStudentImportPreview_(input,[student('s1','Anna Exemple')],[subject('1')]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].sourceRow,5);assert.equal(result.skippedIncomplete,3);assert.equal(result.skippedNoSubject,1);assert.equal(result.issues,0);
});
test('an import with only incomplete rows needs no catalog reads and returns no assignments',()=>{
  const ctx=context();ctx.readStudentImportCatalogs_=()=>{throw new Error('Must not read catalogs');};const result=ctx.previewPendentsStudentsImport({rows:[source(2,'Anna Exemple','')]});assert.equal(result.rows.length,0);assert.equal(result.skippedIncomplete,1);
});
test('complete rows with missing matches are retained for correction, alongside matched records',()=>{
  const ctx=context();const result=ctx.buildStudentImportPreview_([source(2,'Unknown Person'),source(3,'Anna Exemple','2n ESO A','Unknown Subject 1r'),source(4,'Anna Exemple','2n ESO A','Matemàtiques 3r'),source(5,'Anna Exemple','2n ESO B'),source(6)], [student('s1','Anna Exemple')],[subject('1')]);
  assert.equal(result.rows.length,5);assert.equal(result.issues,4);assert.equal(result.rows[0].studentId,'');assert.equal(result.rows[1].subjectId,'');assert.equal(result.rows[4].studentId,'s1');assert.equal(result.rows[4].subjectId,'1');
});
test('subject review grouping keeps explicit levels and unknown-year cohorts distinct',()=>{
  const ctx=context();const result=ctx.buildStudentImportPreview_([source(2,'Anna Exemple','2n ESO A','Projecte PCT'),source(3,'Marc Exemple','2n ESO B','Projecte PCT'),source(4,'Pau Exemple','3r ESO A','Projecte PCT'),source(5,'Anna Exemple','2n ESO A','Projecte PCT 1r'),source(6,'Anna Exemple','2n ESO A','Projecte PCT 2n')],
    [student('a','Anna Exemple'),student('b','Marc Exemple','2n ESO B'),student('c','Pau Exemple','3r ESO A')],[subject('1')]);
  assert.equal(result.rows[0].subjectReviewKey,result.rows[1].subjectReviewKey);assert.notEqual(result.rows[0].subjectReviewKey,result.rows[2].subjectReviewKey);assert.notEqual(result.rows[3].subjectReviewKey,result.rows[4].subjectReviewKey);
});

function rememberRequest(ctx, sources, targetStudent = 's1', targetSubject = '1') {
  const preview = ctx.previewPendentsStudentsImport({rows:sources});
  const choice = preview.students.find(item=>item.id===targetStudent);
  const studentId = choice.key || choice.id;
  return {pairs:sources.map(()=>({studentId,subjectId:targetSubject})),sourceRevision:preview.sourceRevision,
    cacheRevision:preview.cacheRevision,aliasesRevision:preview.aliasesRevision,
    corrections:sources.map(row=>({...row,studentId,subjectId:targetSubject,rememberStudent:true,rememberSubject:true}))};
}
test('confirmed corrections persist once per group with audit fields and resolve the next import',()=>{
  const {ctx,aliases}=setup(); const sources=[source(2,'Anna del fitxer','2n ESO A','Mates 1r'),source(3,'Anna del fitxer','ESO LOE 2 A 2N ESO A','Mates 1r')];
  const request=rememberRequest(ctx,sources);assert.equal(aliases.data.length,1);
  const result=ctx.commitPendentsStudentsImport(request);assert.equal(result.aliasesSaved,2);assert.equal(aliases.data.length,3);
  const saved=ctx.readImportAliases_(aliases);assert.deepEqual(plain(saved.map(row=>row.kind)).sort(),['student','subject']);
  assert.ok(saved.every(row=>row.updated_by==='admindomini@iernestlluch.cat'&&!isNaN(Date.parse(row.updated_at))));
  const repeat=ctx.previewPendentsStudentsImport({rows:sources});assert.equal(repeat.issues,0);
  assert.ok(repeat.rows.every(row=>row.studentId===request.pairs[0].studentId&&row.subjectId==='1'));
  assert.equal(ctx.commitPendentsStudentsImport({...request,sourceRevision:repeat.sourceRevision,cacheRevision:repeat.cacheRevision,aliasesRevision:repeat.aliasesRevision,corrections:[]}).aliasesSaved,0);
  assert.equal(aliases.data.length,3);
});
test('saved mappings respect subject levels, missing-level cohorts, and student class groups',()=>{
  const {ctx}=setup();ctx.commitPendentsStudentsImport(rememberRequest(ctx,[source(2,'Alias Anna','2n ESO A','Mates 1r')]));
  const p=ctx.previewPendentsStudentsImport({rows:[source(2,'Alias Anna','2n ESO B','Mates 1r'),source(3,'Alias Anna','2n ESO A','Mates 2n')]});
  assert.equal(p.rows[0].studentId,'');assert.equal(p.rows[0].subjectId,'1');assert.ok(p.rows[1].studentId);assert.equal(p.rows[1].subjectId,'');
  ctx.commitPendentsStudentsImport(rememberRequest(ctx,[source(2,'Alias Anna','2n ESO A','Projecte')]));
  const unknown=ctx.previewPendentsStudentsImport({rows:[source(2,'Alias Anna','3r ESO A','Projecte')]});assert.equal(unknown.rows[0].subjectId,'');
});
test('changed or removed canonical targets return to review and explicit matches take precedence',()=>{
  const {ctx,students,subjects}=setup();const src=[source(2,'Alias Anna','2n ESO A','Mates 1r')];
  ctx.commitPendentsStudentsImport(rememberRequest(ctx,src));
  students.data[1][2]='new@school.test';subjects.data[1][2]='Matemàtiques noves';
  let p=ctx.previewPendentsStudentsImport({rows:src});assert.equal(p.rows[0].studentId,'');assert.equal(p.rows[0].subjectId,'');
  students.data.push(['s3','Alias Anna','alias@school.test','2n ESO A']);subjects.data.push([3,'1r ESO','Mates','','']);
  p=ctx.previewPendentsStudentsImport({rows:src});assert.ok(p.rows[0].studentId);assert.equal(p.rows[0].subjectId,'3');
  students.data.splice(1,1);subjects.data.splice(1,1); // Original targets removed; no stale fallback.
  p=ctx.previewPendentsStudentsImport({rows:[source(2,'Other name','2n ESO A','Other subject 1r')]});assert.equal(p.rows[0].studentId,'');assert.equal(p.rows[0].subjectId,'');
});
test('concurrent mapping edits and invalid corrections reject before assignment writes',()=>{
  const {ctx,aliases,destination}=setup();const request=rememberRequest(ctx,[source(2,'Alias Anna','2n ESO A','Mates 1r')]);
  aliases.data.push(['subject','external','', '', 'External','2','invalid','teacher@iernestlluch.cat','']);
  assert.throws(()=>ctx.commitPendentsStudentsImport(request),/equivalències han canviat/);assert.equal(destination.data.length,1);
  aliases.data.pop();const invalid=plain(request);invalid.corrections[0].studentId='does-not-exist';
  assert.throws(()=>ctx.commitPendentsStudentsImport(invalid),/Equivalència/);assert.equal(destination.data.length,1);
  const wrong=plain(request);wrong.corrections[0].subject='';assert.throws(()=>ctx.commitPendentsStudentsImport(wrong),/Equivalència/);assert.equal(aliases.data.length,1);
});
test('duplicate mappings need review and a new confirmed correction replaces them',()=>{
  const {ctx,aliases}=setup();const src=[source(2,'Alias Anna','2n ESO A','Mates 1r')];ctx.commitPendentsStudentsImport(rememberRequest(ctx,src));
  aliases.data.push(aliases.data.find(row=>row[0]==='subject').slice());
  assert.equal(ctx.previewPendentsStudentsImport({rows:src}).rows[0].subjectId,'');
  ctx.commitPendentsStudentsImport(rememberRequest(ctx,src));assert.equal(aliases.data.length,3);assert.equal(ctx.previewPendentsStudentsImport({rows:src}).issues,0);
});
test('mapping write failures report the already successful import without pretending mappings were saved',()=>{
  const {ctx,aliases}=setup();const request=rememberRequest(ctx,[source(2,'Alias Anna','2n ESO A','Mates 1r')]);
  aliases.getRange=()=>({setValues(){throw new Error('simulated storage failure');}});
  const result=ctx.commitPendentsStudentsImport(request);assert.equal(result.added,1);assert.equal(result.aliasesSaved,0);assert.match(result.aliasesWarning,/importació s’ha desat/);
});
test('invalid mapping headers fail visibly without replacing the existing sheet contents',()=>{
  const {ctx,aliases}=setup();aliases.data.push(['wrong'],['preserve']);
  assert.throws(()=>ctx.previewPendentsStudentsImport({rows:[source()]}),/Columnes incorrectes/);assert.equal(aliases.data[1][0],'preserve');
});
test('conflicting corrections for one source group are rejected before either sheet is changed',()=>{
  const {ctx,aliases,destination}=setup();const request=rememberRequest(ctx,[source(2,'Alias Anna','2n ESO A','Mates 1r'),source(3,'Alias Anna','2n ESO A','Mates 1r')]);
  request.pairs[1].subjectId='2';request.corrections[1].subjectId='2';
  assert.throws(()=>ctx.commitPendentsStudentsImport(request),/equivalències diferents/);assert.equal(destination.data.length,1);assert.equal(aliases.data.length,1);
});
