(function (root, factory) {
  "use strict";

  const api = factory(root || {});
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SmallToolsVault = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const FORMAT = "huis-tools-vault";
  const FORMAT_VERSION = 1;
  const DB_NAME = "small-tools-vault";
  const DB_VERSION = 1;
  const ENTRY_STORE = "entries";
  const META_STORE = "meta";
  const FALLBACK_ENTRY_PREFIX = "small-tools:vault:entry:";
  const FALLBACK_META_KEY = "small-tools:vault:meta:v1";
  const BROADCAST_NAME = "small-tools-vault-v1";
  const PORTABLE_PREFIX = "TOOLS1.";
  const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
  const MAX_PORTABLE_CHARS = 24 * 1024 * 1024;
  const MAX_ENTRIES = 20_000;
  const MAX_KEY_LENGTH = 2_000;
  const MAX_VALUE_LENGTH = 8 * 1024 * 1024;
  const DEFAULT_SYNC_INTERVAL = 30_000;

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function getTextEncoder() {
    if (typeof TextEncoder !== "undefined") return new TextEncoder();
    // Node versions supported by this project always expose TextEncoder. This
    // branch keeps the error understandable in unusually old runtimes.
    throw new Error("UTF-8 인코더를 사용할 수 없습니다.");
  }

  function getTextDecoder() {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: true });
    throw new Error("UTF-8 디코더를 사용할 수 없습니다.");
  }

  function utf8Bytes(text) {
    return getTextEncoder().encode(String(text));
  }

  function utf8Length(text) {
    return utf8Bytes(text).byteLength;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(value, environment = root) {
    const bytes = value instanceof Uint8Array ? value : utf8Bytes(value);
    const cryptoObject = environment.crypto || root.crypto;
    if (cryptoObject?.subtle?.digest) {
      const digest = await cryptoObject.subtle.digest("SHA-256", bytes);
      return bytesToHex(new Uint8Array(digest));
    }
    if (typeof require === "function") {
      const crypto = require("node:crypto");
      return crypto.createHash("sha256").update(bytes).digest("hex");
    }
    throw new Error("SHA-256 해시를 계산할 수 없습니다.");
  }

  function randomId(environment = root) {
    const cryptoObject = environment.crypto || root.crypto;
    if (typeof cryptoObject?.randomUUID === "function") return cryptoObject.randomUUID();
    if (typeof cryptoObject?.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoObject.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = bytesToHex(bytes);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `vault-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function nowIso(environment = root) {
    const value = typeof environment.now === "function" ? environment.now() : new Date();
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }

  function normalizeEntries(value) {
    if (!isPlainObject(value)) throw new Error("보관함 항목이 올바르지 않습니다.");
    const pairs = Object.entries(value);
    if (pairs.length > MAX_ENTRIES) throw new Error("보관함 항목이 너무 많습니다.");
    const normalized = Object.create(null);
    let bytes = 0;
    pairs.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).forEach(([key, item]) => {
      if (!key || key.length > MAX_KEY_LENGTH) throw new Error("보관함 항목 이름이 올바르지 않습니다.");
      if (typeof item !== "string") throw new Error(`'${key}' 항목은 문자열이어야 합니다.`);
      if (item.length > MAX_VALUE_LENGTH) throw new Error(`'${key}' 항목이 너무 큽니다.`);
      bytes += utf8Length(key) + utf8Length(item);
      if (bytes > MAX_DOCUMENT_BYTES) throw new Error("보관함 데이터가 너무 큽니다.");
      normalized[key] = item;
    });
    return normalized;
  }

  function entriesFromMap(entries) {
    const object = Object.create(null);
    Array.from(entries.entries())
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .forEach(([key, value]) => { object[key] = value; });
    return object;
  }

  function createQuotaError(message) {
    if (typeof DOMException === "function") return new DOMException(message, "QuotaExceededError");
    const error = new Error(message);
    error.name = "QuotaExceededError";
    return error;
  }

  function canonicalPayload(payload) {
    const entries = normalizeEntries(payload.entries);
    return JSON.stringify({
      format: FORMAT,
      version: FORMAT_VERSION,
      vaultId: payload.vaultId,
      revision: payload.revision,
      updatedAt: payload.updatedAt,
      entries,
    });
  }

  function validateMetadata(document) {
    if (!isPlainObject(document)) throw new Error("보관함 파일 형식이 올바르지 않습니다.");
    if (document.format !== FORMAT) throw new Error("지원하는 보관함 파일이 아닙니다.");
    if (document.version !== FORMAT_VERSION) throw new Error("지원하지 않는 보관함 버전입니다.");
    if (typeof document.vaultId !== "string" || !document.vaultId || document.vaultId.length > 200) {
      throw new Error("보관함 식별자가 올바르지 않습니다.");
    }
    if (!Number.isSafeInteger(document.revision) || document.revision < 0) {
      throw new Error("보관함 수정 번호가 올바르지 않습니다.");
    }
    if (typeof document.updatedAt !== "string" || Number.isNaN(Date.parse(document.updatedAt))) {
      throw new Error("보관함 수정 시간이 올바르지 않습니다.");
    }
    if (typeof document.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(document.checksum)) {
      throw new Error("보관함 체크섬이 올바르지 않습니다.");
    }
  }

  async function createVaultDocument(value, environment = root) {
    const payload = {
      format: FORMAT,
      version: FORMAT_VERSION,
      vaultId: value.vaultId,
      revision: value.revision,
      updatedAt: value.updatedAt,
      entries: normalizeEntries(value.entries),
    };
    validateMetadata({ ...payload, checksum: "0".repeat(64) });
    const checksum = await sha256Hex(canonicalPayload(payload), environment);
    const document = { ...payload, checksum };
    if (utf8Length(`${JSON.stringify(document, null, 2)}\n`) > MAX_DOCUMENT_BYTES) {
      throw new Error("직렬화된 보관함 파일이 너무 큽니다.");
    }
    return document;
  }

  async function validateVaultDocument(value, environment = root) {
    validateMetadata(value);
    const entries = normalizeEntries(value.entries);
    const payload = {
      format: FORMAT,
      version: FORMAT_VERSION,
      vaultId: value.vaultId,
      revision: value.revision,
      updatedAt: new Date(value.updatedAt).toISOString(),
      entries,
    };
    // Require an ISO timestamp to round-trip exactly. This avoids multiple
    // equivalent serializations producing surprising checksums.
    if (payload.updatedAt !== value.updatedAt) throw new Error("보관함 수정 시간은 ISO 형식이어야 합니다.");
    const checksum = await sha256Hex(canonicalPayload(payload), environment);
    if (checksum.toLowerCase() !== value.checksum.toLowerCase()) {
      throw new Error("보관함 파일의 체크섬이 일치하지 않습니다.");
    }
    return { ...payload, checksum: checksum.toLowerCase() };
  }

  async function parseVaultText(text, environment = root) {
    if (typeof text !== "string" || !text.trim()) throw new Error("보관함 파일이 비어 있습니다.");
    if (utf8Length(text) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
    let value;
    try {
      value = JSON.parse(text);
    } catch (_error) {
      throw new Error("보관함 JSON을 읽을 수 없습니다.");
    }
    return validateVaultDocument(value, environment);
  }

  function serializeVaultDocument(document) {
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (utf8Length(text) > MAX_DOCUMENT_BYTES) throw new Error("직렬화된 보관함 파일이 너무 큽니다.");
    return text;
  }

  function bytesToBase64Url(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64url");
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error("휴대용 백업 텍스트가 올바르지 않습니다.");
    }
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64url"));
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    let binary;
    try {
      binary = atob(padded);
    } catch (_error) {
      throw new Error("휴대용 백업 텍스트를 해독할 수 없습니다.");
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function collectStream(stream, maximum = MAX_DOCUMENT_BYTES) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error("압축을 푼 보관함 데이터가 너무 큽니다.");
      }
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return result;
  }

  async function gzipBytes(bytes, environment = root) {
    const Compression = environment.CompressionStream || root.CompressionStream;
    const BlobConstructor = environment.Blob || root.Blob;
    if (typeof Compression === "function" && typeof BlobConstructor === "function") {
      return collectStream(new BlobConstructor([bytes]).stream().pipeThrough(new Compression("gzip")), MAX_DOCUMENT_BYTES);
    }
    if (typeof require === "function") {
      const zlib = require("node:zlib");
      return new Uint8Array(zlib.gzipSync(bytes));
    }
    return null;
  }

  async function gunzipBytes(bytes, environment = root) {
    const Decompression = environment.DecompressionStream || root.DecompressionStream;
    const BlobConstructor = environment.Blob || root.Blob;
    if (typeof Decompression === "function" && typeof BlobConstructor === "function") {
      try {
        return await collectStream(
          new BlobConstructor([bytes]).stream().pipeThrough(new Decompression("gzip")),
          MAX_DOCUMENT_BYTES,
        );
      } catch (_error) {
        throw new Error("압축된 보관함 텍스트를 풀 수 없습니다.");
      }
    }
    if (typeof require === "function") {
      try {
        const zlib = require("node:zlib");
        return new Uint8Array(zlib.gunzipSync(bytes, { maxOutputLength: MAX_DOCUMENT_BYTES }));
      } catch (_error) {
        throw new Error("압축된 보관함 텍스트를 풀 수 없습니다.");
      }
    }
    throw new Error("이 브라우저에서는 gzip 백업을 열 수 없습니다.");
  }

  async function encodePortableText(document, environment = root) {
    const source = utf8Bytes(serializeVaultDocument(document));
    const compressed = await gzipBytes(source, environment);
    const payload = compressed || source;
    return PORTABLE_PREFIX + bytesToBase64Url(payload);
  }

  async function decodePortableText(text, environment = root) {
    if (typeof text !== "string") throw new Error("휴대용 백업 텍스트가 없습니다.");
    const normalized = text.trim();
    if (!normalized.startsWith(PORTABLE_PREFIX)) throw new Error("TOOLS1 형식의 백업 텍스트가 아닙니다.");
    if (normalized.length > MAX_PORTABLE_CHARS) throw new Error("휴대용 백업 텍스트가 너무 큽니다.");
    let bytes = base64UrlToBytes(normalized.slice(PORTABLE_PREFIX.length));
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("휴대용 백업 데이터가 너무 큽니다.");
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzipBytes(bytes, environment);
    let decoded;
    try {
      decoded = getTextDecoder().decode(bytes);
    } catch (_error) {
      throw new Error("휴대용 백업 텍스트가 UTF-8 형식이 아닙니다.");
    }
    return parseVaultText(decoded, environment);
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 요청에 실패했습니다."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 저장에 실패했습니다."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 저장이 중단되었습니다."));
    });
  }

  async function createIndexedDbBackend(indexedDB) {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE);
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB를 열 수 없습니다."));
      request.onblocked = () => reject(new Error("다른 탭이 보관함 업데이트를 막고 있습니다."));
    });

    async function load() {
      const transaction = database.transaction([ENTRY_STORE, META_STORE], "readonly");
      const completed = transactionDone(transaction);
      const entryStore = transaction.objectStore(ENTRY_STORE);
      const metaStore = transaction.objectStore(META_STORE);
      const [keys, values, metaKeys, metaValues] = await Promise.all([
        requestResult(entryStore.getAllKeys()),
        requestResult(entryStore.getAll()),
        requestResult(metaStore.getAllKeys()),
        requestResult(metaStore.getAll()),
      ]);
      await completed;
      const entries = new Map();
      keys.forEach((key, index) => entries.set(String(key), String(values[index])));
      const meta = Object.create(null);
      metaKeys.forEach((key, index) => { meta[key] = metaValues[index]; });
      return { entries, meta };
    }

    function writeMeta(store, meta) {
      Object.entries(meta).forEach(([key, value]) => {
        if (value === undefined || value === null) store.delete(key);
        else store.put(value, key);
      });
    }

    async function applyMutation(operation, meta) {
      const transaction = database.transaction([ENTRY_STORE, META_STORE], "readwrite");
      const completed = transactionDone(transaction);
      const entries = transaction.objectStore(ENTRY_STORE);
      if (operation.type === "set") entries.put(operation.value, operation.key);
      else if (operation.type === "remove") entries.delete(operation.key);
      else if (operation.type === "clear") entries.clear();
      writeMeta(transaction.objectStore(META_STORE), meta);
      await completed;
    }

    async function replaceAll(values, meta) {
      const transaction = database.transaction([ENTRY_STORE, META_STORE], "readwrite");
      const completed = transactionDone(transaction);
      const entries = transaction.objectStore(ENTRY_STORE);
      entries.clear();
      values.forEach((value, key) => entries.put(value, key));
      writeMeta(transaction.objectStore(META_STORE), meta);
      await completed;
    }

    async function setMeta(meta) {
      const transaction = database.transaction(META_STORE, "readwrite");
      const completed = transactionDone(transaction);
      writeMeta(transaction.objectStore(META_STORE), meta);
      await completed;
    }

    async function ensureVaultId(proposed) {
      const transaction = database.transaction(META_STORE, "readwrite");
      const completed = transactionDone(transaction);
      const store = transaction.objectStore(META_STORE);
      const existing = await requestResult(store.get("vaultId"));
      const value = typeof existing === "string" && existing ? existing : proposed;
      if (!existing) store.put(value, "vaultId");
      await completed;
      return value;
    }

    return { mode: "indexeddb", supported: true, load, applyMutation, replaceAll, setMeta, ensureVaultId };
  }

  function storageWorks(storage) {
    if (!storage) return false;
    const key = `${FALLBACK_META_KEY}:probe:${Math.random()}`;
    try {
      storage.setItem(key, "1");
      storage.removeItem(key);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function createLocalStorageBackend(storage) {
    function entryStorageKey(key) {
      return FALLBACK_ENTRY_PREFIX + encodeURIComponent(key);
    }

    async function load() {
      const entries = new Map();
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
      keys.filter((key) => typeof key === "string" && key.startsWith(FALLBACK_ENTRY_PREFIX)).forEach((key) => {
        try {
          const decoded = decodeURIComponent(key.slice(FALLBACK_ENTRY_PREFIX.length));
          const value = storage.getItem(key);
          if (value !== null) entries.set(decoded, value);
        } catch (_error) {
          // Ignore malformed keys created by unrelated or older code.
        }
      });
      let meta = Object.create(null);
      try {
        const stored = JSON.parse(storage.getItem(FALLBACK_META_KEY) || "null");
        if (isPlainObject(stored)) meta = stored;
      } catch (_error) {
        // Corrupt metadata must not make otherwise readable entries unusable.
      }
      return { entries, meta };
    }

    function saveMeta(meta) {
      let existing = Object.create(null);
      try {
        const stored = JSON.parse(storage.getItem(FALLBACK_META_KEY) || "null");
        if (isPlainObject(stored)) existing = stored;
      } catch (_error) { /* overwrite corrupt metadata */ }
      const serializable = { ...existing, ...meta };
      delete serializable.fileHandle;
      storage.setItem(FALLBACK_META_KEY, JSON.stringify(serializable));
    }

    async function applyMutation(operation, meta) {
      if (operation.type === "set") storage.setItem(entryStorageKey(operation.key), operation.value);
      else if (operation.type === "remove") storage.removeItem(entryStorageKey(operation.key));
      else if (operation.type === "clear") {
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
        keys.filter((key) => key?.startsWith(FALLBACK_ENTRY_PREFIX)).forEach((key) => storage.removeItem(key));
      }
      saveMeta({ ...meta, pendingReconcile: true });
    }

    async function replaceAll(values, meta) {
      const previous = await load();
      function clearManagedEntries() {
        const keys = [];
        for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
        keys.filter((key) => key?.startsWith(FALLBACK_ENTRY_PREFIX)).forEach((key) => storage.removeItem(key));
      }
      try {
        clearManagedEntries();
        values.forEach((value, key) => storage.setItem(entryStorageKey(key), value));
        saveMeta({ ...meta, pendingReconcile: true });
      } catch (error) {
        try {
          clearManagedEntries();
          previous.entries.forEach((value, key) => storage.setItem(entryStorageKey(key), value));
          saveMeta(previous.meta);
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      }
    }

    async function setMeta(meta) {
      saveMeta(meta);
    }

    async function ensureVaultId(proposed) {
      let meta = Object.create(null);
      try {
        const stored = JSON.parse(storage.getItem(FALLBACK_META_KEY) || "null");
        if (isPlainObject(stored)) meta = stored;
      } catch (_error) { /* replace corrupt metadata below */ }
      if (typeof meta.vaultId === "string" && meta.vaultId) return meta.vaultId;
      meta.vaultId = proposed;
      storage.setItem(FALLBACK_META_KEY, JSON.stringify(meta));
      return proposed;
    }

    async function clearPersistence() {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) keys.push(storage.key(index));
      keys.filter((key) => key?.startsWith(FALLBACK_ENTRY_PREFIX)).forEach((key) => storage.removeItem(key));
      storage.removeItem(FALLBACK_META_KEY);
    }

    return {
      mode: "localstorage", supported: true, load, applyMutation, replaceAll, setMeta, ensureVaultId, clearPersistence,
    };
  }

  function createMemoryBackend() {
    const entries = new Map();
    let meta = Object.create(null);
    return {
      mode: "localstorage",
      supported: false,
      async load() { return { entries: new Map(entries), meta: { ...meta } }; },
      async applyMutation(operation, nextMeta) {
        if (operation.type === "set") entries.set(operation.key, operation.value);
        else if (operation.type === "remove") entries.delete(operation.key);
        else if (operation.type === "clear") entries.clear();
        meta = { ...nextMeta };
      },
      async replaceAll(values, nextMeta) {
        entries.clear();
        values.forEach((value, key) => entries.set(key, value));
        meta = { ...nextMeta };
      },
      async setMeta(nextMeta) { meta = { ...nextMeta }; },
      async ensureVaultId(proposed) {
        if (typeof meta.vaultId === "string" && meta.vaultId) return meta.vaultId;
        meta.vaultId = proposed;
        return proposed;
      },
    };
  }

  function createConflictError() {
    const error = new Error("연결된 보관함 파일이 다른 곳에서 변경되어 저장하지 않았습니다.");
    error.name = "VaultConflictError";
    error.code = "VAULT_FILE_CONFLICT";
    return error;
  }

  function buildFallbackRecoverySnapshot(indexedDbData, fallbackData, environment = root) {
    if (fallbackData?.meta?.pendingReconcile !== true) return null;
    const entries = new Map(fallbackData.entries || []);
    const primaryMeta = indexedDbData?.meta || {};
    const fallbackMeta = fallbackData.meta || {};
    return {
      entries,
      meta: {
        ...primaryMeta,
        vaultId: fallbackMeta.vaultId || primaryMeta.vaultId || randomId(environment),
        revision: Math.max(Number(primaryMeta.revision) || 0, Number(fallbackMeta.revision) || 0) + 1,
        updatedAt: nowIso(environment),
        dirty: true,
        fileHandle: null,
        connectionId: null,
        recentFileName: "",
        lastFileHash: null,
        lastFileRevision: null,
        lastSyncAt: null,
        pendingReconcile: null,
      },
    };
  }

  function createVaultService(overrides = {}) {
    const environment = overrides || {};
    const valueFromEnvironment = (name) => Object.prototype.hasOwnProperty.call(environment, name)
      ? environment[name]
      : root[name];
    const memory = new Map();
    const listeners = new Set();
    const preReadyOperations = [];
    const sourceId = randomId(environment);
    let backend = createMemoryBackend();
    let initialized = false;
    let writeQueue = Promise.resolve();
    let fileSaveQueue = Promise.resolve();
    let broadcastChannel = null;
    let autoSyncTimer = null;
    let vaultId = randomId(environment);
    let revision = 0;
    let updatedAt = nowIso(environment);
    let dirty = false;
    let fileHandle = null;
    let connectionId = null;
    let recentFileName = "";
    let filePermission = "unsupported";
    let lastFileHash = null;
    let lastFileRevision = null;
    let lastSyncAt = null;
    let lastError = null;
    let pendingWriteError = null;
    let needsFullPersistence = false;

    const fileSystemAccessSupported = typeof valueFromEnvironment("showOpenFilePicker") === "function"
      && typeof valueFromEnvironment("showSaveFilePicker") === "function";

    function metadataSnapshot() {
      return {
        vaultId,
        revision,
        updatedAt,
        dirty,
        fileHandle,
        connectionId,
        recentFileName,
        lastFileHash,
        lastFileRevision,
        lastSyncAt,
      };
    }

    function mutationMetadataSnapshot() {
      return { revision, updatedAt, dirty: true };
    }

    function calculateBytes() {
      let total = 0;
      memory.forEach((value, key) => { total += utf8Length(key) + utf8Length(value); });
      return total;
    }

    function getStatus() {
      return {
        mode: backend.mode,
        supported: backend.supported,
        fileSystemAccessSupported,
        connected: Boolean(fileHandle),
        fileName: fileHandle?.name || recentFileName || "",
        lastSyncAt: lastSyncAt || null,
        revision,
        dirty,
        permission: fileHandle ? filePermission : (fileSystemAccessSupported ? "prompt" : "unsupported"),
        entryCount: memory.size,
        bytes: calculateBytes(),
        vaultId,
        ...(lastError ? {
          error: {
            name: lastError.name || "Error",
            message: lastError.message || String(lastError),
            ...(lastError.code ? { code: lastError.code } : {}),
          },
        } : {}),
      };
    }

    function notify(event = { type: "status" }) {
      const status = getStatus();
      listeners.forEach((listener) => {
        try { listener(status, event); } catch (_error) { /* A subscriber cannot break storage. */ }
      });
    }

    function subscribe(listener) {
      if (typeof listener !== "function") throw new TypeError("구독 함수가 필요합니다.");
      listeners.add(listener);
      listener(getStatus(), { type: "subscribe" });
      return () => listeners.delete(listener);
    }

    function applyToMemory(operation) {
      if (operation.type === "set") memory.set(operation.key, operation.value);
      else if (operation.type === "remove") memory.delete(operation.key);
      else if (operation.type === "clear") memory.clear();
    }

    function validateSetItem(key, value) {
      if (!key || key.length > MAX_KEY_LENGTH) throw createQuotaError("보관함 항목 이름이 너무 깁니다.");
      if (value.length > MAX_VALUE_LENGTH) throw createQuotaError("보관함 항목 값이 너무 큽니다.");
      if (!memory.has(key) && memory.size >= MAX_ENTRIES) throw createQuotaError("보관함 항목 개수 한도를 초과했습니다.");
      let total = 0;
      memory.forEach((item, itemKey) => {
        if (itemKey !== key) total += utf8Length(itemKey) + utf8Length(item);
      });
      total += utf8Length(key) + utf8Length(value);
      if (total > MAX_DOCUMENT_BYTES) throw createQuotaError("보관함 저장 한도(16MB)를 초과했습니다.");
      const prospective = new Map(memory);
      prospective.set(key, value);
      const worstCaseDocument = {
        format: FORMAT,
        version: FORMAT_VERSION,
        vaultId,
        revision: Number.MAX_SAFE_INTEGER,
        updatedAt,
        entries: entriesFromMap(prospective),
        checksum: "f".repeat(64),
      };
      if (utf8Length(`${JSON.stringify(worstCaseDocument, null, 2)}\n`) > MAX_DOCUMENT_BYTES) {
        throw createQuotaError("파일로 저장했을 때 보관함 저장 한도(16MB)를 초과합니다.");
      }
    }

    function queueBackendMutation(operation) {
      const snapshot = mutationMetadataSnapshot();
      // A failed write is reported by flush(), but must not permanently poison
      // the queue and prevent every later edit from being attempted.
      writeQueue = writeQueue.catch(() => {}).then(async () => {
        if (needsFullPersistence) {
          await backend.replaceAll(new Map(memory), mutationMetadataSnapshot());
          needsFullPersistence = false;
          return;
        }
        await backend.applyMutation(operation, snapshot);
      }).catch((error) => {
        lastError = error;
        pendingWriteError = error;
        needsFullPersistence = true;
        notify({ type: "error", error });
        throw error;
      });
      // Keep later operations usable after a failed write while still allowing
      // flush() to report that failure once.
      writeQueue.catch(() => {});
    }

    function postBroadcast(message) {
      try { broadcastChannel?.postMessage({ ...message, sourceId }); } catch (_error) { /* optional */ }
    }

    function mutate(operation, options = {}) {
      const oldValue = operation.type === "set" || operation.type === "remove"
        ? (memory.has(operation.key) ? memory.get(operation.key) : null)
        : null;
      if (operation.type === "set" && oldValue === operation.value) return false;
      if (operation.type === "remove" && oldValue === null) return false;
      if (operation.type === "clear" && memory.size === 0) return false;
      applyToMemory(operation);
      revision += 1;
      updatedAt = nowIso(environment);
      dirty = true;
      const event = { ...operation, oldValue, revision, updatedAt };
      if (!initialized) preReadyOperations.push(operation);
      else queueBackendMutation(operation);
      if (options.broadcast !== false) postBroadcast({ type: "mutation", event });
      notify({ type: "mutation", event });
      return true;
    }

    const storage = {
      get length() { return memory.size; },
      key(index) {
        const position = Number(index);
        if (!Number.isInteger(position) || position < 0) return null;
        return Array.from(memory.keys())[position] ?? null;
      },
      getItem(key) {
        const normalized = String(key);
        return memory.has(normalized) ? memory.get(normalized) : null;
      },
      setItem(key, value) {
        const normalizedKey = String(key);
        const normalizedValue = String(value);
        validateSetItem(normalizedKey, normalizedValue);
        mutate({ type: "set", key: normalizedKey, value: normalizedValue });
      },
      removeItem(key) {
        mutate({ type: "remove", key: String(key) });
      },
      clear() {
        mutate({ type: "clear" });
      },
    };

    function dispatchStorageEvent(event) {
      const windowObject = valueFromEnvironment("window");
      if (!windowObject?.dispatchEvent) return;
      const key = event.type === "clear" ? null : event.key;
      const oldValue = event.type === "clear" ? null : event.oldValue;
      const newValue = event.type === "set" ? event.value : null;
      let storageEvent;
      try {
        const StorageEventConstructor = windowObject.StorageEvent || valueFromEnvironment("StorageEvent");
        storageEvent = new StorageEventConstructor("storage", {
          key,
          oldValue,
          newValue,
          url: windowObject.location?.href || "",
        });
      } catch (_error) {
        const EventConstructor = windowObject.Event || valueFromEnvironment("Event");
        storageEvent = typeof EventConstructor === "function" ? new EventConstructor("storage") : { type: "storage" };
        Object.defineProperties(storageEvent, {
          key: { value: key }, oldValue: { value: oldValue }, newValue: { value: newValue },
        });
      }
      windowObject.dispatchEvent(storageEvent);
    }

    function installBroadcastChannel() {
      const Channel = valueFromEnvironment("BroadcastChannel");
      // Node also exposes BroadcastChannel, where an automatically-created
      // singleton channel would unnecessarily keep the process alive. Browser
      // pages (or tests explicitly injecting a channel) are the intended scope.
      if (typeof Channel !== "function"
        || (!valueFromEnvironment("window") && !Object.prototype.hasOwnProperty.call(environment, "BroadcastChannel"))) return;
      try {
        broadcastChannel = new Channel(BROADCAST_NAME);
        broadcastChannel.onmessage = async (messageEvent) => {
          const message = messageEvent.data;
          if (!message || message.sourceId === sourceId) return;
          if (message.type === "mutation" && isPlainObject(message.event)) {
            const event = message.event;
            const oldValue = event.type === "set" || event.type === "remove" ? storage.getItem(event.key) : null;
            applyToMemory(event);
            revision = Math.max(revision, Number(event.revision) || 0);
            updatedAt = typeof event.updatedAt === "string" ? event.updatedAt : updatedAt;
            dirty = true;
            dispatchStorageEvent({ ...event, oldValue });
            notify({ type: "remote-mutation", event });
          } else if (message.type === "replace" && isPlainObject(message.entries)) {
            memory.clear();
            Object.entries(message.entries).forEach(([key, value]) => memory.set(key, String(value)));
            vaultId = message.vaultId || vaultId;
            revision = Number.isSafeInteger(message.revision) ? message.revision : revision;
            updatedAt = message.updatedAt || updatedAt;
            dirty = Boolean(message.dirty);
            // File handles are not safely transferable as part of our message,
            // and the replacement may represent an entirely different vault.
            // Never let the receiving tab write new entries into its old file.
            fileHandle = null;
            connectionId = null;
            recentFileName = message.fileName || "";
            lastFileHash = null;
            lastFileRevision = null;
            lastSyncAt = null;
            filePermission = fileSystemAccessSupported ? "prompt" : "unsupported";
            dispatchStorageEvent({ type: "clear" });
            Object.entries(message.entries).forEach(([key, value]) => {
              dispatchStorageEvent({ type: "set", key, value, oldValue: null });
            });
            notify({ type: "remote-replace" });
          } else if (message.type === "connection-changed") {
            fileHandle = null;
            connectionId = null;
            recentFileName = message.fileName || "";
            lastFileHash = null;
            lastFileRevision = null;
            lastSyncAt = null;
            filePermission = fileSystemAccessSupported ? "prompt" : "unsupported";
            notify({ type: "remote-connection-changed" });
          } else if (message.type === "file-saved" && message.vaultId === vaultId
            && message.connectionId && message.connectionId === connectionId) {
            const snapshot = { vaultId, revision, updatedAt, entries: entriesFromMap(memory) };
            try {
              const current = await createVaultDocument(snapshot, environment);
              if (vaultId === snapshot.vaultId && revision === snapshot.revision
                && updatedAt === snapshot.updatedAt && current.checksum === message.checksum) {
                lastFileHash = message.hash || lastFileHash;
                lastFileRevision = message.revision;
                lastSyncAt = message.lastSyncAt || lastSyncAt;
                dirty = false;
                await backend.setMeta({
                  dirty: false,
                  lastFileHash,
                  lastFileRevision,
                  lastSyncAt,
                });
              }
            } catch (_error) { /* keep dirty when an exact snapshot cannot be proven */ }
            notify({ type: "remote-file-saved" });
          }
        };
      } catch (_error) {
        broadcastChannel = null;
      }
    }

    async function initialize() {
      const indexedDB = valueFromEnvironment("indexedDB");
      async function loadFallbackBackend() {
        const localStorage = valueFromEnvironment("localStorage");
        const candidate = storageWorks(localStorage) ? createLocalStorageBackend(localStorage) : createMemoryBackend();
        try {
          return { candidate, loaded: await candidate.load() };
        } catch (_error) {
          const memoryBackend = createMemoryBackend();
          return { candidate: memoryBackend, loaded: await memoryBackend.load() };
        }
      }

      let loaded;
      if (indexedDB?.open) {
        try {
          backend = await createIndexedDbBackend(indexedDB);
          loaded = await backend.load();
          const localStorage = valueFromEnvironment("localStorage");
          if (storageWorks(localStorage)) {
            const fallbackBackend = createLocalStorageBackend(localStorage);
            const fallbackData = await fallbackBackend.load();
            const recovered = buildFallbackRecoverySnapshot(loaded, fallbackData, environment);
            if (recovered) {
              // localStorage is a complete working snapshot, not an append-only
              // journal. Replacing it wholesale preserves deletions, clear(),
              // and imports whose file-sync dirty flag is intentionally false.
              await backend.replaceAll(recovered.entries, recovered.meta);
              loaded = recovered;
              await fallbackBackend.clearPersistence();
            }
          }
        } catch (_error) {
          const fallback = await loadFallbackBackend();
          backend = fallback.candidate;
          loaded = fallback.loaded;
        }
      } else {
        const fallback = await loadFallbackBackend();
        backend = fallback.candidate;
        loaded = fallback.loaded;
      }

      try {
        if (!(typeof loaded.meta?.vaultId === "string" && loaded.meta.vaultId)) {
          const ensuredId = await backend.ensureVaultId(vaultId);
          loaded.meta = { ...(loaded.meta || {}), vaultId: ensuredId };
        }
      } catch (_error) {
        const fallback = await loadFallbackBackend();
        backend = fallback.candidate;
        loaded = fallback.loaded;
        if (!(typeof loaded.meta?.vaultId === "string" && loaded.meta.vaultId)) {
          const ensuredId = await backend.ensureVaultId(vaultId);
          loaded.meta = { ...(loaded.meta || {}), vaultId: ensuredId };
        }
      }

      const pending = preReadyOperations.splice(0);
      memory.clear();
      loaded.entries.forEach((value, key) => memory.set(key, value));
      const meta = loaded.meta || {};
      const needsInitialMeta = !(typeof meta.vaultId === "string" && meta.vaultId);
      vaultId = typeof meta.vaultId === "string" && meta.vaultId ? meta.vaultId : vaultId;
      revision = Number.isSafeInteger(meta.revision) && meta.revision >= 0 ? meta.revision : 0;
      updatedAt = typeof meta.updatedAt === "string" && !Number.isNaN(Date.parse(meta.updatedAt)) ? meta.updatedAt : updatedAt;
      dirty = meta.dirty === true;
      fileHandle = backend.mode === "indexeddb" && meta.fileHandle ? meta.fileHandle : null;
      connectionId = fileHandle && typeof meta.connectionId === "string" ? meta.connectionId : null;
      recentFileName = typeof meta.recentFileName === "string" ? meta.recentFileName : "";
      lastFileHash = typeof meta.lastFileHash === "string" ? meta.lastFileHash : null;
      lastFileRevision = Number.isSafeInteger(meta.lastFileRevision) ? meta.lastFileRevision : null;
      lastSyncAt = typeof meta.lastSyncAt === "string" ? meta.lastSyncAt : null;

      pending.forEach((operation) => {
        applyToMemory(operation);
        revision += 1;
        updatedAt = nowIso(environment);
        dirty = true;
      });
      initialized = true;
      try {
        if (pending.length) {
          // Rebase only the operations that happened before ready. Replacing a
          // stale load snapshot here could delete another tab's newer keys.
          for (const operation of pending) await backend.applyMutation(operation, mutationMetadataSnapshot());
          const refreshed = await backend.load();
          memory.clear();
          refreshed.entries.forEach((value, key) => memory.set(key, value));
        } else if (needsInitialMeta) {
          await backend.setMeta(metadataSnapshot());
        }
      } catch (error) {
        if (backend.mode === "indexeddb") {
          const fallback = await loadFallbackBackend();
          backend = fallback.candidate;
        } else {
          backend = createMemoryBackend();
        }
        // An IDB load that succeeded is the newest known working copy. Keep it
        // when only a later transaction failed, instead of replacing it with an
        // older fallback snapshot. If fallback persistence also fails, the
        // in-memory backend still keeps the page usable for export.
        try {
          await backend.replaceAll(memory, metadataSnapshot());
        } catch (_fallbackError) {
          backend = createMemoryBackend();
          await backend.replaceAll(memory, metadataSnapshot());
        }
      }
      installBroadcastChannel();
      if (fileHandle) await refreshPermission(false);
      notify({ type: "ready" });

      const windowObject = valueFromEnvironment("window");
      if (windowObject?.addEventListener) {
        windowObject.addEventListener("pagehide", () => { flush().catch(() => {}); });
      }
      if (environment.autoStart !== false && windowObject) startAutoSync();
      return api;
    }

    async function flush() {
      await ready;
      const pending = writeQueue;
      try {
        await pending;
      } catch (error) {
        if (pendingWriteError === error) pendingWriteError = null;
        if (pending === writeQueue) writeQueue = Promise.resolve();
        throw error;
      }
      if (pending === writeQueue && pendingWriteError) {
        const error = pendingWriteError;
        pendingWriteError = null;
        throw error;
      }
      if (needsFullPersistence) {
        const snapshot = new Map(memory);
        const meta = mutationMetadataSnapshot();
        needsFullPersistence = false;
        const recovery = backend.replaceAll(snapshot, meta).catch((error) => {
          lastError = error;
          pendingWriteError = error;
          needsFullPersistence = true;
          notify({ type: "error", error });
          throw error;
        });
        writeQueue = recovery;
        writeQueue.catch(() => {});
        try {
          await recovery;
        } catch (error) {
          if (pendingWriteError === error) pendingWriteError = null;
          if (writeQueue === recovery) writeQueue = Promise.resolve();
          throw error;
        }
      }
      lastError = null;
      return getStatus();
    }

    async function persistMetadata() {
      await flush();
      await backend.setMeta(metadataSnapshot());
    }

    async function replaceWithDocument(document, options = {}) {
      const validated = await validateVaultDocument(document, environment);
      await flush();
      const nextEntries = new Map(Object.entries(validated.entries));
      const next = {
        vaultId: validated.vaultId,
        revision: validated.revision,
        updatedAt: validated.updatedAt,
        dirty: options.dirty === true,
        fileHandle,
        connectionId,
        recentFileName,
        lastFileHash,
        lastFileRevision,
        lastSyncAt,
        filePermission,
      };
      if (options.disconnect === true) {
        next.fileHandle = null;
        next.connectionId = null;
        next.recentFileName = "";
        next.lastFileHash = null;
        next.lastFileRevision = null;
        next.lastSyncAt = null;
        next.filePermission = fileSystemAccessSupported ? "prompt" : "unsupported";
      }
      ["fileHandle", "connectionId", "recentFileName", "lastFileHash", "lastFileRevision", "lastSyncAt", "filePermission"]
        .forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(options, key)) next[key] = options[key];
        });
      const nextMeta = {
        vaultId: next.vaultId,
        revision: next.revision,
        updatedAt: next.updatedAt,
        dirty: next.dirty,
        fileHandle: next.fileHandle,
        connectionId: next.connectionId,
        recentFileName: next.recentFileName,
        lastFileHash: next.lastFileHash,
        lastFileRevision: next.lastFileRevision,
        lastSyncAt: next.lastSyncAt,
      };
      // Publish only after the durable transaction succeeds. A failed import
      // therefore leaves both the visible working copy and connection metadata
      // untouched.
      try {
        await backend.replaceAll(nextEntries, nextMeta);
      } catch (error) {
        lastError = error;
        if (error.rollbackError) {
          const safeMemoryBackend = createMemoryBackend();
          await safeMemoryBackend.replaceAll(new Map(memory), metadataSnapshot());
          backend = safeMemoryBackend;
          needsFullPersistence = false;
        } else {
          needsFullPersistence = true;
        }
        notify({ type: "error", error });
        throw error;
      }
      memory.clear();
      nextEntries.forEach((value, key) => memory.set(key, value));
      vaultId = next.vaultId;
      revision = next.revision;
      updatedAt = next.updatedAt;
      dirty = next.dirty;
      fileHandle = next.fileHandle;
      connectionId = next.connectionId;
      recentFileName = next.recentFileName;
      lastFileHash = next.lastFileHash;
      lastFileRevision = next.lastFileRevision;
      lastSyncAt = next.lastSyncAt;
      filePermission = next.filePermission;
      postBroadcast({
        type: "replace",
        entries: entriesFromMap(memory),
        vaultId,
        revision,
        updatedAt,
        dirty,
        fileName: recentFileName,
      });
      dispatchStorageEvent({ type: "clear" });
      Object.entries(validated.entries).forEach(([key, value]) => {
        dispatchStorageEvent({ type: "set", key, value, oldValue: null });
      });
      notify({ type: "replace" });
      return validated;
    }

    async function migrateKeys(keys, options = {}) {
      await ready;
      if (!Array.isArray(keys)) throw new TypeError("이전할 저장소 키 목록이 필요합니다.");
      const localStorage = valueFromEnvironment("localStorage");
      const migrated = [];
      const skipped = [];
      if (!localStorage) return { migrated, skipped: keys.map(String) };
      for (const rawKey of keys) {
        const key = String(rawKey);
        let source;
        try { source = localStorage.getItem(key); } catch (_error) { source = null; }
        if (source === null || storage.getItem(key) !== null) {
          skipped.push(key);
          continue;
        }
        storage.setItem(key, source);
        migrated.push(key);
      }
      await flush();
      if (options.removeSource === true) {
        migrated.forEach((key) => {
          try { localStorage.removeItem(key); } catch (_error) { /* copied data remains safe */ }
        });
      }
      return { migrated, skipped };
    }

    async function refreshPermission(request) {
      const handle = fileHandle;
      if (!handle) {
        filePermission = fileSystemAccessSupported ? "prompt" : "unsupported";
        return filePermission;
      }
      if (typeof handle.queryPermission !== "function") {
        filePermission = "granted";
        return filePermission;
      }
      let permission;
      try {
        permission = await handle.queryPermission({ mode: "readwrite" });
        if (permission === "prompt" && request && typeof handle.requestPermission === "function") {
          permission = await handle.requestPermission({ mode: "readwrite" });
        }
      } catch (_error) {
        permission = "denied";
      }
      if (fileHandle === handle) filePermission = permission;
      notify({ type: "permission" });
      return permission;
    }

    async function readHandle(handle) {
      const file = await handle.getFile();
      if (Number(file.size) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
      const text = await file.text();
      if (utf8Length(text) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
      return { file, text, rawHash: await sha256Hex(text, environment) };
    }

    async function pickSaveHandle(options) {
      if (options?.handle) return options.handle;
      if (options?.createWritable) return options;
      const picker = valueFromEnvironment("showSaveFilePicker");
      if (typeof picker !== "function") throw new Error("이 브라우저에서는 파일 보관함 연결을 지원하지 않습니다.");
      return picker.call(valueFromEnvironment("window") || root, {
        suggestedName: "tools-vault.json",
        types: [{ description: "도구 보관함", accept: { "application/json": [".json"] } }],
      });
    }

    async function pickOpenHandle(options) {
      if (options?.handle) return options.handle;
      if (options?.getFile) return options;
      const picker = valueFromEnvironment("showOpenFilePicker");
      if (typeof picker !== "function") throw new Error("이 브라우저에서는 파일 보관함 연결을 지원하지 않습니다.");
      const handles = await picker.call(valueFromEnvironment("window") || root, {
        multiple: false,
        types: [{ description: "도구 보관함", accept: { "application/json": [".json"] } }],
      });
      if (!handles?.[0]) throw new Error("선택한 보관함 파일이 없습니다.");
      return handles[0];
    }

    async function pickFallbackFile(options = {}) {
      if (typeof options === "string") return { text: options, name: "tools-vault.json" };
      if (typeof options.text === "string") {
        return { text: options.text, name: options.fileName || options.name || "tools-vault.json" };
      }
      const suppliedFile = options.file || (typeof options.text === "function" ? options : null);
      if (suppliedFile) {
        if (Number(suppliedFile.size) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
        return { text: await suppliedFile.text(), name: suppliedFile.name || "tools-vault.json" };
      }
      const documentObject = valueFromEnvironment("document");
      if (!documentObject?.createElement) throw new Error("가져올 보관함 파일을 선택할 수 없습니다.");
      const file = await new Promise((resolve, reject) => {
        const input = documentObject.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";
        input.hidden = true;
        input.addEventListener("change", () => {
          input.remove();
          if (input.files?.[0]) resolve(input.files[0]);
          else reject(new Error("선택한 보관함 파일이 없습니다."));
        }, { once: true });
        input.addEventListener("cancel", () => {
          input.remove();
          reject(new Error("보관함 파일 선택을 취소했습니다."));
        }, { once: true });
        documentObject.body?.appendChild(input);
        input.click();
      });
      if (Number(file.size) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
      return { text: await file.text(), name: file.name || "tools-vault.json" };
    }

    async function createVaultFile(options = {}) {
      await ready;
      const hasInjectedHandle = Boolean(options?.handle || options?.createWritable);
      if (!hasInjectedHandle && typeof valueFromEnvironment("showSaveFilePicker") !== "function") {
        return enqueueFileOperation(async () => {
          const backup = await downloadBackup(options);
          recentFileName = backup.filename;
          await backend.setMeta(metadataSnapshot());
          notify({ type: "backup-downloaded" });
          return getStatus();
        });
      }
      const handle = await pickSaveHandle(options);
      return enqueueFileOperation(async () => {
        fileHandle = handle;
        connectionId = randomId(environment);
        recentFileName = handle.name || "tools-vault.json";
        filePermission = "granted";
        try {
          const current = await readHandle(handle);
          lastFileHash = current.rawHash;
          lastFileRevision = null;
        } catch (_error) {
          lastFileHash = await sha256Hex("", environment);
          lastFileRevision = null;
        }
        await persistMetadata();
        await performSaveNow({ force: true, requestPermission: true });
        postBroadcast({ type: "connection-changed", fileName: recentFileName });
        return getStatus();
      });
    }

    async function openVaultFile(options = {}) {
      await ready;
      const hasInjectedHandle = Boolean(options?.handle || options?.getFile);
      const hasInjectedFile = typeof options === "string" || typeof options?.text === "string"
        || Boolean(options?.file) || (typeof options?.text === "function" && !options?.getFile);
      if (hasInjectedFile || (!hasInjectedHandle && typeof valueFromEnvironment("showOpenFilePicker") !== "function")) {
        const imported = await pickFallbackFile(options);
        if (utf8Length(imported.text) > MAX_DOCUMENT_BYTES) throw new Error("보관함 파일이 너무 큽니다.");
        const document = await parseVaultText(imported.text, environment);
        return enqueueFileOperation(async () => {
          await replaceWithDocument(document, {
            dirty: false,
            disconnect: true,
            recentFileName: imported.name,
            lastSyncAt: nowIso(environment),
          });
          notify({ type: "file-imported" });
          return getStatus();
        });
      }
      const handle = await pickOpenHandle(options);
      const { text, rawHash } = await readHandle(handle);
      const document = await parseVaultText(text, environment);
      let writePermission = "granted";
      if (typeof handle.queryPermission === "function") {
        try { writePermission = await handle.queryPermission({ mode: "readwrite" }); }
        catch (_error) { writePermission = "denied"; }
      }
      return enqueueFileOperation(async () => {
        await replaceWithDocument(document, {
          dirty: false,
          fileHandle: handle,
          connectionId: randomId(environment),
          recentFileName: handle.name || "tools-vault.json",
          filePermission: writePermission,
          lastFileHash: rawHash,
          lastFileRevision: document.revision,
          lastSyncAt: nowIso(environment),
        });
        return getStatus();
      });
    }

    async function reconnectFile(options = {}) {
      await ready;
      return enqueueFileOperation(async () => {
        if (!fileHandle) throw new Error("다시 연결할 최근 보관함이 없습니다.");
        const permission = await refreshPermission(options.requestPermission !== false);
        if (permission !== "granted") throw new Error("보관함 파일 권한이 필요합니다.");
        const { text, rawHash } = await readHandle(fileHandle);
        const document = await parseVaultText(text, environment);
        if (dirty) {
          if (!lastFileHash || lastFileRevision === null
            || rawHash !== lastFileHash || document.revision !== lastFileRevision) {
            throw createConflictError();
          }
        } else {
          lastFileHash = rawHash;
          lastFileRevision = document.revision;
          lastSyncAt = nowIso(environment);
          await replaceWithDocument(document, { dirty: false });
        }
        await persistMetadata();
        return getStatus();
      });
    }

    async function currentDocument() {
      await ready;
      return createVaultDocument({
        vaultId,
        revision,
        updatedAt,
        entries: entriesFromMap(memory),
      }, environment);
    }

    async function performSaveNow(options = {}) {
      await flush();
      const targetHandle = fileHandle;
      const targetConnectionId = connectionId;
      if (!targetHandle) throw new Error("연결된 보관함 파일이 없습니다.");
      const permission = await refreshPermission(options.requestPermission !== false);
      if (permission !== "granted") throw new Error("보관함 파일 쓰기 권한이 필요합니다.");
      if (fileHandle !== targetHandle || connectionId !== targetConnectionId) {
        throw new Error("저장하는 동안 연결된 보관함이 변경되었습니다.");
      }

      const current = await readHandle(targetHandle);
      if (!options.force && (lastFileHash === null || current.rawHash !== lastFileHash)) throw createConflictError();
      if (!options.force && current.text.trim()) {
        let diskDocument;
        try { diskDocument = await parseVaultText(current.text, environment); } catch (_error) { throw createConflictError(); }
        if (lastFileRevision === null || diskDocument.revision !== lastFileRevision) throw createConflictError();
      }

      const document = await currentDocument();
      const text = serializeVaultDocument(document);
      const writable = await targetHandle.createWritable();
      try {
        await writable.write(text);
        await writable.close();
      } catch (error) {
        try { await writable.abort?.(); } catch (_error) { /* best effort */ }
        throw error;
      }
      const writtenHash = await sha256Hex(text, environment);
      if (fileHandle !== targetHandle || connectionId !== targetConnectionId) {
        // A remote tab may switch the active vault while this write is in
        // progress. The old target was written, but its baseline must never be
        // published as metadata for the new connection.
        return getStatus();
      }
      lastFileHash = writtenHash;
      lastFileRevision = document.revision;
      lastSyncAt = nowIso(environment);
      dirty = !(vaultId === document.vaultId
        && revision === document.revision
        && updatedAt === document.updatedAt);
      lastError = null;
      await backend.setMeta(metadataSnapshot());
      postBroadcast({
        type: "file-saved",
        vaultId: document.vaultId,
        connectionId: targetConnectionId,
        checksum: document.checksum,
        hash: lastFileHash,
        revision: document.revision,
        lastSyncAt,
      });
      notify({ type: "saved" });
      return getStatus();
    }

    function enqueueFileOperation(operation) {
      const task = fileSaveQueue.catch(() => {}).then(operation);
      fileSaveQueue = task;
      task.catch(() => {});
      return task;
    }

    function saveNow(options = {}) {
      return enqueueFileOperation(() => performSaveNow(options));
    }

    async function forgetFile() {
      await flush();
      return enqueueFileOperation(async () => {
        fileHandle = null;
        connectionId = null;
        recentFileName = "";
        filePermission = fileSystemAccessSupported ? "prompt" : "unsupported";
        lastFileHash = null;
        lastFileRevision = null;
        lastSyncAt = null;
        await backend.setMeta(metadataSnapshot());
        postBroadcast({ type: "connection-changed", fileName: "" });
        notify({ type: "file-forgotten" });
        return getStatus();
      });
    }

    async function downloadBackup(options = {}) {
      const document = await currentDocument();
      const text = serializeVaultDocument(document);
      const date = updatedAt.slice(0, 10);
      const filename = options.filename || `tools-vault-${date}.json`;
      const BlobConstructor = valueFromEnvironment("Blob");
      const documentObject = valueFromEnvironment("document");
      const URLObject = valueFromEnvironment("URL");
      if (BlobConstructor && documentObject?.createElement && URLObject?.createObjectURL) {
        const blob = new BlobConstructor([text], { type: "application/json;charset=utf-8" });
        const url = URLObject.createObjectURL(blob);
        const anchor = documentObject.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.hidden = true;
        documentObject.body?.appendChild(anchor);
        anchor.click();
        anchor.remove();
        valueFromEnvironment("setTimeout")?.(() => URLObject.revokeObjectURL(url), 0);
        return { filename, text, document, blob };
      }
      return { filename, text, document };
    }

    async function exportPortableText() {
      return encodePortableText(await currentDocument(), environment);
    }

    async function importPortableText(text) {
      const document = await decodePortableText(text, environment);
      await replaceWithDocument(document, { dirty: true, disconnect: true });
      return getStatus();
    }

    function startAutoSync(options = {}) {
      if (autoSyncTimer) return () => stopAutoSync();
      const setIntervalFunction = valueFromEnvironment("setInterval");
      if (typeof setIntervalFunction !== "function") return () => {};
      const requested = Number(options.interval || options.intervalMs || DEFAULT_SYNC_INTERVAL);
      const interval = Number.isFinite(requested) ? Math.max(1_000, requested) : DEFAULT_SYNC_INTERVAL;
      autoSyncTimer = setIntervalFunction(async () => {
        if (!initialized || !dirty || !fileHandle) return;
        if (await refreshPermission(false) !== "granted") return;
        try {
          await saveNow({ requestPermission: false });
        } catch (error) {
          lastError = error;
          notify({ type: error.code === "VAULT_FILE_CONFLICT" ? "conflict" : "error", error });
        }
      }, interval);
      autoSyncTimer?.unref?.();
      return () => stopAutoSync();
    }

    function stopAutoSync() {
      if (!autoSyncTimer) return;
      const clearIntervalFunction = valueFromEnvironment("clearInterval");
      clearIntervalFunction?.(autoSyncTimer);
      autoSyncTimer = null;
    }

    const api = {
      storage,
      migrateKeys,
      getStatus,
      subscribe,
      createVaultFile,
      openVaultFile,
      reconnectFile,
      saveNow,
      forgetFile,
      downloadBackup,
      exportPortableText,
      importPortableText,
      flush,
      startAutoSync,
      stopAutoSync,
    };
    const ready = initialize();
    api.ready = ready;
    return api;
  }

  const singleton = createVaultService();
  async function runBrowserSmokeTest(service = singleton) {
    await service.ready;
    const status = service.getStatus();
    if (root.indexedDB && status.mode !== "indexeddb") {
      throw new Error("IndexedDB가 제공되었지만 보관함이 fallback 저장소로 열렸습니다.");
    }
    const key = `small-tools:smoke:${Date.now()}`;
    service.storage.setItem(key, "한글 저장 확인");
    await service.flush();
    if (service.storage.getItem(key) !== "한글 저장 확인") throw new Error("보관함 쓰기 smoke test에 실패했습니다.");
    service.storage.removeItem(key);
    await service.flush();
    return service.getStatus();
  }

  return Object.assign(singleton, {
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
    sha256Hex,
    buildFallbackRecoverySnapshot,
    runBrowserSmokeTest,
  });
});
