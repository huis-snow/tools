"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  FORMAT,
  FORMAT_VERSION,
  PORTABLE_PREFIX,
  MAX_DOCUMENT_BYTES,
  createVaultService,
  createVaultDocument,
  validateVaultDocument,
  parseVaultText,
  serializeVaultDocument,
  encodePortableText,
  decodePortableText,
  detectFileSystemAccessDisabledReason,
  buildFallbackRecoverySnapshot,
  runBrowserSmokeTest,
} = require("../vault-storage.js");

const UPDATED_AT = "2026-07-14T12:34:56.000Z";

class FakeLocalStorage {
  constructor() {
    this.values = new Map();
    this.failEntryWrites = false;
    this.failEntryContaining = "";
  }

  get length() { return this.values.size; }

  key(index) { return Array.from(this.values.keys())[index] ?? null; }

  getItem(key) {
    const normalized = String(key);
    return this.values.has(normalized) ? this.values.get(normalized) : null;
  }

  setItem(key, value) {
    const normalized = String(key);
    if ((this.failEntryWrites && normalized.includes("vault:entry:"))
      || (this.failEntryContaining && normalized.includes(this.failEntryContaining))) {
      throw new Error("가상 디스크 쓰기 실패");
    }
    this.values.set(normalized, String(value));
  }

  removeItem(key) { this.values.delete(String(key)); }

  clear() { this.values.clear(); }
}

class FakeFileHandle {
  constructor(content = "", name = "tools-vault.json") {
    this.content = content;
    this.name = name;
    this.permission = "granted";
    this.pauseWrite = false;
    this.writeStarted = null;
    this.releaseWrite = null;
  }

  async queryPermission() { return this.permission; }

  async requestPermission() { return this.permission; }

  async getFile() {
    const content = this.content;
    return {
      name: this.name,
      size: Buffer.byteLength(content),
      async text() { return content; },
    };
  }

  async createWritable() {
    const handle = this;
    let staged = "";
    return {
      async write(value) {
        staged = String(value);
        if (handle.pauseWrite) {
          handle.pauseWrite = false;
          await new Promise((resolve) => {
            handle.releaseWrite = resolve;
            handle.writeStarted?.();
          });
        }
      },
      async close() { handle.content = staged; },
      async abort() { staged = ""; },
    };
  }

  pauseNextWrite() {
    this.pauseWrite = true;
    return new Promise((resolve) => { this.writeStarted = resolve; });
  }
}

function createFallbackService(localStorage = new FakeLocalStorage(), extra = {}) {
  return createVaultService({
    indexedDB: null,
    localStorage,
    window: null,
    BroadcastChannel: null,
    autoStart: false,
    ...extra,
  });
}

async function documentWith(entries, overrides = {}) {
  return createVaultDocument({
    vaultId: overrides.vaultId || "vault-test-001",
    revision: overrides.revision ?? 3,
    updatedAt: overrides.updatedAt || UPDATED_AT,
    entries,
  });
}

test("보관함 JSON은 읽기 쉬운 포맷과 검증 가능한 SHA-256 체크섬을 가진다", async () => {
  const document = await documentWith({ "daily-log": "한글 기록", "habit-maker": "{}" });
  assert.equal(document.format, FORMAT);
  assert.equal(document.version, FORMAT_VERSION);
  assert.match(document.checksum, /^[a-f0-9]{64}$/);

  const text = serializeVaultDocument(document);
  assert.match(text, /\n  "entries": \{/);
  assert.deepEqual(
    { ...(await parseVaultText(text)).entries },
    { "daily-log": "한글 기록", "habit-maker": "{}" },
  );

  const tampered = JSON.parse(text);
  tampered.entries["daily-log"] = "몰래 바뀐 기록";
  await assert.rejects(validateVaultDocument(tampered), /체크섬/);
});

test("체크섬의 항목 정렬은 로케일·입력 순서와 무관하다", async () => {
  const first = await documentWith({ "한글": "1", "😀": "2", a: "3", Z: "4" });
  const second = await documentWith({ Z: "4", a: "3", "😀": "2", "한글": "1" });
  assert.equal(first.checksum, second.checksum);
  assert.deepEqual(Object.keys(first.entries), ["Z", "a", "한글", "😀"]);
});

test("__proto__ 같은 키도 prototype pollution 없이 데이터 키로만 다룬다", async () => {
  const entries = Object.create(null);
  entries.__proto__ = "안전한 문자열";
  entries.constructor = "생성자도 문자열";
  const document = await documentWith(entries);
  const parsed = await parseVaultText(serializeVaultDocument(document));
  assert.equal(parsed.entries.__proto__, "안전한 문자열");
  assert.equal(parsed.entries.constructor, "생성자도 문자열");
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(parsed.entries), null);
});

