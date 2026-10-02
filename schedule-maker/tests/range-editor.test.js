"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const schedule = require("../app.js");

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.listeners = {}; this.textContent = ""; this.value = ""; this.checked = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  cloneNode() { const copy = new Element(this.tag); copy.value = this.value; copy.textContent = this.textContent; return copy; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  setAttribute(name, value) { this[name] = value; }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((value) => value.trim());
    return this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]).filter((child) => selectors.some((value) => value === child.tag || value === "input:checked" && child.tag === "input" && child.checked));
  }
  click() { this.listeners.click?.(); }
}

function harness() {
  const ids = ["timeRangeForm", "timeRangeDays", "timeRangeStart", "timeRangeEnd", "timeRangeSubmit", "timeRangeCancel", "timeRangeError", "timeRangeList"];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id.includes("Start") || id.includes("End") ? "select" : "div")]));
  elements.timeRangeForm.append(elements.timeRangeDays, elements.timeRangeStart, elements.timeRangeEnd, elements.timeRangeSubmit, elements.timeRangeCancel);
  const document = { querySelector: (selector) => elements[selector.slice(1)], createElement: (tag) => new Element(tag) };
  const state = { slots: schedule.createSlots(), startHour: 8, startDay: 0, readOnly: false };
  const history = [];
  const context = { Eonjepyo: schedule };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../range-editor.js"), "utf8"), context);
  const editor = context.EonjepyoRangeEditor.create({ document, getState: () => state, commit: (mutate) => {
    history.push(state.slots.slice());
    mutate();
    editor.render();
  } });
  editor.render();
  const submit = () => elements.timeRangeForm.listeners.submit({ preventDefault() {} });
  const setDays = (days) => elements.timeRangeDays.querySelectorAll("input").forEach((input) => { input.checked = days.includes(Number(input.value)); });
  return { elements, state, editor, history, submit, setDays };
}

test("구간 입력·겹침 합치기·수정·삭제와 실행 취소가 같은 선택 데이터를 사용한다", () => {
  const h = harness();
  h.setDays([0, 2, 4]);
  h.elements.timeRangeStart.value = "19.5";
  h.elements.timeRangeEnd.value = "23";
  h.submit();
  assert.equal(schedule.countSelected(h.state.slots), 21);
  assert.equal(h.elements.timeRangeList.children.length, 1);
  assert.equal(h.elements.timeRangeList.children[0].children[0].textContent, "월·수·금 19:30–23:00");
  h.elements.timeRangeStart.value = "22";
  h.elements.timeRangeEnd.value = "25.5";
  h.submit();
  assert.deepEqual(schedule.selectedRanges(h.state.slots, 0, 8), [[19.5, 25.5]]);
  h.elements.timeRangeList.children[0].children[1].click();
  assert.equal(h.elements.timeRangeSubmit.textContent, "수정 저장");
  h.setDays([1]);
  h.elements.timeRangeStart.value = "20.5";
  h.elements.timeRangeEnd.value = "22";
  h.submit();
  assert.equal(schedule.countSelected(h.state.slots), 3);
  assert.deepEqual(schedule.selectedRanges(h.state.slots, 0, 8), []);
  assert.deepEqual(schedule.selectedRanges(h.state.slots, 1, 8), [[20.5, 22]]);
  h.elements.timeRangeList.children[0].children[2].click();
  assert.equal(schedule.countSelected(h.state.slots), 0);
  h.state.slots = h.history.pop();
  h.editor.render();
  assert.deepEqual(schedule.selectedRanges(h.state.slots, 1, 8), [[20.5, 22]]);
});

test("요일 누락·역순 입력과 읽기 전용 조작은 데이터를 변경하지 않는다", () => {
  const h = harness();
  h.setDays([]);
  h.submit();
  assert.match(h.elements.timeRangeError.textContent, /요일/);
  h.setDays([0]);
  h.elements.timeRangeStart.value = "23";
  h.elements.timeRangeEnd.value = "19";
  h.submit();
  assert.match(h.elements.timeRangeError.textContent, /종료/);
  assert.equal(h.history.length, 0);
  h.state.readOnly = true;
  h.editor.render();
  h.elements.timeRangeEnd.value = "25";
  h.submit();
  assert.equal(schedule.countSelected(h.state.slots), 0);
  assert.equal(h.elements.timeRangeStart.disabled, true);
});

test("실제 방 날짜·회전된 요일·익일 종료 옵션을 표시하고 취소는 원본을 보존한다", () => {
  const h = harness();
  h.state.startDate = "2026-07-22";
  h.state.startDay = 2;
  h.editor.render();
  assert.equal(h.elements.timeRangeDays.children[0].children[1].textContent, "7/22 수");
  assert.equal(h.elements.timeRangeEnd.children.at(-1).textContent, "익일 08:00");
  h.setDays([2]);
  h.submit();
  const original = h.state.slots.slice();
  h.elements.timeRangeList.children[0].children[1].click();
  h.elements.timeRangeStart.value = "20.5";
  h.elements.timeRangeCancel.click();
  assert.deepEqual(h.state.slots, original);
  assert.equal(h.elements.timeRangeSubmit.textContent, "시간 추가");
});
