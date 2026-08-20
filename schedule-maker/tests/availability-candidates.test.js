"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  SLOT_COUNT,
  SLOT_BYTES,
  aggregateParticipantSchedules,
  findAvailabilityCandidates,
} = require("../availability-candidates.js");

function slotIndex(hour, day) {
  return hour * 7 + day;
}

function emptyCells() {
  return Array.from({ length: SLOT_COUNT }, (_value, index) => ({
    index,
    hour: Math.floor(index / 7),
    day: index % 7,
    participantIndexes: [],
    count: 0,
  }));
}

function setCell(cells, hour, day, participantIndexes) {
  const index = slotIndex(hour, day);
  cells[index] = {
    index,
    hour,
    day,
    participantIndexes: [...participantIndexes],
    count: participantIndexes.length,
  };
}

function createSlots() {
  return new Uint8Array(SLOT_BYTES);
}

function select(slots, hour, day) {
  const index = slotIndex(hour, day);
  slots[index >> 3] |= 1 << (index & 7);
}

test("CommonJS와 브라우저 전역에서 같은 후보 API를 제공한다", () => {
  const source = fs.readFileSync(path.join(__dirname, "../availability-candidates.js"), "utf8");
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);

  assert.equal(typeof findAvailabilityCandidates, "function");
  assert.equal(typeof context.EonjepyoAvailabilityCandidates.findAvailabilityCandidates, "function");
  assert.equal(context.EonjepyoAvailabilityCandidates.MAX_PARTICIPANTS, 200);
});

test("같은 고정 참석자 집합의 연속 구간은 한 개의 maximal block으로 중복 제거한다", () => {
  const cells = emptyCells();
  for (let hour = 9; hour <= 14; hour += 1) setCell(cells, hour, 0, [0, 1, 2]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 3 },
    { duration: 2, threshold: "auto" },
  );

  assert.equal(result.allCandidates.length, 1);
  assert.deepEqual(result.candidates[0].participantIndexes, [0, 1, 2]);
  assert.equal(result.candidates[0].startHour, 9);
  assert.equal(result.candidates[0].endHour, 15);
  assert.equal(result.candidates[0].duration, 6);
  assert.deepEqual(result.candidates[0].slotIndexes, [
    slotIndex(9, 0),
    slotIndex(10, 0),
    slotIndex(11, 0),
    slotIndex(12, 0),
    slotIndex(13, 0),
    slotIndex(14, 0),
  ]);
});

test("매시간 인원이 교대하면 셀별 인원 수를 연속 참석 인원으로 오인하지 않는다", () => {
  const cells = emptyCells();
  setCell(cells, 20, 2, [0, 1]);
  setCell(cells, 21, 2, [1, 2]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 3 },
    { duration: 2, threshold: "auto" },
  );

  assert.equal(result.selectedAttendeeCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].participantIndexes, [1]);
  assert.equal(result.candidates[0].duration, 2);
  assert.equal(result.candidates.some((candidate) => candidate.attendeeCount === 2), false);
});

test("시작 시각의 하루 열 안에서는 자정을 지나도 연속 구간으로 계산한다", () => {
  const cells = emptyCells();
  for (const hour of [22, 23, 0, 1]) setCell(cells, hour, 4, [0, 1]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 2 },
    { duration: 4, threshold: "N", startDay: 4 },
  );
  const candidate = result.candidates[0];

  assert.equal(candidate.day, 4);
  assert.equal(candidate.startHour, 22);
  assert.equal(candidate.endHour, 2);
  assert.equal(candidate.duration, 4);
  assert.equal(candidate.crossesMidnight, true);
  assert.equal(candidate.startDayOffset, 0);
  assert.equal(candidate.endDayOffset, 1);
  assert.deepEqual(candidate.slotIndexes, [
    slotIndex(22, 4),
    slotIndex(23, 4),
    slotIndex(0, 4),
    slotIndex(1, 4),
  ]);
});

test("표시상 이웃한 요일 열의 끝과 다음 열의 시작은 연결하지 않는다", () => {
  const cells = emptyCells();
  setCell(cells, 7, 6, [0]); // 일요일 열의 마지막 행
  setCell(cells, 8, 0, [0]); // 다음 월요일 열의 첫 행

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 1 },
    { duration: 1, threshold: "N", startDay: 6 },
  );

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((candidate) => [candidate.day, candidate.duration]), [
    [6, 1],
    [0, 1],
  ]);
  assert.equal(result.allCandidates.some((candidate) => candidate.duration === 2), false);
});

test("auto는 필요 시간을 만족하는 최고 참석 단계를 고르고 짧은 전원 후보를 비교 정보로 남긴다", () => {
  const cells = emptyCells();
  setCell(cells, 9, 0, [0, 1, 2, 3]);
  for (let hour = 10; hour <= 13; hour += 1) setCell(cells, hour, 0, [0, 1, 2]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 4 },
    { duration: 3, threshold: "auto" },
  );

  assert.equal(result.selectedAttendeeCount, 3);
  assert.equal(result.threshold.effectiveMinimumAttendees, 3);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].duration, 5);
  assert.deepEqual(result.candidates[0].participantIndexes, [0, 1, 2]);
  assert.deepEqual(result.candidates[0].missingParticipantIndexes, [3]);
  assert.equal(result.comparison.everyoneShortCandidates.length, 1);
  assert.equal(result.comparison.everyoneShortCandidates[0].duration, 1);
  assert.deepEqual(
    result.skylineCandidates.map((candidate) => [candidate.attendeeCount, candidate.duration]),
    [[3, 5]],
  );
});