test("휴대용 텍스트는 TOOLS1. 접두사로 gzip/base64url 왕복한다", async () => {
  const document = await documentWith({ note: "같은 문장이 반복됩니다. ".repeat(500) });
  const portable = await encodePortableText(document);
  assert.ok(portable.startsWith(PORTABLE_PREFIX));
  assert.doesNotMatch(portable, /[+/=]/);
  assert.deepEqual(
    Array.from(Buffer.from(portable.slice(PORTABLE_PREFIX.length), "base64url").subarray(0, 2)),
    [0x1f, 0x8b],
  );
  const restored = await decodePortableText(`\n${portable}\n`);
  assert.equal(restored.checksum, document.checksum);
  assert.equal(restored.entries.note, document.entries.note);

  await assert.rejects(decodePortableText("OTHER.abc"), /TOOLS1/);
  await assert.rejects(decodePortableText("TOOLS1.%%%"), /올바르지/);
});

test("StorageLike는 즉시 메모리에 반영하고 fallback 저장소에 영속화한다", async () => {
  const localStorage = new FakeLocalStorage();
  const service = createFallbackService(localStorage);
  await service.ready;
  assert.deepEqual(service.getStatus(), {
    mode: "localstorage",
    supported: true,
    fileSystemAccessSupported: false,
    connected: false,
    fileName: "",
    lastSyncAt: null,
    revision: 0,
    dirty: false,
    permission: "unsupported",
    entryCount: 0,
    bytes: 0,
    vaultId: service.getStatus().vaultId,
  });

  service.storage.setItem("daily", "오늘의 기록");
  assert.equal(service.storage.getItem("daily"), "오늘의 기록");
  assert.equal(service.storage.length, 1);
  assert.equal(service.storage.key(0), "daily");
  await service.flush();

  const reloaded = createFallbackService(localStorage);
  await reloaded.ready;
  assert.equal(reloaded.storage.getItem("daily"), "오늘의 기록");
  assert.equal(reloaded.getStatus().vaultId, service.getStatus().vaultId);
  reloaded.storage.removeItem("daily");
  await reloaded.flush();
  assert.equal(reloaded.storage.getItem("daily"), null);
});

test("IndexedDB 초기화 실패 시 localStorage로 안전하게 fallback한다", async () => {
  const localStorage = new FakeLocalStorage();
  const service = createFallbackService(localStorage, {
    indexedDB: { open() { throw new Error("IDB blocked"); } },
  });
  await service.ready;
  assert.equal(service.getStatus().mode, "localstorage");
  assert.equal(service.getStatus().supported, true);
  service.storage.setItem("fallback", "ok");
  await service.flush();
  assert.equal(service.storage.getItem("fallback"), "ok");
});

test("IndexedDB open 후 첫 transaction이 실패해도 localStorage로 fallback한다", async () => {
  const localStorage = new FakeLocalStorage();
  const database = {
    objectStoreNames: { contains() { return true; } },
    transaction() { throw new Error("private mode transaction failure"); },
  };
  const indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
  };
  const service = createFallbackService(localStorage, { indexedDB });
  await service.ready;
  assert.equal(service.getStatus().mode, "localstorage");
  service.storage.setItem("transaction-fallback", "ok");
  await service.flush();
  assert.equal(service.storage.getItem("transaction-fallback"), "ok");
});

test("fallback 복구 snapshot은 삭제된 키를 IndexedDB에서 되살리지 않는다", () => {
  const indexedDbData = {
    entries: new Map([["deleted", "should-stay-deleted"], ["kept", "old"]]),
    meta: { vaultId: "vault-recovery", revision: 4, updatedAt: UPDATED_AT },
  };
  const fallbackData = {
    entries: new Map([["kept", "new"]]),
    meta: { vaultId: "vault-recovery", revision: 5, updatedAt: UPDATED_AT, pendingReconcile: true },
  };
  const recovered = buildFallbackRecoverySnapshot(indexedDbData, fallbackData, { now: () => new Date(UPDATED_AT) });
  assert.equal(recovered.entries.has("deleted"), false);
  assert.equal(recovered.entries.get("kept"), "new");
  assert.equal(recovered.meta.pendingReconcile, null);
});

