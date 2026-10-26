import {state,data} from './state.js';
import {addSubtask,updateTask,removeNode,renameNode,assignPeriod,unassignPeriod,touch,addTemp,removeTemp,reorderSibling,snapshot} from './mutations.js';
import {weekKeyOf,weekDays,dayLabel,today,dstr,addDays,parse,monthOf,mstr,weekLabel,weekStripWeeks,effW,effD,dayCapOf} from './calendar.js';
import {getIslands,getActiveIsland,treeColorOf} from './world.js';
import {escHtml} from './utils.js';
import * as q from './queries.js';
import {markRendered as viewsMark,showView} from './views.js';
import {setSelected} from './planner.js';
import {flyWeekBubbles} from './transition.js';
import {setDay} from './today.js';
import {createDecomposer} from './modules/decomposer.js';

/* ================= 微观规划 · 周视角 v4 =================
   与目标画布/月度详情同构的统一树画布（可复用分解模块）：
   根「本周」→ 目标分组 → 周任务（分解层级递归展开），悬停＋原地创建。
   底部 7 泡泡（波浪容量）不变：拖任务入球落日、小字条拖出移出、容量点改。
   规则：过去的周只读；分解最多两层；落日前必须有工时。 */
var wk=null;
var _cssDone=false,_ghost=null;
var dlgCb=null;
var _ro=false;          /* 当前查看的周是否只读（历史周） */
var dcInst=null;        /* decomposer 实例 */
var renderedWk=null;    /* 当前画布实例对应的周（同周重建时保留视角） */

function caps(){return data.caps||{day:6,weekend:0}}
function dayCap(dk){return dayCapOf(data.caps,dk)}

function num(v){var n=parseFloat(v);return isNaN(n)?0:Math.max(0,Math.round(n*10)/10)}
function isLeafN(n){return !(n.children&&n.children.length)}
function sumH(n){return isLeafN(n)?(n.hours||0):n.children.reduce(function(s,c){return s+sumH(c)},0)}
function treeOf(n){return q.treeOf(n)}
function treeColor(n){
  if(n.lvl==='temp')return 'var(--lx-temp,#38BDF8)';
  var tr=treeOf(n);
  return tr?treeColorOf(tr):'var(--bd-text-3,#6E7689)';          // 树色变体（§3.7：同域多树可区分）
}
function allTreeRoots(){
  var isles=getIslands(),roots=[];
  isles.forEach(function(i){i.trees.forEach(function(r){roots.push(r)})});
  return roots;
}

/* 周域深度：月度任务=0，其子=1，孙=2（分解封顶 2 层） */
function weekDepth(n){var d=0;for(var x=n;x&&x.parent&&x.lvl!=='month';x=x.parent)d++;return d}
/* 顶层目标组：周画布上直接挂在某棵目标树下的任务，共享一个组内顺序 */
function weekGroupOf(n){
  return n&&n._wkGroup&&n._wkGroup.children.indexOf(n)>=0?n._wkGroup:null;
}

/* 临时任务：已落日的按周归属；未落日的属于全局日程池（当前/未来周可见可拖） */
function tempPoolFor(wkKey,future){
  return (data.temps||[]).filter(function(t){
    if(t.assignD)return weekKeyOf(new Date(t.assignD.replace(/-/g,'/')))===wkKey;
    return future;
  });
}
/* 当日事项：落日叶子 + 补点在本日的 + 落日临时任务（容量照常计入）——口径统一于 queries */
function dayItems(dk){return q.dayItems(allTreeRoots(),dk,data.temps)}
function dayLoad(dk){return q.dayHours(allTreeRoots(),dk,data.temps)}
function wkLabel(k){
  var mon=parse(k);mon=addDays(mon,-3);
  var sun=addDays(mon,6);
  return (mon.getMonth()+1)+'/'+mon.getDate()+' \u2013 '+(sun.getMonth()+1)+'/'+sun.getDate();
}
function wkOfKey(dk){return weekKeyOf(new Date(dk.replace(/-/g,'/')))}

/* ---------- 虚拟树：根「本周」→ 目标分组 → 周任务（真实节点直挂） ---------- */
function buildWeekTree(wkKey,future){
  var vroot={title:wkLabel(wkKey),children:[],_virtualRoot:true};
  /* 清掉上一轮渲染留下的组引用，避免已移出本周的节点继续用旧组排序 */
  allTreeRoots().forEach(function(tr){
    (function clr(n){n._wkGroup=null;(n.children||[]).forEach(clr)})(tr);
  });
  allTreeRoots().forEach(function(tr){
    var list=[];
    (function w(n){
      n.children.forEach(function(c){
        /* 所有“有效周=本周”的任务都入画布，不再只限 month/week：
           顶层任务、周任务、只分配到周未落日的任务都要显示。 */
        var inWk=effW(c)===wkKey||(c.makeup&&wkOfKey(c.makeup)===wkKey);
        if(inWk){list.push(c);return}   /* 命中即收；其分解子级由画布递归呈现 */
        if(c.children.length)w(c);
      });
    })(tr);
    if(list.length){
      list.sort(function(a,b){
        var ao=a.wOrder,bo=b.wOrder;
        if(ao==null&&bo==null)return 0;
        if(ao==null)return 1;
        if(bo==null)return -1;
        return ao-bo;
      });
      var group={title:tr.title,_real:tr,_group:true,lvl:'top',children:list};
      list.forEach(function(c){c._wkGroup=group});
      vroot.children.push(group);
    }
  });
  var temps=tempPoolFor(wkKey,future);
  if(temps.length)vroot.children.push({title:'日程',_group:true,_temp:true,lvl:'temp',children:temps});
  return vroot;
}
function removeFromVtree(vroot,node){
  vroot.children.forEach(function(g){
    var i=g.children.indexOf(node);
    if(i>=0)g.children.splice(i,1);
  });
  vroot.children=vroot.children.filter(function(g){return g.children.length});
}

