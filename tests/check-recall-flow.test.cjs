const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function harness(records = new Map()) {
  const files = new Map();
  const sent = [], logs = [], callbacks = new Map();
  const db = {
    open: cb => cb(null), close: async () => {},
    get(key, cb) {
      const value = records.get(key);
      const error = value ? null : Object.assign(new Error('Not found'), { status: 404, notFound: true });
      if (cb) return cb(error, value && copy(value));
      return error ? Promise.reject(error) : Promise.resolve(copy(value));
    },
    put(key, value, cb) { records.set(key, copy(value)); cb?.(null); },
  };
  const fakeFs = {
    existsSync: p => files.has(p), mkdirSync() {},
    readFileSync: p => files.get(p), writeFileSync: (p, text) => files.set(p, text),
    appendFileSync: (p, text) => files.set(p, (files.get(p) || '') + text),
  };
  files.set(path.join('synthetic-data', 'anti_recall', 'config.json'), JSON.stringify({
    saveDb: true, isAntiRecallSelfMsg: false, maxMsgSaveLimit: 10000, deleteMsgCountPerTime: 500,
  }));
  const context = {
    Object, Array, Map, Set, JSON, Promise, console: { log: (...parts) => logs.push(parts.join(' ')) },
    LiteLoader: { path: { data: 'synthetic-data' } }, module: { exports: {} }, exports: {},
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'electron') return { app: { on() {} }, ipcMain: { handle() {} }, dialog: {} };
      if (name === 'level-party') return () => db;
      if (name === './imgDownloader.js') return { ImgDownloader: class { capturePic() {} async downloadPic() {} } };
      throw Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(source, context, { filename: 'anti-recall-main.js' });
  const window = {
    isDestroyed: () => false,
    webContents: {
      on: (name, callback) => callbacks.set(name, callback),
      getURL: () => 'app://./renderer/index.html#/main/message',
      send: (channel, ...args) => sent.push(copy({ channel, args })),
    },
  };
  context.module.exports.onBrowserWindowCreated(window);
  callbacks.get('did-stop-loading')();
  return {
    records, logs, sent,
    send: packet => window.webContents.send('synthetic-qq-ipc', { type: 'event' }, packet),
    lastPacket: () => sent.filter(s => s.channel === 'synthetic-qq-ipc').at(-1).args[1],
  };
}
function message(id = '101', chatType = 2) {
  return { msgId: id, peerUid: 'synthetic-peer', chatType, msgType: 2, subMsgType: 1,
    elements: [{ elementType: 1, textElement: { content: 'Synthetic original text' } }] };
}
function recall(id = '101', self = false) {
  return { ...message(id), msgType: 5, subMsgType: 4,
    elements: [{ elementType: 8, grayTipElement: { revokeElement: { isSelfOperate: self } } }] };
}
function event(name, list) { return { cmdName: 'nodeIKernelMsgListener/' + name, payload: { msgList: list } }; }
async function readBack(h, id = '101') {
  await h.send({ result: 0, errMsg: '', msgList: [recall(id)], needContinueGetMsg: false });
  return h.lastPacket().msgList[0].elements[0]?.textElement?.content;
}

test('group message received as a full list survives recall and reopening', async () => {
  const h = harness();
  await h.send({ result: 0, errMsg: '', msgList: [message()], needContinueGetMsg: false });
  await h.send(event('onMsgInfoListUpdate', [recall()]));
  assert.equal(await readBack(h), 'Synthetic original text');
  assert.equal(h.records.size, 1);
  const restarted = harness(h.records);
  assert.equal(await readBack(restarted), 'Synthetic original text');
});

test('existing active-message receive path still preserves text', async () => {
  const h = harness();
  await h.send(event('onRecvActiveMsg', [message()]));
  await h.send(event('onMsgInfoListUpdate', [recall()]));
  assert.equal(await readBack(h), 'Synthetic original text');
});

test('normal active-message updates are cached before a subsequent recall', async () => {
  const h = harness();
  await h.send(event('onActiveMsgInfoUpdate', [message()]));
  await h.send(event('onActiveMsgInfoUpdate', [recall()]));
  assert.equal(await readBack(h), 'Synthetic original text');
});

test('cache retains a snapshot when QQ mutates the original message object', async () => {
  const h = harness();
  const original = message();
  await h.send(event('onRecvActiveMsg', [original]));
  Object.assign(original, recall());
  await h.send(event('onMsgInfoListUpdate', [original]));
  assert.equal(await readBack(h), 'Synthetic original text');
});

test('unknown recalled messages retain the QQ recall notice', async () => {
  const h = harness();
  await h.send(event('onMsgInfoListUpdate', [recall()]));
  assert.equal(h.lastPacket().payload.msgList.length, 1);
  assert.equal(h.lastPacket().payload.msgList[0].msgType, 5);
  assert.equal(h.records.size, 0);
});

test('self recall remains enabled in QQ when anti-self-recall is off', async () => {
  const h = harness();
  await h.send(event('onRecvActiveMsg', [message()]));
  await h.send(event('onMsgInfoListUpdate', [recall('101', true)]));
  assert.equal(h.lastPacket().payload.msgList[0].msgType, 5);
  assert.equal(h.records.size, 0);
});

test('picture thumbnail paths survive snapshotting and database restoration', async () => {
  const h = harness();
  const original = message();
  original.elements = [{ elementType: 2, picElement: { sourcePath: 'synthetic-original.png', thumbPath: new Map([[198, 'synthetic-thumbnail.png']]) } }];
  await h.send(event('onRecvActiveMsg', [original]));
  await h.send(event('onMsgInfoListUpdate', [recall()]));
  const restarted = harness(h.records);
  await readBack(restarted);
  assert.equal(restarted.lastPacket().msgList[0].elements[0].picElement.thumbPath[198], 'synthetic-thumbnail.png');
});
