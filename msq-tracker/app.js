(function () {
  'use strict';
  const $=id=>document.getElementById(id);
  const cityNames={gridania:'그리다니아',limsa:'림사 로민사',uldah:'울다하'};
  let tracker, data, selected=null, limit=30, composing=false;
  const integer=new Intl.NumberFormat('ko-KR');
  const count=([min,max])=>min===max?integer.format(min):`${integer.format(min)}~${integer.format(max)}`;
  // Never round an unfinished route up to 100.0%, even for a future much larger dataset.
  const rounded=n=>n<100?Math.min(99.9,Math.round(n*10)/10):100;
  const percent=([min,max])=>{
    const lo=rounded(min).toFixed(1),hi=rounded(max).toFixed(1);
    return lo===hi?`${lo}%`:`${lo}~${hi}%`;
  };
  function node(tag, className, text) {
    const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;
  }
  function renderSearch() {
    if(composing)return;
    const query=$('questSearch').value,filter=$('expansionFilter').value;
    const results=$('searchResults');results.replaceChildren();
    if(!query.trim()&&!filter){
      $('searchSummary').textContent='퀘스트 이름을 검색하거나 확장팩을 골라주세요';
      results.append(node('p','search-empty','예: 새벽의 혈맹, 이슈가르드를 향해서\n퀘스트 이름의 일부만 입력해도 괜찮아요.'));
      $('showMore').hidden=true;return;
    }
    const matches=tracker.search(query,filter);
    $('searchSummary').textContent=`${integer.format(matches.length)}개 퀘스트${matches.length>limit?` · ${limit}개 표시`:''}`;
    if(!matches.length)results.append(node('p','search-empty','일치하는 주요 퀘스트가 없어요. 이름의 일부로 다시 검색하거나 확장팩 필터를 확인해 주세요.'));
    for(const q of matches.slice(0,limit)) {
      const button=node('button','quest-result');button.type='button';button.dataset.quest=q.id;button.setAttribute('aria-pressed',String(q.id===selected));
      const text=node('span');text.append(node('strong','',q.name));
      const group=data.groups.find(g=>g.id===q.group);
      const route=q.cities.length<3?` · ${q.cities.map(c=>cityNames[c]).join('/')}`:'';
      text.append(node('small','',`${group.name} · Lv.${q.level}${route}`));
      const arrow=node('span','arrow','↗');arrow.setAttribute('aria-hidden','true');button.append(text,arrow);results.append(button);
    }
    $('showMore').hidden=matches.length<=limit;
  }
  function bar(element, stats) {
    element.firstElementChild.style.width=`${stats.percent[0]}%`;
    element.setAttribute('aria-valuenow',String(rounded(stats.percent[0])));
    element.setAttribute('aria-valuetext',`${percent(stats.percent)}, ${count(stats.done)}개 완료 / ${count(stats.total)}개`);
  }
  function metric(prefix,stats) {
    const value=$(prefix+'Percent');value.textContent=percent(stats.percent);value.classList.toggle('is-range',value.textContent.includes('~'));
    $(prefix+'Count').textContent=`${count(stats.done)} / ${count(stats.total)}개 완료`;
    $(prefix+'Remaining').textContent=`${count(stats.remaining)}개 남음`;
    bar($(prefix+'Bar'),stats);
  }
  function journey(items,hasSelection) {
    const container=$('expansionJourney');container.replaceChildren();
    for(const e of items) {
      const card=node('article',`journey-item ${e.state||''}`);
      if(e.state==='current')card.setAttribute('aria-current','step');
      card.append(node('span','chapter',e.version),node('h3','',e.name));
      const value=node('strong','journey-percent',hasSelection?percent(e.percent):'—');
      value.classList.toggle('is-range',value.textContent.includes('~'));card.append(value);
      const track=node('div','progress-track');track.setAttribute('aria-hidden','true');track.append(node('i'));
      track.firstChild.style.width=hasSelection?`${e.percent[0]}%`:'0%';card.append(track);
      const labels={completed:'완료',current:'현재 확장팩',upcoming:'아직 시작 전'};
      card.append(node('small','',`${hasSelection?labels[e.state]+' · ':''}${count(e.total)}개`));container.append(card);
    }
  }
  function renderProgress() {
    if(!selected)return;
    const status=document.querySelector('input[name="questStatus"]:checked').value;
    const result=tracker.calculate(selected,status,$('startCity').value);
    const q=result.selected, group=data.groups.find(g=>g.id===q.group);
    $('emptyState').hidden=true;$('selectedState').hidden=false;
    $('selectedMeta').textContent=`${group.name} · Lv.${q.level} · ${q.region}`;
    $('selectedName').textContent=q.name;
    $('questLink').href=`https://guide.ff14.co.kr/lodestone/db/quest/${q.id}`;
    $('completionNote').textContent=status==='completed'?'선택한 퀘스트까지 완료 개수에 포함해요.':'선택한 퀘스트는 아직 완료 개수에 포함하지 않아요.';
    $('expansionName').textContent=data.expansions.find(e=>e.id===q.expansion).name;
    metric('overall',result.overall);metric('expansion',result.expansion);
    const notes=[];
    if(result.hasParallel)notes.push('다른 갈래를 얼마나 진행했는지에 따라 달라지는 구간이에요. 선행 퀘스트 기준 최소~최대 진행률을 표시했어요.');
    if(result.hasCityRange)notes.push('신생 시작 도시를 고르면 전체 퀘스트 수의 범위를 좁힐 수 있어요.');
    $('rangeNote').hidden=!notes.length;$('rangeNote').textContent=notes.join(' ');
    journey(result.journey,true);
  }
  function selectQuest(id) {
    const q=tracker.byId.get(id);if(!q)return;
    const restoreFocus=$('searchResults').contains(document.activeElement);
    selected=id;
    if(q.cities.length===1)$('startCity').value=q.cities[0];
    else if($('startCity').value&&!q.cities.includes($('startCity').value))$('startCity').value='';
    for(const option of $('startCity').options)option.disabled=Boolean(option.value&&!q.cities.includes(option.value));
    renderSearch();renderProgress();
    if(restoreFocus)$('searchResults').querySelector(`button[data-quest="${id}"]`)?.focus({preventScroll:true});
  }
  try {
    data=window.MSQ_DATA;tracker=window.MSQProgress.createTracker(data);
    for(const e of data.expansions){const option=node('option','',e.name);option.value=e.id;$('expansionFilter').append(option);}
    $('questSearch').disabled=false;$('expansionFilter').disabled=false;
    $('dataInfo').textContent=`공식 가이드 확인일 ${data.fetchedAt} · 원본 ${integer.format(data.sourceQuestCount)}개 · ${data.groups.at(-1).name}까지 포함 · 초기 클래스별 중복은 통합`;
    $('questSearch').addEventListener('compositionstart',()=>{composing=true;});
    $('questSearch').addEventListener('compositionend',()=>{composing=false;limit=30;renderSearch();});
    $('questSearch').addEventListener('input',()=>{limit=30;renderSearch();});
    $('questSearch').addEventListener('keydown',event=>{
      if(composing||event.isComposing)return;
      if(event.key==='ArrowDown'){const first=$('searchResults').querySelector('button');if(first){event.preventDefault();first.focus();}}
      if(event.key==='Enter'){const first=$('searchResults').querySelector('button');if(first){event.preventDefault();selectQuest(first.dataset.quest);}}
    });
    $('expansionFilter').addEventListener('change',()=>{limit=30;renderSearch();});
    $('showMore').addEventListener('click',()=>{limit+=30;renderSearch();});
    $('searchResults').addEventListener('click',event=>{const button=event.target.closest('button[data-quest]');if(button)selectQuest(button.dataset.quest);});
    $('searchResults').addEventListener('keydown',event=>{
      const current=event.target.closest('button');if(!current)return;
      if(event.key==='ArrowDown'){event.preventDefault();(current.nextElementSibling||current).focus();}
      if(event.key==='ArrowUp'){event.preventDefault();(current.previousElementSibling||$('questSearch')).focus();}
      if(event.key==='Escape')$('questSearch').focus();
    });
    document.querySelectorAll('input[name="questStatus"]').forEach(input=>input.addEventListener('change',renderProgress));
    $('startCity').addEventListener('change',renderProgress);
    renderSearch();journey(tracker.overview(),false);
  } catch(error) {
    $('searchSummary').textContent='퀘스트 데이터를 불러오지 못했어요.';
    $('searchResults').replaceChildren(node('p','error','페이지를 새로고침해 주세요. 계속 실패하면 잠시 후 다시 방문해 주세요.'));
    console.error(error);
  }
})();
