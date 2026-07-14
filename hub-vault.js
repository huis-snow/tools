(function () {
  "use strict";

  const api = window.SmallToolsVault;
  const DISMISS_KEY = "small-tools:vault-panel-dismissed";
  const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const elements = {
    panel: document.getElementById("vaultPanel"),
    statusButton: document.getElementById("vaultStatusButton"),
    headerLabel: document.getElementById("vaultHeaderLabel"),
    closeButton: document.getElementById("vaultCloseButton"),
    title: document.getElementById("vaultTitle"),
    description: document.getElementById("vaultDescription"),
    fileName: document.getElementById("vaultFileName"),
    lastSync: document.getElementById("vaultLastSync"),
    revision: document.getElementById("vaultRevision"),
    stateBadge: document.getElementById("vaultStateBadge"),
    reconnectButton: document.getElementById("vaultReconnectButton"),
    createButton: document.getElementById("vaultCreateButton"),
    openButton: document.getElementById("vaultOpenButton"),
    saveButton: document.getElementById("vaultSaveButton"),
    continueLocalButton: document.getElementById("vaultContinueLocalButton"),
    connectedTools: document.getElementById("vaultConnectedTools"),
    backupButton: document.getElementById("vaultBackupButton"),
    forgetButton: document.getElementById("vaultForgetButton"),
    portableInput: document.getElementById("vaultPortableInput"),
    copyTextButton: document.getElementById("vaultCopyTextButton"),
    importTextButton: document.getElementById("vaultImportTextButton"),
    browserNote: document.getElementById("vaultBrowserNote"),
    notice: document.getElementById("vaultNotice"),
  };

  const actionButtons = [
    elements.reconnectButton,
    elements.createButton,
    elements.openButton,
    elements.saveButton,
    elements.backupButton,
    elements.forgetButton,
    elements.copyTextButton,
    elements.importTextButton,
  ].filter(Boolean);

  let currentStatus = null;
  let busy = false;
  let firstStatusReceived = false;
  let memoryDismissed = false;
  let reconnectFailed = false;

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_error) {
      return memoryDismissed ? "1" : null;
    }
  }

  function safeStorageSet(key, value) {
    memoryDismissed = value === "1";
    try {
      window.localStorage.setItem(key, value);
    } catch (_error) {
      // The in-memory fallback keeps the panel usable when storage is blocked.
    }
  }

  function showPanel(options) {
    const shouldFocus = Boolean(options && options.focus);
    elements.panel.hidden = false;
    elements.statusButton.setAttribute("aria-expanded", "true");
    if (shouldFocus) {
      elements.panel.setAttribute("tabindex", "-1");
      elements.panel.focus({ preventScroll: true });
      elements.panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function hidePanel(options) {
    const shouldFocus = Boolean(options && options.focus);
    elements.panel.hidden = true;
    elements.statusButton.setAttribute("aria-expanded", "false");
    if (shouldFocus) {
      elements.statusButton.focus();
    }
  }

  function announce(message) {
    elements.notice.textContent = message || "";
  }

  function getDisplayFileName(status) {
    const rawName = typeof status.fileName === "string" ? status.fileName.trim() : "";
    if (!rawName) {
      return "";
    }
    return rawName.split(/[\\/]/).pop() || "";
  }

  function formatDate(value) {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}.${month}.${day} ${hour}:${minute}`;
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) {
      return "";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function normalizeStatus(status) {
    const next = status && typeof status === "object" ? status : {};
    const fileName = getDisplayFileName(next);
    const legacyFileAccessSupported = next.fileSystemAccessSupported !== false;
    return {
      mode: next.mode === "localstorage" ? "localstorage" : "indexeddb",
      supported: next.supported !== false,
      filePickerSupported: typeof next.filePickerSupported === "boolean"
        ? next.filePickerSupported
        : legacyFileAccessSupported,
      storedHandleReconnectSupported: typeof next.storedHandleReconnectSupported === "boolean"
        ? next.storedHandleReconnectSupported
        : legacyFileAccessSupported,
      requiresFileReselection: Boolean(next.requiresFileReselection && fileName),
      connected: Boolean(next.connected),
      fileName,
      lastSyncAt: next.lastSyncAt || null,
      revision: Number.isFinite(Number(next.revision)) ? Math.max(0, Number(next.revision)) : 0,
      dirty: Boolean(next.dirty),
      permission: typeof next.permission === "string" ? next.permission : next.connected ? "granted" : "prompt",
      entryCount: Number.isFinite(Number(next.entryCount)) ? Math.max(0, Number(next.entryCount)) : 0,
      bytes: Number.isFinite(Number(next.bytes)) ? Math.max(0, Number(next.bytes)) : 0,
      vaultId: typeof next.vaultId === "string" ? next.vaultId : "",
      error: next.error || null,
    };
  }

  function getStatePresentation(status) {
    if (status.error) {
      return { key: "error", label: "확인 필요" };
    }
    if (!status.supported) {
      return { key: "error", label: "제한된 저장" };
    }
    if (status.requiresFileReselection) {
      return { key: "disconnected", label: "파일 재선택 필요" };
    }
    if (status.connected && status.permission === "denied") {
      return { key: "error", label: "권한 필요" };
    }
    if (status.connected && status.permission !== "granted") {
      return { key: "disconnected", label: "다시 연결 필요" };
    }
    if (status.connected && status.dirty) {
      return { key: "dirty", label: "변경 있음" };
    }
    if (status.connected) {
      return { key: "saved", label: "동기화됨" };
    }
    if (status.fileName && status.filePickerSupported) {
      return { key: "disconnected", label: "다시 연결 필요" };
    }
    return { key: "local", label: "기기 작업본" };
  }

  function renderStatus(rawStatus) {
    const status = normalizeStatus(rawStatus);
    const hasRecentFile = Boolean(status.fileName);
    const usesHybridPicker = status.filePickerSupported && !status.storedHandleReconnectSupported;
    const isActivelyConnected = status.connected
      && status.permission === "granted"
      && !status.requiresFileReselection;
    const hasReconnectableFile = hasRecentFile
      && status.filePickerSupported
      && (status.connected || status.requiresFileReselection);
    const state = getStatePresentation(status);
    const size = formatBytes(status.bytes);
    currentStatus = status;

    elements.fileName.textContent = status.fileName || "연결한 파일 없음";
    elements.fileName.title = status.fileName || "";
    elements.lastSync.textContent = formatDate(status.lastSyncAt);
    const lastSyncDate = status.lastSyncAt ? new Date(status.lastSyncAt) : null;
    elements.lastSync.title = lastSyncDate && !Number.isNaN(lastSyncDate.getTime())
      ? fullDateFormatter.format(lastSyncDate)
      : "";
    elements.revision.textContent = status.vaultId || status.revision > 0 ? `r${status.revision}` : "—";
    elements.stateBadge.textContent = state.label;
    elements.stateBadge.className = `vault-state-badge is-${state.key}`;
    elements.statusButton.dataset.state = state.key;

    if (isActivelyConnected) {
      elements.headerLabel.textContent = `${status.fileName || "보관함"} · ${status.dirty ? "변경 있음" : "저장됨"}`;
      elements.title.textContent = "기록 보관함이 연결되어 있어요";
    } else if (hasReconnectableFile) {
      elements.headerLabel.textContent = `${status.fileName} · ${usesHybridPicker ? "다시 선택" : "다시 연결"}`;
      elements.title.textContent = usesHybridPicker
        ? "최근 보관함을 다시 선택해 연결하세요"
        : "최근 보관함을 다시 연결하세요";
    } else if (hasRecentFile) {
      elements.headerLabel.textContent = `${status.fileName} · 최근 백업`;
      elements.title.textContent = "최근 보관함 백업을 불러왔어요";
    } else {
      elements.headerLabel.textContent = status.mode === "localstorage" || !status.supported ? "기기 저장 확인" : "보관함 연결";
      elements.title.textContent = "기록 보관함을 연결하세요";
    }

    const itemText = status.entryCount > 0
      ? `데이터 묶음 ${status.entryCount.toLocaleString("ko-KR")}개`
      : "아직 저장된 데이터 없음";
    const sizeText = size ? ` · ${size}` : "";
    elements.description.textContent = isActivelyConnected
      ? `${itemText}${sizeText}. 입력 내용은 기기 작업본에 먼저 저장되고 연결한 파일과 자동으로 맞춰집니다.`
      : `${itemText}${sizeText}. 파일을 연결하지 않아도 이 브라우저의 작업본에서 계속 사용할 수 있습니다.`;

    const usesDownloadSave = !status.filePickerSupported;
    const showReconnect = hasReconnectableFile && (!isActivelyConnected || reconnectFailed);
    const hybridExitReminder = usesHybridPicker
      ? " 웨일에서는 브라우저를 완전히 종료한 뒤 보관함 파일을 다시 선택해야 할 수 있습니다."
      : "";
    elements.reconnectButton.hidden = !showReconnect;
    elements.reconnectButton.textContent = usesHybridPicker
      ? "최근 보관함 다시 선택해 연결"
      : "최근 보관함 다시 연결";
    elements.saveButton.hidden = usesDownloadSave ? false : !isActivelyConnected || reconnectFailed;
    elements.saveButton.textContent = usesDownloadSave ? "현재 기록 저장 (JSON)" : "지금 저장";
    elements.saveButton.classList.toggle("vault-button-accent", usesDownloadSave);
    elements.createButton.hidden = usesDownloadSave;
    elements.createButton.textContent = "새 보관함 만들기";
    elements.createButton.classList.toggle("vault-button-accent", !usesHybridPicker || !showReconnect);
    elements.openButton.textContent = usesHybridPicker
      ? "기존 보관함 불러오기"
      : status.filePickerSupported ? "다른 파일 열기" : "보관함 파일 불러오기";
    elements.connectedTools.hidden = false;
    elements.forgetButton.hidden = !status.connected && !status.requiresFileReselection;

    if (usesHybridPicker && isActivelyConnected) {
      elements.browserNote.textContent =
        "웨일에서는 지금 연결한 파일에 직접 저장하고 자동으로 동기화합니다. 다만 브라우저를 완전히 종료한 뒤에는 보안상 같은 파일을 다시 선택해야 할 수 있습니다. 전체 경로는 표시하지 않습니다.";
    } else if (usesHybridPicker && hasRecentFile) {
      elements.browserNote.textContent =
        "웨일에서는 브라우저를 완전히 종료한 뒤 보관함 파일을 다시 선택해야 할 수 있습니다. 위 버튼에서 같은 파일을 선택하면 직접 저장과 자동 동기화가 다시 시작됩니다. 파일 내용은 검증을 통과하기 전까지 변경하지 않습니다.";
    } else if (usesHybridPicker) {
      elements.browserNote.textContent =
        "웨일에서는 새 보관함을 만들면 그 파일에 직접 저장하고 자동으로 동기화합니다. 기존 보관함은 먼저 불러온 뒤 같은 파일을 다시 선택해 연결할 수 있습니다.";
    } else if (status.filePickerSupported) {
      elements.browserNote.textContent =
        "브라우저 보안상 파일의 전체 경로는 표시하거나 저장하지 않습니다. 다시 열 때 파일 권한을 요청할 수 있습니다.";
    } else {
      elements.browserNote.textContent =
        "이 브라우저에서는 파일을 직접 덮어쓸 수 없어, '현재 기록 저장'을 누를 때마다 JSON 새 파일로 내려받습니다. 전체 경로는 표시하지 않습니다.";
    }

    if (!status.supported) {
      elements.browserNote.textContent =
        `이 브라우저에서는 영구 저장소를 사용할 수 없어 현재 탭의 임시 메모리로만 동작합니다. 탭을 닫기 전에 JSON이나 휴대용 텍스트로 백업해 주세요.${hybridExitReminder}`;
    } else if (status.mode === "localstorage") {
      elements.browserNote.textContent =
        `이 브라우저에서는 IndexedDB를 사용할 수 없어 용량이 작은 localStorage로 대신 저장 중입니다. 중요한 기록은 JSON이나 휴대용 텍스트로 자주 백업해 주세요.${hybridExitReminder}`;
    }

    if (!firstStatusReceived) {
      firstStatusReceived = true;
      const dismissed = safeStorageGet(DISMISS_KEY) === "1";
      if (!status.connected && !dismissed) {
        showPanel();
      }
    }

    setBusy(busy);
  }

  function setBusy(nextBusy) {
    busy = Boolean(nextBusy);
    elements.panel.classList.toggle("is-busy", busy);
    for (const button of actionButtons) {
      button.disabled = busy;
    }
  }

  async function refreshStatus(status) {
    try {
      const nextStatus = status || (await api.getStatus());
      renderStatus(nextStatus);
    } catch (error) {
      showCoreError(error);
    }
  }

  function describeError(error) {
    if (!error) {
      return "작업을 마치지 못했어요.";
    }
    if (error.name === "VaultConflictError" || error.code === "VAULT_FILE_CONFLICT") {
      return "파일이 다른 곳에서 바뀌어 덮어쓰지 않았어요. 현재 작업본을 JSON으로 백업한 뒤 파일을 다시 열어 주세요.";
    }
    if (error.name === "AbortError") {
      return "파일 작업을 취소했어요.";
    }
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "파일 권한이 필요해요. 다시 시도해 주세요.";
    }
    if (error.name === "QuotaExceededError") {
      return "브라우저 저장 공간이 부족해요. 먼저 백업 파일을 받아 주세요.";
    }
    return typeof error.message === "string" && error.message.trim()
      ? `작업 중 문제가 생겼어요: ${error.message.trim()}`
      : "작업 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.";
  }

  function showCoreError(error) {
    announce(describeError(error));
    elements.statusButton.dataset.state = "error";
    elements.stateBadge.textContent = "확인 필요";
    elements.stateBadge.className = "vault-state-badge is-error";
  }

  async function runAction(operation, successMessage) {
    if (busy) {
      return null;
    }
    setBusy(true);
    announce("");
    try {
      const result = await operation();
      reconnectFailed = false;
      if (successMessage) {
        announce(typeof successMessage === "function" ? successMessage(result) : successMessage);
      }
      await refreshStatus(result && result.status ? result.status : null);
      return result;
    } catch (error) {
      announce(describeError(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copyPortableText() {
    const result = await runAction(() => api.exportPortableText());
    if (result === null) {
      return;
    }
    const portableText = typeof result === "string" ? result : result && typeof result.text === "string" ? result.text : "";
    if (!portableText) {
      announce("복사할 휴대용 텍스트를 만들지 못했어요.");
      return;
    }

    elements.portableInput.value = portableText;
    try {
      await navigator.clipboard.writeText(portableText);
      announce("휴대용 텍스트를 클립보드에 복사했어요.");
    } catch (_error) {
      elements.portableInput.focus();
      elements.portableInput.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (_copyError) {
        copied = false;
      }
      announce(copied ? "휴대용 텍스트를 클립보드에 복사했어요." : "텍스트가 준비됐어요. 입력칸에서 직접 복사해 주세요.");
    }
  }

  function confirmReplacement() {
    if (!currentStatus || currentStatus.entryCount <= 0) {
      return true;
    }
    return window.confirm(
      "현재 작업본을 선택한 보관함 내용으로 바꿉니다. 필요하면 먼저 JSON 백업을 받아 주세요. 계속할까요?"
    );
  }

  function bindEvents() {
    elements.statusButton.addEventListener("click", () => {
      if (elements.panel.hidden) {
        showPanel({ focus: true });
      } else {
        hidePanel({ focus: true });
      }
    });

    elements.closeButton.addEventListener("click", () => {
      safeStorageSet(DISMISS_KEY, "1");
      hidePanel({ focus: true });
    });

    elements.continueLocalButton.addEventListener("click", () => {
      safeStorageSet(DISMISS_KEY, "1");
      announce("보관함 없이 이 기기의 작업본으로 시작합니다.");
      hidePanel();
      const firstTool = document.querySelector(".active-card");
      if (firstTool) {
        firstTool.focus({ preventScroll: true });
        firstTool.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    elements.reconnectButton.addEventListener("click", async () => {
      reconnectFailed = false;
      const usesHybridPicker = currentStatus
        && currentStatus.filePickerSupported
        && !currentStatus.storedHandleReconnectSupported;
      const result = await runAction(
        () => api.reconnectFile(),
        usesHybridPicker ? "보관함 파일을 다시 선택해 연결했어요." : "최근 보관함을 다시 연결했어요."
      );
      if (result === null) {
        reconnectFailed = true;
        renderStatus(currentStatus);
        elements.reconnectButton.focus();
      }
    });
    elements.createButton.addEventListener("click", () => {
      const usesHybridPicker = currentStatus
        && currentStatus.filePickerSupported
        && !currentStatus.storedHandleReconnectSupported;
      runAction(
        () => api.createVaultFile(),
        usesHybridPicker ? "새 보관함을 만들고 연결했어요." : "새 보관함을 만들었어요."
      );
    });
    elements.openButton.addEventListener("click", () => {
      if (!confirmReplacement()) {
        announce("보관함 불러오기를 취소했어요.");
        return;
      }
      runAction(() => api.openVaultFile(), "보관함을 열고 기기 작업본과 맞췄어요.");
    });
    elements.saveButton.addEventListener("click", () => {
      const usesDownloadSave = currentStatus && !currentStatus.filePickerSupported;
      if (usesDownloadSave) {
        runAction(() => api.createVaultFile(), "현재 기록을 JSON 파일로 내려받았어요.");
      } else {
        runAction(() => api.saveNow(), "보관함 파일에 저장했어요.");
      }
    });
    elements.backupButton.addEventListener("click", () =>
      runAction(() => api.downloadBackup(), "현재 작업본의 JSON 백업을 다운로드했어요.")
    );
    elements.forgetButton.addEventListener("click", () => {
      const fileName = currentStatus && currentStatus.fileName ? ` '${currentStatus.fileName}'` : "";
      const confirmed = window.confirm(
        `${fileName} 연결 정보를 지울까요? 기기의 작업본과 실제 파일은 삭제되지 않습니다.`
      );
      if (confirmed) {
        runAction(() => api.forgetFile(), "보관함 연결 정보를 지웠어요. 기기 작업본은 그대로 남아 있습니다.");
      }
    });
    elements.copyTextButton.addEventListener("click", copyPortableText);
    elements.importTextButton.addEventListener("click", () => {
      const portableText = elements.portableInput.value.trim();
      if (!portableText) {
        announce("먼저 휴대용 텍스트를 붙여넣어 주세요.");
        elements.portableInput.focus();
        return;
      }
      if (!confirmReplacement()) {
        announce("휴대용 텍스트 불러오기를 취소했어요.");
        return;
      }
      runAction(() => api.importPortableText(portableText), "휴대용 텍스트에서 기록을 불러왔어요.");
    });
  }

  async function initialize() {
    bindEvents();

    if (!api || typeof api.getStatus !== "function") {
      elements.connectedTools.hidden = true;
      for (const button of actionButtons) {
        button.disabled = true;
      }
      elements.headerLabel.textContent = "보관함 사용 불가";
      elements.title.textContent = "보관함을 불러오지 못했어요";
      elements.description.textContent = "페이지를 새로고침해도 계속되면 브라우저 콘솔이나 배포 파일을 확인해 주세요.";
      showPanel();
      showCoreError(new Error("보관함 저장 모듈을 찾을 수 없습니다."));
      return;
    }

    try {
      if (typeof api.ready === "function") {
        await api.ready();
      } else if (api.ready && typeof api.ready.then === "function") {
        await api.ready;
      }

      await refreshStatus();

      if (typeof api.subscribe === "function") {
        api.subscribe((status, event) => {
          refreshStatus(status);
          if (event && (event.type === "error" || event.type === "conflict")) {
            announce(describeError(event.error));
          }
        });
      }

      if (typeof api.startAutoSync === "function") {
        await api.startAutoSync();
      }
    } catch (error) {
      showPanel();
      showCoreError(error);
    }
  }

  initialize();
})();
