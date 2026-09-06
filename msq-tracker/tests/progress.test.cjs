const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createTracker}=require('../progress.js');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../data.js'),'utf8'),context);
const data=JSON.parse(JSON.stringify(context.window.MSQ_DATA));
const tracker=createTracker(data);
const quest=name=>{const q=data.quests.find(q=>q.name===name);assert(q,`Missing fixture: ${name}`);return q;};
const cities=['gridania','limsa','uldah'];

test('official scope, metadata, categories and route totals are intact',()=>{
  assert.equal(data.sourceQuestCount,1042);
  assert.equal(data.quests.length,1037);
  assert.equal(new Set(data.quests.map(q=>q.id)).size,data.quests.length);
  assert.equal(data.groups.length,15);
  for(const q of data.quests){
    assert.match(q.id,/^[a-f0-9]{11}$/);
    assert(q.name.length>0&&!q.name.includes('<')&&!q.name.endsWith(' N'));
    assert(q.level>=1&&q.level<=100);
    assert(data.groups.find(g=>g.id===q.group&&g.expansion===q.expansion));
    assert(q.cities.length>0&&q.companies.length>0);
    for(const id of q.previous){const previous=tracker.byId.get(id);assert(previous);assert(previous.group<=q.group);}
  }
  assert.deepEqual(tracker.calculate(quest('인연을 따라서').id,'completed','gridania').overall.total,[987,987]);
  assert.deepEqual(tracker.calculate(quest('인연을 따라서').id,'completed','uldah').overall.total,[988,988]);
  assert.deepEqual(tracker.overview().map(e=>e.total),[[240,241],[138,138],[162,162],[157,157],[155,155],[135,135]]);
});

test('Korean partial, whitespace, initials and expansion-filter searches',()=>{
  const id=quest('이슈가르드를 향해서').id;
  assert.equal(tracker.search('이슈가르드를향해서')[0].id,id);
  assert(tracker.search('ㅇㅅㄱㄹㄷㄹㅎㅎㅅ').some(q=>q.id===id));
  assert(tracker.search('  이슈가르드를   향해서  ').some(q=>q.id===id));
  assert.equal(tracker.search('이슈가르드를 향해서','dt').length,0);
  assert(tracker.search('','dt').every(q=>q.expansion==='dt'));
  assert.equal(tracker.search('존재하지않는퀘스트123456').length,0);
  assert.equal(tracker.search('모험가를 위한 안내').length,3);
  assert.equal(tracker.search('인연을 따라서')[0].name,'인연을 따라서');
});

test('each starting city begins at 0; completion includes exactly the current quest',()=>{
  for(const city of cities){
    const q=data.quests.find(q=>q.name==='모험가를 위한 안내'&&q.cities.includes(city));
    const current=tracker.calculate(q.id,'current',city);
    const completed=tracker.calculate(q.id,'completed',city);
    assert.deepEqual(current.overall.done,[0,0]);
    assert.deepEqual(current.overall.percent,[0,0]);
    assert.deepEqual(completed.overall.done,[1,1]);
    assert.deepEqual(completed.expansion.done,[1,1]);
  }
});

test('new expansions begin at 0 and include the previous expansion patches',()=>{
  for(const name of ['이슈가르드를 향해서','장성을 넘어서','예감','이윽고 바다로 흘러가노니','미지의 모험으로']){
    const result=tracker.calculate(quest(name).id,'current','gridania');
    assert.deepEqual(result.expansion.done,[0,0],name);
    const index=data.expansions.findIndex(e=>e.id===result.selected.expansion);
    assert(result.journey.slice(0,index).every(e=>e.percent[0]===100&&e.percent[1]===100));
    assert(result.journey.slice(index+1).every(e=>e.percent[1]===0));
  }
  const end=tracker.calculate(quest('효월의 종언').id,'completed','gridania');
  assert.deepEqual(end.expansion.done,[108,108]);
  assert.deepEqual(end.expansion.remaining,[47,47]);
});

test('parallel quests show uncertainty and rejoin with exact counts',()=>{
  const branch=tracker.calculate(quest('원한 바위의 수수께끼').id,'current','gridania');
  assert(branch.hasParallel);
  assert.equal(branch.overall.done[1]-branch.overall.done[0],1);
  const longerBranch=tracker.calculate(quest('통신 방해하기').id,'current','gridania');
  assert.equal(longerBranch.overall.done[1]-longerBranch.overall.done[0],2);
  const joined=tracker.calculate(quest('죽은 자는 말한다').id,'current','gridania');
  assert(!joined.hasParallel);
  assert.equal(joined.overall.done[0],joined.overall.done[1]);
});

test('class and company alternatives never count as unfinished parallel branches',()=>{
  const first=tracker.calculate(quest('배넉 연병장으로').id,'current','gridania');
  assert.deepEqual(first.overall.done,[1,1]);
  const join=tracker.calculate(quest('푸른 잎의 마음').id,'current','gridania');
  assert(!join.hasParallel);
  assert.equal(join.overall.done[0],join.overall.done[1]);
  for(const name of ['숲의 의지가 함께하기를','바다가 모든 것을 삼킬 때까지','부와 나라를 위하여']){
    const result=tracker.calculate(quest(name).id,'completed','gridania');
    assert.deepEqual(result.overall.done,join.overall.done);
  }
});

test('latest quest is below 100 while current, exactly 100 when completed',()=>{
  for(const city of ['',...cities]){
    const q=quest('인연을 따라서');
    const current=tracker.calculate(q.id,'current',city);
    const completed=tracker.calculate(q.id,'completed',city);
    assert(current.overall.percent[1]<100);
    assert.deepEqual(current.overall.remaining,[1,1]);
    assert.deepEqual(completed.overall.percent,[100,100]);
    assert.deepEqual(completed.expansion.percent,[100,100]);
    assert.deepEqual(completed.overall.remaining,[0,0]);
  }
});

test('all available quests produce bounded, consistent progress on every valid city route',()=>{
  for(const q of data.quests)for(const city of q.cities){
    const before=tracker.calculate(q.id,'current',city),after=tracker.calculate(q.id,'completed',city);
    for(const key of ['overall','expansion']){
      const a=before[key],b=after[key];
      assert(a.done[0]<=a.done[1],q.name);
      assert(a.percent[0]>=0&&a.percent[1]<100,q.name);
      assert(b.percent[0]>=0&&b.percent[1]<=100,q.name);
      assert.equal(b.done[0],a.done[0]+1,q.name);
      assert.equal(b.done[1],a.done[1]+1,q.name);
      assert.equal(b.remaining[0],a.remaining[0]-1,q.name);
      assert.equal(b.remaining[1],a.remaining[1]-1,q.name);
    }
  }
});

test('invalid quest, status and incompatible city are rejected',()=>{
  assert.throws(()=>tracker.calculate('invalid'));
  assert.throws(()=>tracker.calculate(quest('푸른 잎의 마음').id,'invalid'));
  assert.throws(()=>tracker.calculate(quest('배넉 연병장으로').id,'current','uldah'));
});

test('static assets and app element references resolve without a build step',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  for(const [,id] of app.matchAll(/\$\('([^']+)'\)/g))assert(ids.includes(id),id);
  for(const [,url] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
    if(/^https?:/.test(url))continue;
    assert(fs.existsSync(path.resolve(root,url.split('?')[0])),url);
  }
  for(const filename of ['data.js','progress.js','app.js'])new vm.Script(fs.readFileSync(path.join(root,filename),'utf8'));
});
