"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const schedule = require("../app.js");

const ROOT = path.resolve(__dirname, "..");

function selectorMatches(element, selector) {
  if (!element || typeof element !== "object") return false;
  if (selector.startsWith(".")) {
    const className = selector.slice(1);
    return String(element.className || "").split(/\s+/).includes(className)
      || element.classList?.contains(className);
  }
  const dataMatch = selector.match(/^\[data-([a-z0-9-]+)\]$/i);
  if (dataMatch) {
    const key = dataMatch[1].replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    return Object.hasOwn(element.dataset || {}, key);
  }
  return false;
}

class FakeElement {
  constructor(id = "", tagName = "div") {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
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
      contains: (value) => this.classList.values.has(value)
        || String(this.className || "").split(/\s+/).includes(value),
    };
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = -1;
    this.scrollTop = 0;
  }

  append(...children) {
    children.forEach((child) => {
      if (child && typeof child === "object") child.parentElement = this;
      this.children.push(child);
    });
  }

  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  remove() { this.removed = true; }
  contains(target) {
    return this === target || this.children.some((child) => (
      child && typeof child === "object" && child.contains?.(target)
    ));
  }
  closest(selector) {
    let current = this;
    while (current) {
      if (selectorMatches(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }
  querySelector(selector) {
    return descendants(this).find((child) => selectorMatches(child, selector)) || null;
  }
  querySelectorAll(selector) {
    return descendants(this).filter((child) => selectorMatches(child, selector));
  }
  cloneNode(deep = false) {
    const clone = new FakeElement("", this.tagName);
    clone.className = this.className;
    clone.value = this.value;
    clone.textContent = this.textContent;
    clone.disabled = this.disabled;
    clone.hidden = this.hidden;
    clone.dataset = { ...this.dataset };
    this.attributes.forEach((value, name) => clone.attributes.set(name, value));
    if (deep) clone.append(...this.children.map((child) => (
      child && typeof child.cloneNode === "function" ? child.cloneNode(true) : child
    )));
    return clone;
  }
}

function descendants(element) {
  const result = [];
  (element?.children || []).forEach((child) => {
    if (!child || typeof child !== "object") return;
    result.push(child, ...descendants(child));
  });
  return result;
}

function elementText(element) {
  if (element === null || element === undefined) return "";
  if (typeof element !== "object") return String(element);
  return [element.textContent, ...(element.children || []).map(elementText)].join(" ").replace(/\s+/g, " ").trim();
}

function candidateTemplate() {
  const fragment = new FakeElement("", "fragment");
  const item = new FakeElement("", "div");
  item.className = "compare-candidate-item";
  item.setAttribute("role", "listitem");
  const card = new FakeElement("", "button");
  card.className = "compare-candidate-card";
  card.setAttribute("aria-pressed", "false");
  for (const hook of ["rank", "attendance", "time", "duration", "unavailable"]) {
    const field = new FakeElement("", hook === "attendance" || hook === "time" ? "strong" : "span");
    field.dataset[`candidate${hook[0].toUpperCase()}${hook.slice(1)}`] = "";
    card.append(field);
  }
  item.append(card);
  fragment.append(item);
  return fragment;
}

const PAGE_IDS = [
  "compareLinksInput", "compareAddButton", "compareStartHourSelect", "compareStartDaySelect",
  "compareInputStatus", "participantArea", "participantCount", "participantList",
  "compareClearButton", "compareTimezoneStatus", "compareMaxCount", "compareSummaryText",
  "compareGrid", "compareGridScroller", "compareDetail", "compareCollectionNameInput",
  "compareSaveCollectionButton", "compareCopyCollectionLinkButton", "compareCollectionSaveStatus",
  "compareImageMode", "compareImageSelectedCount", "compareImageSelectionClearButton",
  "compareImageSelectionStatus", "compareImageScopeHelp", "compareImageButton", "compareImageLabel",
  "comparePngButton", "compareImageStatus", "toast", "compareCandidatePanel", "compareCandidateTitle",
  "compareCandidateDurationSelect", "compareCandidateThresholdSelect", "compareCandidateSummary",
  "compareCandidateList", "compareCandidateEmpty", "compareCandidateClearButton",
  "compareCandidateApplyButton", "compareCandidateCardTemplate",
];

function runCandidatePage() {
  const elements = new Map(PAGE_IDS.map((id) => [id, new FakeElement(id)]));
  elements.get("compareCandidateDurationSelect").value = "3";
  elements.get("compareCandidateThresholdSelect").value = "auto";
  elements.get("compareImageMode").value = "overlap";
  const template = elements.get("compareCandidateCardTemplate");
  template.tagName = "TEMPLATE";
  template.content = candidateTemplate();

  const body = new FakeElement("body", "body");
  const document = {
    readyState: "complete",
    body,
    activeElement: null,
    querySelector(selector) {
      return selector.startsWith("#") ? elements.get(selector.slice(1)) || null : null;
    },
    querySelectorAll() { return []; },
    createDocumentFragment() { return new FakeElement("", "fragment"); },
    createTextNode(value) { return String(value); },
    createElement(tagName) { return new FakeElement("", tagName); },
    importNode(node, deep) { return node.cloneNode(deep); },
    elementFromPoint() { return null; },
    addEventListener() {},
    execCommand() { return true; },
  };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const location = {
    pathname: "/schedule-maker/compare.html",
    search: "",
    hash: "",
    href: "https://example.test/schedule-maker/compare.html",
    replace() {},
  };
  const window = {
    location,
    localStorage: storage,
    sessionStorage: storage,
    history: { replaceState() {} },
    isSecureContext: true,
    requestAnimationFrame(callback) { callback(); },
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener() {},
  };
  const context = {
    module: { exports: {} },
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
    navigator: { clipboard: { async writeText() {} } },
    setTimeout,
    clearTimeout,
  };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, "availability-candidates.js"), "utf8"),
    context,
    { filename: "schedule-maker/availability-candidates.js" },
  );
  context.module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, "app.js"), "utf8"),
    context,
    { filename: "schedule-maker/app.js" },
  );
  return { elements, app: context.EonjepyoApp };
}

