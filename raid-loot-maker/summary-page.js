import { createRaidLootRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  formatTimestamp,
  roomIdFromLocation,
  roomUrl,
  setStatus,
} from "./ui-common.js";

const core = globalThis.RaidLootCore;
const imageRenderer = globalThis.RaidLootImage;
const firebaseConfig = globalThis.RaidLootFirebaseConfig;

if (!core) throw new Error("공대 파밍 데이터 모듈을 불러오지 못했습니다.");

const byId = (id) => document.getElementById(id);
const elements = {
  banner: byId("raidLootSummaryBanner"),
  title: byId("raidLootSummaryTitle"),
  meta: byId("raidLootSummaryMeta"),
  roomState: byId("raidLootSummaryRoomState"),
  currentWeek: byId("raidLootSummaryCurrentWeek"),
  submittedCount: byId("raidLootSummarySubmittedCount"),
  status: byId("raidLootSummaryStatus"),
  missingActions: byId("raidLootSummaryMissingActions"),
  workspace: byId("raidLootSummaryWorkspace"),
  headerInputLink: byId("raidLootHeaderInputLink"),
  ownerPanel: byId("raidLootOwnerPanel"),
  ownerStatus: byId("raidLootOwnerStatus"),
  roomLockButton: byId("raidLootRoomLockButton"),
  copyInputLinkButton: byId("raidLootCopyInputLinkButton"),
  copySummaryLinkButton: byId("raidLootCopySummaryLinkButton"),
  roomSettingsForm: byId("raidLootRoomSettingsForm"),
  ownerTitleInput: byId("raidLootOwnerTitleInput"),
  ownerTierInput: byId("raidLootOwnerTierInput"),
  ownerStartDateInput: byId("raidLootOwnerStartDateInput"),
  ownerCurrentWeekSelect: byId("raidLootOwnerCurrentWeekSelect"),
  roomSettingsSaveButton: byId("raidLootRoomSettingsSaveButton"),
  policyForm: byId("raidLootPolicyForm"),
  priorityPolicySelect: byId("raidLootPriorityPolicySelect"),
  policyDescription: byId("raidLootPolicyDescription"),
  policySaveButton: byId("raidLootPolicySaveButton"),
  releaseMemberSelect: byId("raidLootReleaseMemberSelect"),
  releaseClaimButton: byId("raidLootReleaseClaimButton"),
  roomDeleteButton: byId("raidLootRoomDeleteButton"),
  weekTabs: byId("raidLootWeekTabs"),
  weekWorkspace: byId("raidLootWeekWorkspace"),
  selectedWeekNumber: byId("raidLootSelectedWeekNumber"),
  selectedWeekDate: byId("raidLootSelectedWeekDate"),
  selectedWeekAssignedCount: byId("raidLootSelectedWeekAssignedCount"),
  cumulativeAssignedCount: byId("raidLootCumulativeAssignedCount"),
  completedGearCount: byId("raidLootCompletedGearCount"),
  setCurrentWeekButton: byId("raidLootSetCurrentWeekButton"),
  table: byId("raidLootSummaryTable"),
  overallProgress: byId("raidLootOverallProgress"),
  overallProgressText: byId("raidLootOverallProgressText"),
  overallProgressCount: byId("raidLootOverallProgressCount"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  copyImageButton: byId("raidLootCopyImageButton"),
  savePngButton: byId("raidLootSavePngButton"),
  imageStatus: byId("raidLootImageStatus"),
  fairnessList: byId("raidLootFairnessList"),
  fairnessEmpty: byId("raidLootFairnessEmpty"),
  fairnessTemplate: byId("raidLootFairnessItemTemplate"),
  eventSection: byId("raidLootEventSection"),
  eventPickerForm: byId("raidLootEventPickerForm"),
  eventWeekLabel: byId("raidLootEventWeekLabel"),
  eventFloorSelect: byId("raidLootEventFloorSelect"),
  eventDropTypeSelect: byId("raidLootEventDropTypeSelect"),
  directWeaponJobField: byId("raidLootDirectWeaponJobField"),
  directWeaponJobSelect: byId("raidLootDirectWeaponJobSelect"),
  findCandidatesButton: byId("raidLootFindCandidatesButton"),
  eventPickerStatus: byId("raidLootEventPickerStatus"),
  candidatePanel: byId("raidLootCandidatePanel"),
  candidateSummary: byId("raidLootCandidateSummary"),
  candidatePolicyLabel: byId("raidLootCandidatePolicyLabel"),
  candidateList: byId("raidLootCandidateList"),
  candidateEmpty: byId("raidLootCandidateEmpty"),
  candidateTemplate: byId("raidLootCandidateItemTemplate"),
  allocationForm: byId("raidLootAllocationForm"),
  recipientSelect: byId("raidLootRecipientSelect"),
  gearSlotSelect: byId("raidLootGearSlotSelect"),
  decisionSelect: byId("raidLootDecisionSelect"),
  eventNoteInput: byId("raidLootEventNoteInput"),
  countsForFairnessInput: byId("raidLootCountsForFairnessInput"),
  recordUnassignedButton: byId("raidLootRecordUnassignedButton"),
  recordEventButton: byId("raidLootRecordEventButton"),
  allocationStatus: byId("raidLootAllocationStatus"),
  historyWeekLabel: byId("raidLootHistoryWeekLabel"),
  historyCount: byId("raidLootHistoryCount"),
  historyFloorFilter: byId("raidLootHistoryFloorFilter"),
  historyList: byId("raidLootHistoryList"),
  historyEmpty: byId("raidLootHistoryEmpty"),
  historyStatus: byId("raidLootHistoryStatus"),
  historyTemplate: byId("raidLootHistoryItemTemplate"),
  toast: byId("toast"),
};

const STATUS_DISPLAY = Object.freeze({
  complete: "✓ 완료",
  received: "● 획득",
  upgrade: "＋ 보강 필요",
  raid: "◆ 영식 필요",
  empty: "· 미입력",
});
const POLICY_LABELS = Object.freeze({
  fair: "누적 균등 분배",
  progression: "클리어 기여 우선",
  manual: "수동 선택",
  custom: "직접 우선순위",
});
const POLICY_DESCRIPTIONS = Object.freeze({
  fair: "필요한 공대원 중 공정성 집계 장비, 같은 종류, 이번 주 수령이 적은 순서로 추천해요.",
  progression: "DPS → 탱커 → 힐러 그룹 순서 안에서 누적 수령이 적은 공대원을 추천해요.",
  manual: "자동 우선순위를 계산하지 않고 MT부터 D4까지 선택 목록만 보여줘요.",
  custom: "방장이 정한 자리 순서를 가장 먼저 적용해요.",
});
const DECISION_LABELS = Object.freeze({ recommended: "추천대로", manual: "수동 변경", free: "자유 분배" });
const SKIP_LABELS = Object.freeze({ unclaimed: "미분배", external: "외부인 수령", deferred: "보류" });

let roomId = "";
let store = null;
let room = null;
let members = [];
let events = [];
let selectedWeek = 1;
let currentFilter = "all";
let candidates = [];
let selectedDrop = null;
let roomReady = false;
let membersReady = false;
let eventsReady = false;
let roomFromCache = false;
let membersFromCache = false;
let eventsFromCache = false;
let actionBusy = false;
let imageBusy = false;
let roomUnsubscribe = null;
let membersUnsubscribe = null;
let eventsUnsubscribe = null;
const showToast = createToast(elements.toast);

function isOwner() {
  return Boolean(room && store?.user?.uid && room.ownerUid === store.user.uid && store.isGoogleAccount());
}

function memberMap() {
  return new Map(members.map((member) => [member.seat, member]));
}

function hasCompleteRoster() {
  try {
    return core.normalizeMembers(members).length === core.SEATS.length;
  } catch (_error) {
    return false;
  }
}

function allMembersSubmitted() {
  return hasCompleteRoster() && members.every((member) => member.submitted);
}

function inputUrl() {
  return roomUrl("room.html", roomId);
}

function summaryUrl() {
  return roomUrl("summary.html", roomId);
}

function localDate(startDate, week) {
  const [year, month, day] = String(startDate || "").split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(year, month - 1, day + ((Number(week) - 1) * 7));
  return Number.isNaN(date.getTime()) ? null : date;
}

function weekDateLabel(week, long = false) {
  const date = room ? localDate(room.startDate, week) : null;
  if (!date) return `${week}주차`;
  return new Intl.DateTimeFormat("ko-KR", long
    ? { year: "numeric", month: "long", day: "numeric" }
    : { month: "numeric", day: "numeric" }).format(date);
}

function activeEvents() {
  if (!eventsReady) return [];
  return core.activeLootEvents(events);
}

function eventsThroughWeek(week = selectedWeek) {
  return activeEvents().filter((event) => Number(event.week) <= Number(week));
}

function eventsInWeek(week = selectedWeek) {
  return activeEvents().filter((event) => Number(event.week) === Number(week));
}

function awardedInWeek(week = selectedWeek) {
  return eventsInWeek(week).filter((event) => event.action === "award");
}

function eventOverlay(week = selectedWeek) {
  const received = new Set();
  eventsThroughWeek(week).forEach((event) => {
    if (event.action === "award" && core.DROP_SPECS[event.dropType].consumesNeed) {
      received.add(`${event.seat}@${event.gearSlot}`);
    }
  });
  return received;
}

function showMissing(message, state = "error") {
  room = null;
  elements.banner.setAttribute("aria-busy", "false");
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  elements.title.textContent = "공대 파밍방을 열 수 없어요";
  elements.meta.textContent = message;
  elements.roomState.textContent = "확인 필요";
  elements.roomState.dataset.state = "missing";
  setStatus(elements.status, message, state);
}

function updateConnectionStatus() {
  if (!room) return;
  if (!membersReady || !eventsReady || !hasCompleteRoster()) {
    setStatus(elements.status, "8인 명단과 8주 분배 원장을 불러오는 중이에요.", "loading");
  } else if (roomFromCache || membersFromCache || eventsFromCache) {
    setStatus(elements.status, "브라우저에 저장된 내용을 먼저 표시했어요. 서버 연결을 확인하고 있어요.", "warning");
  } else if (room.locked) {
    setStatus(elements.status, "공대원 입력은 마감됐지만 방장은 실제 드랍을 계속 기록할 수 있어요.", "success");
  } else {
    setStatus(elements.status, "장비 상태와 실제 드랍 원장을 실시간으로 표시하고 있어요.", "success");
  }
}

function renderHeader() {
  if (!room) return;
  elements.banner.setAttribute("aria-busy", String(!membersReady || !eventsReady));
  elements.workspace.hidden = false;
  elements.missingActions.hidden = true;
  elements.title.textContent = room.title;
  elements.meta.textContent = `${room.tier} · ${room.startDate} 시작 · 8주 파밍`;
  elements.roomState.textContent = room.locked ? "입력 마감" : "진행 중";
  elements.roomState.dataset.state = room.locked ? "locked" : "open";
  elements.currentWeek.textContent = String(room.currentWeek).padStart(2, "0");
  elements.submittedCount.textContent = String(members.filter((member) => member.submitted).length);
  elements.headerInputLink.href = inputUrl().toString();
  document.title = `${room.title} · 8주 파밍 현황 | 공대 파밍표`;
  updateConnectionStatus();
}

function effectiveStatus(member, gearSlot, received) {
  if (!member?.submitted) return "empty";
  if (received.has(`${member.seat}@${gearSlot}`)) return "received";
  return core.decodeGear(member.gear, { allowUnset: false })[gearSlot] || "empty";
}

function filterMatches(status) {
  if (currentFilter === "all") return true;
  if (currentFilter === "incomplete") return status === "upgrade" || status === "raid";
  return status === currentFilter;
}

function applyTableFilter() {
  elements.filterButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.filter === currentFilter));
  });
  elements.table.querySelectorAll("tbody tr[data-slot]").forEach((row) => {
    const matches = [...row.querySelectorAll("td[data-seat] span[data-state]")]
      .some((value) => filterMatches(value.dataset.state));
    row.hidden = currentFilter !== "all" && !matches;
  });
}

