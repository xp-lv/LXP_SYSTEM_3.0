import {markRendered as viewsMark} from './views.js';
import {state,data} from './state.js';
import {addSubtask,updateTask,removeNode,renameNode,assignPeriod,unassignPeriod,snapshot,unassignFromMonthDeep,reorderSibling} from './mutations.js';
import {monthWeeks,weekLabel,monthOf,today,effM,effW} from './calendar.js';
import {escHtml} from './utils.js';
import {createDecomposer} from './modules/decomposer.js';
import * as q from './queries.js';
import {renderMonths} from './monthcards.js';
import {renderDetail,cancelMvAdd,mvAddActive} from './monthview.js';
import {getIslands,getDomains,getActiveIsland,addDomain,renameDomain,activateTree,activateIsland,plantTree,canPlant,TREE_CAP,treeIndexOf,treeColorOf,removeTree} from './world.js';

/* ================= 宏观规划（planner.js） =================
   planner5 交互的正式版，数据直接挂在当前树（data.root）上：
   主目标=root · 二级=root.children · 三级=其 children · 叶子持 hours/assignM/assignW。
   全部写操作经 mutations → derive/layout/rebuild，3D 世界自动保持一致。
   规则：只有叶子能被划分（悬停＋）、只有叶子能拖到月度、月里只显示任务本级。 */

/* 月卡滚动窗口：本月 + 往后 6 个月，随渲染时点推进（长开跨月也会换窗） */
export var MONTHS=[];
export function refreshMonthWindow(){
  MONTHS.length=0;
  var now=new Date();
  for(var m0=0;m0<7;m0++){
    var _d=new Date(now.getFullYear(),now.getMonth()+m0,1);
    var _k=_d.getFullYear()+'-'+String(_d.getMonth()+1).padStart(2,'0');
    MONTHS.push({key:_k,name:(_d.getMonth()+1)+'月'});
  }
}
refreshMonthWindow();

/* 顶层目标识别色：全部取自 --lx-* token 同源色（accent/语义/物候/域），低饱和不抢戏 */
var PALETTE=['#8B96F8','#4CC38A','#D9A13E','#E5696F','#5B9BE6','#E8A4C4','#74A95C','#D97618'];
var selected=null;   // {node, mk} 或 {mk}（月详情）
export function getSelected(){return selected}
export function setSelected(v){selected=v}
/* mvAdd 已随月详情组件移入 monthview.js */
var _cssDone=false,_ghost=null;
var elPlan=null,elCanvas=null;

/* ---------- 模型工具 ---------- */
export function mLabel(mk){return (+mk.slice(5))+'月'}
export function isLeaf(n){return q.isLeaf(n)}
export function leavesUnder(n){return q.leavesUnder(n)}
export function monthLeafSum(t,mk){return q.monthLeafSum(t,mk)}
export function countMonthLeaves(t,mk){return q.countMonthLeaves(t,mk)}
export function nearestTop(n){return q.nearestTop(n)||data.root}
function treeLeaves(){return data.root?q.treeLeaves(data.root):[]}
function topBranchOf(n){var x=n;while(x.parent&&x.parent!==data.root)x=x.parent;return x}
export function colorOf(n){
  var t=topBranchOf(n);
  if(!t)return PALETTE[0];
  /* 颜色绑定任务 id，而不是 root.children 下标：同级排序后不换色 */
  var id=parseInt(t.id,10);
  if(!isNaN(id))return PALETTE[Math.abs(id)%PALETTE.length];
  var key=String(t.title||'');
  var h=0;
  for(var i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))|0;
  return PALETTE[Math.abs(h)%PALETTE.length];
}
/* 月度框只显示顶层目标任务（lvl=top）；被月度分解的显示其月度任务汇总 */
export function monthTopEntries(mk){return q.monthTopEntries(data.root,mk)}
/* 月负载：顶层叶子直接计；已分解的顶层按其月度任务计（不重复）；独立月度任务另计 */
export function monthLoad(mk){return q.monthLoad(data.root,mk)}
export function monthHasAssign(mk){return q.monthHasAssign(data.root,mk)}
export function num(v){var n=parseFloat(v);return isNaN(n)?0:Math.max(0,Math.round(n*10)/10)}

