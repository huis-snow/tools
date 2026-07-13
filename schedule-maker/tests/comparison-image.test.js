"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const schedule = require("../app.js");

function participant(title, indexes, options = {}) {
  const slots = schedule.createSlots();
  indexes.forEach((index) => schedule.setSelected(slots, index, true));
  return {
    id: options.id || title,
    title,
    displayName: options.displayName || title,
    timezone: options.timezone || "Asia/Seoul",
    startHour: options.startHour ?? 8,
    startDay: options.startDay ?? 0,
    slots,
  };
}

function createCanvasHarness() {
  const calls = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineWidth: 1,
    globalAlpha: 1,
    setTransform(...args) { calls.push({ method: "setTransform", args }); },
    fillRect(...args) {
      calls.push({ method: "fillRect", args, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
    },
    strokeRect(...args) { calls.push({ method: "strokeRect", args, strokeStyle: this.strokeStyle }); },
    clearRect(...args) { calls.push({ method: "clearRect", args }); },
    fillText(text, ...args) {
      calls.push({
        method: "fillText",
        text: String(text),
        args,
        fillStyle: this.fillStyle,
        font: this.font,
        textAlign: this.textAlign,
      });
    },
    measureText(value) {
      return { width: Array.from(String(value)).reduce((width, character) => width + (/[^\x00-\x7f]/.test(character) ? 12 : 7), 0) };
    },
    beginPath() { calls.push({ method: "beginPath", args: [] }); },
    closePath() { calls.push({ method: "closePath", args: [] }); },
    moveTo(...args) { calls.push({ method: "moveTo", args }); },
    lineTo(...args) { calls.push({ method: "lineTo", args }); },
    arc(...args) { calls.push({ method: "arc", args }); },
    roundRect(...args) { calls.push({ method: "roundRect", args }); },
    fill() { calls.push({ method: "fill", args: [], fillStyle: this.fillStyle }); },
    stroke() { calls.push({ method: "stroke", args: [], strokeStyle: this.strokeStyle }); },
    save() { calls.push({ method: "save", args: [] }); },
    restore() { calls.push({ method: "restore", args: [] }); },
    translate(...args) { calls.push({ method: "translate", args }); },
    scale(...args) { calls.push({ method: "scale", args }); },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(kind) {
      assert.equal(kind, "2d");
      return context;
    },
    toBlob(callback, type) { callback({ type, size: 128 }); },
  };
  const fontLoads = [];
  const document = {
    fonts: {
      async load(...args) {
        fontLoads.push(args);
        return [];
      },
    },
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return canvas;
    },
  };
  return { calls, canvas, context, document, fontLoads };
}

async function withDocument(document, callback) {
  const previous = global.document;
  global.document = document;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  }
}

function renderedTexts(harness) {
  return harness.calls
    .filter((call) => call.method === "fillText")
    .map((call) => call.text);
}

