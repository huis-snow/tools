"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const raid = require("../app.js");

const {
  STATE_VERSION,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  RECOVERY_KEY,
  normalizeJobRole,
  normalizeRole,
  createEmptyState,
  createDefaultState,
  createMember,
  parseBulkMembers,
  addMember,
  removeMember,
  updateMember,
  jobCanUseSeat,
  compatibleJobForSeat,
  buildSeats,
  placeMember,
  unassignMember,
  clearAssignments,
  autoAssign,
  compositionSummary,
  migrateV1,
  normalizeState,
  serializeState,
  importState,
  formatRaidText,
  renderRaidImage,
  prepareBrowserStorage,
  resetCorruptState,
  quarantineCorruptState,
} = raid;

const SEAT_ROLES = [
  "main_tank",
  "off_tank",
  "main_healer",
  "off_healer",
  "melee",
  "melee",
  "physical_ranged",
  "magical_ranged",
];
const SEAT_CODES = ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"];

test("브라우저 부팅은 공대표 v2와 이전 v1 키를 함께 보관함으로 이전한다", async () => {
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
    assert.deepEqual(calls, [{
      keys: [STORAGE_KEY, LEGACY_STORAGE_KEY, RECOVERY_KEY],
      options: { removeSource: true },
    }]);
  } finally {
    if (originalVault === undefined) delete globalThis.SmallToolsVault;
    else globalThis.SmallToolsVault = originalVault;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test("손상된 공대표 원문은 별도 복구 키에 한 번만 보관하고 명시적 초기화로 해제한다", () => {
  const values = new Map([[STORAGE_KEY, "{broken-raid"]]);
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };

  assert.equal(quarantineCorruptState(storage, values.get(STORAGE_KEY)), true);
  quarantineCorruptState(storage, "later-broken-value");
  assert.equal(values.get(RECOVERY_KEY), "{broken-raid");
  assert.equal(values.get(STORAGE_KEY), "{broken-raid");

  const reset = resetCorruptState(storage);
  assert.deepEqual(reset, createEmptyState());
  assert.equal(values.has(RECOVERY_KEY), false);
  assert.deepEqual(importState(values.get(STORAGE_KEY)), createEmptyState());
});

function job(name, role) {
  return { name, role };
}

function createTestMember(id, name, primaryJob, options = {}) {
  return {
    id,
    name,
    primaryJob,
    secondaryJob: options.secondaryJob ?? null,
    status: options.status || "confirmed",
    note: options.note || "",
  };
}

function add(state, id, name, primaryJob, options = {}) {
  return addMember(state, createTestMember(id, name, primaryJob, options));
}

function assignedEntries(state) {
  return Object.entries(state.assignments).filter(([, assignment]) => assignment?.memberId);
}

function assignmentFor(state, memberId) {
  const entry = assignedEntries(state).find(([, assignment]) => assignment.memberId === memberId);
  return entry ? { seatId: entry[0], ...entry[1] } : null;
}

function seatFor(state, memberId) {
  const assignment = assignmentFor(state, memberId);
  return assignment && buildSeats(state).find((seat) => seat.id === assignment.seatId);
}

function seatWithRole(state, role, occurrence = 0) {
  return buildSeats(state).filter((seat) => seat.role === role)[occurrence];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("FF14 v2 모듈은 화면과 테스트에 필요한 공개 API를 제공한다", () => {
  assert.equal(STATE_VERSION, 2);
  assert.match(STORAGE_KEY, /v2$/);
  for (const name of [
    "normalizeJobRole", "normalizeRole", "createEmptyState", "createDefaultState",
    "createMember", "parseBulkMembers", "addMember", "removeMember", "updateMember",
    "jobCanUseSeat", "compatibleJobForSeat", "buildSeats", "placeMember",
    "unassignMember", "clearAssignments", "autoAssign", "compositionSummary",
    "migrateV1", "normalizeState", "serializeState", "importState", "formatRaidText",
    "renderRaidImage",
  ]) {
    assert.equal(typeof raid[name], "function", `${name} API가 필요합니다`);
  }
});

test("빈 상태와 기본 상태는 예시 공대원이나 배치를 만들지 않는다", () => {
  for (const state of [createEmptyState(), createDefaultState()]) {
    assert.equal(state.version, 2);
    assert.deepEqual(state.members, []);
    assert.deepEqual(state.assignments, {});
    assert.equal(compositionSummary(state).assignedCount, 0);
    assert.equal(compositionSummary(state).totalSeats, 8);
  }
});

test("고정 파티는 MT·ST·MH·SH·D1·D2·D3·D4 순서의 여덟 자리다", () => {
  const state = createEmptyState();
  const seats = buildSeats(state);
  assert.equal(seats.length, 8);
  assert.deepEqual(seats.map((seat) => seat.role), SEAT_ROLES);
  assert.deepEqual(seats.map((seat) => seat.code), SEAT_CODES);
  assert.deepEqual(seats.map((seat) => seat.label), [
    "멘탱", "섭탱", "멘힐", "섭힐", "근딜", "근딜", "유격대", "캐스터",
  ]);
  assert.equal(new Set(seats.map((seat) => seat.id)).size, 8);
  assert.ok(seats.every((seat) => seat.partyIndex === 0));
});

test("직업 역할 별칭과 generic·exact 자리 호환을 구분한다", () => {
  assert.equal(normalizeJobRole("탱커"), "tank");
  assert.equal(normalizeJobRole("힐러"), "healer");
  assert.equal(normalizeJobRole("근딜"), "melee");
  assert.equal(normalizeJobRole("유격대"), "physical_ranged");
  assert.equal(normalizeJobRole("캐스터"), "magical_ranged");
  assert.equal(normalizeJobRole("MT"), "main_tank");
  assert.equal(normalizeJobRole("ST"), "off_tank");
  assert.equal(normalizeJobRole("MH"), "main_healer");
  assert.equal(normalizeJobRole("SH"), "off_healer");
  assert.equal(normalizeRole("탱커"), normalizeJobRole("탱커"), "이전 normalizeRole 이름은 alias로 유지합니다");
  assert.throws(() => normalizeJobRole("요리사"), /역할/);

  const state = createEmptyState();
  const mainTank = seatWithRole(state, "main_tank");
  const offTank = seatWithRole(state, "off_tank");
  const mainHealer = seatWithRole(state, "main_healer");
  const offHealer = seatWithRole(state, "off_healer");
  const melee = seatWithRole(state, "melee");
  const physical = seatWithRole(state, "physical_ranged");
  const magical = seatWithRole(state, "magical_ranged");

  assert.equal(jobCanUseSeat(job("나이트", "tank"), mainTank), true);
  assert.equal(jobCanUseSeat(job("나이트", "tank"), offTank), true);
  assert.equal(jobCanUseSeat(job("MT 전용", "main_tank"), mainTank), true);
  assert.equal(jobCanUseSeat(job("MT 전용", "main_tank"), offTank), false);
  assert.equal(jobCanUseSeat(job("학자", "healer"), mainHealer), true);
  assert.equal(jobCanUseSeat(job("학자", "healer"), offHealer), true);
  assert.equal(jobCanUseSeat(job("SH 전용", "off_healer"), mainHealer), false);
  assert.equal(jobCanUseSeat(job("SH 전용", "off_healer"), offHealer), true);
  assert.equal(jobCanUseSeat(job("사무라이", "melee"), melee), true);
  assert.equal(jobCanUseSeat(job("사무라이", "melee"), physical), false);
  assert.equal(jobCanUseSeat(job("음유시인", "physical_ranged"), physical), true);
  assert.equal(jobCanUseSeat(job("흑마도사", "magical_ranged"), magical), true);
  assert.equal(jobCanUseSeat(job("DPS 무관", "dps"), melee), true);
  assert.equal(jobCanUseSeat(job("DPS 무관", "dps"), physical), true);
  assert.equal(jobCanUseSeat(job("DPS 무관", "dps"), magical), true);
  assert.equal(jobCanUseSeat(job("DPS 무관", "dps"), mainTank), false);
});

test("주직업은 필수이고 부직업은 이름과 역할을 함께 입력해야 한다", () => {
  const member = createMember(createTestMember(
    "member-one",
    "쵸하",
    job("나이트", "tank"),
    { secondaryJob: job("전사", "tank"), note: "MT 가능" },
  ));
  assert.deepEqual(member.primaryJob, job("나이트", "tank"));
  assert.deepEqual(member.secondaryJob, job("전사", "tank"));

  const withoutSecondary = createMember(createTestMember(
    "member-two",
    "휴이스",
    job("백마도사", "healer"),
    { secondaryJob: { name: "", role: "" } },
  ));
  assert.equal(withoutSecondary.secondaryJob, null);

  assert.throws(() => createMember(createTestMember(
    "broken-name",
    "모카",
    job("사무라이", "melee"),
    { secondaryJob: { name: "몽크", role: "" } },
  )), /부직|보조|역할/);
  assert.throws(() => createMember(createTestMember(
    "broken-role",
    "라온",
    job("사무라이", "melee"),
    { secondaryJob: { name: "", role: "melee" } },
  )), /부직|보조|이름/);
});

test("한 자리에서 주직과 부직이 모두 가능하면 주직을 선택하고 아니면 부직으로 대체한다", () => {
  const state = createEmptyState();
  const tank = createMember(createTestMember(
    "tank",
    "쵸하",
    job("나이트", "tank"),
    { secondaryJob: job("전사", "tank") },
  ));
  const switcher = createMember(createTestMember(
    "switcher",
    "휴이스",
    job("사무라이", "melee"),
    { secondaryJob: job("흑마도사", "magical_ranged") },
  ));

  assert.equal(compatibleJobForSeat(tank, seatWithRole(state, "main_tank")).job, "primary");
  assert.equal(compatibleJobForSeat(switcher, seatWithRole(state, "magical_ranged")).job, "secondary");
  assert.equal(compatibleJobForSeat(switcher, seatWithRole(state, "physical_ranged")), null);
});

test("확정 인원 수를 먼저 최대화하기 위해 필요한 사람은 부직으로 전역 배치한다", () => {
  const state = createEmptyState();
  add(state, "switcher", "전환자", job("나이트", "tank"), {
    secondaryJob: job("흑마도사", "magical_ranged"),
  });
  add(state, "main-only", "메인탱", job("나이트", "main_tank"));
  add(state, "off-only", "서브탱", job("전사", "off_tank"));

  const summary = autoAssign(state);
  assert.equal(summary.assignedCount, 3);
  assert.equal(summary.primaryAssignedCount, 2);
  assert.equal(summary.secondaryAssignedCount, 1);
  assert.equal(summary.confirmedUnassigned.length, 0);
  assert.equal(seatFor(state, "main-only").role, "main_tank");
  assert.equal(seatFor(state, "off-only").role, "off_tank");
  assert.equal(seatFor(state, "switcher").role, "magical_ranged");
  assert.equal(assignmentFor(state, "switcher").job, "secondary");
  assert.equal(assignmentFor(state, "main-only").job, "primary");
});

test("배치 가능한 확정 인원 수가 같으면 주직 배치 수가 더 많은 전역 해를 고른다", () => {
  const state = createEmptyState();
  add(state, "main-tank", "주직멘탱", job("나이트", "main_tank"));
  add(state, "switcher", "전환가능", job("흑마도사", "magical_ranged"), {
    secondaryJob: job("전사", "main_tank"),
  });
  add(state, "caster", "주직캐스터", job("픽토맨서", "magical_ranged"));

  const summary = autoAssign(state);
  assert.equal(summary.assignedCount, 2);
  assert.equal(summary.primaryAssignedCount, 2);
  assert.equal(summary.secondaryAssignedCount, 0);
  assert.equal(assignmentFor(state, "main-tank").job, "primary");
  assert.equal(["switcher", "caster"].filter((id) => assignmentFor(state, id)?.job === "primary").length, 1);
});

test("확정 인원의 주직 배치는 추가 미정 인원 배치보다 우선한다", () => {
  const state = createEmptyState();
  add(state, "confirmed", "확정자", job("사무라이", "melee"), {
    secondaryJob: job("흑마도사", "magical_ranged"),
  });
  add(state, "maybe-one", "미정하나", job("몽크", "melee"), { status: "maybe" });
  add(state, "maybe-two", "미정둘", job("용기사", "melee"), { status: "maybe" });

  const summary = autoAssign(state);
  assert.equal(assignmentFor(state, "confirmed").job, "primary");
  assert.equal(seatFor(state, "confirmed").role, "melee");
  assert.equal(summary.assignedCount, 2, "확정자를 부직으로 돌려 미정 두 명을 모두 넣지 않습니다");
  assert.equal(summary.primaryAssignedCount, 2);
  assert.equal(summary.secondaryAssignedCount, 0);
  assert.equal(summary.tentativeAssignedCount, 1);
  assert.equal(["maybe-one", "maybe-two"].filter((id) => assignmentFor(state, id)).length, 1);
});

test("같은 입력은 명단·좌석 순서까지 포함해 항상 같은 자동 배치가 된다", () => {
  const source = createEmptyState();
  add(source, "tank-a", "탱A", job("나이트", "tank"), { secondaryJob: job("사무라이", "melee") });
  add(source, "tank-b", "탱B", job("전사", "tank"), { secondaryJob: job("음유시인", "physical_ranged") });
  add(source, "tank-c", "탱C", job("건브레이커", "tank"));
  add(source, "flex-dps", "딜러", job("직업 미정", "dps"));
  const serialized = serializeState(source);

  let expected = null;
  for (let index = 0; index < 25; index += 1) {
    const state = importState(serialized);
    autoAssign(state);
    const value = JSON.stringify(state.assignments);
    if (expected === null) expected = value;
    else assert.equal(value, expected);
  }
});

test("수동 배치는 주직 우선·부직 fallback을 기록하고 호환되는 두 사람을 교환한다", () => {
  const state = createEmptyState();
  add(state, "one", "하나", job("나이트", "tank"), {
    secondaryJob: job("흑마도사", "magical_ranged"),
  });
  add(state, "two", "둘", job("픽토맨서", "magical_ranged"), {
    secondaryJob: job("전사", "tank"),
  });
  const mainTank = seatWithRole(state, "main_tank");
  const magical = seatWithRole(state, "magical_ranged");

  placeMember(state, "one", mainTank.id);
  placeMember(state, "two", magical.id);
  assert.equal(state.assignments[mainTank.id].job, "primary");
  assert.equal(state.assignments[magical.id].job, "primary");

  const moved = placeMember(state, "one", magical.id);
  assert.equal(moved.swapped, true);
  assert.deepEqual(state.assignments[magical.id], { memberId: "one", job: "secondary" });
  assert.deepEqual(state.assignments[mainTank.id], { memberId: "two", job: "secondary" });

  assert.equal(unassignMember(state, "one"), true);
  assert.equal(assignmentFor(state, "one"), null);
  assert.equal(clearAssignments(state), true);
  assert.deepEqual(state.assignments, {});
  assert.equal(clearAssignments(state), false);
});

test("공대원 수정·삭제와 참여 상태 변경은 더는 유효하지 않은 배치를 정리한다", () => {
  const state = createEmptyState();
  add(state, "member", "쵸하", job("사무라이", "melee"), {
    secondaryJob: job("흑마도사", "magical_ranged"),
  });
  const magical = seatWithRole(state, "magical_ranged");
  placeMember(state, "member", magical.id);
  assert.equal(assignmentFor(state, "member").job, "secondary");

  updateMember(state, "member", { secondaryJob: null });
  assert.equal(assignmentFor(state, "member"), null);
  const updated = updateMember(state, "member", { status: "absent" });
  assert.equal(updated.status, "absent");
  assert.throws(() => placeMember(state, "member", seatWithRole(state, "melee").id));

  assert.equal(removeMember(state, "member"), true);
  assert.equal(removeMember(state, "member"), false);
});

test("정원 경쟁에서는 확정이 미정보다 우선이고 불참은 자동 배치에서 제외된다", () => {
  const state = createEmptyState();
  add(state, "maybe", "미정", job("나이트", "main_tank"), { status: "maybe" });
  add(state, "absent", "불참", job("전사", "main_tank"), { status: "absent" });
  add(state, "confirmed", "확정", job("건브레이커", "main_tank"));

  const summary = autoAssign(state);
  assert.equal(assignmentFor(state, "confirmed").seatId, seatWithRole(state, "main_tank").id);
  assert.equal(assignmentFor(state, "maybe"), null);
  assert.equal(assignmentFor(state, "absent"), null);
  assert.equal(summary.confirmedUnassigned.length, 0);
  assert.equal(summary.maybeUnassigned.length, 1);
  assert.equal(summary.absent.length, 1);
});

test("v1 사용자 명단은 v2로 이전하되 모호한 기존 배치는 안전하게 비운다", () => {
  const legacy = {
    version: 1,
    title: "이전 공대",
    eventTime: "2026-07-18T22:00",
    settings: { partyCount: 2, partySize: 4, tankPerParty: 1, supportPerParty: 1 },
    members: [
      { id: "old-tank", name: "기존탱", role: "tank", status: "confirmed", note: "MT" },
      { id: "old-healer", name: "기존힐", role: "support", status: "confirmed", note: "" },
      { id: "old-damage", name: "기존딜", role: "damage", status: "maybe", note: "직업 확인" },
      { id: "old-flex", name: "기존무관", role: "flex", status: "absent", note: "" },
    ],
    assignments: {
      "p0-tank-0": "old-tank",
      "p0-support-0": "old-healer",
      "p0-damage-0": "old-damage",
    },
  };

  const migrated = migrateV1(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.title, legacy.title);
  assert.equal(migrated.eventTime, legacy.eventTime);
  assert.deepEqual(migrated.members.map((member) => member.id), legacy.members.map((member) => member.id));
  assert.deepEqual(migrated.members.map((member) => member.status), legacy.members.map((member) => member.status));
  assert.deepEqual(migrated.members.map((member) => member.primaryJob.role), ["tank", "healer", "dps", "any"]);
  assert.deepEqual(migrated.assignments, {});

  assert.equal(JSON.parse(serializeState(migrated)).version, 2);
});

test("한글·이모지 직업명과 주직·부직 배치는 저장 후 그대로 왕복한다", () => {
  const state = createEmptyState();
  state.title = "🌙 절 공대";
  state.eventTime = "2026-07-18T22:00";
  add(state, "emoji", "쵸하🎮", job("건브레이커✨", "tank"), {
    secondaryJob: job("픽토맨서🎨", "magical_ranged"),
    note: "새벽까지 가능🌙",
  });
  placeMember(state, "emoji", seatWithRole(state, "magical_ranged").id);

  const restored = importState(serializeState(state));
  assert.equal(restored.title, state.title);
  assert.equal(restored.members[0].name, "쵸하🎮");
  assert.equal(restored.members[0].primaryJob.name, "건브레이커✨");
  assert.equal(restored.members[0].secondaryJob.name, "픽토맨서🎨");
  assert.equal(restored.members[0].note, "새벽까지 가능🌙");
  assert.deepEqual(restored.assignments, state.assignments);
  assert.deepEqual(normalizeState(restored), restored);
  assert.throws(() => importState("{not-json"), /JSON|형식|데이터/);
});

test("여섯 열 일괄 입력은 닉네임·주직업·주역할·부직업·부역할·메모를 보존한다", () => {
  const parsed = parseBulkMembers([
    "쵸하, 나이트, 탱커, 전사, 탱커, 메인 탱",
    "휴이스\t백마도사\t힐러\t\t\t저녁 가능",
    "모카, 사무라이, 근딜, 몽크, 근딜, ",
    "라온, 음유시인, 유격대, , , 원거리",
  ].join("\n"));

  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0], {
    name: "쵸하",
    primaryJob: job("나이트", "tank"),
    secondaryJob: job("전사", "tank"),
    status: "confirmed",
    note: "메인 탱",
  });
  assert.deepEqual(parsed[1].primaryJob, job("백마도사", "healer"));
  assert.equal(parsed[1].secondaryJob, null);
  assert.equal(parsed[1].note, "저녁 가능");
  assert.deepEqual(parsed[2].secondaryJob, job("몽크", "melee"));
  assert.deepEqual(parsed[3].primaryJob, job("음유시인", "physical_ranged"));
  assert.equal(parsed[3].secondaryJob, null);
  assert.throws(() => parseBulkMembers("잘못된사람, 나이트, 탱커, 전사, , 메모"), /부직|보조|역할/);
});