test("auto 스카이라인은 필요 시간을 만족하는 전원 단기와 n-1 장기를 함께 제공한다", () => {
  const cells = emptyCells();
  for (const hour of [8, 9, 10]) setCell(cells, hour, 0, [0, 1, 2, 3]);
  for (const hour of [11, 12]) setCell(cells, hour, 0, [0, 1, 2]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 4 },
    { duration: 3, threshold: "auto" },
  );

  assert.deepEqual(
    result.skylineCandidates.map((candidate) => [candidate.attendeeCount, candidate.duration]),
    [[4, 3], [3, 5]],
  );
  assert.equal(result.skylineCandidates.every((candidate) => candidate.duration >= 3), true);
  assert.deepEqual(
    result.candidates.map((candidate) => [candidate.attendeeCount, candidate.duration]),
    [[4, 3]],
  );
});

test("auto는 의미 있는 전원·n-1·n-2 범위보다 적은 참석 후보까지 넓히지 않는다", () => {
  const cells = emptyCells();
  for (const hour of [8, 9, 10, 11]) setCell(cells, hour, 0, [0, 1]);

  const result = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 8 },
    { duration: 3, threshold: "auto" },
  );

  assert.equal(result.selectedAttendeeCount, null);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.skylineCandidates, []);
});

test("N-1과 정수 기준은 최소 인원으로 작동하며 높은 인원·긴 구간·화면 순으로 정렬한다", () => {
  const cells = emptyCells();
  setCell(cells, 8, 0, [0, 1, 2, 3]);
  for (const hour of [9, 10, 11]) setCell(cells, hour, 0, [0, 1, 2]);
  for (const hour of [18, 19, 20, 21]) setCell(cells, hour, 6, [0, 1, 2]);
  for (const hour of [12, 13, 14, 15, 16]) setCell(cells, hour, 1, [0, 1]);

  const minimumThree = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 4 },
    { duration: 1, threshold: "N-1", startDay: 6 },
  );
  assert.equal(minimumThree.threshold.minimumAttendees, 3);
  assert.deepEqual(
    minimumThree.candidates.map((candidate) => [candidate.attendeeCount, candidate.duration, candidate.day]),
    [[4, 1, 0], [3, 4, 6], [3, 4, 0]],
  );

  const minimumTwo = findAvailabilityCandidates(
    { cells, startHour: 8, participantCount: 4 },
    { duration: 4, threshold: 2, startDay: 6 },
  );
  assert.deepEqual(
    minimumTwo.candidates.map((candidate) => [candidate.attendeeCount, candidate.duration, candidate.day]),
    [[3, 4, 6], [3, 4, 0], [2, 5, 1]],
  );
});

test("참여자 slots 입력은 서로 다른 시작 시각을 같은 달력 시간으로 맞춰 취합한다", () => {
  const startsAtEight = createSlots();
  const startsAtMidnight = createSlots();
  select(startsAtEight, 0, 0); // 8시 기준 월요일 열의 익일 화요일 0시
  select(startsAtMidnight, 0, 1); // 0시 기준 화요일 0시

  const aggregate = aggregateParticipantSchedules([
    { slots: startsAtEight, startHour: 8 },
    { slots: startsAtMidnight, startHour: 0 },
  ], 0);
  assert.deepEqual(aggregate.cells[slotIndex(0, 1)].participantIndexes, [0, 1]);

  const result = findAvailabilityCandidates({
    participants: [
      { slots: startsAtEight, startHour: 8 },
      { slots: startsAtMidnight, startHour: 0 },
    ],
    startHour: 0,
  }, { duration: 1, threshold: "N" });
  assert.equal(result.candidates[0].day, 1);
  assert.equal(result.candidates[0].startHour, 0);
  assert.deepEqual(result.candidates[0].participantIndexes, [0, 1]);
});

test("기간·인원·취합 셀 경계를 검증한다", () => {
  const cells = emptyCells();
  assert.equal(
    findAvailabilityCandidates({ cells, participantCount: 9 }).participantCount,
    9,
    "수동 취합은 온라인 방의 8명 제한보다 많은 일정도 계속 분석해야 합니다",
  );
  assert.throws(
    () => findAvailabilityCandidates({ cells, participantCount: 1 }, { duration: 0 }),
    /필요 연속 시간/,
  );
  assert.throws(
    () => findAvailabilityCandidates({ cells, participantCount: 1 }, { duration: 7 }),
    /필요 연속 시간/,
  );
  assert.throws(
    () => findAvailabilityCandidates({ cells, participantCount: 201 }),
    /참여자 수/,
  );
  assert.throws(
    () => aggregateParticipantSchedules(Array.from({ length: 201 }, () => ({ slots: createSlots() }))),
    /참여자 수/,
  );
  assert.throws(
    () => findAvailabilityCandidates({ cells: cells.slice(1), participantCount: 1 }),
    /168개/,
  );
});