function renderTable() {
  if (!hasCompleteRoster()) return;
  const bySeat = memberMap();
  const received = eventOverlay();
  let completed = 0;
  core.SEATS.forEach((seat) => {
    const member = bySeat.get(seat);
    const header = elements.table.querySelector(`thead [data-seat="${seat}"]`);
    header.querySelector("[data-field='nickname']").textContent = member.nickname;
    header.querySelector("[data-field='job']").textContent = member.job;
  });
  core.GEAR_SLOTS.forEach((gearSlot) => {
    const row = elements.table.querySelector(`tbody tr[data-slot="${gearSlot}"]`);
    core.SEATS.forEach((seat) => {
      const member = bySeat.get(seat);
      const status = effectiveStatus(member, gearSlot, received);
      if (status === "complete" || status === "received") completed += 1;
      const cell = row.querySelector(`td[data-seat="${seat}"]`);
      let value = cell.querySelector("span[data-state]");
      if (!value) {
        value = document.createElement("span");
        cell.append(value);
      }
      value.dataset.state = status;
      value.textContent = STATUS_DISPLAY[status];
      value.setAttribute("aria-label", `${member.nickname} ${core.GEAR_LABELS[gearSlot]}: ${STATUS_DISPLAY[status].replace(/^[✓●＋◆·]\s*/, "")}`);
    });
  });
  const maximum = core.SEATS.length * core.GEAR_SLOTS.length;
  const percentage = Math.round((completed / maximum) * 100);
  elements.completedGearCount.textContent = String(completed);
  elements.overallProgress.value = completed;
  elements.overallProgress.max = maximum;
  elements.overallProgress.textContent = `${completed} / ${maximum}`;
  elements.overallProgressText.textContent = `${percentage}%`;
  elements.overallProgressCount.textContent = String(completed);
  applyTableFilter();
}

