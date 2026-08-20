import { createPollRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  setStatus,
} from "./ui-common.js";

const core = globalThis.AnonymousPollCore;
const firebaseConfig = globalThis.AnonymousPollFirebaseConfig;

if (!core) throw new Error("익명 투표 데이터 모듈을 불러오지 못했습니다.");

const byId = (id) => document.getElementById(id);
const elements = {
  banner: byId("pollRoomBanner"),
  title: byId("pollRoomTitle"),
  description: byId("pollRoomDescription"),
  state: byId("pollRoomState"),
  roomResultSummary: byId("pollRoomResultSummary"),
  roomTotal: byId("pollRoomTotal"),
  roomTotalLabel: byId("pollRoomTotalLabel"),
  roomStatus: byId("pollRoomStatus"),
  headerCopy: byId("pollHeaderCopyButton"),
  share: byId("pollShareButton"),
  missingActions: byId("pollRoomMissingActions"),
  workspace: byId("pollRoomWorkspace"),
  ownerAccess: byId("pollOwnerAccess"),
  ownerAccessDescription: byId("pollOwnerAccessDescription"),
  ownerSignIn: byId("pollOwnerSignInButton"),
  ownerAccessStatus: byId("pollOwnerAccessStatus"),
  votePanel: byId("pollVotePanel"),
  voteGuide: byId("pollVoteGuide"),
  voteForm: byId("pollVoteForm"),
  voteChoices: byId("pollVoteChoices"),
  ownVote: byId("pollOwnVote"),
  ownVoteLabel: byId("pollOwnVoteLabel"),
  voteButton: byId("pollVoteButton"),
  voteStatus: byId("pollVoteStatus"),
  resultsPanel: byId("pollResultsPanel"),
  resultsTitle: byId("pollResultsTitle"),
  resultsGuide: byId("pollResultsGuide"),
  resultsTotal: byId("pollResultsTotal"),
  resultsLive: byId("pollResultsLive"),
  resultList: byId("pollResultList"),
  resultsEmpty: byId("pollResultsEmpty"),
  ownerPanel: byId("pollOwnerPanel"),
  ownerCopy: byId("pollOwnerCopyButton"),
  lockButton: byId("pollLockButton"),
  ownerStatus: byId("pollOwnerStatus"),
  toast: byId("toast"),
};

let store = null;
let roomId = "";
let room = null;
let ownVote = null;
let results = null;
let roomResolved = false;
let voteResolved = false;
let resultsResolved = false;
let roomFromCache = false;
let roomPendingWrites = false;
let resultsFromCache = false;
let subscriptionFailed = false;
let roomMissing = false;
let draftChoice = "";
let saving = false;
let locking = false;
let ownerAuthBusy = false;
let voteFeedback = null;
let ownerFeedback = null;
let ownerAccessFeedback = null;
let resultsError = null;
let unsubscribeRoom = null;
let unsubscribeVote = null;
let unsubscribeResults = null;
let unsubscribeAuth = null;
let resultsGeneration = 0;
let observedIdentityKey = null;

const showToast = createToast(elements.toast);

function currentUid() {
  return String(store?.user?.uid || "");
}

function identityKey(user) {
  if (!user) return "signed-out";
  const providers = Array.isArray(user.providerData)
    ? user.providerData.map((provider) => String(provider?.providerId || "")).sort().join(",")
    : "";
  return `${String(user.uid || "")}|${providers}`;
}

function isOwner() {
  return Boolean(room && store?.isGoogleAccount?.() && currentUid() && room.ownerUid === currentUid());
}

function ownChoice() {
  return ownVote?.choice || "";
}

function editorDirty() {
  return Boolean(draftChoice && draftChoice !== ownChoice());
}

function choiceLabel(choice) {
  return core.CHOICE_META[choice]?.label || "선택 없음";
}

function resultsEligible() {
  return Boolean(room && !ownerAuthBusy && !subscriptionFailed && isOwner());
}

function shortTime() {
  try {
    return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  } catch (_error) {
    return "방금";
  }
}

function setShareButtons(enabled) {
  elements.headerCopy.disabled = !enabled;
  elements.share.disabled = !enabled;
  elements.ownerCopy.disabled = !enabled || locking;
}

