(function (root) {
  "use strict";

  const MAX_SERIES_LEVEL = 30;
  const EXTRA_LEVEL_EXP = 20_000;
  const MAX_EXTRA_LEVEL = 999;
  const STORAGE_KEY = "small-tools:pvp-series-calculator:v1";
  const STORAGE_VERSION = 1;
  const DEFAULT_STATE = Object.freeze({
    currentLevel: 1,
    currentExp: 0,
    currentExtraLevel: 0,
    targetMode: "level",
    targetLevel: 25,
    targetExtraLevel: 1,
    deadline: "",
  });
  const REWARDS = Object.freeze({
    crystalline: Object.freeze({ fast: 900, expected: 800, safe: 700 }),
    rivalWings: Object.freeze({ fast: 1_250, expected: 1_000, safe: 750 }),
    frontline: Object.freeze({ fast: 1_500, expected: 1_250, safe: 1_000 }),
    dailyFrontlineBonus: 1_500,
  });

  function integer(value, label) {
    const number = Number(value);
    if (!Number.isInteger(number)) throw new TypeError(`${label}은(는) 정수로 입력해 주세요.`);
    return number;
  }

  function expToNextLevel(levelValue) {
    const level = integer(levelValue, "시리즈 레벨");
    if (level < 1) throw new RangeError("시리즈 레벨은 1 이상이어야 합니다.");
    if (level <= 4) return 2_000;
    if (level <= 9) return 3_000;
    if (level <= 14) return 4_000;
    if (level <= 19) return 5_500;
    if (level <= 24) return 7_500;
    if (level <= 29) return 10_000;
    return EXTRA_LEVEL_EXP;
  }

  function cumulativeExpAtLevel(levelValue) {
    const level = integer(levelValue, "시리즈 레벨");
    if (level < 1 || level > MAX_SERIES_LEVEL) {
      throw new RangeError(`시리즈 레벨은 1부터 ${MAX_SERIES_LEVEL}까지 입력해 주세요.`);
    }
    let total = 0;
    for (let current = 1; current < level; current += 1) total += expToNextLevel(current);
    return total;
  }

  function normalizeProgress(value = {}) {
    const level = integer(value.level, "현재 레벨");
    if (level < 1 || level > MAX_SERIES_LEVEL) {
      throw new RangeError(`현재 레벨은 1부터 ${MAX_SERIES_LEVEL}까지 입력해 주세요.`);
    }
    const currentExp = integer(value.currentExp, "현재 경험치");
    const cap = expToNextLevel(level);
    if (currentExp < 0 || currentExp >= cap) {
      throw new RangeError(`현재 경험치는 0부터 ${cap - 1}까지 입력해 주세요.`);
    }
    const extraLevel = integer(value.extraLevel ?? 0, "완료한 추가 레벨");
    if (extraLevel < 0 || extraLevel > MAX_EXTRA_LEVEL) {
      throw new RangeError(`완료한 추가 레벨은 0부터 ${MAX_EXTRA_LEVEL}까지 입력해 주세요.`);
    }
    if (level < MAX_SERIES_LEVEL && extraLevel !== 0) {
      throw new RangeError("추가 레벨은 시리즈 레벨 30을 달성한 뒤 입력할 수 있습니다.");
    }
    return { level, currentExp, extraLevel: level === MAX_SERIES_LEVEL ? extraLevel : 0, cap };
  }

  function normalizeTarget(value = {}) {
    const mode = value.mode === "extra" ? "extra" : "level";
    if (mode === "extra") {
      const extraLevel = integer(value.extraLevel, "목표 추가 레벨");
      if (extraLevel < 1 || extraLevel > MAX_EXTRA_LEVEL) {
        throw new RangeError(`목표 추가 레벨은 1부터 ${MAX_EXTRA_LEVEL}까지 입력해 주세요.`);
      }
      return { mode, level: MAX_SERIES_LEVEL, extraLevel };
    }
    const level = integer(value.level, "목표 레벨");
    if (level < 2 || level > MAX_SERIES_LEVEL) {
      throw new RangeError(`목표 레벨은 2부터 ${MAX_SERIES_LEVEL}까지 입력해 주세요.`);
    }
    return { mode, level, extraLevel: 0 };
  }

  function progressTotal(progress) {
    const normalized = normalizeProgress(progress);
    return cumulativeExpAtLevel(normalized.level)
      + normalized.extraLevel * EXTRA_LEVEL_EXP
      + normalized.currentExp;
  }

  function targetTotal(target) {
    const normalized = normalizeTarget(target);
    return cumulativeExpAtLevel(normalized.level) + normalized.extraLevel * EXTRA_LEVEL_EXP;
  }

  function calculateSeriesProgress(progressValue, targetValue) {
    const progress = normalizeProgress(progressValue);
    const target = normalizeTarget(targetValue);
    const currentTotal = progressTotal(progress);
    const goalTotal = targetTotal(target);
    const remainingExp = Math.max(0, goalTotal - currentTotal);
    const progressPercent = goalTotal === 0
      ? 100
      : Math.max(0, Math.min(100, (currentTotal / goalTotal) * 100));
    return { progress, target, currentTotal, targetTotal: goalTotal, remainingExp, progressPercent };
  }

  function gamesForExp(expValue, rewardValue) {
    const exp = Number(expValue);
    const reward = Number(rewardValue);
    if (!Number.isFinite(exp) || exp < 0) throw new TypeError("남은 경험치는 0 이상의 숫자여야 합니다.");
    if (!Number.isFinite(reward) || reward <= 0) throw new TypeError("경기 보상은 0보다 커야 합니다.");
    return Math.ceil(exp / reward);
  }

  function estimateMode(remainingExp, rewards) {
    return {
      fast: gamesForExp(remainingExp, rewards.fast),
      expected: gamesForExp(remainingExp, rewards.expected),
      safe: gamesForExp(remainingExp, rewards.safe),
    };
  }

  function calculateMatchEstimates(remainingExp) {
    const dailyRewards = {
      fast: REWARDS.frontline.fast + REWARDS.dailyFrontlineBonus,
      expected: REWARDS.frontline.expected + REWARDS.dailyFrontlineBonus,
      safe: REWARDS.frontline.safe + REWARDS.dailyFrontlineBonus,
    };
    return {
      crystalline: estimateMode(remainingExp, REWARDS.crystalline),
      rivalWings: estimateMode(remainingExp, REWARDS.rivalWings),
      frontline: estimateMode(remainingExp, REWARDS.frontline),
      dailyFrontline: estimateMode(remainingExp, dailyRewards),
    };
  }

  function parseISODate(value, label) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const stamp = Date.UTC(year, month - 1, day);
    const date = new Date(stamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      throw new TypeError(`${label}이 올바른 날짜가 아닙니다.`);
    }
    return stamp;
  }

  function localISODate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function calendarDayDifference(deadlineISO, todayISO) {
    const deadline = parseISODate(deadlineISO, "마감일");
    const today = parseISODate(todayISO, "오늘 날짜");
    return Math.round((deadline - today) / 86_400_000);
  }

  function calculateDeadlinePlan(remainingExp, deadlineISO, todayISO = localISODate()) {
    const difference = calendarDayDifference(deadlineISO, todayISO);
    if (difference < 0) {
      return { status: "past", days: 0, difference, remainingExp };
    }
    const days = difference + 1;
    const estimates = calculateMatchEstimates(remainingExp);
    const dailyExp = Math.ceil(remainingExp / days);
    return {
      status: remainingExp === 0 ? "complete" : "active",
      days,
      difference,
      remainingExp,
      dailyExp,
      crystallinePerDay: gamesForExp(dailyExp, REWARDS.crystalline.expected),
      rivalWingsPerDay: gamesForExp(dailyExp, REWARDS.rivalWings.expected),
      dailyFrontlineDays: estimates.dailyFrontline.expected,
      dailyFrontlineFits: estimates.dailyFrontline.expected <= days,
    };
  }

  function formatNumber(value) {
    return Number(value).toLocaleString("ko-KR");
  }

  function describeProgress(progress) {
    if (progress.level < MAX_SERIES_LEVEL) return `현재 Lv.${progress.level}`;
    if (progress.extraLevel === 0) return "현재 Lv.30";
    return `현재 Lv.30 +${progress.extraLevel}`;
  }

  function describeTarget(target) {
    return target.mode === "extra" ? `목표 Lv.30 +${target.extraLevel}` : `목표 Lv.${target.level}`;
  }

  function defaultPlannerState() {
    return { ...DEFAULT_STATE };
  }

  function normalizePlannerState(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("저장된 입력 데이터 형식이 올바르지 않습니다.");
    }

    const progress = normalizeProgress({
      level: value.currentLevel ?? DEFAULT_STATE.currentLevel,
      currentExp: value.currentExp ?? DEFAULT_STATE.currentExp,
      extraLevel: value.currentExtraLevel ?? DEFAULT_STATE.currentExtraLevel,
    });
    const targetMode = value.targetMode ?? DEFAULT_STATE.targetMode;
    if (targetMode !== "level" && targetMode !== "extra") {
      throw new TypeError("저장된 목표 유형이 올바르지 않습니다.");
    }
    const targetLevel = integer(value.targetLevel ?? DEFAULT_STATE.targetLevel, "목표 레벨");
    if (targetLevel < 2 || targetLevel > MAX_SERIES_LEVEL) {
      throw new RangeError(`목표 레벨은 2부터 ${MAX_SERIES_LEVEL}까지 입력해 주세요.`);
    }
    const targetExtraLevel = integer(
      value.targetExtraLevel ?? DEFAULT_STATE.targetExtraLevel,
      "목표 추가 레벨",
    );
    if (targetExtraLevel < 1 || targetExtraLevel > MAX_EXTRA_LEVEL) {
      throw new RangeError(`목표 추가 레벨은 1부터 ${MAX_EXTRA_LEVEL}까지 입력해 주세요.`);
    }

    const deadline = value.deadline ?? DEFAULT_STATE.deadline;
    if (typeof deadline !== "string") throw new TypeError("저장된 마감일 형식이 올바르지 않습니다.");
    if (deadline) parseISODate(deadline, "마감일");

    return {
      currentLevel: progress.level,
      currentExp: progress.currentExp,
      currentExtraLevel: progress.extraLevel,
      targetMode,
      targetLevel,
      targetExtraLevel,
      deadline,
    };
  }

  function loadPlannerState(storage) {
    const fallback = defaultPlannerState();
    if (!storage || typeof storage.getItem !== "function") return fallback;

    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const payload = JSON.parse(raw);
      if (!payload || payload.version !== STORAGE_VERSION) return fallback;
      return normalizePlannerState(payload.state);
    } catch (_error) {
      return fallback;
    }
  }

  function savePlannerState(storage, state) {
    if (!storage || typeof storage.setItem !== "function") return false;

    try {
      const normalized = normalizePlannerState(state);
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

  function initApp(doc = document, storage) {
    const plannerStorage = storage === undefined ? browserStorage() : storage;
    const elements = {
      form: doc.getElementById("plannerForm"),
      currentLevel: doc.getElementById("currentLevelInput"),
      currentExp: doc.getElementById("currentExpInput"),
      currentExpLabel: doc.getElementById("currentExpLabel"),
      currentExpCap: doc.getElementById("currentExpCap"),
      currentExtraField: doc.getElementById("currentExtraField"),
      currentExtra: doc.getElementById("currentExtraInput"),
      targetLevelFields: doc.getElementById("targetLevelFields"),
      targetLevel: doc.getElementById("targetLevelInput"),
      targetExtraField: doc.getElementById("targetExtraField"),
      targetExtra: doc.getElementById("targetExtraInput"),
      deadline: doc.getElementById("deadlineInput"),
      clearDeadline: doc.getElementById("clearDeadlineButton"),
      reset: doc.getElementById("resetButton"),
      resultError: doc.getElementById("resultError"),
      resultContent: doc.getElementById("resultContent"),
      remainingExp: doc.getElementById("remainingExp"),
      resultMessage: doc.getElementById("resultMessage"),
      progressDial: doc.getElementById("progressDial"),
      progressPercent: doc.getElementById("progressPercent"),
      progressBar: doc.getElementById("progressBar"),
      currentSummary: doc.getElementById("currentSummary"),
      targetSummary: doc.getElementById("targetSummary"),
      ccFast: doc.getElementById("ccFast"),
      ccExpected: doc.getElementById("ccExpected"),
      ccSafe: doc.getElementById("ccSafe"),
      rwFast: doc.getElementById("rwFast"),
      rwExpected: doc.getElementById("rwExpected"),
      rwSafe: doc.getElementById("rwSafe"),
      flFast: doc.getElementById("flFast"),
      flExpected: doc.getElementById("flExpected"),
      flSafe: doc.getElementById("flSafe"),
      dailyRange: doc.getElementById("dailyRange"),
      dailyExpected: doc.getElementById("dailyExpected"),
      deadlineResult: doc.getElementById("deadlineResult"),
      deadlineDays: doc.getElementById("deadlineDays"),
      deadlineStatus: doc.getElementById("deadlineStatus"),
      paceGrid: doc.getElementById("paceGrid"),
      dailyExpPace: doc.getElementById("dailyExpPace"),
      ccDailyPace: doc.getElementById("ccDailyPace"),
      rwDailyPace: doc.getElementById("rwDailyPace"),
      dailyFlPace: doc.getElementById("dailyFlPace"),
    };

    if (!elements.form) return;

    for (let level = 1; level <= MAX_SERIES_LEVEL; level += 1) {
      elements.currentLevel.add(new Option(`레벨 ${level}`, String(level)));
    }
    for (let level = 2; level <= MAX_SERIES_LEVEL; level += 1) {
      elements.targetLevel.add(new Option(`레벨 ${level}`, String(level)));
    }

    const modeInputs = [...elements.form.querySelectorAll('input[name="targetMode"]')];
    const quickTargets = [...elements.form.querySelectorAll("[data-target-level]")];

    function selectedMode() {
      return modeInputs.find((input) => input.checked)?.value || "level";
    }

    function applyPlannerState(state) {
      elements.currentLevel.value = String(state.currentLevel);
      elements.currentExp.value = String(state.currentExp);
      elements.currentExtra.value = String(state.currentExtraLevel);
      modeInputs.forEach((input) => { input.checked = input.value === state.targetMode; });
      elements.targetLevel.value = String(state.targetLevel);
      elements.targetExtra.value = String(state.targetExtraLevel);
      elements.deadline.value = state.deadline;
    }

    function persistPlannerState() {
      savePlannerState(plannerStorage, {
        currentLevel: elements.currentLevel.value,
        currentExp: elements.currentExp.value,
        currentExtraLevel: elements.currentExtra.value,
        targetMode: selectedMode(),
        targetLevel: elements.targetLevel.value,
        targetExtraLevel: elements.targetExtra.value,
        deadline: elements.deadline.value,
      });
    }

    function clampCurrentExp() {
      const cap = expToNextLevel(elements.currentLevel.value);
      const value = Number(elements.currentExp.value);
      if (!Number.isFinite(value) || value < 0) elements.currentExp.value = "0";
      else if (value >= cap) elements.currentExp.value = String(cap - 1);
    }

    function updateControls(options = {}) {
      const level = Number(elements.currentLevel.value);
      const cap = expToNextLevel(level);
      elements.currentExp.max = String(cap - 1);
      elements.currentExpCap.textContent = `/ ${formatNumber(cap)}`;
      elements.currentExpLabel.textContent = level === MAX_SERIES_LEVEL
        ? "다음 추가 레벨 경험치"
        : "이 레벨에서 쌓은 경험치";
      elements.currentExtraField.hidden = level !== MAX_SERIES_LEVEL;
      if (level !== MAX_SERIES_LEVEL) elements.currentExtra.value = "0";
      if (options.clampExp) clampCurrentExp();

      const mode = selectedMode();
      elements.targetLevelFields.hidden = mode !== "level";
      elements.targetExtraField.hidden = mode !== "extra";
      quickTargets.forEach((button) => {
        const target = Number(button.dataset.targetLevel);
        button.disabled = target < level;
        button.classList.toggle("is-selected", mode === "level" && Number(elements.targetLevel.value) === target);
      });
    }

    function setCount(element, value, suffix = "") {
      element.textContent = `${formatNumber(value)}${suffix}`;
    }

    function renderDeadline(remainingExp) {
      const value = elements.deadline.value;
      elements.clearDeadline.hidden = !value;
      elements.deadlineResult.hidden = !value;
      if (!value) return;

      const plan = calculateDeadlinePlan(remainingExp, value);
      if (plan.status === "past") {
        elements.deadlineDays.textContent = "마감 지남";
        elements.deadlineStatus.textContent = "선택한 마감일이 이미 지났어요. 오늘 이후의 날짜를 골라주세요.";
        elements.paceGrid.hidden = true;
        return;
      }

      elements.paceGrid.hidden = false;
      elements.deadlineDays.textContent = `오늘 포함 ${formatNumber(plan.days)}일`;
      if (plan.status === "complete") {
        elements.deadlineStatus.textContent = "이미 목표에 도달했어요. 추가 플레이 계획이 필요하지 않습니다.";
      } else {
        elements.deadlineStatus.textContent = `${value}까지 매일 같은 속도로 진행한다고 가정한 계획이에요.`;
      }
      elements.dailyExpPace.textContent = `${formatNumber(plan.dailyExp)} EXP`;
      elements.ccDailyPace.textContent = `${formatNumber(plan.crystallinePerDay)}판씩`;
      elements.rwDailyPace.textContent = `${formatNumber(plan.rivalWingsPerDay)}판씩`;
      if (plan.dailyFrontlineFits) {
        elements.dailyFlPace.textContent = plan.dailyFrontlineDays === 0
          ? "추가 플레이 없음"
          : `균등 기준 ${formatNumber(plan.dailyFrontlineDays)}일`;
      } else {
        const shortage = plan.dailyFrontlineDays - plan.days;
        elements.dailyFlPace.textContent = `${formatNumber(shortage)}일 부족`;
      }
    }

    function render() {
      updateControls();
      try {
        const series = calculateSeriesProgress(
          {
            level: elements.currentLevel.value,
            currentExp: elements.currentExp.value,
            extraLevel: elements.currentExtra.value,
          },
          {
            mode: selectedMode(),
            level: elements.targetLevel.value,
            extraLevel: elements.targetExtra.value,
          },
        );
        const estimates = calculateMatchEstimates(series.remainingExp);
        const roundedProgress = Math.round(series.progressPercent);

        elements.resultError.hidden = true;
        elements.resultContent.hidden = false;
        elements.remainingExp.textContent = formatNumber(series.remainingExp);
        elements.resultMessage.textContent = series.remainingExp === 0
          ? "이미 선택한 목표에 도달했어요. 다음 목표를 정해보세요."
          : `${describeTarget(series.target)}까지 필요한 경험치예요.`;
        elements.progressDial.style.setProperty("--progress", String(series.progressPercent));
        elements.progressPercent.textContent = `${roundedProgress}%`;
        elements.progressBar.style.width = `${series.progressPercent}%`;
        elements.currentSummary.textContent = `${describeProgress(series.progress)} · ${formatNumber(series.progress.currentExp)} / ${formatNumber(series.progress.cap)}`;
        elements.targetSummary.textContent = describeTarget(series.target);

        setCount(elements.ccFast, estimates.crystalline.fast, "판");
        setCount(elements.ccExpected, estimates.crystalline.expected);
        setCount(elements.ccSafe, estimates.crystalline.safe, "판");
        setCount(elements.rwFast, estimates.rivalWings.fast, "판");
        setCount(elements.rwExpected, estimates.rivalWings.expected);
        setCount(elements.rwSafe, estimates.rivalWings.safe, "판");
        setCount(elements.flFast, estimates.frontline.fast, "판");
        setCount(elements.flExpected, estimates.frontline.expected);
        setCount(elements.flSafe, estimates.frontline.safe, "판");
        elements.dailyRange.textContent = estimates.dailyFrontline.fast === estimates.dailyFrontline.safe
          ? formatNumber(estimates.dailyFrontline.fast)
          : `${formatNumber(estimates.dailyFrontline.fast)}~${formatNumber(estimates.dailyFrontline.safe)}`;
        setCount(elements.dailyExpected, estimates.dailyFrontline.expected, "일");
        renderDeadline(series.remainingExp);

        quickTargets.forEach((button) => {
          button.classList.toggle(
            "is-selected",
            selectedMode() === "level" && Number(elements.targetLevel.value) === Number(button.dataset.targetLevel),
          );
        });
        persistPlannerState();
      } catch (error) {
        elements.resultContent.hidden = true;
        elements.resultError.hidden = false;
        elements.resultError.textContent = error.message || "입력값을 확인해 주세요.";
      }
    }

    function reset() {
      applyPlannerState(defaultPlannerState());
      updateControls({ clampExp: true });
      render();
    }

    elements.form.addEventListener("submit", (event) => event.preventDefault());
    elements.form.addEventListener("input", (event) => {
      if (event.target === elements.currentLevel) return;
      render();
    });
    elements.currentLevel.addEventListener("change", () => {
      updateControls({ clampExp: true });
      render();
    });
    elements.targetLevel.addEventListener("change", render);
    modeInputs.forEach((input) => input.addEventListener("change", () => {
      updateControls();
      render();
    }));
    quickTargets.forEach((button) => button.addEventListener("click", () => {
      const levelMode = modeInputs.find((input) => input.value === "level");
      levelMode.checked = true;
      elements.targetLevel.value = button.dataset.targetLevel;
      updateControls();
      render();
    }));
    elements.clearDeadline.addEventListener("click", () => {
      elements.deadline.value = "";
      render();
    });
    elements.reset.addEventListener("click", reset);

    applyPlannerState(loadPlannerState(plannerStorage));
    updateControls({ clampExp: true });
    render();
  }

  const api = {
    MAX_SERIES_LEVEL,
    EXTRA_LEVEL_EXP,
    MAX_EXTRA_LEVEL,
    STORAGE_KEY,
    STORAGE_VERSION,
    DEFAULT_STATE,
    REWARDS,
    expToNextLevel,
    cumulativeExpAtLevel,
    normalizeProgress,
    normalizeTarget,
    progressTotal,
    targetTotal,
    calculateSeriesProgress,
    gamesForExp,
    calculateMatchEstimates,
    localISODate,
    calendarDayDifference,
    calculateDeadlinePlan,
    formatNumber,
    describeProgress,
    describeTarget,
    defaultPlannerState,
    normalizePlannerState,
    loadPlannerState,
    savePlannerState,
    initApp,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PvpSeriesCalculator = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initApp(), { once: true });
    else initApp();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
