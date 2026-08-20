import { createPollRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  formatTimestamp,
  setStatus,
  timestampDate,
} from "./ui-common.js";

const core = globalThis.AnonymousPollCore;
const firebaseConfig = globalThis.AnonymousPollFirebaseConfig;

if (!core) throw new Error("익명 투표 데이터 모듈을 불러오지 못했습니다.");

const byId = (id) => document.getElementById(id);
const elements = {
  setupNotice: byId("pollSetupNotice"),
  authCard: byId("pollAuthCard"),
  authTitle: byId("pollAuthTitle"),
  authDescription: byId("pollAuthDescription"),
  authStatus: byId("pollAuthStatus"),
  googleSignIn: byId("pollGoogleSignInButton"),
  googleSignOut: byId("pollGoogleSignOutButton"),
  ownedRoomsLink: byId("pollOwnedRoomsLink"),
  form: byId("pollRoomCreateForm"),
  agenda: byId("pollCreateAgenda"),
  description: byId("pollCreateDescription"),
  agendaLength: byId("pollAgendaLength"),
  descriptionLength: byId("pollDescriptionLength"),
  createButton: byId("pollCreateButton"),
  createStatus: byId("pollCreateStatus"),
  ownedSection: byId("poll-owned-rooms"),
  ownedCount: byId("pollOwnedRoomCount"),
  ownedList: byId("pollOwnedRoomList"),
  ownedEmpty: byId("pollOwnedRoomsEmpty"),
  ownedStatus: byId("pollOwnedRoomsStatus"),
  ownedRefresh: byId("pollOwnedRoomsRefreshButton"),
  ownedTemplate: byId("pollOwnedRoomTemplate"),
  toast: byId("toast"),
};

let store = null;
let authBusy = false;
let actionBusy = false;
let ownedBusy = false;
let ownedRequest = 0;
let observedIdentityKey = null;
let unsubscribeAuth = null;
const showToast = createToast(elements.toast);

function googleConnected() {
  return Boolean(store?.isGoogleAccount?.());
}

function authName(user) {
  return String(user?.displayName || user?.email || "Google 사용자").trim();
}

function identityKey(user) {
  if (!user) return "signed-out";
  const providers = Array.isArray(user.providerData)
    ? user.providerData.map((provider) => String(provider?.providerId || "")).sort().join(",")
    : "";
  return `${String(user.uid || "")}|${providers}`;
}

function updateLengths() {
  elements.agendaLength.textContent = String(Array.from(elements.agenda.value).length);
  elements.descriptionLength.textContent = String(Array.from(elements.description.value).length);
}

function syncControls(options = {}) {
  const connected = googleConnected();
  const user = store?.user || null;
  elements.authCard.setAttribute("aria-busy", String(!store || authBusy));
  elements.googleSignIn.hidden = connected;
  elements.googleSignIn.disabled = !store || authBusy || actionBusy;
  elements.googleSignOut.hidden = !connected;
  elements.googleSignOut.disabled = authBusy || actionBusy;
  elements.createButton.disabled = !store || !connected || authBusy || actionBusy;
  elements.ownedRoomsLink.hidden = !connected;
  elements.ownedSection.hidden = !connected;
  elements.ownedRefresh.disabled = ownedBusy || authBusy || actionBusy;
  elements.ownedSection.setAttribute("aria-busy", String(ownedBusy));

  if (!store) return;
  if (connected) {
    elements.authTitle.textContent = `${authName(user)}님으로 로그인됨`;
    elements.authDescription.textContent = user?.email
      ? `${user.email} · Google 프로필은 참여자에게 공개되지 않아요.`
      : "Google 프로필은 참여자에게 공개되지 않아요.";
    if (options.preserveStatus !== true && !authBusy) {
      setStatus(elements.authStatus, "새 투표방을 만들고 기존 투표를 관리할 수 있어요.", "success");
    }
    return;
  }

  elements.authTitle.textContent = "Google 로그인으로 투표방을 관리해요";
  elements.authDescription.textContent = user?.isAnonymous
    ? "현재 익명 연결을 Google 계정에 연결할 수 있어요."
    : "참여자는 로그인 화면 없이 공유 링크에서 익명으로 투표해요.";
  if (options.preserveStatus !== true && !authBusy) {
    setStatus(elements.authStatus, "투표방을 만들려면 Google로 로그인해 주세요.", "warning");
  }
}

