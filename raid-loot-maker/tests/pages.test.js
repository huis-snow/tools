"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(APP_ROOT, file), "utf8");
}

function idsFromController(file) {
  return [...read(file).matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
}

function assertControllerIds(page, controller) {
  const html = read(page);
  idsFromController(controller).forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`), `${controller}가 사용하는 #${id}`);
  });
}

test("세 페이지는 컨트롤러가 참조하는 모든 정적 ID를 제공한다", () => {
  assertControllerIds("index.html", "index-page.js");
  assertControllerIds("room.html", "room-page.js");
  assertControllerIds("summary.html", "summary-page.js");
});

test("공대 생성과 참여 화면은 고정 8자리·11부위·3상태 계약을 유지한다", () => {
  const home = read("index.html");
  const room = read("room.html");
  const seats = ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"];

  assert.deepEqual(
    [...home.matchAll(/<tr data-seat="(MT|ST|MH|SH|D1|D2|D3|D4)">/g)].map((match) => match[1]),
    seats,
  );
  assert.equal((room.match(/role="radio" aria-checked="false" data-seat=/g) || []).length, 8);
  assert.equal((room.match(/class="gear-card" data-slot=/g) || []).length, 11);
  for (const state of ["complete", "upgrade", "raid"]) {
    assert.equal((room.match(new RegExp(`value="${state}"`, "g")) || []).length, 11);
  }
  assert.match(home, /id="raidLootCreateStartDate"[^>]*required/);
});

test("취합 화면은 8주 탭·11×8 표·17종 드랍·실제 원장을 제공한다", () => {
  const html = read("summary.html");
  const dropTypes = [
    "raid_earrings", "raid_necklace", "raid_bracelets", "raid_ring",
    "raid_head", "raid_hands", "raid_feet", "upgrade_accessory",
    "tome_weapon_token", "raid_body", "raid_legs", "upgrade_armor",
    "upgrade_weapon", "raid_weapon", "direct_weapon", "music", "mount",
  ];

  assert.equal((html.match(/role="tab"[^>]*data-week="[1-8]"/g) || []).length, 8);
  assert.equal((html.match(/<tr data-slot=/g) || []).length, 11);
  assert.equal((html.match(/<td data-seat=/g) || []).length, 88);
  dropTypes.forEach((dropType) => assert.match(html, new RegExp(`value="${dropType}"`)));
  assert.match(html, /id="raidLootDirectWeaponJobField"[^>]*hidden/);
  assert.match(html, /id="raidLootCandidateItemTemplate"/);
  assert.match(html, /data-field="reason"/);
  assert.match(html, /id="raidLootHistoryItemTemplate"/);
  assert.match(html, /data-field="recipient"/);
  assert.match(html, /data-action="undo-event"/);
});

test("추천 정책 값과 이미지 모듈 로드 순서는 core 계약에 맞는다", () => {
  const html = read("summary.html");
  for (const preset of ["fair", "progression", "manual"]) {
    assert.match(html, new RegExp(`<option value="${preset}">`));
  }
  assert.doesNotMatch(html, /fair-v1|completion-v1|dps-v1/);
  assert.ok(html.indexOf("./core.js") < html.indexOf("./image-renderer.js"));
  assert.ok(html.indexOf("./image-renderer.js") < html.indexOf("./summary-page.js"));
});

test("검색 공개는 홈만 허용하고 방·취합 주소는 noindex로 둔다", () => {
  const home = read("index.html");
  const room = read("room.html");
  const summary = read("summary.html");

  assert.match(home, /<link rel="canonical" href="https:\/\/huis-snow\.github\.io\/tools\/raid-loot-maker\/" \/>/);
  assert.doesNotMatch(home, /name="robots"[^>]*noindex/);
  assert.match(room, /<meta name="robots" content="noindex, follow" \/>/);
  assert.match(summary, /<meta name="robots" content="noindex, follow" \/>/);
});