test("텍스트 내보내기는 좌석 코드와 실제 사용 직업의 주직·부직 표시를 담는다", () => {
  const state = createEmptyState();
  state.title = "토요일 절 공대";
  state.eventTime = "2026-07-18T22:00";
  add(state, "primary", "쵸하", job("나이트", "tank"));
  add(state, "secondary", "휴이스", job("사무라이", "melee"), {
    secondaryJob: job("흑마도사", "magical_ranged"),
    status: "maybe",
  });
  placeMember(state, "primary", seatWithRole(state, "main_tank").id);
  placeMember(state, "secondary", seatWithRole(state, "magical_ranged").id);

  const text = formatRaidText(state);
  for (const expected of ["토요일 절 공대", "쵸하", "나이트", "휴이스", "흑마도사"]) {
    assert.match(text, new RegExp(escapeRegExp(expected)));
  }
  for (const code of SEAT_CODES) {
    assert.match(text, new RegExp(`\\[${code}\\b`));
  }
  for (const roleLabel of ["근딜", "유격대", "캐스터"]) {
    assert.match(text, new RegExp(roleLabel));
  }
  assert.match(text, /주직|주 직업/);
  assert.match(text, /부직|보조 직업/);
  assert.match(text, /미정/);
});

test("공대 이미지는 고해상도 캔버스에 모든 좌석 코드·사용 직업·주직과 부직을 그린다", async () => {
  const originalDocument = global.document;
  const drawnText = [];
  const context = {
    scale() {}, fillRect() {}, strokeRect() {}, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, arc() {}, roundRect() {}, fill() {}, stroke() {},
    save() {}, restore() {}, clip() {}, translate() {}, setLineDash() {},
    fillText(value) { drawnText.push(String(value)); },
    measureText(value) { return { width: Array.from(String(value)).length * 12 }; },
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext(kind) { return kind === "2d" ? context : null; },
  };
  global.document = {
    createElement(tagName) {
      if (tagName !== "canvas") throw new Error(`예상하지 못한 요소 생성: ${tagName}`);
      return canvas;
    },
  };

  try {
    const state = createEmptyState();
    state.title = "🌙 이미지 절 공대";
    add(state, "primary", "쵸하", job("나이트", "tank"));
    add(state, "secondary", "휴이스", job("사무라이", "melee"), {
      secondaryJob: job("흑마도사", "magical_ranged"),
    });
    placeMember(state, "primary", seatWithRole(state, "main_tank").id);
    placeMember(state, "secondary", seatWithRole(state, "magical_ranged").id);

    const rendered = await renderRaidImage(state, { scale: 2 });
    assert.equal(rendered, canvas);
    assert.ok(canvas.width >= 2000, `가로 ${canvas.width}px은 고해상도 이미지로 보기 어렵습니다`);
    assert.ok(canvas.height >= 1200, `세로 ${canvas.height}px은 공대 정보를 담기에 부족합니다`);
    const allText = drawnText.join(" ");
    for (const expected of [
      "이미지 절 공대", "MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4",
      "근딜", "유격대", "캐스터",
      "쵸하", "나이트", "휴이스", "흑마도사",
    ]) {
      assert.match(allText, new RegExp(escapeRegExp(expected)));
    }
    assert.match(allText, /주직|주 직업/);
    assert.match(allText, /부직|보조 직업/);
  } finally {
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});

test("정적 페이지는 FF14 주직·부직 입력 훅을 사용하고 이전 예시 닉네임을 노출하지 않는다", () => {
  const directory = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  const rootHtml = fs.readFileSync(path.join(directory, "..", "index.html"), "utf8");

  for (const id of [
    "eventTitleInput", "eventTimeInput", "memberNameInput", "primaryJobInput",
    "primaryRoleSelect", "secondaryJobInput", "secondaryRoleSelect",
    "memberNoteInput", "addMemberButton", "bulkInput",
    "bulkAddButton", "memberList", "raidBoard", "autoAssignButton",
    "clearAssignmentsButton", "textButton", "imageButton", "pngButton", "resetButton",
    "toast", "liveRegion",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} 요소가 필요합니다`);
  }
  assert.doesNotMatch(html, /id=["'](?:partyCountInput|templateSelect|partySizeInput|tankPerPartyInput|supportPerPartyInput|memberRoleSelect)["']/);
  assert.match(html, /멘탱|MT/);
  assert.match(html, /섭탱|ST/);
  assert.match(html, /멘힐|MH/);
  assert.match(html, /섭힐|SH/);
  assert.match(html, /D1[^\n]*(?:근딜)|(?:근딜)[^\n]*D1/);
  assert.match(html, /D2[^\n]*(?:근딜)|(?:근딜)[^\n]*D2/);
  assert.match(html, /D3[^\n]*(?:유격대)|(?:유격대)[^\n]*D3/);
  assert.match(html, /D4[^\n]*(?:캐스터)|(?:캐스터)[^\n]*D4/);
  assert.match(html, /<script\s+src=["']app\.js["']/);
  assert.match(html, /<html\s+lang=["']ko["']/);

  const priorNames = /쵸하|휴이스|모카|라온|별빛|단풍|토리|윤슬/;
  assert.doesNotMatch(html, priorNames);
  assert.doesNotMatch(rootHtml, priorNames);
});