async function copyRoomLink() {
  if (!roomId) return;
  await copyText(core.roomUrl(roomId, window.location.href).toString());
  showToast("익명 투표 참여 링크를 복사했어요");
}

function syncRoomStatus() {
  if (subscriptionFailed || roomMissing) return;
  if (!roomResolved) {
    setStatus(
      elements.roomStatus,
      roomFromCache ? "서버에서 투표방을 확인하고 있어요." : "Firebase에서 투표방을 확인하고 있어요.",
      roomFromCache ? "warning" : "",
    );
  } else if (roomPendingWrites) {
    setStatus(elements.roomStatus, "투표방 변경 내용을 Firebase에 저장하고 있어요.");
  } else if (roomFromCache) {
    setStatus(elements.roomStatus, "서버 연결을 확인하고 있어요. 잠시 이전 상태가 보일 수 있습니다.", "warning");
  } else {
    setStatus(elements.roomStatus, `동기화됨 · ${shortTime()}`, "success");
  }
}

function renderRoom() {
  if (!room) return;
  const roomBusy = !subscriptionFailed && (!roomResolved || roomFromCache || roomPendingWrites);
  elements.banner.setAttribute("aria-busy", String(roomBusy));
  elements.title.textContent = room.agenda;
  elements.description.textContent = room.description || "추가 설명이 없는 안건입니다.";
  elements.description.dataset.empty = String(!room.description);
  elements.state.textContent = room.locked ? "투표 마감" : "투표 중";
  elements.state.dataset.state = room.locked ? "locked" : "open";
  elements.workspace.hidden = false;
  elements.missingActions.hidden = true;
  setShareButtons(true);
  document.title = `${room.agenda} | 익명 투표소`;
  syncRoomStatus();
}

function renderVote() {
  const open = Boolean(room && !room.locked && !subscriptionFailed);
  const editable = open && voteResolved && !saving && !ownerAuthBusy;
  const savedChoice = ownChoice();

  elements.voteChoices.disabled = !editable;
  elements.voteChoices.querySelectorAll("input[name='pollChoice']").forEach((input) => {
    input.disabled = !editable;
    input.checked = input.value === draftChoice;
    input.closest(".vote-choice")?.setAttribute("data-selected", String(input.checked));
  });

  elements.ownVote.hidden = !savedChoice;
  if (savedChoice) elements.ownVoteLabel.textContent = choiceLabel(savedChoice);
  elements.voteButton.disabled = !editable || !draftChoice || !editorDirty();
  elements.voteButton.innerHTML = savedChoice
    ? '선택 바꾸기 <span aria-hidden="true">→</span>'
    : '선택 저장하기 <span aria-hidden="true">→</span>';

  if (!room) {
    setStatus(elements.voteStatus, "투표방을 불러오고 있어요.");
  } else if (subscriptionFailed) {
    setStatus(elements.voteStatus, "서버 연결을 복구한 뒤 페이지를 새로고침해 주세요.", "error");
  } else if (!voteResolved) {
    setStatus(elements.voteStatus, "이 브라우저의 기존 투표를 확인하고 있어요.");
  } else if (saving) {
    setStatus(elements.voteStatus, "익명 투표를 Firebase에 저장하고 있어요.");
  } else if (ownerAuthBusy) {
    setStatus(elements.voteStatus, "방장 계정을 확인하는 동안 잠시 기다려 주세요.");
  } else if (room.locked) {
    setStatus(
      elements.voteStatus,
      savedChoice ? `투표가 마감됐어요. 내 선택은 ‘${choiceLabel(savedChoice)}’입니다.` : "투표가 마감되어 새로 참여할 수 없어요.",
      "warning",
    );
  } else if (voteFeedback) {
    setStatus(elements.voteStatus, voteFeedback.message, voteFeedback.state);
  } else if (editorDirty()) {
    setStatus(elements.voteStatus, savedChoice ? "바꿀 선택을 골랐어요. 아직 저장되지 않았습니다." : "한 항목을 골랐어요. 저장하면 방장에게 합계로 전달됩니다.", "warning");
  } else if (savedChoice) {
    setStatus(elements.voteStatus, `‘${choiceLabel(savedChoice)}’으로 저장됐어요. 합계는 방장만 볼 수 있고 마감 전까지 선택을 바꿀 수 있습니다.`, "success");
  } else {
    setStatus(elements.voteStatus, "동의·거부·상관없음 중 하나를 골라 주세요.");
  }

  elements.voteGuide.textContent = room?.locked
    ? "방장이 투표를 마감했어요. 저장된 내 선택만 확인할 수 있어요."
    : "한 번 저장한 뒤에도 투표가 마감되기 전까지 바꿀 수 있어요.";
}

