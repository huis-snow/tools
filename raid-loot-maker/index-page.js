import { createRaidLootRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  formatTimestamp,
  roomUrl,
  setStatus,
} from "./ui-common.js";

const core = globalThis.RaidLootCore;
const firebaseConfig = globalThis.RaidLootFirebaseConfig;

if (!core) throw new Error("공대 파밍 데이터 모듈을 불러오지 못했습니다.");

const byId = (id) => document.getElementById(id);
const elements = {
  setupNotice: byId("raidLootSetupNotice"),
  authCard: byId("raidLootAuthCard"),
  authTitle: byId("raidLootAuthTitle"),
  authDescription: byId("raidLootAuthDescription"),
  authStatus: byId("raidLootAuthStatus"),
  googleSignIn: byId("raidLootGoogleSignInButton"),
  googleSignOut: byId("raidLootGoogleSignOutButton"),
  ownedRoomsLink: byId("raidLootOwnedRoomsLink"),
  form: byId("raidLootRoomCreateForm"),
  title: byId("raidLootCreateTitle"),
  tier: byId("raidLootCreateTier"),
  startDate: byId("raidLootCreateStartDate"),
  rosterFilled: byId("raidLootRosterFilledCount"),
  createButton: byId("raidLootCreateButton"),
  createStatus: byId("raidLootCreateStatus"),
  ownedSection: byId("raid-loot-owned-rooms"),
  ownedCount: byId("raidLootOwnedRoomCount"),
  ownedList: byId("raidLootOwnedRoomList"),
  ownedEmpty: byId("raidLootOwnedRoomsEmpty"),
  ownedStatus: byId("raidLootOwnedRoomsStatus"),
  ownedRefresh: byId("raidLootOwnedRoomsRefreshButton"),
  ownedTemplate: byId("raidLootOwnedRoomTemplate"),
  toast: byId("toast"),
};

let store = null;
let authBusy = false;
let actionBusy = false;
let ownedBusy = false;
let ownedRequest = 0;
const showToast = createToast(elements.toast);

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function googleConnected() {
  return Boolean(store?.isGoogleAccount?.());
}

function authName(user) {
  return String(user?.displayName || user?.email || "Google 사용자").trim();
}

function rosterValue() {
  return core.SEATS.map((seat) => ({
    seat,
    nickname: byId(`raidLootRosterNickname${seat}`)?.value || "",
    job: byId(`raidLootRosterJob${seat}`)?.value || "",
  }));
}

function updateRosterCount() {
  const count = rosterValue().filter((member) => member.nickname.trim() && member.job.trim()).length;
  elements.rosterFilled.textContent = String(count);
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
      ? `${user.email} · 프로필 정보는 공대원에게 공개되지 않아요.`
      : "Google 프로필 정보는 공대원에게 공개되지 않아요.";
    if (options.preserveStatus !== true && !authBusy) {
      setStatus(elements.authStatus, "새 8주 공대를 만들고 기존 기록을 이어갈 수 있어요.", "success");
    }
    return;
  }
  elements.authTitle.textContent = "Google 로그인으로 8주 기록을 관리해요";
  elements.authDescription.textContent = user?.isAnonymous
    ? "현재 익명 연결을 Google 계정에 연결할 수 있어요."
    : "방장은 Google로 로그인하고 공대원은 공유 링크에서 익명으로 입력해요.";
  if (options.preserveStatus !== true && !authBusy) {
    setStatus(elements.authStatus, "방을 만들려면 Google로 로그인해 주세요.", "warning");
  }
}

function ownedRoomItem(room) {
  const fragment = elements.ownedTemplate.content.cloneNode(true);
  const item = fragment.querySelector("li");
  const input = roomUrl("room.html", room.id);
  const summary = roomUrl("summary.html", room.id);
  const state = item.querySelector("[data-field='state']");
  state.textContent = room.locked ? "입력 마감" : "진행 중";
  state.dataset.state = room.locked ? "locked" : "open";
  item.querySelector("[data-field='week']").textContent = `${room.currentWeek} / 8주차`;
  item.querySelector("[data-field='title']").textContent = room.title;
  item.querySelector("[data-field='meta']").textContent = `${room.tier} · ${room.startDate} 시작`;
  item.querySelector("[data-field='updated']").textContent = `${formatTimestamp(room.updatedAt)} 수정`;
  item.querySelector("[data-action='input']").href = input.toString();
  item.querySelector("[data-action='summary']").href = summary.toString();
  const copyButton = item.querySelector("[data-action='copy']");
  copyButton.dataset.roomId = room.id;
  return item;
}

