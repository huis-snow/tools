import { createRaidLootRoomStore } from "./firebase-room-store.js";
import {
  createToast,
  firebaseErrorMessage,
  roomIdFromLocation,
  roomUrl,
  setStatus,
} from "./ui-common.js";

const core = globalThis.RaidLootCore;
const firebaseConfig = globalThis.RaidLootFirebaseConfig;

if (!core) throw new Error("공대 파밍 데이터 모듈을 불러오지 못했습니다.");

const byId = (id) => document.getElementById(id);
const elements = {
  banner: byId("raidLootRoomBanner"),
  title: byId("raidLootRoomTitle"),
  meta: byId("raidLootRoomMeta"),
  state: byId("raidLootRoomState"),
  week: byId("raidLootRoomWeek"),
  submittedCount: byId("raidLootSubmittedMemberCount"),
  status: byId("raidLootRoomStatus"),
  missingActions: byId("raidLootRoomMissingActions"),
  workspace: byId("raidLootRoomWorkspace"),
  headerSummaryLink: byId("raidLootHeaderSummaryLink"),
  summaryLink: byId("raidLootSummaryLink"),
  picker: byId("raidLootMemberPicker"),
  pickerStatus: byId("raidLootMemberPickerStatus"),
  selectedMember: byId("raidLootSelectedMember"),
  selectedSeat: byId("raidLootSelectedSeat"),
  selectedNickname: byId("raidLootSelectedNickname"),
  selectedJob: byId("raidLootSelectedJob"),
  changeMember: byId("raidLootChangeMemberButton"),
  form: byId("raidLootGearForm"),
  selectedGearCount: byId("raidLootSelectedGearCount"),
  saveButton: byId("raidLootMemberSaveButton"),
  saveStatus: byId("raidLootMemberSaveStatus"),
  toast: byId("toast"),
};

let roomId = "";
let store = null;
let room = null;
let members = [];
let selectedSeat = "";
let loadedGear = "";
let dirty = false;
let saving = false;
let membersResolved = false;
let unsubscribeRoom = null;
let unsubscribeMembers = null;
const showToast = createToast(elements.toast);

function memberBySeat(seat) {
  return members.find((member) => member.seat === seat) || null;
}

function myClaimedMember() {
  const uid = store?.user?.uid;
  return uid ? members.find((member) => member.editorUid === uid) || null : null;
}

function allRosterReady() {
  return membersResolved && members.length === core.SEATS.length;
}

function selectedCount() {
  return core.GEAR_SLOTS.filter((slot) => elements.form.querySelector(`input[name="gear-${slot}"]:checked`)).length;
}

function gearFromForm() {
  return Object.fromEntries(core.GEAR_SLOTS.map((slot) => [
    slot,
    elements.form.querySelector(`input[name="gear-${slot}"]:checked`)?.value || null,
  ]));
}

function setFormGear(encoded) {
  const gear = core.decodeGear(encoded || "X".repeat(core.GEAR_SLOTS.length), { allowUnset: true });
  core.GEAR_SLOTS.forEach((slot) => {
    elements.form.querySelectorAll(`input[name="gear-${slot}"]`).forEach((input) => {
      input.checked = input.value === gear[slot];
    });
  });
  loadedGear = core.encodeGear(gear, { allowUnset: true });
  dirty = false;
  syncEditor();
}

function syncEditor(options = {}) {
  const member = memberBySeat(selectedSeat);
  const claimed = myClaimedMember();
  const ownsSelectedSeat = !claimed || claimed.seat === selectedSeat;
  const canEdit = Boolean(
    member
    && room
    && !room.locked
    && ownsSelectedSeat
    && (!member.editorUid || member.editorUid === store?.user?.uid),
  );
  const count = selectedCount();
  elements.selectedGearCount.textContent = String(count);
  elements.selectedMember.hidden = !member;
  if (member) {
    elements.selectedSeat.textContent = member.seat;
    elements.selectedNickname.textContent = member.nickname;
    elements.selectedJob.textContent = member.job;
  }
  elements.changeMember.hidden = Boolean(claimed);
  elements.form.querySelectorAll("input").forEach((input) => { input.disabled = !canEdit || saving; });
  elements.saveButton.disabled = !canEdit || saving || count !== core.GEAR_SLOTS.length;
  elements.saveButton.textContent = member?.editorUid === store?.user?.uid ? "장비 상태 다시 저장 →" : "내 자리로 선택하고 저장 →";

  if (options.preserveStatus === true) return;
  if (!member) setStatus(elements.saveStatus, "내 자리를 먼저 선택해 주세요.");
  else if (room?.locked) setStatus(elements.saveStatus, "공대원 입력이 마감되어 수정할 수 없어요.", "warning");
  else if (!ownsSelectedSeat) setStatus(elements.saveStatus, `${claimed.seat} ${claimed.nickname} 자리와 이미 연결되어 있어요.`, "warning");
  else if (member.editorUid && member.editorUid !== store?.user?.uid) setStatus(elements.saveStatus, "이미 다른 사람이 연결한 자리입니다.", "error");
  else if (count < core.GEAR_SLOTS.length) setStatus(elements.saveStatus, `${core.GEAR_SLOTS.length - count}개 부위를 더 선택해 주세요.`);
  else setStatus(elements.saveStatus, dirty ? "변경한 상태를 저장해 주세요." : "11개 부위를 모두 선택했어요.", dirty ? "warning" : "success");
}

