import { createBisRoomStore } from "./firebase-room-store.js";
import {
  copyText,
  createToast,
  firebaseErrorMessage,
  roomUrl,
  setStatus,
} from "./ui-common.js";

const core = globalThis.BisTrackerCore;
const firebaseConfig = globalThis.BisTrackerFirebaseConfig;

if (!core) throw new Error("비스표 데이터 모듈을 불러오지 못했습니다.");

const STATUS_DISPLAY = Object.freeze({
  complete: "✓ 완료",
  upgrade: "＋ 보강 필요",
  raid: "◆ 영식 필요",
  empty: "미입력",
});

const elements = {
  banner: document.querySelector("#bisSummaryBanner"),
  title: document.querySelector("#bisSummaryTitle"),
  meta: document.querySelector("#bisSummaryMeta"),
  roomState: document.querySelector("#bisSummaryRoomState"),
  submittedCount: document.querySelector("#bisSummarySubmittedCount"),
  status: document.querySelector("#bisSummaryStatus"),
  missingActions: document.querySelector("#bisSummaryMissingActions"),
  workspace: document.querySelector("#bisSummaryWorkspace"),
  headerInputLink: document.querySelector("#bisHeaderInputLink"),
  ownerPanel: document.querySelector("#bisOwnerPanel"),
  ownerStatus: document.querySelector("#bisOwnerStatus"),
  roomLockButton: document.querySelector("#bisRoomLockButton"),
  copyInputLinkButton: document.querySelector("#bisCopyInputLinkButton"),
  copySummaryLinkButton: document.querySelector("#bisCopySummaryLinkButton"),
  roomSettingsForm: document.querySelector("#bisRoomSettingsForm"),
  ownerTitleInput: document.querySelector("#bisOwnerTitleInput"),
  ownerTierInput: document.querySelector("#bisOwnerTierInput"),
  ownerWeekInput: document.querySelector("#bisOwnerWeekInput"),
  roomSettingsSaveButton: document.querySelector("#bisRoomSettingsSaveButton"),
  releaseMemberSelect: document.querySelector("#bisReleaseMemberSelect"),
  releaseClaimButton: document.querySelector("#bisReleaseClaimButton"),
  roomDeleteButton: document.querySelector("#bisRoomDeleteButton"),
  table: document.querySelector("#bisSummaryTable"),
  overallProgress: document.querySelector("#bisOverallProgress"),
  overallProgressText: document.querySelector("#bisOverallProgressText"),
  completedGearCount: document.querySelector("#bisCompletedGearCount"),
  filterButtons: [...document.querySelectorAll("[data-filter]")],
  copyImageButton: document.querySelector("#bisCopyImageButton"),
  copyImageLabel: document.querySelector("#bisCopyImageLabel"),
  savePngButton: document.querySelector("#bisSavePngButton"),
  imageStatus: document.querySelector("#bisImageStatus"),
  dropForm: document.querySelector("#bisDropForm"),
  dropInputs: [...document.querySelectorAll("#bisDropGrid input[name^='drop-']")],
  distributionWeek: document.querySelector("#bisDistributionWeek"),
  clearDropCountsButton: document.querySelector("#bisClearDropCountsButton"),
  dropTotalCount: document.querySelector("#bisDropTotalCount"),
  recommendButton: document.querySelector("#bisRecommendButton"),
  dropStatus: document.querySelector("#bisDropStatus"),
  recommendationPanel: document.querySelector("#bisRecommendationPanel"),
  recommendationList: document.querySelector("#bisRecommendationList"),
  recommendationEmpty: document.querySelector("#bisRecommendationEmpty"),
  assignedDropCount: document.querySelector("#bisAssignedDropCount"),
  recommendationTotalCount: document.querySelector("#bisRecommendationTotalCount"),
  distributionForm: document.querySelector("#bisDistributionForm"),
  saveDistributionButton: document.querySelector("#bisSaveDistributionButton"),
  distributionStatus: document.querySelector("#bisDistributionStatus"),
  distributionRowTemplate: document.querySelector("#bisDistributionRowTemplate"),
  toast: document.querySelector("#toast"),
};

let roomId = "";
let store = null;
let room = null;
let members = [];
let roomSnapshotReady = false;
let membersSnapshotReady = false;
let roomFromCache = false;
let membersFromCache = false;
let roomUnsubscribe = null;
let membersUnsubscribe = null;
let currentFilter = "all";
let ownerActionBusy = false;
let distributionBusy = false;
let imageBusy = false;
let distributionDirty = false;
let roomSettingsDirty = false;
let roomSettingsSignature = "";
let loadedDistributionSignature = "";
let planRows = [];
let planVisible = false;
const showToast = createToast(elements.toast);

function isOwner() {
  return Boolean(room && store?.user?.uid && room.ownerUid === store.user.uid);
}

function hasCompleteRoster() {
  if (members.length !== core.SEATS.length) return false;
  try {
    core.normalizeMembers(members);
    return true;
  } catch (_error) {
    return false;
  }
}

function allMembersSubmitted() {
  return hasCompleteRoster() && members.every((member) => member.submitted);
}

function dropTypeFromInput(input) {
  return String(input.name || "").replace(/^drop-/, "");
}

function distributionSignature(distribution) {
  return JSON.stringify(distribution);
}