function makeParticipant(title, byDayAndHour) {
  const slots = schedule.createSlots();
  byDayAndHour.forEach(([hour, day]) => schedule.setSelected(slots, schedule.slotIndex(hour, day), true));
  return { title, timezone: "Asia/Seoul", startHour: 8, startDay: 0, slots };
}

function replaceParticipants(page, availabilityByName) {
  const participants = Object.entries(availabilityByName).map(([name, times]) => makeParticipant(name, times));
  assert.equal(page.app.replaceComparisonSchedules(participants, { startHour: 8, startDay: 0 }), true);
}

function candidateCards(page) {
  return descendants(page.elements.get("compareCandidateList"))
    .filter((element) => element.classList.contains("compare-candidate-card"));
}

function gridCells(page) {
  return descendants(page.elements.get("compareGrid"))
    .filter((element) => element.classList.contains("compare-cell"));
}

function selectedCandidateCells(page) {
  return gridCells(page).filter((cell) => cell.classList.contains("is-candidate-selected"));
}

function dispatchChange(control) {
  control.listeners.get("change")?.({ target: control });
}

function clickCandidate(page, card) {
  const listener = card.listeners.get("click") || page.elements.get("compareCandidateList").listeners.get("click");
  assert.equal(typeof listener, "function", "후보 카드 선택 이벤트가 연결되어야 합니다");
  listener({ target: card, currentTarget: card, preventDefault() {} });
}

test("3시간 연속 같은 참석자 후보를 렌더하고 선택 범위와 참석 상세를 함께 보여준다", () => {
  const page = runCandidatePage();
  const block = [[10, 0], [11, 0], [12, 0]];
  replaceParticipants(page, { 가람: block, 나래: block, 다온: block });

  const cards = candidateCards(page);
  assert.equal(cards.length, 1);
  assert.match(elementText(cards[0]), /3\/3명/);
  assert.match(elementText(cards[0]), /3시간/);
  assert.equal(cards[0].getAttribute("aria-pressed"), "false");

  clickCandidate(page, cards[0]);

  assert.equal(cards[0].getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    selectedCandidateCells(page).map((cell) => Number(cell.dataset.index)).sort((a, b) => a - b),
    block.map(([hour, day]) => schedule.slotIndex(hour, day)),
  );
  assert.match(elementText(page.elements.get("compareDetail")), /가람/);
  assert.match(elementText(page.elements.get("compareDetail")), /나래/);
  assert.match(elementText(page.elements.get("compareDetail")), /다온/);
  assert.match(elementText(page.elements.get("compareDetail")), /불가능.*없음|전원/);
  assert.equal(page.elements.get("compareCandidateClearButton").disabled, false);
  assert.equal(page.elements.get("compareCandidateApplyButton").disabled, false);
});

test("선택 후보를 이미지 직접 선택에 정확히 반영하고 후보 선택을 해제한다", () => {
  const page = runCandidatePage();
  const block = [[22, 4], [23, 4], [0, 4]];
  replaceParticipants(page, { 가람: block, 나래: block });
  const card = candidateCards(page)[0];
  clickCandidate(page, card);

  page.elements.get("compareCandidateApplyButton").listeners.get("click")?.();

  assert.equal(page.elements.get("compareImageMode").value, "selected");
  assert.equal(page.elements.get("compareImageSelectedCount").textContent, "3");
  assert.equal(gridCells(page).filter((cell) => cell.classList.contains("is-image-selected")).length, 3);
  assert.equal(page.elements.get("compareImageButton").disabled, false);

  page.elements.get("compareCandidateClearButton").listeners.get("click")?.();
  assert.equal(card.getAttribute("aria-pressed"), "false");
  assert.equal(selectedCandidateCells(page).length, 0);
  assert.equal(page.elements.get("compareCandidateClearButton").disabled, true);
  assert.equal(page.elements.get("compareCandidateApplyButton").disabled, true);
});

