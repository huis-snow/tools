"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_TITLE,
  DAYS,
  HOURS,
  SLOT_COUNT,
  slotIndex,
  slotCoordinates,
  createSlots,
  isSelected,
  setSelected,
  countSelected,
  encodeSlots,
  decodeSlots,
  makeShareHash,
  parseShareHash,
  parseShareInput,
  makeShareUrl,
  displayHours,
  normalizeStartDay,
  displayDayIndexes,
  selectedRanges,
  formatScheduleText,
  aggregateSchedules,
} = require("../app.js");

test("월요일 0시부터 일요일 23시까지 168개 인덱스가 모두 고유하다", () => {
  const indexes = new Set();
  for (let hour = 0; hour < HOURS; hour += 1) {
    for (let day = 0; day < DAYS.length; day += 1) indexes.add(slotIndex(hour, day));
  }
  assert.equal(indexes.size, SLOT_COUNT);
  assert.equal(slotIndex(0, 0), 0);
  assert.equal(slotIndex(23, 6), 167);
  assert.deepEqual(slotCoordinates(167), { hour: 23, day: 6 });
});

test("첫 칸과 마지막 칸을 서로 영향 없이 선택하고 지운다", () => {
  const slots = createSlots();
  setSelected(slots, 0, true);
  setSelected(slots, 167, true);
  assert.equal(isSelected(slots, 0), true);
  assert.equal(isSelected(slots, 1), false);
  assert.equal(isSelected(slots, 166), false);
  assert.equal(isSelected(slots, 167), true);
  setSelected(slots, 0, false);
  assert.equal(isSelected(slots, 0), false);
  assert.equal(isSelected(slots, 167), true);
});

test("하루 시작이 8시면 8시부터 23시, 익일 0시부터 7시 순서로 표시한다", () => {
  assert.deepEqual(displayHours(8), [
    8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 7,
  ]);
});

test("토요일부터 시작하면 토·일·월·화·수·목·금 순서로 표시한다", () => {
  assert.equal(normalizeStartDay(5), 5);
  assert.deepEqual(displayDayIndexes(5), [5, 6, 0, 1, 2, 3, 4]);
});

test("빈 일정과 전체 일정은 각각 고정된 28자 문자열로 인코딩된다", () => {
  assert.equal(encodeSlots(createSlots()), "AAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(encodeSlots(createSlots(true)), "____________________________");
});

test("여러 선택 패턴이 인코딩과 디코딩 후 그대로 복원된다", () => {
  let seed = 73;
  for (let round = 0; round < 100; round += 1) {
    const slots = createSlots();
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 5 === 0) setSelected(slots, index, true);
    }
    assert.deepEqual(decodeSlots(encodeSlots(slots)), slots);
  }
});

test("손상되거나 base64url이 아닌 선택 데이터는 거절한다", () => {
  for (const invalid of ["", "A".repeat(27), "A".repeat(29), "+".repeat(28), "/".repeat(28), "%".repeat(28)]) {
    assert.throws(() => decodeSlots(invalid));
  }
  assert.throws(() => decodeSlots(null));
});

test("공유 hash에 제목·시간대·하루 시작·시작 요일·선택 상태가 왕복된다", () => {
  const slots = createSlots();
  setSelected(slots, slotIndex(9, 0), true);
  setSelected(slots, slotIndex(18, 4), true);
  const hash = makeShareHash(slots, {
    title: "다음 주 스터디",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 5,
  });
  const parsed = parseShareHash(hash);
  assert.equal(new URLSearchParams(hash.slice(1)).get("h"), "8");
  assert.equal(new URLSearchParams(hash.slice(1)).get("d"), "5");
  assert.equal(parsed.title, "다음 주 스터디");
  assert.equal(parsed.timezone, "Asia/Seoul");
  assert.equal(parsed.startHour, 8);
  assert.equal(parsed.startDay, 5);
  assert.deepEqual(parsed.slots, slots);
});

test("새 공유 hash는 기본 시작 요일인 월요일도 d=0으로 기록한다", () => {
  const parameters = new URLSearchParams(makeShareHash(createSlots()).slice(1));
  assert.equal(parameters.getAll("d").length, 1);
  assert.equal(parameters.get("d"), "0");
});

