/* ================= 日历分配核心 =================
   周期键：月 'YYYY-MM'；周 = 该周周三的日期串 'YYYY-MM-DD'（周归属=周三所在月，
   周区间=周日~周六——R21/R32 已定；单测 tests/run.mjs 钉死该语义）；日 'YYYY-MM-DD'。
   分配字段挂在任意级节点上：assignM/assignW/assignD，
   叶任务的有效分配 = 自身或最近分配祖先。
   （分配模式视觉状态机已随旧管线退役。） */
const WD=d=>d.getDay();                    // 周日=0（R21/R32：本周=周日起至周六止）
const p2=n=>String(n).padStart(2,'0');
/** @param {Date} d @returns {string} 'YYYY-MM-DD' */
export function dstr(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
/** @param {Date} d @returns {string} 'YYYY-MM' */
export function mstr(d){return d.getFullYear()+'-'+p2(d.getMonth()+1)}
export function parse(s){const[y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d)}
/** @param {Date} d @param {number} n @returns {Date} */
export function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
/** @param {Date} date @returns {string} 该周周三的 'YYYY-MM-DD' */
export function weekKeyOf(date){return dstr(addDays(date,3-WD(date)))}   // 该周周三（Sun=0 → +3；周区间=周日~周六）
/** @param {string} weekKey @returns {string} 'YYYY-MM' */
export function monthOf(weekKey){return weekKey.slice(0,7)}              // 周四所在月
/** @param {string} weekKey @returns {string[]} 7天日期串（周日起） */
export function weekDays(weekKey){const sun=addDays(parse(weekKey),-3);
  return Array.from({length:7},(_,i)=>dstr(addDays(sun,i)))}
/** @param {string} monthKey @returns {string[]} 该月全部周键 */
export function monthWeeks(monthKey){          // 该月的全部周（周三在本月）
  const[y,m]=monthKey.split('-').map(Number);
  const first=new Date(y,m-1,1),last=new Date(y,m,0);
  const seen=new Set(),out=[];
  for(let d=new Date(first);d<=last;d=addDays(d,1)){
    const k=weekKeyOf(d);
    if(monthOf(k)===monthKey&&!seen.has(k)){seen.add(k);out.push(k)}
  }
  return out.sort()
}
/** @param {string} monthKey @param {string} weekKey @returns {string} '第N周' */
export function weekLabel(monthKey,weekKey){
  return '第'+(monthWeeks(monthKey).indexOf(weekKey)+1)+'周';
}
/** 周度条的周序列（§7.0）：上月 + 本月 + 下月各完整一月，跨月连续。
 *  供周规划页底部导航条；当前月的周与月详情周度球一一对应。
 * @param {string} monthKey 本月 'YYYY-MM'
 * @returns {Array<{wk:string,mk:string,first:boolean}>} wk=周键 mk=所属月 first=是否该月首周 */
export function weekStripWeeks(monthKey){
  const [y,m]=monthKey.split('-').map(Number);
  const prev=mstr(new Date(y,m-2,1)),next=mstr(new Date(y,m,1));
  const out=[];
  [prev,monthKey,next].forEach(mk=>{
    monthWeeks(mk).forEach((wk,i)=>out.push({wk:wk,mk:mk,first:i===0}));
  });
  return out;
}
const WD_ZH=['日','一','二','三','四','五','六'];
/** @param {string} dayKey @returns {string} '周X DD' */
export function dayLabel(dayKey){return '周'+WD_ZH[WD(parse(dayKey))]+' '+(+dayKey.slice(8,10))}
/** @returns {{m:string,w:string,d:string}} 当前月/周/日键 */
const DAY_SPLIT=5;              /* R21/R32 已定：凌晨 5 点分界（过了 5:00 才算新天/新周） */
function shift(n){const s=new Date(n);s.setHours(s.getHours()-DAY_SPLIT);return s}
export function today(){const n=shift(new Date());
  return{m:mstr(n),w:weekKeyOf(n),d:dstr(n)}}

/* —— 有效分配解析（沿父链取最近显式分配）—— */
function eff(n,f){for(let x=n;x;x=x.parent){const v=f(x);if(v)return v}return null}
export const effM=n=>eff(n,x=>x.assignM);
export const effW=n=>eff(n,x=>x.assignW);
export const effD=n=>eff(n,x=>x.assignD);

/** 展示层逾期：有效落日（补点优先）早于 dayKey，且未完成/未放弃。
 *  n.overdue 是历史事实标志（R16/R17），不作为展示/统计口径。 */
export function isOverdue(n,dayKey){
  if(!n||!n.leaf||n.progress>=1||n.abandoned)return false;
  const d=n.makeup||effD(n);
  return !!d&&d<(dayKey||today().d);
}

/** 日容量：按星期取 caps.weekend / caps.day（caps 缺省 6h/0h）——周泡泡与今日顶带共用口径
 * @param {{day?:number,weekend?:number}|null} caps
 * @param {string} dayKey 'YYYY-MM-DD'
 * @returns {number} */
export function dayCapOf(caps,dayKey){
  const wd=parse(dayKey).getDay();
  const c=caps||{};
  return (wd===0||wd===6)?(c.weekend!=null?c.weekend:0):(c.day!=null?c.day:6);
}
function leavesOf(n){const out=[];(function w(x){x.leaf?out.push(x):x.children.forEach(w)})(n);
    if(!out.length)out.push(n);return out}
