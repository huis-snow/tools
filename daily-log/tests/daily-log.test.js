"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STATE_VERSION,
  STORAGE_KEY,
  RECOVERY_KEY,
  IMPORT_SIZE_LIMIT,
  parseDateKey,
  toDateKey,
  localToday,
  addDays,
  weekdayIndex,
  shiftMonth,
  buildCalendarDays,
  createEmptyRecord,
  normalizeRecord,
  isEmptyRecord,
  createEmptyState,
  normalizeState,
  loadState,
  saveState,
  getRecord,
  upsertRecord,
  deleteRecord,
  calculateMonthlyStats,
  exportState,
  importState,
  prepareBrowserStorage,
  initDailyLogApp,
} = require("../app.js");

const fixedNow = new Date(2026, 6, 14, 21, 30, 0);

function fullRecord(overrides = {}) {
  return {
    meals: {
      breakfast: "토스트",
      lunch: "비빔밥",
      dinner: "샐러드",
      snack: "",
      ...overrides.meals,
    },
    alcohol: {
      drank: false,
      type: "",
      amount: "",
      note: "",
      ...overrides.alcohol,
    },
    condition: 4,
    memo: "평온한 하루",
    ...overrides,
  };
}

test("로컬 날짜는 UTC 변환 없이 YYYY-MM-DD로 안전하게 계산한다", () => {
  assert.equal(toDateKey(new Date(2026, 6, 14, 23, 59)), "2026-07-14");
  assert.equal(localToday(new Date(2026, 6, 14, 0, 1)), "2026-07-14");
  const parsed = parseDateKey("2026-07-14");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 6);
  assert.equal(parsed.getDate(), 14);
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.throws(() => parseDateKey("2026-02-29"));
  assert.throws(() => parseDateKey("2026-7-14"));
});

test("월요일 시작 달력은 항상 앞뒤 날짜를 포함한 6주 42칸이다", () => {
  const days = buildCalendarDays("2026-08");
  assert.equal(days.length, 42);
  assert.deepEqual(days[0], {
    date: "2026-07-27",
    day: 27,
    weekday: 0,
    isCurrentMonth: false,
  });
  assert.equal(days[41].date, "2026-09-06");
  assert.equal(days.filter((day) => day.isCurrentMonth).length, 31);
  assert.equal(weekdayIndex("2026-07-13"), 0);
  assert.equal(weekdayIndex("2026-07-19"), 6);
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
});

test("빈 기록 기본값과 텍스트·컨디션을 정규화한다", () => {
  const empty = createEmptyRecord();
  assert.equal(isEmptyRecord(empty), true);
  const record = normalizeRecord(fullRecord({
    meals: { breakfast: "  토스트  " },
    memo: "  오늘도 좋았음  ",
  }), fixedNow);
  assert.equal(record.meals.breakfast, "토스트");
  assert.equal(record.memo, "오늘도 좋았음");
  assert.equal(record.updatedAt, fixedNow.toISOString());
  assert.equal(isEmptyRecord(record), false);
  assert.throws(() => normalizeRecord({ condition: 6 }, fixedNow), /0부터 5/);
  assert.throws(() => normalizeRecord({ meals: [] }, fixedNow), /식사 기록/);
});

test("음주하지 않은 기록은 숨은 세부 값을 저장하지 않는다", () => {
  const sober = normalizeRecord({
    alcohol: { drank: false, type: "맥주", amount: "두 캔", note: "숨은 값" },
  }, fixedNow);
  assert.deepEqual(sober.alcohol, { drank: false, type: "", amount: "", note: "" });
  assert.equal(isEmptyRecord(sober), true);

  const drinking = normalizeRecord({
    alcohol: { drank: true, type: "맥주", amount: "두 캔", note: "모임" },
  }, fixedNow);
  assert.equal(drinking.alcohol.drank, true);
  assert.equal(drinking.updatedAt, fixedNow.toISOString());
  assert.throws(() => normalizeRecord({ alcohol: { drank: "false" } }, fixedNow), /참\/거짓/);
});

