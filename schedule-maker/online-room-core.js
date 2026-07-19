(function (root) {
  "use strict";

  const ROOM_VERSION = 1;
  const MAX_RESPONSES = 8;
  const ROOM_ID_BYTES = 16;
  const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const SLOT_PATTERN = /^[A-Za-z0-9_-]{28}$/;
  const MAX_TITLE_LENGTH = 60;
  const MAX_NICKNAME_LENGTH = 60;
  const MAX_TIMEZONE_LENGTH = 40;

  function cleanRequiredText(value, label, maximum) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error(`${label}을(를) 입력해 주세요.`);
    if (text.length > maximum) throw new Error(`${label}은(는) ${maximum}자 이하여야 합니다.`);
    return text;
  }

  function normalizeInteger(value, label, minimum, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
      throw new Error(`${label} 값이 올바르지 않습니다.`);
    }
    return number;
  }

  function normalizeTimezone(value) {
    const timezone = cleanRequiredText(value, "기준 시간대", MAX_TIMEZONE_LENGTH);
    if (!/^[-A-Za-z0-9_+./]{1,40}$/.test(timezone)) {
      throw new Error("기준 시간대 형식이 올바르지 않습니다.");
    }
    return timezone;
  }

  function validateRoomId(value) {
    const roomId = String(value ?? "").trim();
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("온라인 방 주소가 올바르지 않습니다.");
    return roomId;
  }

  function bytesToBase64Url(bytes) {
    let base64;
    if (typeof btoa === "function") {
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      base64 = btoa(binary);
    } else if (typeof Buffer !== "undefined") {
      base64 = Buffer.from(bytes).toString("base64");
    } else {
      throw new Error("안전한 온라인 방 주소를 만들 수 없는 브라우저입니다.");
    }
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function createRoomId(cryptoObject = root.crypto) {
    if (!cryptoObject || typeof cryptoObject.getRandomValues !== "function") {
      throw new Error("안전한 온라인 방 주소를 만들 수 없는 브라우저입니다.");
    }
    const bytes = new Uint8Array(ROOM_ID_BYTES);
    cryptoObject.getRandomValues(bytes);
    return bytesToBase64Url(bytes);
  }

  function normalizeRoomDraft(value) {
    if (!value || typeof value !== "object") throw new TypeError("온라인 방 설정이 필요합니다.");
    return {
      version: ROOM_VERSION,
      title: cleanRequiredText(value.title, "방 이름", MAX_TITLE_LENGTH),
      timezone: normalizeTimezone(value.timezone),
      startHour: normalizeInteger(value.startHour, "하루 시작", 0, 23),
      startDay: normalizeInteger(value.startDay, "시작 요일", 0, 6),
    };
  }

  function normalizeResponse(value) {
    if (!value || typeof value !== "object") throw new TypeError("저장할 일정이 필요합니다.");
    const slots = String(value.slots ?? "");
    if (!SLOT_PATTERN.test(slots)) throw new Error("선택한 시간 데이터가 올바르지 않습니다.");
    return {
      nickname: cleanRequiredText(value.nickname, "닉네임", MAX_NICKNAME_LENGTH),
      slots,
    };
  }

  function normalizeResponseMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries = Object.entries(value);
    if (entries.length > MAX_RESPONSES) throw new Error("온라인 방의 참여 인원 데이터가 올바르지 않습니다.");
    return entries.reduce((responses, [uid, response]) => {
      if (!uid || uid.length > 128) throw new Error("온라인 방의 참여자 정보가 올바르지 않습니다.");
      responses[uid] = {
        ...normalizeResponse(response),
        updatedAt: response.updatedAt ?? null,
      };
      return responses;
    }, {});
  }

  function normalizeRoomSnapshot(value, roomId = "") {
    if (!value || typeof value !== "object") throw new TypeError("온라인 방 데이터가 필요합니다.");
    if (value.version !== ROOM_VERSION) throw new Error("지원하지 않는 온라인 방 데이터입니다.");
    const draft = normalizeRoomDraft(value);
    const ownerUid = cleanRequiredText(value.ownerUid, "방장 정보", 128);
    return {
      ...draft,
      id: roomId ? validateRoomId(roomId) : "",
      ownerUid,
      locked: value.locked === true,
      responses: normalizeResponseMap(value.responses),
      createdAt: value.createdAt ?? null,
      updatedAt: value.updatedAt ?? null,
    };
  }

  function roomSchedules(room) {
    const normalized = normalizeRoomSnapshot(room, room.id || "");
    return Object.entries(normalized.responses).map(([uid, response]) => ({
      remoteId: uid,
      title: response.nickname,
      timezone: normalized.timezone,
      startHour: normalized.startHour,
      startDay: normalized.startDay,
      slots: response.slots,
      updatedAt: response.updatedAt,
    }));
  }

  function makeRoomUrl(baseUrl, roomId) {
    const url = new URL(baseUrl);
    url.search = "";
    url.hash = "";
    url.searchParams.set("r", validateRoomId(roomId));
    return url.toString();
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
    MAX_RESPONSES,
    ROOM_ID_PATTERN,
    SLOT_PATTERN,
    MAX_TITLE_LENGTH,
    MAX_NICKNAME_LENGTH,
    MAX_TIMEZONE_LENGTH,
    validateRoomId,
    createRoomId,
    normalizeRoomDraft,
    normalizeResponse,
    normalizeResponseMap,
    normalizeRoomSnapshot,
    roomSchedules,
    makeRoomUrl,
    firebaseConfigReady,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.EonjepyoOnlineCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