function injectCSS(){
  if(_cssDone)return;_cssDone=true;  var css=document.createElement('style');css.textContent=`
#viewWeek .wk-canvas{position:relative;height:100%;overflow:hidden;display:flex;flex-direction:column}
/* 头部 v2：导航胶囊 | 标题+状态徽章 | 动作区（唯一主按钮）——三区主次分明 */
#viewWeek .wk-head{flex:none;display:flex;align-items:center;gap:16px;padding:14px 20px 12px;
  border-bottom:1px solid var(--bd-line,rgba(255,255,255,.10))}
#viewWeek .wk-nav{display:inline-flex;gap:0;padding:2px;border-radius:8px;
  background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-line,rgba(255,255,255,.10));overflow:hidden}
#viewWeek .wk-title{font-size:16px;font-weight:600;color:var(--bd-text,#E9ECF4);letter-spacing:-.015em}
#viewWeek .wk-sub{font-size:10.5px;color:var(--bd-text-3,#6E7689);margin-top:2px}
#viewWeek .wk-chip{font-size:9.5px;font-weight:600;border-radius:999px;padding:2px 8px;margin-left:9px;
  vertical-align:2px;letter-spacing:.05em}
#viewWeek .wk-chip.cur{color:#7EBA68;border:1px solid rgba(126,186,104,.4);background:transparent}
#viewWeek .wk-chip.ro{color:var(--lx-warn,#D9A13E);border:1px solid rgba(217,161,62,.35);
  background:transparent}
#viewWeek .wk-actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex:none}
/* ---- 周度条（头部内联：日期范围右侧平铺，可横向滚动 · §7.0 v2） ---- */
#viewWeek .wk-weeks{display:flex;gap:5px;align-items:center;min-width:0;flex:0 1 auto;
  margin-left:4px;padding:2px 0;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
#viewWeek .wk-weeks::-webkit-scrollbar{display:none}
.wk-wb{flex:none;height:24px;min-width:40px;padding:0 8px;border-radius:999px;
  display:flex;align-items:center;justify-content:center;gap:4px;
  background:var(--bd-surface,#151922);border:1px solid var(--bd-line,rgba(255,255,255,.10));
  color:var(--bd-text-3,#6E7689);font-size:9.5px;letter-spacing:.02em;cursor:pointer;
  user-select:none;white-space:nowrap;
  transition:border-color .15s,color .15s,background .15s,transform .12s}
.wk-wb:hover{border-color:var(--bd-line-strong,rgba(255,255,255,.18));color:var(--bd-text)}
.wk-wb.cur-week{border-color:rgba(126,186,104,.45);color:#7EBA68}
.wk-wb.sel{border-color:var(--bd-accent,#8B96F8);background:rgba(139,150,248,.10);color:var(--bd-text,#E9ECF4);
  box-shadow:none}
.wk-wb .wb-m{font-size:8px;color:var(--bd-text-3,#6E7689);letter-spacing:.06em}
.wk-wb.mstart{margin-left:7px}
.wk-wb.mstart:first-child{margin-left:0}
#viewWeek .wk-head button{height:28px;padding:0 12px;font-size:11px;background:transparent;
  border:1px solid var(--bd-line,rgba(255,255,255,.10));color:var(--bd-text-2,#A7AEC0);border-radius:8px;
  cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap;flex:none}
#viewWeek .wk-head button:hover{border-color:var(--bd-line-strong,rgba(255,255,255,.18));color:var(--bd-text)}
#viewWeek .wk-head button:disabled{opacity:.35;cursor:not-allowed}
#viewWeek .wk-nav button{border-color:transparent;background:transparent;height:24px;width:30px;padding:0;
  border-radius:6px;color:var(--bd-text-2,#A7AEC0)}
#viewWeek .wk-nav button:hover{background:rgba(255,255,255,.05);border-color:transparent;color:var(--bd-text)}
#viewWeek .wk-head .wk-primary{background:var(--lx-accent-deep,#5A63E8);color:#F6F7FF;
  border-color:transparent;box-shadow:none;font-weight:600}
#viewWeek .wk-head .wk-primary:hover{filter:brightness(1.12);color:#fff;border-color:transparent}
/* ---- ◀▶/周度条联动质感（§7.0 v3）：标题按行进方向滑入，画布/泡泡淡入，选中胶囊涟漪 ---- */
@keyframes wkInR{from{opacity:0;transform:translateX(16px)}}
@keyframes wkInL{from{opacity:0;transform:translateX(-16px)}}
@keyframes wkFade{from{opacity:0}}
@keyframes wkSelRip{from{box-shadow:0 0 0 0 rgba(139,150,248,.45)}}
#viewWeek .wk-go-r .wk-tblock{animation:wkInR .34s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
#viewWeek .wk-go-l .wk-tblock{animation:wkInL .34s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
#viewWeek .wk-go-r .wk-dc,#viewWeek .wk-go-l .wk-dc{animation:wkFade .26s ease}
#viewWeek .wk-go-r .wk-bubbles,#viewWeek .wk-go-l .wk-bubbles{animation:wkFade .26s ease .05s}
.wk-wb.sel{animation:wkSelRip .5s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
#viewWeek .wk-dc{flex:1;min-height:0;position:relative}
#viewWeek .wk-dc .dc-node.need-h{animation:wkNeed .5s ease 2}
@keyframes wkNeed{50%{border-color:var(--lx-warn,#D9A13E);box-shadow:0 0 0 3px rgba(217,161,62,.15)}}
#viewWeek .wk-bubbles{flex:none;display:flex;justify-content:center;gap:14px;
  padding:8px 20px 16px;border-top:1px solid var(--bd-line);position:relative;
  overflow-x:auto;overflow-y:hidden;scrollbar-width:none}   /* 周度条上收后泡泡=末行 */
#viewWeek .wk-bubbles::-webkit-scrollbar{display:none}

/* 日分配：连续日期列（飞书时间轴/看板语言），替代底部圆形水泡 */
#viewWeek .wk-daywrap{flex:none;border-top:1px solid var(--bd-line);padding:8px 20px 12px;position:relative;background:transparent}
#viewWeek .wk-dayhead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px}
#viewWeek .wk-daylabel{font-size:9px;font-weight:650;letter-spacing:.14em;color:var(--bd-text-3);display:flex;align-items:center;gap:6px}
#viewWeek .wk-daylabel::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--lx-ph-sprout);flex:none}
#viewWeek .wk-dayhint{font-size:8.5px;color:var(--bd-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#viewWeek .wk-dayrail{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(96px,1fr);
  height:clamp(104px,13vh,138px);overflow-x:auto;overflow-y:hidden;scrollbar-width:none;
  background:var(--bd-canvas)}
#viewWeek .wk-dayrail::-webkit-scrollbar{display:none}
#viewWeek .wk-day{position:relative;min-width:0;display:flex;flex-direction:column;
  padding:7px 9px;border-right:1px solid var(--bd-line);cursor:pointer;background:transparent;
  transition:background .16s}
#viewWeek .wk-day:last-child{border-right:0}
#viewWeek .wk-day:hover{background:rgba(255,255,255,.022)}
#viewWeek .wk-day.today{background:rgba(217,196,106,.045);box-shadow:inset 0 2px 0 rgba(217,196,106,.55)}
#viewWeek .wk-day.over .wk-dayload b{color:var(--lx-danger)}
#viewWeek .wk-daytop{display:flex;align-items:baseline;gap:5px;min-width:0}
#viewWeek .wk-dw{font-size:8.5px;color:var(--bd-text-3);letter-spacing:.04em;white-space:nowrap}
#viewWeek .wk-dd{font-size:15px;font-weight:650;color:var(--bd-text);letter-spacing:-.02em;line-height:1.1}
#viewWeek .wk-todaytag{font-size:8px;color:var(--lx-ph-yellow);white-space:nowrap}
#viewWeek .wk-dayload{display:flex;justify-content:space-between;gap:4px;align-items:baseline;
  font-size:8.5px;color:var(--bd-text-3);margin-top:2px;font-variant-numeric:tabular-nums}
#viewWeek .wk-dayload b{font-size:9.5px;color:var(--bd-text-2);font-weight:500}
#viewWeek .wk-dayload[data-role="cap"]{cursor:pointer;border-radius:3px}
#viewWeek .wk-dayload[data-role="cap"]:hover{background:var(--bd-line)}
#viewWeek .wk-daybar{height:2px;margin:4px 0 6px;border-radius:1px;background:rgba(255,255,255,.06);overflow:hidden;flex:none}
#viewWeek .wk-daybar i{display:block;height:100%;border-radius:1px;background:var(--bd-accent)}
#viewWeek .wk-day.today .wk-daybar i{background:var(--lx-ph-yellow)}
#viewWeek .wk-day.over .wk-daybar i{background:var(--lx-danger)}
#viewWeek .wk-daytasks{flex:1;min-height:0;display:flex;flex-direction:column;gap:3px;overflow:hidden}
#viewWeek .wk-day .tstrip{display:flex;align-items:center;gap:4px;min-height:22px;padding:0 6px;
  font-size:9px;color:var(--bd-text-2);background:var(--bd-surface);border:1px solid var(--bd-line);
  border-radius:5px;cursor:grab;touch-action:none;user-select:none;overflow:hidden}
#viewWeek .wk-day .tstrip i{width:4px;height:4px;border-radius:50%;flex:none}
#viewWeek .wk-day .tstrip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
#viewWeek .wk-day .tstrip .mkb{font-size:7.5px;color:var(--lx-warn);flex:none;line-height:1}
#viewWeek .wk-day .tmore{font-size:8.5px;color:var(--bd-text-3);padding:1px 2px}
#viewWeek .wk-day .wk-empty{font-size:8.5px;color:var(--bd-text-3);opacity:.55;margin-top:2px}
#viewWeek .wk-day:hover .wk-empty{opacity:1;color:var(--bd-accent)}
#viewWeek .wk-day.drop-in{outline:0;background:rgba(139,150,248,.09);box-shadow:inset 0 -2px 0 var(--bd-accent)}
#viewWeek .wk-day.splash{animation:wkDaySplash .42s ease}
@keyframes wkDaySplash{50%{background:rgba(139,150,248,.13)}}
#viewWeek .wk-dayrail.ro .wk-day{cursor:default}
#viewWeek .wk-dayrail.ro .tstrip{cursor:default}
#viewWeek .wk-go-r .wk-daywrap,#viewWeek .wk-go-l .wk-daywrap{animation:wkFade .26s ease .05s}
/* ---- 周度条样式已并入头部区块（wk-head 内联平铺） ---- */
#viewWeek .wk-bubbles::before{content:'拖任务到泡泡落日 · 泡泡内小字条可拖出移出';
  position:absolute;top:-8px;left:50%;transform:translateX(-50%);font-size:9.5px;
  color:var(--bd-text-3,#6E7689);letter-spacing:.06em;white-space:nowrap;
  background:var(--bd-canvas,#0F1218);padding:0 10px}
.bubble{width:88px;height:88px;border-radius:50%;position:relative;overflow:hidden;
  background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-line,rgba(255,255,255,.10));flex:none;cursor:default;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
  box-shadow:none;
  transition:border-color .16s,background .16s,transform .16s}
.bubble:hover{border-color:var(--bd-line-strong,rgba(255,255,255,.18));background:var(--bd-surface,#151922)}
.bubble.jumpable{cursor:pointer}
.bubble .wave{position:absolute;left:-6%;right:-6%;bottom:-4%;height:0%;
  border-radius:44% 46% 0 0/26px 24px 0 0;transition:height .3s ease;
  animation:lx-bob 4.5s ease-in-out infinite alternate}   /* 水波呼吸（§动效） */
.bubble.splash{animation:lx-splash .42s var(--lx-m-spring,cubic-bezier(.34,1.56,.64,1))}
.bubble.ok .wave{background:rgba(78,143,62,.16);border-top:1px solid rgba(126,186,104,.35)}
.bubble.warn .wave{background:rgba(217,161,62,.15);border-top:1px solid rgba(217,161,62,.45)}
.bubble.over .wave{background:rgba(229,105,111,.15);border-top:1px solid rgba(229,105,111,.45)}
.bubble.today{border-color:rgba(217,196,106,.55);box-shadow:none}
.bubble .dw{font-size:9px;color:var(--bd-text-3,#6E7689);position:relative;letter-spacing:.05em}
.bubble .dd{font-size:16px;font-weight:600;color:var(--bd-text,#E9ECF4);position:relative;letter-spacing:-.02em}
.bubble .hh{font-size:9px;color:var(--bd-text-3,#6E7689);position:relative}
.bubble .hh b{color:var(--bd-text-2,#A7AEC0);font-weight:500}
.bubble .hh[data-role="cap"]{cursor:pointer;border-radius:3px;padding:0 3px}
.bubble .hh[data-role="cap"]:hover{background:var(--bd-line)}
.bubble .tasks{position:absolute;left:5px;right:5px;bottom:4px;display:flex;flex-direction:column;gap:1px;z-index:1}
.bubble .tstrip{display:flex;align-items:center;gap:3px;font-size:8px;
  color:var(--bd-text-2,#A7AEC0);background:var(--bd-surface-3,#11151C);border:1px solid var(--bd-line,rgba(255,255,255,.10));border-radius:3px;padding:1px 4px;
  cursor:grab;touch-action:none;user-select:none}
.bubble .tstrip i{width:3px;height:3px;border-radius:50%;flex:none}
.bubble .tstrip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
.bubble .tstrip .mkb{font-size:7.5px;color:var(--lx-warn,#D9A13E);flex:none;line-height:1}
.bubble .tmore{font-size:8px;color:var(--bd-text-3,#6E7689);text-align:center}
.bubble.drop-in{outline:2px dashed var(--bd-accent,#8B96F8);outline-offset:3px}
#wkDlg2{position:fixed;left:50%;top:35%;transform:translate(-50%,-50%);
  background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-line,rgba(255,255,255,.10));
  border-radius:var(--bd-r-zone,12px);padding:16px 20px;z-index:50;min-width:260px;display:none;
  box-shadow:var(--bd-shadow-float,0 12px 32px rgba(0,0,0,.45))}
#wkDlg2 .t{font-size:12.5px;color:var(--bd-text,#E9ECF4);margin-bottom:12px;font-weight:600}
#wkDlg2 input{width:100%;background:var(--bd-surface-3,#11151C);border:1px solid var(--bd-line,rgba(255,255,255,.10));
  border-radius:8px;color:var(--bd-text,#E9ECF4);padding:7px 10px;font-size:12px;
  margin-bottom:6px;font-family:inherit;outline:none}
#wkDlg2 input:focus{border-color:var(--bd-accent,#8B96F8)}
#wkDlg2 .db2{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
#wkDlg2 button{padding:5px 16px;border-radius:8px;font-size:11.5px;cursor:pointer;border:1px solid;font-family:inherit}
#wkDlg2 .ok2{background:var(--lx-accent-deep,#5A63E8);color:#F6F7FF;border-color:transparent}
#wkDlg2 .no2{background:transparent;color:var(--bd-text-2,#A7AEC0);border-color:var(--bd-line,rgba(255,255,255,.10))}
#wkGhost{position:fixed;z-index:99;pointer-events:none;display:none;
  background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-accent,#8B96F8);border-radius:8px;
  padding:6px 13px;font-size:11.5px;color:var(--bd-text,#E9ECF4);
  box-shadow:var(--bd-shadow-float,0 12px 32px rgba(0,0,0,.45));white-space:nowrap;transform:rotate(-1.2deg)}
#wkGhost b{color:var(--bd-accent,#8B96F8);font-weight:500}
#wkGhost.no-h{border-color:var(--lx-warn,#D9A13E)}
#wkGhost.no-h b{color:var(--lx-warn,#D9A13E)}`;
  document.head.appendChild(css);
  _ghost=document.createElement('div');_ghost.id='wkGhost';document.body.appendChild(_ghost);
  var d=document.createElement('div');d.id='wkDlg2';
  d.innerHTML='<div class="t" id="wkDlg2T"></div>'+
    '<input type="text" id="wkDlg2Name" placeholder="子任务名"><input type="text" id="wkDlg2H" placeholder="工时 h（必填）">'+
    '<div class="db2"><button class="no2" id="wkDlg2No">取消</button><button class="ok2" id="wkDlg2Yes">分解</button></div>';
  document.body.appendChild(d);
  document.getElementById('wkDlg2No').onclick=function(){d.style.display='none';dlgCb=null};
  document.getElementById('wkDlg2Yes').onclick=function(){
    var nm=document.getElementById('wkDlg2Name').value.trim();
    var h=num(document.getElementById('wkDlg2H').value);
    if(!nm||h<=0)return;
    var cb=dlgCb;d.style.display='none';dlgCb=null;if(cb)cb(nm,h)};
  }