async function refreshOwnedRooms() {
  if (!store || !googleConnected() || ownedBusy) return;
  const request = ++ownedRequest;
  ownedBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.ownedStatus, "내 공대 파밍표를 불러오고 있어요.");
  try {
    const rooms = await store.listOwnedRooms();
    if (request !== ownedRequest) return;
    elements.ownedList.replaceChildren(...rooms.map(ownedRoomItem));
    elements.ownedCount.textContent = String(rooms.length);
    elements.ownedEmpty.hidden = rooms.length !== 0;
    setStatus(elements.ownedStatus, rooms.length ? "최근 수정한 순서로 표시했어요." : "아직 만든 8주 공대가 없어요.", "success");
  } catch (error) {
    const message = firebaseErrorMessage(error, "내 공대 목록을 불러오지 못했어요.");
    setStatus(elements.ownedStatus, error?.code === "failed-precondition"
      ? "내 공대 목록 색인이 아직 준비되지 않았어요. Firestore 색인을 배포한 뒤 다시 시도해 주세요."
      : message, "error");
  } finally {
    ownedBusy = false;
    syncControls({ preserveStatus: true });
  }
}

async function initialize() {
  elements.startDate.value ||= localDateString();
  updateRosterCount();
  if (!core.firebaseConfigReady(firebaseConfig)) {
    elements.setupNotice.hidden = false;
    elements.authCard.setAttribute("aria-busy", "false");
    elements.authTitle.textContent = "Firebase 연결이 필요합니다";
    setStatus(elements.authStatus, "Firebase 공개 웹 설정을 확인해 주세요.", "warning");
    setStatus(elements.createStatus, "Firebase를 연결하면 8주 공대를 만들 수 있어요.", "warning");
    return;
  }
  try {
    store = await createRaidLootRoomStore(firebaseConfig);
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
      if (!store.hasPendingGoogleAccount()) throw error;
      const confirmed = window.confirm("이 Google 계정은 이미 사용 중입니다.\n\n계정을 전환하면 이 브라우저의 기존 익명 자리 편집 권한을 잃을 수 있습니다. 전환할까요?");
      if (!confirmed) {
        store.clearPendingGoogleAccount();
        setStatus(elements.authStatus, "계정 전환을 취소했어요.", "warning");
        return;
      }
      await store.switchToPendingGoogleAccount();
    }
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
    setStatus(elements.authStatus, "Google 계정에서 로그아웃했어요.", "success");
    setStatus(elements.createStatus, "방을 만들려면 Google로 다시 로그인해 주세요.", "warning");
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
  if (!store || !googleConnected() || actionBusy || !elements.form.reportValidity()) return;
  actionBusy = true;
  syncControls({ preserveStatus: true });
  setStatus(elements.createStatus, "8주 공대와 고정 명단을 만들고 있어요.");
  try {
    const roomId = await store.createRoom({
      title: elements.title.value,
      tier: elements.tier.value,
      startDate: elements.startDate.value,
      currentWeek: 1,
      policy: "fair",
      roster: rosterValue(),
    });
    setStatus(elements.createStatus, "8주 공대를 만들었어요. 파밍 현황으로 이동합니다.", "success");
    showToast("8주 공대를 만들었어요");
    window.location.assign(roomUrl("summary.html", roomId).toString());
  } catch (error) {
    setStatus(elements.createStatus, firebaseErrorMessage(error, "8주 공대를 만들지 못했어요."), "error");
  } finally {
    actionBusy = false;
    syncControls({ preserveStatus: true });
  }
});

initialize();
