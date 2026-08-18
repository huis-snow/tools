"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const BIS_ROOT = path.resolve(__dirname, "..");
const SEATS = ["MT", "ST", "MH", "SH", "D1", "D2", "D3", "D4"];
const DROP_TYPES = [
  "raid_weapon",
  "raid_head",
  "raid_body",
  "raid_hands",
  "raid_legs",
  "raid_feet",
  "raid_earrings",
  "raid_necklace",
  "raid_bracelets",
  "raid_ring",
  "upgrade_weapon",
  "upgrade_armor",
  "upgrade_accessory",
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("BiS Firebase 공개 설정은 기존 프로젝트를 재사용하고 비공개 키를 포함하지 않는다", () => {
  const bisConfig = read("bis-maker/firebase-config.js");
  const scheduleConfig = read("schedule-maker/firebase-config.js");

  assert.match(bisConfig, /root\.BisTrackerFirebaseConfig = Object\.freeze/);
  for (const key of ["apiKey", "authDomain", "projectId", "appId", "appCheckSiteKey"]) {
    const value = scheduleConfig.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
    assert.ok(value, `${key} 설정을 찾을 수 있어야 한다`);
    assert.match(bisConfig, new RegExp(`${key}:\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.doesNotMatch(bisConfig, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});

test("BiS 저장소는 global core가 준비된 뒤 별도의 Firebase 앱으로 연결한다", () => {
  const store = read("bis-maker/firebase-room-store.js");

  assert.match(store, /const core = globalThis\.BisTrackerCore/);
  assert.match(store, /core\.firebaseConfigReady\(config\)/);
  assert.match(store, /initializeApp\(publicFirebaseConfig\(config\), "bis-tracker-online-room"\)/);
  assert.match(store, /ReCaptchaEnterpriseProvider/);
  assert.match(store, /browserLocalPersistence/);
  assert.match(store, /ensureAnonymous: true|options\.ensureAnonymous === true/);
});

test("방 생성은 Google 방장만 가능하고 8명 문서를 같은 batch에 미리 만든다", () => {
  const store = read("bis-maker/firebase-room-store.js");

  assert.match(store, /function requireGoogleAccount\(\)/);
  assert.match(store, /linkWithPopup/);
  assert.match(store, /signInWithPopup/);
  assert.match(store, /signInWithCredential/);
  assert.match(store, /collection\(database, "bisRooms"\)/);
  assert.match(store, /const batch = writeBatch\(database\)/);
  assert.match(store, /batch\.set\(roomReference\(roomId\)/);
  assert.match(store, /members\.forEach\(\(member\) => \{\s*batch\.set\(memberReference\(roomId, member\.seat\), member\)/);
  assert.match(store, /await batch\.commit\(\)/);
  assert.match(store, /editorUid: ""/);
  assert.match(store, /gear: "X"\.repeat\(11\)/);
  assert.match(store, /submitted: false/);

  for (const seat of SEATS) assert.match(store, new RegExp(`"${seat}"`));
  for (const dropType of DROP_TYPES) assert.match(store, new RegExp(`"${dropType}"`));
});

test("참여자는 transaction으로 빈 자리만 선점하고 이후 같은 UID로 저장한다", () => {
  const store = read("bis-maker/firebase-room-store.js");

  assert.match(store, /async function saveMember\(roomId, seat, value, saveOptions = \{\}\)/);
  assert.match(store, /await runTransaction\(database/);
  assert.match(store, /const editorUid = String\(snapshot\.data\(\)\.editorUid \|\| ""\)/);
  assert.match(store, /if \(editorUid && editorUid !== user\.uid\)/);
  assert.match(store, /editorUid: user\.uid/);
  assert.match(store, /gear: progress\.gear/);
  assert.match(store, /submitted: progress\.submitted/);
  assert.match(store, /expectedGear/);
  assert.match(store, /error\.currentGear = currentGear/);
});

test("동일 익명 UID의 여러 자리 동시 점유는 batch 최종 상태를 기준으로 막는다", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /function noOtherBisSeatClaimedByRequester\(\)/);
  assert.match(rules, /getAfter\([^\n]+members\/MT\)\.data\.editorUid != request\.auth\.uid/);
  assert.doesNotMatch(rules, /get\([^\n]+members\/MT\)\.data\.editorUid != request\.auth\.uid/);
});

test("방장 목록·실시간 구독·배포 저장·자리 해제·전체 삭제 API를 제공한다", () => {
  const store = read("bis-maker/firebase-room-store.js");

  assert.match(store, /where\("ownerUid", "==", user\.uid\)/);
  assert.match(store, /orderBy\("createdAt", "desc"\)/);
  assert.match(store, /limit\(OWNED_ROOM_LIMIT\)/);
  assert.match(store, /function subscribeRoom\(/);
  assert.match(store, /function subscribeMembers\(/);
  assert.match(store, /orderBy\("seat", "asc"\)/);
  assert.match(store, /limit\(SEATS\.length\)/);
  assert.match(store, /async function updateRoom\(/);
  assert.match(store, /update\.distribution = emptyDistribution\(metadata\.week\)/);
  assert.match(store, /async function saveDistribution\(/);
  assert.match(store, /async function releaseMember\(/);
  assert.match(store, /editorUid: ""/);
  assert.match(store, /SEATS\.forEach\(\(seat\) => batch\.delete/);
  assert.match(store, /batch\.delete\(roomReference\(normalizedId\)\)/);
});

test("Firestore Rules는 BiS 방과 고정 8명·11칸 진행 상태를 엄격히 제한한다", () => {
  const rules = read("firestore.rules");

  assert.match(rules, /match \/bisRooms\/\{roomId\}/);
  assert.match(rules, /match \/members\/\{seat\}/);
  assert.match(rules, /function validBisSeat\(seat\)/);
  for (const seat of SEATS) assert.match(rules, new RegExp(`seat == '${seat}'`));
  assert.match(rules, /data\.gear\.matches\('\[XCUR\]\{11\}'\)/);
  assert.match(rules, /data\.submitted == false \|\| !data\.gear\.matches\('\.\*X\.\*'\)/);
  assert.match(rules, /data\.distribution\.week == data\.week/);
  assert.match(rules, /data\.editorUid\.size\(\) <= 128/);
  assert.match(rules, /resource\.data\.editorUid == ''/);
  assert.match(rules, /request\.resource\.data\.editorUid == request\.auth\.uid/);
  assert.match(rules, /function noOtherBisSeatClaimedByRequester\(\)/);
  for (const seat of SEATS) {
    assert.match(rules, new RegExp(`members/${seat}\\)\\.data\\.editorUid != request\\.auth\\.uid`));
  }
  assert.match(rules, /parentBefore\(\)\.data\.locked == false/);
  assert.match(rules, /request\.resource\.data\.nickname == resource\.data\.nickname/);
  assert.match(rules, /request\.resource\.data\.job == resource\.data\.job/);
  const ownerUpdate = rules.match(/function ownerMemberUpdate\(\) \{([\s\S]*?)\n        \}/)?.[1] || "";
  const memberValidator = rules.match(/function validBisMember\(data, seat\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.equal((memberValidator.match(/size\(\) <= 30/g) || []).length, 2);
  assert.match(ownerUpdate, /request\.resource\.data\.nickname == resource\.data\.nickname/);
  assert.match(ownerUpdate, /request\.resource\.data\.job == resource\.data\.job/);
  assert.match(ownerUpdate, /changes\.hasOnly\(\['editorUid', 'gear', 'submitted', 'updatedAt'\]\)/);
  assert.match(rules, /request\.query\.limit <= 8/);
  assert.match(rules, /allBisMembersExistAfter\(roomId\)/);
  assert.match(rules, /noBisMembersExistAfter\(roomId\)/);
});

test("Firestore Rules는 13종 드랍 수량과 배정 문자열을 고정 스키마로 검증한다", () => {
  const rules = read("firestore.rules");
  const countValidator = rules.match(/function validBisDropCounts\(data\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  const assignmentValidator = rules.match(/function validBisAssignments\(data\) \{([\s\S]*?)\n    \}/)?.[1] || "";

  for (const dropType of DROP_TYPES) {
    assert.match(countValidator, new RegExp(`'${dropType}'`));
    assert.match(assignmentValidator, new RegExp(`'${dropType}'`));
    assert.match(assignmentValidator, new RegExp(`validBisAssignment\\(data\\.${dropType}\\)`));
  }
  assert.match(rules, /data\.keys\(\)\.hasOnly\(\['week', 'dropCounts', 'assignments'\]\)/);
  assert.match(rules, /data\.week >= 1/);
  assert.match(rules, /data\.week <= 99/);
  assert.match(rules, /value\.size\(\) <= 255/);
  assert.match(rules, /MT\|ST\|MH\|SH\|D1\|D2\|D3\|D4/);
  assert.match(rules, /weapon\|head\|body\|hands\|legs\|feet/);
});

test("BiS 방 생성·삭제는 8명 문서의 원자적 생성·삭제를 강제한다", () => {
  const rules = read("firestore.rules");

  for (const seat of SEATS) {
    assert.match(
      rules,
      new RegExp(`existsAfter\\(\\/databases\\/\\$\\(database\\)\\/documents\\/bisRooms\\/\\$\\(roomId\\)\\/members\\/${seat}\\)`),
    );
  }
  assert.match(rules, /request\.resource\.data\.gear == 'XXXXXXXXXXX'/);
  assert.match(rules, /!exists\(\/databases\/\$\(database\)\/documents\/bisRooms\/\$\(roomId\)\)/);
  assert.match(rules, /!existsAfter\(\/databases\/\$\(database\)\/documents\/bisRooms\/\$\(roomId\)\)/);
});

test("BiS 방장 목록용 복합 색인이 기존 일정표 색인과 함께 등록된다", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  const byCollection = Object.fromEntries(indexes.indexes.map((index) => [index.collectionGroup, index]));

  assert.ok(byCollection.rooms, "기존 일정표 색인이 유지되어야 한다");
  assert.deepEqual(byCollection.bisRooms, {
    collectionGroup: "bisRooms",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "ownerUid", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
  });
});

test("Firebase 파일은 예상한 경로에만 있으며 서비스 계정 자료가 없다", () => {
  assert.equal(fs.existsSync(path.join(BIS_ROOT, "firebase-config.js")), true);
  assert.equal(fs.existsSync(path.join(BIS_ROOT, "firebase-room-store.js")), true);

  const source = [
    read("bis-maker/firebase-config.js"),
    read("bis-maker/firebase-room-store.js"),
  ].join("\n");
  assert.doesNotMatch(source, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});
