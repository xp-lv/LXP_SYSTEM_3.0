import {state} from './state.js';
import {renderer} from './scene.js';
import {renderPlan} from './planner.js';
import {renderWeek} from './weekview.js';
import {enterToday,leaveToday,weekTreeMounted,setDay} from './today.js';
import {store} from './store.js';
import {undo,redo} from './mutations.js';

/* —— data 事件 → 激活视图自动重渲染 ——
   显式渲染（页面在变更后主动调 renderXxx）会刷新 lastRenderAt；
   订阅渲染只兜底"忘记显式渲染"的路径，50ms 内去重避免双渲染。
   组件化后每个组件可自行 store.on('data') 订阅自己的切片。 */
let lastRenderAt=0;
export function markRendered(){lastRenderAt=Date.now()}
store.on('data',function(){
  const at=Date.now();
  if(at-lastRenderAt<50)return;                 // 显式渲染已覆盖
  requestAnimationFrame(function(){
    if(Date.now()-lastRenderAt<66)return;
    const v=state.view;
    if(v==='plan')safeRender('plan',document.getElementById('viewPlan'),renderPlan);
    else if(v==='week')safeRender('week',document.getElementById('viewWeek'),renderWeek);
    else if(v==='today')safeRender('today',document.getElementById('viewToday'),enterToday);
  });
});

/* ================= 应用视图路由（views.js） =================
   'world'  3D 浮空岛世界（原有体验：树/星球/日历分配）
   'plan'   宏观规划（月视角，planner.js）
   'week'   微观规划（周视角，weekview.js）
   'today'  当天执行（3D 树状态 + today.js）
   规划页面是全屏 DOM 覆盖；today 半透明，3D canvas 保持可见。 */

/* 机制 E：chrome 注册表——元素→可见视图的唯一权威；任何模块不得再写这些元素的 display
   （世界布局 v4：outlineD/helpPop 的"默认收纳"由 CSS display:none 实现——
    applyChrome 在世界视图置 '' 时自然回落收纳态，跨视图自动收起） */
const CHROME={
  crumb:['world'],minimap:['world'],helpPop:['world'],hintBtn:['world'],
  treeSel:['world'],outlineD:['world'],obToggle:['world'],taskEditor:['world'],
  stats:['world'],                     /* 世界页才显示活动树指标——规划页顶上不再挂无关读数 */
  hoverCard:['world','today']       /* 8.1 悬停果卡 */
};
export function applyChrome(view){
  for(const id in CHROME){
    const el=document.getElementById(id);
    if(!el)continue;
    let show=CHROME[id].indexOf(view)>=0;
    if(id==='minimap'&&state.mode==='planet')show=false;   /* 星球模式隐藏小地图 */
    el.style.display=show?'':'none';
  }
}

export function initViews(){
  document.querySelectorAll('[data-nav]').forEach(function(b){
    b.onclick=function(){
      var n=b.dataset.nav;
      /* 导航入口「今日」永远回真今天（周泡泡进入的日视角不残留，§8.3） */
      if(n==='today'){
        setDay(null);
        if(state.view==='today'){
          safeRender('today',document.getElementById('viewToday'),enterToday);
          return;
        }
      }
      showView(n);    };
  });
  /* 撤销/重做键盘接线（Cmd/Ctrl+Z · Shift 反向）。
     今日页 data.root 是虚拟周树，undo 回放会与其打架——今日期间禁用。 */
  document.addEventListener('keydown',function(e){
    if(!(e.metaKey||e.ctrlKey))return;
    if(e.key!=='z'&&e.key!=='Z')return;
    if(e.target&&(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'))return;
    if(weekTreeMounted())return;
    e.preventDefault();
    var ok=e.shiftKey?redo():undo();
    if(ok){refreshHistoryView();flashToast(e.shiftKey?'↷ 重做':'↶ 撤销')}
  });
  /* 交互优化：dock 内的撤销/重做按钮（与快捷键同源，可视化入口） */
  var bu=document.getElementById('btnUndo'),br=document.getElementById('btnRedo');
  if(bu)bu.onclick=function(){
    if(weekTreeMounted()){flashToast('今日页暂不支持撤销');return}
    var ok=undo();
    if(ok)refreshHistoryView();
    flashToast(ok?'↶ 撤销':'没有可撤销的操作');
  };
  if(br)br.onclick=function(){
    if(weekTreeMounted()){flashToast('今日页暂不支持重做');return}
    var ok=redo();
    if(ok)refreshHistoryView();
    flashToast(ok?'↷ 重做':'没有可重做的操作');
  };
  state.view='world';
}
/* 撤销/重做后重绘当前规划视图：undo 只回放数据与 3D，不自动重建 DOM 画布 */
function refreshHistoryView(){
  var v=state.view;
  if(v==='plan')safeRender('plan',document.getElementById('viewPlan'),renderPlan);
  else if(v==='week')safeRender('week',document.getElementById('viewWeek'),renderWeek);
}
/* 轻量操作反馈（撤销/重做） */
function flashToast(msg){
  var w=document.querySelector('.toast-wrap');
  if(!w){w=document.createElement('div');w.className='toast-wrap';
    w.style.cssText='position:fixed;bottom:22px;right:22px;z-index:100;display:flex;flex-direction:column;gap:8px;pointer-events:none';
    document.body.appendChild(w)}
  var t=document.createElement('div');
  t.style.cssText='padding:8px 14px;border-radius:8px;background:var(--lx-bg-2,#111628);'+
    'border:1px solid var(--lx-line-2);box-shadow:0 12px 40px rgba(0,0,0,.55);'+
    'font-size:11.5px;color:var(--lx-text-1,#EDEFF7);opacity:0;'+
    'transform:translateY(10px) scale(.97);'+
    'transition:opacity .22s ease,transform .3s var(--lx-m-spring,cubic-bezier(.34,1.56,.64,1))';
  t.textContent=msg;
  w.appendChild(t);
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){t.style.opacity='1';t.style.transform='none'});
  });
  setTimeout(function(){t.style.opacity='0';t.style.transform='translateY(-8px)';
    setTimeout(function(){t.remove()},260)},900);
}

