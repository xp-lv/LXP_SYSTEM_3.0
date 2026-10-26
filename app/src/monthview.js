/* ================= 月度详情组件 v3.4（树画布 + 顶部周度云团） =================
   与目标画布同构：一棵连续的横向树（根「N月」→ 顶级目标 → 月度任务），
   所有月度任务在同一画布上平级展开，不做泳道分割。
   交互统一继承 decomposer：点＋直接创建+光标编辑、双击改名、×删除。
   周度用顶部云团表达；悬停云团高亮本周任务，拖月度任务入云团=排周。
   */
import {data} from './state.js';
import {addSubtask,removeNode,renameNode,assignPeriod,updateTask,unassignFromMonthDeep,reorderSibling} from './mutations.js';
import {monthWeeks,weekLabel,weekDays,today,weekKeyOf,parse,effW} from './calendar.js';
import * as q from './queries.js';
import {createDecomposer} from './modules/decomposer.js';
import {getSelected,setSelected,colorOf,MONTHS,monthLoad,renderPlan} from './planner.js';
import {showView} from './views.js';
import {setWeek} from './weekview.js';
import {flyWeekBubbles} from './transition.js';

var decomposerInst=null;
var currentMk=null;
var _cssDone=false;
var _cloudDropAt=0,_cloudDropWk=null;

/* 从虚拟树摘除节点（含顶级包装），画布即时反映删除/移出 */
function removeFromVtree(vroot,node){
  var i=vroot.children.indexOf(node);
  if(i>=0)vroot.children.splice(i,1);
  vroot.children.forEach(function(g){
    var j=g.children.indexOf(node);
    if(j>=0)g.children.splice(j,1);
  });
  vroot.children=vroot.children.filter(function(g){return g.children.length});
}