/* 供今日页复用：.bubble 样式族 + 飞移目标 DOM 就绪（幂等） */
export function ensureWeekCSS(){injectCSS()}

export function renderWeek(dir){
  viewsMark();
  injectCSS();
  if(!wk)wk=today().w;
  var el=document.getElementById('viewWeek');
  var t0=today();
  _ro=wk<t0.w;                                  /* 过去的周只读 */
  var days=weekDays(wk);
  var isCur=wk===t0.w;
  /* 同周重建（落日/移出等刷新）时保留画布视角，避免视跳回居中 */
  var keepScroll=null;
  if(dcInst&&renderedWk===wk){
    var se0=document.querySelector('#wkCanvasArea .dc-scroll');
    if(se0)keepScroll={l:se0.scrollLeft,t:se0.scrollTop};
  }
  if(dcInst){dcInst.destroy();dcInst=null}
  renderedWk=wk;
  var vroot=buildWeekTree(wk,!_ro);
  var taskN=0,totH=0;
  vroot.children.forEach(function(g){g.children.forEach(function(t){taskN++;totH+=t.hours||0})});

  el.innerHTML='<div class="wk-canvas'+(dir>0?' wk-go-r':dir<0?' wk-go-l':'')+'">'+
    '<div class="wk-head">'+
    /* 导航胶囊：◀ ▶ 一体（翻周是一组功能，不拆在标题两侧） */
    '<div class="wk-nav"><button id="wkPrev" title="上一周">&#9664;</button>'+
    '<button id="wkNext" title="下一周">&#9654;</button></div>'+
    '<div class="wk-tblock">'+
    '<div class="wk-title num">'+wkLabel(wk)+
    (isCur?'<span class="wk-chip cur">本周</span>':'')+
    (_ro?'<span class="wk-chip ro">历史周 · 只读</span>':'')+'</div>'+
    '<div class="wk-sub num">'+taskN+' 个周任务 · '+Math.round(totH)+'h'+
    (vroot.children.length>1?' · '+vroot.children.length+' 组':'')+'</div></div>'+
    /* 周度条平铺到日期范围右侧（原底部整行上收，跨月连续导航不变） */
    '<div class="wk-weeks" id="wkWeeks"></div>'+
    /* 动作区：回本周仅离开本周时出现；＋临时任务=页面唯一主按钮 */
    '<div class="wk-actions">'+
    (isCur?'':'<button id="wkThis" title="回到当前周">回本周</button>')+
    '<button id="wkTemp" class="wk-primary"'+(_ro?' disabled':'')+
      ' title="新增日程条目（带工时，拖入泡泡落日）">&#xff0b; 临时任务</button></div>'+
    '</div>'+
    '<div class="wk-dc" id="wkCanvasArea"></div>'+
    '<div class="wk-daywrap">'+
      '<div class="wk-dayhead"><div class="wk-daylabel">日分配</div>'+
        '<div class="wk-dayhint">'+(_ro?'历史周只读 · 点日期查看当日':'拖任务到日期列 · 列内任务可拖出换日')+'</div></div>'+
      '<div class="wk-dayrail'+(_ro?' ro':'')+'" id="wkDayRail"></div>'+
    '</div>'+
    '</div>';

  document.getElementById('wkPrev').onclick=function(){wk=addDays(parse(wk),-7);wk=weekKeyOf(wk);renderWeek(-1)};
  document.getElementById('wkNext').onclick=function(){wk=addDays(parse(wk),7);wk=weekKeyOf(wk);renderWeek(1)};
  var th=document.getElementById('wkThis');
  if(th)th.onclick=function(){var d=wk>today().w?-1:1;wk=today().w;renderWeek(d)};
  var tmp=document.getElementById('wkTemp');
  if(tmp)tmp.onclick=function(){
    if(_ro){toast('warn','过去的周只读');return}
    openDecompDlg('新建临时任务（带工时）',function(nm,hh){
      addTemp({title:nm,hours:hh});        /* 可撤销（R34） */
      renderWeek();toast('ok','临时任务「'+escHtml(nm)+'」· 拖入日期列落日');
    });
  };

  dcInst=createDecomposer(document.getElementById('wkCanvasArea'),{
    data:vroot,
    height:'100%',
    hint:vroot.children.length?'':'本周暂无排程任务——点右上「＋临时任务」，或在宏观/今日页把任务排到本周',
    padBottom:12,    /* 日分配列在布局流内，底部只留呼吸空间 */
    hoursEditable:!_ro,
    canPlus:function(n){
      return !_ro&&!n._virtualRoot&&!n._group&&n.lvl!=='temp'&&
        (n.hours||0)>0&&weekDepth(n)<2;
    },
    ops:{
      divide:function(parent,fields){
        if(_ro||parent._group||parent._virtualRoot)return null;
        var f=fields||{};
        var c=addSubtask(parent,{title:f.title||'',hours:f.hours!=null?f.hours:2,lvl:'week'});
        setTimeout(refreshDayRail,0);          /* 新子任务带默认工时 → 泡泡负载即时更新 */
        return c;
      },
      remove:function(node){
        if(_ro||node._group||node._virtualRoot)return false;
        /* 只有周任务删除子树；顶层/月度任务是从本周移出，不删树 */
        if(node.lvl==='week'&&node.children&&node.children.length&&
          !confirm('删除「'+node.title+'」及其全部子任务？'))return false;
        if(node.lvl==='temp'){
          removeTemp(node.id);               /* 可撤销（R34） */
        }else if(node.lvl==='month'){
          unassignPeriod(node,'w');            /* 月度任务移出本周（保留任务本身） */
        }else if(node.lvl==='top'){
          unassignPeriod(node,'w');            /* 顶层任务只移出本周 */
        }else if(node.lvl==='week'){
          removeNode(node);                    /* 周任务=删除子树 */
        }else return false;
        removeFromVtree(vroot,node);
        setTimeout(refreshDayRail,0);
        return true;
      },
      rename:function(node,title){
        if(_ro||!title)return;
        if(node.lvl==='temp'){node.title=title;touch()}
        else renameNode(node,title);
      },
      setHours:function(node,h){
        if(_ro)return;
        var hv=Math.max(0,h);
        if(node.lvl==='temp'){node.hours=hv;touch()}
        else updateTask(node,{hours:hv});
        setTimeout(refreshDayRail,0);          /* 工时变化 → 波浪水位即时更新 */
      }
    },
    colorOf:function(n){return n._virtualRoot?null:treeColor(n._real||n)},
    meta:function(n){
      if(n._virtualRoot)return taskN+' 个周任务';
      if(n._group){
        if(n._temp)return '临时 \u00b7 '+n.children.length;
        var s=0;n.children.forEach(function(t){s+=t.hours||0});
        return n.children.length+'任务 \u00b7 '+Math.round(s)+'h';
      }
      var leaf=isLeafN(n);
      /* 容器工时=子级汇总（自身 hours 是分解前的旧值，不再展示） */
      var hv=leaf?(n.hours||0):sumH(n);
      var hrs=hv>0?Math.round(hv)+'h'
        :'<span style="color:var(--lx-warn,#D9A13E)">填工时</span>';
      var h=(!_ro&&leaf)?'<span class="hz" data-role="h">'+hrs+'</span>':hrs;
      /* 落日信息：容器（有子任务）不显示——落日发生在叶子层；
         叶子未落日不写"待落日"文字，由卡片右上角红点（badge）承载 */
      var day;
      if(n.makeup)day='<span style="color:var(--lx-warn,#D9A13E)">补 '+n.makeup.slice(5)+'</span>';
      else if(effD(n))day=dayLabel(effD(n)).split(' ')[0]+' '+effD(n).slice(8);
      else day=null;
      return day?(h+' \u00b7 '+day):h;
    },
    badge:function(n){return isLeafN(n)&&!n.makeup&&!effD(n)},   /* 未落日红点 */
    drag:{
      canDrag:function(n){
        if(_ro||n._virtualRoot||n._group)return false;
        /* 本周画布上的所有真实叶子都可拖到日期列；不再限 month/week */
        return isLeafN(n);
      },
      dropSelector:'#wkDayRail .wk-day',
      ghostText:function(n,el){
        if(!(n.hours>0))return n.title+' 未填工时 · 落日前须补';
        if(!el)return n.title+' → 拖到日期列';
        var isMk=!!(n.overdue&&n.progress<1);
        var load=dayLoad(el.dataset.dk),cap=dayCap(el.dataset.dk);
        var full=load+(n.hours||0)>cap;
        return n.title+' → '+(isMk?'补 ':'')+dayLabel(el.dataset.dk).split(' ')[0]+' '+
          el.dataset.dk.slice(8)+(full?' ⚠超容':'');
      },
      onDrop:function(n,el){
        if(_ro){toast('warn','过去的周只读');return}
        if(!(n.hours>0)){
          toast('warn','「'+n.title+'」未填工时 · 点击工时补填后落日');
          return;
        }
        if(n.overdue&&n.progress<1)updateTask(n,{makeup:el.dataset.dk});
        else assignPeriod(n,'d',el.dataset.dk);
        renderWeek();
        splashBubble(document.querySelector('#wkDayRail .wk-day[data-dk="'+el.dataset.dk+'"]'));
        var load=dayLoad(el.dataset.dk),cap=dayCap(el.dataset.dk);
        toast(load>cap?'warn':'ok','已落日 '+el.dataset.dk.slice(5)+' · '+Math.round(load)+'/'+cap+'h');
      }
    },
    reorder:{
      canReorder:function(n){
        if(_ro||n._virtualRoot||n._group)return false;
        if(n.lvl==='temp')return true;
        /* 顶层目标组内：不要求真实父级相同，所有周任务都可调顺序 */
        if(weekGroupOf(n))return true;
        return !!(n.parent&&!n.parent._virtualRoot);
      },
      siblingsOf:function(n){
        if(n.lvl==='temp')return data.temps||[];
        var g=weekGroupOf(n);
        if(g)return g.children;
        return n.parent?n.parent.children:[];
      },
      onReorder:function(n,before,after){
        if(n.lvl==='temp'){
          var arr=data.temps||[];
          var from=arr.indexOf(n);if(from<0)return false;
          var to=before?arr.indexOf(before):arr.length;
          if(to<0)return false;
          if(after)to++;
          if(to>arr.length)to=arr.length;
          if(to===from||to===from+1)return false;
          snapshot();
          arr.splice(from,1);
          if(to>from)to--;
          arr.splice(to,0,n);
          touch();
          renderWeek();
          return true;
        }
        var group=weekGroupOf(n);
        if(group){
          /* 同一顶层目标下的卡片顺序：写 wOrder，不改真实父子关系 */
          var ga=group.children;
          var gf=ga.indexOf(n);if(gf<0)return false;
          var gt=before?ga.indexOf(before):ga.length;
          if(gt<0)return false;
          if(after)gt++;
          if(gt>ga.length)gt=ga.length;
          if(gt===gf||gt===gf+1)return false;
          snapshot();
          ga.splice(gf,1);
          if(gt>gf)gt--;
          ga.splice(gt,0,n);
          ga.forEach(function(x,i){var r=x._real||x;r.wOrder=i});
          touch();
          renderWeek();
          return true;
        }
        var node=n._real||n;
        var b=before?(before._real||before):null;
        var ok=reorderSibling(node,b,after);
        if(ok)renderWeek();
        return ok;
      }
    }
  });

  renderDayRail(days,t0);
  renderWeekStrip();

  if(keepScroll){
    var se2=document.querySelector('#wkCanvasArea .dc-scroll');
    if(se2){se2.scrollLeft=keepScroll.l;se2.scrollTop=keepScroll.t}
  }
}

