"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  STATE_VERSION,
  STORAGE_KEY,
  RECOVERY_KEY,
  parseLocalDate,
  formatLocalDate,
  localToday,
  addLocalDays,
  weekdayIndex,
  addLocalMonths,
  buildMonthGrid,
  createHabit,
  validateHabit,
  calculateProgress,
  isHabitScheduled,
  createEmptyState,
  createDefaultState,
  validateState,
  serializeState,
  importState,
  loadStoredState,
  resetCorruptState,
  getLogAmount,
  setLogAmount,
  addHabit,
  updateHabit,
  removeHabit,
  daySummary,
  calculateMonthlyStats,
  calculateOverallMonthlyStats,
  prepareBrowserStorage,
} = require("../app.js");

function emptyState(habits, selectedDate = "2026-07-13") {
  return {
    version: STATE_VERSION,
    habits,
    logs: {},
    settings: {
      currentMonth: selectedDate.slice(0, 7),
      selectedDate,
      currentView: "all",
    },
  };
}

test("브라우저 부팅은 기존 습관 키를 보관함으로 옮긴 뒤 공용 StorageLike를 사용한다", async () => {
  const originalVault = globalThis.SmallToolsVault;
  const originalLocalStorage = globalThis.localStorage;
  const fallback = { getItem() { return null; }, setItem() {} };
  const vaultStorage = { getItem() { return null; }, setItem() {} };
  const calls = [];
  globalThis.localStorage = fallback;
  globalThis.SmallToolsVault = {
    ready: Promise.resolve(),
    storage: vaultStorage,
    async migrateKeys(keys, options) { calls.push({ keys, options }); },
  };
  try {
    assert.equal(await prepareBrowserStorage(), vaultStorage);
    assert.deepEqual(calls, [{ keys: [STORAGE_KEY, RECOVERY_KEY], options: { removeSource: true } }]);
  } finally {
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test("손상된 습관 기록은 최초 원문을 격리하고 명시적 초기화 전까지 복구 잠금을 유지한다", () => {
  const values = new Map([[STORAGE_KEY, "{broken-habits"]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };

  assert.throws(() => loadStoredState(storage), /JSON/);
  assert.equal(values.get(RECOVERY_KEY), "{broken-habits");
  assert.equal(values.get(STORAGE_KEY), "{broken-habits");

  values.set(STORAGE_KEY, "{another-broken-value");
  assert.throws(() => loadStoredState(storage));
  assert.equal(values.get(RECOVERY_KEY), "{broken-habits", "최초 복구 원본을 덮으면 안 된다");

  const reset = resetCorruptState(storage, new Date(2026, 6, 13, 12));
  assert.deepEqual(reset.habits, []);
  assert.equal(values.has(RECOVERY_KEY), false);
  assert.deepEqual(loadStoredState(storage, new Date(2026, 6, 13, 12)), reset);
});

test("로컬 날짜 문자열은 UTC 변환 없이 왕복한다", () => {
  const local = new Date(2026, 6, 13, 23, 45, 0);
  assert.equal(formatLocalDate(local), "2026-07-13");
  assert.equal(localToday(local), "2026-07-13");
  const parsed = parseLocalDate("2026-07-13");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 6);
  assert.equal(parsed.getDate(), 13);
  assert.equal(addLocalDays("2026-02-28", 1), "2026-03-01");
  assert.equal(addLocalDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addLocalDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addLocalDays("2026-12-31", 1), "2027-01-01");
  assert.throws(() => parseLocalDate("2026-02-29"));
});

test("요일 인덱스는 월요일 0부터 일요일 6까지다", () => {
  assert.equal(weekdayIndex("2026-07-13"), 0);
  assert.equal(weekdayIndex("2026-07-19"), 6);
});

test("월 그리드는 월요일부터 시작하는 6주 42칸이다", () => {
  const grid = buildMonthGrid("2026-08");
  assert.equal(grid.length, 42);
  assert.equal(grid[0].date, "2026-07-27");
  assert.equal(grid[0].weekday, 0);
  assert.equal(grid[41].date, "2026-09-06");
  assert.equal(grid.filter((cell) => cell.isCurrentMonth).length, 31);
  assert.equal(addLocalMonths("2026-12", 1), "2027-01");
});

test("체크형과 수량형 습관을 정규화하고 검증한다", () => {
  const check = createHabit({
    id: "walk",
    name: "산책",
    type: "check",
    target: 99,
    color: "#EF8354",
    weekdays: [4, 0, 4, 2],
    createdOn: "2026-07-01",
  });
  assert.equal(check.target, 1);
  assert.equal(check.color, "#ef8354");
  assert.deepEqual(check.weekdays, [0, 2, 4]);
  assert.deepEqual(validateHabit(check), check);

  const quantity = createHabit({
    id: "water",
    name: "물",
    type: "quantity",
    unit: "잔",
    target: 8,
    color: "#4f7cac",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    createdOn: "2026-07-01",
  });
  assert.equal(quantity.target, 8);
  assert.throws(() => createHabit({ ...quantity, weekdays: [] }));
  assert.throws(() => createHabit({ ...quantity, target: 0 }));
});

test("생성일 전은 예정일이 아니며 반복 요일만 예정일이다", () => {
  const habit = createHabit({
    id: "exercise",
    name: "운동",
    type: "check",
    color: "#ef8354",
    weekdays: [0, 2, 4],
    createdOn: "2026-07-08",
  });
  assert.equal(isHabitScheduled(habit, "2026-07-06"), false);
  assert.equal(isHabitScheduled(habit, "2026-07-08"), true);
  assert.equal(isHabitScheduled(habit, "2026-07-09"), false);
  assert.equal(isHabitScheduled(habit, "2026-07-10"), true);
});

test("달성률은 목표 대비 비율이며 100%에서 상한 처리한다", () => {
  const habit = { target: 8 };
  assert.equal(calculateProgress(habit, 0), 0);
  assert.equal(calculateProgress(habit, 4), 0.5);
  assert.equal(calculateProgress(habit, 12), 1);
});

test("체크 토글과 수량 기록은 희소 로그로 저장하고 0이면 제거한다", () => {
  const habits = [
    createHabit({ id: "check", name: "체크", type: "check", color: "#ef8354", weekdays: [0], createdOn: "2026-07-01" }),
    createHabit({ id: "water", name: "물", type: "quantity", unit: "잔", target: 8, color: "#4f7cac", weekdays: [0], createdOn: "2026-07-01" }),
  ];
  const state = emptyState(habits);
  assert.equal(setLogAmount(state, "2026-07-13", "check", 5), 1);
  assert.equal(setLogAmount(state, "2026-07-13", "water", 3), 3);
  assert.equal(getLogAmount(state, "2026-07-13", "check"), 1);
  setLogAmount(state, "2026-07-13", "check", 0);
  setLogAmount(state, "2026-07-13", "water", 0);
  assert.deepEqual(state.logs, {});
  assert.throws(() => setLogAmount(state, "2026-06-29", "check", 1));
});

test("월중 추가된 습관은 생성일 이전과 현재 달 미래가 통계 분모에서 빠진다", () => {
  const habit = createHabit({
    id: "exercise",
    name: "운동",
    type: "check",
    color: "#ef8354",
    weekdays: [0, 2, 4],
    createdOn: "2026-07-08",
  });
  const state = emptyState([habit]);
  setLogAmount(state, "2026-07-08", habit.id, 1);
  setLogAmount(state, "2026-07-10", habit.id, 1);

  const stats = calculateMonthlyStats(state, habit.id, "2026-07", "2026-07-13");
  assert.equal(stats.scheduledDays, 2, "오늘 미기록은 아직 분모에 넣지 않는다");
  assert.equal(stats.completedScheduledDays, 2);
  assert.equal(stats.completionRate, 1);
  assert.equal(stats.currentStreak, 2, "오늘 미완료는 직전 예정일까지의 streak를 보존한다");
  assert.equal(stats.bestStreak, 2);
});

test("오늘 부분 기록은 월 달성률에 비율로 반영하지만 streak를 끊지 않는다", () => {
  const habit = createHabit({
    id: "water",
    name: "물",
    type: "quantity",
    unit: "잔",
    target: 8,
    color: "#4f7cac",
    weekdays: [0, 2, 4],
    createdOn: "2026-07-08",
  });
  const state = emptyState([habit]);
  setLogAmount(state, "2026-07-08", habit.id, 8);
  setLogAmount(state, "2026-07-10", habit.id, 8);
  setLogAmount(state, "2026-07-13", habit.id, 4);

  let stats = calculateMonthlyStats(state, habit.id, "2026-07", "2026-07-13");
  assert.equal(stats.scheduledDays, 3);
  assert.equal(stats.completedScheduledDays, 2);
  assert.equal(stats.completionRate, 2.5 / 3);
  assert.equal(stats.currentStreak, 2);

  setLogAmount(state, "2026-07-13", habit.id, 8);
  stats = calculateMonthlyStats(state, habit.id, "2026-07", "2026-07-13");
  assert.equal(stats.currentStreak, 3);
});

test("휴식일은 현재·최장 streak를 더하지도 끊지도 않는다", () => {
  const habit = createHabit({
    id: "mwf",
    name: "월수금",
    type: "check",
    color: "#57a773",
    weekdays: [0, 2, 4],
    createdOn: "2026-07-01",
  });
  const state = emptyState([habit]);
  ["2026-07-01", "2026-07-03", "2026-07-06", "2026-07-08"].forEach((date) => setLogAmount(state, date, habit.id, 1));
  const stats = calculateMonthlyStats(state, habit.id, "2026-07", "2026-07-09");
  assert.equal(stats.currentStreak, 4);
  assert.equal(stats.bestStreak, 4);
});

test("종합 하루 진행률은 예정 습관 평균이고 모두 달성해야 완료다", () => {
  const check = createHabit({ id: "check", name: "체크", type: "check", color: "#ef8354", weekdays: [0], createdOn: "2026-07-01" });
  const water = createHabit({ id: "water", name: "물", type: "quantity", unit: "잔", target: 8, color: "#4f7cac", weekdays: [0], createdOn: "2026-07-01" });
  const state = emptyState([check, water]);
  setLogAmount(state, "2026-07-13", check.id, 1);
  setLogAmount(state, "2026-07-13", water.id, 4);
  let summary = daySummary(state, "2026-07-13");
  assert.equal(summary.progress, 0.75);
  assert.equal(summary.completed, false);
  setLogAmount(state, "2026-07-13", water.id, 8);
  summary = daySummary(state, "2026-07-13");
  assert.equal(summary.completed, true);
});

test("종합 월 달성률은 날짜 평균이 아니라 예정 habit-day의 가중 평균이다", () => {
  const daily = createHabit({ id: "daily", name: "매일", type: "check", color: "#ef8354", weekdays: [0, 1, 2, 3, 4, 5, 6], createdOn: "2026-07-12" });
  const monday = createHabit({ id: "monday", name: "월요일", type: "quantity", unit: "회", target: 4, color: "#4f7cac", weekdays: [0], createdOn: "2026-07-12" });
  const state = emptyState([daily, monday]);
  setLogAmount(state, "2026-07-12", daily.id, 1);
  setLogAmount(state, "2026-07-13", daily.id, 1);
  setLogAmount(state, "2026-07-13", monday.id, 2);
  const stats = calculateOverallMonthlyStats(state, "2026-07", "2026-07-13");
  assert.equal(stats.scheduledDays, 2);
  assert.equal(stats.scheduledHabitDays, 3);
  assert.equal(stats.completionRate, 2.5 / 3);
  assert.equal(stats.completedScheduledDays, 1);
});

test("습관 추가·수정·삭제 시 기록과 현재 보기를 함께 관리한다", () => {
  const state = emptyState([]);
  const habit = addHabit(state, {
    id: "read",
    name: "독서",
    type: "quantity",
    unit: "쪽",
    target: 10,
    color: "#57a773",
    weekdays: [0, 1, 2, 3, 4],
    createdOn: "2026-07-01",
  });
  state.settings.currentView = habit.id;
  setLogAmount(state, "2026-07-13", habit.id, 5);
  updateHabit(state, habit.id, { name: "책 읽기", target: 20 });
  assert.equal(state.habits[0].name, "책 읽기");
  assert.equal(state.habits[0].createdOn, "2026-07-01");
  assert.equal(removeHabit(state, habit.id), true);
  assert.equal(state.settings.currentView, "all");
  assert.deepEqual(state.logs, {});
});

test("상태를 JSON으로 왕복하고 잘못된 import를 거절한다", () => {
  const state = createDefaultState(new Date(2026, 6, 13, 12));
  setLogAmount(state, "2026-07-13", "water", 4);
  const restored = importState(serializeState(state), new Date(2026, 6, 13, 12));
  assert.deepEqual(restored, state);
  assert.equal(validateState(restored), true);

  const duplicate = JSON.parse(serializeState(state));
  duplicate.habits.push({ ...duplicate.habits[0] });
  assert.throws(() => importState(JSON.stringify(duplicate)));
  const unknownLog = JSON.parse(serializeState(state));
  unknownLog.logs["2026-07-13"].unknown = 1;
  assert.throws(() => importState(JSON.stringify(unknownLog)));
  assert.throws(() => importState("{broken"));
});

test("기본 상태에는 세 가지 예시 습관과 현재 보기가 있다", () => {
  const empty = createEmptyState(new Date(2026, 6, 13, 12));
  assert.deepEqual(empty.habits, []);
  assert.deepEqual(empty.logs, {});
  assert.equal(empty.settings.selectedDate, "2026-07-13");

  const state = createDefaultState(new Date(2026, 6, 13, 12));
  assert.equal(state.habits.length, 3);
  assert.deepEqual(state.habits.map((habit) => habit.id), ["water", "exercise", "reading"]);
  assert.equal(state.settings.currentMonth, "2026-07");
  assert.equal(state.settings.selectedDate, "2026-07-13");
  assert.equal(state.settings.currentView, "all");
});