/* 渲染错误边界：单视图异常不带走整个应用 */
function safeRender(name,container,fn){
  try{
    fn();
  }catch(err){
    console.error('[view:'+name+']',err);
    if(container)container.innerHTML=
      '<div style="margin:60px auto;max-width:420px;padding:20px 24px;'+
      'border:1px solid rgba(229,105,111,.35);border-radius:12px;'+
      'background:rgba(229,105,111,.06);color:#EC8A8F;font-size:13px;line-height:1.8">'+
      '<b style="font-size:14px;color:#F0A9AC">「'+name+'」视图渲染失败</b><br>'+
      '<span style="color:#9BA3B8;font-size:11px">'+String(err&&err.message||err)+
      '</span><br><span style="color:#5E667C;font-size:10.5px">其他视图不受影响 · 详见控制台</span></div>';
  }
}

/* 页面切换淡入承接：月↔周飞移时新页柔和浮现（配合 transition.js，弱化硬切）。
   只动 opacity——带 transform 的入场会移动目标框，飞移克隆按 rect 落位就会错位跳变 */
function viewFadeIn(el){
  if(el&&el.animate){
    try{el.animate([{opacity:0},{opacity:1}],{duration:240,easing:'ease-out'})}catch(e){}
  }
}
/* 入场编排门控：给页内带 data-rise 的元素一次错峰浮现（lx-rise）。
   只在真正切换进视图时触发；数据变更触发的重渲染不重播（§动效）。
   定时器挂在页面元素上（不共享）——连续切页互不取消对方的收尾 */
function enterChoreo(el){
  if(!el)return;
  el.classList.remove('entering');
  void el.offsetWidth;                         /* 重进视图时重置动画 */
  el.classList.add('entering');
  clearTimeout(el._enterTimer);
  el._enterTimer=setTimeout(function(){el.classList.remove('entering')},1100);
}
/* 数字滚动（odometer 式）：进度环百分比进视图时充能滚动 */
function countUp(el,to,suffix){
  if(!el)return;
  var t0=null,D=560;
  function step(now){
    if(t0==null)t0=now;
    var k=Math.min(1,(now-t0)/D);
    k=1-Math.pow(1-k,3);                       /* easeOutCubic */
    el.textContent=Math.round(to*k)+suffix;
    if(k<1)setTimeout(function(){step(Date.now())},16);
  }
  try{requestAnimationFrame(function(){requestAnimationFrame(function(){step(Date.now())})})}
  catch(e){el.textContent=to+suffix}
}

export function showView(name){
  var prev=state.view;
  if(prev===name)return;
  if(prev==='today')leaveToday();
  state.view=name;
  var cv=renderer.domElement;
  document.querySelectorAll('.page').forEach(function(p){p.style.display='none'});
  applyChrome(name);
  markRendered();
  state.renderPaused=(name==='plan'||name==='week');
  if(name==='world'){
    cv.style.display='block';
  }else if(name==='plan'){
    cv.style.display='none';
    document.getElementById('viewPlan').style.display='block';
    viewFadeIn(document.getElementById('viewPlan'));
    safeRender('plan',document.getElementById('viewPlan'),renderPlan);
    enterChoreo(document.getElementById('viewPlan'));
  }else if(name==='week'){
    cv.style.display='none';
    document.getElementById('viewWeek').style.display='block';
    viewFadeIn(document.getElementById('viewWeek'));
    safeRender('week',document.getElementById('viewWeek'),renderWeek);
    enterChoreo(document.getElementById('viewWeek'));
  }else if(name==='today'){
    cv.style.display='block';
    document.getElementById('viewToday').style.display='block';
    safeRender('today',document.getElementById('viewToday'),enterToday);
    enterChoreo(document.getElementById('viewToday'));
    var rt=document.querySelector('#viewToday .ring-big .rt');
    if(rt)countUp(rt,parseInt(rt.textContent)||0,'%');
  }
  document.querySelectorAll('[data-nav]').forEach(function(b){
    b.classList.toggle('on',b.dataset.nav===name)});
}
