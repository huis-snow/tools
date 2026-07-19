const core = globalThis.EonjepyoOnlineCore;
const scheduleApi = globalThis.Eonjepyo;
const firebaseConfig = globalThis.EonjepyoFirebaseConfig;

if (!core || !scheduleApi) throw new Error("온라인 언제표를 시작하는 데 필요한 모듈을 불러오지 못했습니다.");

const elements = {
  setupNotice: document.querySelector("#onlineSetupNotice"),
  authCard: document.querySelector("#onlineAuthCard"),
  authTitle: document.querySelector("#onlineAuthTitle"),
  authDescription: document.querySelector("#onlineAuthDescription"),
  authStatus: document.querySelector("#onlineAuthStatus"),
  googleSignIn: document.querySelector("#onlineGoogleSignInButton"),
  googleSignOut: document.querySelector("#onlineGoogleSignOutButton"),
  ownedRoomsLink: document.querySelector("#onlineOwnedRoomsLink"),
  createForm: document.querySelector("#onlineRoomCreateForm"),
  createTitle: document.querySelector("#onlineCreateTitle"),
  createStartHour: document.querySelector("#onlineCreateStartHour"),
  createStartDay: document.querySelector("#onlineCreateStartDay"),
  createTimezone: document.querySelector("#onlineCreateTimezone"),
  createButton: document.querySelector("#onlineCreateButton"),
  createStatus: document.querySelector("#onlineCreateStatus"),
  ownedRoomsSection: document.querySelector("#onlineOwnedRoomsSection"),
  ownedRoomsTitle: document.querySelector("#onlineOwnedRoomsTitle"),
  ownedRoomCount: document.querySelector("#onlineOwnedRoomCount"),
  ownedRoomList: document.querySelector("#onlineOwnedRoomList"),
  ownedRoomsEmpty: document.querySelector("#onlineOwnedRoomsEmpty"),
  ownedRoomsStatus: document.querySelector("#onlineOwnedRoomsStatus"),
  ownedRoomsRefresh: document.querySelector("#onlineOwnedRoomsRefreshButton"),
  ownedRoomTemplate: document.querySelector("#onlineOwnedRoomTemplate"),
  workspace: document.querySelector("#onlineRoomWorkspace"),
  roomTitle: document.querySelector("#onlineRoomTitle"),
  roomMeta: document.querySelector("#onlineRoomMeta"),
  roomState: document.querySelector("#onlineRoomState"),
  roomParticipantCount: document.querySelector("#onlineRoomParticipantCount"),
  roomStatus: document.querySelector("#onlineRoomStatus"),
  roomCopy: document.querySelector("#onlineRoomCopyButton"),
  roomLock: document.querySelector("#onlineRoomLockButton"),
  roomDelete: document.querySelector("#onlineRoomDeleteButton"),
  roomOwnerNote: document.querySelector("#onlineRoomOwnerNote"),
  roomMissingActions: document.querySelector("#onlineRoomMissingActions"),
  saveResponse: document.querySelector("#onlineSaveResponseButton"),
  deleteResponse: document.querySelector("#onlineDeleteResponseButton"),
  responseStatus: document.querySelector("#onlineResponseStatus"),
  nickname: document.querySelector("#titleInput"),
  schedulePanel: document.querySelector("#onlineSchedulePanel"),
  participantList: document.querySelector("#participantList"),
  toast: document.querySelector("#toast"),
};

let store = null;
let currentRoomId = "";
let currentRoom = null;
let unsubscribeRoom = null;
let editorInitialized = false;
let editorDirty = false;
let ownResponseSignature = responseSignature(null);
let liveComparisonSignature = "";
let currentSnapshotMetadata = {};
let actionBusy = false;
let authBusy = false;
let ownedRoomsBusy = false;
let ownedRoomsRequest = 0;
let ownedRooms = [];
let focusRoomOnNextSnapshot = false;
let toastTimer = null;

function setStatus(element, message, state = "") {
  if (!element) return;
  element.textContent = message;
  if (state) element.dataset.state = state;
  else delete element.dataset.state;
}

function showToast(message) {
  if (!elements.toast) return;
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function shortTime(value = new Date()) {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(value);
  } catch (_error) {
    return "";
  }
}

function detectedTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
  } catch (_error) {
    return "Asia/Seoul";
  }
}

function populateCreateOptions() {
  for (let hour = 0; hour < scheduleApi.HOURS; hour += 1) {
    const option = document.createElement("option");
    option.value = String(hour);
    option.textContent = `${String(hour).padStart(2, "0")}:00${hour === 8 ? " · 추천" : ""}`;
    elements.createStartHour.append(option);
  }
  elements.createStartHour.value = "8";

  scheduleApi.DAYS.forEach((day, dayIndex) => {
    const option = document.createElement("option");
    option.value = String(dayIndex);
    option.textContent = `${day.full} 시작`;
    elements.createStartDay.append(option);
  });
  elements.createStartDay.value = "0";
  elements.createTimezone.value = detectedTimezone();
}

