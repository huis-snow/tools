"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../core.js");
globalThis.BisTrackerCore = core;
const { renderBisSummaryImage } = require("../image-renderer.js");

function member(seat, gear = "C".repeat(11), submitted = true) {
  return {
    seat,
    nickname: `${seat} 공대원`,
    job: `${seat} 직업`,
    editorUid: "",
    gear,
    submitted,
    createdAt: null,
    updatedAt: null,
  };
}

function room(distribution = core.emptyDistribution(3)) {
  return {
    version: 1,
    id: "A".repeat(22),
    title: "테스트 공대 비스표",
    tier: "새로운 영식",
    week: 3,
    ownerUid: "owner-uid",
    locked: false,
    distribution,
    createdAt: null,
    updatedAt: null,
  };
}

function fakeCanvas() {
  const calls = [];
  const context = {
    calls,
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    scale() {},
    measureText(value) { return { width: String(value).length * 8 }; },
    fillText(value) { calls.push(String(value)); },
  };
  return {
    width: 0,
    height: 0,
    style: {},
    getContext(kind) { return kind === "2d" ? context : null; },
    context,
  };
}

test("비스표 이미지는 8명·11부위 현황과 진행률을 고해상도 캔버스에 그린다", () => {
  const members = core.SEATS.map((seat) => member(seat));
  const canvas = fakeCanvas();
  const rendered = renderBisSummaryImage(room(), members, { createCanvas: () => canvas, scale: 2 });

  assert.equal(rendered, canvas);
  assert.equal(canvas.width, 2960);
  assert.ok(canvas.height > 1600);
  assert.ok(canvas.context.calls.includes("테스트 공대 비스표"));
  assert.ok(canvas.context.calls.includes("새로운 영식 · 3주차"));
  assert.ok(canvas.context.calls.some((value) => value.includes("88 / 88개 완료")));
  core.SEATS.forEach((seat) => assert.ok(canvas.context.calls.includes(seat)));
  core.GEAR_SLOTS.forEach((slot) => assert.ok(canvas.context.calls.includes(core.GEAR_LABELS[slot])));
});

test("저장된 주간 드랍 분배도 현황 이미지 아래에 표시한다", () => {
  const members = core.SEATS.map((seat) => member(seat, seat === "MT" ? `R${"C".repeat(10)}` : "C".repeat(11)));
  const distribution = core.normalizeDistribution({
    week: 3,
    dropCounts: { ...core.emptyDistribution(3).dropCounts, raid_weapon: 1 },
    assignments: [{ dropType: "raid_weapon", seat: "MT", gearSlot: "weapon" }],
  });
  const canvas = fakeCanvas();
  renderBisSummaryImage(room(distribution), members, { createCanvas: () => canvas, scale: 1 });

  assert.ok(canvas.context.calls.includes("3주차 드랍 분배"));
  assert.ok(canvas.context.calls.includes("영식 무기 × 1"));
  assert.ok(canvas.context.calls.some((value) => value.includes("MT MT 공대원 · 무기")));
});

test("분배 뒤 장비 상태가 완료로 바뀌어도 저장된 수령 기록을 이미지에 남긴다", () => {
  const distribution = core.normalizeDistribution({
    week: 3,
    dropCounts: { ...core.emptyDistribution(3).dropCounts, raid_weapon: 1 },
    assignments: [{ dropType: "raid_weapon", seat: "MT", gearSlot: "weapon" }],
  });
  const members = core.SEATS.map((seat) => member(seat, "C".repeat(11)));
  const canvas = fakeCanvas();

  assert.doesNotThrow(() => {
    renderBisSummaryImage(room(distribution), members, { createCanvas: () => canvas, scale: 1 });
  });
  assert.ok(canvas.context.calls.some((value) => value.includes("MT MT 공대원 · 무기")));
});

test("이미지는 8명 전체 장비 데이터가 없으면 생성하지 않는다", () => {
  assert.throws(
    () => renderBisSummaryImage(room(), [member("MT")], { createCanvas: fakeCanvas }),
    /8명/,
  );
});