function ownedRoomItem(room) {
  const fragment = elements.ownedTemplate.content.cloneNode(true);
  const item = fragment.querySelector("li");
  const url = core.roomUrl(room.id, window.location.href);
  const state = item.querySelector("[data-field='state']");
  state.textContent = room.locked ? "투표 마감" : "투표 중";
  state.dataset.state = room.locked ? "locked" : "open";
  item.querySelector("[data-field='agenda']").textContent = room.agenda;
  const description = item.querySelector("[data-field='description']");
  description.textContent = room.description || "추가 설명 없음";
  description.dataset.empty = String(!room.description);
  const time = item.querySelector("[data-field='updated']");
  const date = timestampDate(room.updatedAt);
  time.textContent = formatTimestamp(room.updatedAt);
  if (date && !Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
  item.querySelector("[data-action='open']").href = url.toString();
  const copy = item.querySelector("[data-action='copy']");
  copy.dataset.roomId = room.id;
  copy.setAttribute("aria-label", `‘${room.agenda}’ 참여 링크 복사`);
  return item;
}

function resetOwnedRooms() {
  ownedRequest += 1;
  ownedBusy = false;
  elements.ownedList.replaceChildren();
  elements.ownedCount.textContent = "0";
  elements.ownedEmpty.hidden = true;
}

async function refreshOwnedRooms() {
  if (!store || !googleConnected() || ownedBusy) return;
  const request = ++ownedRequest;
  ownedBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.ownedStatus, "내 투표방을 불러오고 있어요.");
  try {
    const rooms = await store.listOwnedRooms();
    if (request !== ownedRequest) return;
    elements.ownedList.replaceChildren(...rooms.map(ownedRoomItem));
    elements.ownedCount.textContent = String(rooms.length);
    elements.ownedEmpty.hidden = rooms.length !== 0;
    setStatus(
      elements.ownedStatus,
      rooms.length ? `최근 투표방 ${rooms.length}개를 불러왔어요.` : "Google 계정에 저장된 투표방이 아직 없어요.",
      "success",
    );
  } catch (error) {
    if (request !== ownedRequest) return;
    const indexPending = String(error?.code || "").includes("failed-precondition");
    setStatus(
      elements.ownedStatus,
      indexPending
        ? "내 투표방 목록 색인이 아직 준비되지 않았어요. Firestore 색인을 배포한 뒤 다시 시도해 주세요."
        : firebaseErrorMessage(error, "내 투표방을 불러오지 못했어요."),
      "error",
    );
  } finally {
    if (request === ownedRequest) {
      ownedBusy = false;
      syncControls({ preserveStatus: true });
    }
  }
}

async function handleAuthState(user) {
  const nextIdentityKey = identityKey(user);
  if (nextIdentityKey === observedIdentityKey) return;

  const firstIdentity = observedIdentityKey === null;
  observedIdentityKey = nextIdentityKey;
  resetOwnedRooms();
  syncControls({ preserveStatus: authBusy });
  if (authBusy) return;

  if (googleConnected()) {
    setStatus(
      elements.authStatus,
      firstIdentity
        ? "새 투표방을 만들고 기존 투표를 관리할 수 있어요."
        : "Google 로그인 상태가 바뀌어 내 투표방을 다시 불러와요.",
      "success",
    );
    setStatus(elements.createStatus, "안건을 입력하면 새 익명 투표방을 만들 수 있어요.", "success");
    await refreshOwnedRooms();
    return;
  }

  setStatus(
    elements.authStatus,
    firstIdentity
      ? "투표방을 만들려면 Google로 로그인해 주세요."
      : "Google 로그인 상태가 바뀌었어요. 투표방을 만들려면 다시 로그인해 주세요.",
    "warning",
  );
  setStatus(elements.createStatus, "투표방을 만들려면 Google로 로그인해 주세요.", "warning");
}

function showAuthSubscriptionError(error) {
  const message = firebaseErrorMessage(error, "Google 로그인 상태를 확인하지 못했어요.");
  setStatus(elements.authStatus, message, "error");
  setStatus(elements.createStatus, message, "error");
  syncControls({ preserveStatus: true });
}

function startAuthSubscription() {
  if (!store || unsubscribeAuth) return;
  unsubscribeAuth = store.subscribeAuthState(
    (user) => {
      handleAuthState(user).catch(showAuthSubscriptionError);
    },
    showAuthSubscriptionError,
  );
}

function stopAuthSubscription() {
  unsubscribeAuth?.();
  unsubscribeAuth = null;
}

async function initialize() {
  updateLengths();
  if (!core.firebaseConfigReady(firebaseConfig)) {
    elements.setupNotice.hidden = false;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결이 필요합니다";
    elements.authDescription.textContent = "공개 웹 설정과 Authentication 공급자를 먼저 연결해 주세요.";
    setStatus(elements.authStatus, "Firebase 공개 웹 설정을 확인해 주세요.", "warning");
    setStatus(elements.createStatus, "Firebase를 연결하면 익명 투표방을 만들 수 있어요.", "warning");
    return;
  }

  try {
    store = await createPollRoomStore(firebaseConfig);
    syncControls({ preserveStatus: true });
    startAuthSubscription();
  } catch (error) {
    elements.setupNotice.hidden = false;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결을 시작하지 못했어요";
    setStatus(elements.authStatus, firebaseErrorMessage(error), "error");
    setStatus(elements.createStatus, firebaseErrorMessage(error), "error");
  }
}

