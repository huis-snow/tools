"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  displayWidth,
  truncateDisplayWidth,
  padCell,
  detectDelimiter,
  parseDelimited,
  generateTable,
} = require("../app.js");

test("ASCII 문자는 한 칸씩 센다", () => {
  assert.equal(displayWidth("SEOUL"), 5);
});

test("한글·한자·일본어·전각 기호는 두 칸씩 센다", () => {
  assert.equal(displayWidth("서울"), 4);
  assert.equal(displayWidth("佐藤"), 4);
  assert.equal(displayWidth("カナ"), 4);
  assert.equal(displayWidth("ＡＢ"), 4);
});

test("결합 문자는 별도 칸을 차지하지 않는다", () => {
  assert.equal(displayWidth("e\u0301"), 1);
  assert.equal(displayWidth("\u0301"), 0);
  assert.equal(displayWidth("각"), displayWidth("가\u11a8"));
  assert.equal(displayWidth("한글"), 4);
});

test("이모지와 ZWJ 이모지 묶음은 두 칸으로 센다", () => {
  assert.equal(displayWidth("☕️"), 2);
  assert.equal(displayWidth("✅"), 2);
  assert.equal(displayWidth("👨‍💻"), 2);
  assert.equal(displayWidth("🇰🇷"), 2);
  assert.equal(displayWidth("🇰"), 1);
  assert.equal(displayWidth("1️⃣"), 2);
  assert.equal(displayWidth("❤︎"), 1);
});

test("혼합 문자열의 표시 폭을 더한다", () => {
  assert.equal(displayWidth("Seoul 서울 ☕️"), 13);
  assert.equal(displayWidth("ｱｲ"), 2);
  assert.equal(displayWidth("𠀀"), 2);
  assert.equal(displayWidth("a\u200bb"), 2);
  assert.equal(displayWidth("\ud800"), 0);
});

test("정렬 방향에 맞게 실제 표시 폭만큼 패딩한다", () => {
  assert.equal(displayWidth(padCell("한글", 8, "left")), 8);
  assert.equal(padCell("한글", 8, "left"), "한글    ");
  assert.equal(padCell("한글", 8, "right"), "    한글");
  assert.equal(padCell("한글", 7, "center"), " 한글  ");
});

test("한글과 복합 이모지를 grapheme 단위로 표시 폭 말줄임한다", () => {
  assert.equal(truncateDisplayWidth("가나다라", 5), "가나…");
  assert.equal(displayWidth(truncateDisplayWidth("가나다라", 5)), 5);
  assert.equal(truncateDisplayWidth("👨‍💻👩‍🔬X", 3), "👨‍💻…");
  assert.equal(displayWidth(truncateDisplayWidth("👨‍💻👩‍🔬X", 3)), 3);
  assert.equal(truncateDisplayWidth("e\u0301e\u0301X", 2), "e\u0301…");
});

test("탭·쉼표·세로줄 구분자를 자동 감지한다", () => {
  assert.equal(detectDelimiter("이름\t역할\n민지\t디자인"), "\t");
  assert.equal(detectDelimiter("이름,역할\n민지,디자인"), ",");
  assert.equal(detectDelimiter("이름|역할\n민지|디자인"), "|");
});

test("따옴표가 있는 CSV를 파싱한다", () => {
  assert.deepEqual(parseDelimited('이름,메모\n민지,"서울, 한국"', ","), [
    ["이름", "메모"],
    ["민지", "서울, 한국"],
  ]);
});

test("한글이 포함된 표의 모든 줄 폭이 같다", () => {
  const rows = [
    ["이름", "역할", "상태"],
    ["김민지", "디자이너", "진행 중"],
    ["Alex", "개발자", "완료 ✅"],
    ["佐藤", "리서처", "대기"],
  ];

  for (const style of ["rounded", "square", "heavy", "ascii"]) {
    const table = generateTable(rows, {
      style,
      padding: 1,
      hasHeader: true,
      alignments: ["left", "center", "right"],
    });
    const widths = table.split("\n").map(displayWidth);
    assert.equal(new Set(widths).size, 1, `${style}\n${table}\n줄 폭: ${widths.join(", ")}`);
  }
});

test("Markdown 표도 한글 셀을 표시 폭 기준으로 맞춘다", () => {
  const table = generateTable(
    [
      ["도시", "code"],
      ["서울", "SEL"],
    ],
    { style: "markdown", hasHeader: true, alignments: ["left", "right"] },
  );
  assert.match(table, /^\| 도시/m);
  assert.match(table, /:\s+\|$/m);
  assert.equal(new Set(table.split("\n").map(displayWidth)).size, 1, table);
});

test("고정 폭은 ASCII·Unicode·Markdown 표의 모든 열 콘텐츠를 같은 폭으로 맞춘다", () => {
  const rows = [
    ["이름", "설명"],
    ["김민지", "👨‍💻 개발자와 긴 설명"],
    ["Alexander", "짧음"],
  ];

  for (const style of ["ascii", "rounded", "square", "heavy", "markdown"]) {
    const table = generateTable(rows, {
      style,
      padding: 1,
      fixedWidth: 5,
      hasHeader: true,
      alignments: ["left", "right"],
    });
    const lineWidths = table.split("\n").map(displayWidth);
    assert.deepEqual(new Set(lineWidths), new Set([17]), `${style}\n${table}`);
    assert.match(table, /…/, `${style}\n${table}`);
    assert.doesNotMatch(table, /Alexander/, `${style}\n${table}`);
  }
});

test("Markdown 고정 폭은 세로줄을 이스케이프한 뒤 다시 말줄임한다", () => {
  const table = generateTable(
    [
      ["키", "설명"],
      ["A", "가|나다라마바사"],
    ],
    { style: "markdown", fixedWidth: 5, hasHeader: true },
  );

  assert.match(table, /가\\\|…/);
  assert.equal(new Set(table.split("\n").map(displayWidth)).size, 1, table);
  assert.equal(displayWidth(table.split("\n")[0]), 17);
});

test("fixedWidth가 없으면 기존 자동 열 너비와 내용이 유지된다", () => {
  const table = generateTable(
    [
      ["이름", "설명"],
      ["김민지", "아주 긴 설명도 그대로 유지"],
    ],
    { style: "ascii", padding: 1, hasHeader: true },
  );

  assert.match(table, /아주 긴 설명도 그대로 유지/);
  assert.doesNotMatch(table, /…/);
  assert.equal(new Set(table.split("\n").map(displayWidth)).size, 1, table);
});