function dropCountsFromInputs() {
  const source = {};
  elements.dropInputs.forEach((input) => {
    const value = input.value === "" ? 0 : Number(input.value);
    source[dropTypeFromInput(input)] = value;
  });
  return core.normalizeDropCounts(source, { requireAll: true });
}

function totalDrops(counts = dropCountsFromInputs()) {
  return core.DROP_TYPES.reduce((total, dropType) => total + counts[dropType], 0);
}

function setDropInputs(counts) {
  const normalized = core.normalizeDropCounts(counts, { requireAll: true });
  elements.dropInputs.forEach((input) => {
    input.value = String(normalized[dropTypeFromInput(input)]);
  });
  updateDropTotal();
}

function updateDropTotal() {
  let total = 0;
  try {
    total = totalDrops();
  } catch (_error) {
    // reportValidity와 제출 처리에서 자세한 범위 오류를 안내한다.
  }
  elements.dropTotalCount.textContent = String(total);
  return total;
}

function inputUrl() {
  return roomUrl("room.html", roomId);
}

function summaryUrl() {
  return roomUrl("summary.html", roomId);
}

function showMissing(message, state = "error") {
  room = null;
  elements.banner.setAttribute("aria-busy", "false");
  elements.workspace.hidden = true;
  elements.missingActions.hidden = false;
  elements.title.textContent = "비스표 방을 열 수 없어요";
  elements.meta.textContent = message;
  elements.roomState.textContent = "확인 필요";
  elements.roomState.dataset.state = "locked";
  setStatus(elements.status, message, state);
}

function submittedMembersCount() {
  return members.filter((member) => member.submitted).length;
}

function updateConnectionStatus() {
  if (!room) return;
  const memberCount = members.length;
  if (!membersSnapshotReady || memberCount !== core.SEATS.length) {
    setStatus(elements.status, `공대원 현황을 불러오는 중이에요. (${memberCount} / 8명)`, "loading");
    return;
  }
  if (roomFromCache || membersFromCache) {
    setStatus(elements.status, "브라우저에 저장된 현황을 먼저 표시했어요. 서버 연결을 확인하고 있어요.", "warning");
    return;
  }
  setStatus(
    elements.status,
    room.locked
      ? "입력이 마감된 방입니다. 저장된 전체 현황을 표시하고 있어요."
      : "최신 장비 현황과 분배안을 실시간으로 표시하고 있어요.",
    "success",
  );
}

function renderRoomHeader() {
  if (!room) return;
  elements.banner.setAttribute("aria-busy", String(!membersSnapshotReady || members.length !== core.SEATS.length));
  elements.workspace.hidden = false;
  elements.missingActions.hidden = true;
  elements.title.textContent = room.title;
  elements.meta.textContent = `${room.tier} · 일회성 취합`;
  elements.roomState.textContent = room.locked ? "입력 마감" : "입력 중";
  elements.roomState.dataset.state = room.locked ? "locked" : "open";
  elements.submittedCount.textContent = String(submittedMembersCount());
  elements.distributionWeek.textContent = String(room.week);
  elements.headerInputLink.href = inputUrl().toString();
  document.title = `${room.title} · 8인 BiS 전체 현황 | 비스표`;
  updateConnectionStatus();
}

function memberMap() {
  return new Map(members.map((member) => [member.seat, member]));
}

function memberStatuses(member) {
  if (!member?.submitted) return null;
  return core.decodeGear(member.gear, { allowUnset: false });
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
    let matchingCells = 0;
    row.querySelectorAll("td[data-seat]").forEach((cell) => {
      const state = cell.querySelector("[data-state]")?.dataset.state || "empty";
      const matches = filterMatches(state);
      cell.hidden = false;
      if (matches) matchingCells += 1;
    });
    row.hidden = currentFilter !== "all" && matchingCells === 0;
  });
}

function renderMemberTable() {
  const bySeat = memberMap();
  let completedCount = 0;

  core.SEATS.forEach((seat) => {
    const member = bySeat.get(seat);
    const header = elements.table.querySelector(`thead [data-seat="${seat}"]`);
    if (!header) return;
    header.querySelector("[data-field='nickname']").textContent = member?.nickname || "—";
    header.querySelector("[data-field='job']").textContent = member?.job || "—";
  });

  core.GEAR_SLOTS.forEach((gearSlot) => {
    const row = elements.table.querySelector(`tbody tr[data-slot="${gearSlot}"]`);
    if (!row) return;
    core.SEATS.forEach((seat) => {
      const member = bySeat.get(seat);
      const statuses = memberStatuses(member);
      const status = statuses?.[gearSlot] || "empty";
      if (status === "complete") completedCount += 1;
      const cell = row.querySelector(`td[data-seat="${seat}"]`);
      if (!cell) return;
      const value = cell.querySelector("span") || document.createElement("span");
      value.dataset.state = status;
      value.textContent = STATUS_DISPLAY[status];
      value.setAttribute(
        "aria-label",
        `${member?.nickname || seat} ${core.GEAR_LABELS[gearSlot]}: ${STATUS_DISPLAY[status].replace(/^[✓＋◆]\s*/, "")}`,
      );
      if (!value.parentNode) cell.append(value);
    });
  });

  const maximum = core.SEATS.length * core.GEAR_SLOTS.length;
  const percentage = Math.round((completedCount / maximum) * 100);
  elements.completedGearCount.textContent = String(completedCount);
  elements.overallProgress.value = completedCount;
  elements.overallProgress.max = maximum;
  elements.overallProgress.textContent = `${completedCount} / ${maximum}`;
  elements.overallProgressText.textContent = `${percentage}%`;
  elements.submittedCount.textContent = String(submittedMembersCount());
  applyTableFilter();
}