function renderWeekNavigation() {
  if (!room || !eventsReady) return;
  elements.weekTabs.querySelectorAll("[data-week]").forEach((button) => {
    const week = Number(button.dataset.week);
    const selected = week === selectedWeek;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.dataset.state = week === room.currentWeek ? "current" : week < room.currentWeek ? "past" : "future";
    button.querySelector("[data-field='date']").textContent = weekDateLabel(week);
    button.querySelector("[data-field='count']").textContent = String(eventsInWeek(week).length);
  });
  elements.weekWorkspace.setAttribute("aria-labelledby", `raidLootWeekTab${selectedWeek}`);
  elements.selectedWeekNumber.textContent = String(selectedWeek);
  elements.selectedWeekDate.textContent = `${weekDateLabel(selectedWeek, true)} 시작`;
  elements.eventWeekLabel.textContent = String(selectedWeek);
  elements.historyWeekLabel.textContent = String(selectedWeek);
  elements.setCurrentWeekButton.hidden = !isOwner() || selectedWeek === room.currentWeek;
  elements.setCurrentWeekButton.disabled = actionBusy;
}

function renderStatistics() {
  if (!hasCompleteRoster() || !eventsReady) return;
  const through = eventsThroughWeek();
  const statistics = core.cumulativeStatistics(members, through);
  const weekAwards = awardedInWeek().length;
  const cumulativeAwards = through.filter((event) => event.action === "award").length;
  elements.selectedWeekAssignedCount.textContent = String(weekAwards);
  elements.cumulativeAssignedCount.textContent = String(cumulativeAwards);
  elements.fairnessList.replaceChildren();
  const maximum = Math.max(1, ...statistics.map((item) => item.totalAwards));
  statistics.forEach((stat) => {
    const fragment = elements.fairnessTemplate.content.cloneNode(true);
    const item = fragment.querySelector("li");
    item.querySelector("[data-field='seat']").textContent = stat.seat;
    item.querySelector("[data-field='nickname']").textContent = stat.nickname;
    item.querySelector("[data-field='job']").textContent = stat.job;
    item.querySelector("[data-field='count']").textContent = String(stat.totalAwards);
    const bar = item.querySelector("[data-field='bar']");
    bar.style.width = `${Math.round((stat.totalAwards / maximum) * 100)}%`;
    bar.parentElement.setAttribute("aria-label", `공정성 집계 ${stat.totalAwards}개`);
    elements.fairnessList.append(item);
  });
  elements.fairnessEmpty.hidden = statistics.some((item) => item.totalAwards > 0);
}

