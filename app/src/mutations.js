import {data} from './state.js';
import {derive,allocId} from './data.js';
import {store} from './store.js';


import {weekKeyOf} from './calendar.js';
let renderHook=null;
/* 渲染经注册回调（07.3：变更服务不直连渲染模块）；main 装配时注入 rebuild */
export function onRender(fn){renderHook=fn}
function render(){try{renderHook&&renderHook()}catch(e){console.warn('[mutations] render',e)}}
/* world 依赖惰性化：undo 回放的切树仅浏览器运行期需要（node 单测无 three） */
var _world=null;function worldLazy(){if(!_world)try{_world=worldRef()}catch(e){}return _world}
var worldRef=function(){return null};
export function setWorldRef(fn){worldRef=fn}

/* ================= 任务树变更服务（唯一收口） =================
   任何数据修改必须经由此模块：变更 → derive 重算聚合 → layout 重排 → rebuild 重建场景。
   这样 buckets/pct/agg/pos/标签/物候/统计条永远一致，未来加撤销栈/持久化也只动这里。

   节点字段约定见 data.js 顶部注释：leaf 节点持 planned/progress/overdue/abandoned，
   中间节点全部派生（H/buckets/pct/agg/leafCount/redCount）。 */

/* ================= 规则引擎（纯函数从 rules.js 导入） ================= */
import {assertInvariant,snapNode,reviveNode,createUndoStack} from './rules.js';
export {assertInvariant};

const undoStack=createUndoStack(50);
/* 树作用域解析器：world 在启动时注册，用于校验快照所属树仍种植在世界中
   （多树 undo 硬约束——跨树快照不得覆写他树，见功能说明 §3.7） */
var treeResolver=null;
export function setTreeResolver(fn){treeResolver=fn}
function tempsClone(){return JSON.parse(JSON.stringify(data.temps||[]))}
/* 虚拟根判定：今日页用 _virtual，周规划页用 _virtualRoot——两者都不是真树，
   快照不得带树（否则 treeResolver 判废、temp 增删无法撤销） */
function isVirtualRoot(){
  return !!(data.root&&(data.root._virtual||data.root._virtualRoot));
}
function pushUndo(){
  if(!data.root)return;
  if(isVirtualRoot()){
    undoStack.push({tree:null,snap:null,temps:tempsClone()});return}
  undoStack.push({tree:data.root,snap:snapNode(data.root),temps:tempsClone()});
}
/* 显式快照入口：组合操作（如换月=删子树+落月）在改动前调一次，避免双份快照 */
export function snapshot(){pushUndo()}
function applySnap(entry){
  if(!entry)return false;
  if(entry.tree){
    if(treeResolver&&!treeResolver(entry.tree))return false;  // 树已不在世界中：快照作废
    if(entry.tree!==data.root){
      const sw=worldLazy()&&worldLazy().activateTreeByRef;   /* 回放自动切回所属树 */
      if(sw)sw(entry.tree);
    }
    const revived=reviveNode(entry.snap);
    const root=entry.tree;
    // 复制原子字段到现有 root 对象（保留引用，3D 模块仍指向它）
    ['id','title','leaf','hours','lvl','planned','progress','overdue','completedAt',
     'assignM','assignW','assignD','makeup','order','checklist'].forEach(k=>root[k]=revived[k]);
    root.children=revived.children;
    // 重建 depth 与 parent（快照不含派生字段）
    (function fixDepth(n,d){
      n.depth=d;
      n.children.forEach(c=>{c.parent=n;fixDepth(c,d+1)});
    })(root,0);
  }
  if(entry.temps!==undefined)data.temps=JSON.parse(JSON.stringify(entry.temps));
  return true;
}
export function undo(){
  if(!undoStack.canUndo||!data.root)return false;
  const vir=isVirtualRoot();
  const current={tree:vir?null:data.root,snap:vir?null:snapNode(data.root),temps:tempsClone()};
  let prev=undoStack.undo(current);
  while(prev&&!applySnap(prev))prev=undoStack.undo(current);   // 跳过已作废快照
  if(prev){refresh();return true}
  return false;
}
export function redo(){
  if(!undoStack.canRedo||!data.root)return false;
  const vir=isVirtualRoot();
  const current={tree:vir?null:data.root,snap:vir?null:snapNode(data.root),temps:tempsClone()};
  let next=undoStack.redo(current);
  while(next&&!applySnap(next))next=undoStack.redo(current);
  if(next){refresh();return true}
  return false;
}