test("fallback에서 clear한 빈 snapshot도 IndexedDB 전체를 비운다", () => {
  const recovered = buildFallbackRecoverySnapshot(
    { entries: new Map([["old", "남으면 안 됨"]]), meta: { vaultId: "v", revision: 1 } },
    { entries: new Map(), meta: { vaultId: "v", revision: 2, pendingReconcile: true } },
    { now: () => new Date(UPDATED_AT) },
  );
  assert.ok(recovered);
  assert.equal(recovered.entries.size, 0);
  assert.equal(recovered.meta.dirty, true);
});

test("파일 sync dirty=false인 fallback import도 pendingReconcile이면 전체 복구한다", () => {
  const recovered = buildFallbackRecoverySnapshot(
    { entries: new Map([["old", "IDB 값"]]), meta: { vaultId: "old-vault", revision: 8 } },
    {
      entries: new Map([["imported", "가져온 snapshot"]]),
      meta: { vaultId: "import-vault", revision: 3, dirty: false, pendingReconcile: true },
    },
    { now: () => new Date(UPDATED_AT) },
  );
  assert.equal(recovered.entries.get("old"), undefined);
  assert.equal(recovered.entries.get("imported"), "가져온 snapshot");
  assert.equal(recovered.meta.vaultId, "import-vault");
});

test("StorageLike 한도 초과는 기존 값과 revision을 변경하지 않는다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("safe", "기존 값");
  await service.flush();
  const before = service.getStatus();
  assert.throws(
    () => service.storage.setItem("safe", "x".repeat(MAX_DOCUMENT_BYTES + 1)),
    (error) => error.name === "QuotaExceededError",
  );
  assert.equal(service.storage.getItem("safe"), "기존 값");
  assert.equal(service.getStatus().revision, before.revision);
  assert.equal(service.getStatus().bytes, before.bytes);

  assert.throws(
    () => service.storage.setItem("escaped", "\\".repeat(8 * 1024 * 1024)),
    (error) => error.name === "QuotaExceededError" && /파일로 저장/.test(error.message),
  );
  assert.equal(service.storage.getItem("escaped"), null);
});

test("실패한 비동기 쓰기는 한 번 보고되고 다음 변경에서 전체 작업본을 복구한다", async () => {
  const localStorage = new FakeLocalStorage();
  const service = createFallbackService(localStorage);
  await service.ready;
  localStorage.failEntryWrites = true;
  service.storage.setItem("first", "메모리에 남음");
  await assert.rejects(service.flush(), /가상 디스크/);
  localStorage.failEntryWrites = false;
  await service.flush();
  assert.equal(service.getStatus().error, undefined);
  const recovered = createFallbackService(localStorage);
  await recovered.ready;
  assert.equal(recovered.storage.getItem("first"), "메모리에 남음");

  service.storage.setItem("second", "다음 쓰기");
  await service.flush();
  const reloaded = createFallbackService(localStorage);
  await reloaded.ready;
  assert.equal(reloaded.storage.getItem("first"), "메모리에 남음");
  assert.equal(reloaded.storage.getItem("second"), "다음 쓰기");
});

test("검증된 문서도 backend commit이 실패하면 메모리와 연결 상태를 교체하지 않는다", async () => {
  const localStorage = new FakeLocalStorage();
  const service = createFallbackService(localStorage);
  await service.ready;
  service.storage.setItem("old", "원래 작업본");
  await service.flush();
  const before = service.getStatus();
  const replacement = await documentWith({ fresh: "새 작업본" }, { revision: 14 });
  localStorage.failEntryWrites = true;
  await assert.rejects(
    service.openVaultFile({ text: serializeVaultDocument(replacement), fileName: "fresh.json" }),
    /가상 디스크/,
  );
  assert.equal(service.storage.getItem("old"), "원래 작업본");
  assert.equal(service.storage.getItem("fresh"), null);
  assert.equal(service.getStatus().vaultId, before.vaultId);
  assert.equal(service.getStatus().connected, false);
  assert.equal(service.getStatus().fileName, "");
  localStorage.failEntryWrites = false;
  await service.flush();
});

