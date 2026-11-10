const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../zen-safe-close.uc.js'), 'utf8');
const moduleSource = source.slice(source.indexOf('// uBlock sync:'));
const pure = moduleSource.slice(moduleSource.indexOf('  function reconcile('), moduleSource.indexOf('  function activeOwner('));
const codec = moduleSource.slice(moduleSource.indexOf('  async function hash('), moduleSource.indexOf('  async function connect('));
function helpers(globals = {}) { return vm.runInNewContext(pure + '\n' + codec + '\n({reconcile, canonical, validate, bridgeFrame, pack, unpack, hash})', { KEY: 'zenarc-ubo-v1.', Uint8Array, ...globals }); }
const h = helpers();
const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
const record = (digest, clock) => ({ digest, clock, data: { value: digest } });
const state = (digest = 'old', clock = { [A]: 1 }, device = A) => ({ digest, clock, device });
const local = digest => ({ digest, data: { value: digest } });
const plain = x => JSON.parse(JSON.stringify(x));

test('first device publishes; second device imports an existing cloud record', () => {
 const seed = h.reconcile(local('first'), { device: A, clock: {} }, []);
 assert.equal(seed.action, 'publish'); assert(seed.record.clock[A] > 0);
 assert.equal(h.reconcile(local('second'), { device: B, clock: {} }, [seed.record]).action, 'apply');
});
test('unchanged snapshot does not republish or reapply', () => {
 assert.equal(h.reconcile(local('old'), state(), [record('old', { [A]: 1 })]).action, 'adopt');
});
test('local changes publish and retain ancestry', () => {
 const p = h.reconcile(local('new'), state(), [record('old', { [A]: 1 })]);
 assert.equal(p.action, 'publish'); assert(p.record.clock[A] > 1);
});
test('remote successor applies to an unchanged device', () => {
 assert.equal(h.reconcile(local('old'), state(), [record('new', { [A]: 1, [B]: 1 })]).action, 'apply');
});
test('stale cloud records cannot roll back the locally acknowledged revision', () => {
 const p = h.reconcile(local('new'), state('new', { [A]: 2 }), [record('old', { [A]: 1 })]);
 assert.equal(p.action, 'publish'); assert.equal(p.record.digest, 'new');
});
test('offline edits conflict without choosing a clock-time winner', () => {
 assert.equal(h.reconcile(local('edit-a'), state(), [record('edit-b', { [A]: 1, [B]: 1 })]).action, 'conflict');
});
test('independent initial devices remain conflicting', () => {
 assert.equal(h.reconcile(local('a'), state('a'), [record('a', { [A]: 1 }), record('b', { [B]: 1 })]).action, 'conflict');
});
test('explicit local resolution dominates all competing revisions', () => {
 const records = [record('b', { [A]: 1, [B]: 4 }), record('c', { [C]: 2 })];
 const p = h.reconcile(local('a'), state(), records, 'local');
 assert.equal(p.action, 'publish'); assert(p.record.clock[A] > 1); assert.equal(p.record.clock[B], 4); assert.equal(p.record.clock[C], 2);
 const follower = h.reconcile(local('b'), state('b', records[0].clock, B), [...records, p.record]);
 assert.equal(follower.action, 'apply'); assert.equal(follower.record.digest, 'a');
});
test('explicit remote resolution merges ancestry; ambiguous cloud versions remain paused', () => {
 const p = h.reconcile(local('a'), state(), [record('b', { [B]: 2 })], 'remote');
 assert.equal(p.action, 'apply-publish'); assert.equal(p.record.digest, 'b'); assert(p.record.clock[A] > 1);
 assert.equal(h.reconcile(local('a'), state(), [record('b', { [B]: 2 }), record('c', { [C]: 2 })], 'remote').action, 'conflict');
});
test('same-content concurrent edits converge without conflict', () => {
 const p = h.reconcile(local('same'), state(), [record('same', { [A]: 1, [B]: 1 })]);
 assert.notEqual(p.action, 'conflict'); assert.equal(p.record.clock[B], 1);
});
test('equal revisions with different payloads are rejected', () => {
 assert.throws(() => h.reconcile(local('old'), state(), [record('bad', { [A]: 1 })]), /Inconsistent/);
});
function snapshot() { return { schema: 1, uboVersion: '1.75.0', userSettings: { importedLists: [], userFiltersTrusted: false, autoUpdate: true }, hiddenSettings: { test: 'unset' }, userFilters: '', selectedFilterLists: ['user-filters'], whitelist: [], rules: [] }; }
test('snapshot validation accepts imported-list arrays and rejects malformed values', () => {
 assert(h.validate(snapshot())); assert.throws(() => h.validate({ ...snapshot(), rules: [42] }), /Invalid rules/);
 assert.throws(() => h.validate({ ...snapshot(), userSettings: { nested: {} } }), /Invalid userSettings/);
});
test('canonical hashes ignore object key order and preserve filter text', () => {
 assert.equal(h.canonical({ b: 2, a: 1 }), h.canonical({ a: 1, b: 2 }));
 assert.notEqual(h.canonical({ f: 'a\nb' }), h.canonical({ f: 'b\na' }));
});
const browserGlobals = { crypto: webcrypto, TextEncoder, Blob, Response, CompressionStream, DecompressionStream, btoa, atob };
test('compressed snapshots round-trip with checksum and revision validation', async () => {
 const data = snapshot(), digest = await h.hash(browserGlobals, h.canonical(data));
 const r = { data, digest, clock: { [A]: 1 } };
 assert.deepEqual(plain(await h.unpack(browserGlobals, await h.pack(browserGlobals, r))), r);
 await assert.rejects(() => h.unpack(browserGlobals, { schema: 2, gzip: '' }), /Invalid/);
 await assert.rejects(async () => h.unpack(browserGlobals, await h.pack(browserGlobals, { ...r, digest: 'tampered' })), /checksum/);
 await assert.rejects(async () => h.unpack(browserGlobals, await h.pack(browserGlobals, { ...r, clock: { [A]: -1 } })), /revision/);
});
test('oversize settings fail before upload; decompression is bounded', async () => {
 const random = require('node:crypto').randomBytes(12000).toString('base64');
 await assert.rejects(() => h.pack(browserGlobals, { value: random }), /8 KB/);
 const packed = await h.pack(browserGlobals, { value: 'x'.repeat(1200000) });
 await assert.rejects(() => h.unpack(browserGlobals, packed), /size limit/);
});
function frame(initial = snapshot()) {
 let data = structuredClone(initial), handler, reply, temporary = false;
 const writes = [];
 const send = async r => {
  switch (r.what) {
   case 'getAppData': return { version: data.uboVersion };
   case 'userSettings': if (!r.name) return structuredClone(data.userSettings); writes.push(r.what); data.userSettings[r.name] = r.value; return;
   case 'readHiddenSettings': return { current: data.hiddenSettings };
   case 'readUserFilters': return { content: data.userFilters };
   case 'getLists': return { available: Object.fromEntries([...new Set(['user-filters', 'stock', ...data.selectedFilterLists])].map(k => [k, { off: !data.selectedFilterLists.includes(k) }])) };
   case 'getWhitelist': return { whitelist: data.whitelist };
   case 'getRules': return { permanentRules: data.rules, sessionRules: temporary ? ['temp'] : data.rules };
   case 'writeHiddenSettings': writes.push(r.what); data.hiddenSettings = Object.fromEntries(r.content.split('\n').map(line=>{const i=line.indexOf(' '); return [line.slice(0,i),line.slice(i+1)];})); return;
   case 'writeUserFilters': writes.push(r.what); data.userFilters = r.content; data.userSettings.userFiltersTrusted = r.trusted; return;
   case 'applyFilterListSelection': writes.push(r.what); data.selectedFilterLists = r.toSelect; return;
   case 'setWhitelist': writes.push(r.what); data.whitelist = r.whitelist ? r.whitelist.split('\n') : []; return;
   case 'modifyRuleset': writes.push(r.what); data.rules = r.toAdd ? r.toAdd.split('\n') : []; return;
   case 'reloadAllFilters': writes.push(r.what); return;
   default: throw Error('Unexpected command '+r.what);
  }
 };
 const content = { location: { href: 'moz-extension://test/settings.html' }, wrappedJSObject: { vAPI: { messaging: { send: (_, r) => send(r) } }, JSON } };
 const f = helpers({ content, Components: { utils: { cloneInto: structuredClone } }, addMessageListener: (_, fn) => { handler=fn; }, sendAsyncMessage: (_, r) => { reply=r; } });
 f.bridgeFrame('moz-extension://test/', 'bridge');
 return { writes, content, setTemporary() { temporary = true; }, async call(command, payload) { await handler({ data: { serial: 1, command, payload } }); if (reply.error) throw Error(reply.error); return reply.result; } };
}
test('bridge applies settings through uBlock commands and verifies the resulting snapshot', async () => {
 const f = frame(), expected = await f.call('snapshot'); const next = structuredClone(expected);
 next.userFilters = 'example.com##.ad'; next.whitelist = ['trusted.example']; next.rules = ['example.com * * block']; next.selectedFilterLists.push('stock'); next.selectedFilterLists.sort(); next.userSettings.autoUpdate = false;
 assert.equal(h.canonical(await f.call('apply', { expected, next })), h.canonical(next));
 assert(f.writes.includes('reloadAllFilters')); assert(!f.writes.includes('restoreUserData'));
});
test('bridge rejects non-uBlock pages and unknown operations', async () => {
 const f = frame(); await assert.rejects(() => f.call('delete'), /Unsupported/);
 f.content.location.href = 'https://example.org/'; await assert.rejects(() => f.call('snapshot'), /Wrong extension/);
});
test('temporary rules and local edits are never silently overwritten', async () => {
 const f = frame(), expected = await f.call('snapshot'); expected.userFilters = 'stale';
 await assert.rejects(() => f.call('apply', { expected, next: snapshot() }), /Local settings changed/); assert.equal(f.writes.length, 0);
 f.setTemporary(); await assert.rejects(() => f.call('snapshot'), /temporary/);
});
test('version and settings-schema mismatches cause no writes', async () => {
 const f = frame(), expected = await f.call('snapshot'); let next = { ...expected, uboVersion: 'other' };
 await assert.rejects(() => f.call('apply', { expected, next }), /same version/); assert.equal(f.writes.length, 0);
 next = { ...expected, userSettings: {} }; await assert.rejects(() => f.call('apply', { expected, next }), /schema/); assert.equal(f.writes.length, 0);
});
test('disabled module shares observers, never imports extension internals, and cleans up on last uninstall', () => {
 const observers = new Set(), host = {}, prefs = new Map(); let imports = 0;
 const Services = { obs: { addObserver(o,t) { observers.add(t); }, removeObserver(o,t) { observers.delete(t); } }, prefs: { setStringPref(k,v) { prefs.set(k,v); } } };
 function open() {
  const listeners = new Map(); const api = { sharedHost: host, config: { enabled: true, ublockSync: false }, uninstall() {} };
  const window = { __zenSafeClose: api, addEventListener(k,f) { listeners.set(k,f); }, removeEventListener(k) { listeners.delete(k); } };
  vm.runInNewContext(moduleSource, { window, Services, ChromeUtils: { importESModule() { imports++; throw Error('Unexpected import'); } } });
  return { api, window, listeners };
 }
 const a = open(), b = open(); assert.equal(imports, 0); assert.equal(observers.size, 3);
 a.api.uninstall(); assert.equal(observers.size, 3); b.api.uninstall(); assert.equal(observers.size, 0); assert.equal(b.listeners.size, 0);
});

