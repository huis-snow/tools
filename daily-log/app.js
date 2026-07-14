(function (root) {
  "use strict";

  const STATE_VERSION = 1;
  const STORAGE_KEY = "small-tools:daily-log:v1";
  const WEEKDAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  const MEAL_KEYS = ["breakfast", "lunch", "dinner", "snack"];
  const MEAL_LABELS = {
    breakfast: "아침",
    lunch: "점심",
    dinner: "저녁",
    snack: "간식",
  };
  const TEXT_LIMITS = {
    meal: 1_000,
    alcoholType: 200,
    alcoholAmount: 200,
    alcoholNote: 1_000,
    memo: 10_000,
  };
  const IMPORT_SIZE_LIMIT = 5_000_000;
  const activeApps = typeof WeakMap === "function" ? new WeakMap() : null;

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function parseDateKey(value) {
    if (typeof value !== "string") throw new TypeError("날짜는 YYYY-MM-DD 문자열이어야 합니다.");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error("날짜 형식은 YYYY-MM-DD여야 합니다.");
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error("올바르지 않은 날짜입니다.");
    }
    // 정오를 사용하면 DST 전환 지역에서도 날짜를 더할 때 전날/다음 날로 밀리지 않는다.
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error("올바르지 않은 날짜입니다.");
    }
    return date;
  }

  function toDateKey(value) {
    if (typeof value === "string") {
      parseDateKey(value);
      return value;
    }
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("올바르지 않은 날짜입니다.");
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }

  function localToday(now = new Date()) {
    return toDateKey(now);
  }

  function addDays(value, amount) {
    if (!Number.isInteger(amount)) throw new TypeError("더할 날짜 수는 정수여야 합니다.");
    const date = typeof value === "string" ? parseDateKey(value) : new Date(value.getTime());
    if (Number.isNaN(date.getTime())) throw new Error("올바르지 않은 날짜입니다.");
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + amount);
    return toDateKey(date);
  }

  function weekdayIndex(value) {
    const date = typeof value === "string" ? parseDateKey(value) : value;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error("올바르지 않은 날짜입니다.");
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
    if (value instanceof Date) return toDateKey(value).slice(0, 7);
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return toDateKey(value).slice(0, 7);
    parseMonthKey(value);
    return value;
  }

  function shiftMonth(value, amount) {
    if (!Number.isInteger(amount)) throw new TypeError("이동할 월 수는 정수여야 합니다.");
    const { year, month } = parseMonthKey(value);
    const date = new Date(year, month - 1 + amount, 1, 12, 0, 0, 0);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  function monthBounds(value) {
    const { year, month } = parseMonthKey(value);
    const lastDay = new Date(year, month, 0, 12, 0, 0, 0).getDate();
    return {
      first: `${year}-${pad2(month)}-01`,
      last: `${year}-${pad2(month)}-${pad2(lastDay)}`,
      days: lastDay,
    };
  }

  function buildCalendarDays(value) {
    const { first } = monthBounds(value);
    const start = addDays(first, -weekdayIndex(first));
    return Array.from({ length: 42 }, (_unused, index) => {
      const date = addDays(start, index);
      return {
        date,
        day: Number(date.slice(8, 10)),
        weekday: weekdayIndex(date),
        isCurrentMonth: date.slice(0, 7) === value,
      };
    });
  }

  function cleanText(value, label, maximum) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new TypeError(`${label}은 문자열이어야 합니다.`);
    const text = value.trim();
    if (text.length > maximum) throw new Error(`${label}은 ${maximum.toLocaleString("ko-KR")}자 이하여야 합니다.`);
    return text;
  }

  function timestamp(value, now) {
    if (value === undefined || value === null || value === "") return now.toISOString();
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("수정 시간이 올바르지 않습니다.");
    return new Date(value).toISOString();
  }

  function createEmptyRecord() {
    return {
      meals: { breakfast: "", lunch: "", dinner: "", snack: "" },
      alcohol: { drank: false, type: "", amount: "", note: "" },
      condition: 0,
      memo: "",
      updatedAt: "",
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isEmptyRecord(value) {
    if (!isPlainObject(value)) return true;
    const meals = isPlainObject(value.meals) ? value.meals : {};
    const hasMeal = MEAL_KEYS.some((key) => typeof meals[key] === "string" && meals[key].trim());
    const drank = isPlainObject(value.alcohol) && value.alcohol.drank === true;
    const condition = Number(value.condition || 0);
    const memo = typeof value.memo === "string" && value.memo.trim();
    return !hasMeal && !drank && condition === 0 && !memo;
  }

  function normalizeRecord(value = {}, now = new Date()) {
    if (!isPlainObject(value)) throw new TypeError("하루 기록이 올바르지 않습니다.");
    const mealsValue = value.meals === undefined ? {} : value.meals;
    if (!isPlainObject(mealsValue)) throw new TypeError("식사 기록이 올바르지 않습니다.");
    const meals = {};
    MEAL_KEYS.forEach((key) => {
      meals[key] = cleanText(mealsValue[key], `${MEAL_LABELS[key]} 기록`, TEXT_LIMITS.meal);
    });

    const alcoholValue = value.alcohol === undefined ? {} : value.alcohol;
    if (!isPlainObject(alcoholValue)) throw new TypeError("음주 기록이 올바르지 않습니다.");
    if (alcoholValue.drank !== undefined && typeof alcoholValue.drank !== "boolean") {
      throw new TypeError("음주 여부는 참/거짓 값이어야 합니다.");
    }
    const drank = alcoholValue.drank === true;
    const alcohol = drank
      ? {
        drank: true,
        type: cleanText(alcoholValue.type, "술 종류", TEXT_LIMITS.alcoholType),
        amount: cleanText(alcoholValue.amount, "음주량", TEXT_LIMITS.alcoholAmount),
        note: cleanText(alcoholValue.note, "음주 메모", TEXT_LIMITS.alcoholNote),
      }
      : { drank: false, type: "", amount: "", note: "" };

    const condition = value.condition === undefined || value.condition === null || value.condition === ""
      ? 0
      : Number(value.condition);
    if (!Number.isInteger(condition) || condition < 0 || condition > 5) {
      throw new Error("컨디션은 0부터 5 사이의 정수여야 합니다.");
    }
    const normalized = {
      meals,
      alcohol,
      condition,
      memo: cleanText(value.memo, "하루 메모", TEXT_LIMITS.memo),
      updatedAt: "",
    };
    if (!isEmptyRecord(normalized)) normalized.updatedAt = timestamp(value.updatedAt, now);
    return normalized;
  }

  function createEmptyState() {
    return { version: STATE_VERSION, records: {} };
  }

  function normalizeState(value, now = new Date()) {
    if (!isPlainObject(value)) throw new TypeError("하루 기록 데이터가 올바르지 않습니다.");
    if (value.version !== STATE_VERSION) throw new Error("지원하지 않는 하루 기록 데이터 버전입니다.");
    if (!isPlainObject(value.records)) throw new Error("날짜별 기록 목록이 올바르지 않습니다.");
    const entries = Object.entries(value.records);
    if (entries.length > 20_000) throw new Error("기록이 너무 많습니다.");
    const records = {};
    entries.forEach(([date, record]) => {
      parseDateKey(date);
      const normalized = normalizeRecord(record, now);
      if (!isEmptyRecord(normalized)) records[date] = normalized;
    });
    return { version: STATE_VERSION, records };
  }

  function validateState(value, now = new Date()) {
    normalizeState(value, now);
    return true;
  }

  function exportState(value) {
    return JSON.stringify(normalizeState(value), null, 2);
  }

  function importState(text, now = new Date()) {
    if (typeof text !== "string") throw new Error("가져올 JSON 데이터가 없습니다.");
    if (text.length > IMPORT_SIZE_LIMIT) throw new Error("가져올 파일이 너무 큽니다.");
    if (!text.trim()) throw new Error("가져올 JSON 데이터가 없습니다.");
    let value;
    try {
      value = JSON.parse(text);
    } catch (_error) {
      throw new Error("JSON 파일을 읽을 수 없습니다.");
    }
    return normalizeState(value, now);
  }

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      return root.localStorage;
    } catch (_error) {
      return null;
    }
  }

  async function prepareBrowserStorage(keys = [STORAGE_KEY]) {
    const fallback = resolveStorage();
    const vault = root.SmallToolsVault;
    if (!vault) return fallback;
    try {
      await vault.ready;
      if (typeof vault.migrateKeys !== "function") throw new Error("보관함 이전 기능을 사용할 수 없습니다.");
      await vault.migrateKeys(keys, { removeSource: true });
      if (!vault.storage || typeof vault.storage.getItem !== "function" || typeof vault.storage.setItem !== "function") {
        throw new Error("보관함 저장소를 사용할 수 없습니다.");
      }
      return vault.storage;
    } catch (_error) {
      return fallback;
    }
  }

  function loadState(storage, now = new Date()) {
    const target = resolveStorage(storage);
    if (!target || typeof target.getItem !== "function") return createEmptyState();
    const stored = target.getItem(STORAGE_KEY);
    return stored ? importState(stored, now) : createEmptyState();
  }

  function saveState(value, storage) {
    const normalized = normalizeState(value);
    const target = resolveStorage(storage);
    if (!target || typeof target.setItem !== "function") throw new Error("브라우저 저장소를 사용할 수 없습니다.");
    target.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function getRecord(state, date) {
    parseDateKey(date);
    const record = state?.records?.[date];
    return record ? normalizeRecord(record) : createEmptyRecord();
  }

  function upsertRecord(state, date, value, now = new Date()) {
    if (!isPlainObject(state) || !isPlainObject(state.records)) throw new TypeError("하루 기록 상태가 올바르지 않습니다.");
    parseDateKey(date);
    const normalized = normalizeRecord({ ...value, updatedAt: undefined }, now);
    if (isEmptyRecord(normalized)) {
      delete state.records[date];
      return null;
    }
    state.records[date] = normalized;
    return normalized;
  }

  function deleteRecord(state, date) {
    if (!isPlainObject(state) || !isPlainObject(state.records)) throw new TypeError("하루 기록 상태가 올바르지 않습니다.");
    parseDateKey(date);
    if (!Object.prototype.hasOwnProperty.call(state.records, date)) return false;
    delete state.records[date];
    return true;
  }

  function calculateMonthlyStats(state, value) {
    parseMonthKey(value);
    const normalized = normalizeState(state);
    const records = Object.entries(normalized.records).filter(([date]) => date.slice(0, 7) === value);
    let mealCount = 0;
    let drinkingDays = 0;
    let conditionTotal = 0;
    let conditionDays = 0;
    records.forEach(([_date, record]) => {
      mealCount += MEAL_KEYS.filter((key) => record.meals[key]).length;
      if (record.alcohol.drank) drinkingDays += 1;
      if (record.condition > 0) {
        conditionTotal += record.condition;
        conditionDays += 1;
      }
    });
    return {
      month: value,
      loggedDays: records.length,
      mealCount,
      drinkingDays,
      conditionDays,
      averageCondition: conditionDays ? conditionTotal / conditionDays : null,
    };
  }

  function formatMonthLabel(value) {
    const { year, month } = parseMonthKey(value);
    return `${year}년 ${month}월`;
  }

  function formatDateLabel(value) {
    const date = parseDateKey(value);
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAY_LABELS[weekdayIndex(date)]}요일`;
  }

  function dateForMonth(value, preferredDay) {
    const { days } = monthBounds(value);
    return `${value}-${pad2(Math.min(Math.max(Number(preferredDay) || 1, 1), days))}`;
  }

  function recordSummary(record) {
    if (isEmptyRecord(record)) return "아직 남긴 기록이 없어요";
    const parts = [];
    const meals = MEAL_KEYS.filter((key) => record.meals[key]).length;
    if (meals) parts.push(`식사 ${meals}개`);
    if (record.alcohol.drank) parts.push("음주 기록 있음");
    if (record.condition > 0) parts.push(`컨디션 ${record.condition}/5`);
    if (record.memo) parts.push("하루 메모 있음");
    return parts.join(" · ");
  }

  function initDailyLogApp(doc = root.document, options = {}) {
    if (!doc || typeof doc.getElementById !== "function") return null;
    if (activeApps?.has(doc)) return activeApps.get(doc);
    const byId = (id) => doc.getElementById(id);
    const elements = {
      monthLabel: byId("monthLabel"),
      form: byId("dailyLogForm"),
      prevMonth: byId("prevMonthButton"),
      nextMonth: byId("nextMonthButton"),
      today: byId("todayButton"),
      calendar: byId("calendarGrid"),
      selectedDateLabel: byId("selectedDateLabel"),
      selectedDateSummary: byId("selectedDateSummary"),
      breakfast: byId("breakfastInput"),
      lunch: byId("lunchInput"),
      dinner: byId("dinnerInput"),
      snack: byId("snackInput"),
      alcoholDrank: byId("alcoholDrankInput"),
      alcoholDetails: byId("alcoholDetails"),
      alcoholType: byId("alcoholTypeInput"),
      alcoholAmount: byId("alcoholAmountInput"),
      alcoholNote: byId("alcoholNoteInput"),
      memo: byId("memoInput"),
      saveStatus: byId("saveStatus"),
      clearDay: byId("clearDayButton"),
      loggedDays: byId("loggedDaysCount"),
      mealCount: byId("mealCount"),
      drinkingDays: byId("drinkingDaysCount"),
      averageCondition: byId("averageCondition"),
      exportButton: byId("exportButton"),
      importButton: byId("importButton"),
      importInput: byId("importInput"),
      toast: byId("toast"),
      conditionButtons: Array.from(doc.querySelectorAll?.("[data-condition]") || []),
    };
    if (!elements.monthLabel || !elements.calendar) return null;

    const storage = resolveStorage(options.storage);
    const getNow = typeof options.now === "function" ? options.now : () => options.now || new Date();
    const today = () => localToday(getNow());
    let state;
    let storageLoadFailed = false;
    try {
      state = loadState(storage, getNow());
    } catch (_error) {
      state = createEmptyState();
      storageLoadFailed = true;
    }
    let selectedDate = today();
    let currentMonth = selectedDate.slice(0, 7);
    let selectedCondition = 0;
    let saveTimer = null;
    let toastTimer = null;
    let destroyed = false;
    let saveGeneration = 0;

    function showToast(message) {
      if (!elements.toast) return;
      if (toastTimer !== null) root.clearTimeout?.(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList?.add("show");
      toastTimer = root.setTimeout?.(() => elements.toast.classList?.remove("show"), 2_000) ?? null;
    }

    function persistState() {
      try {
        state = saveState(state, storage);
        return true;
      } catch (_error) {
        showToast("브라우저에 자동 저장하지 못했어요");
        return false;
      }
    }

    function setSaveStatus(message) {
      if (elements.saveStatus) elements.saveStatus.textContent = message;
    }

    function readEditor() {
      return {
        meals: {
          breakfast: elements.breakfast?.value || "",
          lunch: elements.lunch?.value || "",
          dinner: elements.dinner?.value || "",
          snack: elements.snack?.value || "",
        },
        alcohol: {
          drank: Boolean(elements.alcoholDrank?.checked),
          type: elements.alcoholType?.value || "",
          amount: elements.alcoholAmount?.value || "",
          note: elements.alcoholNote?.value || "",
        },
        condition: selectedCondition,
        memo: elements.memo?.value || "",
      };
    }

    function syncAlcoholDetails() {
      const drank = Boolean(elements.alcoholDrank?.checked);
      if (elements.alcoholDetails) elements.alcoholDetails.hidden = !drank;
      [elements.alcoholType, elements.alcoholAmount, elements.alcoholNote].forEach((input) => {
        if (input) input.disabled = !drank;
      });
    }

    function syncConditionButtons() {
      elements.conditionButtons.forEach((button) => {
        const condition = Number(button.dataset?.condition);
        const pressed = condition > 0 && condition === selectedCondition;
        button.classList?.toggle("is-active", pressed);
        button.setAttribute?.("aria-pressed", String(pressed));
      });
    }

    function renderSelectedSummary() {
      const record = getRecord(state, selectedDate);
      if (elements.selectedDateLabel) elements.selectedDateLabel.textContent = formatDateLabel(selectedDate);
      if (elements.selectedDateSummary) elements.selectedDateSummary.textContent = recordSummary(record);
      if (elements.clearDay) elements.clearDay.disabled = isEmptyRecord(record);
    }

    function renderStats() {
      const stats = calculateMonthlyStats(state, currentMonth);
      if (elements.loggedDays) elements.loggedDays.textContent = String(stats.loggedDays);
      if (elements.mealCount) elements.mealCount.textContent = String(stats.mealCount);
      if (elements.drinkingDays) elements.drinkingDays.textContent = String(stats.drinkingDays);
      if (elements.averageCondition) {
        elements.averageCondition.textContent = stats.averageCondition === null
          ? "-"
          : stats.averageCondition.toFixed(1).replace(/\.0$/, "");
      }
    }

    function focusCalendarDate(date) {
      const button = doc.querySelector?.(`[data-date="${date}"]`);
      button?.focus?.();
    }

    function selectCalendarDate(date, focusAfterRender = false) {
      flushEditorSave();
      selectedDate = toDateKey(date);
      if (selectedDate.slice(0, 7) !== currentMonth) currentMonth = selectedDate.slice(0, 7);
      render();
      if (focusAfterRender) focusCalendarDate(selectedDate);
    }

    function calendarKeydown(event, date) {
      let target = null;
      if (event.key === "ArrowLeft") target = addDays(date, -1);
      else if (event.key === "ArrowRight") target = addDays(date, 1);
      else if (event.key === "ArrowUp") target = addDays(date, -7);
      else if (event.key === "ArrowDown") target = addDays(date, 7);
      else if (event.key === "Home") target = addDays(date, -weekdayIndex(date));
      else if (event.key === "End") target = addDays(date, 6 - weekdayIndex(date));
      else if (event.key === "PageUp") target = dateForMonth(shiftMonth(date.slice(0, 7), -1), Number(date.slice(8, 10)));
      else if (event.key === "PageDown") target = dateForMonth(shiftMonth(date.slice(0, 7), 1), Number(date.slice(8, 10)));
      if (!target) return;
      event.preventDefault?.();
      selectCalendarDate(target, true);
    }

    function renderCalendar() {
      elements.monthLabel.textContent = formatMonthLabel(currentMonth);
      elements.calendar.setAttribute?.("aria-label", `${formatMonthLabel(currentMonth)} 하루 기록 달력`);
      elements.calendar.replaceChildren();
      WEEKDAY_LABELS.forEach((label) => {
        const header = doc.createElement("span");
        header.className = "calendar-weekday";
        header.setAttribute?.("aria-hidden", "true");
        header.textContent = label;
        elements.calendar.append(header);
      });
      buildCalendarDays(currentMonth).forEach((cell) => {
        const record = getRecord(state, cell.date);
        const mealCount = MEAL_KEYS.filter((key) => record.meals[key]).length;
        const button = doc.createElement("button");
        button.type = "button";
        button.className = "calendar-day";
        button.dataset.date = cell.date;
        button.setAttribute?.("aria-pressed", String(cell.date === selectedDate));
        button.tabIndex = cell.date === selectedDate ? 0 : -1;
        if (!cell.isCurrentMonth) button.classList?.add("is-outside");
        if (cell.date === selectedDate) button.classList?.add("is-selected");
        if (cell.date === today()) {
          button.classList?.add("is-today");
          button.setAttribute?.("aria-current", "date");
        }
        if (!isEmptyRecord(record)) button.classList?.add("has-record");

        const number = doc.createElement("span");
        number.className = "calendar-day-number";
        number.textContent = String(cell.day);
        const marks = doc.createElement("span");
        marks.className = "calendar-day-marks";
        marks.setAttribute?.("aria-hidden", "true");
        if (mealCount) {
          const mark = doc.createElement("i");
          mark.className = "mark-meal";
          marks.append(mark);
        }
        if (record.alcohol.drank) {
          const mark = doc.createElement("i");
          mark.className = "mark-alcohol";
          marks.append(mark);
        }
        if (record.memo) {
          const mark = doc.createElement("i");
          mark.className = "mark-note";
          marks.append(mark);
        }
        const details = [];
        if (mealCount) details.push(`식사 ${mealCount}개`);
        if (record.alcohol.drank) details.push("음주");
        if (record.condition > 0) details.push(`컨디션 ${record.condition}점`);
        if (record.memo) details.push("메모");
        button.setAttribute?.("aria-label", `${formatDateLabel(cell.date)}${details.length ? `, ${details.join(", ")}` : ", 기록 없음"}`);
        button.append(number, marks);
        button.addEventListener?.("click", () => selectCalendarDate(cell.date));
        button.addEventListener?.("keydown", (event) => calendarKeydown(event, cell.date));
        elements.calendar.append(button);
      });
    }

    function renderEditor() {
      const record = getRecord(state, selectedDate);
      if (elements.breakfast) elements.breakfast.value = record.meals.breakfast;
      if (elements.lunch) elements.lunch.value = record.meals.lunch;
      if (elements.dinner) elements.dinner.value = record.meals.dinner;
      if (elements.snack) elements.snack.value = record.meals.snack;
      if (elements.alcoholDrank) elements.alcoholDrank.checked = record.alcohol.drank;
      if (elements.alcoholType) elements.alcoholType.value = record.alcohol.type;
      if (elements.alcoholAmount) elements.alcoholAmount.value = record.alcohol.amount;
      if (elements.alcoholNote) elements.alcoholNote.value = record.alcohol.note;
      if (elements.memo) elements.memo.value = record.memo;
      selectedCondition = record.condition;
      syncAlcoholDetails();
      syncConditionButtons();
      renderSelectedSummary();
    }

    function render() {
      if (destroyed) return;
      renderCalendar();
      renderEditor();
      renderStats();
    }

    function saveEditor() {
      if (destroyed) return;
      saveTimer = null;
      try {
        upsertRecord(state, selectedDate, readEditor(), getNow());
        const saved = persistState();
        const generation = ++saveGeneration;
        if (!saved) {
          setSaveStatus("저장 실패");
        } else if (storage === root.SmallToolsVault?.storage && typeof root.SmallToolsVault.flush === "function") {
          setSaveStatus("저장 중…");
          Promise.resolve(root.SmallToolsVault.flush()).then(() => {
            if (!destroyed && generation === saveGeneration) setSaveStatus("자동 저장됨");
          }).catch(() => {
            if (!destroyed && generation === saveGeneration) setSaveStatus("저장 실패");
            showToast("브라우저에 자동 저장하지 못했어요");
          });
        } else {
          setSaveStatus("자동 저장됨");
        }
        renderCalendar();
        renderSelectedSummary();
        renderStats();
      } catch (error) {
        setSaveStatus("저장 실패");
        showToast(error.message || "기록을 저장하지 못했어요");
      }
    }

    function scheduleEditorSave() {
      if (saveTimer !== null) root.clearTimeout?.(saveTimer);
      setSaveStatus("저장 중…");
      saveTimer = root.setTimeout?.(saveEditor, Number(options.debounceMs ?? 350)) ?? null;
      if (saveTimer === null) saveEditor();
    }

    function flushEditorSave() {
      if (saveTimer === null) return;
      root.clearTimeout?.(saveTimer);
      saveTimer = null;
      saveEditor();
    }

    function addInputAutosave(element) {
      element?.addEventListener?.("input", scheduleEditorSave);
      element?.addEventListener?.("change", () => {
        scheduleEditorSave();
        flushEditorSave();
      });
    }

    [elements.breakfast, elements.lunch, elements.dinner, elements.snack,
      elements.alcoholType, elements.alcoholAmount, elements.alcoholNote, elements.memo]
      .forEach(addInputAutosave);

    elements.form?.addEventListener?.("submit", (event) => {
      event.preventDefault?.();
      scheduleEditorSave();
      flushEditorSave();
    });

    elements.alcoholDrank?.addEventListener?.("change", () => {
      if (!elements.alcoholDrank.checked) {
        if (elements.alcoholType) elements.alcoholType.value = "";
        if (elements.alcoholAmount) elements.alcoholAmount.value = "";
        if (elements.alcoholNote) elements.alcoholNote.value = "";
      }
      syncAlcoholDetails();
      scheduleEditorSave();
      flushEditorSave();
    });

    elements.conditionButtons.forEach((button) => {
      button.addEventListener?.("click", () => {
        const condition = Number(button.dataset?.condition);
        if (!Number.isInteger(condition) || condition < 0 || condition > 5) return;
        selectedCondition = condition === selectedCondition ? 0 : condition;
        syncConditionButtons();
        scheduleEditorSave();
        flushEditorSave();
      });
    });

    elements.prevMonth?.addEventListener?.("click", () => {
      flushEditorSave();
      currentMonth = shiftMonth(currentMonth, -1);
      selectedDate = dateForMonth(currentMonth, Number(selectedDate.slice(8, 10)));
      render();
    });
    elements.nextMonth?.addEventListener?.("click", () => {
      flushEditorSave();
      currentMonth = shiftMonth(currentMonth, 1);
      selectedDate = dateForMonth(currentMonth, Number(selectedDate.slice(8, 10)));
      render();
    });
    elements.today?.addEventListener?.("click", () => {
      flushEditorSave();
      selectedDate = today();
      currentMonth = selectedDate.slice(0, 7);
      render();
    });
    elements.clearDay?.addEventListener?.("click", () => {
      flushEditorSave();
      const current = getRecord(state, selectedDate);
      if (isEmptyRecord(current)) return;
      if (typeof root.confirm === "function" && !root.confirm("이 날짜의 식사·음주·컨디션·메모 기록을 모두 지울까요?")) return;
      deleteRecord(state, selectedDate);
      const saved = persistState();
      render();
      if (!saved) {
        setSaveStatus("저장 실패");
        return;
      }
      setSaveStatus("기록을 지웠어요");
      showToast("이날의 기록을 지웠어요");
    });

    function downloadText(text, filename) {
      if (typeof root.Blob !== "function" || !root.URL?.createObjectURL) throw new Error("파일 저장을 지원하지 않는 브라우저입니다.");
      const blob = new root.Blob([text], { type: "application/json;charset=utf-8" });
      const url = root.URL.createObjectURL(blob);
      const anchor = doc.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      root.setTimeout?.(() => root.URL.revokeObjectURL(url), 1_000);
    }

    elements.exportButton?.addEventListener?.("click", () => {
      flushEditorSave();
      try {
        downloadText(exportState(state), `daily-log-backup-${today()}.json`);
        showToast("JSON 백업 파일을 저장했어요");
      } catch (error) {
        showToast(error.message || "백업 파일을 만들지 못했어요");
      }
    });
    elements.importButton?.addEventListener?.("click", () => elements.importInput?.click?.());
    elements.importInput?.addEventListener?.("change", async () => {
      const file = elements.importInput.files?.[0];
      if (!file) return;
      try {
        if (Number.isFinite(file.size) && file.size > IMPORT_SIZE_LIMIT) {
          throw new Error("가져올 파일이 너무 큽니다.");
        }
        const imported = importState(await file.text(), getNow());
        if (typeof root.confirm === "function" && !root.confirm("현재 하루 기록을 백업 파일의 내용으로 바꿀까요?")) return;
        const previousState = state;
        state = imported;
        const saved = persistState();
        if (!saved) {
          state = previousState;
          render();
          setSaveStatus("저장 실패");
          return;
        }
        render();
        setSaveStatus("백업을 불러왔어요");
        showToast("하루 기록을 불러왔어요");
      } catch (error) {
        showToast(error.message || "JSON을 불러오지 못했어요");
      } finally {
        elements.importInput.value = "";
      }
    });

    const storageListener = (event) => {
      if (storage === root.SmallToolsVault?.storage && event.storageArea) return;
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try {
        const incomingValue = event.key === null ? storage?.getItem(STORAGE_KEY) : event.newValue;
        const hasPendingDraft = saveTimer !== null;
        const pendingDraft = hasPendingDraft ? readEditor() : null;
        if (hasPendingDraft) {
          root.clearTimeout?.(saveTimer);
          saveTimer = null;
        }
        state = incomingValue ? importState(incomingValue, getNow()) : createEmptyState();
        if (pendingDraft) {
          upsertRecord(state, selectedDate, pendingDraft, getNow());
          const saved = persistState();
          setSaveStatus(saved ? "자동 저장됨" : "저장 실패");
          render();
          if (!saved) return;
          showToast("다른 탭의 변경과 작성 중인 기록을 합쳤어요");
          return;
        }
        render();
        showToast(incomingValue ? "다른 탭에서 바뀐 기록을 불러왔어요" : "다른 탭에서 기록을 비웠어요");
      } catch (_error) {
        showToast("다른 탭의 기록을 불러오지 못했어요");
      }
    };
    root.addEventListener?.("storage", storageListener);
    const pagehideListener = () => flushEditorSave();
    root.addEventListener?.("pagehide", pagehideListener);
    const visibilityListener = () => {
      if (doc.visibilityState === "hidden") flushEditorSave();
    };
    doc.addEventListener?.("visibilitychange", visibilityListener);

    const controller = {
      getState: () => normalizeState(state),
      getSelectedDate: () => selectedDate,
      getCurrentMonth: () => currentMonth,
      render,
      flush: flushEditorSave,
      destroy() {
        flushEditorSave();
        destroyed = true;
        if (saveTimer !== null) root.clearTimeout?.(saveTimer);
        if (toastTimer !== null) root.clearTimeout?.(toastTimer);
        root.removeEventListener?.("storage", storageListener);
        root.removeEventListener?.("pagehide", pagehideListener);
        doc.removeEventListener?.("visibilitychange", visibilityListener);
        activeApps?.delete(doc);
      },
    };
    activeApps?.set(doc, controller);
    render();
    if (storageLoadFailed) showToast("저장된 기록을 읽지 못해 빈 기록으로 열었어요");
    return controller;
  }

  const api = {
    STATE_VERSION,
    STORAGE_KEY,
    IMPORT_SIZE_LIMIT,
    WEEKDAY_LABELS,
    MEAL_KEYS,
    parseDateKey,
    toDateKey,
    localToday,
    addDays,
    weekdayIndex,
    parseMonthKey,
    monthKey,
    shiftMonth,
    monthBounds,
    buildCalendarDays,
    buildMonthGrid: buildCalendarDays,
    createEmptyRecord,
    normalizeRecord,
    isEmptyRecord,
    createEmptyState,
    normalizeState,
    validateState,
    loadState,
    saveState,
    getRecord,
    upsertRecord,
    deleteRecord,
    calculateMonthlyStats,
    exportState,
    serializeState: exportState,
    importState,
    prepareBrowserStorage,
    formatMonthLabel,
    formatDateLabel,
    initDailyLogApp,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DailyLogApp = api;

  if (typeof document !== "undefined") {
    const boot = async () => initDailyLogApp(document, { storage: await prepareBrowserStorage() });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
