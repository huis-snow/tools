"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const BIS_ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(BIS_ROOT, file), "utf8");
}

test("참여자 페이지는 방 주소를 검증하고 익명 세션으로 방과 8인 명단을 구독한다", () => {
  const page = read("room-page.js");

  assert.match(page, /core\.validateRoomId\(parameter\)/);
  assert.match(page, /createBisRoomStore\(firebaseConfig, \{ ensureAnonymous: true \}\)/);
  assert.match(page, /await store\.ensureParticipantSession\(\)/);
  assert.match(page, /store\.subscribeRoom\(/);
  assert.match(page, /store\.subscribeMembers\(/);
  assert.match(page, /members\.length === core\.SEATS\.length/);
});

test("Firebase UID로 이미 선점한 내 자리를 찾고 빈 자리만 새로 선택할 수 있다", () => {
  const page = read("room-page.js");

  assert.match(page, /member\.editorUid === uid/);
  assert.match(page, /if \(ownSeat\) return \{ disabled: true/);
  assert.match(page, /if \(member\.editorUid\) return member\.editorUid === uid/);
  assert.match(page, /ownSeat = uid \? core\.SEATS\.find/);
  assert.match(page, /core\.decodeGear\(member\.gear, \{ allowUnset: true \}\)/);
  assert.doesNotMatch(page, /signInCreatorWithGoogle|signInWithPopup|displayName|\.email/);
});

test("11개 상태를 모두 선택한 뒤 한 자리만 transaction 저장 API에 제출한다", () => {
  const page = read("room-page.js");

  assert.match(page, /selectedGearCount\(\)/);
  assert.match(page, /count === core\.GEAR_SLOTS\.length/);
  assert.match(page, /core\.normalizeMemberUpdate\(\{ gear, submitted: true \}\)/);
  assert.match(page, /await store\.saveMember\(/);
  assert.match(page, /expectedGear: baselineGearCode/);
  assert.match(page, /ownSeat = seat/);
  assert.match(page, /room\.locked/);
});

test("저장하지 않은 입력은 페이지 이탈 경고를 띄우고 UID는 화면에 노출하지 않는다", () => {
  const page = read("room-page.js");

  assert.match(page, /currentGearCode\(\) !== baselineGearCode/);
  assert.match(page, /window\.addEventListener\("beforeunload"/);
  assert.match(page, /if \(!editorDirty\) return/);
  assert.doesNotMatch(page, /dataset\.(?:uid|editorUid)|setAttribute\(["']data-(?:uid|editor-uid)/);
});
