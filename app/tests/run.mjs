/* 纯逻辑单测（7号 §D：〔自〕断言全部进单测）
   只测零 DOM/零 three 的模块：data / persistence / slots / calendar。 */
import {derive,makeTopTree,makeBareTree,allocId,seedIds,maxIdOf} from '../src/data.js';
import * as P from '../src/persistence.js';
import {allocateTreeSlot,slotOf,releaseTreeSlot,TREE_CAP,crownScaleOf,islandRadiusOf} from '../src/slots.js';
import {weekKeyOf,monthOf,dayCapOf,weekDays} from '../src/calendar.js';
import {fallenFruits,leafPile} from '../src/queries.js';
import {snapNode,reviveNode} from '../src/rules.js';
import {undo,redo,updateTask,updateTemp,addSubtask} from '../src/mutations.js';
import {data} from '../src/state.js';

let n=0,f=0;
function t(name,fn){try{fn();n++;console.log('  ✓ '+name)}
  catch(e){f++;console.error('  ✗ '+name+'\n    '+e.message)}}
function eq(a,b,msg){if(JSON.stringify(a)!==JSON.stringify(b))
  throw new Error((msg||'')+' 期望 '+JSON.stringify(b)+' 实得 '+JSON.stringify(a))}

console.log('[data] id 单口分配（机制 A）');
t('makeTopTree 两次调用 id 不重叠',()=>{
  const a=makeTopTree('A',['x']),b=makeTopTree('B',['y']);
  const ids=[...wa(a.root),...wa(b.root)];
  eq(new Set(ids).size,ids.length);
  function wa(r,o=[]){o.push(r.id);r.children.forEach(c=>wa(c,o));return o}
});
t('makeBareTree 同样全局唯一',()=>{
  const a=makeBareTree('A',[{name:'n',subs:['s']}]),b=makeBareTree('B',[]);
  const ids=[...wa(a.root),...wa(b.root)];
  eq(new Set(ids).size,ids.length);
  function wa(r,o=[]){o.push(r.id);r.children.forEach(c=>wa(c,o));return o}
});
t('seedIds 回播后不回退',()=>{
  seedIds(999);eq(allocId(),1000);seedIds(5);eq(allocId(),1001);
});

console.log('[data] derive（bare/桶/进度）');
t('bare=未排期未完成；排期/完成翻转',()=>{
  const r=makeTopTree('g',['a','b']).root;
  derive(r);
  eq(r.children[0].bare,true);
  r.children[0].assignW='2026-W42';derive(r);
  eq(r.children[0].bare,false);
  r.children[1].progress=1;derive(r);
  eq(r.pct,.5);
});
t('无 abandoned 桶（6号 §C 四桶）',()=>{
  const r=makeTopTree('g',['a']).root;r.children[0].abandoned=true;derive(r);
  eq(r.buckets.abandoned,undefined);
});

console.log('[persistence] 序列化/回环（派生不入档 G5）');
t('roundtrip 保原子字段、丢派生',()=>{
  const r=makeTopTree('g',['a']).root;
  r.children[0].assignD='2026-10-12';r.children[0].progress=1;
  r.children[0].order=3;r.children[0].checklist=[{t:'x',done:true}];
  r._rec={x:1};r.pos={x:1};
  const p=P.serializeTree(r);
  const back=P.deserializeTree(JSON.parse(JSON.stringify(p)));
  eq(back.children[0].assignD,'2026-10-12');
  eq(back.children[0].checklist[0].t,'x');eq(back.children[0].checklist[0].done,true);
  eq(back._rec,undefined);eq(back.pos,undefined);
  derive(back);eq(back.pct,1);
});
t('serializeWorld 结构=schema v2（domains/trees/island/active id/exec）',()=>{
  const doc=P.serializeWorld({domains:[{id:1,name:'d',color:2}],
    trees:[P.serializeTree(makeTopTree('t',[]))],
    island:{treeSlots:[{x:0,z:0,h:1,r:2,treeId:5}]},
    active:{domainId:1,treeId:5},temps:[],caps:null,orchard:[],
    exec:{items:[{nodeId:5,startedAt:1,decomposed:false,page:0}],collapsed:false}});
  eq(doc.schema,2);
  eq(Object.keys(doc).sort().join(','),['active','caps','domains','exec','island','orchard','savedAt','schema','temps','trees'].sort().join(','));
  eq(doc.exec.items[0].nodeId,5);              /* 05.6 v12：执行区状态入档透传 */
  eq(P.serializeWorld({}).exec,null);          /* 旧档无 exec → null 空默认 */
});