test("localStorage fallback의 replace 실패는 이전 durable snapshot을 즉시 복구한다", async () => {
  const localStorage = new FakeLocalStorage();
  const service = createFallbackService(localStorage);
  await service.ready;
  service.storage.setItem("old", "원래 durable 값");
  await service.flush();
  const replacement = await documentWith({ fresh: "쓰다 실패할 값" }, { revision: 15 });
  localStorage.failEntryContaining = "fresh";
  await assert.rejects(
    service.openVaultFile({ text: serializeVaultDocument(replacement), fileName: "fresh.json" }),
    /가상 디스크/,
  );
  localStorage.failEntryContaining = "";
  const immediateReload = createFallbackService(localStorage);
  await immediateReload.ready;
  assert.equal(immediateReload.storage.getItem("old"), "원래 durable 값");
  assert.equal(immediateReload.storage.getItem("fresh"), null);
});

test("기존 localStorage 키는 중복 덮어쓰기 없이 이전하고 원본을 선택적으로 지운다", async () => {
  const localStorage = new FakeLocalStorage();
  localStorage.setItem("small-tools:daily", "기존 하루 기록");
  const service = createFallbackService(localStorage);
  await service.ready;
  const result = await service.migrateKeys(["small-tools:daily", "missing"], { removeSource: true });
  assert.deepEqual(result, { migrated: ["small-tools:daily"], skipped: ["missing"] });
  assert.equal(service.storage.getItem("small-tools:daily"), "기존 하루 기록");
  assert.equal(localStorage.getItem("small-tools:daily"), null);

  localStorage.setItem("small-tools:daily", "더 오래된 원본");
  const repeated = await service.migrateKeys(["small-tools:daily"], { removeSource: true });
  assert.deepEqual(repeated, { migrated: [], skipped: ["small-tools:daily"] });
  assert.equal(service.storage.getItem("small-tools:daily"), "기존 하루 기록");
  assert.equal(localStorage.getItem("small-tools:daily"), "더 오래된 원본");
});

test("명시적으로 연 파일만 작업본을 교체하며 잘못된 체크섬은 기존 데이터를 보존한다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("old", "유지되어야 함");
  await service.flush();
  const valid = await documentWith({ fresh: "불러온 값" }, { revision: 11 });
  const broken = { ...valid, entries: { fresh: "변조" } };
  await assert.rejects(
    service.openVaultFile({ text: serializeVaultDocument(broken), fileName: "broken.json" }),
    /체크섬/,
  );
  assert.equal(service.storage.getItem("old"), "유지되어야 함");

  const status = await service.openVaultFile({ text: serializeVaultDocument(valid), fileName: "backup.json" });
  assert.equal(service.storage.getItem("old"), null);
  assert.equal(service.storage.getItem("fresh"), "불러온 값");
  assert.equal(status.connected, false);
  assert.equal(status.fileName, "backup.json");
  assert.equal(status.revision, 11);
});

test("연결 파일이 외부에서 바뀌면 기본 저장은 덮어쓰지 않고 충돌을 알린다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("raid", "초기 편성");
  await service.flush();
  const handle = new FakeFileHandle();
  await service.createVaultFile({ handle });
  assert.equal(service.getStatus().connected, true);
  assert.equal(service.getStatus().dirty, false);
  const savedByUs = handle.content;

  service.storage.setItem("raid", "새 편성");
  const external = await documentWith({ raid: "외부 변경" }, { vaultId: service.getStatus().vaultId, revision: 99 });
  handle.content = serializeVaultDocument(external);
  await assert.rejects(
    service.saveNow(),
    (error) => error.name === "VaultConflictError" && error.code === "VAULT_FILE_CONFLICT",
  );
  assert.equal(handle.content, serializeVaultDocument(external));
  assert.notEqual(handle.content, savedByUs);
  assert.equal(service.getStatus().dirty, true);
});