function populateReleaseMembers() {
  const previous = elements.releaseMemberSelect.value;
  const claimed = members.filter((member) => member.editorUid);
  const options = [new Option("공대원 선택", "")];
  claimed.forEach((member) => {
    options.push(new Option(`${member.seat} · ${member.nickname} (${member.job})`, member.seat));
  });
  elements.releaseMemberSelect.replaceChildren(...options);
  if (claimed.some((member) => member.seat === previous)) {
    elements.releaseMemberSelect.value = previous;
  }
}

function syncRoomSettings() {
  if (!room || !elements.roomSettingsForm) return;
  const signature = JSON.stringify([room.title, room.tier, room.week]);
  if (!roomSettingsDirty && signature !== roomSettingsSignature) {
    elements.ownerTitleInput.value = room.title;
    elements.ownerTierInput.value = room.tier;
    elements.ownerWeekInput.value = String(room.week);
    roomSettingsSignature = signature;
  }
}

function syncOwnerPanel(options = {}) {
  const owner = isOwner();
  elements.ownerPanel.hidden = !owner;
  if (!owner) return;
  const busy = ownerActionBusy || distributionBusy;
  syncRoomSettings();
  elements.ownerPanel.setAttribute("aria-busy", String(busy));
  elements.roomLockButton.textContent = room.locked ? "입력 다시 열기" : "입력 마감";
  elements.roomLockButton.disabled = busy;
  elements.copyInputLinkButton.disabled = busy;
  elements.copySummaryLinkButton.disabled = busy;
  elements.ownerTitleInput.disabled = busy;
  elements.ownerTierInput.disabled = busy;
  elements.ownerWeekInput.disabled = busy;
  elements.roomSettingsSaveButton.disabled = busy || !roomSettingsDirty;
  elements.releaseMemberSelect.disabled = busy;
  elements.releaseClaimButton.disabled = busy || !elements.releaseMemberSelect.value;
  elements.roomDeleteButton.disabled = busy;
  if (!busy && options.preserveStatus !== true) {
    if (roomSettingsDirty) {
      setStatus(elements.ownerStatus, "방 정보를 수정했어요. 저장 전에는 다른 사람에게 보이지 않습니다.", "warning");
      return;
    }
    setStatus(
      elements.ownerStatus,
      room.locked ? "공대원 입력이 마감되어 있어요." : "공대원 입력 링크가 열려 있어요.",
      room.locked ? "warning" : "success",
    );
  }
}

function needCandidates(dropType, ignoredRow = null) {
  const spec = core.DROP_SPECS[dropType];
  const used = new Set(
    planRows
      .filter((row) => row !== ignoredRow && row.seat && row.gearSlot)
      .map((row) => `${row.seat}@${row.gearSlot}`),
  );
  const candidates = [];
  members.forEach((member) => {
    if (!member.submitted) return;
    const gear = memberStatuses(member);
    spec.gearSlots.forEach((gearSlot) => {
      if (gear[gearSlot] !== spec.status || used.has(`${member.seat}@${gearSlot}`)) return;
      candidates.push({ seat: member.seat, gearSlot });
    });
  });
  return candidates;
}

function rowsFromDistribution(distribution) {
  const normalized = core.normalizeDistribution(distribution);
  const assignments = core.decodeAssignmentMap(normalized.assignments);
  const rows = [];
  core.DROP_TYPES.forEach((dropType) => {
    const matching = assignments.filter((assignment) => assignment.dropType === dropType);
    for (let index = 0; index < normalized.dropCounts[dropType]; index += 1) {
      const assignment = matching[index] || null;
      rows.push({
        dropType,
        seat: assignment?.seat || "",
        gearSlot: assignment?.gearSlot || "",
        savedAssignmentKey: assignment
          ? `${assignment.dropType}@${assignment.seat}@${assignment.gearSlot}`
          : "",
      });
    }
  });
  return rows;
}

function rowsFromPlan(plan, counts) {
  const assignments = [...plan.assignments];
  const rows = [];
  core.DROP_TYPES.forEach((dropType) => {
    const matching = assignments.filter((assignment) => assignment.dropType === dropType);
    for (let index = 0; index < counts[dropType]; index += 1) {
      const assignment = matching[index] || null;
      rows.push({
        dropType,
        seat: assignment?.seat || "",
        gearSlot: assignment?.gearSlot || "",
        savedAssignmentKey: "",
      });
    }
  });
  return rows;
}

