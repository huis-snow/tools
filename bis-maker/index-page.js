import { createBisRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  formatTimestamp,
  roomUrl,
  setStatus,
  timestampDate,
} from "./ui-common.js";

const core = globalThis.BisTrackerCore;
const firebaseConfig = globalThis.BisTrackerFirebaseConfig;

if (!core) throw new Error("비스표 데이터 모듈을 불러오지 못했습니다.");

const SEATS = ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"];
const elements = {
  setupNotice: document.querySelector("#bisSetupNotice"),
  authCard: document.querySelector("#bisAuthCard"),
  authTitle: document.querySelector("#bisAuthTitle"),
  authDescription: document.querySelector("#bisAuthDescription"),
  authStatus: document.querySelector("#bisAuthStatus"),
  googleSignIn: document.querySelector("#bisGoogleSignInButton"),
  googleSignOut: document.querySelector("#bisGoogleSignOutButton"),
  ownedRoomsLink: document.querySelector("#bisOwnedRoomsLink"),
  form: document.querySelector("#bisRoomCreateForm"),
  title: document.querySelector("#bisCreateTitle"),
  tier: document.querySelector("#bisCreateTier"),
  week: document.querySelector("#bisCreateWeek"),
  rosterFilled: document.querySelector("#bisRosterFilledCount"),
  createButton: document.querySelector("#bisCreateButton"),
  createStatus: document.querySelector("#bisCreateStatus"),
  ownedSection: document.querySelector("#bis-owned-rooms"),
  ownedCount: document.querySelector("#bisOwnedRoomCount"),
  ownedList: document.querySelector("#bisOwnedRoomList"),
  ownedEmpty: document.querySelector("#bisOwnedRoomsEmpty"),
  ownedStatus: document.querySelector("#bisOwnedRoomsStatus"),
  ownedRefresh: document.querySelector("#bisOwnedRoomsRefreshButton"),
  ownedTemplate: document.querySelector("#bisOwnedRoomTemplate"),
  toast: document.querySelector("#toast"),
};

let store = null;
let authBusy = false;
let actionBusy = false;
let ownedBusy = false;
let ownedRequest = 0;
const showToast = createToast(elements.toast);

function googleConnected() {
  return Boolean(store?.isGoogleAccount?.());
}

function authName(user) {
  return String(user?.displayName || user?.email || "Google 사용자").trim();
}

function rosterValue() {
  return SEATS.map((seat) => ({
    seat,
    nickname: document.querySelector(`#bisRosterNickname${seat}`)?.value || "",
    job: document.querySelector(`#bisRosterJob${seat}`)?.value || "",
  }));
}

function updateRosterCount() {
  const count = rosterValue().filter((member) => member.nickname.trim() && member.job.trim()).length;
  elements.rosterFilled.textContent = String(count);
}

function syncControls(options = {}) {
  const connected = googleConnected();
  const user = store?.user || null;
  elements.authCard?.setAttribute("aria-busy", String(!store || authBusy));
  elements.googleSignIn.hidden = connected;
  elements.googleSignIn.disabled = !store || authBusy || actionBusy;
  elements.googleSignOut.hidden = !connected;
  elements.googleSignOut.disabled = authBusy || actionBusy;
  elements.createButton.disabled = !store || !connected || authBusy || actionBusy;
  elements.ownedRoomsLink.hidden = !connected;
  elements.ownedSection.hidden = !connected;
  elements.ownedRefresh.disabled = ownedBusy || authBusy || actionBusy;
  elements.ownedSection.setAttribute("aria-busy", String(ownedBusy));

  if (!store) {
    elements.authTitle.textContent = "로그인 상태를 확인하고 있어요";
    elements.authDescription.textContent = "방을 만들고 관리할 때만 Google 로그인이 필요해요.";
    return;
  }
  if (connected) {
    elements.authTitle.textContent = `${authName(user)}님으로 로그인됨`;
    elements.authDescription.textContent = user?.email
      ? `${user.email} · 이름과 이메일은 공대원에게 공개되지 않아요.`
      : "Google 프로필 정보는 공대원에게 공개되지 않아요.";
    if (options.preserveStatus !== true && !authBusy) {
      setStatus(elements.authStatus, "새 방을 만들고 내 비스표 방을 불러올 수 있어요.", "success");
    }
    return;
  }
  elements.authTitle.textContent = "Google 로그인으로 방을 관리해요";
  elements.authDescription.textContent = user?.isAnonymous
    ? "현재 익명 연결을 Google 계정에 연결할 수 있어요."
    : "공대 명단을 등록하고 다른 기기에서도 관리하려면 로그인해 주세요.";
  if (options.preserveStatus !== true && !authBusy) {
    setStatus(elements.authStatus, "방을 만들려면 Google 로그인이 필요합니다.", "warning");
  }
}

function ownedRoomItem(room) {
  const fragment = elements.ownedTemplate.content.cloneNode(true);
  const item = fragment.querySelector("li");
  const inputUrl = roomUrl("room.html", room.id);
  const summaryUrl = roomUrl("summary.html", room.id);
  const state = item.querySelector("[data-field='state']");
  state.textContent = room.locked ? "입력 마감" : "입력 중";
  state.dataset.state = room.locked ? "locked" : "open";
  item.querySelector("[data-field='progress']").textContent = "8인 명단";
  item.querySelector("[data-field='title']").textContent = room.title;
  item.querySelector("[data-field='meta']").textContent = `${room.tier} · ${room.week}주차`;
  const time = item.querySelector("[data-field='updated']");
  const date = timestampDate(room.updatedAt);
  time.textContent = formatTimestamp(room.updatedAt);
  if (date && !Number.isNaN(date.getTime())) time.dateTime = date.toISOString();
  item.querySelector("[data-action='input']").href = inputUrl.toString();
  item.querySelector("[data-action='summary']").href = summaryUrl.toString();
  const copy = item.querySelector("[data-action='copy']");
  copy.dataset.roomId = room.id;
  copy.setAttribute("aria-label", `‘${room.title}’ 공대원 입력 링크 복사`);
  return item;
}

