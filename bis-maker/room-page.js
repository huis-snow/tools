import { createBisRoomStore } from "./firebase-room-store.js";
import {
  createToast,
  firebaseErrorMessage,
  roomUrl,
  setStatus,
} from "./ui-common.js";

const core = globalThis.BisTrackerCore;
const firebaseConfig = globalThis.BisTrackerFirebaseConfig;

if (!core) throw new Error("비스표 데이터 모듈을 불러오지 못했습니다.");

const EMPTY_GEAR_CODE = "X".repeat(core.GEAR_SLOTS.length);
const elements = {
  banner: document.querySelector("#bisRoomBanner"),
  title: document.querySelector("#bisRoomTitle"),
  meta: document.querySelector("#bisRoomMeta"),
  state: document.querySelector("#bisRoomState"),
  status: document.querySelector("#bisRoomStatus"),
  submittedCount: document.querySelector("#bisSubmittedMemberCount"),
  summaryLink: document.querySelector("#bisSummaryLink"),
  headerSummaryLink: document.querySelector("#bisHeaderSummaryLink"),
  missingActions: document.querySelector("#bisRoomMissingActions"),
  workspace: document.querySelector("#bisRoomWorkspace"),
  picker: document.querySelector("#bisMemberPicker"),
  pickerStatus: document.querySelector("#bisMemberPickerStatus"),
  selectedMember: document.querySelector("#bisSelectedMember"),
  selectedSeat: document.querySelector("#bisSelectedSeat"),
  selectedNickname: document.querySelector("#bisSelectedNickname"),
  selectedJob: document.querySelector("#bisSelectedJob"),
  changeMember: document.querySelector("#bisChangeMemberButton"),
  form: document.querySelector("#bisGearForm"),
  gearGrid: document.querySelector("#bisGearGrid"),
  selectedGearCount: document.querySelector("#bisSelectedGearCount"),
  saveButton: document.querySelector("#bisMemberSaveButton"),
  saveStatus: document.querySelector("#bisMemberSaveStatus"),
  toast: document.querySelector("#toast"),
};

let store = null;
let roomId = "";
let room = null;
let members = [];
let roomResolved = false;
let membersResolved = false;
let roomFromCache = false;
let membersFromCache = false;
let roomPendingWrites = false;
let membersPendingWrites = false;
let subscriptionFailed = false;
let roomMissing = false;
let selectedSeat = "";
let ownSeat = "";
let draftGear = core.emptyGear();
let baselineGearCode = EMPTY_GEAR_CODE;
let editorDirty = false;
let saving = false;
let saveFeedback = null;
let unsubscribeRoom = null;
let unsubscribeMembers = null;

const showToast = createToast(elements.toast);

function currentUid() {
  return String(store?.user?.uid || "");
}

function memberForSeat(seat) {
  return members.find((member) => member.seat === seat) || null;
}

function selectedMember() {
  return memberForSeat(selectedSeat);
}

function currentGearCode() {
  return core.encodeGear(draftGear, { allowUnset: true });
}

function selectedGearCount() {
  return core.GEAR_SLOTS.filter((slot) => draftGear[slot] !== null).length;
}

function rosterReady() {
  return members.length === core.SEATS.length
    && core.SEATS.every((seat) => memberForSeat(seat));
}

function selectedSeatIsEditable() {
  const member = selectedMember();
  const uid = currentUid();
  if (!room || room.locked || subscriptionFailed || saving || !rosterReady() || !member || !uid) return false;
  if (ownSeat && member.seat !== ownSeat) return false;
  if (member.editorUid) return member.editorUid === uid;
  return !ownSeat || ownSeat === member.seat;
}

function updateDirty() {
  editorDirty = Boolean(selectedSeat && currentGearCode() !== baselineGearCode);
}

function setSummaryLinks(id) {
  const summary = roomUrl("summary.html", id).toString();
  elements.summaryLink.href = summary;
  elements.headerSummaryLink.href = summary;
  elements.summaryLink.removeAttribute("aria-disabled");
  elements.headerSummaryLink.removeAttribute("aria-disabled");
}