function currentPlan() {
  const dropCounts = dropCountsFromInputs();
  const assignments = [];
  const unassignedDrops = [];
  planRows.forEach((row) => {
    if (!row.seat && !row.gearSlot) {
      unassignedDrops.push({ dropType: row.dropType });
      return;
    }
    if (!row.seat || !row.gearSlot) throw new Error("받는 사람과 적용 부위를 함께 선택해 주세요.");
    const assignment = { dropType: row.dropType, seat: row.seat, gearSlot: row.gearSlot };
    const key = `${assignment.dropType}@${assignment.seat}@${assignment.gearSlot}`;
    const member = members.find((candidate) => candidate.seat === assignment.seat);
    const status = memberStatuses(member)?.[assignment.gearSlot] || null;
    const matchesCurrentNeed = status === core.DROP_SPECS[assignment.dropType].status;
    if (!matchesCurrentNeed && row.savedAssignmentKey !== key) {
      throw new Error(`${assignment.seat}의 ${core.GEAR_LABELS[assignment.gearSlot]} 현재 상태와 드랍 아이템이 맞지 않습니다.`);
    }
    assignments.push(assignment);
  });
  const normalized = core.normalizeDistribution({
    week: room?.week || 1,
    dropCounts,
    assignments,
  });
  return core.distributionPlan(normalized);
}

function readonlyOption(select, label, value = "") {
  select.replaceChildren(new Option(label, value, true, true));
  select.value = value;
  select.disabled = true;
  select.required = false;
}

function syncEditableRow(item, row) {
  const recipient = item.querySelector("[data-field='recipient']");
  const gear = item.querySelector("[data-field='gear-slot']");
  const candidates = needCandidates(row.dropType, row);
  const memberBySeat = memberMap();
  const seatOptions = [...new Set(candidates.map((candidate) => candidate.seat))];
  const currentPairValid = candidates.some((candidate) => (
    candidate.seat === row.seat && candidate.gearSlot === row.gearSlot
  ));
  const currentKey = row.seat && row.gearSlot
    ? `${row.dropType}@${row.seat}@${row.gearSlot}`
    : "";
  const preservedSavedPair = Boolean(
    currentKey
    && row.savedAssignmentKey === currentKey
    && memberBySeat.has(row.seat)
    && core.dropMatchesGearSlot(row.dropType, row.gearSlot),
  );
  let clearedInvalidPair = false;
  if (row.seat && row.gearSlot && !currentPairValid && !preservedSavedPair) {
    row.seat = "";
    row.gearSlot = "";
    row.savedAssignmentKey = "";
    clearedInvalidPair = true;
  }

  recipient.replaceChildren(new Option("미배정", ""));
  if (preservedSavedPair && !seatOptions.includes(row.seat)) seatOptions.unshift(row.seat);
  seatOptions.forEach((seat) => {
    const member = memberBySeat.get(seat);
    const changed = preservedSavedPair && seat === row.seat && !currentPairValid;
    recipient.append(new Option(`${seat} · ${member?.nickname || seat}${changed ? " · 저장된 배정" : ""}`, seat));
  });
  recipient.value = row.seat;
  recipient.disabled = distributionBusy;
  recipient.required = false;

  const gearCandidates = candidates.filter((candidate) => candidate.seat === row.seat);
  if (preservedSavedPair && !gearCandidates.some((candidate) => candidate.gearSlot === row.gearSlot)) {
    gearCandidates.unshift({ seat: row.seat, gearSlot: row.gearSlot, saved: true });
  }
  gear.replaceChildren(new Option(row.seat ? "부위 선택" : "먼저 공대원 선택", ""));
  gearCandidates.forEach((candidate) => {
    gear.append(new Option(
      `${core.GEAR_LABELS[candidate.gearSlot]}${candidate.saved ? " · 현재 상태 변경됨" : ""}`,
      candidate.gearSlot,
    ));
  });
  gear.value = row.gearSlot;
  gear.disabled = distributionBusy || !row.seat;
  gear.required = false;
  return clearedInvalidPair;
}

