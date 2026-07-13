(function (root) {
  "use strict";

  if (typeof document === "undefined") return;

  const scheduleApi = root.Eonjepyo;
  const savedApi = root.EonjepyoSaved;
  const listElement = document.querySelector("#savedScheduleList");
  if (!scheduleApi || !savedApi || !listElement) return;

  const elements = {
    search: document.querySelector("#savedSearchInput"),
    count: document.querySelector("#savedScheduleCount"),
    selectAll: document.querySelector("#savedSelectAllCheckbox"),
    selectedCount: document.querySelector("#savedSelectedCount"),
    clearSelection: document.querySelector("#savedClearSelectionButton"),
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
    toast: document.querySelector("#toast"),
  };

  let records = [];
  let visibleRecords = [];
  let selectedIds = new Set();
  let renamingId = null;
  let deletingId = null;
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

    const loadLink = item.querySelector("[data-action='load']");
    const editLink = item.querySelector("[data-action='edit']");
    loadLink.href = `./?load=${encodeURIComponent(record.id)}`;
    editLink.href = `./?edit=${encodeURIComponent(record.id)}`;

    const renameForm = item.querySelector("[data-rename-form]");
    const viewMode = item.querySelector("[data-view-mode]");
    if (renamingId === record.id) {
      renameForm.hidden = false;
      viewMode.hidden = true;
      const input = item.querySelector("[data-field='rename-input']");
      input.value = record.title;
    }

    return fragment;
  }

  function render({ announce = false } = {}) {
    try {
      records = savedApi.list(root.localStorage);
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

    const description = records.length === 0
      ? "저장한 일정이 없습니다."
      : query && visibleRecords.length === 0
        ? "검색어와 일치하는 일정이 없습니다."
        : `${records.length}개의 저장 일정 중 ${visibleRecords.length}개를 보여주고 있습니다.`;
    elements.status.textContent = description;
    if (announce) elements.status.setAttribute("data-updated", String(Date.now()));

    if (renamingId) {
      root.requestAnimationFrame(() => {
        const input = elements.list.querySelector(`[data-saved-id="${CSS.escape(renamingId)}"] [data-field="rename-input"]`);
        input?.focus();
        input?.select();
      });
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
      savedApi.remove(root.localStorage, deletingId);
      selectedIds.delete(deletingId);
      if (renamingId === deletingId) renamingId = null;
      showToast(`${record?.title || "일정"}을 저장 목록에서 삭제했어요`);
      deletingId = null;
      render({ announce: true });
    } catch (_error) {
      showToast("일정을 삭제하지 못했어요");
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

  elements.compare.addEventListener("click", () => {
    const ids = records.filter((record) => selectedIds.has(record.id)).map((record) => record.id);
    if (!ids.length) return;
    try {
      savedApi.queueForComparison(root.localStorage, ids, { actionStorage: root.sessionStorage });
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
    const item = form.closest("[data-saved-item]");
    const id = item.dataset.savedId;
    const input = form.querySelector("[data-field='rename-input']");
    try {
      const updated = savedApi.updateTitle(root.localStorage, id, input.value);
      renamingId = null;
      showToast(`${updated.title}(으)로 이름을 바꿨어요`);
      render({ announce: true });
    } catch (error) {
      input.focus();
      showToast(error.message || "일정 이름을 바꾸지 못했어요");
    }
  });

  elements.deleteConfirm.addEventListener("click", (event) => {
    event.preventDefault();
    confirmDelete();
    elements.deleteDialog.close("confirm");
  });

  elements.deleteDialog.addEventListener("close", () => {
    deletingId = null;
  });

  render();
})(typeof globalThis !== "undefined" ? globalThis : this);
