// Runs the production store with SDK imports redirected to a disposable demo emulator.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const runtime = process.env.FARM_TEST_RUNTIME || path.resolve(__dirname, '../../../.cache/farm-party-runtime');
const core = require('../core.js');
test('room deletion preserves unseen applications, then removes the reviewed room and clears listeners', { timeout: 30000 }, async () => {
  const { initializeTestEnvironment } = require(path.join(runtime, 'node_modules/@firebase/rules-unit-testing'));
  const fragment = fs.readFileSync(path.join(__dirname, '../firestore-rules.fragment'), 'utf8');
  const rules = `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { function signedIn() { return request.auth != null; } ${fragment} } }`;
  const env = await initializeTestEnvironment({ projectId: 'demo-farm-party', firestore: { host: '127.0.0.1', port: 8080, rules } });
  globalThis.FarmPartyCore = core;
  const source = fs.readFileSync(path.join(__dirname, '../firebase-store.js'), 'utf8')
    .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-([\w-]+)\.js/g, (_, name) => 'firebase/' + name)
    .replace('GoogleAuthProvider, browserLocalPersistence', 'connectAuthEmulator, GoogleAuthProvider, browserLocalPersistence')
    .replace('collection, doc,', 'connectFirestoreEmulator, collection, doc,')
    .replace('const auth = getAuth(app);', 'const auth = getAuth(app); connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });')
    .replace('const db = getFirestore(app);', 'const db = getFirestore(app); connectFirestoreEmulator(db, "127.0.0.1", 8080);');
  const modulePath = path.join(runtime, 'farm-delete-store-under-test.mjs');
  fs.writeFileSync(modulePath, source + '\nimport * as sdkApp from "firebase/app"; import * as sdkAuth from "firebase/auth"; import * as sdkDb from "firebase/firestore"; export { sdkApp, sdkAuth, sdkDb };\n');
  const { createFarmStore, sdkApp, sdkAuth, sdkDb } = await import(pathToFileURL(modulePath).href);
  const store = await createFarmStore({ apiKey: 'demo', projectId: 'demo-farm-party', authDomain: 'demo-farm-party.firebaseapp.com', appId: 'demo-app' });
  const app = sdkApp.getApp('farm-party'), auth = sdkAuth.getAuth(app), db = sdkDb.getFirestore(app);
  let id, stopRoom = () => {}, stopList = () => {};
  try {
    await assert.rejects(store.removeRoom(core.createRoomId(), 0), /Google/);
    const credential = sdkAuth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'delete-store-test', email: 'delete-store-test@example.test', email_verified: true }));
    await sdkAuth.linkWithCredential(auth.currentUser, credential); await auth.currentUser.getIdToken(true);
    id = await store.createRoom({ trials: [0, 6], title: '삭제 검증용', date: '2026-10-02', time: '21:00', description: '' });
    const ref = sdkDb.doc(db, 'farmRooms', id);
    await store.apply(id, { nickname: '신청자', server: '', memo: '', preferences: Object.fromEntries(core.SEATS.map(seat => [seat, seat === 'T1' ? 2 : 0])), wings: { '0': false, '6': true } });
    await assert.rejects(store.removeRoom(id, 0), /갱신/);
    assert.equal((await sdkDb.getDoc(ref)).exists(), true);
    const removed = new Promise((resolve, reject) => { stopRoom = store.subscribeRoom(id, value => { if (value === null) resolve(); }, reject); });
    let resolveListed, rejectListed;
    const firstListed = new Promise((resolve, reject) => { resolveListed = resolve; rejectListed = reject; });
    const noLongerListed = new Promise((resolve, reject) => { let listed = false; stopList = store.subscribeList(rooms => { if (rooms.some(room => room.id === id)) { listed = true; resolveListed(); } else if (listed) resolve(); }, error => { rejectListed(error); reject(error); }, true); });
    await firstListed;
    await store.removeRoom(id, 1);
    await Promise.all([removed, noLongerListed]);
    assert.equal((await sdkDb.getDocFromServer(ref)).exists(), false);
    await assert.rejects(store.removeRoom(id, 1), /이미 삭제/);
    await assert.rejects(store.apply(id, null), /찾지 못/);
  } finally {
    stopRoom(); stopList(); await sdkDb.terminate(db); await sdkApp.deleteApp(app); await env.cleanup();
  }
});