async function refreshOwnedRooms() {
  if (!store || !googleConnected() || ownedBusy) return;
  const request = ++ownedRequest;
  ownedBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.ownedStatus, "내 비스표 방을 불러오고 있어요.");
  try {
    const rooms = await store.listOwnedRooms();
    if (request !== ownedRequest) return;
    elements.ownedList.replaceChildren(...rooms.map(ownedRoomItem));
    elements.ownedCount.textContent = String(rooms.length);
    elements.ownedEmpty.hidden = rooms.length !== 0;
    setStatus(
      elements.ownedStatus,
      rooms.length ? `최근 비스표 방 ${rooms.length}개를 불러왔어요.` : "Google 계정에 저장된 비스표 방이 아직 없어요.",
      "success",
    );
  } catch (error) {
    if (request === ownedRequest) setStatus(elements.ownedStatus, firebaseErrorMessage(error), "error");
  } finally {
    if (request === ownedRequest) {
      ownedBusy = false;
      syncControls({ preserveStatus: true });
    }
  }
}

async function initialize() {
  updateRosterCount();
  if (!core.firebaseConfigReady(firebaseConfig)) {
    elements.setupNotice.hidden = false;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결이 필요합니다";
    elements.authDescription.textContent = "공개 웹 설정과 Authentication 공급자를 먼저 연결해 주세요.";
    setStatus(elements.authStatus, "Firebase 공개 웹 설정을 확인해 주세요.", "warning");
    setStatus(elements.createStatus, "Firebase를 연결하면 비스표 방을 만들 수 있어요.", "warning");
    return;
  }
  try {
    store = await createBisRoomStore(firebaseConfig);
    syncControls();
    if (googleConnected()) await refreshOwnedRooms();
  } catch (error) {
    elements.setupNotice.hidden = false;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결을 시작하지 못했어요";
    setStatus(elements.authStatus, firebaseErrorMessage(error), "error");
    setStatus(elements.createStatus, firebaseErrorMessage(error), "error");
  }
}

elements.form.addEventListener("input", updateRosterCount);

elements.googleSignIn.addEventListener("click", async () => {
  if (!store || authBusy || actionBusy || googleConnected()) return;
  authBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.authStatus, "Google 로그인 창을 열고 있어요.");
  try {
    try {
      await store.signInCreatorWithGoogle();
    } catch (error) {
      if (!store.hasPendingGoogleAccount()) throw error;
      const confirmed = window.confirm(
        "이 Google 계정은 이미 사용 중입니다.\n\n"
        + "계정을 전환하면 이 브라우저의 기존 익명 공대원 편집 권한을 잃을 수 있습니다. 전환할까요?",
      );
      if (!confirmed) {
        store.clearPendingGoogleAccount();
        setStatus(elements.authStatus, "계정 전환을 취소했어요. 기존 익명 권한은 유지됩니다.", "warning");
        return;
      }
      await store.switchToPendingGoogleAccount();
    }
    syncControls({ preserveStatus: true });
    setStatus(elements.authStatus, "Google 계정으로 로그인했어요.", "success");
    showToast("Google 계정으로 로그인했어요");
    await refreshOwnedRooms();
    elements.title.focus();
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
    elements.ownedList.replaceChildren();
    elements.ownedCount.textContent = "0";
    syncControls({ preserveStatus: true });
    setStatus(elements.authStatus, "Google 계정에서 로그아웃했어요.", "success");
    setStatus(elements.createStatus, "방을 만들려면 Google로 다시 로그인해 주세요.", "warning");
  } catch (error) {
    setStatus(elements.authStatus, firebaseErrorMessage(error, "로그아웃하지 못했어요."), "error");
  } finally {
    authBusy = false;
    syncControls({ preserveStatus: true });
  }
});

elements.ownedRefresh.addEventListener("click", refreshOwnedRooms);

elements.ownedList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='copy']");
  if (!button) return;
  button.disabled = true;
  try {
    await copyText(roomUrl("room.html", core.validateRoomId(button.dataset.roomId)).toString());
    showToast("공대원 입력 링크를 복사했어요");
  } catch (error) {
    setStatus(elements.ownedStatus, error.message || "링크를 복사하지 못했어요.", "error");
  } finally {
    button.disabled = false;
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || !googleConnected() || actionBusy) return;
  if (!elements.form.reportValidity()) return;
  actionBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.createStatus, "8인 명단과 비스표 방을 만들고 있어요.");
  try {
    const roomId = await store.createRoom({
      title: elements.title.value,
      tier: elements.tier.value,
      week: elements.week.value,
      roster: rosterValue(),
    });
    showToast("비스표 방을 만들었어요");
    window.location.assign(roomUrl("summary.html", roomId).toString());
  } catch (error) {
    setStatus(elements.createStatus, firebaseErrorMessage(error, "비스표 방을 만들지 못했어요."), "error");
  } finally {
    actionBusy = false;
    syncControls({ preserveStatus: true });
  }
});

initialize();
