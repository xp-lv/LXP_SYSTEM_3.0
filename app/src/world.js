import THREE from './three.js';
import {scene} from './scene.js';
import {state,data} from './state.js';
import {clamp} from './utils.js';
import {makeTopTree,allocId,seedIds,maxIdOf,derive} from './data.js';
import {rebuild,treeHeightOf} from './tree.js';
import {setCamHome,sphGoal,tgtGoal} from './camera.js';
import {renderCrumb} from './ui.js';
import {allocateTreeSlot,slotOf,releaseTreeSlot,TREE_CAP,crownScaleOf,islandRadiusOf} from './slots.js';
import {buildIslandMesh,getTreeWorldPos} from './island.js';
import {setTreeResolver,touch} from './mutations.js';
import {treeLeaves} from './queries.js';
import * as persist from './persistence.js';
import {setEnvFocus} from './demo/env.js';
import {notify} from './notify.js';

/* ================= 世界管理（world.js）——单岛 + 领域=数据分组 =================
   redesign《0/1》岛屿模块：一座岛承载所有树；领域只作数据分组（选择框/规划页可见，
   世界不呈现任何领域元素）。激活两级（领域→树），id 引用，回退链=A7。 */

let domains=[];            /* [{id,name,color}] */
let trees=[];              /* 任务树根（root.domainId 归属领域） */
let island=null;           /* {id,treeSlots[],group,_dH,boundingBox} 唯一世界岛 */
let activeDomainId=null,activeTreeId=null;
var treeChangedHook=null;
export function onTreeChanged(fn){treeChangedHook=fn}
function fireTreeChanged(){try{if(treeChangedHook)treeChangedHook()}catch(e){}}
/* 机制 B：世界状态单口提交——持久化 + 联动 + （可选）反馈，一站完成。
   任何 world 内变更结尾必须走 commit()，禁止散落 touch 调用。 */
function commit(feedback){
  touch();                                          /* → store 'data' → 归档判定 + writeDoc（main 装配） */
  fireTreeChanged();
  if(feedback)notify.toast(feedback);
}

/* —— 兼容视图：把领域呈现为"伪岛"对象（name/color/trees），规划三页沿用旧接口 —— */
function pseudo(d){
  return{id:d.id,name:d.name,color:d.color,trees:trees.filter(t=>t.domainId===d.id)};
}
export function getIslands(){return domains.map(pseudo)}
export function getActiveIsland(){
  const d=domains.find(x=>x.id===activeDomainId)||domains[0];
  return d?pseudo(d):null;
}
export function getDomains(){return domains}
export function getTrees(){return trees}
export function getWorldIsland(){return island}
export function getActiveTree(){return trees.find(t=>t.id===activeTreeId)||null}
export function canPlant(){return trees.length<TREE_CAP}

/* ================= 初始化 ================= */
export function initWorld(){
  island=_newIsland();
  const rd=persist.readDoc();
  if(rd.notice)notify.banner(rd.notice);            /* 机制 C：存储通知单出口 */
  if(rd.doc){
    importDoc(rd.doc);
    return;
  }
  _seedDefault();
}
function _newIsland(){
  return{id:20260924,treeSlots:[],group:null,_dH:null,boundingBox:null,color:0x86b45e,
    get trees(){return trees}};
}

