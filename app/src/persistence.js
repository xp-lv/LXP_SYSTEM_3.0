import {derive} from './data.js';

/* ================= 持久化（schema v2，redesign《6-数据契约》） =================
   存档根 = { schema:2, savedAt,
     domains:[{id,name,color}],            领域=纯数据分组
     trees:[nodePlain…(根带 domainId)],     全部树平铺
     island:{ treeSlots:[{x,z,h,r,treeId}] },  单岛坑位表（treeId=null 墓碑）
     active:{domainId,treeId},             id 引用（弃用旧数组下标）
     temps, caps, orchard, exec }          exec=执行区状态（05.6 v10，随文档同步）

   序列化为纯函数（派生字段不入档）；localStorage 读写含错误路径
   （损坏→备份 .bak + 全新初始；版本高→拒载；写失败保留旧档）。 */

const KEY='lxp_redesign';
const PREF='lxp_redesign.prefs';
/* 用户偏好（提示条记忆等）——存储单拥有者的唯一例外通道 */
export function getPref(k){try{return JSON.parse(localStorage.getItem(PREF)||'{}')[k]}catch(e){return null}}
export function setPref(k,v){try{const o=JSON.parse(localStorage.getItem(PREF)||'{}');o[k]=v;localStorage.setItem(PREF,JSON.stringify(o))}catch(e){}}
const BAK='lxp_redesign.bak';
const LEGACY='lxp.v1';   /* 旧 app 存档键：不迁移（H1 已定），但要告知用户 */

/* —— 纯序列化（原子字段） —— */
export function serializeTree(root){
  function plain(n){
    const o={id:n.id,title:n.title};
    if(n.leaf)o.leaf=true;
    if(n.hours!=null)o.hours=n.hours;
    if(n.lvl)o.lvl=n.lvl;
    if(n.progress){o.progress=1;if(n.completedAt)o.completedAt=n.completedAt;}
    if(n.overdue)o.overdue=true;
    if(n.assignM)o.assignM=n.assignM;
    if(n.assignW)o.assignW=n.assignW;
    if(n.assignD)o.assignD=n.assignD;
    if(n.makeup)o.makeup=n.makeup;
    if(n.order!=null)o.order=n.order;
    if(n.wOrder!=null)o.wOrder=n.wOrder;
    if(n.checklist)o.checklist=n.checklist.map(c=>({t:c.t,done:!!c.done}));
    if(n.children&&n.children.length)o.children=n.children.map(plain);
    return o;
  }
  const o=plain(root);
  if(root.domainId!=null)o.domainId=root.domainId;
  return o;
}
export function deserializeTree(p){
  const root=revive(p,null,0);
  derive(root);
  if(p.domainId!=null)root.domainId=p.domainId;
  return root;
}
function revive(p,parent,depth){
  const n={id:p.id,title:p.title,depth:depth,parent:parent,
    children:[],leaf:!!p.leaf,
    progress:p.progress?1:0,overdue:!!p.overdue,
    completedAt:p.completedAt||null,
    hours:p.hours!=null?+p.hours:2};
  if(p.lvl)n.lvl=p.lvl;
  if(p.assignM)n.assignM=p.assignM;
  if(p.assignW)n.assignW=p.assignW;
  if(p.assignD)n.assignD=p.assignD;
  if(p.makeup)n.makeup=p.makeup;
  if(p.order!=null)n.order=p.order;
  if(p.wOrder!=null)n.wOrder=p.wOrder;
  if(p.checklist)n.checklist=p.checklist.map(c=>({t:c.t,done:!!c.done}));
  (p.children||[]).forEach(c=>{n.children.push(revive(c,n,depth+1))});
  if(n.children.length)n.leaf=false;
  return n;
}

/* —— 临时任务（全局日程池，《6》§B：含 order/completedAt） —— */
export function serializeTemp(t){
  const o={id:t.id,title:t.title,hours:+t.hours||0};
  if(t.assignD)o.assignD=t.assignD;
  if(t.assignW)o.assignW=t.assignW;
  if(t.makeup)o.makeup=t.makeup;
  if(t.order!=null)o.order=t.order;
  if(t.progress){o.progress=1;if(t.completedAt)o.completedAt=t.completedAt}
  return o;
}
export function reviveTemp(p){
  return{id:p.id,title:p.title,hours:+p.hours||0,lvl:'temp',
    assignD:p.assignD||null,assignW:p.assignW||null,makeup:p.makeup||null,
    order:p.order!=null?p.order:null,
    progress:p.progress?1:0,completedAt:p.completedAt||null};
}

