(function (root) {
  "use strict";

  const STORAGE_VERSION = 1;
  const STORAGE_KEY = "eonjepyo-saved-comparisons-v1";
  const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
  const SHARE_VERSION = 1;
  const SHARE_PARAMETER = "g";
  const DEFAULT_NAME = "저장한 취합 일정";
  const DEFAULT_START_HOUR = 8;
  const DEFAULT_START_DAY = 0;
  const MAX_SAVED_COMPARISONS = 100;
  const MAX_MEMBERS = 200;
  const MAX_NAME_LENGTH = 60;
  const MAX_TITLE_LENGTH = 60;
  const MAX_TIMEZONE_LENGTH = 40;
  const MAX_STORAGE_LENGTH = 2_000_000;
  const MAX_SHARE_LENGTH = 100_000;

  let cachedScheduleApi = null;

  function scheduleApi() {
    if (root.Eonjepyo) return root.Eonjepyo;
    if (cachedScheduleApi) return cachedScheduleApi;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      cachedScheduleApi = require("./app.js");
      return cachedScheduleApi;
    }
    throw new Error("언제표 일정 API를 불러오지 못했습니다.");
  }

  function assertStorage(storage) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new TypeError("localStorage와 호환되는 저장소가 필요합니다.");
    }
    return storage;
  }

  function corruptStorageError() {
    const error = new Error("저장한 취합 일정 목록이 손상되었습니다. 원본을 복구용으로 보관했으며 초기화하기 전까지 저장하지 않습니다.");
    error.code = "CORRUPT_STORAGE";
    return error;
  }

  function getRecoveryDocument(storage) {
    return assertStorage(storage).getItem(RECOVERY_KEY);
  }

  function quarantineDocument(storage, raw) {
    const target = assertStorage(storage);
    try {
      if (target.getItem(RECOVERY_KEY) === null) target.setItem(RECOVERY_KEY, String(raw));
    } catch (_error) {
      // Keep the primary value untouched when a separate recovery copy cannot be written.
    }
    return corruptStorageError();
  }

  function clearRecoveryDocument(storage) {
    try {
      assertStorage(storage).removeItem?.(RECOVERY_KEY);
    } catch (_error) {
      // A valid repaired document remains usable even if stale recovery cleanup fails.
    }
  }

  function resetCorruptDocument(storage) {
    const target = assertStorage(storage);
    target.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, items: [] }));
    clearRecoveryDocument(target);
    return { version: STORAGE_VERSION, items: [] };
  }

  function unicodeSlice(value, maximum) {
    return Array.from(String(value ?? "")).slice(0, maximum).join("");
  }

  function cleanText(value, fallback, maximum) {
    const cleaned = unicodeSlice(value, maximum).trim();
    return cleaned || fallback;
  }

  function timestamp(value) {
    const candidate = typeof value === "function" ? value() : value;
    if (candidate instanceof Date) return candidate.getTime();
    if (candidate !== undefined) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    }
    return Date.now();
  }

  function persistedTimestamp(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : null;
  }

  function cloneMember(member) {
    return member ? { ...member } : null;
  }

  function cloneRecord(record) {
    return record ? { ...record, members: record.members.map(cloneMember) } : null;
  }

  function strictText(value, label, maximum) {
    if (typeof value !== "string") throw new Error(`${label}의 형식이 올바르지 않습니다.`);
    const cleaned = value.trim();
    if (!cleaned || Array.from(cleaned).length > maximum) {
      throw new Error(`${label}의 길이가 올바르지 않습니다.`);
    }
    return cleaned;
  }

  function normalizeMember(value, options = {}) {
    const api = scheduleApi();
    let member = value;
    if (typeof member === "string") member = api.parseShareInput(member);
    if (!member || typeof member !== "object" || Array.isArray(member)) {
      throw new TypeError("취합할 일정 데이터가 필요합니다.");
    }

    let slots;
    if (member.slots instanceof Uint8Array) {
      slots = api.encodeSlots(member.slots);
    } else if (typeof member.slots === "string") {
      api.decodeSlots(member.slots);
      slots = member.slots;
    } else if (typeof member.canonicalHash === "string") {
      const parsed = api.parseShareHash(member.canonicalHash);
      if (!parsed) throw new Error("취합할 일정의 선택 데이터가 없습니다.");
      member = { ...parsed, ...member, slots: parsed.slots };
      slots = api.encodeSlots(parsed.slots);
    } else {
      throw new Error("취합할 일정의 선택 데이터가 올바르지 않습니다.");
    }

    const strict = options.strict === true;
    const title = strict
      ? strictText(member.title, "일정 이름", MAX_TITLE_LENGTH)
      : cleanText(member.title, api.DEFAULT_TITLE || "우리의 가능한 시간", MAX_TITLE_LENGTH);
    const timezone = strict
      ? strictText(member.timezone, "시간대", MAX_TIMEZONE_LENGTH)
      : cleanText(member.timezone, "Asia/Seoul", MAX_TIMEZONE_LENGTH);

    let startHour;
    let startDay;
    if (strict) {
      if (!Number.isInteger(member.startHour) || member.startHour < 0 || member.startHour >= 24) {
        throw new Error("하루 시작 시간이 올바르지 않습니다.");
      }
      if (!Number.isInteger(member.startDay) || member.startDay < 0 || member.startDay >= 7) {
        throw new Error("시작 요일이 올바르지 않습니다.");
      }
      startHour = member.startHour;
      startDay = member.startDay;
    } else {
      startHour = api.normalizeStartHour(member.startHour, 0);
      startDay = api.normalizeStartDay(member.startDay, 0);
    }

    return { title, timezone, startHour, startDay, slots };
  }

  function canonicalMemberKey(value) {
    const member = normalizeMember(value);
    return JSON.stringify([
      member.title,
      member.timezone,
      member.startHour,
      member.startDay,
      member.slots,
    ]);
  }

  function normalizeMembers(values, options = {}) {
    if (!Array.isArray(values)) throw new TypeError("취합 일정 구성원 목록은 배열이어야 합니다.");
    if (values.length > MAX_MEMBERS) throw new Error(`취합 일정은 최대 ${MAX_MEMBERS}명까지 저장할 수 있습니다.`);

    const members = [];
    const seen = new Set();
    values.forEach((value) => {
      const member = normalizeMember(value, options);
      const key = canonicalMemberKey(member);
      if (seen.has(key)) return;
      seen.add(key);
      members.push(member);
    });
    if (!members.length && options.allowEmpty !== true) {
      throw new Error("취합 일정에 한 명 이상의 일정이 필요합니다.");
    }
    return members;
  }

  function normalizeName(value, options = {}) {
    if (options.strict === true) return strictText(value, "취합 일정 이름", MAX_NAME_LENGTH);
    return cleanText(value, DEFAULT_NAME, MAX_NAME_LENGTH);
  }

  function normalizeGroupStartHour(value, options = {}) {
    if (options.strict === true) {
      if (!Number.isInteger(value) || value < 0 || value >= 24) {
        throw new Error("취합 결과의 하루 시작 시간이 올바르지 않습니다.");
      }
      return value;
    }
    return scheduleApi().normalizeStartHour(value, DEFAULT_START_HOUR);
  }

  function normalizeGroupStartDay(value, options = {}) {
    if (options.strict === true) {
      if (!Number.isInteger(value) || value < 0 || value >= 7) {
        throw new Error("취합 결과의 시작 요일이 올바르지 않습니다.");
      }
      return value;
    }
    return scheduleApi().normalizeStartDay(value, DEFAULT_START_DAY);
  }

  function canonicalPayload(value, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("취합 일정 데이터가 필요합니다.");
    }
    const name = normalizeName(value.name, options);
    const startHour = normalizeGroupStartHour(value.startHour, options);
    const startDay = normalizeGroupStartDay(value.startDay, options);
    const members = normalizeMembers(value.members, options);
    const sortedMembers = members
      .map((member) => [
        member.title,
        member.timezone,
        member.startHour,
        member.startDay,
        member.slots,
      ])
      .sort((left, right) => {
        const leftKey = JSON.stringify(left);
        const rightKey = JSON.stringify(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
    return [SHARE_VERSION, name, startHour, startDay, sortedMembers];
  }

  function textToBytes(value) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(value, "utf8"));
    const escaped = unescape(encodeURIComponent(value));
    return Uint8Array.from(escaped, (character) => character.charCodeAt(0));
  }

  function bytesToText(bytes) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (typeof Buffer !== "undefined") {
      const text = Buffer.from(bytes).toString("utf8");
      if (Buffer.from(text, "utf8").compare(Buffer.from(bytes)) !== 0) {
        throw new Error("공유 취합 일정의 문자 인코딩이 올바르지 않습니다.");
      }
      return text;
    }
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return decodeURIComponent(escape(binary));
  }

  function bytesToBase64(bytes) {
    if (typeof btoa === "function") {
      let binary = "";
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
  }

  function base64ToBytes(base64) {
    if (typeof atob === "function") {
      const binary = atob(base64);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  function encodeBase64Url(value) {
    return bytesToBase64(textToBytes(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function decodeBase64Url(value) {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > MAX_SHARE_LENGTH ||
      !/^[A-Za-z0-9_-]+$/.test(value) ||
      value.length % 4 === 1
    ) {
      throw new Error("공유 취합 일정 데이터의 형식이 올바르지 않습니다.");
    }
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    let bytes;
    try {
      bytes = base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
    } catch (_error) {
      throw new Error("공유 취합 일정 데이터를 읽지 못했습니다.");
    }
    try {
      return bytesToText(bytes);
    } catch (_error) {
      throw new Error("공유 취합 일정의 문자 인코딩이 올바르지 않습니다.");
    }
  }

  function canonicalGroupKey(value) {
    return encodeBase64Url(JSON.stringify(canonicalPayload(value)));
  }

  function makeShareHash(value) {
    return `#${SHARE_PARAMETER}=${canonicalGroupKey(value)}`;
  }

  function makeShareUrl(baseUrl, value) {
    const url = new URL(baseUrl);
    url.hash = makeShareHash(value).slice(1);
    return url.toString();
  }

  function memberFromTuple(value) {
    if (!Array.isArray(value) || value.length !== 5) {
      throw new Error("공유 취합 일정의 구성원 형식이 올바르지 않습니다.");
    }
    return normalizeMember({
      title: value[0],
      timezone: value[1],
      startHour: value[2],
      startDay: value[3],
      slots: value[4],
    }, { strict: true });
  }

  function parseShareHash(hash) {
    const source = String(hash ?? "");
    if (!source || source === "#") return null;
    const match = source.match(new RegExp(`^#${SHARE_PARAMETER}=([A-Za-z0-9_-]+)$`));
    if (!match) throw new Error("공유 취합 일정 링크의 형식이 올바르지 않습니다.");

    let payload;
    try {
      payload = JSON.parse(decodeBase64Url(match[1]));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("공유 취합 일정 데이터가 손상되었습니다.");
      throw error;
    }
    if (!Array.isArray(payload) || payload.length !== 5 || payload[0] !== SHARE_VERSION) {
      throw new Error("지원하지 않는 공유 취합 일정 버전입니다.");
    }
    if (!Array.isArray(payload[4]) || !payload[4].length || payload[4].length > MAX_MEMBERS) {
      throw new Error("공유 취합 일정의 구성원 수가 올바르지 않습니다.");
    }

    const name = normalizeName(payload[1], { strict: true });
    const startHour = normalizeGroupStartHour(payload[2], { strict: true });
    const startDay = normalizeGroupStartDay(payload[3], { strict: true });
    const members = normalizeMembers(payload[4].map(memberFromTuple), { strict: true });
    return { name, startHour, startDay, members };
  }

  function parseShareInput(input) {
    if (typeof input !== "string" || !input.trim()) {
      throw new Error("공유 취합 일정 링크를 입력해 주세요.");
    }
    let source = input.trim();
    if (source.startsWith("<") || source.endsWith(">")) {
      const discordLink = source.match(/^<([^<>\s]+)>$/);
      if (!discordLink) throw new Error("공유 취합 일정 링크의 형식이 올바르지 않습니다.");
      source = discordLink[1];
    }

    let hash;
    if (source.startsWith("#")) {
      hash = source;
    } else {
      try {
        hash = new URL(source).hash;
      } catch (_error) {
        throw new Error("공유 취합 일정 링크의 형식이 올바르지 않습니다.");
      }
    }
    const comparison = parseShareHash(hash);
    if (!comparison) throw new Error("공유 취합 일정 데이터가 없습니다.");
    return comparison;
  }

  function normalizeRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const id = String(value.id ?? "").trim();
    if (!id || id.length > 120) return null;
    try {
      const name = normalizeName(value.name, { strict: true });
      const startHour = normalizeGroupStartHour(value.startHour, { strict: true });
      const startDay = normalizeGroupStartDay(value.startDay, { strict: true });
      const members = normalizeMembers(value.members, { strict: true });
      const createdAt = persistedTimestamp(value.createdAt);
      const rawUpdatedAt = persistedTimestamp(value.updatedAt);
      if (createdAt === null || rawUpdatedAt === null) return null;
      const updatedAt = Math.max(createdAt, rawUpdatedAt);
      return { id, name, startHour, startDay, members, createdAt, updatedAt };
    } catch (_error) {
      return null;
    }
  }

  function readDocument(storage) {
    const target = assertStorage(storage);
    const raw = target.getItem(STORAGE_KEY);
    if (raw === null) {
      if (getRecoveryDocument(target) !== null) throw corruptStorageError();
      return { version: STORAGE_VERSION, items: [] };
    }
    let parsed;
    try {
      if (raw.length > MAX_STORAGE_LENGTH) throw new Error("too large");
      parsed = JSON.parse(raw);
    } catch (_error) {
      throw quarantineDocument(target, raw);
    }
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      throw quarantineDocument(target, raw);
    }

    const byId = new Map();
    if (parsed.items.length > MAX_SAVED_COMPARISONS * 2) throw quarantineDocument(target, raw);
    for (const value of parsed.items) {
      const record = normalizeRecord(value);
      if (!record) throw quarantineDocument(target, raw);
      const previous = byId.get(record.id);
      if (!previous || record.updatedAt >= previous.updatedAt) byId.set(record.id, record);
    }

    const seenGroups = new Set();
    const items = Array.from(byId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
      .filter((record) => {
        const key = canonicalGroupKey(record);
        if (seenGroups.has(key)) return false;
        seenGroups.add(key);
        return true;
      })
      .slice(0, MAX_SAVED_COMPARISONS);
    clearRecoveryDocument(target);
    return { version: STORAGE_VERSION, items };
  }

  function writeDocument(storage, items) {
    assertStorage(storage).setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      items: items.slice(0, MAX_SAVED_COMPARISONS),
    }));
  }

  function list(storage) {
    return readDocument(storage).items.map(cloneRecord);
  }

  function get(storage, id) {
    const target = String(id ?? "");
    return cloneRecord(readDocument(storage).items.find((record) => record.id === target) || null);
  }

  function uniqueId(items, requestedId, now, idFactory) {
    if (requestedId !== undefined && requestedId !== null) {
      const id = String(requestedId).trim();
      if (!id || id.length > 120) throw new Error("저장된 취합 일정 ID가 올바르지 않습니다.");
      return id;
    }
    const used = new Set(items.map((item) => item.id));
    let candidate;
    let attempts = 0;
    do {
      const generated = typeof idFactory === "function" ? idFactory({ now, attempt: attempts }) : null;
      const randomPart = generated ?? (root.crypto?.randomUUID
        ? root.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14));
      candidate = generated === null
        ? `comparison-${now.toString(36)}-${randomPart}`
        : String(generated).trim();
      if (!candidate || candidate.length > 120) throw new Error("생성된 취합 일정 ID가 올바르지 않습니다.");
      attempts += 1;
      if (attempts > 100) throw new Error("고유한 취합 일정 ID를 만들지 못했습니다.");
    } while (used.has(candidate));
    return candidate;
  }

  function saveComparison(storage, comparison, options = {}) {
    if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
      throw new TypeError("저장할 취합 일정 데이터가 필요합니다.");
    }
    const document = readDocument(storage);
    const name = normalizeName(comparison.name);
    const startHour = normalizeGroupStartHour(comparison.startHour);
    const startDay = normalizeGroupStartDay(comparison.startDay);
    const members = normalizeMembers(comparison.members);
    const now = timestamp(options.now);
    const requestedId = options.id !== undefined ? options.id : comparison.id;
    const idMatch = requestedId === undefined || requestedId === null
      ? null
      : document.items.find((record) => record.id === String(requestedId).trim());
    const canonicalKey = canonicalGroupKey({ name, startHour, startDay, members });
    const exactMatch = document.items.find((record) => canonicalGroupKey(record) === canonicalKey);
    const previous = idMatch || exactMatch || null;
    const id = previous?.id || uniqueId(document.items, requestedId, now, options.idFactory);
    const record = {
      id,
      name,
      startHour,
      startDay,
      members,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };

    const items = document.items.filter((item) => (
      item.id !== id && canonicalGroupKey(item) !== canonicalKey
    ));
    items.unshift(record);
    items.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
    writeDocument(storage, items);
    return cloneRecord(record);
  }

  function rename(storage, id, name, options = {}) {
    const cleanedName = cleanText(name, "", MAX_NAME_LENGTH);
    if (!cleanedName) throw new Error("취합 일정 이름을 입력해 주세요.");
    const previous = get(storage, id);
    if (!previous) throw new Error("저장된 취합 일정을 찾지 못했습니다.");
    return saveComparison(storage, { ...previous, name: cleanedName }, {
      id: previous.id,
      now: options.now,
    });
  }

  function remove(storage, id) {
    const document = readDocument(storage);
    const target = String(id ?? "");
    const items = document.items.filter((record) => record.id !== target);
    if (items.length === document.items.length) return false;
    writeDocument(storage, items);
    return true;
  }

  function addMembers(storage, id, members, options = {}) {
    const previous = get(storage, id);
    if (!previous) throw new Error("저장된 취합 일정을 찾지 못했습니다.");
    if (!Array.isArray(members) || !members.length) throw new Error("추가할 일정을 선택해 주세요.");
    const mergedMembers = normalizeMembers([...previous.members, ...members]);
    return saveComparison(storage, { ...previous, members: mergedMembers }, {
      id: previous.id,
      now: options.now,
    });
  }

  function saveSharedComparison(storage, input, options = {}) {
    return saveComparison(storage, parseShareInput(input), options);
  }

  const api = {
    STORAGE_VERSION,
    STORAGE_KEY,
    RECOVERY_KEY,
    SHARE_VERSION,
    SHARE_PARAMETER,
    DEFAULT_NAME,
    DEFAULT_START_HOUR,
    DEFAULT_START_DAY,
    MAX_SAVED_COMPARISONS,
    MAX_MEMBERS,
    list,
    readSavedComparisons: list,
    get,
    getSavedComparison: get,
    save: saveComparison,
    saveComparison,
    upsertComparison: saveComparison,
    rename,
    renameComparison: rename,
    remove,
    delete: remove,
    deleteComparison: remove,
    addMembers,
    addComparisonMembers: addMembers,
    saveSharedComparison,
    normalizeMember,
    normalizeMembers,
    normalizeRecord,
    normalizeGroupStartHour,
    normalizeGroupStartDay,
    canonicalMemberKey,
    canonicalGroupKey,
    makeShareHash,
    makeShareUrl,
    parseShareHash,
    parseShareInput,
    getRecoveryDocument,
    resetCorruptDocument,
    corruptStorageError,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EonjepyoComparisons = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