test("파일 쓰기 도중 새 변경이 생기면 이전 snapshot만 저장하고 dirty를 유지한다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("note", "첫 값");
  await service.flush();
  const handle = new FakeFileHandle();
  await service.createVaultFile({ handle });

  service.storage.setItem("note", "두 번째 값");
  const writeStarted = handle.pauseNextWrite();
  const saving = service.saveNow();
  await writeStarted;
  service.storage.setItem("note", "세 번째 값");
  handle.releaseWrite();
  await saving;

  const diskAfterFirstSave = await parseVaultText(handle.content);
  assert.equal(diskAfterFirstSave.entries.note, "두 번째 값");
  assert.equal(service.storage.getItem("note"), "세 번째 값");
  assert.equal(service.getStatus().dirty, true);
  await service.saveNow();
  assert.equal((await parseVaultText(handle.content)).entries.note, "세 번째 값");
  assert.equal(service.getStatus().dirty, false);
});

test("진행 중 저장과 새 파일 열기는 직렬화되어 새 연결 baseline을 오염시키지 않는다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("note", "old 작업본");
  await service.flush();
  const oldHandle = new FakeFileHandle("", "old.json");
  await service.createVaultFile({ handle: oldHandle });
  service.storage.setItem("note", "old 저장 내용");
  const writeStarted = oldHandle.pauseNextWrite();
  const saving = service.saveNow();
  await writeStarted;

  const newDocument = await documentWith({ note: "new 파일 내용" }, { vaultId: "new-vault", revision: 20 });
  const newHandle = new FakeFileHandle(serializeVaultDocument(newDocument), "new.json");
  const opening = service.openVaultFile({ handle: newHandle });
  oldHandle.releaseWrite();
  await saving;
  await opening;
  assert.equal(service.getStatus().fileName, "new.json");
  assert.equal(service.storage.getItem("note"), "new 파일 내용");
  service.storage.setItem("note", "new 파일 수정");
  await service.saveNow();
  assert.equal((await parseVaultText(newHandle.content)).entries.note, "new 파일 수정");
});