test("날짜별 기록 CRUD는 빈 기록을 희소 저장소에서 제거한다", () => {
  const state = createEmptyState();
  const saved = upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  assert.equal(saved.meals.lunch, "비빔밥");
  assert.equal(state.records["2026-07-14"].updatedAt, fixedNow.toISOString());
  assert.equal(getRecord(state, "2026-07-14").condition, 4);

  const removed = upsertRecord(state, "2026-07-14", createEmptyRecord(), fixedNow);
  assert.equal(removed, null);
  assert.deepEqual(state.records, {});
  assert.equal(deleteRecord(state, "2026-07-14"), false);

  upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  assert.equal(deleteRecord(state, "2026-07-14"), true);
  assert.deepEqual(state.records, {});
});

test("월간 통계는 기록일·식사 수·음주일·기록된 컨디션 평균을 계산한다", () => {
  const state = createEmptyState();
  upsertRecord(state, "2026-07-01", fullRecord({
    meals: { breakfast: "죽", lunch: "", dinner: "", snack: "" },
    condition: 3,
    memo: "",
  }), fixedNow);
  upsertRecord(state, "2026-07-02", fullRecord({
    meals: { breakfast: "", lunch: "국수", dinner: "밥", snack: "과일" },
    alcohol: { drank: true, type: "맥주", amount: "1잔", note: "" },
    condition: 5,
    memo: "",
  }), fixedNow);
  upsertRecord(state, "2026-07-03", {
    meals: {}, alcohol: { drank: false }, condition: 0, memo: "메모만",
  }, fixedNow);
  upsertRecord(state, "2026-08-01", fullRecord(), fixedNow);

  assert.deepEqual(calculateMonthlyStats(state, "2026-07"), {
    month: "2026-07",
    loggedDays: 3,
    mealCount: 4,
    drinkingDays: 1,
    conditionDays: 2,
    averageCondition: 4,
  });
  assert.equal(calculateMonthlyStats(createEmptyState(), "2026-07").averageCondition, null);
});

test("JSON 백업은 왕복되고 버전·날짜·필드 타입을 검증한다", () => {
  const state = createEmptyState();
  upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  const text = exportState(state);
  const restored = importState(text, fixedNow);
  assert.deepEqual(restored, normalizeState(state, fixedNow));
  assert.equal(JSON.parse(text).version, STATE_VERSION);
  assert.throws(() => importState(""), /데이터가 없습니다/);
  assert.throws(() => importState(" ".repeat(IMPORT_SIZE_LIMIT + 1)), /파일이 너무 큽니다/);
  assert.throws(() => importState("{"), /JSON 파일/);
  assert.throws(() => importState(JSON.stringify({ version: 2, records: {} })), /지원하지 않는/);
  assert.throws(() => importState(JSON.stringify({ version: 1, records: { nope: {} } })), /날짜 형식/);
  assert.throws(() => importState(JSON.stringify({ version: 1, records: { "2026-07-14": { memo: 123 } } })), /문자열/);
});

test("localStorage 저장과 불러오기는 고정 키 및 검증된 상태를 사용한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const state = createEmptyState();
  upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  saveState(state, storage);
  assert.equal(values.has(STORAGE_KEY), true);
  assert.equal(loadState(storage, fixedNow).records["2026-07-14"].memo, "평온한 하루");
  values.set(STORAGE_KEY, "bad json");
  assert.throws(() => loadState(storage, fixedNow), /JSON 파일/);
});