function injectCSS(){
  if(_cssDone)return;_cssDone=true;
  var css=document.createElement('style');css.textContent=`
/* 月详情布局：画布满铺，周泡泡浮在画布上（不截断画布） */
.mv-layout{width:100%;height:100%;overflow:hidden;position:relative}
/* 周度：内嵌在画布上层的半透明线条云团，树可以从云下穿过 */
.mv-cloudband{position:absolute;top:0;left:0;right:0;z-index:6;pointer-events:none;padding:6px 14px 0}
.mv-cloudhead{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.wc-head-left{display:flex;flex-direction:column;gap:2px;min-width:0}
.wr-label{font-size:9px;font-weight:650;letter-spacing:.14em;color:var(--bd-text-3,#6E7689);
  display:flex;align-items:center;gap:6px;white-space:nowrap}
.wr-label::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--lx-ph-sprout);flex:none}
.wr-hint{font-size:8.5px;color:var(--bd-text-3,#6E7689);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wc-field{position:relative;height:clamp(104px,12vh,130px);max-width:1000px;margin:2px auto 0;pointer-events:none}
.weekcloud{position:absolute;top:var(--y);left:var(--x);
  width:calc(clamp(140px,18%,190px) + var(--grow,0px));
  height:clamp(78px,9vh,94px);transform:translate(-50%,-50%);
  display:flex;align-items:center;justify-content:center;
  pointer-events:none;cursor:pointer;outline:none;user-select:none;color:rgba(255,255,255,.22);
  background:none;box-shadow:none;
  transition:transform .18s,opacity .18s,color .18s}
.wc-line{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;color:inherit}
.wc-line .wc-stroke{fill:none;stroke:currentColor;stroke-width:1;stroke-linejoin:round;stroke-linecap:round;opacity:.9}
.wc-hit{fill:transparent;stroke:transparent;stroke-width:18;pointer-events:all;cursor:pointer}
.wc-body{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:0 16px;text-align:center;pointer-events:none}
.weekcloud.hot,.weekcloud:focus-visible{color:rgba(255,255,255,.42);transform:translate(-50%,-50%) scale(1.045);z-index:5}
.weekcloud.now{color:var(--lx-ph-sprout,#8CAF6E)}
.weekcloud.now .wc-name{color:var(--lx-ph-sprout,#8CAF6E)}
.weekcloud.now .wc-date,.weekcloud.now .wc-load{color:rgba(140,175,110,.78)}
.weekcloud.sel{color:var(--bd-accent,#8B96F8);opacity:1}
.weekcloud.sel .wc-line .wc-stroke{stroke-width:1.6}
.weekcloud.sel .wc-name{color:var(--bd-accent,#8B96F8)}
.weekcloud.sel.hot{color:var(--bd-accent,#8B96F8)}
.weekcloud.past{opacity:.55}
.weekcloud.wc-dim{opacity:.38}
.weekcloud.splash{animation:wcSplash .42s ease}
@keyframes wcSplash{50%{transform:translate(-50%,-50%) scale(1.08)}}
.wc-name{font-size:11.5px;font-weight:600;color:var(--bd-text,#E9ECF4);line-height:1.2;white-space:nowrap;pointer-events:auto;cursor:pointer}

.wc-date{font-size:8.5px;color:var(--bd-text-2,#A7AEC0);white-space:nowrap}
.wc-load{font-size:8.5px;color:var(--bd-text-2,#A7AEC0);font-variant-numeric:tabular-nums;white-space:nowrap}
.wc-now{font-size:8px;color:var(--lx-ph-sprout,#8CAF6E);margin-left:4px}
.wc-empty{font-size:9px;color:var(--bd-text-3,#6E7689);opacity:.6}
.weekcloud.hot .wc-empty{opacity:1;color:var(--bd-accent,#8B96F8)}
.weekcloud.dc-drop-in{color:var(--bd-accent,#8B96F8)}
.weekcloud.dc-drop-in .wc-line .wc-stroke{stroke-width:1.6}
.weekcloud.dc-drop-in .wc-name,.weekcloud.dc-drop-in .wc-date{color:var(--bd-accent,#8B96F8)}
.mv-canvas-area{position:absolute;inset:0}
/* 悬停周云团时，树上的本周任务高亮，其余叶子淡化 */
#plDetail .dc-node.wk-hl{border-color:var(--bd-accent,#8B96F8)!important;
  background:color-mix(in srgb,var(--bd-accent,#8B96F8) 12%,var(--bd-surface,#151922))!important;
  box-shadow:0 0 0 3px rgba(139,150,248,.16),0 0 22px rgba(139,150,248,.12)!important}
#plDetail .dc-node.wk-hl .n-name{color:var(--bd-accent,#8B96F8)}
#plDetail .dc-node.wk-dim{opacity:.32}
@media(max-width:1400px){
  .wc-name{font-size:10.5px}
  .wc-date,.wc-load{font-size:8px}
  .wc-field{height:108px}
  .weekcloud{width:calc(clamp(128px,17%,160px) + var(--grow,0px));height:80px}
}
@media(max-width:1180px){
  .wc-name{font-size:11.5px}
  .wc-date,.wc-load{font-size:8.5px}
  .wc-field{height:118px}
  .weekcloud{width:calc(clamp(140px,18%,180px) + var(--grow,0px));height:86px}
}
.pl-empty{width:100%;flex:1;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:36px 40px;box-sizing:border-box;background:var(--bd-canvas,#0F1218);text-align:left}
.pl-empty-inner{width:min(760px,100%);display:flex;flex-direction:column;gap:18px}
.pl-empty-head{display:flex;align-items:center;gap:14px;min-width:0}
.pl-empty-icon{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  color:var(--bd-text-2,#A7AEC0);font-size:23px;border:1px solid var(--bd-line,rgba(255,255,255,.10));
  background:var(--bd-surface-2,#1A1F2A);flex:none}
.pl-empty-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
.pl-empty-title{font-size:15px;font-weight:650;color:var(--bd-text,#E9ECF4)}
.pl-empty-sub{font-size:10.5px;color:var(--bd-text-3,#6E7689);line-height:1.6;max-width:520px}
.pl-empty-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:0;width:100%}
.pl-empty-steps>div{display:flex;flex-direction:column;align-items:flex-start;gap:7px;padding:12px;
  border:1px solid var(--bd-line,rgba(255,255,255,.10));border-radius:10px;
  background:var(--bd-surface,#151922);font-size:10px;line-height:1.5;color:var(--bd-text-3,#6E7689);min-height:78px}
.pl-empty-steps b{font-size:9px;color:var(--bd-accent,#8B96F8);font-weight:650;letter-spacing:.04em;flex:none}
.pl-empty-months-wrap{display:flex;flex-direction:column;gap:8px;padding:12px;
  border:1px solid var(--bd-line,rgba(255,255,255,.10));border-radius:10px;background:rgba(255,255,255,.014)}
.pl-empty-months-label{font-size:9px;font-weight:600;color:var(--bd-text-3,#6E7689);letter-spacing:.12em}
.pl-empty-months{width:100%;height:96px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));
  gap:6px;align-items:end}
.pl-em-col{height:100%;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0}
.pl-em-col>span{font-size:8.5px;color:var(--bd-text-3,#6E7689);white-space:nowrap}
.pl-em-col>i{flex:1;width:100%;display:flex;align-items:flex-end;overflow:hidden;
  background:rgba(255,255,255,.045);border-radius:3px}
.pl-em-col>i>b{display:block;width:100%;min-height:2px;border-radius:2px;background:var(--bd-accent,#8B96F8)}
.pl-em-col>em{font-style:normal;font-size:8px;font-variant-numeric:tabular-nums;color:var(--bd-text-3,#6E7689)}
.mv-layout{background:transparent}
.mv-kpis{position:absolute;top:10px;right:12px;z-index:6;display:flex;align-items:center;gap:6px;
  padding:4px 6px;border:1px solid var(--bd-line,rgba(255,255,255,.10));border-radius:9px;
  background:rgba(15,18,24,.82);backdrop-filter:blur(8px);
  box-shadow:0 8px 24px rgba(0,0,0,.28)}
.mv-kpi{display:inline-flex;align-items:baseline;gap:4px;font-size:9.5px;color:var(--bd-text-3,#6E7689);
  padding:3px 8px;border:1px solid var(--bd-line,rgba(255,255,255,.10));border-radius:999px;background:transparent;white-space:nowrap}
.mv-kpi b{font-size:11px;color:var(--bd-text,#E9ECF4);font-weight:650;font-variant-numeric:tabular-nums}
`;
  document.head.appendChild(css);
}

