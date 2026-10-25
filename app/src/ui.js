import {state} from './state.js';
import {byId,pathTo} from './data.js';
import {trunc,fmtH} from './utils.js';
import {AGGNAME} from './config.js';
import {rebuild} from './tree.js';
import * as persist from './persistence.js';
import {setHoverLock} from './selection.js';          // 循环依赖：仅运行期（面包屑点击）调用
import {flyTo} from './camera.js';
import {exitPlanet } from './planet.js';    // 循环依赖：仅运行期调用

/* 3D 世界只读观赏：面包屑 + 悬停物候卡；任务编辑一律在三大画布进行。 */

/* ================= 面包屑 ================= */
export function renderCrumb(){
  const el=document.getElementById('crumb');
  if(state.mode==='planet'){
    el.innerHTML='星球模式：<b style="color:#EAF0FA">'+trunc(state.planetRoot.title)+'</b><em>›</em><span id="exitPlanet" style="color:#FF9A9E">返回树模式</span>';
    const x=document.getElementById('exitPlanet');
    if(x)x.onclick=exitPlanet;
    return}

  if(!state.focus){el.innerHTML='视角：<b style="color:#EAF0FA">全景</b>';return}
  el.innerHTML='目标 '+pathTo(state.focus).map(function(n){
    return'<em>›</em><span data-id="'+n.id+'">'+trunc(n.title)+'</span>'}).join('');
  el.querySelectorAll('span').forEach(function(s){s.onclick=function(){
    setFocus(byId(+s.dataset.id));rebuild();flyTo(state.focus)}});
}

/* ================= 悬停物候卡（只读，不展示工时——工时自周度域开始） ================= */
const card=document.getElementById('hoverCard');
export function updateCard(){
  const n=state.hoverLock||state.hovered;
  if(!n){card.style.display='none';return}
  const st=n.leaf?(n.progress>=1?'已完成':(n.bare?'断梢 · 未排期':(n.overdue?'已逾期 · 待补点':'已排期')))
    :(AGGNAME[n.agg]||'分组');
  let chips='<span class="chip'+(n.agg==='overdue'?' red':'')+'">'+st+'</span>';
  if(n.leaf){
    chips+='<span class="chip">'+(n.hours||0)+'h</span>';
    const d=n.makeup||n.assignD;
    const sched=d?d:(n.assignW?('周 '+n.assignW):(n.assignM?('月 '+n.assignM):null));
    chips+='<span class="chip">'+(sched?('排 '+sched):'未排期')+'</span>';
  }else{
    chips+='<span class="chip">Σ '+fmtH(n.H)+'</span>';
  }
  chips+='<span class="chip">含 '+n.leafCount+' 任务</span>';
  if(n.redCount>0)chips+='<span class="chip red">过期 ×'+n.redCount+'</span>';
  card.innerHTML='<div class="hc-title">'+n.title+'</div>'+
    '<div class="hc-path">目标'+pathTo(n).slice(1).map(function(x){return ' › '+trunc(x.title)}).join('')+'</div>'+
    '<div class="hc-chips">'+chips+'</div>';
  card.style.display='block';
  /* 固定位置：右上角（topbar 下方），不跟随鼠标 */
  card.style.left=Math.max(12,innerWidth-card.offsetWidth-14)+'px';
  card.style.top='64px'}

/* ================= 帮助簇收纳（dock ？ 展开：操作提示 + 图例，pref 记忆 · W13c） ================= */
(function(){
  const pop=document.getElementById('helpPop');
  const btn=document.getElementById('hintBtn');
  if(!pop||!btn)return;
  const open=function(on){
    pop.style.display=on?'block':'none';
    btn.classList.toggle('on',on);
    persist.setPref('help_open',on?'1':'0')};
  open(persist.getPref('help_open')==='1');       /* 默认收纳 */
  btn.onclick=function(e){e.stopPropagation();open(pop.style.display!=='block')};
  /* 交互优化：点击外部关闭 */
  document.addEventListener('pointerdown',function(e){
    if(pop.style.display!=='block')return;
    if(pop.contains(e.target)||btn.contains(e.target))return;
    open(false);
  },true);
})();
