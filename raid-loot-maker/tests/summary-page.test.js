"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(APP_ROOT, "summary.html"), "utf8");
const source = fs.readFileSync(path.join(APP_ROOT, "summary-page.js"), "utf8");

function controllerIds(value) {
  return [...value.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
}

test("8주 현황 컨트롤러가 참조하는 모든 ID가 문서에 존재한다", () => {
  const missing = controllerIds(source).filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test("방·8인 명단·append-only 분배 원장을 익명 읽기 세션에서 함께 실시간 구독한다", () => {
  assert.match(source, /createRaidLootRoomStore\(firebaseConfig, \{ ensureAnonymous: true \}\)/);
  assert.match(source, /store\.subscribeRoom\(roomId/);
  assert.match(source, /store\.subscribeMembers\(roomId/);
  assert.match(source, /store\.subscribeLootEvents\(roomId/);
  assert.match(source, /room\.ownerUid === store\.user\.uid && store\.isGoogleAccount\(\)/);
  assert.match(source, /roomUnsubscribe\?\.\(\)/);
  assert.match(source, /membersUnsubscribe\?\.\(\)/);
  assert.match(source, /eventsUnsubscribe\?\.\(\)/);
});

test("1~8주 탭은 주별 기록 수와 시작 날짜를 표시하고 키보드로 이동한다", () => {
  const weeks = [...html.matchAll(/id="raidLootWeekTab([1-8])"[^>]*data-week="([1-8])"/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(weeks, Array.from({ length: 8 }, (_item, index) => [index + 1, index + 1]));
  assert.match(source, /eventsInWeek\(week\)\.length/);
  assert.match(source, /day \+ \(\(Number\(week\) - 1\) \* 7\)/);
  assert.match(source, /core\.FARMING_WEEKS/);
  assert.match(source, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(source, /selectedWeek = core\.normalizeWeek\(button\.dataset\.week\)/);
});

test("선택 주차까지 활성 배정만 11×8 표에 누적 획득 상태로 겹쳐 표시한다", () => {
  assert.equal((html.match(/<tr data-slot=/g) || []).length, 11);
  assert.equal((html.match(/<td data-seat=/g) || []).length, 88);
  assert.match(source, /core\.activeLootEvents\(events\)/);
  assert.match(source, /filter\(\(event\) => Number\(event\.week\) <= Number\(week\)\)/);
  assert.match(source, /event\.action === "award" && core\.DROP_SPECS\[event\.dropType\]\.consumesNeed/);
  assert.match(source, /received\.add\(`\$\{event\.seat\}@\$\{event\.gearSlot\}`\)/);
  assert.match(source, /if \(received\.has\(`\$\{member\.seat\}@\$\{gearSlot\}`\)\) return "received"/);
  assert.match(source, /core\.GEAR_SLOTS\.forEach/);
  assert.match(source, /core\.SEATS\.forEach/);
});

test("누적 공정 통계와 방 정책으로 후보 순위·추천 이유를 계산한다", () => {
  assert.match(source, /core\.cumulativeStatistics\(members, through\)/);
  assert.match(source, /stat\.totalAwards/);
  assert.match(source, /core\.rankCandidates\(\{/);
  assert.match(source, /events:\s*candidateHistory\(\)/);
  assert.match(source, /policy:\s*room\.policy/);
  assert.match(source, /candidate\.reasons\.join\(" · "\)/);
  assert.match(source, /elements\.recordEventButton\.disabled = actionBusy \|\| !isOwner\(\)/);
  for (const policy of ["fair", "progression", "manual"]) {
    assert.match(html, new RegExp(`<option value="${policy}">`));
  }
});

test("층을 고를 때 17종 드랍을 동적으로 제한하고 직접 무기는 공대 직업을 요구한다", () => {
  const dropTypes = [...html.matchAll(/<option value="([a-z_]+)">/g)]
    .map((match) => match[1])
    .filter((value) => !["fair", "progression", "manual", "recommended", "free", "all"].includes(value));
  assert.equal(new Set(dropTypes).size, 17);
  assert.match(source, /core\.floorDropTypes\(floor\)\.forEach/);
  assert.match(source, /core\.DROP_SPECS\[dropType\]\.label/);
  assert.match(source, /elements\.eventDropTypeSelect\.value === "direct_weapon"/);
  assert.match(source, /members\.map\(\(member\) => member\.job\)/);
  assert.match(source, /elements\.directWeaponJobSelect\.required = direct/);
  assert.match(source, /job: dropType === "direct_weapon"/);
  assert.match(source, /core\.normalizeDrop\(\{/);
});

test("실제 배정·미분배·되돌리기를 각각 원장 이벤트로 추가하고 원본을 직접 삭제하지 않는다", () => {
  assert.match(source, /core\.createAwardEvent\(\{/);
  assert.match(source, /decision:\s*elements\.decisionSelect\.value/);
  assert.match(source, /countsForFairness:\s*elements\.countsForFairnessInput\.checked/);
  assert.match(source, /store\.createLootEvent\(roomId, draft\)/);
  assert.match(source, /core\.createSkipEvent\(\{/);
  assert.match(source, /reason:\s*"unclaimed"/);
  assert.match(source, /store\.undoLootEvent\(roomId, eventId/);
  assert.match(source, /원본은 지우지 않고 되돌리기 이력이 추가됩니다/);
  assert.match(source, /원본과 되돌리기 이력은 보존됩니다/);
  assert.doesNotMatch(source, /deleteLootEvent|removeLootEvent/);
});

test("방장은 주차·시작일·정책·잠금·자리 연결·방 삭제와 두 공유 링크를 관리한다", () => {
  assert.match(source, /store\.updateRoom\(roomId, \{/);
  assert.match(source, /startDate:\s*elements\.ownerStartDateInput\.value/);
  assert.match(source, /currentWeek:\s*Number\(elements\.ownerCurrentWeekSelect\.value\)/);
  assert.match(source, /policy:\s*core\.normalizePolicy\(preset\)/);
  assert.match(source, /locked:\s*!room\.locked/);
  assert.match(source, /store\.releaseMember\(roomId, seat\)/);
  assert.match(source, /store\.removeRoom\(roomId\)/);
  assert.match(source, /copyText\(inputUrl\(\)\.toString\(\)\)/);
  assert.match(source, /copyText\(summaryUrl\(\)\.toString\(\)\)/);
  assert.match(source, /기존 원장은 그대로 보존됩니다/);
});

test("선택 주차까지의 현황을 동일한 이미지 API로 클립보드 복사하거나 PNG 저장한다", () => {
  assert.match(source, /imageRenderer\.renderRaidLootSummaryImage\(room, members, events, \{ week: selectedWeek \}\)/);
  assert.match(source, /new ClipboardItem\(\{ "image\/png": blob \}\)/);
  assert.match(source, /navigator\.clipboard\.write/);
  assert.match(source, /link\.download = `\$\{room\.title\.replace/);
  assert.match(source, /-\$\{selectedWeek\}주차-공대파밍표\.png`/);
  assert.match(source, /URL\.revokeObjectURL\(blobUrl\)/);
});