test("Chrome 재연결 권한 요청은 비동기 경계보다 먼저 클릭 순간에 시작한다", async () => {
  const service = createFallbackService(undefined, {
    showOpenFilePicker() {},
    showSaveFilePicker() {},
    navigator: { userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" },
  });
  await service.ready;
  service.storage.setItem("note", "첫 작업본");
  await service.flush();
  const handle = new FakeFileHandle();
  await service.createVaultFile({ handle });
  handle.permission = "prompt";
  await service.openVaultFile({ handle });

  let userActivation = true;
  let permissionRequests = 0;
  handle.requestPermission = () => {
    permissionRequests += 1;
    if (!userActivation) {
      const error = new Error("사용자 활성화가 끝났습니다.");
      error.name = "SecurityError";
      throw error;
    }
    handle.permission = "granted";
    return Promise.resolve("granted");
  };

  const reconnecting = service.reconnectFile();
  assert.equal(permissionRequests, 1);
  userActivation = false;
  const status = await reconnecting;
  assert.equal(status.connected, true);
  assert.equal(status.permission, "granted");
});

test("이미 권한이 허용된 재연결은 requestPermission을 다시 호출하지 않는다", async () => {
  const service = createFallbackService(undefined, {
    showOpenFilePicker() {},
    showSaveFilePicker() {},
    navigator: { userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" },
  });
  await service.ready;
  const handle = new FakeFileHandle();
  service.storage.setItem("note", "권한 유지 작업본");
  await service.flush();
  await service.createVaultFile({ handle });
  let permissionRequests = 0;
  handle.requestPermission = () => {
    permissionRequests += 1;
    throw new Error("이미 허용된 핸들에는 호출하면 안 됨");
  };
  const status = await service.reconnectFile();
  assert.equal(status.permission, "granted");
  assert.equal(permissionRequests, 0);
});

test("재연결 SecurityError는 권한 거부로 위조하지 않고 다시 시도할 수 있게 남긴다", async () => {
  const service = createFallbackService(undefined, {
    showOpenFilePicker() {},
    showSaveFilePicker() {},
    navigator: { userAgent: "Mozilla/5.0 Chrome/150.0.0.0 Safari/537.36" },
  });
  await service.ready;
  const handle = new FakeFileHandle();
  service.storage.setItem("note", "재시도 작업본");
  await service.flush();
  await service.createVaultFile({ handle });
  handle.permission = "prompt";
  await service.openVaultFile({ handle });
  handle.requestPermission = () => {
    const error = new Error("사용자 활성화 필요");
    error.name = "SecurityError";
    throw error;
  };
  await assert.rejects(service.reconnectFile(), (error) => error.name === "SecurityError");
  assert.equal(service.getStatus().permission, "prompt");
  assert.equal(service.getStatus().connected, true);
});

test("Whale에서는 저장 핸들 재권한 요청을 막고 파일 입출력 fallback을 사용한다", async () => {
  const navigator = { userAgent: "Mozilla/5.0 Chrome/148.0.0.0 Whale/4.38.386.14 Safari/537.36" };
  assert.equal(detectFileSystemAccessDisabledReason({ navigator }), "whale-stored-handle-crash");
  let pickerCalls = 0;
  const service = createFallbackService(undefined, {
    navigator,
    showOpenFilePicker() { pickerCalls += 1; },
    showSaveFilePicker() { pickerCalls += 1; },
  });
  await service.ready;
  service.storage.setItem("note", "웨일 작업본");
  await service.flush();
  const fallbackStatus = await service.createVaultFile({ filename: "whale-safe-backup.json" });
  assert.equal(fallbackStatus.connected, false);
  assert.equal(fallbackStatus.fileName, "whale-safe-backup.json");
  assert.equal(pickerCalls, 0);

  // An injected handle models an old handle restored from IndexedDB. Even if
  // it is present, the Whale workaround must never ask it for permission.
  const handle = new FakeFileHandle();
  await service.createVaultFile({ handle });
  let permissionRequests = 0;
  handle.requestPermission = () => {
    permissionRequests += 1;
    return Promise.resolve("granted");
  };
  await assert.rejects(service.reconnectFile(), /안전을 위해/);
  assert.equal(permissionRequests, 0);
  assert.equal(pickerCalls, 0);
  assert.equal(service.getStatus().fileSystemAccessSupported, false);
  assert.equal(service.getStatus().fileSystemAccessDisabledReason, "whale-stored-handle-crash");
});

test("파일 열기는 실제 readwrite permission을 조회해 prompt 상태를 보존한다", async () => {
  const service = createFallbackService();
  await service.ready;
  const document = await documentWith({ note: "읽기 전용으로 연 파일" });
  const handle = new FakeFileHandle(serializeVaultDocument(document), "prompt.json");
  handle.permission = "prompt";
  const status = await service.openVaultFile({ handle });
  assert.equal(status.connected, true);
  assert.equal(status.permission, "prompt");
});

test("FSA 미지원 create는 다운로드 snapshot으로 fallback하고 직접 연결하지 않는다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("note", "백업할 내용");
  await service.flush();
  const status = await service.createVaultFile({ filename: "내-보관함.json" });
  assert.equal(status.connected, false);
  assert.equal(status.fileName, "내-보관함.json");
  assert.ok(status.lastSyncAt);
  const backup = await service.downloadBackup({ filename: "검증.json" });
  assert.equal((await parseVaultText(backup.text)).entries.note, "백업할 내용");
});

test("휴대용 텍스트 import도 검증 후에만 전체 작업본을 교체한다", async () => {
  const service = createFallbackService();
  await service.ready;
  service.storage.setItem("before", "이전 값");
  await service.flush();
  const portable = await encodePortableText(await documentWith({ after: "새 값" }, { revision: 8 }));
  await service.importPortableText(portable);
  assert.equal(service.storage.getItem("before"), null);
  assert.equal(service.storage.getItem("after"), "새 값");
  assert.equal(service.getStatus().revision, 8);
  assert.equal(service.getStatus().dirty, true);
  assert.equal(service.getStatus().connected, false);
});

test("subscribe는 즉시 canonical status를 넘기고 이후 상태 변경도 알린다", async () => {
  const service = createFallbackService();
  await service.ready;
  const received = [];
  const unsubscribe = service.subscribe((status, event) => received.push({ status, event }));
  assert.equal(received[0].event.type, "subscribe");
  service.storage.setItem("x", "1");
  assert.equal(received.at(-1).event.type, "mutation");
  assert.equal(received.at(-1).status.entryCount, 1);
  unsubscribe();
  service.storage.setItem("y", "2");
  assert.equal(received.at(-1).status.entryCount, 1);
});

test("브라우저 IndexedDB smoke hook을 공개하고 fallback 환경에서도 StorageLike 왕복한다", async () => {
  assert.equal(typeof runBrowserSmokeTest, "function");
  const service = createFallbackService();
  const status = await runBrowserSmokeTest(service);
  assert.equal(status.mode, "localstorage");
  assert.equal(service.storage.length, 0);
});
