(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FarmPartyCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TRIALS = Object.freeze(["극 발리가르만다", "극 조라쟈", "극 이터널 퀸", "극 젤레니아", "극 영원한 어둠", "극 글라시아 라볼라스", "극 에누오"]);
  const SEATS = Object.freeze(["T1", "T2", "H1", "H2", "D1", "D2", "D3", "D4"]);
  const MAX_APPLICANTS = 100;
  const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const millis = (value) => typeof value?.toMillis === "function" ? value.toMillis() : Number(value?.seconds) * 1000 || Number(value) || 0;
  function fail(message) { throw new Error(message); }
  function text(value, maximum, label, required = false) {
    if (typeof value !== "string" || value.trim().length > maximum || (required && !value.trim())) fail(`${label}을 확인해 주세요.`);
    return value.trim();
  }
  function preferences(value) {
    if (!plain(value) || Object.keys(value).length !== 8 || !SEATS.every((seat) => own(value, seat) && [0, 1, 2].includes(value[seat])) || !SEATS.some((seat) => value[seat] > 0)) fail("가능한 자리를 하나 이상 선택해 주세요.");
    return Object.fromEntries(SEATS.map((seat) => [seat, value[seat]]));
  }
  function profile(value) {
    if (!plain(value) || !Array.isArray(value.wings) || value.wings.length !== 7 || !value.wings.every((wing) => typeof wing === "boolean")) fail("날개 기록을 확인해 주세요.");
    return { nickname: text(value.nickname, 30, "닉네임", true), server: text(value.server, 20, "서버"), memo: text(value.memo, 200, "메모"), preferences: preferences(value.preferences), wings: [...value.wings] };
  }
  function roomId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(value)) fail("모집방 주소가 올바르지 않습니다."); return value; }
  function uid(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) fail("참여자 정보가 올바르지 않습니다."); return value; }
  function createRoomId() {
    const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function trials(value) {
    const selected = value.trials === undefined ? [value.trial] : value.trials;
    if (!Array.isArray(selected) || selected.length < 1 || selected.length > 7 || new Set(selected).size !== selected.length || !selected.every(index => Number.isInteger(index) && index >= 0 && index < 7)) fail("토벌전을 하나 이상 선택해 주세요.");
    return [...selected].sort((a, b) => a - b);
  }
  function wing(value, person, index) { return value.version === 2 ? person.wings[String(index)] : person.wing; }
  function applicationWings(value, wings) { return value.version === 2 ? { wings: Object.fromEntries(trials(value).map(index => [String(index), wings[index]])) } : { wing: wings[value.trial] }; }
  function draft(value) {
    if (!plain(value)) fail("토벌전을 하나 이상 선택해 주세요.");
    const selected = trials(value);
    if (typeof value.date !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value.date) || new Date(`${value.date}T00:00:00Z`).toISOString().slice(0, 10) !== value.date) fail("출발 날짜를 확인해 주세요.");
    if (typeof value.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) fail("출발 시간을 확인해 주세요.");
    return { ...(value.trials === undefined ? { version: 1, trial: selected[0] } : { version: 2, trials: selected }), title: text(value.title, 60, "모집 제목", true), date: value.date, time: value.time, description: text(value.description, 500, "모집 설명") };
  }
  function applicant(value, selected) {
    if (!plain(value)) fail("신청 정보가 올바르지 않습니다.");
    let wings;
    if (selected) {
      if (!plain(value.wings) || Object.keys(value.wings).length !== selected.length || !selected.every(index => typeof value.wings[String(index)] === "boolean")) fail("선택한 토벌전의 날개 기록을 확인해 주세요.");
      wings = { wings: Object.fromEntries(selected.map(index => [String(index), value.wings[String(index)]])) };
    } else {
      if (typeof value.wing !== "boolean") fail("신청 정보가 올바르지 않습니다.");
      wings = { wing: value.wing };
    }
    return { nickname: text(value.nickname, 30, "닉네임", true), server: text(value.server, 20, "서버"), memo: text(value.memo, 200, "메모"), preferences: preferences(value.preferences), ...wings };
  }
  function allocations(assignments, locks, applicants) {
    if (!plain(assignments) || !plain(locks) || Object.keys(assignments).some((seat) => !SEATS.includes(seat)) || Object.keys(locks).some((seat) => !SEATS.includes(seat))) fail("편성 정보가 올바르지 않습니다.");
    const ids = new Set();
    for (const seat of Object.keys(assignments)) {
      const id = uid(assignments[seat]);
      if (ids.has(id) || !own(applicants, id) || !applicants[id].preferences[seat]) fail("한 사람을 중복 배정하거나 불가능한 자리에 배정할 수 없습니다.");
      ids.add(id);
    }
    for (const seat of Object.keys(locks)) if (locks[seat] !== true || !own(assignments, seat)) fail("빈자리를 고정할 수 없습니다.");
    return { assignments: { ...assignments }, locks: { ...locks } };
  }
  function room(value, id) {
    const base = draft(value);
    uid(value.ownerUid);
    if (value.version !== base.version || !["open", "confirmed", "closed"].includes(value.status) || !Number.isInteger(value.revision) || value.revision < 0 || !plain(value.applicants) || Object.keys(value.applicants).length > MAX_APPLICANTS) fail("모집방 데이터를 읽을 수 없습니다.");
    const applicants = Object.fromEntries(Object.entries(value.applicants).map(([key, item]) => [uid(key), { ...applicant(item, value.version === 2 ? trials(value) : undefined), joinedAt: item.joinedAt, updatedAt: item.updatedAt }]));
    const allocation = allocations(value.assignments, value.locks, applicants);
    if (value.status === "confirmed" && Object.keys(allocation.assignments).length !== 8) fail("확정 편성에는 여덟 명이 필요합니다.");
    return { ...base, id: roomId(id), ownerUid: value.ownerUid, status: value.status, revision: value.revision, ...allocation, applicants, createdAt: value.createdAt, updatedAt: value.updatedAt };
  }
  function orderedApplicants(value) {
    return Object.entries(value.applicants).map(([id, person]) => ({ id, ...person })).sort((a, b) => millis(a.joinedAt) - millis(b.joinedAt) || a.id.localeCompare(b.id));
  }
  function applyApplication(value, id, input, timestamp) {
    uid(id);
    if (value.status !== "open") fail("신청이 마감된 모집방입니다.");
    const applicants = { ...value.applicants };
    const assignments = { ...value.assignments };
    const locks = { ...value.locks };
    if (input === null) delete applicants[id];
    else {
      const next = applicant(input, value.version === 2 ? trials(value) : undefined);
      if (!own(applicants, id) && Object.keys(applicants).length >= MAX_APPLICANTS) fail("신청자는 최대 100명까지 받을 수 있습니다.");
      applicants[id] = { ...next, joinedAt: applicants[id]?.joinedAt || timestamp, updatedAt: timestamp };
    }
    for (const seat of SEATS) if (assignments[seat] === id && (!applicants[id] || !applicants[id].preferences[seat])) { delete assignments[seat]; delete locks[seat]; }
    return { applicants, assignments, locks };
  }
  function recommend(value) {
    allocations(value.assignments, value.locks, value.applicants);
    const fixed = Object.fromEntries(SEATS.filter((seat) => value.locks[seat]).map((seat) => [seat, value.assignments[seat]]));
    const fixedIds = new Set(Object.values(fixed));
    const free = SEATS.filter((seat) => !fixed[seat]);
    let states = new Map([[0, { score: 0, assignments: {} }]]);
    for (const person of orderedApplicants(value).filter((item) => !fixedIds.has(item.id))) {
      const next = new Map(states);
      for (const [mask, state] of states) free.forEach((seat, index) => {
        if ((mask & (1 << index)) || !person.preferences[seat]) return;
        const target = mask | (1 << index);
        const score = state.score + (person.preferences[seat] === 2 ? 1 : 0);
        if (!next.has(target) || score > next.get(target).score) next.set(target, { score, assignments: { ...state.assignments, [seat]: person.id } });
      });
      states = next;
    }
    let best = { score: -1, assignments: {} };
    for (const state of states.values()) if (Object.keys(state.assignments).length > Object.keys(best.assignments).length || (Object.keys(state.assignments).length === Object.keys(best.assignments).length && state.score > best.score)) best = state;
    return { ...fixed, ...best.assignments };
  }
  function manage(value, command) {
    if (value.status === "closed") fail("종료한 모집방은 변경할 수 없습니다.");
    let assignments = { ...value.assignments }, locks = { ...value.locks }, status = value.status;
    switch (command.type) {
      case "recommend": if (status !== "open") fail("편성을 먼저 다시 열어 주세요."); assignments = recommend(value); break;
      case "assign": {
        if (status !== "open" || !SEATS.includes(command.seat) || locks[command.seat]) fail("배정을 바꾸려면 편성과 자리 고정을 확인해 주세요.");
        const previous = SEATS.find((seat) => assignments[seat] === command.uid);
        if (command.uid && previous && locks[previous]) fail(`${previous} 배정을 먼저 고정 해제해 주세요.`);
        if (previous) delete assignments[previous];
        if (command.uid) assignments[command.seat] = uid(command.uid); else delete assignments[command.seat];
        break;
      }
      case "lock": if (status !== "open" || !SEATS.includes(command.seat) || !assignments[command.seat]) fail("배정된 자리만 고정할 수 있습니다."); if (locks[command.seat]) delete locks[command.seat]; else locks[command.seat] = true; break;
      case "confirm": if (status !== "open" || Object.keys(assignments).length !== 8) fail("여덟 자리를 채운 뒤 확정해 주세요."); status = "confirmed"; break;
      case "reopen": if (status !== "confirmed") fail("확정한 편성만 다시 열 수 있습니다."); status = "open"; break;
      case "close": status = "closed"; break;
      default: fail("지원하지 않는 편성 작업입니다.");
    }
    return { ...allocations(assignments, locks, value.applicants), status };
  }
  return { TRIALS, SEATS, MAX_APPLICANTS, profile, preferences, roomId, uid, createRoomId, trials, wing, applicationWings, draft, applicant, allocations, room, orderedApplicants, applyApplication, recommend, manage, millis };
});
