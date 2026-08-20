"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const POLL_ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(POLL_ROOT, "index-page.js"), "utf8");

test("투표방 생성은 Google 계정과 core 검증을 거쳐 참여 링크로 이동한다", () => {
  assert.match(page, /createPollRoomStore\(firebaseConfig\)/);
  assert.match(page, /store\?\.isGoogleAccount\?\.\(\)/);
  assert.match(page, /await store\.signInCreatorWithGoogle\(\)/);
  assert.match(page, /core\.normalizeRoomDraft\(\{/);
  assert.match(page, /agenda: elements\.agenda\.value/);
  assert.match(page, /description: elements\.description\.value/);
  assert.match(page, /await store\.createRoom\(draft\)/);
  assert.match(page, /window\.location\.assign\(core\.roomUrl\(roomId, window\.location\.href\)\.toString\(\)\)/);
});

test("내 투표방 목록은 개별 투표가 아니라 메타데이터만 렌더링하고 링크를 복사한다", () => {
  assert.match(page, /await store\.listOwnedRooms\(\)/);
  assert.match(page, /room\.agenda/);
  assert.match(page, /room\.description/);
  assert.match(page, /room\.locked/);
  assert.match(page, /core\.roomUrl\(room\.id, window\.location\.href\)/);
  assert.match(page, /copyText\(core\.roomUrl/);
  assert.doesNotMatch(page, /subscribeResults|subscribeOwnVote|votes\//);
  assert.doesNotMatch(page, /room\.counts|room\.total/);
});

test("Google 계정 전환이 익명 투표 수정 권한에 미치는 영향을 미리 경고한다", () => {
  assert.match(page, /hasPendingGoogleAccount/);
  assert.match(page, /기존 투표의 변경 권한을 잃을 수 있습니다/);
  assert.match(page, /switchToPendingGoogleAccount/);
  assert.match(page, /clearPendingGoogleAccount/);
});

test("다른 탭의 인증 변경을 반영하고 페이지를 떠날 때 인증 구독을 정리한다", () => {
  assert.match(page, /store\.subscribeAuthState\(/);
  assert.match(page, /function handleAuthState\(user\)/);
  assert.match(page, /identityKey\(user\)/);
  assert.match(page, /resetOwnedRooms\(\)/);
  assert.match(page, /await refreshOwnedRooms\(\)/);
  assert.match(page, /안건을 입력하면 새 익명 투표방을 만들 수 있어요/);
  assert.match(page, /window\.addEventListener\("pagehide"/);
  assert.match(page, /unsubscribeAuth\?\.\(\)/);
  assert.match(page, /window\.addEventListener\("pageshow"/);
  assert.match(page, /startAuthSubscription\(\)/);
});

test("생성 요청 시 Firebase나 Google 로그인이 없으면 상태와 포커스로 이유를 알린다", () => {
  assert.match(page, /if \(!store\) \{/);
  assert.match(page, /Firebase 연결을 확인한 뒤 다시 시도해 주세요/);
  assert.match(page, /if \(!googleConnected\(\)\) \{/);
  assert.match(page, /먼저 Google로 로그인해 주세요/);
  assert.match(page, /elements\.googleSignIn\.focus\(\)/);
});
