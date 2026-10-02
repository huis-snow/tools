"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const schedule = require("../app.js");
const candidates = require("../availability-candidates.js");
const online = require("../online-room-core.js");
const saved = require("../saved-schedules.js");
const comparisons = require("../saved-comparisons.js");

function selectRange(slots, days, start, end, startHour = 8) {
  schedule.rangeSlotIndexes(days, start, end, startHour).forEach((index) => schedule.setSelected(slots, index, true));
}

function legacySlots(selected) {
  const bytes = new Uint8Array(21);
  selected.forEach(([hour, day]) => {
    const index = hour * 7 + day;
    bytes[index >> 3] |= 1 << (index & 7);
  });
  return Buffer.from(bytes).toString("base64url");
}

test("기존 링크와 보관함의 1시간 선택을 앞·뒤 30분으로 손실 없이 확장한다", () => {
  const old = legacySlots([[0, 0], [23, 6], [19, 2]]);
  const loaded = schedule.parseShareHash(`#v=1&h=8&d=5&s=${old}`);
  assert.equal(loaded.startHour, 8);
  assert.equal(loaded.startDay, 5);
  assert.equal(schedule.countSelected(loaded.slots), 6);
  for (const [hour, day] of [[0, 0], [23, 6], [19, 2]]) {
    assert.equal(schedule.isSelected(loaded.slots, schedule.slotIndex(hour, day)), true);
    assert.equal(schedule.isSelected(loaded.slots, schedule.slotIndex(hour + 0.5, day)), true);
  }
  assert.deepEqual(schedule.selectedRanges(loaded.slots, 6, 8), [[23, 24]]);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const record = saved.saveSchedule(storage, { ...loaded, title: "이전 일정", slots: old }, { id: "old" });
  assert.equal(record.slots.length, 56);
  assert.deepEqual(schedule.decodeSlots(record.slots), loaded.slots);
  assert.equal(comparisons.canonicalMemberKey({ ...loaded, slots: old }), comparisons.canonicalMemberKey(loaded));
});

test("30분 경계와 익일 구간은 여러 요일에 적용되고 공유·텍스트로 왕복된다", () => {
  const slots = schedule.createSlots();
  selectRange(slots, [0, 2, 4], 19.5, 25.5);
  assert.equal(schedule.countSelected(slots), 36);
  assert.equal(schedule.isSelected(slots, schedule.slotIndex(19, 0)), false);
  assert.equal(schedule.isSelected(slots, schedule.slotIndex(19.5, 0)), true);
  assert.equal(schedule.isSelected(slots, schedule.slotIndex(1, 0)), true);
  assert.equal(schedule.isSelected(slots, schedule.slotIndex(1.5, 0)), false);
  assert.deepEqual(schedule.selectedRanges(slots, 0, 8), [[19.5, 25.5]]);
  assert.match(schedule.formatScheduleText(slots, { startHour: 8 }), /월: 19:30–익일 01:30/);
  assert.deepEqual(schedule.parseShareHash(schedule.makeShareHash(slots, { startHour: 8 })).slots, slots);
  assert.equal(schedule.slotCalendarLabel("2026-07-20", 0, 6, 23.5, 8), "2026. 7. 26.(일) 23:30–2026. 7. 27.(월) 00:00");
});

test("구간 입력은 요일·30분 간격·종료 순서와 하루 경계를 검사한다", () => {
  assert.throws(() => schedule.rangeSlotIndexes([], 19, 23, 8), /요일/);
  assert.throws(() => schedule.rangeSlotIndexes([7], 19, 23, 8), /요일/);
  assert.throws(() => schedule.rangeSlotIndexes([0], 19.25, 23, 8), /30분/);
  assert.throws(() => schedule.rangeSlotIndexes([0], 19, 19, 8), /종료/);
  assert.throws(() => schedule.rangeSlotIndexes([0], 23, 1, 8), /익일/);
  assert.throws(() => schedule.rangeSlotIndexes([0], 8, 32.5, 8), /종료/);
  assert.equal(schedule.rangeSlotIndexes([0, 0], 8, 32, 8).length, 48);
});

test("서로 다른 하루 시작의 30분을 같은 실제 요일에 취합한다", () => {
  const mondayNight = schedule.createSlots();
  const tuesdayMorning = schedule.createSlots();
  selectRange(mondayNight, [0], 24.5, 26);
  selectRange(tuesdayMorning, [1], 0.5, 2, 0);
  const participants = [{ slots: mondayNight, startHour: 8 }, { slots: tuesdayMorning, startHour: 0 }];
  const aggregate = schedule.aggregateSchedules(participants, 0);
  assert.deepEqual(aggregate.cells[schedule.slotIndex(0.5, 1)].participantIndexes, [0, 1]);
  assert.equal(aggregate.cells[schedule.slotIndex(0, 1)].count, 0);
  const found = candidates.findAvailabilityCandidates(participants, { startHour: 0, duration: 1.5, threshold: "N" });
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].startHour, 0.5);
  assert.equal(found.candidates[0].endHour, 2);
  assert.equal(found.candidates[0].duration, 1.5);
  assert.equal(found.candidates[0].slotIndexes.length, 3);
});

test("앞·뒤 30분의 참석자가 다르면 1시간 전원 후보로 오인하지 않는다", () => {
  const first = schedule.createSlots();
  const second = schedule.createSlots();
  selectRange(first, [0], 19, 19.5);
  selectRange(second, [0], 19.5, 20);
  const participants = [{ slots: first }, { slots: second }];
  const result = candidates.findAvailabilityCandidates(participants, { duration: 1, threshold: "N" });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.allCandidates.length, 2);
  assert.equal(result.allCandidates.every((candidate) => candidate.duration === 0.5), true);
  assert.throws(() => candidates.findAvailabilityCandidates(participants, { duration: 1.25 }), /30분/);
});

test("온라인 응답은 기존 28자와 새 56자만 허용하고 실제 날짜를 반시간에도 유지한다", () => {
  for (const slots of ["A".repeat(28), "A".repeat(56)]) assert.equal(online.normalizeResponse({ nickname: "친구", slots }).slots, slots);
  for (const slots of ["A".repeat(42), "A".repeat(55), "A".repeat(57), "!".repeat(56)]) assert.throws(() => online.normalizeResponse({ nickname: "친구", slots }));
  assert.equal(online.roomSlotDate("2026-07-20", 0, 0, 0.5, 8), "2026-07-21");
});