test("빈 일정 이름은 placeholder와 같은 기본 제목을 사용한다", () => {
  const slots = createSlots();
  const parsed = parseShareHash(makeShareHash(slots, { title: "", startHour: 8 }));
  assert.equal(DEFAULT_TITLE, "우리의 가능한 시간");
  assert.equal(parsed.title, DEFAULT_TITLE);
  assert.match(formatScheduleText(slots, { title: "" }), /^\[우리의 가능한 시간\]/);
});

test("하루 시작과 시작 요일 정보가 없는 기존 공유 hash는 0시·월요일 시작으로 해석한다", () => {
  const encoded = encodeSlots(createSlots());
  const parsed = parseShareHash(`#v=1&s=${encoded}`);
  assert.equal(parsed.startHour, 0);
  assert.equal(parsed.startDay, 0);
});

test("공유 hash는 버전과 선택 데이터가 없거나 중복되면 거절한다", () => {
  const encoded = encodeSlots(createSlots());
  assert.throws(() => parseShareHash(`#s=${encoded}`));
  assert.throws(() => parseShareHash(`#v=2&s=${encoded}`));
  assert.throws(() => parseShareHash(`#v=1`));
  assert.throws(() => parseShareHash(`#v=1&v=1&s=${encoded}`));
  assert.throws(() => parseShareHash(`#v=1&s=${encoded}&s=${encoded}`));
  assert.throws(() => parseShareHash(`#v=1&h=8&h=9&s=${encoded}`));
  assert.throws(() => parseShareHash(`#v=1&d=5&d=6&s=${encoded}`));
  assert.equal(parseShareHash(""), null);
});

test("공유 hash의 하루 시작은 0부터 23까지의 정수만 허용한다", () => {
  const encoded = encodeSlots(createSlots());
  for (const invalid of ["", "-1", "24", "1.5", "오전", "008"]) {
    assert.throws(() => parseShareHash(`#v=1&h=${encodeURIComponent(invalid)}&s=${encoded}`));
  }
});

test("공유 hash의 시작 요일은 0부터 6까지의 정수만 허용한다", () => {
  const encoded = encodeSlots(createSlots());
  for (const invalid of ["", "-1", "7", "1.5", "토", "06"]) {
    assert.throws(() => parseShareHash(`#v=1&d=${encodeURIComponent(invalid)}&s=${encoded}`));
  }
});

test("공유 URL은 기존 경로와 query를 유지하고 hash만 교체한다", () => {
  const url = makeShareUrl("https://example.com/tools/schedule/?from=home#old", createSlots(), {
    title: "회의",
    timezone: "UTC",
  });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, "/tools/schedule/");
  assert.equal(parsed.search, "?from=home");
  assert.match(parsed.hash, /^#v=1&/);
});

test("연속 선택은 하나의 시간 범위로 합치고 빈 구간은 분리한다", () => {
  const slots = createSlots();
  [9, 10, 11, 14, 15].forEach((hour) => setSelected(slots, slotIndex(hour, 0), true));
  assert.deepEqual(selectedRanges(slots, 0), [
    [9, 12],
    [14, 16],
  ]);
  const text = formatScheduleText(slots, { title: "스터디", timezone: "Asia/Seoul" });
  assert.match(text, /월: 09:00–12:00, 14:00–16:00/);
  assert.match(text, /화: 선택 없음/);
});

test("텍스트 일정은 설정한 시작 요일부터 출력하되 선택 요일은 바꾸지 않는다", () => {
  const slots = createSlots();
  setSelected(slots, slotIndex(9, 0), true);
  setSelected(slots, slotIndex(10, 6), true);
  const text = formatScheduleText(slots, { startHour: 8, startDay: 6 });

  assert.match(text, /시작 요일: 일요일/);
  assert.ok(text.indexOf("일: 10:00–11:00") < text.indexOf("월: 09:00–10:00"));
  assert.ok(text.indexOf("월: 09:00–10:00") < text.indexOf("토: 선택 없음"));
});

