"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const STYLE_FILES = [
  "hub.css",
  "table-maker/styles.css",
  "schedule-maker/styles.css",
  "habit-maker/styles.css",
  "raid-maker/styles.css",
  "daily-log/styles.css",
];
const PAGE_FILES = [
  "index.html",
  "table-maker/index.html",
  "schedule-maker/index.html",
  "schedule-maker/compare.html",
  "schedule-maker/room.html",
  "schedule-maker/saved.html",
  "habit-maker/index.html",
  "raid-maker/index.html",
  "daily-log/index.html",
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function cssBlock(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] || "";
}

test("모든 실제 페이지는 공통 상단 메뉴 구조를 사용한다", () => {
  PAGE_FILES.forEach((file) => {
    assert.match(read(file), /<header class="site-header">/, `${file}의 상단 메뉴`);
  });
});

test("모든 앱 스타일은 데스크톱·모바일 고정 헤더와 앵커 여백을 유지한다", () => {
  STYLE_FILES.forEach((file) => {
    const source = read(file);
    const html = cssBlock(source, "html");
    const header = cssBlock(source, ".site-header");
    const skipLink = cssBlock(source, ".skip-link");

    assert.match(html, /scroll-padding-top:\s*104px;/, `${file}의 데스크톱 앵커 여백`);
    assert.match(source, /scroll-padding-top:\s*84px;/, `${file}의 모바일 앵커 여백`);
    assert.match(header, /position:\s*sticky;/, `${file}의 고정 헤더`);
    assert.match(header, /top:\s*0;/, `${file}의 헤더 위치`);
    assert.match(header, /z-index:\s*200;/, `${file}의 헤더 쌓임 순서`);
    assert.match(header, /backdrop-filter:\s*blur\(12px\);/, `${file}의 헤더 배경 처리`);
    assert.match(skipLink, /z-index:\s*300;/, `${file}의 건너뛰기 링크 쌓임 순서`);
  });
});

test("공대표의 내부 이동 막대는 고정 헤더 아래에 머문다", () => {
  const source = read("raid-maker/styles.css");
  assert.match(cssBlock(source, ".move-tray"), /top:\s*96px;/);
  assert.match(source, /@media \(max-width: 680px\)[\s\S]*?\.move-tray\s*\{[^}]*top:\s*78px;/);
});
