"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(APP_ROOT, "index.html"), "utf8");
const source = fs.readFileSync(path.join(APP_ROOT, "index-page.js"), "utf8");

function controllerIds(value) {
  return [...value.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
}

test("방 만들기 컨트롤러가 참조하는 모든 ID가 문서에 존재한다", () => {
  const missing = controllerIds(source).filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("방장은 Google 로그인으로 8주 공대를 만들고 내 방 목록을 관리한다", () => {
  assert.match(source, /createRaidLootRoomStore\(firebaseConfig\)/);
  assert.match(source, /store\.signInCreatorWithGoogle\(\)/);
  assert.match(source, /store\?\.isGoogleAccount\?\.\(\)/);
  assert.match(source, /store\.listOwnedRooms\(\)/);
  assert.match(source, /store\.signOutCreator\(\)/);
  assert.doesNotMatch(source, /ensureParticipantSession\(|ensureAnonymous:\s*true/);
});

test("방 생성 요청은 시작일·1주차·공정 정책과 MT부터 D4까지 8인 명단을 포함한다", () => {
  const seats = [...html.matchAll(/<tr data-seat="(MT|ST|MH|SH|D1|D2|D3|D4)">/g)]
    .map((match) => match[1]);
  assert.deepEqual(seats, ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"]);
  assert.equal((html.match(/name="nickname-(?:MT|ST|MH|SH|D1|D2|D3|D4)"/g) || []).length, 8);
  assert.equal((html.match(/name="job-(?:MT|ST|MH|SH|D1|D2|D3|D4)"/g) || []).length, 8);
  assert.match(html, /id="raidLootCreateStartDate"[^>]*type="date"[^>]*required/);

  assert.match(source, /core\.SEATS\.map\(\(seat\) => \(\{/);
  assert.match(source, /startDate:\s*elements\.startDate\.value/);
  assert.match(source, /currentWeek:\s*1/);
  assert.match(source, /policy:\s*"fair"/);
  assert.match(source, /roster:\s*rosterValue\(\)/);
  assert.match(source, /store\.createRoom\(\{/);
  assert.match(source, /window\.location\.assign\(roomUrl\("summary\.html", roomId\)\.toString\(\)\)/);
});

test("1주차 시작일은 브라우저의 오늘 날짜로 초기화하고 공유 링크는 입력 페이지를 가리킨다", () => {
  assert.match(source, /elements\.startDate\.value \|\|= localDateString\(\)/);
  assert.match(source, /roomUrl\("room\.html", room\.id\)/);
  assert.match(source, /roomUrl\("summary\.html", room\.id\)/);
  assert.match(source, /copyText\(roomUrl\("room\.html", core\.validateRoomId/);
});
