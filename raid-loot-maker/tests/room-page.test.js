"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(APP_ROOT, "room.html"), "utf8");
const source = fs.readFileSync(path.join(APP_ROOT, "room-page.js"), "utf8");

function controllerIds(value) {
  return [...value.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
}

test("공대원 컨트롤러가 참조하는 모든 ID가 문서에 존재한다", () => {
  const missing = controllerIds(source).filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("공유 주소를 검증하고 익명 세션으로 방과 고정 8인 명단을 실시간 구독한다", () => {
  assert.match(source, /roomId\s*=\s*roomIdFromLocation\(core\)/);
  assert.match(source, /createRaidLootRoomStore\(firebaseConfig, \{ ensureAnonymous: true \}\)/);
  assert.match(source, /store\.subscribeRoom\(roomId/);
  assert.match(source, /store\.subscribeMembers\(roomId/);
  assert.match(source, /members\.length === core\.SEATS\.length/);
  assert.doesNotMatch(source, /signInCreatorWithGoogle|signInWithPopup|displayName|\.email/);
});

test("Firebase UID로 한 자리만 이어서 편집하고 다른 사람이 선점한 자리는 막는다", () => {
  assert.match(source, /member\.editorUid === uid/);
  assert.match(source, /const claimed = myClaimedMember\(\)/);
  assert.match(source, /const occupied = Boolean\(member\?\.editorUid && !mine\)/);
  assert.match(source, /button\.disabled = !member \|\| saving \|\| occupied \|\| Boolean\(claimed && !mine\)/);
  assert.match(source, /const ownsSelectedSeat = !claimed \|\| claimed\.seat === selectedSeat/);
  assert.match(source, /&& ownsSelectedSeat/);
  assert.match(source, /if \(claimed && claimed\.seat !== seat\) return/);
  assert.match(source, /if \(claimed && claimed\.seat !== selectedSeat\) \{/);
  assert.match(source, /if \(member\.editorUid && member\.editorUid !== store\?\.user\?\.uid\) return/);
  assert.doesNotMatch(source, /dataset\.(?:uid|editorUid)|setAttribute\(["']data-(?:uid|editor-uid)/);
});

test("11개 부위는 완료·보강 필요·영식 필요 세 상태만 받아 optimistic conflict 검증으로 저장한다", () => {
  assert.equal((html.match(/class="gear-card" data-slot=/g) || []).length, 11);
  assert.equal((html.match(/value="complete"/g) || []).length, 11);
  assert.equal((html.match(/value="upgrade"/g) || []).length, 11);
  assert.equal((html.match(/value="raid"/g) || []).length, 11);
  assert.equal((html.match(/value="(?:complete|upgrade|raid)"/g) || []).length, 33);

  assert.match(source, /core\.GEAR_SLOTS\.filter/);
  assert.match(source, /count !== core\.GEAR_SLOTS\.length/);
  assert.match(source, /core\.normalizeMemberUpdate\(\{ gear: gearFromForm\(\), submitted: true \}\)/);
  assert.match(source, /store\.saveMember\(roomId, selectedSeat, progress, \{ expectedGear: loadedGear \}\)/);
  assert.match(source, /savedMember\.editorUid = store\.user\.uid/);
  assert.match(source, /savedMember\.gear = progress\.gear/);
  assert.match(source, /error\?\.code === "raid-loot\/conflict" && error\.currentGear/);
  assert.match(source, /setFormGear\(error\.currentGear\)/);
});

test("입력 마감과 저장하지 않은 변경을 보호하고 실시간 구독을 정리한다", () => {
  assert.match(source, /room\.locked/);
  assert.match(source, /dirty = core\.encodeGear\(gearFromForm\(\), \{ allowUnset: true \}\) !== loadedGear/);
  assert.match(source, /window\.addEventListener\("beforeunload"/);
  assert.match(source, /if \(!dirty\) return/);
  assert.match(source, /window\.addEventListener\("pagehide"/);
  assert.match(source, /unsubscribeRoom\?\.\(\)/);
  assert.match(source, /unsubscribeMembers\?\.\(\)/);
});