function firebaseErrorMessage(error, fallback = "Firebase 연결 중 문제가 생겼습니다.") {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) return "권한이 없습니다. 방이 잠겼거나 Firebase 보안 규칙을 확인해 주세요.";
  if (code.includes("google-sign-in-required")) return "온라인 방을 만들려면 Google 로그인이 필요합니다.";
  if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) return "Google 로그인을 취소했어요.";
  if (code.includes("popup-blocked")) return "Google 로그인 창이 차단됐어요. 팝업을 허용한 뒤 다시 시도해 주세요.";
  if (code.includes("unauthorized-domain")) return "이 주소에서는 Google 로그인을 사용할 수 없어요. Firebase 승인된 도메인을 확인해 주세요.";
  if (code.includes("operation-not-allowed")) return "Firebase Authentication에서 Google 로그인을 활성화해 주세요.";
  if (code.includes("credential-already-in-use") || code.includes("account-exists-with-different-credential")) {
    return "이 Google 계정은 이미 연결되어 있어요. 현재 익명 권한은 그대로 유지했습니다.";
  }
  if (code.includes("unauthenticated")) return "로그인 연결이 끊겼어요. 다시 로그인해 주세요.";
  if (code.includes("unavailable") || code.includes("network-request-failed") || code.includes("network")) {
    return "네트워크에 연결할 수 없습니다. 연결 상태를 확인해 주세요.";
  }
  if (code.includes("resource-exhausted")) return "오늘의 Firebase 무료 사용 한도를 초과했습니다.";
  if (code.includes("not-found")) return "온라인 방을 찾지 못했습니다.";
  return error?.message || fallback;
}

function waitForAppController() {
  if (globalThis.EonjepyoApp) return Promise.resolve(globalThis.EonjepyoApp);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("일정표 편집기를 시작하지 못했습니다.")), 5000);
    document.addEventListener("eonjepyo:app-ready", () => {
      window.clearTimeout(timeout);
      resolve(globalThis.EonjepyoApp);
    }, { once: true });
  });
}

function responseSignature(response) {
  return response
    ? `${response.nickname}\u0000${response.slots}`
    : `\u0000${scheduleApi.encodeSlots(scheduleApi.createSlots())}`;
}

function currentEditorSignature() {
  const schedule = globalThis.EonjepyoApp?.getSchedule?.();
  if (!schedule) return "";
  return `${schedule.title}\u0000${scheduleApi.encodeSlots(schedule.slots)}`;
}

function roomComparisonSignature(room, schedules) {
  return JSON.stringify([
    room.title,
    room.timezone,
    room.startHour,
    room.startDay,
    schedules.map((schedule) => [schedule.remoteId, schedule.title, schedule.slots]),
  ]);
}

function cleanRoomUrl(roomId = currentRoomId) {
  return core.makeRoomUrl(new URL("./room.html", window.location.href), roomId);
}