test("필요 시간과 후보 기준을 바꾸면 현재 취합 데이터로 즉시 재계산한다", () => {
  const page = runCandidatePage();
  const allTwoHours = [[10, 1], [11, 1]];
  const twoPeopleFourHours = [...allTwoHours, [12, 1], [13, 1]];
  replaceParticipants(page, {
    가람: twoPeopleFourHours,
    나래: twoPeopleFourHours,
    다온: allTwoHours,
  });

  assert.match(elementText(candidateCards(page)[0]), /2\/3명/);
  assert.match(elementText(candidateCards(page)[0]), /4시간/);

  const threshold = page.elements.get("compareCandidateThresholdSelect");
  threshold.value = "all";
  dispatchChange(threshold);
  assert.equal(candidateCards(page).length, 0, "3시간 전원 가능 후보는 없어야 합니다");
  assert.equal(page.elements.get("compareCandidateEmpty").hidden, false);

  const duration = page.elements.get("compareCandidateDurationSelect");
  duration.value = "2";
  dispatchChange(duration);
  const cards = candidateCards(page);
  assert.equal(cards.length, 1);
  assert.match(elementText(cards[0]), /3\/3명/);
  assert.match(elementText(cards[0]), /2시간/);
  assert.match(elementText(page.elements.get("compareCandidateSummary")), /2시간/);
});

test("시간마다 빠지는 사람이 다른 셀 수 n-1 착시는 연속 후보로 렌더하지 않는다", () => {
  const page = runCandidatePage();
  replaceParticipants(page, {
    가람: [[20, 2], [21, 2], [22, 2]],
    나래: [[20, 2], [21, 2]],
    다온: [[20, 2], [22, 2]],
    라온: [[21, 2], [22, 2]],
  });
  const threshold = page.elements.get("compareCandidateThresholdSelect");
  threshold.value = "n-1";
  dispatchChange(threshold);

  assert.equal(candidateCards(page).length, 0);
  assert.equal(page.elements.get("compareCandidateEmpty").hidden, false);
  assert.match(elementText(page.elements.get("compareCandidateSummary")), /없|찾지|후보/);
  assert.equal(page.elements.get("compareCandidateApplyButton").disabled, true);
});

test("온라인식 갱신 뒤에도 같은 시간 범위 후보를 선택한 채 최신 참석·불참 명단을 보여준다", () => {
  const page = runCandidatePage();
  const block = [[10, 3], [11, 3], [12, 3]];
  replaceParticipants(page, {
    "이전 가람": block,
    "이전 나래": block,
    "이전 다온": [],
  });
  clickCandidate(page, candidateCards(page)[0]);

  const updatedParticipants = {
    "새 가람": block,
    "새 나래": block,
    "새 다온": [],
    "새 라온": [],
  };
  const schedules = Object.entries(updatedParticipants)
    .map(([name, times]) => makeParticipant(name, times));
  assert.equal(page.app.replaceComparisonSchedules(schedules, {
    startHour: 8,
    startDay: 0,
    preserveView: true,
  }), true);

  const cards = candidateCards(page);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].getAttribute("aria-pressed"), "true");
  assert.deepEqual(
    selectedCandidateCells(page).map((cell) => Number(cell.dataset.index)).sort((a, b) => a - b),
    block.map(([hour, day]) => schedule.slotIndex(hour, day)),
  );
  const detail = elementText(page.elements.get("compareDetail"));
  assert.match(detail, /새 가람/);
  assert.match(detail, /새 나래/);
  assert.match(detail, /불가능.*새 다온/);
  assert.match(detail, /불가능.*새 라온/);
  assert.doesNotMatch(detail, /이전 (?:가람|나래|다온)/);
});

test("이미지에 반영한 후보가 온라인식 갱신으로 사라지면 후보 유래 선택을 전부 해제한다", () => {
  const page = runCandidatePage();
  const block = [[19, 5], [20, 5], [21, 5]];
  replaceParticipants(page, { 가람: block, 나래: block });
  clickCandidate(page, candidateCards(page)[0]);
  page.elements.get("compareCandidateApplyButton").listeners.get("click")?.();
  assert.equal(page.elements.get("compareImageSelectedCount").textContent, "3");

  const changedSchedules = [
    makeParticipant("가람", [[19, 5]]),
    makeParticipant("나래", [[20, 5]]),
  ];
  assert.equal(page.app.replaceComparisonSchedules(changedSchedules, {
    startHour: 8,
    startDay: 0,
    preserveView: true,
  }), true);

  assert.equal(candidateCards(page).some((card) => card.getAttribute("aria-pressed") === "true"), false);
  assert.equal(selectedCandidateCells(page).length, 0);
  assert.equal(page.elements.get("compareCandidateClearButton").disabled, true);
  assert.equal(page.elements.get("compareCandidateApplyButton").disabled, true);
  assert.equal(page.elements.get("compareImageMode").value, "selected");
  assert.equal(page.elements.get("compareImageSelectedCount").textContent, "0");
  assert.equal(gridCells(page).filter((cell) => cell.classList.contains("is-image-selected")).length, 0);
  assert.equal(page.elements.get("compareImageButton").disabled, true);
  assert.equal(page.elements.get("comparePngButton").disabled, true);
});