function disableSummaryLinks() {
  [elements.summaryLink, elements.headerSummaryLink].forEach((link) => {
    link.removeAttribute("href");
    link.setAttribute("aria-disabled", "true");
  });
}

function shortTime() {
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch (_error) {
    return "방금";
  }
}

function syncRoomStatus() {
  if (subscriptionFailed || roomMissing) return;
  if (!roomResolved) {
    setStatus(elements.status, roomFromCache
      ? "이 브라우저에 저장된 방 정보가 없어 서버 연결을 기다리고 있어요."
      : "Firebase에서 방 정보를 확인하고 있어요.", roomFromCache ? "warning" : "");
    return;
  }
  if (!membersResolved || !rosterReady()) {
    if (membersResolved && !membersFromCache) {
      setStatus(elements.status, `공대 명단이 완전하지 않아요. 방장에게 알려 주세요. (${members.length}/8명)`, "error");
      return;
    }
    const cachedRoster = membersFromCache && !rosterReady();
    setStatus(elements.status, cachedRoster
      ? "공대 명단을 서버에서 확인하고 있어요. 잠시만 기다려 주세요."
      : "8명의 공대 명단을 불러오고 있어요.", cachedRoster ? "warning" : "");
    return;
  }
  if (roomPendingWrites || membersPendingWrites) {
    setStatus(elements.status, "변경 내용을 Firebase에 저장하고 있어요.");
  } else if (roomFromCache || membersFromCache) {
    setStatus(elements.status, "서버 연결을 확인하고 있어요. 잠시 이전 데이터가 보일 수 있습니다.", "warning");
  } else {
    setStatus(elements.status, `동기화됨 · ${shortTime()}`, "success");
  }
}

function renderRoom() {
  if (!room) return;
  elements.banner.setAttribute("aria-busy", String(!rosterReady() && (!membersResolved || membersFromCache)));
  elements.title.textContent = room.title;
  elements.meta.textContent = `${room.tier} · 일회성 취합`;
  elements.state.textContent = room.locked ? "입력 마감" : "입력 중";
  elements.state.dataset.state = room.locked ? "locked" : "open";
  elements.submittedCount.textContent = String(members.filter((member) => member.submitted).length);
  elements.missingActions.hidden = true;
  elements.workspace.hidden = false;
  document.title = `${room.title} | 내 BiS 입력`;
  syncRoomStatus();
}

function pickerState(member) {
  const uid = currentUid();
  const isOwn = Boolean(uid && member.editorUid === uid);
  const occupied = Boolean(member.editorUid && !isOwn);

  if (isOwn && ownSeat && member.seat !== ownSeat) {
    return { disabled: true, state: "unavailable", label: "중복 자리 · 방장 문의" };
  }
  if (isOwn) return { disabled: room?.locked || saving || subscriptionFailed, state: "own", label: member.submitted ? "내 자리 · 입력 완료" : "내 자리" };
  if (occupied) return { disabled: true, state: "occupied", label: "사용 중" };
  if (room?.locked) return { disabled: true, state: "locked", label: "입력 마감" };
  if (subscriptionFailed || !room || !rosterReady()) return { disabled: true, state: "loading", label: "확인 중" };
  if (ownSeat) return { disabled: true, state: "unavailable", label: "내 자리 선택 완료" };
  if (saving) return { disabled: true, state: "saving", label: "저장 중" };
  return {
    disabled: false,
    state: member.submitted ? "submitted" : "available",
    label: member.submitted ? "입력됨 · 선택 가능" : "선택 가능",
  };
}