function renderReleaseMembers() {
  if (!isOwner() || !hasCompleteRoster()) return;
  const previous = elements.releaseMemberSelect.value;
  const claimed = members.filter((member) => member.editorUid);
  elements.releaseMemberSelect.replaceChildren(new Option("공대원 선택", ""));
  claimed.forEach((member) => elements.releaseMemberSelect.append(new Option(
    `${member.seat} · ${member.nickname} (${member.job})`, member.seat,
  )));
  if (claimed.some((member) => member.seat === previous)) elements.releaseMemberSelect.value = previous;
}

function syncOwnerPanel(options = {}) {
  const owner = isOwner();
  elements.ownerPanel.hidden = !owner;
  if (!owner || !room) return;
  elements.ownerPanel.setAttribute("aria-busy", String(actionBusy));
  elements.roomLockButton.textContent = room.locked ? "공대원 입력 다시 열기" : "공대원 입력 마감";
  elements.ownerTitleInput.value = room.title;
  elements.ownerTierInput.value = room.tier;
  elements.ownerStartDateInput.value = room.startDate;
  elements.ownerCurrentWeekSelect.value = String(room.currentWeek);
  elements.priorityPolicySelect.value = room.policy.preset;
  elements.policyDescription.textContent = POLICY_DESCRIPTIONS[room.policy.preset];
  elements.ownerPanel.querySelectorAll("button, input, select").forEach((control) => { control.disabled = actionBusy; });
  elements.releaseClaimButton.disabled = actionBusy || !elements.releaseMemberSelect.value;
  renderReleaseMembers();
  if (options.preserveStatus !== true) {
    setStatus(elements.ownerStatus, room.locked
      ? "공대원 입력이 마감됐어요. 실제 드랍 기록은 계속할 수 있습니다."
      : "공대원 입력 링크가 열려 있어요.", room.locked ? "warning" : "success");
  }
}

function resetCandidates(message = "층과 실제로 나온 아이템을 선택해 주세요.") {
  candidates = [];
  selectedDrop = null;
  elements.candidatePanel.hidden = true;
  elements.candidateList.replaceChildren();
  setStatus(elements.eventPickerStatus, message);
}

function populateDropTypes() {
  const floor = Number(elements.eventFloorSelect.value);
  elements.eventDropTypeSelect.replaceChildren(new Option("아이템 선택", ""));
  if (Number.isInteger(floor) && floor >= 1 && floor <= core.FLOOR_COUNT) {
    core.floorDropTypes(floor).forEach((dropType) => {
      elements.eventDropTypeSelect.append(new Option(core.DROP_SPECS[dropType].label, dropType));
    });
  }
  syncDirectWeaponField();
  resetCandidates(floor ? `${floor}층에서 나온 아이템을 선택해 주세요.` : undefined);
}

function syncDirectWeaponField() {
  const direct = elements.eventDropTypeSelect.value === "direct_weapon";
  if (elements.directWeaponJobField) elements.directWeaponJobField.hidden = !direct;
  if (elements.directWeaponJobSelect) {
    const previous = elements.directWeaponJobSelect.value;
    const jobs = [...new Set(members.map((member) => member.job).filter(Boolean))];
    elements.directWeaponJobSelect.replaceChildren(new Option("직업 선택", ""));
    jobs.forEach((job) => elements.directWeaponJobSelect.append(new Option(job, job)));
    if (jobs.includes(previous)) elements.directWeaponJobSelect.value = previous;
    elements.directWeaponJobSelect.required = direct;
  }
}

function currentDrop() {
  const floor = Number(elements.eventFloorSelect.value);
  const dropType = elements.eventDropTypeSelect.value;
  return core.normalizeDrop({
    floor,
    dropType,
    job: dropType === "direct_weapon" ? elements.directWeaponJobSelect?.value || "" : "",
  });
}

function candidateHistory() {
  return eventsThroughWeek();
}

function populateGearSlots(candidate) {
  elements.gearSlotSelect.replaceChildren();
  if (!candidate || !candidate.gearSlots.length) {
    elements.gearSlotSelect.append(new Option("부위 없음", ""));
    elements.gearSlotSelect.value = "";
    elements.gearSlotSelect.required = false;
    elements.gearSlotSelect.disabled = true;
    return;
  }
  candidate.gearSlots.forEach((gearSlot) => elements.gearSlotSelect.append(new Option(
    core.GEAR_LABELS[gearSlot], gearSlot,
  )));
  elements.gearSlotSelect.value = candidate.suggestedGearSlot;
  elements.gearSlotSelect.required = true;
  elements.gearSlotSelect.disabled = actionBusy;
}

