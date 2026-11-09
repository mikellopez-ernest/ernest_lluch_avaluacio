const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
class Element {
  constructor() { this.children = []; this.handlers = {}; this.value = ''; this.attrs = {}; this.classList = { toggle() {} }; this.open = false; }
  addEventListener(name, fn) { this.handlers[name] = fn; }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return name === 'data-can-import' ? 'true' : this.attrs[name]; }
  append(...nodes) { this.children.push(...nodes); }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {}
  showModal() { this.open = true; this.shown = true; }
  close() { this.open = false; }
}
async function previewUi(unmatched = false, empty = false, customRows = null) {
  const elements = new Map(); const commits = [];
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const preview = { students: [{id:'10',name:'Anna Exemple',group:'2n ESO A'}, {id:'20',name:'Marc Exemple',group:'2n ESO B'}],
    subjects:[{id:'1',name:'Matemàtiques',level:'1r ESO'},{id:'2',name:'Socials',level:'1r ESO'},{id:'3',name:'Socials',level:'2n ESO'}], sourceRevision:'source',cacheRevision:'cache',aliasesRevision:'aliases', skippedIncomplete:1,
    rows: customRows || (empty ? [] : [
      {sourceRow:2,sourceName:'Anna Exemple',sourceGroup:'2n ESO A',sourceSubject:'Matemàtiques 1r',studentId:'10',subjectId:'1'},
      {sourceRow:3,sourceName:'Marc Exemple',sourceGroup:'2n ESO B',sourceSubject:'Matemàtiques 1r',studentId:unmatched ? '' : '20',subjectId:'1',studentIssue:unmatched?'No s’ha trobat el nom':''}
    ]) };
  let success;
  const run = { withSuccessHandler(fn) { success = fn; return run; }, withFailureHandler() { return run; },
    previewPendentsStudentsImport() { success(preview); },
    commitPendentsStudentsImport(payload) { commits.push(payload); success({rows:[],canImport:true,added:payload.pairs.length,updated:0,duplicates:0}); }
  };
  const ctx = vm.createContext({ document:{getElementById:get,createElement:()=>new Element(),createDocumentFragment:()=>new Element()},
    window:{addEventListener(){}}, Option:class extends Element {constructor(text,value){super();this.textContent=text;this.value=value;}},
    google:{script:{run}}, setBusy(){}, dirty:false,
    XLSX:{ read:()=>({SheetNames:['Sheet1'],Sheets:{Sheet1:{'!ref':'A1:C2'}}}), utils:{decode_range:()=>({e:{r:1}}),sheet_to_json:()=>[
      ["Nom complet de l'alumne/a",'Grup classe','Matèries/Nivells pendents de cursos anteriors - Nom'],['Anna Exemple','2n ESO A','Matemàtiques 1r']
    ]}} });
  const script = fs.readFileSync(path.join(__dirname,'../src/StudentsClient.html'),'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(script,ctx);
  get('studentFile').files = [{name:'example.xlsx',size:1,arrayBuffer:async()=>new ArrayBuffer(0)}];
  await get('studentFile').handlers.change();
  return {get,commits};
}

test('all-matched imports are saved without showing the disambiguation popup',async()=>{
  const {get,commits}=await previewUi();
  assert.equal(commits.length,1); assert.equal(commits[0].pairs.length,2);
  assert.notEqual(get('studentImportDialog').shown,true);
});

test('the popup shows only unresolved rows and hides each row when corrected',async()=>{
  const {get,commits}=await previewUi(true);
  assert.equal(get('studentImportDialog').open,true); assert.equal(commits.length,0);
  const table=get('studentReviewRows');
  assert.equal(table.children.length,1);
  assert.equal(table.children[0].children[0].textContent,'Marc Exemple');
  const input=table.children[0].children[3].children[0];
  input.value='Marc Exemple — 2n ESO B · 20'; input.handlers.input();
  assert.match(table.children[0].children[0].textContent,/incidències estan resoltes/);
  get('studentImportConfirm').handlers.click();
  assert.equal(commits.length,1); assert.equal(commits[0].pairs.length,2);
  assert.equal(commits[0].pairs[1].studentId,'20');
});

test('all-incomplete imports neither show a popup nor submit assignments',async()=>{
  const {get,commits}=await previewUi(false,true);
  assert.equal(commits.length,0); assert.notEqual(get('studentImportDialog').shown,true);
  assert.match(get('studentStatus').textContent,/Cap fila per importar/);
});


test('review groups subjects first, then groups students across all their pending subjects', async () => {
  const rows = [
    {sourceRow:2,sourceName:'Anna Exemple',sourceGroup:'2n ESO A',sourceSubject:'Matemàtiques 1r',studentId:'10',subjectId:'1'},
    ...[3,4].map(sourceRow => ({sourceRow,sourceName:'Marc Exemple',sourceGroup:'2n ESO B',sourceSubject:'Socials 1r',studentId:'',subjectId:'',subjectReviewKey:'socials1',subjectLevel:'1r ESO',studentMatchKey:'marc2b'})),
    {sourceRow:5,sourceName:'Marc Exemple',sourceGroup:'2n ESO B',sourceSubject:'Socials 2n',studentId:'',subjectId:'',subjectReviewKey:'socials2',subjectLevel:'2n ESO',studentMatchKey:'marc2b'},
    {sourceRow:6,sourceName:'Anna Exemple',sourceGroup:'2n ESO A',sourceSubject:'Socials 1r',studentId:'10',subjectId:'',subjectReviewKey:'socials1',subjectLevel:'1r ESO',studentMatchKey:'anna2a'}
  ];
  const {get,commits}=await previewUi(false,false,rows); const body=get('studentReviewRows');
  assert.match(get('studentImportTitle').textContent,/Pas 1 de 2/);
  assert.equal(body.children.length,2);
  assert.equal(body.children[0].children[2].textContent,3);
  assert.equal(get('studentImportConfirm').disabled,true);
  let input=body.children[0].children[3].children[0]; input.value='Socials — 1r ESO · 2'; input.handlers.input();
  assert.equal(body.children.length,1);
  input=body.children[0].children[3].children[0]; input.value='Socials — 2n ESO · 3'; input.handlers.input();
  assert.equal(get('studentImportConfirm').disabled,false);
  assert.match(get('studentImportConfirm').textContent,/Pas 2/);
  get('studentImportConfirm').handlers.click();
  assert.match(get('studentImportTitle').textContent,/Pas 2 de 2/);
  assert.equal(body.children.length,1);
  assert.equal(body.children[0].children[0].textContent,'Marc Exemple');
  assert.equal(body.children[0].children[2].textContent,3);
  input=body.children[0].children[3].children[0]; input.value='Marc Exemple — 2n ESO B · 20'; input.handlers.input();
  get('studentImportConfirm').handlers.click();
  assert.equal(commits.length,1); assert.equal(commits[0].pairs.length,5);
  assert.equal(commits[0].pairs[1].subjectId,'2'); assert.equal(commits[0].pairs[2].subjectId,'2');
  assert.equal(commits[0].pairs[3].subjectId,'3'); assert.equal(commits[0].pairs[4].subjectId,'2');
  assert.equal(commits[0].pairs[1].studentId,'20'); assert.equal(commits[0].pairs[2].studentId,'20');
  assert.equal(commits[0].pairs[3].studentId,'20');
  assert.equal(commits[0].aliasesRevision,'aliases');
  assert.equal(commits[0].corrections.length,4);
  assert.equal(commits[0].corrections.filter(row=>row.rememberSubject).length,4);
  assert.equal(commits[0].corrections.filter(row=>row.rememberStudent).length,3);
});

test('omitting an unknown subject group omits all its rows before the student step',async()=>{
  const rows = [{sourceRow:2,sourceName:'Anna Exemple',sourceGroup:'2n ESO A',sourceSubject:'Matemàtiques 1r',studentId:'10',subjectId:'1'},
    ...[3,4].map(sourceRow => ({sourceRow,sourceName:'Unknown',sourceGroup:'2n ESO B',sourceSubject:'Unknown 1r',studentId:'',subjectId:'',subjectReviewKey:'unknown1',subjectLevel:'1r ESO',studentMatchKey:'unknown2b'}))];
  const {get,commits}=await previewUi(false,false,rows);
  const checkbox=get('studentReviewRows').children[0].children[4].children[0]; checkbox.checked=true; checkbox.handlers.change();
  assert.equal(get('studentImportConfirm').disabled,false);
  assert.match(get('studentImportConfirm').textContent,/Importar 1 files/);
  get('studentImportConfirm').handlers.click();
  assert.equal(commits[0].pairs.length,1);
  assert.equal(commits[0].corrections.length,0);
});


test('a subject correction later omitted in the student step is not remembered',async()=>{
  const rows=[{sourceRow:2,sourceName:'Anna Exemple',sourceGroup:'2n ESO A',sourceSubject:'Matemàtiques 1r',studentId:'10',subjectId:'1'},
    {sourceRow:3,sourceName:'Unknown',sourceGroup:'2n ESO B',sourceSubject:'Unknown 1r',studentId:'',subjectId:'',subjectReviewKey:'unknown1',studentMatchKey:'unknown2b',subjectLevel:'1r ESO'}];
  const {get,commits}=await previewUi(false,false,rows);
  let input=get('studentReviewRows').children[0].children[3].children[0];input.value='Socials — 1r ESO · 2';input.handlers.input();
  get('studentImportConfirm').handlers.click();
  const skip=get('studentReviewRows').children[0].children[4].children[0];skip.handlers.change();
  get('studentImportConfirm').handlers.click();assert.equal(commits[0].pairs.length,1);assert.equal(commits[0].corrections.length,0);
});