/* ---------- 页面骨架与样式 ---------- */
function injectCSS(){
  if(_cssDone)return;_cssDone=true;
  var css=document.createElement('style');css.textContent=`
#viewPlan{display:none}
#viewPlan .pl-grid{display:grid;grid-template-columns:2fr 3fr;grid-template-rows:3fr 2fr;
  gap:8px;height:100%;padding:8px;box-sizing:border-box}
#viewPlan .pl-zone{position:relative;border:1px solid var(--lx-line-1);border-radius:var(--lx-r-lg);display:flex;
  flex-direction:column;overflow:hidden;min-height:0;
  background:linear-gradient(180deg,rgba(255,255,255,.048),rgba(255,255,255,.012));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 14px 44px rgba(0,0,0,.38)}
#viewPlan .pl-zlabel{font-size:10px;font-weight:600;letter-spacing:.16em;padding:11px 16px 5px;flex:none;
  color:var(--lx-text-3);display:flex;align-items:center;gap:7px}
#viewPlan .pl-zlabel::before{content:'';width:5px;height:5px;border-radius:50%;flex:none;
  background:var(--lx-text-4)}
#viewPlan .pl-body{flex:1;position:relative;overflow:hidden;padding:0}
#viewPlan #plGoals{grid-column:1;grid-row:1;border-color:rgba(139,150,248,.16);
  background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,0)),rgba(139,150,248,.065)}
#viewPlan #plGoals .pl-zlabel{color:var(--lx-text-2)}
#viewPlan #plGoals .pl-zlabel::before{background:var(--lx-accent);box-shadow:0 0 6px rgba(122,134,248,.6)}
#viewPlan #plMonths{grid-column:1;grid-row:2}
#viewPlan #plMonths .pl-zlabel::before{background:var(--lx-ph-sprout)}
#viewPlan #plDetail{grid-column:2;grid-row:1/3}
#viewPlan #plDetail .pl-zlabel::before{background:var(--lx-text-3)}
/* ---- 目标画布挂载点 ---- */
/* ---- 领域·树切换条 / 下拉 / 空树引导态（§3.3/§3.7） ---- */
#plTreeBar{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:500}
.ptb-drop{cursor:pointer;color:var(--bd-text-2,#A7AEC0);border:1px solid var(--bd-line);
  border-radius:999px;padding:2px 10px;white-space:nowrap;transition:color .15s,border-color .15s}
.ptb-drop:hover{color:var(--bd-text);border-color:var(--bd-line-strong)}
.ptb-new{cursor:pointer;color:var(--bd-accent,#8B96F8);padding:2px 8px;border-radius:999px}
.ptb-new:hover{background:rgba(139,150,248,.10)}
.pl-tree-menu{position:fixed;z-index:80;min-width:230px;max-height:420px;overflow-y:auto;
  background:var(--bd-surface-2);border:1px solid var(--bd-line);
  border-radius:var(--bd-r-zone);box-shadow:var(--bd-shadow-float);padding:8px}
.pl-tree-menu .ptm-head{font-size:10px;color:var(--bd-text-3);letter-spacing:.1em;padding:4px 8px 6px}
.pl-tree-menu .ptm-isle{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600;
  color:var(--bd-text-2,#A7AEC0);padding:6px 8px 3px}
.pl-tree-menu .ptm-isle i{width:8px;height:8px;border-radius:50%;flex:none}
.pl-tree-menu .ptm-isle em{font-style:normal;font-size:9.5px;color:var(--bd-text-3);margin-left:auto}
.pl-tree-menu .ptm-isle-add{flex:none;width:18px;height:18px;border-radius:5px;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:400;
  color:var(--bd-text-3);transition:all .12s;user-select:none}
.pl-tree-menu .ptm-isle-add:hover{color:var(--bd-accent);background:rgba(139,150,248,.10)}
.pl-tree-menu .ptm-tree{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--bd-text-2);
  padding:6px 10px 6px 22px;border-radius:7px;cursor:pointer}
.pl-tree-menu .ptm-tree:hover{background:rgba(255,255,255,.04);color:var(--bd-text)}
.pl-tree-menu .ptm-tree.on{color:var(--bd-text);background:rgba(139,150,248,.10)}
.pl-tree-menu .ptm-tree b{width:6px;height:6px;border-radius:50%;flex:none}
.pl-tree-menu .ptm-tree.none{color:var(--bd-text-3);cursor:default;font-size:10.5px}
.pl-tree-menu .ptm-x{margin-left:auto;font-size:13px;color:var(--bd-text-3);padding:0 4px;flex:none}
.pl-tree-menu .ptm-x:hover{color:var(--lx-danger,#E5667A)}
.pl-empty-tree{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:6px;text-align:center}
.pl-empty-tree .et-icon{font-size:30px;opacity:.85;color:var(--bd-text-3)}
.pl-empty-tree .et-t{font-size:13.5px;font-weight:600;color:var(--bd-text-2,#A7AEC0)}
.pl-empty-tree .et-sub{font-size:10.5px;color:var(--bd-text-3,#6E7689);margin-bottom:8px}
.pl-empty-tree .et-btn{font-size:11.5px;color:var(--bd-accent);border:1px solid color-mix(in srgb,var(--bd-accent) 40%,var(--bd-line));
  background:transparent;border-radius:8px;padding:6px 16px;cursor:pointer}
.pl-empty-tree .et-btn:hover{background:rgba(139,150,248,.10)}
/* .pt-np 弹层样式已迁 chrome.css（全局）——今日页 tmpPrompt 也用同一组件，
   之前样式只在 planner 注入，直进今日页时弹层裸排到文档流底部 */
#plCanvas{position:absolute;inset:0}
/* ---- 月度 ---- */
#plMonthTrack{display:flex;gap:10px;height:100%;align-items:stretch;
  overflow-x:auto;overflow-y:hidden;padding:0 12px 10px}
#plMonthTrack::-webkit-scrollbar{height:5px}
#plMonthTrack::-webkit-scrollbar-thumb{background:var(--lx-line-2);border-radius:3px}
.month-card{flex:none;width:176px;
  background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.016));
  border:1px solid var(--lx-line-1);border-radius:var(--lx-r-lg);display:flex;
  flex-direction:column;cursor:default;user-select:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04);
  transition:border-color .16s,box-shadow .16s,transform .16s}
.month-card:hover{transform:translateY(-1px);border-color:var(--lx-line-2);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 12px 32px rgba(0,0,0,.46)}
.month-card.drop{border-color:var(--lx-ok);box-shadow:0 0 0 1px rgba(76,195,138,.35)}
.month-card.sel{border-color:rgba(139,150,248,.5);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 0 0 1px rgba(139,150,248,.24),
    0 12px 36px rgba(90,99,232,.24)}
.month-card.sel .mc-name{color:var(--lx-accent)}
.mc-head{padding:9px 12px 6px;border-bottom:1px solid var(--lx-line-1);flex:none}
.mc-head .mc-name{font-size:15px;font-weight:700;letter-spacing:-.01em;color:var(--lx-text-1)}
.mc-head .mc-hrs{font-size:10px;color:var(--lx-text-3);margin-top:1px}
.mc-head .mc-hrs.over{color:var(--lx-danger)}
.mc-tasks{flex:1;padding:6px 8px;overflow-y:auto;min-height:0}
.mc-leaf{display:flex;align-items:center;gap:6px;padding:4px 8px;
  border-radius:var(--lx-r-sm);margin-bottom:2px;cursor:pointer;transition:background .1s}
.mc-leaf:hover{background:var(--lx-hover)}
.mc-leaf .mt-dot{width:6px;height:6px;border-radius:50%;flex:none}
.mc-leaf .mt-name{flex:1;font-size:11.5px;color:var(--lx-text-2);white-space:nowrap;
  overflow:hidden;text-overflow:ellipsis}
.mc-leaf .mt-h{font-size:10px;color:var(--lx-text-3);cursor:pointer;padding:1px 4px;border-radius:3px}
.mc-leaf .mt-h:hover{background:var(--lx-line-1);color:var(--lx-accent)}
.mc-leaf .mt-h.z{color:var(--lx-warn)}
.mc-leaf .mt-x{display:none;font-size:12px;color:var(--lx-text-3);cursor:pointer;padding:0 1px}
.mc-leaf:hover .mt-x{display:block}
.mc-leaf .mt-x:hover{color:var(--lx-danger)}
.mc-empty{color:var(--lx-text-4);font-size:10px;text-align:center;padding:16px 0 8px;
  letter-spacing:.05em}
/* ---- 月详情（遗留样式，供月卡/详情复用） ---- */
#plDetailBody{display:flex;gap:20px;height:100%;align-items:flex-start}
/* ---- 弹窗/输入 ---- */
.pl-input{background:var(--lx-bg-3);border:1px solid var(--lx-line-2);border-radius:var(--lx-r-sm);
  color:var(--lx-text-1);padding:2px 6px;font-size:12px;font-family:inherit;outline:none}
.pl-input:focus{border-color:rgba(139,150,248,.55)}
#plGhost#plGhost{position:fixed;z-index:99;pointer-events:none;display:none;
  background:var(--lx-bg-2);border:1px solid;border-radius:var(--lx-r-md);padding:5px 10px;
  font-size:11px;color:var(--lx-text-2);box-shadow:0 4px 16px rgba(0,0,0,.5);white-space:nowrap}
`;
  document.head.appendChild(css);
  var css2=document.createElement('style');
  css2.textContent=`
#viewPlan{background:var(--lx-bg-0)}
#viewPlan .pl-wrap{height:100%;display:flex;flex-direction:column;padding:12px 16px 14px;box-sizing:border-box;gap:10px}
#viewPlan .pl-head{flex:none;display:flex;align-items:center;gap:16px;height:42px;padding:0 2px 8px;min-width:0;border-bottom:1px solid var(--bd-line)}
#viewPlan .pl-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:650;color:var(--bd-text);letter-spacing:.01em;white-space:nowrap}
#viewPlan .pl-title i{width:7px;height:7px;border-radius:50%;background:var(--bd-accent);flex:none}
#viewPlan .pl-title small{font-size:9.5px;font-weight:500;color:var(--bd-text-3);letter-spacing:.04em;margin-left:2px}
#viewPlan .pl-head-mid{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden}
#viewPlan #plTreeBar{display:flex;align-items:center;gap:8px;font-size:11px;min-width:0;overflow:hidden}
#viewPlan .ptb-drop{max-width:min(42vw,520px);overflow:hidden;text-overflow:ellipsis}
#viewPlan .pl-stats{display:flex;align-items:center;gap:6px;flex:none}
#viewPlan .pl-stat{display:inline-flex;align-items:baseline;gap:4px;padding:4px 9px;border:1px solid var(--bd-line);border-radius:999px;background:transparent;font-size:9.5px;color:var(--bd-text-3);white-space:nowrap}
#viewPlan .pl-stat b{font-size:11.5px;font-weight:650;color:var(--bd-text);font-variant-numeric:tabular-nums}
#viewPlan .pl-stat.warn{border-color:rgba(217,161,62,.30);color:var(--lx-warn)}
#viewPlan .pl-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,1fr);grid-template-rows:minmax(0,1fr) auto;gap:14px;height:auto;padding:0;box-sizing:border-box}
/* 画板即边框：外层不再套一层卡片，避免“框中框”的厚重感 */
#viewPlan .pl-zone{background:transparent;border:0;border-radius:0;box-shadow:none;overflow:visible;min-height:0}
#viewPlan #plGoals{grid-column:1;grid-row:1;background:transparent}
#viewPlan #plMonths{grid-column:1;grid-row:2;background:transparent}
#viewPlan #plDetail{grid-column:2;grid-row:1/3;background:transparent}
#viewPlan .pl-zhead{display:flex;align-items:center;gap:10px;height:34px;padding:0 2px 8px;border-bottom:0;flex:none;min-width:0}
#viewPlan .pl-zlabel{font-size:10px;font-weight:650;letter-spacing:.14em;color:var(--bd-text-2);display:flex;align-items:center;gap:7px;flex:none}
#viewPlan .pl-zlabel::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--bd-text-3);flex:none}
#viewPlan #plGoals .pl-zlabel::before{background:var(--bd-accent)}
#viewPlan #plMonths .pl-zlabel::before{background:var(--lx-ph-sprout)}
#viewPlan #plDetail .pl-zlabel::before{background:var(--bd-text-3)}
#viewPlan .pl-zhint{margin-left:auto;font-size:9.5px;color:var(--bd-text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#viewPlan .pl-depth-rail{display:flex;align-items:center;gap:6px;font-size:9px;color:var(--bd-text-3);letter-spacing:.03em;white-space:nowrap;margin-left:4px}
#viewPlan .pl-depth-rail span{color:var(--bd-text-2)}
#viewPlan .pl-depth-rail i{font-style:normal;color:var(--bd-text-3);font-size:10px}
#viewPlan .pl-zactions{position:absolute;top:54px;right:12px;z-index:6;
  display:flex;align-items:center;gap:8px;min-width:0;
  padding:3px 4px 3px 10px;background:rgba(26,31,42,.88);border:1px solid var(--bd-line);
  border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.28);backdrop-filter:blur(8px)}
#viewPlan .pl-legend{display:flex;align-items:center;gap:10px;font-size:9.5px;color:var(--bd-text-3);white-space:nowrap}
#viewPlan .pl-legend span{display:inline-flex;align-items:center;gap:4px}
#viewPlan .pl-legend i{width:5px;height:5px;border-radius:50%;flex:none}
#viewPlan .pl-fitbtn{border:0;background:transparent;color:var(--bd-text-2);border-radius:0;padding:4px 8px;font:inherit;font-size:9.5px;cursor:pointer;white-space:nowrap}
#viewPlan .pl-fitbtn:hover{color:var(--bd-text);background:rgba(255,255,255,.045)}
#viewPlan .pl-fitbtn+.pl-fitbtn{border-left:1px solid var(--bd-line)}
#viewPlan .pl-zoom{display:flex;align-items:center;gap:0;border:0;border-radius:0;background:transparent;overflow:visible}
#viewPlan .pl-body{flex:1;min-height:0;position:relative;overflow:hidden;padding:0;background:transparent}
#viewPlan #plGoals .pl-body{background:transparent}
#viewPlan #plDetail .pl-body,#viewPlan #plDetailBody{background:transparent}
/* 月度分配：飞书甘特式连续月份时间线（列 = 月份，不是七张独立卡片） */
#viewPlan #plMonthTrack{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(88px,1fr);
  gap:0;height:clamp(140px,16vh,168px);overflow-x:auto;overflow-y:hidden;
  padding:0;box-sizing:border-box;background:var(--bd-canvas);
  scrollbar-width:none}
#viewPlan #plMonthTrack::-webkit-scrollbar{display:none}
#viewPlan .month-card{position:relative;min-width:0;width:auto;height:100%;
  display:flex;flex-direction:column;border:0;border-right:1px solid var(--bd-line);
  border-radius:0;background:transparent;box-shadow:none;
  transition:background .16s}
#viewPlan .month-card:last-child{border-right:0}
#viewPlan .month-card:hover{background:rgba(255,255,255,.022);transform:none}
#viewPlan .month-card.sel{background:rgba(139,150,248,.055);box-shadow:inset 0 -2px 0 var(--bd-accent)}
#viewPlan .month-card.sel .mc-name{color:var(--bd-accent)}
#viewPlan .month-card.now{box-shadow:inset 0 2px 0 rgba(76,195,138,.45)}
#viewPlan .month-card.now.sel{box-shadow:inset 0 -2px 0 var(--bd-accent),inset 0 2px 0 rgba(76,195,138,.45)}
#viewPlan .month-card.dc-drop-in{outline:0;background:rgba(139,150,248,.10);box-shadow:inset 0 0 0 1px var(--bd-accent)}
#viewPlan .mc-head{padding:9px 10px 7px;border-bottom:1px solid var(--bd-line);flex:none}
#viewPlan .mc-title{display:flex;align-items:center;gap:5px;min-width:0}
#viewPlan .mc-name{font-size:12px;font-weight:650;letter-spacing:-.01em;color:var(--bd-text);line-height:1.2}
#viewPlan .mc-badge{font-size:8px;font-weight:600;color:var(--lx-ph-green);background:rgba(76,195,138,.10);border:1px solid rgba(76,195,138,.24);border-radius:999px;padding:1px 4px;white-space:nowrap}
#viewPlan .mc-sub{display:flex;justify-content:space-between;gap:4px;font-size:8.5px;color:var(--bd-text-3);margin-top:3px;font-variant-numeric:tabular-nums}
#viewPlan .mc-load{height:2px;margin:0;border-radius:0;background:rgba(255,255,255,.06);overflow:hidden;flex:none}
#viewPlan .mc-load i{display:block;height:100%;border-radius:0;background:var(--bd-accent)}
#viewPlan .month-card.now .mc-load i{background:var(--lx-ph-green)}
#viewPlan .mc-tasks{flex:1;display:flex;flex-direction:column;gap:4px;padding:6px 8px;overflow-y:auto;min-height:0;
  scrollbar-width:none}
#viewPlan .mc-tasks::-webkit-scrollbar{display:none}
#viewPlan .month-card.empty .mc-tasks{justify-content:center}
#viewPlan .mc-leaf{display:flex;align-items:center;gap:6px;min-height:24px;padding:0 7px;
  border:1px solid var(--bd-line);border-radius:6px;background:var(--bd-surface);
  margin:0;cursor:pointer;transition:background .12s,border-color .12s}
#viewPlan .mc-leaf:hover{background:var(--bd-surface-2);border-color:var(--bd-line-strong)}
#viewPlan .mc-leaf .mt-dot{width:5px;height:5px;border-radius:50%;flex:none}
#viewPlan .mc-leaf .mt-name{flex:1;font-size:10px;color:var(--bd-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4}
#viewPlan .mc-leaf .mt-x{display:none;font-size:11px;color:var(--bd-text-3);cursor:pointer;padding:0 1px;flex:none}
#viewPlan .mc-leaf:hover .mt-x{display:block}
#viewPlan .mc-leaf .mt-x:hover{color:var(--lx-danger)}
#viewPlan .mc-more{font-size:8.5px;color:var(--bd-text-3);padding:2px 4px 0;letter-spacing:.03em}
#viewPlan .mc-empty{margin:2px 0 0;padding:8px 2px;border:1px dashed var(--bd-line);border-radius:6px;
  color:var(--bd-text-3);font-size:9px;text-align:center;letter-spacing:.04em}
#viewPlan .mc-empty:hover{border-color:var(--bd-line-strong);color:var(--bd-text-2)}
#viewPlan .pl-deep-badge{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:999px;border:1px solid var(--bd-line);background:transparent;font-size:8.5px;color:var(--bd-text-3);white-space:nowrap;vertical-align:middle}
#viewPlan .ptb-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--lx-ph-sprout);margin-right:5px;vertical-align:middle}
#viewPlan .ptb-dot.off{background:var(--bd-text-3)}
#viewPlan .pl-mdot{display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:5px;vertical-align:middle;flex:none}
#viewPlan .dc-node{border-radius:var(--bd-r-node);padding:8px 12px 7px 10px;max-width:206px}
#viewPlan .dc-node.root{padding:10px 14px 9px 12px;border-width:1.5px}
#viewPlan .dc-node.dc-virtual{padding:7px 16px 6px 14px;border-radius:999px}
#viewPlan .dc-node .n-name{font-size:12.5px;font-weight:600;max-width:170px}
#viewPlan .dc-node.root .n-name{font-size:13.5px;max-width:160px}
#viewPlan .dc-node .n-meta{font-size:9.5px}
#viewPlan .pl-empty-tree{margin:22px;border:1px dashed var(--bd-line);border-radius:var(--bd-r-zone);background:transparent}
#viewPlan .pl-placeholder{height:100%;display:flex;align-items:center;justify-content:center;color:var(--bd-text-3);font-size:11px;background:transparent}
#viewPlan .mv-layout{background:transparent}
#viewPlan .mv-kpis{position:static;display:flex;align-items:center;gap:4px;flex:none;
  padding:0;border:0;background:transparent;box-shadow:none}
#viewPlan .mv-kpi{display:inline-flex;align-items:baseline;gap:4px;font-size:9.5px;color:var(--bd-text-3);padding:3px 8px;border:1px solid var(--bd-line);border-radius:999px;background:transparent;white-space:nowrap}
#viewPlan .mv-kpi b{font-size:11px;color:var(--bd-text);font-weight:650;font-variant-numeric:tabular-nums}
#viewPlan .mv-canvas-area{background:transparent}
@media(max-width:1450px){
  /* 中等宽度：画布变矮，工具条回到标题行，避免压住顶部节点 */
  #viewPlan .pl-zactions{position:static;top:auto;right:auto;margin-left:auto;box-shadow:none}
}
@media(max-width:1180px){
  #viewPlan .pl-grid{grid-template-columns:minmax(0,1fr) minmax(320px,.8fr)}
  #viewPlan .pl-legend{display:none}
  #viewPlan .pl-depth-rail{display:none}
}
@media(max-width:1180px){
  #viewPlan .pl-wrap{overflow:auto}
  #viewPlan .pl-grid{display:flex;flex-direction:column;min-height:0}
  #viewPlan #plGoals{flex:none;min-height:460px}
  #viewPlan #plMonths{flex:none;height:auto}
  #viewPlan #plDetail{flex:none;height:420px}
  #viewPlan .pl-stats{display:none}
}
`;
  document.head.appendChild(css2);
  _ghost=document.createElement('div');_ghost.id='plGhost';
  document.body.appendChild(_ghost);
}

