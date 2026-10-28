import {mulberry32} from './utils.js';
import {data} from './state.js';
import {today,isOverdue} from './calendar.js';

/* 任务字段约定（叶节点原子字段，物候态由此推导，杜绝矛盾组合）：
   planned 已排期 / progress 完成二值 0|1 / effort 投入度 0..1（驱动青柿→黄柿的连续物候）
   overdue 逾期 / abandoned 放弃 */





/* ================= 节点 id 分配器（单口，演示数据与后续变更共用） =================
   多端同步：每个客户端都从同一份存档续号会撞 id（两端各建一个任务分到同一个号，
   合并时被当成同一个任务而丢失）。浏览器每次启动随机一个 16bit 段：
   id = 段 × 2^37 + 段内序号，仍 ≤ 2^53（JSON 数值安全）。
   Node 单测不设段（salt=0），保持从 1 递增的原有行为。 */
const ID_BASE=137438953472;        /* 2^37 */
let _uid=1,_idSalt=0;             /* D1 已定：起始 1，避免 falsy 陷阱 */
export function setIdSalt(salt){
  const n=+salt|0;
  _idSalt=(n>0&&n<65536)?n:0;
  _uid=1;
}
export function allocId(){return _idSalt*ID_BASE+_uid++}
/* 持久化载入后回播既有 id，防重启后重新分配撞旧档（只回播本段） */
export function seedIds(id){
  if(id==null)return;
  const base=_idSalt*ID_BASE;
  if(id>=base&&id<base+ID_BASE){
    const seq=id-base+1;
    if(seq>_uid)_uid=seq;
  }
}
export function maxIdOf(root){var m=0;
  (function w(n){if(n.id>m)m=n.id;n.children.forEach(w)})(root);return m}

/* ================= 自底向上聚合：工时桶/完成率/告警态/物候键 =================
   任何数据变更后必须重跑（mutations.refresh 收口调用） */
export function derive(n,dayKey){
  dayKey=dayKey||today().d;
  const B={done:0,overdue:0,assigned:0,floating:0};
  if(n.leaf){
    n._stage=null;
    const ab=!!n.abandoned;
    const doneH=n.hours*(n.progress>=1?1:0);
    B.done+=doneH;
    /* 逾期按展示层派生（makeup||assignD < 今天）；overdue 标志仅作历史事实。
       放弃任务不计逾期（R16 四桶约束：不新增 abandoned 桶）。 */
    const over=!ab&&isOverdue(n,dayKey);
    if(over)B.overdue+=n.hours-doneH;
    else if(ab)B.assigned+=n.hours-doneH;
    else if(!n.assignD&&!n.assignW&&!n.assignM)B.floating+=n.hours-doneH;
    else B.assigned+=n.hours-doneH;
    n.H=n.hours;n.leafCount=1;n.redCount=over?1:0;
    n.bare=!ab&&!(n.progress>=1)&&!n.assignD&&!n.assignW;   /* 断梢：assignM 不影响（已定） */
    if(n.progress>=1&&!n.completedAt)n.completedAt=Date.now();   /* R28：完成时间戳 */
  }else{
    n.children.forEach(function(c){derive(c,dayKey)});
    n.H=n.children.reduce((s,c)=>s+c.H,0);
    for(const k in B)B[k]=n.children.reduce((s,c)=>s+c.buckets[k],0);
    n.leafCount=n.children.reduce((s,c)=>s+c.leafCount,0);
    n.redCount=n.children.reduce((s,c)=>s+c.redCount,0)}
  n.buckets=B;n.pct=n.H>0?B.done/n.H:0;          // 空枝（H=0）防护：NaN% → 0%
  n.agg=B.overdue>0?'overdue':B.floating>0?'floating':n.pct>=1?'done':'assigned';
}

/* ================= 全芽态树（真实使用起点：所有任务未排期） ================= */
export function makeBareTree(title,topics){
  const root={id:allocId(),title:title,depth:0,parent:null,children:[],lvl:'top'};
  // topics: [{name, subs:['子项1','子项2']}];
  for(const tp of topics||[]){
    const b={id:allocId(),title:tp.name,depth:1,parent:root,children:[],lvl:'top'};
    root.children.push(b);
    for(const sub of tp.subs||[]){
      const n2={id:allocId(),title:sub,depth:2,parent:b,children:[],lvl:'top'};
      b.children.push(n2);
      // 每个二级下 2-3 个叶任务（全部未排期芽态）
      const leafCount=2+Math.floor(Math.random()*2);
      for(let li=1;li<=leafCount;li++){
        n2.children.push({id:allocId(),title:sub+'·任务'+li,depth:3,
          parent:n2,children:[],leaf:true,
          progress:0,overdue:false,
          hours:2+Math.round(Math.random()*6),lvl:'top'});
      }
    }
  }
  derive(root);
  return {root,taskLevels:4};
}
/* ================= 主干树（只有主目标+顶层分支，全部顶级目标域） ================= */
export function makeTopTree(title,branches){  /* id 一律走全局 allocId（机制：单口分配） */
  const root={id:allocId(),title:title,depth:0,parent:null,children:[],lvl:'top'};
  for(const b of branches||[]){
    root.children.push({id:allocId(),title:b,depth:1,parent:root,children:[],leaf:true,
      progress:0,overdue:false,hours:2,lvl:'top'});
  }
  derive(root);
  return {root,taskLevels:2};
}
/* ================= 节点查找工具 ================= */
export function byTitle(t){let r;(function w(n){if(!r&&n.title===t)r=n;n.children.forEach(w)})(data.root);return r}
export function byId(id){let r;(function w(n){if(n.id===id)r=n;n.children.forEach(w)})(data.root);return r}
export function pathTo(n){const p=[];for(let x=n;x;x=x.parent)p.unshift(x);return p}