/* 外部入口：月详情点周度球 → 指定选中周后进周视图（§7.0） */
export function setWeek(wkKey){if(wkKey)wk=wkKey}

/* 仅刷新泡泡（工时增删后负载变化），不动画布——视角与编辑状态不受影响 */
function refreshDayRail(){
  renderDayRail(weekDays(wk),today());
  renderWeekStrip();
}

/* ---------- 底部周度条（§7.0：上月+本月+下月跨月连续，月↔周切换纽带） ---------- */
function renderWeekStrip(){
  var wrap=document.getElementById('wkWeeks');
  if(!wrap)return;
  var curMk=monthOf(wk);
  var curW=today().w;
  var h='';
  weekStripWeeks(curMk).forEach(function(it,i){
    var isCur=it.wk===curW;
    h+='<div class="wk-wb'+(it.wk===wk?' sel':'')+(isCur?' cur-week':'')+
      (it.first?' mstart':'')+'" data-wk="'+it.wk+
      '" data-rise style="--i:'+i+';--rise-base:130ms"'+
      ' title="'+(isCur?'本周 · ':'')+'点选周 · 再点当前周回宏观规划">'+
      (it.first?'<span class="wb-m">'+(+it.mk.slice(5))+'月</span>':'')+
      '<span>'+weekLabel(it.mk,it.wk)+(isCur?' · 本周':'')+'</span></div>';
  });
  wrap.innerHTML=h;
  wrap.querySelectorAll('.wk-wb').forEach(function(el){
    el.onclick=function(){
      var k=el.dataset.wk;
      if(k===wk)backToPlan(k);          /* 再点当前周 = 回宏观（框收拢飞回为纽带） */
      else{var d2=k>wk?1:-1;wk=k;renderWeek(d2)}   /* 点框选周：画布切换，周度条跟随居中 */
    };
  });
  /* 选中周居中：直接赋值 scrollLeft（瞬时、只滚周度条自身）。
     不用 scrollIntoView——它可能走平滑滚动并连带滚动其他可滚祖先
     （如 7 泡泡行），滑行发生在飞移取矩形之后 → 克隆落位与真身错位 → 文字漂移 */
  var sel=wrap.querySelector('.wk-wb.sel');
  if(sel&&wrap.scrollWidth>wrap.clientWidth){
    var wr=wrap.getBoundingClientRect(),sr=sel.getBoundingClientRect();
    wrap.scrollLeft+=sr.left-wr.left-(wr.width-sr.width)/2;
  }
}

