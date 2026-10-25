import THREE from '../three.js';
import {getIslands,getActiveTree,activateTreeByRef} from '../world.js';
import {enterPlanet} from '../planet.js';
import {weekTreeMounted} from '../today.js';
import {data,state} from '../state.js';
import {clamp,escHtml} from '../utils.js';

/* ================= demo 面板（移植自 demo/tree-proj 的树选择框 + 任务树大纲 + HUD） =================
   树选择框 = 全领域目标总览（左上：按领域分组，点选跨领域激活 · W2b）
   任务树大纲 = 激活树的层级细节（状态点/工时/进度，点行飞向该枝）
   HUD = 顶栏徽章式读数（进度徽章 + 断梢/完成/过期） */

/* 徽章分档（demo stageOf） */
function stageOf(p){
  if(p>=1)return['圆满',0xE8A13A];
  if(p>.5)return['丰收',0xD9C24A];
  if(p>.25)return['半坡',0x6FA053];
  if(p>0)return['破土',0xA8B888];
  return['荒芜',0x8a7a5a]}
function rgba(hex,a){
  const c=new THREE.Color(hex);
  return 'rgba('+Math.round(c.r*255)+','+Math.round(c.g*255)+','+Math.round(c.b*255)+','+a+')'}

/* demo 大纲的断梢判定：与 goal.js cfgFromApp 同语义——
   叶子任务 未排期且未完成 → 断梢红光 */
function isBareLeaf(n){
  return n.leaf&&!n.children.length&&(n.progress||0)<1&&
    !(n.assignD||n.assignW)}

export function refreshTreePanels(){
  refreshSel();
  refreshOutline();
  refreshHud()}
export function initDemoPanels(){
  const ob=document.getElementById('obToggle');    /* 大纲默认收纳，≡ 展开内层 obPanel（世界布局 v4） */
  if(ob)ob.onclick=function(e){
    e.stopPropagation();
    const el=document.getElementById('obPanel');
    if(!el)return;
    const on=el.style.display!=='block';
    el.style.display=on?'block':'none';
    ob.classList.toggle('on',on)};
  /* 交互优化：点击大纲外部 → 收起 */
  document.addEventListener('pointerdown',function(e){
    const el=document.getElementById('obPanel');
    const btn=document.getElementById('obToggle');
    if(!el||el.style.display!=='block'||!btn)return;
    if(el.contains(e.target)||btn.contains(e.target))return;
    el.style.display='none';
    btn.classList.remove('on');
  },true);
  refreshTreePanels()}

/* —— 树选择框（全领域目标总览：按领域分组，点选跨领域激活） —— */
function refreshSel(){
  const el=document.getElementById('treeSel');
  if(!el)return;
  const curTree=getActiveTree();
  let html='<div class="ts-t">全领域 · 目标</div>';
  const hex6=function(c){return'#'+(c>>>0).toString(16).padStart(6,'0')};
  getIslands().forEach(function(isle){
    html+='<div class="ts-g"><i style="background:'+hex6(isle.color)+'"></i>'+
      escHtml(isle.name)+'<span class="ts-n">'+isle.trees.length+'</span></div>';
    isle.trees.forEach(function(t){
      const pct=Math.round((t.pct||0)*100);
      html+='<button class="ts-row'+(t===curTree?' on':'')+'" data-tid="'+t.id+'">'+
        '<span class="ts-top"><span class="nm">'+escHtml(t.title)+'</span>'+
        '<span class="pc">'+pct+'%</span></span>'+
        '<span class="ts-bar"><i style="width:'+pct+'%'+(pct>=100?';background:linear-gradient(90deg,#E8C24A,#D9A93A)':'')+'"></i></span></button>'});
    if(!isle.trees.length)html+='<div class="ts-empty">暂无目标 · 到宏观规划页种植</div>';
  });
  el.innerHTML=html;
  el.querySelectorAll('.ts-row').forEach(function(b){
    b.onclick=function(){
      let target=null;
      getIslands().forEach(function(isle){isle.trees.forEach(function(t){
        if(t.id===parseInt(b.dataset.tid))target=t})});
      if(target)activateTreeByRef(target);   /* 跨领域激活：换域+换树+飞行聚焦 */}})}

