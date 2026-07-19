const core = globalThis.EonjepyoOnlineCore;
const scheduleApi = globalThis.Eonjepyo;
const firebaseConfig = globalThis.EonjepyoFirebaseConfig;

if (!core || !scheduleApi) throw new Error("온라인 언제표를 시작하는 데 필요한 모듈을 불러오지 못했습니다.");

const elements = {
  setupNotice: document.querySelector("#onlineSetupNotice"),
  createForm: document.querySelector("#onlineRoomCreateForm"),
  createTitle: document.querySelector("#onlineCreateTitle"),
  createStartHour: document.querySelector("#onlineCreateStartHour"),
  createStartDay: document.querySelector("#onlineCreateStartDay"),
  createTimezone: document.querySelector("#onlineCreateTimezone"),
  createButton: document.querySelector("#onlineCreateButton"),
  createStatus: document.querySelector("#onlineCreateStatus"),
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
  if (code.includes("unauthenticated")) return "익명 로그인에 실패했습니다. Firebase Authentication 설정을 확인해 주세요.";
  if (code.includes("unavailable") || code.includes("network")) return "네트워크에 연결할 수 없습니다. 연결 상태를 확인해 주세요.";
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
}

function syncParticipantRemoveButtons(isOwner) {
  elements.participantList?.querySelectorAll("[data-remote-participant-uid]").forEach((button) => {
    button.hidden = !isOwner;
    button.title = isOwner ? "방에서 이 응답 삭제" : "";
  });
}

function syncRoomControls(snapshotMetadata = currentSnapshotMetadata) {
  if (!currentRoom || !store) return;
  const responseEntries = Object.entries(currentRoom.responses);
  const ownResponse = currentRoom.responses[store.user.uid] || null;
  const isOwner = currentRoom.ownerUid === store.user.uid;
  const isFull = responseEntries.length >= core.MAX_RESPONSES && !ownResponse;

  document.body.classList.toggle("is-room-owner", isOwner);
  elements.roomOwnerNote.hidden = !isOwner;
  elements.roomLock.hidden = !isOwner;
  elements.roomDelete.hidden = !isOwner;
  elements.roomLock.textContent = currentRoom.locked ? "방 다시 열기" : "입력 마감";
  elements.roomLock.disabled = actionBusy;
  elements.roomDelete.disabled = actionBusy;
  elements.roomCopy.disabled = actionBusy;

  elements.saveResponse.disabled = actionBusy || currentRoom.locked || isFull;
  elements.deleteResponse.disabled = actionBusy || !ownResponse || (currentRoom.locked && !isOwner);
  elements.deleteResponse.hidden = !ownResponse;
  globalThis.EonjepyoApp.setScheduleReadOnly(currentRoom.locked);

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
  const ownResponse = responses[store.user.uid] || null;
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

  if (!core.firebaseConfigReady(firebaseConfig)) {
    elements.setupNotice.hidden = false;
    elements.createButton.disabled = true;
    setStatus(elements.createStatus, "Firebase 공개 웹 설정을 연결하면 온라인 방을 만들 수 있어요.", "warning");
    const requestedRoom = new URLSearchParams(window.location.search).get("r");
    if (requestedRoom) {
      elements.createForm.hidden = true;
      elements.workspace.hidden = true;
    }
    return;
  }

  try {
    setStatus(elements.createStatus, "Firebase 익명 연결을 준비하고 있어요.");
    const { createFirebaseRoomStore } = await import("./firebase-room-store.js");
    store = await createFirebaseRoomStore(firebaseConfig);
    setStatus(elements.createStatus, "온라인 방을 만들 준비가 됐어요.", "success");
    elements.createButton.disabled = false;
  } catch (error) {
    elements.setupNotice.hidden = false;
    elements.createButton.disabled = true;
    setStatus(elements.createStatus, firebaseErrorMessage(error), "error");
    return;
  }

  const requestedRoom = new URLSearchParams(window.location.search).get("r");
  if (!requestedRoom) {
    showCreateMode();
    return;
  }
  try {
    subscribeToRoom(core.validateRoomId(requestedRoom));
  } catch (error) {
    showCreateMode({ focus: true });
    setStatus(elements.createStatus, error.message, "error");
  }
}

elements.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || actionBusy) return;
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
  if (!success) elements.createButton.disabled = false;
});

elements.roomCopy.addEventListener("click", async () => {
  if (!currentRoomId) return;
  try {
    await copyPlainText(cleanRoomUrl());
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
  if (!store || !currentRoom?.responses?.[store.user.uid]) return;
  if (!window.confirm("이 온라인 방에서 내 일정을 삭제할까요?")) return;
  const isOwner = currentRoom.ownerUid === store.user.uid;
  const success = await runAction(
    () => store.removeResponse(currentRoomId, store.user.uid, { asOwner: isOwner }),
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
  if (!store || !currentRoom || currentRoom.ownerUid !== store.user.uid) return;
  const nextLocked = !currentRoom.locked;
  const success = await runAction(
    () => store.updateRoom(currentRoomId, { locked: nextLocked }),
    elements.roomStatus,
    nextLocked ? "추가 입력을 마감하고 있어요." : "온라인 방을 다시 열고 있어요.",
  );
  if (success) showToast(nextLocked ? "추가 입력을 마감했어요" : "온라인 방을 다시 열었어요");
});

elements.roomDelete.addEventListener("click", async () => {
  if (!store || !currentRoom || currentRoom.ownerUid !== store.user.uid) return;
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
  if (!button || !store || currentRoom?.ownerUid !== store.user.uid) return;
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
  setStatus(elements.createStatus, firebaseErrorMessage(error, "온라인 방을 시작하지 못했습니다."), "error");
});
