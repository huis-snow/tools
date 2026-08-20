"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../core.js");

const timestamp = { seconds: 1, nanoseconds: 0 };

function room(overrides = {}) {
  return {
    version: 1,
    agenda: "이번 주 토요일에 출발할까요?",
    description: "오후 8시 출발 기준입니다.",
    ownerUid: "owner-uid",
    locked: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

test("익명 투표는 동의·거부·상관없음 세 선택지만 사용한다", () => {
  assert.deepEqual(core.CHOICES, ["agree", "reject", "neutral"]);
  assert.deepEqual(core.CHOICES.map((choice) => core.CHOICE_META[choice].label), ["동의", "거부", "상관없음"]);
  core.CHOICES.forEach((choice) => assert.deepEqual(core.normalizeVoteDraft(choice), { choice }));
  assert.throws(() => core.normalizeVoteDraft("abstain"), /동의, 거부, 상관없음/);
});

test("안건과 선택 설명은 공백을 정리하고 길이를 제한한다", () => {
  assert.deepEqual(core.normalizeRoomDraft({ agenda: "  안건입니다  ", description: "  설명입니다  " }), {
    version: 1,
    agenda: "안건입니다",
    description: "설명입니다",
  });
  assert.throws(() => core.normalizeRoomDraft({ agenda: "", description: "" }), /안건/);
  assert.throws(() => core.normalizeRoomDraft({ agenda: "가".repeat(161), description: "" }), /160자/);
  assert.throws(() => core.normalizeRoomDraft({ agenda: "안건", description: "가".repeat(501) }), /500자/);
});

test("공개 방 정보와 방장 전용 익명 투표함은 서로 분리한다", () => {
  const normalized = core.normalizeRoomSnapshot(room(), "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(normalized.agenda, "이번 주 토요일에 출발할까요?");
  assert.equal(Object.hasOwn(normalized, "counts"), false);
  const result = core.normalizeResultSnapshot({
    votes: {
      AAAAAAAAAAAAAAAAAAAAAA: "agree",
      BBBBBBBBBBBBBBBBBBBBBB: "agree",
      CCCCCCCCCCCCCCCCCCCCCC: "reject",
      DDDDDDDDDDDDDDDDDDDDDD: "neutral",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  assert.deepEqual(result.counts, { agree: 2, reject: 1, neutral: 1 });
  assert.equal(result.total, 4);
  assert.equal(Object.hasOwn(result, "votes"), false);
  assert.throws(() => core.normalizeResultSnapshot({
    votes: { short: "agree" }, createdAt: timestamp, updatedAt: timestamp,
  }), /투표 키/);
  assert.throws(() => core.normalizeResultSnapshot({
    votes: { AAAAAAAAAAAAAAAAAAAAAA: "abstain" }, createdAt: timestamp, updatedAt: timestamp,
  }), /동의, 거부, 상관없음/);
  const tooManyVotes = Object.fromEntries(Array.from(
    { length: 101 },
    (_, index) => [String(index).padStart(22, "A"), "agree"],
  ));
  assert.throws(() => core.normalizeResultSnapshot({
    votes: tooManyVotes, createdAt: timestamp, updatedAt: timestamp,
  }), /최대 참여/);
});

test("결과 행은 참여 인원과 소수점 한 자리 비율을 계산한다", () => {
  assert.deepEqual(core.resultRows({ agree: 2, reject: 1, neutral: 1 }).map(({ choice, count, percent }) => ({ choice, count, percent })), [
    { choice: "agree", count: 2, percent: 50 },
    { choice: "reject", count: 1, percent: 25 },
    { choice: "neutral", count: 1, percent: 25 },
  ]);
  assert.ok(core.resultRows(core.emptyCounts()).every(({ percent }) => percent === 0));
});

test("개별 투표는 무작위 투표 키와 시각을 가진 고정 스키마만 받는다", () => {
  const vote = core.normalizeVoteSnapshot({
    choice: "reject", ballotKey: "AAAAAAAAAAAAAAAAAAAAAA", createdAt: timestamp, updatedAt: timestamp,
  });
  assert.equal(vote.choice, "reject");
  assert.equal(vote.ballotKey, "AAAAAAAAAAAAAAAAAAAAAA");
  assert.throws(() => core.normalizeVoteSnapshot({ ...vote, ballotKey: "short" }), /투표 키/);
  assert.throws(() => core.normalizeVoteSnapshot({ ...vote, extra: true }), /알 수 없는 항목/);
});

test("방 주소와 익명 투표 키는 각각 16바이트 base64url 22자만 허용한다", () => {
  const id = core.createRoomId({ getRandomValues(bytes) { bytes.fill(255); return bytes; } });
  assert.equal(id, "_____________________w");
  assert.equal(core.validateRoomId(id), id);
  const ballotKey = core.createBallotKey({ getRandomValues(bytes) { bytes.fill(0); return bytes; } });
  assert.equal(ballotKey, "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(core.validateBallotKey(ballotKey), ballotKey);
  const url = core.roomUrl(id, "https://huis-snow.github.io/tools/poll-maker/?old=1#draft");
  assert.equal(url.searchParams.get("r"), id);
  assert.equal(url.searchParams.size, 1);
  assert.equal(url.hash, "");
  assert.throws(() => core.validateRoomId("short"), /주소/);
  assert.throws(() => core.validateBallotKey("short"), /투표 키/);
});

test("Firebase 공개 웹 설정 네 항목만 연결 여부에 사용한다", () => {
  assert.equal(core.firebaseConfigReady({ apiKey: "a", authDomain: "b", projectId: "c", appId: "d" }), true);
  assert.equal(core.firebaseConfigReady({ apiKey: "YOUR_API_KEY", authDomain: "b", projectId: "c", appId: "d" }), false);
});