test("브라우저 부팅 저장소는 보관함 준비와 이전을 마친 뒤 IndexedDB StorageLike를 사용한다", async () => {
  const originalVault = globalThis.SmallToolsVault;
  const originalLocalStorage = globalThis.localStorage;
  const fallback = { getItem() { return null; }, setItem() {} };
  const vaultStorage = { getItem() { return null; }, setItem() {} };
  let releaseReady;
  const calls = [];
  globalThis.localStorage = fallback;
  globalThis.SmallToolsVault = {
    ready: new Promise((resolve) => { releaseReady = resolve; }),
    storage: vaultStorage,
    async migrateKeys(keys, options) { calls.push({ keys, options }); },
  };
  try {
    const pending = prepareBrowserStorage();
    await Promise.resolve();
    assert.deepEqual(calls, [], "ready 전에는 마이그레이션하지 않는다");
    releaseReady();
    assert.equal(await pending, vaultStorage);
    assert.deepEqual(calls, [{ keys: [STORAGE_KEY, RECOVERY_KEY], options: { removeSource: true } }]);

    globalThis.SmallToolsVault = { ready: Promise.reject(new Error("IndexedDB unavailable")) };
    assert.equal(await prepareBrowserStorage(), fallback, "코어 실패 시 localStorage를 유지한다");
  } finally {
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

class FakeClassList {
  constructor(owner) {
    this.owner = owner;
    this.values = new Set();
  }

  add(...names) { names.forEach((name) => this.values.add(name)); }
  remove(...names) { names.forEach((name) => this.values.delete(name)); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.listeners = new Map();
    this.dataset = {};
    this.attributes = {};
    this.classList = new FakeClassList(this);
    this.textContent = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.files = [];
    this.tabIndex = 0;
    this.type = "";
    this.clicked = false;
  }

  set className(value) {
    this.classList.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  get className() { return [...this.classList.values].join(" "); }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatch(type, values = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    const results = (this.listeners.get(type) || []).map((listener) => listener(event));
    return Promise.all(results);
  }

  click() { this.clicked = true; return this.dispatch("click"); }
  focus() { this.focused = true; }
}

function createDom(storedState = null) {
  const ids = [
    "monthLabel", "dailyLogForm", "prevMonthButton", "nextMonthButton", "todayButton", "calendarGrid",
    "selectedDateLabel", "selectedDateSummary", "breakfastInput", "lunchInput", "dinnerInput",
    "snackInput", "alcoholDrankInput", "alcoholDetails", "alcoholTypeInput", "alcoholAmountInput",
    "alcoholNoteInput", "memoInput", "saveStatus", "clearDayButton", "loggedDaysCount", "mealCount",
    "drinkingDaysCount", "averageCondition", "exportButton", "importButton", "importInput", "toast",
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement("div", id)]));
  ["breakfastInput", "lunchInput", "dinnerInput", "snackInput", "alcoholTypeInput", "alcoholAmountInput"]
    .forEach((id) => { elements.get(id).tagName = "INPUT"; });
  elements.get("alcoholDrankInput").tagName = "INPUT";
  elements.get("alcoholDrankInput").type = "checkbox";
  elements.get("alcoholNoteInput").tagName = "TEXTAREA";
  elements.get("memoInput").tagName = "TEXTAREA";
  const conditions = [1, 2, 3, 4, 5].map((value) => {
    const button = new FakeElement("button");
    button.dataset.condition = String(value);
    return button;
  });
  const doc = {
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) { return selector === "[data-condition]" ? conditions : []; },
    querySelector(selector) {
      const match = /^\[data-date="(\d{4}-\d{2}-\d{2})"\]$/.exec(selector);
      if (!match) return null;
      return elements.get("calendarGrid").children.find((child) => child.dataset?.date === match[1]) || null;
    },
    createElement(tagName) { return new FakeElement(tagName); },
  };
  const values = new Map();
  if (storedState) values.set(STORAGE_KEY, JSON.stringify(storedState));
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
  return { doc, elements, conditions, storage, values };
}

test("손상된 하루 기록은 원문을 격리하고 자동 저장을 잠근 뒤 명시적 초기화로만 해제한다", async () => {
  const env = createDom();
  env.values.set(STORAGE_KEY, "{broken-daily-log");
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 10_000 });

  assert.equal(env.values.get(RECOVERY_KEY), "{broken-daily-log");
  assert.equal(env.values.get(STORAGE_KEY), "{broken-daily-log");
  assert.match(env.elements.get("saveStatus").textContent, /복구 필요/);

  env.elements.get("memoInput").value = "빈 상태에서 쓴 메모";
  await env.elements.get("memoInput").dispatch("change");
  assert.equal(env.values.get(STORAGE_KEY), "{broken-daily-log", "자동 저장이 손상 원문을 덮으면 안 된다");

  await env.elements.get("saveStatus").click();
  assert.equal(env.values.get(RECOVERY_KEY), undefined);
  assert.deepEqual(JSON.parse(env.values.get(STORAGE_KEY)).records, {});
  app.destroy();
});

