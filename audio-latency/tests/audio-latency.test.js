"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MIN_WAIT_MS,
  MAX_WAIT_MS,
  median,
  medianAbsoluteDeviation,
  classifyGap,
  calculateSummary,
  randomWait,
} = require("../app.js");

test("홀수와 짝수 개수의 중앙값을 계산하며 원본 배열은 바꾸지 않는다", () => {
  const even = [300, 200, 400, 100];
  assert.equal(median(even), 250);
  assert.deepEqual(even, [300, 200, 400, 100]);
  assert.equal(median([9, 2, 5]), 5);
});

test("비어 있거나 유한하지 않은 값은 거부한다", () => {
  assert.throws(() => median([]), /측정값/);
  assert.throws(() => median([200, Number.NaN]), /유한한 숫자/);
  assert.throws(() => median([200, Number.POSITIVE_INFINITY]), /유한한 숫자/);
});

test("중앙 절대 편차는 극단값에 크게 흔들리지 않는다", () => {
  assert.equal(medianAbsoluteDeviation([200, 202, 205, 207, 900]), 3);
});

test("유선과 블루투스 중앙값 차이 및 측정 신뢰도를 요약한다", () => {
  const summary = calculateSummary(
    [200, 204, 208, 210, 212, 214, 216, 220],
    [270, 274, 278, 280, 282, 284, 286, 290],
  );
  assert.equal(summary.wiredMedian, 211);
  assert.equal(summary.bluetoothMedian, 281);
  assert.equal(summary.gap, 70);
  assert.equal(summary.reliability, "high");
  assert.equal(summary.verdict.level, "medium");
});

test("차이가 측정 흔들림보다 작으면 단정하지 않는다", () => {
  const verdict = classifyGap(12, 18);
  assert.equal(verdict.level, "uncertain");
  assert.match(verdict.title, /흔들림/);
  assert.equal(classifyGap(25, 4).level, "small");
  assert.equal(classifyGap(95, 12).level, "large");
});

test("무작위 대기 시간은 지정 범위의 양 끝을 포함한다", () => {
  assert.equal(randomWait(() => 0), MIN_WAIT_MS);
  assert.equal(randomWait(() => 1), MAX_WAIT_MS);
  const middle = randomWait(() => 0.5);
  assert.ok(middle > MIN_WAIT_MS && middle < MAX_WAIT_MS);
});
