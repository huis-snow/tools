/* Pure search and graph calculations; also used by the Node.js regression tests. */
(function (root) {
  'use strict';
  const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  function normalize(value) { return String(value).normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s\p{P}\p{S}]/gu, ''); }
  function initials(value) {
    return [...String(value)].map(char => {
      const code=char.charCodeAt(0)-0xac00;
      return code>=0&&code<11172 ? CHOSEONG[Math.floor(code/588)] : char;
    }).join('');
  }
  function createTracker(data) {
    if(data.schemaVersion!==1 || !data.quests?.length) throw new Error('지원하지 않는 퀘스트 데이터입니다.');
    const byId = new Map(data.quests.map(q=>[q.id,q]));
    const groupOrder = new Map(data.groups.map((g,i)=>[g.id,i]));
    const expansionOrder = new Map(data.expansions.map((e,i)=>[e.id,i]));
    const searchIndex = data.quests.map(q=>({quest:q, text:normalize(q.name), initials:normalize(initials(q.name))}));
    const routes = [];
    for(const city of ['gridania','limsa','uldah']) for(const company of ['쌍사당','흑와단','불멸대']) {
      const quests=data.quests.filter(q=>q.cities.includes(city)&&q.companies.includes(company));
      const ids=new Set(quests.map(q=>q.id));
      const previous=new Map(quests.map(q=>[q.id,q.previous.filter(id=>ids.has(id))]));
      const next=new Map(quests.map(q=>[q.id,[]]));
      for(const q of quests) for(const id of previous.get(q.id)) next.get(id).push(q.id);
      const counts=new Map(data.expansions.map(e=>[e.id,quests.filter(q=>q.expansion===e.id).length]));
      routes.push({city,company,quests,ids,previous,next,counts});
    }
    function search(term, expansion='') {
      const query=normalize(term);
      const matched=searchIndex.filter(item=>(!expansion||item.quest.expansion===expansion)&&(!query||item.text.includes(query)||item.initials.includes(query)));
      if(query) matched.sort((a,b)=>{
        const rank=item=>item.text===query?0:item.text.startsWith(query)?1:item.text.includes(query)?2:3;
        return rank(a)-rank(b);
      });
      return matched.map(item=>item.quest);
    }
    function walk(id, links) {
      const found=new Set(), pending=[...(links.get(id)||[])];
      while(pending.length) {
        const next=pending.pop();
        if(found.has(next)) continue;
        found.add(next); pending.push(...links.get(next));
      }
      return found;
    }
    function aggregate(samples) {
      const range=key=>[Math.min(...samples.map(s=>s[key])),Math.max(...samples.map(s=>s[key]))];
      const percents=samples.flatMap(s=>[100*s.min/s.total,100*s.max/s.total]);
      return {done:[range('min')[0],range('max')[1]],total:range('total'),remaining:[Math.min(...samples.map(s=>s.total-s.max)),Math.max(...samples.map(s=>s.total-s.min))],percent:[Math.min(...percents),Math.max(...percents)]};
    }
    function calculate(id, status='current', city='') {
      const selected=byId.get(id);
      if(!selected) throw new Error('퀘스트를 찾을 수 없습니다.');
      if(!['current','completed'].includes(status)) throw new Error('잘못된 완료 상태입니다.');
      const candidates=routes.filter(r=>(!city||r.city===city)&&r.ids.has(id));
      if(!candidates.length) throw new Error('선택한 시작 도시에서 진행할 수 없는 퀘스트입니다.');
      const currentGroup=groupOrder.get(selected.group);
      const samples=candidates.map(route=>{
        const ancestors=walk(id,route.previous), descendants=walk(id,route.next);
        const before=route.quests.filter(q=>groupOrder.get(q.group)<currentGroup);
        const same=route.quests.filter(q=>q.group===selected.group);
        const certain=same.filter(q=>ancestors.has(q.id)).length;
        const possible=same.filter(q=>q.id!==id&&!descendants.has(q.id)).length;
        const include=status==='completed'?1:0;
        const groupMin=certain+include, groupMax=possible+include;
        const expansionBefore=before.filter(q=>q.expansion===selected.expansion).length;
        return {route,overall:{min:before.length+groupMin,max:before.length+groupMax,total:route.quests.length}, expansion:{min:expansionBefore+groupMin,max:expansionBefore+groupMax,total:route.counts.get(selected.expansion)},parallel:possible>certain};
      });
      const overall=aggregate(samples.map(s=>s.overall));
      const expansion=aggregate(samples.map(s=>s.expansion));
      const journey=data.expansions.map(e=>{
        const position=expansionOrder.get(e.id)-expansionOrder.get(selected.expansion);
        const stats=e.id===selected.expansion?expansion:aggregate(samples.map(({route})=>{
          const total=route.counts.get(e.id),done=position<0?total:0;
          return {min:done,max:done,total};
        }));
        return {...e,...stats,state:position<0?'completed':position===0?'current':'upcoming'};
      });
      return {selected,overall,expansion,journey,hasParallel:samples.some(s=>s.parallel),hasCityRange:new Set(samples.map(s=>s.overall.total)).size>1};
    }
    function overview(city='') {
      const candidates=routes.filter(r=>!city||r.city===city);
      return data.expansions.map(e=>({...e,total:[Math.min(...candidates.map(r=>r.counts.get(e.id))),Math.max(...candidates.map(r=>r.counts.get(e.id)))]}));
    }
    return {search,calculate,overview,byId};
  }
  const api={createTracker,normalize,initials};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.MSQProgress=api;
})(typeof window==='undefined'?globalThis:window);