async function copyPlainText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.append(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function googleAccountConnected() {
  return Boolean(store?.isGoogleAccount?.());
}

function authDisplayName(user) {
  return String(user?.displayName || user?.email || "Google 사용자").trim();
}

function syncAuthControls(options = {}) {
  const user = store?.user || null;
  const googleConnected = googleAccountConnected();
  const hasRoom = Boolean(currentRoomId);

  elements.authCard.setAttribute("aria-busy", String(authBusy || !store));
  elements.googleSignIn.hidden = googleConnected;
  elements.googleSignIn.disabled = authBusy || actionBusy || !store;
  elements.googleSignOut.hidden = !googleConnected;
  elements.googleSignOut.disabled = authBusy || actionBusy;
  elements.ownedRoomsLink.hidden = !googleConnected || !hasRoom;
  elements.createButton.disabled = !store || !googleConnected || actionBusy || authBusy;
  elements.ownedRoomsSection.hidden = !googleConnected || hasRoom;
  elements.ownedRoomsSection.setAttribute("aria-busy", String(ownedRoomsBusy));
  elements.ownedRoomsRefresh.disabled = ownedRoomsBusy || authBusy || actionBusy;

  if (!store) {
    elements.authTitle.textContent = "로그인 상태를 확인하고 있어요";
    elements.authDescription.textContent = "링크로 참여할 때는 로그인하지 않아도 돼요.";
    if (options.preserveStatus !== true) {
      setStatus(elements.authStatus, "Firebase 인증 연결을 준비하고 있어요.");
    }
    return;
  }

  if (googleConnected) {
    elements.authTitle.textContent = `${authDisplayName(user)}님으로 로그인됨`;
    const email = String(user?.email || "").trim();
    elements.authDescription.textContent = email
      ? `${email} · 이름과 이메일은 방 참여자에게 공개되지 않아요.`
      : "Google 이름과 이메일은 방 참여자에게 공개되지 않아요.";
    if (options.preserveStatus !== true && !authBusy) {
      setStatus(
        elements.authStatus,
        hasRoom
          ? "이 계정으로 방장 권한을 확인하고 있어요."
          : "새 방을 만들고 내 온라인 방을 불러올 수 있어요.",
        "success",
      );
    }
    return;
  }

  elements.authTitle.textContent = "Google 로그인으로 방을 관리해요";
  elements.authDescription.textContent = hasRoom
    ? "참여자는 로그인 없이 입력할 수 있어요. 이 방의 방장이라면 Google로 로그인해 주세요."
    : user?.isAnonymous
      ? "기존 익명 권한을 유지한 채 Google 계정에 연결할 수 있어요."
      : "온라인 방을 만들고 다른 기기에서도 관리하려면 로그인해 주세요.";
  if (options.preserveStatus !== true && !authBusy) {
    setStatus(
      elements.authStatus,
      hasRoom
        ? "참여자로 익명 연결됐어요. Google 로그인은 방장에게만 필요합니다."
        : "방을 만들려면 Google 로그인이 필요합니다.",
      hasRoom ? "success" : "warning",
    );
  }
}

function roomDate(value) {
  if (typeof value?.toDate === "function") return value.toDate();
  if (Number.isFinite(value?.seconds)) return new Date(value.seconds * 1000);
  return null;
}

function formatRoomUpdated(value) {
  const date = roomDate(value);
  if (!date || Number.isNaN(date.getTime())) return "수정 시각 확인 중";
  try {
    return `${new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)} 수정`;
  } catch (_error) {
    return `${date.toLocaleString()} 수정`;
  }
}

function createOwnedRoomItem(room) {
  const fragment = elements.ownedRoomTemplate.content.cloneNode(true);
  const item = fragment.querySelector("li");
  const url = cleanRoomUrl(room.id).toString();
  const responseCount = Object.keys(room.responses).length;
  const state = item.querySelector("[data-field='state']");
  const title = item.querySelector("[data-field='title']");
  const openButton = item.querySelector("[data-action='open-button']");
  const copyButton = item.querySelector("[data-action='copy']");
  const updated = item.querySelector("[data-field='updated']");
  const updatedDate = roomDate(room.updatedAt);

  state.textContent = room.locked ? "입력 마감" : "입력 중";
  state.dataset.state = room.locked ? "locked" : "open";
  item.querySelector("[data-field='participants']").textContent = `${responseCount} / 8명`;
  title.textContent = room.title;
  openButton.href = url;
  openButton.setAttribute("aria-label", `‘${room.title}’ 온라인 방 열기`);
  copyButton.dataset.roomId = room.id;
  copyButton.setAttribute("aria-label", `‘${room.title}’ 온라인 방 링크 복사`);
  item.querySelector("[data-field='meta']").textContent =
    `${scheduleApi.DAYS[room.startDay].full}부터 · ${String(room.startHour).padStart(2, "0")}:00 시작 · ${room.timezone}`;
  updated.textContent = formatRoomUpdated(room.updatedAt);
  if (updatedDate && !Number.isNaN(updatedDate.getTime())) updated.dateTime = updatedDate.toISOString();
  return item;
}

function renderOwnedRooms() {
  elements.ownedRoomList.replaceChildren(...ownedRooms.map(createOwnedRoomItem));
  elements.ownedRoomCount.textContent = String(ownedRooms.length);
  elements.ownedRoomsEmpty.hidden = ownedRooms.length !== 0;
}

async function refreshOwnedRooms() {
  if (!store || !googleAccountConnected() || currentRoomId) return;
  const requestId = ++ownedRoomsRequest;
  const requestedUid = store.user?.uid || "";
  ownedRoomsBusy = true;
  elements.ownedRoomsSection.setAttribute("aria-busy", "true");
  syncAuthControls({ preserveStatus: true });
  setStatus(elements.ownedRoomsStatus, "내 온라인 방을 불러오고 있어요.");
  try {
    const nextRooms = await store.listOwnedRooms();
    if (requestId !== ownedRoomsRequest || requestedUid !== store.user?.uid || currentRoomId) return;
    ownedRooms = nextRooms;
    renderOwnedRooms();
    setStatus(
      elements.ownedRoomsStatus,
      ownedRooms.length
        ? `최근 온라인 방 ${ownedRooms.length}개를 불러왔어요.`
        : "Google 계정에 저장된 온라인 방이 아직 없어요.",
      ownedRooms.length ? "success" : "",
    );
  } catch (error) {
    if (requestId !== ownedRoomsRequest) return;
    const code = String(error?.code || "");
    const message = code.includes("permission-denied")
      ? "내 방 목록 권한이 아직 적용되지 않았어요. 저장소의 Firestore Rules를 배포해 주세요."
      : code.includes("failed-precondition")
        ? "내 방 목록 인덱스가 아직 준비되지 않았어요. 저장소의 Firestore 인덱스를 배포해 주세요."
        : firebaseErrorMessage(error, "내 온라인 방 목록을 불러오지 못했어요.");
    setStatus(elements.ownedRoomsStatus, message, "error");
  } finally {
    if (requestId === ownedRoomsRequest) {
      ownedRoomsBusy = false;
      elements.ownedRoomsSection.setAttribute("aria-busy", "false");
      syncAuthControls({ preserveStatus: true });
    }
  }
}

function focusOwnedRooms() {
  window.requestAnimationFrame(() => {
    elements.ownedRoomsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    elements.ownedRoomsTitle.focus({ preventScroll: true });
  });
}

function resetEditorForIdentityChange() {
  editorInitialized = false;
  editorDirty = false;
  ownResponseSignature = responseSignature(null);
  currentSnapshotMetadata = {};
}

async function applyIdentityChange(message) {
  resetEditorForIdentityChange();
  if (!googleAccountConnected()) {
    ownedRoomsRequest += 1;
    ownedRoomsBusy = false;
    ownedRooms = [];
    renderOwnedRooms();
  }
  syncAuthControls({ preserveStatus: true });
  setStatus(elements.authStatus, message, "success");
  if (currentRoomId) {
    subscribeToRoom(currentRoomId);
    return;
  }
  await refreshOwnedRooms();
}

async function reconcileIdentityAfterError(previousUid) {
  const nextUid = store?.user?.uid || "";
  if (nextUid === previousUid) return false;

  resetEditorForIdentityChange();
  ownedRoomsRequest += 1;
  ownedRoomsBusy = false;
  ownedRooms = [];
  renderOwnedRooms();
  syncAuthControls({ preserveStatus: true });

  if (currentRoomId && store.user) {
    subscribeToRoom(currentRoomId);
  } else if (currentRoomId) {
    globalThis.EonjepyoApp.setScheduleReadOnly(true);
    elements.saveResponse.disabled = true;
    elements.deleteResponse.disabled = true;
    setStatus(elements.responseStatus, "참여자 연결이 끊겼어요. 페이지를 새로고침해 다시 연결해 주세요.", "warning");
  } else if (googleAccountConnected()) {
    await refreshOwnedRooms();
  }
  return true;
}

function showCreateMode(options = {}) {
  unsubscribeRoom?.();
  unsubscribeRoom = null;
  currentRoomId = "";
  currentRoom = null;
  editorInitialized = false;
  editorDirty = false;
  ownResponseSignature = responseSignature(null);
  liveComparisonSignature = "";
  currentSnapshotMetadata = {};
  elements.createForm.hidden = false;
  elements.workspace.hidden = true;
  elements.roomMissingActions.hidden = true;
  document.body.classList.remove("is-room-owner");
  document.title = "온라인 취합방 만들기 | 언제표";
  syncAuthControls();
  if (googleAccountConnected()) {
    refreshOwnedRooms().finally(() => {
      if (options.focusOwnedRooms === true) focusOwnedRooms();
    });
  } else if (options.focusOwnedRooms === true) {
    setStatus(elements.authStatus, "내 온라인 방을 보려면 Google로 로그인해 주세요.", "warning");
    window.requestAnimationFrame(() => {
      elements.authCard.scrollIntoView({ behavior: "smooth", block: "center" });
      elements.googleSignIn.focus({ preventScroll: true });
    });
  }
  if (options.focus === true) {
    window.requestAnimationFrame(() => elements.createTitle.focus());
  }
}

function showWorkspaceLoading(roomId) {
  currentRoomId = roomId;
  currentRoom = null;
  liveComparisonSignature = "";
  currentSnapshotMetadata = {};
  focusRoomOnNextSnapshot = true;
  elements.createForm.hidden = true;
  elements.workspace.hidden = false;
  elements.workspace.setAttribute("aria-busy", "true");
  elements.roomTitle.textContent = "온라인 방 불러오는 중";
  elements.roomMeta.textContent = "잠시만 기다려 주세요.";
  elements.roomState.textContent = "연결 중";
  elements.roomState.dataset.state = "loading";
  elements.roomCopy.disabled = true;
  elements.roomLock.disabled = true;
  elements.roomDelete.disabled = true;
  elements.saveResponse.disabled = true;
  elements.roomMissingActions.hidden = true;
  setStatus(elements.roomStatus, "Firebase에서 방 정보를 확인하고 있어요.");
  syncAuthControls();
}

function syncParticipantRemoveButtons(isOwner) {
  elements.participantList?.querySelectorAll("[data-remote-participant-uid]").forEach((button) => {
    button.hidden = !isOwner;
    button.title = isOwner ? "방에서 이 응답 삭제" : "";
  });
}

function syncRoomControls(snapshotMetadata = currentSnapshotMetadata) {
  if (!currentRoom || !store) return;
  const user = store.user;
  const responseEntries = Object.entries(currentRoom.responses);
  const ownResponse = user ? currentRoom.responses[user.uid] || null : null;
  const isOwner = Boolean(user && currentRoom.ownerUid === user.uid);
  const isFull = responseEntries.length >= core.MAX_RESPONSES && !ownResponse;

  document.body.classList.toggle("is-room-owner", isOwner);
  elements.roomOwnerNote.hidden = !isOwner;
  if (isOwner) {
    elements.roomOwnerNote.textContent = googleAccountConnected()
      ? "이 Google 계정이 방장입니다. 잘못 들어온 응답을 아래 참여자 목록에서 삭제하고, 일정이 끝난 방은 직접 정리해 주세요."
      : "이 브라우저의 기존 익명 권한이 방장입니다. 위에서 Google로 로그인하면 이 방을 계정에 연결할 수 있어요.";
  }
  elements.roomLock.hidden = !isOwner;
  elements.roomDelete.hidden = !isOwner;
  elements.roomLock.textContent = currentRoom.locked ? "방 다시 열기" : "입력 마감";
  elements.roomLock.disabled = actionBusy || authBusy;
  elements.roomDelete.disabled = actionBusy || authBusy;
  elements.roomCopy.disabled = actionBusy || authBusy;

  elements.saveResponse.disabled = actionBusy || authBusy || !user || currentRoom.locked || isFull;
  elements.deleteResponse.disabled = actionBusy || authBusy || !ownResponse || (currentRoom.locked && !isOwner);
  elements.deleteResponse.hidden = !ownResponse;
  globalThis.EonjepyoApp.setScheduleReadOnly(currentRoom.locked || !user);

  if (currentRoom.locked) {
    setStatus(elements.responseStatus, isOwner
      ? "입력이 마감됐어요. 방을 다시 열면 일정을 수정할 수 있어요."
      : "방장이 입력을 마감했어요. 현재 일정은 읽기만 할 수 있어요.", "warning");
  } else if (isFull) {
    setStatus(elements.responseStatus, "참여 인원 8명이 모두 찼어요. 방장에게 기존 응답 정리를 요청해 주세요.", "warning");
  } else if (editorDirty) {
    setStatus(elements.responseStatus, "저장하지 않은 변경사항이 있어요.", "warning");
  } else if (ownResponse) {
    setStatus(elements.responseStatus, "이 브라우저의 일정이 서버에 저장되어 있어요.", "success");
  } else {
    setStatus(elements.responseStatus, "닉네임과 가능한 시간을 입력한 뒤 서버에 저장해 주세요.");
  }

  if (snapshotMetadata.hasPendingWrites) {
    setStatus(elements.roomStatus, "변경 내용을 Firebase에 저장하고 있어요.");
  } else if (snapshotMetadata.fromCache) {
    setStatus(elements.roomStatus, "서버 연결을 확인하고 있어요. 잠시 이전 데이터가 보일 수 있습니다.", "warning");
  } else {
    setStatus(elements.roomStatus, `동기화됨 · ${shortTime()}`, "success");
  }
  syncParticipantRemoveButtons(isOwner);
  syncAuthControls({ preserveStatus: true });
}

function applyRoomSnapshot(payload) {
  if (payload?.missingFromCache) {
    elements.workspace.setAttribute("aria-busy", "true");
    elements.roomState.textContent = "연결 대기";
    elements.roomState.dataset.state = "loading";
    elements.roomCopy.disabled = true;
    elements.saveResponse.disabled = true;
    elements.roomMissingActions.hidden = true;
    setStatus(elements.roomStatus, "이 브라우저에 저장된 방 정보가 없어 서버 연결을 기다리고 있어요.", "warning");
    globalThis.EonjepyoApp.setScheduleReadOnly(true);
    return;
  }

  if (!payload) {
    currentRoom = null;
    editorDirty = false;
    ownResponseSignature = responseSignature(null);
    liveComparisonSignature = "";
    currentSnapshotMetadata = {};
    elements.workspace.setAttribute("aria-busy", "false");
    elements.roomTitle.textContent = "방을 찾지 못했어요";
    elements.roomMeta.textContent = "주소가 잘못됐거나 방장이 삭제한 방입니다.";
    elements.roomParticipantCount.textContent = "0";
    elements.roomState.textContent = "종료됨";
    elements.roomState.dataset.state = "error";
    elements.roomCopy.disabled = true;
    elements.roomLock.hidden = true;
    elements.roomDelete.hidden = true;
    elements.roomOwnerNote.hidden = true;
    elements.saveResponse.disabled = true;
    elements.deleteResponse.hidden = true;
    elements.roomMissingActions.hidden = false;
    document.body.classList.remove("is-room-owner");
    setStatus(elements.roomStatus, "새 온라인 방을 만들거나 방장에게 새 링크를 받아 주세요.", "error");
    globalThis.EonjepyoApp.setScheduleReadOnly(true);
    globalThis.EonjepyoApp.replaceComparisonSchedules([], {
      title: "종료된 온라인 방",
      startHour: 8,
      startDay: 0,
    });
    if (focusRoomOnNextSnapshot) {
      focusRoomOnNextSnapshot = false;
      elements.roomTitle.focus();
    }
    return;
  }

  currentRoom = payload.room;
  currentSnapshotMetadata = payload;
  const responses = currentRoom.responses;
  const responseCount = Object.keys(responses).length;
  const ownResponse = store.user ? responses[store.user.uid] || null : null;
  const nextOwnSignature = responseSignature(ownResponse);

  elements.workspace.setAttribute("aria-busy", "false");
  elements.roomTitle.textContent = currentRoom.title;
  elements.roomMeta.textContent = `${currentRoom.timezone} · ${String(currentRoom.startHour).padStart(2, "0")}:00 시작 · ${scheduleApi.DAYS[currentRoom.startDay].full}부터`;
  elements.roomParticipantCount.textContent = String(responseCount);
  elements.roomState.textContent = currentRoom.locked ? "입력 마감" : "입력 중";
  elements.roomState.dataset.state = currentRoom.locked ? "locked" : "open";
  document.title = `${currentRoom.title} | 온라인 언제표`;
  elements.roomMissingActions.hidden = true;

  if (!editorInitialized || (!editorDirty && ownResponseSignature !== nextOwnSignature)) {
    globalThis.EonjepyoApp.applySchedule({
      title: ownResponse?.nickname || "",
      slots: ownResponse?.slots || scheduleApi.createSlots(),
      timezone: currentRoom.timezone,
      startHour: currentRoom.startHour,
      startDay: currentRoom.startDay,
    });
    globalThis.EonjepyoApp.setScheduleConfigurationLocked(true);
    editorInitialized = true;
    editorDirty = false;
  }
  ownResponseSignature = nextOwnSignature;

  const schedules = core.roomSchedules(currentRoom).sort((left, right) =>
    left.title.localeCompare(right.title, "ko") || left.remoteId.localeCompare(right.remoteId));
  const nextComparisonSignature = roomComparisonSignature(currentRoom, schedules);
  if (liveComparisonSignature !== nextComparisonSignature) {
    globalThis.EonjepyoApp.replaceComparisonSchedules(schedules, {
      title: currentRoom.title,
      startHour: currentRoom.startHour,
      startDay: currentRoom.startDay,
      preserveView: Boolean(liveComparisonSignature),
    });
    liveComparisonSignature = nextComparisonSignature;
  }
  syncRoomControls(payload);
  if (focusRoomOnNextSnapshot) {
    focusRoomOnNextSnapshot = false;
    elements.roomTitle.focus();
  }
}

function subscribeToRoom(roomId) {
  unsubscribeRoom?.();
  showWorkspaceLoading(roomId);
  unsubscribeRoom = store.subscribeRoom(roomId, applyRoomSnapshot, (error) => {
    elements.workspace.setAttribute("aria-busy", "false");
    elements.roomState.textContent = "연결 오류";
    elements.roomState.dataset.state = "error";
    elements.roomLock.disabled = true;
    elements.roomDelete.disabled = true;
    elements.saveResponse.disabled = true;
    elements.deleteResponse.disabled = true;
    elements.roomMissingActions.hidden = false;
    setStatus(elements.roomStatus, firebaseErrorMessage(error), "error");
    setStatus(elements.responseStatus, "서버 연결을 복구한 뒤 다시 입력해 주세요.", "warning");
    globalThis.EonjepyoApp.setScheduleReadOnly(true);
  });
}

async function runAction(action, statusElement = elements.roomStatus, pendingMessage = "") {
  if (actionBusy) return false;
  actionBusy = true;
  syncRoomControls();
  if (pendingMessage) setStatus(statusElement, pendingMessage);
  let failureMessage = "";
  try {
    await action();
    return true;
  } catch (error) {
    failureMessage = firebaseErrorMessage(error);
    showToast(failureMessage);
    return false;
  } finally {
    actionBusy = false;
    syncRoomControls();
    syncAuthControls({ preserveStatus: true });
    if (failureMessage) setStatus(statusElement, failureMessage, "error");
  }
}

function syncEditorDirty() {
  if (!editorInitialized || currentRoom?.locked) return;
  const nextDirty = currentEditorSignature() !== ownResponseSignature;
  if (editorDirty !== nextDirty) {
    editorDirty = nextDirty;
    syncRoomControls();
  }
}

function queueEditorDirtyCheck() {
  if (typeof window.queueMicrotask === "function") {
    window.queueMicrotask(syncEditorDirty);
    return;
  }
  Promise.resolve().then(syncEditorDirty);
}

async function initialize() {
  populateCreateOptions();
  await waitForAppController();
  globalThis.EonjepyoApp.setScheduleConfigurationLocked(true);
  globalThis.EonjepyoApp.setScheduleReadOnly(true);
  const requestParameters = new URLSearchParams(window.location.search);
  const requestedRoom = requestParameters.get("r");
  const requestedOwnedRooms = !requestedRoom && requestParameters.get("view") === "mine";

  if (!core.firebaseConfigReady(firebaseConfig)) {
    elements.setupNotice.hidden = false;
    elements.createButton.disabled = true;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결이 필요합니다";
    elements.authDescription.textContent = "공개 웹 설정과 Authentication 공급자를 먼저 연결해 주세요.";
    setStatus(elements.createStatus, "Firebase 공개 웹 설정을 연결하면 온라인 방을 만들 수 있어요.", "warning");
    setStatus(elements.authStatus, "Firebase 공개 웹 설정을 먼저 연결해 주세요.", "warning");
    if (requestedRoom) {
      elements.createForm.hidden = true;
      elements.workspace.hidden = true;
    }
    return;
  }

  try {
    setStatus(
      elements.createStatus,
      requestedRoom ? "Firebase 참여자 연결을 준비하고 있어요." : "Google 로그인 상태를 확인하고 있어요.",
    );
    const { createFirebaseRoomStore } = await import("./firebase-room-store.js");
    store = await createFirebaseRoomStore(firebaseConfig, { ensureAnonymous: Boolean(requestedRoom) });
    syncAuthControls();
    setStatus(
      elements.createStatus,
      googleAccountConnected()
        ? "온라인 방을 만들 준비가 됐어요."
        : "방을 만들려면 위에서 Google로 로그인해 주세요.",
      googleAccountConnected() ? "success" : "warning",
    );
  } catch (error) {
    elements.setupNotice.hidden = false;
    elements.createButton.disabled = true;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "로그인 연결을 시작하지 못했어요";
    elements.authDescription.textContent = "Firebase 설정과 네트워크 상태를 확인해 주세요.";
    setStatus(elements.createStatus, firebaseErrorMessage(error), "error");
    setStatus(elements.authStatus, firebaseErrorMessage(error), "error");
    return;
  }

  if (!requestedRoom) {
    showCreateMode({ focusOwnedRooms: requestedOwnedRooms });
    if (requestedOwnedRooms) {
      window.history.replaceState(null, "", new URL("./room.html", window.location.href).toString());
    }
    return;
  }
  try {
    subscribeToRoom(core.validateRoomId(requestedRoom));
  } catch (error) {
    showCreateMode({ focus: true });
    setStatus(elements.createStatus, error.message, "error");
  }
}

elements.googleSignIn.addEventListener("click", async () => {
  if (!store || authBusy || actionBusy || googleAccountConnected()) return;
  if (editorDirty && !window.confirm("저장하지 않은 시간 선택이 있어요. 저장하지 않고 Google 로그인을 진행할까요?")) {
    return;
  }

  const previousUid = store.user?.uid || "";
  const wasAnonymous = Boolean(store.user?.isAnonymous);
  let switchedGoogleAccount = false;
  authBusy = true;
  syncAuthControls({ preserveStatus: true });
  syncRoomControls();
  setStatus(
    elements.authStatus,
    wasAnonymous ? "현재 익명 권한을 유지하며 Google 계정에 연결하고 있어요." : "Google 로그인 창을 열고 있어요.",
  );

  try {
    try {
      await store.signInCreatorWithGoogle();
    } catch (error) {
      if (!store.hasPendingGoogleAccount()) throw error;
      const anonymousUser = store.user;
      const ownsCurrentRoom = Boolean(
        wasAnonymous && anonymousUser && currentRoom?.ownerUid === anonymousUser.uid,
      );
      const hasCurrentResponse = Boolean(
        wasAnonymous && anonymousUser && currentRoom?.responses?.[anonymousUser.uid],
      );
      if (ownsCurrentRoom || hasCurrentResponse) {
        store.clearPendingGoogleAccount();
        const protectedData = ownsCurrentRoom ? "방장 권한" : "저장한 응답";
        window.alert(
          `현재 익명 계정에 이 방의 ${protectedData}이 연결되어 있어요.\n\n`
          + "이미 사용 중인 Google 계정으로 전환하면 이 권한을 복구할 수 없어서 전환을 중단했습니다. "
          + "아직 언제표에 연결하지 않은 다른 Google 계정을 선택해 주세요.",
        );
        setStatus(
          elements.authStatus,
          `익명 ${protectedData}을 보호하기 위해 Google 계정 전환을 중단했어요.`,
          "warning",
        );
        return;
      }
      const confirmed = window.confirm(
        "이 Google 계정은 이미 언제표에서 사용 중입니다.\n\n"
        + "계정을 전환하면 이 브라우저의 기존 익명 방장 권한과 익명 응답을 더 이상 수정할 수 없고 복구할 수 없습니다. "
        + "기존 Google 계정으로 전환할까요?",
      );
      if (!confirmed) {
        store.clearPendingGoogleAccount();
        setStatus(elements.authStatus, "계정 전환을 취소했어요. 기존 익명 권한은 그대로 유지됩니다.", "warning");
        return;
      }
      await store.switchToPendingGoogleAccount();
      switchedGoogleAccount = true;
    }

    await applyIdentityChange(
      switchedGoogleAccount
        ? "기존 Google 계정으로 전환했어요."
        : wasAnonymous
        ? "기존 권한을 유지하며 Google 계정에 연결했어요."
        : "Google 계정으로 로그인했어요.",
    );
    setStatus(elements.createStatus, "온라인 방을 만들 준비가 됐어요.", "success");
    showToast(
      switchedGoogleAccount
        ? "기존 Google 계정으로 전환했어요"
        : wasAnonymous
          ? "Google 계정에 기존 권한을 연결했어요"
          : "Google 계정으로 로그인했어요",
    );
    if (!currentRoomId) window.requestAnimationFrame(() => elements.createTitle.focus());
  } catch (error) {
    try {
      await reconcileIdentityAfterError(previousUid);
    } catch (_identityError) {
      // 원래 인증 오류를 유지하고, 현재 사용자 상태는 finally에서 다시 그린다.
    }
    setStatus(elements.authStatus, firebaseErrorMessage(error, "Google 로그인에 실패했어요."), "error");
  } finally {
    authBusy = false;
    syncAuthControls({ preserveStatus: true });
    syncRoomControls();
  }
});

elements.googleSignOut.addEventListener("click", async () => {
  if (!store || authBusy || actionBusy || !googleAccountConnected()) return;
  const user = store.user;
  const previousUid = user?.uid || "";
  const ownsCurrentRoom = Boolean(currentRoom && user && currentRoom.ownerUid === user.uid);
  const hasCurrentResponse = Boolean(currentRoom && user && currentRoom.responses[user.uid]);
  if (currentRoomId && (ownsCurrentRoom || hasCurrentResponse || editorDirty)) {
    const confirmed = window.confirm(
      ownsCurrentRoom
        ? "로그아웃하면 이 방의 방장 관리 버튼이 사라집니다. Google로 다시 로그인하면 복구할 수 있어요. 로그아웃할까요?"
        : "로그아웃하면 이 Google 계정으로 저장한 현재 방의 응답을 수정할 수 없어요. 로그아웃할까요?",
    );
    if (!confirmed) return;
  }

  authBusy = true;
  unsubscribeRoom?.();
  unsubscribeRoom = null;
  syncAuthControls({ preserveStatus: true });
  syncRoomControls();
  setStatus(elements.authStatus, "Google 계정에서 로그아웃하고 있어요.");
  try {
    await store.signOutCreator({ ensureAnonymous: Boolean(currentRoomId) });
    await applyIdentityChange(
      currentRoomId
        ? "Google 계정에서 로그아웃하고 익명 참여자로 다시 연결했어요."
        : "Google 계정에서 로그아웃했어요.",
    );
    if (!currentRoomId) {
      setStatus(elements.createStatus, "방을 만들려면 위에서 Google로 로그인해 주세요.", "warning");
      window.requestAnimationFrame(() => elements.googleSignIn.focus());
    }
    showToast("Google 계정에서 로그아웃했어요");
  } catch (error) {
    let reconciled = false;
    try {
      reconciled = await reconcileIdentityAfterError(previousUid);
    } catch (_identityError) {
      // 원래 로그아웃 오류를 유지한다.
    }
    if (!reconciled && currentRoomId && store.user) subscribeToRoom(currentRoomId);
    setStatus(elements.authStatus, firebaseErrorMessage(error, "로그아웃하지 못했어요."), "error");
  } finally {
    authBusy = false;
    syncAuthControls({ preserveStatus: true });
    syncRoomControls();
  }
});

elements.ownedRoomsRefresh.addEventListener("click", () => {
  refreshOwnedRooms();
});

elements.ownedRoomList.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-action='copy']");
  if (!copyButton) return;
  const room = ownedRooms.find((candidate) => candidate.id === copyButton.dataset.roomId);
  if (!room) return;
  copyButton.disabled = true;
  try {
    await copyPlainText(cleanRoomUrl(room.id).toString());
    setStatus(elements.ownedRoomsStatus, `‘${room.title}’ 방 링크를 복사했어요.`, "success");
    showToast("온라인 방 링크를 복사했어요");
  } catch (_error) {
    setStatus(elements.ownedRoomsStatus, "방 링크를 복사하지 못했어요.", "error");
  } finally {
    copyButton.disabled = false;
  }
});

