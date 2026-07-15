"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  createSlots,
  encodeSlots,
  isSelected,
  makeShareHash,
  parseShareHash,
  setSelected,
  slotIndex,
} = require("../app.js");
const saved = require("../saved-schedules.js");
const comparisons = require("../saved-comparisons.js");

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries).map(([key, value]) => [key, String(value)]));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class WriteFailingStorage extends MemoryStorage {
  setItem() {
    throw new Error("저장소 쓰기 실패");
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
    };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.tabIndex = -1;
    this.scrollTop = 0;
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  closest() { return null; }
  cloneNode() {
    const clone = new FakeElement();
    clone.value = this.value;
    clone.textContent = this.textContent;
    return clone;
  }
}

function runBrowserPage(ids, options = {}) {
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  const body = new FakeElement("body");
  const localStorage = options.localStorage || new MemoryStorage();
  const sessionStorage = options.sessionStorage || new MemoryStorage();
  const historyCalls = [];
  const clipboardWrites = [];
  const document = {
    readyState: "complete",
    body,
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll() { return []; },
    createElement() { return new FakeElement(); },
    createDocumentFragment() { return new FakeElement(); },
    createTextNode(value) { return String(value); },
    elementFromPoint() { return null; },
    addEventListener() {},
    execCommand() { return true; },
  };
  const location = {
    pathname: options.pathname || "/schedule-maker/",
    search: options.search || "",
    hash: options.hash || "",
    href: "",
    replace(value) { this.replacedWith = value; },
  };
  location.href = `https://example.test${location.pathname}${location.search}${location.hash}`;
  const window = {
    location,
    localStorage,
    sessionStorage,
    history: {
      replaceState(_state, _unused, value) {
        historyCalls.push(String(value));
        const nextUrl = new URL(String(value), location.href);
        location.pathname = nextUrl.pathname;
        location.search = nextUrl.search;
        location.hash = nextUrl.hash;
        location.href = nextUrl.href;
      },
    },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    confirm() { return true; },
    isSecureContext: true,
  };
  const context = {
    Buffer,
    URL,
    URLSearchParams,
    Intl,
    Uint8Array,
    Date,
    Math,
    Set,
    Map,
    String,
    Number,
    Array,
    Object,
    RegExp,
    Error,
    TypeError,
    RangeError,
    Promise,
    document,
    window,
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(String(value)); } } },
  };
  context.globalThis = context;
  const directory = path.join(__dirname, "..");
  vm.runInNewContext(
    fs.readFileSync(path.join(directory, "saved-schedules.js"), "utf8"),
    context,
    { filename: "schedule-maker/saved-schedules.js" },
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(directory, "saved-comparisons.js"), "utf8"),
    context,
    { filename: "schedule-maker/saved-comparisons.js" },
  );
  vm.runInNewContext(
    fs.readFileSync(path.join(directory, "app.js"), "utf8"),
    context,
    { filename: "schedule-maker/app.js" },
  );
  return { elements, historyCalls, clipboardWrites, localStorage, sessionStorage, location };
}

const WRITER_PAGE_IDS = [
  "titleInput", "startHourSelect", "startDaySelect", "timezoneInput", "rangeLabel",
  "scheduleGrid", "scheduleScroller", "selectedCount", "selectionProgress", "undoButton",
  "clearButton", "resetButton", "liveRegion", "linkButton", "linkLabel", "textButton",
  "textLabel", "imageButton", "imageLabel", "pngButton", "toast",
];

const COMPARE_PAGE_IDS = [
  "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
  "compareInputStatus", "participantArea", "participantCount", "participantList",
  "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
  "compareGrid", "compareGridScroller", "compareDetail", "compareCollectionNameInput",
  "compareSaveCollectionButton", "compareCopyCollectionLinkButton", "compareCollectionSaveStatus", "toast",
];

test("작성·취합·목록 페이지는 저장 모듈을 앱보다 먼저 불러온다", () => {
  const directory = path.join(__dirname, "..");
  for (const filename of ["index.html", "compare.html", "saved.html"]) {
    const html = fs.readFileSync(path.join(directory, filename), "utf8");
    const savedModule = html.indexOf("saved-schedules.js");
    const app = html.indexOf("app.js");
    assert.ok(savedModule >= 0, `${filename}에서 저장 모듈을 불러와야 합니다`);
    assert.ok(app > savedModule, `${filename}에서 저장 모듈은 app.js보다 먼저 실행되어야 합니다`);
    if (filename === "saved.html") {
      assert.ok(html.indexOf("saved-page.js") > app, "목록 컨트롤러는 공용 API 뒤에 실행되어야 합니다");
    }
  }
});

