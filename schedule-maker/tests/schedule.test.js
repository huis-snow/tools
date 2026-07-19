"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  DEFAULT_TITLE,
  DRAFT_KEY,
  DRAFT_RECOVERY_KEY,
  MAX_OVERLAP_LEVEL,
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
  normalizeCalendarDate,
  addCalendarDays,
  calendarWeekday,
  calendarPeriodLabel,
  slotCalendarLabel,
  selectedRanges,
  formatScheduleText,
  aggregateSchedules,
  overlapColorLevel,
  prepareBrowserStorage,
} = require("../app.js");

test("브라우저 부팅은 일정 저장 키를 보관함으로 옮기고 실패하면 localStorage를 유지한다", async () => {
  const originalVault = globalThis.SmallToolsVault;
  const originalLocalStorage = globalThis.localStorage;
  const fallback = { getItem() { return null; }, setItem() {} };
  const vaultStorage = { getItem() { return null; }, setItem() {} };
  const calls = [];
  globalThis.localStorage = fallback;
  try {
    globalThis.SmallToolsVault = {
      ready: Promise.resolve(),
      storage: vaultStorage,
      async migrateKeys(keys, options) { calls.push({ keys, options }); },
    };
    assert.equal(await prepareBrowserStorage(), vaultStorage);
    assert.deepEqual(calls, [{
      keys: [
        "eonjepyo-saved-schedules-v1",
        "eonjepyo-saved-schedules-v1:recovery",
        "eonjepyo-saved-comparisons-v1",
        "eonjepyo-saved-comparisons-v1:recovery",
        DRAFT_KEY,
        DRAFT_RECOVERY_KEY,
      ],
      options: { removeSource: true },
    }]);

    globalThis.SmallToolsVault = {
      ready: Promise.resolve(),
      storage: vaultStorage,
      async migrateKeys() { throw new Error("IndexedDB 쓰기 실패"); },
    };
    assert.equal(await prepareBrowserStorage(), fallback);
  } finally {
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

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

test("겹침 색은 1명부터 8명까지 서로 다른 단계이며 그 이상은 8단계로 묶는다", () => {
  assert.equal(MAX_OVERLAP_LEVEL, 8);
  assert.deepEqual(Array.from({ length: 9 }, (_value, count) => overlapColorLevel(count)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(overlapColorLevel(9), 8);
  assert.equal(overlapColorLevel(30), 8);
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

test("온라인 방 날짜는 7일 기간과 자정 이후 실제 날짜를 시간대와 무관하게 표시한다", () => {
  assert.equal(normalizeCalendarDate("2026-07-20"), "2026-07-20");
  assert.equal(normalizeCalendarDate("2026-02-29"), "");
  assert.equal(addCalendarDays("2026-12-29", 6), "2027-01-04");
  assert.equal(calendarWeekday("2026-07-20"), 0);
  assert.equal(calendarPeriodLabel("2026-07-20"), "2026. 7. 20.(월) ~ 7. 26.(일)");
  assert.equal(
    slotCalendarLabel("2026-07-20", 0, 0, 0, 8, { full: true }),
    "2026년 7월 21일 화요일 00:00–01:00",
  );
  assert.equal(
    slotCalendarLabel("2026-07-20", 0, 6, 23, 8),
    "2026. 7. 26.(일) 23:00–2026. 7. 27.(월) 00:00",
  );
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

test("저수준 출력 함수는 빈 일정 이름에 호환용 기본 제목을 사용한다", () => {
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

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
      contains: (value) => this.classList.values.has(value),
    };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.focused = false;
    this.tabIndex = -1;
    this.scrollTop = 0;
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  closest() { return null; }
  cloneNode() {
    const clone = new FakeElement();
    clone.value = this.value;
    clone.textContent = this.textContent;
    return clone;
  }
}

function descendantsMatching(element, predicate) {
  const matches = [];
  (element?.children || []).forEach((child) => {
    if (!child || typeof child !== "object") return;
    if (predicate(child)) matches.push(child);
    matches.push(...descendantsMatching(child, predicate));
  });
  return matches;
}

function runWithPageDom(ids, hash = "#top", options = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const body = new FakeElement("body");
  (options.bodyClasses || []).forEach((className) => body.classList.add(className));
  let storageReads = 0;
  const storage = new Map(Object.entries(options.storage || {}));
  const storageWrites = [];
  const historyCalls = [];
  const clipboardWrites = [];
  const timers = new Map();
  let nextTimerId = 1;
  const document = {
    readyState: "complete",
    body,
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll() { return []; },
    createElement() { return new FakeElement(); },
    createDocumentFragment() { return new FakeElement(); },
    createTextNode(value) { return String(value); },
    elementFromPoint() { return null; },
    addEventListener() {},
    execCommand() { return true; },
  };
  const location = {
    pathname: options.pathname || "/schedule-maker/compare.html",
    search: options.search || "",
    hash,
    href: "",
    replacedWith: null,
    replace(value) { this.replacedWith = value; },
  };
  location.href = `https://example.test${location.pathname}${location.search}${location.hash}`;
  const window = {
    location,
    history: {
      replaceState(_state, _unused, value) {
        historyCalls.push(String(value));
        const nextUrl = new URL(String(value), location.href);
        location.pathname = nextUrl.pathname;
        location.search = nextUrl.search;
        location.hash = nextUrl.hash;
        location.href = nextUrl.href;
      },
    },
    localStorage: {
      getItem(key) {
        storageReads += 1;
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
        storageWrites.push([key, String(value)]);
      },
    },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay = 0) {
      const timerId = nextTimerId;
      nextTimerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(timerId) { timers.delete(timerId); },
    confirm() { return true; },
    isSecureContext: true,
  };
  const context = {
    module: { exports: {} },
    Buffer,
    URL,
    URLSearchParams,
    Intl,
    Uint8Array,
    Date,
    Math,
    Set,
    Map,
    String,
    Number,
    Array,
    Object,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    document,
    window,
    navigator: {
      clipboard: {
        async writeText(value) { clipboardWrites.push(String(value)); },
      },
    },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "schedule-maker/app.js" });
  return {
    elements,
    storageReads,
    storage,
    storageWrites,
    historyCalls,
    clipboardWrites,
    location,
    api: context.module.exports,
    app: context.EonjepyoApp,
  };
}

const WRITER_PAGE_IDS = [
  "titleInput", "startHourSelect", "startDaySelect", "timezoneInput", "rangeLabel",
  "scheduleGrid", "scheduleScroller", "selectedCount", "selectionProgress", "undoButton",
  "clearButton", "resetButton", "liveRegion", "linkButton", "linkLabel", "textButton",
  "textLabel", "imageButton", "imageLabel", "pngButton", "toast",
];

test("일정 이름 입력란은 기본 이름을 placeholder로 대신 표시하지 않는다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const titleInput = html.match(/<input\b[^>]*\bid=["']titleInput["'][^>]*>/i);
  assert.ok(titleInput, "일정 이름 입력란을 찾을 수 있어야 한다");
  assert.doesNotMatch(titleInput[0], /\bplaceholder\s*=/i);
});

test("일정을 편집하면 draft만 저장하고 현재 주소에는 공유 데이터를 붙이지 않는다", () => {
  const result = runWithPageDom(WRITER_PAGE_IDS, "", { pathname: "/schedule-maker/" });
  const title = result.elements.get("titleInput");
  title.value = "쵸하";
  title.listeners.get("input")();

  const gridFragment = result.elements.get("scheduleGrid").children[0];
  const firstSlot = gridFragment.children[1].children[1];
  firstSlot.listeners.get("keydown")({
    key: " ",
    currentTarget: firstSlot,
    preventDefault() {},
  });

  assert.equal(result.location.href, "https://example.test/schedule-maker/");
  assert.equal(result.location.search, "");
  assert.equal(result.location.hash, "");
  assert.ok(result.storageWrites.some(([key]) => key === "eonjepyo-draft"));

  const draft = parseShareHash(result.storage.get("eonjepyo-draft"));
  assert.equal(draft.title, "쵸하");
  assert.equal(countSelected(draft.slots), 1);
});

test("공유 링크를 복사할 때만 현재 상태가 든 URL을 만들고 주소창은 그대로 둔다", async () => {
  const slots = createSlots();
  setSelected(slots, slotIndex(22, 4), true);
  const draft = makeShareHash(slots, {
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
  });
  const result = runWithPageDom(WRITER_PAGE_IDS, "", {
    pathname: "/schedule-maker/",
    storage: { "eonjepyo-draft": draft },
  });
  const cleanHref = result.location.href;

  await result.elements.get("linkButton").listeners.get("click")();

  assert.equal(result.clipboardWrites.length, 1);
  const shared = parseShareInput(result.clipboardWrites[0]);
  assert.equal(shared.title, "휴이스");
  assert.equal(isSelected(shared.slots, slotIndex(22, 4)), true);
  assert.equal(result.location.href, cleanHref);
  assert.equal(result.location.search, "");
  assert.equal(result.location.hash, "");
});

test("일정 이름이 비어 있으면 공유 링크를 복사하지 않고 이름 입력을 안내한다", async () => {
  const result = runWithPageDom(WRITER_PAGE_IDS, "", { pathname: "/schedule-maker/" });

  await result.elements.get("linkButton").listeners.get("click")();

  assert.equal(result.clipboardWrites.length, 0);
  assert.equal(result.elements.get("titleInput").focused, true);
  assert.match(result.elements.get("toast").textContent, /이름/);
});

test("저장 모듈을 쓸 수 없으면 공유 URL 일정을 작성 화면에 보존하고 주소만 정리한다", () => {
  const slots = createSlots();
  setSelected(slots, slotIndex(1, 6), true);
  const shareHash = makeShareHash(slots, {
    title: "새벽 공대",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 5,
  });
  const result = runWithPageDom(WRITER_PAGE_IDS, shareHash, { pathname: "/schedule-maker/" });

  assert.equal(result.elements.get("titleInput").value, "새벽 공대");
  assert.equal(result.elements.get("selectedCount").textContent, "1");
  assert.equal(result.location.href, "https://example.test/schedule-maker/");
  assert.equal(result.location.search, "");
  assert.equal(result.location.hash, "");
  assert.equal(result.location.replacedWith, null);
  assert.ok(result.historyCalls.length > 0, "공유 데이터를 읽은 뒤 history API로 주소를 정리해야 한다");

  const saved = parseShareHash(result.storage.get("eonjepyo-draft"));
  assert.equal(saved.title, "새벽 공대");
  assert.equal(isSelected(saved.slots, slotIndex(1, 6)), true);
});

test("작성 전용 DOM은 취합 요소 없이 독립 초기화된다", () => {
  const ids = [
    "titleInput", "startHourSelect", "startDaySelect", "timezoneInput", "rangeLabel",
    "scheduleGrid", "scheduleScroller", "selectedCount", "selectionProgress", "undoButton",
    "clearButton", "resetButton", "liveRegion", "linkButton", "linkLabel", "textButton",
    "textLabel", "imageButton", "imageLabel", "pngButton", "toast",
  ];
  const result = runWithPageDom(ids);
  assert.equal(result.elements.get("scheduleGrid").children[0].children.length, 25);
  const timeLabels = descendantsMatching(
    result.elements.get("scheduleGrid"),
    (element) => element.className === "time-toggle",
  ).map((element) => element.textContent);
  assert.equal(timeLabels.length, 24);
  assert.ok(timeLabels.includes("익일 00:00"));
  assert.ok(timeLabels.every((label) => !label.includes("~")), "시간 행에는 반복되는 끝시간을 표시하지 않습니다");
  assert.equal(result.storageReads, 2, "초안과 남아 있는 복구 잠금을 각각 확인합니다");
  assert.equal(typeof result.api.aggregateSchedules, "function");
});

test("온라인 방 초기화는 방장이 정한 시간 기준을 유지하고 닉네임과 선택만 비운다", async () => {
  const result = runWithPageDom(WRITER_PAGE_IDS, "", {
    pathname: "/schedule-maker/room.html",
    bodyClasses: ["online-room-page"],
  });
  const slots = createSlots();
  setSelected(slots, slotIndex(23, 5), true);
  result.app.applySchedule({
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 23,
    startDay: 5,
    slots,
  });

  await result.elements.get("resetButton").listeners.get("click")();

  assert.equal(result.elements.get("titleInput").value, "");
  assert.equal(result.elements.get("selectedCount").textContent, "0");
  assert.equal(result.elements.get("timezoneInput").value, "Asia/Seoul");
  assert.equal(result.elements.get("startHourSelect").value, "23");
  assert.equal(result.elements.get("startDaySelect").value, "5");
  assert.equal(result.storageWrites.length, 0, "온라인 방 편집은 일반 draft를 건드리지 않아야 한다");
});

test("온라인 방 입력표는 실제 날짜 열과 자정 이후 날짜를 표시한다", () => {
  const result = runWithPageDom(WRITER_PAGE_IDS, "", {
    pathname: "/schedule-maker/room.html",
    bodyClasses: ["online-room-page"],
  });
  result.app.applySchedule({
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDate: "2026-07-22",
    slots: createSlots(),
  });

  const headers = descendantsMatching(
    result.elements.get("scheduleGrid"),
    (element) => element.className === "day-toggle",
  );
  assert.deepEqual(headers.map((header) => header.textContent), [
    "7/22 수", "7/23 목", "7/24 금", "7/25 토", "7/26 일", "7/27 월", "7/28 화",
  ]);
  assert.equal(result.elements.get("startDaySelect").value, "2");
  assert.equal(result.app.getSchedule().startDate, "2026-07-22");

  const midnight = descendantsMatching(
    result.elements.get("scheduleGrid"),
    (element) => element.dataset?.index === String(slotIndex(0, 2)),
  )[0];
  assert.match(midnight.title, /2026\. 7\. 23\.\(목\) 00:00–01:00/);
});

test("손상된 작성 초안은 원문을 격리하고 초기화 전 자동 저장으로 덮지 않는다", () => {
  const raw = "#v=1&s=broken";
  const result = runWithPageDom(WRITER_PAGE_IDS, "#top", {
    pathname: "/schedule-maker/",
    storage: { [DRAFT_KEY]: raw },
  });

  assert.equal(result.storage.get(DRAFT_KEY), raw);
  assert.equal(result.storage.get(DRAFT_RECOVERY_KEY), raw);
  assert.equal(result.storageWrites.some(([key]) => key === DRAFT_KEY), false);
  assert.match(result.elements.get("toast").textContent, /초기화/);
});

test("취합 전용 DOM은 작성 요소 없이 초기화되고 페이지 hash를 공유 일정으로 읽지 않는다", () => {
  const ids = [
    "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
    "compareInputStatus", "participantArea", "participantCount", "participantList",
    "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
    "compareGrid", "compareGridScroller", "compareDetail", "toast",
  ];
  const hash = "#v=1&s=손상된-공유-일정";
  const result = runWithPageDom(ids, hash);
  assert.equal(result.elements.get("compareGrid").children[0].children.length, 25);
  const timeLabels = descendantsMatching(
    result.elements.get("compareGrid"),
    (element) => element.className === "compare-time",
  ).map((element) => element.textContent);
  assert.equal(timeLabels.length, 24);
  assert.ok(timeLabels.includes("익일 00:00"));
  assert.ok(timeLabels.every((label) => !label.includes("~")), "취합표 시간 행에도 끝시간을 반복하지 않습니다");
  assert.equal(result.storageReads, 0);
  assert.equal(result.location.hash, hash);
  assert.equal(typeof result.api.makeShareHash, "function");
});

test("온라인 취합표는 참여자 안내를 사용하고 실시간 교체 때 스크롤 위치를 보존한다", () => {
  const ids = [
    "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
    "compareInputStatus", "participantArea", "participantCount", "participantList",
    "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
    "compareGrid", "compareGridScroller", "compareDetail", "toast",
  ];
  const result = runWithPageDom(ids, "", {
    pathname: "/schedule-maker/room.html",
    bodyClasses: ["online-room-page"],
  });

  assert.match(result.elements.get("compareTimezoneStatus").textContent, /참여자/);
  assert.match(result.elements.get("compareSummaryText").textContent, /참여자/);

  const firstSlots = createSlots();
  setSelected(firstSlots, slotIndex(22, 1), true);
  result.app.replaceComparisonSchedules([{
    remoteId: "uid-1",
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
    slots: firstSlots,
  }], { startHour: 8, startDay: 0 });
  result.elements.get("compareGridScroller").scrollTop = 240;

  const secondSlots = firstSlots.slice();
  setSelected(secondSlots, slotIndex(23, 1), true);
  result.app.replaceComparisonSchedules([{
    remoteId: "uid-1",
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
    slots: secondSlots,
  }], { startHour: 8, startDay: 0, preserveView: true });

  assert.equal(result.elements.get("compareGridScroller").scrollTop, 240);
});

test("온라인 취합표는 날짜 헤더를 표시하고 날짜 없는 방으로 바뀌면 요일 헤더로 되돌린다", () => {
  const ids = [
    "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
    "compareInputStatus", "participantArea", "participantCount", "participantList",
    "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
    "compareGrid", "compareGridScroller", "compareDetail", "toast",
  ];
  const result = runWithPageDom(ids, "", {
    pathname: "/schedule-maker/room.html",
    bodyClasses: ["online-room-page"],
  });
  const slots = createSlots();
  setSelected(slots, slotIndex(0, 0), true);
  const participant = {
    remoteId: "uid-1",
    title: "휴이스",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
    slots,
  };

  result.app.replaceComparisonSchedules([participant], {
    startHour: 8,
    startDate: "2026-07-20",
  });
  let headers = descendantsMatching(
    result.elements.get("compareGrid"),
    (element) => element.className === "compare-day",
  );
  assert.deepEqual(headers.map((header) => header.textContent), [
    "7/20 월", "7/21 화", "7/22 수", "7/23 목", "7/24 금", "7/25 토", "7/26 일",
  ]);
  const midnight = descendantsMatching(
    result.elements.get("compareGrid"),
    (element) => element.dataset?.index === String(slotIndex(0, 0)),
  )[0];
  assert.match(midnight.title, /2026\. 7\. 21\.\(화\) 00:00–01:00/);

  result.app.replaceComparisonSchedules([participant], { startHour: 8, startDay: 0 });
  headers = descendantsMatching(
    result.elements.get("compareGrid"),
    (element) => element.className === "compare-day",
  );
  assert.deepEqual(headers.map((header) => header.textContent), ["월", "화", "수", "목", "금", "토", "일"]);
});

test("작성 페이지의 기존 #compare 북마크는 취합 페이지로 이동하고 draft를 읽지 않는다", () => {
  const ids = [
    "titleInput", "startHourSelect", "startDaySelect", "timezoneInput", "rangeLabel",
    "scheduleGrid", "scheduleScroller", "selectedCount", "selectionProgress", "undoButton",
    "clearButton", "resetButton", "liveRegion", "linkButton", "linkLabel", "textButton",
    "textLabel", "imageButton", "imageLabel", "pngButton", "toast",
  ];
  const result = runWithPageDom(ids, "#compare");
  assert.equal(result.location.replacedWith, "./compare.html");
  assert.equal(result.storageReads, 0);
  assert.equal(result.elements.get("scheduleGrid").children.length, 0);
});