/* 富演示种子（对照 v2 验证台“英语650”混合形态：主线+丛生+日梢扇+金团+断茬） */
function makeRichDemoTree(){
  const N=(title,depth,parent,extra)=>Object.assign({id:allocId(),title,depth,
    parent:parent||null,children:[],lvl:'top'},extra||{});
  const leaf=(title,depth,parent,hours,st)=>N(title,depth,parent,
    Object.assign({leaf:true,hours:hours||2,planned:false,progress:0,effort:0,
      overdue:false,abandoned:false},st||{}));
  const root=N('示例目标 · 英语650',0,null,{});
  const vocab=N('词汇',1,root);
  const book=N('核心词书',2,vocab);
  book.children.push(leaf('U1 语法',3,book,2,{planned:true,progress:1,effort:1}));
  book.children.push(leaf('U2 词汇',3,book,2,{planned:true}));
  book.children.push(leaf('U3 阅读',3,book,2,{}));
  vocab.children.push(book);
  const read=N('阅读',1,root);
  const paper=N('真题阅读',2,read);
  const bank=N('题库月',3,paper);
  const wA=N('题库周A',4,bank);
  wA.children.push(leaf('精读T1',5,wA,2,{planned:true}));
  wA.children.push(leaf('精读T2',5,wA,2,{planned:true,progress:1,effort:1}));
  bank.children.push(wA);
  bank.children.push(leaf('题库周B',4,bank,2,{}));
  paper.children.push(bank);
  read.children.push(paper);
  const listen=leaf('听力',1,root,3,{});
  const write=N('写作',1,root);
  const wm=N('写作月',2,write);
  wm.children.push(leaf('框架课',3,wm,2,{planned:true,progress:1,effort:1}));
  wm.children.push(leaf('段落练习',3,wm,2,{planned:true,progress:1,effort:1}));
  wm.children.push(leaf('批改复盘',3,wm,1,{planned:true,progress:1,effort:1}));
  write.children.push(wm);
  write.children.push(leaf('仿写月',2,write,2,{}));
  const speak=N('口语',1,root);
  const sw=N('口语周',2,speak);
  sw.children.push(leaf('跟读',3,sw,1,{}));
  sw.children.push(leaf('模考问答',3,sw,1,{planned:true}));
  speak.children.push(sw);
  root.children.push(vocab,read,listen,write,speak);
  derive(root);
  return {root,taskLevels:5};
}

function _seedDefault(){
  /* 首启种子：一个领域 + 一棵示例目标（顶层三枝，全断梢） */
  const d={id:allocId(),name:'默认领域',color:0x4C9EFF};
  domains=[d];
  const root=makeRichDemoTree().root;
  root.domainId=d.id;
  trees=[root];
  data.temps=[];data.caps={day:6,weekend:0};data.orchard=[];
  data.exec={items:[],collapsed:false};
  activeDomainId=d.id;activeTreeId=root.id;
  _finishInit();
}
/* 应用一份完整存档（导入备份 / 启动载入共用） */
export function importDoc(doc){
  domains=doc.domains.slice();
  trees=doc.trees.slice();
  island.treeSlots=doc.island.treeSlots.slice();
  activeDomainId=doc.active&&doc.active.domainId;
  activeTreeId=doc.active&&doc.active.treeId;
  data.temps=doc.temps||[];
  data.caps=doc.caps||{day:6,weekend:0};
  data.orchard=doc.orchard||[];
  data.exec=(doc.exec&&Array.isArray(doc.exec.items))?doc.exec:{items:[],collapsed:false};
  var mx=0;trees.forEach(t=>{var m2=maxIdOf(t);if(m2>mx)mx=m2});
  domains.forEach(d=>{if(d.id>mx)mx=d.id});   /* 领域 ID 也入种子——防新领域分配重复 ID */
  (data.temps||[]).forEach(t=>{if(t.id>mx)mx=t.id});  /* 临时任务 ID 同理 */
  seedIds(mx);
  _finishInit();
}
function _finishInit(){
  setTreeResolver(function(tree){return trees.indexOf(tree)>=0});
  setCamHome(_frameIsland);                        /* 回正=岛全景（W11） */
  trees.forEach(function(t){                       /* 补分配：无坑树先落位 */
    if(!slotOf(island,t)){
      const s=allocateTreeSlot(island);
      if(s)s.treeId=t.id;
    }
  });
  buildIslandMesh(island);
  if(!domains.find(x=>x.id===activeDomainId))activeDomainId=domains[0].id;
  if(!trees.find(t=>t.id===activeTreeId&&t.domainId===activeDomainId)){
    const first=trees.find(t=>t.domainId===activeDomainId);
    activeTreeId=first?first.id:null;
  }
  _activate(true);
  fireTreeChanged();
}
/* 删除空领域（仅当无树；至少保留一个） */
export function deleteDomainAt(idx){
  const d=domains[idx];
  if(!d)return false;
  if(trees.some(t=>t.domainId===d.id))return false;
  if(domains.length<=1)return false;
  domains.splice(idx,1);
  if(activeDomainId===d.id){
    activeDomainId=domains[0].id;
    const first=trees.find(t=>t.domainId===activeDomainId);
    activeTreeId=first?first.id:null;
  }
  _activate(true);
  commit('已删除空领域「'+d.name+'」');
  return true;
}