function makeSchedule(title, selectedIndex = slotIndex(9, 0), overrides = {}) {
  const slots = createSlots();
  setSelected(slots, selectedIndex, true);
  return {
    title,
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
    slots,
    ...overrides,
  };
}

test("저장 모듈은 브라우저와 계약한 CRUD·전달 큐 API를 공개한다", () => {
  for (const name of [
    "list",
    "readSavedSchedules",
    "get",
    "getSavedSchedule",
    "saveSchedule",
    "upsertSavedSchedule",
    "updateTitle",
    "remove",
    "deleteSavedSchedule",
    "setDraftFromSaved",
    "queueForComparison",
    "consumeComparisonQueue",
    "queueSavedScheduleAction",
    "consumeSavedScheduleAction",
  ]) {
    assert.equal(typeof saved[name], "function", `${name} 함수가 필요합니다`);
  }
  assert.equal(typeof saved.STORAGE_KEY, "string");
  assert.equal(typeof saved.ACTION_KEY, "string");
  assert.equal(typeof saved.DRAFT_KEY, "string");
});

test("일정을 저장하면 직렬화된 레코드로 목록과 개별 조회에서 복원된다", () => {
  const storage = new MemoryStorage();
  const schedule = makeSchedule("쵸하", slotIndex(22, 4));
  const record = saved.saveSchedule(storage, schedule, {
    id: "choha",
    now: 1000,
    source: "shared-link",
  });

  assert.equal(record.id, "choha");
  assert.equal(record.title, "쵸하");
  assert.equal(record.slots, encodeSlots(schedule.slots));
  assert.equal(record.createdAt, 1000);
  assert.equal(record.updatedAt, 1000);
  assert.equal(record.source, "shared-link");
  assert.equal(saved.list(storage).length, 1);
  assert.deepEqual(saved.get(storage, "choha"), record);

  const restored = parseShareHash(record.canonicalHash);
  assert.equal(restored.title, "쵸하");
  assert.equal(isSelected(restored.slots, slotIndex(22, 4)), true);

  record.title = "외부에서 바꾼 값";
  assert.equal(saved.get(storage, "choha").title, "쵸하", "반환값 수정이 저장본을 바꾸면 안 됩니다");
});

test("같은 공유 일정을 다시 자동 저장하면 새 항목을 만들지 않고 갱신한다", () => {
  const storage = new MemoryStorage();
  const schedule = makeSchedule("휴이스", slotIndex(1, 6));
  const first = saved.saveSchedule(storage, schedule, { now: 100, source: "shared-link" });
  const second = saved.saveSchedule(storage, {
    ...schedule,
    slots: schedule.slots.slice(),
  }, { now: 200, source: "shared-link" });

  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, 100);
  assert.equal(second.updatedAt, 200);
  assert.equal(saved.list(storage).length, 1);
});

test("공유 URL을 열면 목록에 자동 저장한 뒤 개별 일정 목록으로 바로 이동한다", () => {
  const storage = new MemoryStorage();
  const incoming = makeSchedule("공유받은 일정", slotIndex(1, 6), { startDay: 5 });
  const hash = makeShareHash(incoming.slots, incoming);
  const first = runBrowserPage(WRITER_PAGE_IDS, {
    localStorage: storage,
    hash,
    search: "?from=discord&load=stale",
  });

  assert.equal(first.location.replacedWith, "./saved.html#saved-schedules");
  const records = saved.list(storage);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "공유받은 일정");
  assert.equal(records[0].source, "shared");

  const reopened = runBrowserPage(WRITER_PAGE_IDS, { localStorage: storage, hash });
  assert.equal(reopened.location.replacedWith, "./saved.html#saved-schedules");
  assert.equal(saved.list(storage).length, 1, "같은 공유 링크를 다시 열어도 중복 저장하면 안 됩니다");
});