/* 临时任务写口（G1：此前 today 直改字段绕过本模块） */
export function updateTemp(id,patch){
  const t=(data.temps||[]).find(function(x){return x.id===id});
  if(!t)return null;
  Object.assign(t,patch||{});
  if(t.progress!==undefined){
    t.progress=t.progress>=1?1:0;
    if(t.progress===1){if(!t.completedAt)t.completedAt=Date.now()}   /* R28：完成盖戳 */
    else t.completedAt=null;                                        /* 撤回清戳（防旧戳误判） */
  }
  touch();
  return t;
}
/* 临时任务增删（交互优化：入 undo 栈 R34——此前直接 push/splice 不可撤销） */
export function addTemp(fields){
  pushUndo();
  data.temps=data.temps||[];
  const f=fields||{};
  const t={id:allocId(),title:f.title||'临时任务',hours:+f.hours||0,lvl:'temp',
    assignD:f.assignD||null,assignW:f.assignW||null,progress:0,
    order:f.order!=null?f.order:null};
  data.temps.push(t);
  touch();
  return t;
}
export function removeTemp(id){
  const i=(data.temps||[]).findIndex(function(t){return t.id===id});
  if(i<0)return false;
  pushUndo();
  data.temps.splice(i,1);
  touch();
  return true;
}
export function refresh(){
  /* 今日页 data.root 是虚拟周树——真树必须同时派生，
     否则 completedAt/桶/pct 停更（R28 撤回判定失效的根因） */
  const w=worldLazy();
  if(w&&w.getTrees)w.getTrees().forEach(function(t){if(t!==data.root)derive(t)});
  if(!data.root){render();touch();return}    /* 空树引导态：无数据可派生 */
  derive(data.root);
  render();
  touch();
}
/* 数据变更广播（分配类原语不重建，也走这里）；
   持久化由 main.js 的 store.on('data') 订阅者执行——mutations 不依赖 world */
export function touch(){
  store.emit('data',data.root);
}

/* 在 parent 下新增子任务（叶子）。
   fields: {title, hours, planned, progress, overdue, abandoned}
   若 parent 原是叶子，会自动升级为容器节点（其自身进度字段退役，聚合改由子节点决定）。 */
export function addSubtask(parent,fields){
  if(!parent)throw new Error('addSubtask: 缺少父节点');
  if(parent.parent===null&&parent!==data.root)throw new Error('addSubtask: 非法父节点');
  const f=fields||{};
  pushUndo();
  assertInvariant(parent,{lvl:f.lvl||parent.lvl||'top'});
  const node={
    id:allocId(),
    title:f.title||('新任务'+(parent.children.length+1)),
    depth:parent.depth+1,
    parent,
    children:[],
    leaf:true,
    progress:f.progress>=1?1:0,
    hours:Math.max(0.5,+f.hours||2),
    overdue:!!f.overdue,
    lvl:f.lvl||parent.lvl||'top'                   // 级别标签：top/month/week
  };
  if(parent.leaf){                       // 叶 → 容器：退役自身物候字段
    parent.leaf=false;
    delete parent.ph;
  }
  parent.children.push(node);
  refresh();
  return node;
}

/* 新增顶级目标分支（挂在根下） */
export function addTopBranch(fields){
  return addSubtask(data.root,fields);
}

