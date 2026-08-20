"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const POLL_ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(POLL_ROOT, file), "utf8");
}

test("검색 가능한 홈은 canonical과 무료 한국어 웹앱 구조화 데이터를 제공한다", () => {
  const html = read("index.html");
  const jsonLdSource = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];

  assert.match(html, /<html lang="ko">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/huis-snow\.github\.io\/tools\/poll-maker\/"/);
  assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
  assert.ok(jsonLdSource, "구조화 데이터가 있어야 한다");
  assert.deepEqual(JSON.parse(jsonLdSource), {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "익명 투표소",
    url: "https://huis-snow.github.io/tools/poll-maker/",
    description: "동의, 거부, 상관없음 중 하나를 익명으로 선택하고 결과 공개 범위를 정할 수 있는 온라인 투표 도구",
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    inLanguage: "ko-KR",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
  });
});

test("홈은 Google 방장 로그인·한 안건·설명·고정 세 선택지와 결과 공개 범위를 제공한다", () => {
  const html = read("index.html");

  assert.match(html, /id="pollGoogleSignInButton"/);
  assert.match(html, /id="pollRoomCreateForm"/);
  assert.match(html, /id="pollCreateAgenda"[^>]*maxlength="160"[^>]*required/);
  assert.match(html, /id="pollCreateDescription"[^>]*maxlength="500"/);
  assert.equal((html.match(/class="(?:agree|reject|neutral)"/g) || []).length >= 3, true);
  for (const label of ["동의", "거부", "상관없음"]) assert.match(html, new RegExp(label));
  assert.match(html, /id="poll-owned-rooms"/);
  assert.match(html, /data-action="copy"/);
  assert.doesNotMatch(html, /name="(?:nickname|name)"/i);
  assert.equal((html.match(/name="resultVisibility"/g) || []).length, 3);
  assert.equal((html.match(/value="(?:public|voters|owner)"/g) || []).length, 3);
  assert.match(html, /name="resultVisibility" value="owner" checked/);
  assert.match(html, /전체 공개/);
  assert.match(html, /투표한 사람만 공개/);
  assert.match(html, /방장만 공개 <b>추천<\/b>/);
  assert.match(html, /aria-label="익명 투표 결과 예시"/);
  assert.match(html, /결과를 누구에게 보여 줄지 방장이 정해요/);
});

test("참여방은 검색 제외·native radio·권한별 결과 안내와 방장 마감 영역을 갖춘다", () => {
  const html = read("room.html");

  assert.match(html, /<meta name="robots" content="noindex, follow"/);
  assert.equal((html.match(/type="radio" name="pollChoice"/g) || []).length, 3);
  assert.equal((html.match(/value="(?:agree|reject|neutral)"/g) || []).length, 3);
  assert.match(html, /<fieldset class="vote-choices"/);
  assert.match(html, /id="pollResultsPanel"[^>]*hidden/);
  assert.match(html, /id="pollRoomResultSummary"[^>]*hidden/);
  assert.equal((html.match(/class="result-row (?:agree|reject|neutral)"/g) || []).length, 3);
  assert.match(html, /id="pollOwnerPanel"[^>]*hidden/);
  assert.match(html, /id="pollLockButton"/);
  assert.match(html, /id="pollOwnerAccess"/);
  assert.match(html, /id="pollOwnerSignInButton"/);
  assert.match(html, /id="pollRoomVisibilityLabel"/);
  assert.match(html, /id="pollRoomVisibilityDescription"/);
  assert.match(html, /id="pollRoomVisibilityNotice" hidden/);
  assert.match(html, /id="pollRoomTotal">—</);
  assert.match(html, /id="pollRoomTotalLabel">방장 결과/);
});

test("익명 범위·결과 공개 범위와 기술적 한계를 홈과 참여방에서 오해 없이 알린다", () => {
  const copy = `${read("index.html")}\n${read("room.html")}`;

  for (const phrase of ["무작위 투표 키", "키와 선택이 함께 저장", "결과 열람 권한", "가명표 원본", "앱 화면", "Firebase 프로젝트 운영자", "원본 데이터", "짐작"]) {
    assert.match(copy, new RegExp(phrase));
  }
  assert.match(read("index.html"), /공식 선거나 신원 확인이 필요한 투표에는 적합하지 않습니다/);
  assert.match(read("room.html"), /결과 공개 범위와 관계없이 앱 화면에는 이름 없는 선택지별 합계만 표시해요/);
  assert.match(read("room.html"), /결과 열람 권한이 있는 계정이나 브라우저/);
  assert.doesNotMatch(copy, /내부 익명 ID만/);
  assert.doesNotMatch(copy, /방장(?:도|은|에게는?) (?:원본|개별 선택)에 접근할 수 없/);
});

test("건너뛰기 대상과 방장 결과 상태는 키보드와 보조 기술에 연결된다", () => {
  const home = read("index.html");
  const room = read("room.html");

  assert.match(home, /id="poll-room-builder"[^>]*tabindex="-1"/);
  assert.match(room, /id="pollVotePanel"[^>]*tabindex="-1"/);
  assert.match(room, /id="pollResultsTitle"[^>]*tabindex="-1"/);
  assert.match(room, /id="pollResultsLive"[^>]*role="status"[^>]*aria-live="polite"/);
});

test("보조 문구 색상은 종이와 카드 배경 모두에서 일반 텍스트 대비를 확보한다", () => {
  const css = read("styles.css");
  const color = (name) => css.match(new RegExp(`--${name}:\\s*#([0-9a-f]{6})`, "i"))?.[1];
  const luminance = (hex) => {
    const channels = hex.match(/../g).map((part) => Number.parseInt(part, 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  };
  const contrast = (left, right) => {
    const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (bright + 0.05) / (dark + 0.05);
  };

  assert.ok(contrast(color("muted"), color("paper")) >= 4.5);
  assert.ok(contrast(color("muted"), color("cream")) >= 4.5);
});

test("각 페이지는 core·Firebase 설정·저장소 다음에 controller를 불러온다", () => {
  for (const file of ["index.html", "room.html"]) {
    const html = read(file);
    assert.ok(html.indexOf("./core.js") < html.indexOf("./firebase-config.js"), `${file} core 순서`);
    assert.ok(html.indexOf("./firebase-config.js") < html.indexOf("./firebase-room-store.js"), `${file} config 순서`);
    const controller = file === "index.html" ? "./index-page.js" : "./room-page.js";
    assert.ok(html.indexOf("./firebase-room-store.js") < html.indexOf(controller), `${file} controller 순서`);
  }
});

test("두 controller가 찾는 모든 정적 ID를 각 문서가 제공한다", () => {
  for (const page of ["index", "room"]) {
    const html = read(`${page}.html`);
    const controller = read(`${page}-page.js`);
    const ids = [...controller.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]);
    assert.ok(ids.length > 0, `${page} controller의 ID 목록`);
    ids.forEach((id) => assert.match(html, new RegExp(`id="${id}"`), `${page}.html의 #${id}`));
  }
});
