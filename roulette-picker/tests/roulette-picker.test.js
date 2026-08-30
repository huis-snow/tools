"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const roulette = require("../app.js");

const {
  TAU,
  POINTER_ANGLE,
  STORAGE_KEY,
  STORAGE_VERSION,
  DEFAULT_ROWS,
  activeEntries,
  entryGroups,
  probabilityForLabel,
  segmentColors,
  randomIndex,
  normalizeAngle,
  winningRotation,
  defaultState,
  loadState,
  saveState,
} = roulette;

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

test("빈 입력은 제외하고 중복 입력은 서로 다른 룰렛 칸으로 유지한다", () => {
  assert.deepEqual(
    activeEntries([" 치킨 ", "", "피자", "치킨", "   ", "초밥"]),
    ["치킨", "피자", "치킨", "초밥"],
  );
});

test("중복 횟수가 해당 이름의 당첨 확률이 된다", () => {
  const rows = ["치킨", "피자", "치킨", "초밥"];
  assert.deepEqual(entryGroups(rows), [
    { label: "치킨", count: 2, probability: 0.5 },
    { label: "피자", count: 1, probability: 0.25 },
    { label: "초밥", count: 1, probability: 0.25 },
  ]);
  assert.equal(probabilityForLabel(rows, "치킨"), 0.5);
  assert.equal(probabilityForLabel(rows, "피자"), 0.25);
  assert.equal(probabilityForLabel(rows, "없는 항목"), 0);
});

test("서로 다른 이름은 다른 색을 받고 같은 이름은 같은 색을 공유한다", () => {
  const colors = segmentColors(["치킨", "피자", "치킨", "초밥"]);
  assert.equal(colors.length, 4);
  assert.equal(colors[0], colors[2]);
  assert.notEqual(colors[0], colors[1]);
  assert.notEqual(colors[1], colors[3]);
  assert.equal(new Set(colors).size, 3);

  const manyColors = segmentColors(Array.from({ length: 60 }, (_, index) => `항목 ${index + 1}`));
  assert.equal(new Set(manyColors).size, 60);
});

test("암호학적 난수의 모듈로 편향 구간을 버리고 유효한 칸을 고른다", () => {
  const samples = [0xffff_ffff, 7];
  const cryptoSource = {
    getRandomValues(array) {
      array[0] = samples.shift();
      return array;
    },
  };
  assert.equal(randomIndex(10, cryptoSource), 7);
  assert.equal(samples.length, 0);
  assert.throws(() => randomIndex(0, cryptoSource), /1 이상/);
});

test("선택된 조각의 중심이 회전 뒤 위쪽 포인터에 정확히 놓인다", () => {
  const current = 1.234;
  const winnerIndex = 3;
  const segmentCount = 7;
  const target = winningRotation(current, winnerIndex, segmentCount, 6);
  const winnerCenter = target + (winnerIndex + 0.5) * TAU / segmentCount;
  const error = normalizeAngle(winnerCenter - POINTER_ANGLE);

  assert.ok(target > current + 5 * TAU);
  assert.ok(error < 1e-10 || Math.abs(error - TAU) < 1e-10);
});

test("입력 항목과 최근 결과를 브라우저 저장소에서 다시 복원한다", () => {
  const storage = memoryStorage();
  const state = {
    rows: ["치킨", "피자", "치킨", "초밥"],
    history: [{ label: "치킨", matching: 2, total: 4 }],
  };

  assert.equal(saveState(storage, state), true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), {
    version: STORAGE_VERSION,
    state,
  });
  assert.deepEqual(loadState(storage), state);
});

test("손상됐거나 접근할 수 없는 저장값은 빈 기본 룰렛으로 대체한다", () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, "{broken");
  assert.deepEqual(loadState(storage), defaultState());
  assert.deepEqual(loadState(null), { rows: [...DEFAULT_ROWS], history: [] });

  const blockedStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(loadState(blockedStorage), defaultState());
  assert.equal(saveState(blockedStorage, defaultState()), false);
});

test("페이지는 룰렛 입력·회전·결과 영역과 공개 메타데이터를 제공한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /https:\/\/huis-snow\.github\.io\/tools\/roulette-picker\//);
  assert.match(html, /<title>랜덤 룰렛 추첨기 \| 빙글뽑기<\/title>/);
  assert.match(html, /id="entryList"/);
  assert.match(html, /id="rouletteCanvas"/);
  assert.match(html, /id="spinButton"/);
  assert.match(html, /id="resultLabel"/);
  assert.match(html, /같은 선택지를 여러 번 적으면 합치지 않고/);
  assert.match(html, /app\.js\?v=20260830-colors/);
});
