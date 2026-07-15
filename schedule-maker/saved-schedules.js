(function (root) {
  "use strict";

  const STORAGE_VERSION = 1;
  const STORAGE_KEY = "eonjepyo-saved-schedules-v1";
  const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
  const ACTION_KEY = "eonjepyo-saved-action-v1";
  const DRAFT_KEY = "eonjepyo-draft";
  const MAX_SAVED_SCHEDULES = 200;

  let cachedScheduleApi = null;

  function scheduleApi() {
    if (root.Eonjepyo) return root.Eonjepyo;
    if (cachedScheduleApi) return cachedScheduleApi;
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      // CommonJS tests load this file on its own. In the browser app.js is loaded
      // immediately after this file, so the global API is available before use.
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
    const error = new Error("저장한 일정 목록이 손상되었습니다. 원본을 복구용으로 보관했으며 초기화하기 전까지 저장하지 않습니다.");
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
      // The original primary value is intentionally left untouched as a second recovery source.
    }
    return corruptStorageError();
  }

  function clearRecoveryDocument(storage) {
    try {
      assertStorage(storage).removeItem?.(RECOVERY_KEY);
    } catch (_error) {
      // A valid repaired document can still be used when recovery cleanup is unavailable.
    }
  }

  function resetCorruptDocument(storage) {
    const target = assertStorage(storage);
    target.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, items: [] }));
    clearRecoveryDocument(target);
    return { version: STORAGE_VERSION, items: [] };
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

  function cloneRecord(record) {
    return record ? { ...record } : null;
  }

  function canonicalSchedule(value) {
    const api = scheduleApi();
    let schedule = value;

    if (typeof schedule === "string") schedule = api.parseShareInput(schedule);
    if (!schedule || typeof schedule !== "object") {
      throw new TypeError("저장할 일정 데이터가 필요합니다.");
    }

    if (!(schedule.slots instanceof Uint8Array)) {
      if (typeof schedule.slots === "string") {
        schedule = { ...schedule, slots: api.decodeSlots(schedule.slots) };
      } else if (typeof schedule.canonicalHash === "string") {
        schedule = api.parseShareHash(schedule.canonicalHash);
      } else {
        throw new TypeError("저장할 일정의 선택 데이터가 올바르지 않습니다.");
      }
    }

    const title = String(schedule.title ?? api.DEFAULT_TITLE).trim().slice(0, 60) || api.DEFAULT_TITLE;
    const timezone = String(schedule.timezone ?? "Asia/Seoul").trim().slice(0, 40) || "Asia/Seoul";
    const startHour = api.normalizeStartHour(schedule.startHour, 0);
    const startDay = api.normalizeStartDay(schedule.startDay, 0);
    const slots = api.encodeSlots(schedule.slots);
    const canonicalHash = api.makeShareHash(schedule.slots, {
      title,
      timezone,
      startHour,
      startDay,
    });

    return { title, timezone, startHour, startDay, slots, canonicalHash };
  }

  function normalizeRecord(value) {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id ?? "").trim();
    if (!id) return null;

    try {
      const normalized = canonicalSchedule(value);
      const createdAt = timestamp(value.createdAt);
      const updatedAt = timestamp(value.updatedAt);
      return {
        id,
        ...normalized,
        createdAt,
        updatedAt: Math.max(createdAt, updatedAt),
        source: String(value.source ?? "manual").trim().slice(0, 30) || "manual",
      };
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
      parsed = JSON.parse(raw);
    } catch (_error) {
      throw quarantineDocument(target, raw);
    }
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.items)) {
      throw quarantineDocument(target, raw);
    }

    const byId = new Map();
    for (const item of parsed.items) {
      const normalized = normalizeRecord(item);
      if (!normalized) throw quarantineDocument(target, raw);
      const previous = byId.get(normalized.id);
      if (!previous || normalized.updatedAt >= previous.updatedAt) byId.set(normalized.id, normalized);
    }

    const seenHashes = new Set();
    const items = Array.from(byId.values())
      .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)
      .filter((item) => {
        if (seenHashes.has(item.canonicalHash)) return false;
        seenHashes.add(item.canonicalHash);
        return true;
      })
      .slice(0, MAX_SAVED_SCHEDULES);
    clearRecoveryDocument(target);
    return { version: STORAGE_VERSION, items };
  }

  function writeDocument(storage, items) {
    assertStorage(storage).setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      items: items.slice(0, MAX_SAVED_SCHEDULES),
    }));
  }

  function list(storage) {
    return readDocument(storage).items.map(cloneRecord);
  }

  function get(storage, id) {
    const target = String(id ?? "");
    return cloneRecord(readDocument(storage).items.find((item) => item.id === target) || null);
  }

  function uniqueId(items, requestedId, now) {
    if (requestedId !== undefined && requestedId !== null) {
      const id = String(requestedId).trim();
      if (!id) throw new Error("저장 일정 ID가 비어 있습니다.");
      return id;
    }
    const used = new Set(items.map((item) => item.id));
    let candidate;
    do {
      const randomPart = root.crypto?.randomUUID
        ? root.crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : Math.random().toString(36).slice(2, 14);
      candidate = `schedule-${now.toString(36)}-${randomPart}`;
    } while (used.has(candidate));
    return candidate;
  }

  function saveSchedule(storage, schedule, options = {}) {
    const document = readDocument(storage);
    const normalized = canonicalSchedule(schedule);
    const now = timestamp(options.now);
    const requestedId = options.id === undefined ? null : String(options.id);
    const exactMatch = document.items.find((item) => item.canonicalHash === normalized.canonicalHash);
    const idMatch = requestedId === null
      ? null
      : document.items.find((item) => item.id === requestedId);
    const previous = idMatch || exactMatch || null;
    const id = previous?.id || uniqueId(document.items, options.id, now);
    const record = {
      id,
      ...normalized,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      source: String(options.source ?? previous?.source ?? "manual").trim().slice(0, 30) || "manual",
    };

    const items = document.items.filter((item) => item.id !== id && item.canonicalHash !== record.canonicalHash);
    items.unshift(record);
    items.sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
    writeDocument(storage, items);
    return cloneRecord(record);
  }

  function updateTitle(storage, id, title, options = {}) {
    const cleanedTitle = String(title ?? "").trim().slice(0, 60);
    if (!cleanedTitle) throw new Error("일정 이름을 입력해 주세요.");
    const previous = get(storage, id);
    if (!previous) throw new Error("저장된 일정을 찾지 못했습니다.");
    return saveSchedule(storage, { ...previous, title: cleanedTitle }, {
      id: previous.id,
      source: previous.source,
      now: options.now,
    });
  }

  function remove(storage, id) {
    const document = readDocument(storage);
    const target = String(id ?? "");
    const items = document.items.filter((item) => item.id !== target);
    if (items.length === document.items.length) return false;
    writeDocument(storage, items);
    return true;
  }

  function setDraftFromSaved(storage, id) {
    const record = get(storage, id);
    if (!record) throw new Error("저장된 일정을 찾지 못했습니다.");
    assertStorage(storage).setItem(DRAFT_KEY, record.canonicalHash);
    return cloneRecord(record);
  }

  function normalizeIds(ids) {
    if (!Array.isArray(ids)) throw new TypeError("일정 ID 목록은 배열이어야 합니다.");
    return Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  }

  function queueSavedScheduleAction(storage, action, options = {}) {
    if (!action || !["load", "compare"].includes(action.type)) {
      throw new Error("지원하지 않는 저장 일정 동작입니다.");
    }
    const ids = normalizeIds(action.ids);
    if (!ids.length) throw new Error("선택한 일정이 없습니다.");
    if (action.type === "load" && ids.length !== 1) {
      throw new Error("불러올 일정은 하나만 선택해 주세요.");
    }

    const recordsById = new Map(list(storage).map((record) => [record.id, record]));
    const records = ids.map((id) => recordsById.get(id));
    if (records.some((record) => !record)) throw new Error("저장된 일정 일부를 찾지 못했습니다.");
    const queued = {
      version: STORAGE_VERSION,
      type: action.type,
      ids,
      hashes: records.map((record) => record.canonicalHash),
      createdAt: timestamp(options.now),
    };
    const actionStorage = options.actionStorage || options.queueStorage || storage;
    assertStorage(actionStorage).setItem(ACTION_KEY, JSON.stringify(queued));
    return { ...queued, ids: [...queued.ids], hashes: [...queued.hashes] };
  }

  function consumeSavedScheduleAction(storage) {
    assertStorage(storage);
    const raw = storage.getItem(ACTION_KEY);
    if (typeof storage.removeItem === "function") storage.removeItem(ACTION_KEY);
    else storage.setItem(ACTION_KEY, "");
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        parsed.version !== STORAGE_VERSION ||
        !["load", "compare"].includes(parsed.type) ||
        !Array.isArray(parsed.ids) ||
        !Array.isArray(parsed.hashes) ||
        parsed.ids.length !== parsed.hashes.length ||
        !parsed.ids.length
      ) return null;
      parsed.hashes.forEach((hash) => canonicalSchedule(hash));
      return {
        version: STORAGE_VERSION,
        type: parsed.type,
        ids: normalizeIds(parsed.ids),
        hashes: [...parsed.hashes],
        createdAt: timestamp(parsed.createdAt),
      };
    } catch (_error) {
      return null;
    }
  }

  function queueForComparison(storage, ids, options = {}) {
    return queueSavedScheduleAction(storage, { type: "compare", ids }, options);
  }

  function consumeComparisonQueue(storage) {
    const action = consumeSavedScheduleAction(storage);
    return action?.type === "compare" ? action : null;
  }

  const api = {
    STORAGE_VERSION,
    STORAGE_KEY,
    RECOVERY_KEY,
    ACTION_KEY,
    DRAFT_KEY,
    MAX_SAVED_SCHEDULES,
    list,
    readSavedSchedules: list,
    get,
    getSavedSchedule: get,
    saveSchedule,
    upsertSavedSchedule: saveSchedule,
    updateTitle,
    remove,
    deleteSavedSchedule: remove,
    setDraftFromSaved,
    queueForComparison,
    consumeComparisonQueue,
    queueSavedScheduleAction,
    consumeSavedScheduleAction,
    canonicalSchedule,
    getRecoveryDocument,
    resetCorruptDocument,
    corruptStorageError,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EonjepyoSaved = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
