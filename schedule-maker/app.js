(function (root) {
  "use strict";

  const DAYS = [
    { short: "월", full: "월요일" },
    { short: "화", full: "화요일" },
    { short: "수", full: "수요일" },
    { short: "목", full: "목요일" },
    { short: "금", full: "금요일" },
    { short: "토", full: "토요일" },
    { short: "일", full: "일요일" },
  ];
  const HOURS = 24;
  const SLOT_COUNT = DAYS.length * HOURS;
  const SLOT_BYTES = SLOT_COUNT / 8;
  const SHARE_VERSION = "1";
  const DEFAULT_TITLE = "우리의 가능한 시간";
  const MAX_OVERLAP_LEVEL = 8;

  function slotIndex(hour, day) {
    return hour * DAYS.length + day;
  }

  function slotCoordinates(index) {
    return { hour: Math.floor(index / DAYS.length), day: index % DAYS.length };
  }

  function createSlots(fill = false) {
    const slots = new Uint8Array(SLOT_BYTES);
    if (fill) slots.fill(0xff);
    return slots;
  }

  function assertSlots(slots) {
    if (!(slots instanceof Uint8Array) || slots.length !== SLOT_BYTES) {
      throw new TypeError(`선택 데이터는 ${SLOT_BYTES}바이트여야 합니다.`);
    }
  }

  function isSelected(slots, index) {
    assertSlots(slots);
    if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return false;
    return Boolean(slots[index >> 3] & (1 << (index & 7)));
  }

  function setSelected(slots, index, value) {
    assertSlots(slots);
    if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
      throw new RangeError("일정 칸 인덱스가 범위를 벗어났습니다.");
    }
    const byte = index >> 3;
    const mask = 1 << (index & 7);
    if (value) slots[byte] |= mask;
    else slots[byte] &= ~mask;
    return slots;
  }

  function countSelected(slots) {
    assertSlots(slots);
    let count = 0;
    for (let index = 0; index < SLOT_COUNT; index += 1) {
      if (isSelected(slots, index)) count += 1;
    }
    return count;
  }

  function bytesToBase64(bytes) {
    if (typeof btoa === "function") {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
  }

  function base64ToBytes(base64) {
    if (typeof atob === "function") {
      const binary = atob(base64);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    }
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  function encodeSlots(slots) {
    assertSlots(slots);
    return bytesToBase64(slots).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decodeSlots(encoded) {
    if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]{28}$/.test(encoded)) {
      throw new Error("공유 일정 데이터의 형식이 올바르지 않습니다.");
    }
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = base64ToBytes(base64);
    if (bytes.length !== SLOT_BYTES) throw new Error("공유 일정 데이터의 길이가 올바르지 않습니다.");
    return bytes;
  }

  function cleanMeta(value, fallback, maximum) {
    const cleaned = String(value ?? "").trim().slice(0, maximum);
    return cleaned || fallback;
  }

  function normalizeStartHour(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number < HOURS ? number : fallback;
  }

  function displayHours(startHour = 0) {
    const start = normalizeStartHour(startHour);
    return Array.from({ length: HOURS }, (_value, offset) => (start + offset) % HOURS);
  }

  function normalizeStartDay(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number < DAYS.length ? number : fallback;
  }

  function displayDayIndexes(startDay = 0) {
    const start = normalizeStartDay(startDay);
    return Array.from({ length: DAYS.length }, (_value, offset) => (start + offset) % DAYS.length);
  }

  function makeShareHash(slots, metadata = {}) {
    const parameters = new URLSearchParams();
    parameters.set("v", SHARE_VERSION);
    parameters.set("t", cleanMeta(metadata.title, DEFAULT_TITLE, 60));
    parameters.set("z", cleanMeta(metadata.timezone, "Asia/Seoul", 40));
    parameters.set("h", String(normalizeStartHour(metadata.startHour, 0)));
    parameters.set("d", String(normalizeStartDay(metadata.startDay, 0)));
    parameters.set("s", encodeSlots(slots));
    return `#${parameters.toString()}`;
  }

  function parseShareHash(hash) {
    const source = String(hash ?? "");
    if (!source || source === "#") return null;
    const parameters = new URLSearchParams(source.replace(/^#/, ""));

    if (parameters.getAll("v").length !== 1 || parameters.get("v") !== SHARE_VERSION) {
      throw new Error("지원하지 않는 공유 링크 버전입니다.");
    }
    if (parameters.getAll("s").length !== 1) throw new Error("공유 일정 데이터가 없습니다.");
    if (
      parameters.getAll("t").length > 1 ||
      parameters.getAll("z").length > 1 ||
      parameters.getAll("h").length > 1 ||
      parameters.getAll("d").length > 1
    ) {
      throw new Error("공유 일정 정보가 중복되어 있습니다.");
    }
    const rawStartHour = parameters.get("h");
    const startHour = parameters.has("h") && /^\d{1,2}$/.test(rawStartHour)
      ? normalizeStartHour(rawStartHour, -1)
      : parameters.has("h") ? -1 : 0;
    if (startHour === -1) throw new Error("하루 시작 시간이 올바르지 않습니다.");
    const rawStartDay = parameters.get("d");
    const startDay = parameters.has("d") && /^\d$/.test(rawStartDay)
      ? normalizeStartDay(rawStartDay, -1)
      : parameters.has("d") ? -1 : 0;
    if (startDay === -1) throw new Error("시작 요일이 올바르지 않습니다.");

    return {
      slots: decodeSlots(parameters.get("s")),
      title: cleanMeta(parameters.get("t"), DEFAULT_TITLE, 60),
      timezone: cleanMeta(parameters.get("z"), "Asia/Seoul", 40),
      startHour,
      startDay,
    };
  }

  function makeShareUrl(baseUrl, slots, metadata = {}) {
    const url = new URL(baseUrl);
    url.hash = makeShareHash(slots, metadata).slice(1);
    return url.toString();
  }

  function formatHour(hour) {
    return `${String(hour).padStart(2, "0")}:00`;
  }

  function selectedRanges(slots, day, startHour = 0) {
    assertSlots(slots);
    const ranges = [];
    let start = null;
    const firstHour = normalizeStartHour(startHour);

    for (let offset = 0; offset <= HOURS; offset += 1) {
      const hour = (firstHour + offset) % HOURS;
      const selected = offset < HOURS && isSelected(slots, slotIndex(hour, day));
      const timelineHour = firstHour + offset;
      if (selected && start === null) start = timelineHour;
      if (!selected && start !== null) {
        ranges.push([start, timelineHour]);
        start = null;
      }
    }
    return ranges;
  }

  function formatTimelineHour(timelineHour, startHour = 0) {
    if (timelineHour === HOURS && normalizeStartHour(startHour) === 0) return "24:00";
    const dayOffset = Math.floor(timelineHour / HOURS);
    const hour = timelineHour % HOURS;
    return `${dayOffset > 0 ? "익일 " : ""}${formatHour(hour)}`;
  }

  function formatScheduleText(slots, metadata = {}) {
    const title = cleanMeta(metadata.title, DEFAULT_TITLE, 60);
    const timezone = cleanMeta(metadata.timezone, "Asia/Seoul", 40);
    const startHour = normalizeStartHour(metadata.startHour, 0);
    const startDay = normalizeStartDay(metadata.startDay, 0);
    const lines = [
      `[${title}]`,
      `기준 시간대: ${timezone} · 하루 시작: ${formatHour(startHour)} · 시작 요일: ${DAYS[startDay].full}`,
      "",
    ];

    displayDayIndexes(startDay).forEach((dayIndex) => {
      const day = DAYS[dayIndex];
      const ranges = selectedRanges(slots, dayIndex, startHour);
      const description = ranges.length
        ? ranges.map(([start, end]) => `${formatTimelineHour(start, startHour)}–${formatTimelineHour(end, startHour)}`).join(", ")
        : "선택 없음";
      lines.push(`${day.short}: ${description}`);
    });

    lines.push("", `가능한 시간 ${countSelected(slots)}칸 · 언제표`);
    return lines.join("\n");
  }

  function slotsEqual(left, right) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }

  function parseShareInput(input) {
    if (typeof input !== "string" || !input.trim()) {
      throw new Error("공유 링크를 입력해 주세요.");
    }

    let source = input.trim();
    if (source.startsWith("<") || source.endsWith(">")) {
      const discordLink = source.match(/^<([^<>\s]+)>$/);
      if (!discordLink) throw new Error("공유 링크의 형식이 올바르지 않습니다.");
      source = discordLink[1];
    }

    let hash;
    if (source.startsWith("#")) {
      hash = source;
    } else {
      try {
        hash = new URL(source).hash;
      } catch (_error) {
        throw new Error("공유 링크의 형식이 올바르지 않습니다.");
      }
    }

    const schedule = parseShareHash(hash);
    if (!schedule) throw new Error("공유 일정 데이터가 없습니다.");
    return schedule;
  }

  function requireStartHour(value, label) {
    if (!Number.isInteger(value) || value < 0 || value >= HOURS) {
      throw new RangeError(`${label}은 0부터 23 사이의 정수여야 합니다.`);
    }
    return value;
  }

  function aggregateSchedules(participants, targetStart = 0) {
    if (!Array.isArray(participants)) throw new TypeError("일정 목록은 배열이어야 합니다.");
    const startHour = requireStartHour(targetStart, "기준 시작 시각");
    const sources = participants.map((participant) => {
      if (!participant || typeof participant !== "object") {
        throw new TypeError("각 일정은 공유 일정 객체여야 합니다.");
      }
      assertSlots(participant.slots);
      return {
        slots: participant.slots,
        startHour: participant.startHour === undefined
          ? 0
          : requireStartHour(participant.startHour, "일정 시작 시각"),
      };
    });

    let maxCount = 0;
    const cells = Array.from({ length: SLOT_COUNT }, (_value, index) => {
      const { hour, day } = slotCoordinates(index);
      const calendarDay = (day + (hour < startHour ? 1 : 0)) % DAYS.length;
      const participantIndexes = [];

      sources.forEach((source, participantIndex) => {
        const sourceDay = (
          calendarDay - (hour < source.startHour ? 1 : 0) + DAYS.length
        ) % DAYS.length;
        if (isSelected(source.slots, slotIndex(hour, sourceDay))) {
          participantIndexes.push(participantIndex);
        }
      });

      const count = participantIndexes.length;
      if (count > maxCount) maxCount = count;
      return { index, hour, day, participantIndexes, count };
    });

    return { startHour, cells, maxCount };
  }

  function overlapColorLevel(count) {
    const normalized = Number(count);
    if (!Number.isFinite(normalized) || normalized <= 0) return 0;
    return Math.min(MAX_OVERLAP_LEVEL, Math.floor(normalized));
  }

  function truncateCanvasText(context, value, maximumWidth) {
    const text = String(value);
    if (context.measureText(text).width <= maximumWidth) return text;
    let shortened = text;
    while (shortened && context.measureText(`${shortened}…`).width > maximumWidth) shortened = shortened.slice(0, -1);
    return `${shortened}…`;
  }

  async function renderScheduleImage(slots, metadata = {}, options = {}) {
    assertSlots(slots);
    if (typeof document === "undefined") throw new Error("이미지는 브라우저에서만 만들 수 있습니다.");

    const scale = options.scale || 2;
    const width = 1040;
    const gridX = 104;
    const gridY = 156;
    const gridWidth = 900;
    const headerHeight = 45;
    const rowHeight = 30;
    const gridHeight = headerHeight + HOURS * rowHeight;
    const height = gridY + gridHeight + 74;
    const fontFamily = '"Schedule D2Coding", "D2Coding", monospace';
    const title = cleanMeta(metadata.title, DEFAULT_TITLE, 60);
    const timezone = cleanMeta(metadata.timezone, "Asia/Seoul", 40);
    const startHour = normalizeStartHour(metadata.startHour, 0);
    const startDay = normalizeStartDay(metadata.startDay, 0);
    const dayOrder = displayDayIndexes(startDay);

    if (document.fonts) {
      await document.fonts.load('400 16px "Schedule D2Coding"', "월화수목금토일 00:00 가능");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.textBaseline = "middle";

    context.fillStyle = "#edf2e8";
    context.fillRect(0, 0, width, height);

    const markX = 36;
    const markBottom = 44;
    [14, 25, 18, 31, 24, 15, 21].forEach((barHeight, index) => {
      context.fillStyle = [1, 3, 4].includes(index) ? "#f36c3f" : "#153c34";
      context.fillRect(markX + index * 7, markBottom - barHeight, 5, barHeight);
    });

    context.font = `400 11px ${fontFamily}`;
    context.fillStyle = "#61766e";
    context.textAlign = "left";
    context.fillText("언제표 · WEEKLY AVAILABILITY", 102, 30);

    context.font = `400 25px ${fontFamily}`;
    context.fillStyle = "#153c34";
    context.fillText(truncateCanvasText(context, title, 680), 36, 82);

    context.font = `400 12px ${fontFamily}`;
    context.fillStyle = "#708078";
    context.fillText(`기준 시간대  ${timezone}  ·  하루 시작  ${formatHour(startHour)}  ·  시작 요일  ${DAYS[startDay].full}`, 38, 117);
    context.textAlign = "right";
    context.fillText(`가능한 시간  ${countSelected(slots)}칸`, width - 36, 117);

    context.fillStyle = "#153c34";
    context.fillRect(36, gridY, width - 72, headerHeight);
    context.font = `400 12px ${fontFamily}`;
    context.textAlign = "center";
    context.fillStyle = "#dce8df";
    context.fillText("시간", 70, gridY + headerHeight / 2);

    const dayAreaX = gridX;
    const dayAreaWidth = gridWidth;
    dayOrder.forEach((day, columnIndex) => {
      const left = dayAreaX + Math.round((columnIndex * dayAreaWidth) / DAYS.length);
      const right = dayAreaX + Math.round(((columnIndex + 1) * dayAreaWidth) / DAYS.length);
      context.fillStyle = day === 6 ? "#ffc2ae" : day === 5 ? "#b9d1d8" : "#ffffff";
      context.fillText(DAYS[day].short, (left + right) / 2, gridY + headerHeight / 2);
    });

    displayHours(startHour).forEach((hour, rowOffset) => {
      const top = gridY + headerHeight + rowOffset * rowHeight;
      context.fillStyle = rowOffset % 2 ? "#f7f8ef" : "#fffdf5";
      context.fillRect(36, top, width - 72, rowHeight);
      context.font = `400 ${hour < startHour ? 8 : 10}px ${fontFamily}`;
      context.fillStyle = "#60736c";
      context.textAlign = "center";
      context.fillText(`${hour < startHour ? "익일 " : ""}${formatHour(hour)}`, 70, top + rowHeight / 2);

      dayOrder.forEach((day, columnIndex) => {
        if (!isSelected(slots, slotIndex(hour, day))) return;
        const left = dayAreaX + Math.round((columnIndex * dayAreaWidth) / DAYS.length);
        const right = dayAreaX + Math.round(((columnIndex + 1) * dayAreaWidth) / DAYS.length);
        context.fillStyle = "#f36c3f";
        context.fillRect(left + 1, top + 1, right - left - 1, rowHeight - 1);
        context.font = `400 12px ${fontFamily}`;
        context.fillStyle = "#ffffff";
        context.fillText("✓", (left + right) / 2, top + rowHeight / 2 + 0.5);
      });
    });

    context.fillStyle = "#9aaba1";
    for (let hour = 0; hour <= HOURS; hour += 1) {
      const y = gridY + headerHeight + hour * rowHeight;
      context.fillRect(36, y, width - 72, 1);
    }
    context.fillRect(gridX - 1, gridY, 1, gridHeight);
    for (let day = 0; day <= DAYS.length; day += 1) {
      const x = dayAreaX + Math.round((day * dayAreaWidth) / DAYS.length);
      context.fillRect(x, gridY, 1, gridHeight);
    }
    if (startHour !== 0) {
      const midnightOffset = HOURS - startHour;
      const midnightY = gridY + headerHeight + midnightOffset * rowHeight;
      context.fillStyle = "#f36c3f";
      context.fillRect(36, midnightY, width - 72, 2);
    }

    const footerY = gridY + gridHeight + 34;
    context.fillStyle = "#f36c3f";
    context.fillRect(38, footerY - 6, 12, 12);
    context.font = `400 10px ${fontFamily}`;
    context.fillStyle = "#61766e";
    context.textAlign = "left";
    context.fillText("선택한 칸 = 가능한 시간", 59, footerY);
    context.textAlign = "right";
    context.fillText("언제표에서 만든 주간 가능 시간표", width - 36, footerY);

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("PNG 이미지를 만들지 못했습니다."));
      }, "image/png");
    });
  }

  function initApps() {
    const elements = {
      title: document.querySelector("#titleInput"),
      startHour: document.querySelector("#startHourSelect"),
      startDay: document.querySelector("#startDaySelect"),
      timezone: document.querySelector("#timezoneInput"),
      rangeLabel: document.querySelector("#rangeLabel"),
      grid: document.querySelector("#scheduleGrid"),
      scroller: document.querySelector("#scheduleScroller"),
      count: document.querySelector("#selectedCount"),
      progress: document.querySelector("#selectionProgress"),
      undo: document.querySelector("#undoButton"),
      clear: document.querySelector("#clearButton"),
      reset: document.querySelector("#resetButton"),
      live: document.querySelector("#liveRegion"),
      linkButton: document.querySelector("#linkButton"),
      linkLabel: document.querySelector("#linkLabel"),
      textButton: document.querySelector("#textButton"),
      textLabel: document.querySelector("#textLabel"),
      imageButton: document.querySelector("#imageButton"),
      imageLabel: document.querySelector("#imageLabel"),
      pngButton: document.querySelector("#pngButton"),
      toast: document.querySelector("#toast"),
      compareLinks: document.querySelector("#compareLinksInput"),
      compareAdd: document.querySelector("#compareAddButton"),
      compareStartHour: document.querySelector("#compareStartHourSelect"),
      compareStartDay: document.querySelector("#compareStartDaySelect"),
      compareInputStatus: document.querySelector("#compareInputStatus"),
      participantArea: document.querySelector("#participantArea"),
      participantCount: document.querySelector("#participantCount"),
      participantList: document.querySelector("#participantList"),
      compareClear: document.querySelector("#compareClearButton"),
      compareTimezoneStatus: document.querySelector("#compareTimezoneStatus"),
      compareMaxCount: document.querySelector("#compareMaxCount"),
      compareSummaryText: document.querySelector("#compareSummaryText"),
      compareGrid: document.querySelector("#compareGrid"),
      compareGridScroller: document.querySelector("#compareGridScroller"),
      compareDetail: document.querySelector("#compareDetail"),
      compareCollectionName: document.querySelector("#compareCollectionNameInput"),
      compareCollectionSave: document.querySelector("#compareSaveCollectionButton"),
      compareCollectionShare: document.querySelector("#compareCopyCollectionLinkButton"),
      compareCollectionStatus: document.querySelector("#compareCollectionSaveStatus"),
    };

    let slots = createSlots();
    let history = [];
    let slotElements = [];
    let dayButtons = [];
    let timeButtons = [];
    let rovingIndex = slotIndex(9, 0);
    let dragging = null;
    let toastTimer;
    let initialMessage = "";
    let activeSavedScheduleId = null;
    let comparisonParticipants = [];
    let nextParticipantId = 1;
    let comparisonCells = [];
    let comparisonRoster = [];
    let comparisonActiveIndex = null;
    let comparisonRovingIndex = slotIndex(8, 0);
    let comparisonCellElements = [];
    let activeComparisonCollectionId = null;
    let comparisonCollectionDirty = false;
    const participantColors = ["#f36c3f", "#2d765f", "#49778a", "#d69231", "#7b6aa8", "#b85167", "#42877d"];
    const anchorHashes = new Set(["#top", "#schedule", "#share", "#compare"]);

    const detectedTimezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul";
      } catch (_error) {
        return "Asia/Seoul";
      }
    })();
    if (elements.timezone) elements.timezone.value = detectedTimezone;
    for (let hour = 0; hour < HOURS; hour += 1) {
      const option = document.createElement("option");
      option.value = String(hour);
      option.textContent = `${formatHour(hour)}${hour === 8 ? " · 추천" : ""}`;
      if (elements.startHour) elements.startHour.append(option);
      if (elements.compareStartHour) elements.compareStartHour.append(option.cloneNode(true));
    }
    if (elements.startHour) elements.startHour.value = "8";
    if (elements.compareStartHour) elements.compareStartHour.value = "8";
    DAYS.forEach((day, dayIndex) => {
      const option = document.createElement("option");
      option.value = String(dayIndex);
      option.textContent = `${day.full} 시작`;
      if (elements.startDay) elements.startDay.append(option);
      if (elements.compareStartDay) elements.compareStartDay.append(option.cloneNode(true));
    });
    if (elements.startDay) elements.startDay.value = "0";
    if (elements.compareStartDay) elements.compareStartDay.value = "0";

    function metadata() {
      return {
        title: cleanMeta(elements.title.value, DEFAULT_TITLE, 60),
        timezone: cleanMeta(elements.timezone.value, detectedTimezone, 40),
        startHour: normalizeStartHour(elements.startHour.value, 8),
        startDay: normalizeStartDay(elements.startDay.value, 0),
      };
    }

    function currentStartHour() {
      return normalizeStartHour(elements.startHour.value, 8);
    }

    function currentStartDay() {
      return normalizeStartDay(elements.startDay.value, 0);
    }

    function timelineHourFor(hour) {
      const startHour = currentStartHour();
      return hour < startHour ? hour + HOURS : hour;
    }

    function savedSchedulesApi() {
      return root.EonjepyoSaved && typeof root.EonjepyoSaved.get === "function"
        ? root.EonjepyoSaved
        : null;
    }

    function savedComparisonsApi() {
      return root.EonjepyoComparisons && typeof root.EonjepyoComparisons.get === "function"
        ? root.EonjepyoComparisons
        : null;
    }

    function applyStoredSchedule(record) {
      if (!record) return false;
      slots = decodeSlots(record.slots);
      elements.title.value = record.title === DEFAULT_TITLE ? "" : record.title;
      elements.timezone.value = record.timezone;
      elements.startHour.value = String(record.startHour);
      elements.startDay.value = String(record.startDay);
      return true;
    }

    function cleanWriterLocation({ removeSavedAction = false } = {}) {
      const parameters = new URLSearchParams(window.location.search);
      if (removeSavedAction) {
        parameters.delete("load");
        parameters.delete("edit");
      }
      const search = parameters.toString();
      const cleanLocation = `${window.location.pathname}${search ? `?${search}` : ""}`;
      try {
        window.history.replaceState(null, "", cleanLocation);
      } catch (_error) {
        window.location.hash = "";
      }
    }

    function loadInitialState() {
      const shareHash = window.location.hash;
      if (shareHash && !anchorHashes.has(shareHash)) {
        activeSavedScheduleId = null;
        try {
          const shared = parseShareHash(shareHash);
          if (shared) {
            slots = shared.slots;
            elements.title.value = shared.title === DEFAULT_TITLE ? "" : shared.title;
            elements.timezone.value = shared.timezone;
            elements.startHour.value = String(shared.startHour);
            elements.startDay.value = String(shared.startDay);
            try {
              savedSchedulesApi()?.saveSchedule(window.localStorage, shared, { source: "shared" });
            } catch (_error) {
              // 저장 공간을 사용할 수 없어도 공유 일정 자체는 계속 열 수 있다.
            }
            initialMessage = "공유받은 일정표를 불러왔어요. 수정해도 원본은 바뀌지 않아요.";
          }
        } catch (_error) {
          slots = createSlots();
          initialMessage = "공유 링크가 손상되어 빈 일정표로 열었어요.";
        } finally {
          cleanWriterLocation({ removeSavedAction: true });
        }
        return;
      }

      const query = new URLSearchParams(window.location.search);
      const editId = query.get("edit");
      const loadId = query.get("load");
      if (editId || loadId) {
        try {
          const stored = savedSchedulesApi()?.get(window.localStorage, editId || loadId);
          if (applyStoredSchedule(stored)) {
            activeSavedScheduleId = editId ? stored.id : null;
            initialMessage = editId
              ? `저장된 '${stored.title}' 일정을 편집하고 있어요.`
              : `저장된 '${stored.title}' 일정을 새 초안으로 불러왔어요.`;
            return;
          }
          initialMessage = "불러올 저장 일정을 찾지 못해 지난 초안을 열었어요.";
        } catch (_error) {
          initialMessage = "저장 일정을 불러오지 못해 지난 초안을 열었어요.";
        } finally {
          cleanWriterLocation({ removeSavedAction: true });
        }
      }

      try {
        const draft = window.localStorage.getItem("eonjepyo-draft");
        if (!draft) return;
        const restored = parseShareHash(draft);
        if (!restored) return;
        slots = restored.slots;
        elements.title.value = restored.title === DEFAULT_TITLE ? "" : restored.title;
        elements.timezone.value = restored.timezone;
        elements.startHour.value = String(restored.startHour);
        elements.startDay.value = String(restored.startDay);
        if (countSelected(slots)) initialMessage = "지난번에 칠하던 일정표를 불러왔어요.";
      } catch (_error) {
        slots = createSlots();
      }
    }

    function daySelectionState(day) {
      let selected = 0;
      for (let hour = 0; hour < HOURS; hour += 1) {
        if (isSelected(slots, slotIndex(hour, day))) selected += 1;
      }
      if (selected === 0) return "false";
      if (selected === HOURS) return "true";
      return "mixed";
    }

    function hourSelectionState(hour) {
      let selected = 0;
      for (let day = 0; day < DAYS.length; day += 1) {
        if (isSelected(slots, slotIndex(hour, day))) selected += 1;
      }
      if (selected === 0) return "false";
      if (selected === DAYS.length) return "true";
      return "mixed";
    }

    function updateSlotElement(index) {
      const element = slotElements[index];
      if (!element) return;
      const selected = isSelected(slots, index);
      const { hour, day } = slotCoordinates(index);
      const startHour = currentStartHour();
      const timelineHour = timelineHourFor(hour);
      const startLabel = formatTimelineHour(timelineHour, startHour);
      const endLabel = formatTimelineHour(timelineHour + 1, startHour);
      element.setAttribute("aria-checked", String(selected));
      element.setAttribute(
        "aria-label",
        `${DAYS[day].full} ${startLabel}부터 ${endLabel}까지 ${selected ? "가능함" : "선택 안 됨"}`,
      );
      element.title = `${DAYS[day].short} ${startLabel}–${endLabel}`;
    }

    function updateHeaders() {
      dayButtons.forEach((button, day) => {
        const state = daySelectionState(day);
        button.setAttribute("aria-checked", state);
        button.setAttribute("aria-label", `${DAYS[day].full} 전체 ${state === "true" ? "선택 해제" : "선택"}`);
      });
      timeButtons.forEach((button, hour) => {
        const state = hourSelectionState(hour);
        const startHour = currentStartHour();
        const timelineHour = timelineHourFor(hour);
        const startLabel = formatTimelineHour(timelineHour, startHour);
        const endLabel = formatTimelineHour(timelineHour + 1, startHour);
        button.setAttribute("aria-checked", state);
        button.setAttribute("aria-label", `${startLabel}부터 ${endLabel}까지 일주일 전체 ${state === "true" ? "선택 해제" : "선택"}`);
      });
    }

    function updateStatus() {
      const selected = countSelected(slots);
      elements.count.textContent = String(selected);
      elements.progress.style.width = `${(selected / SLOT_COUNT) * 100}%`;
      elements.undo.disabled = history.length === 0;
      elements.clear.disabled = selected === 0;
    }

    function saveDraft() {
      const hash = makeShareHash(slots, metadata());
      try {
        window.localStorage.setItem("eonjepyo-draft", hash);
        const explicitTitle = elements.title.value.trim();
        if (activeSavedScheduleId && explicitTitle) {
          savedSchedulesApi()?.saveSchedule(window.localStorage, {
            slots,
            ...metadata(),
            title: explicitTitle,
          }, { id: activeSavedScheduleId });
        }
      } catch (_error) {
        // Private browsing can disable localStorage; the current tab still keeps the state.
      }
    }

    function announce(message) {
      elements.live.textContent = "";
      window.setTimeout(() => (elements.live.textContent = message), 20);
    }

    function renderAll({ save = true } = {}) {
      slotElements.forEach((_element, index) => updateSlotElement(index));
      updateHeaders();
      updateStatus();
      const startHour = currentStartHour();
      elements.rangeLabel.textContent = startHour === 0
        ? "00:00부터 24:00까지"
        : `${formatHour(startHour)}부터 익일 ${formatHour(startHour)}까지`;
      if (save) saveDraft();
    }

    function pushHistory(previous) {
      if (slotsEqual(previous, slots)) return false;
      history.push(previous);
      if (history.length > 40) history.shift();
      return true;
    }

    function commitMutation(mutator, message) {
      const previous = slots.slice();
      mutator();
      if (!pushHistory(previous)) return;
      renderAll();
      announce(message || `가능한 시간 ${countSelected(slots)}칸을 선택했습니다.`);
    }

    function setRovingFocus(index, shouldFocus = true) {
      if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return;
      if (slotElements[rovingIndex]) slotElements[rovingIndex].tabIndex = -1;
      rovingIndex = index;
      slotElements[rovingIndex].tabIndex = 0;
      if (shouldFocus) slotElements[rovingIndex].focus({ preventScroll: false });
    }

    function createGrid() {
      elements.grid.replaceChildren();
      slotElements = [];
      dayButtons = [];
      timeButtons = [];
      const startDay = currentStartDay();
      const dayOrder = displayDayIndexes(startDay);
      elements.grid.setAttribute(
        "aria-label",
        `${DAYS[startDay].full}부터 ${DAYS[dayOrder[dayOrder.length - 1]].full}까지 시간별 가능 여부`,
      );

      const fragment = document.createDocumentFragment();
      const headerRow = document.createElement("div");
      headerRow.className = "grid-row header-row";
      headerRow.setAttribute("role", "row");

      const corner = document.createElement("div");
      corner.className = "grid-corner";
      corner.setAttribute("role", "columnheader");
      corner.textContent = "시간";
      headerRow.append(corner);

      dayOrder.forEach((dayIndex) => {
        const day = DAYS[dayIndex];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "day-toggle";
        button.dataset.day = String(dayIndex);
        button.setAttribute("role", "checkbox");
        button.textContent = day.short;
        button.addEventListener("click", () => {
          const select = daySelectionState(dayIndex) !== "true";
          commitMutation(() => {
            for (let hour = 0; hour < HOURS; hour += 1) setSelected(slots, slotIndex(hour, dayIndex), select);
          }, `${day.full} 전체를 ${select ? "선택했습니다" : "지웠습니다"}.`);
        });
        dayButtons[dayIndex] = button;
        headerRow.append(button);
      });
      fragment.append(headerRow);

      const startHour = currentStartHour();
      displayHours(startHour).forEach((hour) => {
        const row = document.createElement("div");
        row.className = "grid-row";
        row.setAttribute("role", "row");

        const timelineHour = hour < startHour ? hour + HOURS : hour;
        const isNextDayStart = startHour !== 0 && hour === 0;
        const startLabel = formatTimelineHour(timelineHour, startHour);

        const timeButton = document.createElement("button");
        timeButton.type = "button";
        timeButton.className = "time-toggle";
        if (isNextDayStart) timeButton.classList.add("next-day-start");
        timeButton.setAttribute("role", "checkbox");
        timeButton.textContent = startLabel;
        timeButton.addEventListener("click", () => {
          const select = hourSelectionState(hour) !== "true";
          commitMutation(() => {
            for (let day = 0; day < DAYS.length; day += 1) setSelected(slots, slotIndex(hour, day), select);
          }, `${startLabel} 시간대를 ${select ? "선택했습니다" : "지웠습니다"}.`);
        });
        timeButtons[hour] = timeButton;
        row.append(timeButton);

        dayOrder.forEach((day) => {
          const index = slotIndex(hour, day);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "slot";
          if (isNextDayStart) button.classList.add("next-day-start");
          button.dataset.index = String(index);
          button.setAttribute("role", "checkbox");
          button.tabIndex = index === rovingIndex ? 0 : -1;
          button.addEventListener("keydown", handleSlotKeydown);
          slotElements[index] = button;
          row.append(button);
        });
        fragment.append(row);
      });

      elements.grid.append(fragment);
    }

    function rebuildScheduleGrid() {
      dragging = null;
      rovingIndex = slotIndex(currentStartHour(), currentStartDay());
      createGrid();
      renderAll();
      elements.scroller.scrollTop = 0;
    }

    function resetSchedule() {
      const hasChanges = countSelected(slots) > 0 ||
        history.length > 0 ||
        elements.title.value.trim() !== "" ||
        elements.timezone.value.trim() !== detectedTimezone ||
        currentStartHour() !== 8 ||
        currentStartDay() !== 0;
      if (hasChanges && !window.confirm("일정표 설정과 선택한 시간을 모두 초기화할까요?")) return;

      slots = createSlots();
      activeSavedScheduleId = null;
      history = [];
      dragging = null;
      elements.title.value = "";
      elements.timezone.value = detectedTimezone;
      elements.startHour.value = "8";
      elements.startDay.value = "0";
      rovingIndex = slotIndex(8, 0);
      createGrid();
      renderAll();
      elements.scroller.scrollTop = 0;
      announce("일정표를 처음 상태로 초기화했습니다.");
      showToast("빈 일정표로 초기화했어요");
    }

    function handleSlotKeydown(event) {
      const index = Number(event.currentTarget.dataset.index);
      const { hour, day } = slotCoordinates(index);
      const startHour = currentStartHour();
      const startDay = currentStartDay();
      const rowOffset = (hour - startHour + HOURS) % HOURS;
      const columnOffset = (day - startDay + DAYS.length) % DAYS.length;
      const lastDay = (startDay + DAYS.length - 1) % DAYS.length;
      let destination = null;

      if (event.key === "ArrowLeft" && columnOffset > 0) destination = slotIndex(hour, (day + DAYS.length - 1) % DAYS.length);
      else if (event.key === "ArrowRight" && columnOffset < DAYS.length - 1) destination = slotIndex(hour, (day + 1) % DAYS.length);
      else if (event.key === "ArrowUp" && rowOffset > 0) destination = slotIndex((hour + HOURS - 1) % HOURS, day);
      else if (event.key === "ArrowDown" && rowOffset < HOURS - 1) destination = slotIndex((hour + 1) % HOURS, day);
      else if (event.key === "Home") destination = event.ctrlKey ? slotIndex(startHour, startDay) : slotIndex(hour, startDay);
      else if (event.key === "End") destination = event.ctrlKey
        ? slotIndex((startHour + HOURS - 1) % HOURS, lastDay)
        : slotIndex(hour, lastDay);
      else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        commitMutation(() => setSelected(slots, index, !isSelected(slots, index)));
        return;
      }

      if (destination !== null) {
        event.preventDefault();
        setRovingFocus(destination);
      }
    }

    function slotFromPoint(event) {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      return target?.closest?.(".slot") || null;
    }

    function paintSlot(element) {
      if (!dragging || !element) return;
      const index = Number(element.dataset.index);
      if (dragging.touched.has(index)) return;
      dragging.touched.add(index);
      setSelected(slots, index, dragging.paintValue);
      updateSlotElement(index);
      element.classList.add("drag-touched");
      updateStatus();
    }

    function startDrag(event) {
      const slot = event.target.closest(".slot");
      if (!slot || event.button !== 0) return;
      event.preventDefault();
      const index = Number(slot.dataset.index);
      setRovingFocus(index, false);
      slot.focus({ preventScroll: true });
      dragging = {
        pointerId: event.pointerId,
        paintValue: !isSelected(slots, index),
        before: slots.slice(),
        touched: new Set(),
      };
      paintSlot(slot);
    }

    function continueDrag(event) {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      event.preventDefault();
      paintSlot(slotFromPoint(event));
    }

    function finishDrag(event) {
      if (!dragging || event.pointerId !== dragging.pointerId) return;
      const completed = dragging;
      dragging = null;
      completed.touched.forEach((index) => slotElements[index].classList.remove("drag-touched"));
      if (!pushHistory(completed.before)) return;
      updateHeaders();
      updateStatus();
      saveDraft();
      announce(`${completed.touched.size}칸을 ${completed.paintValue ? "선택했습니다" : "지웠습니다"}.`);
    }

    function applyPreset(preset) {
      if (preset === "all") {
        commitMutation(() => slots.fill(0xff), "일주일 전체 시간을 선택했습니다.");
        return;
      }
      const start = preset === "weekday-morning" ? 9 : 18;
      const end = preset === "weekday-morning" ? 12 : 22;
      commitMutation(() => {
        for (let hour = start; hour < end; hour += 1) {
          for (let day = 0; day < 5; day += 1) setSelected(slots, slotIndex(hour, day), true);
        }
      }, `${preset === "weekday-morning" ? "평일 오전" : "평일 저녁"}을 선택했습니다.`);
    }

    function showToast(message) {
      if (!elements.toast) return;
      window.clearTimeout(toastTimer);
      elements.toast.textContent = message;
      elements.toast.classList.add("show");
      toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
    }

    async function copyPlainText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }

    function temporaryLabel(element, message, original) {
      element.textContent = message;
      window.setTimeout(() => (element.textContent = original), 1700);
    }

    async function copyLink() {
      const title = elements.title.value.trim();
      if (!title) {
        const message = "공유 링크를 복사하려면 일정 이름을 입력해 주세요.";
        elements.title.setAttribute("aria-invalid", "true");
        elements.title.focus();
        announce(message);
        showToast(message);
        return;
      }

      const shareUrl = makeShareUrl(window.location.href, slots, { ...metadata(), title });
      try {
        savedSchedulesApi()?.saveSchedule(window.localStorage, {
          slots,
          ...metadata(),
          title,
        }, { source: "created" });
      } catch (_error) {
        // 저장 목록을 사용할 수 없어도 공유 링크 복사는 계속 진행한다.
      }
      try {
        await copyPlainText(shareUrl);
        temporaryLabel(elements.linkLabel, "링크 복사 완료!", "공유 링크 복사");
        showToast("같은 선택 상태를 여는 링크를 복사했어요");
      } catch (_error) {
        showToast("링크를 복사하지 못했어요. 다시 시도해 주세요.");
      }
    }

    async function copyScheduleText() {
      try {
        await copyPlainText(formatScheduleText(slots, metadata()));
        temporaryLabel(elements.textLabel, "텍스트 복사 완료!", "일정 텍스트 복사");
        showToast("요일별 가능한 시간을 텍스트로 복사했어요");
      } catch (_error) {
        showToast("일정 텍스트를 복사하지 못했어요");
      }
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function imageBlobPromise() {
      return renderScheduleImage(slots.slice(), metadata()).then(canvasToBlob);
    }

    async function copyImage() {
      const original = "이미지 복사";
      elements.imageButton.disabled = true;
      elements.imageLabel.textContent = "이미지 만드는 중";
      const blobPromise = imageBlobPromise();

      try {
        let copied = false;
        const supportsPng = typeof ClipboardItem !== "undefined" &&
          (typeof ClipboardItem.supports !== "function" || ClipboardItem.supports("image/png"));

        if (window.isSecureContext && navigator.clipboard?.write && supportsPng) {
          try {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
            copied = true;
          } catch (_clipboardError) {
            copied = false;
          }
        }

        if (copied) {
          elements.imageLabel.textContent = "이미지 복사 완료!";
          showToast("메신저 입력창에 바로 붙여넣을 수 있어요");
        } else {
          downloadBlob(await blobPromise, "eonjepyo-schedule.png");
          elements.imageLabel.textContent = "PNG 저장 완료!";
          showToast("이미지 복사를 지원하지 않아 PNG로 저장했어요");
        }
      } catch (error) {
        elements.imageLabel.textContent = "다시 시도해 주세요";
        showToast(error.message || "일정 이미지를 만들지 못했어요");
      } finally {
        window.setTimeout(() => {
          elements.imageButton.disabled = false;
          elements.imageLabel.textContent = original;
        }, 1800);
      }
    }

    async function savePng() {
      elements.pngButton.disabled = true;
      try {
        downloadBlob(await imageBlobPromise(), "eonjepyo-schedule.png");
        showToast("고해상도 일정 이미지를 저장했어요");
      } catch (error) {
        showToast(error.message || "PNG를 저장하지 못했어요");
      } finally {
        elements.pngButton.disabled = false;
      }
    }

    function currentComparisonStartHour() {
      return normalizeStartHour(elements.compareStartHour.value, 8);
    }

    function currentComparisonStartDay() {
      return normalizeStartDay(elements.compareStartDay.value, 0);
    }

    function comparisonTimezoneKey(value) {
      const timezone = cleanMeta(value, "Asia/Seoul", 40);
      try {
        return Intl.DateTimeFormat("en-US", { timeZone: timezone })
          .resolvedOptions().timeZone.toLowerCase();
      } catch (_error) {
        return timezone.toLowerCase();
      }
    }

    function comparisonView() {
      const titleCounts = new Map();
      const roster = comparisonParticipants.map((participant) => {
        const occurrence = (titleCounts.get(participant.title) || 0) + 1;
        titleCounts.set(participant.title, occurrence);
        return {
          ...participant,
          displayName: occurrence === 1 ? participant.title : `${participant.title} (${occurrence})`,
        };
      });
      const baseTimezone = roster[0]?.timezone || null;
      const baseTimezoneKey = baseTimezone ? comparisonTimezoneKey(baseTimezone) : null;
      const compatible = baseTimezoneKey
        ? roster.filter((participant) => comparisonTimezoneKey(participant.timezone) === baseTimezoneKey)
        : [];
      const excluded = baseTimezoneKey
        ? roster.filter((participant) => comparisonTimezoneKey(participant.timezone) !== baseTimezoneKey)
        : [];
      return { roster, compatible, excluded, baseTimezone };
    }

    function setComparisonInputStatus(message, state = "") {
      elements.compareInputStatus.textContent = message;
      if (state) elements.compareInputStatus.dataset.state = state;
      else delete elements.compareInputStatus.dataset.state;
    }

    function setComparisonCollectionStatus(message, state = "") {
      if (!elements.compareCollectionStatus) return;
      elements.compareCollectionStatus.textContent = message;
      if (state) elements.compareCollectionStatus.dataset.state = state;
      else delete elements.compareCollectionStatus.dataset.state;
    }

    function syncComparisonCollectionControls() {
      const hasParticipants = comparisonParticipants.length > 0;
      if (elements.compareCollectionSave) elements.compareCollectionSave.disabled = !hasParticipants;
      if (elements.compareCollectionShare) elements.compareCollectionShare.disabled = !hasParticipants;
    }

    function describeComparisonCollectionState() {
      syncComparisonCollectionControls();
      if (!comparisonParticipants.length) {
        setComparisonCollectionStatus("취합할 일정을 추가하고 이름을 입력하면 저장할 수 있어요.");
        return;
      }
      if (!elements.compareCollectionName?.value.trim()) {
        setComparisonCollectionStatus("저장하거나 공유하려면 취합 일정 이름을 입력해 주세요.", "warning");
        return;
      }
      if (activeComparisonCollectionId && comparisonCollectionDirty) {
        setComparisonCollectionStatus("저장된 취합표에 반영하지 않은 변경사항이 있어요.", "warning");
        return;
      }
      if (activeComparisonCollectionId) {
        setComparisonCollectionStatus("이 취합표는 내 브라우저 보관함에 저장되어 있어요.", "success");
        return;
      }
      setComparisonCollectionStatus("현재 참여 일정과 보기 설정을 새 취합표로 저장할 수 있어요.");
    }

    function markComparisonCollectionDirty() {
      comparisonCollectionDirty = true;
      describeComparisonCollectionState();
    }

    function comparisonParticipantKey(schedule, participantSlots) {
      return makeShareHash(participantSlots, {
        title: schedule.title,
        timezone: schedule.timezone,
        startHour: schedule.startHour,
        // 시작 요일은 선택 데이터가 아니라 작성 화면의 보기 순서라서 중복 판별에서 제외한다.
        startDay: 0,
      });
    }

    function appendComparisonSchedules(schedules) {
      let added = 0;
      let duplicateCount = 0;
      schedules.forEach((schedule) => {
        const participantSlots = schedule.slots instanceof Uint8Array
          ? schedule.slots.slice()
          : decodeSlots(schedule.slots);
        const participant = {
          title: cleanMeta(schedule.title, DEFAULT_TITLE, 60),
          timezone: cleanMeta(schedule.timezone, "Asia/Seoul", 40),
          startHour: normalizeStartHour(schedule.startHour, 0),
          startDay: normalizeStartDay(schedule.startDay, 0),
          slots: participantSlots,
        };
        const key = comparisonParticipantKey(participant, participantSlots);
        if (comparisonParticipants.some((item) => item.key === key)) {
          duplicateCount += 1;
          return;
        }
        comparisonParticipants.push({
          ...participant,
          id: nextParticipantId,
          key,
        });
        nextParticipantId += 1;
        added += 1;
      });
      return { added, duplicateCount };
    }

    function comparisonCollectionSnapshot() {
      return comparisonParticipants.map((participant) => ({
        title: participant.title,
        timezone: participant.timezone,
        startHour: participant.startHour,
        startDay: participant.startDay,
        slots: participant.slots.slice(),
      }));
    }

    function applyComparisonCollection(record) {
      comparisonParticipants = [];
      nextParticipantId = 1;
      appendComparisonSchedules(record.members || []);
      elements.compareCollectionName.value = record.name || "";
      elements.compareCollectionName.removeAttribute("aria-invalid");
      elements.compareStartHour.value = String(normalizeStartHour(record.startHour, 8));
      elements.compareStartDay.value = String(normalizeStartDay(record.startDay, 0));
      activeComparisonCollectionId = record.id || null;
      comparisonCollectionDirty = false;
    }

    function cleanComparisonLocation({ removeCollection = false, removeGroupHash = false } = {}) {
      const parameters = new URLSearchParams(window.location.search || "");
      if (removeCollection) parameters.delete("collection");
      const search = parameters.toString();
      const hash = removeGroupHash ? "" : (window.location.hash || "");
      const cleanLocation = `${window.location.pathname}${search ? `?${search}` : ""}${hash}`;
      try {
        window.history.replaceState(null, "", cleanLocation);
      } catch (_error) {
        if (removeGroupHash) window.location.hash = "";
      }
    }

    function loadInitialComparisonCollection() {
      const api = savedComparisonsApi();
      if (!api) return false;

      const shareHash = window.location.hash || "";
      if (shareHash.startsWith(`#${api.SHARE_PARAMETER || "g"}=`)) {
        let shared;
        let stored = null;
        try {
          shared = api.parseShareHash(shareHash);
          try {
            stored = api.saveComparison(window.localStorage, shared);
          } catch (_error) {
            // 저장 공간을 사용할 수 없어도 공유받은 취합표는 계속 열 수 있다.
          }
          applyComparisonCollection(stored || shared);
          setComparisonCollectionStatus(
            stored
              ? "공유받은 취합표를 내 브라우저 보관함에 저장했어요."
              : "공유받은 취합표를 열었지만 브라우저 보관함에는 저장하지 못했어요.",
            stored ? "success" : "warning",
          );
          showToast(`${shared.name} 취합표를 불러왔어요`);
        } catch (error) {
          setComparisonCollectionStatus(error.message || "공유받은 취합표를 읽지 못했어요.", "error");
          showToast("공유 취합 링크가 손상되어 열지 못했어요");
        } finally {
          cleanComparisonLocation({ removeCollection: true, removeGroupHash: true });
        }
        return Boolean(shared);
      }

      const parameters = new URLSearchParams(window.location.search || "");
      const collectionId = parameters.get("collection");
      if (!collectionId) return false;
      try {
        const record = api.get(window.localStorage, collectionId);
        if (!record) {
          setComparisonCollectionStatus("저장된 취합표를 찾지 못했어요. 보관함에서 다시 열어 주세요.", "error");
          return false;
        }
        applyComparisonCollection(record);
        setComparisonCollectionStatus("저장된 취합표를 불러왔어요.", "success");
        return true;
      } catch (_error) {
        setComparisonCollectionStatus("브라우저 보관함에서 취합표를 읽지 못했어요.", "error");
        return false;
      } finally {
        cleanComparisonLocation({ removeCollection: true });
      }
    }

    function requireComparisonCollectionName() {
      const name = elements.compareCollectionName.value.trim();
      if (name) {
        elements.compareCollectionName.removeAttribute("aria-invalid");
        return name;
      }
      elements.compareCollectionName.setAttribute("aria-invalid", "true");
      elements.compareCollectionName.focus();
      setComparisonCollectionStatus("취합 일정 이름을 먼저 입력해 주세요.", "error");
      showToast("취합 일정 이름을 입력해 주세요");
      return null;
    }

    function saveCurrentComparisonCollection() {
      const api = savedComparisonsApi();
      if (!api) {
        setComparisonCollectionStatus("취합표 저장 기능을 불러오지 못했어요.", "error");
        return null;
      }
      if (!comparisonParticipants.length) {
        setComparisonCollectionStatus("먼저 한 명 이상의 일정을 추가해 주세요.", "error");
        return null;
      }
      const name = requireComparisonCollectionName();
      if (!name) return null;
      try {
        const record = api.saveComparison(window.localStorage, {
          name,
          startHour: currentComparisonStartHour(),
          startDay: currentComparisonStartDay(),
          members: comparisonCollectionSnapshot(),
        }, activeComparisonCollectionId ? { id: activeComparisonCollectionId } : {});
        activeComparisonCollectionId = record.id;
        comparisonCollectionDirty = false;
        elements.compareCollectionName.value = record.name;
        setComparisonCollectionStatus(`${record.name} 취합표를 내 브라우저 보관함에 저장했어요.`, "success");
        return record;
      } catch (error) {
        setComparisonCollectionStatus(error.message || "취합표를 저장하지 못했어요.", "error");
        showToast("취합표를 저장하지 못했어요");
        return null;
      }
    }

    async function copyCurrentComparisonCollection() {
      const record = saveCurrentComparisonCollection();
      if (!record) return;
      try {
        const baseUrl = new URL("./compare.html", window.location.href);
        baseUrl.search = "";
        baseUrl.hash = "";
        await copyPlainText(savedComparisonsApi().makeShareUrl(baseUrl.toString(), record));
        setComparisonCollectionStatus("취합표 공유 링크를 복사했어요. 받은 사람도 같은 취합 결과를 열 수 있어요.", "success");
        showToast("취합표 공유 링크를 복사했어요");
      } catch (error) {
        setComparisonCollectionStatus(error.message || "취합표 공유 링크를 복사하지 못했어요.", "error");
        showToast("공유 링크를 복사하지 못했어요");
      }
    }

    function addComparisonLinks() {
      const inputs = elements.compareLinks.value.match(/\S+/g) || [];
      if (!inputs.length) {
        setComparisonInputStatus("추가할 언제표 공유 링크를 붙여넣어 주세요.", "error");
        elements.compareLinks.focus();
        return;
      }

      let added = 0;
      let duplicateCount = 0;
      const invalidInputs = [];
      const invalidMessages = [];

      inputs.forEach((input) => {
        try {
          const schedule = parseShareInput(input);
          const result = appendComparisonSchedules([schedule]);
          added += result.added;
          duplicateCount += result.duplicateCount;
        } catch (error) {
          invalidInputs.push(input);
          invalidMessages.push(error.message || "링크 형식을 읽지 못했습니다.");
        }
      });

      elements.compareLinks.value = invalidInputs.join("\n");
      const messages = [];
      if (added) messages.push(`${added}개의 일정을 추가했어요.`);
      if (duplicateCount) messages.push(`이미 있는 링크 ${duplicateCount}개는 건너뛰었어요.`);
      if (invalidInputs.length) messages.push(`읽지 못한 ${invalidInputs.length}개는 입력창에 남겨뒀어요: ${invalidMessages[0]}`);
      const state = invalidInputs.length || duplicateCount ? "warning" : added ? "success" : "error";
      setComparisonInputStatus(messages.join(" ") || "추가된 일정이 없어요.", state);
      renderComparison();
      if (added) {
        markComparisonCollectionDirty();
        showToast(`${added}명의 가능 시간을 겹침표에 반영했어요`);
      }
    }

    function renderParticipantList(roster, excluded) {
      elements.participantList.replaceChildren();
      elements.participantCount.textContent = String(roster.length);
      elements.compareClear.disabled = roster.length === 0;

      if (!roster.length) {
        const empty = document.createElement("p");
        empty.className = "participant-empty";
        empty.textContent = "아직 추가한 일정이 없어요.";
        elements.participantList.append(empty);
        return;
      }

      const excludedIds = new Set(excluded.map((participant) => participant.id));
      roster.forEach((participant) => {
        const chip = document.createElement("span");
        chip.className = "participant-chip";
        chip.setAttribute("role", "listitem");
        chip.style.setProperty("--participant-color", participantColors[(participant.id - 1) % participantColors.length]);
        if (excludedIds.has(participant.id)) chip.classList.add("is-excluded");
        chip.title = `${participant.displayName} · 가능한 시간 ${countSelected(participant.slots)}칸 · ${participant.timezone}`;

        const name = document.createElement("span");
        name.textContent = participant.displayName;
        chip.append(name);

        if (excludedIds.has(participant.id)) {
          const note = document.createElement("small");
          note.textContent = "시간대 제외";
          chip.append(note);
        }

        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.participantId = String(participant.id);
        remove.setAttribute("aria-label", `${participant.displayName} 일정 제거`);
        remove.textContent = "×";
        chip.append(remove);
        elements.participantList.append(chip);
      });
    }

    function resetComparisonDetail() {
      if (comparisonActiveIndex !== null) {
        const previous = comparisonCellElements[comparisonActiveIndex];
        previous?.classList.remove("is-active");
        previous?.setAttribute("aria-selected", "false");
      }
      comparisonActiveIndex = null;
      elements.compareDetail.replaceChildren();
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "↖";
      const message = document.createElement("p");
      message.textContent = comparisonRoster.length
        ? "시간 칸을 가리키거나 선택하면 가능한 사람과 불가능한 사람을 보여드려요."
        : "일정 링크를 추가한 뒤 시간 칸에서 겹치는 사람을 확인할 수 있어요.";
      elements.compareDetail.append(icon, message);
    }

    function showComparisonDetail(index) {
      const cell = comparisonCells[index];
      const element = comparisonCellElements[index];
      if (!cell || !element) return;

      if (comparisonActiveIndex !== null && comparisonActiveIndex !== index) {
        comparisonCellElements[comparisonActiveIndex]?.classList.remove("is-active");
        comparisonCellElements[comparisonActiveIndex]?.setAttribute("aria-selected", "false");
      }
      comparisonActiveIndex = index;
      element.classList.add("is-active");
      element.setAttribute("aria-selected", "true");

      const startHour = currentComparisonStartHour();
      const timelineHour = cell.hour < startHour ? cell.hour + HOURS : cell.hour;
      const startLabel = formatTimelineHour(timelineHour, startHour);
      const endLabel = formatTimelineHour(timelineHour + 1, startHour);
      const availableIndexes = new Set(cell.participantIndexes);
      const available = cell.participantIndexes.map((participantIndex) => comparisonRoster[participantIndex]);
      const unavailable = comparisonRoster.filter((_participant, participantIndex) => !availableIndexes.has(participantIndex));

      elements.compareDetail.replaceChildren();
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "●";
      const detail = document.createElement("p");
      const heading = document.createElement("strong");
      heading.textContent = `${DAYS[cell.day].full} ${startLabel}–${endLabel}`;
      detail.append(heading, ` · ${cell.count}/${comparisonRoster.length}명 가능`);
      detail.append(document.createElement("br"), "가능: ");

      if (available.length) {
        const names = document.createElement("span");
        names.className = "detail-participants";
        available.forEach((participant) => {
          const name = document.createElement("span");
          name.textContent = participant.displayName;
          names.append(name);
        });
        detail.append(names);
      } else {
        detail.append("없음");
      }

      if (unavailable.length) {
        const unavailableText = document.createElement("span");
        unavailableText.className = "detail-unavailable";
        unavailableText.textContent = ` · 불가능: ${unavailable.map((participant) => participant.displayName).join(", ")}`;
        detail.append(unavailableText);
      }
      elements.compareDetail.append(icon, detail);
    }

    function createComparisonGrid(aggregate, roster) {
      elements.compareGrid.replaceChildren();
      comparisonCellElements = [];
      const startDay = currentComparisonStartDay();
      const dayOrder = displayDayIndexes(startDay);
      elements.compareGrid.setAttribute(
        "aria-label",
        `${DAYS[startDay].full}부터 ${DAYS[dayOrder[dayOrder.length - 1]].full}까지 시간별 가능 인원`,
      );
      const fragment = document.createDocumentFragment();
      const headerRow = document.createElement("div");
      headerRow.className = "compare-grid-row";
      headerRow.setAttribute("role", "row");

      const corner = document.createElement("div");
      corner.className = "compare-corner";
      corner.setAttribute("role", "columnheader");
      corner.textContent = "시간";
      headerRow.append(corner);
      dayOrder.forEach((dayIndex) => {
        const day = DAYS[dayIndex];
        const header = document.createElement("div");
        header.className = "compare-day";
        header.dataset.day = String(dayIndex);
        header.setAttribute("role", "columnheader");
        header.textContent = day.short;
        headerRow.append(header);
      });
      fragment.append(headerRow);

      const startHour = currentComparisonStartHour();
      displayHours(startHour).forEach((hour) => {
        const row = document.createElement("div");
        row.className = "compare-grid-row";
        row.setAttribute("role", "row");
        const timelineHour = hour < startHour ? hour + HOURS : hour;
        const startLabel = formatTimelineHour(timelineHour, startHour);
        const endLabel = formatTimelineHour(timelineHour + 1, startHour);
        const isNextDayStart = startHour !== 0 && hour === 0;

        const time = document.createElement("div");
        time.className = "compare-time";
        if (isNextDayStart) time.classList.add("next-day-start");
        time.setAttribute("role", "rowheader");
        time.textContent = startLabel;
        row.append(time);

        dayOrder.forEach((day) => {
          const index = slotIndex(hour, day);
          const cell = aggregate.cells[index];
          const names = cell.participantIndexes.map((participantIndex) => roster[participantIndex].displayName);
          const level = overlapColorLevel(cell.count);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "compare-cell";
          if (isNextDayStart) button.classList.add("next-day-start");
          button.dataset.index = String(index);
          button.dataset.count = String(cell.count);
          button.dataset.level = String(level);
          button.setAttribute("role", "gridcell");
          button.setAttribute("aria-selected", "false");
          button.setAttribute(
            "aria-label",
            `${DAYS[day].full} ${startLabel}부터 ${endLabel}까지, ${roster.length}명 중 ${cell.count}명 가능, 자세히 보기`,
          );
          button.title = names.length
            ? `${DAYS[day].short} ${startLabel}–${endLabel}\n${cell.count}명: ${names.join(", ")}`
            : `${DAYS[day].short} ${startLabel}–${endLabel}\n가능한 사람 없음`;
          button.tabIndex = index === comparisonRovingIndex ? 0 : -1;
          button.textContent = cell.count ? `${cell.count}명` : "–";
          comparisonCellElements[index] = button;
          row.append(button);
        });
        fragment.append(row);
      });
      elements.compareGrid.append(fragment);
    }

    function renderComparison() {
      const { roster, compatible, excluded, baseTimezone } = comparisonView();
      renderParticipantList(roster, excluded);

      if (!roster.length) {
        elements.compareTimezoneStatus.textContent = "링크를 추가하면 기준 시간대를 확인해요.";
        delete elements.compareTimezoneStatus.dataset.state;
      } else if (excluded.length) {
        elements.compareTimezoneStatus.textContent = `${baseTimezone} 기준 ${compatible.length}명만 비교해요. 다른 시간대 ${excluded.length}명은 정확히 변환할 수 없어 제외했어요.`;
        elements.compareTimezoneStatus.dataset.state = "warning";
      } else {
        elements.compareTimezoneStatus.textContent = `${baseTimezone} 기준 · ${compatible.length}명 모두 같은 시간대예요.`;
        elements.compareTimezoneStatus.dataset.state = "ok";
      }

      const startHour = currentComparisonStartHour();
      const startDay = currentComparisonStartDay();
      const aggregate = aggregateSchedules(compatible, startHour);
      comparisonCells = aggregate.cells;
      comparisonRoster = compatible;
      comparisonActiveIndex = null;
      comparisonRovingIndex = slotIndex(startHour, startDay);
      createComparisonGrid(aggregate, compatible);
      resetComparisonDetail();
      elements.compareGridScroller.scrollTop = 0;
      elements.compareMaxCount.textContent = String(aggregate.maxCount);

      if (!compatible.length) {
        elements.compareSummaryText.textContent = "링크를 추가하면 가장 많이 겹치는 시간을 찾아드려요.";
      } else if (aggregate.maxCount === 0) {
        elements.compareSummaryText.textContent = `${compatible.length}명의 선택 중 겹치는 가능한 시간이 아직 없어요.`;
      } else {
        const bestCellCount = aggregate.cells.filter((cell) => cell.count === aggregate.maxCount).length;
        const result = aggregate.maxCount === compatible.length
          ? `${bestCellCount}칸에서 ${compatible.length}명 전원이 가능해요.`
          : `${bestCellCount}칸에서 최대 ${aggregate.maxCount}/${compatible.length}명이 가능해요.`;
        elements.compareSummaryText.textContent = excluded.length
          ? `${result} 다른 시간대 ${excluded.length}명은 제외했어요.`
          : result;
      }
      syncComparisonCollectionControls();
    }

    function setComparisonRovingFocus(index, shouldFocus = true) {
      if (!Number.isInteger(index) || !comparisonCellElements[index]) return;
      comparisonCellElements[comparisonRovingIndex]?.setAttribute("tabindex", "-1");
      comparisonRovingIndex = index;
      comparisonCellElements[index].tabIndex = 0;
      if (shouldFocus) comparisonCellElements[index].focus({ preventScroll: false });
    }

    function handleComparisonKeydown(event) {
      const element = event.target.closest(".compare-cell");
      if (!element) return;
      const index = Number(element.dataset.index);
      const { hour, day } = slotCoordinates(index);
      const startHour = currentComparisonStartHour();
      const startDay = currentComparisonStartDay();
      const rowOffset = (hour - startHour + HOURS) % HOURS;
      const columnOffset = (day - startDay + DAYS.length) % DAYS.length;
      const lastDay = (startDay + DAYS.length - 1) % DAYS.length;
      let destination = null;

      if (event.key === "ArrowLeft" && columnOffset > 0) destination = slotIndex(hour, (day + DAYS.length - 1) % DAYS.length);
      else if (event.key === "ArrowRight" && columnOffset < DAYS.length - 1) destination = slotIndex(hour, (day + 1) % DAYS.length);
      else if (event.key === "ArrowUp" && rowOffset > 0) destination = slotIndex((hour + HOURS - 1) % HOURS, day);
      else if (event.key === "ArrowDown" && rowOffset < HOURS - 1) destination = slotIndex((hour + 1) % HOURS, day);
      else if (event.key === "Home") destination = event.ctrlKey ? slotIndex(startHour, startDay) : slotIndex(hour, startDay);
      else if (event.key === "End") destination = event.ctrlKey
        ? slotIndex((startHour + HOURS - 1) % HOURS, lastDay)
        : slotIndex(hour, lastDay);
      else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setComparisonRovingFocus(index, false);
        showComparisonDetail(index);
        return;
      } else if (event.key === "Escape") {
        event.preventDefault();
        resetComparisonDetail();
        return;
      }

      if (destination !== null) {
        event.preventDefault();
        setComparisonRovingFocus(destination);
        showComparisonDetail(destination);
      }
    }

    function initScheduleApp() {
      if (!elements.grid) return false;
      if (window.location.hash === "#compare") {
        window.location.replace("./compare.html");
        return true;
      }
      loadInitialState();
      rovingIndex = slotIndex(currentStartHour(), currentStartDay());
      createGrid();
      renderAll();

      elements.grid.addEventListener("pointerdown", startDrag);
      document.addEventListener("pointermove", continueDrag, { passive: false });
      document.addEventListener("pointerup", finishDrag);
      document.addEventListener("pointercancel", finishDrag);

      document.querySelectorAll("[data-preset]").forEach((button) => {
        button.addEventListener("click", () => applyPreset(button.dataset.preset));
      });
      elements.undo.addEventListener("click", () => {
        if (!history.length) return;
        slots = history.pop();
        renderAll();
        announce("마지막 선택을 되돌렸습니다.");
      });
      elements.clear.addEventListener("click", () => {
        commitMutation(() => slots.fill(0), "모든 선택을 지웠습니다.");
      });
      elements.reset.addEventListener("click", resetSchedule);
      elements.title.addEventListener("input", () => {
        elements.title.removeAttribute("aria-invalid");
        saveDraft();
      });
      elements.timezone.addEventListener("input", saveDraft);
      elements.startHour.addEventListener("change", () => {
        rebuildScheduleGrid();
        announce(`하루 시작을 ${formatHour(currentStartHour())}로 바꿨습니다.`);
      });
      elements.startDay.addEventListener("change", () => {
        rebuildScheduleGrid();
        announce(`${DAYS[currentStartDay()].full}부터 보이도록 순서를 바꿨습니다. 기존 선택은 유지됩니다.`);
      });
      elements.linkButton.addEventListener("click", copyLink);
      elements.textButton.addEventListener("click", copyScheduleText);
      elements.imageButton.addEventListener("click", copyImage);
      elements.pngButton.addEventListener("click", savePng);

      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener("click", (event) => {
          const target = document.querySelector(anchor.getAttribute("href"));
          if (!target) return;
          event.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          saveDraft();
        });
      });

      window.requestAnimationFrame(() => {
        elements.scroller.scrollTop = 0;
        if (initialMessage) showToast(initialMessage);
      });
      return false;
    }

    function initComparisonApp() {
      if (!elements.compareGrid) return;
      const comparisonApi = savedComparisonsApi();
      const hasInitialCollection = Boolean(
        (comparisonApi && (window.location.hash || "").startsWith(`#${comparisonApi.SHARE_PARAMETER || "g"}=`))
        || new URLSearchParams(window.location.search || "").has("collection")
      );
      loadInitialComparisonCollection();
      renderComparison();
      if (!hasInitialCollection) describeComparisonCollectionState();
      try {
        const savedApi = savedSchedulesApi();
        const queued = savedApi?.consumeComparisonQueue(window.sessionStorage);
        if (queued?.hashes?.length) {
          elements.compareLinks.value = queued.hashes.join("\n");
          addComparisonLinks();
        }
      } catch (_error) {
        // 세션 저장소가 막혀 있으면 기존 링크 붙여넣기 흐름을 그대로 제공한다.
      }
      elements.compareAdd.addEventListener("click", addComparisonLinks);
      elements.compareLinks.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          addComparisonLinks();
        }
      });
      elements.compareStartHour.addEventListener("change", () => {
        renderComparison();
        markComparisonCollectionDirty();
        setComparisonInputStatus(`결과의 하루 시작을 ${formatHour(currentComparisonStartHour())}로 바꿨어요.`, "success");
      });
      elements.compareStartDay.addEventListener("change", () => {
        renderComparison();
        markComparisonCollectionDirty();
        setComparisonInputStatus(`결과를 ${DAYS[currentComparisonStartDay()].full}부터 보이도록 바꿨어요.`, "success");
      });
      elements.compareClear.addEventListener("click", () => {
        comparisonParticipants = [];
        renderComparison();
        markComparisonCollectionDirty();
        setComparisonInputStatus("추가한 일정을 모두 비웠어요.", "success");
      });
      elements.participantList.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-participant-id]");
        if (!remove) return;
        const participantId = Number(remove.dataset.participantId);
        const participant = comparisonParticipants.find((item) => item.id === participantId);
        comparisonParticipants = comparisonParticipants.filter((item) => item.id !== participantId);
        renderComparison();
        markComparisonCollectionDirty();
        setComparisonInputStatus(`${participant?.title || "일정"} 일정을 제거했어요.`, "success");
      });
      elements.compareCollectionName?.addEventListener("input", () => {
        elements.compareCollectionName.removeAttribute("aria-invalid");
        markComparisonCollectionDirty();
      });
      elements.compareCollectionSave?.addEventListener("click", () => {
        const record = saveCurrentComparisonCollection();
        if (record) showToast(`${record.name} 취합표를 저장했어요`);
      });
      elements.compareCollectionShare?.addEventListener("click", copyCurrentComparisonCollection);
      window.addEventListener?.("hashchange", () => {
        const api = savedComparisonsApi();
        if (!api || !(window.location.hash || "").startsWith(`#${api.SHARE_PARAMETER || "g"}=`)) return;
        loadInitialComparisonCollection();
        renderComparison();
      });
      elements.compareGrid.addEventListener("pointerover", (event) => {
        const cell = event.target.closest(".compare-cell");
        if (cell) showComparisonDetail(Number(cell.dataset.index));
      });
      elements.compareGrid.addEventListener("focusin", (event) => {
        const cell = event.target.closest(".compare-cell");
        if (cell) showComparisonDetail(Number(cell.dataset.index));
      });
      elements.compareGrid.addEventListener("click", (event) => {
        const cell = event.target.closest(".compare-cell");
        if (!cell) return;
        const index = Number(cell.dataset.index);
        setComparisonRovingFocus(index, false);
        showComparisonDetail(index);
      });
      elements.compareGrid.addEventListener("keydown", handleComparisonKeydown);
    }

    const redirectedFromLegacyComparison = initScheduleApp();
    if (!redirectedFromLegacyComparison) initComparisonApp();
  }

  const api = {
    DEFAULT_TITLE,
    MAX_OVERLAP_LEVEL,
    DAYS,
    HOURS,
    SLOT_COUNT,
    SLOT_BYTES,
    slotIndex,
    slotCoordinates,
    createSlots,
    isSelected,
    setSelected,
    countSelected,
    encodeSlots,
    decodeSlots,
    normalizeStartHour,
    displayHours,
    normalizeStartDay,
    displayDayIndexes,
    makeShareHash,
    parseShareHash,
    makeShareUrl,
    selectedRanges,
    formatTimelineHour,
    formatScheduleText,
    parseShareInput,
    aggregateSchedules,
    overlapColorLevel,
    renderScheduleImage,
    canvasToBlob,
    slotsEqual,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Eonjepyo = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initApps);
    else initApps();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