console.log('[slots] 坑位（墓碑制 R37/上限 R39）');
t('上限封顶 + 墓碑复用 + 活树不移动',()=>{
  const isl={treeSlots:[],trees:new Array(0)};
  const ids=[];
  for(let i=0;i<TREE_CAP;i++){const s=allocateTreeSlot(isl);s.treeId=100+i;ids.push(s)}
  eq(allocateTreeSlot(isl),null);
  const keep=ids.map(s=>({x:s.x,z:s.z}));
  releaseTreeSlot(isl,{id:100});
  const s2=allocateTreeSlot(isl);
  eq(s2.treeId,null);                       /* 复用墓碑坑 */
  isl.treeSlots.forEach((s,i)=>{if(i>0)eq({x:s.x,z:s.z},keep[i],'坑位不动')});
});
t('crownScale 单调不增且封底 0.5',()=>{
  let last=1.2;
  for(let i=1;i<=20;i++){const s=crownScaleOf(i);if(s>last+.0001)throw new Error('monotonic');last=s}
  eq(crownScaleOf(99),.5);
});

console.log('[calendar] 周期键（周三锚点 · 周日始 R21/R32）');
t('weekKeyOf=该周周三；周日为周首日',()=>{
  eq(weekKeyOf(new Date('2026/10/11')),'2026-10-14');   /* 周日 → 本周三 */
  eq(weekKeyOf(new Date('2026/10/12')),'2026-10-14');   /* 周一 → 同周三 */
  eq(weekKeyOf(new Date('2026/10/17')),'2026-10-14');   /* 周六 → 同周三（周六收周） */
  eq(weekKeyOf(new Date('2026/10/18')),'2026-10-21');   /* 下周日 → 下周三 */
  eq(monthOf('2026-10-14'),'2026-10');
});
t('weekDays 周日起至周六止（R21 本周口径）',()=>{
  const ds=weekDays('2026-10-14');
  eq(ds[0],'2026-10-11');
  eq(ds[6],'2026-10-17');
  eq(ds.length,7);
});
t('dayCapOf 工作日/周末分桶',()=>{
  const caps={day:6,weekend:4};
  eq(dayCapOf(caps,'2026-10-12'),6);   /* 周一 */
  eq(dayCapOf(caps,'2026-10-18'),4);   /* 周日 */
});

console.log('[mutations] undo/redo（G2：undo 到底=字节级还原）');
t('updateTask 可撤销且字节级还原',()=>{
  const r=makeTopTree('g',['a','b']).root;
  data.root=r;
  const before=JSON.stringify(P.serializeTree(r));
  updateTask(r.children[0],{progress:1});
  if(r.children[0].progress!==1)throw new Error('未生效');
  while(undo());
  const after=JSON.stringify(P.serializeTree(r));
  eq(after,before,'undo 到底');
});
t('undo 后 redo 恢复',()=>{
  const r=makeTopTree('g2',['a']).root;
  data.root=r;
  updateTask(r.children[0],{progress:1});
  while(undo());
  if(redo()&&r.children[0].progress!==1)throw new Error('redo 未恢复');
});
t('结构变更（addSubtask）可撤销',()=>{
  const r=makeTopTree('g3',['a']).root;
  data.root=r;
  const before=JSON.stringify(P.serializeTree(r));
  addSubtask(r.children[0],{title:'sub'});
  if(r.children[0].children.length!==1)throw new Error('未加');
  while(undo());
  eq(JSON.stringify(P.serializeTree(r)),before,'结构还原');
});