test("이름이 빠진 이전 공유 URL도 기본 이름으로 저장하고 목록으로 이동한다", () => {
  const storage = new MemoryStorage();
  const incoming = makeSchedule("임시 이름", slotIndex(2, 4));
  const parameters = new URLSearchParams(makeShareHash(incoming.slots, incoming).slice(1));
  parameters.delete("t");

  const result = runBrowserPage(WRITER_PAGE_IDS, {
    localStorage: storage,
    hash: `#${parameters.toString()}`,
  });

  assert.equal(result.location.replacedWith, "./saved.html#saved-schedules");
  const records = saved.list(storage);
  assert.equal(records.length, 1);
  assert.equal(records[0].title, "우리의 가능한 시간");
  assert.equal(records[0].source, "shared");
  assert.equal(isSelected(parseShareHash(records[0].canonicalHash).slots, slotIndex(2, 4)), true);
});

test("일반 작성 진입과 기존 #compare 북마크는 저장 목록으로 보내지 않는다", () => {
  const direct = runBrowserPage(WRITER_PAGE_IDS, {
    pathname: "/schedule-maker/",
  });
  assert.equal(direct.location.replacedWith, undefined);
  assert.equal(saved.list(direct.localStorage).length, 0);

  const comparisonBookmark = runBrowserPage(WRITER_PAGE_IDS, {
    pathname: "/schedule-maker/",
    hash: "#compare",
  });
  assert.equal(comparisonBookmark.location.replacedWith, "./compare.html");
  assert.equal(saved.list(comparisonBookmark.localStorage).length, 0);
});

test("손상된 공유 URL이나 저장 실패는 목록으로 이동하지 않고 작성 화면에 남는다", () => {
  const broken = runBrowserPage(WRITER_PAGE_IDS, {
    pathname: "/schedule-maker/",
    hash: "#v=1&t=%EC%86%90%EC%83%81&s=broken",
  });
  assert.equal(broken.location.replacedWith, undefined);
  assert.equal(broken.location.hash, "");
  assert.equal(saved.list(broken.localStorage).length, 0);

  const incoming = makeSchedule("저장 실패 일정", slotIndex(23, 6));
  const writeFailingStorage = new WriteFailingStorage();
  const failed = runBrowserPage(WRITER_PAGE_IDS, {
    pathname: "/schedule-maker/",
    localStorage: writeFailingStorage,
    hash: makeShareHash(incoming.slots, incoming),
  });
  assert.equal(failed.location.replacedWith, undefined);
  assert.equal(failed.elements.get("titleInput").value, "저장 실패 일정");
  assert.equal(failed.elements.get("selectedCount").textContent, "1");
});

test("이름 수정·개별 조회·삭제가 선택 데이터와 생성 시각을 보존한다", () => {
  const storage = new MemoryStorage();
  const first = saved.saveSchedule(storage, makeSchedule("수정 전"), {
    id: "editable",
    now: 10,
    source: "manual",
  });
  saved.saveSchedule(storage, makeSchedule("다른 일정", slotIndex(15, 3)), {
    id: "other",
    now: 15,
  });

  const renamed = saved.updateTitle(storage, first.id, "  수정 후  ", { now: 20 });
  assert.equal(renamed.title, "수정 후");
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.createdAt, 10);
  assert.equal(renamed.updatedAt, 20);
  assert.equal(renamed.slots, first.slots);
  assert.throws(() => saved.updateTitle(storage, first.id, "   "), /이름/);
  assert.throws(() => saved.updateTitle(storage, "missing", "새 이름"), /찾지 못/);

  assert.equal(saved.remove(storage, first.id), true);
  assert.equal(saved.get(storage, first.id), null);
  assert.equal(saved.remove(storage, first.id), false);
  assert.deepEqual(saved.list(storage).map((record) => record.id), ["other"]);
});

