(function (root) {
  "use strict";

  function persistentStorage() {
    return root.EonjepyoStorage || root.localStorage || root.window?.localStorage;
  }

  function initSavedPage() {
    if (typeof document === "undefined") return;

  const scheduleApi = root.Eonjepyo;
  const savedApi = root.EonjepyoSaved;
  const comparisonsApi = root.EonjepyoComparisons;
  const listElement = document.querySelector("#savedScheduleList");
  const collectionListElement = document.querySelector("#savedCollectionList");
  if (!scheduleApi || !savedApi || !comparisonsApi || !listElement || !collectionListElement) return;

  const elements = {
    search: document.querySelector("#savedSearchInput"),
    count: document.querySelector("#savedScheduleCount"),
    selectAll: document.querySelector("#savedSelectAllCheckbox"),
    selectedCount: document.querySelector("#savedSelectedCount"),
    clearSelection: document.querySelector("#savedClearSelectionButton"),
    addToCollection: document.querySelector("#savedAddToCollectionButton"),
    compare: document.querySelector("#savedCompareButton"),
    list: listElement,
    empty: document.querySelector("#savedEmptyState"),
    noResults: document.querySelector("#savedNoResultsState"),
    resetSearch: document.querySelector("#savedSearchResetButton"),
    status: document.querySelector("#savedListStatus"),
    template: document.querySelector("#savedScheduleTemplate"),
    deleteDialog: document.querySelector("#savedDeleteDialog"),
    deleteName: document.querySelector("#savedDeleteTargetName"),
    deleteConfirm: document.querySelector("#savedDeleteConfirmButton"),
    collectionCount: document.querySelector("#savedCollectionCount"),
    collectionList: collectionListElement,
    collectionEmpty: document.querySelector("#savedCollectionEmptyState"),
    collectionStatus: document.querySelector("#savedCollectionListStatus"),
    collectionTemplate: document.querySelector("#savedCollectionTemplate"),
    addDialog: document.querySelector("#savedAddToCollectionDialog"),
    addForm: document.querySelector("#savedAddToCollectionForm"),
    addCount: document.querySelector("#savedAddToCollectionCount"),
    addTarget: document.querySelector("#savedAddTargetSelect"),
    addHelp: document.querySelector("#savedAddToCollectionHelp"),
    addConfirm: document.querySelector("#savedAddToCollectionConfirmButton"),
    collectionDeleteDialog: document.querySelector("#savedCollectionDeleteDialog"),
    collectionDeleteName: document.querySelector("#savedCollectionDeleteTargetName"),
    collectionDeleteConfirm: document.querySelector("#savedCollectionDeleteConfirmButton"),
    toast: document.querySelector("#toast"),
  };

  let records = [];
  let visibleRecords = [];
  let collections = [];
  let selectedIds = new Set();
  let renamingId = null;
  let deletingId = null;
  let renamingCollectionId = null;
  let deletingCollectionId = null;
  let toastTimer = null;

  function showToast(message) {
    if (!elements.toast) return;
    root.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    toastTimer = root.setTimeout(() => elements.toast.classList.remove("show"), 2200);
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function formatStartRange(startHour) {
    return startHour === 0
      ? "00:00–24:00"
      : `${formatHour(startHour)}–익일 ${formatHour(startHour)}`;
  }

  function formatStartDay(startDay) {
    return scheduleApi.DAYS?.[startDay]?.full || `${startDay + 1}번째 요일`;
  }

  function formatRelativeTime(timestamp) {
    const difference = Math.max(0, Date.now() - timestamp);
    const minutes = Math.floor(difference / 60000);
    if (minutes < 1) return "방금";
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}일 전`;
    return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(timestamp);
  }

  function formatSavedDate(timestamp) {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(timestamp);
  }

  function selectedCount(record) {
    try {
      return scheduleApi.countSelected(scheduleApi.decodeSlots(record.slots));
    } catch (_error) {
      return 0;
    }
  }

  function setText(item, selector, value) {
    const target = item.querySelector(selector);
    if (target) target.textContent = String(value);
  }

  function recordMatches(record, query) {
    if (!query) return true;
    const searchable = `${record.title} ${record.timezone}`.toLocaleLowerCase("ko-KR");
    return searchable.includes(query);
  }

  function collectionTimezone(record) {
    const timezones = [...new Set(record.members.map((member) => member.timezone))];
    if (timezones.length <= 1) return timezones[0] || "-";
    return `${timezones[0]} 외 ${timezones.length - 1}개`;
  }

  function collectionParticipantNames(record) {
    const names = record.members.map((member) => member.title);
    if (names.length <= 8) return names.join(" · ");
    return `${names.slice(0, 8).join(" · ")} 외 ${names.length - 8}명`;
  }

  function syncSelectionControls() {
    const visibleIds = visibleRecords.map((record) => record.id);
    const visibleSelected = visibleIds.filter((id) => selectedIds.has(id)).length;
    const allVisibleSelected = visibleIds.length > 0 && visibleSelected === visibleIds.length;

    elements.selectAll.disabled = visibleIds.length === 0;
    elements.selectAll.checked = allVisibleSelected;
    elements.selectAll.indeterminate = visibleSelected > 0 && !allVisibleSelected;
    elements.selectedCount.textContent = String(selectedIds.size);
    elements.clearSelection.disabled = selectedIds.size === 0;
    elements.compare.disabled = selectedIds.size === 0;
    elements.addToCollection.disabled = selectedIds.size === 0 || collections.length === 0;
  }

  function createSavedItem(record) {
    const fragment = elements.template.content.cloneNode(true);
    const item = fragment.querySelector("[data-saved-item]");
    item.dataset.savedId = record.id;

    setText(item, "[data-field='title']", record.title);
    setText(item, "[data-field='saved-at']", formatRelativeTime(record.updatedAt));
    setText(item, "[data-field='saved-date']", formatSavedDate(record.updatedAt));
    setText(item, "[data-field='selected-count']", selectedCount(record));
    setText(item, "[data-field='timezone']", record.timezone);
    setText(item, "[data-field='start-range']", formatStartRange(record.startHour));
    setText(item, "[data-field='selection-label']", `${record.title} 일정 선택`);

    const checkbox = item.querySelector("[data-action='toggle-selection']");
    checkbox.checked = selectedIds.has(record.id);

    item.querySelector("[data-action='load']").href = `./?load=${encodeURIComponent(record.id)}`;
    item.querySelector("[data-action='edit']").href = `./?edit=${encodeURIComponent(record.id)}`;

    if (renamingId === record.id) {
      item.querySelector("[data-rename-form]").hidden = false;
      item.querySelector("[data-view-mode]").hidden = true;
      item.querySelector("[data-field='rename-input']").value = record.title;
    }
    return fragment;
  }

  function createCollectionItem(record) {
    const fragment = elements.collectionTemplate.content.cloneNode(true);
    const item = fragment.querySelector("[data-saved-collection-item]");
    item.dataset.collectionId = record.id;

    setText(item, "[data-field='title']", record.name);
    setText(item, "[data-field='updated-at']", formatRelativeTime(record.updatedAt));
    setText(item, "[data-field='updated-date']", formatSavedDate(record.updatedAt));
    setText(item, "[data-field='participant-count']", record.members.length);
    setText(item, "[data-field='participant-names']", collectionParticipantNames(record));
    setText(item, "[data-field='start-range']", formatStartRange(record.startHour));
    setText(item, "[data-field='start-day']", formatStartDay(record.startDay));
    setText(item, "[data-field='timezone']", collectionTimezone(record));
    item.querySelector("[data-action='open']").href = `./compare.html?collection=${encodeURIComponent(record.id)}`;

    if (renamingCollectionId === record.id) {
      item.querySelector("[data-rename-form]").hidden = false;
      item.querySelector("[data-view-mode]").hidden = true;
      item.querySelector("[data-field='rename-input']").value = record.name;
    }
    return fragment;
  }

  function focusRenameInput(list, dataKey, id) {
    root.requestAnimationFrame(() => {
      const item = [...list.children].find((candidate) => candidate.dataset[dataKey] === id);
      const input = item?.querySelector("[data-field='rename-input']");
      input?.focus();
      input?.select();
    });
  }

  function renderCollections({ announce = false } = {}) {
    try {
      collections = comparisonsApi.list(persistentStorage());
    } catch (_error) {
      collections = [];
      showToast("저장한 취합 일정 목록을 읽지 못했어요");
    }

    elements.collectionList.replaceChildren(...collections.map(createCollectionItem));
    elements.collectionCount.textContent = String(collections.length);
    elements.collectionEmpty.hidden = collections.length !== 0;
    elements.collectionStatus.textContent = collections.length
      ? `${collections.length}개의 저장된 취합 일정이 있습니다.`
      : "저장한 취합 일정이 없습니다.";
    if (announce) elements.collectionStatus.setAttribute("data-updated", String(Date.now()));

    const previousTarget = elements.addTarget.value;
    elements.addTarget.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = collections.length
      ? "추가할 취합 일정을 선택하세요"
      : "먼저 취합 일정을 저장해 주세요";
    elements.addTarget.append(placeholder);
    collections.forEach((record) => {
      const option = document.createElement("option");
      option.value = record.id;
      option.textContent = `${record.name} · ${record.members.length}명`;
      elements.addTarget.append(option);
    });
    if (collections.some((record) => record.id === previousTarget)) elements.addTarget.value = previousTarget;
    elements.addConfirm.disabled = !elements.addTarget.value;
    syncSelectionControls();
    if (renamingCollectionId) focusRenameInput(elements.collectionList, "collectionId", renamingCollectionId);
  }

  function render({ announce = false } = {}) {
    try {
      records = savedApi.list(persistentStorage());
    } catch (_error) {
      records = [];
      showToast("저장한 일정 목록을 읽지 못했어요");
    }

    const existingIds = new Set(records.map((record) => record.id));
    selectedIds = new Set([...selectedIds].filter((id) => existingIds.has(id)));
    const query = elements.search.value.trim().toLocaleLowerCase("ko-KR");
    visibleRecords = records.filter((record) => recordMatches(record, query));

    elements.list.replaceChildren(...visibleRecords.map(createSavedItem));
    elements.count.textContent = String(records.length);
    elements.empty.hidden = records.length !== 0;
    elements.noResults.hidden = records.length === 0 || visibleRecords.length !== 0;
    syncSelectionControls();

    elements.status.textContent = records.length === 0
      ? "저장한 일정이 없습니다."
      : query && visibleRecords.length === 0
        ? "검색어와 일치하는 일정이 없습니다."
        : `${records.length}개의 저장 일정 중 ${visibleRecords.length}개를 보여주고 있습니다.`;
    if (announce) elements.status.setAttribute("data-updated", String(Date.now()));
    if (renamingId) focusRenameInput(elements.list, "savedId", renamingId);
  }

  async function copyPlainText(text) {
    if (root.navigator?.clipboard?.writeText) {
      await root.navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("클립보드 복사를 지원하지 않습니다.");
  }

  async function shareCollection(record) {
    try {
      const baseUrl = new URL("./compare.html", root.location.href);
      baseUrl.search = "";
      baseUrl.hash = "";
      await copyPlainText(comparisonsApi.makeShareUrl(baseUrl.toString(), record));
      showToast(`${record.name} 공유 링크를 복사했어요`);
    } catch (_error) {
      showToast("취합표 공유 링크를 복사하지 못했어요");
    }
  }

  function beginDelete(record) {
    deletingId = record.id;
    elements.deleteName.textContent = record.title;
    if (typeof elements.deleteDialog.showModal === "function") {
      elements.deleteDialog.showModal();
      return;
    }
    if (root.confirm(`'${record.title}' 일정을 삭제할까요?`)) confirmDelete();
  }

  function confirmDelete() {
    if (!deletingId) return;
    const record = records.find((item) => item.id === deletingId);
    try {
      savedApi.remove(persistentStorage(), deletingId);
      selectedIds.delete(deletingId);
      if (renamingId === deletingId) renamingId = null;
      showToast(`${record?.title || "일정"}을 저장 목록에서 삭제했어요`);
      deletingId = null;
      render({ announce: true });
    } catch (_error) {
      showToast("일정을 삭제하지 못했어요");
    }
  }

  function beginCollectionDelete(record) {
    deletingCollectionId = record.id;
    elements.collectionDeleteName.textContent = record.name;
    if (typeof elements.collectionDeleteDialog.showModal === "function") {
      elements.collectionDeleteDialog.showModal();
      return;
    }
    if (root.confirm(`'${record.name}' 취합 일정을 삭제할까요?`)) confirmCollectionDelete();
  }

  function confirmCollectionDelete() {
    if (!deletingCollectionId) return;
    const record = collections.find((item) => item.id === deletingCollectionId);
    try {
      comparisonsApi.remove(persistentStorage(), deletingCollectionId);
      if (renamingCollectionId === deletingCollectionId) renamingCollectionId = null;
      showToast(`${record?.name || "취합 일정"}을 보관함에서 삭제했어요`);
      deletingCollectionId = null;
      renderCollections({ announce: true });
    } catch (_error) {
      showToast("취합 일정을 삭제하지 못했어요");
    }
  }

  function openAddDialog() {
    if (!selectedIds.size || !collections.length) return;
    elements.addCount.textContent = String(selectedIds.size);
    elements.addTarget.value = "";
    elements.addConfirm.disabled = true;
    elements.addHelp.textContent = "이미 들어 있는 일정은 중복으로 추가하지 않아요.";
    if (typeof elements.addDialog.showModal === "function") {
      elements.addDialog.showModal();
      return;
    }
    elements.addTarget.value = collections[0].id;
    addSelectedToCollection();
  }

  function addSelectedToCollection() {
    const targetId = elements.addTarget.value;
    const target = collections.find((record) => record.id === targetId);
    if (!target) {
      elements.addHelp.textContent = "추가할 취합 일정을 선택해 주세요.";
      return false;
    }
    const members = records
      .filter((record) => selectedIds.has(record.id))
      .map((record) => ({
        title: record.title,
        timezone: record.timezone,
        startHour: record.startHour,
        startDay: record.startDay,
        slots: record.slots,
      }));
    if (!members.length) return false;

    try {
      const updated = comparisonsApi.addMembers(persistentStorage(), target.id, members);
      const added = updated.members.length - target.members.length;
      const skipped = members.length - added;
      selectedIds.clear();
      renderCollections({ announce: true });
      render({ announce: true });
      if (added && skipped) showToast(`${target.name}에 ${added}개 추가하고 중복 ${skipped}개는 건너뛰었어요`);
      else if (added) showToast(`${target.name}에 새 일정 ${added}개를 추가했어요`);
      else showToast("선택한 일정은 이미 모두 이 취합표에 들어 있어요");
      return true;
    } catch (error) {
      elements.addHelp.textContent = error.message || "선택한 일정을 추가하지 못했어요.";
      showToast("선택한 일정을 취합표에 추가하지 못했어요");
      return false;
    }
  }

  elements.search.addEventListener("input", () => render());
  elements.resetSearch.addEventListener("click", () => {
    elements.search.value = "";
    render({ announce: true });
    elements.search.focus();
  });

  elements.selectAll.addEventListener("change", () => {
    visibleRecords.forEach((record) => {
      if (elements.selectAll.checked) selectedIds.add(record.id);
      else selectedIds.delete(record.id);
    });
    render();
  });

  elements.clearSelection.addEventListener("click", () => {
    selectedIds.clear();
    render({ announce: true });
  });

  elements.addToCollection.addEventListener("click", openAddDialog);
  elements.addTarget.addEventListener("change", () => {
    elements.addConfirm.disabled = !elements.addTarget.value;
    elements.addHelp.textContent = elements.addTarget.value
      ? "이미 들어 있는 일정은 중복으로 추가하지 않아요."
      : "추가할 취합 일정을 선택해 주세요.";
  });
  elements.addForm.addEventListener("submit", (event) => {
    if (event.submitter?.value !== "confirm") return;
    event.preventDefault();
    if (addSelectedToCollection() && elements.addDialog.open) elements.addDialog.close("confirm");
  });

  elements.compare.addEventListener("click", () => {
    const ids = records.filter((record) => selectedIds.has(record.id)).map((record) => record.id);
    if (!ids.length) return;
    try {
      savedApi.queueForComparison(persistentStorage(), ids, { actionStorage: root.sessionStorage });
      root.location.href = "./compare.html";
    } catch (_error) {
      showToast("선택한 일정을 취합 화면으로 보내지 못했어요");
    }
  });

  elements.list.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-action='toggle-selection']");
    if (!checkbox) return;
    const item = checkbox.closest("[data-saved-item]");
    if (checkbox.checked) selectedIds.add(item.dataset.savedId);
    else selectedIds.delete(item.dataset.savedId);
    syncSelectionControls();
  });

  elements.list.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action || ["toggle-selection", "load", "edit", "save-rename"].includes(action.dataset.action)) return;
    const item = action.closest("[data-saved-item]");
    const record = records.find((candidate) => candidate.id === item?.dataset.savedId);
    if (!record) return;
    if (action.dataset.action === "rename") {
      renamingId = record.id;
      render();
    } else if (action.dataset.action === "cancel-rename") {
      renamingId = null;
      render();
    } else if (action.dataset.action === "delete") {
      beginDelete(record);
    }
  });

  elements.list.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-rename-form]");
    if (!form) return;
    event.preventDefault();
    const id = form.closest("[data-saved-item]").dataset.savedId;
    const input = form.querySelector("[data-field='rename-input']");
    try {
      const updated = savedApi.updateTitle(persistentStorage(), id, input.value);
      renamingId = null;
      showToast(`${updated.title}(으)로 이름을 바꿨어요`);
      render({ announce: true });
    } catch (error) {
      input.focus();
      showToast(error.message || "일정 이름을 바꾸지 못했어요");
    }
  });

  elements.collectionList.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action || ["open", "save-rename"].includes(action.dataset.action)) return;
    const item = action.closest("[data-saved-collection-item]");
    const record = collections.find((candidate) => candidate.id === item?.dataset.collectionId);
    if (!record) return;
    if (action.dataset.action === "share") {
      shareCollection(record);
    } else if (action.dataset.action === "rename") {
      renamingCollectionId = record.id;
      renderCollections();
    } else if (action.dataset.action === "cancel-rename") {
      renamingCollectionId = null;
      renderCollections();
    } else if (action.dataset.action === "delete") {
      beginCollectionDelete(record);
    }
  });

  elements.collectionList.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-rename-form]");
    if (!form) return;
    event.preventDefault();
    const id = form.closest("[data-saved-collection-item]").dataset.collectionId;
    const input = form.querySelector("[data-field='rename-input']");
    try {
      const updated = comparisonsApi.rename(persistentStorage(), id, input.value);
      renamingCollectionId = null;
      showToast(`${updated.name}(으)로 이름을 바꿨어요`);
      renderCollections({ announce: true });
    } catch (error) {
      input.focus();
      showToast(error.message || "취합 일정 이름을 바꾸지 못했어요");
    }
  });

  elements.deleteConfirm.addEventListener("click", (event) => {
    event.preventDefault();
    confirmDelete();
    if (elements.deleteDialog.open) elements.deleteDialog.close("confirm");
  });
  elements.deleteDialog.addEventListener("close", () => { deletingId = null; });

  elements.collectionDeleteConfirm.addEventListener("click", (event) => {
    event.preventDefault();
    confirmCollectionDelete();
    if (elements.collectionDeleteDialog.open) elements.collectionDeleteDialog.close("confirm");
  });
  elements.collectionDeleteDialog.addEventListener("close", () => { deletingCollectionId = null; });

  root.addEventListener?.("storage", (event) => {
    if (root.EonjepyoStorage === root.SmallToolsVault?.storage && event.storageArea) return;
    if (event.key === null || event.key === comparisonsApi.STORAGE_KEY) renderCollections({ announce: true });
    if (event.key === null || event.key === savedApi.STORAGE_KEY) render({ announce: true });
  });

  renderCollections();
  render();
  }

  const storageReady = root.EonjepyoStorageReady || root.SmallToolsVault?.ready;
  if (storageReady && typeof storageReady.then === "function") {
    Promise.resolve(storageReady).catch(() => undefined).then(initSavedPage);
  } else {
    initSavedPage();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
