"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../core.js");

const ROOM_ID = "AAECAwQFBgcICQoLDA0ODw";

function roster() {
  return core.SEATS.map((seat, index) => ({
    seat,
    nickname: `공대원 ${index + 1}`,
    job: `직업 ${index + 1}`,
  }));
}

function gearWith(overrides = {}) {
  return Object.fromEntries(core.GEAR_SLOTS.map((slot) => [slot, overrides[slot] ?? "complete"]));
}

function members(overrides = {}) {
  return roster().map((identity) => {
    const custom = overrides[identity.seat] || {};
    const gear = custom.gear || gearWith(custom.needs || {});
    return {
      ...identity,
      editorUid: custom.editorUid || "",
      gear: core.encodeGear(gear),
      submitted: custom.submitted ?? true,
      updatedAt: null,
    };
  });
}

function counts(overrides = {}) {
  return Object.fromEntries(core.DROP_TYPES.map((dropType) => [dropType, overrides[dropType] || 0]));
}

test("고정 자리·장비 부위·드랍 종류는 화면과 저장소가 공유할 순서를 유지한다", () => {
  assert.deepEqual(core.SEATS, ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
  assert.deepEqual(core.GEAR_SLOTS, [
    "weapon", "head", "body", "hands", "legs", "feet",
    "earrings", "necklace", "bracelets", "ring1", "ring2",
  ]);
  assert.equal(core.DROP_TYPES.length, 13);
  assert.deepEqual(core.DROP_SPECS.raid_ring.gearSlots, ["ring1", "ring2"]);
  assert.deepEqual(core.DROP_SPECS.upgrade_armor.gearSlots, ["head", "body", "hands", "legs", "feet"]);
  assert.deepEqual(core.DROP_SPECS.upgrade_accessory.gearSlots, [
    "earrings", "necklace", "bracelets", "ring1", "ring2",
  ]);
});

test("장비 상태 11개는 C/U/R/X 한 글자씩 왕복 변환한다", () => {
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
  const encoded = core.encodeGear(gear);
  assert.equal(encoded, "CURXCURXCUR");
  assert.deepEqual(core.decodeGear(encoded), gear);
  assert.throws(() => core.decodeGear("CUR"));
  assert.throws(() => core.decodeGear("CURXCULXCUR"));
  assert.throws(() => core.decodeGear(encoded, { allowUnset: false }));
  assert.throws(() => core.normalizeGearMap({ ...gear, unknown: "raid" }, { allowUnset: true }));
});

test("제출 전에는 미입력을 허용하고 제출 시 11개 상태를 모두 요구한다", () => {
  const draft = core.normalizeMemberDraft({
    seat: "mt",
    nickname: "  휴이스 ",
    job: " 나이트 ",
  });
  assert.deepEqual(draft, {
    seat: "MT",
    nickname: "휴이스",
    job: "나이트",
    gear: "X".repeat(11),
    submitted: false,
  });
  assert.throws(() => core.normalizeMemberUpdate({ gear: "X".repeat(11), submitted: true }));
  assert.deepEqual(core.normalizeMemberUpdate({ gear: gearWith(), submitted: true }), {
    gear: "C".repeat(11),
    submitted: true,
  });
  assert.throws(() => core.normalizeMemberUpdate({ gear: gearWith(), submitted: "true" }));
});

test("공대원 저장 데이터는 문서 ID 자리와 편집자 정보를 보존한다", () => {
  const snapshot = core.normalizeMemberSnapshot({
    seat: "MT",
    nickname: "휴이스",
    job: "나이트",
    editorUid: "anonymous-user",
    gear: "C".repeat(11),
    submitted: true,
    updatedAt: { seconds: 10 },
  }, "MT");
  assert.equal(snapshot.seat, "MT");
  assert.equal(snapshot.editorUid, "anonymous-user");
  assert.deepEqual(snapshot.updatedAt, { seconds: 10 });
  assert.throws(() => core.normalizeMemberSnapshot({
    nickname: "휴이스",
    job: "나이트",
    editorUid: 123,
    gear: "C".repeat(11),
    submitted: true,
  }, "MT"));
  assert.throws(() => core.normalizeMemberSnapshot({
    seat: "ST",
    nickname: "휴이스",
    job: "나이트",
    editorUid: "",
    gear: "C".repeat(11),
    submitted: true,
  }, "MT"));
});

test("방 초안은 정확히 8자리의 고유 닉네임과 직업을 정규화한다", () => {
  const reversed = roster().reverse();
  const room = core.normalizeRoomDraft({
    title: "  절영 공대 BiS ",
    tier: "  황금의 유산 4층 ",
    week: "7",
    roster: reversed,
  });
  assert.equal(room.version, 1);
  assert.equal(room.title, "절영 공대 BiS");
  assert.equal(room.tier, "황금의 유산 4층");
  assert.equal(room.week, 7);
  assert.deepEqual(room.roster.map((member) => member.seat), core.SEATS);

  assert.throws(() => core.normalizeRoomDraft({ title: "방", tier: "시즌", week: 1, roster: roster().slice(0, 7) }));
  assert.throws(() => core.normalizeRoomDraft({
    title: "방",
    tier: "시즌",
    week: 1,
    roster: roster().map((member, index) => index === 7 ? { ...member, seat: "D3" } : member),
  }));
  assert.throws(() => core.normalizeRoomDraft({
    title: "방",
    tier: "시즌",
    week: 1,
    roster: roster().map((member, index) => index === 7 ? { ...member, nickname: " 공대원 1 " } : member),
  }));
  assert.throws(() => core.normalizeRoomDraft({
    title: "방",
    tier: "시즌",
    week: 1,
    roster: roster().map((member, index) => index === 7 ? { ...member, job: "" } : member),
  }));
});

test("방 ID와 공유 URL은 16바이트 base64url 형식만 사용한다", () => {
  const roomId = core.createRoomId({
    getRandomValues(bytes) {
      bytes.forEach((_value, index) => { bytes[index] = index; });
      return bytes;
    },
  });
  assert.equal(roomId, ROOM_ID);
  assert.equal(core.validateRoomId(roomId), roomId);
  assert.equal(
    core.makeRoomUrl("https://example.test/bis-maker/room.html?old=1#secret", roomId),
    `https://example.test/bis-maker/room.html?r=${roomId}`,
  );
  assert.throws(() => core.validateRoomId("short"));
  assert.throws(() => core.createRoomId({}));
});

test("드랍 수량은 13개 고정 키의 0~99 정수로 정규화한다", () => {
  const normalized = core.normalizeDropCounts({ raid_weapon: "2", upgrade_armor: 3 });
  assert.equal(normalized.raid_weapon, 2);
  assert.equal(normalized.upgrade_armor, 3);
  assert.equal(normalized.raid_head, 0);
  assert.equal(Object.keys(normalized).length, 13);
  assert.throws(() => core.normalizeDropCounts({ unknown: 1 }));
  assert.throws(() => core.normalizeDropCounts({ raid_weapon: -1 }));
  assert.throws(() => core.normalizeDropCounts({ raid_weapon: 1.5 }));
  assert.throws(() => core.normalizeDropCounts({ raid_weapon: 100 }));
  assert.throws(() => core.normalizeDropCounts({ raid_weapon: 1 }, { requireAll: true }));
});

test("반지 드랍 두 개는 한 사람의 서로 다른 반지 수요에 각각 배정한다", () => {
  const party = members({ MT: { needs: { ring1: "raid", ring2: "raid" } } });
  const result = core.autoAllocateDrops(party, counts({ raid_ring: 2 }), { week: 4 });
  assert.deepEqual(result.assignments, [
    { dropType: "raid_ring", seat: "MT", gearSlot: "ring1" },
    { dropType: "raid_ring", seat: "MT", gearSlot: "ring2" },
  ]);
  assert.deepEqual(result.unassignedDrops, []);
  assert.equal(result.distribution.assignments.raid_ring, "MT@ring1,MT@ring2");
});

test("방어구·장신구 보강재는 해당 범주의 보강 필요 부위에만 배정한다", () => {
  const party = members({
    MT: { needs: { head: "upgrade" } },
    ST: { needs: { feet: "upgrade" } },
    D1: { needs: { earrings: "upgrade" } },
    D2: { needs: { weapon: "upgrade" } },
  });
  const result = core.autoAllocateDrops(party, counts({
    upgrade_weapon: 1,
    upgrade_armor: 2,
    upgrade_accessory: 1,
  }));
  assert.deepEqual(result.assignments, [
    { dropType: "upgrade_weapon", seat: "D2", gearSlot: "weapon" },
    { dropType: "upgrade_armor", seat: "MT", gearSlot: "head" },
    { dropType: "upgrade_armor", seat: "ST", gearSlot: "feet" },
    { dropType: "upgrade_accessory", seat: "D1", gearSlot: "earrings" },
  ]);
  assert.equal(result.assignments.some((item) => item.seat === "D1" && item.dropType === "upgrade_armor"), false);
});

test("자동 분배는 이번 주 배정 횟수가 적은 사람을 먼저 고른다", () => {
  const party = members({
    MT: { needs: { head: "raid", body: "raid" } },
    ST: { needs: { head: "raid" } },
  });
  const result = core.autoAllocateDrops(party, counts({ raid_head: 1, raid_body: 1 }), {
    existingAssignments: [{ dropType: "raid_body", seat: "MT", gearSlot: "body" }],
  });
  assert.deepEqual(result.assignments, [
    { dropType: "raid_body", seat: "MT", gearSlot: "body" },
    { dropType: "raid_head", seat: "ST", gearSlot: "head" },
  ]);
});

test("배정 횟수가 같으면 완료 부위가 적은 사람, 그다음 고정 자리 순서를 우선한다", () => {
  const fewerComplete = members({
    MT: { needs: { head: "raid", body: "raid" } },
    ST: { needs: { head: "raid" } },
  });
  assert.deepEqual(
    core.autoAllocateDrops(fewerComplete, counts({ raid_head: 1 })).assignments[0],
    { dropType: "raid_head", seat: "MT", gearSlot: "head" },
  );

  const tied = members({
    MT: { needs: { head: "raid" } },
    ST: { needs: { head: "raid" } },
  });
  assert.deepEqual(
    core.autoAllocateDrops(tied, counts({ raid_head: 1 })).assignments[0],
    { dropType: "raid_head", seat: "MT", gearSlot: "head" },
  );
});

test("후보보다 드랍이 많거나 장비표가 미제출이면 미분배 드랍으로 남긴다", () => {
  const party = members({
    MT: { needs: { head: "raid" } },
    ST: { gear: "X".repeat(11), submitted: false },
  });
  const result = core.autoAllocateDrops(party, counts({ raid_head: 3 }));
  assert.deepEqual(result.assignments, [{ dropType: "raid_head", seat: "MT", gearSlot: "head" }]);
  assert.deepEqual(result.unassignedDrops, [
    { dropType: "raid_head" },
    { dropType: "raid_head" },
  ]);
});

test("같은 장비 필요 부위는 자동·수동 계획 모두 두 번 배정하지 않는다", () => {
  const party = members({ MT: { needs: { head: "raid" } } });
  const duplicate = [
    { dropType: "raid_head", seat: "MT", gearSlot: "head" },
    { dropType: "raid_head", seat: "MT", gearSlot: "head" },
  ];
  assert.throws(() => core.autoAllocateDrops(party, counts({ raid_head: 2 }), { existingAssignments: duplicate }));
  assert.throws(() => core.validateAllocationPlan({ assignments: duplicate, unassignedDrops: [] }, party, counts({ raid_head: 2 })));
});

test("수동 분배 계획은 필요 상태·드랍 부위·전체 수량을 모두 검증한다", () => {
  const party = members({
    MT: { needs: { head: "raid" } },
    ST: { needs: { body: "upgrade" } },
  });
  const valid = core.validateAllocationPlan({
    assignments: [{ dropType: "raid_head", seat: "MT", gearSlot: "head" }],
    unassignedDrops: [{ dropType: "upgrade_armor" }],
  }, party, counts({ raid_head: 1, upgrade_armor: 1 }));
  assert.equal(valid.assignments.length, 1);
  assert.equal(valid.unassignedDrops.length, 1);

  assert.throws(() => core.validateAllocationPlan({
    assignments: [{ dropType: "raid_head", seat: "ST", gearSlot: "head" }],
    unassignedDrops: [{ dropType: "upgrade_armor" }],
  }, party, counts({ raid_head: 1, upgrade_armor: 1 })));
  assert.throws(() => core.normalizeAssignment({ dropType: "raid_head", seat: "MT", gearSlot: "body" }));
  assert.throws(() => core.validateAllocationPlan({
    assignments: [{ dropType: "raid_head", seat: "MT", gearSlot: "head" }],
    unassignedDrops: [],
  }, party, counts({ raid_head: 2 })));
});

test("분배표는 Firestore용 고정 문자열 맵과 논리 계획 사이를 왕복한다", () => {
  const dropCounts = counts({ raid_ring: 3, upgrade_armor: 1 });
  const distribution = core.normalizeDistribution({
    week: "5",
    dropCounts,
    assignments: [
      { dropType: "raid_ring", seat: "MT", gearSlot: "ring1" },
      { dropType: "raid_ring", seat: "ST", gearSlot: "ring2" },
    ],
  });
  assert.equal(distribution.week, 5);
  assert.equal(distribution.assignments.raid_ring, "MT@ring1,ST@ring2");
  assert.equal(distribution.assignments.raid_head, "");
  assert.equal(Object.keys(distribution.assignments).length, 13);
  assert.deepEqual(core.distributionPlan(distribution), {
    assignments: [
      { dropType: "raid_ring", seat: "MT", gearSlot: "ring1" },
      { dropType: "raid_ring", seat: "ST", gearSlot: "ring2" },
    ],
    unassignedDrops: [
      { dropType: "raid_ring" },
      { dropType: "upgrade_armor" },
    ],
  });
  assert.throws(() => core.normalizeDistribution({
    week: 5,
    dropCounts,
    assignments: { ...core.emptyAssignmentMap(), raid_head: "MT@head,MT@head" },
  }));
  assert.throws(() => core.normalizeDistribution({
    week: 5,
    dropCounts,
    assignments: { ...core.emptyAssignmentMap(), raid_head: "MT@body" },
  }));
});

test("방 저장 데이터는 메타데이터와 같은 주차의 고정 분배표만 받는다", () => {
  const room = core.normalizeRoomSnapshot({
    version: 1,
    title: "공대 BiS",
    tier: "현역 영식",
    week: 3,
    ownerUid: "owner-uid",
    locked: false,
    distribution: core.emptyDistribution(3),
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 2 },
  }, ROOM_ID);
  assert.equal(room.id, ROOM_ID);
  assert.equal(room.distribution.week, 3);
  assert.deepEqual(core.normalizeRoomMetadataUpdate({ title: " 새 이름 ", locked: true }), {
    title: "새 이름",
    locked: true,
  });
  assert.throws(() => core.normalizeRoomSnapshot({ ...room, distribution: core.emptyDistribution(4) }, ROOM_ID));
  assert.throws(() => core.normalizeRoomMetadataUpdate({}));
  assert.throws(() => core.normalizeRoomMetadataUpdate({ ownerUid: "other" }));
});