/* 构建本月虚拟树：根「N月」→ 顶级目标 → 月度任务（统一树，不做泳道） */
function buildVirtualTree(mk){
  var root={title:(+mk.slice(5))+'月',children:[],_virtualRoot:true};
  var entries=[];
  (function w(n){n.children.forEach(function(c){
    if(c.lvl!=='month'&&c.lvl!=='week'&&c.assignM===mk)entries.push(c);
    if(c.children.length)w(c);
  })})(data.root);
  entries.forEach(function(entry){
    var vnode={title:entry.title,_real:entry,children:[],lvl:entry.lvl,hours:entry.hours};
    entry.children.forEach(function(mc){
      if(mc.lvl==='month'&&mc.assignM===mk)vnode.children.push(mc);
    });
    root.children.push(vnode);
  });
  return root;
}

/* 周泡泡负载：统一周任务口径（月度叶子 + 周级叶子 + 补点在本周，已分解父级不重复计） */
function weekTasks(wk){return q.weekLeaves([data.root],wk)}
/* 高亮口径包含容器：父级排到本周、子级继承有效周，整段分支都亮 */
function weekHighlightSet(wk){
  var set=new Set();
  (function walk(n){
    if(!n)return;
    var inWk=effW(n)===wk;
    if(!inWk&&n.assignD)inWk=weekKeyOf(parse(n.assignD))===wk;
    if(!inWk&&n.makeup)inWk=weekKeyOf(parse(n.makeup))===wk;
    if(inWk)set.add(n);
    (n.children||[]).forEach(walk);
  })(data.root);
  return set;
}