/* 回宏观规划：周度条胶囊 → 月详情周段胶囊的共享元素飞移。
   用临时锚点承接落位，避免隐藏整段日刻度/任务文字。 */
function makePlanWeekAnchors(){
  var map={};
  document.querySelectorAll('#mvWeekTrack .weekcloud').forEach(function(seg){
    var name=seg.querySelector('.wc-name');
    var r=(name||seg).getBoundingClientRect();
    var a=document.createElement('div');
    a.textContent=name?name.textContent:'周';
    a.style.cssText='position:fixed;z-index:130;pointer-events:none;box-sizing:border-box;'+
      'left:'+Math.round(r.left-7)+'px;top:'+Math.round(r.top-5)+'px;'+
      'width:'+Math.round(Math.max(42,r.width+14))+'px;height:24px;'+
      'display:flex;align-items:center;justify-content:center;white-space:nowrap;'+
      'background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-line,rgba(255,255,255,.10));'+
      'border-radius:999px;font:600 9.5px sans-serif;color:var(--bd-text-2,#A7AEC0)';
    document.body.appendChild(a);
    map[seg.dataset.wk]=a;
  });
  return map;
}
function backToPlan(k){
  var mk=monthOf(k);
  var stripEls=[];
  document.querySelectorAll('#wkWeeks .wk-wb').forEach(function(el){
    if(monthOf(el.dataset.wk)===mk)stripEls.push(el);
  });
  var clicked=null;
  stripEls.forEach(function(el){if(el.dataset.wk===k)clicked=el});
  if(clicked)clicked.style.opacity='.55';
  setTimeout(function(){
    /* 起点矩形在切换视图前捕获 */
    var caps=stripEls.map(function(el){return {el:el,rect:el.getBoundingClientRect()}});
    setSelected({mk:mk,wk:k});       /* 落月跟随：回宏观选中该月与该周云团 */
    showView('plan');               /* renderPlan 同步完成，月详情周段已就位 */
    var dest=makePlanWeekAnchors();
    flyWeekBubbles(caps.filter(function(c){return dest[c.el.dataset.wk]})
      .map(function(c){return {fromEl:c.el,fromRect:c.rect,toEl:dest[c.el.dataset.wk]}}));
    setTimeout(function(){
      Object.keys(dest).forEach(function(k2){try{dest[k2].remove()}catch(e){}});
    },1000);
  },50);
}