test("깨진 JSON·버전·레코드는 원문을 격리하고 초기화나 정상 복원 전까지 변경을 막는다", () => {
  const raw = "{broken";
  const storage = new MemoryStorage({ [saved.STORAGE_KEY]: raw });
  assert.throws(() => saved.list(storage), (error) => error.code === "CORRUPT_STORAGE");
  assert.equal(storage.getItem(saved.RECOVERY_KEY), raw);
  assert.equal(storage.getItem(saved.STORAGE_KEY), raw);
  assert.throws(() => saved.saveSchedule(storage, makeSchedule("덮으면 안 됨")), /손상/);
  assert.equal(storage.getItem(saved.STORAGE_KEY), raw);

  saved.resetCorruptDocument(storage);
  assert.equal(storage.getItem(saved.RECOVERY_KEY), null);
  assert.deepEqual(saved.list(storage), []);

  const wrongVersion = JSON.stringify({ version: 999, items: [] });
  storage.setItem(saved.STORAGE_KEY, wrongVersion);
  assert.throws(() => saved.list(storage), /손상/);
  assert.equal(storage.getItem(saved.RECOVERY_KEY), wrongVersion);

  const validStorage = new MemoryStorage();
  const valid = saved.saveSchedule(validStorage, makeSchedule("정상"), {
    id: "valid",
    now: 30,
  });
  storage.setItem(saved.STORAGE_KEY, JSON.stringify({
    version: saved.STORAGE_VERSION,
    items: [
      { id: "broken", title: "손상", slots: "not-base64url" },
      null,
      valid,
    ],
  }));
  assert.throws(() => saved.list(storage), /손상/);
  assert.equal(storage.getItem(saved.RECOVERY_KEY), wrongVersion, "최초 격리 원문을 덮으면 안 된다");

  storage.setItem(saved.STORAGE_KEY, validStorage.getItem(saved.STORAGE_KEY));
  assert.deepEqual(saved.list(storage).map((record) => record.id), ["valid"], "정상 백업 복원은 잠금을 해제한다");
  assert.equal(storage.getItem(saved.RECOVERY_KEY), null);
});

test("저장 일정을 불러오기로 넘기면 기존 작성 draft 형식으로 기록한다", () => {
  const storage = new MemoryStorage();
  const original = makeSchedule("불러올 일정", slotIndex(3, 2), { startDay: 5 });
  const record = saved.saveSchedule(storage, original, { id: "load-me", now: 40 });

  const loaded = saved.setDraftFromSaved(storage, record.id);
  assert.equal(loaded.id, record.id);
  assert.equal(storage.getItem(saved.DRAFT_KEY), record.canonicalHash);

  const draft = parseShareHash(storage.getItem(saved.DRAFT_KEY));
  assert.equal(draft.title, "불러올 일정");
  assert.equal(draft.startDay, 5);
  assert.equal(isSelected(draft.slots, slotIndex(3, 2)), true);
  assert.throws(() => saved.setDraftFromSaved(storage, "missing"), /찾지 못/);
});

test("여러 저장 일정은 중복 ID 없이 취합 큐에 담기고 한 번만 소비된다", () => {
  const storage = new MemoryStorage();
  const first = saved.saveSchedule(storage, makeSchedule("쵸하"), { id: "choha", now: 50 });
  const second = saved.saveSchedule(storage, makeSchedule("휴이스", slotIndex(10, 1)), {
    id: "huis",
    now: 60,
  });

  const queued = saved.queueForComparison(storage, [first.id, first.id, second.id], { now: 70 });
  assert.deepEqual(queued.ids, [first.id, second.id]);
  assert.deepEqual(queued.hashes, [first.canonicalHash, second.canonicalHash]);
  assert.equal(queued.type, "compare");
  assert.equal(queued.createdAt, 70);

  const consumed = saved.consumeComparisonQueue(storage);
  assert.deepEqual(consumed, queued);
  assert.equal(storage.getItem(saved.ACTION_KEY), null);
  assert.equal(saved.consumeComparisonQueue(storage), null);
  assert.throws(() => saved.queueForComparison(storage, []), /선택/);
  assert.throws(() => saved.queueForComparison(storage, ["missing"]), /찾지 못/);
});

test("저장 목록이 만든 취합 큐는 취합 페이지에서 즉시 소비해 참여자로 반영한다", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const first = saved.saveSchedule(localStorage, makeSchedule("쵸하"), { id: "choha", now: 120 });
  const second = saved.saveSchedule(localStorage, makeSchedule("휴이스", slotIndex(9, 0)), {
    id: "huis",
    now: 130,
  });
  saved.queueForComparison(localStorage, [first.id, second.id], {
    now: 140,
    actionStorage: sessionStorage,
  });

  const result = runBrowserPage(COMPARE_PAGE_IDS, {
    pathname: "/schedule-maker/compare.html",
    localStorage,
    sessionStorage,
  });

  assert.equal(result.elements.get("participantCount").textContent, "2");
  assert.equal(localStorage.getItem(saved.ACTION_KEY), null, "목록 저장소에는 전달 큐를 섞지 않습니다");
  assert.equal(sessionStorage.getItem(saved.ACTION_KEY), null, "사용한 취합 큐는 지워야 합니다");
});

