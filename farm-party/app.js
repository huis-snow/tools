(() => {
  "use strict";
  const TRIALS = ["극 발리가르만다", "극 조라쟈", "극 이터널 퀸", "극 젤레니아", "극 영원한 어둠", "극 글라시아 라볼라스", "극 에누오"];
  const SEATS = ["T1", "T2", "H1", "H2", "D1", "D2", "D3", "D4"];
  const PROFILE_KEY = "small-tools:farm-party:profile:v1";
  const SESSION_KEY = "small-tools:farm-party:preview:v1";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const emptyPreferences = () => Object.fromEntries(SEATS.map((seat) => [seat, 0]));
  const emptyProfile = () => ({ nickname: "", server: "", preferences: emptyPreferences(), wings: TRIALS.map(() => false), memo: "" });
  const seatLabel = (seat) => `<span class="seat-label role-${seat[0]}">${seat}</span>`;
  let profile = null;
  let profileDraft = emptyProfile();
  let storage;
  let storageAvailable = false;
  let rooms;
  let selectedId;
  let currentView = "rooms";
  let signupPreferences;
  let toastTimer;
  let lastSuggestion = "";

  function notify(message) {
    $("toast").textContent = message;
    $("toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3600);
  }

  function seedRooms() {
    const people = [
      ["따뜻한차", ["T1", "T2"], "T1", true], ["밤산책", ["T2"], "T2", false],
      ["새벽별", ["H1", "H2"], "H1", false], ["감자", ["D1", "D2"], "D1", false],
      ["여름", ["D3"], "D3", true], ["달빛", ["D4", "D2"], "D4", false],
      ["솜구름", ["H2", "H1"], "H2", false], ["귤껍질", ["D2", "D1"], "D2", false],
    ].map(([nickname, possible, preferred, wing], index) => ({ id: `example-${index}`, nickname, server: "", preferences: Object.fromEntries(SEATS.map((seat) => [seat, seat === preferred ? 2 : possible.includes(seat) ? 1 : 0])), wing, memo: "", order: index }));
    return [
      { id: "preview-1", trial: 1, title: "날개 파밍 5클 · 편하게 함께해요", date: "2026-10-02", time: "21:00", description: "클리어 경험 있는 분들과 5클 진행해요. 공략과 산개는 출발 전에 맞출게요.", applicants: structuredClone(people), assignments: { T1: "example-0", T2: "example-1", H1: "example-2", D1: "example-3", D3: "example-4", D4: "example-5" }, locks: {}, status: "open" },
      { id: "preview-2", trial: 0, title: "금요일 밤, 날개를 향해 다섯 판", date: "2026-10-02", time: "22:30", description: "여유 있게 함께 파밍해요. 5클 모두 참여 가능한 분을 모집합니다.", applicants: structuredClone(people.slice(0, 5)), assignments: { T1: "example-0", T2: "example-1", H1: "example-2", D1: "example-3" }, locks: {}, status: "open" },
      { id: "preview-3", trial: 2, title: "주말 날개 파밍 · 5클", date: "2026-10-03", time: "20:00", description: "편성이 확정된 예시 파티입니다. 출발 전에 배정된 자리를 확인해 주세요.", applicants: structuredClone(people), assignments: Object.fromEntries(people.map((person) => [Object.keys(person.preferences).find((seat) => person.preferences[seat] === 2), person.id])), locks: {}, status: "confirmed" },
    ];
  }

  function validateProfile(value) {
    if (!value || typeof value !== "object" || typeof value.nickname !== "string" || !value.nickname.trim() || value.nickname.length > 30 || typeof value.server !== "string" || value.server.length > 20 || typeof value.memo !== "string" || value.memo.length > 200 || !value.preferences || !SEATS.every((seat) => [0, 1, 2].includes(value.preferences[seat])) || !SEATS.some((seat) => value.preferences[seat] > 0) || !Array.isArray(value.wings) || value.wings.length !== 7 || !value.wings.every((wing) => typeof wing === "boolean")) throw new Error("저장된 내 정보의 형식이 올바르지 않습니다.");
    return { nickname: value.nickname.trim(), server: value.server.trim(), preferences: { ...value.preferences }, wings: [...value.wings], memo: value.memo.trim() };
  }

  async function initialize() {
    try {
      if (window.SmallToolsVault) {
        await SmallToolsVault.ready;
        await SmallToolsVault.migrateKeys([PROFILE_KEY], { removeSource: true });
        storage = SmallToolsVault.storage;
        storageAvailable = SmallToolsVault.getStatus().mode !== "memory";
      } else { storage = localStorage; storageAvailable = true; }
      const raw = storage.getItem(PROFILE_KEY);
      if (raw) {
        try { profile = validateProfile(JSON.parse(raw)); }
        catch {
          storage.setItem(`${PROFILE_KEY}:recovery:${Date.now()}`, raw);
          storageAvailable = false;
          notify("기존 정보를 읽지 못했어요. 원본을 보존하고 저장을 중단했습니다.");
        }
      }
    } catch { storageAvailable = false; notify("브라우저 저장을 사용할 수 없어요. 이번 화면에서만 체험할 수 있습니다."); }
    rooms = seedRooms();
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if (saved && saved.version === 1 && Array.isArray(saved.rooms) && saved.rooms.length && saved.rooms.every((room) => room && typeof room.id === "string" && Number.isInteger(room.trial) && room.trial >= 0 && room.trial < 7 && Array.isArray(room.applicants) && room.assignments && room.locks && ["open", "confirmed"].includes(room.status) && /^\d{4}-\d{2}-\d{2}$/.test(room.date) && /^\d{2}:\d{2}$/.test(room.time) && room.applicants.every((person) => person && typeof person.id === "string" && typeof person.nickname === "string" && person.preferences && SEATS.every((seat) => [0, 1, 2].includes(person.preferences[seat]))))) rooms = saved.rooms;
    } catch { /* Preview data can safely fall back to the examples. */ }
    selectedId = rooms[0].id;
    if (profile) profileDraft = structuredClone(profile);
    $("storageStatus").textContent = storageAvailable ? "내 정보는 이 브라우저에 저장" : "현재 화면에서만 이용 가능";
    $("createTrial").innerHTML = TRIALS.map((name, index) => `<option value="${index}">${name}</option>`).join("");
    $("createDate").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    attachEvents();
    renderProfile();
    renderAll();
  }

  function room() { return rooms.find((item) => item.id === selectedId) || rooms[0]; }
  function memberForSeat(item, seat) { return item.applicants.find((person) => person.id === item.assignments[seat]); }
  function assignedSeat(item, id) { return SEATS.find((seat) => item.assignments[seat] === id); }
  function count(item) { return SEATS.filter((seat) => memberForSeat(item, seat)).length; }
  function dateLabel(item) {
    const date = new Date(`${item.date}T12:00:00+09:00`);
    const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
    return `${item.date.slice(5).replace("-", ".")} (${weekday}) · ${item.time}`;
  }
  function statusTag(item) { return `<span class="status-tag ${item.status === "confirmed" ? "confirmed" : ""}">${item.status === "confirmed" ? "편성 확정" : "모집 중"}</span>`; }
  function preferenceChips(preferences) { return SEATS.filter((seat) => preferences[seat]).map((seat) => `<span class="${preferences[seat] === 2 ? "is-preferred" : ""}">${preferences[seat] === 2 ? "★ " : ""}${seat}</span>`).join(""); }

  function renderMyCard() {
    $("profileDot").classList.toggle("saved", !!profile);
    $("myCard").innerHTML = `<div class="card-eyebrow">MY ADVENTURER CARD<span class="local-tag">브라우저 저장</span></div>${profile ? `<div class="my-name-row"><span class="profile-avatar">${esc(Array.from(profile.nickname)[0])}</span><h2 id="myCardTitle">${esc(profile.nickname)}<small>${esc(profile.server || "나의 모험가 정보")}</small></h2></div><div class="mini-seats">${SEATS.filter((seat) => profile.preferences[seat]).map((seat) => `<span class="mini-seat ${profile.preferences[seat] === 2 ? "preferred" : ""}">${profile.preferences[seat] === 2 ? "★ " : ""}${seat}</span>`).join("")}</div><p>날개 ${profile.wings.filter(Boolean).length} / 7 보유 · 준비된 정보로 바로 신청</p>` : '<h2 id="myCardTitle">내 정보를 먼저 기록해요.</h2><p>닉네임, 가능한 자리, 날개 현황을<br>한 번 저장하면 다음 신청이 가벼워져요.</p>'}<button data-action="profile">${profile ? "내 정보 수정" : "내 정보 등록"}<span>↗</span></button>`;
  }

  function roomHeader(item) {
    return `<header class="room-head"><div class="room-topline"><p class="eyebrow">TRIAL ${String(item.trial + 1).padStart(2, "0")} / WING FARM</p>${statusTag(item)}</div><h2>${TRIALS[item.trial]}</h2><p class="room-title-sub">${esc(item.title)}</p><div class="room-meta"><span><i>◷</i><b>${dateLabel(item)}</b></span><span><i>↻</i><b>5클 반복</b></span><span><i>♧</i>8인 파티</span></div><p class="room-description"><span>모집 안내</span>${esc(item.description || "5클 함께할 모험가를 모집합니다.")}</p></header>`;
  }

  function partyBoard(item, host = false) {
    const missing = SEATS.filter((seat) => !memberForSeat(item, seat));
    return `<section class="party-section"><div class="block-topline"><h3>파티 편성<span class="count-mono">${count(item)} / 8</span></h3><div class="role-key"><span><i class="tank-dot"></i>탱커</span><span><i class="healer-dot"></i>힐러</span><span><i class="dps-dot"></i>딜러</span></div></div><div class="party-grid">${SEATS.map((seat) => {
      const person = memberForSeat(item, seat);
      return `<div class="party-seat ${person ? "" : "empty"}">${seatLabel(seat)}${person?.preferences[seat] === 2 ? '<span class="preferred-mark" aria-label="선호 자리">★</span>' : ""}<h4>${person ? esc(person.nickname) : "함께할 모험가"}</h4><small>${person ? (person.wing ? "날개 보유" : "날개 미보유") : "아직 비어 있어요"}</small>${host ? `<div class="host-seat-controls"><select data-assign="${seat}" aria-label="${seat} 자리 배정" ${item.status === "confirmed" || item.locks[seat] ? "disabled" : ""}><option value="">빈자리</option>${item.applicants.filter((candidate) => candidate.preferences[seat]).map((candidate) => `<option value="${esc(candidate.id)}" ${person?.id === candidate.id ? "selected" : ""}>${esc(candidate.nickname)}${candidate.preferences[seat] === 2 ? " ★" : ""}</option>`).join("")}</select><button class="lock-button ${item.locks[seat] ? "locked" : ""}" data-lock="${seat}" aria-label="${seat} 자리 ${item.locks[seat] ? "고정 해제" : "고정"}" aria-pressed="${Boolean(item.locks[seat])}" ${!person || item.status === "confirmed" ? "disabled" : ""}>${item.locks[seat] ? "◆" : "◇"}</button></div>` : ""}</div>`;
    }).join("")}</div>${missing.length ? `<p class="empty-callout"><span>↗</span><span>아직 <b>${missing.join(" · ")}</b> 자리가 비어 있어요.${host ? " 신청자를 배정하거나 추천 편성을 실행해 보세요." : " 가능한 자리가 있다면 함께해 주세요."}</span></p>` : ""}</section>`;
  }

  function applicantsTable(item, host = false) {
    return `<table class="applicant-list"><thead><tr><th scope="col">모험가</th><th scope="col">가능한 자리 · ★ 선호</th>${host ? "" : '<th scope="col">날개</th>'}<th scope="col">${host ? "날개" : "배정"}</th></tr></thead><tbody>${item.applicants.map((person) => {
      const assigned = assignedSeat(item, person.id);
      return `<tr><td class="applicant-name">${esc(person.nickname)}${person.id === "local-me" ? '<span class="me-tag">나</span>' : ""}<small>${host ? (assigned ? `${assigned} ${item.status === "confirmed" ? "확정" : "배정"}` : "대기") : esc(person.server || "")}</small></td><td><div class="applicant-seats">${preferenceChips(person.preferences)}</div></td><td class="wing-status ${person.wing ? "owned" : ""}"><b>${person.wing ? "✦" : "○"}</b>${person.wing ? "보유" : "미보유"}</td>${host ? "" : `<td class="member-status ${assigned ? "" : "waiting"}">${assigned || "대기"}${assigned && item.status === "confirmed" ? " 확정" : ""}</td>`}</tr>`;
    }).join("") || `<tr><td colspan="${host ? 3 : 4}">첫 번째 신청을 기다리고 있어요.</td></tr>`}</tbody></table>`;
  }

  function joinPanel(item) {
    const mine = item.applicants.find((person) => person.id === "local-me");
    const assigned = mine && assignedSeat(item, mine.id);
    if (item.status === "confirmed") return `<section class="join-section"><div><h3>${mine ? (assigned ? `내 자리 ${assigned} · 편성이 확정됐어요.` : "이번 편성에서는 대기 상태예요.") : "여덟 자리의 편성이 확정됐어요."}</h3><p>확정된 모집방은 새 신청을 받지 않습니다.</p></div><button class="secondary-button" data-action="copy">편성표 복사 ↗</button></section>`;
    return `<section class="join-section"><div><h3>${mine ? (assigned ? `${assigned}에 배정됐어요. 최종 확정을 기다려 주세요.` : "신청 완료 · 방장이 편성을 확인하고 있어요.") : profile ? `${esc(profile.nickname)}님, 저장된 정보로 함께해요.` : "내 정보를 저장하면, 다음엔 한 번에 신청."}</h3><p>${mine ? "신청 정보는 기본 정보와 별도로 저장됩니다." : profile ? `이번 토벌전 날개 ${profile.wings[item.trial] ? "보유" : "미보유"} · 5클 모두 참여` : "날개 여부와 자리 선호도를 매번 다시 입력하지 않아도 돼요."}</p></div><div class="join-actions">${mine ? '<button class="quiet-button" data-action="withdraw">신청 취소</button>' : profile ? '<button class="quiet-button" data-action="signup-edit">이번 신청만 변경</button>' : ""}<button class="primary-button" data-action="${mine ? "signup-edit" : "signup"}">${mine ? "내 신청 수정" : profile ? "이 정보로 5클 신청" : "내 정보 등록하고 신청"}<span>→</span></button></div></section>`;
  }

  function renderAll() {
    const item = room();
    $("roomCount").textContent = rooms.length;
    renderMyCard();
    $("roomList").innerHTML = rooms.map((candidate) => `<button class="room-card ${candidate.id === item.id ? "selected" : ""}" data-room="${esc(candidate.id)}" aria-pressed="${candidate.id === item.id}"><div class="room-card-top"><span class="trial-number">TRIAL / ${String(candidate.trial + 1).padStart(2, "0")}</span>${statusTag(candidate)}</div><h3>${TRIALS[candidate.trial]}</h3><p><span>${dateLabel(candidate)}</span><strong>${count(candidate)}<small> / 8</small></strong></p><div class="tiny-progress"><span style="width:${count(candidate) / 8 * 100}%"></span></div></button>`).join("");
    $("roomDetail").innerHTML = `${roomHeader(item)}${partyBoard(item)}<section class="applicants-section"><div class="block-topline"><h3>신청한 모험가<span class="count-mono">${item.applicants.length}</span></h3><span>8인 초과 신청은 대기로 관리</span></div>${applicantsTable(item)}</section>${joinPanel(item)}`;
    $("hostRoomSelect").innerHTML = rooms.map((candidate) => `<option value="${esc(candidate.id)}" ${candidate.id === item.id ? "selected" : ""}>${TRIALS[candidate.trial]} · ${dateLabel(candidate)}</option>`).join("");
    $("hostDetail").innerHTML = `<div class="host-columns"><article class="room-detail">${roomHeader(item)}${partyBoard(item, true)}${lastSuggestion ? `<p class="suggestion-summary">${esc(lastSuggestion)}</p>` : ""}<div class="host-controls">${item.status === "open" ? `<button class="secondary-button" data-action="recommend">✦ 추천 편성</button><button class="primary-button" data-action="confirm" ${count(item) !== 8 ? "disabled" : ""}>편성 확정 →</button>` : '<button class="secondary-button" data-action="reopen">편성 다시 열기</button><button class="primary-button" data-action="copy">편성표 복사 ↗</button>'}</div></article><section class="panel host-applicants"><div class="block-topline"><h3>신청자 목록<span class="count-mono">${item.applicants.length}</span></h3><span>예시 관리 화면</span></div>${applicantsTable(item, true)}<p class="host-hint">★ 선호 자리를 최대한 반영하되, 여덟 자리를 채우는 것을 우선해요.<br>◇를 눌러 배정을 고정하면 다음 추천에서도 유지됩니다.<br>날개 보유 여부는 현재 편성 우선순위에 반영하지 않아요.</p><button class="new-room-button" data-action="duplicate">이 모집 설정으로 다음 회차 만들기 ↗</button></section></div>`;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ version: 1, rooms })); } catch { /* Preview can continue in memory. */ }
  }

  function renderSeatOptions(targetId, preferences) {
    $(targetId).innerHTML = SEATS.map((seat) => `<button class="seat-choice" type="button" data-preference="${seat}" data-target="${targetId}" data-level="${preferences[seat]}" aria-label="${seat}: ${["불가", "가능", "선호"][preferences[seat]]}. 누르면 다음 단계로 변경">${seatLabel(seat)}<span class="choice-star" aria-hidden="true">${preferences[seat] === 2 ? "★" : "☆"}</span><span class="choice-status">${["불가", "가능", "선호"][preferences[seat]]}</span></button>`).join("");
  }

  function renderProfile() {
    $("nickname").value = profileDraft.nickname;
    $("server").value = profileDraft.server;
    $("memo").value = profileDraft.memo;
    renderSeatOptions("profileSeats", profileDraft.preferences);
    $("wingChecklist").innerHTML = TRIALS.map((name, index) => `<label class="wing-item"><input type="checkbox" data-wing="${index}" ${profileDraft.wings[index] ? "checked" : ""}><span class="wing-number">${String(index + 1).padStart(2, "0")}</span><span>${name}</span><small>${profileDraft.wings[index] ? "보유" : "미보유"}</small></label>`).join("");
    $("wingCount").textContent = profileDraft.wings.filter(Boolean).length;
  }

  function selectView(view) {
    currentView = view;
    document.querySelectorAll(".nav-tab").forEach((tab) => { const active = tab.dataset.view === view; tab.classList.toggle("active", active); if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current"); });
    ["rooms", "profile", "host"].forEach((name) => $(name + "View").hidden = name !== view);
    if (view === "profile") renderProfile();
  }

  function showSignup() {
    const item = room();
    if (item.status !== "open") return notify("이 모집방은 편성이 확정됐어요.");
    if (!profile) { selectView("profile"); $("nickname").focus(); return notify("내 정보를 한 번 저장한 뒤 신청해 주세요."); }
    const existing = item.applicants.find((person) => person.id === "local-me");
    signupPreferences = { ...(existing?.preferences || profile.preferences) };
    $("signupMemo").value = existing?.memo ?? profile.memo;
    $("signupSummary").innerHTML = `<div class="signup-card"><h3>${TRIALS[item.trial]}</h3><p>${dateLabel(item)} · 5클 모두 참여</p><dl class="signup-info"><dt>모험가</dt><dd>${esc(profile.nickname)}${profile.server ? ` @${esc(profile.server)}` : ""}</dd><dt>가능한 자리</dt><dd id="signupSeatSummary"><div class="applicant-seats">${preferenceChips(signupPreferences)}</div></dd><dt>날개</dt><dd>${profile.wings[item.trial] ? "✦ 보유" : "○ 미보유"}</dd></dl></div>`;
    renderSeatOptions("signupSeats", signupPreferences);
    document.querySelector(".signup-overrides").open = false;
    $("signupForm").querySelector('button[type="submit"]').innerHTML = `${existing ? "이 정보로 신청 수정" : "이 정보로 5클 신청"}<span>→</span>`;
    $("signupDialog").showModal();
  }

  function showCreate(duplicate = false) {
    const item = room();
    $("createForm").reset();
    $("createDate").value = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    $("createTrial").value = duplicate ? item.trial : 0;
    $("createTitle").value = duplicate ? item.title : "날개 파밍 5클 · 편하게 함께해요";
    $("createDescription").value = duplicate ? item.description : "";
    if (duplicate) $("createTime").value = item.time;
    $("createDialog").showModal();
  }

  function submitSignup(preferences, memo) {
    const item = room();
    if (item.status !== "open") return notify("이 모집방은 편성이 확정됐어요.");
    if (!SEATS.some((seat) => preferences[seat])) return notify("가능한 자리를 하나 이상 선택해 주세요.");
    const existing = item.applicants.find((person) => person.id === "local-me");
    const applicant = { id: "local-me", nickname: profile.nickname, server: profile.server, preferences: { ...preferences }, wing: profile.wings[item.trial], memo: memo.trim(), order: existing?.order ?? Math.max(-1, ...item.applicants.map((person) => person.order)) + 1 };
    if (existing) item.applicants[item.applicants.indexOf(existing)] = applicant; else item.applicants.push(applicant);
    const assigned = assignedSeat(item, applicant.id);
    if (assigned && !applicant.preferences[assigned]) { delete item.assignments[assigned]; delete item.locks[assigned]; }
    $("signupDialog").close(); renderAll();
    notify(existing ? "이번 신청 정보를 수정했어요. 내 기본 정보는 그대로 유지됩니다." : "예시 모집방에 신청했어요. 방장 화면에서 편성을 확인해 보세요.");
  }

  function recommend(item) {
    const fixed = Object.fromEntries(SEATS.filter((seat) => item.locks[seat] && memberForSeat(item, seat)).map((seat) => [seat, item.assignments[seat]]));
    const fixedIds = new Set(Object.values(fixed));
    const freeSeats = SEATS.filter((seat) => !fixed[seat]);
    const candidates = item.applicants.filter((person) => !fixedIds.has(person.id)).sort((a, b) => a.order - b.order);
    let states = new Map([[0, { score: 0, assignments: {} }]]);
    for (const person of candidates) {
      const next = new Map(states);
      for (const [mask, state] of states) {
        freeSeats.forEach((seat, index) => {
          if ((mask & (1 << index)) || !person.preferences[seat]) return;
          const nextMask = mask | (1 << index);
          const score = state.score + (person.preferences[seat] === 2 ? 1 : 0);
          if (!next.has(nextMask) || score > next.get(nextMask).score) next.set(nextMask, { score, assignments: { ...state.assignments, [seat]: person.id } });
        });
      }
      states = next;
    }
    let best = { assignments: {}, score: -1 };
    for (const state of states.values()) if (Object.keys(state.assignments).length > Object.keys(best.assignments).length || (Object.keys(state.assignments).length === Object.keys(best.assignments).length && state.score > best.score)) best = state;
    item.assignments = { ...fixed, ...best.assignments };
    const preferred = SEATS.filter((seat) => memberForSeat(item, seat)?.preferences[seat] === 2).length;
    const missing = SEATS.filter((seat) => !memberForSeat(item, seat));
    lastSuggestion = `추천 완료 · ${count(item)}/8명 · 선호 자리 ${preferred}명${missing.length ? ` · ${missing.join(", ")} 배정 가능한 조합이 부족해요.` : " · 고정한 배정은 유지했어요."}`;
    notify(lastSuggestion);
    renderAll();
  }

  function copyParty() {
    const item = room();
    const text = [`${TRIALS[item.trial]} · 5클`, `${item.date} ${item.time}`, item.title, "", ...SEATS.map((seat) => `${seat} ${memberForSeat(item, seat)?.nickname || "모집 중"}`)].join("\n");
    if (!navigator.clipboard) return notify("이 브라우저에서는 클립보드 복사를 지원하지 않아요.");
    navigator.clipboard.writeText(text).then(() => notify("편성표를 복사했어요."), () => notify("복사 권한을 확인해 주세요."));
  }

  function attachEvents() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled) return;
      if (button.dataset.close) return $(button.dataset.close).close();
      if (button.dataset.view) return selectView(button.dataset.view);
      if (button.dataset.room) { selectedId = button.dataset.room; lastSuggestion = ""; renderAll(); return; }
      if (button.dataset.preference) {
        const target = button.dataset.target;
        const preferences = target === "profileSeats" ? profileDraft.preferences : signupPreferences;
        preferences[button.dataset.preference] = (preferences[button.dataset.preference] + 1) % 3;
        renderSeatOptions(target, preferences);
        $(target).querySelector(`[data-preference="${button.dataset.preference}"]`).focus({ preventScroll: true });
        if (target === "signupSeats") $("signupSeatSummary").innerHTML = `<div class="applicant-seats">${preferenceChips(preferences) || "가능한 자리를 하나 이상 선택해 주세요."}</div>`;
        return;
      }
      const item = room();
      if (button.dataset.lock) { if (item.status !== "open") return; item.locks[button.dataset.lock] = !item.locks[button.dataset.lock]; renderAll(); return; }
      switch (button.dataset.action) {
        case "profile": selectView("profile"); break;
        case "signup": if (profile) submitSignup(profile.preferences, profile.memo); else showSignup(); break;
        case "signup-edit": showSignup(); break;
        case "create": showCreate(); break;
        case "duplicate": showCreate(true); break;
        case "recommend": if (item.status === "open") recommend(item); break;
        case "confirm": if (count(item) === 8) { item.status = "confirmed"; lastSuggestion = ""; renderAll(); notify("예시 파티의 편성을 확정했어요."); } break;
        case "reopen": item.status = "open"; renderAll(); notify("편성을 다시 열었어요."); break;
        case "withdraw":
          if (item.status !== "open") return;
          item.applicants = item.applicants.filter((person) => person.id !== "local-me");
          SEATS.forEach((seat) => { if (item.assignments[seat] === "local-me") { delete item.assignments[seat]; delete item.locks[seat]; } });
          renderAll(); notify("예시 모집방의 신청을 취소했어요."); break;
        case "copy": copyParty(); break;
      }
      if (button.id === "accountButton") $("accountDialog").showModal();
    });
    $("profileForm").addEventListener("input", (event) => {
      if (["nickname", "server", "memo"].includes(event.target.id)) profileDraft[event.target.id] = event.target.value;
      if (event.target.dataset.wing !== undefined) {
        profileDraft.wings[Number(event.target.dataset.wing)] = event.target.checked;
        event.target.closest("label").querySelector("small").textContent = event.target.checked ? "보유" : "미보유";
        $("wingCount").textContent = profileDraft.wings.filter(Boolean).length;
      }
    });
    $("profileForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!SEATS.some((seat) => profileDraft.preferences[seat])) return notify("가능한 자리를 하나 이상 선택해 주세요.");
      let next;
      try { next = validateProfile(profileDraft); } catch { return notify("닉네임과 가능한 자리를 확인해 주세요."); }
      $("saveProfileButton").disabled = true;
      try {
        if (storageAvailable) {
          storage.setItem(PROFILE_KEY, JSON.stringify(next));
          if (window.SmallToolsVault) {
            await SmallToolsVault.flush();
            storageAvailable = SmallToolsVault.getStatus().mode !== "memory";
          }
        }
        profile = next; profileDraft = structuredClone(profile); renderAll(); selectView("rooms");
        notify(storageAvailable ? "내 정보를 이 브라우저에 저장했어요. 모집방에서 바로 신청해 보세요." : "이번 화면에 내 정보를 적용했어요. 브라우저 저장은 사용할 수 없습니다.");
      } catch { notify("내 정보를 저장하지 못했어요. 입력 내용은 그대로 유지됩니다."); }
      finally { $("saveProfileButton").disabled = false; }
    });
    $("signupForm").addEventListener("submit", (event) => {
      event.preventDefault();
      submitSignup(signupPreferences, $("signupMemo").value);
    });
    $("createForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const title = $("createTitle").value.trim();
      if (!title) return notify("모집 제목을 입력해 주세요.");
      const item = { id: `preview-${crypto.randomUUID()}`, trial: Number($("createTrial").value), title, date: $("createDate").value, time: $("createTime").value, description: $("createDescription").value.trim(), applicants: [], assignments: {}, locks: {}, status: "open" };
      rooms.unshift(item); selectedId = item.id; lastSuggestion = "";
      $("createDialog").close(); renderAll(); selectView("host"); notify("새 예시 모집방을 만들었어요.");
    });
    $("hostRoomSelect").addEventListener("change", (event) => { selectedId = event.target.value; lastSuggestion = ""; renderAll(); });
    document.addEventListener("change", (event) => {
      if (!event.target.dataset.assign) return;
      const item = room(); const seat = event.target.dataset.assign; const id = event.target.value;
      if (item.status !== "open" || item.locks[seat]) return;
      if (!id) delete item.assignments[seat];
      else {
        const oldSeat = assignedSeat(item, id);
        if (oldSeat && item.locks[oldSeat]) { renderAll(); return notify(`${oldSeat} 배정이 고정돼 있어요. 고정을 먼저 해제해 주세요.`); }
        if (oldSeat) delete item.assignments[oldSeat];
        item.assignments[seat] = id;
      }
      lastSuggestion = ""; renderAll();
    });
  }
  initialize();
})();