test("8시 시작 일정은 같은 요일 열의 23시·0시·1시를 자정 너머 한 범위로 합친다", () => {
  const slots = createSlots();
  [23, 0, 1].forEach((hour) => setSelected(slots, slotIndex(hour, 0), true));

  assert.deepEqual(selectedRanges(slots, 0, 8), [[23, 26]]);
  assert.match(
    formatScheduleText(slots, { startHour: 8 }),
    /월: 23:00–익일 02:00/,
  );
});

test("23시와 하루 전체 선택의 끝은 24:00으로 표시한다", () => {
  const lastHour = createSlots();
  setSelected(lastHour, slotIndex(23, 6), true);
  assert.match(formatScheduleText(lastHour), /일: 23:00–24:00/);

  const fullMonday = createSlots();
  for (let hour = 0; hour < HOURS; hour += 1) setSelected(fullMonday, slotIndex(hour, 0), true);
  assert.deepEqual(selectedRanges(fullMonday, 0), [[0, 24]]);
  assert.match(formatScheduleText(fullMonday), /월: 00:00–24:00/);
  assert.equal(countSelected(fullMonday), 24);
});

test("8시 시작 일정의 하루 전체는 익일 8시까지 한 범위로 표시한다", () => {
  const fullMonday = createSlots();
  for (let hour = 0; hour < HOURS; hour += 1) {
    setSelected(fullMonday, slotIndex(hour, 0), true);
  }

  assert.deepEqual(selectedRanges(fullMonday, 0, 8), [[8, 32]]);
  assert.match(
    formatScheduleText(fullMonday, { startHour: 8 }),
    /월: 08:00–익일 08:00/,
  );
});

test("hash·전체 URL·Discord 자동 임베드 방지 URL에서 공유 일정을 읽는다", () => {
  const slots = createSlots();
  setSelected(slots, slotIndex(1, 0), true);
  const hash = makeShareHash(slots, {
    title: "심야 스터디",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 5,
  });
  const url = `https://example.com/schedule-maker/${hash}`;

  for (const input of [hash, url, `<${url}>`, `  <${url}>  `]) {
    const parsed = parseShareInput(input);
    assert.equal(parsed.title, "심야 스터디");
    assert.equal(parsed.startHour, 8);
    assert.equal(parsed.startDay, 5);
    assert.deepEqual(parsed.slots, slots);
  }
});

test("공유 데이터가 없는 URL과 깨진 Discord URL 입력은 거절한다", () => {
  for (const invalid of [
    "",
    "일정 링크",
    "https://example.com/schedule-maker/",
    "<https://example.com/schedule-maker/>",
    "<https://example.com/schedule-maker/#broken",
  ]) {
    assert.throws(() => parseShareInput(invalid));
  }
});

test("시작 시각이 같으면 모든 선택을 같은 논리 요일과 시간에 합산한다", () => {
  const first = createSlots();
  const second = createSlots();
  setSelected(first, slotIndex(1, 0), true);
  setSelected(first, slotIndex(23, 4), true);
  setSelected(second, slotIndex(1, 0), true);

  const aggregate = aggregateSchedules([
    { slots: first, startHour: 8 },
    { slots: second, startHour: 8 },
  ], 8);

  assert.equal(aggregate.cells.length, SLOT_COUNT);
  assert.equal(aggregate.startHour, 8);
  assert.deepEqual(aggregate.cells[slotIndex(1, 0)].participantIndexes, [0, 1]);
  assert.equal(aggregate.cells[slotIndex(1, 0)].count, 2);
  assert.deepEqual(aggregate.cells[slotIndex(23, 4)].participantIndexes, [0]);
  assert.equal(aggregate.maxCount, 2);
});

