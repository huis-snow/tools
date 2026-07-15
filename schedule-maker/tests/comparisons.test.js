"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const schedule = require("../app.js");
const comparisons = require("../saved-comparisons.js");

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries).map(([key, value]) => [key, String(value)]));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function member(title, indexes = [], options = {}) {
  const slots = schedule.createSlots();
  indexes.forEach((index) => schedule.setSelected(slots, index, true));
  return {
    title,
    timezone: options.timezone || "Asia/Seoul",
    startHour: options.startHour ?? 8,
    startDay: options.startDay ?? 0,
    slots,
  };
}

function group(name = "주말 공대", members = [member("휴이스")], options = {}) {
  return {
    name,
    startHour: options.startHour ?? 8,
    startDay: options.startDay ?? 0,
    members,
  };
}

test("취합표 저장 모듈은 저장·추가·공유에 필요한 공개 API를 제공한다", () => {
  for (const name of [
    "list", "get", "saveComparison", "rename", "remove", "addMembers",
    "makeShareHash", "makeShareUrl", "parseShareHash", "parseShareInput",
  ]) {
    assert.equal(typeof comparisons[name], "function", `${name} API가 필요합니다`);
  }
});

test("취합표는 이름·보기 설정·멤버 선택 스냅샷을 따로 저장한다", () => {
  const storage = new MemoryStorage();
  const source = member("쵸하", [schedule.slotIndex(22, 4)], { startHour: 9, startDay: 5 });
  const saved = comparisons.saveComparison(storage, group("금요일 레이드", [source], {
    startHour: 10,
    startDay: 4,
  }), { id: "raid", now: 100 });

  schedule.setSelected(source.slots, schedule.slotIndex(22, 4), false);
  source.title = "바뀐 원본";

  const restored = comparisons.get(storage, saved.id);
  assert.equal(restored.name, "금요일 레이드");
  assert.equal(restored.startHour, 10);
  assert.equal(restored.startDay, 4);
  assert.equal(restored.members[0].title, "쵸하");
  assert.equal(
    schedule.isSelected(schedule.decodeSlots(restored.members[0].slots), schedule.slotIndex(22, 4)),
    true,
  );
});

test("선택한 새 일정만 기존 취합표에 추가하고 정확한 중복은 건너뛴다", () => {
  const storage = new MemoryStorage();
  const choha = member("쵸하", [schedule.slotIndex(20, 1)]);
  const huis = member("휴이스", [schedule.slotIndex(21, 2)]);
  comparisons.saveComparison(storage, group("고정팟", [choha]), { id: "fixed", now: 100 });

  const updated = comparisons.addMembers(storage, "fixed", [choha, huis], { now: 200 });
  assert.deepEqual(updated.members.map((item) => item.title), ["쵸하", "휴이스"]);
  assert.equal(updated.createdAt, 100);
  assert.equal(updated.updatedAt, 200);
});

test("취합표 이름 변경과 삭제는 포함된 개별 일정 데이터에 영향을 주지 않는다", () => {
  const storage = new MemoryStorage();
  comparisons.saveComparison(storage, group(), { id: "group-one", now: 100 });
  const renamed = comparisons.rename(storage, "group-one", "토요일 출발", { now: 150 });
  assert.equal(renamed.name, "토요일 출발");
  assert.equal(renamed.members.length, 1);
  assert.equal(comparisons.remove(storage, "group-one"), true);
  assert.equal(comparisons.get(storage, "group-one"), null);
  assert.equal(comparisons.remove(storage, "group-one"), false);
});

test("한글·이모지 취합표 공유 링크가 모든 멤버와 보기 설정을 왕복한다", () => {
  const original = group("🌙 새벽 레이드", [
    member("쵸하🎮", [schedule.slotIndex(1, 6)], { startHour: 8, startDay: 6 }),
    member("휴이스", [schedule.slotIndex(2, 0)], { startHour: 0, startDay: 1 }),
  ], { startHour: 11, startDay: 5 });
  const hash = comparisons.makeShareHash(original);
  const parsed = comparisons.parseShareHash(hash);

  assert.match(hash, /^#g=[A-Za-z0-9_-]+$/);
  assert.equal(parsed.name, original.name);
  assert.equal(parsed.startHour, 11);
  assert.equal(parsed.startDay, 5);
  assert.deepEqual(parsed.members.map((item) => item.title).sort(), ["쵸하🎮", "휴이스"].sort());
  assert.equal(
    comparisons.canonicalGroupKey(parsed),
    comparisons.canonicalGroupKey({ ...original, members: [...original.members].reverse() }),
  );
});

test("취합 공유 데이터는 전체 URL과 Discord 자동 임베드 방지 URL에서도 읽힌다", () => {
  const original = group("평일 저녁");
  const url = comparisons.makeShareUrl("https://example.test/schedule-maker/compare.html", original);
  assert.equal(comparisons.parseShareInput(url).name, "평일 저녁");
  assert.equal(comparisons.parseShareInput(`<${url}>`).name, "평일 저녁");
});

test("같은 공유 취합표를 다시 열면 보관함에 중복 항목을 만들지 않는다", () => {
  const storage = new MemoryStorage();
  const hash = comparisons.makeShareHash(group("겹치는 표"));
  const first = comparisons.saveSharedComparison(storage, hash, { id: "first", now: 100 });
  const second = comparisons.saveSharedComparison(storage, hash, { id: "second", now: 200 });

  assert.equal(comparisons.list(storage).length, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.updatedAt, 200);
});

test("깨진 저장 문서는 원문을 격리하고 초기화 전까지 취합표 변경을 막는다", () => {
  const raw = "{not-json";
  const brokenStorage = new MemoryStorage({ [comparisons.STORAGE_KEY]: raw });
  assert.throws(() => comparisons.list(brokenStorage), (error) => error.code === "CORRUPT_STORAGE");
  assert.equal(brokenStorage.getItem(comparisons.RECOVERY_KEY), raw);
  assert.equal(brokenStorage.getItem(comparisons.STORAGE_KEY), raw);
  assert.throws(() => comparisons.saveComparison(brokenStorage, group("덮으면 안 됨")), /손상/);
  assert.equal(brokenStorage.getItem(comparisons.STORAGE_KEY), raw);

  comparisons.resetCorruptDocument(brokenStorage);
  assert.equal(brokenStorage.getItem(comparisons.RECOVERY_KEY), null);
  assert.deepEqual(comparisons.list(brokenStorage), []);
});

test("손상된 공유 데이터는 저장 문서와 구분해 안전하게 거절한다", () => {
  assert.throws(() => comparisons.parseShareHash("#g=%%%"), /형식/);
  assert.throws(() => comparisons.parseShareInput("https://example.test/compare.html"), /데이터/);
});

test("취합·보관함 페이지는 취합 저장 모듈을 app.js보다 먼저 불러온다", () => {
  const directory = path.join(__dirname, "..");
  for (const filename of ["compare.html", "saved.html"]) {
    const html = fs.readFileSync(path.join(directory, filename), "utf8");
    const moduleIndex = html.indexOf("saved-comparisons.js");
    const appIndex = html.indexOf("app.js");
    assert.ok(moduleIndex >= 0, `${filename}에서 취합 저장 모듈을 불러와야 합니다`);
    assert.ok(appIndex > moduleIndex, `${filename}에서 취합 저장 모듈이 app.js보다 먼저 실행되어야 합니다`);
  }
});
