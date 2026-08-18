"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const RAID_LOOT_ROOT = path.resolve(__dirname, "..");
const SEATS = ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"];
const DROP_TYPES = [
  "raid_earrings", "raid_necklace", "raid_bracelets", "raid_ring",
  "raid_head", "raid_hands", "raid_feet", "upgrade_accessory", "tome_weapon_token",
  "raid_body", "raid_legs", "upgrade_armor", "upgrade_weapon",
  "raid_weapon", "direct_weapon", "music", "mount",
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Firebase 계층과 core는 이벤트 상한·17종 드랍 스키마를 공유한다", () => {
  const core = require("../core.js");
  const store = read("raid-loot-maker/firebase-room-store.js");
  const rules = read("firestore.rules");

  assert.equal(core.MAX_LOOT_EVENTS, 480);
  assert.match(store, new RegExp(`const MAX_LOOT_EVENTS = ${core.MAX_LOOT_EVENTS}`));
  assert.deepEqual(core.DROP_TYPES, DROP_TYPES);
  for (const dropType of core.DROP_TYPES) {
    assert.match(rules, new RegExp(`dropType == '${dropType}'`));
  }
  assert.deepEqual(core.POLICY_PRESETS, ["manual", "fair", "progression", "custom"]);
  assert.deepEqual(core.AWARD_DECISIONS, ["recommended", "manual", "free"]);
});

