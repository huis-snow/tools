(function (root) {
  "use strict";

  const STATE_VERSION = 2;
  const STORAGE_KEY = "small-tools:raid-maker:v2";
  const LEGACY_STORAGE_KEY = "small-tools:raid-maker:v1";
  const MAX_MEMBERS = 120;
  const COMPOSITION_ID = "ff14-standard-8";
  const STATUSES = Object.freeze({
    confirmed: { label: "참여", rank: 0 },
    maybe: { label: "미정", rank: 1 },
    absent: { label: "불참", rank: 2 },
  });
  const JOB_ROLES = Object.freeze({
    tank: { label: "탱커 · 멘/섭 가능", short: "T", color: "#4f7cac" },
    main_tank: { label: "멘탱", short: "MT", color: "#4f7cac" },
    off_tank: { label: "섭탱", short: "ST", color: "#6d91b5" },
    healer: { label: "힐러 · 멘/섭 가능", short: "H", color: "#57a773" },
    main_healer: { label: "멘힐", short: "MH", color: "#57a773" },
    off_healer: { label: "섭힐", short: "SH", color: "#70ad8a" },
    melee: { label: "근딜", short: "M", color: "#ef6b43" },
    physical_ranged: { label: "유격대", short: "D3", color: "#d59b3d" },
    magical_ranged: { label: "캐스터", short: "D4", color: "#8b6fc0" },
    dps: { label: "딜러 · 근/원/마 가능", short: "D", color: "#c86b54" },
    any: { label: "모든 역할 가능", short: "ALL", color: "#69766f" },
  });
  const SEAT_SPECS = Object.freeze([
    { id: "p0-main_tank-0", code: "MT", role: "main_tank", label: "멘탱" },
    { id: "p0-off_tank-0", code: "ST", role: "off_tank", label: "섭탱" },
    { id: "p0-main_healer-0", code: "MH", role: "main_healer", label: "멘힐" },
    { id: "p0-off_healer-0", code: "SH", role: "off_healer", label: "섭힐" },
    { id: "p0-melee-0", code: "D1", role: "melee", label: "근딜" },
    { id: "p0-melee-1", code: "D2", role: "melee", label: "근딜" },
    { id: "p0-physical_ranged-0", code: "D3", role: "physical_ranged", label: "유격대" },
    { id: "p0-magical_ranged-0", code: "D4", role: "magical_ranged", label: "캐스터" },
  ]);
  const ROLE_ALIASES = new Map([
    ["tank", "tank"], ["탱", "tank"], ["탱커", "tank"], ["탱커전체", "tank"],
    ["main_tank", "main_tank"], ["maintank", "main_tank"], ["mt", "main_tank"],
    ["멘탱", "main_tank"], ["메인탱", "main_tank"], ["메인탱커", "main_tank"],
    ["off_tank", "off_tank"], ["offtank", "off_tank"], ["st", "off_tank"], ["ot", "off_tank"],
    ["섭탱", "off_tank"], ["서브탱", "off_tank"], ["서브탱커", "off_tank"],
    ["healer", "healer"], ["heal", "healer"], ["힐", "healer"], ["힐러", "healer"],
    ["main_healer", "main_healer"], ["mainhealer", "main_healer"], ["mh", "main_healer"],
    ["멘힐", "main_healer"], ["메인힐", "main_healer"], ["메인힐러", "main_healer"],
    ["off_healer", "off_healer"], ["offhealer", "off_healer"], ["sh", "off_healer"], ["oh", "off_healer"],
    ["섭힐", "off_healer"], ["서브힐", "off_healer"], ["서브힐러", "off_healer"],
    ["melee", "melee"], ["근딜", "melee"], ["근거리", "melee"], ["근거리딜러", "melee"],
    ["physical_ranged", "physical_ranged"], ["physicalranged", "physical_ranged"],
    ["ranged", "physical_ranged"], ["pranged", "physical_ranged"], ["원딜", "physical_ranged"],
    ["원거리", "physical_ranged"], ["물리원딜", "physical_ranged"], ["유격", "physical_ranged"],
    ["유격대", "physical_ranged"], ["물리원거리", "physical_ranged"],
    ["magical_ranged", "magical_ranged"], ["magicalranged", "magical_ranged"],
    ["caster", "magical_ranged"], ["마딜", "magical_ranged"], ["마법딜러", "magical_ranged"],
    ["캐스터", "magical_ranged"], ["미딜", "magical_ranged"],
    ["dps", "dps"], ["damage", "dps"], ["dealer", "dps"], ["딜", "dps"], ["딜러", "dps"],
    ["any", "any"], ["all", "any"], ["flex", "any"], ["무관", "any"], ["모든역할", "any"],
  ]);
  let idSequence = 0;

  function sliceGraphemes(value, maximum) {
    const text = String(value);
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      return [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)]
        .slice(0, maximum)
        .map((item) => item.segment)
        .join("");
    }
    return Array.from(text).slice(0, maximum).join("");
  }

  function cleanText(value, maximum, fallback = "") {
    const text = String(value ?? "").trim();
    return sliceGraphemes(text || fallback, maximum);
  }

  function createMemberId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    idSequence += 1;
    return `member-${Date.now().toString(36)}-${idSequence.toString(36)}`;
  }

  function normalizeJobRole(value) {
    const key = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const compactKey = key.replace(/_/g, "");
    const role = ROLE_ALIASES.get(key) || ROLE_ALIASES.get(compactKey);
    if (!role) {
      throw new Error("역할은 멘탱, 섭탱, 멘힐, 섭힐, 근딜, 유격대, 캐스터 중에서 골라 주세요.");
    }
    return role;
  }

  function normalizeRole(value) {
    return normalizeJobRole(value);
  }

  function normalizeStatus(value) {
    const status = String(value || "confirmed").trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(STATUSES, status)) throw new Error("참여 상태가 올바르지 않습니다.");
    return status;
  }

  function normalizeJob(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} 정보를 입력해 주세요.`);
    const name = cleanText(value.name, 30);
    if (!name) throw new Error(`${label} 이름을 입력해 주세요.`);
    return { name, role: normalizeJobRole(value.role) };
  }

  function memberJobInput(input, prefix) {
    const direct = input[`${prefix}Job`];
    if (direct && typeof direct === "object") return direct;
    const name = input[`${prefix}JobName`] ?? (typeof direct === "string" ? direct : "");
    return { name, role: input[`${prefix}Role`] };
  }

  function createMember(input = {}) {
    const suppliedId = cleanText(input.id, 72);
    const id = suppliedId || createMemberId();
    if (!/^[A-Za-z0-9_-]{1,72}$/.test(id)) throw new Error("공대원 ID 형식이 올바르지 않습니다.");
    const name = cleanText(input.name, 30);
    if (!name) throw new Error("공대원 닉네임을 입력해 주세요.");
    const primaryJob = normalizeJob(memberJobInput(input, "primary"), "주직");
    const secondarySource = memberJobInput(input, "secondary");
    const secondaryName = cleanText(secondarySource.name, 30);
    const secondaryRole = String(secondarySource.role ?? "").trim();
    if (Boolean(secondaryName) !== Boolean(secondaryRole)) {
      throw new Error("부직은 직업 이름과 역할을 함께 입력하거나 둘 다 비워 주세요.");
    }
    const secondaryJob = secondaryName
      ? normalizeJob({ name: secondaryName, role: secondaryRole }, "부직")
      : null;
    if (secondaryJob && secondaryJob.name === primaryJob.name && secondaryJob.role === primaryJob.role) {
      throw new Error("주직과 같은 직업·역할을 부직으로 다시 입력할 필요는 없어요.");
    }
    return {
      id,
      name,
      status: normalizeStatus(input.status),
      note: cleanText(input.note, 50),
      primaryJob,
      secondaryJob,
    };
  }

  function createEmptyState() {
    return {
      version: STATE_VERSION,
      title: "",
      eventTime: "",
      settings: { composition: COMPOSITION_ID },
      members: [],
      assignments: {},
    };
  }

  function createDefaultState() {
    return createEmptyState();
  }

  function buildSeats() {
    return SEAT_SPECS.map((seat, position) => ({
      ...seat,
      partyIndex: 0,
      position,
      roleIndex: seat.role === "melee" ? position - 4 : 0,
    }));
  }

  function jobCanUseSeat(jobOrRole, seatOrRole) {
    const role = typeof jobOrRole === "string" ? normalizeJobRole(jobOrRole) : normalizeJobRole(jobOrRole?.role);
    const seatRole = typeof seatOrRole === "string" ? seatOrRole : seatOrRole?.role;
    if (!SEAT_SPECS.some((seat) => seat.role === seatRole)) return false;
    if (role === "any") return true;
    if (role === "tank") return seatRole === "main_tank" || seatRole === "off_tank";
    if (role === "healer") return seatRole === "main_healer" || seatRole === "off_healer";
    if (role === "dps") return ["melee", "physical_ranged", "magical_ranged"].includes(seatRole);
    return role === seatRole;
  }

  function compatibleJobForSeat(member, seat, preferredJob = "auto") {
    if (!member || !seat || member.status === "absent") return null;
    const options = preferredJob === "primary"
      ? [["primary", member.primaryJob]]
      : preferredJob === "secondary"
        ? [["secondary", member.secondaryJob]]
        : [["primary", member.primaryJob], ["secondary", member.secondaryJob]];
    for (const [job, details] of options) {
      if (!details || !jobCanUseSeat(details, seat)) continue;
      return {
        job,
        name: details.name,
        role: details.role,
        exact: details.role === seat.role,
      };
    }
    return null;
  }

  function assignmentMemberId(value) {
    return typeof value === "string" ? value : String(value?.memberId || "");
  }

  function assignmentSeatId(state, memberId) {
    return Object.keys(state.assignments || {}).find((seatId) => assignmentMemberId(state.assignments[seatId]) === memberId) || null;
  }

  function reconcileAssignments(state) {
    const seats = new Map(buildSeats().map((seat) => [seat.id, seat]));
    const members = new Map(state.members.map((member) => [member.id, member]));
    const usedMembers = new Set();
    const assignments = {};
    for (const [seatId, rawAssignment] of Object.entries(state.assignments || {})) {
      const seat = seats.get(seatId);
      const memberId = assignmentMemberId(rawAssignment);
      const member = members.get(memberId);
      if (!seat || !member || usedMembers.has(memberId)) continue;
      const requestedJob = rawAssignment?.job === "primary" || rawAssignment?.job === "secondary"
        ? rawAssignment.job
        : "auto";
      const choice = compatibleJobForSeat(member, seat, requestedJob)
        || compatibleJobForSeat(member, seat, "auto");
      if (!choice) continue;
      assignments[seatId] = { memberId, job: choice.job };
      usedMembers.add(memberId);
    }
    state.assignments = assignments;
    return state;
  }

  function normalizeState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("공대 구성 데이터 형식이 올바르지 않습니다.");
    if (Number(value.version) !== STATE_VERSION) throw new Error("지원하지 않는 공대 구성 데이터 버전입니다.");
    if (!Array.isArray(value.members) || value.members.length > MAX_MEMBERS) throw new Error("공대원 명단 형식이 올바르지 않습니다.");
    const members = value.members.map(createMember);
    if (new Set(members.map((member) => member.id)).size !== members.length) throw new Error("중복된 공대원 ID가 있습니다.");
    const names = members.map((member) => member.name.toLocaleLowerCase());
    if (new Set(names).size !== names.length) throw new Error("중복된 공대원 닉네임이 있습니다.");
    const composition = value.settings?.composition || COMPOSITION_ID;
    if (composition !== COMPOSITION_ID) throw new Error("지원하지 않는 파티 구성 방식입니다.");
    const normalized = {
      version: STATE_VERSION,
      title: cleanText(value.title, 60),
      eventTime: cleanText(value.eventTime, 40),
      settings: { composition: COMPOSITION_ID },
      members,
      assignments: value.assignments && typeof value.assignments === "object" && !Array.isArray(value.assignments)
        ? { ...value.assignments }
        : {},
    };
    return reconcileAssignments(normalized);
  }

  function serializeState(state) {
    return JSON.stringify(normalizeState(state));
  }

  function importState(value) {
    if (typeof value !== "string" || value.length > 250_000) throw new Error("공대 구성 JSON 데이터가 올바르지 않습니다.");
    try {
      return normalizeState(JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("공대 구성 JSON 데이터 형식이 올바르지 않습니다.");
      throw error;
    }
  }

  function isLegacyExample(value) {
    return Number(value?.version ?? 1) === 1
      && Array.isArray(value?.members)
      && value.members.length === 8
      && value.members.every((member) => String(member?.id || "").startsWith("example-"));
  }

  function migrateV1(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Number(value.version ?? 1) !== 1) {
      throw new Error("이전 공대 구성 데이터 형식이 올바르지 않습니다.");
    }
    if (isLegacyExample(value)) return createEmptyState();
    const legacyRoleMap = { tank: "tank", support: "healer", damage: "dps", flex: "any" };
    const state = createEmptyState();
    state.title = cleanText(value.title, 60);
    state.eventTime = cleanText(value.eventTime, 40);
    if (!Array.isArray(value.members) || value.members.length > MAX_MEMBERS) throw new Error("이전 공대원 명단 형식이 올바르지 않습니다.");
    value.members.forEach((member) => {
      addMember(state, {
        id: member.id,
        name: member.name,
        status: member.status,
        note: member.note,
        primaryJob: {
          name: "직업 미지정",
          role: legacyRoleMap[String(member.role)] || "any",
        },
        secondaryJob: null,
      });
    });
    state.assignments = {};
    return state;
  }

  function addMember(state, input) {
    if (!state || !Array.isArray(state.members)) throw new Error("공대 구성 상태가 올바르지 않습니다.");
    if (state.members.length >= MAX_MEMBERS) throw new Error(`공대원은 최대 ${MAX_MEMBERS}명까지 추가할 수 있습니다.`);
    const member = createMember(input);
    if (state.members.some((candidate) => candidate.id === member.id)) throw new Error("이미 사용 중인 공대원 ID입니다.");
    if (state.members.some((candidate) => candidate.name.toLocaleLowerCase() === member.name.toLocaleLowerCase())) {
      throw new Error("이미 같은 닉네임의 공대원이 있습니다.");
    }
    state.members.push(member);
    return member;
  }

  function removeMember(state, memberId) {
    const index = state.members.findIndex((member) => member.id === memberId);
    if (index < 0) return false;
    state.members.splice(index, 1);
    unassignMember(state, memberId);
    return true;
  }

  function updateMember(state, memberId, patch = {}) {
    const index = state.members.findIndex((member) => member.id === memberId);
    if (index < 0) throw new Error("수정할 공대원을 찾지 못했습니다.");
    const current = state.members[index];
    const updated = createMember({
      ...current,
      ...patch,
      id: current.id,
      primaryJob: patch.primaryJob || current.primaryJob,
      secondaryJob: Object.prototype.hasOwnProperty.call(patch, "secondaryJob") ? patch.secondaryJob : current.secondaryJob,
    });
    if (state.members.some((member, candidateIndex) => (
      candidateIndex !== index && member.name.toLocaleLowerCase() === updated.name.toLocaleLowerCase()
    ))) throw new Error("이미 같은 닉네임의 공대원이 있습니다.");
    state.members[index] = updated;
    reconcileAssignments(state);
    return updated;
  }

  function parseBulkMembers(value) {
    const lines = String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length > MAX_MEMBERS) throw new Error(`한 번에 최대 ${MAX_MEMBERS}명까지 추가할 수 있습니다.`);
    return lines.map((line, index) => {
      // 탭 입력은 빈 열도 의미가 있으므로 주변 `\s*`로 나누면 안 된다.
      const delimiter = line.includes("\t") ? "\t" : ",";
      const parts = line.split(delimiter).map((part) => part.trim());
      if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
        throw new Error(`${index + 1}번째 줄에 닉네임, 주직 이름, 주직 역할을 입력해 주세요.`);
      }
      const [name, primaryName, primaryRole, secondaryName = "", secondaryRole = "", ...noteParts] = parts;
      if (Boolean(secondaryName) !== Boolean(secondaryRole)) {
        throw new Error(`${index + 1}번째 줄의 부직 이름과 역할을 함께 입력해 주세요.`);
      }
      return {
        name,
        status: "confirmed",
        note: noteParts.join(" / "),
        primaryJob: { name: primaryName, role: normalizeJobRole(primaryRole) },
        secondaryJob: secondaryName ? { name: secondaryName, role: normalizeJobRole(secondaryRole) } : null,
      };
    });
  }

  function unassignMember(state, memberId) {
    const seatId = assignmentSeatId(state, memberId);
    if (!seatId) return false;
    delete state.assignments[seatId];
    return true;
  }

  function clearAssignments(state) {
    const changed = Object.keys(state.assignments).length > 0;
    state.assignments = {};
    return changed;
  }

  function placeMember(state, memberId, seatId, preferredJob = "auto") {
    const member = state.members.find((candidate) => candidate.id === memberId);
    const seats = buildSeats();
    const targetSeat = seats.find((seat) => seat.id === seatId);
    if (!member) throw new Error("옮길 공대원을 찾지 못했습니다.");
    if (!targetSeat) throw new Error("옮길 공대 자리를 찾지 못했습니다.");
    const choice = compatibleJobForSeat(member, targetSeat, preferredJob);
    if (!choice) throw new Error(`${member.name}님은 ${targetSeat.label} 자리에 들어갈 수 있는 주직이나 부직이 없어요.`);
    const sourceSeatId = assignmentSeatId(state, memberId);
    const occupantAssignment = state.assignments[seatId] || null;
    const occupantId = assignmentMemberId(occupantAssignment);
    if (occupantId === memberId) return { moved: false, swapped: false, displacedMemberId: null, job: choice.job };

    if (sourceSeatId) delete state.assignments[sourceSeatId];
    let swapped = false;
    let displacedMemberId = null;
    if (occupantId) {
      const occupant = state.members.find((candidate) => candidate.id === occupantId);
      const sourceSeat = seats.find((seat) => seat.id === sourceSeatId);
      const occupantChoice = sourceSeat && compatibleJobForSeat(occupant, sourceSeat, "auto");
      if (occupantChoice) {
        state.assignments[sourceSeat.id] = { memberId: occupant.id, job: occupantChoice.job };
        swapped = true;
      } else {
        displacedMemberId = occupantId;
      }
    }
    state.assignments[seatId] = { memberId, job: choice.job };
    return { moved: true, swapped, displacedMemberId, job: choice.job };
  }

  function addFlowEdge(graph, from, to, capacity, cost, meta = null) {
    const forward = { to, reverse: graph[to].length, capacity, cost, meta, originalCapacity: capacity };
    const backward = { to: from, reverse: graph[from].length, capacity: 0, cost: -cost, meta: null, originalCapacity: 0 };
    graph[from].push(forward);
    graph[to].push(backward);
  }

  function autoAssign(state) {
    const seats = buildSeats();
    const candidates = state.members.filter((member) => member.status !== "absent");
    const source = 0;
    const memberOffset = 1;
    const seatOffset = memberOffset + candidates.length;
    const sink = seatOffset + seats.length;
    const graph = Array.from({ length: sink + 1 }, () => []);
    const base = seats.length + 1;
    const powers = {
      confirmed: base ** 5,
      confirmedPrimary: base ** 4,
      maybe: base ** 3,
      maybePrimary: base ** 2,
      exact: base,
    };

    candidates.forEach((member, memberIndex) => {
      const memberNode = memberOffset + memberIndex;
      addFlowEdge(graph, source, memberNode, 1, 0);
      seats.forEach((seat, seatIndex) => {
        const choice = compatibleJobForSeat(member, seat, "auto");
        if (!choice) return;
        const confirmed = member.status === "confirmed";
        const primary = choice.job === "primary";
        const score = confirmed
          ? powers.confirmed + (primary ? powers.confirmedPrimary : 0) + (choice.exact ? powers.exact : 0)
          : powers.maybe + (primary ? powers.maybePrimary : 0) + (choice.exact ? powers.exact : 0);
        addFlowEdge(graph, memberNode, seatOffset + seatIndex, 1, -score, {
          memberId: member.id,
          seatId: seat.id,
          job: choice.job,
        });
      });
    });
    seats.forEach((_seat, seatIndex) => addFlowEdge(graph, seatOffset + seatIndex, sink, 1, 0));

    while (true) {
      const distance = Array(graph.length).fill(Infinity);
      const previousNode = Array(graph.length).fill(-1);
      const previousEdge = Array(graph.length).fill(-1);
      const inQueue = Array(graph.length).fill(false);
      const queue = [source];
      distance[source] = 0;
      inQueue[source] = true;
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const node = queue[cursor];
        inQueue[node] = false;
        graph[node].forEach((edge, edgeIndex) => {
          if (edge.capacity <= 0) return;
          const candidateDistance = distance[node] + edge.cost;
          if (candidateDistance >= distance[edge.to]) return;
          distance[edge.to] = candidateDistance;
          previousNode[edge.to] = node;
          previousEdge[edge.to] = edgeIndex;
          if (!inQueue[edge.to]) {
            queue.push(edge.to);
            inQueue[edge.to] = true;
          }
        });
      }
      if (!Number.isFinite(distance[sink]) || distance[sink] >= 0) break;
      for (let node = sink; node !== source; node = previousNode[node]) {
        const parent = previousNode[node];
        const edge = graph[parent][previousEdge[node]];
        edge.capacity -= 1;
        graph[node][edge.reverse].capacity += 1;
      }
    }

    const assignments = {};
    candidates.forEach((_member, memberIndex) => {
      const memberNode = memberOffset + memberIndex;
      graph[memberNode].forEach((edge) => {
        if (!edge.meta || edge.originalCapacity !== 1 || edge.capacity !== 0) return;
        assignments[edge.meta.seatId] = { memberId: edge.meta.memberId, job: edge.meta.job };
      });
    });
    state.assignments = assignments;
    return compositionSummary(state);
  }

  function validatedAssignments(state) {
    const members = new Map(state.members.map((member) => [member.id, member]));
    const usedMembers = new Set();
    const assignments = new Map();
    buildSeats().forEach((seat) => {
      const raw = state.assignments?.[seat.id];
      const memberId = assignmentMemberId(raw);
      const member = members.get(memberId);
      if (!member || usedMembers.has(memberId)) return;
      const choice = compatibleJobForSeat(member, seat, raw?.job || "auto");
      if (!choice) return;
      assignments.set(seat.id, { memberId, job: choice.job });
      usedMembers.add(memberId);
    });
    return assignments;
  }

  function compositionSummary(state) {
    const seats = buildSeats();
    const valid = validatedAssignments(state);
    const assignedIds = new Set([...valid.values()].map((assignment) => assignment.memberId));
    const unassigned = state.members.filter((member) => !assignedIds.has(member.id));
    const assignedCount = valid.size;
    const primaryAssignedCount = [...valid.values()].filter((assignment) => assignment.job === "primary").length;
    const secondaryAssignedCount = assignedCount - primaryAssignedCount;
    const tentativeAssignedCount = [...valid.values()].filter((assignment) => (
      state.members.find((member) => member.id === assignment.memberId)?.status === "maybe"
    )).length;
    const missingSeats = seats.filter((seat) => !valid.has(seat.id));
    const complete = assignedCount === seats.length;
    const ready = complete && tentativeAssignedCount === 0;
    return {
      parties: [{
        partyIndex: 0,
        filled: assignedCount,
        capacity: seats.length,
        openSeats: seats.length - assignedCount,
        missingSeats,
        complete,
        ready,
        maybeCount: tentativeAssignedCount,
      }],
      totalSeats: seats.length,
      assignedCount,
      primaryAssignedCount,
      secondaryAssignedCount,
      tentativeAssignedCount,
      openSeats: seats.length - assignedCount,
      missingSeats,
      unassigned,
      confirmedUnassigned: unassigned.filter((member) => member.status === "confirmed"),
      maybeUnassigned: unassigned.filter((member) => member.status === "maybe"),
      absent: unassigned.filter((member) => member.status === "absent"),
      complete,
      ready,
    };
  }

  function formatEventTime(value) {
    const text = cleanText(value, 40);
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
    if (!match) return text;
    return `${match[1]}년 ${Number(match[2])}월 ${Number(match[3])}일 ${match[4]}:${match[5]}`;
  }

  function formatRaidText(state) {
    const normalized = normalizeState(state);
    const members = new Map(normalized.members.map((member) => [member.id, member]));
    const lines = [`[${normalized.title || "우리 공대 구성"}]`];
    if (normalized.eventTime) lines.push(formatEventTime(normalized.eventTime));
    lines.push("", "8인 파티");
    buildSeats().forEach((seat) => {
      const assignment = normalized.assignments[seat.id];
      const member = members.get(assignment?.memberId);
      if (!member) {
        lines.push(`- [${seat.code} · ${seat.label}] 빈 자리`);
        return;
      }
      const job = assignment.job === "secondary" ? member.secondaryJob : member.primaryJob;
      const flags = [assignment.job === "secondary" ? "부직" : "주직"];
      if (member.status === "maybe") flags.push("미정");
      lines.push(`- [${seat.code} · ${seat.label}] ${member.name} · ${job.name} (${flags.join(" · ")})${member.note ? ` · ${member.note}` : ""}`);
    });
    const summary = compositionSummary(normalized);
    lines.push("");
    if (summary.confirmedUnassigned.length) lines.push(`미배치 · ${summary.confirmedUnassigned.map((member) => member.name).join(" / ")}`);
    if (summary.maybeUnassigned.length) lines.push(`미정 · ${summary.maybeUnassigned.map((member) => member.name).join(" / ")}`);
    if (summary.absent.length) lines.push(`불참 · ${summary.absent.map((member) => member.name).join(" / ")}`);
    return lines.join("\n").trim();
  }

  function truncateCanvasText(context, value, maximumWidth) {
    const text = String(value);
    if (context.measureText(text).width <= maximumWidth) return text;
    const clusters = typeof Intl !== "undefined" && Intl.Segmenter
      ? [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(text)].map((item) => item.segment)
      : Array.from(text);
    while (clusters.length && context.measureText(`${clusters.join("")}…`).width > maximumWidth) clusters.pop();
    return `${clusters.join("")}…`;
  }

  function compactCanvasList(context, items, maximumWidth) {
    const values = items.map(String);
    const full = values.join(" · ");
    if (context.measureText(full).width <= maximumWidth) return full;
    for (let count = values.length - 1; count >= 1; count -= 1) {
      const candidate = `${values.slice(0, count).join(" · ")} · 외 ${values.length - count}명`;
      if (context.measureText(candidate).width <= maximumWidth) return candidate;
    }
    return truncateCanvasText(context, `${values[0] || "없음"}${values.length > 1 ? ` · 외 ${values.length - 1}명` : ""}`, maximumWidth);
  }

  async function renderRaidImage(state, options = {}) {
    if (typeof document === "undefined") throw new Error("공대 구성 이미지는 브라우저에서만 만들 수 있습니다.");
    const normalized = normalizeState(state);
    const scale = Number(options.scale || 2);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error("이미지 배율이 올바르지 않습니다.");
    if (document.fonts) await document.fonts.load('400 16px "Raid D2Coding"', "공대표 멘탱 섭탱 멘힐 섭힐 근딜 유격대 캐스터 주직 부직");
    const width = 1040;
    const height = 690;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("공대 구성 이미지 캔버스를 만들지 못했습니다.");
    if (typeof context.scale === "function") context.scale(scale, scale);
    context.textBaseline = "middle";
    const fontFamily = '"Raid D2Coding", "D2Coding", monospace';
    const members = new Map(normalized.members.map((member) => [member.id, member]));
    const summary = compositionSummary(normalized);

    context.fillStyle = "#edf2e8";
    context.fillRect(0, 0, width, height);
    [18, 31, 22, 39, 27, 18, 32, 23].forEach((barHeight, index) => {
      context.fillStyle = index === 3 || index === 4 ? "#ef6b43" : "#153c34";
      context.fillRect(36 + index * 8, 51 - barHeight, 6, barHeight);
    });
    context.fillStyle = "#61766e";
    context.font = `400 12px ${fontFamily}`;
    context.fillText("공대표 · FULL PARTY COMPOSITION", 118, 31);
    context.fillStyle = "#153c34";
    context.font = `700 30px ${fontFamily}`;
    context.fillText(truncateCanvasText(context, normalized.title || "우리 공대 구성", 700), 36, 88);
    context.font = `400 13px ${fontFamily}`;
    context.fillStyle = "#61766e";
    context.fillText(normalized.eventTime ? formatEventTime(normalized.eventTime) : "일정 미정", 38, 125);
    context.textAlign = "right";
    context.fillText(`배치 ${summary.assignedCount}/8 · 주직 ${summary.primaryAssignedCount} · 부직 ${summary.secondaryAssignedCount}`, width - 36, 125);
    context.textAlign = "left";

    const boardX = 36;
    const boardY = 158;
    const boardWidth = 968;
    const columnGap = 18;
    const slotWidth = (boardWidth - columnGap) / 2;
    const slotHeight = 78;
    context.fillStyle = "#153c34";
    context.fillRect(boardX, boardY, boardWidth, 54);
    context.fillStyle = "#ffffff";
    context.font = `700 15px ${fontFamily}`;
    context.fillText("8인 파티 · MT / ST / MH / SH / D1 / D2 / D3 / D4", boardX + 18, boardY + 28);
    context.textAlign = "right";
    context.fillStyle = summary.ready ? "#c9f25f" : "#ffd2c2";
    context.fillText(summary.ready ? "구성 완료" : `${summary.assignedCount}/8`, boardX + boardWidth - 18, boardY + 28);
    context.textAlign = "left";

    buildSeats().forEach((seat, index) => {
      const row = Math.floor(index / 2);
      const column = index % 2;
      const left = boardX + column * (slotWidth + columnGap);
      const top = boardY + 64 + row * (slotHeight + 10);
      const assignment = normalized.assignments[seat.id];
      const member = members.get(assignment?.memberId);
      const job = member && (assignment.job === "secondary" ? member.secondaryJob : member.primaryJob);
      context.fillStyle = "#fffdf5";
      context.fillRect(left, top, slotWidth, slotHeight);
      context.strokeStyle = "#9aaba1";
      context.lineWidth = 1;
      context.strokeRect(left + 0.5, top + 0.5, slotWidth - 1, slotHeight - 1);
      context.fillStyle = JOB_ROLES[seat.role].color;
      context.fillRect(left + 14, top + 17, 44, 44);
      context.fillStyle = "#ffffff";
      context.font = `700 11px ${fontFamily}`;
      context.textAlign = "center";
      context.fillText(seat.code, left + 36, top + 39);
      context.textAlign = "left";
      context.font = `700 14px ${fontFamily}`;
      context.fillStyle = member ? "#153c34" : "#9aa69f";
      context.fillText(member ? truncateCanvasText(context, member.name, 190) : `${seat.label} 빈 자리`, left + 72, top + 29);
      context.font = `400 11px ${fontFamily}`;
      context.fillStyle = assignment?.job === "secondary" ? "#d8522a" : "#61766e";
      const jobLine = member
        ? `${seat.label} · ${job.name} · ${assignment.job === "secondary" ? "부직 사용" : "주직"}${member.status === "maybe" ? " · 미정" : ""}`
        : `${seat.label} 역할 필요`;
      context.fillText(truncateCanvasText(context, jobLine, slotWidth - 90), left + 72, top + 51);
    });

    const footerY = 600;
    const visibleUnassigned = summary.unassigned.filter((member) => member.status !== "absent");
    context.fillStyle = "#153c34";
    context.font = `700 12px ${fontFamily}`;
    context.fillText("미배치 / 미정", 38, footerY);
    context.font = `400 12px ${fontFamily}`;
    context.fillStyle = "#61766e";
    context.fillText(
      visibleUnassigned.length
        ? compactCanvasList(context, visibleUnassigned.map((member) => `${member.name}${member.status === "maybe" ? "(미정)" : ""}`), 720)
        : "없음",
      142,
      footerY,
    );
    context.textAlign = "right";
    context.fillText("작은 도구함에서 만든 공대 구성표", width - 36, height - 32);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 이미지를 만들지 못했습니다."));
      }, "image/png");
    });
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  async function prepareBrowserStorage(keys = [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const fallback = resolveStorage();
    const vault = root.SmallToolsVault;
    if (!vault) return fallback;
    try {
      await vault.ready;
      if (typeof vault.migrateKeys !== "function") throw new Error("보관함 이전 기능을 사용할 수 없습니다.");
      await vault.migrateKeys(keys, { removeSource: true });
      if (!vault.storage || typeof vault.storage.getItem !== "function" || typeof vault.storage.setItem !== "function") {
        throw new Error("보관함 저장소를 사용할 수 없습니다.");
      }
      return vault.storage;
    } catch (_error) {
      return fallback;
    }
  }

  function initApp(options = {}) {
    const storage = resolveStorage(options.storage);
    const byId = (id) => document.getElementById(id);
    const elements = {
      eventTitle: byId("eventTitleInput"),
      eventTime: byId("eventTimeInput"),
      memberName: byId("memberNameInput"),
      primaryJob: byId("primaryJobInput"),
      primaryRole: byId("primaryRoleSelect"),
      secondaryJob: byId("secondaryJobInput"),
      secondaryRole: byId("secondaryRoleSelect"),
      memberNote: byId("memberNoteInput"),
      addMember: byId("addMemberButton"),
      cancelEdit: byId("cancelEditButton"),
      bulkInput: byId("bulkInput"),
      bulkAdd: byId("bulkAddButton"),
      rosterCount: byId("rosterCount"),
      confirmedCount: byId("confirmedCount"),
      maybeCount: byId("maybeCount"),
      absentCount: byId("absentCount"),
      memberList: byId("memberList"),
      autoAssign: byId("autoAssignButton"),
      clearAssignments: byId("clearAssignmentsButton"),
      raidBoard: byId("raidBoard"),
      compositionStatus: byId("compositionStatus"),
      reset: byId("resetButton"),
      text: byId("textButton"),
      image: byId("imageButton"),
      png: byId("pngButton"),
      imageLabel: byId("imageLabel"),
      toast: byId("toast"),
      live: byId("liveRegion"),
    };
    if (Object.values(elements).some((element) => !element)) return;

    let state = createEmptyState();
    let editingMemberId = null;
    let selectedMemberId = null;
    let dragDropped = false;
    let imageBusy = false;
    let toastTimer = 0;
    let migratedLegacy = false;

    function loadState() {
      try {
        const saved = storage?.getItem(STORAGE_KEY);
        if (saved) return importState(saved);
      } catch (_error) {
        // 저장소가 막힌 환경에서도 현재 탭에서는 계속 사용할 수 있다.
      }
      try {
        const legacy = storage?.getItem(LEGACY_STORAGE_KEY);
        if (!legacy) return createEmptyState();
        const parsed = JSON.parse(legacy);
        migratedLegacy = !isLegacyExample(parsed) && Array.isArray(parsed.members) && parsed.members.length > 0;
        return migrateV1(parsed);
      } catch (_error) {
        return createEmptyState();
      }
    }

    function persistState() {
      try {
        if (!storage || typeof storage.setItem !== "function") throw new Error("브라우저 저장소를 사용할 수 없습니다.");
        storage.setItem(STORAGE_KEY, serializeState(state));
        if (storage === root.SmallToolsVault?.storage && typeof root.SmallToolsVault.flush === "function") {
          Promise.resolve(root.SmallToolsVault.flush()).catch(() => showToast("브라우저에 자동 저장하지 못했어요."));
        }
      } catch (_error) {
        // private mode/storage quota failures should not break the editor.
      }
    }

    function announce(message) {
      elements.live.textContent = "";
      root.setTimeout(() => { elements.live.textContent = message; }, 20);
    }

    function showToast(message) {
      root.clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList.add("show");
      toastTimer = root.setTimeout(() => elements.toast.classList.remove("show"), 2600);
    }

    function roleLabel(role) {
      return JOB_ROLES[role]?.label || role;
    }

    function selectedMember() {
      return state.members.find((member) => member.id === selectedMemberId) || null;
    }

    function assignmentForMember(memberId) {
      const seatId = assignmentSeatId(state, memberId);
      if (!seatId) return null;
      return {
        seat: buildSeats().find((seat) => seat.id === seatId),
        assignment: state.assignments[seatId],
      };
    }

    function appendJobRow(container, job, priority) {
      if (!job) return;
      const row = document.createElement("span");
      row.className = `member-job is-${priority}`;
      const marker = document.createElement("b");
      marker.className = "job-priority";
      marker.textContent = priority === "primary" ? "주" : "부";
      const badge = document.createElement("i");
      badge.className = `role-badge role-${job.role}`;
      badge.textContent = roleLabel(job.role);
      const name = document.createElement("span");
      name.className = "member-job-name";
      name.textContent = job.name;
      row.append(marker, badge, name);
      container.append(row);
    }

    function renderMembers() {
      elements.memberList.replaceChildren();
      if (!state.members.length) {
        const empty = document.createElement("div");
        empty.className = "member-empty";
        empty.setAttribute("role", "status");
        const art = document.createElement("span");
        art.setAttribute("aria-hidden", "true");
        art.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
        const title = document.createElement("strong");
        title.textContent = "첫 공대원을 기다리고 있어요";
        const description = document.createElement("p");
        description.textContent = "위 입력칸에서 닉네임과 주직을 적어 추가해 주세요.";
        empty.append(art, title, description);
        elements.memberList.append(empty);
        return;
      }

      state.members.forEach((member) => {
        const card = document.createElement("article");
        card.className = "member-card";
        if (member.id === selectedMemberId) card.classList.add("is-selected");
        card.dataset.memberId = member.id;
        card.dataset.status = member.status;
        card.setAttribute("role", "listitem");
        card.draggable = member.status !== "absent";

        const handle = document.createElement("span");
        handle.className = "drag-handle";
        handle.setAttribute("aria-hidden", "true");
        handle.textContent = "⠿";

        const main = document.createElement("div");
        main.className = "member-main";
        const name = document.createElement("strong");
        name.className = "member-name";
        name.textContent = member.name;
        const jobs = document.createElement("span");
        jobs.className = "member-job-list";
        appendJobRow(jobs, member.primaryJob, "primary");
        appendJobRow(jobs, member.secondaryJob, "secondary");
        const meta = document.createElement("span");
        meta.className = "member-meta";
        const placement = assignmentForMember(member.id);
        if (member.status === "absent") {
          meta.textContent = `불참${member.note ? ` · ${member.note}` : ""}`;
        } else if (placement) {
          const usedJob = placement.assignment.job === "secondary" ? member.secondaryJob : member.primaryJob;
          meta.textContent = `${placement.seat.code} 배치 · ${usedJob.name} ${placement.assignment.job === "secondary" ? "(부직)" : "(주직)"}${member.note ? ` · ${member.note}` : ""}`;
        } else {
          meta.textContent = `${member.status === "maybe" ? "참여 미정" : "아직 미배치"}${member.note ? ` · ${member.note}` : ""}`;
        }
        main.append(name, jobs, meta);

        const controls = document.createElement("div");
        controls.className = "member-controls";
        const status = document.createElement("select");
        status.dataset.action = "status";
        status.setAttribute("aria-label", `${member.name} 참여 상태`);
        Object.entries(STATUSES).forEach(([value, details]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = details.label;
          option.selected = member.status === value;
          status.append(option);
        });
        const edit = document.createElement("button");
        edit.type = "button";
        edit.dataset.action = "edit";
        edit.textContent = "수정";
        edit.setAttribute("aria-label", `${member.name} 정보 수정`);
        const move = document.createElement("button");
        move.type = "button";
        move.dataset.action = "move";
        move.textContent = member.id === selectedMemberId ? "취소" : "이동";
        move.disabled = member.status === "absent";
        move.setAttribute("aria-pressed", String(member.id === selectedMemberId));
        move.setAttribute("aria-label", `${member.name} 자리 ${member.id === selectedMemberId ? "선택 취소" : "선택"}`);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove";
        remove.textContent = "삭제";
        remove.setAttribute("aria-label", `${member.name} 삭제`);
        controls.append(status, edit, move, remove);
        card.append(handle, main, controls);
        elements.memberList.append(card);
      });
    }

    function missingSeatText(seats) {
      return seats.map((seat) => `${seat.code} ${seat.label}`).join(" · ");
    }

    function renderBoard(summary) {
      const members = new Map(state.members.map((member) => [member.id, member]));
      const picked = selectedMember();
      elements.raidBoard.replaceChildren();

      if (picked) {
        const tray = document.createElement("div");
        tray.className = "move-tray";
        const message = document.createElement("p");
        message.textContent = `${picked.name}님을 옮길 자리를 선택하세요.`;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.dataset.action = "cancel-move";
        cancel.textContent = "선택 취소";
        tray.append(message, cancel);
        elements.raidBoard.append(tray);
      }

      const party = document.createElement("section");
      party.className = "party-card full-party-card";
      if (summary.complete) party.classList.add("is-complete");
      party.setAttribute("role", "listitem");
      party.setAttribute("aria-label", `8인 공대 ${summary.assignedCount}명 배치`);

      const header = document.createElement("header");
      header.className = "party-card-header party-heading";
      const heading = document.createElement("div");
      const kicker = document.createElement("span");
      kicker.textContent = "FULL PARTY / 8";
      const title = document.createElement("h4");
      title.textContent = "8인 공대";
      heading.append(kicker, title);
      const count = document.createElement("span");
      count.className = "party-count";
      count.textContent = `${summary.assignedCount}/8`;
      header.append(heading, count);

      const slots = document.createElement("div");
      slots.className = "party-slots";
      slots.setAttribute("role", "list");
      slots.setAttribute("aria-label", "고정 역할 자리");
      buildSeats().forEach((seat) => {
        const assignment = state.assignments[seat.id];
        const member = members.get(assignment?.memberId);
        const validTarget = picked && Boolean(compatibleJobForSeat(picked, seat));
        const slot = document.createElement("button");
        slot.type = "button";
        slot.className = "party-slot";
        slot.dataset.seatId = seat.id;
        slot.dataset.slotIndex = String(seat.position);
        slot.setAttribute("role", "listitem");
        if (member) {
          slot.classList.add("is-filled");
          slot.dataset.memberId = member.id;
          slot.draggable = member.status !== "absent";
        }
        if (validTarget) slot.classList.add("is-valid-target");
        if (member?.id === selectedMemberId) slot.classList.add("is-selected");
        const code = document.createElement("span");
        code.className = `slot-code slot-role role-${seat.role}`;
        code.textContent = seat.code;
        if (member) {
          const copy = document.createElement("span");
          copy.className = "slot-member";
          const memberName = document.createElement("strong");
          memberName.textContent = member.name;
          const job = assignment.job === "secondary" ? member.secondaryJob : member.primaryJob;
          const jobText = document.createElement("span");
          jobText.className = `slot-job${assignment.job === "secondary" ? " is-secondary" : ""}`;
          jobText.textContent = `${seat.label} · ${job.name} · ${assignment.job === "secondary" ? "부직 사용" : "주직"}${member.status === "maybe" ? " · 미정" : ""}`;
          copy.append(memberName, jobText);
          slot.append(code, copy);
          slot.setAttribute("aria-label", `${seat.code} ${seat.label}, ${member.name}, ${job.name}, ${assignment.job === "secondary" ? "부직" : "주직"}`);
        } else {
          const empty = document.createElement("span");
          empty.className = "slot-empty";
          const label = document.createElement("strong");
          label.textContent = seat.label;
          const hint = document.createElement("small");
          hint.textContent = picked ? (validTarget ? "여기에 배치" : "역할 불일치") : "빈 자리";
          empty.append(label, hint);
          slot.append(code, empty);
          slot.setAttribute("aria-label", `${seat.code} ${seat.label}, ${picked ? (validTarget ? `${picked.name} 배치 가능` : "배치할 수 없음") : "빈 자리"}`);
        }
        slots.append(slot);
      });

      const partyStatus = document.createElement("p");
      partyStatus.className = "party-role-status";
      if (summary.ready) {
        partyStatus.textContent = `배치 완료 · 주직 ${summary.primaryAssignedCount}명 · 부직 ${summary.secondaryAssignedCount}명`;
      } else if (summary.complete) {
        partyStatus.textContent = `8명 배치 · 참여 미정 ${summary.tentativeAssignedCount}명 확인 필요`;
      } else {
        partyStatus.textContent = `${summary.openSeats}자리 남음 · ${missingSeatText(summary.missingSeats)}`;
      }
      party.append(header, slots, partyStatus);
      elements.raidBoard.append(party);
    }

    function renderStatus(summary) {
      elements.compositionStatus.classList.toggle("is-complete", summary.ready);
      elements.compositionStatus.dataset.state = summary.ready ? "complete" : "incomplete";
      if (!state.members.length) {
        elements.compositionStatus.textContent = "공대원을 추가하면 주직·부직에 맞는 자리와 남은 역할을 알려드려요.";
      } else if (summary.ready) {
        elements.compositionStatus.textContent = `8인 구성 완료 · 전원 참여 확정 · 주직 ${summary.primaryAssignedCount}명, 부직 ${summary.secondaryAssignedCount}명`;
      } else if (summary.complete) {
        elements.compositionStatus.textContent = `8/8 배치 완료 · 참여 미정 ${summary.tentativeAssignedCount}명을 확인해 주세요. · 주직 ${summary.primaryAssignedCount}명, 부직 ${summary.secondaryAssignedCount}명`;
      } else {
        elements.compositionStatus.textContent = `${summary.assignedCount}/8 배치 · 빈 자리 ${missingSeatText(summary.missingSeats)} · 주직 ${summary.primaryAssignedCount}명, 부직 ${summary.secondaryAssignedCount}명`;
      }
    }

    function render(options = {}) {
      state = normalizeState(state);
      if (selectedMemberId && !state.members.some((member) => member.id === selectedMemberId && member.status !== "absent")) {
        selectedMemberId = null;
      }
      if (document.activeElement !== elements.eventTitle) elements.eventTitle.value = state.title;
      if (document.activeElement !== elements.eventTime) elements.eventTime.value = state.eventTime;
      const counts = { confirmed: 0, maybe: 0, absent: 0 };
      state.members.forEach((member) => { counts[member.status] += 1; });
      elements.rosterCount.textContent = String(state.members.length);
      elements.confirmedCount.textContent = String(counts.confirmed);
      elements.maybeCount.textContent = String(counts.maybe);
      elements.absentCount.textContent = String(counts.absent);
      const summary = compositionSummary(state);
      renderMembers();
      renderBoard(summary);
      renderStatus(summary);
      const eligible = state.members.some((member) => member.status !== "absent");
      elements.autoAssign.disabled = !eligible || imageBusy;
      elements.clearAssignments.disabled = summary.assignedCount === 0 || imageBusy;
      elements.text.disabled = summary.assignedCount === 0 || imageBusy;
      elements.image.disabled = summary.assignedCount === 0 || imageBusy;
      elements.png.disabled = summary.assignedCount === 0 || imageBusy;
      elements.imageLabel.textContent = imageBusy ? "이미지 만드는 중" : "이미지 복사";
      elements.secondaryRole.disabled = !elements.secondaryJob.value.trim();
      if (options.persist !== false) persistState();
      return summary;
    }

    function resetMemberForm() {
      editingMemberId = null;
      elements.memberName.value = "";
      elements.primaryJob.value = "";
      elements.primaryRole.value = elements.primaryRole.querySelector('option[value=""]') ? "" : "melee";
      elements.secondaryJob.value = "";
      elements.secondaryRole.value = "";
      elements.secondaryRole.disabled = true;
      elements.memberNote.value = "";
      elements.addMember.innerHTML = '<span aria-hidden="true">＋</span> 공대원 추가';
      elements.cancelEdit.hidden = true;
    }

    function formMemberInput() {
      const secondaryName = elements.secondaryJob.value.trim();
      return {
        name: elements.memberName.value,
        primaryJob: { name: elements.primaryJob.value, role: elements.primaryRole.value },
        secondaryJob: secondaryName
          ? { name: secondaryName, role: elements.secondaryRole.value }
          : null,
        note: elements.memberNote.value,
      };
    }

    function submitMember() {
      try {
        if (editingMemberId) {
          const current = state.members.find((member) => member.id === editingMemberId);
          if (!current) throw new Error("수정할 공대원을 찾지 못했습니다.");
          const updated = updateMember(state, editingMemberId, { ...formMemberInput(), status: current.status });
          resetMemberForm();
          render();
          showToast(`${updated.name}님의 정보를 수정했어요.`);
          announce(`${updated.name} 공대원 정보 수정 완료`);
        } else {
          const member = addMember(state, formMemberInput());
          resetMemberForm();
          render();
          showToast(`${member.name}님을 명단에 추가했어요.`);
          announce(`${member.name} 공대원 추가 완료`);
          elements.memberName.focus();
        }
      } catch (error) {
        showToast(error.message);
        announce(error.message);
      }
    }

    function beginEdit(memberId) {
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member) return;
      editingMemberId = member.id;
      elements.memberName.value = member.name;
      elements.primaryJob.value = member.primaryJob.name;
      elements.primaryRole.value = member.primaryJob.role;
      elements.secondaryJob.value = member.secondaryJob?.name || "";
      elements.secondaryRole.value = member.secondaryJob?.role || "";
      elements.secondaryRole.disabled = !member.secondaryJob;
      elements.memberNote.value = member.note;
      elements.addMember.textContent = "수정 완료";
      elements.cancelEdit.hidden = false;
      elements.memberName.focus();
      elements.memberName.scrollIntoView({ behavior: "smooth", block: "center" });
      announce(`${member.name} 정보 수정 중`);
    }

    function chooseMember(memberId, shouldFocusSeat = false) {
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member || member.status === "absent") {
        showToast("불참 공대원은 자리에 배치할 수 없어요.");
        return;
      }
      selectedMemberId = selectedMemberId === memberId ? null : memberId;
      render({ persist: false });
      if (!selectedMemberId) {
        announce("자리 이동 선택을 취소했어요.");
        return;
      }
      announce(`${member.name} 선택됨. 배치할 자리를 고르세요.`);
      if (shouldFocusSeat) {
        const target = [...elements.raidBoard.querySelectorAll("[data-seat-id]")]
          .find((slot) => compatibleJobForSeat(member, buildSeats().find((seat) => seat.id === slot.dataset.seatId)));
        target?.focus();
      }
    }

    function moveSelectedTo(seatId) {
      const member = selectedMember();
      if (!member) {
        const assignment = state.assignments[seatId];
        if (assignment) chooseMember(assignment.memberId);
        else showToast("먼저 명단이나 배치된 공대원을 선택해 주세요.");
        return;
      }
      try {
        const seat = buildSeats().find((candidate) => candidate.id === seatId);
        const result = placeMember(state, member.id, seatId);
        selectedMemberId = null;
        render();
        if (!result.moved) showToast(`${member.name}님은 이미 ${seat.code} 자리에 있어요.`);
        else if (result.swapped) showToast(`${member.name}님을 ${seat.code} 자리로 옮기고 두 공대원을 맞바꿨어요.`);
        else if (result.displacedMemberId) showToast(`${member.name}님을 ${seat.code} 자리에 배치하고 기존 공대원은 명단으로 옮겼어요.`);
        else showToast(`${member.name}님을 ${seat.code} 자리에 ${result.job === "secondary" ? "부직으로 " : ""}배치했어요.`);
        announce(`${member.name} ${seat.code} 자리 배치 완료`);
      } catch (error) {
        showToast(error.message);
        announce(error.message);
      }
    }

    async function copyText(value) {
      if (root.navigator?.clipboard?.writeText) {
        await root.navigator.clipboard.writeText(value);
        return;
      }
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("클립보드에 복사하지 못했습니다.");
    }

    function safeFilename() {
      const base = cleanText(state.title, 60, "공대-구성표")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      return `${base || "공대-구성표"}.png`;
    }

    async function makeImageBlob() {
      const canvas = await renderRaidImage(state, { scale: 2 });
      return canvasToBlob(canvas);
    }

    async function withImageBusy(task) {
      if (imageBusy) return;
      imageBusy = true;
      render({ persist: false });
      try {
        await task();
      } catch (error) {
        showToast(error.message || "이미지를 만들지 못했습니다.");
        announce(error.message || "이미지 생성 실패");
      } finally {
        imageBusy = false;
        render({ persist: false });
      }
    }

    elements.eventTitle.addEventListener("input", () => {
      state.title = cleanText(elements.eventTitle.value, 60);
      persistState();
    });
    elements.eventTime.addEventListener("change", () => {
      state.eventTime = cleanText(elements.eventTime.value, 40);
      persistState();
    });
    elements.secondaryJob.addEventListener("input", () => {
      const hasJob = Boolean(elements.secondaryJob.value.trim());
      elements.secondaryRole.disabled = !hasJob;
      if (!hasJob) elements.secondaryRole.value = "";
    });
    elements.addMember.addEventListener("click", submitMember);
    [elements.memberName, elements.primaryJob, elements.secondaryJob, elements.memberNote].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitMember();
        }
      });
    });
    elements.cancelEdit.addEventListener("click", () => {
      resetMemberForm();
      announce("공대원 정보 수정을 취소했어요.");
    });
    elements.bulkAdd.addEventListener("click", () => {
      try {
        const members = parseBulkMembers(elements.bulkInput.value);
        if (!members.length) throw new Error("붙여넣을 공대원 정보를 입력해 주세요.");
        if (state.members.length + members.length > MAX_MEMBERS) throw new Error(`공대원은 최대 ${MAX_MEMBERS}명까지 추가할 수 있습니다.`);
        const normalizedMembers = members.map(createMember);
        const existingNames = new Set(state.members.map((member) => member.name.toLocaleLowerCase()));
        normalizedMembers.forEach((member) => {
          const key = member.name.toLocaleLowerCase();
          if (existingNames.has(key)) throw new Error(`${member.name}님과 같은 닉네임이 이미 있어요.`);
          existingNames.add(key);
        });
        normalizedMembers.forEach((member) => addMember(state, member));
        elements.bulkInput.value = "";
        render();
        showToast(`${normalizedMembers.length}명을 명단에 추가했어요.`);
        announce(`공대원 ${normalizedMembers.length}명 일괄 추가 완료`);
      } catch (error) {
        showToast(error.message);
        announce(error.message);
      }
    });

    elements.memberList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-member-id]");
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!card || !action || action === "status") return;
      const memberId = card.dataset.memberId;
      const member = state.members.find((candidate) => candidate.id === memberId);
      if (!member) return;
      if (action === "edit") beginEdit(memberId);
      if (action === "move") chooseMember(memberId, true);
      if (action === "remove") {
        if (!root.confirm(`${member.name}님을 명단에서 삭제할까요?`)) return;
        removeMember(state, memberId);
        if (editingMemberId === memberId) resetMemberForm();
        if (selectedMemberId === memberId) selectedMemberId = null;
        render();
        showToast(`${member.name}님을 명단에서 삭제했어요.`);
        announce(`${member.name} 삭제 완료`);
      }
    });
    elements.memberList.addEventListener("change", (event) => {
      const select = event.target.closest('select[data-action="status"]');
      const card = event.target.closest("[data-member-id]");
      if (!select || !card) return;
      try {
        const member = updateMember(state, card.dataset.memberId, { status: select.value });
        if (member.status === "absent" && selectedMemberId === member.id) selectedMemberId = null;
        render();
        showToast(`${member.name}님의 상태를 ${STATUSES[member.status].label}(으)로 바꿨어요.`);
        announce(`${member.name} 참여 상태 ${STATUSES[member.status].label}`);
      } catch (error) {
        showToast(error.message);
        render({ persist: false });
      }
    });
    elements.memberList.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-member-id]");
      if (!card) return;
      const member = state.members.find((candidate) => candidate.id === card.dataset.memberId);
      if (!member || member.status === "absent") {
        event.preventDefault();
        return;
      }
      selectedMemberId = member.id;
      dragDropped = false;
      card.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", member.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    elements.memberList.addEventListener("dragend", () => {
      if (!dragDropped) selectedMemberId = null;
      dragDropped = false;
      render({ persist: false });
    });

    elements.raidBoard.addEventListener("click", (event) => {
      if (event.target.closest('[data-action="cancel-move"]')) {
        selectedMemberId = null;
        render({ persist: false });
        announce("자리 이동 선택을 취소했어요.");
        return;
      }
      const slot = event.target.closest("[data-seat-id]");
      if (slot) moveSelectedTo(slot.dataset.seatId);
    });
    elements.raidBoard.addEventListener("dragstart", (event) => {
      const slot = event.target.closest("[data-seat-id][data-member-id]");
      if (!slot) return;
      selectedMemberId = slot.dataset.memberId;
      dragDropped = false;
      event.dataTransfer?.setData("text/plain", selectedMemberId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    elements.raidBoard.addEventListener("dragover", (event) => {
      const slot = event.target.closest("[data-seat-id]");
      const member = selectedMember();
      if (!slot || !member) return;
      const seat = buildSeats().find((candidate) => candidate.id === slot.dataset.seatId);
      if (!compatibleJobForSeat(member, seat)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      slot.classList.add("is-drop-target");
    });
    elements.raidBoard.addEventListener("dragleave", (event) => {
      event.target.closest("[data-seat-id]")?.classList.remove("is-drop-target");
    });
    elements.raidBoard.addEventListener("drop", (event) => {
      const slot = event.target.closest("[data-seat-id]");
      if (!slot || !selectedMember()) return;
      event.preventDefault();
      dragDropped = true;
      moveSelectedTo(slot.dataset.seatId);
    });
    elements.raidBoard.addEventListener("dragend", () => {
      if (!dragDropped) selectedMemberId = null;
      dragDropped = false;
      render({ persist: false });
    });

    elements.autoAssign.addEventListener("click", () => {
      const summary = autoAssign(state);
      selectedMemberId = null;
      render();
      const message = summary.assignedCount
        ? `추천 배치 완료 · ${summary.assignedCount}/8명 · 주직 ${summary.primaryAssignedCount}명 · 부직 ${summary.secondaryAssignedCount}명`
        : "역할에 맞춰 배치할 수 있는 공대원이 없어요.";
      showToast(message);
      announce(message);
    });
    elements.clearAssignments.addEventListener("click", () => {
      if (!clearAssignments(state)) return;
      selectedMemberId = null;
      render();
      showToast("공대원 명단은 두고 배치만 비웠어요.");
      announce("공대 배치 초기화 완료");
    });
    elements.reset.addEventListener("click", () => {
      const hasContent = state.members.length || state.title || state.eventTime || Object.keys(state.assignments).length;
      if (hasContent && !root.confirm("공대 정보, 명단, 배치를 모두 지울까요?")) return;
      state = createEmptyState();
      selectedMemberId = null;
      resetMemberForm();
      render();
      showToast("공대표를 완전히 비웠어요.");
      announce("공대표 전체 초기화 완료");
    });
    elements.text.addEventListener("click", async () => {
      try {
        await copyText(formatRaidText(state));
        showToast("공대 구성표를 텍스트로 복사했어요.");
        announce("공대 구성 텍스트 복사 완료");
      } catch (error) {
        showToast(error.message);
        announce(error.message);
      }
    });
    elements.image.addEventListener("click", () => withImageBusy(async () => {
      if (!root.navigator?.clipboard?.write || typeof root.ClipboardItem === "undefined") {
        throw new Error("이 브라우저는 이미지 복사를 지원하지 않아요. PNG 저장을 이용해 주세요.");
      }
      const blob = await makeImageBlob();
      await root.navigator.clipboard.write([new root.ClipboardItem({ "image/png": blob })]);
      showToast("공대 구성표 이미지를 복사했어요.");
      announce("공대 구성 이미지 복사 완료");
    }));
    elements.png.addEventListener("click", () => withImageBusy(async () => {
      const blob = await makeImageBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeFilename();
      document.body.append(link);
      link.click();
      link.remove();
      root.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("공대 구성표 PNG를 저장했어요.");
      announce("공대 구성 PNG 저장 완료");
    }));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (selectedMemberId) {
        selectedMemberId = null;
        render({ persist: false });
        announce("자리 이동 선택을 취소했어요.");
      } else if (editingMemberId) {
        resetMemberForm();
        announce("공대원 정보 수정을 취소했어요.");
      }
    });
    root.addEventListener?.("storage", (event) => {
      if (storage === root.SmallToolsVault?.storage && event.storageArea) return;
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        const incomingValue = event.key === null ? storage?.getItem(STORAGE_KEY) : event.newValue;
        state = incomingValue ? importState(incomingValue) : createEmptyState();
        selectedMemberId = null;
        editingMemberId = null;
        resetMemberForm();
        render({ persist: false });
        showToast(incomingValue ? "다른 탭에서 바뀐 공대표를 불러왔어요." : "다른 탭에서 공대표를 비웠어요.");
      } catch (_error) {
        // 다른 탭의 손상된 값은 현재 작업을 덮어쓰지 않는다.
      }
    });

    state = loadState();
    resetMemberForm();
    render();
    if (migratedLegacy) {
      const removeLegacyState = () => {
        try { storage?.removeItem?.(LEGACY_STORAGE_KEY); } catch (_error) { /* keep the migrated v2 state */ }
      };
      if (storage === root.SmallToolsVault?.storage && typeof root.SmallToolsVault.flush === "function") {
        Promise.resolve(root.SmallToolsVault.flush()).then(removeLegacyState).then(() => root.SmallToolsVault.flush()).catch(() => {});
      } else {
        removeLegacyState();
      }
      showToast("이전 명단을 옮겼어요. 각 공대원의 주직과 부직을 확인해 주세요.");
      announce("이전 명단 이전 완료. 직업 정보를 확인해 주세요.");
    }
  }

  const api = {
    STATE_VERSION,
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
    COMPOSITION_ID,
    STATUSES,
    JOB_ROLES,
    SEAT_SPECS,
    createEmptyState,
    createDefaultState,
    createMember,
    normalizeJobRole,
    normalizeRole,
    parseBulkMembers,
    buildSeats,
    jobCanUseSeat,
    compatibleJobForSeat,
    addMember,
    removeMember,
    updateMember,
    placeMember,
    unassignMember,
    clearAssignments,
    autoAssign,
    compositionSummary,
    migrateV1,
    isLegacyExample,
    normalizeState,
    serializeState,
    importState,
    formatRaidText,
    renderRaidImage,
    canvasToBlob,
    prepareBrowserStorage,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RaidMaker = api;

  if (typeof document !== "undefined") {
    const boot = async () => initApp({ storage: await prepareBrowserStorage() });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