/* ---------- 底部日分配列 ---------- */
function renderDayRail(days,t0){
  var wrap=document.getElementById('wkDayRail');
  if(!wrap)return;
  var h='';
  days.forEach(function(dk,i){
    var ld=dayLoad(dk),cap=dayCap(dk),pct=cap>0?ld/cap:(ld>0?1:0);
    var cls=pct>=1?'over':pct>=.8?'warn':'ok';
    var isTd=dk===t0.d;
    var wd=new Date(dk.replace(/-/g,'/')).getDay();
    var isWe=(wd===0||wd===6);
    var items=dayItems(dk);
    var strips=items.slice(0,2).map(function(l){
      return '<div class="tstrip" data-strip="1" data-nid="'+l.id+'"'+
        (l.lvl==='temp'?' data-tmp="1"':'')+'>'+
        '<i style="background:'+treeColor(l)+'"></i><span>'+escHtml(l.title)+'</span>'+
        (l.makeup?'<b class="mkb">补</b>':'')+'</div>';
    }).join('');
    if(items.length>2)strips+='<div class="tmore num">+'+(items.length-2)+'</div>';
    if(!items.length)strips='<div class="wk-empty">'+(_ro?'无任务':'＋ 拖入')+'</div>';
    h+='<div class="wk-day '+cls+(isTd?' today':'')+'" data-dk="'+dk+'"'+
      ' data-rise style="--i:'+i+';--rise-base:70ms">'+
      '<div class="wk-daytop"><span class="wk-dw">'+dayLabel(dk).split(' ')[0]+'</span>'+
        '<span class="wk-dd num">'+dk.slice(8)+'</span>'+
        (isTd?'<span class="wk-todaytag">今天</span>':'')+'</div>'+
      '<div class="wk-dayload'+(pct>=1?' over':'')+'" data-cap="'+cap+'"'+(!_ro?
        ' data-role="cap" data-weekend="'+(isWe?1:0)+'" title="点改日容量"':'')+'>'+
        '<span><b>'+Math.round(ld)+'</b>/'+cap+'h</span><span>'+items.length+'项</span></div>'+
      '<div class="wk-daybar"><i style="width:'+Math.min(pct,1)*100+'%"></i></div>'+
      '<div class="wk-daytasks">'+strips+'</div>'+
      '</div>';
  });
  wrap.innerHTML=h;
  wrap.querySelectorAll('.wk-day').forEach(function(b){
    b.onclick=function(){jumpToToday(b.dataset.dk)};
  });
  /* 小字条拖出移出 / 换日（点击不触发日期列跳转） */
  if(!_ro)wrap.querySelectorAll('.tstrip').forEach(function(st){
    st.addEventListener('click',function(e){e.stopPropagation()});
    st.addEventListener('pointerdown',function(e){
      if(e.button!==0)return;
      var n2=resolveNode(st);
      if(!n2)return;
      stripDrag={n:n2,el:st,moved:false,px0:e.clientX,py0:e.clientY};
      window.addEventListener('pointermove',onStripMove);
      window.addEventListener('pointerup',onStripUp);
    });
  });
  /* 日容量点改（点击不触发日期列跳转） */
  wrap.querySelectorAll('.wk-dayload[data-role="cap"]').forEach(function(hh){
    hh.addEventListener('pointerdown',function(e){e.stopPropagation()});
    hh.onclick=function(e){
      e.stopPropagation();
      var cap0=+hh.dataset.cap||0,we=hh.dataset.weekend==='1';
      inlineNum(hh,cap0+'',function(v){
        data.caps=caps();
        data.caps[we?'weekend':'day']=Math.max(0,num(v)||0);
        touch();renderWeek();
      });
    };
  });
}