function clearResults() {
  results = null;
  resultsResolved = false;
  resultsFromCache = false;
  resultsError = null;
  elements.roomTotal.textContent = "—";
  elements.roomTotalLabel.textContent = "방장 결과";
  elements.resultsTotal.textContent = "—";
  elements.resultsEmpty.hidden = true;
  elements.resultsGuide.textContent = "방장 전용 전체 합계를 불러오고 있어요.";
  elements.resultsLive.innerHTML = '<b aria-hidden="true"></b> 확인 중';
  elements.resultsLive.dataset.state = "cache";
  core.CHOICES.forEach((choice) => {
    const item = elements.resultList.querySelector(`[data-choice="${choice}"]`);
    if (!item) return;
    item.querySelector("[data-field='count']").textContent = "0";
    item.querySelector("[data-field='percent']").textContent = "0%";
    item.querySelector("[data-field='bar']").style.width = "0%";
    item.removeAttribute("aria-label");
  });
}

function renderResults() {
  const eligible = resultsEligible();
  elements.resultsPanel.hidden = !eligible;
  elements.roomResultSummary.hidden = !eligible;

  if (!eligible) {
    elements.roomTotal.textContent = "—";
    elements.roomTotalLabel.textContent = "방장 결과";
    return;
  }

  elements.resultsPanel.setAttribute("aria-busy", String(!resultsResolved && !resultsError));
  if (resultsError) {
    const message = firebaseErrorMessage(resultsError, "투표 합계를 불러오지 못했어요.");
    elements.roomTotal.textContent = "—";
    elements.roomTotalLabel.textContent = "합계 확인 불가";
    elements.resultsGuide.textContent = message;
    elements.resultsLive.innerHTML = '<b aria-hidden="true"></b> 합계 연결 오류';
    elements.resultsLive.dataset.state = "error";
    return;
  }

  if (!resultsResolved || !results) {
    elements.roomTotal.textContent = "—";
    elements.roomTotalLabel.textContent = "합계 불러오는 중";
    elements.resultsTotal.textContent = "—";
    elements.resultsGuide.textContent = "방장 전용 전체 합계를 불러오고 있어요.";
    return;
  }

  const rows = core.resultRows(results.counts);
  const total = Number.isInteger(results.total) ? results.total : core.totalVotes(results.counts);
  elements.roomTotal.textContent = String(total);
  elements.roomTotalLabel.textContent = "표 참여";
  elements.resultsTotal.textContent = String(total);
  elements.resultsEmpty.hidden = total !== 0;
  elements.resultsGuide.textContent = room?.locked
    ? "방장에게만 보이는 최종 합계예요. 개별 투표는 표시되지 않아요."
    : "방장에게만 보이는 실시간 합계예요. 개별 선택은 표시되지 않아요.";
  elements.resultsLive.innerHTML = resultsFromCache
    ? '<b aria-hidden="true"></b> 연결 확인 중'
    : room?.locked
      ? '<b aria-hidden="true"></b> 최종 결과'
      : '<b aria-hidden="true"></b> 실시간';
  elements.resultsLive.dataset.state = resultsFromCache ? "cache" : room?.locked ? "locked" : "live";

  rows.forEach((row) => {
    const item = elements.resultList.querySelector(`[data-choice="${row.choice}"]`);
    if (!item) return;
    const percent = Number.isInteger(row.percent) ? String(row.percent) : row.percent.toFixed(1);
    item.querySelector("[data-field='count']").textContent = String(row.count);
    item.querySelector("[data-field='percent']").textContent = `${percent}%`;
    item.querySelector("[data-field='bar']").style.width = `${Math.max(0, Math.min(100, row.ratio * 100))}%`;
    item.setAttribute("aria-label", `${row.label} ${row.count}표, ${percent}퍼센트`);
  });
}