function selectCandidate(seat, options = {}) {
  const candidate = candidates.find((item) => item.seat === seat);
  if (!candidate) return;
  elements.recipientSelect.value = candidate.seat;
  populateGearSlots(candidate);
  elements.recordEventButton.disabled = actionBusy || !isOwner();
  const recommended = candidates[0]?.seat === candidate.seat;
  if (options.preserveDecision !== true) elements.decisionSelect.value = recommended ? "recommended" : "manual";
  setStatus(elements.allocationStatus, `${candidate.seat} ${candidate.nickname} · ${candidate.reasons.join(" · ")}`, "success");
}

function renderCandidates() {
  elements.candidateList.replaceChildren();
  candidates.forEach((candidate) => {
    const fragment = elements.candidateTemplate.content.cloneNode(true);
    const item = fragment.querySelector("li");
    item.dataset.seat = candidate.seat;
    item.querySelector("[data-field='rank']").textContent = String(candidate.rank);
    item.querySelector("[data-field='seat']").textContent = candidate.seat;
    item.querySelector("[data-field='nickname']").textContent = candidate.nickname;
    item.querySelector("[data-field='job']").textContent = candidate.job;
    item.querySelector("[data-field='reason']").textContent = candidate.reasons.join(" · ");
    item.querySelector("[data-field='gear-slot']").textContent = candidate.gearSlots.length
      ? candidate.gearSlots.map((slot) => core.GEAR_LABELS[slot]).join(" / ")
      : "장비와 무관";
    item.querySelector("[data-action='select-candidate']").disabled = actionBusy || !isOwner();
    elements.candidateList.append(item);
  });
  elements.recipientSelect.replaceChildren(new Option("미분배", ""));
  candidates.forEach((candidate) => elements.recipientSelect.append(new Option(
    `${candidate.rank}순위 · ${candidate.seat} ${candidate.nickname}`, candidate.seat,
  )));
  elements.candidatePanel.hidden = false;
  elements.candidateEmpty.hidden = candidates.length !== 0;
  elements.candidatePolicyLabel.textContent = POLICY_LABELS[room.policy.preset];
  elements.candidateSummary.textContent = candidates.length
    ? `${core.DROP_SPECS[selectedDrop.dropType].label} 필요자 ${candidates.length}명을 누적 원장으로 비교했어요.`
    : `${core.DROP_SPECS[selectedDrop.dropType].label}을 받을 수 있는 입력 완료 공대원이 없어요.`;
  elements.gearSlotSelect.replaceChildren(new Option("먼저 받는 사람 선택", ""));
  elements.gearSlotSelect.disabled = true;
  elements.recordEventButton.disabled = true;
  elements.recordUnassignedButton.disabled = actionBusy || !isOwner();
  if (candidates.length) selectCandidate(candidates[0].seat);
}

function syncEventControls(options = {}) {
  const ready = allMembersSubmitted();
  const owner = isOwner();
  const writableWeek = room && selectedWeek <= room.currentWeek;
  const disabled = actionBusy || !owner || !ready || !writableWeek;
  elements.eventPickerForm.querySelectorAll("select, button").forEach((control) => { control.disabled = disabled; });
  if (elements.directWeaponJobSelect) elements.directWeaponJobSelect.disabled = disabled;
  elements.allocationForm.querySelectorAll("input, select, button").forEach((control) => { control.disabled = disabled; });
  if (!elements.recipientSelect.value) elements.recordEventButton.disabled = true;
  if (!owner) {
    setStatus(elements.eventPickerStatus, "실제 드랍 원장은 방장만 기록할 수 있어요.", "warning");
  } else if (!ready) {
    setStatus(elements.eventPickerStatus, `8명 모두 장비 상태를 저장하면 자동 추천을 사용할 수 있어요. (${members.filter((member) => member.submitted).length} / 8명)`, "warning");
  } else if (!writableWeek) {
    setStatus(elements.eventPickerStatus, "미래 주차는 먼저 현재 주차로 설정한 뒤 기록해 주세요.", "warning");
  } else if (options.preserveStatus !== true && !selectedDrop) {
    setStatus(elements.eventPickerStatus, "층과 실제로 나온 아이템을 선택해 주세요.");
  }
}