/* 日期列 → 当日视图：用临时胶囊锚点做共享元素飞移 */
function makeDayAnchors(){
  var map={};
  document.querySelectorAll('#wkDayRail .wk-day').forEach(function(day){
    var dw=day.querySelector('.wk-dw'),dd=day.querySelector('.wk-dd');
    var r=(dw||day).getBoundingClientRect();
    var a=document.createElement('div');
    a.textContent=(dw?dw.textContent:'')+' '+(dd?dd.textContent:'');
    a.style.cssText='position:fixed;z-index:130;pointer-events:none;box-sizing:border-box;'+
      'left:'+Math.round(r.left-6)+'px;top:'+Math.round(r.top-4)+'px;'+
      'width:'+Math.round(Math.max(48,r.width+12))+'px;height:24px;'+
      'display:flex;align-items:center;justify-content:center;white-space:nowrap;'+
      'background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-line,rgba(255,255,255,.10));'+
      'border-radius:999px;font:600 9.5px sans-serif;color:var(--bd-text-2,#A7AEC0)';
    document.body.appendChild(a);
    map[day.dataset.dk]=a;
  });
  return map;
}
function jumpToToday(dk){
  var anchors=makeDayAnchors();
  var keys=Object.keys(anchors);
  if(!keys.length)return;
  if(anchors[dk])anchors[dk].style.opacity='.55';
  setTimeout(function(){
    var caps=keys.map(function(k){
      return {dk:k,el:anchors[k],rect:anchors[k].getBoundingClientRect()};
    });
    setDay(dk);
    showView('today');
    var dest={};
    document.querySelectorAll('#tpDays .bubble').forEach(function(el){dest[el.dataset.dk]=el});
    var pairs=caps.filter(function(c){return dest[c.dk]})
      .map(function(c){return {fromEl:c.el,fromRect:c.rect,toEl:dest[c.dk]}});
    flyWeekBubbles(pairs);
    setTimeout(function(){
      keys.forEach(function(k){try{anchors[k].remove()}catch(e){}});
    },1000);
  },50);
}

/* 数字行内编辑（工时/容量），不依赖 planner */
function inlineNum(el,cur,done){
  var i=document.createElement('input');
  i.className='dc-input';i.value=cur;i.style.width='46px';
  el.textContent='';el.appendChild(i);i.focus();i.select();
  var fin=false;
  var finish=function(v){if(fin)return;fin=true;done(v)};
  i.onblur=function(){finish(i.value.trim()||cur)};
  i.onkeydown=function(e){
    if(e.key==='Enter')finish(i.value.trim()||cur);
    if(e.key==='Escape')finish(cur);
    e.stopPropagation();
  };
}

/* ---------- 节点查找 / 拖拽 ---------- */
function nodeByIdGlobal(id){
  var r=null,isles=getIslands();
  isles.forEach(function(isle){isle.trees.forEach(function(root){
    if(r)return;(function w(n){if(n.id===id)r=n;n.children.forEach(w)})(root)})});
  return r;
}
function tempById(id){
  var ts=data.temps||[];
  for(var i=0;i<ts.length;i++)if(ts[i].id===id)return ts[i];
  return null;
}
function resolveNode(el){
  var id=+el.dataset.nid;
  return el.dataset.tmp?tempById(id):nodeByIdGlobal(id);
}

