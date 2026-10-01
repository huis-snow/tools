const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../core.js');
const prefs = (...seats) => Object.fromEntries(core.SEATS.map(s => [s, seats.includes(s) ? 2 : 0]));
const person = (seats, joinedAt = 1) => ({ nickname: '참여자', server: '', memo: '', preferences: prefs(...seats), wing: false, joinedAt, updatedAt: joinedAt });
const room = (applicants) => ({ applicants, assignments: {}, locks: {}, status: 'open' });
test('fills all eight seats before maximizing preferences, without greedy blocking', () => {
  const value = room({ early: person(['T1', 'T2']), later: person(['T1'], 2), ...Object.fromEntries(core.SEATS.slice(2).map(s => [s, person([s])])) });
  const result = core.recommend(value);
  assert.equal(Object.keys(result).length, 8); assert.equal(result.T1, 'later'); assert.equal(result.T2, 'early');
});
test('keeps locks and respects earlier applications for equal preference', () => {
  const value = room({ first: person(['T1'], 1), second: person(['T1'], 2), fixed: person(['T2'], 3) });
  value.assignments = { T2: 'fixed' }; value.locks = { T2: true };
  assert.deepEqual(core.recommend(value), { T2: 'fixed', T1: 'first' });
});
test('maximizes preferred placements and leaves incompatible applicants waiting', () => {
  const value = room({ a: person(['T1']), b: person(['T1', 'T2']), c: person(['T1']) });
  value.applicants.a.preferences.T1 = 1;
  const result = core.recommend(value); assert.equal(result.T1, 'c'); assert.equal(result.T2, 'b');
});
test('own application changes clear incompatible assignment and lock, retain join order', () => {
  const value = room({ me: person(['T1'], 10), other: person(['H1']) }); value.assignments.T1 = 'me'; value.locks.T1 = true;
  const patch = core.applyApplication(value, 'me', person(['D1']), 20);
  assert.equal(patch.applicants.me.joinedAt, 10); assert.deepEqual(patch.assignments, {}); assert.deepEqual(patch.locks, {});
  assert.equal(value.applicants.me.preferences.T1, 2);
  const withdrawal = core.applyApplication(value, 'me', null, 30); assert.equal(withdrawal.applicants.me, undefined); assert.ok(withdrawal.applicants.other);
});
test('confirmed and closed rooms reject applications; incomplete party cannot finalize', () => {
  for (const status of ['confirmed', 'closed']) assert.throws(() => core.applyApplication({ ...room({}), status }, 'me', person(['T1']), 1));
  assert.throws(() => core.manage(room({}), { type: 'confirm' }));
});
test('manual assignment cannot move locked person or duplicate a person', () => {
  const value = room({ me: person(['T1', 'T2']) }); value.assignments.T1 = 'me'; value.locks.T1 = true;
  assert.throws(() => core.manage(value, { type: 'assign', seat: 'T2', uid: 'me' }));
  delete value.locks.T1;
  assert.deepEqual(core.manage(value, { type: 'assign', seat: 'T2', uid: 'me' }).assignments, { T2: 'me' });
});
test('limits new applications to 100 but permits update and withdrawal', () => {
  const value = room(Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['u' + i, person(['T1'])])));
  assert.throws(() => core.applyApplication(value, 'new', person(['T1']), 2));
  assert.equal(Object.keys(core.applyApplication(value, 'u0', person(['T2']), 2).applicants).length, 100);
  assert.equal(Object.keys(core.applyApplication(value, 'u0', null, 2).applicants).length, 99);
});
test('validates the seven-trial profile, dates, and untrusted IDs', () => {
  assert.equal(core.TRIALS.length, 7);
  assert.throws(() => core.profile({ nickname: '나', server: '', memo: '', preferences: prefs(), wings: Array(7).fill(false) }));
  assert.throws(() => core.draft({ trial: 0, title: '방', date: '2026-02-30', time: '21:00', description: '' }));
  assert.throws(() => core.uid('__proto__'));
  assert.equal(core.roomId(core.createRoomId()).length, 22);
});

test('multiple trials validate selection and snapshot only selected wing records', () => {
  const input = { trials: [6, 0, 2], title: '여러 토벌전', date: '2026-10-02', time: '21:00', description: '' };
  const draft = core.draft(input);
  assert.equal(draft.version, 2); assert.deepEqual(draft.trials, [0, 2, 6]);
  for (const trials of [[], [0, 0], [7], [-1], ['0'], [0.5], null]) assert.throws(() => core.draft({ ...input, trials }));
  const wings = [true, true, false, true, true, true, true];
  const snapshot = core.applicationWings(draft, wings);
  assert.deepEqual(snapshot, { wings: { '0': true, '2': false, '6': true } });
  const value = { ...room({}), ...draft, ownerUid: 'host', revision: 0 };
  const patch = core.applyApplication(value, 'me', { ...person(['D2']), ...snapshot }, 2);
  const loaded = core.room({ ...value, ...patch }, 'abcdefghijklmnopqrstuv');
  assert.deepEqual(loaded.applicants.me.wings, snapshot.wings);
  assert.equal(core.wing(loaded, loaded.applicants.me, 2), false);
  assert.equal(core.wing(loaded, loaded.applicants.me, 6), true);
  assert.equal(loaded.applicants.me.wing, undefined);
  for (const invalid of [{ '0': true }, { ...snapshot.wings, '1': false }, { ...snapshot.wings, '6': 'true' }]) {
    assert.throws(() => core.applyApplication(value, 'me', { ...person(['D2']), wings: invalid }, 2));
  }
  assert.deepEqual(core.recommend(loaded), { D2: 'me' });
  assert.deepEqual(core.applyApplication(loaded, 'me', null, 3).applicants, {});
});

test('legacy single-trial rooms retain their schema and applications', () => {
  const draft = core.draft({ trial: 4, title: '기존 방', date: '2026-10-02', time: '21:00', description: '' });
  const value = { ...room({ me: person(['T1']) }), ...draft, ownerUid: 'host', revision: 0 };
  const loaded = core.room(value, 'abcdefghijklmnopqrstuv');
  assert.equal(loaded.version, 1); assert.deepEqual(core.trials(loaded), [4]);
  const snapshot = core.applicationWings(loaded, [false, false, false, false, true, false, false]);
  assert.deepEqual(snapshot, { wing: true });
  const patch = core.applyApplication(loaded, 'me', { ...person(['T1']), ...snapshot }, 3);
  assert.equal(patch.applicants.me.wing, true); assert.equal(patch.applicants.me.wings, undefined);
  assert.equal(core.wing(loaded, patch.applicants.me, 4), true);
  assert.throws(() => core.room({ ...value, version: 2 }, 'abcdefghijklmnopqrstuv'));
});
