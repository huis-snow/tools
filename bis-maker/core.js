(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const ROOM_ID_BYTES = 16;
  const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const MAX_TITLE_LENGTH = 60;
  const MAX_TIER_LENGTH = 60;
  const MAX_NICKNAME_LENGTH = 30;
  const MAX_JOB_LENGTH = 30;
  const MAX_WEEK = 99;
  const MAX_DROP_COUNT = 99;

  const SEATS = Object.freeze(["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
  const SEAT_LABELS = Object.freeze({
    MT: "멘탱",
    ST: "섭탱",
    MH: "멘힐",
    SH: "섭힐",
    D1: "근딜 1",
    D2: "근딜 2",
    D3: "유격대",
    D4: "캐스터",
  });

  const GEAR_SLOTS = Object.freeze([
    "weapon",
    "head",
    "body",
    "hands",
    "legs",
    "feet",
    "earrings",
    "necklace",
    "bracelets",
    "ring1",
    "ring2",
  ]);
  const GEAR_LABELS = Object.freeze({
    weapon: "무기",
    head: "머리",
    body: "몸통",
    hands: "장갑",
    legs: "바지",
    feet: "신발",
    earrings: "귀걸이",
    necklace: "목걸이",
    bracelets: "팔찌",
    ring1: "반지 1",
    ring2: "반지 2",
  });
  const GEAR_STATUSES = Object.freeze(["complete", "upgrade", "raid"]);
  const STATUS_LABELS = Object.freeze({
    complete: "완료",
    upgrade: "보강템필요",
    raid: "영식템필요",
  });
  const STATUS_TO_CODE = Object.freeze({ complete: "C", upgrade: "U", raid: "R" });
  const CODE_TO_STATUS = Object.freeze({ C: "complete", U: "upgrade", R: "raid", X: null });
  const GEAR_CODE_PATTERN = /^[XCUR]{11}$/;

  const ARMOR_SLOTS = Object.freeze(["head", "body", "hands", "legs", "feet"]);
  const ACCESSORY_SLOTS = Object.freeze(["earrings", "necklace", "bracelets", "ring1", "ring2"]);
  const DROP_TYPES = Object.freeze([
    "raid_weapon",
    "raid_head",
    "raid_body",
    "raid_hands",
    "raid_legs",
    "raid_feet",
    "raid_earrings",
    "raid_necklace",
    "raid_bracelets",
    "raid_ring",
    "upgrade_weapon",
    "upgrade_armor",
    "upgrade_accessory",
  ]);
  const DROP_SPECS = Object.freeze({
    raid_weapon: Object.freeze({ label: "영식 무기", status: "raid", gearSlots: Object.freeze(["weapon"]) }),
    raid_head: Object.freeze({ label: "영식 머리", status: "raid", gearSlots: Object.freeze(["head"]) }),
    raid_body: Object.freeze({ label: "영식 몸통", status: "raid", gearSlots: Object.freeze(["body"]) }),
    raid_hands: Object.freeze({ label: "영식 장갑", status: "raid", gearSlots: Object.freeze(["hands"]) }),
    raid_legs: Object.freeze({ label: "영식 바지", status: "raid", gearSlots: Object.freeze(["legs"]) }),
    raid_feet: Object.freeze({ label: "영식 신발", status: "raid", gearSlots: Object.freeze(["feet"]) }),
    raid_earrings: Object.freeze({ label: "영식 귀걸이", status: "raid", gearSlots: Object.freeze(["earrings"]) }),
    raid_necklace: Object.freeze({ label: "영식 목걸이", status: "raid", gearSlots: Object.freeze(["necklace"]) }),
    raid_bracelets: Object.freeze({ label: "영식 팔찌", status: "raid", gearSlots: Object.freeze(["bracelets"]) }),
    raid_ring: Object.freeze({ label: "영식 반지", status: "raid", gearSlots: Object.freeze(["ring1", "ring2"]) }),
    upgrade_weapon: Object.freeze({ label: "무기 보강재", status: "upgrade", gearSlots: Object.freeze(["weapon"]) }),
    upgrade_armor: Object.freeze({ label: "방어구 보강재", status: "upgrade", gearSlots: ARMOR_SLOTS }),
    upgrade_accessory: Object.freeze({ label: "장신구 보강재", status: "upgrade", gearSlots: ACCESSORY_SLOTS }),
  });

  function own(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function assertPlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError(`${label} 정보가 필요합니다.`);
    }
    return value;
  }

  function rejectUnknownKeys(value, allowedKeys, label) {
    const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
    if (unknown.length) throw new Error(`${label}에 알 수 없는 항목이 있습니다: ${unknown.join(", ")}`);
  }

  function cleanRequiredText(value, label, maximum) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error(`${label}을(를) 입력해 주세요.`);
    if (Array.from(text).length > maximum) throw new Error(`${label}은(는) ${maximum}자 이하여야 합니다.`);
    return text;
  }

  function normalizeUid(value, label, allowEmpty = false) {
    if (typeof value !== "string") throw new Error(`${label} 값이 올바르지 않습니다.`);
    const uid = value.trim();
    if (!uid && allowEmpty) return "";
    if (!uid || uid.length > 128) throw new Error(`${label} 값이 올바르지 않습니다.`);
    return uid;
  }

  function normalizeInteger(value, label, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(`${label} 값이 올바르지 않습니다.`);
    }
    return number;
  }

  function normalizeBoolean(value, label) {
    if (value !== true && value !== false) throw new Error(`${label} 값이 올바르지 않습니다.`);
    return value;
  }

  function normalizeSeat(value) {
    const seat = String(value ?? "").trim().toUpperCase();
    if (!SEATS.includes(seat)) throw new Error("공대 자리 값이 올바르지 않습니다.");
    return seat;
  }

  function normalizeGearSlot(value) {
    const gearSlot = String(value ?? "").trim();
    if (!GEAR_SLOTS.includes(gearSlot)) throw new Error("장비 부위 값이 올바르지 않습니다.");
    return gearSlot;
  }

  function normalizeGearStatus(value, allowUnset = false) {
    if (allowUnset && (value === null || value === undefined || value === "" || value === "unset" || value === "X")) {
      return null;
    }
    const status = String(value ?? "").trim().toLowerCase();
    if (!GEAR_STATUSES.includes(status)) throw new Error("장비 상태 값이 올바르지 않습니다.");
    return status;
  }

  function emptyGear() {
    return Object.fromEntries(GEAR_SLOTS.map((gearSlot) => [gearSlot, null]));
  }

  function decodeGear(value, options = {}) {
    const encoded = String(value ?? "").trim().toUpperCase();
    if (!GEAR_CODE_PATTERN.test(encoded)) throw new Error("장비 상태 저장 데이터가 올바르지 않습니다.");
    const allowUnset = options.allowUnset !== false;
    const gear = {};
    GEAR_SLOTS.forEach((gearSlot, index) => {
      const status = CODE_TO_STATUS[encoded[index]];
      if (status === null && !allowUnset) throw new Error("제출한 장비표에는 미입력 부위가 없어야 합니다.");
      gear[gearSlot] = status;
    });
    return gear;
  }

  function normalizeGearMap(value, options = {}) {
    const allowUnset = options.allowUnset === true;
    if (typeof value === "string") return decodeGear(value, { allowUnset });
    assertPlainObject(value, "장비 상태");
    rejectUnknownKeys(value, GEAR_SLOTS, "장비 상태");
    const gear = {};
    GEAR_SLOTS.forEach((gearSlot) => {
      if (!own(value, gearSlot) && !allowUnset) throw new Error(`${GEAR_LABELS[gearSlot]} 상태를 선택해 주세요.`);
      gear[gearSlot] = normalizeGearStatus(value[gearSlot], allowUnset);
    });
    return gear;
  }

  function encodeGear(value, options = {}) {
    const allowUnset = options.allowUnset !== false;
    const gear = normalizeGearMap(value, { allowUnset });
    return GEAR_SLOTS.map((gearSlot) => {
      const status = gear[gearSlot];
      if (status === null) return "X";
      return STATUS_TO_CODE[status];
    }).join("");
  }

  function normalizeRosterEntry(value) {
    assertPlainObject(value, "공대원");
    rejectUnknownKeys(value, ["seat", "nickname", "job"], "공대원");
    return {
      seat: normalizeSeat(value.seat),
      nickname: cleanRequiredText(value.nickname, "닉네임", MAX_NICKNAME_LENGTH),
      job: cleanRequiredText(value.job, "직업", MAX_JOB_LENGTH),
    };
  }

  function rosterValues(value) {
    if (Array.isArray(value)) return value;
    assertPlainObject(value, "공대 명단");
    return Object.entries(value).map(([seat, member]) => ({ ...assertPlainObject(member, "공대원"), seat: member.seat ?? seat }));
  }

  function normalizeRoster(value) {
    const roster = rosterValues(value).map(normalizeRosterEntry);
    if (roster.length !== SEATS.length) throw new Error("공대 명단은 MT부터 D4까지 정확히 8명이어야 합니다.");

    const seatSet = new Set(roster.map((member) => member.seat));
    if (seatSet.size !== SEATS.length || SEATS.some((seat) => !seatSet.has(seat))) {
      throw new Error("공대 명단에는 MT, ST, MH, SH, D1, D2, D3, D4가 한 번씩 있어야 합니다.");
    }
    const nicknameSet = new Set(roster.map((member) => member.nickname.toLocaleLowerCase("ko")));
    if (nicknameSet.size !== roster.length) throw new Error("공대원 닉네임은 서로 달라야 합니다.");
    return SEATS.map((seat) => roster.find((member) => member.seat === seat));
  }

  function normalizeRoomTitle(value) {
    return cleanRequiredText(value, "방 이름", MAX_TITLE_LENGTH);
  }

  function normalizeTier(value) {
    return cleanRequiredText(value, "레이드 시즌", MAX_TIER_LENGTH);
  }

  function normalizeWeek(value) {
    return normalizeInteger(value, "파밍 주차", 1, MAX_WEEK);
  }

  function normalizeRoomDraft(value) {
    assertPlainObject(value, "BiS 방 설정");
    rejectUnknownKeys(value, ["title", "tier", "week", "roster"], "BiS 방 설정");
    return {
      version: ROOM_VERSION,
      title: normalizeRoomTitle(value.title),
      tier: normalizeTier(value.tier),
      week: normalizeWeek(value.week),
      roster: normalizeRoster(value.roster),
    };
  }

  function normalizeMemberDraft(value, seatValue) {
    assertPlainObject(value, "공대원");
    rejectUnknownKeys(value, ["seat", "nickname", "job", "gear", "submitted", "updatedAt"], "공대원");
    const seat = normalizeSeat(seatValue ?? value.seat);
    const submitted = value.submitted === undefined ? false : normalizeBoolean(value.submitted, "제출 상태");
    const gearSource = value.gear === undefined ? emptyGear() : value.gear;
    const gear = encodeGear(gearSource, { allowUnset: !submitted });
    if (submitted && gear.includes("X")) throw new Error("제출한 장비표에는 미입력 부위가 없어야 합니다.");
    return {
      seat,
      nickname: cleanRequiredText(value.nickname, "닉네임", MAX_NICKNAME_LENGTH),
      job: cleanRequiredText(value.job, "직업", MAX_JOB_LENGTH),
      gear,
      submitted,
    };
  }

  function normalizeMemberUpdate(value) {
    assertPlainObject(value, "장비표 수정");
    rejectUnknownKeys(value, ["gear", "submitted"], "장비표 수정");
    const submitted = normalizeBoolean(value.submitted, "제출 상태");
    const gear = encodeGear(value.gear, { allowUnset: !submitted });
    if (submitted && gear.includes("X")) throw new Error("모든 장비 부위를 입력한 뒤 제출해 주세요.");
    return { gear, submitted };
  }

  function normalizeMemberSnapshot(value, seatValue) {
    assertPlainObject(value, "공대원 저장 데이터");
    rejectUnknownKeys(value, [
      "seat", "nickname", "job", "editorUid", "gear", "submitted", "createdAt", "updatedAt",
    ], "공대원 저장 데이터");
    const documentSeat = normalizeSeat(seatValue ?? value.seat);
    if (value.seat !== undefined && normalizeSeat(value.seat) !== documentSeat) {
      throw new Error("공대원 문서의 자리와 저장된 자리가 일치하지 않습니다.");
    }
    const member = normalizeMemberDraft({
      seat: documentSeat,
      nickname: value.nickname,
      job: value.job,
      gear: value.gear,
      submitted: value.submitted,
    });
    return {
      ...member,
      editorUid: normalizeUid(value.editorUid ?? "", "편집자 정보", true),
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizeMembers(value) {
    let source;
    if (Array.isArray(value)) source = value;
    else {
      assertPlainObject(value, "공대원 장비표");
      source = Object.entries(value).map(([seat, member]) => ({ ...assertPlainObject(member, "공대원 저장 데이터"), seat: member.seat ?? seat }));
    }
    if (source.length !== SEATS.length) throw new Error("8명의 장비표가 모두 필요합니다.");
    const members = source.map((member) => normalizeMemberSnapshot(member, member.seat));
    const seats = new Set(members.map((member) => member.seat));
    if (seats.size !== SEATS.length || SEATS.some((seat) => !seats.has(seat))) {
      throw new Error("MT부터 D4까지 각 자리의 장비표가 한 개씩 있어야 합니다.");
    }
    const nicknames = new Set(members.map((member) => member.nickname.toLocaleLowerCase("ko")));
    if (nicknames.size !== members.length) throw new Error("공대원 닉네임은 서로 달라야 합니다.");
    return SEATS.map((seat) => members.find((member) => member.seat === seat));
  }

  function validateRoomId(value) {
    const roomId = String(value ?? "").trim();
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("BiS 방 주소가 올바르지 않습니다.");
    return roomId;
  }

  function bytesToBase64Url(bytes) {
    let base64;
    if (typeof btoa === "function") {
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      base64 = btoa(binary);
    } else if (typeof Buffer !== "undefined") {
      base64 = Buffer.from(bytes).toString("base64");
    } else {
      throw new Error("안전한 BiS 방 주소를 만들 수 없는 브라우저입니다.");
    }
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function createRoomId(cryptoObject = root.crypto) {
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("안전한 BiS 방 주소를 만들 수 없는 브라우저입니다.");
    }
    const bytes = new Uint8Array(ROOM_ID_BYTES);
    cryptoObject.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  function makeRoomUrl(baseUrl, roomId) {
    const url = new URL(baseUrl);
    url.search = "";
    url.hash = "";
    url.searchParams.set("r", validateRoomId(roomId));
    return url.toString();
  }

  function normalizeDropType(value) {
    const dropType = String(value ?? "").trim();
    if (!DROP_TYPES.includes(dropType)) throw new Error("드랍 아이템 종류가 올바르지 않습니다.");
    return dropType;
  }

  function normalizeDropCounts(value, options = {}) {
    const source = value ?? {};
    assertPlainObject(source, "드랍 수량");
    rejectUnknownKeys(source, DROP_TYPES, "드랍 수량");
    const requireAll = options.requireAll === true;
    const counts = {};
    DROP_TYPES.forEach((dropType) => {
      if (requireAll && !own(source, dropType)) throw new Error(`${DROP_SPECS[dropType].label} 수량이 없습니다.`);
      counts[dropType] = normalizeInteger(source[dropType] ?? 0, `${DROP_SPECS[dropType].label} 수량`, 0, MAX_DROP_COUNT);
    });
    return counts;
  }

  function dropMatchesGearSlot(dropTypeValue, gearSlotValue) {
    const dropType = normalizeDropType(dropTypeValue);
    const gearSlot = normalizeGearSlot(gearSlotValue);
    return DROP_SPECS[dropType].gearSlots.includes(gearSlot);
  }

  function normalizeAssignment(value) {
    assertPlainObject(value, "분배 항목");
    rejectUnknownKeys(value, ["dropType", "seat", "gearSlot"], "분배 항목");
    const assignment = {
      dropType: normalizeDropType(value.dropType),
      seat: normalizeSeat(value.seat),
      gearSlot: normalizeGearSlot(value.gearSlot),
    };
    if (!dropMatchesGearSlot(assignment.dropType, assignment.gearSlot)) {
      throw new Error(`${DROP_SPECS[assignment.dropType].label}은(는) ${GEAR_LABELS[assignment.gearSlot]}에 분배할 수 없습니다.`);
    }
    return assignment;
  }

  function emptyAssignmentMap() {
    return Object.fromEntries(DROP_TYPES.map((dropType) => [dropType, ""]));
  }

  function encodeAssignmentMap(value) {
    if (!Array.isArray(value)) throw new TypeError("분배 항목 목록이 필요합니다.");
    const map = Object.fromEntries(DROP_TYPES.map((dropType) => [dropType, []]));
    const usedNeeds = new Set();
    value.forEach((item) => {
      const assignment = normalizeAssignment(item);
      const needKey = `${assignment.seat}@${assignment.gearSlot}`;
      if (usedNeeds.has(needKey)) throw new Error("같은 공대원의 같은 장비 부위에 두 번 분배할 수 없습니다.");
      usedNeeds.add(needKey);
      map[assignment.dropType].push(`${assignment.seat}@${assignment.gearSlot}`);
    });
    return Object.fromEntries(DROP_TYPES.map((dropType) => [dropType, map[dropType].join(",")]));
  }

  function decodeAssignmentMap(value) {
    assertPlainObject(value, "분배 저장 데이터");
    rejectUnknownKeys(value, DROP_TYPES, "분배 저장 데이터");
    const assignments = [];
    const usedNeeds = new Set();
    DROP_TYPES.forEach((dropType) => {
      if (!own(value, dropType) || typeof value[dropType] !== "string") {
        throw new Error(`${DROP_SPECS[dropType].label} 분배 데이터가 올바르지 않습니다.`);
      }
      const encoded = value[dropType];
      if (!encoded) return;
      if (encoded !== encoded.trim() || encoded.includes(" ")) throw new Error("분배 저장 데이터에 공백을 넣을 수 없습니다.");
      encoded.split(",").forEach((token) => {
        const match = /^(MT|ST|MH|SH|D1|D2|D3|D4)@([a-z0-9]+)$/.exec(token);
        if (!match) throw new Error("분배 저장 데이터 형식이 올바르지 않습니다.");
        const assignment = normalizeAssignment({ dropType, seat: match[1], gearSlot: match[2] });
        const needKey = `${assignment.seat}@${assignment.gearSlot}`;
        if (usedNeeds.has(needKey)) throw new Error("같은 공대원의 같은 장비 부위에 두 번 분배할 수 없습니다.");
        usedNeeds.add(needKey);
        assignments.push(assignment);
      });
    });
    return assignments;
  }

  function memberGear(member) {
    return decodeGear(member.gear, { allowUnset: !member.submitted });
  }

  function assignmentMatchesNeed(assignment, members) {
    const member = members.find((candidate) => candidate.seat === assignment.seat);
    if (!member || !member.submitted) return false;
    const gear = memberGear(member);
    const spec = DROP_SPECS[assignment.dropType];
    return spec.gearSlots.includes(assignment.gearSlot) && gear[assignment.gearSlot] === spec.status;
  }

  function normalizeUnassignedDrop(value) {
    const dropType = typeof value === "string" ? value : value?.dropType;
    return { dropType: normalizeDropType(dropType) };
  }

  function validateAllocationPlan(value, membersValue, dropCountsValue) {
    assertPlainObject(value, "분배 계획");
    rejectUnknownKeys(value, ["assignments", "unassignedDrops"], "분배 계획");
    if (!Array.isArray(value.assignments) || !Array.isArray(value.unassignedDrops)) {
      throw new TypeError("분배 및 미분배 항목 목록이 필요합니다.");
    }
    const members = normalizeMembers(membersValue);
    const dropCounts = normalizeDropCounts(dropCountsValue);
    const assignments = value.assignments.map(normalizeAssignment);
    const unassignedDrops = value.unassignedDrops.map(normalizeUnassignedDrop);
    const usedNeeds = new Set();
    assignments.forEach((assignment) => {
      const needKey = `${assignment.seat}@${assignment.gearSlot}`;
      if (usedNeeds.has(needKey)) throw new Error("같은 공대원의 같은 장비 부위에 두 번 분배할 수 없습니다.");
      usedNeeds.add(needKey);
      if (!assignmentMatchesNeed(assignment, members)) {
        throw new Error(`${assignment.seat}의 ${GEAR_LABELS[assignment.gearSlot]} 상태와 드랍 아이템이 맞지 않습니다.`);
      }
    });
    DROP_TYPES.forEach((dropType) => {
      const allocated = assignments.filter((item) => item.dropType === dropType).length;
      const unassigned = unassignedDrops.filter((item) => item.dropType === dropType).length;
      if (allocated + unassigned !== dropCounts[dropType]) {
        throw new Error(`${DROP_SPECS[dropType].label}의 분배 수량 합계가 드랍 수량과 다릅니다.`);
      }
    });
    return { assignments, unassignedDrops };
  }

  function normalizeDistribution(value, membersValue) {
    assertPlainObject(value, "파밍 분배표");
    rejectUnknownKeys(value, ["week", "dropCounts", "drops", "assignments"], "파밍 분배표");
    const week = normalizeWeek(value.week);
    const dropCounts = normalizeDropCounts(value.dropCounts ?? value.drops, { requireAll: true });
    let assignments;
    if (Array.isArray(value.assignments)) assignments = value.assignments.map(normalizeAssignment);
    else assignments = decodeAssignmentMap(value.assignments);
    const assignmentMap = encodeAssignmentMap(assignments);
    DROP_TYPES.forEach((dropType) => {
      const count = assignments.filter((assignment) => assignment.dropType === dropType).length;
      if (count > dropCounts[dropType]) throw new Error(`${DROP_SPECS[dropType].label} 분배 수가 드랍 수량보다 많습니다.`);
    });
    if (membersValue !== undefined) {
      const members = normalizeMembers(membersValue);
      assignments.forEach((assignment) => {
        if (!assignmentMatchesNeed(assignment, members)) {
          throw new Error(`${assignment.seat}의 ${GEAR_LABELS[assignment.gearSlot]} 상태와 드랍 아이템이 맞지 않습니다.`);
        }
      });
    }
    return { week, dropCounts, assignments: assignmentMap };
  }

  function distributionPlan(value, membersValue) {
    const distribution = normalizeDistribution(value, membersValue);
    const assignments = decodeAssignmentMap(distribution.assignments);
    const unassignedDrops = [];
    DROP_TYPES.forEach((dropType) => {
      const assignedCount = assignments.filter((assignment) => assignment.dropType === dropType).length;
      for (let index = assignedCount; index < distribution.dropCounts[dropType]; index += 1) {
        unassignedDrops.push({ dropType });
      }
    });
    return { assignments, unassignedDrops };
  }

  function emptyDistribution(week) {
    return {
      week: normalizeWeek(week),
      dropCounts: normalizeDropCounts({}, { requireAll: false }),
      assignments: emptyAssignmentMap(),
    };
  }

  function autoAllocateDrops(first, second, third = {}) {
    let membersValue;
    let dropCountsValue;
    let options;
    if (Array.isArray(first)) {
      membersValue = first;
      dropCountsValue = second;
      options = third || {};
    } else {
      assertPlainObject(first, "자동 분배 설정");
      membersValue = first.members;
      dropCountsValue = first.dropCounts ?? first.drops;
      options = first;
    }
    const members = normalizeMembers(membersValue);
    const dropCounts = normalizeDropCounts(dropCountsValue);
    const existingSource = options.existingAssignments ?? options.assignments ?? [];
    if (!Array.isArray(existingSource)) throw new TypeError("기존 분배 목록이 올바르지 않습니다.");
    const assignments = existingSource.map(normalizeAssignment);
    const usedNeeds = new Set();
    const assignmentCounts = Object.fromEntries(SEATS.map((seat) => [seat, 0]));
    assignments.forEach((assignment) => {
      const needKey = `${assignment.seat}@${assignment.gearSlot}`;
      if (usedNeeds.has(needKey)) throw new Error("같은 공대원의 같은 장비 부위에 두 번 분배할 수 없습니다.");
      if (!assignmentMatchesNeed(assignment, members)) throw new Error("기존 분배가 현재 장비 필요 상태와 맞지 않습니다.");
      usedNeeds.add(needKey);
      assignmentCounts[assignment.seat] += 1;
    });
    DROP_TYPES.forEach((dropType) => {
      const count = assignments.filter((assignment) => assignment.dropType === dropType).length;
      if (count > dropCounts[dropType]) throw new Error(`${DROP_SPECS[dropType].label} 기존 분배가 드랍 수량보다 많습니다.`);
    });

    const completedCounts = Object.fromEntries(members.map((member) => {
      const gear = memberGear(member);
      return [member.seat, GEAR_SLOTS.filter((gearSlot) => gear[gearSlot] === "complete").length];
    }));
    const seatRanks = Object.fromEntries(SEATS.map((seat, index) => [seat, index]));
    const gearRanks = Object.fromEntries(GEAR_SLOTS.map((gearSlot, index) => [gearSlot, index]));
    const unassignedDrops = [];

    DROP_TYPES.forEach((dropType) => {
      const alreadyAssigned = assignments.filter((assignment) => assignment.dropType === dropType).length;
      for (let itemIndex = alreadyAssigned; itemIndex < dropCounts[dropType]; itemIndex += 1) {
        const spec = DROP_SPECS[dropType];
        const candidates = [];
        members.forEach((member) => {
          if (!member.submitted) return;
          const gear = memberGear(member);
          spec.gearSlots.forEach((gearSlot) => {
            if (gear[gearSlot] !== spec.status || usedNeeds.has(`${member.seat}@${gearSlot}`)) return;
            candidates.push({ seat: member.seat, gearSlot });
          });
        });
        candidates.sort((left, right) => (
          assignmentCounts[left.seat] - assignmentCounts[right.seat]
          || completedCounts[left.seat] - completedCounts[right.seat]
          || seatRanks[left.seat] - seatRanks[right.seat]
          || gearRanks[left.gearSlot] - gearRanks[right.gearSlot]
        ));
        const selected = candidates[0];
        if (!selected) {
          unassignedDrops.push({ dropType });
          continue;
        }
        const assignment = { dropType, seat: selected.seat, gearSlot: selected.gearSlot };
        assignments.push(assignment);
        usedNeeds.add(`${selected.seat}@${selected.gearSlot}`);
        assignmentCounts[selected.seat] += 1;
      }
    });
    const plan = validateAllocationPlan({ assignments, unassignedDrops }, members, dropCounts);
    const week = normalizeWeek(options.week ?? 1);
    return {
      ...plan,
      dropCounts,
      distribution: normalizeDistribution({ week, dropCounts, assignments: plan.assignments }, members),
    };
  }

  function normalizeRoomSnapshot(value, roomId = "") {
    assertPlainObject(value, "BiS 방 저장 데이터");
    rejectUnknownKeys(value, [
      "version", "title", "tier", "week", "ownerUid", "locked", "distribution", "createdAt", "updatedAt",
    ], "BiS 방 저장 데이터");
    if (value.version !== ROOM_VERSION) throw new Error("지원하지 않는 BiS 방 데이터입니다.");
    const week = normalizeWeek(value.week);
    const distribution = normalizeDistribution(value.distribution);
    if (distribution.week !== week) throw new Error("방의 파밍 주차와 분배표 주차가 일치하지 않습니다.");
    return {
      version: ROOM_VERSION,
      id: roomId ? validateRoomId(roomId) : "",
      title: normalizeRoomTitle(value.title),
      tier: normalizeTier(value.tier),
      week,
      ownerUid: normalizeUid(value.ownerUid, "방장 정보"),
      locked: normalizeBoolean(value.locked, "방 잠금 상태"),
      distribution,
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizeRoomMetadataUpdate(value) {
    assertPlainObject(value, "방 설정 수정");
    const allowed = ["title", "tier", "week", "locked"];
    rejectUnknownKeys(value, allowed, "방 설정 수정");
    const keys = Object.keys(value);
    if (!keys.length) throw new Error("수정할 방 설정이 없습니다.");
    const update = {};
    if (own(value, "title")) update.title = normalizeRoomTitle(value.title);
    if (own(value, "tier")) update.tier = normalizeTier(value.tier);
    if (own(value, "week")) update.week = normalizeWeek(value.week);
    if (own(value, "locked")) update.locked = normalizeBoolean(value.locked, "방 잠금 상태");
    return update;
  }

  function firebaseConfigReady(config) {
    if (!config || typeof config !== "object") return false;
    return ["apiKey", "authDomain", "projectId", "appId"].every((key) => {
      const value = String(config[key] ?? "").trim();
      return value && !/REPLACE|YOUR_|여기에/i.test(value);
    });
  }

  const api = {
    ROOM_VERSION,
    ROOM_ID_PATTERN,
    MAX_TITLE_LENGTH,
    MAX_TIER_LENGTH,
    MAX_NICKNAME_LENGTH,
    MAX_JOB_LENGTH,
    MAX_WEEK,
    MAX_DROP_COUNT,
    SEATS,
    SEAT_LABELS,
    GEAR_SLOTS,
    GEAR_LABELS,
    GEAR_STATUSES,
    STATUS_LABELS,
    GEAR_CODE_PATTERN,
    DROP_TYPES,
    DROP_SPECS,
    normalizeSeat,
    normalizeGearSlot,
    normalizeGearStatus,
    emptyGear,
    encodeGear,
    decodeGear,
    normalizeGearMap,
    normalizeRosterEntry,
    normalizeRoster,
    normalizeRoomTitle,
    normalizeTier,
    normalizeWeek,
    normalizeRoomDraft,
    normalizeMemberDraft,
    normalizeMemberUpdate,
    normalizeMemberSnapshot,
    normalizeMembers,
    validateRoomId,
    createRoomId,
    makeRoomUrl,
    normalizeDropType,
    normalizeDropCounts,
    dropMatchesGearSlot,
    normalizeAssignment,
    emptyAssignmentMap,
    encodeAssignmentMap,
    decodeAssignmentMap,
    validateAllocationPlan,
    normalizeDistribution,
    distributionPlan,
    emptyDistribution,
    autoAllocateDrops,
    normalizeRoomSnapshot,
    normalizeRoomMetadataUpdate,
    firebaseConfigReady,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BisTrackerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