test("DOM 초기화는 오늘을 선택하고 월요일 시작 42일 달력과 빈 통계를 그린다", () => {
  const env = createDom();
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow });
  assert.ok(app);
  assert.equal(env.elements.get("monthLabel").textContent, "2026년 7월");
  assert.equal(env.elements.get("selectedDateLabel").textContent, "2026년 7월 14일 화요일");
  const calendarChildren = env.elements.get("calendarGrid").children;
  assert.equal(calendarChildren.length, 49, "요일 7개와 날짜 42개를 만든다");
  assert.equal(calendarChildren[0].classList.contains("calendar-weekday"), true);
  const days = calendarChildren.filter((element) => element.dataset.date);
  assert.equal(days[0].dataset.date, "2026-06-29");
  assert.equal(days.at(-1).dataset.date, "2026-08-09");
  const todayButton = days.find((day) => day.dataset.date === "2026-07-14");
  assert.equal(todayButton.classList.contains("is-today"), true);
  assert.equal(todayButton.tagName, "BUTTON");
  assert.equal(todayButton.getAttribute("role"), undefined, "날짜는 네이티브 버튼 의미를 유지한다");
  assert.equal(todayButton.getAttribute("aria-pressed"), "true");
  assert.equal(todayButton.getAttribute("aria-current"), "date");
  assert.equal(env.elements.get("loggedDaysCount").textContent, "0");
  assert.equal(env.elements.get("averageCondition").textContent, "-");
  app.destroy();
});

test("입력 변경은 선택 날짜에 즉시 저장하고 달력·통계를 갱신한다", async () => {
  const env = createDom();
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 10_000 });
  const breakfast = env.elements.get("breakfastInput");
  breakfast.value = "김치볶음밥";
  await breakfast.dispatch("input");
  await breakfast.dispatch("change");

  let stored = JSON.parse(env.values.get(STORAGE_KEY));
  assert.equal(stored.records["2026-07-14"].meals.breakfast, "김치볶음밥");
  assert.equal(env.elements.get("saveStatus").textContent, "자동 저장됨");
  assert.equal(env.elements.get("loggedDaysCount").textContent, "1");
  assert.equal(env.elements.get("mealCount").textContent, "1");
  let selectedDay = env.elements.get("calendarGrid").children.find((child) => child.dataset?.date === "2026-07-14");
  assert.equal(selectedDay.classList.contains("has-record"), true);

  await env.conditions[3].click();
  stored = JSON.parse(env.values.get(STORAGE_KEY));
  assert.equal(stored.records["2026-07-14"].condition, 4);
  assert.equal(env.conditions[3].classList.contains("is-active"), true);
  assert.equal(env.elements.get("averageCondition").textContent, "4");

  const drank = env.elements.get("alcoholDrankInput");
  drank.checked = true;
  await drank.dispatch("change");
  const type = env.elements.get("alcoholTypeInput");
  type.value = "와인";
  await type.dispatch("input");
  await type.dispatch("change");
  assert.equal(env.elements.get("drinkingDaysCount").textContent, "1");
  drank.checked = false;
  await drank.dispatch("change");
  stored = JSON.parse(env.values.get(STORAGE_KEY));
  assert.deepEqual(stored.records["2026-07-14"].alcohol, { drank: false, type: "", amount: "", note: "" });
  assert.equal(type.value, "");
  assert.equal(env.elements.get("alcoholDetails").hidden, true);
  app.destroy();
});