function renderRecommendation(options = {}) {
  if (!planVisible) {
    elements.recommendationPanel.hidden = true;
    return;
  }
  const owner = isOwner();
  const memberBySeat = memberMap();
  let clearedInvalidPair = false;
  elements.recommendationPanel.hidden = false;
  elements.recommendationList.replaceChildren();

  planRows.forEach((row, index) => {
    const fragment = elements.distributionRowTemplate.content.cloneNode(true);
    const item = fragment.querySelector("li");
    item.dataset.rowIndex = String(index);
    item.dataset.dropType = row.dropType;
    item.querySelector("[data-field='index']").textContent = String(index + 1).padStart(2, "0");
    item.querySelector("[data-field='drop-label']").textContent = core.DROP_SPECS[row.dropType].label;
    item.querySelector("[data-field='drop-category']").textContent = core.DROP_SPECS[row.dropType].gearSlots
      .map((gearSlot) => core.GEAR_LABELS[gearSlot])
      .join(" · ");
    const recipient = item.querySelector("[data-field='recipient']");
    const gear = item.querySelector("[data-field='gear-slot']");
    const remove = item.querySelector("[data-action='remove-assignment']");
    if (owner && allMembersSubmitted()) {
      clearedInvalidPair = syncEditableRow(item, row) || clearedInvalidPair;
      remove.disabled = distributionBusy || (!row.seat && !row.gearSlot);
      remove.hidden = false;
    } else {
      const member = memberBySeat.get(row.seat);
      readonlyOption(
        recipient,
        member ? `${member.seat} · ${member.nickname}` : (row.seat ? `${row.seat} · 불러오는 중` : "미배정"),
        row.seat,
      );
      readonlyOption(gear, row.gearSlot ? core.GEAR_LABELS[row.gearSlot] : "—", row.gearSlot);
      remove.hidden = true;
    }
    elements.recommendationList.append(item);
  });

  let assigned = planRows.filter((row) => row.seat && row.gearSlot).length;
  if (owner && allMembersSubmitted()) {
    try {
      assigned = currentPlan().assignments.length;
    } catch (error) {
      if (options.quiet !== true) setStatus(elements.distributionStatus, error.message, "error");
    }
  }
  elements.assignedDropCount.textContent = String(assigned);
  elements.recommendationTotalCount.textContent = String(planRows.length);
  elements.recommendationEmpty.hidden = planRows.length !== 0;
  if (!planRows.length) {
    const emptyTitle = elements.recommendationEmpty.querySelector("strong");
    const emptyDescription = elements.recommendationEmpty.querySelector("p");
    let noDrops = false;
    try {
      noDrops = totalDrops() === 0;
    } catch (_error) {
      // 잘못 입력한 수량은 폼 검증 메시지로 안내한다.
    }
    emptyTitle.textContent = noDrops ? "입력된 드랍이 없어요" : "배정할 수 있는 대상이 없어요";
    emptyDescription.textContent = noDrops
      ? "분배안을 비우려면 아래 저장 버튼을 눌러 주세요."
      : "해당 아이템이 필요한 공대원이 없어요.";
  }
  elements.saveDistributionButton.hidden = !owner;
  elements.saveDistributionButton.disabled = distributionBusy || !allMembersSubmitted();
  if (clearedInvalidPair) {
    distributionDirty = true;
    if (options.quiet !== true) {
      setStatus(elements.distributionStatus, "현재 장비 필요 상태와 맞지 않는 기존 배정을 미배정으로 바꿨어요.", "warning");
    }
  }
}

function loadDistribution(distribution, options = {}) {
  const normalized = core.normalizeDistribution(distribution);
  if (room && normalized.week !== room.week) {
    throw new Error("방의 파밍 주차와 저장된 분배표 주차가 일치하지 않습니다.");
  }
  setDropInputs(normalized.dropCounts);
  planRows = rowsFromDistribution(normalized);
  planVisible = totalDrops(normalized.dropCounts) > 0;
  loadedDistributionSignature = distributionSignature(normalized);
  distributionDirty = false;
  renderRecommendation({ quiet: true });
  if (options.announce === true) {
    setStatus(
      elements.distributionStatus,
      planVisible ? "저장된 일회성 분배안을 불러왔어요." : "아직 저장된 분배안이 없어요.",
      "success",
    );
  }
}

function resetPlanForEditedCounts() {
  planRows = [];
  planVisible = false;
  distributionDirty = true;
  renderRecommendation();
}

function syncDistributionControls() {
  const owner = isOwner();
  const ready = allMembersSubmitted();
  const disabled = !owner || !ready || distributionBusy || ownerActionBusy;
  elements.dropForm.setAttribute("aria-busy", String(distributionBusy));
  elements.dropInputs.forEach((input) => { input.disabled = disabled; });
  elements.clearDropCountsButton.disabled = disabled;
  elements.recommendButton.disabled = disabled;
  elements.saveDistributionButton.hidden = !owner;
  elements.saveDistributionButton.disabled = disabled || !planVisible;

  if (!owner) {
    setStatus(elements.dropStatus, "드랍 수량과 저장된 분배안은 방장만 수정할 수 있어요.", "warning");
  } else if (!ready) {
    setStatus(
      elements.dropStatus,
      `8명 모두 현황을 입력하면 분배 추천을 사용할 수 있어요. (${submittedMembersCount()} / 8명)`,
      "warning",
    );
  } else if (!distributionDirty) {
    setStatus(
      elements.dropStatus,
      updateDropTotal() ? "저장된 드랍 수량이에요. 수정한 뒤 다시 자동 추천할 수 있어요." : "드랍된 아이템 수량을 입력해 주세요.",
      "success",
    );
  }
  renderRecommendation({ quiet: true });
}

function renderAll() {
  if (!room) return;
  renderRoomHeader();
  renderMemberTable();
  populateReleaseMembers();
  syncOwnerPanel();
  syncDistributionControls();
  elements.copyImageButton.disabled = imageBusy || !hasCompleteRoster();
  elements.savePngButton.disabled = imageBusy || !hasCompleteRoster();
}

function handleRoomValue(value) {
  roomSnapshotReady = true;
  if (value?.missingFromCache) {
    roomFromCache = true;
    elements.banner.setAttribute("aria-busy", "true");
    setStatus(elements.status, "로컬 저장소에는 방 정보가 없어요. 서버에서 확인하고 있어요.", "loading");
    return;
  }
  if (!value) {
    showMissing("삭제되었거나 존재하지 않는 비스표 방입니다.");
    roomUnsubscribe?.();
    membersUnsubscribe?.();
    return;
  }

  const previousWeek = room?.week;
  room = value.room;
  roomFromCache = Boolean(value.fromCache);
  const incomingSignature = distributionSignature(room.distribution);
  try {
    if (!loadedDistributionSignature || (!distributionDirty && incomingSignature !== loadedDistributionSignature)) {
      loadDistribution(room.distribution);
    } else if (distributionDirty && previousWeek !== undefined && previousWeek !== room.week) {
      loadDistribution(room.distribution);
      setStatus(elements.distributionStatus, "파밍 주차가 바뀌어 작성 중이던 분배안을 초기화했어요.", "warning");
    } else if (distributionDirty && incomingSignature !== loadedDistributionSignature) {
      setStatus(elements.distributionStatus, "서버의 분배안이 변경됐어요. 현재 작성 중인 내용은 저장 전까지 유지합니다.", "warning");
    }
  } catch (error) {
    setStatus(elements.distributionStatus, error.message, "error");
  }
  renderAll();
}