function renderPicker() {
  const claimed = myClaimedMember();
  elements.picker.querySelectorAll("[data-seat]").forEach((button) => {
    const member = memberBySeat(button.dataset.seat);
    const mine = member?.editorUid && member.editorUid === store?.user?.uid;
    const occupied = Boolean(member?.editorUid && !mine);
    button.querySelector("[data-field='nickname']").textContent = member?.nickname || "—";
    button.querySelector("[data-field='job']").textContent = member?.job || "—";
    button.querySelector("[data-field='claim-state']").textContent = mine ? "내 자리" : occupied ? "사용 중" : member?.submitted ? "입력 완료" : "선택 가능";
    button.setAttribute("aria-checked", String(button.dataset.seat === selectedSeat));
    button.dataset.state = mine ? "mine" : occupied ? "occupied" : member?.submitted ? "submitted" : "open";
    button.disabled = !member || saving || occupied || Boolean(claimed && !mine);
  });
  if (!allRosterReady()) setStatus(elements.pickerStatus, "공대 명단을 불러오고 있어요.");
  else if (claimed) setStatus(elements.pickerStatus, `${claimed.seat} ${claimed.nickname} 자리와 연결되어 있어요.`, "success");
  else setStatus(elements.pickerStatus, "내 자리를 선택한 뒤 11개 부위를 입력해 주세요.", "success");
}

function selectMember(seat, options = {}) {
  const member = memberBySeat(seat);
  if (!member) return;
  const claimed = myClaimedMember();
  if (claimed && claimed.seat !== seat) return;
  if (member.editorUid && member.editorUid !== store?.user?.uid) return;
  if (dirty && options.force !== true && !window.confirm("저장하지 않은 장비 상태가 있어요. 다른 자리로 바꿀까요?")) return;
  selectedSeat = seat;
  setFormGear(member.gear);
  renderPicker();
  elements.selectedMember.hidden = false;
  elements.form.scrollIntoView({ behavior: options.quiet ? "auto" : "smooth", block: "start" });
}