test("취합 이미지 렌더러를 공개 API로 제공하고 배율에 맞는 canvas를 만든다", async () => {
  assert.equal(typeof schedule.renderComparisonImage, "function");
  const members = [participant("쵸하", [schedule.slotIndex(20, 0)])];

  const normal = createCanvasHarness();
  const normalCanvas = await withDocument(normal.document, () => schedule.renderComparisonImage(members, {}, { scale: 1 }));
  const highResolution = createCanvasHarness();
  const highResolutionCanvas = await withDocument(
    highResolution.document,
    () => schedule.renderComparisonImage(members, {}, { scale: 3 }),
  );

  assert.equal(normalCanvas, normal.canvas);
  assert.equal(highResolutionCanvas, highResolution.canvas);
  assert.ok(normalCanvas.width > 0);
  assert.ok(normalCanvas.height > 0);
  assert.equal(highResolutionCanvas.width, normalCanvas.width * 3);
  assert.equal(highResolutionCanvas.height, normalCanvas.height * 3);
  assert.deepEqual(normal.calls.find((call) => call.method === "setTransform")?.args, [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(highResolution.calls.find((call) => call.method === "setTransform")?.args, [3, 0, 0, 3, 0, 0]);
  assert.ok(normal.fontLoads.length > 0, "한글 폭이 안정되도록 이미지 생성 전 웹폰트를 기다려야 합니다");
});

test("취합 이미지에 이름·시간대·보기 설정·참여자와 제외된 일정을 표시한다", async () => {
  const members = [
    participant("쵸하", [schedule.slotIndex(22, 5)]),
    participant("휴이스", [schedule.slotIndex(22, 5)]),
  ];
  const excluded = [participant("다른 시간대", [schedule.slotIndex(22, 5)], { timezone: "UTC" })];
  const harness = createCanvasHarness();

  await withDocument(harness.document, () => schedule.renderComparisonImage(members, {
    title: "🌙 새벽 공대 취합",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 5,
    excluded,
  }));

  const texts = renderedTexts(harness);
  const allText = texts.join("\n");
  assert.match(allText, /새벽 공대 취합/);
  assert.match(allText, /Asia\/Seoul/);
  assert.match(allText, /08:00/);
  assert.match(allText, /토요일|토 시작|시작 요일\s*토/);
  assert.match(allText, /쵸하/);
  assert.match(allText, /휴이스/);
  assert.match(allText, /다른 시간대/);
  assert.match(allText, /제외/);

  const dayHeaders = texts.filter((text) => schedule.DAYS.some((day) => day.short === text));
  assert.deepEqual(dayHeaders.slice(0, 7), ["토", "일", "월", "화", "수", "목", "금"]);
});

test("서로 다른 하루 시작 시각의 같은 달력 시간을 한 칸으로 집계해 이미지에 그린다", async () => {
  const startsAtEight = participant("8시 시작", [schedule.slotIndex(0, 0)], { startHour: 8 });
  const startsAtMidnight = participant("0시 시작", [schedule.slotIndex(0, 1)], { startHour: 0 });
  const originals = [startsAtEight.slots.slice(), startsAtMidnight.slots.slice()];
  const harness = createCanvasHarness();

  await withDocument(harness.document, () => schedule.renderComparisonImage(
    [startsAtEight, startsAtMidnight],
    { title: "달력 시간 보정", timezone: "Asia/Seoul", startHour: 8, startDay: 0 },
  ));

  const allText = renderedTexts(harness).join("\n");
  assert.match(allText, /최대[^\n]*2|2[^\n]*최대/);
  assert.ok(
    renderedTexts(harness).some((text) => /^2(?:명)?$/.test(text)),
    "두 일정이 겹친 시간 칸에 2명이 표시되어야 합니다",
  );
  assert.deepEqual(startsAtEight.slots, originals[0]);
  assert.deepEqual(startsAtMidnight.slots, originals[1]);
});

test("취합 이미지 렌더러는 잘못된 참여 일정 데이터를 거절한다", async () => {
  const harness = createCanvasHarness();
  await assert.rejects(
    withDocument(harness.document, () => schedule.renderComparisonImage([
      { title: "깨진 일정", timezone: "Asia/Seoul", startHour: 8, slots: "not-slot-bytes" },
    ])),
    /28바이트|선택 데이터|일정/,
  );
});

test("취합 페이지에 이미지 복사·PNG 저장 버튼과 결과 상태 영역이 있다", () => {
  const html = fs.readFileSync(path.join(__dirname, "../compare.html"), "utf8");
  for (const id of ["compareImageButton", "compareImageLabel", "comparePngButton", "compareImageStatus"]) {
    assert.match(html, new RegExp(`\\bid=["']${id}["']`), `${id} 요소가 필요합니다`);
  }
  const copyButton = html.match(/<button\b[^>]*\bid=["']compareImageButton["'][^>]*>/i)?.[0];
  const pngButton = html.match(/<button\b[^>]*\bid=["']comparePngButton["'][^>]*>/i)?.[0];
  assert.ok(copyButton);
  assert.ok(pngButton);
  assert.match(copyButton, /\bdisabled\b/i);
  assert.match(pngButton, /\bdisabled\b/i);
  assert.match(html, /이미지 복사/);
  assert.match(html, /PNG (?:저장|다운로드)/);
});

class FakeElement {
  constructor(id = "", tagName = "div") {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
      toggle: (value, force) => {
        const enabled = force === undefined ? !this.classList.values.has(value) : Boolean(force);
        if (enabled) this.classList.values.add(value);
        else this.classList.values.delete(value);
        return enabled;
      },
      contains: (value) => this.classList.values.has(value),
    };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.tabIndex = -1;
    this.scrollTop = 0;
    this.href = "";
    this.download = "";
    this.clicked = false;
  }

  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  remove() { this.removed = true; }
  click() { this.clicked = true; }
  closest() { return null; }
  cloneNode() {
    const clone = new FakeElement("", this.tagName);
    clone.value = this.value;
    clone.textContent = this.textContent;
    return clone;
  }
}

const COMPARE_PAGE_IDS = [
  "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
  "compareInputStatus", "participantArea", "participantCount", "participantList",
  "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
  "compareGrid", "compareGridScroller", "compareDetail", "compareCollectionNameInput",
  "compareSaveCollectionButton", "compareCopyCollectionLinkButton", "compareCollectionSaveStatus",
  "compareImageButton", "compareImageLabel", "comparePngButton", "compareImageStatus", "toast",
];

function runComparisonPage(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const elements = new Map(COMPARE_PAGE_IDS.map((id) => [id, new FakeElement(id)]));
  const imageWrites = [];
  const downloads = [];
  const createdCanvases = [];
  const timers = [];
  const body = new FakeElement("body", "body");
  const document = {
    readyState: "complete",
    body,
    fonts: { async load() { return []; } },
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll() { return []; },
    createDocumentFragment() { return new FakeElement("", "fragment"); },
    createTextNode(value) { return String(value); },
    elementFromPoint() { return null; },
    addEventListener() {},
    execCommand() { return true; },
    createElement(tagName) {
      if (tagName === "canvas") {
        const harness = createCanvasHarness();
        createdCanvases.push(harness.canvas);
        return harness.canvas;
      }
      const element = new FakeElement("", tagName);
      if (tagName === "a") {
        element.click = () => {
          element.clicked = true;
          downloads.push({ href: element.href, filename: element.download });
        };
      }
      return element;
    },
  };

  class TestUrl extends URL {}
  TestUrl.createObjectURL = () => `blob:test-${downloads.length + 1}`;
  TestUrl.revokeObjectURL = () => {};
  class TestClipboardItem {
    constructor(items) { this.items = items; }
    static supports(type) { return options.supportsPng !== false && type === "image/png"; }
  }

  const location = {
    pathname: "/schedule-maker/compare.html",
    search: "",
    hash: "",
    href: "https://example.test/schedule-maker/compare.html",
    replace() {},
  };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const window = {
    location,
    localStorage: storage,
    sessionStorage: storage,
    history: { replaceState() {} },
    isSecureContext: options.secure !== false,
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
  };
  const navigator = {
    clipboard: {
      async write(items) { imageWrites.push(items); },
      async writeText() {},
    },
  };
  const context = {
    module: { exports: {} },
    Buffer,
    URL: TestUrl,
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
    navigator,
    ClipboardItem: TestClipboardItem,
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "schedule-maker/app.js" });
  return { elements, imageWrites, downloads, createdCanvases, timers, location };
}

function addOneComparisonSchedule(page) {
  const slots = schedule.createSlots();
  schedule.setSelected(slots, schedule.slotIndex(21, 4), true);
  page.elements.get("compareLinksInput").value = schedule.makeShareUrl(
    "https://example.test/schedule-maker/",
    slots,
    { title: "휴이스", timezone: "Asia/Seoul", startHour: 8, startDay: 0 },
  );
  page.elements.get("compareAddButton").listeners.get("click")();
}

test("취합 일정이 생기면 이미지 버튼을 활성화하고 PNG를 클립보드에 복사한다", async () => {
  const page = runComparisonPage();
  assert.equal(page.elements.get("compareImageButton").disabled, true);
  assert.equal(page.elements.get("comparePngButton").disabled, true);

  addOneComparisonSchedule(page);
  assert.equal(page.elements.get("compareImageButton").disabled, false);
  assert.equal(page.elements.get("comparePngButton").disabled, false);

  await page.elements.get("compareImageButton").listeners.get("click")();
  assert.equal(page.imageWrites.length, 1);
  assert.equal(page.downloads.length, 0);
  assert.ok(page.imageWrites[0][0] instanceof Object);
  assert.ok(Object.hasOwn(page.imageWrites[0][0].items, "image/png"));
  const png = await page.imageWrites[0][0].items["image/png"];
  assert.equal(png.type, "image/png");
  assert.match(page.elements.get("compareImageStatus").textContent, /복사/);
  assert.equal(page.location.href, "https://example.test/schedule-maker/compare.html");
});

test("취합 이미지 클립보드를 지원하지 않으면 PNG 파일로 저장한다", async () => {
  const page = runComparisonPage({ secure: false });
  addOneComparisonSchedule(page);

  await page.elements.get("compareImageButton").listeners.get("click")();

  assert.equal(page.imageWrites.length, 0);
  assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].filename, /\.png$/i);
  assert.match(page.elements.get("compareImageStatus").textContent, /PNG|저장/);
});

test("취합 PNG 저장 버튼은 고해상도 이미지를 바로 내려받는다", async () => {
  const page = runComparisonPage();
  addOneComparisonSchedule(page);

  await page.elements.get("comparePngButton").listeners.get("click")();

  assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].filename, /\.png$/i);
  assert.match(page.elements.get("compareImageStatus").textContent, /저장/);
});
