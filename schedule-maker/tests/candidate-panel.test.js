"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const PAGE_NAMES = ["compare.html", "room.html"];
const CANDIDATE_IDS = [
  "compareCandidatePanel",
  "compareCandidateTitle",
  "compareCandidateDurationSelect",
  "compareCandidateThresholdSelect",
  "compareCandidateSummary",
  "compareCandidateList",
  "compareCandidateEmpty",
  "compareCandidateClearButton",
  "compareCandidateApplyButton",
  "compareCandidateCardTemplate",
];

function readPage(name) {
  return fs.readFileSync(path.join(ROOT, name), "utf8");
}

function elementById(html, id, tag = "[a-z]+") {
  return html.match(new RegExp(`<${tag}\\b[^>]*\\bid=["']${id}["'][^>]*>`, "i"))?.[0] || "";
}

test("수동·온라인 취합표는 같은 후보 패널 ID 계약을 중복 없이 제공한다", () => {
  for (const name of PAGE_NAMES) {
    const html = readPage(name);
    for (const id of CANDIDATE_IDS) {
      const matches = html.match(new RegExp(`\\bid=["']${id}["']`, "g")) || [];
      assert.equal(matches.length, 1, `${name}: ${id}는 정확히 하나여야 합니다`);
    }
    assert.ok(html.indexOf('id="compareCandidatePanel"') < html.indexOf('id="compareImageButton"'));
    assert.ok(html.indexOf('src="availability-candidates.js"') < html.indexOf('src="app.js"'));
  }
});

test("후보 조건은 1~6시간과 자동·전원·n-1·n-2 기준을 제공한다", () => {
  for (const name of PAGE_NAMES) {
    const html = readPage(name);
    const duration = html.match(/<select\b[^>]*id="compareCandidateDurationSelect"[^>]*>[\s\S]*?<\/select>/)?.[0] || "";
    const threshold = html.match(/<select\b[^>]*id="compareCandidateThresholdSelect"[^>]*>[\s\S]*?<\/select>/)?.[0] || "";

    assert.deepEqual([...duration.matchAll(/<option\s+value="(\d)"/g)].map((match) => match[1]), ["1", "2", "3", "4", "5", "6"]);
    assert.match(duration, /<option value="3" selected>3시간<\/option>/);
    assert.deepEqual([...threshold.matchAll(/<option\s+value="([^"]+)"/g)].map((match) => match[1]), ["auto", "all", "n-1", "n-2"]);
    assert.match(threshold, /<option value="auto" selected>자동 추천<\/option>/);
  }
});

test("후보 패널은 상태 안내·선택 토글·키보드용 네이티브 컨트롤을 갖춘다", () => {
  for (const name of PAGE_NAMES) {
    const html = readPage(name);
    const status = elementById(html, "compareCandidateSummary", "p");
    const list = elementById(html, "compareCandidateList", "div");
    const clear = elementById(html, "compareCandidateClearButton", "button");
    const apply = elementById(html, "compareCandidateApplyButton", "button");

    assert.match(html, /<fieldset class="compare-candidate-controls">/);
    assert.match(html, /<label for="compareCandidateDurationSelect">/);
    assert.match(html, /<label for="compareCandidateThresholdSelect">/);
    assert.match(status, /role="status"/);
    assert.match(status, /aria-live="polite"/);
    assert.match(list, /role="list"/);
    assert.match(clear, /type="button"/);
    assert.match(clear, /disabled/);
    assert.match(apply, /type="button"/);
    assert.match(apply, /disabled/);
    assert.match(html, /class="compare-candidate-card" type="button" aria-pressed="false"/);
    for (const hook of ["rank", "attendance", "time", "duration", "unavailable"]) {
      assert.match(html, new RegExp(`data-candidate-${hook}`));
    }
  }
});

test("후보 카드 스타일은 선택 상태와 모바일 한 열 배치를 구분한다", () => {
  const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.match(css, /\.compare-candidate-card\[aria-pressed="true"\]/);
  assert.match(css, /\.compare-candidate-empty\[hidden\]/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.compare-candidate-controls,[\s\S]*?\.compare-candidate-list\s*{\s*grid-template-columns: minmax\(0, 1fr\);/);
});