function weekDate(startDate, week) {
  const parts = String(startDate || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return "";
  const date = new Date(parts[0], parts[1] - 1, parts[2] + ((week - 1) * 7));
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}

function renderRoom() {
  if (!room) return;
  elements.banner.setAttribute("aria-busy", String(!allRosterReady()));
  elements.title.textContent = room.title;
  elements.meta.textContent = `${room.tier} · ${room.currentWeek}주차 · ${weekDate(room.startDate, room.currentWeek)}`;
  elements.state.textContent = room.locked ? "입력 마감" : "입력 중";
  elements.state.dataset.state = room.locked ? "locked" : "open";
  elements.week.textContent = String(room.currentWeek).padStart(2, "0");
  elements.submittedCount.textContent = String(members.filter((member) => member.submitted).length);
  elements.workspace.hidden = false;
  elements.missingActions.hidden = true;
  const summary = roomUrl("summary.html", roomId);
  elements.headerSummaryLink.href = summary.toString();
  elements.summaryLink.href = summary.toString();
  document.title = `${room.title} · 내 BiS 입력 | 공대 파밍표`;
  setStatus(elements.status, room.locked
    ? "입력이 마감된 공대입니다. 저장된 상태만 확인할 수 있어요."
    : "공대 명단과 장비 상태를 실시간으로 불러왔어요.", room.locked ? "warning" : "success");
  renderPicker();
  syncEditor();
}

function showMissing(message, state = "error") {
  elements.banner.setAttribute("aria-busy", "false");
  elements.title.textContent = "공대 파밍방을 열 수 없어요";
  elements.meta.textContent = "공유 주소 또는 Firebase 연결을 확인해 주세요.";
  elements.state.textContent = "연결 실패";
  elements.state.dataset.state = "missing";
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  setStatus(elements.status, message, state);
}

async function initialize() {
  try {
    roomId = roomIdFromLocation(core);
  } catch (error) {
    showMissing(error.message);
    return;
  }
  if (!core.firebaseConfigReady(firebaseConfig)) {
    showMissing("Firebase 공개 웹 설정이 아직 연결되지 않았습니다.", "warning");
    return;
  }
  try {
    store = await createRaidLootRoomStore(firebaseConfig, { ensureAnonymous: true });
  } catch (error) {
    showMissing(firebaseErrorMessage(error));
    return;
  }

  unsubscribeRoom = store.subscribeRoom(roomId, (snapshot) => {
    if (!snapshot || snapshot.room === null && !snapshot.missingFromCache) {
      showMissing("삭제되었거나 존재하지 않는 공대 파밍방입니다.");
      return;
    }
    if (snapshot?.room) room = snapshot.room;
    if (room) renderRoom();
  }, (error) => showMissing(firebaseErrorMessage(error)));

  unsubscribeMembers = store.subscribeMembers(roomId, (snapshot) => {
    members = snapshot.members;
    membersResolved = true;
    const claimed = myClaimedMember();
    if (claimed && !selectedSeat) {
      selectedSeat = claimed.seat;
      setFormGear(claimed.gear);
    } else if (selectedSeat && !dirty && memberBySeat(selectedSeat)?.gear !== loadedGear) {
      setFormGear(memberBySeat(selectedSeat).gear);
    }
    if (room) renderRoom();
  }, (error) => {
    setStatus(elements.pickerStatus, firebaseErrorMessage(error, "공대 명단을 불러오지 못했어요."), "error");
  });
}

elements.picker.addEventListener("click", (event) => {
  const button = event.target.closest("[data-seat]");
  if (!button || button.disabled) return;
  selectMember(button.dataset.seat);
});

elements.changeMember.addEventListener("click", () => {
  if (dirty && !window.confirm("저장하지 않은 장비 상태를 지우고 자리를 다시 고를까요?")) return;
  selectedSeat = "";
  loadedGear = "";
  dirty = false;
  elements.form.reset();
  renderPicker();
  syncEditor();
  elements.picker.scrollIntoView({ behavior: "smooth", block: "center" });
});

elements.form.addEventListener("change", () => {
  if (!selectedSeat) return;
  dirty = core.encodeGear(gearFromForm(), { allowUnset: true }) !== loadedGear;
  syncEditor();
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || !room || room.locked || !selectedSeat || saving || !elements.form.reportValidity()) return;
  const claimed = myClaimedMember();
  if (claimed && claimed.seat !== selectedSeat) {
    setStatus(elements.saveStatus, `${claimed.seat} ${claimed.nickname} 자리와 이미 연결되어 있어요.`, "warning");
    renderPicker();
    syncEditor({ preserveStatus: true });
    return;
  }
  saving = true;
  syncEditor({ preserveStatus: true });
  setStatus(elements.saveStatus, "내 장비 상태를 저장하고 있어요.");
  try {
    const progress = core.normalizeMemberUpdate({ gear: gearFromForm(), submitted: true });
    await store.saveMember(roomId, selectedSeat, progress, { expectedGear: loadedGear });
    const savedMember = memberBySeat(selectedSeat);
    if (savedMember) {
      savedMember.editorUid = store.user.uid;
      savedMember.gear = progress.gear;
      savedMember.submitted = true;
    }
    loadedGear = progress.gear;
    dirty = false;
    setStatus(elements.saveStatus, "8주 공대에 내 BiS 상태를 저장했어요.", "success");
    showToast("내 BiS 상태를 저장했어요");
  } catch (error) {
    if (error?.code === "raid-loot/conflict" && error.currentGear) {
      setFormGear(error.currentGear);
      setStatus(elements.saveStatus, "다른 탭의 최신 상태를 불러왔어요. 다시 확인해 주세요.", "warning");
    } else {
      setStatus(elements.saveStatus, firebaseErrorMessage(error, "장비 상태를 저장하지 못했어요."), "error");
    }
  } finally {
    saving = false;
    syncEditor({ preserveStatus: true });
    renderPicker();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("pagehide", () => {
  unsubscribeRoom?.();
  unsubscribeMembers?.();
});

initialize();