elements.form.addEventListener("input", updateLengths);
elements.ownedRefresh.addEventListener("click", refreshOwnedRooms);

elements.googleSignIn.addEventListener("click", async () => {
  if (!store || authBusy || actionBusy || googleConnected()) return;
  authBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.authStatus, "Google 로그인 창을 열고 있어요.");
  try {
    try {
      await store.signInCreatorWithGoogle();
    } catch (error) {
      if (!store.hasPendingGoogleAccount?.()) throw error;
      const confirmed = window.confirm(
        "이 Google 계정은 이미 사용 중입니다.\n\n"
        + "계정을 전환하면 이 브라우저에서 익명으로 참여했던 기존 투표의 변경 권한을 잃을 수 있습니다. 전환할까요?",
      );
      if (!confirmed) {
        store.clearPendingGoogleAccount?.();
        setStatus(elements.authStatus, "계정 전환을 취소했어요. 기존 익명 투표 권한은 유지됩니다.", "warning");
        return;
      }
      await store.switchToPendingGoogleAccount();
    }
    observedIdentityKey = identityKey(store.user);
    syncControls({ preserveStatus: true });
    setStatus(elements.authStatus, "Google 계정으로 로그인했어요.", "success");
    setStatus(elements.createStatus, "안건을 입력하면 새 익명 투표방을 만들 수 있어요.", "success");
    showToast("Google 계정으로 로그인했어요");
    await refreshOwnedRooms();
    elements.agenda.focus();
  } catch (error) {
    setStatus(elements.authStatus, firebaseErrorMessage(error, "Google 로그인에 실패했어요."), "error");
  } finally {
    authBusy = false;
    syncControls({ preserveStatus: true });
  }
});

elements.googleSignOut.addEventListener("click", async () => {
  if (!store || authBusy || actionBusy || !googleConnected()) return;
  authBusy = true;
  ownedRequest += 1;
  syncControls({ preserveStatus: true });
  try {
    await store.signOutCreator();
    observedIdentityKey = identityKey(store.user);
    resetOwnedRooms();
    syncControls({ preserveStatus: true });
    setStatus(elements.authStatus, "Google 계정에서 로그아웃했어요.", "success");
    setStatus(elements.createStatus, "투표방을 만들려면 Google로 다시 로그인해 주세요.", "warning");
  } catch (error) {
    setStatus(elements.authStatus, firebaseErrorMessage(error, "로그아웃하지 못했어요."), "error");
  } finally {
    authBusy = false;
    syncControls({ preserveStatus: true });
  }
});

elements.ownedList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='copy']");
  if (!button) return;
  button.disabled = true;
  try {
    const roomId = core.validateRoomId(button.dataset.roomId);
    await copyText(core.roomUrl(roomId, window.location.href).toString());
    showToast("익명 투표 참여 링크를 복사했어요");
  } catch (error) {
    setStatus(elements.ownedStatus, error.message || "링크를 복사하지 못했어요.", "error");
  } finally {
    button.disabled = false;
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store) {
    setStatus(elements.createStatus, "Firebase 연결을 확인한 뒤 다시 시도해 주세요.", "error");
    return;
  }
  if (authBusy) {
    setStatus(elements.createStatus, "Google 로그인 상태를 확인하고 있어요. 잠시 기다려 주세요.", "warning");
    return;
  }
  if (!googleConnected()) {
    syncControls({ preserveStatus: true });
    setStatus(elements.createStatus, "투표방을 만들려면 먼저 Google로 로그인해 주세요.", "warning");
    elements.googleSignIn.focus();
    return;
  }
  if (actionBusy || !elements.form.reportValidity()) return;
  actionBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.createStatus, "익명 투표방을 만들고 있어요.");
  try {
    const draft = core.normalizeRoomDraft({
      agenda: elements.agenda.value,
      description: elements.description.value,
    });
    const roomId = await store.createRoom(draft);
    setStatus(elements.createStatus, "투표방을 만들었어요. 참여 화면으로 이동합니다.", "success");
    showToast("익명 투표방을 만들었어요");
    window.location.assign(core.roomUrl(roomId, window.location.href).toString());
  } catch (error) {
    setStatus(elements.createStatus, firebaseErrorMessage(error, "익명 투표방을 만들지 못했어요."), "error");
  } finally {
    actionBusy = false;
    syncControls({ preserveStatus: true });
  }
});

window.addEventListener("pagehide", () => {
  stopAuthSubscription();
});

window.addEventListener("pageshow", () => {
  if (!store || unsubscribeAuth) return;
  observedIdentityKey = null;
  startAuthSubscription();
});

initialize();
