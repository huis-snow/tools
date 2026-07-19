"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const core = require("../online-room-core.js");

const ROOT = path.resolve(__dirname, "../..");

function validResponse(index = 0) {
  return {
    nickname: `참여자 ${index + 1}`,
    slots: index % 2 ? "_".repeat(28) : "A".repeat(28),
    updatedAt: { seconds: index },
  };
}

function validRoom(overrides = {}) {
  return {
    version: 1,
    title: "절렉 공대 가능한 시간",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 0,
    ownerUid: "owner-uid",
    locked: false,
    responses: {},
    createdAt: { seconds: 1 },
    updatedAt: { seconds: 1 },
    ...overrides,
  };
}

test("방 ID는 암호학적 난수 16바이트를 22자 base64url로 만든다", () => {
  const fakeCrypto = {
    getRandomValues(bytes) {
      bytes.forEach((_value, index) => {
        bytes[index] = index;
      });
      return bytes;
    },
  };
  const roomId = core.createRoomId(fakeCrypto);
  assert.equal(roomId, "AAECAwQFBgcICQoLDA0ODw");
  assert.equal(roomId.length, 22);
  assert.equal(core.validateRoomId(roomId), roomId);
  assert.throws(() => core.validateRoomId("short"));
  assert.throws(() => core.createRoomId({}));
});

test("방 설정은 필수 텍스트와 시간 범위를 정규화한다", () => {
  assert.deepEqual(core.normalizeRoomDraft({
    title: "  새벽 공대  ",
    timezone: "Asia/Seoul",
    startHour: "8",
    startDay: "5",
  }), {
    version: 1,
    title: "새벽 공대",
    timezone: "Asia/Seoul",
    startHour: 8,
    startDay: 5,
  });
  assert.throws(() => core.normalizeRoomDraft({ title: "", timezone: "Asia/Seoul", startHour: 8, startDay: 0 }));
  assert.throws(() => core.normalizeRoomDraft({ title: "방", timezone: "Asia Seoul", startHour: 8, startDay: 0 }));
  assert.throws(() => core.normalizeRoomDraft({ title: "방", timezone: "Asia/Seoul", startHour: 24, startDay: 0 }));
  assert.throws(() => core.normalizeRoomDraft({ title: "방", timezone: "Asia/Seoul", startHour: 8, startDay: 7 }));
});

test("참여자 응답은 닉네임과 정확한 28자 선택 데이터만 받는다", () => {
  assert.deepEqual(core.normalizeResponse({
    nickname: "  휴이스  ",
    slots: "_".repeat(28),
  }), {
    nickname: "휴이스",
    slots: "_".repeat(28),
  });
  assert.throws(() => core.normalizeResponse({ nickname: "", slots: "A".repeat(28) }));
  assert.throws(() => core.normalizeResponse({ nickname: "휴이스", slots: "A".repeat(27) }));
  assert.throws(() => core.normalizeResponse({ nickname: "휴이스", slots: "+".repeat(28) }));
});

test("방 응답은 최대 8명이며 각 UID를 기존 취합 일정으로 변환한다", () => {
  const responses = Object.fromEntries(Array.from({ length: 8 }, (_value, index) => [
    `uid-${index}`,
    validResponse(index),
  ]));
  const room = core.normalizeRoomSnapshot(validRoom({ responses }), "AAECAwQFBgcICQoLDA0ODw");
  assert.equal(Object.keys(room.responses).length, 8);

  const schedules = core.roomSchedules(room);
  assert.equal(schedules.length, 8);
  assert.equal(schedules[0].remoteId, "uid-0");
  assert.equal(schedules[0].title, "참여자 1");
  assert.equal(schedules[0].timezone, "Asia/Seoul");
  assert.equal(schedules[0].startHour, 8);
  assert.equal(schedules[0].slots.length, 28);

  responses["uid-8"] = validResponse(8);
  assert.throws(() => core.normalizeRoomSnapshot(validRoom({ responses }), "AAECAwQFBgcICQoLDA0ODw"));
  assert.throws(() => core.normalizeRoomSnapshot(validRoom({ version: 2 }), "AAECAwQFBgcICQoLDA0ODw"));
});

test("방 공유 URL은 기존 query와 hash를 버리고 room ID 하나만 남긴다", () => {
  const roomId = "AAECAwQFBgcICQoLDA0ODw";
  assert.equal(
    core.makeRoomUrl("https://example.test/schedule-maker/room.html?old=1#data", roomId),
    `https://example.test/schedule-maker/room.html?r=${roomId}`,
  );
});

