const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Level = require('level-party');

test('packaged database dependency persists a recalled message across reopening', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-db-test-'));
  let db;
  t.after(async () => {
    if (db) await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  db = Level(directory, { valueEncoding: 'json' });
  const original = { id: 'synthetic', msg: { elements: [{ textElement: { content: 'synthetic test' } }] } };
  await new Promise((resolve, reject) => db.put(original.id, original, error => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
  db = Level(directory, { valueEncoding: 'json' });
  const restored = await db.get('synthetic');
  assert.deepEqual(restored, original);
});