async function integration({ remote, backupError, applyError, mismatch, verified=true, fresh=true } = {}) {
 const data = snapshot(), calls = [], values = new Map(), host = {};
 const stateKey = 'zen-safe-close-internal.ublockSync.v1';
 const storage = { async get() { calls.push('cloud-read'); return remote ? { ['zenarc-ubo-v1.'+B]: await h.pack(browserGlobals, { data: remote, digest: await h.hash(browserGlobals,h.canonical(remote)), clock: {[B]:1} }) } : {}; }, async set() { calls.push('cloud-write'); } };
 const fixture = { bridge: { async call(command, payload) { calls.push(command); if (command==='snapshot') return data; if (applyError) throw Error('injected apply failure'); return mismatch ? data : payload.next; }, close() { calls.push('close'); } },
  async backup() { calls.push('backup'); if(backupError)throw Error('disk full'); return '/profile/zenarc-ublock-backups/backup.json'; } };
 let code = moduleSource;
 const start = code.indexOf('  async function connect('), end = code.indexOf('  async function restoreLastBackup(');
 code = code.slice(0,start) + '  async function connect() { return fixture.bridge; }\n  async function backup() { return fixture.backup(); }\n' + code.slice(end);
 const config = {enabled:true,ublockSync:false,ublockSyncResolution:'pause'};
 const api = {sharedHost:host,config,uninstall(){},setConfig(v){Object.assign(config,v);}};
 const window = {__zenSafeClose:api,...browserGlobals,addEventListener(){},removeEventListener(){}};
 const Services = {uuid:{generateUUID:()=>A},prefs:{getStringPref:(k,d)=>values.get(k)??d,setStringPref:(k,v)=>values.set(k,v),getBoolPref:(k,d)=>d},obs:{addObserver(){},removeObserver(){}}};
 vm.runInNewContext(code, {window,Services,fixture,Uint8Array,ChromeUtils:{importESModule(uri){
  if(uri.includes('FxAccounts'))return {fxAccounts:{getSignedInUser:async()=>({uid:'test-account',verified})}};
  if(uri.includes('ExtensionParent'))return {ExtensionParent:{GlobalManager:{getExtension:()=>({id:'ubo'})}}};
  if(uri.includes('ExtensionStorageSync'))return {extensionStorageSync:storage};
  throw Error('unexpected import '+uri);
 }}});
 config.ublockSync=true;host.ublockSync.fresh=fresh;
 await window.__zenSafeCloseUBlockSync.sync();
 return {calls,status:window.__zenSafeCloseUBlockSync.status,readState:()=>JSON.parse(values.get(stateKey)||'null'),window,config,values};
}
test('no login or successful native sync means no extension storage access', async()=>{
 for(const options of [{verified:false},{fresh:false}]) { const r=await integration(options); assert.deepEqual(r.calls,[]); }
});
test('new remote settings are backed up before applying, then checkpointed', async()=>{
 const remote=snapshot();remote.userFilters='example.com##.ad'; const r=await integration({remote});
 assert(r.calls.indexOf('backup')<r.calls.indexOf('apply'));assert(!r.calls.includes('cloud-write'));
 assert.equal(r.status.state,'up-to-date');assert(!r.readState().pending);assert(r.readState().lastBackup);
});
test('backup failure prevents any apply or cloud write', async()=>{
 const remote=snapshot();remote.userFilters='changed';const r=await integration({remote,backupError:true});
 assert(!r.calls.includes('apply'));assert(!r.calls.includes('cloud-write'));assert.equal(r.status.state,'paused');
});
test('failed or mismatched apply leaves a durable recovery marker and never publishes', async()=>{
 const remote=snapshot();remote.userFilters='changed';
 for(const options of [{applyError:true},{mismatch:true}]) {const r=await integration({remote,...options});
 assert(r.readState().pending);assert(!r.calls.includes('cloud-write'));assert.equal(r.status.state,'paused');
 const before=r.calls.length;await r.window.__zenSafeCloseUBlockSync.sync();assert.equal(r.calls.length,before);}
});
test('successful local publication is queued for native Mozilla transfer', async()=>{
 const r=await integration();assert(r.calls.includes('cloud-write'));assert.equal(r.status.state,'queued-for-Mozilla-sync');assert(r.readState().digest);
});