elements.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || actionBusy) return;
  if (!googleAccountConnected()) {
    setStatus(elements.createStatus, "온라인 방을 만들려면 Google로 로그인해 주세요.", "warning");
    elements.googleSignIn.focus();
    return;
  }
  let draft;
  try {
    draft = core.normalizeRoomDraft({
      title: elements.createTitle.value,
      timezone: elements.createTimezone.value,
      startHour: elements.createStartHour.value,
      startDay: elements.createStartDay.value,
    });
    elements.createTitle.removeAttribute("aria-invalid");
  } catch (error) {
    if (!elements.createTitle.value.trim()) {
      elements.createTitle.setAttribute("aria-invalid", "true");
      elements.createTitle.focus();
    }
    setStatus(elements.createStatus, error.message, "error");
    return;
  }

  elements.createButton.disabled = true;
  setStatus(elements.createStatus, "온라인 방을 만들고 있어요.");
  const success = await runAction(async () => {
    const roomId = await store.createRoom(draft);
    window.history.replaceState(null, "", cleanRoomUrl(roomId).toString());
    subscribeToRoom(roomId);
    showToast("온라인 취합방을 만들었어요");
  }, elements.createStatus, "온라인 방을 만들고 있어요.");
  if (!success) syncAuthControls({ preserveStatus: true });
});

