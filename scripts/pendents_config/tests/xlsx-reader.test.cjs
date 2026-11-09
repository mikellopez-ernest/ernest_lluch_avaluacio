const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceDir = path.join(__dirname, '../src');
const sample = path.join(__dirname, '../materies_pendents_esfera_mostra.xlsx');

test('browser parser reads the optional local Esfera sample and preserves its physical row numbers', { skip: !fs.existsSync(sample) }, async () => {
  const elements = new Map(); let sent;
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, hidden: false, handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; }, classList: { toggle() {} }, setAttribute() {}, getAttribute(name) { return name === 'data-can-import' ? 'true' : null; } });
    return elements.get(id);
  }
  const bytes = fs.readFileSync(sample);
  const file = { name: 'sample.xlsx', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const run = { withSuccessHandler() { return run; }, withFailureHandler() { return run; }, previewPendentsStudentsImport(payload) { sent = payload; } };
  const ctx = vm.createContext({ Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, Buffer,
    document: { getElementById: element }, window: { addEventListener() {} },
    google: { script: { run } }, setBusy() {}, dirty: false });
  const library = fs.readFileSync(path.join(sourceDir, 'XlsxLibrary.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(library, ctx);
  const client = fs.readFileSync(path.join(sourceDir, 'StudentsClient.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
  vm.runInContext(client, ctx);
  element('studentFile').files = [file];
  await element('studentFile').handlers.change();
  assert.ok(sent, 'Expected a parsed preview request');
  assert.equal(sent.rows.length, 517);
  assert.equal(sent.rows.filter(row => row.subject).length, 449);
  assert.equal(sent.rows[0].sourceRow, 2);
  assert.equal(sent.rows[0].subject, 'Biologia i Geologia 1r');
});