test("Firebase 연결 여부는 공개 웹 설정 네 항목만 검사한다", () => {
  assert.equal(core.firebaseConfigReady({
    apiKey: "api-key",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    appId: "app-id",
  }), true);
  assert.equal(core.firebaseConfigReady({
    apiKey: "",
    authDomain: "project.firebaseapp.com",
    projectId: "project",
    appId: "app-id",
  }), false);
});

test("온라인 방 페이지는 noindex와 공개 설정·Firebase 모듈 로드 순서를 유지한다", () => {
  const html = fs.readFileSync(path.join(ROOT, "schedule-maker/room.html"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex, follow"\s*\/>/);
  assert.match(html, /id="onlineGoogleSignInButton"/);
  assert.match(html, /id="onlineGoogleSignOutButton"/);
  assert.match(html, /id="onlineOwnedRoomsLink" href="\.\/room\.html\?view=mine"/);
  assert.match(html, /id="onlineRoomCreateForm"/);
  assert.match(html, /id="onlineOwnedRoomsSection"/);
  assert.match(html, /id="onlineOwnedRoomTemplate"/);
  assert.match(html, /id="onlineSaveResponseButton"/);
  assert.match(html, /id="compareGrid"/);
  assert.match(html, /닉네임과 선택한 시간은 Firebase에 저장됩니다/);

  const coreIndex = html.indexOf('src="online-room-core.js"');
  const configIndex = html.indexOf('src="firebase-config.js"');
  const appIndex = html.indexOf('src="app.js"');
  const pageIndex = html.indexOf('src="room-page.js"');
  assert.ok(coreIndex < configIndex && configIndex < appIndex && appIndex < pageIndex);
});

test("공개 Firebase 설정에는 서비스 계정 비공개 키가 없다", () => {
  const config = fs.readFileSync(path.join(ROOT, "schedule-maker/firebase-config.js"), "utf8");
  assert.match(config, /apiKey/);
  assert.doesNotMatch(config, /private_key|service_account|client_email/i);
});

test("Firebase 방 저장소는 Google 방장과 익명 참여자를 분리하고 본인 방만 조회한다", () => {
  const store = fs.readFileSync(path.join(ROOT, "schedule-maker/firebase-room-store.js"), "utf8");
  const page = fs.readFileSync(path.join(ROOT, "schedule-maker/room-page.js"), "utf8");

  assert.match(store, /linkWithPopup/);
  assert.match(store, /signInWithPopup/);
  assert.match(store, /signInWithCredential/);
  assert.match(store, /get user\(\)\s*{\s*return auth\.currentUser;/);
  assert.doesNotMatch(store, /const user = auth\.currentUser \|\|/);
  assert.match(store, /where\("ownerUid", "==", user\.uid\)/);
  assert.match(store, /orderBy\("createdAt", "desc"\)/);
  assert.match(store, /limit\(OWNED_ROOM_LIMIT\)/);
  assert.match(page, /ensureAnonymous: Boolean\(requestedRoom\)/);
  assert.match(page, /requestParameters\.get\("view"\) === "mine"/);
  assert.match(page, /store\.signInCreatorWithGoogle\(\)/);
  assert.match(page, /store\.signOutCreator\(\{ ensureAnonymous: Boolean\(currentRoomId\) \}\)/);
  assert.match(page, /익명 .*을 보호하기 위해 Google 계정 전환을 중단했어요/);
});

test("Firestore Rules는 Google 방장 목록만 허용하고 9번째 응답과 타인 수정을 막는다", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  const indexes = fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8");
  const firebase = fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8");
  assert.match(rules, /function googleAccount\(\)/);
  assert.match(rules, /'google\.com' in request\.auth\.token\.firebase\.identities/);
  assert.match(rules, /allow list:\s*if googleAccount\(\)\s*&&\s*resource\.data\.ownerUid == request\.auth\.uid\s*&&\s*request\.query\.limit <= 30;/);
  assert.match(rules, /allow create:\s*if googleAccount\(\)/);
  assert.match(rules, /data\.responses\.size\(\)\s*<=\s*8/);
  assert.match(rules, /data\.title == data\.title\.trim\(\)/);
  assert.match(rules, /data\.nickname == data\.nickname\.trim\(\)/);
  assert.match(rules, /responseChanges\.hasOnly\(\[request\.auth\.uid\]\)/);
  assert.match(rules, /resource\.data\.locked == false/);
  assert.match(rules, /responseChanges\.addedKeys\(\)\.size\(\) == 0/);
  assert.match(indexes, /"fieldPath": "ownerUid"/);
  assert.match(indexes, /"fieldPath": "createdAt"/);
  assert.match(indexes, /"order": "DESCENDING"/);
  assert.match(firebase, /"indexes": "firestore\.indexes\.json"/);
});
