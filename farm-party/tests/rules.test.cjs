// Run against a demo Firestore emulator, never a production project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.FARM_TEST_RUNTIME || path.resolve(__dirname, '../../../.cache/farm-party-runtime');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require(path.join(runtime, 'node_modules/@firebase/rules-unit-testing'));
const { doc, setDoc, getDoc, updateDoc, getDocs, collection, query, where, limit, orderBy, serverTimestamp, runTransaction } = require(path.join(runtime, 'node_modules/firebase/firestore'));
const core = require('../core.js');
const id = 'abcdefghijklmnopqrstuv';
const prefs = (...seats) => Object.fromEntries(core.SEATS.map(s => [s, seats.includes(s) ? 2 : 0]));
const applicant = (name, seats) => ({ nickname: name, server: '', memo: '', preferences: prefs(...seats), wing: false });
const google = { firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['test'] } } };
test('Firestore ownership, privacy, concurrency, complete allocation and closed-state permissions', async () => {
  const fragment = fs.readFileSync(path.join(__dirname, '../firestore-rules.fragment'), 'utf8');
  const rules = `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { function signedIn() { return request.auth != null; } ${fragment} } }`;
  const env = await initializeTestEnvironment({ projectId: 'demo-farm-party', firestore: { host: '127.0.0.1', port: 8080, rules } });
  try {
    await env.clearFirestore();
    const owner = env.authenticatedContext('owner', google).firestore(), stranger = env.authenticatedContext('stranger', google).firestore();
    const anon = env.authenticatedContext('anon').firestore(), publicDb = env.unauthenticatedContext().firestore();
    const ref = db => doc(db, 'farmRooms', id);
    const draft = { ...core.draft({ trial: 0, title: '테스트', description: '', date: '2026-10-02', time: '21:00' }), ownerUid: 'owner', status: 'open', applicants: {}, assignments: {}, locks: {}, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(ref(anon), { ...draft, ownerUid: 'anon' }));
    await assertSucceeds(setDoc(ref(owner), draft));
    console.log('Room creation passed');
    await assertFails(getDoc(ref(publicDb))); await assertSucceeds(getDoc(ref(anon)));
    await assertSucceeds(getDocs(query(collection(anon, 'farmRooms'), where('status', 'in', ['open', 'confirmed']), orderBy('createdAt', 'desc'), limit(30))));
    await assertFails(getDocs(collection(anon, 'farmRooms')));
    console.log('Room read/list permissions passed');
    const apply = async (db, uid, input) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        let revision;
        try { return await runTransaction(db, async tx => { const current = core.room((await tx.get(ref(db))).data(), id); revision = current.revision; tx.update(ref(db), { ...core.applyApplication(current, uid, input, serverTimestamp()), revision: current.revision + 1, updatedAt: serverTimestamp() }); }); }
        catch (error) { if (error.code !== 'permission-denied' || attempt === 3 || (await getDoc(ref(db))).data().revision === revision) throw error; }
      }
    };
    const change = (db, command, revision) => runTransaction(db, async tx => { const current = core.room((await tx.get(ref(db))).data(), id); if (revision != null && revision !== current.revision) throw Error('stale revision'); tx.update(ref(db), { ...core.manage(current, command), revision: current.revision + 1, updatedAt: serverTimestamp() }); });
    await Promise.all([assertSucceeds(apply(anon, 'anon', applicant('익명', ['T1', 'T2']))), assertSucceeds(apply(stranger, 'stranger', applicant('다른 계정', ['T1'])))]);
    console.log('Concurrent application passed');
    assert.equal(Object.keys((await getDoc(ref(owner))).data().applicants).length, 2);
    await assertFails(apply(anon, 'stranger', applicant('변조', ['D1'])));
    await assertFails(change(stranger, { type: 'recommend' }));
    await assertSucceeds(change(owner, { type: 'recommend' }));
    await assertSucceeds(change(owner, { type: 'lock', seat: 'T2' }));
    await assertSucceeds(apply(anon, 'anon', applicant('익명 수정', ['D1'])));
    assert.equal((await getDoc(ref(owner))).data().assignments.T2, undefined);
    await assertFails(updateDoc(ref(anon), { title: '탈취', revision: 99, updatedAt: serverTimestamp() }));
    await assertSucceeds(apply(anon, 'anon', null));
    for (const seat of core.SEATS.slice(1)) { const db = env.authenticatedContext('seat' + seat).firestore(); await assertSucceeds(apply(db, 'seat' + seat, applicant(seat, [seat]))); }
    await assertSucceeds(change(owner, { type: 'recommend' }));
    const before = (await getDoc(ref(owner))).data().revision;
    let lockRevision = before;
    await assertSucceeds(updateDoc(ref(owner), { locks: Object.fromEntries(core.SEATS.map(seat => [seat, true])), revision: lockRevision + 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(apply(stranger, 'stranger', { ...applicant('수정', ['T1']), memo: '갱신' }));
    await assert.rejects(change(owner, { type: 'confirm' }, before), /stale revision/);
    await assertSucceeds(change(owner, { type: 'confirm' }));
    let current = (await getDoc(ref(owner))).data();
    await assertFails(updateDoc(ref(anon), { applicants: { ...current.applicants, anon: { ...applicant('늦은 신청', ['T1']), joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } }, revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(owner), { assignments: {}, revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(change(owner, { type: 'reopen' }));
    // Full room: updates and withdrawals remain possible, the 101st applicant is denied.
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore(); const snapshot = (await getDoc(ref(db))).data();
      const applicants = { ...snapshot.applicants };
      for (let i = Object.keys(applicants).length; i < 100; i++) applicants['extra' + i] = { ...applicant('대기' + i, ['T1']), joinedAt: snapshot.createdAt, updatedAt: snapshot.createdAt };
      await updateDoc(ref(db), { applicants });
    });
    await assertSucceeds(apply(stranger, 'stranger', { ...applicant('100명 중 수정', ['T1']), memo: '수정' }));
    let fullRoom = (await getDoc(ref(owner))).data();
    await assertFails(updateDoc(ref(anon), { applicants: { ...fullRoom.applicants, anon: { ...applicant('101번째', ['T1']), joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } }, revision: fullRoom.revision + 1, updatedAt: serverTimestamp() }));
    const profile = { ...core.profile({ nickname: '나', server: '', memo: '', preferences: prefs('T1'), wings: Array(7).fill(false) }), version: 1, updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(owner, 'farmProfiles', 'owner'), profile));
    await assertSucceeds(getDoc(doc(owner, 'farmProfiles', 'owner')));
    await assertFails(getDoc(doc(stranger, 'farmProfiles', 'owner')));
    await assertFails(setDoc(doc(anon, 'farmProfiles', 'anon'), profile));
    await assertSucceeds(change(owner, { type: 'close' }));
    await assertSucceeds(getDoc(ref(anon)));
    current = (await getDoc(ref(owner))).data();
    await assertFails(updateDoc(ref(owner), { status: 'open', revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(getDocs(query(collection(owner, 'farmRooms'), where('ownerUid', '==', 'owner'), orderBy('createdAt', 'desc'), limit(30))));
    console.log('Ownership, private profiles, simultaneous applications, allocations, stale confirmation, closing: passed');
  } finally { await env.cleanup(); }
});