elements.roomCopy.addEventListener("click", async () => {
  if (!currentRoomId) return;
  try {
    await copyPlainText(cleanRoomUrl().toString());
    showToast("8명에게 보낼 온라인 방 링크를 복사했어요");
    setStatus(elements.roomStatus, "온라인 방 링크를 복사했어요.", "success");
  } catch (_error) {
    setStatus(elements.roomStatus, "방 링크를 복사하지 못했어요.", "error");
  }
});

elements.saveResponse.addEventListener("click", async () => {
  if (!store || !currentRoom || currentRoom.locked) return;
  const schedule = globalThis.EonjepyoApp.getSchedule();
  let response;
  try {
    response = core.normalizeResponse({
      nickname: schedule.title,
      slots: scheduleApi.encodeSlots(schedule.slots),
    });
    elements.nickname.removeAttribute("aria-invalid");
  } catch (error) {
    if (!schedule.title) {
      elements.nickname.setAttribute("aria-invalid", "true");
      elements.nickname.focus();
    }
    setStatus(elements.responseStatus, error.message, "error");
    return;
  }
  setStatus(elements.responseStatus, "내 일정을 Firebase에 저장하고 있어요.");
  const success = await runAction(
    () => store.saveResponse(currentRoomId, response),
    elements.responseStatus,
    "내 일정을 Firebase에 저장하고 있어요.",
  );
  if (success) {
    const savedSignature = responseSignature(response);
    ownResponseSignature = savedSignature;
    editorDirty = currentEditorSignature() !== savedSignature;
    syncRoomControls();
    if (editorDirty) {
      setStatus(elements.responseStatus, "저장하는 동안 바꾼 내용이 남아 있어요. 한 번 더 저장해 주세요.", "warning");
      showToast("저장 후 바뀐 내용은 한 번 더 저장해 주세요");
    } else {
      setStatus(elements.responseStatus, "내 일정을 서버에 저장했어요.", "success");
      showToast("취합표에 내 일정을 반영했어요");
    }
  }
});

