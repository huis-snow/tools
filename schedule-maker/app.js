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
  const DRAFT_KEY = "eonjepyo-draft";
  const DRAFT_RECOVERY_KEY = `${DRAFT_KEY}:recovery`;
  const PERSISTED_STORAGE_KEYS = [
    "eonjepyo-saved-schedules-v1",
    "eonjepyo-saved-schedules-v1:recovery",
    "eonjepyo-saved-comparisons-v1",
    "eonjepyo-saved-comparisons-v1:recovery",
    DRAFT_KEY,
    DRAFT_RECOVERY_KEY,
  ];
  let selectedPersistentStorage = null;

  function fallbackStorage() {
    try {
      return root.localStorage || root.window?.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function persistentStorage() {
    return selectedPersistentStorage || fallbackStorage();
  }

  function draftRecoveryValue() {
    try {
      return persistentStorage()?.getItem?.(DRAFT_RECOVERY_KEY) ?? null;
    } catch (_error) {
      return null;
    }
  }

  function quarantineDraft(raw) {
    try {
      const storage = persistentStorage();
      if (storage?.getItem?.(DRAFT_RECOVERY_KEY) === null) storage.setItem(DRAFT_RECOVERY_KEY, String(raw));
    } catch (_error) {
      // Keep the unread primary draft untouched when a separate copy cannot be written.
    }
  }

  function clearDraftRecovery() {
    try {
      persistentStorage()?.removeItem?.(DRAFT_RECOVERY_KEY);
    } catch (_error) {
      // A valid repaired draft remains usable even if recovery cleanup is unavailable.
    }
  }

  async function prepareBrowserStorage(keys = PERSISTED_STORAGE_KEYS) {
    const fallback = fallbackStorage();
    const vault = root.SmallToolsVault;
    if (!vault) {
      selectedPersistentStorage = fallback;
      return fallback;
    }
    try {
      await vault.ready;
      if (typeof vault.migrateKeys !== "function") throw new Error("보관함 이전 기능을 사용할 수 없습니다.");
      await vault.migrateKeys(keys, { removeSource: true });
      if (!vault.storage || typeof vault.storage.getItem !== "function" || typeof vault.storage.setItem !== "function") {
        throw new Error("보관함 저장소를 사용할 수 없습니다.");
      }
      selectedPersistentStorage = vault.storage;
    } catch (_error) {
      selectedPersistentStorage = fallback;
    }
    return selectedPersistentStorage;
  }

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

  function wrapCanvasText(context, value, maximumWidth, maximumLines = 2) {
    const words = String(value).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const lines = [];
    let line = "";

    words.forEach((word) => {
      if (lines.length >= maximumLines) return;
      const candidate = line ? `${line} ${word}` : word;
      if (!line || context.measureText(candidate).width <= maximumWidth) {
        line = candidate;
        return;
      }
      lines.push(line);
      line = word;
    });
    if (line && lines.length < maximumLines) lines.push(line);

    const source = words.join(" ");
    const rendered = lines.join(" ");
    if (rendered !== source && lines.length) {
      lines[lines.length - 1] = truncateCanvasText(context, lines[lines.length - 1], maximumWidth);
    } else if (lines.length) {
      lines[lines.length - 1] = truncateCanvasText(context, lines[lines.length - 1], maximumWidth);
    }
    return lines;
  }

  async function renderComparisonImage(participants, metadata = {}, options = {}) {
    if (!Array.isArray(participants) || !participants.length) {
      throw new Error("이미지로 만들 취합 일정이 한 명 이상 필요합니다.");
    }
    if (typeof document === "undefined") throw new Error("이미지는 브라우저에서만 만들 수 있습니다.");

    const roster = participants.map((participant, index) => ({
      ...participant,
      displayName: cleanMeta(
        participant?.displayName || participant?.title,
        `참여자 ${index + 1}`,
        60,
      ),
      timezone: cleanMeta(participant?.timezone, "Asia/Seoul", 40),
    }));
    const startHour = normalizeStartHour(metadata.startHour, 8);
    const startDay = normalizeStartDay(metadata.startDay, 0);
    const dayOrder = displayDayIndexes(startDay);
    const aggregate = aggregateSchedules(roster, startHour);
    const mode = ["overlap", "all", "selected"].includes(options.mode)
      ? options.mode
      : "overlap";
    const selectedIndexSource = Array.isArray(options.selectedIndexes)
      ? options.selectedIndexes
      : options.selectedIndexes instanceof Set
        ? Array.from(options.selectedIndexes)
        : [];
    const selectedIndexes = new Set(selectedIndexSource
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < SLOT_COUNT));
    if (mode === "selected" && selectedIndexes.size === 0) {
      throw new Error("이미지에 표시할 시간 칸을 하나 이상 선택해 주세요.");
    }
    const title = cleanMeta(metadata.title, "함께 가능한 시간", 60);
    const timezone = cleanMeta(metadata.timezone, roster[0].timezone, 40);
    const excluded = Array.isArray(metadata.excluded)
      ? metadata.excluded.map((participant, index) => cleanMeta(
        typeof participant === "string" ? participant : participant?.displayName || participant?.title,
        `제외 일정 ${index + 1}`,
        60,
      ))
      : [];
    const maximumCells = aggregate.maxCount > 0
      ? aggregate.cells.filter((cell) => cell.count === aggregate.maxCount).length
      : 0;
    const everyoneCells = aggregate.cells.filter((cell) => cell.count === roster.length).length;
    const imageHourOrder = displayHours(startHour);
    const isCellInImageScope = (cell) => mode === "overlap"
      ? cell.count > 0
      : mode === "all"
        ? cell.count === roster.length
        : selectedIndexes.has(cell.index);
    const relevantRowOffsets = imageHourOrder
      .map((hour, rowOffset) => dayOrder.some((day) => (
        isCellInImageScope(aggregate.cells[slotIndex(hour, day)])
      )) ? rowOffset : -1)
      .filter((rowOffset) => rowOffset >= 0);
    const firstRowOffset = relevantRowOffsets[0] ?? 0;
    const lastRowOffset = relevantRowOffsets[relevantRowOffsets.length - 1] ?? -1;
    const imageHours = relevantRowOffsets.length
      ? imageHourOrder.slice(firstRowOffset, lastRowOffset + 1)
      : [];

    const scale = options.scale || 2;
    const width = 1040;
    const gridX = 124;
    const gridY = 222;
    const gridWidth = 880;
    const headerHeight = 45;
    const rowHeight = 30;
    const gridHeight = headerHeight + imageHours.length * rowHeight;
    const height = gridY + gridHeight + 92;
    const fontFamily = '"Schedule D2Coding", "D2Coding", monospace';
    const overlapAlphas = [0, 0.14, 0.24, 0.34, 0.44, 0.54, 0.66, 0.8, 1];

    if (document.fonts) {
      await document.fonts.load('400 16px "Schedule D2Coding"', "월화수목금토일 익일 참여 제외 최대 겹침");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 캔버스를 만들지 못했습니다.");
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
    context.fillText("언제표 · GROUP AVAILABILITY", 102, 30);

    context.font = `400 25px ${fontFamily}`;
    context.fillStyle = "#153c34";
    context.fillText(truncateCanvasText(context, title, 700), 36, 78);

    context.font = `400 12px ${fontFamily}`;
    context.fillStyle = "#708078";
    context.fillText(
      `기준 시간대  ${timezone}  ·  하루 시작  ${formatHour(startHour)}  ·  시작 요일  ${DAYS[startDay].full}`,
      38,
      114,
    );
    context.textAlign = "right";
    const maximumSummary = mode === "all"
      ? `집계 참여 ${roster.length}명  ·  전원 가능 ${everyoneCells}칸`
      : mode === "selected"
        ? `집계 참여 ${roster.length}명  ·  직접 선택 ${selectedIndexes.size}칸`
        : maximumCells
          ? `집계 참여 ${roster.length}명  ·  최대 겹침 ${aggregate.maxCount}/${roster.length}명  ·  ${maximumCells}칸`
          : `집계 참여 ${roster.length}명  ·  최대 겹침 0/${roster.length}명`;
    context.fillText(maximumSummary, width - 36, 114);

    context.textAlign = "left";
    context.font = `400 11px ${fontFamily}`;
    context.fillStyle = "#405f55";
    wrapCanvasText(
      context,
      `참여 일정  ${roster.map((participant) => participant.displayName).join(" · ")}`,
      width - 76,
      2,
    ).forEach((line, index) => context.fillText(line, 38, 148 + index * 20));

    if (excluded.length) {
      context.fillStyle = "#d8522a";
      context.fillText(
        truncateCanvasText(context, `집계 제외  ${excluded.join(" · ")}  ·  기준 시간대와 다름`, width - 76),
        38,
        194,
      );
    }

    context.fillStyle = "#153c34";
    context.fillRect(36, gridY, width - 72, headerHeight);
    context.font = `400 12px ${fontFamily}`;
    context.textAlign = "center";
    context.fillStyle = "#dce8df";
    context.fillText("시간", 80, gridY + headerHeight / 2);

    dayOrder.forEach((day, columnIndex) => {
      const left = gridX + Math.round((columnIndex * gridWidth) / DAYS.length);
      const right = gridX + Math.round(((columnIndex + 1) * gridWidth) / DAYS.length);
      context.fillStyle = day === 6 ? "#ffc2ae" : day === 5 ? "#b9d1d8" : "#ffffff";
      context.fillText(DAYS[day].short, (left + right) / 2, gridY + headerHeight / 2);
    });

    imageHours.forEach((hour, croppedRowOffset) => {
      const sourceRowOffset = firstRowOffset + croppedRowOffset;
      const top = gridY + headerHeight + croppedRowOffset * rowHeight;
      context.fillStyle = sourceRowOffset % 2 ? "#f7f8ef" : "#fffdf5";
      context.fillRect(36, top, width - 72, rowHeight);
      context.font = `400 ${hour < startHour ? 9 : 10}px ${fontFamily}`;
      context.fillStyle = "#60736c";
      context.textAlign = "center";
      context.fillText(`${hour < startHour ? "익일 " : ""}${formatHour(hour)}`, 80, top + rowHeight / 2);

      dayOrder.forEach((day, columnIndex) => {
        const cell = aggregate.cells[slotIndex(hour, day)];
        const level = overlapColorLevel(cell.count);
        const isVisible = mode === "overlap" || isCellInImageScope(cell);
        const left = gridX + Math.round((columnIndex * gridWidth) / DAYS.length);
        const right = gridX + Math.round(((columnIndex + 1) * gridWidth) / DAYS.length);
        if (isVisible && (level > 0 || mode === "selected")) {
          context.fillStyle = mode === "all"
            ? "#f36c3f"
            : level === 0
              ? "#ffebe2"
              : level === MAX_OVERLAP_LEVEL
                ? "#f36c3f"
                : `rgba(243, 108, 63, ${overlapAlphas[level]})`;
          context.fillRect(left + 1, top + 1, right - left - 1, rowHeight - 1);
        }
        if (mode === "selected" && isVisible) {
          context.strokeStyle = "#d8522a";
          context.lineWidth = 1.5;
          context.strokeRect(left + 2, top + 2, right - left - 4, rowHeight - 4);
        }
        if (isVisible) {
          context.font = `600 10px ${fontFamily}`;
          context.fillStyle = mode === "all"
            ? "#0f2e27"
            : level >= 6
              ? "#ffffff"
              : level
                ? "#153c34"
                : "#8f4a35";
          const cellLabel = cell.count ? `${cell.count}명` : mode === "selected" ? "0명" : "–";
          context.fillText(cellLabel, (left + right) / 2, top + rowHeight / 2 + 0.5);
        }
      });
    });

    context.fillStyle = "#9aaba1";
    for (let rowOffset = 0; rowOffset <= imageHours.length; rowOffset += 1) {
      const y = gridY + headerHeight + rowOffset * rowHeight;
      context.fillRect(36, y, width - 72, 1);
    }
    context.fillRect(gridX - 1, gridY, 1, gridHeight);
    for (let day = 0; day <= DAYS.length; day += 1) {
      const x = gridX + Math.round((day * gridWidth) / DAYS.length);
      context.fillRect(x, gridY, 1, gridHeight);
    }
    if (startHour !== 0 && imageHours.length) {
      const midnightOffset = HOURS - startHour;
      const croppedMidnightOffset = midnightOffset - firstRowOffset;
      if (croppedMidnightOffset > 0 && croppedMidnightOffset < imageHours.length) {
        const midnightY = gridY + headerHeight + croppedMidnightOffset * rowHeight;
        context.fillStyle = "#f36c3f";
        context.fillRect(36, midnightY, width - 72, 2);
      }
    }

    const footerY = gridY + gridHeight + 42;
    context.font = `400 10px ${fontFamily}`;
    context.textAlign = "left";
    context.fillStyle = "#61766e";
    if (mode === "overlap") {
      context.fillText("겹치는 인원", 38, footerY);
      for (let level = 1; level <= MAX_OVERLAP_LEVEL; level += 1) {
        const x = 116 + (level - 1) * 33;
        context.fillStyle = level === MAX_OVERLAP_LEVEL
          ? "#f36c3f"
          : `rgba(243, 108, 63, ${overlapAlphas[level]})`;
        context.fillRect(x, footerY - 8, 24, 16);
      }
      context.fillStyle = "#61766e";
      context.fillText("1명", 116, footerY + 25);
      context.fillText("8명+", 331, footerY + 25);
    } else {
      context.fillStyle = "#f36c3f";
      context.fillRect(38, footerY - 8, 24, 16);
      context.fillStyle = "#61766e";
      context.fillText(
        mode === "all"
          ? `전원 가능한 시간만 표시 · ${everyoneCells}칸`
          : `직접 선택한 시간만 표시 · ${selectedIndexes.size}칸`,
        74,
        footerY,
      );
    }
    context.textAlign = "right";
    context.fillText("언제표에서 만든 가능 시간 취합표", width - 36, footerY);

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
      compareImageMode: document.querySelector("#compareImageMode"),
      compareImageSelectedCount: document.querySelector("#compareImageSelectedCount"),
      compareImageSelectionClear: document.querySelector("#compareImageSelectionClearButton"),
      compareImageSelectionStatus: document.querySelector("#compareImageSelectionStatus"),
      compareImageScopeHelp: document.querySelector("#compareImageScopeHelp"),
      compareImageButton: document.querySelector("#compareImageButton"),
      compareImageLabel: document.querySelector("#compareImageLabel"),
      comparePngButton: document.querySelector("#comparePngButton"),
      compareImageStatus: document.querySelector("#compareImageStatus"),
    };

    const onlineRoomMode = typeof document.body?.classList?.contains === "function" &&
      document.body.classList.contains("online-room-page");
    let slots = createSlots();
    let history = [];
    let slotElements = [];
    let dayButtons = [];
    let timeButtons = [];
    let rovingIndex = slotIndex(9, 0);
    let dragging = null;
    let toastTimer;
    let initialMessage = "";
    let draftRecoveryLocked = false;
    let activeSavedScheduleId = null;
    let comparisonParticipants = [];
    let nextParticipantId = 1;
    let comparisonCells = [];
    let comparisonRoster = [];
    let comparisonActiveIndex = null;
    let comparisonRovingIndex = slotIndex(8, 0);
    let comparisonCellElements = [];
    const comparisonImageSelectedIndexes = new Set();
    let activeComparisonCollectionId = null;
    let comparisonCollectionDirty = false;
    let comparisonImageBusy = false;
    let scheduleReadOnly = false;
    const participantColors = ["#f36c3f", "#2d765f", "#49778a", "#d69231", "#7b6aa8", "#b85167", "#42877d", "#6d7f35"];
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
      if (onlineRoomMode) return false;
      const shareHash = window.location.hash;
      if (shareHash && !anchorHashes.has(shareHash)) {
        activeSavedScheduleId = null;
        let redirectingToSavedList = false;
        try {
          const shared = parseShareHash(shareHash);
          if (shared) {
            slots = shared.slots;
            elements.title.value = shared.title === DEFAULT_TITLE ? "" : shared.title;
            elements.timezone.value = shared.timezone;
            elements.startHour.value = String(shared.startHour);
            elements.startDay.value = String(shared.startDay);
            try {
              const savedRecord = savedSchedulesApi()?.saveSchedule(persistentStorage(), shared, { source: "shared" });
              if (savedRecord) {
                redirectingToSavedList = true;
                const redirectToSavedList = () => window.location.replace("./saved.html#saved-schedules");
                if (persistentStorage() === root.SmallToolsVault?.storage && typeof root.SmallToolsVault.flush === "function") {
                  Promise.resolve(root.SmallToolsVault.flush()).catch(() => {
                    try {
                      const savedDocument = persistentStorage().getItem(savedSchedulesApi().STORAGE_KEY);
                      if (savedDocument !== null) fallbackStorage()?.setItem(savedSchedulesApi().STORAGE_KEY, savedDocument);
                    } catch (_error) {
                      // The shared URL remains available if neither durable store accepts the record.
                    }
                  }).finally(redirectToSavedList);
                } else {
                  redirectToSavedList();
                }
                return true;
              }
            } catch (_error) {
              // 저장 공간을 사용할 수 없어도 공유 일정 자체는 계속 열 수 있다.
              redirectingToSavedList = false;
            }
            initialMessage = "공유받은 일정표를 불러왔어요. 수정해도 원본은 바뀌지 않아요.";
          }
        } catch (_error) {
          slots = createSlots();
          initialMessage = "공유 링크가 손상되어 빈 일정표로 열었어요.";
        } finally {
          if (!redirectingToSavedList) cleanWriterLocation({ removeSavedAction: true });
        }
        return false;
      }

      const query = new URLSearchParams(window.location.search);
      const editId = query.get("edit");
      const loadId = query.get("load");
      if (editId || loadId) {
        try {
          const stored = savedSchedulesApi()?.get(persistentStorage(), editId || loadId);
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

      let draft = null;
      let draftRead = false;
      try {
        draft = persistentStorage().getItem(DRAFT_KEY);
        draftRead = true;
        if (draft === null) {
          if (draftRecoveryValue() !== null) {
            draftRecoveryLocked = true;
            initialMessage = "지난 초안이 손상되어 자동 저장을 멈췄어요. ‘초기화’를 눌러 새로 시작해 주세요.";
          }
          return;
        }
        const restored = parseShareHash(draft);
        if (!restored) throw new Error("저장된 초안 데이터가 없습니다.");
        clearDraftRecovery();
        slots = restored.slots;
        elements.title.value = restored.title === DEFAULT_TITLE ? "" : restored.title;
        elements.timezone.value = restored.timezone;
        elements.startHour.value = String(restored.startHour);
        elements.startDay.value = String(restored.startDay);
        if (countSelected(slots)) initialMessage = "지난번에 칠하던 일정표를 불러왔어요.";
      } catch (_error) {
        slots = createSlots();
        if (draftRead && draft !== null) {
          quarantineDraft(draft);
          draftRecoveryLocked = true;
          initialMessage = "지난 초안이 손상되어 자동 저장을 멈췄어요. 손상 원본은 복구용으로 보관했으며 ‘초기화’를 눌러 새로 시작할 수 있어요.";
        } else {
          initialMessage = "브라우저 저장소에서 지난 초안을 읽지 못해 빈 일정표로 열었어요.";
        }
      }
      return false;
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
      elements.undo.disabled = scheduleReadOnly || history.length === 0;
      elements.clear.disabled = scheduleReadOnly || selected === 0;
      if (elements.reset) elements.reset.disabled = scheduleReadOnly;
    }

    function showDraftRecoveryWarning() {
      if (elements.reset) {
        elements.reset.title = "손상된 초안 원본은 복구용으로 보관했습니다. 눌러서 빈 일정표로 초기화하세요.";
        elements.reset.setAttribute?.("aria-label", "손상된 일정 초안을 빈 일정표로 초기화");
      }
      showToast("초안이 손상되어 자동 저장을 멈췄어요. ‘초기화’를 눌러 새로 시작해 주세요.");
    }

    function saveDraft({ repair = false } = {}) {
      if (onlineRoomMode) return true;
      if (draftRecoveryLocked && !repair) {
        showDraftRecoveryWarning();
        return false;
      }
      const hash = makeShareHash(slots, metadata());
      try {
        persistentStorage().setItem(DRAFT_KEY, hash);
        if (repair) {
          clearDraftRecovery();
          draftRecoveryLocked = false;
        }
      } catch (_error) {
        // Private browsing can disable localStorage; the current tab still keeps the state.
        return false;
      }
      try {
        const explicitTitle = elements.title.value.trim();
        if (activeSavedScheduleId && explicitTitle) {
          savedSchedulesApi()?.saveSchedule(persistentStorage(), {
            slots,
            ...metadata(),
            title: explicitTitle,
          }, { id: activeSavedScheduleId });
        }
      } catch (_error) {
        // A damaged saved-list document must not prevent the independent draft from being kept.
      }
      return true;
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

    async function resetSchedule() {
      const hasChanges = countSelected(slots) > 0 ||
        history.length > 0 ||
        elements.title.value.trim() !== "" ||
        (!onlineRoomMode && (
          elements.timezone.value.trim() !== detectedTimezone ||
          currentStartHour() !== 8 ||
          currentStartDay() !== 0
        ));
      const question = draftRecoveryLocked
        ? "읽지 못한 초안 원본은 복구용으로 따로 보관되어 있습니다. 빈 일정표로 초기화할까요?"
        : onlineRoomMode
          ? "닉네임과 선택한 시간을 모두 초기화할까요?"
          : "일정표 설정과 선택한 시간을 모두 초기화할까요?";
      if ((hasChanges || draftRecoveryLocked) && !window.confirm(question)) return;
      if (!onlineRoomMode && !await createRecoveryPoint("일정 초안 전체 초기화 전")) return;

      const resetStartHour = onlineRoomMode ? currentStartHour() : 8;
      const resetStartDay = onlineRoomMode ? currentStartDay() : 0;
      slots = createSlots();
      activeSavedScheduleId = null;
      history = [];
      dragging = null;
      elements.title.value = "";
      if (!onlineRoomMode) elements.timezone.value = detectedTimezone;
      elements.startHour.value = String(resetStartHour);
      elements.startDay.value = String(resetStartDay);
      rovingIndex = slotIndex(resetStartHour, resetStartDay);
      createGrid();
      renderAll({ save: false });
      if (!saveDraft({ repair: draftRecoveryLocked })) {
        showToast("빈 일정표를 저장하지 못했어요");
        return;
      }
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

    async function createRecoveryPoint(label) {
      if (typeof root.SmallToolsVault?.createRecoveryPoint !== "function") return true;
      try {
        await root.SmallToolsVault.createRecoveryPoint(label);
        return true;
      } catch (_error) {
        showToast("복원 지점을 만들지 못해 작업을 취소했어요");
        return false;
      }
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
        savedSchedulesApi()?.saveSchedule(persistentStorage(), {
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
        const baseKey = comparisonParticipantKey(participant, participantSlots);
        const remoteId = typeof schedule.remoteId === "string" ? schedule.remoteId : "";
        const key = remoteId ? `${remoteId}:${baseKey}` : baseKey;
        if (comparisonParticipants.some((item) => item.key === key)) {
          duplicateCount += 1;
          return;
        }
        comparisonParticipants.push({
          ...participant,
          remoteId,
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
      comparisonImageSelectedIndexes.clear();
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
            stored = api.saveComparison(persistentStorage(), shared);
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
        const record = api.get(persistentStorage(), collectionId);
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
        const record = api.saveComparison(persistentStorage(), {
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

    function setComparisonImageStatus(message) {
      if (elements.compareImageStatus) elements.compareImageStatus.textContent = message;
    }

    function currentComparisonImageMode() {
      const mode = elements.compareImageMode?.value;
      return ["overlap", "all", "selected"].includes(mode) ? mode : "overlap";
    }

    function comparisonEveryoneCellCount() {
      if (!comparisonRoster.length) return 0;
      return comparisonCells.filter((cell) => cell.count === comparisonRoster.length).length;
    }

    function syncComparisonImageSelectionPresentation() {
      const mode = currentComparisonImageMode();
      const isSelecting = mode === "selected";
      const selectedCount = comparisonImageSelectedIndexes.size;
      if (elements.compareImageSelectedCount) {
        elements.compareImageSelectedCount.textContent = String(selectedCount);
      }
      if (elements.compareImageSelectionStatus) {
        elements.compareImageSelectionStatus.hidden = !isSelecting;
      }
      if (elements.compareImageSelectionClear) {
        elements.compareImageSelectionClear.disabled = comparisonImageBusy || selectedCount === 0;
      }
      if (elements.compareGrid) {
        if (isSelecting) elements.compareGrid.classList.add("is-image-selecting");
        else elements.compareGrid.classList.remove("is-image-selecting");
        if (isSelecting) elements.compareGrid.setAttribute("aria-multiselectable", "true");
        else elements.compareGrid.removeAttribute("aria-multiselectable");
        elements.compareGrid.dataset.imageMode = mode;
      }

      comparisonCellElements.forEach((cell, index) => {
        if (!cell) return;
        const isSelected = comparisonImageSelectedIndexes.has(index);
        if (isSelected) cell.classList.add("is-image-selected");
        else cell.classList.remove("is-image-selected");
        cell.setAttribute("aria-selected", String(isSelecting && isSelected));
        const baseLabel = cell.dataset.baseAriaLabel || cell.getAttribute("aria-label") || "시간 칸";
        cell.dataset.baseAriaLabel = baseLabel;
        cell.setAttribute(
          "aria-label",
          isSelecting
            ? `${baseLabel}, 이미지 ${isSelected ? "선택됨, 선택 해제" : "선택에 추가"}`
            : baseLabel,
        );
      });
    }

    function syncComparisonImageControls(compatibleCount = comparisonView().compatible.length) {
      const needsSelection = currentComparisonImageMode() === "selected";
      const disabled = comparisonImageBusy
        || compatibleCount === 0
        || (needsSelection && comparisonImageSelectedIndexes.size === 0);
      if (elements.compareImageButton) elements.compareImageButton.disabled = disabled;
      if (elements.comparePngButton) elements.comparePngButton.disabled = disabled;
      if (elements.compareImageMode) elements.compareImageMode.disabled = comparisonImageBusy;
      if (elements.compareImageSelectionClear) {
        elements.compareImageSelectionClear.disabled = comparisonImageBusy
          || comparisonImageSelectedIndexes.size === 0;
      }
    }

    function describeComparisonImageScope(excludedCount = comparisonView().excluded.length) {
      const mode = currentComparisonImageMode();
      const compatibleCount = comparisonRoster.length;
      const exclusionNote = excludedCount ? ` 다른 시간대 ${excludedCount}명은 이미지 집계에서 제외돼요.` : "";
      let help = "겹치는 인원 현황을 모두 이미지에 표시해요.";
      let status = compatibleCount
        ? `현재 ${compatibleCount}명의 전체 취합 결과를 이미지로 복사하거나 저장할 수 있어요.${exclusionNote}`
        : onlineRoomMode
          ? "참여자가 일정을 저장하면 결과를 이미지로 내보낼 수 있어요."
          : "취합할 일정을 추가하면 결과를 이미지로 내보낼 수 있어요.";

      if (mode === "all") {
        const everyoneCells = comparisonEveryoneCellCount();
        help = "모두 가능한 시간만 진하게 남기고 다른 칸의 숫자는 숨겨요.";
        status = compatibleCount
          ? `${compatibleCount}명 전원이 가능한 ${everyoneCells}칸만 이미지에 표시해요.${exclusionNote}`
          : onlineRoomMode
            ? "참여자가 일정을 저장하면 전원 가능한 시간을 이미지로 내보낼 수 있어요."
            : "취합할 일정을 추가하면 전원 가능한 시간을 이미지로 내보낼 수 있어요.";
      } else if (mode === "selected") {
        const selectedCount = comparisonImageSelectedIndexes.size;
        help = selectedCount
          ? `표에서 고른 ${selectedCount}칸만 이미지에 표시해요. 칸을 다시 누르면 선택이 풀려요.`
          : "아래 표에서 이미지에 넣을 시간 칸을 눌러 선택해 주세요.";
        status = selectedCount
          ? `직접 고른 ${selectedCount}칸만 이미지로 복사하거나 저장해요.${exclusionNote}`
          : "직접 선택 모드예요. 아래 표에서 이미지에 넣을 시간 칸을 하나 이상 골라 주세요.";
      }

      if (elements.compareImageScopeHelp) elements.compareImageScopeHelp.textContent = help;
      setComparisonImageStatus(status);
    }

    function toggleComparisonImageSelection(index) {
      if (currentComparisonImageMode() !== "selected" || !comparisonCells[index]) return false;
      if (comparisonImageSelectedIndexes.has(index)) comparisonImageSelectedIndexes.delete(index);
      else comparisonImageSelectedIndexes.add(index);
      syncComparisonImageSelectionPresentation();
      syncComparisonImageControls(comparisonRoster.length);
      describeComparisonImageScope();
      return true;
    }

    function clearComparisonImageSelection() {
      if (!comparisonImageSelectedIndexes.size) return;
      comparisonImageSelectedIndexes.clear();
      syncComparisonImageSelectionPresentation();
      syncComparisonImageControls(comparisonRoster.length);
      describeComparisonImageScope();
    }

    function comparisonImageFilename() {
      const title = elements.compareCollectionName?.value.trim() || "eonjepyo-comparison";
      const safeTitle = title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 48).trim();
      return `${safeTitle || "eonjepyo-comparison"}.png`;
    }

    function comparisonImageBlobPromise() {
      const { compatible, excluded, baseTimezone } = comparisonView();
      if (!compatible.length) throw new Error("이미지로 만들 취합 일정이 없어요.");
      const snapshot = compatible.map((participant) => ({
        ...participant,
        slots: participant.slots.slice(),
      }));
      return renderComparisonImage(snapshot, {
        title: elements.compareCollectionName?.value.trim() || "함께 가능한 시간",
        timezone: baseTimezone || "Asia/Seoul",
        startHour: currentComparisonStartHour(),
        startDay: currentComparisonStartDay(),
        excluded,
      }, {
        mode: currentComparisonImageMode(),
        selectedIndexes: Array.from(comparisonImageSelectedIndexes),
      }).then(canvasToBlob);
    }

    async function copyComparisonImage() {
      comparisonImageBusy = true;
      syncComparisonImageControls();
      const original = "이미지 복사";
      if (elements.compareImageLabel) elements.compareImageLabel.textContent = "이미지 만드는 중";
      setComparisonImageStatus("현재 취합 결과를 이미지로 만들고 있어요.");

      try {
        const blobPromise = comparisonImageBlobPromise();
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
          if (elements.compareImageLabel) elements.compareImageLabel.textContent = "이미지 복사 완료!";
          setComparisonImageStatus("취합 결과 이미지를 복사했어요. 메신저 입력창에 붙여넣을 수 있어요.");
          showToast("취합 결과 이미지를 복사했어요");
        } else {
          downloadBlob(await blobPromise, comparisonImageFilename());
          if (elements.compareImageLabel) elements.compareImageLabel.textContent = "PNG 저장 완료!";
          setComparisonImageStatus("이미지 복사를 지원하지 않아 PNG 파일로 저장했어요.");
          showToast("이미지 복사를 지원하지 않아 PNG로 저장했어요");
        }
      } catch (error) {
        if (elements.compareImageLabel) elements.compareImageLabel.textContent = "다시 시도해 주세요";
        setComparisonImageStatus(error.message || "취합 결과 이미지를 만들지 못했어요.");
        showToast(error.message || "취합 결과 이미지를 만들지 못했어요");
      } finally {
        comparisonImageBusy = false;
        syncComparisonImageControls();
        window.setTimeout(() => {
          if (elements.compareImageLabel) elements.compareImageLabel.textContent = original;
        }, 1800);
      }
    }

    async function saveComparisonPng() {
      comparisonImageBusy = true;
      syncComparisonImageControls();
      setComparisonImageStatus("현재 취합 결과를 고해상도 PNG로 만들고 있어요.");
      try {
        downloadBlob(await comparisonImageBlobPromise(), comparisonImageFilename());
        setComparisonImageStatus("고해상도 취합 결과 PNG를 저장했어요.");
        showToast("고해상도 취합 결과 PNG를 저장했어요");
      } catch (error) {
        setComparisonImageStatus(error.message || "취합 결과 PNG를 저장하지 못했어요.");
        showToast(error.message || "취합 결과 PNG를 저장하지 못했어요");
      } finally {
        comparisonImageBusy = false;
        syncComparisonImageControls();
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
        empty.textContent = onlineRoomMode
          ? "아직 저장한 참여자가 없어요."
          : "아직 추가한 일정이 없어요.";
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
        if (participant.remoteId) {
          remove.dataset.remoteParticipantUid = participant.remoteId;
          remove.hidden = onlineRoomMode;
        }
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
      }
      comparisonActiveIndex = null;
      elements.compareDetail.replaceChildren();
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "↖";
      const message = document.createElement("p");
      message.textContent = comparisonRoster.length
        ? "시간 칸을 가리키거나 선택하면 가능한 사람과 불가능한 사람을 보여드려요."
        : onlineRoomMode
          ? "참여자가 저장한 뒤 시간 칸에서 가능한 사람을 확인할 수 있어요."
          : "일정 링크를 추가한 뒤 시간 칸에서 겹치는 사람을 확인할 수 있어요.";
      elements.compareDetail.append(icon, message);
    }

    function showComparisonDetail(index) {
      const cell = comparisonCells[index];
      const element = comparisonCellElements[index];
      if (!cell || !element) return;

      if (comparisonActiveIndex !== null && comparisonActiveIndex !== index) {
        comparisonCellElements[comparisonActiveIndex]?.classList.remove("is-active");
      }
      comparisonActiveIndex = index;
      element.classList.add("is-active");

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
          button.dataset.baseAriaLabel = `${DAYS[day].full} ${startLabel}부터 ${endLabel}까지, ${roster.length}명 중 ${cell.count}명 가능, 자세히 보기`;
          button.setAttribute("aria-label", button.dataset.baseAriaLabel);
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

    function renderComparison(options = {}) {
      const preserveView = options.preserveView === true;
      const previousScrollTop = preserveView ? elements.compareGridScroller.scrollTop : 0;
      const previousActiveIndex = preserveView ? comparisonActiveIndex : null;
      const previousRovingIndex = preserveView ? comparisonRovingIndex : null;
      const hadGridFocus = preserveView &&
        typeof elements.compareGrid.contains === "function" &&
        elements.compareGrid.contains(document.activeElement);
      const { roster, compatible, excluded, baseTimezone } = comparisonView();
      renderParticipantList(roster, excluded);

      if (!roster.length) {
        elements.compareTimezoneStatus.textContent = onlineRoomMode
          ? "참여자가 저장하면 기준 시간대를 확인해요."
          : "링크를 추가하면 기준 시간대를 확인해요.";
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
      comparisonRovingIndex = Number.isInteger(previousRovingIndex)
        ? previousRovingIndex
        : slotIndex(startHour, startDay);
      createComparisonGrid(aggregate, compatible);
      syncComparisonImageSelectionPresentation();
      if (compatible.length && previousActiveIndex !== null && comparisonCells[previousActiveIndex]) {
        showComparisonDetail(previousActiveIndex);
      } else {
        resetComparisonDetail();
      }
      elements.compareGridScroller.scrollTop = previousScrollTop;
      if (hadGridFocus) {
        comparisonCellElements[comparisonRovingIndex]?.focus?.({ preventScroll: true });
        elements.compareGridScroller.scrollTop = previousScrollTop;
      }
      elements.compareMaxCount.textContent = String(aggregate.maxCount);

      if (!compatible.length) {
        elements.compareSummaryText.textContent = onlineRoomMode
          ? "참여자가 저장하면 가장 많이 겹치는 시간을 찾아드려요."
          : "링크를 추가하면 가장 많이 겹치는 시간을 찾아드려요.";
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
      syncComparisonImageControls(compatible.length);
      if (!comparisonImageBusy) {
        describeComparisonImageScope(excluded.length);
      }
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
        toggleComparisonImageSelection(index);
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

    function currentScheduleSnapshot() {
      if (!elements.grid) return null;
      return {
        slots: slots.slice(),
        title: elements.title?.value?.trim?.() || "",
        timezone: cleanMeta(elements.timezone?.value, detectedTimezone, 40),
        startHour: normalizeStartHour(elements.startHour?.value, 8),
        startDay: normalizeStartDay(elements.startDay?.value, 0),
      };
    }

    function applyExternalSchedule(schedule = {}) {
      if (!elements.grid) return false;
      const nextSlots = schedule.slots instanceof Uint8Array
        ? schedule.slots.slice()
        : typeof schedule.slots === "string"
          ? decodeSlots(schedule.slots)
          : createSlots();
      slots = nextSlots;
      history = [];
      dragging = null;
      if (elements.title) elements.title.value = String(schedule.title ?? "").trim().slice(0, 60);
      if (elements.timezone) {
        elements.timezone.value = cleanMeta(schedule.timezone, detectedTimezone, 40);
      }
      if (elements.startHour) {
        elements.startHour.value = String(normalizeStartHour(schedule.startHour, 8));
      }
      if (elements.startDay) {
        elements.startDay.value = String(normalizeStartDay(schedule.startDay, 0));
      }
      rovingIndex = slotIndex(currentStartHour(), currentStartDay());
      createGrid();
      renderAll({ save: false });
      if (elements.scroller) elements.scroller.scrollTop = 0;
      return true;
    }

    function setScheduleConfigurationLocked(locked = true) {
      if (elements.startHour) elements.startHour.disabled = Boolean(locked);
      if (elements.startDay) elements.startDay.disabled = Boolean(locked);
      if (elements.timezone) elements.timezone.readOnly = Boolean(locked);
    }

    function setScheduleReadOnly(readOnly = true) {
      scheduleReadOnly = Boolean(readOnly);
      if (elements.title) elements.title.readOnly = scheduleReadOnly;
      slotElements.forEach((element) => {
        element.disabled = scheduleReadOnly;
      });
      dayButtons.forEach((element) => {
        if (element) element.disabled = scheduleReadOnly;
      });
      timeButtons.forEach((element) => {
        if (element) element.disabled = scheduleReadOnly;
      });
      document.querySelectorAll("[data-preset]").forEach((button) => {
        button.disabled = scheduleReadOnly;
      });
      updateStatus();
    }

    function replaceComparisonSchedules(schedules = [], options = {}) {
      if (!elements.compareGrid) return false;
      comparisonParticipants = [];
      if (options.preserveView !== true) comparisonImageSelectedIndexes.clear();
      nextParticipantId = 1;
      appendComparisonSchedules(Array.isArray(schedules) ? schedules : []);
      if (elements.compareStartHour) {
        elements.compareStartHour.value = String(normalizeStartHour(options.startHour, 8));
      }
      if (elements.compareStartDay) {
        elements.compareStartDay.value = String(normalizeStartDay(options.startDay, 0));
      }
      if (elements.compareCollectionName && typeof options.title === "string") {
        elements.compareCollectionName.value = options.title.trim().slice(0, 60);
      }
      renderComparison({ preserveView: options.preserveView === true });
      return true;
    }

    function initScheduleApp() {
      if (!elements.grid) return false;
      if (window.location.hash === "#compare") {
        window.location.replace("./compare.html");
        return true;
      }
      if (loadInitialState()) return true;
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
      elements.linkButton?.addEventListener("click", copyLink);
      elements.textButton?.addEventListener("click", copyScheduleText);
      elements.imageButton?.addEventListener("click", copyImage);
      elements.pngButton?.addEventListener("click", savePng);

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
        if (draftRecoveryLocked) showDraftRecoveryWarning();
      });
      return false;
    }

    function initComparisonApp() {
      if (!elements.compareGrid) return;
      if (elements.compareImageMode && !["overlap", "all", "selected"].includes(elements.compareImageMode.value)) {
        elements.compareImageMode.value = "overlap";
      }
      const comparisonApi = onlineRoomMode ? null : savedComparisonsApi();
      const hasInitialCollection = !onlineRoomMode && Boolean(
        (comparisonApi && (window.location.hash || "").startsWith(`#${comparisonApi.SHARE_PARAMETER || "g"}=`))
        || new URLSearchParams(window.location.search || "").has("collection")
      );
      if (!onlineRoomMode) loadInitialComparisonCollection();
      renderComparison();
      if (!onlineRoomMode) {
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
        elements.compareAdd?.addEventListener("click", addComparisonLinks);
        elements.compareLinks?.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            addComparisonLinks();
          }
        });
        elements.compareStartHour?.addEventListener("change", () => {
          comparisonImageSelectedIndexes.clear();
          renderComparison();
          markComparisonCollectionDirty();
          setComparisonInputStatus(`결과의 하루 시작을 ${formatHour(currentComparisonStartHour())}로 바꿨어요.`, "success");
        });
        elements.compareStartDay?.addEventListener("change", () => {
          renderComparison();
          markComparisonCollectionDirty();
          setComparisonInputStatus(`결과를 ${DAYS[currentComparisonStartDay()].full}부터 보이도록 바꿨어요.`, "success");
        });
        elements.compareClear?.addEventListener("click", () => {
          comparisonParticipants = [];
          comparisonImageSelectedIndexes.clear();
          renderComparison();
          markComparisonCollectionDirty();
          setComparisonInputStatus("추가한 일정을 모두 비웠어요.", "success");
        });
        elements.participantList?.addEventListener("click", (event) => {
          const remove = event.target.closest("[data-participant-id]");
          if (!remove) return;
          const participantId = Number(remove.dataset.participantId);
          const participant = comparisonParticipants.find((item) => item.id === participantId);
          comparisonParticipants = comparisonParticipants.filter((item) => item.id !== participantId);
          if (!comparisonParticipants.length) comparisonImageSelectedIndexes.clear();
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
      }
      elements.compareImageMode?.addEventListener("change", () => {
        syncComparisonImageSelectionPresentation();
        syncComparisonImageControls(comparisonRoster.length);
        describeComparisonImageScope();
      });
      elements.compareImageSelectionClear?.addEventListener("click", clearComparisonImageSelection);
      elements.compareImageButton?.addEventListener("click", copyComparisonImage);
      elements.comparePngButton?.addEventListener("click", saveComparisonPng);
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
        toggleComparisonImageSelection(index);
        showComparisonDetail(index);
      });
      elements.compareGrid.addEventListener("keydown", handleComparisonKeydown);
    }

    const redirectedFromScheduleApp = initScheduleApp();
    if (!redirectedFromScheduleApp) initComparisonApp();
    root.EonjepyoApp = {
      getSchedule: currentScheduleSnapshot,
      applySchedule: applyExternalSchedule,
      setScheduleConfigurationLocked,
      setScheduleReadOnly,
      replaceComparisonSchedules,
    };
    if (typeof root.CustomEvent === "function" && typeof document.dispatchEvent === "function") {
      document.dispatchEvent(new root.CustomEvent("eonjepyo:app-ready"));
    }
    if (elements.grid || elements.compareGrid) {
      window.addEventListener?.("storage", (event) => {
        if (root.EonjepyoStorage === root.SmallToolsVault?.storage && event.storageArea) return;
        if (event.key === null) window.location.reload?.();
      });
    }
  }

  const api = {
    DEFAULT_TITLE,
    DRAFT_KEY,
    DRAFT_RECOVERY_KEY,
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
    renderComparisonImage,
    canvasToBlob,
    slotsEqual,
    prepareBrowserStorage,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.Eonjepyo = api;

  if (typeof document !== "undefined") {
    const startApps = () => {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initApps, { once: true });
      else initApps();
    };
    const vault = root.SmallToolsVault;
    if (vault) {
      const storageReady = prepareBrowserStorage();
      root.EonjepyoStorageReady = storageReady;
      storageReady.then((storage) => {
        root.EonjepyoStorage = storage;
        startApps();
      });
    } else {
      selectedPersistentStorage = fallbackStorage();
      root.EonjepyoStorage = selectedPersistentStorage;
      root.EonjepyoStorageReady = Promise.resolve();
      startApps();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
