const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function ui(canImport) {
  const elements = new Map(); let failure;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', handlers: {}, hidden: false,
      getAttribute(name) { return name === 'data-can-import' ? String(canImport) : null; },
      setAttribute() {}, click() { this.clicked = true; }, addEventListener(name, fn) { this.handlers[name] = fn; }, classList: { toggle() {} } });
    return elements.get(id);
  }
  const run = { withSuccessHandler() { return run; }, withFailureHandler(fn) { failure = fn; return run; },
    getPendentsStudentsData() { failure({ message: 'Test load failure' }); } };
  const ctx = vm.createContext({ document: { getElementById: element }, window: { addEventListener() {} },
    setBusy() {}, dirty: false, google: { script: { run } } });
  const source = fs.readFileSync(path.join(__dirname, '../src/StudentsClient.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(source, ctx);
  return { element };
}

test('school-account import button remains visible and enabled after the student table fails to load', () => {
  const { element } = ui(true);
  assert.equal(element('studentImport').hidden, false);
  assert.equal(element('studentImport').disabled, false);
  element('studentsTab').handlers.click();
  assert.equal(element('studentImport').hidden, false);
  assert.equal(element('studentImport').disabled, false);
  assert.equal(element('studentStatus').textContent, 'Test load failure');
});

test('accounts without school access cannot use XLSX import', () => {
  const { element } = ui(false);
  assert.equal(element('studentImport').hidden, false);
  assert.equal(element('studentImport').disabled, true);
  assert.match(element('studentImport').title, /iernestlluch.cat/);
});


test('clicking Importar XLSX opens the computer file selector for a school account', () => {
  const { element } = ui(true);
  element('studentImport').handlers.click();
  assert.equal(element('studentFile').clicked, true);
});