elements.deleteResponse.addEventListener("click", async () => {
  const user = store?.user;
  if (!user || !currentRoom?.responses?.[user.uid]) return;
  if (!window.confirm("이 온라인 방에서 내 일정을 삭제할까요?")) return;
  const isOwner = currentRoom.ownerUid === user.uid;
  const success = await runAction(
    () => store.removeResponse(currentRoomId, user.uid, { asOwner: isOwner }),
    elements.responseStatus,
    "온라인 방에서 내 일정을 삭제하고 있어요.",
  );
  if (success) {
    editorDirty = false;
    ownResponseSignature = responseSignature(null);
    globalThis.EonjepyoApp.applySchedule({
      title: "",
      slots: scheduleApi.createSlots(),
      timezone: currentRoom.timezone,
      startHour: currentRoom.startHour,
      startDay: currentRoom.startDay,
    });
    globalThis.EonjepyoApp.setScheduleConfigurationLocked(true);
    showToast("온라인 방에서 내 일정을 삭제했어요");
  }
});

elements.roomLock.addEventListener("click", async () => {
  const user = store?.user;
  if (!user || !currentRoom || currentRoom.ownerUid !== user.uid) return;
  const nextLocked = !currentRoom.locked;
  const success = await runAction(
    () => store.updateRoom(currentRoomId, { locked: nextLocked }),
    elements.roomStatus,
    nextLocked ? "추가 입력을 마감하고 있어요." : "온라인 방을 다시 열고 있어요.",
  );
  if (success) showToast(nextLocked ? "추가 입력을 마감했어요" : "온라인 방을 다시 열었어요");
});

