// Run against a demo Firestore emulator, never a production project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.FARM_TEST_RUNTIME || path.resolve(__dirname, '../../../.cache/farm-party-runtime');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require(path.join(runtime, 'node_modules/@firebase/rules-unit-testing'));
const { doc, setDoc, getDoc, updateDoc, deleteDoc, getDocs, collection, query, where, limit, orderBy, serverTimestamp, runTransaction } = require(path.join(runtime, 'node_modules/firebase/firestore'));
const core = require('../core.js');
const id = 'abcdefghijklmnopqrstuv';
const prefs = (...seats) => Object.fromEntries(core.SEATS.map(s => [s, seats.includes(s) ? 2 : 0]));
const applicant = (name, seats) => ({ nickname: name, server: '', memo: '', preferences: prefs(...seats), wing: false });
const google = { firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['test'] } } };
for (const version of [1, 2]) test(`Firestore v${version}: ownership, privacy, concurrency, complete allocation and closed-state permissions`, async () => {
  const selected = version === 2 ? { trials: [0, 1, 2, 3, 4, 5, 6] } : { trial: 0 };
  const applicant = (name, seats) => ({ nickname: name, server: '', memo: '', preferences: prefs(...seats), ...core.applicationWings({ ...selected, version }, [true, false, true, false, true, false, true]) });
  const fragment = fs.readFileSync(path.join(__dirname, '../firestore-rules.fragment'), 'utf8');
  const rules = `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { function signedIn() { return request.auth != null; } ${fragment} } }`;
  const env = await initializeTestEnvironment({ projectId: 'demo-farm-party', firestore: { host: '127.0.0.1', port: 8080, rules } });
  try {
    await env.clearFirestore();
    const owner = env.authenticatedContext('owner', google).firestore(), stranger = env.authenticatedContext('stranger', google).firestore();
    const anon = env.authenticatedContext('anon').firestore(), publicDb = env.unauthenticatedContext().firestore();
    const ref = db => doc(db, 'farmRooms', id);
    const draft = { ...core.draft({ ...selected, title: '테스트', description: '', date: '2026-10-02', time: '21:00' }), ownerUid: 'owner', status: 'open', applicants: {}, assignments: {}, locks: {}, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(ref(anon), { ...draft, ownerUid: 'anon' }));
    await assertSucceeds(setDoc(ref(owner), draft));
    await assertFails(deleteDoc(ref(publicDb)));
    await assertFails(deleteDoc(ref(anon)));
    await assertFails(deleteDoc(ref(stranger)));
    await assertFails(deleteDoc(ref(env.authenticatedContext('owner').firestore())));
    const openId = core.createRoomId();
    await assertSucceeds(setDoc(doc(owner, 'farmRooms', openId), draft));
    await assertSucceeds(deleteDoc(doc(owner, 'farmRooms', openId)));
    assert.equal((await getDoc(doc(anon, 'farmRooms', openId))).exists(), false);
    if (version === 2) {
      const otherId = core.createRoomId();
      const otherRef = doc(owner, 'farmRooms', otherId);
      for (const trials of [[], [0, 0], [7], [0.5], ['0']]) await assertFails(setDoc(otherRef, { ...draft, trials }));
      await assertSucceeds(setDoc(otherRef, { ...draft, trials: [0, 6] }));
      const two = doc(anon, 'farmRooms', otherId);
      const write = wings => updateDoc(two, { applicants: { anon: { ...applicant('두 토벌전', ['T1']), wings, joinedAt: serverTimestamp(), updatedAt: serverTimestamp() } }, revision: 1, updatedAt: serverTimestamp() });
      for (const wings of [{ '0': true }, { '0': true, '1': false }, { '0': true, '6': 'false' }, { '0': true, '6': false, '2': false }]) await assertFails(write(wings));
      await assertSucceeds(write({ '0': true, '6': false }));
    }
    console.log('Room creation passed');
    await assertFails(getDoc(ref(publicDb))); await assertSucceeds(getDoc(ref(anon)));
    await assertSucceeds(getDocs(query(collection(anon, 'farmRooms'), where('status', 'in', ['open', 'confirmed']), orderBy('createdAt', 'desc'), limit(30))));
    await assertFails(getDocs(collection(anon, 'farmRooms')));
    console.log('Room read/list permissions passed');
    const edit = (db, fields) => runTransaction(db, async tx => {
      const snapshot = await tx.get(ref(db)), current = core.room(snapshot.data(), id);
      const next = { ...snapshot.data(), ...core.editRoom(current, fields), revision: current.revision + 1, updatedAt: serverTimestamp() };
      if (next.version === 2) delete next.trial; else delete next.trials;
      tx.set(ref(db), next);
    });
    const editFields = { trials: core.trials(draft), title: '편집한 제목', date: '2026-10-03', time: '22:00', description: '편집 설명' };
    await assertFails(edit(stranger, editFields)); await assertFails(edit(anon, editFields));
    await assertSucceeds(edit(owner, editFields));
    assert.equal((await getDoc(ref(anon))).data().title, editFields.title);
    const emptyRef = doc(owner, 'farmRooms', core.createRoomId());
    await assertSucceeds(setDoc(emptyRef, draft));
    await assertSucceeds(runTransaction(owner, async tx => {
      const snapshot = await tx.get(emptyRef), current = core.room(snapshot.data(), emptyRef.id);
      const next = { ...snapshot.data(), ...core.editRoom(current, { ...editFields, trials: [0, 6] }), revision: 1, updatedAt: serverTimestamp() };
      delete next.trial; tx.set(emptyRef, next);
    }));
    assert.equal((await getDoc(emptyRef)).data().version, 2);
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
    let edited = (await getDoc(ref(owner))).data();
    const revisionPatch = { revision: edited.revision + 1, updatedAt: serverTimestamp() };
    await assertFails(updateDoc(ref(owner), { ...(version === 1 ? { trial: 6 } : { trials: [0] }), ...revisionPatch }));
    await assertFails(updateDoc(ref(owner), { title: '', ...revisionPatch }));
    await assertFails(updateDoc(ref(owner), { ownerUid: 'stranger', title: '탈취', ...revisionPatch }));
    await assertSucceeds(edit(owner, { ...editFields, description: '신청 이후 설명 변경' }));
    assert.equal(Object.keys((await getDoc(ref(owner))).data().applicants).length, 2);
    await assertFails(apply(anon, 'stranger', applicant('변조', ['D1'])));
    await assertFails(change(stranger, { type: 'recommend' }));
    await assertSucceeds(change(owner, { type: 'recommend' }));
    console.log('Initial recommendation passed');
    await assertSucceeds(change(owner, { type: 'lock', seat: 'T2' }));
    await assertSucceeds(apply(anon, 'anon', applicant('익명 수정', ['D1'])));
    console.log('Locked own seat removal passed');
    assert.equal((await getDoc(ref(owner))).data().assignments.T2, undefined);
    await assertFails(updateDoc(ref(anon), { title: '탈취', revision: 99, updatedAt: serverTimestamp() }));
    await assertSucceeds(apply(anon, 'anon', null));
    for (const seat of core.SEATS.slice(1)) { const db = env.authenticatedContext('seat' + seat).firestore(); await assertSucceeds(apply(db, 'seat' + seat, applicant(seat, [seat]))); }
    await assertSucceeds(change(owner, { type: 'recommend' }));
    console.log('Complete recommendation passed');
    const before = (await getDoc(ref(owner))).data().revision;
    let lockRevision = before;
    await assertSucceeds(updateDoc(ref(owner), { locks: Object.fromEntries(core.SEATS.map(seat => [seat, true])), revision: lockRevision + 1, updatedAt: serverTimestamp() }));
    console.log('Eight locks passed');
    const locked = (await getDoc(ref(owner))).data();
    const forged = { ...locked.applicants, stranger: { ...applicant('다른 자리 탈취', ['T1']), joinedAt: locked.applicants.stranger.joinedAt, updatedAt: serverTimestamp() } };
    const badAssignments = { ...locked.assignments }; delete badAssignments.H1;
    const badLocks = { ...locked.locks }; delete badLocks.H1;
    await assertFails(updateDoc(ref(stranger), { applicants: forged, assignments: badAssignments, locks: badLocks, revision: locked.revision + 1, updatedAt: serverTimestamp() }));
    const unlockOwn = { ...locked.locks }; delete unlockOwn.T1;
    await assertFails(updateDoc(ref(stranger), { applicants: forged, locks: unlockOwn, revision: locked.revision + 1, updatedAt: serverTimestamp() }));
    const lastSeatDb = env.authenticatedContext('seatD4').firestore();
    await assertSucceeds(apply(lastSeatDb, 'seatD4', null));
    assert.equal((await getDoc(ref(owner))).data().locks.D4, undefined);
    await assertSucceeds(apply(lastSeatDb, 'seatD4', applicant('D4 재신청', ['D4'])));
    await assertSucceeds(change(owner, { type: 'recommend' }));
    await assertSucceeds(change(owner, { type: 'lock', seat: 'D4' }));
    await assertSucceeds(apply(stranger, 'stranger', { ...applicant('수정', ['T1']), memo: '갱신' }));
    await assert.rejects(change(owner, { type: 'confirm' }, before), /stale revision/);
    await assertSucceeds(change(owner, { type: 'confirm' }));
    let current = (await getDoc(ref(owner))).data();
    const allocationBeforeEdit = current.assignments;
    await assertSucceeds(edit(owner, { ...editFields, time: '23:00' }));
    current = (await getDoc(ref(owner))).data();
    assert.deepEqual(current.assignments, allocationBeforeEdit); assert.equal(current.status, 'confirmed');
    const confirmedId = core.createRoomId();
    await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), 'farmRooms', confirmedId), current); });
    await assertFails(deleteDoc(doc(stranger, 'farmRooms', confirmedId)));
    await assertSucceeds(deleteDoc(doc(owner, 'farmRooms', confirmedId)));
    assert.equal((await getDoc(doc(anon, 'farmRooms', confirmedId))).exists(), false);
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
    await assertFails(updateDoc(ref(owner), { title: '종료 후 수정', revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(owner), { status: 'open', revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertSucceeds(getDocs(query(collection(owner, 'farmRooms'), where('ownerUid', '==', 'owner'), orderBy('createdAt', 'desc'), limit(30))));
    await assertFails(deleteDoc(ref(stranger)));
    await assertSucceeds(deleteDoc(ref(owner)));
    assert.equal((await getDoc(ref(anon))).exists(), false);
    const remaining = await getDocs(query(collection(owner, 'farmRooms'), where('ownerUid', '==', 'owner'), orderBy('createdAt', 'desc'), limit(30)));
    assert.equal(remaining.docs.some(snapshot => snapshot.id === id), false);
    await assertSucceeds(getDoc(doc(owner, 'farmProfiles', 'owner')));
    console.log('Ownership, private profiles, simultaneous applications, allocations, stale confirmation, closing: passed');
  } finally { await env.cleanup(); }
});