function syncPickerStatus() {
  if (subscriptionFailed) {
    setStatus(elements.pickerStatus, "서버 연결을 복구한 뒤 페이지를 새로고침해 주세요.", "error");
    return;
  }
  if (!membersResolved || !rosterReady()) {
    if (membersResolved && !membersFromCache) {
      setStatus(elements.pickerStatus, `공대 명단을 온전히 불러오지 못했어요. 현재 ${members.length}/8명입니다.`, "error");
    } else {
      setStatus(elements.pickerStatus, "공대 명단을 불러오고 있어요.");
    }
    return;
  }
  if (room?.locked) {
    setStatus(elements.pickerStatus, "방장이 입력을 마감했어요. 저장된 상태만 확인할 수 있어요.", "warning");
    return;
  }
  const own = memberForSeat(ownSeat);
  if (own) {
    setStatus(elements.pickerStatus, `${own.seat} ${own.nickname} 자리를 이 브라우저의 내 자리로 찾았어요.`, "success");
    return;
  }
  const available = members.filter((member) => !member.editorUid).length;
  setStatus(elements.pickerStatus, available
    ? `선택 가능한 자리가 ${available}개 있어요. 저장할 때 내 자리로 확정됩니다.`
    : "8명의 자리가 모두 사용 중이에요. 방장에게 자리 해제를 요청해 주세요.", available ? "" : "warning");
}

function renderPicker() {
  const buttons = Array.from(elements.picker.querySelectorAll("[data-seat]"));
  buttons.forEach((button) => {
    const member = memberForSeat(button.dataset.seat);
    const nickname = button.querySelector("[data-field='nickname']");
    const job = button.querySelector("[data-field='job']");
    const claimState = button.querySelector("[data-field='claim-state']");
    if (!member) {
      nickname.textContent = "—";
      job.textContent = "—";
      claimState.textContent = "확인 중";
      button.disabled = true;
      button.dataset.state = "loading";
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-disabled", "true");
      return;
    }
    const presentation = pickerState(member);
    nickname.textContent = member.nickname;
    job.textContent = member.job;
    claimState.textContent = presentation.label;
    button.disabled = presentation.disabled;
    button.dataset.state = presentation.state;
    button.setAttribute("aria-checked", String(selectedSeat === member.seat));
    button.setAttribute("aria-disabled", String(presentation.disabled));
  });
  syncPickerStatus();
}

function renderGearEditor() {
  const member = selectedMember();
  const canEdit = selectedSeatIsEditable();
  const count = selectedGearCount();
  const own = Boolean(member && member.editorUid && member.editorUid === currentUid());

  elements.selectedMember.hidden = !member;
  if (member) {
    elements.selectedSeat.textContent = member.seat;
    elements.selectedNickname.textContent = member.nickname;
    elements.selectedJob.textContent = member.job;
  }
  elements.changeMember.hidden = !member || own;
  elements.changeMember.disabled = saving || Boolean(room?.locked);

  core.GEAR_SLOTS.forEach((slot) => {
    const fieldset = elements.gearGrid.querySelector(`[data-slot="${slot}"]`);
    if (!fieldset) return;
    const status = draftGear[slot];
    fieldset.disabled = !canEdit;
    if (status) fieldset.dataset.status = status;
    else delete fieldset.dataset.status;
    fieldset.querySelectorAll("input[type='radio']").forEach((input) => {
      input.checked = input.value === status;
      input.disabled = !canEdit;
    });
  });

  elements.form.setAttribute("aria-disabled", String(!canEdit));
  elements.selectedGearCount.textContent = String(count);
  const allSelected = count === core.GEAR_SLOTS.length;
  elements.saveButton.disabled = !canEdit || !allSelected || (own && !editorDirty && member?.submitted);
  elements.saveButton.innerHTML = own
    ? '내 BiS 다시 저장 <span aria-hidden="true">→</span>'
    : '내 자리로 선택하고 저장 <span aria-hidden="true">→</span>';

  if (saving) {
    setStatus(elements.saveStatus, "내 BiS 상태를 Firebase에 저장하고 있어요.");
  } else if (subscriptionFailed) {
    setStatus(elements.saveStatus, "서버 연결을 복구한 뒤 다시 입력해 주세요.", "error");
  } else if (room?.locked) {
    setStatus(elements.saveStatus, editorDirty
      ? "입력이 마감되어 저장하지 않은 변경사항을 보낼 수 없어요."
      : "방장이 입력을 마감했어요. 현재 상태는 읽기만 할 수 있어요.", "warning");
  } else if (!member) {
    setStatus(elements.saveStatus, "내 자리를 먼저 선택해 주세요.");
  } else if (!canEdit) {
    setStatus(elements.saveStatus, "선택한 자리는 지금 편집할 수 없어요.", "warning");
  } else if (saveFeedback) {
    setStatus(elements.saveStatus, saveFeedback.message, saveFeedback.state);
  } else if (!allSelected) {
    setStatus(elements.saveStatus, `${count}/11개를 선택했어요. 남은 ${11 - count}개 부위도 골라 주세요.`, editorDirty ? "warning" : "");
  } else if (editorDirty) {
    setStatus(elements.saveStatus, "11개를 모두 골랐어요. 아직 서버에 저장하지 않은 변경사항이 있어요.", "warning");
  } else if (own && member.submitted) {
    setStatus(elements.saveStatus, "이 브라우저의 장비 상태가 서버에 저장되어 있어요.", "success");
  } else {
    setStatus(elements.saveStatus, "11개를 모두 골랐어요. 저장하면 이 자리가 내 자리로 확정됩니다.", "success");
  }
}