elements.roomDelete.addEventListener("click", async () => {
  const user = store?.user;
  if (!user || !currentRoom || currentRoom.ownerUid !== user.uid) return;
  if (!window.confirm(`'${currentRoom.title}' 온라인 방과 8명까지의 응답을 모두 삭제할까요?`)) return;
  const success = await runAction(
    () => store.removeRoom(currentRoomId),
    elements.roomStatus,
    "온라인 방을 삭제하고 있어요.",
  );
  if (!success) return;
  window.history.replaceState(null, "", new URL("./room.html", window.location.href).toString());
  showCreateMode({ focus: true });
  setStatus(elements.createStatus, "온라인 방을 삭제했어요. 새 방을 만들 수 있습니다.", "success");
  showToast("온라인 방을 삭제했어요");
});

elements.participantList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remote-participant-uid]");
  const user = store?.user;
  if (!button || !user || currentRoom?.ownerUid !== user.uid) return;
  const uid = button.dataset.remoteParticipantUid;
  const response = currentRoom.responses[uid];
  if (!response || !window.confirm(`'${response.nickname}' 응답을 이 방에서 삭제할까요?`)) return;
  const success = await runAction(
    () => store.removeResponse(currentRoomId, uid, { asOwner: true }),
    elements.roomStatus,
    `${response.nickname} 응답을 삭제하고 있어요.`,
  );
  if (success) showToast(`${response.nickname} 응답을 삭제했어요`);
});

elements.schedulePanel.addEventListener("input", queueEditorDirtyCheck);
elements.schedulePanel.addEventListener("change", queueEditorDirtyCheck);
elements.schedulePanel.addEventListener("click", queueEditorDirtyCheck);
elements.schedulePanel.addEventListener("pointerup", queueEditorDirtyCheck);
elements.schedulePanel.addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") queueEditorDirtyCheck();
});

window.addEventListener("beforeunload", (event) => {
  if (!editorDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize().catch((error) => {
  elements.setupNotice.hidden = false;
  elements.authCard.setAttribute("aria-busy", "false");
  elements.authTitle.textContent = "온라인 방을 시작하지 못했어요";
  setStatus(elements.createStatus, firebaseErrorMessage(error, "온라인 방을 시작하지 못했습니다."), "error");
  setStatus(elements.authStatus, firebaseErrorMessage(error, "온라인 방을 시작하지 못했습니다."), "error");
});