test("기록 폼 Enter 제출은 페이지 이동을 막고 현재 입력을 즉시 저장한다", async () => {
  const env = createDom();
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 60_000 });
  env.elements.get("dinnerInput").value = "카레";
  let prevented = false;
  await env.elements.get("dailyLogForm").dispatch("submit", {
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-14"].meals.dinner, "카레");
  app.destroy();
});

test("저장된 날 선택·월 이동·날짜 초기화가 편집기와 저장소에 반영된다", async () => {
  const state = createEmptyState();
  upsertRecord(state, "2026-07-13", fullRecord({ memo: "월요일 기록" }), fixedNow);
  const env = createDom(state);
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 10_000 });
  let day = env.elements.get("calendarGrid").children.find((child) => child.dataset?.date === "2026-07-13");
  await day.click();
  assert.equal(app.getSelectedDate(), "2026-07-13");
  assert.equal(env.elements.get("memoInput").value, "월요일 기록");
  assert.match(env.elements.get("selectedDateSummary").textContent, /식사 3개/);

  await env.elements.get("nextMonthButton").click();
  assert.equal(app.getCurrentMonth(), "2026-08");
  assert.equal(app.getSelectedDate(), "2026-08-13");
  await env.elements.get("todayButton").click();
  assert.equal(app.getSelectedDate(), "2026-07-14");

  day = env.elements.get("calendarGrid").children.find((child) => child.dataset?.date === "2026-07-13");
  await day.click();
  await env.elements.get("clearDayButton").click();
  assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-13"], undefined);
  assert.equal(env.elements.get("memoInput").value, "");
  assert.equal(env.elements.get("clearDayButton").disabled, true);
  app.destroy();
});

test("날짜 초기화 저장 실패는 성공 문구로 덮지 않고 메모리 상태를 유지한다", async () => {
  const state = createEmptyState();
  upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  const env = createDom(state);
  env.storage.setItem = () => { throw new Error("quota"); };
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow });

  await env.elements.get("clearDayButton").click();
  assert.equal(app.getState().records["2026-07-14"], undefined, "현재 탭의 메모리 변경은 유지한다");
  assert.equal(env.elements.get("saveStatus").textContent, "저장 실패");
  assert.equal(env.elements.get("toast").textContent, "브라우저에 자동 저장하지 못했어요");
  assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-14"].memo, "평온한 하루", "실패한 저장소는 바뀌지 않는다");
  app.destroy();
});

test("위험 작업 전 복원 지점 생성이 실패하면 하루 기록 삭제를 중단한다", async () => {
  const originalVault = globalThis.SmallToolsVault;
  const state = createEmptyState();
  upsertRecord(state, "2026-07-14", fullRecord(), fixedNow);
  const env = createDom(state);
  globalThis.SmallToolsVault = {
    async createRecoveryPoint() { throw new Error("snapshot failed"); },
  };
  try {
    const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow });
    await env.elements.get("clearDayButton").click();
    assert.equal(app.getState().records["2026-07-14"].memo, "평온한 하루");
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-14"].memo, "평온한 하루");
    assert.match(env.elements.get("toast").textContent, /작업을 취소/);
    app.destroy();
  } finally {
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
  }
});

test("백업 가져오기는 파일 크기를 먼저 확인하고 저장 실패 시 기존 상태를 복원한다", async () => {
  const originalState = createEmptyState();
  upsertRecord(originalState, "2026-07-14", fullRecord(), fixedNow);
  const importedState = createEmptyState();
  upsertRecord(importedState, "2026-07-01", fullRecord({ memo: "가져온 기록" }), fixedNow);
  const env = createDom(originalState);
  env.storage.setItem = () => { throw new Error("quota"); };
  const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow });
  const input = env.elements.get("importInput");

  input.files = [{ size: 100, text: async () => JSON.stringify(importedState) }];
  await input.dispatch("change");
  assert.equal(app.getState().records["2026-07-14"].memo, "평온한 하루");
  assert.equal(app.getState().records["2026-07-01"], undefined);
  assert.equal(env.elements.get("saveStatus").textContent, "저장 실패");

  let oversizedFileRead = false;
  input.files = [{
    size: IMPORT_SIZE_LIMIT + 1,
    text: async () => {
      oversizedFileRead = true;
      return JSON.stringify(importedState);
    },
  }];
  await input.dispatch("change");
  assert.equal(oversizedFileRead, false);
  assert.equal(env.elements.get("toast").textContent, "가져올 파일이 너무 큽니다.");
  app.destroy();
});

