"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../core.js");
globalThis.RaidLootCore = core;
const { renderRaidLootSummaryImage } = require("../image-renderer.js");

function room() {
  return {
    version: 1,
    id: "A".repeat(22),
    title: "절 공대 8주 파밍표",
    tier: "황금 영식 2시즌",
    startDate: "2026-08-18",
    currentWeek: 2,
    ownerUid: "owner-uid",
    locked: false,
    policy: { preset: "fair", seatOrder: core.SEATS },
    createdAt: null,
    updatedAt: null,
  };
}

function members(gear = "C".repeat(11)) {
  const jobs = ["나이트", "전사", "백마도사", "학자", "몽크", "용기사", "음유시인", "픽토맨서"];
  return core.SEATS.map((seat, index) => ({
    seat,
    nickname: `공대원 ${index + 1}`,
    job: jobs[index],
    editorUid: "",
    gear,
    submitted: true,
    createdAt: null,
    updatedAt: null,
  }));
}

function eventId(index) {
  return `E${String(index).padStart(21, "0")}`;
}

function event(value, index) {
  return {
    id: eventId(index),
    ...core.normalizeLootEventDraft(value),
    createdBy: "owner-uid",
    createdAt: { seconds: index },
  };
}

function award(overrides, index) {
  return event({
    action: "award",
    week: 1,
    floor: 1,
    dropType: "raid_ring",
    seat: "MT",
    gearSlot: "ring1",
    job: "",
    source: "raid",
    decision: "recommended",
    countsForFairness: true,
    note: "",
    ...overrides,
  }, index);
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
    measureText(value) { return { width: Array.from(String(value)).length * 8 }; },
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

test("8주 파밍표 이미지는 8명·11부위와 전체 주차 흐름을 고해상도로 그린다", () => {
  const canvas = fakeCanvas();
  const rendered = renderRaidLootSummaryImage(room(), members(), [], {
    week: 2,
    createCanvas: () => canvas,
    scale: 2,
  });

  assert.equal(rendered, canvas);
  assert.equal(canvas.width, 3360);
  assert.ok(canvas.height > 2600);
  assert.equal(canvas.style.width, "1680px");
  assert.ok(canvas.context.calls.includes("절 공대 8주 파밍표"));
  assert.ok(canvas.context.calls.includes("황금 영식 2시즌 · 2주차 · 08.25–08.31"));
  assert.ok(canvas.context.calls.includes("88 / 88개 완료"));
  assert.ok(canvas.context.calls.includes("8주 파밍 흐름"));
  assert.ok(canvas.context.calls.includes("2주차까지 공정성 집계"));
  assert.ok(canvas.context.calls.includes("2주차 활성 이력"));
  core.SEATS.forEach((seat) => assert.ok(canvas.context.calls.includes(seat)));
  core.GEAR_SLOTS.forEach((gearSlot) => {
    assert.ok(canvas.context.calls.includes(core.GEAR_LABELS[gearSlot]));
  });
  assert.equal(globalThis.RaidLootImage.renderRaidLootSummaryImage, renderRaidLootSummaryImage);
});

test("선택 주차까지의 활성 장비 분배만 덮어쓰고 undo와 미래 분배를 제외한다", () => {
  const first = award({
    floor: 4,
    dropType: "raid_weapon",
    seat: "MT",
    gearSlot: "weapon",
  }, 1);
  const undo = {
    id: eventId(2),
    ...core.createUndoEvent(first.id, "오입력"),
    createdBy: "owner-uid",
    createdAt: { seconds: 2 },
  };
  const free = award({
    floor: 2,
    dropType: "raid_head",
    seat: "D1",
    gearSlot: "head",
    decision: "free",
    countsForFairness: false,
  }, 3);
  const future = award({
    week: 2,
    floor: 4,
    dropType: "raid_weapon",
    seat: "ST",
    gearSlot: "weapon",
  }, 4);
  const skipped = event({
    action: "skip",
    week: 1,
    floor: 4,
    dropType: "mount",
    job: "",
    reason: "unclaimed",
    note: "",
  }, 5);
  const canvas = fakeCanvas();

  renderRaidLootSummaryImage(room(), members("R".repeat(11)), [first, undo, free, future, skipped], {
    week: 1,
    createCanvas: () => canvas,
    scale: 1,
  });

  assert.equal(canvas.context.calls.filter((value) => value === "수령 완료").length, 1);
  assert.ok(canvas.context.calls.includes("되돌린 기록 1건 제외 · 같은 내용은 묶어서 표시"));
  assert.ok(canvas.context.calls.includes("제외 1 · 남은 필요 10"));
  assert.ok(canvas.context.calls.includes("08.18–08.24 · 미배정 1"));
  assert.ok(canvas.context.calls.includes("08.25–08.31 · 미배정 0"));
  assert.ok(canvas.context.calls.some((value) => value.includes(
    "영식 머리 상자 → D1 공대원 5 · 머리 · 자유 분배 · 공정 집계 제외",
  )));
  assert.ok(canvas.context.calls.some((value) => value.includes("탈것 · 미배정 (희망자 없음)")));
  assert.equal(canvas.context.calls.some((value) => value.includes("ST 공대원 2 · 무기 · 추천 분배")), false);
});

test("공정 집계 포함 수령과 제외 수령을 구분해 누적하고 활성 이력을 요약한다", () => {
  const fair = award({ seat: "MT", gearSlot: "ring1" }, 1);
  const excluded = award({
    seat: "ST",
    gearSlot: "ring1",
    decision: "manual",
    countsForFairness: false,
  }, 2);
  const duplicateFree = award({
    floor: 4,
    dropType: "mount",
    seat: "D4",
    gearSlot: "",
    decision: "free",
    countsForFairness: false,
  }, 3);
  const duplicateFree2 = award({
    floor: 4,
    dropType: "mount",
    seat: "D4",
    gearSlot: "",
    decision: "free",
    countsForFairness: false,
  }, 4);
  const canvas = fakeCanvas();

  renderRaidLootSummaryImage(room(), members("R".repeat(11)), [fair, excluded, duplicateFree, duplicateFree2], {
    week: 1,
    createCanvas: () => canvas,
    scale: 1,
  });

  assert.ok(canvas.context.calls.some((value) => value.includes("공정 집계 1개 · 기록 4개")));
  assert.ok(canvas.context.calls.includes("집계 1개"));
  assert.ok(canvas.context.calls.includes("제외 1 · 남은 필요 10"));
  assert.ok(canvas.context.calls.some((value) => value.includes(
    "탈것 → D4 공대원 8 · 자유 분배 · 공정 집계 제외 × 2",
  )));
});

test("코어에서 거절하는 불완전한 데이터로 이미지를 만들지 않는다", () => {
  assert.throws(
    () => renderRaidLootSummaryImage(room(), members().slice(0, 7), [], { createCanvas: fakeCanvas }),
    /8명/,
  );
  assert.throws(
    () => renderRaidLootSummaryImage(room(), members(), [{
      id: eventId(1),
      action: "award",
      week: 1,
      floor: 4,
      dropType: "mount",
      job: "",
      seat: "MT",
      gearSlot: "",
      source: "raid",
      note: "",
      createdBy: "owner-uid",
      createdAt: null,
    }], { createCanvas: fakeCanvas }),
    /분배 결정 방식/,
  );
});