export function renderDetail(){
  injectCSS();
  var el=document.getElementById('plDetailBody');
  var lb=document.getElementById('plDetailLabel');
  var sel=getSelected();
  if(!sel||!sel.mk){
    lb.style.display='';
    lb.textContent='月度详情';
    el.innerHTML='<div class="pl-empty">'+
      '<div class="pl-empty-inner">'+
        '<div class="pl-empty-head">'+
          '<div class="pl-empty-icon">◫</div>'+
          '<div class="pl-empty-copy">'+
            '<div class="pl-empty-title">月度详情</div>'+
            '<div class="pl-empty-sub">选择上方任意月份，在这里把顶级目标拆成月度任务</div>'+
          '</div>'+
        '</div>'+
        '<div class="pl-empty-steps">'+
          '<div><b>01</b><span>从目标画布拖一个叶子到月份列</span></div>'+
          '<div><b>02</b><span>点月份列，在这里拆成月度任务</span></div>'+
          '<div><b>03</b><span>把月度任务拖进底部周泡泡排周</span></div>'+
        '</div>'+
        '<div class="pl-empty-months-wrap">'+
          '<div class="pl-empty-months-label">未来 7 个月</div>'+
          '<div class="pl-empty-months" id="plEmptyMonths"></div>'+
        '</div>'+
      '</div>'+
      '</div>';
    renderEmptyMonths();
    if(decomposerInst){decomposerInst.destroy();decomposerInst=null;currentMk=null}
    return;
  }
  var mk=sel.mk;
  /* 同月重建（如拖周后刷新）时保留画布滚动位置，避免视角跳回原点 */
  var keepScroll=null;
  if(currentMk===mk){
    var se0=document.querySelector('#mvCanvasArea .dc-scroll');
    if(se0)keepScroll={l:se0.scrollLeft,t:se0.scrollTop};
  }
  if(decomposerInst){decomposerInst.destroy();decomposerInst=null}
  currentMk=mk;

  var vroot=buildVirtualTree(mk);
  var leaves=[];
  (function collect(n){(n.children||[]).forEach(function(c){
    if(c.children&&c.children.length)collect(c);else leaves.push(c);
  })})(vroot);
  var monthN=leaves.filter(function(l){return l.lvl==='month'}).length;
  var weekN=leaves.filter(function(l){return !!l.assignW}).length;
  lb.style.display='';
  lb.textContent=(+mk.slice(5))+'月 · 月度详情';

  /* 布局：顶部周度云团 + 全宽树画布 */
  el.innerHTML='<div class="mv-layout">'+
    '<div class="mv-cloudband">'+
      '<div class="mv-cloudhead">'+
        '<div class="wc-head-left"><div class="wr-label">周度</div>'+
          '<div class="wr-hint">悬停云团高亮本周任务 · 拖任务入云团排周</div></div>'+
        '<div class="mv-kpis">'+
          '<span class="mv-kpi"><b>'+vroot.children.length+'</b> 顶级</span>'+
          '<span class="mv-kpi"><b>'+monthN+'</b> 月度任务</span>'+
          '<span class="mv-kpi"><b>'+weekN+'</b> 已排周</span>'+
        '</div>'+
      '</div>'+
      '<div class="wc-field" id="mvWeekTrack"></div>'+
    '</div>'+
    '<div class="mv-canvas-area" id="mvCanvasArea"></div>'+
    '</div>';

  /* 虚拟树深度：不能沿真实 parent 走（月度任务的 parent 是真实顶级节点），
     必须沿 vroot.children 的虚拟结构计算。 */
  function mvDepth(n){
    var found=-1;
    (function walk(x,d){
      if(found>=0)return;
      if(x===n){found=d;return}
      (x.children||[]).forEach(function(c){walk(c,d+1)});
    })(vroot,0);
    return found;
  }
  /* 挂载 decomposer 到画布区（统一树模式，与目标画布同构） */
  var canvasArea=document.getElementById('mvCanvasArea');
  decomposerInst=createDecomposer(canvasArea,{
    data:vroot,
    height:'100%',compact:true,
    hint:'',
    padBottom:12,    /* 底部只留少量呼吸空间 */
    hoursEditable:false,   /* 宏观域不展示工时（工时自周度域开始） */
    /* 月度域只看月度任务；周级子任务属于周画布 */
    filter:function(n){return n.lvl!=='week'&&n.lvl!=='temp'},
    canPlus:function(n){
      if(!n||n._virtualRoot)return false;
      /* 10月虚拟根不可加；顶级任务 + 第一层月度任务可各分解一次 */
      return mvDepth(n)<=2;
    },
    ops:{
      divide:function(parent,fields){
        if(!parent||parent._virtualRoot)return null;
        if(mvDepth(parent)>2)return null;
        var f=fields||{};
        if(parent._real){
          /* 顶级任务（包装节点）→ 第一次月度分解 */
          var c=addSubtask(parent._real,{title:f.title,hours:f.hours||1,lvl:'month'});
          assignPeriod(c,'m',mk,{noUndo:true});      /* 经收口：派生/持久化/3D 同步 */
          parent.children.push(c);   /* 同步进虚拟树，画布立即可见 */
          return c;
        }
        /* 第一层月度任务（真实节点）→ 第二次月度分解 */
        var c2=addSubtask(parent,{title:f.title,hours:f.hours||1,lvl:'month'});
        assignPeriod(c2,'m',mk,{noUndo:true});
        return c2;
      },
      remove:function(node){
        if(node._virtualRoot)return false;
        removeFromVtree(vroot,node);                 /* 画布即时摘除 */
        if(node._real){
          if(!node.title){                           /* 刚创建未命名的空壳 → 删除真节点 */
            removeNode(node._real);
          }else{                                     /* 顶级任务 ×= 移出该月（节点保留） */
            unassignFromMonthDeep(node._real,mk);
          }
          return true;
        }
        removeNode(node);                            /* 月度任务 ×= 删除节点 */
        return true;
      },
      rename:function(node,title){
        if(node._real){renameNode(node._real,title);node.title=title}
        else renameNode(node,title);
      },
      setHours:function(node,h){
        if(node._real)updateTask(node._real,{hours:h});
        else updateTask(node,{hours:h});
      }
    },
    colorOf:function(n){return n._virtualRoot?null:colorOf(n._real||n)},
    meta:function(n){
      /* 宏观域不展示工时：目标卡=构成，任务卡=周标签 */
      if(n._virtualRoot)return n.children.length+' 个顶级';
      if(n._real){
        if(!n._real.children.length)return '顶级目标 · 未分解';
        var cnt=0;
        n.children.forEach(function(c){if(c.lvl==='month'&&c.assignM===mk)cnt++});
        var total=q.countMonthLeaves(n._real,mk);
        var hidden=Math.max(0,total-cnt);
        return (cnt?'月度×'+cnt:'顶级目标')+
          (hidden?'<span class="pl-deep-badge" title="更深层级已折叠，数据保留">更深层级 ×'+hidden+'</span>':'');
      }
      return n.assignW?weekLabel(mk,n.assignW):'待排周';
    },
    onClick:function(n){
      if(n._real)setSelected({node:n._real,mk:mk});
      else if(n.parent&&n.parent._real)setSelected({node:n.parent._real,mk:mk});
      else setSelected({mk:mk});
    },
    drag:{
      canDrag:function(n){return n.lvl==='month'&&n.assignM===mk&&(!n.children||!n.children.length)},
      dropSelector:'#mvWeekTrack .weekcloud',
      ghostText:function(n,el){
        return el
          ?n.title+' → '+(el.querySelector('.wc-name')?el.querySelector('.wc-name').textContent:'周')
          :'拖到周云团排周';
      },
      onDrop:function(n,el){
        if(n.lvl==='month'&&n.assignM===mk&&(!n.children||!n.children.length)){
          assignPeriod(n,'w',el.dataset.wk);
          _cloudDropAt=Date.now();_cloudDropWk=el.dataset.wk;
          renderDetail();
          var nb=document.querySelector('#mvWeekTrack .weekcloud[data-wk="'+el.dataset.wk+'"]');
          if(nb){nb.classList.add('splash');setTimeout(function(){nb.classList.remove('splash')},480)}
        }
      }
    },
    reorder:{
      /* 顶级包装节点固定；只允许月任务在其父级内部排序 */
      canReorder:function(n){
        return !!(n.lvl==='month'&&n.parent&&!n.parent._virtualRoot&&!n._virtualRoot);
      },
      onReorder:function(n,before,after){
        var node=n._real||n;
        var b=before?(before._real||before):null;
        var ok=reorderSibling(node,b,after);
        if(ok)renderPlan();          /* 同步月卡内部顺序 + 详情树 */
        return ok;
      }
    }
  });

  renderWeekClouds(mk);

  if(keepScroll){
    var se2=document.querySelector('#mvCanvasArea .dc-scroll');
    if(se2){se2.scrollLeft=keepScroll.l;se2.scrollTop=keepScroll.t}
  }
}