/* —— 文档组装/校验 —— */
export function serializeWorld(doc){
  return{schema:2,savedAt:Date.now(),
    domains:doc.domains,active:doc.active,
    trees:doc.trees,island:doc.island,
    temps:(doc.temps||[]).map(serializeTemp),
    caps:doc.caps||null,orchard:doc.orchard||[],
    exec:doc.exec||null};
}
function validate(doc){
  return!!(doc&&doc.schema===2&&Array.isArray(doc.domains)&&doc.domains.length
    &&Array.isArray(doc.trees)&&doc.island&&Array.isArray(doc.island.treeSlots));
}

/* —— localStorage 读写（含错误路径） —— */
/* 写档边界不变量（机制 A 的守门）：id 必须全局唯一 */
function assertUniqueIds(doc){
  const seen=new Set();
  for(const t of doc.trees||[]){
    (function w(n){
      if(seen.has(n.id))throw new Error('id 重复: '+n.id+'（'+n.title+'）');
      seen.add(n.id);(n.children||[]).forEach(w)})(t);
  }
  for(const tp of doc.temps||[])if(seen.has(tp.id))throw new Error('id 重复(temp): '+tp.id);
}
export function writeDoc(doc){
  try{
    assertUniqueIds(doc);                          /* 唯一性在写边界拦截 */
    if(typeof localStorage==='undefined')
      return{ok:false,notice:'浏览器存储不可用——数据仅保留在内存，建议立即用「⇩ 备份」导出'};
    const s=JSON.stringify(serializeWorld(doc));   /* 序列化成功才写（原子性 E2） */
    localStorage.setItem(KEY,s);
    return{ok:true};
  }catch(e){
    if(/id 重复/.test(String(e.message)))throw e;  /* 不变量违规：上抛，宁可写败不可写坏 */
    console.warn('[persistence] write 失败',e);
    return{ok:false,notice:'存档写入失败（存储可能已满）——建议用「⇩ 备份」导出后清理'};
  }
}
export function readDoc(){
  const out={doc:null,notice:null};
  try{
    if(typeof localStorage==='undefined'){
      out.notice='浏览器存储不可用——本次会话数据不会保存，可用「⇩ 备份」导出';
      return out}
    const raw=localStorage.getItem(KEY);
    if(raw){
      let doc=null,parseErr=false;
      try{doc=JSON.parse(raw)}catch(e){parseErr=true}
      if(parseErr){                                  /* 损坏：备份 + 全新（F 表） */
        try{localStorage.setItem(BAK,raw)}catch(e2){}
        out.notice='存档损坏——已自动备份（.bak），现以全新状态启动';
        return out;
      }
      if(doc&&doc.schema>2){                         /* 版本高：拒载 + 提示（F 表） */
        out.notice='存档由更新版本创建，本程序无法读取——请升级程序';
        return out;
      }
      if(!doc||doc.schema!==2){                      /* 低版本：H1 已定不迁移，明确告知 */
        out.notice='检测到未知/旧版存档，已忽略（不支持迁移）——旧数据未被删除';
        return out;
      }
      if(!validate(doc)){out.notice='存档结构校验失败，已忽略';return out}
      doc.trees=doc.trees.map(deserializeTree);
      doc.temps=(doc.temps||[]).map(reviveTemp);
      out.doc=doc;
      return out;
    }
    /* 无本系统存档，但存在旧 app 存档 → 告知不迁移 */
    try{
      if(typeof localStorage!=='undefined'&&localStorage.getItem(LEGACY))
        out.notice='检测到旧版（app）存档：按设计不迁移，如需保留请在旧版中导出';
    }catch(e){}
    return out;
  }catch(e){console.warn('[persistence] read 失败',e);return out}
}
export function exportJSON(doc){return JSON.stringify(serializeWorld(doc),null,2)}
export function importJSON(text){
  try{
    const doc=JSON.parse(text);
    if(!validate(doc))return null;
    doc.trees=doc.trees.map(deserializeTree);
    doc.temps=(doc.temps||[]).map(reviveTemp);
    return doc;
  }catch(e){return null}
}