function renderOwnerAccess() {
  const owner = isOwner();
  elements.ownerAccess.hidden = owner;
  if (owner) return;

  const google = Boolean(store?.isGoogleAccount?.());
  elements.ownerSignIn.disabled = !store || ownerAuthBusy || subscriptionFailed;
  elements.ownerSignIn.textContent = google ? "다른 Google 계정으로 확인" : "Google로 방장 확인";
  elements.ownerAccessDescription.textContent = google
    ? "현재 Google 계정은 이 방의 방장 계정이 아니에요. 다른 계정으로 전환해 확인할 수 있습니다."
    : "방을 만든 Google 계정으로 확인하면 실시간 합계와 마감 기능이 열려요.";

  if (ownerAuthBusy) {
    setStatus(elements.ownerAccessStatus, "Google 방장 계정을 확인하고 있어요.");
  } else if (ownerAccessFeedback) {
    setStatus(elements.ownerAccessStatus, ownerAccessFeedback.message, ownerAccessFeedback.state);
  } else if (google) {
    setStatus(elements.ownerAccessStatus, "이 계정은 방장이 아닙니다. 참여자로 투표할 수 있지만 결과는 볼 수 없어요.", "warning");
  } else {
    setStatus(elements.ownerAccessStatus, "참여자는 로그인하지 않아도 투표할 수 있고 결과는 공개되지 않아요.");
  }
}

function renderOwner() {
  const owner = isOwner();
  elements.ownerPanel.hidden = !owner;
  if (!owner) return;
  elements.lockButton.disabled = locking || subscriptionFailed;
  elements.ownerCopy.disabled = locking || !roomId;
  elements.lockButton.textContent = room?.locked ? "투표 다시 열기" : "투표 마감하기";
  elements.lockButton.dataset.action = room?.locked ? "reopen" : "lock";
  if (locking) {
    setStatus(elements.ownerStatus, room?.locked ? "투표를 다시 열고 있어요." : "투표를 마감하고 있어요.");
  } else if (resultsError) {
    setStatus(elements.ownerStatus, "방장 계정은 확인됐지만 합계를 불러오지 못했어요. 위 결과 안내를 확인해 주세요.", "error");
  } else if (ownerFeedback) {
    setStatus(elements.ownerStatus, ownerFeedback.message, ownerFeedback.state);
  } else if (room?.locked) {
    setStatus(elements.ownerStatus, "투표가 마감됐어요. 필요하면 다시 열 수 있습니다.", "success");
  } else {
    setStatus(elements.ownerStatus, "방장 전용 실시간 합계를 확인할 수 있어요. 모두 참여했다면 투표를 마감해 주세요.");
  }
}

function renderAll() {
  renderRoom();
  renderOwnerAccess();
  renderVote();
  renderResults();
  renderOwner();
}

function stopResultsSubscription(options = {}) {
  resultsGeneration += 1;
  unsubscribeResults?.();
  unsubscribeResults = null;
  if (options.clear !== false) clearResults();
}

function extractResults(payload) {
  if (!payload) return null;
  return payload.results || payload.result || payload;
}

function applyResultsSnapshot(payload, generation) {
  if (generation !== resultsGeneration || !resultsEligible()) return;
  if (payload?.missingFromCache) {
    resultsFromCache = true;
    renderResults();
    renderOwner();
    return;
  }
  const next = extractResults(payload);
  if (!next) {
    resultsError = new Error("투표 합계 데이터가 없습니다.");
    renderResults();
    renderOwner();
    return;
  }
  results = next;
  resultsResolved = true;
  resultsFromCache = Boolean(payload?.fromCache);
  resultsError = null;
  renderResults();
  renderOwner();
}