function renderEmptyMonths(){
  var wrap=document.getElementById('plEmptyMonths');
  if(!wrap)return;
  var max=0;
  MONTHS.forEach(function(m){max=Math.max(max,monthLoad(m.key))});
  var h='';
  MONTHS.forEach(function(m){
    var l=monthLoad(m.key);
    var pct=max?Math.max(4,Math.min(100,l/max*100)):0;
    h+='<div class="pl-em-col"><span>'+m.name+'</span><i><b style="height:'+pct+'%"></b></i><em>'+(l?l+'h':'—')+'</em></div>';
  });
  wrap.innerHTML=h;
}

/* 周度云团：顶部漂浮的有机形状，不是列/表/卡。
   悬停高亮树上的本周任务；点击进周规划；拖任务入云团写 assignW。 */
function weekRangeLabel(days){
  function md(s){return (+s.slice(5,7))+'/'+(+s.slice(8,10))}
  return md(days[0])+'–'+md(days[6]);
}
var WC_SHAPES=[
  '58% 42% 55% 45% / 45% 55% 45% 55%',
  '45% 55% 48% 52% / 55% 45% 55% 45%',
  '52% 48% 60% 40% / 42% 58% 42% 58%',
  '60% 40% 45% 55% / 52% 48% 52% 48%',
  '48% 52% 42% 58% / 58% 42% 58% 42%'
];
var WC_PATH='M32 74 C16 74 8 62 13 50 C18 38 31 34 40 39 C45 22 62 15 74 24 C84 10 105 13 111 29 C129 25 146 36 145 51 C156 55 159 68 149 73 C145 76 136 77 126 77 L38 77 C34 77 33 76 32 74 Z';
var WC_POS={
  4:[[9,42],[33,61],[58,37],[83,59]],
  5:[[7,40],[27,60],[48,36],[69,60],[89,43]],
  6:[[6,38],[23,58],[42,34],[61,58],[79,38],[93,56]]
};
function highlightWeek(wk,on,cloud){
  var area=document.getElementById('mvCanvasArea');
  if(!area)return;
  var rm=area._rowMap||[];
  if(on){
    var match=weekHighlightSet(wk),keep=new Set();
    match.forEach(function(t){
      for(var x=t;x;x=x.parent)keep.add(x);
    });
    area.querySelectorAll('.dc-node').forEach(function(el){
      var vm=rm[+el.dataset.i];
      if(!vm)return;
      var real=vm._real||vm;
      if(match.has(real)){
        el.classList.add('wk-hl');el.classList.remove('wk-dim');
      }else if(keep.has(real)){
        el.classList.remove('wk-hl','wk-dim');
      }else if(!vm._real&&real.lvl==='month'){
        el.classList.add('wk-dim');el.classList.remove('wk-hl');
      }else{
        el.classList.remove('wk-hl','wk-dim');
      }
    });
    document.querySelectorAll('#mvWeekTrack .weekcloud').forEach(function(c){
      c.classList.toggle('wc-dim',c!==cloud);
    });
  }else{
    area.querySelectorAll('.dc-node.wk-hl,.dc-node.wk-dim').forEach(function(el){
      el.classList.remove('wk-hl','wk-dim');
    });
    document.querySelectorAll('#mvWeekTrack .weekcloud.wc-dim').forEach(function(c){
      c.classList.remove('wc-dim');
    });
  }
}
function renderWeekClouds(mk){
  var wrap=document.getElementById('mvWeekTrack');
  if(!wrap)return;
  var weeks=monthWeeks(mk);
  var curW=today().w;
  var sel0=getSelected();
  var h='';
  weeks.forEach(function(wk,i){
    var tasks=weekTasks(wk);
    var load=tasks.reduce(function(s,t){return s+(+t.hours||0)},0);
    var isCur=wk===curW;
    var isPast=wk<curW;
    var days=weekDays(wk);
    var grow=isCur?10:(tasks.length?Math.min(8,tasks.length*1.5):0);
    var pos=(WC_POS[weeks.length]||WC_POS[4])[i%6]||[50,50];
    h+='<div class="weekcloud'+(isCur?' now':'')+(isPast?' past':'')+((sel0&&sel0.wk===wk)?' sel':'')+'" data-wk="'+wk+'"'+
      ' style="--x:'+pos[0]+'%;--y:'+pos[1]+'%;--grow:'+grow+'px;border-radius:'+WC_SHAPES[i%5]+'"'+
      ' role="button" tabindex="0"'+
      ' title="跳转到周规划'+(isCur?'（本周）':'')+' · 悬停高亮本周任务 · 拖任务入云团=排周">'+
      '<svg class="wc-line" viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true">'+
        '<path class="wc-hit" d="'+WC_PATH+'" vector-effect="non-scaling-stroke"></path>'+
        '<path class="wc-stroke" d="'+WC_PATH+'" vector-effect="non-scaling-stroke"></path></svg>'+
      '<div class="wc-body">'+
        '<div class="wc-name">'+weekLabel(mk,wk)+(isCur?'<span class="wc-now">本周</span>':'')+'</div>'+
        '<div class="wc-date">'+weekRangeLabel(days)+'</div>'+
        '<div class="wc-load'+(tasks.length?'':' wc-empty')+'">'+
          (tasks.length?tasks.length+'项 · '+Math.round(load)+'h':'＋ 拖入')+'</div>'+
      '</div>'+
      '</div>';
  });
  wrap.innerHTML=h;
  wrap.querySelectorAll('.weekcloud').forEach(function(el){
    function enter(){el.classList.add('hot');highlightWeek(el.dataset.wk,true,el)}
    function leave(){el.classList.remove('hot');highlightWeek(el.dataset.wk,false,el)}
    function open(){
      if(Date.now()-_cloudDropAt<400&&el.dataset.wk===_cloudDropWk)return;
      jumpToWeek(el.dataset.wk);
    }
    /* 云朵轮廓内部任意位置都算悬停；子元素之间移动不触发 leave */
    el.addEventListener('mouseover',function(e){
      if(e.relatedTarget&&el.contains(e.relatedTarget))return;
      enter();
    });
    el.addEventListener('mouseout',function(e){
      if(e.relatedTarget&&el.contains(e.relatedTarget))return;
      leave();
    });
    el.addEventListener('click',open);
    el.addEventListener('focus',enter);
    el.addEventListener('blur',leave);
    el.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}
    });
  });
}