/* 修改叶节点任务字段（排期/进度/逾期/放弃），随后统一刷新派生数据 */
export function updateTask(node,patch){
  if(!node||!node.leaf)throw new Error('updateTask: 仅叶节点可直接修改');
  pushUndo();
  assertInvariant(node,patch);
  Object.assign(node,patch||{});
  if(node.progress!==undefined){
    node.progress=node.progress>=1?1:0;
    if(node.progress===1){if(!node.completedAt)node.completedAt=Date.now()}   /* R28：完成盖戳 */
    else node.completedAt=null;                                             /* 撤回清戳（防旧戳误判） */
  }
  refresh();
  return node;
}

/* 任意节点改名（规划页双击重命名） */
export function renameNode(node,title){
  if(!node||!title)return;
  pushUndo();
  node.title=title;
  refresh();
}

/* 批量标记逾期（今日页进入时推导：落日已过且未完成） */
export function bulkOverdue(nodes){
  if(!nodes||!nodes.length)return;
  nodes.forEach(function(n){n.overdue=true});
  refresh();
}

/* 同级排序：只移动 node 在 parent.children 中的位置，不改父级/层级/分配。
   before=null 表示移到末尾；after=true 表示插到 before 之后。 */
export function reorderSibling(node,before,after){
  if(!node||!node.parent)return false;
  const parent=node.parent;
  const arr=parent.children||[];
  const from=arr.indexOf(node);
  if(from<0)return false;
  if(before&&before.parent!==parent)return false;
  let to=before?arr.indexOf(before):arr.length;
  if(to<0)return false;
  if(after)to++;
  if(to>arr.length)to=arr.length;
  if(to===from||to===from+1)return false;   /* 落回原位：不产生撤销/持久化 */
  pushUndo();
  arr.splice(from,1);
  if(to>from)to--;
  arr.splice(to,0,node);
  refresh();
  return true;
}

/* 删除节点及其子树 */
export function removeNode(node){
  if(!node||!node.parent)throw new Error('removeNode: 不能删除根节点');
  pushUndo();
  const i=node.parent.children.indexOf(node);
  if(i>=0)node.parent.children.splice(i,1);
  if(node.parent.children.length===0){   // 父变回叶子：恢复默认物候字段
    node.parent.leaf=true;
    node.parent.progress=0;
  }
  refresh();
}

/* ================= 日历分配原语 ================= */
export function assignPeriod(node,level,key,opts){
  if(!(opts&&opts.noUndo))pushUndo();
  var frozenM=node.lvl==='month'&&node.assignM&&level!=='m';
  var prevM=node.assignM;
  if(level==='m')node.assignM=key;
  else if(level==='w'){node.assignW=key;node.assignM=key.slice(0,7)}
  else if(level==='d'){node.assignD=key;
    node.assignW=weekKeyOf(new Date(key.replace(/-/g,'/')));
    node.assignM=node.assignW.slice(0,7)}
  if(frozenM&&node.assignM!==prevM)node.assignM=prevM;
  /* 排期变化影响枝形阶段/物候/果实显隐 → 走完整刷新链 */
  refresh();
}
export function unassignPeriod(node,level){
  pushUndo();
  if(level==='m'){node.assignM=null;node.assignW=null;node.assignD=null}
  else if(level==='w'){node.assignW=null;node.assignD=null}
  else if(level==='d')node.assignD=null;
  refresh();
}
/* 移出该月：顶层任务及其月度子孙解除月/周/日分配（节点保留，重新拖入可再规划）。
   收口原语——此前月卡×/月详情删除直接改字段，持久化与 3D 世界都不更新。 */
export function unassignFromMonthDeep(node,mk){
  if(!node)return;
  pushUndo();
  node.assignM=null;node.assignW=null;node.assignD=null;
  (function w(n){n.children.forEach(function(c){
    if(c.lvl==='month'&&(mk==null||c.assignM===mk)){
      c.assignM=null;c.assignW=null;c.assignD=null;c.makeup=null;  /* R7 已定 */
    }
    if(c.children.length)w(c);
  })})(node);
  refresh();
}