function syncResultsSubscription() {
  if (!store || !roomId || !resultsEligible()) {
    if (unsubscribeResults || results || resultsResolved || resultsError) {
      stopResultsSubscription({ clear: true });
      renderResults();
    }
    return;
  }
  if (unsubscribeResults) return;

  clearResults();
  const generation = ++resultsGeneration;
  try {
    unsubscribeResults = store.subscribeResults(
      roomId,
      (payload) => applyResultsSnapshot(payload, generation),
      (error) => {
        if (generation !== resultsGeneration || !resultsEligible()) return;
        resultsError = error;
        resultsResolved = false;
        renderResults();
        renderOwner();
      },
    );
  } catch (error) {
    if (generation !== resultsGeneration || !resultsEligible()) return;
    resultsError = error;
    resultsResolved = false;
  }
  renderResults();
  renderOwner();
}

function ensureOwnVoteSubscription() {
  if (!store || !room || !roomId || roomFromCache || unsubscribeVote || roomMissing) return;
  try {
    unsubscribeVote = store.subscribeOwnVote(
      roomId,
      applyOwnVoteSnapshot,
      (error) => showSubscriptionError(error, "vote"),
    );
  } catch (error) {
    showSubscriptionError(error, "vote");
  }
}

function resetIdentitySubscriptions() {
  unsubscribeRoom?.();
  unsubscribeVote?.();
  unsubscribeRoom = null;
  unsubscribeVote = null;
  stopResultsSubscription({ clear: true });
  ownVote = null;
  voteResolved = false;
  draftChoice = "";
  voteFeedback = null;
  roomResolved = false;
  roomFromCache = false;
  roomPendingWrites = false;
}

function subscribeForCurrentIdentity() {
  if (!store || !roomId || unsubscribeRoom) return;
  unsubscribeRoom = store.subscribeRoom(
    roomId,
    applyRoomSnapshot,
    (error) => showSubscriptionError(error, "room"),
  );
}

async function handleAuthState(user) {
  const nextIdentityKey = identityKey(user);
  if (ownerAuthBusy) {
    observedIdentityKey = nextIdentityKey;
    return;
  }
  if (nextIdentityKey === observedIdentityKey) return;

  const firstIdentity = observedIdentityKey === null;
  observedIdentityKey = nextIdentityKey;
  resetIdentitySubscriptions();
  subscriptionFailed = false;
  if (!firstIdentity) {
    ownerAccessFeedback = { message: "로그인 상태가 바뀌어 투표방 권한을 다시 확인하고 있어요.", state: "warning" };
  }
  renderAll();

  if (!user) {
    try {
      await store.ensureParticipantSession();
    } catch (error) {
      showSubscriptionError(error, "auth");
    }
    return;
  }
  subscribeForCurrentIdentity();
}

function showMissingRoom() {
  unsubscribeVote?.();
  unsubscribeVote = null;
  stopResultsSubscription({ clear: true });
  room = null;
  ownVote = null;
  voteResolved = false;
  roomMissing = true;
  elements.banner.setAttribute("aria-busy", "false");
  elements.title.textContent = "투표방을 찾지 못했어요";
  elements.description.textContent = "주소가 잘못됐거나 더 이상 열 수 없는 투표입니다.";
  elements.state.textContent = "종료됨";
  elements.state.dataset.state = "error";
  elements.roomResultSummary.hidden = true;
  elements.roomTotal.textContent = "—";
  elements.roomTotalLabel.textContent = "확인 불가";
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  setShareButtons(false);
  setStatus(elements.roomStatus, "새 투표방을 만들거나 방장에게 링크를 다시 받아 주세요.", "error");
  document.title = "투표방을 찾지 못했어요 | 익명 투표소";
  elements.title.focus();
}

function applyRoomSnapshot(payload) {
  if (payload?.missingFromCache) {
    roomFromCache = true;
    syncRoomStatus();
    return;
  }
  if (!payload) {
    showMissingRoom();
    return;
  }
  room = payload.room || payload;
  roomResolved = true;
  roomMissing = false;
  roomFromCache = Boolean(payload.fromCache);
  roomPendingWrites = Boolean(payload.hasPendingWrites);

  renderAll();
  ensureOwnVoteSubscription();
  syncResultsSubscription();
}

function applyOwnVoteSnapshot(payload) {
  if (payload?.missingFromCache) return;
  const nextVote = payload && Object.prototype.hasOwnProperty.call(payload, "vote") ? payload.vote : payload;
  const wasDirty = editorDirty();
  ownVote = nextVote || null;
  voteResolved = true;
  if (!wasDirty) draftChoice = ownChoice();
  voteFeedback = null;
  renderVote();
  renderOwner();
  syncResultsSubscription();
}

