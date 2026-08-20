(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AnonymousPollCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LEGACY_VERSION = 1;
  const VERSION = 2;
  const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const BALLOT_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;
  const MAX_AGENDA_LENGTH = 160;
  const MAX_DESCRIPTION_LENGTH = 500;
  const MAX_VOTES = 100;
  const DEFAULT_RESULT_VISIBILITY = "owner";
  const RESULT_VISIBILITIES = Object.freeze(["public", "voters", "owner"]);
  const RESULT_VISIBILITY_META = Object.freeze({
    public: Object.freeze({
      label: "전체 공개",
      description: "링크로 들어온 누구나 결과를 볼 수 있어요",
    }),
    voters: Object.freeze({
      label: "투표한 사람만 공개",
      description: "투표를 제출한 사람과 방장만 결과를 볼 수 있어요",
    }),
    owner: Object.freeze({
      label: "방장만 공개",
      description: "방장만 결과를 볼 수 있어요",
    }),
  });
  const CHOICES = Object.freeze(["agree", "reject", "neutral"]);
  const CHOICE_META = Object.freeze({
    agree: Object.freeze({ label: "동의", symbol: "○", description: "이 안건에 동의해요" }),
    reject: Object.freeze({ label: "거부", symbol: "×", description: "이 안건에 동의하지 않아요" }),
    neutral: Object.freeze({ label: "상관없음", symbol: "—", description: "어느 쪽으로 정해져도 괜찮아요" }),
  });

  function plainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function exactKeys(value, keys, label) {
    if (!plainObject(value)) throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new Error(`${label}에 알 수 없는 항목이 있습니다.`);
    }
  }

  function text(value, label, maxLength, allowEmpty = false) {
    if (typeof value !== "string") throw new TypeError(`${label}을(를) 입력해 주세요.`);
    const normalized = value.trim().replace(/\r\n?/g, "\n");
    if (!allowEmpty && !normalized) throw new Error(`${label}을(를) 입력해 주세요.`);
    if (normalized.length > maxLength) throw new Error(`${label}은(는) ${maxLength}자 이내로 입력해 주세요.`);
    return normalized;
  }

  function uid(value, label = "사용자 식별자") {
    if (typeof value !== "string" || !value || value.length > 128) {
      throw new Error(`${label} 형식이 올바르지 않습니다.`);
    }
    return value;
  }

  function timestamp(value, label) {
    const valid = value instanceof Date ||
      (plainObject(value) && (typeof value.toMillis === "function" || Number.isFinite(value.seconds)));
    if (!valid) throw new Error(`${label} 형식이 올바르지 않습니다.`);
    return value;
  }

  function normalizeChoice(value) {
    if (!CHOICES.includes(value)) throw new Error("동의, 거부, 상관없음 중 하나를 선택해 주세요.");
    return value;
  }

  function normalizeResultVisibility(value) {
    if (!RESULT_VISIBILITIES.includes(value)) {
      throw new Error("결과 공개 범위를 전체 공개, 투표한 사람만 공개, 방장만 공개 중에서 선택해 주세요.");
    }
    return value;
  }

  function normalizeCounts(value) {
    exactKeys(value, CHOICES, "투표 합계");
    const counts = {};
    CHOICES.forEach((choice) => {
      const count = value[choice];
      if (!Number.isInteger(count) || count < 0 || count > MAX_VOTES) {
        throw new Error("투표 합계가 올바르지 않습니다.");
      }
      counts[choice] = count;
    });
    return counts;
  }

  function emptyCounts() {
    return { agree: 0, reject: 0, neutral: 0 };
  }

  function totalVotes(counts) {
    const normalized = normalizeCounts(counts);
    const total = CHOICES.reduce((sum, choice) => sum + normalized[choice], 0);
    if (total > MAX_VOTES) throw new Error("이 투표방의 최대 참여 인원을 초과했습니다.");
    return total;
  }

  function normalizeRoomDraft(value) {
    if (!plainObject(value)) throw new TypeError("투표방 정보를 입력해 주세요.");
    return {
      version: VERSION,
      agenda: text(value.agenda, "안건", MAX_AGENDA_LENGTH),
      description: text(value.description || "", "설명", MAX_DESCRIPTION_LENGTH, true),
      resultVisibility: normalizeResultVisibility(
        value.resultVisibility === undefined ? DEFAULT_RESULT_VISIBILITY : value.resultVisibility,
      ),
    };
  }

  function normalizeRoomSnapshot(value, roomId) {
    const legacyKeys = [
      "version", "agenda", "description", "ownerUid", "locked", "createdAt", "updatedAt",
    ];
    if (!plainObject(value)) throw new TypeError("투표방 형식이 올바르지 않습니다.");
    const legacy = value.version === LEGACY_VERSION;
    if (!legacy && value.version !== VERSION) throw new Error("지원하지 않는 투표방 버전입니다.");
    exactKeys(value, legacy ? legacyKeys : [...legacyKeys, "resultVisibility"], "투표방");
    if (typeof value.locked !== "boolean") throw new Error("투표 마감 상태가 올바르지 않습니다.");
    return {
      id: roomId === undefined ? undefined : validateRoomId(roomId),
      version: value.version,
      agenda: text(value.agenda, "안건", MAX_AGENDA_LENGTH),
      description: text(value.description, "설명", MAX_DESCRIPTION_LENGTH, true),
      resultVisibility: normalizeResultVisibility(
        legacy ? DEFAULT_RESULT_VISIBILITY : value.resultVisibility,
      ),
      ownerUid: uid(value.ownerUid, "방장 식별자"),
      locked: value.locked,
      createdAt: timestamp(value.createdAt, "생성 시각"),
      updatedAt: timestamp(value.updatedAt, "수정 시각"),
    };
  }

  function normalizeResultSnapshot(value) {
    exactKeys(value, ["votes", "createdAt", "updatedAt"], "익명 투표함");
    if (!plainObject(value.votes)) throw new TypeError("익명 투표함 형식이 올바르지 않습니다.");
    const entries = Object.entries(value.votes);
    if (entries.length > MAX_VOTES) throw new Error("이 투표방의 최대 참여 인원을 초과했습니다.");
    const counts = emptyCounts();
    entries.forEach(([ballotKey, choice]) => {
      validateBallotKey(ballotKey);
      counts[normalizeChoice(choice)] += 1;
    });
    return {
      counts,
      total: entries.length,
      createdAt: timestamp(value.createdAt, "투표함 생성 시각"),
      updatedAt: timestamp(value.updatedAt, "투표함 수정 시각"),
    };
  }

  function normalizeVoteDraft(value) {
    if (typeof value === "string") return { choice: normalizeChoice(value) };
    exactKeys(value, ["choice"], "투표");
    return { choice: normalizeChoice(value.choice) };
  }

  function normalizeVoteSnapshot(value) {
    exactKeys(value, ["choice", "ballotKey", "createdAt", "updatedAt"], "개별 투표");
    return {
      choice: normalizeChoice(value.choice),
      ballotKey: validateBallotKey(value.ballotKey),
      createdAt: timestamp(value.createdAt, "투표 생성 시각"),
      updatedAt: timestamp(value.updatedAt, "투표 수정 시각"),
    };
  }

  function resultRows(value) {
    const counts = normalizeCounts(value);
    const total = totalVotes(counts);
    return CHOICES.map((choice) => ({
      choice,
      ...CHOICE_META[choice],
      count: counts[choice],
      ratio: total ? counts[choice] / total : 0,
      percent: total ? Math.round((counts[choice] / total) * 1000) / 10 : 0,
    }));
  }

  function validateRoomId(value) {
    const roomId = String(value || "");
    if (!ROOM_ID_PATTERN.test(roomId)) throw new Error("투표방 주소가 올바르지 않습니다.");
    return roomId;
  }

  function validateBallotKey(value) {
    const ballotKey = String(value || "");
    if (!BALLOT_KEY_PATTERN.test(ballotKey)) throw new Error("익명 투표 키가 올바르지 않습니다.");
    return ballotKey;
  }

  function bytesToBase64Url(bytes) {
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    if (typeof btoa === "function") return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64url");
    throw new Error("투표방 주소를 인코딩할 수 없습니다.");
  }

  function createRoomId(randomSource) {
    const source = randomSource || globalThis.crypto;
    if (!source || typeof source.getRandomValues !== "function") throw new Error("안전한 난수 생성기를 사용할 수 없습니다.");
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    return validateRoomId(bytesToBase64Url(bytes));
  }

  function createBallotKey(randomSource) {
    const source = randomSource || globalThis.crypto;
    if (!source || typeof source.getRandomValues !== "function") throw new Error("안전한 난수 생성기를 사용할 수 없습니다.");
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    return validateBallotKey(bytesToBase64Url(bytes));
  }

  function firebaseConfigReady(config) {
    return plainObject(config) && ["apiKey", "authDomain", "projectId", "appId"].every(
      (key) => typeof config[key] === "string" && config[key].trim() && !/YOUR_|여기에|example/i.test(config[key]),
    );
  }

  function roomUrl(roomId, baseUrl) {
    const url = new URL("./room.html", baseUrl || "https://huis-snow.github.io/tools/poll-maker/");
    url.search = "";
    url.hash = "";
    url.searchParams.set("r", validateRoomId(roomId));
    return url;
  }

  return Object.freeze({
    LEGACY_VERSION,
    VERSION,
    ROOM_ID_PATTERN,
    BALLOT_KEY_PATTERN,
    MAX_AGENDA_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_VOTES,
    DEFAULT_RESULT_VISIBILITY,
    RESULT_VISIBILITIES,
    RESULT_VISIBILITY_META,
    CHOICES,
    CHOICE_META,
    normalizeChoice,
    normalizeResultVisibility,
    normalizeCounts,
    emptyCounts,
    totalVotes,
    normalizeRoomDraft,
    normalizeRoomSnapshot,
    normalizeResultSnapshot,
    normalizeVoteDraft,
    normalizeVoteSnapshot,
    resultRows,
    validateRoomId,
    validateBallotKey,
    createRoomId,
    createBallotKey,
    firebaseConfigReady,
    roomUrl,
  });
});