function renderAll() {
  renderRoom();
  renderPicker();
  renderGearEditor();
}

function loadMember(member) {
  selectedSeat = member.seat;
  draftGear = core.decodeGear(member.gear, { allowUnset: true });
  baselineGearCode = member.gear;
  editorDirty = false;
  saveFeedback = null;
}

function confirmDiscard() {
  return !editorDirty || window.confirm("저장하지 않은 장비 상태를 버리고 자리를 바꿀까요?");
}

function selectMember(seat) {
  const member = memberForSeat(seat);
  if (!member || pickerState(member).disabled || selectedSeat === seat) return;
  if (!confirmDiscard()) return;
  loadMember(member);
  renderAll();
  setStatus(elements.pickerStatus, `${member.seat} ${member.nickname} 자리를 선택했어요. 저장하기 전까지는 자리가 확정되지 않습니다.`);
  elements.selectedMember.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}

function clearSelection() {
  selectedSeat = "";
  draftGear = core.emptyGear();
  baselineGearCode = EMPTY_GEAR_CODE;
  editorDirty = false;
  saveFeedback = null;
  renderAll();
}

function applyMembersSnapshot(payload) {
  const previousSelectedSeat = selectedSeat;
  const previousOwnSeat = ownSeat;
  members = payload.members;
  membersResolved = true;
  membersFromCache = Boolean(payload.fromCache);
  membersPendingWrites = Boolean(payload.hasPendingWrites);

  const uid = currentUid();
  ownSeat = uid ? core.SEATS.find((seat) => memberForSeat(seat)?.editorUid === uid) || "" : "";

  if (ownSeat && selectedSeat !== ownSeat) {
    const own = memberForSeat(ownSeat);
    if (own) {
      const discardedDraft = Boolean(selectedSeat && editorDirty);
      loadMember(own);
      if (discardedDraft) showToast("다른 탭에서 확정한 내 자리를 불러왔어요");
    }
  } else if (selectedSeat) {
    const selected = selectedMember();
    const claimedByOther = Boolean(selected?.editorUid && selected.editorUid !== uid);
    if (!selected || claimedByOther || (ownSeat && ownSeat !== selectedSeat)) {
      clearSelection();
      showToast("선택한 자리를 다른 사람이 먼저 사용했어요");
      return;
    }
    if (!editorDirty && !saving && selected.gear !== baselineGearCode) loadMember(selected);
  }

  renderAll();
  if (ownSeat && ownSeat !== previousOwnSeat) {
    const own = memberForSeat(ownSeat);
    if (own) setStatus(elements.pickerStatus, `${own.seat} ${own.nickname} 자리를 이 브라우저의 내 자리로 불러왔어요.`, "success");
  } else if (previousSelectedSeat && !selectedSeat) {
    setStatus(elements.pickerStatus, "다른 사람이 먼저 저장한 자리예요. 다른 자리를 선택해 주세요.", "warning");
  }
}