/* 激活核心：两级激活 → data.root → layout → rebuild → 环境聚焦 */
function _activate(skipFly){
  const t=getActiveTree();
  data.root=t||null;
  data.taskLevels=4;
  rebuild();
  try{
    const bb=island.boundingBox||{cx:0,cz:0};
    setEnvFocus(bb.cx,120,bb.cz,(island._R||islandRadiusOf(island))*1.25);
  }catch(e){}
  renderCrumb();
}
export function activateIsland(idx,skipFly){
  if(idx<0||idx>=domains.length)return;
  activeDomainId=domains[idx].id;
  const first=trees.find(t=>t.domainId===activeDomainId);
  activeTreeId=first?first.id:null;
  _activate(skipFly);
  if(!skipFly)flyToActive();
  commit();                                        /* 激活也入档（机制 B） */
}
export function activateTree(idx,skipFly){
  const list=trees.filter(t=>t.domainId===activeDomainId);
  if(idx<0||idx>=list.length)return;
  activeTreeId=list[idx].id;
  _activate(skipFly);
  if(!skipFly)flyToActive();
  commit();
}
export function activateTreeByRef(tree){
  const i=trees.indexOf(tree);
  if(i<0)return false;
  activeTreeId=tree.id;
  activeDomainId=tree.domainId;
  _activate(true);
  flyToActive();
  commit();
  return true;
}
export function resolveActive(){
  let t=getActiveTree();
  if(!t||t.domainId!==activeDomainId){
    const first=trees.find(x=>x.domainId===activeDomainId);
    if(first)activeTreeId=first.id;
    else{
      activeTreeId=trees.length?trees[0].id:null;
      if(activeTreeId!=null)activeDomainId=trees[0].domainId;
    }
  }
  if(!domains.find(x=>x.id===activeDomainId))activeDomainId=domains[0].id;
  _activate(true);
}
export function flyToActive(){                    /* W4：聚焦激活树（非全岛） */
  const t=getActiveTree();
  if(t){
    const slot=slotOf(island,t);
    if(slot){
      const wp=getTreeWorldPos(island,slot);
      const H=treeHeightOf();
      tgtGoal.set(wp.x,wp.y+H*.5,wp.z);
      sphGoal.r=clamp(H*2.1,240,900);sphGoal.p=.95;
      return;
    }
  }
  _frameIsland();
}
function _frameIsland(){                           /* 岛全景取景（回正/兜底） */
  const bb=island.boundingBox||{cx:0,cz:0};
  const R=island._R||islandRadiusOf(island);
  const body=island._body;
  const front=body&&body.front;
  const mini=body&&body.mini;
  /* 世界正面 = 正对主岛瀑布的方向；同时把右下方卫星岛收进画面 */
  const fx=front?front.x:0, fz=front?front.z:0;
  const mx=mini?mini.center.x:0, mz=mini?mini.center.z:0;
  tgtGoal.set((fx+mx)*0.5,80,(fz+mz)*0.5);
  sphGoal.r=clamp(R*2.7,900,3400);
  sphGoal.p=.85;
  sphGoal.t=0;
}