function renderHistory() {
  if (!eventsReady) return;
  const bySeat = memberMap();
  const floorFilter = elements.historyFloorFilter.value;
  const history = eventsInWeek().filter((event) => floorFilter === "all" || String(event.floor) === floorFilter);
  elements.historyList.replaceChildren();
  history.forEach((lootEvent) => {
    const fragment = elements.historyTemplate.content.cloneNode(true);
    const item = fragment.querySelector("li");
    item.dataset.eventId = lootEvent.id;
    item.querySelector("[data-field='time']").textContent = formatTimestamp(lootEvent.createdAt);
    item.querySelector("[data-field='floor']").textContent = `${lootEvent.floor}층`;
    item.querySelector("[data-field='drop-label']").textContent = core.DROP_SPECS[lootEvent.dropType].label;
    const gear = item.querySelector("[data-field='gear-slot']");
    const recipient = item.querySelector("[data-field='recipient']");
    const decision = item.querySelector("[data-field='decision']");
    if (lootEvent.action === "award") {
      const member = bySeat.get(lootEvent.seat);
      gear.textContent = lootEvent.gearSlot ? core.GEAR_LABELS[lootEvent.gearSlot] : "장비와 무관";
      recipient.querySelector("[data-field='seat']").textContent = lootEvent.seat;
      recipient.querySelector("[data-field='nickname']").textContent = member?.nickname || lootEvent.seat;
      decision.textContent = DECISION_LABELS[lootEvent.decision];
      decision.dataset.state = lootEvent.countsForFairness ? lootEvent.decision : "excluded";
      if (!lootEvent.countsForFairness) decision.title = "공정성 집계 제외";
    } else {
      gear.textContent = SKIP_LABELS[lootEvent.reason];
      recipient.querySelector("[data-field='seat']").textContent = "—";
      recipient.querySelector("[data-field='nickname']").textContent = "미분배";
      decision.textContent = SKIP_LABELS[lootEvent.reason];
      decision.dataset.state = "skip";
    }
    const note = item.querySelector("[data-field='note']");
    note.textContent = lootEvent.note;
    note.hidden = !lootEvent.note;
    const undo = item.querySelector("[data-action='undo-event']");
    undo.hidden = !isOwner();
    undo.disabled = actionBusy;
    elements.historyList.append(item);
  });
  elements.historyCount.textContent = String(history.length);
  elements.historyEmpty.hidden = history.length !== 0;
  setStatus(elements.historyStatus, floorFilter === "all"
    ? `${selectedWeek}주차 활성 기록 ${history.length}개를 표시했어요.`
    : `${selectedWeek}주차 ${floorFilter}층 기록 ${history.length}개를 표시했어요.`, "success");
}

function renderAll(options = {}) {
  if (!room) return;
  renderHeader();
  renderWeekNavigation();
  if (membersReady && eventsReady && hasCompleteRoster()) {
    renderTable();
    renderStatistics();
    renderHistory();
  }
  syncDirectWeaponField();
  syncOwnerPanel(options);
  syncEventControls(options);
}

async function withOwnerAction(message, action, successMessage) {
  if (!isOwner() || actionBusy) return;
  actionBusy = true;
  syncOwnerPanel({ preserveStatus: true });
  syncEventControls({ preserveStatus: true });
  setStatus(elements.ownerStatus, message);
  try {
    await action();
    if (successMessage) {
      setStatus(elements.ownerStatus, successMessage, "success");
      showToast(successMessage);
    }
  } catch (error) {
    setStatus(elements.ownerStatus, firebaseErrorMessage(error, "방장 작업을 완료하지 못했어요."), "error");
  } finally {
    actionBusy = false;
    renderAll({ preserveStatus: true });
  }
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("PNG 이미지를 만들지 못했습니다."));
  }, "image/png"));
}

function renderImageCanvas() {
  if (!imageRenderer?.renderRaidLootSummaryImage) throw new Error("이미지 모듈을 불러오지 못했습니다.");
  if (!room || !hasCompleteRoster() || !eventsReady) throw new Error("8주 현황을 모두 불러온 뒤 다시 시도해 주세요.");
  return imageRenderer.renderRaidLootSummaryImage(room, members, events, { week: selectedWeek });
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
  roomUnsubscribe = store.subscribeRoom(roomId, (snapshot) => {
    if (!snapshot || snapshot.room === null && !snapshot.missingFromCache) {
      showMissing("삭제되었거나 존재하지 않는 공대 파밍방입니다.");
      return;
    }
    if (snapshot?.room) {
      const firstRoom = !roomReady;
      room = snapshot.room;
      roomReady = true;
      roomFromCache = Boolean(snapshot.fromCache);
      if (firstRoom) selectedWeek = room.currentWeek;
      renderAll();
    }
  }, (error) => showMissing(firebaseErrorMessage(error)));
  membersUnsubscribe = store.subscribeMembers(roomId, (snapshot) => {
    members = snapshot.members;
    membersReady = true;
    membersFromCache = Boolean(snapshot.fromCache);
    if (room) renderAll();
  }, (error) => setStatus(elements.status, firebaseErrorMessage(error, "공대원 명단을 불러오지 못했어요."), "error"));
  eventsUnsubscribe = store.subscribeLootEvents(roomId, (snapshot) => {
    events = snapshot.events;
    eventsReady = true;
    eventsFromCache = Boolean(snapshot.fromCache);
    if (room) renderAll();
  }, (error) => setStatus(elements.status, firebaseErrorMessage(error, "실제 드랍 원장을 불러오지 못했어요."), "error"));
}

elements.weekTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-week]");
  if (!button) return;
  selectedWeek = core.normalizeWeek(button.dataset.week);
  resetCandidates();
  renderAll();
});

elements.weekTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Home") selectedWeek = 1;
  else if (event.key === "End") selectedWeek = core.FARMING_WEEKS;
  else selectedWeek = Math.min(core.FARMING_WEEKS, Math.max(1, selectedWeek + (event.key === "ArrowRight" ? 1 : -1)));
  renderAll();
  byId(`raidLootWeekTab${selectedWeek}`).focus();
});

elements.filterButtons.forEach((button) => button.addEventListener("click", () => {
  currentFilter = button.dataset.filter;
  applyTableFilter();
}));

elements.eventFloorSelect.addEventListener("change", populateDropTypes);
elements.eventDropTypeSelect.addEventListener("change", () => {
  syncDirectWeaponField();
  resetCandidates(elements.eventDropTypeSelect.value ? "받을 사람 추천을 눌러 주세요." : "드랍 아이템을 선택해 주세요.");
});
elements.directWeaponJobSelect?.addEventListener("change", () => resetCandidates("직업을 확인한 뒤 받을 사람 추천을 눌러 주세요."));