test("8명 데이터와 분배 저장 데이터의 비정상 형태를 엄격히 거절한다", () => {
  assert.throws(() => core.normalizeMembers(members().slice(0, 7)));
  assert.throws(() => core.normalizeMembers(members().map((member, index) => (
    index === 7 ? { ...member, seat: "D3" } : member
  ))));
  assert.throws(() => core.decodeAssignmentMap({ ...core.emptyAssignmentMap(), raid_head: "MT @head" }));
  assert.throws(() => core.decodeAssignmentMap({ ...core.emptyAssignmentMap(), raid_head: "XX@head" }));
  assert.throws(() => core.decodeAssignmentMap({ ...core.emptyAssignmentMap(), extra: "" }));
  assert.throws(() => core.normalizeDistribution({
    week: 1,
    dropCounts: counts({ raid_head: 0 }),
    assignments: { ...core.emptyAssignmentMap(), raid_head: "MT@head" },
  }));
});

test("Firebase 공개 설정은 서비스 계정 없이 웹 설정 네 항목만 확인한다", () => {
  assert.equal(core.firebaseConfigReady({
    apiKey: "api-key",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    appId: "app-id",
  }), true);
  assert.equal(core.firebaseConfigReady({
    apiKey: "YOUR_API_KEY",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    appId: "app-id",
  }), false);
});
