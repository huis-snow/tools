"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const calculator = require("../app.js");

const {
  MAX_SERIES_LEVEL,
  EXTRA_LEVEL_EXP,
  STORAGE_KEY,
  STORAGE_VERSION,
  DEFAULT_STATE,
  REWARDS,
  expToNextLevel,
  cumulativeExpAtLevel,
  normalizeProgress,
  calculateSeriesProgress,
  gamesForExp,
  calculateMatchEstimates,
  calendarDayDifference,
  calculateDeadlinePlan,
  normalizePlannerState,
  loadPlannerState,
  savePlannerState,
} = calculator;

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("시리즈 경험치 구간과 30레벨 누적 경험치가 공개 데이터와 일치한다", () => {
  assert.equal(MAX_SERIES_LEVEL, 30);
  assert.equal(EXTRA_LEVEL_EXP, 20_000);
  assert.equal(expToNextLevel(1), 2_000);
  assert.equal(expToNextLevel(4), 2_000);
  assert.equal(expToNextLevel(5), 3_000);
  assert.equal(expToNextLevel(9), 3_000);
  assert.equal(expToNextLevel(10), 4_000);
  assert.equal(expToNextLevel(15), 5_500);
  assert.equal(expToNextLevel(20), 7_500);
  assert.equal(expToNextLevel(25), 10_000);
  assert.equal(expToNextLevel(30), 20_000);
  assert.equal(cumulativeExpAtLevel(1), 0);
  assert.equal(cumulativeExpAtLevel(5), 8_000);
  assert.equal(cumulativeExpAtLevel(10), 23_000);
  assert.equal(cumulativeExpAtLevel(30), 158_000);
});

test("현재 22레벨 450 EXP에서 25레벨까지 22,050 EXP가 남는다", () => {
  const result = calculateSeriesProgress(
    { level: 22, currentExp: 450, extraLevel: 0 },
    { mode: "level", level: 25, extraLevel: 0 },
  );
  assert.equal(result.currentTotal, 85_950);
  assert.equal(result.targetTotal, 108_000);
  assert.equal(result.remainingExp, 22_050);
  assert.ok(result.progressPercent > 79 && result.progressPercent < 80);
});

test("이미 달성한 레벨 목표는 남은 경험치가 0이다", () => {
  assert.equal(calculateSeriesProgress(
    { level: 20, currentExp: 1_000, extraLevel: 0 },
    { mode: "level", level: 20, extraLevel: 0 },
  ).remainingExp, 0);
  assert.equal(calculateSeriesProgress(
    { level: 20, currentExp: 1_000, extraLevel: 0 },
    { mode: "level", level: 15, extraLevel: 0 },
  ).remainingExp, 0);
});

test("30 이후 완료한 추가 레벨과 다음 구간 경험치를 반영한다", () => {
  const result = calculateSeriesProgress(
    { level: 30, currentExp: 5_000, extraLevel: 2 },
    { mode: "extra", level: 30, extraLevel: 4 },
  );
  assert.equal(result.currentTotal, 203_000);
  assert.equal(result.targetTotal, 238_000);
  assert.equal(result.remainingExp, 35_000);
});

test("현재 경험치는 해당 구간의 최대치 미만이어야 한다", () => {
  assert.throws(
    () => normalizeProgress({ level: 22, currentExp: 7_500, extraLevel: 0 }),
    /0부터 7499/,
  );
  assert.throws(
    () => normalizeProgress({ level: 29, currentExp: -1, extraLevel: 0 }),
    /0부터 9999/,
  );
  assert.throws(
    () => normalizeProgress({ level: 20, currentExp: 0, extraLevel: 1 }),
    /30을 달성한 뒤/,
  );
});

test("경기 보상 수치와 판수는 항상 올림해 계산한다", () => {
  assert.deepEqual(REWARDS.crystalline, { fast: 900, expected: 800, safe: 700 });
  assert.deepEqual(REWARDS.rivalWings, { fast: 1_250, expected: 1_000, safe: 750 });
  assert.deepEqual(REWARDS.frontline, { fast: 1_500, expected: 1_250, safe: 1_000 });
  assert.equal(gamesForExp(22_050, 750), 30);
  assert.equal(gamesForExp(22_050, 1_000), 23);
  assert.equal(gamesForExp(0, 900), 0);
});

