"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../core.js");

const ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";

function roster() {
  return core.SEATS.map((seat, index) => ({
    seat,
    nickname: `공대원 ${index + 1}`,
    job: ["나이트", "전사", "백마도사", "학자", "몽크", "용기사", "음유시인", "픽토맨서"][index],
  }));
}

function gearWith(overrides = {}) {
  return Object.fromEntries(core.GEAR_SLOTS.map((gearSlot) => [gearSlot, overrides[gearSlot] ?? "complete"]));
}

function members(overrides = {}) {
  return roster().map((identity) => {
    const custom = overrides[identity.seat] || {};
    const gear = custom.gear || gearWith(custom.needs || {});
    return {
      ...identity,
      job: custom.job || identity.job,
      editorUid: custom.editorUid || "",
      gear: typeof gear === "string" ? gear : core.encodeGear(gear),
      submitted: custom.submitted ?? true,
      createdAt: null,
      updatedAt: null,
    };
  });
}

function eventId(index) {
  return `E${String(index).padStart(21, "0")}`;
}

function snapshot(value, index, createdBy = "owner-uid") {
  return {
    id: eventId(index),
    ...core.normalizeLootEventDraft(value),
    createdBy,
    createdAt: { seconds: index },
  };
}

function award(overrides, index) {
  return snapshot({
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

test("8주·8자리·11부위와 층별 17종 드랍팩을 고정한다", () => {
  assert.equal(core.FARMING_WEEKS, 8);
  assert.equal(core.FLOOR_COUNT, 4);
  assert.equal(core.MAX_LOOT_EVENTS, 480);
  assert.deepEqual(core.SEATS, ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
  assert.equal(core.GEAR_SLOTS.length, 11);
  assert.equal(core.DROP_TYPES.length, 17);
  assert.deepEqual(core.floorDropTypes(1), [
    "raid_earrings", "raid_necklace", "raid_bracelets", "raid_ring",
  ]);
  assert.deepEqual(core.floorDropTypes(2), [
    "raid_head", "raid_hands", "raid_feet", "upgrade_accessory", "tome_weapon_token",
  ]);
  assert.deepEqual(core.floorDropTypes(3), [
    "raid_body", "raid_legs", "upgrade_armor", "upgrade_weapon",
  ]);
  assert.deepEqual(core.floorDropTypes(4), ["raid_weapon", "direct_weapon", "music", "mount"]);
  assert.deepEqual(core.DROP_SPECS.raid_ring.gearSlots, ["ring1", "ring2"]);
  assert.equal(core.DROP_SPECS.tome_weapon_token.consumesNeed, false);
});

test("11부위 상태를 C/U/R/X로 왕복하고 제출 시 미입력을 거절한다", () => {
  const gear = {
    weapon: "complete",
    head: "upgrade",
    body: "raid",
    hands: null,
    legs: "complete",
    feet: "upgrade",
    earrings: "raid",
    necklace: null,
    bracelets: "complete",
    ring1: "upgrade",
    ring2: "raid",
  };
  assert.equal(core.encodeGear(gear), "CURXCURXCUR");
  assert.deepEqual(core.decodeGear("CURXCURXCUR"), gear);
  assert.throws(() => core.decodeGear("CUR"));
  assert.throws(() => core.normalizeMemberUpdate({ gear: "X".repeat(11), submitted: true }));
  assert.deepEqual(core.normalizeMemberUpdate({ gear: gearWith(), submitted: true }), {
    gear: "C".repeat(11),
    submitted: true,
  });
});

test("방 초안은 실재하는 시작일·1~8주차·8인 명단과 정책을 요구한다", () => {
  const room = core.normalizeRoomDraft({
    title: "  8주 파밍 공대 ",
    tier: " 현역 영식 ",
    startDate: "2026-08-24",
    currentWeek: "8",
    policy: "fair",
    roster: roster().reverse(),
  });
  assert.equal(room.version, 1);
  assert.equal(room.title, "8주 파밍 공대");
  assert.equal(room.startDate, "2026-08-24");
  assert.equal(room.currentWeek, 8);
  assert.deepEqual(room.roster.map((member) => member.seat), core.SEATS);
  assert.deepEqual(room.policy, { preset: "fair", seatOrder: core.SEATS });

  assert.throws(() => core.normalizeRoomDraft({ ...room, roster: roster(), currentWeek: 9 }));
  assert.throws(() => core.normalizeRoomDraft({ ...room, roster: roster(), startDate: "2026-02-30" }));
  assert.throws(() => core.normalizeRoomDraft({ ...room, roster: roster().slice(0, 7) }));
});

test("분배 정책은 수동·공정·진도·직접 설정과 정확한 8자리 순서를 지원한다", () => {
  assert.deepEqual(core.normalizePolicy("manual"), { preset: "manual", seatOrder: core.SEATS });
  assert.deepEqual(core.normalizePolicy("progression"), {
    preset: "progression",
    seatOrder: core.PROGRESSION_SEAT_ORDER,
  });
  const customOrder = [...core.SEATS].reverse();
  assert.deepEqual(core.normalizePolicy({ preset: "custom", seatOrder: customOrder }), {
    preset: "custom",
    seatOrder: customOrder,
  });
  assert.throws(() => core.normalizePolicy("unknown"));
  assert.throws(() => core.normalizePolicy({ preset: "custom" }));
  assert.throws(() => core.normalizePolicy({ preset: "custom", seatOrder: [...core.SEATS.slice(0, 7), "D3"] }));
});

test("드랍은 기본 층을 채우고 다른 층·불필요한 직업 지정은 거절한다", () => {
  assert.deepEqual(core.normalizeDrop("raid_body"), { floor: 3, dropType: "raid_body", job: "" });
  assert.deepEqual(core.normalizeDrop({ floor: 4, dropType: "direct_weapon", job: " 픽토맨서 " }), {
    floor: 4,
    dropType: "direct_weapon",
    job: "픽토맨서",
  });
  assert.throws(() => core.normalizeDrop({ floor: 2, dropType: "raid_body" }));
  assert.throws(() => core.normalizeDrop({ floor: 4, dropType: "direct_weapon" }));
  assert.throws(() => core.normalizeDrop({ floor: 4, dropType: "raid_weapon", job: "나이트" }));
});

test("award·skip·undo 이벤트를 용도별 고정 필드로 정규화한다", () => {
  const awarded = core.normalizeLootEventDraft({
    action: "award",
    week: "2",
    floor: 2,
    dropType: "tome_weapon_token",
    seat: "d1",
    gearSlot: "",
    job: "",
    source: "raid",
    decision: "free",
    countsForFairness: false,
    note: " 자유분배 ",
  });
  assert.deepEqual(awarded, {
    action: "award",
    week: 2,
    floor: 2,
    dropType: "tome_weapon_token",
    job: "",
    seat: "D1",
    gearSlot: "",
    source: "raid",
    decision: "free",
    countsForFairness: false,
    note: "자유분배",
  });
  assert.deepEqual(core.createSkipEvent({
    week: 4,
    floor: 4,
    dropType: "mount",
    job: "",
    reason: "external",
    note: "용병",
  }), {
    action: "skip",
    week: 4,
    floor: 4,
    dropType: "mount",
    job: "",
    reason: "external",
    note: "용병",
  });
  assert.deepEqual(core.createUndoEvent(eventId(1), "오입력"), {
    action: "undo",
    targetEventId: eventId(1),
    note: "오입력",
  });
  assert.throws(() => core.normalizeLootEventDraft({
    action: "award", week: 4, floor: 4, dropType: "mount", seat: "MT", gearSlot: "", job: "", source: "raid", note: "",
  }));
  assert.throws(() => core.normalizeLootEventDraft({
    action: "award", week: 4, floor: 4, dropType: "mount", seat: "MT", gearSlot: "head", job: "", source: "raid",
    decision: "free", countsForFairness: false, note: "",
  }));
});

test("원장은 append-only undo로 과거 기록을 비활성화하고 감사 이력을 보존한다", () => {
  const first = award({}, 1);
  const skipped = snapshot({
    action: "skip", week: 1, floor: 4, dropType: "mount", job: "", reason: "unclaimed", note: "",
  }, 2);
  const undo = {
    id: eventId(3),
    ...core.createUndoEvent(first.id, "잘못 배정"),
    createdBy: "owner-uid",
    createdAt: { seconds: 3 },
  };
  const ledger = core.normalizeLootEvents([first, skipped, undo]);
  assert.equal(ledger.length, 3);
  assert.deepEqual(core.activeLootEvents(ledger).map((event) => event.id), [skipped.id]);
  assert.throws(() => core.normalizeLootEvents([undo, first]));
  assert.throws(() => core.normalizeLootEvents([first, undo, {
    ...undo, id: eventId(4), note: "두 번 취소",
  }]));
  assert.throws(() => core.normalizeLootEvents([first, undo, {
    id: eventId(4), ...core.createUndoEvent(undo.id), createdBy: "owner-uid", createdAt: null,
  }]));
});

test("같은 필요 부위는 활성 배정을 중복할 수 없지만 undo 뒤에는 다시 배정할 수 있다", () => {
  const first = award({}, 1);
  const duplicate = award({ dropType: "upgrade_accessory", floor: 2, source: "book" }, 2);
  assert.throws(() => core.normalizeLootEvents([first, duplicate]));
  const undo = {
    id: eventId(3), ...core.createUndoEvent(first.id), createdBy: "owner-uid", createdAt: null,
  };
  assert.doesNotThrow(() => core.normalizeLootEvents([first, undo, duplicate]));
});

test("장비 후보는 상태·부위·기존 활성 배정·직접 무기 직업을 모두 확인한다", () => {
  const party = members({
    MT: { needs: { ring1: "raid", ring2: "raid", weapon: "raid" } },
    ST: { needs: { ring1: "upgrade" } },
    D4: { needs: { weapon: "raid" } },
  });
  const ringAward = award({}, 1);
  const ringCandidates = core.eligibleCandidates("raid_ring", party, [ringAward]);
  assert.deepEqual(ringCandidates.map((candidate) => [candidate.seat, candidate.gearSlots]), [
    ["MT", ["ring2"]],
  ]);
  assert.deepEqual(
    core.eligibleCandidates({ floor: 4, dropType: "direct_weapon", job: "픽토맨서" }, party).map((item) => item.seat),
    ["D4"],
  );
  assert.equal(core.eligibleCandidates("mount", party).length, 8);
});

test("자유분배는 필요 부위를 소비하지만 공정성 통계와 다음 순위에는 불이익을 주지 않는다", () => {
  const party = members({
    MT: { needs: { head: "raid", body: "raid" } },
    ST: { needs: { head: "raid", body: "raid" } },
  });
  const freeAward = award({
    week: 2,
    floor: 3,
    dropType: "raid_body",
    seat: "MT",
    gearSlot: "body",
    decision: "free",
    countsForFairness: false,
  }, 1);
  const stat = core.cumulativeStatistics(party, [freeAward]).find((item) => item.seat === "MT");
  assert.equal(stat.recordedAwards, 1);
  assert.equal(stat.excludedAwards, 1);
  assert.equal(stat.totalAwards, 0);
  assert.equal(stat.gearAwards, 0);
  assert.deepEqual(stat.satisfiedSlots, ["body"]);
  assert.equal(stat.remainingSlots.includes("body"), false);

  const ranked = core.rankCandidates({ drop: "raid_head", week: 2, members: party, events: [freeAward], policy: "fair" });
  assert.deepEqual(ranked.slice(0, 2).map((item) => item.seat), ["MT", "ST"]);
});

test("공정 정책은 누적 장비·같은 드랍·이번 주 집계가 적은 후보를 먼저 둔다", () => {
  const party = members({
    MT: { needs: { head: "raid", body: "raid" } },
    ST: { needs: { head: "raid" } },
  });
  const received = award({
    floor: 3, dropType: "raid_body", seat: "MT", gearSlot: "body",
  }, 1);
  const ranked = core.rankCandidates({ drop: "raid_head", week: 1, members: party, events: [received], policy: "fair" });
  assert.equal(ranked[0].seat, "ST");
  assert.match(ranked[0].reasons.join(" "), /공정 집계 장비 0개/);
  assert.deepEqual(ranked[0].sortKey, [0, 0, 0, 1]);
});

test("진도 정책은 DPS 그룹 안에서 공정성을 적용하고 탱커·힐러보다 먼저 둔다", () => {
  const party = members(Object.fromEntries(core.SEATS.map((seat) => [seat, {
    needs: { head: "raid", body: "raid" },
  }])));
  const d4Received = award({
    floor: 3, dropType: "raid_body", seat: "D4", gearSlot: "body",
  }, 1);
  const ranked = core.rankCandidates({
    drop: "raid_head", week: 1, members: party, events: [d4Received], policy: "progression",
  });
  assert.equal(ranked.slice(0, 4).every((candidate) => candidate.seat.startsWith("D")), true);
  assert.notEqual(ranked[0].seat, "D4");
  assert.match(ranked[0].reasons[0], /DPS 우선 그룹/);
  assert.equal(ranked.findIndex((candidate) => candidate.seat === "MT") > 3, true);
});

test("직접 정책은 누적 수령량보다 사용자가 정한 절대 순서를 우선한다", () => {
  const party = members({
    MT: { needs: { head: "raid", body: "raid" } },
    D4: { needs: { head: "raid" } },
  });
  const received = award({
    floor: 3, dropType: "raid_body", seat: "MT", gearSlot: "body",
  }, 1);
  const seatOrder = ["MT", "D4", "ST", "MH", "SH", "D1", "D2", "D3"];
  const ranked = core.rankCandidates({
    drop: "raid_head", week: 1, members: party, events: [received], policy: { preset: "custom", seatOrder },
  });
  assert.equal(ranked[0].seat, "MT");
  assert.match(ranked[0].reasons[0], /사용자 우선순위 1번째/);
});

test("한 개 추천은 1순위와 설명 목록 및 recommended 이벤트를 함께 만든다", () => {
  const party = members({
    MT: { needs: { feet: "upgrade" } },
    ST: { needs: { head: "upgrade" } },
  });
  const suggestion = core.suggestAssignment({
    drop: "upgrade_armor",
    week: 3,
    members: party,
    events: [],
    policy: "fair",
  });
  assert.equal(suggestion.candidate.seat, "MT");
  assert.equal(suggestion.candidates.length, 2);
  assert.deepEqual(suggestion.event, {
    action: "award",
    week: 3,
    floor: 3,
    dropType: "upgrade_armor",
    job: "",
    seat: "MT",
    gearSlot: "feet",
    source: "raid",
    decision: "recommended",
    countsForFairness: true,
    note: "",
  });
  assert.equal(core.suggestAssignment({ drop: "raid_weapon", week: 3, members: party }), null);
});

test("수동 한 개 분배도 현재 필요와 활성 원장을 통과해야 한다", () => {
  const party = members({ MT: { needs: { ring1: "raid" } } });
  const draft = core.createAwardEvent({
    week: 1,
    floor: 1,
    dropType: "raid_ring",
    seat: "MT",
    gearSlot: "ring1",
    job: "",
    source: "raid",
    decision: "manual",
    countsForFairness: true,
    note: "방장 지정",
  }, party);
  assert.equal(draft.decision, "manual");
  assert.throws(() => core.createAwardEvent({ ...draft, seat: "ST" }, party));
  assert.throws(() => core.createAwardEvent(draft, party, [award({}, 1)]));
});

test("방 저장 데이터·메타데이터·ID·Firebase 공개 설정을 엄격히 검증한다", () => {
  const room = core.normalizeRoomSnapshot({
    version: 1,
    title: "8주 공대",
    tier: "현역 영식",
    startDate: "2026-08-24",
    currentWeek: 4,
    ownerUid: "owner-uid",
    locked: false,
    policy: "fair",
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 2 },
  }, ROOM_ID);
  assert.equal(room.id, ROOM_ID);
  assert.equal(room.startDate, "2026-08-24");
  assert.deepEqual(core.normalizeRoomMetadataUpdate({
    startDate: "2026-08-31",
    currentWeek: 5,
    policy: { preset: "manual", seatOrder: core.SEATS },
  }), {
    startDate: "2026-08-31",
    currentWeek: 5,
    policy: { preset: "manual", seatOrder: core.SEATS },
  });
  assert.throws(() => core.normalizeRoomMetadataUpdate({}));
  assert.throws(() => core.validateRoomId("short"));
  assert.throws(() => core.validateEventId("short"));
  assert.equal(core.createRoomId({
    getRandomValues(bytes) { bytes.forEach((_value, index) => { bytes[index] = index; }); return bytes; },
  }), ROOM_ID);
  assert.equal(core.createEventId({
    getRandomValues(bytes) { bytes.forEach((_value, index) => { bytes[index] = index; }); return bytes; },
  }), ROOM_ID);
  assert.equal(core.firebaseConfigReady({
    apiKey: "api-key", authDomain: "project.firebaseapp.com", projectId: "project", appId: "app-id",
  }), true);
  assert.equal(core.firebaseConfigReady({
    apiKey: "YOUR_API_KEY", authDomain: "project.firebaseapp.com", projectId: "project", appId: "app-id",
  }), false);
});
