"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const POLL_ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(POLL_ROOT, "room-page.js"), "utf8");

function functionSource(name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^]*?(?=\\nfunction ${nextName}\\()`);
  return page.match(pattern)?.[0] || "";
}

test("참여방은 비밀 주소를 검증하고 실제 방을 확인한 뒤 내 투표를 구독한다", () => {
  assert.match(page, /core\.validateRoomId\(parameter\)/);
  assert.match(page, /createPollRoomStore\(firebaseConfig, \{ ensureAnonymous: true \}\)/);
  assert.match(page, /await store\.ensureParticipantSession\(\)/);
  assert.match(page, /store\.subscribeRoom\(/);
  assert.match(page, /store\.subscribeOwnVote\(/);
  const initialize = page.match(/async function initialize\(\)[\s\S]*?\n}\n\nelements\.voteChoices/)?.[0] || "";
  const applyRoom = functionSource("applyRoomSnapshot", "applyOwnVoteSnapshot");
  const ensureVote = functionSource("ensureOwnVoteSubscription", "showMissingRoom");
  assert.doesNotMatch(initialize, /store\.subscribeOwnVote\(/);
  assert.match(applyRoom, /ensureOwnVoteSubscription\(\)/);
  assert.match(ensureVote, /if \(!store \|\| !room \|\| !roomId \|\| roomFromCache/);
  assert.doesNotMatch(page, /subscribeVotes|listVotes|displayName|\.email/);
});

test("존재하지 않거나 사라진 방은 내 투표 구독을 정리하고 명확한 안내를 유지한다", () => {
  const missing = functionSource("showMissingRoom", "applyRoomSnapshot");
  const subscriptionError = functionSource("showSubscriptionError", "showStartupError");

  assert.match(missing, /unsubscribeVote\?\.\(\)/);
  assert.match(missing, /unsubscribeVote = null/);
  assert.match(missing, /stopResultsSubscription\(\{ clear: true \}\)/);
  assert.match(missing, /elements\.roomResultSummary\.hidden = true/);
  assert.match(subscriptionError, /if \(roomMissing\) return/);
});

test("결과는 Google 방장에게만 구독·표시하고 참여자에게는 합계 영역도 숨긴다", () => {
  const eligibility = functionSource("resultsEligible", "shortTime");
  const owner = functionSource("isOwner", "ownChoice");
  const subscription = functionSource("syncResultsSubscription", "ensureOwnVoteSubscription");

  assert.match(owner, /store\?\.isGoogleAccount\?\.\(\)/);
  assert.match(owner, /room\.ownerUid === currentUid\(\)/);
  assert.match(eligibility, /room && !ownerAuthBusy && !subscriptionFailed && isOwner\(\)/);
  assert.doesNotMatch(eligibility, /ownVote|room\.locked/);
  assert.match(subscription, /if \(!store \|\| !roomId \|\| !resultsEligible\(\)\)/);
  assert.match(subscription, /store\.subscribeResults\(/);
  assert.match(page, /elements\.resultsPanel\.hidden = !eligible/);
  assert.match(page, /elements\.roomResultSummary\.hidden = !eligible/);
  assert.match(page, /elements\.roomTotal\.textContent = "—"/);
  assert.match(page, /elements\.roomTotalLabel\.textContent = "방장 결과"/);
});

test("인증 계정을 바꾸기 전 투표·결과 구독과 화면 데이터를 모두 제거한다", () => {
  const resetIdentity = functionSource("resetIdentitySubscriptions", "subscribeForCurrentIdentity");

  assert.match(resetIdentity, /unsubscribeRoom\?\.\(\)/);
  assert.match(resetIdentity, /unsubscribeVote\?\.\(\)/);
  assert.match(resetIdentity, /stopResultsSubscription\(\{ clear: true \}\)/);
  assert.match(resetIdentity, /ownVote = null/);
  assert.match(resetIdentity, /voteResolved = false/);
  assert.match(page, /unsubscribeResults\?\.\(\)/);
  assert.match(page, /results = null/);
  assert.match(page, /resultsResolved = false/);
  assert.match(page, /item\.querySelector\("\[data-field='bar'\]"\)\.style\.width = "0%"/);
});

test("공유 URL로 바로 온 방장도 Google 계정을 확인하고 현재 UID로 다시 연결한다", () => {
  assert.match(page, /elements\.ownerSignIn\.addEventListener\("click"/);
  assert.match(page, /await store\.signInCreatorWithGoogle\(\)/);
  assert.match(page, /await store\.signOutCreator\(\{ ensureAnonymous: true \}\)/);
  assert.match(page, /store\.hasPendingGoogleAccount/);
  assert.match(page, /await store\.switchToPendingGoogleAccount\(\)/);
  assert.match(page, /resetIdentitySubscriptions\(\)/);
  assert.match(page, /subscribeForCurrentIdentity\(\)/);
  assert.match(page, /if \(!store\.user\) await store\.ensureParticipantSession\(\)/);
  assert.match(page, /showSubscriptionError\(recoveryError, "auth"\)/);
  assert.match(page, /isOwner\(\) && !elements\.resultsPanel\.hidden/);
  assert.match(page, /elements\.resultsTitle\.focus\(\)/);
});

test("다른 탭의 로그인 변경도 즉시 감지해 결과 DOM을 지우고 새 UID로 다시 연결한다", () => {
  const authState = functionSource("handleAuthState", "showMissingRoom");

  assert.match(page, /store\.subscribeAuthState\(/);
  assert.match(authState, /identityKey\(user\)/);
  assert.match(authState, /resetIdentitySubscriptions\(\)/);
  assert.match(authState, /renderAll\(\)/);
  assert.match(authState, /await store\.ensureParticipantSession\(\)/);
  assert.match(authState, /subscribeForCurrentIdentity\(\)/);
  assert.match(page, /unsubscribeAuth\?\.\(\)/);
});

test("native radio 선택은 마감 전 저장·변경할 수 있고 저장하지 않은 변경은 이탈 경고한다", () => {
  assert.match(page, /core\.normalizeChoice\(input\.value\)/);
  assert.match(page, /await store\.castVote\(roomId, choice\)/);
  assert.match(page, /savedChoice\s*\?\s*'선택 바꾸기/);
  assert.match(page, /room\.locked/);
  assert.match(page, /window\.addEventListener\("beforeunload"/);
  assert.match(page, /if \(!editorDirty\(\) \|\| room\?\.locked\) return/);
});

test("방장만 마감·재개를 제어하고 링크 공유 외 개별 선택 기능은 없다", () => {
  assert.match(page, /room\.ownerUid === currentUid\(\)/);
  assert.match(page, /await store\.setLocked\(roomId, nextLocked\)/);
  assert.match(page, /room = \{ \.\.\.room, locked: nextLocked \}/);
  assert.match(page, /copyText\(core\.roomUrl\(roomId, window\.location\.href\)\.toString\(\)\)/);
  assert.doesNotMatch(page, /voterUid|nickname|사용자 목록|투표자 목록/);
  assert.doesNotMatch(page, /마감 후에는 .*최종 합계|한 표를 저장하면 마감 전/);
});

test("결과는 세 선택지의 합계·비율만 실시간 렌더링한다", () => {
  assert.match(page, /core\.resultRows\(results\.counts\)/);
  assert.match(page, /core\.totalVotes\(results\.counts\)/);
  assert.match(page, /row\.ratio \* 100/);
  assert.match(page, /data-field='count'/);
  assert.match(page, /data-field='percent'/);
  assert.doesNotMatch(page, /results\.votes|results\.voters/);
});

test("결과 연결 오류를 방장 상태와 실시간 상태 영역에 함께 알린다", () => {
  const renderResults = functionSource("renderResults", "renderOwnerAccess");
  const renderOwner = functionSource("renderOwner", "renderAll");

  assert.match(renderResults, /firebaseErrorMessage\(resultsError/);
  assert.match(renderResults, /합계 연결 오류/);
  assert.match(renderOwner, /else if \(resultsError\)/);
  assert.match(renderOwner, /방장 계정은 확인됐지만 합계를 불러오지 못했어요/);
});

test("방 정보의 실제 확인·캐시·저장 상태를 aria-busy에 반영한다", () => {
  const renderRoom = functionSource("renderRoom", "renderVote");

  assert.match(renderRoom, /!roomResolved \|\| roomFromCache \|\| roomPendingWrites/);
  assert.match(renderRoom, /setAttribute\("aria-busy", String\(roomBusy\)\)/);
});