test("취합 화면에서 이름을 붙여 저장하고 공유 링크를 복사할 때 현재 주소는 바꾸지 않는다", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const first = saved.saveSchedule(localStorage, makeSchedule("쵸하"), { id: "choha", now: 120 });
  const second = saved.saveSchedule(localStorage, makeSchedule("휴이스", slotIndex(10, 1)), {
    id: "huis",
    now: 130,
  });
  saved.queueForComparison(localStorage, [first.id, second.id], { actionStorage: sessionStorage });
  const result = runBrowserPage(COMPARE_PAGE_IDS, {
    pathname: "/schedule-maker/compare.html",
    localStorage,
    sessionStorage,
  });

  await result.elements.get("compareCopyCollectionLinkButton").listeners.get("click")();
  assert.equal(result.clipboardWrites.length, 0);
  assert.equal(result.elements.get("compareCollectionNameInput").focused, true);

  const nameInput = result.elements.get("compareCollectionNameInput");
  nameInput.value = "금요일 새벽 공대";
  nameInput.listeners.get("input")();
  result.elements.get("compareSaveCollectionButton").listeners.get("click")();

  const stored = comparisons.list(localStorage);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, "금요일 새벽 공대");
  assert.equal(stored[0].members.length, 2);

  const addressBeforeCopy = result.location.href;
  await result.elements.get("compareCopyCollectionLinkButton").listeners.get("click")();
  assert.equal(result.clipboardWrites.length, 1);
  assert.match(result.clipboardWrites[0], /\/schedule-maker\/compare\.html#g=/);
  assert.equal(result.location.href, addressBeforeCopy);
});

test("공유받은 취합 링크는 자동 보관하고 참여자를 복원한 뒤 주소에서 공유 데이터를 지운다", () => {
  const localStorage = new MemoryStorage();
  const members = [
    makeSchedule("쵸하", slotIndex(20, 0)),
    makeSchedule("휴이스", slotIndex(1, 6), { startDay: 5 }),
  ];
  const hash = comparisons.makeShareHash({
    name: "공유받은 고정 공대",
    startHour: 11,
    startDay: 5,
    members,
  });
  const result = runBrowserPage(COMPARE_PAGE_IDS, {
    pathname: "/schedule-maker/compare.html",
    localStorage,
    hash,
  });

  assert.equal(result.elements.get("participantCount").textContent, "2");
  assert.equal(result.elements.get("compareCollectionNameInput").value, "공유받은 고정 공대");
  assert.equal(result.elements.get("compareStartHourSelect").value, "11");
  assert.equal(result.elements.get("compareStartDaySelect").value, "5");
  assert.equal(result.location.hash, "");
  assert.ok(result.historyCalls.length > 0);
  assert.equal(comparisons.list(localStorage).length, 1);
});

test("불러오기 동작 큐는 하나의 일정만 허용하고 손상된 큐는 제거한다", () => {
  const storage = new MemoryStorage();
  const first = saved.saveSchedule(storage, makeSchedule("첫 일정"), { id: "first", now: 80 });
  const second = saved.saveSchedule(storage, makeSchedule("둘째 일정", slotIndex(11, 2)), {
    id: "second",
    now: 90,
  });

  assert.throws(
    () => saved.queueSavedScheduleAction(storage, { type: "load", ids: [first.id, second.id] }),
    /하나만/,
  );
  assert.throws(
    () => saved.queueSavedScheduleAction(storage, { type: "unknown", ids: [first.id] }),
    /지원하지/,
  );

  const queued = saved.queueSavedScheduleAction(
    storage,
    { type: "load", ids: [first.id] },
    { now: 100 },
  );
  assert.equal(saved.consumeSavedScheduleAction(storage).hashes[0], queued.hashes[0]);
  assert.equal(saved.consumeSavedScheduleAction(storage), null);

  storage.setItem(saved.ACTION_KEY, JSON.stringify({
    version: saved.STORAGE_VERSION,
    type: "compare",
    ids: [first.id],
    hashes: ["#v=1&s=broken"],
    createdAt: 110,
  }));
  assert.equal(saved.consumeSavedScheduleAction(storage), null);
  assert.equal(storage.getItem(saved.ACTION_KEY), null);
});