elements.eventPickerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!room || !isOwner() || !allMembersSubmitted() || actionBusy || !elements.eventPickerForm.reportValidity()) return;
  try {
    selectedDrop = currentDrop();
    candidates = core.rankCandidates({
      drop: selectedDrop,
      week: selectedWeek,
      members,
      events: candidateHistory(),
      policy: room.policy,
    });
    renderCandidates();
    setStatus(elements.eventPickerStatus, candidates.length
      ? `${candidates.length}명의 후보를 추천 순서로 정리했어요.`
      : "현재 이 드랍을 받을 수 있는 공대원이 없어요.", candidates.length ? "success" : "warning");
    elements.candidatePanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    resetCandidates(error.message);
    setStatus(elements.eventPickerStatus, error.message, "error");
  }
});

elements.candidateList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='select-candidate']");
  if (!button) return;
  selectCandidate(button.closest("[data-seat]")?.dataset.seat || "");
});

elements.recipientSelect.addEventListener("change", () => {
  if (!elements.recipientSelect.value) {
    populateGearSlots(null);
    elements.recordEventButton.disabled = true;
    return;
  }
  selectCandidate(elements.recipientSelect.value);
  elements.recordEventButton.disabled = actionBusy;
});

elements.decisionSelect.addEventListener("change", () => {
  if (elements.decisionSelect.value === "free") elements.countsForFairnessInput.checked = false;
});

elements.allocationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store || !selectedDrop || !isOwner() || actionBusy || !elements.allocationForm.reportValidity()) return;
  const seat = elements.recipientSelect.value;
  const candidate = candidates.find((item) => item.seat === seat);
  if (!candidate) {
    setStatus(elements.allocationStatus, "받는 공대원을 선택해 주세요.", "error");
    return;
  }
  actionBusy = true;
  syncEventControls({ preserveStatus: true });
  setStatus(elements.allocationStatus, "실제 분배를 원장에 기록하고 있어요.");
  try {
    const draft = core.createAwardEvent({
      week: selectedWeek,
      ...selectedDrop,
      seat,
      gearSlot: elements.gearSlotSelect.value,
      source: "raid",
      decision: elements.decisionSelect.value,
      countsForFairness: elements.countsForFairnessInput.checked,
      note: elements.eventNoteInput.value,
    }, members, events);
    await store.createLootEvent(roomId, draft);
    elements.eventNoteInput.value = "";
    resetCandidates("분배를 기록했어요. 다음 드랍 아이템을 선택해 주세요.");
    setStatus(elements.allocationStatus, "실제 분배를 기록했어요.", "success");
    showToast("실제 분배를 기록했어요");
  } catch (error) {
    setStatus(elements.allocationStatus, firebaseErrorMessage(error, "분배를 기록하지 못했어요."), "error");
  } finally {
    actionBusy = false;
    renderAll({ preserveStatus: true });
  }
});

elements.recordUnassignedButton.addEventListener("click", async () => {
  if (!store || !selectedDrop || !isOwner() || actionBusy) return;
  actionBusy = true;
  syncEventControls({ preserveStatus: true });
  setStatus(elements.allocationStatus, "미분배 드랍을 원장에 기록하고 있어요.");
  try {
    const draft = core.createSkipEvent({
      week: selectedWeek,
      ...selectedDrop,
      reason: "unclaimed",
      note: elements.eventNoteInput.value,
    });
    await store.createLootEvent(roomId, draft);
    elements.eventNoteInput.value = "";
    resetCandidates("미분배로 기록했어요. 다음 드랍 아이템을 선택해 주세요.");
    setStatus(elements.allocationStatus, "미분배 드랍을 기록했어요.", "success");
    showToast("미분배 드랍을 기록했어요");
  } catch (error) {
    setStatus(elements.allocationStatus, firebaseErrorMessage(error, "미분배 기록을 저장하지 못했어요."), "error");
  } finally {
    actionBusy = false;
    renderAll({ preserveStatus: true });
  }
});

elements.historyFloorFilter.addEventListener("change", renderHistory);
elements.historyList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action='undo-event']");
  if (!button || !isOwner() || actionBusy) return;
  const item = button.closest("[data-event-id]");
  const eventId = item?.dataset.eventId || "";
  if (!window.confirm("이 실제 드랍 기록을 되돌릴까요? 원본은 지우지 않고 되돌리기 이력이 추가됩니다.")) return;
  actionBusy = true;
  syncEventControls({ preserveStatus: true });
  setStatus(elements.historyStatus, "되돌리기 이력을 저장하고 있어요.");
  try {
    await store.undoLootEvent(roomId, eventId, "방장 화면에서 되돌림");
    setStatus(elements.historyStatus, "기록을 되돌렸어요. 원본과 되돌리기 이력은 보존됩니다.", "success");
    showToast("드랍 기록을 되돌렸어요");
  } catch (error) {
    setStatus(elements.historyStatus, firebaseErrorMessage(error, "기록을 되돌리지 못했어요."), "error");
  } finally {
    actionBusy = false;
    renderAll({ preserveStatus: true });
  }
});