/* —— 任务树大纲 —— */
function refreshOutline(){
  const el=document.getElementById('outlineD');
  if(!el)return;
  const root=data.root;
  const tt=document.getElementById('obTitle'),bb=document.getElementById('obBody');
  if(!tt||!bb)return;
  if(!root){tt.textContent='';bb.innerHTML='';return}   /* 只清内容，不拆容器结构 */
  const pct=Math.round((root.pct||0)*100);
  document.getElementById('obTitle').innerHTML=
    escHtml(root.title)+' <span class="pct">'+pct+'%</span>';
  const body=document.getElementById('obBody');
  body.innerHTML='';
  function row(pad,html2,onclick){
    const r=document.createElement('div');
    r.className='row';r.style.paddingLeft=pad+'px';
    r.style.cursor=onclick?'pointer':'default';
    r.innerHTML=html2;
    if(onclick)r.onclick=onclick;
    body.appendChild(r)}
  function dot(c){return '<span class="dot" style="background:'+c+'"></span>'}
  function walk(n,pad){
    const done=(n.pct||0)>=1;
    const hasKids=n.children&&n.children.length;
    const bare=isBareLeaf(n);
    const c3=done?'#D9C24A':(bare?'#FF3B2A':(hasKids?'#6FA053':'#9cb86a'));
    const lab=done?' · <b style="color:#D9C24A">完成</b>':
      (bare?' · <b style="color:#FF6B5A">断梢</b>':
       (hasKids?'':' · 细枝'));
    row(pad,dot(c3)+'<b style="color:#c8cede;font-weight:600">'+escHtml(n.title)+'</b> · '+
      Math.round(n.H||0)+'h'+(hasKids||n.leaf?' · '+Math.round((n.pct||0)*100)+'%':'')+lab,
      function(){
        if(weekTreeMounted())return;            /* 今日虚拟树期间不进星球 */
        if(state.mode==='planet')return;         /* 星球内只经行星/中心球导航（06.2） */
        if(n.children&&n.children.length)enterPlanet(n);
        else if(n.parent)enterPlanet(n.parent); /* 叶行 → 父节点星系（W9①B） */
      });
    (n.children||[]).forEach(function(c){walk(c,pad+14)})}
  walk(root,0)}

/* —— 顶栏 HUD（demo 徽章式读数，数据=app 派生字段） —— */
function refreshHud(){
  const el=document.getElementById('stats');
  if(!el||!data.root)return;
  const root=data.root,pct=Math.round((root.pct||0)*100);
  const st=stageOf(root.pct||0);
  const bare=(function cnt(n){let c=0;
    (function w(m){(m.children||[]).forEach(function(x){if(isBareLeaf(x))c++;w(x)})})(n);return c})(root);
  const done=(function cnt(n){let c=0;
    (function w(m){(m.children||[]).forEach(function(x){
      if(x.leaf&&(x.progress||0)>=1)c++;w(x)})})(n);return c})(root);
  const red=root.redCount||0;
  el.innerHTML=
    '<span class="dbadge" style="background:'+rgba(st[1],.14)+';border-color:'+rgba(st[1],.42)+
    ';color:#'+new THREE.Color(st[1]).lerp(new THREE.Color(0xffffff),.42).getHexString()+'">'+st[0]+'</span>'+
    '<span class="dpct">'+pct+'%</span>'+
    '<span class="dname">'+escHtml(root.title)+'</span>'+
    '<span class="dsep"></span>'+
    '<span class="dstat"><i>断梢</i><b'+(bare?' style="color:#FF6B5A"':'')+'>'+bare+'</b></span>'+
    '<span class="dstat"><i>完成</i><b style="color:#D9C24A">'+done+'</b></span>'+
    (red?'<span class="dstat"><i>过期</i><b style="color:var(--lx-danger,#F87171)">'+red+'</b></span>':'')+
    '<span class="dstat"><i>任务</i><b>'+clamp(root.leafCount||0,0,9999)+'</b></span>'}