console.log('[性能] 存档体积基准（N5）');
t('单树序列化 ≤8KB',()=>{
  const r=makeBareTree('大量任务',[{name:'A',subs:['a1','a2','a3']},{name:'B',subs:['b1','b2']}]).root;
  derive(r);
  const json=JSON.stringify(P.serializeTree(r));
  if(json.length>8192)throw new Error(json.length+' bytes > 8KB');
});
t('id 起始=1（D1 falsy 防护）',()=>{
  seedIds(0);                            /* 重置 */
  const first=allocId();
  if(first===0)throw new Error('id 从 0 开始（falsy 陷阱）');
  if(!first)throw new Error('id 为 falsy');
});
t('completedAt 在完成时写入',()=>{
  const r=makeTopTree('g',['a']).root;
  derive(r);
  if(r.children[0].completedAt)throw new Error('未完成就有时间戳');
  r.children[0].progress=1;derive(r);
  if(!r.children[0].completedAt)throw new Error('完成后无时间戳');
});
t('updateTask 完成盖戳 / 撤回清戳（R28 写入链）',()=>{
  const r=makeTopTree('g',['a']).root;
  data.root=r;
  updateTask(r.children[0],{progress:1});
  if(!r.children[0].completedAt)throw new Error('完成未盖戳');
  updateTask(r.children[0],{progress:0});
  if(r.children[0].completedAt)throw new Error('撤回未清戳');
});
t('updateTemp 完成盖戳 + order/completedAt 序列化往返',()=>{
  data.temps=[{id:9001,title:'t',hours:2,lvl:'temp',assignD:'2026-10-12',progress:0,order:2}];
  updateTemp(9001,{progress:1});
  if(!data.temps[0].completedAt)throw new Error('temp 完成未盖戳');
  const back=P.reviveTemp(JSON.parse(JSON.stringify(P.serializeTemp(data.temps[0]))));
  eq(back.order,2);
  if(!back.completedAt)throw new Error('completedAt 未入档');
  data.temps=[];
});
t('undo 快照保 checklist={t,done}（《6》§B 契约）',()=>{
  const r=makeTopTree('g',['a']).root;
  r.children[0].checklist=[{t:'x',done:true}];
  const back=reviveNode(snapNode(r));
  eq(back.children[0].checklist,[{t:'x',done:true}]);
});
console.log('[queries] R21 判定（落果/落叶堆；今日=2026-10-12 周一，本周=10-11~10-17）');
t('fallenFruits/leafPile：本周超时含 temp；过期补点在本周=落果、在周前=落叶堆',()=>{
  const r=makeTopTree('g',['A','B','C','D','E','F']).root;
  const L=r.children;
  L[0].assignD='2026-10-11';                                  /* 本周·昨天·未完成 → 落果 */
  L[1].assignD='2026-10-13';                                  /* 本周·明天 → 挂枝 */
  L[2].assignD='2026-10-10';                                  /* 上周 → 落叶堆 */
  L[3].assignD='2026-10-10';L[3].makeup='2026-10-15';         /* 有效补点 → 挂枝带补 */
  L[4].assignD='2026-10-10';L[4].makeup='2026-10-11';         /* 补点过期于本周 → 落果 */
  L[5].assignD='2026-10-11';L[5].progress=1;                  /* 已完成 → 不落 */
  const temps=[{id:9001,assignD:'2026-10-12',progress:0},
               {id:9002,assignD:'2026-10-11',progress:0},
               {id:9003,assignD:'2026-10-02',progress:0}];
  const fall=fallenFruits([r],temps,'2026-10-14','2026-10-12');
  eq(fall.map(x=>x.id).sort((a,b)=>a-b),[L[0].id,L[4].id,9002].sort((a,b)=>a-b));
  const pile=leafPile([r],temps,'2026-10-11','2026-10-12');
  eq(pile.map(x=>x.id).sort((a,b)=>a-b),[L[2].id,9003].sort((a,b)=>a-b));
});
t('bare 不受 assignM 影响',()=>{
  const r=makeTopTree('g',['a']).root;
  r.children[0].assignM='2026-10';derive(r);
  if(!r.children[0].bare)throw new Error('落月后 bare=false（应仍为 true）');
});

console.log('────────────────────────');
console.log(`Pass ${n} / Fail ${f}`);
process.exit(f?1:0);
