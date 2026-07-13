(function (root) {
  "use strict";

  const STATE_VERSION = 1;
  const STORAGE_KEY = "small-tools:habit-maker:v1";
  const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  const HABIT_TYPES = new Set(["check", "quantity"]);
  const DEFAULT_COLORS = ["#ef8354", "#4f7cac", "#57a773", "#8b6fc0", "#e0a93b", "#d45d79"];
  let idSequence = 0;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function parseLocalDate(value) {
    if (typeof value !== "string") throw new TypeError("날짜는 YYYY-MM-DD 문자열이어야 합니다.");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("날짜 형식은 YYYY-MM-DD여야 합니다.");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error("올바르지 않은 날짜입니다.");
    }
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error("올바르지 않은 날짜입니다.");
    }
    return date;
  }

  function formatLocalDate(value) {
    const date = value instanceof Date ? value : parseLocalDate(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("올바르지 않은 날짜입니다.");
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function localToday(now = new Date()) {
    return formatLocalDate(now);
  }

  function addLocalDays(value, amount) {
    if (!Number.isInteger(amount)) throw new TypeError("더할 날짜 수는 정수여야 합니다.");
    const date = value instanceof Date ? new Date(value.getTime()) : parseLocalDate(value);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + amount);
    return formatLocalDate(date);
  }

  function weekdayIndex(value) {
    const date = value instanceof Date ? value : parseLocalDate(value);
    return (date.getDay() + 6) % 7;
  }

  function parseMonthKey(value) {
    if (typeof value !== "string") throw new TypeError("월은 YYYY-MM 문자열이어야 합니다.");
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[1]) < 1000 || Number(match[2]) < 1 || Number(match[2]) > 12) {
      throw new Error("월 형식은 YYYY-MM이어야 합니다.");
    }
    return { year: Number(match[1]), month: Number(match[2]) };
  }

  function monthKey(value) {
    if (value instanceof Date) return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`;
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
    parseMonthKey(value);
    return value;
  }

  function addLocalMonths(value, amount) {
    if (!Number.isInteger(amount)) throw new TypeError("더할 월 수는 정수여야 합니다.");
    const { year, month } = parseMonthKey(value);
    const date = new Date(year, month - 1 + amount, 1, 12, 0, 0, 0);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function monthBounds(value) {
    const { year, month } = parseMonthKey(value);
    const first = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(year, month, 0, 12, 0, 0, 0).getDate();
    return { first, last: `${year}-${pad2(month)}-${pad2(lastDay)}` };
  }

  function buildMonthGrid(value) {
    const { first } = monthBounds(value);
    const start = addLocalDays(first, -weekdayIndex(first));
    return Array.from({ length: 42 }, (_unused, index) => {
      const date = addLocalDays(start, index);
      return {
        date,
        day: Number(date.slice(8, 10)),
        weekday: weekdayIndex(date),
        isCurrentMonth: date.slice(0, 7) === value,
      };
    });
  }

  function cleanText(value, label, maximum, fallback = "") {
    const text = String(value ?? "").trim();
    if (!text && !fallback) throw new Error(`${label}을 입력해 주세요.`);
    return (text || fallback).slice(0, maximum);
  }

  function normalizeWeekdays(value) {
    if (!Array.isArray(value)) throw new TypeError("반복 요일은 배열이어야 합니다.");
    const weekdays = [...new Set(value.map(Number))].sort((left, right) => left - right);
    if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error("반복 요일은 월요일 0부터 일요일 6 사이에서 하나 이상 골라야 합니다.");
    }
    return weekdays;
  }

  function createHabitId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    idSequence += 1;
    return `habit-${Date.now().toString(36)}-${idSequence.toString(36)}`;
  }

  function createHabit(input = {}, now = new Date()) {
    const type = String(input.type || "check");
    if (!HABIT_TYPES.has(type)) throw new Error("습관 종류는 check 또는 quantity여야 합니다.");
    const id = String(input.id || createHabitId()).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("습관 ID 형식이 올바르지 않습니다.");
    const targetNumber = type === "check" ? 1 : Number(input.target);
    if (!Number.isFinite(targetNumber) || targetNumber <= 0 || targetNumber > 1e9) {
      throw new Error("목표량은 0보다 큰 숫자여야 합니다.");
    }
    const color = String(input.color || DEFAULT_COLORS[0]).trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) throw new Error("색상은 #RRGGBB 형식이어야 합니다.");
    const createdOn = input.createdOn || localToday(now);
    parseLocalDate(createdOn);
    return {
      id,
      name: cleanText(input.name, "습관 이름", 40),
      type,
      unit: cleanText(input.unit, "단위", 12, type === "check" ? "회" : "회"),
      target: targetNumber,
      color,
      weekdays: normalizeWeekdays(input.weekdays ?? [0, 1, 2, 3, 4, 5, 6]),
      createdOn,
    };
  }

  function validateHabit(habit) {
    if (!habit || typeof habit !== "object" || Array.isArray(habit)) throw new TypeError("습관 데이터가 올바르지 않습니다.");
    const normalized = createHabit(habit);
    if (habit.type === "check" && Number(habit.target) !== 1) throw new Error("체크 습관의 목표값은 1이어야 합니다.");
    return normalized;
  }

  function calculateProgress(habit, amount) {
    const target = Number(habit?.target);
    const value = Number(amount);
    if (!Number.isFinite(target) || target <= 0) return 0;
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(value / target, 1);
  }

  function isHabitScheduled(habit, date) {
    parseLocalDate(date);
    if (!habit || date < habit.createdOn) return false;
    return habit.weekdays.includes(weekdayIndex(date));
  }

  function createEmptyState(now = new Date()) {
    const today = localToday(now);
    return {
      version: STATE_VERSION,
      habits: [],
      logs: {},
      settings: {
        currentMonth: today.slice(0, 7),
        selectedDate: today,
        currentView: "all",
      },
    };
  }

  function createDefaultState(now = new Date()) {
    const state = createEmptyState(now);
    const today = state.settings.selectedDate;
    const createdOn = `${today.slice(0, 7)}-01`;
    const habits = [
      createHabit({
        id: "water",
        name: "물 마시기",
        type: "quantity",
        unit: "잔",
        target: 8,
        color: "#4f7cac",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        createdOn,
      }, now),
      createHabit({
        id: "exercise",
        name: "운동하기",
        type: "check",
        unit: "회",
        target: 1,
        color: "#ef8354",
        weekdays: [0, 2, 4],
        createdOn,
      }, now),
      createHabit({
        id: "reading",
        name: "독서",
        type: "quantity",
        unit: "분",
        target: 30,
        color: "#57a773",
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        createdOn,
      }, now),
    ];
    state.habits = habits;
    return state;
  }

  function normalizeState(value, now = new Date()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("습관 데이터가 올바르지 않습니다.");
    if (value.version !== STATE_VERSION) throw new Error("지원하지 않는 습관 데이터 버전입니다.");
    if (!Array.isArray(value.habits) || value.habits.length > 100) throw new Error("습관 목록이 올바르지 않습니다.");
    const habits = value.habits.map(validateHabit);
    const ids = new Set();
    habits.forEach((habit) => {
      if (ids.has(habit.id)) throw new Error("중복된 습관 ID가 있습니다.");
      ids.add(habit.id);
    });

    if (!value.logs || typeof value.logs !== "object" || Array.isArray(value.logs)) {
      throw new Error("기록 데이터가 올바르지 않습니다.");
    }
    const logs = {};
    Object.entries(value.logs).forEach(([date, records]) => {
      parseLocalDate(date);
      if (!records || typeof records !== "object" || Array.isArray(records)) throw new Error("하루 기록이 올바르지 않습니다.");
      const normalizedRecords = {};
      Object.entries(records).forEach(([habitId, amount]) => {
        if (!ids.has(habitId)) throw new Error(`알 수 없는 습관 기록입니다: ${habitId}`);
        const number = Number(amount);
        if (!Number.isFinite(number) || number < 0 || number > 1e12) throw new Error("기록량은 0 이상의 숫자여야 합니다.");
        if (number > 0) normalizedRecords[habitId] = number;
      });
      if (Object.keys(normalizedRecords).length) logs[date] = normalizedRecords;
    });

    const today = localToday(now);
    const settings = value.settings && typeof value.settings === "object" && !Array.isArray(value.settings)
      ? value.settings
      : {};
    const currentMonth = settings.currentMonth || today.slice(0, 7);
    parseMonthKey(currentMonth);
    const selectedDate = settings.selectedDate || today;
    parseLocalDate(selectedDate);
    const currentView = settings.currentView === "all" || ids.has(settings.currentView)
      ? settings.currentView
      : "all";
    return {
      version: STATE_VERSION,
      habits,
      logs,
      settings: { currentMonth, selectedDate, currentView },
    };
  }

  function validateState(value, now = new Date()) {
    normalizeState(value, now);
    return true;
  }

  function serializeState(value) {
    return JSON.stringify(normalizeState(value), null, 2);
  }

  function importState(text, now = new Date()) {
    if (typeof text !== "string" || !text.trim()) throw new Error("가져올 JSON 데이터가 없습니다.");
    if (text.length > 2_000_000) throw new Error("가져올 파일이 너무 큽니다.");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_error) {
      throw new Error("JSON 파일을 읽을 수 없습니다.");
    }
    return normalizeState(parsed, now);
  }

  function findHabit(state, habitId) {
    const habit = state.habits.find((candidate) => candidate.id === habitId);
    if (!habit) throw new Error("습관을 찾을 수 없습니다.");
    return habit;
  }

  function getLogAmount(state, date, habitId) {
    return Number(state.logs?.[date]?.[habitId] || 0);
  }

  function setLogAmount(state, date, habitId, amount) {
    parseLocalDate(date);
    const habit = findHabit(state, habitId);
    if (date < habit.createdOn) throw new Error("습관을 만든 날보다 이전에는 기록할 수 없습니다.");
    let value = Number(amount);
    if (!Number.isFinite(value) || value < 0 || value > 1e12) throw new Error("기록량은 0 이상의 숫자여야 합니다.");
    if (habit.type === "check") value = value > 0 ? 1 : 0;
    if (!state.logs[date]) state.logs[date] = {};
    if (value > 0) state.logs[date][habitId] = value;
    else delete state.logs[date][habitId];
    if (!Object.keys(state.logs[date]).length) delete state.logs[date];
    return value;
  }

  function addHabit(state, input, now = new Date()) {
    const habit = createHabit(input, now);
    if (state.habits.some((candidate) => candidate.id === habit.id)) throw new Error("이미 존재하는 습관 ID입니다.");
    state.habits.push(habit);
    return habit;
  }

  function updateHabit(state, habitId, updates) {
    const index = state.habits.findIndex((habit) => habit.id === habitId);
    if (index < 0) throw new Error("습관을 찾을 수 없습니다.");
    const current = state.habits[index];
    const updated = createHabit({ ...current, ...updates, id: current.id, createdOn: current.createdOn });
    state.habits[index] = updated;
    return updated;
  }

  function removeHabit(state, habitId) {
    const index = state.habits.findIndex((habit) => habit.id === habitId);
    if (index < 0) return false;
    state.habits.splice(index, 1);
    Object.keys(state.logs).forEach((date) => {
      delete state.logs[date][habitId];
      if (!Object.keys(state.logs[date]).length) delete state.logs[date];
    });
    if (state.settings.currentView === habitId) state.settings.currentView = "all";
    return true;
  }

  function daySummary(state, date) {
    parseLocalDate(date);
    const details = state.habits
      .filter((habit) => isHabitScheduled(habit, date))
      .map((habit) => {
        const amount = getLogAmount(state, date, habit.id);
        const progress = calculateProgress(habit, amount);
        return { habit, amount, progress, completed: progress >= 1 };
      });
    const progress = details.length
      ? details.reduce((sum, detail) => sum + detail.progress, 0) / details.length
      : 0;
    return {
      date,
      scheduledCount: details.length,
      completedCount: details.filter((detail) => detail.completed).length,
      progress,
      completed: details.length > 0 && details.every((detail) => detail.completed),
      details,
    };
  }

  function effectiveMonthEnd(value, referenceDate) {
    const { first, last } = monthBounds(value);
    const reference = formatLocalDate(referenceDate instanceof Date ? referenceDate : parseLocalDate(referenceDate));
    if (reference < first) return null;
    return reference < last ? reference : last;
  }

  function eachDate(first, last, callback) {
    if (!last || first > last) return;
    for (let date = first; date <= last; date = addLocalDays(date, 1)) callback(date);
  }

  function calculateHabitStreaks(state, habit, endDate, referenceDate) {
    if (!endDate || endDate < habit.createdOn) return { currentStreak: 0, bestStreak: 0 };
    const today = formatLocalDate(referenceDate instanceof Date ? referenceDate : parseLocalDate(referenceDate));
    let currentStreak = 0;
    let bestStreak = 0;
    eachDate(habit.createdOn, endDate, (date) => {
      if (!isHabitScheduled(habit, date)) return;
      const progress = calculateProgress(habit, getLogAmount(state, date, habit.id));
      if (date === today && progress < 1) return;
      if (progress >= 1) {
        currentStreak += 1;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    });
    return { currentStreak, bestStreak };
  }

  function calculateMonthlyStats(state, habitId, value, referenceDate = new Date()) {
    const habit = findHabit(state, habitId);
    const { first } = monthBounds(value);
    const end = effectiveMonthEnd(value, referenceDate);
    const today = formatLocalDate(referenceDate instanceof Date ? referenceDate : parseLocalDate(referenceDate));
    let scheduledDays = 0;
    let completedScheduledDays = 0;
    let progressTotal = 0;
    eachDate(first, end, (date) => {
      if (!isHabitScheduled(habit, date)) return;
      const amount = getLogAmount(state, date, habit.id);
      if (date === today && amount <= 0) return;
      const progress = calculateProgress(habit, amount);
      scheduledDays += 1;
      progressTotal += progress;
      if (progress >= 1) completedScheduledDays += 1;
    });
    const streaks = calculateHabitStreaks(state, habit, end, referenceDate);
    return {
      habitId,
      month: value,
      scheduledDays,
      completedScheduledDays,
      completionRate: scheduledDays ? progressTotal / scheduledDays : 0,
      ...streaks,
    };
  }

  function calculateOverallMonthlyStats(state, value, referenceDate = new Date()) {
    const { first } = monthBounds(value);
    const end = effectiveMonthEnd(value, referenceDate);
    const today = formatLocalDate(referenceDate instanceof Date ? referenceDate : parseLocalDate(referenceDate));
    let scheduledDays = 0;
    let scheduledHabitDays = 0;
    let completedScheduledDays = 0;
    let progressTotal = 0;
    eachDate(first, end, (date) => {
      const summary = daySummary(state, date);
      if (!summary.scheduledCount) return;
      const eligibleDetails = date === today
        ? summary.details.filter((detail) => detail.amount > 0)
        : summary.details;
      if (!eligibleDetails.length) return;
      scheduledDays += 1;
      scheduledHabitDays += eligibleDetails.length;
      progressTotal += eligibleDetails.reduce((sum, detail) => sum + detail.progress, 0);
      if (summary.completed) completedScheduledDays += 1;
    });

    const createdDates = state.habits.map((habit) => habit.createdOn).sort();
    let currentStreak = 0;
    let bestStreak = 0;
    if (createdDates.length && end && createdDates[0] <= end) {
      eachDate(createdDates[0], end, (date) => {
        const summary = daySummary(state, date);
        if (!summary.scheduledCount) return;
        if (date === today && !summary.completed) return;
        if (summary.completed) {
          currentStreak += 1;
          bestStreak = Math.max(bestStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      });
    }
    return {
      month: value,
      scheduledDays,
      scheduledHabitDays,
      completedScheduledDays,
      completionRate: scheduledHabitDays ? progressTotal / scheduledHabitDays : 0,
      currentStreak,
      bestStreak,
    };
  }

  function formatMonthLabel(value) {
    const { year, month } = parseMonthKey(value);
    return `${year}년 ${month}월`;
  }

  function formatDateLabel(value) {
    const date = parseLocalDate(value);
    return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_LABELS[weekdayIndex(value)]}요일`;
  }

  async function renderHabitImage(state, value = state.settings.currentMonth, options = {}) {
    if (typeof document === "undefined") throw new Error("이미지는 브라우저에서만 만들 수 있습니다.");
    normalizeState(state);
    parseMonthKey(value);
    if (document.fonts) await document.fonts.ready;
    const scale = Number(options.scale) || 2;
    const width = 980;
    const height = 840;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.scale(scale, scale);
    context.fillStyle = "#f7f4ec";
    context.fillRect(0, 0, width, height);
    const activeHabit = state.habits.find((habit) => habit.id === state.settings.currentView) || null;
    const accentColor = activeHabit?.color || "#57a773";
    const viewName = activeHabit?.name || "종합";
    context.fillStyle = "#17221d";
    context.font = "700 32px sans-serif";
    context.fillText(options.title || `${viewName} 습관 달력`, 48, 58);
    context.font = "500 18px sans-serif";
    context.fillStyle = "#66706b";
    context.fillText(formatMonthLabel(value), 48, 91);

    const grid = buildMonthGrid(value);
    const gridX = 48;
    const gridY = 138;
    const cellWidth = (width - 96) / 7;
    const cellHeight = 88;
    WEEKDAY_LABELS.forEach((label, index) => {
      context.fillStyle = index >= 5 ? "#b35c4d" : "#66706b";
      context.font = "700 15px sans-serif";
      context.textAlign = "center";
      context.fillText(label, gridX + cellWidth * (index + 0.5), 125);
    });
    grid.forEach((cell, index) => {
      const column = index % 7;
      const row = Math.floor(index / 7);
      const x = gridX + column * cellWidth;
      const y = gridY + row * cellHeight;
      context.fillStyle = cell.isCurrentMonth ? "#ffffff" : "#eeeae1";
      context.strokeStyle = "#d8d4ca";
      context.lineWidth = 1;
      context.fillRect(x, y, cellWidth - 4, cellHeight - 4);
      context.strokeRect(x, y, cellWidth - 4, cellHeight - 4);
      if (cell.date === localToday()) {
        context.strokeStyle = accentColor;
        context.lineWidth = 2;
        context.strokeRect(x + 1, y + 1, cellWidth - 6, cellHeight - 6);
      }
      context.textAlign = "left";
      context.font = "600 14px sans-serif";
      context.fillStyle = cell.isCurrentMonth ? "#26332d" : "#a7aaa7";
      context.fillText(String(cell.day), x + 10, y + 20);
      const summary = state.settings.currentView === "all"
        ? daySummary(state, cell.date)
        : (() => {
          const habit = state.habits.find((candidate) => candidate.id === state.settings.currentView);
          const progress = habit && isHabitScheduled(habit, cell.date)
            ? calculateProgress(habit, getLogAmount(state, cell.date, habit.id))
            : 0;
          return { progress, scheduledCount: habit && isHabitScheduled(habit, cell.date) ? 1 : 0 };
        })();
      if (cell.isCurrentMonth && summary.scheduledCount) {
        context.fillStyle = "#e4e7e3";
        context.fillRect(x + 10, y + 57, cellWidth - 24, 8);
        context.fillStyle = accentColor;
        context.fillRect(x + 10, y + 57, (cellWidth - 24) * summary.progress, 8);
      }
    });

    context.textAlign = "left";
    context.font = "500 14px sans-serif";
    context.fillStyle = "#66706b";
    const names = activeHabit ? activeHabit.name : state.habits.map((habit) => habit.name).join(" · ");
    context.fillText(names.slice(0, 105), 48, 722);
    const stats = state.settings.currentView === "all"
      ? calculateOverallMonthlyStats(state, value)
      : calculateMonthlyStats(state, state.settings.currentView, value);
    context.font = "700 16px sans-serif";
    context.fillStyle = "#26332d";
    context.fillText(`달성률 ${Math.round(stats.completionRate * 100)}%`, 48, 760);
    context.fillText(`완료 ${stats.completedScheduledDays}일`, 220, 760);
    context.fillText(`현재 ${stats.currentStreak}회 · 최장 ${stats.bestStreak}회`, 370, 760);
    context.textAlign = "right";
    context.fillText(`${formatDateLabel(localToday())} 기준 · 작은 도구함`, width - 48, 790);
    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG 이미지를 만들지 못했습니다.")), "image/png");
    });
  }

  function initApp() {
    const byId = (id) => document.getElementById(id);
    const elements = {
      currentMonthLabel: byId("currentMonthLabel"),
      calendarGrid: byId("calendarGrid"),
      habitTabs: byId("habitTabs"),
      dayRecords: byId("dayRecords"),
      selectedDateLabel: byId("selectedDateLabel"),
      prevMonth: byId("prevMonthButton") || byId("previousMonthButton"),
      nextMonth: byId("nextMonthButton"),
      today: byId("todayButton"),
      addHabit: byId("addHabitButton"),
      editHabit: byId("editHabitButton"),
      modal: byId("habitModal"),
      form: byId("habitForm"),
      modalTitle: byId("habitModalTitle"),
      habitId: byId("habitIdInput"),
      habitName: byId("habitNameInput"),
      habitType: byId("habitTypeSelect"),
      habitUnit: byId("habitUnitInput"),
      habitTarget: byId("habitTargetInput"),
      habitColor: byId("habitColorInput"),
      quantityFields: byId("quantityFields"),
      saveHabit: byId("saveHabitButton"),
      closeModal: byId("closeHabitModalButton") || byId("closeHabitModal"),
      cancelModal: byId("cancelHabitButton"),
      deleteHabit: byId("deleteHabitButton"),
      exportJson: byId("exportDataButton") || byId("exportJsonButton") || byId("exportButton"),
      importJson: byId("importDataButton") || byId("importJsonButton") || byId("importButton"),
      importFile: byId("importDataInput") || byId("importFileInput") || byId("jsonFileInput"),
      reset: byId("resetDataButton") || byId("resetButton"),
      png: byId("exportImageButton") || byId("exportPngButton") || byId("pngButton") || byId("imageButton"),
      completionRate: byId("monthlyRate") || byId("completionRate"),
      completedDays: byId("completedScheduledDays") || byId("completedDays"),
      currentStreak: byId("currentStreak"),
      bestStreak: byId("bestStreak"),
      toast: byId("toast"),
      formStatus: byId("habitFormStatus"),
    };
    if (!elements.currentMonthLabel || !elements.calendarGrid || !elements.habitTabs || !elements.dayRecords) return;

    let state;
    let storageLoadFailed = false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      state = stored ? importState(stored) : createDefaultState();
    } catch (_error) {
      storageLoadFailed = true;
      state = createDefaultState();
    }
    let toastTimer;
    let renderedToday = localToday();

    function showToast(message) {
      if (!elements.toast) return;
      clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList.add("show");
      toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 1800);
    }

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, serializeState(state));
      } catch (_error) {
        showToast("브라우저에 자동 저장하지 못했어요");
      }
    }

    function refreshForNewDay() {
      const nextToday = localToday();
      if (nextToday === renderedToday) return;
      const wasFollowingToday = state.settings.selectedDate === renderedToday;
      renderedToday = nextToday;
      if (wasFollowingToday) {
        state.settings.selectedDate = nextToday;
        state.settings.currentMonth = nextToday.slice(0, 7);
        save();
      }
      render();
    }

    function renderTabs() {
      elements.habitTabs.replaceChildren();
      const tabs = [{ id: "all", name: "종합", color: "#26332d" }, ...state.habits];
      tabs.forEach((habit) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "habit-tab";
        if (state.settings.currentView === habit.id) button.classList.add("is-active");
        button.dataset.habitId = habit.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(state.settings.currentView === habit.id));
        button.setAttribute("aria-controls", "calendarGrid");
        button.tabIndex = state.settings.currentView === habit.id ? 0 : -1;
        button.style.setProperty("--habit-color", habit.color);
        const dot = document.createElement("span");
        dot.className = habit.id === "all" ? "tab-dot all-dot" : "tab-dot";
        dot.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = habit.name;
        button.append(dot, label);
        button.addEventListener("click", () => {
          state.settings.currentView = habit.id;
          render();
          save();
        });
        elements.habitTabs.append(button);
      });
      if (elements.editHabit) elements.editHabit.disabled = state.settings.currentView === "all";
    }

    function progressForCell(date) {
      if (state.settings.currentView === "all") return daySummary(state, date);
      const habit = state.habits.find((candidate) => candidate.id === state.settings.currentView);
      if (!habit || !isHabitScheduled(habit, date)) return { progress: 0, scheduledCount: 0, completed: false };
      const progress = calculateProgress(habit, getLogAmount(state, date, habit.id));
      return { progress, scheduledCount: 1, completed: progress >= 1 };
    }

    function renderCalendar() {
      elements.currentMonthLabel.textContent = formatMonthLabel(state.settings.currentMonth);
      const activeHabit = state.habits.find((habit) => habit.id === state.settings.currentView);
      const accentColor = activeHabit?.color || DEFAULT_COLORS[0];
      const weekdayHeader = elements.calendarGrid.querySelector(".calendar-weekdays");
      elements.calendarGrid.replaceChildren();
      if (weekdayHeader) elements.calendarGrid.append(weekdayHeader);
      if (!state.habits.length) {
        const empty = document.createElement("div");
        empty.className = "calendar-empty";
        empty.setAttribute("role", "status");
        const mark = document.createElement("span");
        mark.className = "empty-calendar-mark";
        mark.setAttribute("aria-hidden", "true");
        mark.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
        const title = document.createElement("strong");
        title.textContent = "첫 습관을 기다리고 있어요";
        const description = document.createElement("p");
        description.textContent = "새 습관을 만들면 매일의 성취가 이 달력에 차곡차곡 쌓입니다.";
        empty.append(mark, title, description);
        elements.calendarGrid.append(empty);
        return;
      }
      buildMonthGrid(state.settings.currentMonth).forEach((cell) => {
        const summary = progressForCell(cell.date);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "calendar-day";
        if (!cell.isCurrentMonth) button.classList.add("outside-month", "is-outside");
        if (cell.date === state.settings.selectedDate) button.classList.add("selected", "is-selected");
        if (cell.date === localToday()) button.classList.add("today", "is-today");
        if (summary.completed) button.classList.add("completed", "is-complete");
        else if (summary.progress > 0) button.classList.add("partial", "is-partial");
        button.dataset.date = cell.date;
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-selected", String(cell.date === state.settings.selectedDate));
        button.dataset.today = String(cell.date === localToday());
        button.dataset.outside = String(!cell.isCurrentMonth);
        button.dataset.status = summary.completed ? "complete" : summary.progress > 0 ? "partial" : "empty";
        button.style.setProperty("--habit-color", accentColor);
        button.style.setProperty("--habit-soft", `color-mix(in srgb, ${accentColor} 18%, white)`);
        button.style.setProperty("--progress", `${summary.progress * 100}%`);
        button.style.setProperty("--day-progress", `${summary.progress * 100}%`);
        button.setAttribute("aria-label", `${formatDateLabel(cell.date)}, 달성률 ${Math.round(summary.progress * 100)}%`);
        const number = document.createElement("span");
        number.className = "day-number";
        number.textContent = String(cell.day);
        const bar = document.createElement("span");
        bar.className = "day-progress";
        bar.setAttribute("aria-hidden", "true");
        const fill = document.createElement("span");
        bar.append(fill);
        button.append(number, bar);
        button.addEventListener("click", () => {
          state.settings.selectedDate = cell.date;
          if (!cell.isCurrentMonth) state.settings.currentMonth = cell.date.slice(0, 7);
          render();
          save();
        });
        elements.calendarGrid.append(button);
      });
    }

    function recordHabitCard(habit, date) {
      const amount = getLogAmount(state, date, habit.id);
      const progress = calculateProgress(habit, amount);
      const card = document.createElement("article");
      card.className = "day-record";
      card.style.setProperty("--habit-color", habit.color);
      const heading = document.createElement("div");
      heading.className = "record-heading";
      const name = document.createElement("strong");
      name.textContent = habit.name;
      const status = document.createElement("span");
      status.className = "record-progress";
      status.textContent = `${Math.round(progress * 100)}%`;
      heading.append(name, status);
      card.append(heading);

      if (habit.type === "check") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "check-record-button";
        button.setAttribute("aria-pressed", String(progress >= 1));
        button.textContent = progress >= 1 ? "완료 ✓" : "완료로 표시";
        button.addEventListener("click", () => {
          setLogAmount(state, date, habit.id, progress >= 1 ? 0 : 1);
          render();
          save();
        });
        card.append(button);
      } else {
        const controls = document.createElement("div");
        controls.className = "quantity-controls";
        const minus = document.createElement("button");
        minus.type = "button";
        minus.textContent = "−";
        minus.setAttribute("aria-label", `${habit.name} 1${habit.unit} 줄이기`);
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "1";
        input.value = String(amount);
        input.setAttribute("aria-label", `${habit.name} 기록량 (${habit.unit})`);
        const unit = document.createElement("span");
        unit.textContent = `/ ${habit.target}${habit.unit}`;
        const plus = document.createElement("button");
        plus.type = "button";
        plus.textContent = "+";
        plus.setAttribute("aria-label", `${habit.name} 1${habit.unit} 늘리기`);
        const apply = (value) => {
          setLogAmount(state, date, habit.id, Math.max(0, value));
          render();
          save();
        };
        minus.addEventListener("click", () => apply(amount - 1));
        plus.addEventListener("click", () => apply(amount + 1));
        input.addEventListener("change", () => apply(Number(input.value) || 0));
        controls.append(minus, input, unit, plus);
        card.append(controls);
      }
      return card;
    }

    function renderDayRecords() {
      const date = state.settings.selectedDate;
      if (elements.selectedDateLabel) elements.selectedDateLabel.textContent = formatDateLabel(date);
      elements.dayRecords.replaceChildren();
      if (!state.habits.length) {
        const empty = document.createElement("p");
        empty.className = "empty-records";
        empty.textContent = "새 습관을 만들고 오늘의 첫 기록을 남겨보세요.";
        elements.dayRecords.append(empty);
        return;
      }
      if (date > localToday()) {
        const future = document.createElement("p");
        future.className = "empty-records future-records";
        future.textContent = "미래 날짜는 아직 기록할 수 없어요. 그날 다시 만나요.";
        elements.dayRecords.append(future);
        return;
      }
      let habits = state.habits.filter((habit) => isHabitScheduled(habit, date));
      if (state.settings.currentView !== "all") {
        habits = habits.filter((habit) => habit.id === state.settings.currentView);
      }
      if (!habits.length) {
        const empty = document.createElement("p");
        empty.className = "empty-records";
        empty.textContent = "이날 예정된 습관이 없어요. 편하게 쉬어도 좋아요.";
        elements.dayRecords.append(empty);
        return;
      }
      habits.forEach((habit) => elements.dayRecords.append(recordHabitCard(habit, date)));
    }

    function renderStats() {
      const stats = state.settings.currentView === "all"
        ? calculateOverallMonthlyStats(state, state.settings.currentMonth)
        : calculateMonthlyStats(state, state.settings.currentView, state.settings.currentMonth);
      if (elements.completionRate) elements.completionRate.textContent = `${Math.round(stats.completionRate * 100)}%`;
      if (elements.completedDays) elements.completedDays.textContent = String(stats.completedScheduledDays);
      if (elements.currentStreak) elements.currentStreak.textContent = String(stats.currentStreak);
      if (elements.bestStreak) elements.bestStreak.textContent = String(stats.bestStreak);
    }

    function render() {
      renderTabs();
      renderCalendar();
      renderDayRecords();
      renderStats();
    }

    function updateQuantityFields() {
      if (!elements.quantityFields || !elements.habitType) return;
      const isQuantity = elements.habitType.value === "quantity";
      elements.quantityFields.hidden = !isQuantity;
      if (elements.habitTarget) elements.habitTarget.required = isQuantity;
      if (elements.habitUnit) elements.habitUnit.required = isQuantity;
    }

    function openHabitModal(habit = null) {
      if (!elements.modal || !elements.form) return;
      elements.form.reset();
      if (elements.modalTitle) elements.modalTitle.textContent = habit ? "습관 수정" : "새 습관";
      if (elements.habitId) elements.habitId.value = habit?.id || "";
      if (elements.habitName) elements.habitName.value = habit?.name || "";
      if (elements.habitType) elements.habitType.value = habit?.type || "check";
      if (elements.habitUnit) elements.habitUnit.value = habit?.unit || "회";
      if (elements.habitTarget) elements.habitTarget.value = String(habit?.target || 1);
      if (elements.habitColor) elements.habitColor.value = habit?.color || DEFAULT_COLORS[state.habits.length % DEFAULT_COLORS.length];
      document.querySelectorAll('input[name="habitWeekday"]').forEach((checkbox) => {
        checkbox.checked = habit ? habit.weekdays.includes(Number(checkbox.value)) : true;
      });
      if (elements.deleteHabit) elements.deleteHabit.hidden = !habit;
      if (elements.formStatus) elements.formStatus.textContent = "";
      updateQuantityFields();
      if (typeof elements.modal.showModal === "function") {
        if (!elements.modal.open) elements.modal.showModal();
      } else {
        elements.modal.hidden = false;
      }
      elements.habitName?.focus();
    }

    function closeHabitModal() {
      if (!elements.modal) return;
      if (typeof elements.modal.close === "function" && elements.modal.open) elements.modal.close();
      else elements.modal.hidden = true;
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    elements.prevMonth?.addEventListener("click", () => {
      state.settings.currentMonth = addLocalMonths(state.settings.currentMonth, -1);
      state.settings.selectedDate = `${state.settings.currentMonth}-01`;
      render();
      save();
    });
    elements.nextMonth?.addEventListener("click", () => {
      state.settings.currentMonth = addLocalMonths(state.settings.currentMonth, 1);
      state.settings.selectedDate = `${state.settings.currentMonth}-01`;
      render();
      save();
    });
    elements.today?.addEventListener("click", () => {
      const today = localToday();
      state.settings.currentMonth = today.slice(0, 7);
      state.settings.selectedDate = today;
      render();
      save();
    });
    elements.addHabit?.addEventListener("click", () => openHabitModal());
    elements.editHabit?.addEventListener("click", () => {
      if (state.settings.currentView !== "all") openHabitModal(findHabit(state, state.settings.currentView));
    });
    elements.closeModal?.addEventListener("click", closeHabitModal);
    elements.cancelModal?.addEventListener("click", closeHabitModal);
    elements.modal?.addEventListener("click", (event) => {
      if (event.target === elements.modal) closeHabitModal();
    });
    elements.habitType?.addEventListener("change", updateQuantityFields);
    elements.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const weekdays = Array.from(document.querySelectorAll('input[name="habitWeekday"]:checked'), (input) => Number(input.value));
        const type = elements.habitType?.value || "check";
        const values = {
          name: elements.habitName?.value,
          type,
          unit: type === "check" ? "회" : elements.habitUnit?.value,
          target: type === "check" ? 1 : Number(elements.habitTarget?.value),
          color: elements.habitColor?.value,
          weekdays,
        };
        const id = elements.habitId?.value;
        if (id) {
          const current = findHabit(state, id);
          const scheduleChanged = current.type !== values.type
            || current.target !== values.target
            || current.unit !== values.unit
            || JSON.stringify(current.weekdays) !== JSON.stringify(values.weekdays);
          if (scheduleChanged && !confirm("기록 방식·목표·요일 변경은 지난 통계에도 새 설정으로 반영됩니다. 계속할까요?")) {
            return;
          }
          updateHabit(state, id, values);
        } else {
          const habit = addHabit(state, { ...values, createdOn: localToday() });
          state.settings.currentView = habit.id;
        }
        closeHabitModal();
        render();
        save();
        showToast(id ? "습관을 수정했어요" : "새 습관을 추가했어요");
      } catch (error) {
        if (elements.formStatus) elements.formStatus.textContent = error.message || "습관을 저장하지 못했어요";
        showToast(error.message || "습관을 저장하지 못했어요");
      }
    });
    elements.deleteHabit?.addEventListener("click", () => {
      const id = elements.habitId?.value;
      if (!id || !confirm("이 습관과 모든 기록을 삭제할까요?")) return;
      removeHabit(state, id);
      closeHabitModal();
      render();
      save();
      showToast("습관을 삭제했어요");
    });
    elements.exportJson?.addEventListener("click", () => {
      downloadBlob(
        new Blob([serializeState(state)], { type: "application/json;charset=utf-8" }),
        `ggujunpyo-backup-${localToday()}.json`,
      );
      showToast("JSON 백업 파일을 저장했어요");
    });
    elements.importJson?.addEventListener("click", () => elements.importFile?.click());
    elements.importFile?.addEventListener("change", async () => {
      const file = elements.importFile.files?.[0];
      if (!file) return;
      try {
        const imported = importState(await file.text());
        if (!confirm("현재 습관과 기록을 백업 파일의 내용으로 바꿀까요?")) return;
        state = imported;
        render();
        save();
        showToast("습관과 기록을 불러왔어요");
      } catch (error) {
        showToast(error.message || "JSON을 불러오지 못했어요");
      } finally {
        elements.importFile.value = "";
      }
    });
    elements.reset?.addEventListener("click", () => {
      if (!confirm("모든 습관과 기록을 초기화할까요?")) return;
      state = createEmptyState();
      render();
      save();
      showToast("모든 습관과 기록을 비웠어요");
    });
    elements.png?.addEventListener("click", async () => {
      elements.png.disabled = true;
      try {
        const blob = await renderHabitImage(state).then(canvasToBlob);
        downloadBlob(blob, `ggujunpyo-${state.settings.currentMonth}.png`);
        showToast("PNG 달력을 저장했어요");
      } catch (error) {
        showToast(error.message || "PNG를 만들지 못했어요");
      } finally {
        elements.png.disabled = false;
      }
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        state = importState(event.newValue);
        render();
        showToast("다른 탭에서 바뀐 기록을 불러왔어요");
      } catch (_error) {
        showToast("다른 탭의 기록을 불러오지 못했어요");
      }
    });
    window.addEventListener("focus", refreshForNewDay);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshForNewDay();
    });
    window.setInterval(refreshForNewDay, 60_000);

    render();
    if (storageLoadFailed) showToast("저장된 기록을 읽지 못해 기본 상태로 열었어요");
    else save();
  }

  const api = {
    STATE_VERSION,
    STORAGE_KEY,
    WEEKDAY_LABELS,
    parseLocalDate,
    formatLocalDate,
    localToday,
    addLocalDays,
    weekdayIndex,
    parseMonthKey,
    monthKey,
    addLocalMonths,
    monthBounds,
    buildMonthGrid,
    createHabit,
    validateHabit,
    calculateProgress,
    isHabitScheduled,
    createEmptyState,
    createDefaultState,
    normalizeState,
    validateState,
    serializeState,
    importState,
    getLogAmount,
    setLogAmount,
    addHabit,
    updateHabit,
    removeHabit,
    daySummary,
    calculateMonthlyStats,
    calculateOverallMonthlyStats,
    renderHabitImage,
    canvasToBlob,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.HabitMaker = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initApp);
    else initApp();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