test("콘텐츠별 빠른·예상·보수적 판수와 일일 전장 일수를 계산한다", () => {
  assert.deepEqual(calculateMatchEstimates(22_050), {
    crystalline: { fast: 25, expected: 28, safe: 32 },
    rivalWings: { fast: 18, expected: 23, safe: 30 },
    frontline: { fast: 15, expected: 18, safe: 23 },
    dailyFrontline: { fast: 8, expected: 9, safe: 9 },
  });
});

test("마감일은 오늘을 포함하며 날짜 경계와 하루 목표를 계산한다", () => {
  assert.equal(calendarDayDifference("2026-09-03", "2026-08-26"), 8);
  assert.equal(calendarDayDifference("2026-08-26", "2026-08-26"), 0);

  const plan = calculateDeadlinePlan(22_050, "2026-09-03", "2026-08-26");
  assert.equal(plan.status, "active");
  assert.equal(plan.days, 9);
  assert.equal(plan.dailyExp, 2_450);
  assert.equal(plan.crystallinePerDay, 4);
  assert.equal(plan.rivalWingsPerDay, 3);
  assert.equal(plan.dailyFrontlineDays, 9);
  assert.equal(plan.dailyFrontlineFits, true);
});

test("지난 마감일과 이미 달성한 목표의 계획 상태를 구분한다", () => {
  assert.deepEqual(
    calculateDeadlinePlan(10_000, "2026-08-25", "2026-08-26"),
    { status: "past", days: 0, difference: -1, remainingExp: 10_000 },
  );
  const complete = calculateDeadlinePlan(0, "2026-08-26", "2026-08-26");
  assert.equal(complete.status, "complete");
  assert.equal(complete.days, 1);
  assert.equal(complete.dailyExp, 0);
});

test("계산기 입력 상태를 버전과 함께 저장하고 다시 복원한다", () => {
  const storage = memoryStorage();
  const state = {
    currentLevel: 30,
    currentExp: 12_345,
    currentExtraLevel: 3,
    targetMode: "extra",
    targetLevel: 25,
    targetExtraLevel: 8,
    deadline: "2026-09-30",
  };

  assert.equal(savePlannerState(storage, state), true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    version: STORAGE_VERSION,
    state,
  });
  assert.deepEqual(loadPlannerState(storage), state);
});

test("손상됐거나 접근할 수 없는 저장 데이터는 기본값으로 안전하게 대체한다", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, "{broken-json");
  assert.deepEqual(loadPlannerState(storage), DEFAULT_STATE);

  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: STORAGE_VERSION,
    state: { currentLevel: 15, currentExp: 99_999 },
  }));
  assert.deepEqual(loadPlannerState(storage), DEFAULT_STATE);

  const blockedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(loadPlannerState(blockedStorage), DEFAULT_STATE);
  assert.equal(savePlannerState(blockedStorage, DEFAULT_STATE), false);
});

test("저장 상태는 목표와 날짜 범위를 함께 검증한다", () => {
  assert.throws(
    () => normalizePlannerState({ ...DEFAULT_STATE, targetMode: "unknown" }),
    /목표 유형/,
  );
  assert.throws(
    () => normalizePlannerState({ ...DEFAULT_STATE, targetExtraLevel: 1_000 }),
    /1부터 999/,
  );
  assert.throws(
    () => normalizePlannerState({ ...DEFAULT_STATE, deadline: "2026-02-30" }),
    /올바른 날짜/,
  );
});

test("페이지는 계산기 메타데이터와 핵심 입력·결과 영역을 제공한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /https:\/\/huis-snow\.github\.io\/tools\/pvp-series-calculator\//);
  assert.match(html, /id="currentLevelInput"/);
  assert.match(html, /id="remainingExp"/);
  assert.match(html, /id="deadlineResult"/);
  assert.match(html, /app\.js\?v=20260826-storage/);
  assert.match(html, /입력값은 서버로 전송하지 않고 이 브라우저에만 저장해요/);
});

test("사용자에게 보이는 글자는 10px보다 작게 축소하지 않는다", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.doesNotMatch(css, /(?:font-size|font):[^;]*(?<![\d.])[1-9]px/);
  assert.match(css, /\.intro-copy > p:not\(\.eyebrow\)[^{]*\{[^}]*font-size: 16px;/);
  assert.match(css, /\.field > small[^{]*\{[^}]*font-size: 11px;/);
  assert.match(css, /\.result-message[^{]*\{[^}]*font-size: 13px;/);
});