function showSubscriptionError(error, area) {
  if (roomMissing) return;
  if (area === "results") {
    resultsError = error;
    renderResults();
    renderOwner();
    return;
  }
  subscriptionFailed = true;
  stopResultsSubscription({ clear: true });
  elements.banner.setAttribute("aria-busy", "false");
  elements.state.textContent = "연결 오류";
  elements.state.dataset.state = "error";
  setStatus(elements.roomStatus, firebaseErrorMessage(error), "error");
  renderResults();
  renderOwnerAccess();
  renderVote();
  renderOwner();
}

function showStartupError(title, description, message) {
  unsubscribeAuth?.();
  unsubscribeRoom?.();
  unsubscribeVote?.();
  stopResultsSubscription({ clear: true });
  unsubscribeRoom = null;
  unsubscribeVote = null;
  unsubscribeAuth = null;
  subscriptionFailed = true;
  elements.banner.setAttribute("aria-busy", "false");
  elements.title.textContent = title;
  elements.description.textContent = description;
  elements.state.textContent = "연결 불가";
  elements.state.dataset.state = "error";
  elements.roomResultSummary.hidden = true;
  elements.roomTotal.textContent = "—";
  elements.roomTotalLabel.textContent = "확인 불가";
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  setShareButtons(false);
  setStatus(elements.roomStatus, message, "error");
  document.title = `${title} | 익명 투표소`;
}

async function initialize() {
  renderVote();
  renderResults();

  try {
    const parameter = new URL(window.location.href).searchParams.get("r");
    if (!parameter) throw new Error("공유 링크에 투표방 정보가 없습니다.");
    roomId = core.validateRoomId(parameter);
  } catch (error) {
    showStartupError("투표방 주소를 확인해 주세요", "방장에게 받은 공유 링크를 다시 열어 주세요.", error.message);
    return;
  }

  if (!core.firebaseConfigReady(firebaseConfig)) {
    showStartupError(
      "Firebase 연결이 필요합니다",
      "익명 투표소의 공개 웹 설정이 아직 준비되지 않았습니다.",
      "방장에게 Firebase 연결 상태를 확인해 달라고 알려 주세요.",
    );
    return;
  }

  try {
    store = await createPollRoomStore(firebaseConfig, { ensureAnonymous: true });
    await store.ensureParticipantSession();
    unsubscribeAuth = store.subscribeAuthState(
      handleAuthState,
      (error) => showSubscriptionError(error, "auth"),
    );
  } catch (error) {
    showStartupError(
      "익명 투표를 시작하지 못했어요",
      "익명 참여 연결을 만들지 못했습니다.",
      firebaseErrorMessage(error, "익명 투표를 시작하지 못했습니다."),
    );
  }
}

elements.voteChoices.addEventListener("change", (event) => {
  const input = event.target.closest("input[name='pollChoice']");
  if (!input || input.disabled || saving) return;
  draftChoice = core.normalizeChoice(input.value);
  voteFeedback = null;
  renderVote();
});