test("8시 시작 원본의 자정 이후 선택은 0시 시작 기준의 다음 달력 요일로 옮긴다", () => {
  const source = createSlots();
  setSelected(source, slotIndex(0, 0), true); // 월요일 열의 익일, 즉 화요일 0시
  setSelected(source, slotIndex(7, 6), true); // 일요일 열의 익일, 즉 월요일 7시
  setSelected(source, slotIndex(8, 0), true); // 시작 경계는 월요일 8시 그대로

  const { cells } = aggregateSchedules([{ slots: source, startHour: 8 }], 0);

  assert.deepEqual(cells[slotIndex(0, 1)].participantIndexes, [0]);
  assert.deepEqual(cells[slotIndex(7, 0)].participantIndexes, [0]);
  assert.deepEqual(cells[slotIndex(8, 0)].participantIndexes, [0]);
  assert.equal(cells[slotIndex(0, 0)].count, 0);
});

test("0시 시작 원본의 자정 이후 선택은 8시 시작 기준의 이전 논리 요일로 옮긴다", () => {
  const source = createSlots();
  setSelected(source, slotIndex(0, 1), true); // 달력상 화요일 0시 → 월요일 열 익일 0시
  setSelected(source, slotIndex(7, 0), true); // 달력상 월요일 7시 → 일요일 열 익일 7시
  setSelected(source, slotIndex(8, 0), true); // 시작 경계는 월요일 8시 그대로

  const { cells } = aggregateSchedules([{ slots: source, startHour: 0 }], 8);

  assert.deepEqual(cells[slotIndex(0, 0)].participantIndexes, [0]);
  assert.deepEqual(cells[slotIndex(7, 6)].participantIndexes, [0]);
  assert.deepEqual(cells[slotIndex(8, 0)].participantIndexes, [0]);
  assert.equal(cells[slotIndex(0, 1)].count, 0);
});

test("서로 다른 시작 시각의 같은 달력 시간이 한 셀에 모인다", () => {
  const startsAtEight = createSlots();
  const startsAtMidnight = createSlots();
  setSelected(startsAtEight, slotIndex(0, 0), true);
  setSelected(startsAtMidnight, slotIndex(0, 1), true);

  const atMidnight = aggregateSchedules([
    { slots: startsAtEight, startHour: 8 },
    { slots: startsAtMidnight, startHour: 0 },
  ], 0);
  assert.deepEqual(atMidnight.cells[slotIndex(0, 1)].participantIndexes, [0, 1]);
  assert.equal(atMidnight.cells[slotIndex(0, 1)].count, 2);
  assert.equal(atMidnight.maxCount, 2);

  const atEight = aggregateSchedules([
    { slots: startsAtEight, startHour: 8 },
    { slots: startsAtMidnight, startHour: 0 },
  ], 8);
  assert.deepEqual(atEight.cells[slotIndex(0, 0)].participantIndexes, [0, 1]);
  assert.equal(atEight.maxCount, 2);
});

test("시작 요일은 열 표시 순서일 뿐 집계 좌표를 바꾸지 않는다", () => {
  const first = createSlots();
  const second = createSlots();
  setSelected(first, slotIndex(10, 0), true);
  setSelected(second, slotIndex(10, 0), true);

  const aggregate = aggregateSchedules([
    { slots: first, startHour: 8, startDay: 0 },
    { slots: second, startHour: 8, startDay: 5 },
  ], 8);

  assert.deepEqual(aggregate.cells[slotIndex(10, 0)].participantIndexes, [0, 1]);
  assert.equal(aggregate.cells[slotIndex(10, 0)].count, 2);
  assert.equal(aggregate.cells[slotIndex(10, 5)].count, 0);
});

test("23시 시작 일정도 자정 전후와 일요일·월요일 경계를 보존한다", () => {
  const source = createSlots();
  setSelected(source, slotIndex(23, 6), true); // 일요일 23시
  setSelected(source, slotIndex(22, 6), true); // 일요일 열의 익일, 즉 월요일 22시
  setSelected(source, slotIndex(0, 0), true); // 월요일 열의 익일, 즉 화요일 0시

  const { cells } = aggregateSchedules([{ slots: source, startHour: 23 }], 8);

  assert.equal(cells[slotIndex(23, 6)].count, 1);
  assert.equal(cells[slotIndex(22, 0)].count, 1);
  assert.equal(cells[slotIndex(0, 0)].count, 1);
  assert.equal(cells[slotIndex(22, 6)].count, 0);
});
