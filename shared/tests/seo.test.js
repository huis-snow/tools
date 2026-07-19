"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "../..");
const PAGES = [
  { file: "index.html", url: "https://huis-snow.github.io/tools/", indexed: true },
  { file: "table-maker/index.html", url: "https://huis-snow.github.io/tools/table-maker/", indexed: true },
  { file: "schedule-maker/index.html", url: "https://huis-snow.github.io/tools/schedule-maker/", indexed: true },
  {
    file: "schedule-maker/compare.html",
    url: "https://huis-snow.github.io/tools/schedule-maker/compare.html",
    indexed: true,
  },
  {
    file: "schedule-maker/room.html",
    url: "https://huis-snow.github.io/tools/schedule-maker/room.html",
    indexed: false,
  },
  {
    file: "schedule-maker/saved.html",
    url: "https://huis-snow.github.io/tools/schedule-maker/saved.html",
    indexed: false,
  },
  { file: "habit-maker/index.html", url: "https://huis-snow.github.io/tools/habit-maker/", indexed: true },
  { file: "raid-maker/index.html", url: "https://huis-snow.github.io/tools/raid-maker/", indexed: true },
  { file: "daily-log/index.html", url: "https://huis-snow.github.io/tools/daily-log/", indexed: true },
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)];
}

function jsonLd(relativePath) {
  return matches(read(relativePath), /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).map((match) =>
    JSON.parse(match[1]),
  );
}

test("모든 실제 페이지는 고유한 대표 주소와 공유 메타데이터를 가진다", () => {
  const canonicalUrls = new Set();

  PAGES.forEach(({ file, url, indexed }) => {
    const source = read(file);
    const canonical = matches(source, /<link rel="canonical" href="([^"]+)"\s*\/>/g);

    assert.equal(canonical.length, 1, `${file}의 canonical 개수`);
    assert.equal(canonical[0][1], url, `${file}의 canonical 주소`);
    assert.ok(!canonicalUrls.has(url), `${url} canonical 중복`);
    canonicalUrls.add(url);

    assert.equal(matches(source, /<title>[^<]+<\/title>/g).length, 1, `${file}의 title`);
    assert.equal(matches(source, /<meta\s+name="description"\s+content="[^"]+"\s*\/>/g).length, 1, `${file}의 description`);
    assert.match(source, /<meta property="og:title" content="[^"]+"\s*\/>/, `${file}의 Open Graph 제목`);
    assert.match(source, new RegExp(`<meta property="og:url" content="${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" \\/>`));
    assert.match(source, /<meta name="twitter:card" content="summary"\s*\/>/, `${file}의 Twitter 카드`);

    if (indexed) {
      assert.doesNotMatch(source, /<meta name="robots" content="[^"]*noindex/i, `${file}는 검색 허용`);
    } else {
      assert.match(source, /<meta name="robots" content="noindex, follow"\s*\/>/, `${file}는 검색 제외`);
    }
  });
});

test("사이트맵은 검색 허용 페이지의 canonical만 중복 없이 포함한다", () => {
  const source = read("sitemap.xml");
  const locations = matches(source, /<loc>([^<]+)<\/loc>/g).map((match) => match[1]);
  const expected = PAGES.filter(({ indexed }) => indexed).map(({ url }) => url);

  assert.match(source, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual(locations, expected);
  assert.equal(new Set(locations).size, locations.length, "사이트맵 URL 중복 없음");
  assert.doesNotMatch(source, /schedule-maker\/saved\.html/);
});

test("반듯표는 한글 아스키 테이블 검색 의도와 실제 사용 안내를 정적으로 제공한다", () => {
  const source = read("table-maker/index.html");

  assert.match(source, /<title>한글 아스키\(ASCII\) 테이블 생성기 \| 반듯표<\/title>/);
  assert.match(source, /<h1 id="hero-title">한글 아스키<br \/><em>테이블 생성기\.<\/em><\/h1>/);
  assert.match(source, /표시 폭을 계산해 디스코드와 터미널/);
  assert.match(source, /디스코드에서 표가 어긋나는 이유/);
  assert.match(source, /한글과 전각 문자는 왜 2칸일까요\?/);
  assert.match(source, /스프레드시트에서 바로 표 만들기/);
  assert.match(read("index.html"), /한글 아스키\(ASCII\) 테이블 생성기/);
});

test("사이트와 반듯표 구조화 데이터는 실제 페이지 정보와 일치한다", () => {
  const [site] = jsonLd("index.html");
  const [app] = jsonLd("table-maker/index.html");

  assert.equal(site["@context"], "https://schema.org");
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.name, "작은 도구함");
  assert.equal(site.url, PAGES[0].url);
  assert.equal(site.inLanguage, "ko-KR");

  assert.equal(app["@context"], "https://schema.org");
  assert.equal(app["@type"], "WebApplication");
  assert.equal(app.name, "반듯표");
  assert.equal(app.alternateName, "한글 아스키 테이블 생성기");
  assert.equal(app.url, PAGES[1].url);
  assert.equal(app.applicationCategory, "UtilitiesApplication");
  assert.equal(app.operatingSystem, "Any");
  assert.equal(app.inLanguage, "ko-KR");
  assert.equal(app.isAccessibleForFree, true);
  assert.equal(app.offers.price, "0");
  assert.equal(app.offers.priceCurrency, "KRW");
});
