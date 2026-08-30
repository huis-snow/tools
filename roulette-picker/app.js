(function (root) {
  "use strict";

  const TAU = Math.PI * 2;
  const POINTER_ANGLE = -Math.PI / 2;
  const MAX_ROWS = 60;
  const MAX_LABEL_LENGTH = 80;
  const MAX_HISTORY = 8;
  const STORAGE_KEY = "small-tools:roulette-picker:v1";
  const STORAGE_VERSION = 1;
  const DEFAULT_ROWS = Object.freeze(["", "", "", ""]);
  const SAMPLE_ROWS = Object.freeze(["치킨", "피자", "초밥", "치킨"]);
  const COLORS = Object.freeze([
    "#f06a40",
    "#f2b84b",
    "#4f8f82",
    "#6c86b5",
    "#d56f89",
    "#8f75b5",
    "#68a66e",
    "#df8d4b",
    "#4b9aa8",
    "#bd6b55",
  ]);

  function normalizeLabel(value) {
    return String(value ?? "").trim().slice(0, MAX_LABEL_LENGTH);
  }

  function normalizeRows(values) {
    if (!Array.isArray(values)) throw new TypeError("룰렛 항목은 배열이어야 합니다.");
    const rows = values.slice(0, MAX_ROWS).map((value) => String(value ?? "").slice(0, MAX_LABEL_LENGTH));
    return rows.length > 0 ? rows : [""];
  }

  function activeEntries(values) {
    return normalizeRows(values).map(normalizeLabel).filter(Boolean);
  }

  function entryGroups(entriesValue) {
    const entries = activeEntries(entriesValue);
    const groups = new Map();
    entries.forEach((label) => groups.set(label, (groups.get(label) || 0) + 1));
    return [...groups].map(([label, count]) => ({ label, count, probability: count / entries.length }));
  }

  function probabilityForLabel(entriesValue, labelValue) {
    const label = normalizeLabel(labelValue);
    const entries = activeEntries(entriesValue);
    if (!label || entries.length === 0) return 0;
    return entries.filter((entry) => entry === label).length / entries.length;
  }

  function randomIndex(lengthValue, cryptoSource = root.crypto) {
    const length = Number(lengthValue);
    if (!Number.isInteger(length) || length < 1) throw new RangeError("추첨 항목 수는 1 이상이어야 합니다.");
    if (cryptoSource && typeof cryptoSource.getRandomValues === "function") {
      const range = 0x1_0000_0000;
      const limit = range - (range % length);
      const sample = new Uint32Array(1);
      do cryptoSource.getRandomValues(sample); while (sample[0] >= limit);
      return sample[0] % length;
    }
    return Math.floor(Math.random() * length);
  }

  function normalizeAngle(angle) {
    return ((Number(angle) % TAU) + TAU) % TAU;
  }

  function winningRotation(currentValue, winnerIndexValue, segmentCountValue, turnsValue = 6) {
    const current = Number(currentValue);
    const winnerIndex = Number(winnerIndexValue);
    const segmentCount = Number(segmentCountValue);
    const turns = Number(turnsValue);
    if (![current, winnerIndex, segmentCount, turns].every(Number.isFinite)) {
      throw new TypeError("회전값은 숫자여야 합니다.");
    }
    if (!Number.isInteger(winnerIndex) || !Number.isInteger(segmentCount) || segmentCount < 1
      || winnerIndex < 0 || winnerIndex >= segmentCount) {
      throw new RangeError("당첨 칸 번호가 룰렛 범위를 벗어났습니다.");
    }
    const arc = TAU / segmentCount;
    const desired = POINTER_ANGLE - (winnerIndex + 0.5) * arc;
    const forwardOffset = normalizeAngle(desired - normalizeAngle(current));
    return current + Math.max(0, turns) * TAU + forwardOffset;
  }

  function defaultState() {
    return { rows: [...DEFAULT_ROWS], history: [] };
  }

  function normalizeHistory(values) {
    if (!Array.isArray(values)) return [];
    return values.slice(0, MAX_HISTORY).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const label = normalizeLabel(value.label);
      const matching = Number(value.matching);
      const total = Number(value.total);
      if (!label || !Number.isInteger(matching) || !Number.isInteger(total)
        || matching < 1 || total < matching) return [];
      return [{ label, matching, total }];
    });
  }

  function normalizeState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("저장된 룰렛 형식이 올바르지 않습니다.");
    }
    return {
      rows: normalizeRows(value.rows),
      history: normalizeHistory(value.history),
    };
  }

  function loadState(storage) {
    const fallback = defaultState();
    if (!storage || typeof storage.getItem !== "function") return fallback;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const payload = JSON.parse(raw);
      if (!payload || payload.version !== STORAGE_VERSION) return fallback;
      return normalizeState(payload.state);
    } catch (_error) {
      return fallback;
    }
  }

  function saveState(storage, state) {
    if (!storage || typeof storage.setItem !== "function") return false;
    try {
      const normalized = normalizeState(state);
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state: normalized }));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function browserStorage() {
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function labelColor(label) {
    let hash = 0;
    for (const character of label) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    return COLORS[Math.abs(hash) % COLORS.length];
  }

  function fitCanvasText(context, text, maxWidth) {
    if (context.measureText(text).width <= maxWidth) return text;
    const characters = Array.from(text);
    while (characters.length > 1 && context.measureText(`${characters.join("")}…`).width > maxWidth) {
      characters.pop();
    }
    return `${characters.join("")}…`;
  }

  function initApp(doc = document, storage) {
    const elements = {
      entryList: doc.getElementById("entryList"),
      addEntry: doc.getElementById("addEntryButton"),
      clearEntries: doc.getElementById("clearEntriesButton"),
      sample: doc.getElementById("sampleButton"),
      slotCount: doc.getElementById("slotCount"),
      uniqueCount: doc.getElementById("uniqueCount"),
      duplicateSummary: doc.getElementById("duplicateSummary"),
      wheelCount: doc.getElementById("wheelCount"),
      wheelWrap: doc.getElementById("wheelWrap"),
      canvas: doc.getElementById("rouletteCanvas"),
      spin: doc.getElementById("spinButton"),
      spinLabel: doc.getElementById("spinButtonLabel"),
      resultCard: doc.getElementById("resultCard"),
      resultLead: doc.getElementById("resultLead"),
      resultLabel: doc.getElementById("resultLabel"),
      resultDetail: doc.getElementById("resultDetail"),
      historySection: doc.getElementById("historySection"),
      historyList: doc.getElementById("historyList"),
      clearHistory: doc.getElementById("clearHistoryButton"),
    };
    if (!elements.entryList || !elements.canvas) return;

    const plannerStorage = storage === undefined ? browserStorage() : storage;
    const stored = loadState(plannerStorage);
    const state = {
      rows: stored.rows,
      history: stored.history,
      entries: [],
      rotation: POINTER_ANGLE,
      spinning: false,
      result: null,
      canvasSize: 0,
    };
    const context = elements.canvas.getContext("2d");

    function persist() {
      saveState(plannerStorage, { rows: state.rows, history: state.history });
    }

    function drawEmptyWheel(size) {
      if (!context || !size) return;
      const center = size / 2;
      const radius = center - 14;
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(center, center);
      for (let index = 0; index < 12; index += 1) {
        const start = POINTER_ANGLE + index * TAU / 12;
        context.beginPath();
        context.moveTo(0, 0);
        context.arc(0, 0, radius, start, start + TAU / 12);
        context.closePath();
        context.fillStyle = index % 2 === 0 ? "#e7dfd1" : "#f4ecdf";
        context.fill();
        context.strokeStyle = "#fffaf0";
        context.lineWidth = 2;
        context.stroke();
      }
      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.strokeStyle = "#173b35";
      context.lineWidth = 4;
      context.stroke();
      context.restore();
    }

    function drawWheel() {
      const size = state.canvasSize;
      if (!context || !size) return;
      if (state.entries.length < 2) {
        drawEmptyWheel(size);
        return;
      }

      const center = size / 2;
      const radius = center - 14;
      const arc = TAU / state.entries.length;
      const fontSize = state.entries.length <= 6 ? 19 : state.entries.length <= 12 ? 15 : state.entries.length <= 24 ? 12 : 10;
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(center, center);

      state.entries.forEach((label, index) => {
        const start = state.rotation + index * arc;
        const end = start + arc;
        context.beginPath();
        context.moveTo(0, 0);
        context.arc(0, 0, radius, start, end);
        context.closePath();
        context.fillStyle = labelColor(label);
        context.fill();
        context.strokeStyle = "#fffaf0";
        context.lineWidth = state.entries.length > 30 ? 1 : 2;
        context.stroke();

        const middle = start + arc / 2;
        const angle = normalizeAngle(middle);
        const displayLabel = state.entries.length > 28 ? String(index + 1) : label;
        context.save();
        context.rotate(middle);
        context.fillStyle = "#fffdf6";
        context.font = `800 ${fontSize}px "Noto Sans KR", sans-serif`;
        context.textBaseline = "middle";
        context.shadowColor = "rgba(23, 59, 53, 0.28)";
        context.shadowBlur = 2;
        const labelRadius = radius * 0.88;
        const maxWidth = radius * (state.entries.length <= 8 ? 0.56 : 0.48);
        if (angle > Math.PI / 2 && angle < Math.PI * 1.5) {
          context.rotate(Math.PI);
          context.textAlign = "left";
          context.fillText(fitCanvasText(context, displayLabel, maxWidth), -labelRadius, 0, maxWidth);
        } else {
          context.textAlign = "right";
          context.fillText(fitCanvasText(context, displayLabel, maxWidth), labelRadius, 0, maxWidth);
        }
        context.restore();
      });

      context.beginPath();
      context.arc(0, 0, radius, 0, TAU);
      context.strokeStyle = "#173b35";
      context.lineWidth = 5;
      context.stroke();
      context.beginPath();
      context.arc(0, 0, radius * 0.16, 0, TAU);
      context.fillStyle = "#fffaf0";
      context.fill();
      context.strokeStyle = "#173b35";
      context.lineWidth = 3;
      context.stroke();
      context.restore();
    }

    function resizeCanvas() {
      const bounds = elements.canvas.getBoundingClientRect();
      const size = Math.max(1, Math.round(bounds.width));
      const ratio = Math.min(2, root.devicePixelRatio || 1);
      elements.canvas.width = Math.round(size * ratio);
      elements.canvas.height = Math.round(size * ratio);
      context?.setTransform(ratio, 0, 0, ratio, 0, 0);
      state.canvasSize = size;
      drawWheel();
    }

    function clearResult() {
      state.result = null;
      elements.resultCard.classList.remove("has-result");
      elements.resultLead.textContent = "아직 룰렛을 돌리지 않았어요.";
      elements.resultLabel.textContent = "—";
      elements.resultDetail.textContent = "선택지를 입력하고 가운데 버튼을 눌러주세요.";
    }

    function renderResult(result) {
      state.result = result;
      elements.resultCard.classList.remove("has-result");
      void elements.resultCard.offsetWidth;
      elements.resultCard.classList.add("has-result");
      elements.resultLead.textContent = "이번에 뽑힌 선택지는";
      elements.resultLabel.textContent = result.label;
      const percent = (result.matching / result.total * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
      elements.resultDetail.textContent = result.matching > 1
        ? `같은 이름 ${result.matching}칸 · 전체 ${result.total}칸 중 ${percent}%`
        : `전체 ${result.total}칸 중 한 칸 · 당첨 확률 ${percent}%`;
    }

    function renderHistory() {
      elements.historyList.replaceChildren();
      state.history.forEach((result, index) => {
        const item = doc.createElement("li");
        const number = doc.createElement("span");
        const label = doc.createElement("b");
        const chance = doc.createElement("small");
        number.textContent = String(index + 1).padStart(2, "0");
        label.textContent = result.label;
        chance.textContent = `${result.matching}/${result.total}칸`;
        item.append(number, label, chance);
        elements.historyList.append(item);
      });
      elements.historySection.hidden = state.history.length === 0;
    }

    function setControlsLocked(locked) {
      elements.entryList.querySelectorAll("input, button").forEach((control) => { control.disabled = locked; });
      elements.addEntry.disabled = locked || state.rows.length >= MAX_ROWS;
      elements.clearEntries.disabled = locked;
      elements.sample.disabled = locked;
      elements.clearHistory.disabled = locked;
    }

    function updateSummary() {
      state.entries = activeEntries(state.rows);
      const groups = entryGroups(state.rows);
      const duplicates = groups.filter((group) => group.count > 1);
      elements.slotCount.textContent = String(state.entries.length);
      elements.uniqueCount.textContent = String(groups.length);
      elements.wheelCount.textContent = `${state.entries.length} SLOT${state.entries.length === 1 ? "" : "S"}`;
      if (state.entries.length < 2) {
        elements.duplicateSummary.textContent = "두 개 이상 입력하면 룰렛이 만들어져요.";
      } else if (duplicates.length === 0) {
        elements.duplicateSummary.textContent = `중복 없음 · 모든 항목 ${Math.round(100 / state.entries.length)}%씩`;
      } else {
        elements.duplicateSummary.textContent = duplicates.map((group) => {
          const percent = (group.probability * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
          return `${group.label} ×${group.count}칸 (${percent}%)`;
        }).join(" · ");
      }
      elements.spin.disabled = state.spinning || state.entries.length < 2;
      elements.spinLabel.textContent = state.spinning ? "도는 중" : state.entries.length < 2 ? "2칸 필요" : "돌리기";
      elements.canvas.setAttribute(
        "aria-label",
        state.entries.length < 2
          ? "선택지를 두 개 이상 입력하면 룰렛이 표시됩니다."
          : `${state.entries.length}칸 룰렛. ${state.entries.slice(0, 20).join(", ")}${state.entries.length > 20 ? " 외" : ""}`,
      );
      drawWheel();
    }

    function entriesChanged() {
      clearResult();
      updateSummary();
      persist();
    }

    function addRow(afterIndex = state.rows.length - 1) {
      if (state.rows.length >= MAX_ROWS || state.spinning) return;
      const nextIndex = Math.min(state.rows.length, Math.max(0, afterIndex + 1));
      state.rows.splice(nextIndex, 0, "");
      renderRows(nextIndex);
      entriesChanged();
    }

    function removeRow(index) {
      if (state.spinning) return;
      if (state.rows.length === 1) state.rows[0] = "";
      else state.rows.splice(index, 1);
      renderRows(Math.min(index, state.rows.length - 1));
      entriesChanged();
    }

    function pasteRows(index, text) {
      const lines = text.split(/\r?\n/).map((line) => line.slice(0, MAX_LABEL_LENGTH)).filter((line) => line.trim());
      if (lines.length < 2) return false;
      const available = MAX_ROWS - state.rows.length + 1;
      state.rows.splice(index, 1, ...lines.slice(0, available));
      renderRows(Math.min(index + lines.length - 1, state.rows.length - 1));
      entriesChanged();
      return true;
    }

    function renderRows(focusIndex = -1) {
      elements.entryList.replaceChildren();
      state.rows.forEach((value, index) => {
        const item = doc.createElement("li");
        item.className = "entry-row";
        const number = doc.createElement("span");
        number.className = "entry-number";
        number.textContent = String(index + 1).padStart(2, "0");
        const input = doc.createElement("input");
        input.type = "text";
        input.maxLength = MAX_LABEL_LENGTH;
        input.value = value;
        input.placeholder = index === 0 ? "예: 치킨" : index === 1 ? "예: 피자" : "선택지를 입력하세요";
        input.setAttribute("aria-label", `${index + 1}번째 선택지`);
        input.disabled = state.spinning;
        input.addEventListener("input", () => {
          state.rows[index] = input.value;
          entriesChanged();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.isComposing) return;
          event.preventDefault();
          addRow(index);
        });
        input.addEventListener("paste", (event) => {
          const text = event.clipboardData?.getData("text") || "";
          if (!text.includes("\n")) return;
          event.preventDefault();
          pasteRows(index, text);
        });
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.className = "remove-button";
        remove.setAttribute("aria-label", `${index + 1}번째 선택지 삭제`);
        remove.textContent = "×";
        remove.disabled = state.spinning;
        remove.addEventListener("click", () => removeRow(index));
        item.append(number, input, remove);
        elements.entryList.append(item);
      });
      elements.addEntry.disabled = state.spinning || state.rows.length >= MAX_ROWS;
      if (focusIndex >= 0) elements.entryList.querySelectorAll("input")[focusIndex]?.focus();
    }

    function easeOutQuint(progress) {
      return 1 - (1 - progress) ** 5;
    }

    function spin() {
      if (state.spinning || state.entries.length < 2) return;
      const entries = [...state.entries];
      const winnerIndex = randomIndex(entries.length);
      const turns = 6 + randomIndex(3);
      const startRotation = state.rotation;
      const target = winningRotation(startRotation, winnerIndex, entries.length, turns);
      const reduceMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const duration = reduceMotion ? 420 : 4_300 + randomIndex(700);
      const startedAt = root.performance.now();
      state.spinning = true;
      elements.wheelWrap.classList.add("is-spinning");
      setControlsLocked(true);
      updateSummary();

      function frame(now) {
        const progress = Math.min(1, (now - startedAt) / duration);
        state.rotation = startRotation + (target - startRotation) * easeOutQuint(progress);
        drawWheel();
        if (progress < 1) {
          root.requestAnimationFrame(frame);
          return;
        }

        state.rotation = normalizeAngle(target);
        state.spinning = false;
        elements.wheelWrap.classList.remove("is-spinning");
        const label = entries[winnerIndex];
        const matching = entries.filter((entry) => entry === label).length;
        const result = { label, matching, total: entries.length };
        state.history.unshift(result);
        state.history = state.history.slice(0, MAX_HISTORY);
        renderResult(result);
        renderHistory();
        setControlsLocked(false);
        updateSummary();
        persist();
      }

      root.requestAnimationFrame(frame);
    }

    elements.addEntry.addEventListener("click", () => addRow());
    elements.clearEntries.addEventListener("click", () => {
      if (state.spinning) return;
      if (state.rows.some((row) => row.trim()) && !root.confirm("입력한 선택지를 모두 지울까요?")) return;
      state.rows = [...DEFAULT_ROWS];
      renderRows(0);
      entriesChanged();
    });
    elements.sample.addEventListener("click", () => {
      if (state.spinning) return;
      if (state.rows.some((row) => row.trim()) && !root.confirm("현재 선택지를 중복 예시로 바꿀까요?")) return;
      state.rows = [...SAMPLE_ROWS];
      renderRows(0);
      entriesChanged();
    });
    elements.spin.addEventListener("click", spin);
    elements.clearHistory.addEventListener("click", () => {
      state.history = [];
      renderHistory();
      persist();
    });

    if (typeof root.ResizeObserver === "function") {
      new root.ResizeObserver(resizeCanvas).observe(elements.canvas);
    } else {
      root.addEventListener("resize", resizeCanvas);
    }

    renderRows();
    renderHistory();
    clearResult();
    updateSummary();
    persist();
    root.requestAnimationFrame(resizeCanvas);
  }

  const api = {
    TAU,
    POINTER_ANGLE,
    MAX_ROWS,
    MAX_LABEL_LENGTH,
    MAX_HISTORY,
    STORAGE_KEY,
    STORAGE_VERSION,
    DEFAULT_ROWS,
    SAMPLE_ROWS,
    normalizeLabel,
    normalizeRows,
    activeEntries,
    entryGroups,
    probabilityForLabel,
    randomIndex,
    normalizeAngle,
    winningRotation,
    defaultState,
    normalizeState,
    loadState,
    saveState,
    initApp,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoulettePicker = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initApp(), { once: true });
    else initApp();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