/* ================= 种植 / 移除 / 归档 ================= */
export function plantTree(isleLike,title){
  if(!canPlant())return null;
  const d=domains.find(x=>x.id===(isleLike&&isleLike.id));
  if(!d)return null;
  const root=makeTopTree(title||'新目标',[]).root;
  root.domainId=d.id;
  const slot=allocateTreeSlot(island);
  if(!slot)return null;
  slot.treeId=root.id;
  trees.push(root);
  buildIslandMesh(island);
  activeDomainId=d.id;activeTreeId=root.id;
  _activate(true);flyToActive();
  commit('已种下「'+root.title+'」');
  return root;
}
export function removeTree(tree){
  const i=trees.indexOf(tree);
  if(i<0)return false;
  releaseTreeSlot(island,tree);
  trees.splice(i,1);
  buildIslandMesh(island);
  resolveActive();
  commit('已删除「'+tree.title+'」');
  return true;
}
/* 自动归档（A3/R30）：整树完成 → 记录入 orchard（呈现去处 ⚖️），树离场 */
export function autoArchive(){
  const acts=[];
  trees.slice().forEach(function(t){
    const ls=treeLeaves(t);
    if(!ls.length)return;
    const done=ls.every(l=>l.progress>=1);
    const justDone=done&&!t._wasDone;
    t._wasDone=done;
    if(justDone){
      data.orchard=data.orchard||[];
      data.orchard.push({id:t.id,title:t.title,domainId:t.domainId,
        archivedAt:Date.now(),tree:persist.serializeTree(t)});
      releaseTreeSlot(island,t);
      trees.splice(trees.indexOf(t),1);
      buildIslandMesh(island);
      acts.push(t.title);
    }
  });
  if(acts.length){
    resolveActive();
    commit('🎉 「'+acts.join('」「')+'」全部完成 · 已归档离场（A3）');   /* 机制 B：归档有反馈（#15） */
  }
  return acts;
}
/* ================= 领域（纯数据分组） ================= */
export function addDomain(name,color){
  const d={id:allocId(),name:name||('领域'+(domains.length+1)),color:color||0x8B96F8};
  domains.push(d);
  commit('已创建领域「'+d.name+'」');
  return d;
}
export function renameDomain(d,name){if(d)d.name=name||d.name;commit('领域已改名')}

/* ================= 树色变体（周/今日分组可区分） ================= */
var colorCache=new Map();
export function treeColorOf(tree){
  if(colorCache.has(tree))return colorCache.get(tree);
  var out='#64748b';
  const d=domains.find(x=>x.id===tree.domainId);
  if(d){
    const idx=trees.filter(t=>t.domainId===d.id).indexOf(tree);
    const base=new THREE.Color(d.color);
    if(idx>0)base.offsetHSL((idx%3)*0.045,0.02,((idx+1)>>1)*0.09);
    out='#'+base.getHexString();
  }
  colorCache.set(tree,out);
  return out;
}
export function treeIndexOf(tree){
  for(const d of domains){
    const idx=trees.filter(t=>t.domainId===d.id).indexOf(tree);
    if(idx>=0)return{isle:pseudo(d),idx};
  }
  return null;
}
export {TREE_CAP,islandRadiusOf,getTreeWorldPos,slotOf,crownScaleOf};

/* ================= 存档导出（main 持久化用） ================= */
export function exportDoc(){
  return{domains:domains.map(d=>({id:d.id,name:d.name,color:d.color})),
    trees:trees.map(t=>persist.serializeTree(t)),
    island:{treeSlots:island.treeSlots.map(s=>({x:s.x,z:s.z,h:s.h,r:s.r,treeId:s.treeId}))},
    active:{domainId:activeDomainId,treeId:activeTreeId},
    temps:data.temps,caps:data.caps,orchard:data.orchard||[],exec:data.exec};
}