elements.roomSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.roomSettingsForm.reportValidity()) return;
  await withOwnerAction("공대 정보를 저장하고 있어요.", () => store.updateRoom(roomId, {
    title: elements.ownerTitleInput.value,
    tier: elements.ownerTierInput.value,
    startDate: elements.ownerStartDateInput.value,
    currentWeek: Number(elements.ownerCurrentWeekSelect.value),
  }), "공대 정보를 저장했어요");
});

elements.policyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.policyForm.reportValidity()) return;
  const preset = elements.priorityPolicySelect.value;
  await withOwnerAction("분배 정책을 저장하고 있어요.", () => store.updateRoom(roomId, {
    policy: core.normalizePolicy(preset),
  }), "분배 정책을 저장했어요");
});

elements.priorityPolicySelect.addEventListener("change", () => {
  elements.policyDescription.textContent = POLICY_DESCRIPTIONS[elements.priorityPolicySelect.value] || "분배 정책을 선택해 주세요.";
});

elements.roomLockButton.addEventListener("click", () => withOwnerAction(
  room.locked ? "공대원 입력을 다시 열고 있어요." : "공대원 입력을 마감하고 있어요.",
  () => store.updateRoom(roomId, { locked: !room.locked }),
  room.locked ? "공대원 입력을 다시 열었어요" : "공대원 입력을 마감했어요",
));

elements.copyInputLinkButton.addEventListener("click", async () => {
  try {
    await copyText(inputUrl().toString());
    showToast("공대원 입력 링크를 복사했어요");
  } catch (error) {
    setStatus(elements.ownerStatus, error.message || "입력 링크를 복사하지 못했어요.", "error");
  }
});

elements.copySummaryLinkButton.addEventListener("click", async () => {
  try {
    await copyText(summaryUrl().toString());
    showToast("8주 현황 링크를 복사했어요");
  } catch (error) {
    setStatus(elements.ownerStatus, error.message || "현황 링크를 복사하지 못했어요.", "error");
  }
});

elements.releaseMemberSelect.addEventListener("change", () => {
  elements.releaseClaimButton.disabled = actionBusy || !elements.releaseMemberSelect.value;
});

elements.releaseClaimButton.addEventListener("click", async () => {
  const seat = elements.releaseMemberSelect.value;
  const member = memberMap().get(seat);
  if (!member || !window.confirm(`${seat} ${member.nickname} 자리의 브라우저 연결만 해제할까요? 저장한 장비 상태는 유지됩니다.`)) return;
  await withOwnerAction("자리 연결을 해제하고 있어요.", () => store.releaseMember(roomId, seat), `${seat} 자리 연결을 해제했어요`);
});

elements.setCurrentWeekButton.addEventListener("click", async () => {
  if (!window.confirm(`현재 파밍 주차를 ${selectedWeek}주차로 바꿀까요? 기존 원장은 그대로 보존됩니다.`)) return;
  await withOwnerAction("현재 주차를 바꾸고 있어요.", () => store.updateRoom(roomId, { currentWeek: selectedWeek }), `${selectedWeek}주차를 현재 주차로 설정했어요`);
});

elements.roomDeleteButton.addEventListener("click", async () => {
  if (!room || !window.confirm(`“${room.title}” 8주 공대와 모든 실제 드랍 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
  await withOwnerAction("8주 공대를 삭제하고 있어요.", async () => {
    await store.removeRoom(roomId);
    window.location.replace("./");
  });
});

elements.copyImageButton.addEventListener("click", async () => {
  if (imageBusy) return;
  imageBusy = true;
  elements.copyImageButton.disabled = true;
  elements.savePngButton.disabled = true;
  setStatus(elements.imageStatus, "공대 파밍표 이미지를 만들고 있어요.");
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) throw new Error("이 브라우저는 이미지 클립보드 복사를 지원하지 않아요. PNG 저장을 이용해 주세요.");
    const blob = await canvasBlob(renderImageCanvas());
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    setStatus(elements.imageStatus, "선택한 주차까지의 현황 이미지를 복사했어요.", "success");
    showToast("이미지를 복사했어요");
  } catch (error) {
    setStatus(elements.imageStatus, error.message || "이미지를 복사하지 못했어요.", "error");
  } finally {
    imageBusy = false;
    elements.copyImageButton.disabled = false;
    elements.savePngButton.disabled = false;
  }
});

elements.savePngButton.addEventListener("click", async () => {
  if (imageBusy) return;
  imageBusy = true;
  elements.copyImageButton.disabled = true;
  elements.savePngButton.disabled = true;
  setStatus(elements.imageStatus, "PNG 파일을 만들고 있어요.");
  try {
    const blob = await canvasBlob(renderImageCanvas());
    const link = document.createElement("a");
    const blobUrl = URL.createObjectURL(blob);
    link.href = blobUrl;
    link.download = `${room.title.replace(/[\\/:*?\"<>|]/g, "-")}-${selectedWeek}주차-공대파밍표.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    setStatus(elements.imageStatus, "PNG 파일을 저장했어요.", "success");
  } catch (error) {
    setStatus(elements.imageStatus, error.message || "PNG 파일을 저장하지 못했어요.", "error");
  } finally {
    imageBusy = false;
    elements.copyImageButton.disabled = false;
    elements.savePngButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  roomUnsubscribe?.();
  membersUnsubscribe?.();
  eventsUnsubscribe?.();
});

initialize();