function handleMembersValue(value) {
  membersSnapshotReady = true;
  members = value.members;
  membersFromCache = Boolean(value.fromCache);
  if (room && !distributionDirty && loadedDistributionSignature) {
    try {
      loadDistribution(room.distribution);
    } catch (error) {
      setStatus(elements.distributionStatus, `저장된 분배안을 확인하지 못했어요: ${error.message}`, "error");
    }
  }
  renderAll();
}

async function runOwnerAction(action, workingMessage, successMessage) {
  if (!isOwner() || ownerActionBusy || distributionBusy) return false;
  ownerActionBusy = true;
  syncOwnerPanel({ preserveStatus: true });
  setStatus(elements.ownerStatus, workingMessage);
  try {
    await action();
    setStatus(elements.ownerStatus, successMessage, "success");
    showToast(successMessage);
    return true;
  } catch (error) {
    setStatus(elements.ownerStatus, firebaseErrorMessage(error), "error");
    return false;
  } finally {
    ownerActionBusy = false;
    syncOwnerPanel({ preserveStatus: true });
  }
}

function filenamePart(value) {
  const normalized = String(value || "비스표")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 60) || "비스표";
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG 이미지를 만들지 못했습니다."));
    }, "image/png");
  });
}

function downloadBlob(blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePart(room?.title)}-bis.png`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createSummaryImageBlob() {
  if (!room || !hasCompleteRoster()) throw new Error("8명의 현황을 모두 불러온 뒤 이미지를 만들어 주세요.");
  if (!globalThis.BisTrackerImage?.renderBisSummaryImage) {
    throw new Error("비스표 이미지 모듈을 불러오지 못했습니다.");
  }
  return canvasBlob(globalThis.BisTrackerImage.renderBisSummaryImage(room, members));
}

async function runImageAction(action) {
  if (imageBusy) return;
  imageBusy = true;
  elements.copyImageButton.disabled = true;
  elements.savePngButton.disabled = true;
  setStatus(elements.imageStatus, "8인 현황 이미지를 만들고 있어요.");
  try {
    await action();
  } catch (error) {
    setStatus(elements.imageStatus, error.message || "이미지를 만들지 못했어요.", "error");
  } finally {
    imageBusy = false;
    elements.copyImageButton.disabled = !hasCompleteRoster();
    elements.savePngButton.disabled = !hasCompleteRoster();
  }
}

elements.filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    applyTableFilter();
  });
});

elements.releaseMemberSelect.addEventListener("change", () => {
  elements.releaseClaimButton.disabled = ownerActionBusy || distributionBusy || !elements.releaseMemberSelect.value;
});

elements.roomLockButton.addEventListener("click", () => {
  if (!room) return;
  const nextLocked = !room.locked;
  runOwnerAction(
    () => store.updateRoom(roomId, { locked: nextLocked }),
    nextLocked ? "공대원 입력을 마감하고 있어요." : "공대원 입력을 다시 열고 있어요.",
    nextLocked ? "공대원 입력을 마감했어요" : "공대원 입력을 다시 열었어요",
  );
});

elements.copyInputLinkButton.addEventListener("click", () => {
  runOwnerAction(
    () => copyText(inputUrl().toString()),
    "공대원 입력 링크를 복사하고 있어요.",
    "공대원 입력 링크를 복사했어요",
  );
});

elements.copySummaryLinkButton.addEventListener("click", () => {
  runOwnerAction(
    () => copyText(summaryUrl().toString()),
    "전체 현황 링크를 복사하고 있어요.",
    "전체 현황 링크를 복사했어요",
  );
});

elements.roomSettingsForm.addEventListener("input", () => {
  roomSettingsDirty = true;
  elements.roomSettingsSaveButton.disabled = ownerActionBusy || distributionBusy;
  setStatus(elements.ownerStatus, "방 정보를 수정했어요. 저장 전에는 다른 사람에게 보이지 않습니다.", "warning");
});

elements.roomSettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!room || !isOwner() || ownerActionBusy || distributionBusy || !roomSettingsDirty) return;
  if (!elements.roomSettingsForm.reportValidity()) return;
  let requestedSettings;
  try {
    requestedSettings = core.normalizeRoomMetadataUpdate({
      title: elements.ownerTitleInput.value,
      tier: elements.ownerTierInput.value,
      week: elements.ownerWeekInput.value,
    });
  } catch (error) {
    setStatus(elements.ownerStatus, error.message, "error");
    return;
  }
  const changes = {};
  if (requestedSettings.title !== room.title) changes.title = requestedSettings.title;
  if (requestedSettings.tier !== room.tier) changes.tier = requestedSettings.tier;
  if (requestedSettings.week !== room.week) changes.week = requestedSettings.week;
  if (!Object.keys(changes).length) {
    roomSettingsDirty = false;
    syncOwnerPanel();
    return;
  }
  const weekChanged = Object.prototype.hasOwnProperty.call(changes, "week");
  if (weekChanged) {
    const confirmed = window.confirm(
      `${room.week}주차에서 ${requestedSettings.week}주차로 바꿀까요?\n\n저장된 드랍 수량과 분배안은 새 주차에 맞춰 모두 초기화됩니다.`,
    );
    if (!confirmed) return;
  }
  const saved = await runOwnerAction(
    () => store.updateRoom(roomId, changes),
    "방 정보를 저장하고 있어요.",
    weekChanged ? `${requestedSettings.week}주차로 바꾸고 분배안을 초기화했어요` : "방 정보를 저장했어요",
  );
  if (saved) {
    roomSettingsDirty = false;
    roomSettingsSignature = JSON.stringify([
      requestedSettings.title,
      requestedSettings.tier,
      requestedSettings.week,
    ]);
    elements.ownerTitleInput.value = requestedSettings.title;
    elements.ownerTierInput.value = requestedSettings.tier;
    elements.ownerWeekInput.value = String(requestedSettings.week);
    elements.roomSettingsSaveButton.disabled = true;
    if (weekChanged) distributionDirty = false;
  }
});

elements.releaseClaimButton.addEventListener("click", () => {
  const seat = elements.releaseMemberSelect.value;
  const member = members.find((candidate) => candidate.seat === seat);
  if (!member) return;
  if (!window.confirm(`${seat} ${member.nickname}님의 자리 점유를 해제할까요?\n기존 장비 상태는 유지됩니다.`)) return;
  runOwnerAction(
    () => store.releaseMember(roomId, seat),
    `${seat} 자리 연결을 해제하고 있어요.`,
    `${seat} 자리 연결을 해제했어요`,
  );
});

elements.roomDeleteButton.addEventListener("click", async () => {
  if (!room || !isOwner() || ownerActionBusy || distributionBusy) return;
  const confirmed = window.confirm(
    `‘${room.title}’ 방을 삭제할까요?\n\n8명의 장비 현황과 저장된 분배안이 모두 삭제되며 되돌릴 수 없습니다.`,
  );
  if (!confirmed) return;
  const removed = await runOwnerAction(
    () => store.removeRoom(roomId),
    "비스표 방과 8명의 현황을 삭제하고 있어요.",
    "비스표 방을 삭제했어요",
  );
  if (removed) window.location.replace("./");
});

elements.dropInputs.forEach((input) => {
  input.addEventListener("input", () => {
    updateDropTotal();
    resetPlanForEditedCounts();
    syncDistributionControls();
    setStatus(elements.dropStatus, "수량을 수정했어요. 자동 추천을 다시 실행해 주세요.", "warning");
  });
  input.addEventListener("change", () => {
    if (input.value === "") input.value = "0";
    const maximum = Number(input.max) || core.MAX_DROP_COUNT;
    const value = Math.max(0, Math.min(maximum, Number(input.value) || 0));
    input.value = String(Math.trunc(value));
    updateDropTotal();
  });
});

elements.clearDropCountsButton.addEventListener("click", () => {
  const empty = core.normalizeDropCounts({});
  setDropInputs(empty);
  planRows = [];
  planVisible = true;
  distributionDirty = true;
  renderRecommendation();
  syncDistributionControls();
  setStatus(elements.dropStatus, "드랍 수량을 모두 0개로 바꿨어요. 저장하려면 분배안을 저장해 주세요.", "warning");
});

elements.dropForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isOwner() || !allMembersSubmitted() || distributionBusy || ownerActionBusy) return;
  if (!elements.dropForm.reportValidity()) return;
  try {
    const counts = dropCountsFromInputs();
    const result = core.autoAllocateDrops(members, counts, { week: room.week });
    planRows = rowsFromPlan(result, counts);
    planVisible = true;
    distributionDirty = true;
    renderRecommendation();
    syncDistributionControls();
    const assigned = result.assignments.length;
    const unassigned = result.unassignedDrops.length;
    setStatus(
      elements.dropStatus,
      unassigned
        ? `${assigned}개를 추천했고 ${unassigned}개는 필요한 대상이 없어 미배정으로 남겼어요.`
        : `${assigned}개 드랍의 분배 대상을 모두 추천했어요.`,
      unassigned ? "warning" : "success",
    );
    setStatus(elements.distributionStatus, "추천 결과를 확인하고 분배안을 저장해 주세요.", "warning");
    elements.recommendationPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(elements.dropStatus, error.message, "error");
  }
});

elements.recommendationList.addEventListener("change", (event) => {
  if (!isOwner() || !allMembersSubmitted() || distributionBusy || ownerActionBusy) return;
  const item = event.target.closest("[data-row-index]");
  if (!item) return;
  const row = planRows[Number(item.dataset.rowIndex)];
  if (!row) return;
  if (event.target.matches("[data-field='recipient']")) {
    row.seat = event.target.value;
    const candidates = needCandidates(row.dropType, row).filter((candidate) => candidate.seat === row.seat);
    row.gearSlot = candidates[0]?.gearSlot || "";
    row.savedAssignmentKey = "";
  } else if (event.target.matches("[data-field='gear-slot']")) {
    row.gearSlot = event.target.value;
    row.savedAssignmentKey = "";
  } else {
    return;
  }
  distributionDirty = true;
  renderRecommendation();
  syncDistributionControls();
  try {
    currentPlan();
    setStatus(elements.distributionStatus, "수동 변경을 반영했어요. 저장 전에는 다른 사람에게 보이지 않습니다.", "warning");
  } catch (error) {
    setStatus(elements.distributionStatus, error.message, "error");
  }
});

elements.recommendationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='remove-assignment']");
  if (!button || !isOwner() || distributionBusy || ownerActionBusy) return;
  const item = button.closest("[data-row-index]");
  const row = planRows[Number(item?.dataset.rowIndex)];
  if (!row) return;
  row.seat = "";
  row.gearSlot = "";
  row.savedAssignmentKey = "";
  distributionDirty = true;
  renderRecommendation();
  syncDistributionControls();
  setStatus(elements.distributionStatus, "드랍을 미배정으로 남겼어요. 저장 전에는 다른 사람에게 보이지 않습니다.", "warning");
});

elements.distributionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isOwner() || !allMembersSubmitted() || distributionBusy || ownerActionBusy || !planVisible) return;
  distributionBusy = true;
  syncDistributionControls();
  syncOwnerPanel({ preserveStatus: true });
  setStatus(elements.distributionStatus, "분배안을 저장하고 있어요.");
  try {
    const dropCounts = dropCountsFromInputs();
    const plan = currentPlan();
    const distribution = core.normalizeDistribution({
      week: room.week,
      dropCounts,
      assignments: plan.assignments,
    });
    await store.saveDistribution(roomId, distribution);
    planRows.forEach((row) => {
      row.savedAssignmentKey = row.seat && row.gearSlot
        ? `${row.dropType}@${row.seat}@${row.gearSlot}`
        : "";
    });
    loadedDistributionSignature = distributionSignature(distribution);
    distributionDirty = false;
    setStatus(elements.distributionStatus, "분배안을 저장했어요.", "success");
    setStatus(elements.dropStatus, "저장된 드랍 수량과 분배안을 표시하고 있어요.", "success");
    showToast("분배안을 저장했어요");
  } catch (error) {
    setStatus(elements.distributionStatus, firebaseErrorMessage(error, "분배안을 저장하지 못했어요."), "error");
  } finally {
    distributionBusy = false;
    syncDistributionControls();
    syncOwnerPanel({ preserveStatus: true });
  }
});

elements.copyImageButton.addEventListener("click", () => runImageAction(async () => {
  const blob = await createSummaryImageBlob();
  if (globalThis.ClipboardItem && navigator.clipboard?.write && window.isSecureContext) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus(elements.imageStatus, "8인 BiS 현황 이미지를 클립보드에 복사했어요.", "success");
      showToast("현황 이미지를 복사했어요");
      return;
    } catch (_error) {
      // 이미지 클립보드를 지원하지 않는 브라우저에서는 바로 PNG로 저장한다.
    }
  }
  downloadBlob(blob);
  setStatus(elements.imageStatus, "이 브라우저에서는 이미지 복사가 제한되어 PNG로 저장했어요.", "warning");
  showToast("현황 이미지를 PNG로 저장했어요");
}));

elements.savePngButton.addEventListener("click", () => runImageAction(async () => {
  downloadBlob(await createSummaryImageBlob());
  setStatus(elements.imageStatus, "8인 BiS 현황 이미지를 PNG로 저장했어요.", "success");
  showToast("현황 이미지를 저장했어요");
}));

window.addEventListener("beforeunload", (event) => {
  if ((!distributionDirty && !roomSettingsDirty) || !isOwner()) return;
  event.preventDefault();
  event.returnValue = "";
});

async function initialize() {
  elements.dropInputs.forEach((input) => { input.disabled = true; });
  elements.clearDropCountsButton.disabled = true;
  elements.recommendButton.disabled = true;
  elements.saveDistributionButton.disabled = true;
  elements.copyImageButton.disabled = true;
  elements.savePngButton.disabled = true;
  try {
    roomId = core.validateRoomId(new URL(window.location.href).searchParams.get("r"));
  } catch (error) {
    showMissing(error.message);
    return;
  }

  elements.headerInputLink.href = inputUrl().toString();
  if (!core.firebaseConfigReady(firebaseConfig)) {
    showMissing("Firebase 공개 웹 설정을 연결한 뒤 비스표 방을 이용할 수 있어요.", "warning");
    return;
  }

  try {
    store = await createBisRoomStore(firebaseConfig, { ensureAnonymous: true });
    roomUnsubscribe = store.subscribeRoom(roomId, handleRoomValue, (error) => {
      showMissing(firebaseErrorMessage(error));
    });
    membersUnsubscribe = store.subscribeMembers(roomId, handleMembersValue, (error) => {
      setStatus(elements.status, firebaseErrorMessage(error, "공대원 현황을 불러오지 못했어요."), "error");
    });
  } catch (error) {
    showMissing(firebaseErrorMessage(error));
  }
}

initialize();