var wkDrag=null,stripDrag=null;
function bindNodeDrag(vroot){
  var area=document.getElementById('wkCanvasArea');
  if(!area)return;
  area.addEventListener('pointerdown',function(e){
    if(e.button!==0||_ro)return;
    var nodeEl=e.target.closest('.dc-node');
    if(!nodeEl)return;
    if(e.target.closest('.n-plus,.n-x,.dc-input'))return;
    var vm=area._rowMap&&area._rowMap[+nodeEl.dataset.i];
    if(!vm||vm._virtualRoot||vm._group)return;
    var n=vm._real||vm;
    if(!(n.lvl==='month'||n.lvl==='week'||n.lvl==='temp'))return;
    if(!isLeafN(n))return;
    wkDrag={n:n,el:nodeEl,moved:false,px0:e.clientX,py0:e.clientY};
    window.addEventListener('pointermove',onWkDragMove);
    window.addEventListener('pointerup',onWkDragUp);
  });
}
function bubbleAt(px,py){
  var els=document.querySelectorAll('#viewWeek .wk-day');
  for(var i=0;i<els.length;i++){
    var r=els[i].getBoundingClientRect();
    if(px>=r.left&&px<=r.right&&py>=r.top&&py<=r.bottom)return els[i];
  }
  return null;
}
function onWkDragMove(e){
  if(!wkDrag)return;
  if(!wkDrag.moved&&Math.abs(e.clientX-wkDrag.px0)+Math.abs(e.clientY-wkDrag.py0)>5)
    wkDrag.moved=true;
  if(!wkDrag.moved)return;
  wkDrag.el.style.opacity=.45;
  var col=bubbleAt(e.clientX,e.clientY);
  document.querySelectorAll('#viewWeek .wk-day').forEach(function(c){
    c.classList.toggle('drop-in',c===col)});
  _ghost.classList.toggle('no-h',!(wkDrag.n.hours>0));
  _ghost.style.display='block';
  _ghost.style.left=(e.clientX+14)+'px';
  _ghost.style.top=(e.clientY-10)+'px';
  if(!(wkDrag.n.hours>0)){
    _ghost.innerHTML=escHtml(wkDrag.n.title)+' <b>未填工时 \u00b7 落日前须补</b>';
    return;
  }
  var isMk=!!(wkDrag.n.overdue&&wkDrag.n.progress<1);   /* 逾期任务重排 → 补点 */
  var load=col?dayLoad(col.dataset.dk):0;
  var dcap=dayCap(col.dataset.dk);var full=load+(wkDrag.n.hours||0)>dcap;
  _ghost.innerHTML=escHtml(wkDrag.n.title)+' <b>\u2192 '+
    (col?((isMk?'补 ':'')+dayLabel(col.dataset.dk).split(' ')[0]+' '+col.dataset.dk.slice(8)+(full?' \u26A0超容':'')):'拖到泡泡')+'</b>';
}
function onWkDragUp(e){
  if(!wkDrag)return;
  var d=wkDrag;wkDrag=null;
  window.removeEventListener('pointermove',onWkDragMove);
  window.removeEventListener('pointerup',onWkDragUp);
  d.el.style.opacity='';
  _ghost.style.display='none';_ghost.classList.remove('no-h');
  document.querySelectorAll('#viewWeek .wk-day').forEach(function(c){
    c.classList.remove('drop-in')});
  if(!d.moved)return;
  if(_ro){toast('warn','过去的周只读');return}
  if(!(d.n.hours>0)){                            /* 落日必须有工时 */
    d.el.classList.add('need-h');
    setTimeout(function(){d.el.classList.remove('need-h')},1100);
    toast('warn','「'+escHtml(d.n.title)+'」未填工时 \u00b7 点击工时补填后落日');
    return;
  }
  var col=bubbleAt(e.clientX,e.clientY);
  if(col){
    /* 逾期任务原排期冻结为历史锚点，重排只写补点（§8.1） */
    if(d.n.overdue&&d.n.progress<1)updateTask(d.n,{makeup:col.dataset.dk});
    else assignPeriod(d.n,'d',col.dataset.dk);
    renderWeek();
    splashBubble(document.querySelector('#wkDayRail .wk-day[data-dk="'+col.dataset.dk+'"]'));
    var load=dayLoad(col.dataset.dk);
    var tcap=dayCap(col.dataset.dk);toast(load>tcap?'warn':'ok','已落日 '+col.dataset.dk.slice(5)+' \u00b7 '+Math.round(load)+'/'+tcap+'h');
  }
}
/* 落水挤压：任务入泡后泡泡回弹一下（lx-splash，§动效） */
function splashBubble(el){
  if(!el)return;
  el.classList.remove('splash');
  void el.offsetWidth;
  el.classList.add('splash');
  setTimeout(function(){el.classList.remove('splash')},480);
}
function onStripMove(e){
  if(!stripDrag)return;
  if(!stripDrag.moved&&Math.abs(e.clientX-stripDrag.px0)+Math.abs(e.clientY-stripDrag.py0)>5)
    stripDrag.moved=true;
  if(!stripDrag.moved)return;
  stripDrag.el.style.opacity=.5;
  var col=bubbleAt(e.clientX,e.clientY);
  document.querySelectorAll('#viewWeek .wk-day').forEach(function(c){
    c.classList.toggle('drop-in',c===col)});
  _ghost.style.display='block';
  _ghost.style.left=(e.clientX+14)+'px';
  _ghost.style.top=(e.clientY-10)+'px';
  var isMk=!!(stripDrag.n.overdue&&stripDrag.n.progress<1);
  var curDay=isMk?(stripDrag.n.makeup||effD(stripDrag.n)):effD(stripDrag.n);
  _ghost.innerHTML=escHtml(stripDrag.n.title)+' <b>'+
    (col?(col.dataset.dk===curDay?'同一天':(isMk?'补 ':'')+dayLabel(col.dataset.dk).split(' ')[0]+' '+col.dataset.dk.slice(8))
        :(isMk?'松手清除补点':'松手移出落日'))+'</b>';
}
function onStripUp(e){
  if(!stripDrag)return;
  var d=stripDrag;stripDrag=null;
  window.removeEventListener('pointermove',onStripMove);
  window.removeEventListener('pointerup',onStripUp);
  d.el.style.opacity='';
  _ghost.style.display='none';
  document.querySelectorAll('#viewWeek .wk-day').forEach(function(c){
    c.classList.remove('drop-in')});
  if(!d.moved)return;
  var col=bubbleAt(e.clientX,e.clientY);
  var isMk=!!(d.n.overdue&&d.n.progress<1);
  var curDay=isMk?(d.n.makeup||effD(d.n)):effD(d.n);
  if(col){
    if(col.dataset.dk===curDay)return;
    if(isMk)updateTask(d.n,{makeup:col.dataset.dk});   /* 逾期重排 → 补点（原排期冻结） */
    else assignPeriod(d.n,'d',col.dataset.dk);
    toast('ok','「'+escHtml(d.n.title)+'」'+(isMk?'补点 ':'落日 ')+col.dataset.dk.slice(5));
  }else{
    if(d.n.lvl==='temp'){d.n.assignD=null;d.n.assignW=null;touch()}
    else if(isMk){updateTask(d.n,{makeup:null});toast('ok','「'+escHtml(d.n.title)+'」已清除补点（原排期保留）')}
    else{unassignPeriod(d.n,'d');toast('ok','「'+escHtml(d.n.title)+'」已移出落日')}
  }
  renderWeek();
}

/* ---------- 临时任务弹窗 / toast ---------- */
function openDecompDlg(title,cb){
  var d=document.getElementById('wkDlg2');
  document.getElementById('wkDlg2T').textContent=title;
  document.getElementById('wkDlg2Name').value='';
  document.getElementById('wkDlg2H').value='';
  d.style.display='block';
  document.getElementById('wkDlg2Name').focus();
  dlgCb=cb;
}
function toast(kind,msg){
  var ICONS={ok:'var(--lx-ok,#4CC38A)',warn:'var(--lx-warn,#D9A13E)'};
  var wrap=document.querySelector('.toast-wrap');
  if(!wrap){wrap=document.createElement('div');wrap.className='toast-wrap';
    wrap.style.cssText='position:fixed;bottom:22px;right:22px;z-index:100;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(wrap)}
  var t=document.createElement('div');
  t.style.cssText='display:flex;align-items:center;gap:10px;min-width:220px;padding:10px 14px;'+
    'border-radius:8px;background:var(--lx-bg-2);border:1px solid var(--lx-line-2);'+
    'box-shadow:0 12px 40px rgba(0,0,0,.55);font-size:11.5px;color:var(--lx-text-1);pointer-events:auto';
  t.innerHTML='<i style="width:7px;height:7px;border-radius:50%;flex:none;background:'+ICONS[kind]+
    ';box-shadow:0 0 8px '+ICONS[kind]+'"></i><span>'+msg+'</span>';
  wrap.appendChild(t);
  setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .24s';
    setTimeout(function(){t.remove()},260)},2400);
}
document.addEventListener('keydown',function(e){
  if(state.view!=='week'||e.key!=='Escape')return;
  var d=document.getElementById('wkDlg2');
  if(d&&d.style.display==='block'){d.style.display='none';dlgCb=null}
});
