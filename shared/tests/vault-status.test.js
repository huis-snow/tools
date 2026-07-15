"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  formatRelativeTime,
  getStatusPresentation,
} = require("../vault-status.js");

function status(overrides = {}) {
  return {
    supported: true,
    mode: "indexeddb",
    connected: false,
    dirty: false,
    permission: "prompt",
    lastSyncAt: null,
    ...overrides,
  };
}

test("앱 저장 배지는 브라우저 작업본과 파일 동기화 상태를 구분한다", () => {
  assert.equal(getStatusPresentation(status()).label, "브라우저에 저장됨");
  assert.equal(getStatusPresentation(status(), { pending: true }).label, "브라우저 저장 중…");
  assert.equal(getStatusPresentation(status({ connected: true, permission: "granted", dirty: true })).label, "파일 동기화 대기");
  assert.equal(getStatusPresentation(status({ connected: true, permission: "granted" })).label, "파일까지 저장됨");
});

test("저장 오류와 제한된 fallback 상태는 성공 상태처럼 보이지 않는다", () => {
  assert.equal(getStatusPresentation(status({ error: { message: "disk fail" } })).state, "error");
  assert.equal(getStatusPresentation(status({ supported: false })).label, "임시 저장 중");
  assert.equal(getStatusPresentation(status({ mode: "localstorage" })).label, "간이 저장됨");
  assert.equal(getStatusPresentation(status({ connected: true, permission: "denied" })).label, "파일 권한 필요");
});

test("마지막 파일 저장 시각은 짧은 상대 시각으로 표시한다", () => {
  const now = Date.parse("2026-07-15T12:00:00.000Z");
  assert.equal(formatRelativeTime("2026-07-15T11:59:45.000Z", now), "방금");
  assert.equal(formatRelativeTime("2026-07-15T11:53:00.000Z", now), "7분 전");
  assert.equal(formatRelativeTime("2026-07-14T10:00:00.000Z", now), "1일 전");
});
