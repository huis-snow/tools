// Node.js 20+. Fetch only public quest metadata; no descriptions or rewards are retained.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const base = 'https://guide.ff14.co.kr';
const cache = new URL('.cache/', root);
await mkdir(cache, { recursive: true });
const decode = text => text.replace(/<[^>]*>/g, '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : +n)).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function get(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
      return await response.text();
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
}
const index = await get('/lodestone/db/quest');
const groups = [...index.matchAll(/fnOpenLeftMenu\(2,\s*(\d+),\s*(\d+),[^']*'([^']+)'\)">주요 퀘스트: ([^<]+)</g)].map(m => ({id:+m[2], category:+m[1], name:decode(m[4]), path:decode(m[3])}));
if (groups.length < 15 || new Set(groups.map(g => g.id)).size !== groups.length) throw new Error('Official category navigation changed. Review before updating.');
const quests = [];
for (const group of groups) {
  let page = 1;
  const ids = new Set();
  while (true) {
    const html = await get(group.path + `&page=${page}`);
    const body = html.split('<ul class="list_type">')[1]?.split('<!-- Case1.')[0];
    if (!body) throw new Error(`Missing quest list: ${group.path}`);
    const items = [...body.matchAll(/<a href="\/lodestone\/db\/quest\/([a-f0-9]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => {
      const title = m[2].match(/<cite class="name">([\s\S]*?)<\/cite>/)?.[1];
      const fields = [...m[2].matchAll(/<dd>([\s\S]*?)<\/dd>/g)].map(x => decode(x[1]));
      if (!title || !fields[1] || !m[2].includes(`주요 퀘스트: ${group.name}`)) throw new Error('Unexpected quest row');
      return {id:m[1], name:decode(title.replace(/<i\b[^>]*>[\s\S]*?<\/i>/g, '')), level:+fields[1], region:fields[0], group:group.id};
    });
    for (const quest of items) {
      if (ids.has(quest.id)) throw new Error(`Repeated page: ${group.id}/${page}`);
      ids.add(quest.id);
      quests.push(quest);
    }
    const pages = [...html.matchAll(/href="\/lodestone\/db\/quest\?[^"\s]*?page=(\d+)"/g)].map(m => +m[1]);
    if (!items.length || !pages.some(p => p > page)) break;
    if (++page > 100) throw new Error('Pagination overflow');
  }
  console.log(`${group.name}: ${ids.size}`);
}
if (quests.length < 900 || new Set(quests.map(q=>q.id)).size !== quests.length) throw new Error('Incomplete or duplicated catalog');
await writeFile(new URL('catalog.json', cache), JSON.stringify({groups,quests}, null, 2));
let cursor = 0, done = 0;
await Promise.all(Array.from({length:3}, async () => {
  while (cursor < quests.length) {
    const q = quests[cursor++];
    const target = new URL(`${q.id}.json`, cache);
    let detail;
    try { detail = JSON.parse(await readFile(target, 'utf8')); } catch {}
    if (!detail || process.argv.includes('--refresh')) {
      const html = await get(`/lodestone/db/quest/${q.id}`);
      const area = html.split('<span>선행 퀘스트</span>')[1]?.split('</dl>')[0] || '';
      if (!html.includes('class="item_detail"') && !html.includes('발생 퀘스트') && !html.includes('클래스/잡 조건')) throw new Error(`Unexpected detail: ${q.id}`);
      detail = { previous:[...area.matchAll(/href="\/lodestone\/db\/quest\/([a-f0-9]+)"/g)].map(m=>m[1]), initialClass:decode(html.match(/초기 전투 클래스<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/s)?.[1] || '') };
      await writeFile(target, JSON.stringify(detail));
    }
    Object.assign(q, detail);
    if (++done % 100 === 0) console.log(`Quest links: ${done}/${quests.length}`);
  }
}));
const output = {schemaVersion:1, fetchedAt:new Date().toISOString().slice(0,10), source:base+'/lodestone/db/quest', groups, quests};
await writeFile(new URL('raw-data.json', cache), JSON.stringify(output, null, 2));
console.log(`Metadata ready: ${quests.length}. Run build-data.mjs to validate and publish the browser snapshot.`);
