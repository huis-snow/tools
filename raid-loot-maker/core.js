(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const FARMING_WEEKS = 8;
  const FLOOR_COUNT = 4;
  const ROOM_ID_BYTES = 16;
  const EVENT_ID_BYTES = 16;
  const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const START_DATE_PATTERN = /^[1-9]\d{3}-\d{2}-\d{2}$/;
  const MAX_TITLE_LENGTH = 60;
  const MAX_TIER_LENGTH = 60;
  const MAX_NICKNAME_LENGTH = 30;
  const MAX_JOB_LENGTH = 30;
  const MAX_NOTE_LENGTH = 200;
  const MAX_LOOT_EVENTS = 480;

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
    upgrade: "보강템 필요",
    raid: "영식템 필요",
  });
  const STATUS_TO_CODE = Object.freeze({ complete: "C", upgrade: "U", raid: "R" });
  const CODE_TO_STATUS = Object.freeze({ C: "complete", U: "upgrade", R: "raid", X: null });
  const GEAR_CODE_PATTERN = /^[XCUR]{11}$/;

  const ARMOR_SLOTS = Object.freeze(["head", "body", "hands", "legs", "feet"]);
  const ACCESSORY_SLOTS = Object.freeze(["earrings", "necklace", "bracelets", "ring1", "ring2"]);
  const DROP_TYPES = Object.freeze([
    "raid_earrings",
    "raid_necklace",
    "raid_bracelets",
    "raid_ring",
    "raid_head",
    "raid_hands",
    "raid_feet",
    "upgrade_accessory",
    "tome_weapon_token",
    "raid_body",
    "raid_legs",
    "upgrade_armor",
    "upgrade_weapon",
    "raid_weapon",
    "direct_weapon",
    "music",
    "mount",
  ]);

  function freezeSpec(spec) {
    return Object.freeze({ ...spec, gearSlots: Object.freeze([...(spec.gearSlots || [])]) });
  }

  const DROP_SPECS = Object.freeze({
    raid_earrings: freezeSpec({
      label: "영식 귀걸이 상자", floor: 1, category: "raidGear", needStatus: "raid", gearSlots: ["earrings"], consumesNeed: true,
    }),
    raid_necklace: freezeSpec({
      label: "영식 목걸이 상자", floor: 1, category: "raidGear", needStatus: "raid", gearSlots: ["necklace"], consumesNeed: true,
    }),
    raid_bracelets: freezeSpec({
      label: "영식 팔찌 상자", floor: 1, category: "raidGear", needStatus: "raid", gearSlots: ["bracelets"], consumesNeed: true,
    }),
    raid_ring: freezeSpec({
      label: "영식 반지 상자", floor: 1, category: "raidGear", needStatus: "raid", gearSlots: ["ring1", "ring2"], consumesNeed: true,
    }),
    raid_head: freezeSpec({
      label: "영식 머리 상자", floor: 2, category: "raidGear", needStatus: "raid", gearSlots: ["head"], consumesNeed: true,
    }),
    raid_hands: freezeSpec({
      label: "영식 장갑 상자", floor: 2, category: "raidGear", needStatus: "raid", gearSlots: ["hands"], consumesNeed: true,
    }),
    raid_feet: freezeSpec({
      label: "영식 신발 상자", floor: 2, category: "raidGear", needStatus: "raid", gearSlots: ["feet"], consumesNeed: true,
    }),
    upgrade_accessory: freezeSpec({
      label: "장신구 보강재", floor: 2, category: "upgrade", needStatus: "upgrade", gearSlots: ACCESSORY_SLOTS, consumesNeed: true,
    }),
    tome_weapon_token: freezeSpec({
      label: "석판 무기 교환 토큰", floor: 2, category: "token", needStatus: null, gearSlots: [], consumesNeed: false,
    }),
    raid_body: freezeSpec({
      label: "영식 몸통 상자", floor: 3, category: "raidGear", needStatus: "raid", gearSlots: ["body"], consumesNeed: true,
    }),
    raid_legs: freezeSpec({
      label: "영식 바지 상자", floor: 3, category: "raidGear", needStatus: "raid", gearSlots: ["legs"], consumesNeed: true,
    }),
    upgrade_armor: freezeSpec({
      label: "방어구 보강재", floor: 3, category: "upgrade", needStatus: "upgrade", gearSlots: ARMOR_SLOTS, consumesNeed: true,
    }),
    upgrade_weapon: freezeSpec({
      label: "무기 보강재", floor: 3, category: "upgrade", needStatus: "upgrade", gearSlots: ["weapon"], consumesNeed: true,
    }),
    raid_weapon: freezeSpec({
      label: "영식 무기 상자", floor: 4, category: "raidGear", needStatus: "raid", gearSlots: ["weapon"], consumesNeed: true,
    }),
    direct_weapon: freezeSpec({
      label: "직접 드랍 무기", floor: 4, category: "directWeapon", needStatus: "raid", gearSlots: ["weapon"], consumesNeed: true, requiresJob: true,
    }),
    music: freezeSpec({
      label: "오케스트리온 악보", floor: 4, category: "cosmetic", needStatus: null, gearSlots: [], consumesNeed: false,
    }),
    mount: freezeSpec({
      label: "탈것", floor: 4, category: "cosmetic", needStatus: null, gearSlots: [], consumesNeed: false,
    }),
  });

  const FLOOR_DROP_TYPES = Object.freeze(Object.fromEntries(
    Array.from({ length: FLOOR_COUNT }, (_unused, index) => index + 1).map((floor) => [
      floor,
      Object.freeze(DROP_TYPES.filter((dropType) => DROP_SPECS[dropType].floor === floor)),
    ]),
  ));
  const DROP_CATEGORIES = Object.freeze(["raidGear", "upgrade", "directWeapon", "token", "cosmetic"]);
  const EVENT_ACTIONS = Object.freeze(["award", "skip", "undo"]);
  const SKIP_REASONS = Object.freeze(["unclaimed", "external", "deferred"]);
  const LOOT_SOURCES = Object.freeze(["raid", "book", "external", "other"]);
  const AWARD_DECISIONS = Object.freeze(["recommended", "manual", "free"]);
  const POLICY_PRESETS = Object.freeze(["manual", "fair", "progression", "custom"]);
  const PROGRESSION_SEAT_ORDER = Object.freeze(["D4", "D3", "D1", "D2", "MT", "ST", "MH", "SH"]);

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

  function cleanOptionalText(value, label, maximum) {
    const text = String(value ?? "").trim();
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

  function normalizeSeatOrder(value, label = "자리 우선순위") {
    if (!Array.isArray(value) || value.length !== SEATS.length) {
      throw new Error(`${label}에는 MT부터 D4까지 정확히 8자리가 필요합니다.`);
    }
    const order = value.map(normalizeSeat);
    if (new Set(order).size !== SEATS.length || SEATS.some((seat) => !order.includes(seat))) {
      throw new Error(`${label}에는 각 자리가 한 번씩 있어야 합니다.`);
    }
    return order;
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
      return status === null ? "X" : STATUS_TO_CODE[status];
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
    return Object.entries(value).map(([seat, member]) => ({
      ...assertPlainObject(member, "공대원"),
      seat: member.seat ?? seat,
    }));
  }

  function normalizeRoster(value) {
    const roster = rosterValues(value).map(normalizeRosterEntry);
    if (roster.length !== SEATS.length) throw new Error("공대 명단은 MT부터 D4까지 정확히 8명이어야 합니다.");
    const seats = new Set(roster.map((member) => member.seat));
    if (seats.size !== SEATS.length || SEATS.some((seat) => !seats.has(seat))) {
      throw new Error("공대 명단에는 MT, ST, MH, SH, D1, D2, D3, D4가 한 번씩 있어야 합니다.");
    }
    const nicknames = new Set(roster.map((member) => member.nickname.toLocaleLowerCase("ko")));
    if (nicknames.size !== roster.length) throw new Error("공대원 닉네임은 서로 달라야 합니다.");
    return SEATS.map((seat) => roster.find((member) => member.seat === seat));
  }

  function normalizeRoomTitle(value) {
    return cleanRequiredText(value, "방 이름", MAX_TITLE_LENGTH);
  }

  function normalizeTier(value) {
    return cleanRequiredText(value, "레이드 시즌", MAX_TIER_LENGTH);
  }

  function normalizeWeek(value) {
    return normalizeInteger(value, "파밍 주차", 1, FARMING_WEEKS);
  }

  function normalizeFloor(value) {
    return normalizeInteger(value, "영식 층", 1, FLOOR_COUNT);
  }

  function normalizeStartDate(value) {
    const startDate = String(value ?? "").trim();
    if (!START_DATE_PATTERN.test(startDate)) throw new Error("1주차 시작일 형식이 올바르지 않습니다.");
    const parsed = new Date(`${startDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== startDate) {
      throw new Error("1주차 시작일이 올바른 날짜가 아닙니다.");
    }
    return startDate;
  }

  function normalizePolicy(value = "fair") {
    const source = typeof value === "string" ? { preset: value } : assertPlainObject(value, "분배 정책");
    rejectUnknownKeys(source, ["preset", "seatOrder"], "분배 정책");
    const preset = String(source.preset ?? "").trim().toLowerCase();
    if (!POLICY_PRESETS.includes(preset)) throw new Error("분배 정책 값이 올바르지 않습니다.");
    let defaultOrder = SEATS;
    if (preset === "progression") defaultOrder = PROGRESSION_SEAT_ORDER;
    if (preset === "custom" && !own(source, "seatOrder")) {
      throw new Error("직접 설정 정책에는 8자리 우선순위가 필요합니다.");
    }
    const seatOrder = own(source, "seatOrder")
      ? normalizeSeatOrder(source.seatOrder)
      : [...defaultOrder];
    return { preset, seatOrder };
  }

  function normalizeRoomDraft(value) {
    assertPlainObject(value, "공대 파밍방 설정");
    rejectUnknownKeys(value, ["title", "tier", "startDate", "currentWeek", "policy", "roster"], "공대 파밍방 설정");
    return {
      version: ROOM_VERSION,
      title: normalizeRoomTitle(value.title),
      tier: normalizeTier(value.tier),
      startDate: normalizeStartDate(value.startDate),
      currentWeek: normalizeWeek(value.currentWeek),
      policy: normalizePolicy(value.policy ?? "fair"),
      roster: normalizeRoster(value.roster),
    };
  }

  function normalizeMemberDraft(value, seatValue) {
    assertPlainObject(value, "공대원");
    rejectUnknownKeys(value, ["seat", "nickname", "job", "gear", "submitted", "updatedAt"], "공대원");
    const seat = normalizeSeat(seatValue ?? value.seat);
    const submitted = value.submitted === undefined ? false : normalizeBoolean(value.submitted, "제출 상태");
    const gear = encodeGear(value.gear === undefined ? emptyGear() : value.gear, { allowUnset: !submitted });
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
      source = Object.entries(value).map(([seat, member]) => ({
        ...assertPlainObject(member, "공대원 저장 데이터"),
        seat: member.seat ?? seat,
      }));
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

  function bytesToBase64Url(bytes) {
    let base64;
    if (typeof btoa === "function") {
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      base64 = btoa(binary);
    } else if (typeof Buffer !== "undefined") {
      base64 = Buffer.from(bytes).toString("base64");
    } else {
      throw new Error("안전한 공유 주소를 만들 수 없는 브라우저입니다.");
    }
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function createRandomId(byteLength, cryptoObject, label) {
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error(`안전한 ${label}을(를) 만들 수 없는 브라우저입니다.`);
    }
    const bytes = new Uint8Array(byteLength);
    cryptoObject.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  function validateRoomId(value) {
    const roomId = String(value ?? "").trim();
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("공대 파밍방 주소가 올바르지 않습니다.");
    return roomId;
  }

  function validateEventId(value) {
    const eventId = String(value ?? "").trim();
    if (!EVENT_ID_PATTERN.test(eventId)) throw new Error("드랍 기록 ID가 올바르지 않습니다.");
    return eventId;
  }

  function createRoomId(cryptoObject = root.crypto) {
    return createRandomId(ROOM_ID_BYTES, cryptoObject, "공대 파밍방 주소");
  }

  function createEventId(cryptoObject = root.crypto) {
    return createRandomId(EVENT_ID_BYTES, cryptoObject, "드랍 기록 ID");
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

  function floorDropTypes(floorValue) {
    return [...FLOOR_DROP_TYPES[normalizeFloor(floorValue)]];
  }

  function normalizeDrop(value) {
    const source = typeof value === "string" ? { dropType: value } : assertPlainObject(value, "드랍 아이템");
    rejectUnknownKeys(source, ["dropType", "floor", "job"], "드랍 아이템");
    const dropType = normalizeDropType(source.dropType);
    const spec = DROP_SPECS[dropType];
    const floor = normalizeFloor(source.floor ?? spec.floor);
    if (floor !== spec.floor) throw new Error(`${spec.label}은(는) ${spec.floor}층 드랍입니다.`);
    const job = cleanOptionalText(source.job, "직접 드랍 직업", MAX_JOB_LENGTH);
    if (spec.requiresJob && !job) throw new Error("직접 드랍 무기의 직업을 입력해 주세요.");
    if (!spec.requiresJob && job) throw new Error(`${spec.label}에는 직접 드랍 직업을 지정할 수 없습니다.`);
    return { floor, dropType, job };
  }

  function normalizeSource(value) {
    const source = String(value ?? "raid").trim().toLowerCase();
    if (!LOOT_SOURCES.includes(source)) throw new Error("획득 경로 값이 올바르지 않습니다.");
    return source;
  }

  function normalizeAwardDecision(value) {
    const decision = String(value ?? "").trim().toLowerCase();
    if (!AWARD_DECISIONS.includes(decision)) throw new Error("분배 결정 방식이 올바르지 않습니다.");
    return decision;
  }

  function normalizeSkipReason(value) {
    const reason = String(value ?? "unclaimed").trim().toLowerCase();
    if (!SKIP_REASONS.includes(reason)) throw new Error("미배정 사유 값이 올바르지 않습니다.");
    return reason;
  }

  function normalizeLootEventDraft(value) {
    assertPlainObject(value, "드랍 기록");
    const action = String(value.action ?? "").trim().toLowerCase();
    if (!EVENT_ACTIONS.includes(action)) throw new Error("드랍 기록 동작이 올바르지 않습니다.");

    if (action === "undo") {
      rejectUnknownKeys(value, ["action", "targetEventId", "note"], "되돌리기 기록");
      return {
        action,
        targetEventId: validateEventId(value.targetEventId),
        note: cleanOptionalText(value.note, "메모", MAX_NOTE_LENGTH),
      };
    }

    const drop = normalizeDrop({ dropType: value.dropType, floor: value.floor, job: value.job });
    if (action === "skip") {
      rejectUnknownKeys(value, ["action", "week", "floor", "dropType", "job", "reason", "note"], "미배정 기록");
      return {
        action,
        week: normalizeWeek(value.week),
        ...drop,
        reason: normalizeSkipReason(value.reason),
        note: cleanOptionalText(value.note, "메모", MAX_NOTE_LENGTH),
      };
    }

    rejectUnknownKeys(value, [
      "action", "week", "floor", "dropType", "seat", "gearSlot", "job", "source", "note",
      "decision", "countsForFairness",
    ], "분배 기록");
    const spec = DROP_SPECS[drop.dropType];
    const gearSlotText = String(value.gearSlot ?? "").trim();
    let gearSlot = "";
    if (spec.consumesNeed) {
      gearSlot = normalizeGearSlot(gearSlotText);
      if (!spec.gearSlots.includes(gearSlot)) {
        throw new Error(`${spec.label}은(는) ${GEAR_LABELS[gearSlot]} 부위에 분배할 수 없습니다.`);
      }
    } else if (gearSlotText) {
      throw new Error(`${spec.label}에는 장비 부위를 지정할 수 없습니다.`);
    }
    return {
      action,
      week: normalizeWeek(value.week),
      ...drop,
      seat: normalizeSeat(value.seat),
      gearSlot,
      source: normalizeSource(value.source),
      decision: normalizeAwardDecision(value.decision),
      countsForFairness: normalizeBoolean(value.countsForFairness, "공정 분배 집계 상태"),
      note: cleanOptionalText(value.note, "메모", MAX_NOTE_LENGTH),
    };
  }

  function normalizeLootEventSnapshot(value, eventIdValue) {
    assertPlainObject(value, "드랍 기록 저장 데이터");
    const eventId = validateEventId(eventIdValue ?? value.id);
    const withoutMetadata = { ...value };
    delete withoutMetadata.id;
    delete withoutMetadata.createdBy;
    delete withoutMetadata.createdAt;
    const draft = normalizeLootEventDraft(withoutMetadata);
    const allowed = [...Object.keys(draft), "id", "createdBy", "createdAt"];
    rejectUnknownKeys(value, allowed, "드랍 기록 저장 데이터");
    return {
      id: eventId,
      ...draft,
      createdBy: normalizeUid(value.createdBy, "기록 작성자"),
      createdAt: value.createdAt ?? null,
    };
  }

  function normalizeLootEvents(value) {
    if (!Array.isArray(value)) throw new TypeError("드랍 기록 목록이 필요합니다.");
    if (value.length > MAX_LOOT_EVENTS) throw new Error(`드랍 기록은 최대 ${MAX_LOOT_EVENTS}개까지 저장할 수 있습니다.`);
    const events = [];
    const byId = new Map();
    const undoneIds = new Set();
    const activeNeedEvents = new Map();
    value.forEach((item) => {
      const event = normalizeLootEventSnapshot(item, item?.id);
      if (byId.has(event.id)) throw new Error("같은 드랍 기록 ID를 두 번 저장할 수 없습니다.");
      if (event.action === "undo") {
        const target = byId.get(event.targetEventId);
        if (!target) throw new Error("되돌릴 드랍 기록이 앞선 이력에 없습니다.");
        if (target.action === "undo") throw new Error("되돌리기 기록은 다시 되돌릴 수 없습니다.");
        if (undoneIds.has(target.id)) throw new Error("이미 되돌린 드랍 기록입니다.");
        undoneIds.add(target.id);
        if (target.action === "award" && DROP_SPECS[target.dropType].consumesNeed) {
          activeNeedEvents.delete(`${target.seat}@${target.gearSlot}`);
        }
      } else if (event.action === "award" && DROP_SPECS[event.dropType].consumesNeed) {
        const needKey = `${event.seat}@${event.gearSlot}`;
        if (activeNeedEvents.has(needKey)) {
          throw new Error("같은 공대원의 같은 장비 부위에 활성 분배 기록을 두 번 저장할 수 없습니다.");
        }
        activeNeedEvents.set(needKey, event.id);
      }
      events.push(event);
      byId.set(event.id, event);
    });
    return events;
  }

  function activeLootEvents(value) {
    const events = normalizeLootEvents(value);
    const undoneIds = new Set(events.filter((event) => event.action === "undo").map((event) => event.targetEventId));
    return events.filter((event) => event.action !== "undo" && !undoneIds.has(event.id));
  }

  function appendLootEvent(eventsValue, eventValue) {
    const events = normalizeLootEvents(eventsValue);
    return normalizeLootEvents([...events, eventValue]);
  }

  function createUndoEvent(targetEventId, note = "") {
    return normalizeLootEventDraft({ action: "undo", targetEventId, note });
  }

  function memberGear(member) {
    return decodeGear(member.gear, { allowUnset: !member.submitted });
  }

  function activeConsumedNeeds(events) {
    const consumed = new Set();
    events.forEach((event) => {
      if (event.action !== "award") return;
      const spec = DROP_SPECS[event.dropType];
      if (spec.consumesNeed) consumed.add(`${event.seat}@${event.gearSlot}`);
    });
    return consumed;
  }

  function jobsMatch(left, right) {
    return String(left ?? "").trim() === String(right ?? "").trim();
  }

  function eligibleCandidates(dropValue, membersValue, eventsValue = []) {
    const drop = normalizeDrop(dropValue);
    const spec = DROP_SPECS[drop.dropType];
    const members = normalizeMembers(membersValue);
    const activeEvents = activeLootEvents(eventsValue);
    const consumed = activeConsumedNeeds(activeEvents);
    return members.flatMap((member) => {
      if (!member.submitted) return [];
      if (spec.requiresJob && !jobsMatch(member.job, drop.job)) return [];
      if (!spec.consumesNeed) {
        return [{
          seat: member.seat,
          nickname: member.nickname,
          job: member.job,
          gearSlots: [],
          suggestedGearSlot: "",
        }];
      }
      const gear = memberGear(member);
      const gearSlots = spec.gearSlots.filter((gearSlot) => (
        gear[gearSlot] === spec.needStatus && !consumed.has(`${member.seat}@${gearSlot}`)
      ));
      if (!gearSlots.length) return [];
      return [{
        seat: member.seat,
        nickname: member.nickname,
        job: member.job,
        gearSlots,
        suggestedGearSlot: gearSlots[0],
      }];
    });
  }

  function zeroCountMap(keys) {
    return Object.fromEntries(keys.map((key) => [key, 0]));
  }

  function cumulativeStatistics(membersValue, eventsValue = []) {
    const members = normalizeMembers(membersValue);
    const activeEvents = activeLootEvents(eventsValue);
    const consumed = activeConsumedNeeds(activeEvents);
    const statistics = members.map((member) => {
      const gear = memberGear(member);
      const remainingSlots = GEAR_SLOTS.filter((gearSlot) => (
        (gear[gearSlot] === "raid" || gear[gearSlot] === "upgrade")
        && !consumed.has(`${member.seat}@${gearSlot}`)
      ));
      return {
        seat: member.seat,
        nickname: member.nickname,
        job: member.job,
        totalAwards: 0,
        recordedAwards: 0,
        excludedAwards: 0,
        raidAwards: 0,
        gearAwards: 0,
        raidGearAwards: 0,
        auxiliaryAwards: 0,
        byWeek: zeroCountMap(Array.from({ length: FARMING_WEEKS }, (_item, index) => String(index + 1))),
        byFloor: zeroCountMap(Array.from({ length: FLOOR_COUNT }, (_item, index) => String(index + 1))),
        byDropType: zeroCountMap(DROP_TYPES),
        byCategory: zeroCountMap(DROP_CATEGORIES),
        bySource: zeroCountMap(LOOT_SOURCES),
        currentNeeds: GEAR_SLOTS.filter((gearSlot) => gear[gearSlot] === "raid" || gear[gearSlot] === "upgrade").length,
        currentRaidNeeds: GEAR_SLOTS.filter((gearSlot) => gear[gearSlot] === "raid").length,
        currentUpgradeNeeds: GEAR_SLOTS.filter((gearSlot) => gear[gearSlot] === "upgrade").length,
        satisfiedSlots: [],
        remainingSlots,
        remainingNeeds: remainingSlots.length,
      };
    });
    const bySeat = Object.fromEntries(statistics.map((item) => [item.seat, item]));
    activeEvents.forEach((event) => {
      if (event.action !== "award") return;
      const stat = bySeat[event.seat];
      if (!stat) return;
      const spec = DROP_SPECS[event.dropType];
      stat.recordedAwards += 1;
      if (spec.consumesNeed && !stat.satisfiedSlots.includes(event.gearSlot)) {
        stat.satisfiedSlots.push(event.gearSlot);
      }
      if (!event.countsForFairness) {
        stat.excludedAwards += 1;
        return;
      }
      stat.totalAwards += 1;
      if (event.source === "raid") stat.raidAwards += 1;
      if (spec.consumesNeed) {
        stat.gearAwards += 1;
        if (event.source === "raid") stat.raidGearAwards += 1;
      } else {
        stat.auxiliaryAwards += 1;
      }
      stat.byWeek[event.week] += 1;
      stat.byFloor[event.floor] += 1;
      stat.byDropType[event.dropType] += 1;
      stat.byCategory[spec.category] += 1;
      stat.bySource[event.source] += 1;
    });
    statistics.forEach((stat) => {
      stat.satisfiedSlots.sort((left, right) => GEAR_SLOTS.indexOf(left) - GEAR_SLOTS.indexOf(right));
    });
    return statistics;
  }

  function rankingValues(candidate, spec, drop, week, policy) {
    const stat = candidate.stats;
    const seatRank = policy.seatOrder.indexOf(candidate.seat);
    const mainCount = spec.consumesNeed ? stat.gearAwards : stat.auxiliaryAwards;
    const typeCount = stat.byDropType[drop.dropType];
    const weekCount = stat.byWeek[week];
    if (policy.preset === "manual") return [seatRank];
    if (policy.preset === "progression") {
      const roleGroup = candidate.seat.startsWith("D") ? 0 : candidate.seat.endsWith("T") ? 1 : 2;
      return [roleGroup, mainCount, typeCount, weekCount, seatRank];
    }
    if (policy.preset === "custom") {
      return [seatRank, mainCount, typeCount, weekCount];
    }
    return [mainCount, typeCount, weekCount, seatRank];
  }

  function compareNumberArrays(left, right) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left[index] ?? 0) - (right[index] ?? 0);
      if (difference) return difference;
    }
    return 0;
  }

  function candidateReasons(candidate, spec, drop, week, policy) {
    const stat = candidate.stats;
    const reasons = [];
    if (policy.preset === "manual") {
      reasons.push(`수동 선택 표시 순서 ${policy.seatOrder.indexOf(candidate.seat) + 1}번째`);
    } else if (policy.preset === "progression") {
      const roleGroupLabel = candidate.seat.startsWith("D") ? "DPS" : candidate.seat.endsWith("T") ? "탱커" : "힐러";
      reasons.push(`${roleGroupLabel} 우선 그룹`);
      reasons.push(`그룹 안 표시 순서 ${policy.seatOrder.indexOf(candidate.seat) + 1}번째`);
    } else if (policy.preset === "custom") {
      reasons.push(`사용자 우선순위 ${policy.seatOrder.indexOf(candidate.seat) + 1}번째`);
    }
    if (policy.preset !== "manual") {
      reasons.push(spec.consumesNeed
        ? `이번 시즌 공정 집계 장비 ${stat.gearAwards}개 수령`
        : `이번 시즌 보조 보상 ${stat.auxiliaryAwards}개 수령`);
      reasons.push(`${DROP_SPECS[drop.dropType].label} ${stat.byDropType[drop.dropType]}회 수령`);
      reasons.push(`${week}주차 전체 보상 ${stat.byWeek[week]}개 수령`);
    }
    if (spec.consumesNeed) {
      reasons.push(`남은 필요 부위 ${stat.remainingNeeds}개`);
      reasons.push(`적용 가능: ${candidate.gearSlots.map((gearSlot) => GEAR_LABELS[gearSlot]).join(", ")}`);
    } else {
      reasons.push("장비 진행도와 무관한 보조 보상");
    }
    return reasons;
  }

  function rankCandidates(value) {
    const options = assertPlainObject(value, "후보 순위 설정");
    rejectUnknownKeys(options, ["drop", "week", "members", "events", "policy"], "후보 순위 설정");
    const drop = normalizeDrop(options.drop);
    const week = normalizeWeek(options.week);
    const policy = normalizePolicy(options.policy ?? "fair");
    const members = normalizeMembers(options.members);
    const events = normalizeLootEvents(options.events ?? []);
    const statistics = cumulativeStatistics(members, events);
    const statsBySeat = Object.fromEntries(statistics.map((stat) => [stat.seat, stat]));
    const spec = DROP_SPECS[drop.dropType];
    const candidates = eligibleCandidates(drop, members, events).map((candidate) => {
      const withStats = { ...candidate, stats: statsBySeat[candidate.seat] };
      const sortKey = rankingValues(withStats, spec, drop, week, policy);
      return {
        ...withStats,
        reasons: candidateReasons(withStats, spec, drop, week, policy),
        sortKey,
      };
    });
    candidates.sort((left, right) => compareNumberArrays(left.sortKey, right.sortKey));
    return candidates.map((candidate, index) => ({ rank: index + 1, ...candidate }));
  }

  function createAwardEvent(value, membersValue, eventsValue = []) {
    assertPlainObject(value, "한 개 분배");
    const draft = normalizeLootEventDraft({ ...value, action: "award" });
    const candidates = eligibleCandidates({
      floor: draft.floor,
      dropType: draft.dropType,
      job: draft.job,
    }, membersValue, eventsValue);
    const candidate = candidates.find((item) => item.seat === draft.seat);
    if (!candidate) throw new Error("이 공대원은 현재 드랍의 분배 대상이 아닙니다.");
    if (draft.gearSlot && !candidate.gearSlots.includes(draft.gearSlot)) {
      throw new Error("선택한 장비 부위에는 현재 드랍을 적용할 수 없습니다.");
    }
    return draft;
  }

  function createSkipEvent(value) {
    assertPlainObject(value, "미배정 드랍");
    return normalizeLootEventDraft({ ...value, action: "skip" });
  }

  function suggestAssignment(value) {
    const options = assertPlainObject(value, "자동 추천 설정");
    rejectUnknownKeys(options, ["drop", "week", "members", "events", "policy", "source", "note"], "자동 추천 설정");
    const drop = normalizeDrop(options.drop);
    const week = normalizeWeek(options.week);
    const members = normalizeMembers(options.members);
    const events = normalizeLootEvents(options.events ?? []);
    const candidates = rankCandidates({
      drop,
      week,
      members,
      events,
      policy: options.policy ?? "fair",
    });
    if (!candidates.length) return null;
    const candidate = candidates[0];
    const event = createAwardEvent({
      week,
      ...drop,
      seat: candidate.seat,
      gearSlot: candidate.suggestedGearSlot,
      source: options.source ?? "raid",
      decision: "recommended",
      countsForFairness: true,
      note: options.note ?? "",
    }, members, events);
    return { event, candidate, candidates };
  }

  function normalizeRoomSnapshot(value, roomId = "") {
    assertPlainObject(value, "공대 파밍방 저장 데이터");
    rejectUnknownKeys(value, [
      "version", "title", "tier", "currentWeek", "ownerUid", "locked", "policy", "createdAt", "updatedAt",
      "startDate",
    ], "공대 파밍방 저장 데이터");
    if (value.version !== ROOM_VERSION) throw new Error("지원하지 않는 공대 파밍방 데이터입니다.");
    return {
      version: ROOM_VERSION,
      id: roomId ? validateRoomId(roomId) : "",
      title: normalizeRoomTitle(value.title),
      tier: normalizeTier(value.tier),
      startDate: normalizeStartDate(value.startDate),
      currentWeek: normalizeWeek(value.currentWeek),
      ownerUid: normalizeUid(value.ownerUid, "방장 정보"),
      locked: normalizeBoolean(value.locked, "방 잠금 상태"),
      policy: normalizePolicy(value.policy),
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function normalizeRoomMetadataUpdate(value) {
    assertPlainObject(value, "방 설정 수정");
    const allowed = ["title", "tier", "startDate", "currentWeek", "locked", "policy"];
    rejectUnknownKeys(value, allowed, "방 설정 수정");
    if (!Object.keys(value).length) throw new Error("수정할 방 설정이 없습니다.");
    const update = {};
    if (own(value, "title")) update.title = normalizeRoomTitle(value.title);
    if (own(value, "tier")) update.tier = normalizeTier(value.tier);
    if (own(value, "startDate")) update.startDate = normalizeStartDate(value.startDate);
    if (own(value, "currentWeek")) update.currentWeek = normalizeWeek(value.currentWeek);
    if (own(value, "locked")) update.locked = normalizeBoolean(value.locked, "방 잠금 상태");
    if (own(value, "policy")) update.policy = normalizePolicy(value.policy);
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
    FARMING_WEEKS,
    FLOOR_COUNT,
    ROOM_ID_PATTERN,
    EVENT_ID_PATTERN,
    START_DATE_PATTERN,
    MAX_TITLE_LENGTH,
    MAX_TIER_LENGTH,
    MAX_NICKNAME_LENGTH,
    MAX_JOB_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_LOOT_EVENTS,
    SEATS,
    SEAT_LABELS,
    GEAR_SLOTS,
    GEAR_LABELS,
    GEAR_STATUSES,
    STATUS_LABELS,
    GEAR_CODE_PATTERN,
    DROP_TYPES,
    DROP_SPECS,
    FLOOR_DROP_TYPES,
    DROP_CATEGORIES,
    EVENT_ACTIONS,
    SKIP_REASONS,
    LOOT_SOURCES,
    AWARD_DECISIONS,
    POLICY_PRESETS,
    PROGRESSION_SEAT_ORDER,
    normalizeSeat,
    normalizeSeatOrder,
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
    normalizeFloor,
    normalizeStartDate,
    normalizePolicy,
    normalizeRoomDraft,
    normalizeMemberDraft,
    normalizeMemberUpdate,
    normalizeMemberSnapshot,
    normalizeMembers,
    validateRoomId,
    validateEventId,
    createRoomId,
    createEventId,
    makeRoomUrl,
    normalizeDropType,
    floorDropTypes,
    normalizeDrop,
    normalizeSource,
    normalizeAwardDecision,
    normalizeSkipReason,
    normalizeLootEventDraft,
    normalizeLootEventSnapshot,
    normalizeLootEvents,
    activeLootEvents,
    appendLootEvent,
    createUndoEvent,
    eligibleCandidates,
    cumulativeStatistics,
    rankCandidates,
    createAwardEvent,
    createSkipEvent,
    suggestAssignment,
    normalizeRoomSnapshot,
    normalizeRoomMetadataUpdate,
    firebaseConfigReady,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RaidLootCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