function showMissingRoom() {
  unsubscribeMembers?.();
  unsubscribeMembers = null;
  room = null;
  roomMissing = true;
  selectedSeat = "";
  ownSeat = "";
  editorDirty = false;
  elements.banner.setAttribute("aria-busy", "false");
  elements.title.textContent = "비스표 방을 찾지 못했어요";
  elements.meta.textContent = "주소가 잘못됐거나 방장이 삭제한 방입니다.";
  elements.state.textContent = "종료됨";
  elements.state.dataset.state = "error";
  elements.submittedCount.textContent = "0";
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  setStatus(elements.status, "새 비스표 방을 만들거나 방장에게 새 링크를 받아 주세요.", "error");
  document.title = "방을 찾지 못했어요 | 비스표";
  elements.title.focus();
}

function applyRoomSnapshot(payload) {
  if (payload?.missingFromCache) {
    roomFromCache = true;
    elements.state.textContent = "연결 대기";
    elements.state.dataset.state = "loading";
    syncRoomStatus();
    return;
  }
  if (!payload) {
    showMissingRoom();
    return;
  }
  room = payload.room;
  roomResolved = true;
  roomMissing = false;
  roomFromCache = Boolean(payload.fromCache);
  roomPendingWrites = Boolean(payload.hasPendingWrites);
  renderAll();
}

function showSubscriptionError(error, area) {
  subscriptionFailed = true;
  elements.banner.setAttribute("aria-busy", "false");
  elements.state.textContent = "연결 오류";
  elements.state.dataset.state = "error";
  setStatus(elements.status, firebaseErrorMessage(error), "error");
  renderPicker();
  renderGearEditor();
  if (area === "members") setStatus(elements.pickerStatus, "공대 명단을 불러오지 못했어요. 페이지를 새로고침해 주세요.", "error");
}

function showStartupError(title, description, errorMessage) {
  unsubscribeRoom?.();
  unsubscribeMembers?.();
  unsubscribeRoom = null;
  unsubscribeMembers = null;
  subscriptionFailed = true;
  elements.banner.setAttribute("aria-busy", "false");
  elements.title.textContent = title;
  elements.meta.textContent = description;
  elements.state.textContent = "연결 불가";
  elements.state.dataset.state = "error";
  elements.submittedCount.textContent = "0";
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  setStatus(elements.status, errorMessage, "error");
  disableSummaryLinks();
  document.title = `${title} | 비스표`;
}

async function initialize() {
  renderPicker();
  renderGearEditor();

  try {
    const parameter = new URL(window.location.href).searchParams.get("r");
    if (!parameter) throw new Error("공유 링크에 BiS 방 정보가 없습니다.");
    roomId = core.validateRoomId(parameter);
  } catch (error) {
    showStartupError("비스표 방 주소를 확인해 주세요", "공대장에게 받은 공유 링크를 다시 열어 주세요.", error.message);
    return;
  }

  setSummaryLinks(roomId);
  if (!core.firebaseConfigReady(firebaseConfig)) {
    showStartupError(
      "Firebase 연결이 필요합니다",
      "비스표 방의 공개 웹 설정이 아직 준비되지 않았습니다.",
      "방장에게 Firebase 연결 상태를 확인해 달라고 알려 주세요.",
    );
    return;
  }

  try {
    store = await createBisRoomStore(firebaseConfig, { ensureAnonymous: true });
    await store.ensureParticipantSession();
    unsubscribeRoom = store.subscribeRoom(
      roomId,
      applyRoomSnapshot,
      (error) => showSubscriptionError(error, "room"),
    );
    unsubscribeMembers = store.subscribeMembers(
      roomId,
      applyMembersSnapshot,
      (error) => showSubscriptionError(error, "members"),
    );
  } catch (error) {
    showStartupError(
      "비스표 방을 시작하지 못했어요",
      "익명 참여 연결을 만들지 못했습니다.",
      firebaseErrorMessage(error, "비스표 방을 시작하지 못했습니다."),
    );
  }
}