test("다른 탭 변경을 받을 때 저장 대기 중인 현재 기록을 덮어쓰지 않고 합친다", async () => {
  const listeners = new Map();
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = (type, listener) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  };
  try {
    const env = createDom();
    const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 60_000 });
    env.elements.get("memoInput").value = "아직 저장 대기 중인 메모";
    await env.elements.get("memoInput").dispatch("input");

    const remoteState = createEmptyState();
    upsertRecord(remoteState, "2026-07-13", fullRecord({ memo: "다른 탭의 기록" }), fixedNow);
    listeners.get("storage")({ key: STORAGE_KEY, newValue: JSON.stringify(remoteState) });

    const merged = JSON.parse(env.values.get(STORAGE_KEY));
    assert.equal(merged.records["2026-07-13"].memo, "다른 탭의 기록");
    assert.equal(merged.records["2026-07-14"].memo, "아직 저장 대기 중인 메모");
    assert.equal(env.elements.get("memoInput").value, "아직 저장 대기 중인 메모");
    assert.equal(env.elements.get("saveStatus").textContent, "자동 저장됨");
    app.destroy();
  } finally {
    if (originalAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAdd;
    if (originalRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = originalRemove;
  }
});

test("보관함 사용 중 기존 localStorage 제거 이벤트는 무시하고 보관함 전체 교체는 다시 읽는다", () => {
  const listeners = new Map();
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  const originalVault = globalThis.SmallToolsVault;
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = () => {};
  try {
    const initial = createEmptyState();
    upsertRecord(initial, "2026-07-14", fullRecord({ memo: "보관함 기록" }), fixedNow);
    const env = createDom(initial);
    globalThis.SmallToolsVault = { storage: env.storage, async flush() {} };
    const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow });

    listeners.get("storage")({ key: STORAGE_KEY, newValue: null, storageArea: {} });
    assert.equal(app.getState().records["2026-07-14"].memo, "보관함 기록");

    env.values.delete(STORAGE_KEY);
    listeners.get("storage")({ key: null, newValue: null, storageArea: null });
    assert.deepEqual(app.getState().records, {});
    app.destroy();
  } finally {
    if (originalAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAdd;
    if (originalRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = originalRemove;
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
  }
});

test("pagehide와 destroy는 debounce 중인 마지막 입력을 잃지 않는다", async () => {
  const listeners = new Map();
  const originalAdd = globalThis.addEventListener;
  const originalRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = (type, listener) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  };
  try {
    const env = createDom();
    const app = initDailyLogApp(env.doc, { storage: env.storage, now: () => fixedNow, debounceMs: 60_000 });
    env.elements.get("memoInput").value = "창을 닫기 직전 메모";
    await env.elements.get("memoInput").dispatch("input");
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY) || '{"records":{}}').records["2026-07-14"], undefined);
    listeners.get("pagehide")();
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-14"].memo, "창을 닫기 직전 메모");

    env.elements.get("memoInput").value = "destroy 직전 메모";
    await env.elements.get("memoInput").dispatch("input");
    app.destroy();
    assert.equal(JSON.parse(env.values.get(STORAGE_KEY)).records["2026-07-14"].memo, "destroy 직전 메모");
    assert.equal(listeners.has("pagehide"), false);
    assert.equal(listeners.has("storage"), false);
  } finally {
    if (originalAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = originalAdd;
    if (originalRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = originalRemove;
  }
});