test("공대 파밍 Firebase 공개 설정은 기존 프로젝트를 재사용하고 비공개 키를 포함하지 않는다", () => {
  const raidLootConfig = read("raid-loot-maker/firebase-config.js");
  const scheduleConfig = read("schedule-maker/firebase-config.js");

  assert.match(raidLootConfig, /root\.RaidLootFirebaseConfig = Object\.freeze/);
  for (const key of ["apiKey", "authDomain", "projectId", "appId", "appCheckSiteKey"]) {
    const value = scheduleConfig.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
    assert.ok(value, `${key} 설정을 찾을 수 있어야 한다`);
    assert.match(raidLootConfig, new RegExp(`${key}:\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.doesNotMatch(raidLootConfig, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});

test("공대 파밍 저장소는 전용 core와 별도 Firebase 앱으로 연결한다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");

  assert.match(store, /const core = globalThis\.RaidLootCore/);
  assert.match(store, /core\.firebaseConfigReady\(config\)/);
  assert.match(store, /initializeApp\(publicFirebaseConfig\(config\), "raid-loot-online-room"\)/);
  assert.match(store, /ReCaptchaEnterpriseProvider/);
  assert.match(store, /browserLocalPersistence/);
  assert.match(store, /options\.ensureAnonymous === true/);
});

test("Google 방장이 정확한 8명 문서와 방을 하나의 batch로 만든다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");

  assert.match(store, /function requireGoogleAccount\(\)/);
  assert.match(store, /linkWithPopup/);
  assert.match(store, /signInWithPopup/);
  assert.match(store, /signInWithCredential/);
  assert.match(store, /doc\(database, "raidLootRooms"/);
  assert.match(store, /const batch = writeBatch\(database\)/);
  assert.match(store, /batch\.set\(roomReference\(roomId\)/);
  assert.match(store, /members\.forEach\(\(member\) => \{\s*batch\.set\(memberReference\(roomId, member\.seat\), member\)/);
  assert.match(store, /await batch\.commit\(\)/);
  assert.match(store, /editorUid: ""/);
  assert.match(store, /gear: "X"\.repeat\(11\)/);
  assert.match(store, /submitted: false/);
  assert.match(store, /createdAt: serverTimestamp\(\)/);
  assert.match(store, /startDate: room\.startDate/);

  for (const seat of SEATS) assert.match(store, new RegExp(`"${seat}"`));
});

test("참여자는 transaction으로 빈 자리 하나만 선점하고 충돌을 감지한다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");
  const rules = read("firestore.rules");

  assert.match(store, /async function saveMember\(roomId, seat, value, saveOptions = \{\}\)/);
  assert.match(store, /await runTransaction\(database/);
  assert.match(store, /if \(editorUid && editorUid !== user\.uid\)/);
  assert.match(store, /editorUid: user\.uid/);
  assert.match(store, /expectedGear/);
  assert.match(store, /error\.currentGear = currentGear/);
  assert.match(rules, /function noOtherRaidLootSeatClaimedByRequester\(\)/);
  for (const seat of SEATS) {
    assert.match(rules, new RegExp(`raidLootRooms/\\$\\(roomId\\)/members/${seat}\\)\\.data\\.editorUid != request\\.auth\\.uid`));
  }
});

test("방·8명·이벤트를 실시간 구독하고 이벤트는 시간순 최대 480개만 읽는다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");

  assert.match(store, /const MAX_LOOT_EVENTS = 480/);
  assert.match(store, /function subscribeRoom\(/);
  assert.match(store, /function subscribeMembers\(/);
  assert.match(store, /function subscribeLootEvents\(/);
  assert.match(store, /collection\(roomReference\(roomId\), "events"\)/);
  assert.match(store, /where\("ownerUid", "==", user\.uid\)[\s\S]*orderBy\("updatedAt", "desc"\)/);
  assert.match(store, /orderBy\("createdAt", "asc"\)/);
  assert.match(store, /limit\(MAX_LOOT_EVENTS\)/);
  assert.match(store, /core\.normalizeLootEventSnapshot\(eventDocument\.data\(\), eventDocument\.id\)/);
  assert.match(store, /core\.normalizeLootEvents\(events\)/);
});

test("드랍 기록과 되돌리기는 기존 문서를 수정하지 않고 새 이벤트를 추가한다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");

  assert.match(store, /async function appendLootEvent\(/);
  assert.match(store, /const eventId = core\.createEventId\(\)/);
  assert.match(store, /core\.normalizeLootEventDraft\(draft\)/);
  assert.match(store, /core\.normalizeLootEvents\(\[\.\.\.events, pendingEvent\]\)/);
  assert.match(store, /batch\.set\(eventReference\(normalizedId, eventId\)/);
  assert.match(store, /batch\.update\(roomReference\(normalizedId\), \{\s*updatedAt: serverTimestamp\(\)/);
  assert.match(store, /createdBy: user\.uid/);
  assert.match(store, /createdAt: serverTimestamp\(\)/);
  assert.match(store, /async function createLootEvent\(/);
  assert.match(store, /async function undoLootEvent\(/);
  assert.match(store, /core\.createUndoEvent\(targetEventId, note\)/);
  assert.doesNotMatch(store, /async function (?:update|delete|remove)LootEvent/);
});

test("방 삭제는 최대 480개 이벤트와 8명, 방을 500회 미만의 단일 batch로 정리한다", () => {
  const store = read("raid-loot-maker/firebase-room-store.js");

  assert.match(store, /const MAX_LOOT_EVENTS = 480/);
  assert.ok(480 + SEATS.length + 1 < 500);
  assert.match(store, /const eventsSnapshot = await getDocs\(eventQuery\(normalizedId\)\)/);
  assert.match(store, /eventsSnapshot\.docs\.forEach\(\(eventDocument\) => batch\.delete\(eventDocument\.ref\)\)/);
  assert.match(store, /SEATS\.forEach\(\(seat\) => batch\.delete\(memberReference\(normalizedId, seat\)\)\)/);
  assert.match(store, /batch\.delete\(roomReference\(normalizedId\)\)/);
  assert.match(store, /await batch\.commit\(\)/);
});

test("Firestore Rules는 1~8주 방과 고정 정책·8명 장비 상태를 엄격히 검증한다", () => {
  const rules = read("firestore.rules");

  assert.match(rules, /match \/raidLootRooms\/\{roomId\}/);
  assert.match(rules, /function validRaidLootPolicy\(data\)/);
  assert.match(rules, /data\.preset == 'manual'/);
  assert.match(rules, /data\.preset == 'fair'/);
  assert.match(rules, /data\.preset == 'progression'/);
  assert.match(rules, /data\.preset == 'custom'/);
  assert.match(rules, /data\.seatOrder\.size\(\) == 8/);
  for (const seat of SEATS) assert.match(rules, new RegExp(`'${seat}' in data\\.seatOrder`));
  assert.match(rules, /data\.currentWeek >= 1/);
  assert.match(rules, /data\.currentWeek <= 8/);
  assert.match(rules, /data\.startDate\.matches\('\[1-9\]\[0-9\]\{3\}-/);
  assert.match(rules, /data\.gear\.matches\('\[XCUR\]\{11\}'\)/);
  assert.match(rules, /data\.submitted == false \|\| !data\.gear\.matches\('\.\*X\.\*'\)/);
  assert.match(rules, /allRaidLootMembersExistAfter\(roomId\)/);
  assert.match(rules, /noRaidLootMembersExistAfter\(roomId\)/);
});

test("Firestore Rules는 방장만 append-only award·skip·undo 이벤트를 기록하게 한다", () => {
  const rules = read("firestore.rules");
  const eventBlock = rules.match(/match \/events\/\{eventId\} \{([\s\S]*?)\n      \}/)?.[1] || "";

  assert.match(rules, /function validRaidLootAward\(data\)/);
  assert.match(rules, /function validRaidLootSkip\(data\)/);
  assert.match(rules, /function validRaidLootUndo\(data\)/);
  assert.match(rules, /data\.action == 'award'/);
  assert.match(rules, /data\.action == 'skip'/);
  assert.match(rules, /data\.action == 'undo'/);
  assert.match(rules, /data\.decision == 'recommended'/);
  assert.match(rules, /data\.decision == 'manual'/);
  assert.match(rules, /data\.decision == 'free'/);
  assert.match(rules, /data\.countsForFairness is bool/);
  for (const dropType of DROP_TYPES) assert.match(rules, new RegExp(`dropType == '${dropType}'`));
  for (const source of ["raid", "book", "external", "other"]) {
    assert.match(rules, new RegExp(`data\\.source == '${source}'`));
  }
  assert.match(rules, /function validRaidLootDropFloor\(data\)/);
  assert.match(rules, /function validRaidLootGearTarget\(data\)/);
  assert.match(rules, /data\.dropType == 'raid_ring' && \(data\.gearSlot == 'ring1' \|\| data\.gearSlot == 'ring2'\)/);
  assert.match(rules, /data\.dropType == 'upgrade_accessory'/);
  assert.match(rules, /data\.dropType == 'upgrade_armor'/);
  assert.match(rules, /data\.dropType == 'direct_weapon' && data\.gearSlot == 'weapon'/);
  assert.match(rules, /data\.dropType == 'tome_weapon_token' \|\|/);
  assert.match(rules, /function validRaidLootDirectWeaponRecipient\(\)/);
  assert.match(rules, /members\/\$\(request\.resource\.data\.seat\)\)\.data\.job == request\.resource\.data\.job/);
  assert.match(rules, /data\.reason == 'unclaimed'/);
  assert.match(rules, /data\.reason == 'external'/);
  assert.match(rules, /data\.reason == 'deferred'/);
  assert.match(eventBlock, /allow create: if googleAccount\(\)/);
  assert.match(eventBlock, /raidLootEventParentOwner\(\)/);
  assert.match(eventBlock, /request\.resource\.data\.createdBy == request\.auth\.uid/);
  assert.match(eventBlock, /request\.resource\.data\.createdAt == request\.time/);
  assert.match(eventBlock, /allow update: if false/);
  assert.match(eventBlock, /allow delete: if raidLootEventParentOwner\(\) &&\s*!existsAfter/);
  assert.match(eventBlock, /request\.query\.limit <= 480/);
  assert.match(rules, /target\.data\.action != 'undo'/);
});

test("공대 파밍 방장 목록 색인이 기존 일정표·BiS 색인과 함께 등록된다", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  const byCollection = Object.fromEntries(indexes.indexes.map((index) => [index.collectionGroup, index]));

  assert.ok(byCollection.rooms, "기존 일정표 색인이 유지되어야 한다");
  assert.ok(byCollection.bisRooms, "기존 BiS 색인이 유지되어야 한다");
  assert.deepEqual(byCollection.raidLootRooms, {
    collectionGroup: "raidLootRooms",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "ownerUid", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "DESCENDING" },
    ],
  });
});

test("Firebase 파일은 예상 경로에만 있고 서비스 계정 자료를 포함하지 않는다", () => {
  assert.equal(fs.existsSync(path.join(RAID_LOOT_ROOT, "firebase-config.js")), true);
  assert.equal(fs.existsSync(path.join(RAID_LOOT_ROOT, "firebase-room-store.js")), true);
  const source = [
    read("raid-loot-maker/firebase-config.js"),
    read("raid-loot-maker/firebase-room-store.js"),
  ].join("\n");
  assert.doesNotMatch(source, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});