elements.picker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-seat]");
  if (!button || button.disabled) return;
  selectMember(button.dataset.seat);
});

elements.changeMember.addEventListener("click", () => {
  if (ownSeat || saving || !confirmDiscard()) return;
  clearSelection();
  setStatus(elements.pickerStatus, "다른 자리를 선택해 주세요.");
  elements.picker.querySelector("[data-seat]:not(:disabled)")?.focus();
});

elements.form.addEventListener("change", (event) => {
  const input = event.target.closest("input[type='radio']");
  const fieldset = input?.closest("[data-slot]");
  if (!input || !fieldset || !selectedSeatIsEditable()) return;
  draftGear[fieldset.dataset.slot] = core.normalizeGearStatus(input.value);
  saveFeedback = null;
  updateDirty();
  renderGearEditor();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !selectedSeatIsEditable()) return;
  const member = selectedMember();
  const seat = selectedSeat;
  const gear = { ...draftGear };
  try {
    core.normalizeMemberUpdate({ gear, submitted: true });
  } catch (error) {
    saveFeedback = { message: error.message, state: "error" };
    renderGearEditor();
    return;
  }

  saving = true;
  saveFeedback = null;
  renderAll();
  try {
    await store.saveMember(
      roomId,
      seat,
      { gear, submitted: true },
      { expectedGear: baselineGearCode },
    );
    const savedCode = core.encodeGear(gear, { allowUnset: false });
    members = members.map((candidate) => candidate.seat === seat ? {
      ...candidate,
      editorUid: currentUid(),
      gear: savedCode,
      submitted: true,
    } : candidate);
    ownSeat = seat;
    baselineGearCode = savedCode;
    editorDirty = currentGearCode() !== savedCode;
    saveFeedback = editorDirty
      ? { message: "저장하는 동안 바뀐 내용이 남아 있어요. 한 번 더 저장해 주세요.", state: "warning" }
      : { message: `${member.nickname}님의 11개 장비 상태를 저장했어요.`, state: "success" };
    showToast("내 BiS 상태를 저장했어요");
  } catch (error) {
    let conflictNeedsOverwrite = true;
    if (error?.code === "bis/conflict" && typeof error.currentGear === "string") {
      try {
        core.decodeGear(error.currentGear, { allowUnset: true });
        baselineGearCode = error.currentGear;
        editorDirty = currentGearCode() !== baselineGearCode;
        conflictNeedsOverwrite = editorDirty;
      } catch (_invalidCurrentGear) {
        // 서버 데이터 오류는 아래의 일반 오류 안내로 처리한다.
      }
    }
    const permissionDenied = String(error?.code || "").includes("permission-denied");
    saveFeedback = {
      message: error?.code === "bis/conflict"
        ? conflictNeedsOverwrite
          ? "다른 탭에서 먼저 저장한 변경을 확인했어요. 현재 화면의 선택으로 바꾸려면 저장 버튼을 한 번 더 눌러 주세요."
          : "다른 탭에서 같은 장비 상태를 이미 저장했어요."
        : permissionDenied
          ? "이 자리를 다른 사람이 먼저 선택했거나 방 입력이 마감됐어요. 최신 명단을 확인해 주세요."
          : firebaseErrorMessage(error, "내 BiS 상태를 저장하지 못했어요."),
      state: error?.code === "bis/conflict" && !conflictNeedsOverwrite ? "success" : "error",
    };
  } finally {
    saving = false;
    renderAll();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!editorDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

initialize();
