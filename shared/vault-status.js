(function (root, factory) {
  "use strict";

  const api = factory(root || {});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SmallToolsVaultStatus = api;
  if (root?.document) api.mount();
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function normalizeStatus(value) {
    const status = value && typeof value === "object" ? value : {};
    return {
      supported: status.supported !== false,
      mode: status.mode === "localstorage" ? "localstorage" : "indexeddb",
      connected: Boolean(status.connected),
      dirty: Boolean(status.dirty),
      permission: typeof status.permission === "string" ? status.permission : "prompt",
      lastSyncAt: status.lastSyncAt || null,
      fileName: typeof status.fileName === "string" ? status.fileName : "",
      error: status.error || null,
    };
  }

  function formatRelativeTime(value, now = Date.now()) {
    if (!value) return "";
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "";
    const elapsed = Math.max(0, now - timestamp);
    if (elapsed < 60_000) return "방금";
    if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}분 전`;
    if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}시간 전`;
    return `${Math.floor(elapsed / (24 * 60 * 60_000))}일 전`;
  }

  function getStatusPresentation(value, options = {}) {
    const status = normalizeStatus(value);
    if (options.pending) {
      return {
        state: "pending",
        label: "브라우저 저장 중…",
        detail: "변경 내용을 이 브라우저의 작업본에 저장하고 있어요.",
      };
    }
    if (options.writeError || status.error) {
      const message = options.writeError?.message || status.error?.message || "저장 상태를 확인해 주세요.";
      return { state: "error", label: "저장 오류", detail: message };
    }
    if (!status.supported) {
      return {
        state: "error",
        label: "임시 저장 중",
        detail: "영구 저장소를 사용할 수 없어 현재 탭에만 보관하고 있어요.",
      };
    }
    if (status.mode === "localstorage") {
      return {
        state: "warning",
        label: "간이 저장됨",
        detail: "IndexedDB 대신 용량이 작은 브라우저 저장소를 사용하고 있어요.",
      };
    }
    if (status.connected && status.permission === "denied") {
      return {
        state: "error",
        label: "파일 권한 필요",
        detail: "연결한 보관함 파일에 쓰려면 권한을 다시 허용해야 해요.",
      };
    }
    if (status.connected && status.permission !== "granted") {
      return {
        state: "warning",
        label: "파일 연결 필요",
        detail: "브라우저 작업본은 저장됐지만 보관함 파일을 다시 연결해야 해요.",
      };
    }
    if (status.connected && status.dirty) {
      return {
        state: "warning",
        label: "파일 동기화 대기",
        detail: "브라우저 작업본은 저장됐고 연결한 파일에 곧 반영할 예정이에요.",
      };
    }
    if (status.connected) {
      const relative = formatRelativeTime(status.lastSyncAt, options.now);
      return {
        state: "synced",
        label: "파일까지 저장됨",
        detail: `${status.fileName || "보관함 파일"}에 저장됐어요${relative ? ` · ${relative}` : ""}.`,
      };
    }
    return {
      state: "local",
      label: "브라우저에 저장됨",
      detail: "이 브라우저의 IndexedDB 작업본에 저장됐어요. 파일 백업은 도구함에서 연결할 수 있어요.",
    };
  }

  function findScript(documentObject) {
    if (documentObject.currentScript?.src) return documentObject.currentScript;
    return Array.from(documentObject.scripts || []).find((script) => /\/shared\/vault-status\.js(?:\?|$)/.test(script.src || ""));
  }

  function resolveHubUrl(documentObject, locationObject) {
    const script = findScript(documentObject);
    try {
      return new URL("../?vault=open#vaultPanel", script?.src || locationObject?.href || "").href;
    } catch (_error) {
      return "../?vault=open#vaultPanel";
    }
  }

  function createBadge(documentObject, hubUrl) {
    const badge = documentObject.createElement("a");
    badge.className = "vault-save-status";
    badge.href = hubUrl;
    badge.dataset.state = "pending";
    badge.innerHTML = [
      '<span class="vault-save-status-dot" aria-hidden="true"></span>',
      '<span class="vault-save-status-label">저장 확인 중…</span>',
    ].join("");
    badge.setAttribute("aria-label", "저장 상태 확인 중. 도구함에서 기록 보관함 열기");
    return badge;
  }

  function placeBadge(documentObject, badge) {
    const header = documentObject.querySelector(".site-header");
    if (!header) return false;
    const existing = header.querySelector(".vault-save-status");
    if (existing) return existing;

    let tools = header.querySelector(":scope > .vault-header-tools");
    if (!tools) {
      tools = documentObject.createElement("div");
      tools.className = "vault-header-tools";
      const rightSlot = header.lastElementChild;
      if (rightSlot && !rightSlot.classList.contains("brand") && !rightSlot.classList.contains("back-link")) {
        header.insertBefore(tools, rightSlot);
        tools.appendChild(rightSlot);
      } else {
        header.appendChild(tools);
      }
    }
    tools.appendChild(badge);
    return badge;
  }

  function mount(options = {}) {
    const documentObject = options.document || root.document;
    const vault = options.vault || root.SmallToolsVault;
    if (!documentObject || !vault || typeof vault.getStatus !== "function") return null;

    const createdBadge = createBadge(documentObject, options.hubUrl || resolveHubUrl(documentObject, root.location));
    const badge = placeBadge(documentObject, createdBadge);
    if (!badge) return null;

    const label = badge.querySelector(".vault-save-status-label");
    let currentStatus = null;
    let pending = false;
    let writeError = null;
    let verifyTimer = null;
    let generation = 0;

    function render(status = currentStatus) {
      currentStatus = status || currentStatus || vault.getStatus();
      const presentation = getStatusPresentation(currentStatus, { pending, writeError, now: Date.now() });
      badge.dataset.state = presentation.state;
      label.textContent = presentation.label;
      badge.title = presentation.detail;
      badge.setAttribute("aria-label", `${presentation.label}. ${presentation.detail} 도구함에서 기록 보관함 열기`);
    }

    function verifyBrowserWrite() {
      const expectedGeneration = ++generation;
      pending = true;
      writeError = null;
      render();
      if (verifyTimer !== null) root.clearTimeout?.(verifyTimer);
      verifyTimer = root.setTimeout?.(async () => {
        verifyTimer = null;
        try {
          const status = typeof vault.flush === "function" ? await vault.flush() : vault.getStatus();
          if (expectedGeneration !== generation) return;
          pending = false;
          currentStatus = status || vault.getStatus();
          render();
        } catch (error) {
          if (expectedGeneration !== generation) return;
          pending = false;
          writeError = error;
          currentStatus = vault.getStatus();
          render();
        }
      }, 90) ?? null;
    }

    function receive(status, event = {}) {
      currentStatus = status || currentStatus;
      if (event.type === "mutation" || event.type === "remote-mutation") {
        verifyBrowserWrite();
        return;
      }
      if (event.type === "error" || event.type === "conflict") {
        pending = false;
        writeError = event.error || currentStatus?.error || new Error("저장 상태를 확인해 주세요.");
      } else if (event.type === "saved" || event.type === "file-saved" || event.type === "remote-file-saved") {
        writeError = null;
      }
      render();
    }

    render(vault.getStatus());
    const unsubscribe = typeof vault.subscribe === "function" ? vault.subscribe(receive) : null;
    Promise.resolve(vault.ready).then(() => {
      currentStatus = vault.getStatus();
      render();
    }).catch((error) => {
      pending = false;
      writeError = error;
      render();
    });

    const refreshTimer = root.setInterval?.(() => render(), 60_000) ?? null;
    return {
      element: badge,
      render,
      destroy() {
        generation += 1;
        if (verifyTimer !== null) root.clearTimeout?.(verifyTimer);
        if (refreshTimer !== null) root.clearInterval?.(refreshTimer);
        if (typeof unsubscribe === "function") unsubscribe();
        badge.remove();
      },
    };
  }

  return {
    normalizeStatus,
    formatRelativeTime,
    getStatusPresentation,
    resolveHubUrl,
    mount,
  };
});
