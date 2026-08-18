"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const directory = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(directory, "summary.html"), "utf8");
const source = fs.readFileSync(path.join(directory, "summary-page.js"), "utf8");

test("전체 현황 페이지는 방과 8명의 변경을 실시간으로 함께 구독한다", () => {
  assert.match(source, /createBisRoomStore\(firebaseConfig, \{ ensureAnonymous: true \}\)/);
  assert.match(source, /store\.subscribeRoom\(roomId/);
  assert.match(source, /store\.subscribeMembers\(roomId/);
  assert.match(source, /room\.ownerUid === store\.user\.uid/);
});

test("전체 현황표의 11개 부위와 네 가지 필터를 실제 렌더링한다", () => {
  assert.match(source, /core\.GEAR_SLOTS\.forEach/);
  assert.match(source, /core\.decodeGear\(member\.gear/);
  for (const filter of ["all", "incomplete", "raid", "upgrade"]) {
    assert.match(html, new RegExp(`data-filter="${filter}"`));
  }
});

test("주간 분배는 13종 실제 수량을 자동 추천하고 수동 계획도 검증해 저장한다", () => {
  assert.equal((html.match(/name="drop-[^"]+"/g) || []).length, 13);
  assert.match(source, /core\.autoAllocateDrops\(members, counts/);
  assert.match(source, /core\.normalizeDistribution\(\{/);
  assert.match(source, /core\.distributionPlan\(normalized\)/);
  assert.match(source, /savedAssignmentKey/);
  assert.match(source, /store\.saveDistribution\(roomId, distribution\)/);
  assert.match(source, /unassignedDrops\.push/);
});

test("방장은 방 정보·잠금·자리 점유·삭제를 관리하며 주차 변경을 경고한다", () => {
  assert.match(source, /if \(requestedSettings\.week !== room\.week\) changes\.week = requestedSettings\.week/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(changes, "week"\)/);
  assert.match(source, /store\.updateRoom\(roomId, changes\)/);
  assert.match(source, /저장된 드랍 수량과 분배안은 새 주차에 맞춰 모두 초기화/);
  assert.match(source, /store\.updateRoom\(roomId, \{ locked: nextLocked \}\)/);
  assert.match(source, /store\.releaseMember\(roomId, seat\)/);
  assert.match(source, /store\.removeRoom\(roomId\)/);
});

test("공유 링크와 전체 현황 이미지는 복사 실패 시 PNG 저장으로 대체한다", () => {
  assert.match(source, /copyText\(inputUrl\(\)\.toString\(\)\)/);
  assert.match(source, /copyText\(summaryUrl\(\)\.toString\(\)\)/);
  assert.match(source, /BisTrackerImage\.renderBisSummaryImage\(room, members\)/);
  assert.match(source, /new ClipboardItem\(\{ "image\/png": blob \}\)/);
  assert.match(source, /downloadBlob\(blob\)/);
});