/* ================= 主渲染 ================= */
export function renderPlan(){
  try{viewsMark()}catch(e){}
  injectCSS();
  refreshMonthWindow();                          /* 月窗随渲染时点推进 */
  if(!elPlan){
    elPlan=document.getElementById('viewPlan');
    elPlan.innerHTML=
      '<div class="pl-wrap">'+
        '<div class="pl-head">'+
          '<div class="pl-title"><i></i>宏观规划<small>目标分解 · 月度分配</small></div>'+
          '<div class="pl-head-mid" id="plTreeBar"></div>'+
          '<div class="pl-stats" id="plStats"></div>'+
        '</div>'+
        '<div class="pl-grid">'+
          '<div class="pl-zone pl-goals" id="plGoals" data-rise style="--i:0">'+
            '<div class="pl-zhead"><div class="pl-zlabel">目标画布</div>'+
              '<div class="pl-depth-rail"><span>顶层目标</span><i>›</i><span>一级</span><i>›</i><span>二级</span></div>'+
              '<div class="pl-zactions" id="plGoalActions"></div></div>'+
            '<div class="pl-body"><div id="plCanvas"></div></div>'+
          '</div>'+
          '<div class="pl-zone pl-months" id="plMonths" data-rise style="--i:1">'+
            '<div class="pl-zhead"><div class="pl-zlabel">月度分配</div>'+
              '<div class="pl-zhint">拖任务到月份 · 滚轮/右键平移</div></div>'+
            '<div class="pl-body" style="display:flex;flex-direction:column"><div id="plMonthTrack"></div></div>'+
          '</div>'+
          '<div class="pl-zone pl-detail" id="plDetail" data-rise style="--i:2">'+
            '<div class="pl-zhead"><div class="pl-zlabel" id="plDetailLabel">月度详情</div>'+
              '<div class="pl-depth-rail"><span>月</span><i>›</i><span>顶级</span><i>›</i><span>月度任务</span></div></div>'+
            '<div class="pl-body" id="plDetailBody" style="overflow:hidden;padding:0"></div>'+
          '</div>'+
        '</div>'+
      '</div>';
    var ga=document.getElementById('plGoalActions');
    if(ga)ga.innerHTML='<span class="pl-legend">'+
      '<span><i style="background:var(--lx-ph-stump)"></i>未分配</span>'+
      '<span><i style="background:var(--lx-ph-sprout)"></i>已落月</span>'+
      '<span><i style="background:var(--lx-ph-blossom)"></i>已排周</span>'+
      '</span><span class="pl-zoom"><button class="pl-fitbtn" id="plZoomOut" type="button">−</button><button class="pl-fitbtn" id="plFit" type="button">适应画布</button><button class="pl-fitbtn" id="plZoomIn" type="button">＋</button></span>';
    elCanvas=document.getElementById('plCanvas');
    bindPlanGlobal();
    /* 月卡区：右键拖动平移（替代滚动条） */
    var mt=document.getElementById('plMonthTrack');
    mt.style.overflow='auto';
    mt.style.cursor='grab';
    mt.addEventListener('contextmenu',function(e){e.preventDefault()});
    mt.addEventListener('wheel',function(e){
      if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){
        e.preventDefault();
        mt.scrollLeft+=e.deltaY;
      }
    },{passive:false});
    mt.addEventListener('pointerdown',function(e){
      if(e.button!==2)return;
      e.preventDefault();
      mt.style.cursor='grabbing';
      var sx=e.clientX,ssl=mt.scrollLeft;
      function mv(ev){mt.scrollLeft=ssl-(ev.clientX-sx)}
      function up(){
        mt.style.cursor='grab';
        window.removeEventListener('pointermove',mv);
        window.removeEventListener('pointerup',up);
      }
      window.addEventListener('pointermove',mv);
      window.addEventListener('pointerup',up);
    });
  }
  renderCanvas();
  renderMonths();
  renderDetail();
  renderStats();
  var fb=document.getElementById('plFit');
  if(fb)fb.onclick=function(){if(canvasInst&&canvasInst.fit)canvasInst.fit()};
  var zo=document.getElementById('plZoomOut');
  if(zo)zo.onclick=function(){if(canvasInst&&canvasInst.zoomBy)canvasInst.zoomBy(-.12)};
  var zi=document.getElementById('plZoomIn');
  if(zi)zi.onclick=function(){if(canvasInst&&canvasInst.zoomBy)canvasInst.zoomBy(.12)};
}