elements.ownerSignIn.addEventListener("click", async () => {
  if (!store || !room || isOwner() || ownerAuthBusy || subscriptionFailed) return;
  const switchingGoogleAccount = Boolean(store.isGoogleAccount?.());
  if (switchingGoogleAccount) {
    const confirmed = window.confirm(
      "현재 Google 계정은 이 투표방의 방장이 아닙니다.\n\n"
      + "다른 계정으로 전환하면 현재 계정이나 이 브라우저의 익명 투표 수정 권한을 잃을 수 있습니다. 계속할까요?",
    );
    if (!confirmed) return;
  }

  ownerAuthBusy = true;
  ownerAccessFeedback = null;
  resetIdentitySubscriptions();
  renderAll();
  try {
    if (switchingGoogleAccount) await store.signOutCreator({ ensureAnonymous: true });
    try {
      await store.signInCreatorWithGoogle();
    } catch (error) {
      if (!store.hasPendingGoogleAccount?.()) throw error;
      const confirmed = window.confirm(
        "선택한 Google 계정으로 전환할까요?\n\n"
        + "전환하면 이 브라우저의 기존 익명 투표 수정 권한을 잃을 수 있습니다.",
      );
      if (!confirmed) {
        store.clearPendingGoogleAccount?.();
        ownerAccessFeedback = { message: "방장 계정 전환을 취소했어요.", state: "warning" };
        return;
      }
      await store.switchToPendingGoogleAccount();
    }
    ownerAccessFeedback = room.ownerUid === currentUid()
      ? { message: "방장 계정을 확인했어요.", state: "success" }
      : { message: "선택한 Google 계정은 이 투표방의 방장이 아니에요.", state: "warning" };
    showToast(room.ownerUid === currentUid() ? "방장 계정을 확인했어요" : "방장 계정이 아니에요");
  } catch (error) {
    ownerAccessFeedback = { message: firebaseErrorMessage(error, "방장 계정을 확인하지 못했어요."), state: "error" };
  } finally {
    subscriptionFailed = false;
    let recoveryError = null;
    try {
      if (!store.user) await store.ensureParticipantSession();
      observedIdentityKey = identityKey(store.user);
      subscribeForCurrentIdentity();
    } catch (error) {
      recoveryError = error;
    }
    ownerAuthBusy = false;
    if (recoveryError) {
      showSubscriptionError(recoveryError, "auth");
      return;
    }
    renderAll();
    syncResultsSubscription();
    if (isOwner() && !elements.resultsPanel.hidden) elements.resultsTitle.focus();
  }
});

elements.voteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || !room || room.locked || saving || !voteResolved || !editorDirty()) return;
  let choice;
  try {
    choice = core.normalizeChoice(draftChoice);
  } catch (error) {
    voteFeedback = { message: error.message, state: "error" };
    renderVote();
    return;
  }

  saving = true;
  voteFeedback = null;
  renderVote();
  try {
    const wasFirstVote = !ownVote;
    await store.castVote(roomId, choice);
    ownVote = { ...(ownVote || {}), choice };
    voteResolved = true;
    draftChoice = choice;
    voteFeedback = { message: `‘${choiceLabel(choice)}’으로 익명 투표를 저장했어요.`, state: "success" };
    showToast(wasFirstVote ? "익명 투표를 저장했어요" : "내 선택을 바꿨어요");
    syncResultsSubscription();
  } catch (error) {
    const closed = String(error?.code || "").includes("permission-denied");
    voteFeedback = {
      message: closed
        ? "투표가 방금 마감됐거나 상태가 바뀌었어요. 최신 상태를 확인해 주세요."
        : firebaseErrorMessage(error, "익명 투표를 저장하지 못했어요."),
      state: "error",
    };
  } finally {
    saving = false;
    renderAll();
  }
});

[elements.headerCopy, elements.share, elements.ownerCopy].forEach((button) => {
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    try {
      await copyRoomLink();
    } catch (error) {
      const target = isOwner() ? elements.ownerStatus : elements.roomStatus;
      setStatus(target, error.message || "링크를 복사하지 못했어요.", "error");
    } finally {
      setShareButtons(Boolean(room));
    }
  });
});

elements.lockButton.addEventListener("click", async () => {
  if (!store || !room || !isOwner() || locking) return;
  const nextLocked = !room.locked;
  if (nextLocked && !window.confirm("투표를 마감할까요?\n마감 후에는 더 이상 새 투표나 선택 변경을 받지 않습니다.")) return;
  locking = true;
  ownerFeedback = null;
  renderOwner();
  try {
    await store.setLocked(roomId, nextLocked);
    room = { ...room, locked: nextLocked };
    ownerFeedback = { message: nextLocked ? "투표를 마감했어요." : "투표를 다시 열었어요.", state: "success" };
    showToast(nextLocked ? "투표를 마감했어요" : "투표를 다시 열었어요");
    syncResultsSubscription();
  } catch (error) {
    ownerFeedback = { message: firebaseErrorMessage(error, "투표 상태를 바꾸지 못했어요."), state: "error" };
  } finally {
    locking = false;
    renderAll();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!editorDirty() || room?.locked) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize();
