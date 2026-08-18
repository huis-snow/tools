"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(APP_ROOT, relativePath), "utf8");
}

test("비스표 방 만들기는 방장 로그인과 고정 8자리 명단을 받는다", () => {
  const html = read("index.html");
  const rows = [...html.matchAll(/<tr data-seat="(MT|ST|MH|SH|D1|D2|D3|D4)">/g)].map((match) => match[1]);
  assert.deepEqual(rows, ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
  assert.match(html, /id="bisGoogleSignInButton"/);
  assert.match(html, /id="bisRoomCreateForm"/);
  assert.match(html, /id="bisCreateWeek"[^>]*type="hidden"[^>]*value="1"/);
  assert.match(html, /공대 파밍표 사용하기/);
  assert.doesNotMatch(html, /쵸하|휴이스/);

  const controller = read("index-page.js");
  assert.match(controller, /store\.createRoom\(\{/);
  assert.match(controller, /roster:\s*rosterValue\(\)/);
  assert.match(controller, /roomUrl\("summary\.html", roomId\)/);
});

test("공대원 입력 화면은 8자리와 11부위의 세 가지 상태만 제공한다", () => {
  const html = read("room.html");
  assert.equal((html.match(/role="radio"/g) || []).length, 8);
  assert.equal((html.match(/class="gear-card" data-slot=/g) || []).length, 11);
  assert.equal((html.match(/value="complete"/g) || []).length, 11);
  assert.equal((html.match(/value="upgrade"/g) || []).length, 11);
  assert.equal((html.match(/value="raid"/g) || []).length, 11);
  assert.match(html, /다른 사람이 사용 중인 자리는 선택할 수 없어요/);
});

test("전체 현황은 11×8 표·13종 일회성 드랍·이미지 공유를 갖춘다", () => {
  const html = read("summary.html");
  assert.equal((html.match(/<tr data-slot=/g) || []).length, 11);
  assert.equal((html.match(/<td data-seat=/g) || []).length, 88);
  assert.equal((html.match(/data-drop-type=/g) || []).length, 13);
  assert.match(html, /id="bisRoomSettingsForm"/);
  assert.match(html, /class="owner-week-field"[^>]*hidden/);
  assert.match(html, /오늘의 드랍 분배/);
  assert.match(html, /id="bisCopyImageButton"/);
  assert.match(html, /id="bisSavePngButton"/);
  assert.ok(html.indexOf("./core.js") < html.indexOf("./image-renderer.js"));
  assert.ok(html.indexOf("./image-renderer.js") < html.indexOf("./summary-page.js"));
});

test("온라인 페이지는 Firebase 저장과 링크 공개 범위를 안내한다", () => {
  assert.match(read("index.html"), /Firebase 연결 안내/);
  assert.match(read("room.html"), /닉네임·직업과 선택한 장비 상태는 Firebase/);
  assert.match(read("summary.html"), /방 링크를 아는 사람은 8명의 닉네임·직업·장비 상태/);
  assert.match(read("FIREBASE_SETUP.md"), /bisRooms/);
  assert.match(read("FIREBASE_SETUP.md"), /firebase deploy --only firestore:rules,firestore:indexes/);
});

test("작은 도구함 첫 화면은 일회성 비스표와 8주 공대 파밍표를 구분한다", () => {
  const hub = fs.readFileSync(path.join(REPO_ROOT, "index.html"), "utf8");
  assert.match(hub, /TOOLS \/ 07/);
  assert.match(hub, /href="\.\/bis-maker\/"/);
  assert.match(hub, /<h3>비스표/);
  assert.match(hub, /당일 드랍을 빠르게 나누는 도구/);
  assert.match(hub, /href="\.\/raid-loot-maker\/"/);
  assert.match(hub, /<h3>공대 파밍표/);
  assert.match(hub, /8주 동안 층별 드랍과 수령 이력/);
});