function renderStats(){
  var el=document.getElementById('plStats');
  if(!el)return;
  if(!data.root){el.innerHTML='';return}
  var leaves=q.treeLeaves(data.root);
  var mk=today().m;
  var cur=q.monthTopEntries(data.root,mk).length;
  var sched=leaves.filter(function(l){return !!effW(l)}).length;
  var un=leaves.filter(function(l){return !effM(l)}).length;
  el.innerHTML='<span class="pl-stat"><b>'+cur+'</b> 本月</span>'+
    '<span class="pl-stat"><b>'+sched+'</b> 已排周</span>'+
    '<span class="pl-stat'+(un?' warn':'')+'"><b>'+un+'</b> 未分配</span>';
}

/* ---------- ① 目标画布：可复用分解模块（数据=当前任务树，写操作经 mutations 直通） ---------- */
var canvasInst=null;
/* 领域·树切换条 + 空树引导态（功能说明 §3.3/§3.7） */
function renderTreeBar(){
  var bar=document.getElementById('plTreeBar');
  if(!bar)return;
  var isles=getIslands();
  var h='<span class="ptb-drop" id="ptbCur">'+
    (data.root?('<i class="ptb-dot"></i>'+esc2(treeIndexOf(data.root)?treeIndexOf(data.root).isle.name:'')+' · '+esc2(data.root.title)):'<i class="ptb-dot off"></i>本领域暂无目标')+
    ' ▾</span><span class="ptb-new'+(canPlant()?'':' off')+'" id="ptbNew" '+
    (canPlant()?'':'title="全岛已满（'+TREE_CAP+' 棵）——先完成或删除一棵树"')+'>＋ 新主目标</span>';
  bar.innerHTML=h;
  var cur=document.getElementById('ptbCur');
  if(cur)cur.onclick=function(ev){ev.stopPropagation();toggleTreeMenu()};
  var nw=document.getElementById('ptbNew');
  if(nw)nw.onclick=function(ev){ev.stopPropagation();
    if(!canPlant()){alert('全岛已满（'+TREE_CAP+' 棵）——先完成或删除一棵树再种新的');return}
    promptNewTree()};
}
function activeIsleOf(){
  var isles=getIslands();
  for(var i=0;i<isles.length;i++)
    if(isles[i].trees.indexOf(data.root)>=0)return isles[i];
  return isles[0];
}
function esc2(x){return escHtml(x)}
var _treeMenu=null;
function toggleTreeMenu(){
  if(_treeMenu){closeTreeMenu();return}
  var isles=getIslands();
  var h='<div class="ptm-head">领域 · 目标树</div>';
  isles.forEach(function(isle){
    h+='<div class="ptm-isle'+(isle.id===activeIsleOf().id?' on':'')+'" data-act="'+isles.indexOf(isle)+'" title="激活该领域"><i style="background:#'+isle.color.toString(16).padStart(6,'0')+'"></i>'+
      esc2(isle.name)+'<em>'+isle.trees.length+' 棵</em>'+
      '<span class="ptm-isle-add" data-isle-add="'+isles.indexOf(isle)+'" title="在此领域新增顶层目标">＋</span></div>';
    isle.trees.forEach(function(t,ti){
      h+='<div class="ptm-tree'+(t===data.root?' on':'')+'" data-isle="'+isles.indexOf(isle)+'" data-ti="'+ti+'">'+
        '<b style="background:'+treeColorOf(t)+'"></b>'+esc2(t.title)+
        (t===data.root?'<span class="ptm-x" data-rm="1" title="删除此树（连同全部规划）">×</span>':'')+'</div>';
    });
    if(!isle.trees.length)h+='<div class="ptm-tree none">（空领域）</div>';
  });
  h+='<div class="ptm-domain-ops">'+
    '<span class="ptm-do" data-do="new">＋ 新领域</span>'+
    '<span class="ptm-do" data-do="rename">✎ 改名当前领域</span>'+
    '<span class="ptm-do" data-do="del">× 删除空领域</span></div>';
  var m=document.createElement('div');m.className='pl-tree-menu';m.innerHTML=h;
  document.body.appendChild(m);_treeMenu=m;
  var r=document.getElementById('ptbCur').getBoundingClientRect();
  m.style.left=Math.min(r.left,innerWidth-260)+'px';m.style.top=(r.bottom+6)+'px';
  m.querySelectorAll('.ptm-tree[data-ti]').forEach(function(el){
    el.onclick=function(ev){
      var rm=ev.target.closest('[data-rm]');
      if(rm){
        var t2=getIslands()[+el.dataset.isle].trees[+el.dataset.ti];
        if(!t2)return;
        var undone=0;
        (function w(n){n.children.forEach(function(c){
          if(c.children&&c.children.length)w(c);
          else if(c.progress<1)undone++;
        })})(t2);
        if(!confirm('删除树「'+t2.title+'」？其下全部规划（月/周/日分配）将一并删除。'))return;
        if(undone>0&&!confirm('该树还有 '+undone+' 项未完成——确定仍要整树删除？'))return;  /* 二次确认（§3.3） */
        removeTree(t2);closeTreeMenu();renderPlan();
        return;
      }
      activateIsland(+el.dataset.isle,true);
      activateTree(+el.dataset.ti,false);
      closeTreeMenu();
    };
  });
  m.querySelectorAll('.ptm-isle[data-act]').forEach(function(el){
    el.onclick=function(ev){ev.stopPropagation();
      activateIsland(+el.dataset.act,true);
      closeTreeMenu();renderPlan();
    };
  });
  /* ＋ 在此领域新增顶层目标 */
  m.querySelectorAll('.ptm-isle-add').forEach(function(el){
    el.onclick=function(ev){ev.stopPropagation();
      var targetIsle=getIslands()[+el.dataset.isleAdd];  /* 直接取目标领域 */
      activateIsland(+el.dataset.isleAdd,true);
      closeTreeMenu();
      if(!canPlant()){alert('该领域已满（'+TREE_CAP+' 棵）');return}
      /* 直接用 targetIsle 种树（不依赖 activeDomainId——切换是异步的） */
      inlineText('新主目标名称（领域：'+targetIsle.name+'）',function(name){
        var root=plantTree(targetIsle,name);
        if(!root){toastPlan('该领域树坑已满（'+TREE_CAP+' 棵）');return}
        renderPlan();
      });
    };
  });
  m.querySelectorAll('.ptm-do').forEach(function(el){
    el.onclick=function(ev){ev.stopPropagation();domainOp(el.dataset.do)};
  });
  setTimeout(function(){document.addEventListener('pointerdown',treeMenuOutside,true)},0);
}
/* 领域管理（01.2：纯数据分组，入口=树切换器） */
function domainOp(op){
  if(op==='new'){
    inlineText('新领域名称：',function(name){
      var colors=[0x4C9EFF,0xE8A13A,0x52C41A,0xB37FEB,0xE86A5A,0x36CFC9];
      addDomain(name,colors[getDomains().length%colors.length]);
      renderPlan();
    });
    return;  /* inlineText 是异步的，不关菜单（等回调后再关） */
  }else if(op==='rename'){
    var d=getActiveIsland();
    if(!d)return;
    inlineText('领域改名（当前：'+d.name+'）：',function(nn){
      renameDomain(getDomains().find(function(x){return x.id===d.id}),nn);
      renderPlan();
    });
    return;
  }else if(op==='del'){
    var d2=getActiveIsland();
    if(!d2)return;
    if(d2.trees.length){alert('仅空领域可删除——先移除该领域的树');return}
    if(getDomains().length<=1){alert('至少保留一个领域');return}
    if(!confirm('删除空领域「'+d2.name+'」？'))return;
    var di=getDomains().findIndex(function(x){return x.id===d2.id});
    import('./world.js').then(function(w){
      w.deleteDomainAt(di);
    });
  }
  closeTreeMenu();renderPlan();
}
function treeMenuOutside(ev){
  if(_treeMenu&&!_treeMenu.contains(ev.target)&&!ev.target.closest('#plTreeBar'))closeTreeMenu();
}
function closeTreeMenu(){
  if(_treeMenu){_treeMenu.remove();_treeMenu=null}
  document.removeEventListener('pointerdown',treeMenuOutside,true);
}
function promptNewTree(){
  var isle=activeIsleOf();
  inlineText('新主目标名称（领域：'+isle.name+'）',function(name){
    var root=plantTree(isle,name);
    if(!root){toastPlan('该领域树坑已满（8 棵）· 请开新领域');return}
    renderPlan();
  });
}
/* 轻量命名浮层（种植 / 领域面板共用） */
function inlineText(placeholder,done){
  var ov=document.createElement('div');ov.className='pt-np-ov';
  ov.innerHTML='<div class="pt-np"><div class="t">'+esc2(placeholder)+'</div>'+
    '<input type="text" placeholder="名称…"><div class="btns">'+
    '<button class="no">取消</button><button class="ok">确定</button></div></div>';
  document.body.appendChild(ov);
  var inp=ov.querySelector('input');inp.focus();
  function fin(v){ov.remove();if(v)done(v)}
  ov.querySelector('.no').onclick=function(){fin(null)};
  ov.querySelector('.ok').onclick=function(){fin(inp.value.trim()||null)};
  ov.addEventListener('pointerdown',function(e){if(e.target===ov)fin(null)});
  inp.addEventListener('keydown',function(e){
    if(e.key==='Enter')fin(inp.value.trim()||null);
    if(e.key==='Escape')fin(null);
    e.stopPropagation();
  });
}
export function toastPlan(msg){
  var w=document.querySelector('.toast-wrap');
  if(!w){w=document.createElement('div');w.className='toast-wrap';
    w.style.cssText='position:fixed;bottom:22px;right:22px;z-index:100;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(w)}
  var t=document.createElement('div');
  t.style.cssText='display:flex;align-items:center;gap:10px;min-width:200px;padding:10px 14px;border-radius:8px;background:var(--lx-bg-2,#0E1119);border:1px solid var(--lx-line-2);box-shadow:0 12px 40px rgba(0,0,0,.55);font-size:11.5px;color:var(--lx-text-1,#EDEFF7)';
  t.innerHTML='<i style="width:7px;height:7px;border-radius:50%;background:var(--lx-warn,#D9A13E)"></i>'+msg;
  w.appendChild(t);setTimeout(function(){t.style.opacity='0';t.style.transition='opacity .24s';
    setTimeout(function(){t.remove()},260)},2400);
}
function renderCanvas(){
  if(canvasInst&&canvasInst.getData()!==data.root){
    canvasInst.destroy();canvasInst=null;      /* 切换树后重建 */
  }
  renderTreeBar();
  if(!data.root){                              /* 空树引导态（§3.7） */
    elCanvas.innerHTML='<div class="pl-empty-tree">'+
      '<div class="et-icon">◌</div><div class="et-t">本领域还没有目标树</div>'+
      '<div class="et-sub">一棵树 = 一个主目标，从种下它开始规划</div>'+
      '<div class="et-btn'+(canPlant()?'':' off')+'" id="etPlant">＋ 新主目标</div>'+
      '</div>';
    var b=document.getElementById('etPlant');
    if(b)b.onclick=function(){
      if(!canPlant()){alert('全岛已满（'+TREE_CAP+' 棵）——先完成或删除一棵树再种新的');return}
      promptNewTree();
    };
    return;
  }
  if(!canvasInst){
    canvasInst=createDecomposer(elCanvas,{
      data:data.root,height:'100%',compact:true,
      hint:'空白拖动平移 · 拖卡片同级排序 · 拖叶子到月卡 · 双击改名',
      hoursEditable:false,   /* 宏观画布不展示工时（工时自周度域开始） */
      ops:{
        divide:function(parent,f){
          if(depthOfNode(parent)>=2)return null;
          return addSubtask(parent,{title:f.title,hours:f.hours!=null?f.hours:2,lvl:'top'});
        },
        /* 交互优化：删除带子任务的目标先确认（叶子直接删，可撤销） */
        remove:function(n){
          if(n.children&&n.children.length&&
            !confirm('删除「'+n.title+'」及其全部子任务？'))return false;
          removeNode(n);
          return true;
        },
        rename:function(n,t){renameNode(n,t)},
        setHours:function(n,h){updateTask(n,{hours:h})},
        abandon:function(n,on){
          if(on&&!confirm('放弃「'+n.title+'」？\n将从今日清单、落果/落叶堆和逾期统计中移除；任务保留在树中，可随时恢复。'))return;
          updateTask(n,{abandoned:!!on});
          renderPlan();
        }
      },
      /* 画布只显示根 + 2 层；更深层级折叠保留，不撑宽画布 */
      filter:function(n){return n.lvl!=='month'&&n.lvl!=='week'&&depthOfNode(n)<=2},
      /* 顶级目标最多3级：主目标/二级可再分解，三级封底 */
      canPlus:function(n){return depthOfNode(n)<2},
      canAbandon:function(n){return n!==data.root&&n.leaf&&!n._virtualRoot&&!n._group},
      meta:canvasMeta,
      colorOf:function(n){return n===data.root?null:colorOf(n)},
      isSelected:function(n){return !!(selected&&selected.node===n)},
      onClick:function(n){selectForDetail(n)},
      drag:{
        canDrag:function(n){return n!==data.root&&n.lvl!=='month'&&n.lvl!=='week'&&!n.abandoned},
        dropSelector:'#plMonthTrack .month-card',
        ghostText:function(n,mc){
          return mc
            ?(n.assignM===mc.dataset.mk
              ?n.title+' · 已在该月'
              :n.title+' → '+mLabel(mc.dataset.mk))
            :'拖到月卡分配';
        },
        onDrop:function(n,mc){
          if(n.assignM!==mc.dataset.mk){
            /* 换月=干净重来：其下全部月度/周度分解与分配整体删除，只保留新月的月度分配
               （整段操作前打一次快照，Cmd+Z 一步回到换月前） */
            snapshot();
            (function strip(x){
              x.children=x.children.filter(function(c){
                if(c.lvl==='month'||c.lvl==='week')return false;
                c.makeup=null;               /* R8 已定：换月随删 makeup */
                strip(c);return true});
            })(n);
            if(!n.children.length){n.leaf=true;n.progress=0}
            n.assignM=null;n.assignW=null;n.assignD=null;
            assignPeriod(n,'m',mc.dataset.mk,{noUndo:true});
            renderPlan();
          }
        }
      },
      reorder:{
        canReorder:function(n){return n!==data.root},
        onReorder:function(n,before,after){
          var ok=reorderSibling(n,before,after);
          if(ok)renderPlan();
          return ok;
        }
      }
    });
  }else{
    canvasInst.render();
  }
}
function depthOfNode(n){var d=0;for(var x=n;x&&x.parent;x=x.parent)d++;return d}
/* 宏观画布信息行：只显示落月标记——不展示工时（工时自周度域开始） */
function hiddenGoalCount(n){
  var d0=depthOfNode(n),c=0;
  (function w(x,d){
    (x.children||[]).forEach(function(ch){
      if(ch.lvl==='month'||ch.lvl==='week')return;
      if(d+1>2)c++;
      w(ch,d+1);
    });
  })(n,d0);
  return c;
}
function canvasMeta(n){
  var months={};
  leavesUnder(n).forEach(function(l){if(l.assignM)months[l.assignM]=1});
  var keys=Object.keys(months).sort();
  var dot='<span class="pl-mdot" style="background:'+colorOf(n)+'"></span>';
  var hidden=(depthOfNode(n)===2)?hiddenGoalCount(n):0;
  return dot+(keys.length
    ?'<span style="color:var(--lx-accent,#8B96F8)">'+keys.map(mLabel).join(' · ')+'</span>'
    :'<span style="color:var(--bd-text-3,#6E7689)">未分配</span>')+
    (hidden?'<span class="pl-deep-badge" title="更深层级已折叠，数据保留">更深层级 ×'+hidden+'</span>':'');
}
function selectForDetail(n){
  var mk=n.assignM||(leavesUnder(n).filter(function(l){return l.assignM})[0]||{}).assignM||null;
  selected={node:n,mk:mk};
  renderMonths();renderCanvas();renderDetail();
}
export function nodeById(id){
  var r=null;
  (function w(n){if(n.id===id)r=n;n.children.forEach(w)})(data.root);
  return r;
}

export function inline(el,cur,done,isN){
  var i=document.createElement('input');
  i.className='pl-input';i.value=cur;
  i.style.width=isN?'52px':'150px';
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
function bindPlanGlobal(){
  /* 点输入框和＋以外收起新建框 */
  document.addEventListener('pointerdown',function(ev){
    if(state.view!=='plan')return;
    if(ev.target.closest('.cc-newrow,.cn-plus'))return;
    if(mvAddActive()&&(!getSelected()||!getSelected().node))cancelMvAdd()
  },true);
  document.addEventListener('keydown',function(e){
    if(state.view!=='plan'||e.key!=='Escape')return;
    if(e.target.tagName==='INPUT')return;
    if(cancelMvAdd())return;
    if(selected){selected=null;renderPlan()}
  });
}