/* 周段 → 周规划：用临时胶囊锚点做共享元素飞移，
   避免把整段日刻度/任务文字压进周度条胶囊。 */
function makeWeekAnchors(){
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
function dropWeekAnchors(map){
  Object.keys(map||{}).forEach(function(k){try{map[k].remove()}catch(e){}});
}
function jumpToWeek(wkKey){
  var s0=getSelected();
  if(s0&&s0.mk)setSelected({mk:s0.mk,wk:wkKey});
  var anchors=makeWeekAnchors();
  var weeks=Object.keys(anchors);
  if(!weeks.length)return;
  var clicked=anchors[wkKey];
  if(clicked)clicked.style.opacity='.55';
  setTimeout(function(){
    /* 起点矩形在切换视图前捕获（视图隐藏后 rect 归零） */
    var caps=weeks.map(function(wk){
      return {wk:wk,el:anchors[wk],rect:anchors[wk].getBoundingClientRect()};
    });
    setWeek(wkKey);
    showView('week');               /* renderWeek 同步完成，周度条已就位 */
    var dest={};
    document.querySelectorAll('#wkWeeks .wk-wb').forEach(function(el){dest[el.dataset.wk]=el});
    var pairs=[],fades=[];
    caps.forEach(function(c){
      if(dest[c.wk])pairs.push({fromEl:c.el,fromRect:c.rect,toEl:dest[c.wk]});
    });
    document.querySelectorAll('#wkWeeks .wk-wb').forEach(function(el){
      if(!dest[el.dataset.wk])fades.push(el);    /* 邻月框：随分散浮现 */
    });
    flyWeekBubbles(pairs,fades);
    setTimeout(function(){dropWeekAnchors(anchors)},1000);
  },50);
}

/* 供 planner 的 Esc 链调用 */
export function cancelMvAdd(){return false}
export function mvAddActive(){return false}
