(() => {
  "use strict";
  const core = globalThis.FarmPartyCore;
  const { TRIALS, SEATS } = core;
  const PROFILE_KEY = "small-tools:farm-party:profile:v1";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const emptyProfile = () => ({ nickname: "", server: "", memo: "", preferences: Object.fromEntries(SEATS.map(s => [s, 0])), wings: TRIALS.map(() => false) });
  const seatLabel = (seat) => '<span class="seat-label role-' + seat[0] + '">' + seat + '</span>';
  let profile = null, profileDraft = emptyProfile(), storage, storageAvailable = false, corruptStorage = false;
  let store, user, rooms = [], ownedRooms = [], selectedId = new URL(location.href).searchParams.get("r"), selectedRoom = null;
  let currentView = "rooms", busy = false, profileLoading = false, connected = false, listLoaded = false;
  let signupPreferences, signupRoomId, closeRoomId, toastTimer, accountGeneration = 0;
  let stopList = () => {}, stopOwned = () => {}, stopRoom = () => {};
  let roomMessage = "모집방을 불러오고 있어요.";
  const google = () => Boolean(store?.isGoogle(user));
  const room = () => selectedRoom;
  const uiRoom = (value) => ({ ...value, applicants: core.orderedApplicants(value) });
  const cacheKey = () => google() ? PROFILE_KEY + ":" + user.uid : PROFILE_KEY;
  function notify(message) { $("toast").textContent = message; $("toast").classList.add("visible"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 4500); }
  function errorMessage(error) {
    const messages = { "failed-precondition": "모집 목록을 준비 중이에요. 잠시 후 다시 연결해 주세요.", "permission-denied": "접근 권한을 확인하지 못했어요. 다시 연결해 주세요.", "unavailable": "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", "auth/network-request-failed": "로그인 서버에 연결하지 못했어요. 다시 연결해 주세요.", "auth/popup-blocked": "팝업을 허용한 뒤 다시 로그인해 주세요.", "auth/popup-closed-by-user": "로그인 창을 닫았어요.", "auth/unauthorized-domain": "이 주소의 로그인 설정을 확인해야 합니다.", "auth/operation-not-allowed": "Google 로그인 설정을 확인해야 합니다.", "auth/credential-already-in-use": "이미 연결된 계정이에요. 계정 전환 안내를 확인해 주세요.", "auth/email-already-in-use": "이미 연결된 계정이에요. 계정 전환 안내를 확인해 주세요." };
    return messages[error?.code] || error?.message || "작업을 완료하지 못했어요. 다시 시도해 주세요.";
  }
  function connection(message, failed = false) { $("connectionText").textContent = message; $("connectionStrip").classList.toggle("failed", failed); $("retryButton").hidden = !failed; }
  async function work(action, success) {
    if (busy) return; busy = true; renderAll();
    try { await action(); if (success) notify(success); }
    catch (error) { notify(errorMessage(error)); }
    finally { busy = false; renderAll(); }
  }
  function readCache(key) {
    const raw = storage?.getItem(key); if (!raw) return null;
    try { return core.profile(JSON.parse(raw)); }
    catch { storage?.setItem(key + ":recovery:" + Date.now(), raw); corruptStorage = true; notify("저장된 정보를 읽지 못했어요. 원본을 보존했습니다."); return null; }
  }
  async function writeCache(key, value) {
    if (!storageAvailable || corruptStorage) return false;
    storage.setItem(key, JSON.stringify(value));
    if (window.SmallToolsVault) { await SmallToolsVault.flush(); storageAvailable = SmallToolsVault.getStatus().mode !== "memory"; }
    return storageAvailable;
  }
  async function initialize() {
    try {
      if (window.SmallToolsVault) { await SmallToolsVault.ready; await SmallToolsVault.migrateKeys([PROFILE_KEY], { removeSource: true }); storage = SmallToolsVault.storage; storageAvailable = SmallToolsVault.getStatus().mode !== "memory"; }
      else { storage = localStorage; storageAvailable = true; }
      profile = readCache(PROFILE_KEY);
    } catch { storageAvailable = false; }
    if (profile) profileDraft = structuredClone(profile);
    $("createTrial").innerHTML = TRIALS.map((name, i) => '<option value="' + i + '">' + name + '</option>').join("");
    attachEvents(); renderProfile(); renderAll();
    await connect();
  }
  async function connect() {
    connection("모집방을 연결하고 있어요.");
    try {
      if (!store) { const { createFarmStore } = await import("./firebase-store.js?v=20261001-live"); store = await createFarmStore(globalThis.FarmPartyFirebaseConfig); store.subscribeAuth(onAccount); }
      else await onAccount(store.currentUser());
    } catch (error) { connected = false; connection(errorMessage(error), true); roomMessage = "모집방에 연결하지 못했어요. 내 정보는 계속 수정할 수 있습니다."; renderAll(); }
  }
  async function onAccount(nextUser) {
    const generation = ++accountGeneration, previousUser = user, previousProfile = profile;
    user = nextUser; stopList(); stopOwned(); stopRoom(); rooms = []; ownedRooms = []; selectedRoom = null; connected = false; listLoaded = false;
    if (!user) { renderAll(); return; }
    profileLoading = google();
    if (previousUser?.uid !== user.uid) profile = readCache(cacheKey());
    if (google() && previousUser?.uid === user.uid && previousUser?.isAnonymous) profile = previousProfile;
    profileDraft = profile ? structuredClone(profile) : emptyProfile(); renderProfile(); renderAll();
    const fail = (error) => { if (generation !== accountGeneration) return; connected = false; connection(errorMessage(error), true); renderAll(); };
    stopList = store.subscribeList((values) => {
      if (generation !== accountGeneration) return; rooms = values.map(uiRoom); listLoaded = true; connected = true; connection("모집방과 신청 현황을 실시간으로 연결했어요.");
      if (!selectedId && rooms.length) selectRoom(rooms[0].id); renderAll();
    }, fail);
    if (google()) stopOwned = store.subscribeList((values) => { if (generation !== accountGeneration) return; ownedRooms = values.map(uiRoom); if (currentView === "host" && (!selectedId || selectedRoom && selectedRoom.ownerUid !== user.uid) && ownedRooms.length) selectRoom(ownedRooms[0].id); renderAll(); }, fail, true);
    if (selectedId) selectRoom(selectedId, false);
    if (google()) {
      try {
        const saved = await store.loadProfile(); if (generation !== accountGeneration) return;
        if (saved) profile = saved;
        else if (profile) await store.saveProfile(profile);
        if (generation !== accountGeneration) return;
        if (profile) await writeCache(cacheKey(), profile);
        profileDraft = profile ? structuredClone(profile) : emptyProfile(); renderProfile();
      } catch (error) { if (generation === accountGeneration) notify("계정의 내 정보를 불러오지 못했어요. " + errorMessage(error)); }
      finally { if (generation === accountGeneration) { profileLoading = false; renderAll(); } }
    }
  }
  function selectRoom(id, updateURL = true) {
    stopRoom(); selectedRoom = null; selectedId = id; roomMessage = "모집방을 불러오고 있어요.";
    try { core.roomId(id); }
    catch { roomMessage = "모집방 주소가 올바르지 않아요. 목록에서 모집방을 선택해 주세요."; renderAll(); return; }
    if (updateURL) { const url = new URL(location.href); url.searchParams.set("r", id); history.replaceState(null, "", url); }
    const generation = accountGeneration;
    if (store && user) stopRoom = store.subscribeRoom(id, (value, metadata) => {
      if (generation !== accountGeneration || selectedId !== id) return;
      selectedRoom = value ? uiRoom(value) : null; roomMessage = value ? "" : "모집방을 찾지 못했어요. 공유 주소를 확인해 주세요.";
      if (metadata.fromCache) connection("최근 정보를 표시하고 있어요. 서버 연결을 확인 중입니다.");
      else if (connected) connection("모집방과 신청 현황을 실시간으로 연결했어요."); renderAll();
    }, (error) => { if (selectedId !== id || generation !== accountGeneration) return; selectedRoom = null; roomMessage = errorMessage(error); connection(roomMessage, true); renderAll(); });
    renderAll();
  }
  function memberForSeat(item, seat) { return item.applicants.find((person) => person.id === item.assignments[seat]); }
  function assignedSeat(item, id) { return SEATS.find((seat) => item.assignments[seat] === id); }
  function count(item) { return SEATS.filter((seat) => memberForSeat(item, seat)).length; }
  function dateLabel(item) {
    const date = new Date(`${item.date}T12:00:00+09:00`);
    const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "short" }).format(date);
    return `${item.date.slice(5).replace("-", ".")} (${weekday}) · ${item.time}`;
  }
  function statusTag(item) { return `<span class="status-tag ${item.status === "confirmed" ? "confirmed" : ""}">${item.status === "closed" ? "모집 종료" : item.status === "confirmed" ? "편성 확정" : "모집 중"}</span>`; }
  function preferenceChips(preferences) { return SEATS.filter((seat) => preferences[seat]).map((seat) => `<span class="${preferences[seat] === 2 ? "is-preferred" : ""}">${preferences[seat] === 2 ? "★ " : ""}${seat}</span>`).join(""); }

  function renderMyCard() {
    $("profileDot").classList.toggle("saved", !!profile);
    $("myCard").innerHTML = `<div class="card-eyebrow">MY ADVENTURER CARD<span class="local-tag">${google() ? "계정 저장" : "브라우저 저장"}</span></div>${profile ? `<div class="my-name-row"><span class="profile-avatar">${esc(Array.from(profile.nickname)[0])}</span><h2 id="myCardTitle">${esc(profile.nickname)}<small>${esc(profile.server || "나의 모험가 정보")}</small></h2></div><div class="mini-seats">${SEATS.filter((seat) => profile.preferences[seat]).map((seat) => `<span class="mini-seat ${profile.preferences[seat] === 2 ? "preferred" : ""}">${profile.preferences[seat] === 2 ? "★ " : ""}${seat}</span>`).join("")}</div><p>날개 ${profile.wings.filter(Boolean).length} / 7 보유 · 준비된 정보로 바로 신청</p>` : '<h2 id="myCardTitle">내 정보를 먼저 기록해요.</h2><p>닉네임, 가능한 자리, 날개 현황을<br>한 번 저장하면 다음 신청이 가벼워져요.</p>'}<button data-action="profile">${profile ? "내 정보 수정" : "내 정보 등록"}<span>↗</span></button>`;
  }

  function roomHeader(item) {
    return `<header class="room-head"><div class="room-topline"><p class="eyebrow">TRIAL ${String(item.trial + 1).padStart(2, "0")} / WING FARM</p>${statusTag(item)}</div><h2>${TRIALS[item.trial]}</h2><p class="room-title-sub">${esc(item.title)}</p><div class="room-meta"><span><i>◷</i><b>${dateLabel(item)}</b></span><span><i>↻</i><b>5클 반복</b></span><span><i>♧</i>8인 파티</span></div><div class="room-share"><button class="secondary-button" data-action="share">모집 링크 복사 ↗</button><button class="quiet-button" data-action="copy">편성표 복사</button></div><p class="room-description"><span>모집 안내</span>${esc(item.description || "5클 함께할 모험가를 모집합니다.")}</p></header>`;
  }

  function partyBoard(item, host = false) {
    const missing = SEATS.filter((seat) => !memberForSeat(item, seat));
    return `<section class="party-section"><div class="block-topline"><h3>파티 편성<span class="count-mono">${count(item)} / 8</span></h3><div class="role-key"><span><i class="tank-dot"></i>탱커</span><span><i class="healer-dot"></i>힐러</span><span><i class="dps-dot"></i>딜러</span></div></div><div class="party-grid">${SEATS.map((seat) => {
      const person = memberForSeat(item, seat);
      return `<div class="party-seat ${person ? "" : "empty"}">${seatLabel(seat)}${person?.preferences[seat] === 2 ? '<span class="preferred-mark" aria-label="선호 자리">★</span>' : ""}<h4>${person ? esc(person.nickname) : "함께할 모험가"}</h4><small>${person ? (person.wing ? "날개 보유" : "날개 미보유") : "아직 비어 있어요"}</small>${host ? `<div class="host-seat-controls"><select data-assign="${seat}" aria-label="${seat} 자리 배정" ${item.status !== "open" || item.locks[seat] || busy ? "disabled" : ""}><option value="">빈자리</option>${item.applicants.filter((candidate) => candidate.preferences[seat]).map((candidate) => `<option value="${esc(candidate.id)}" ${person?.id === candidate.id ? "selected" : ""}>${esc(candidate.nickname)}${candidate.preferences[seat] === 2 ? " ★" : ""}</option>`).join("")}</select><button class="lock-button ${item.locks[seat] ? "locked" : ""}" data-lock="${seat}" aria-label="${seat} 자리 ${item.locks[seat] ? "고정 해제" : "고정"}" aria-pressed="${Boolean(item.locks[seat])}" ${!person || item.status !== "open" || busy ? "disabled" : ""}>${item.locks[seat] ? "◆" : "◇"}</button></div>` : ""}</div>`;
    }).join("")}</div>${missing.length ? `<p class="empty-callout"><span>↗</span><span>아직 <b>${missing.join(" · ")}</b> 자리가 비어 있어요.${host ? " 신청자를 배정하거나 추천 편성을 실행해 보세요." : " 가능한 자리가 있다면 함께해 주세요."}</span></p>` : ""}</section>`;
  }

  function applicantsTable(item, host = false) {
    return `<table class="applicant-list"><thead><tr><th scope="col">모험가</th><th scope="col">가능한 자리 · ★ 선호</th>${host ? "" : '<th scope="col">날개</th>'}<th scope="col">${host ? "날개" : "배정"}</th></tr></thead><tbody>${item.applicants.map((person) => {
      const assigned = assignedSeat(item, person.id);
      return `<tr><td class="applicant-name">${esc(person.nickname)}${person.id === user?.uid ? '<span class="me-tag">나</span>' : ""}<small>${host ? (assigned ? `${assigned} ${item.status === "confirmed" ? "확정" : "배정"}` : "대기") : esc(person.server || "")}</small>${person.memo ? `<details class="applicant-memo"><summary>메모</summary><p>${esc(person.memo)}</p></details>` : ""}</td><td><div class="applicant-seats">${preferenceChips(person.preferences)}</div></td><td class="wing-status ${person.wing ? "owned" : ""}"><b>${person.wing ? "✦" : "○"}</b>${person.wing ? "보유" : "미보유"}</td>${host ? "" : `<td class="member-status ${assigned ? "" : "waiting"}">${assigned || "대기"}${assigned && item.status === "confirmed" ? " 확정" : ""}</td>`}</tr>`;
    }).join("") || `<tr><td colspan="${host ? 3 : 4}">첫 번째 신청을 기다리고 있어요.</td></tr>`}</tbody></table>`;
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

  function emptyPanel(title, text, action = "create", label = "＋ 새 모집방") {
    return `<div class="empty-panel"><p class="eyebrow">FARM PARTY</p><h2>${esc(title)}</h2><p>${esc(text)}</p><button class="primary-button" data-action="${action}">${label}</button></div>`;
  }
  function joinPanel(item) {
    const mine = item.applicants.find(p => p.id === user?.uid), assigned = mine && assignedSeat(item, mine.id);
    if (item.status !== "open") return `<section class="join-section"><div><h3>${item.status === "closed" ? "모집이 종료됐어요." : mine ? assigned ? `내 자리 ${assigned} · 편성 확정` : "이번 편성에서는 대기 상태예요." : "편성이 확정됐어요."}</h3><p>새 신청과 신청 변경을 받지 않습니다.</p></div></section>`;
    return `<section class="join-section"><div><h3>${mine ? assigned ? `${assigned} 배정 · 최종 확정을 기다려 주세요.` : "신청 완료 · 편성 대기" : profile ? `${esc(profile.nickname)}님, 저장된 정보로 신청하세요.` : "내 정보를 저장하고 신청하세요."}</h3><p>${mine ? "신청 정보는 내 기본 정보와 별도로 저장됩니다." : profile ? `이번 토벌전 날개 ${profile.wings[item.trial] ? "보유" : "미보유"} · 5클 모두 참여` : "닉네임·가능한 자리·날개를 같은 브라우저에서 불러옵니다."}</p></div><div class="join-actions">${mine ? '<button class="quiet-button" data-action="withdraw">신청 취소</button>' : profile ? '<button class="quiet-button" data-action="signup-edit">이번 신청만 변경</button>' : ""}<button class="primary-button" data-action="${mine ? "signup-edit" : "signup"}" ${busy || !connected || profileLoading ? "disabled" : ""}>${mine ? "내 신청 수정" : profile ? "이 정보로 5클 신청" : "내 정보 등록하고 신청"}<span>→</span></button></div></section>`;
  }
  function renderAccount() {
    $("accountButton").innerHTML = google() ? '계정 연결됨 <span>↗</span>' : '계정 연결 <span>↗</span>';
    $("storageStatus").textContent = google() ? "Google 계정에 내 정보 저장" : storageAvailable ? "내 정보는 이 브라우저에 저장" : "내 정보는 현재 화면에서만 유지";
    $("profileSaveNote").innerHTML = google() ? '<span>◉</span> Google 계정에 내 정보를 저장해요.<small>다른 기기에서도 같은 계정으로 불러올 수 있습니다.</small>' : '<span>◉</span> 이 정보는 같은 브라우저에 저장돼요.<small>사이트 데이터를 지우면 내 정보와 익명 신청의 수정 권한을 복구할 수 없어요.</small>';
    $("saveProfileButton").disabled = busy || profileLoading;
    const pending = store?.hasPendingAccount();
    $("accountContent").innerHTML = google() ? `<p><b>${esc(user.displayName || "Google 계정")}</b><br>${esc(user.email || "")}</p><p>내 정보와 내가 만든 모집방을 다른 기기에서도 불러올 수 있어요.</p><p class="signup-note">로그아웃하면 새 익명 참여자로 접속합니다. 기존 계정의 신청·모집방을 관리하려면 다시 로그인하세요.</p><button class="secondary-button full" data-action="logout" ${busy ? "disabled" : ""}>로그아웃</button>` : `<p>참여 신청은 로그인 없이 가능합니다. 방을 만들고 관리할 때는 Google 로그인이 필요해요.</p><p class="signup-note">계정을 연결하면 저장된 내 정보를 계정에도 저장합니다. 닉네임·자리·날개·신청 메모는 신청한 모집방에서 공개됩니다.</p>${pending ? '<div class="account-warning"><p>이미 사용 중인 Google 계정입니다. 전환하면 익명으로 한 기존 신청은 자동으로 옮겨지지 않습니다. 기존 신청은 전환 전에 취소해 주세요.</p><button class="primary-button full" data-action="switch-account">기존 계정으로 전환</button></div>' : `<button class="primary-button full" data-action="login" ${busy || !store ? "disabled" : ""}>Google로 연결</button>`}`;
  }
  function renderAll() {
    const item = room(); renderMyCard(); renderAccount();
    document.querySelectorAll('.room-sidebar > [data-action="create"], .host-toolbar > [data-action="create"]').forEach(button => button.disabled = busy);
    document.querySelectorAll('#signupForm button[type="submit"], #createForm button[type="submit"], #closeDialog [data-action]').forEach(button => button.disabled = busy);
    $("roomCount").textContent = rooms.length;
    $("roomList").innerHTML = rooms.map(candidate => `<button class="room-card ${candidate.id === selectedId ? "selected" : ""}" data-room="${esc(candidate.id)}" aria-pressed="${candidate.id === selectedId}"><div class="room-card-top"><span class="trial-number">TRIAL / ${String(candidate.trial + 1).padStart(2, "0")}</span>${statusTag(candidate)}</div><h3>${TRIALS[candidate.trial]}</h3><p><span>${dateLabel(candidate)}</span><strong>${count(candidate)}<small> / 8</small></strong></p><div class="tiny-progress"><span style="width:${count(candidate) / 8 * 100}%"></span></div></button>`).join("") || `<p class="empty-list">${listLoaded ? "모집 중인 파티가 없어요." : "모집 목록을 불러오는 중입니다."}</p>`;
    $("roomDetail").innerHTML = item ? `${roomHeader(item)}${partyBoard(item)}<section class="applicants-section"><div class="block-topline"><h3>신청한 모험가<span class="count-mono">${item.applicants.length}</span></h3><span>8인 초과 신청은 대기로 관리</span></div>${applicantsTable(item)}</section>${joinPanel(item)}` : emptyPanel(selectedId ? "모집방 확인" : "새 파티를 모집해 보세요.", selectedId ? roomMessage : listLoaded ? "새 모집방을 만들고 링크로 참여자를 초대하세요." : $("connectionText").textContent);
    $("hostRoomSelect").innerHTML = '<option value="">내 모집방 선택</option>' + ownedRooms.map(candidate => `<option value="${esc(candidate.id)}" ${candidate.id === selectedId ? "selected" : ""}>${candidate.status === "closed" ? "[종료] " : ""}${TRIALS[candidate.trial]} · ${dateLabel(candidate)}</option>`).join("");
    $("hostRoomSelect").disabled = !google() || busy;
    if (!google()) $("hostDetail").innerHTML = emptyPanel("방장 계정을 연결해 주세요.", "Google 계정으로 내가 만든 모집방을 관리할 수 있어요.", "account", "Google 계정 연결");
    else if (!item || item.ownerUid !== user.uid) $("hostDetail").innerHTML = emptyPanel("내 모집방을 선택해 주세요.", ownedRooms.length ? "위 목록에서 관리할 모집방을 선택하세요." : "새 모집방을 만들고 참여자를 모집하세요.");
    else $("hostDetail").innerHTML = `<div class="host-columns"><article class="room-detail">${roomHeader(item)}${partyBoard(item, true)}<div class="host-controls">${item.status === "open" ? `<button class="secondary-button" data-action="recommend">✦ 추천 편성</button><button class="primary-button" data-action="confirm" ${count(item) !== 8 ? "disabled" : ""}>편성 확정 →</button>` : item.status === "confirmed" ? '<button class="secondary-button" data-action="reopen">편성 다시 열기</button>' : '<p>종료한 모집방입니다.</p>'}${item.status !== "closed" ? '<button class="quiet-button" data-action="close">모집 종료</button>' : ""}</div></article><section class="panel host-applicants"><div class="block-topline"><h3>신청자 목록<span class="count-mono">${item.applicants.length}</span></h3><span>신청순</span></div>${applicantsTable(item, true)}<p class="host-hint">가능한 자리에서 8인 편성을 우선하고, 선호 자리를 최대한 반영합니다.<br>◇를 눌러 배정을 고정하면 다음 추천에서도 유지됩니다.<br>날개 보유 여부는 편성 우선순위에 반영하지 않습니다.</p><button class="new-room-button" data-action="duplicate">이 모집 설정으로 다음 회차 만들기 ↗</button></section></div>`;
    if (busy) document.querySelectorAll('[data-action]:not([data-action="profile"]):not([data-action="account"]), [data-assign], [data-lock], form button[type="submit"]').forEach(button => button.disabled = true);
  }
  function selectView(view, preserveRoom = false) {
    currentView = view;
    document.querySelectorAll(".nav-tab").forEach(tab => { const active = tab.dataset.view === view; tab.classList.toggle("active", active); if (active) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current"); });
    ["rooms", "profile", "host"].forEach(name => $(name + "View").hidden = name !== view);
    if (view === "profile") renderProfile();
    if (view === "host" && !preserveRoom && google() && ownedRooms.length && !ownedRooms.some(r => r.id === selectedId) && selectedRoom?.ownerUid !== user.uid) selectRoom(ownedRooms[0].id);
    renderAll();
  }
  async function loginWithDeadline() {
    let timeout;
    try { return await Promise.race([store.login(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("로그인 창을 진행하지 못했어요. 팝업 허용을 확인하고 다시 시도해 주세요.")), 60000); })]); }
    finally { clearTimeout(timeout); }
  }
  function showAccount() { renderAccount(); if (!$("accountDialog").open) $("accountDialog").showModal(); }
  function showSignup() {
    const item = room(); if (!item || item.status !== "open") return notify("신청 가능한 모집방을 선택해 주세요.");
    if (!profile) { selectView("profile"); $("nickname").focus(); return notify("내 정보를 저장한 뒤 신청해 주세요."); }
    const existing = item.applicants.find(p => p.id === user?.uid); signupRoomId = item.id;
    signupPreferences = { ...(existing?.preferences || profile.preferences) }; $("signupMemo").value = existing?.memo ?? profile.memo;
    $("signupSummary").innerHTML = `<div class="signup-card"><h3>${TRIALS[item.trial]}</h3><p>${dateLabel(item)} · 5클 모두 참여</p><dl class="signup-info"><dt>모험가</dt><dd>${esc(profile.nickname)}${profile.server ? ` @${esc(profile.server)}` : ""}</dd><dt>가능한 자리</dt><dd id="signupSeatSummary"><div class="applicant-seats">${preferenceChips(signupPreferences)}</div></dd><dt>날개</dt><dd>${profile.wings[item.trial] ? "✦ 보유" : "○ 미보유"}</dd></dl></div>`;
    renderSeatOptions("signupSeats", signupPreferences); document.querySelector(".signup-overrides").open = false;
    $("signupForm").querySelector('button[type="submit"]').innerHTML = `${existing ? "이 정보로 신청 수정" : "이 정보로 5클 신청"}<span>→</span>`;
    $("signupDialog").showModal();
  }
  function today() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); return ["year", "month", "day"].map(type => parts.find(p => p.type === type).value).join("-"); }
  function showCreate(duplicate = false) {
    if (!google()) { showAccount(); return; }
    const item = room(); $("createForm").reset(); $("createDate").value = today(); $("createTrial").value = duplicate && item ? item.trial : 0;
    $("createTitle").value = duplicate && item ? item.title : "5클 반복 파티 모집";
    $("createDescription").value = duplicate && item ? item.description : ""; if (duplicate && item) $("createTime").value = item.time;
    $("createDialog").showModal();
  }
  async function submitSignup(preferences, memo, id = selectedId) {
    if (!profile || profileLoading || !store || !connected) return notify("내 정보와 서버 연결을 확인해 주세요.");
    const item = room(); if (!item || item.id !== id) return notify("모집방이 바뀌었어요. 신청 화면을 다시 열어 주세요.");
    const snapshot = { nickname: profile.nickname, server: profile.server, preferences: { ...preferences }, wing: profile.wings[item.trial], memo: memo.trim() };
    await work(async () => { await store.apply(id, snapshot); $("signupDialog").close(); }, "신청 정보를 저장했어요.");
  }
  function manage(command) {
    const item = room(); if (!item || item.ownerUid !== user?.uid || !google()) return notify("방장만 편성을 변경할 수 있어요.");
    const id = item.id, revision = item.revision;
    return work(() => store.manage(id, command, revision), ({ recommend: "추천 편성을 저장했어요.", confirm: "편성을 확정했어요.", reopen: "편성을 다시 열었어요.", close: "모집을 종료했어요.", assign: "배정을 저장했어요.", lock: "자리 고정을 변경했어요." })[command.type]);
  }
  function copyText(text, message) { if (!navigator.clipboard) return notify("이 브라우저에서는 복사를 지원하지 않아요."); navigator.clipboard.writeText(text).then(() => notify(message), () => notify("복사 권한을 확인해 주세요.")); }
  function copyParty() {
    const item = room(); if (!item) return;
    copyText([`${TRIALS[item.trial]} · 5클`, `${item.date} ${item.time} (한국 시간)`, item.title, "", ...SEATS.map(seat => `${seat} ${memberForSeat(item, seat)?.nickname || "모집 중"}`)].join("\n"), "편성표를 복사했어요.");
  }
  function attachEvents() {
    $("retryButton").addEventListener("click", connect);
    window.addEventListener("popstate", () => { const id = new URL(location.href).searchParams.get("r"); if (id) selectRoom(id, false); else { stopRoom(); selectedId = null; selectedRoom = null; renderAll(); } });
    document.addEventListener("click", event => {
      const button = event.target.closest("button"); if (!button || button.disabled) return;
      if (button.dataset.close) return $(button.dataset.close).close();
      if (button.dataset.view) return selectView(button.dataset.view);
      if (button.dataset.room) return selectRoom(button.dataset.room);
      if (button.id === "accountButton") return showAccount();
      if (button.dataset.preference) {
        const target = button.dataset.target, preferences = target === "profileSeats" ? profileDraft.preferences : signupPreferences;
        preferences[button.dataset.preference] = (preferences[button.dataset.preference] + 1) % 3; renderSeatOptions(target, preferences);
        $(target).querySelector(`[data-preference="${button.dataset.preference}"]`).focus({ preventScroll: true });
        if (target === "signupSeats") $("signupSeatSummary").innerHTML = `<div class="applicant-seats">${preferenceChips(preferences) || "가능한 자리를 선택해 주세요."}</div>`; return;
      }
      if (button.dataset.lock) return manage({ type: "lock", seat: button.dataset.lock });
      const item = room();
      switch (button.dataset.action) {
        case "profile": return selectView("profile");
        case "account": return showAccount();
        case "signup": return profile ? submitSignup(profile.preferences, profile.memo) : showSignup();
        case "signup-edit": return showSignup();
        case "create": return showCreate();
        case "duplicate": return showCreate(true);
        case "recommend": case "confirm": case "reopen": return manage({ type: button.dataset.action });
        case "withdraw": if (item) return work(() => store.apply(item.id, null), "신청을 취소했어요."); return;
        case "close": if (item) { closeRoomId = item.id; $("closeDialog").showModal(); } return;
        case "finish-close": if (closeRoomId && item?.id === closeRoomId) return work(async () => { await store.manage(closeRoomId, { type: "close" }, item.revision); $("closeDialog").close(); }, "모집을 종료했어요."); return;
        case "copy": return copyParty();
        case "share": if (item) { const url = new URL(location.href); url.search = ""; url.hash = ""; url.searchParams.set("r", item.id); copyText(url.href, "모집 링크를 복사했어요."); } return;
        case "login": return work(async () => { await loginWithDeadline(); await onAccount(store.currentUser()); $("accountDialog").close(); }, "Google 계정을 연결했어요.");
        case "switch-account": return work(async () => { await store.switchAccount(); await onAccount(store.currentUser()); $("accountDialog").close(); }, "기존 계정으로 전환했어요.");
        case "logout": return work(async () => { await store.logout(); $("accountDialog").close(); }, "로그아웃했어요.");
      }
    });
    $("profileForm").addEventListener("input", event => {
      if (["nickname", "server", "memo"].includes(event.target.id)) profileDraft[event.target.id] = event.target.value;
      if (event.target.dataset.wing !== undefined) { profileDraft.wings[Number(event.target.dataset.wing)] = event.target.checked; event.target.closest("label").querySelector("small").textContent = event.target.checked ? "보유" : "미보유"; $("wingCount").textContent = profileDraft.wings.filter(Boolean).length; }
    });
    $("profileForm").addEventListener("submit", event => {
      event.preventDefault(); if (profileLoading) return;
      let next; try { next = core.profile(profileDraft); } catch (error) { return notify(error.message); }
      const generation = accountGeneration, key = cacheKey(), cloud = google();
      work(async () => {
        if (cloud) await store.saveProfile(next);
        const persisted = await writeCache(key, next);
        if (generation !== accountGeneration) return;
        profile = next; profileDraft = structuredClone(next); selectView("rooms");
        notify(cloud ? "내 정보를 계정에 저장했어요." : persisted ? "내 정보를 이 브라우저에 저장했어요." : "내 정보를 현재 화면에 적용했어요. 브라우저 저장은 사용할 수 없습니다.");
      });
    });
    $("signupForm").addEventListener("submit", event => { event.preventDefault(); submitSignup(signupPreferences, $("signupMemo").value, signupRoomId); });
    $("createForm").addEventListener("submit", event => {
      event.preventDefault(); const draft = { trial: Number($("createTrial").value), title: $("createTitle").value, date: $("createDate").value, time: $("createTime").value, description: $("createDescription").value };
      work(async () => { const id = await store.createRoom(draft); $("createDialog").close(); selectRoom(id); selectView("host", true); }, "모집방을 만들었어요. 모집 링크를 복사해 공유하세요.");
    });
    $("hostRoomSelect").addEventListener("change", event => { if (event.target.value) selectRoom(event.target.value); });
    document.addEventListener("change", event => { if (event.target.dataset.assign) manage({ type: "assign", seat: event.target.dataset.assign, uid: event.target.value }); });
  }
  initialize().catch(error => { connection(errorMessage(error), true); });
})();
