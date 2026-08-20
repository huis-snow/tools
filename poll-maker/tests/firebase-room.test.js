"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const POLL_ROOT = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("익명 투표 Firebase 공개 설정은 기존 프로젝트를 재사용하고 비공개 키를 포함하지 않는다", () => {
  const pollConfig = read("poll-maker/firebase-config.js");
  const scheduleConfig = read("schedule-maker/firebase-config.js");

  assert.match(pollConfig, /root\.AnonymousPollFirebaseConfig = Object\.freeze/);
  for (const key of ["apiKey", "authDomain", "projectId", "appId", "appCheckSiteKey"]) {
    const value = scheduleConfig.match(new RegExp(`${key}:\\s*"([^"]+)"`))?.[1];
    assert.ok(value, `${key} 설정을 찾을 수 있어야 한다`);
    assert.match(pollConfig, new RegExp(`${key}:\\s*"${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.doesNotMatch(pollConfig, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});

test("투표 저장소는 익명 참여와 Google 방장 로그인을 모두 지원한다", () => {
  const store = read("poll-maker/firebase-room-store.js");
  const authImports = store.match(/import \{([\s\S]*?)\} from "https:\/\/www\.gstatic\.com\/firebasejs\/12\.16\.0\/firebase-auth\.js";/)?.[1] || "";

  assert.match(store, /const core = globalThis\.AnonymousPollCore/);
  assert.match(store, /core\.firebaseConfigReady\(config\)/);
  assert.match(store, /initializeApp\(publicFirebaseConfig\(config\), "anonymous-poll-online-room"\)/);
  assert.match(store, /ReCaptchaEnterpriseProvider/);
  assert.match(store, /browserLocalPersistence/);
  assert.match(authImports, /\bonAuthStateChanged\b/);
  assert.match(store, /options\.ensureAnonymous === true/);
  assert.match(store, /async function ensureParticipantSession\(\)/);
  assert.match(store, /function subscribeAuthState\(onValue, onError\)/);
  assert.match(store, /return onAuthStateChanged\(auth, onValue, onError\)/);
  assert.match(store, /subscribeAuthState,\s*\n\s*ensureParticipantSession/);
  assert.match(store, /async function signInCreatorWithGoogle\(\)/);
  assert.match(store, /linkWithPopup/);
  assert.match(store, /signInWithPopup/);
  assert.match(store, /signInWithCredential/);
});

test("Google 방장은 parent와 빈 ballots/current 문서를 같은 batch로 만든다", () => {
  const store = read("poll-maker/firebase-room-store.js");

  assert.match(store, /function requireGoogleAccount\(\)/);
  assert.match(store, /doc\(database, "pollRooms", core\.validateRoomId\(roomId\)\)/);
  assert.match(store, /doc\(roomReference\(roomId\), "ballots", CURRENT_BALLOT_ID\)/);
  assert.match(store, /const batch = writeBatch\(database\)/);
  assert.match(store, /batch\.set\(roomReference\(roomId\)/);
  assert.match(store, /resultVisibility: room\.resultVisibility/);
  assert.match(store, /batch\.set\(ballotReference\(roomId\)/);
  assert.match(store, /votes: \{\}/);
  assert.match(store, /await batch\.commit\(\)/);
});

test("방장 목록과 방·내 표·공개 범위별 결과 실시간 구독 API를 제공한다", () => {
  const store = read("poll-maker/firebase-room-store.js");
  const resultSubscription = store.match(/function subscribeResults\([\s\S]*?\n  async function castVote/)?.[0] || "";

  assert.match(store, /where\("ownerUid", "==", user\.uid\)/);
  assert.match(store, /orderBy\("updatedAt", "desc"\)/);
  assert.match(store, /limit\(OWNED_ROOM_LIMIT\)/);
  assert.match(store, /function subscribeRoom\(/);
  assert.match(store, /function subscribeOwnVote\(/);
  assert.match(store, /function subscribeResults\(/);
  assert.match(resultSubscription, /requireUser\(\)/);
  assert.doesNotMatch(resultSubscription, /requireGoogleAccount\(\)/);
  assert.equal(
    (store.match(/snapshot\.data\(\{ serverTimestamps: "estimate" \}\)/g) || []).length,
    3,
    "room, own vote, result 구독은 pending serverTimestamp의 추정값을 사용해야 한다",
  );
  assert.match(
    store,
    /core\.normalizeRoomSnapshot\(\s*snapshot\.data\(\{ serverTimestamps: "estimate" \}\),\s*normalizedId/,
  );
  assert.match(
    store,
    /core\.normalizeVoteSnapshot\(\s*snapshot\.data\(\{ serverTimestamps: "estimate" \}\)/,
  );
  assert.match(
    store,
    /core\.normalizeResultSnapshot\(\s*snapshot\.data\(\{ serverTimestamps: "estimate" \}\)/,
  );
});

test("투표는 숫자 집계를 읽지 않고 무작위 ballot 필드와 내 vote만 transaction에서 바꾼다", () => {
  const store = read("poll-maker/firebase-room-store.js");
  const castVote = store.match(/async function castVote\([\s\S]*?\n  async function setLocked/)?.[0] || "";

  assert.match(castVote, /runTransaction\(database/);
  assert.match(castVote, /transaction\.get\(roomRef\)/);
  assert.match(castVote, /transaction\.get\(voteRef\)/);
  assert.doesNotMatch(castVote, /transaction\.get\(ballotRef\)/);
  assert.match(castVote, /previous\?\.ballotKey \|\| core\.createBallotKey\(\)/);
  assert.match(castVote, /transaction\.set\(voteRef/);
  assert.match(castVote, /ballotKey,/);
  assert.match(castVote, /transaction\.update\(voteRef/);
  assert.match(castVote, /new FieldPath\("votes", ballotKey\)/);
  assert.match(castVote, /transaction\.update\(\s*ballotRef,/);
  assert.doesNotMatch(castVote, /increment\(|counts\.|resultUpdate|total/);
  assert.match(castVote, /if \(room\.locked\)/);
});

test("투표방 parent에는 공개 집계가 없고 방장은 마감 상태만 바꿀 수 있다", () => {
  const rules = read("firestore.rules");
  const roomValidator = rules.match(/function validPollRoom\(data\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  const pollMatch = rules.match(/match \/pollRooms\/\{roomId\} \{([\s\S]*?)\n    match \/\{document=\*\*\}/)?.[1] || "";

  assert.match(pollMatch, /function pollOwnerLockUpdate\(\)/);
  assert.match(pollMatch, /changes\.hasOnly\(\['locked', 'updatedAt'\]\)/);
  assert.match(pollMatch, /changes\.hasAll\(\['locked', 'updatedAt'\]\)/);
  assert.doesNotMatch(roomValidator, /'counts'|'total'/);
  assert.match(pollMatch, /allow delete: if false/);
});

test("익명 투표함 get은 방장·전체 공개·투표 완료 공개를 구분하고 list는 막는다", () => {
  const rules = read("firestore.rules");
  const ballotMatch = rules.match(/match \/ballots\/\{ballotId\} \{([\s\S]*?)\n      match \/votes\/\{voterUid\}/)?.[1] || "";
  const ballotGet = ballotMatch.match(/allow get:[\s\S]*?;/)?.[0] || "";

  assert.match(ballotGet, /ballotId == 'current'/);
  assert.match(ballotGet, /signedIn\(\)/);
  assert.match(ballotGet, /pollCanReadResults\(\)/);
  assert.doesNotMatch(ballotGet, /googleAccount\(\)/);
  assert.match(ballotMatch, /googleAccount\(\) &&\s*parent\.data\.ownerUid == request\.auth\.uid/);
  assert.match(ballotMatch, /parent\.data\.ownerUid == request\.auth\.uid/);
  assert.match(ballotMatch, /parent\.data\.resultVisibility == 'public'/);
  assert.match(ballotMatch, /parent\.data\.resultVisibility == 'voters'/);
  assert.match(
    ballotMatch,
    /exists\([^\n]+pollRooms\/\$\(roomId\)\/votes\/\$\(request\.auth\.uid\)\)/,
  );
  assert.match(ballotMatch, /allow list: if false/);
  assert.match(ballotMatch, /allow delete: if false/);
});

test("개별 vote 문서는 본인만 get하고 누구도 list하거나 삭제할 수 없다", () => {
  const rules = read("firestore.rules");
  const voteMatch = rules.match(/match \/votes\/\{voterUid\} \{([\s\S]*?)\n      \}\n    \}/)?.[1] || "";

  assert.match(voteMatch, /voterUid == request\.auth\.uid/);
  assert.match(voteMatch, /allow get:/);
  assert.match(voteMatch, /allow list: if false/);
  assert.match(voteMatch, /allow delete: if false/);
  assert.match(voteMatch, /request\.resource\.data\.createdAt == request\.time/);
  assert.match(voteMatch, /request\.resource\.data\.ballotKey == resource\.data\.ballotKey/);
  assert.match(voteMatch, /changes\.hasOnly\(\['choice', 'updatedAt'\]\)/);
  assert.match(voteMatch, /changes\.hasAll\(\['choice', 'updatedAt'\]\)/);
});

test("Rules는 own vote와 무작위 ballot 필드 하나의 정확한 원자적 전이를 교차 검증한다", () => {
  const rules = read("firestore.rules");
  const pollMatch = rules.match(/match \/pollRooms\/\{roomId\} \{([\s\S]*?)\n    match \/\{document=\*\*\}/)?.[1] || "";
  const ballotMatch = pollMatch.match(/match \/ballots\/\{ballotId\} \{([\s\S]*?)\n      match \/votes\/\{voterUid\}/)?.[1] || "";
  const ballotUpdate = ballotMatch.match(/allow update:([\s\S]*?)allow delete:/)?.[1] || "";

  assert.match(rules, /function validPollBallotTransition\(/);
  assert.match(rules, /data\.votes\.size\(\) <= 100/);
  assert.match(rules, /beforeBallot\.votes\.size\(\) < 100/);
  assert.match(rules, /voteChanges\.affectedKeys\(\)\.hasOnly\(\[ballotKey\]\)/);
  assert.match(rules, /voteChanges\.affectedKeys\(\)\.hasAll\(\[ballotKey\]\)/);
  assert.match(rules, /afterBallot\.votes\.size\(\) == beforeBallot\.votes\.size\(\) \+ 1/);
  assert.match(rules, /afterBallot\.votes\.size\(\) == beforeBallot\.votes\.size\(\)/);
  assert.match(rules, /pollFirstBallotUpdate\(\)/);
  assert.match(rules, /pollChangedBallotUpdate\(\)/);
  assert.match(rules, /pollFirstVoteCreate\(\)/);
  assert.match(rules, /pollVoteChange\(\)/);
  assert.match(rules, /getAfter\([^\n]+votes\/\$\(request\.auth\.uid\)\)/);
  assert.match(rules, /getAfter\([^\n]+ballots\/current\)/);
  assert.match(ballotUpdate, /signedIn\(\)/);
  assert.match(ballotUpdate, /pollBallotOpenBeforeAndAfter\(\)/);
  assert.match(ballotUpdate, /pollFirstBallotUpdate\(\)/);
  assert.match(ballotUpdate, /pollChangedBallotUpdate\(\)/);
  assert.doesNotMatch(ballotUpdate, /ownerUid|googleAccount\(\)/);
  assert.doesNotMatch(pollMatch, /match \/results\/|function validPollResult\(|counts|total|100000/);
});

test("방 생성과 방장 목록은 Google 계정·비밀 ID·최대 30개를 강제한다", () => {
  const rules = read("firestore.rules");
  const pollMatch = rules.match(/match \/pollRooms\/\{roomId\} \{([\s\S]*?)\n    match \/\{document=\*\*\}/)?.[1] || "";

  assert.match(pollMatch, /allow get: if signedIn\(\) && validRoomId\(roomId\)/);
  assert.match(pollMatch, /allow list: if googleAccount\(\)/);
  assert.match(pollMatch, /request\.query\.limit <= 30/);
  assert.match(pollMatch, /allow create: if googleAccount\(\)/);
  assert.match(pollMatch, /request\.resource\.data\.version == 2/);
  assert.match(pollMatch, /validInitialPollBallot\(roomId\)/);
});

test("Rules는 v2 공개 범위를 필수 검증하면서 기존 v1을 owner-only로 유지한다", () => {
  const rules = read("firestore.rules");
  const roomValidator = rules.match(/function validPollRoom\(data\) \{([\s\S]*?)\n    \}/)?.[1] || "";

  assert.match(rules, /function validPollResultVisibility\(resultVisibility\)/);
  for (const visibility of ["public", "voters", "owner"]) {
    assert.match(rules, new RegExp(`resultVisibility == '${visibility}'`));
  }
  assert.match(roomValidator, /data\.version == 1/);
  assert.match(roomValidator, /!\('resultVisibility' in data\)/);
  assert.match(roomValidator, /data\.version == 2/);
  assert.match(roomValidator, /'resultVisibility' in data/);
  assert.match(roomValidator, /validPollResultVisibility\(data\.resultVisibility\)/);
});

test("익명 투표 방장 목록용 복합 색인이 기존 색인과 함께 등록된다", () => {
  const indexes = JSON.parse(read("firestore.indexes.json"));
  const byCollection = Object.fromEntries(indexes.indexes.map((index) => [index.collectionGroup, index]));

  for (const collectionGroup of ["rooms", "bisRooms", "raidLootRooms"]) {
    assert.ok(byCollection[collectionGroup], `기존 ${collectionGroup} 색인이 유지되어야 한다`);
  }
  assert.deepEqual(byCollection.pollRooms, {
    collectionGroup: "pollRooms",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "ownerUid", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "DESCENDING" },
    ],
  });
});

test("Firebase 파일은 예상 경로에만 있으며 서비스 계정 자료가 없다", () => {
  assert.equal(fs.existsSync(path.join(POLL_ROOT, "firebase-config.js")), true);
  assert.equal(fs.existsSync(path.join(POLL_ROOT, "firebase-room-store.js")), true);

  const source = [
    read("poll-maker/firebase-config.js"),
    read("poll-maker/firebase-room-store.js"),
  ].join("\n");
  assert.doesNotMatch(source, /private_key|service_account|client_email|BEGIN PRIVATE KEY/i);
});
