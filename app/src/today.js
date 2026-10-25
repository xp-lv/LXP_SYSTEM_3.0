import THREE from './three.js';
import {clamp,escHtml} from './utils.js';
import {markRendered as viewsMark,showView} from './views.js';
import {pickMeshes} from './state.js';
import {scene} from './scene.js';
import {data} from './state.js';
import {updateTask,updateTemp,touch,addTemp,removeTemp} from './mutations.js';
import {notify} from './notify.js';
import {today,dayLabel,weekKeyOf,weekDays,addDays,parse,dstr,dayCapOf,effD} from './calendar.js';
import {setWeek,ensureWeekCSS} from './weekview.js';
import {flyWeekBubbles} from './transition.js';
import {frameToday} from './camera.js';
import {getIslands,getWorldIsland,treeColorOf} from './world.js';
import {islandRadiusOf} from './slots.js';
import {derive} from './data.js';
import {rebuild} from './tree.js';
import {STAGE} from './demo/stage.js';
import {setEnvFocus} from './demo/env.js';
import * as q from './queries.js';

/* ================= 今日视角 v2 =================
   左：3D 周计划树舞台（落果=本周超时 / 落叶堆=本周前欠账 → 点击选补点）
   右：模块拼接式事项清单（环 / 排序 / 草稿分解 / 总进度环）＋ 执行区（05.6） */

var _cssDone=false;
var _doneOpen=false;    /* 已完成组展开态（默认折叠） */
var _histRO=false;      /* 历史日视角只读（R28/R33） */

/* ===== 执行区（05.6 v10）：入档"正在执行"状态（data.exec，多设备同步） ===== */
var _exec=[];             /* [{nodeId, startedAt, decomposed, editing, page}] */
var _execTimer=null;
var _zoneCollapsed=false;
var _execRestored=false;   /* 只恢复一次（避免每次 enterToday 都覆盖） */

/* ── 持久化 v10（05.6）：执行区状态入档 data.exec——随文档写 localStorage +
   推服务器 data.json（多设备同步），不再走 pref 本地暂存 ── */
function execSave(){
  try{
    data.exec={items:_exec.map(function(e){return{
      nodeId:e.nodeId,startedAt:e.startedAt,decomposed:e.decomposed,page:e.page||0
      /* editing 不持久化——重载后输入框关闭 */}}),
      collapsed:_zoneCollapsed};
    touch();          /* 变更广播单通道（07.3）→ main 存档 + 云同步（防抖推送） */
  }catch(e){}
}
function execRestore(){
  try{
    var st=data.exec;
    if(!st||!Array.isArray(st.items))return;
    _zoneCollapsed=!!st.collapsed;
    /* 只恢复仍然存在的未完成任务 */
    _exec=st.items.filter(function(e){
      var n=nodeAnyById(e.nodeId);
      return n&&n.progress<1;
    }).map(function(e){
      return{nodeId:e.nodeId,startedAt:e.startedAt||Date.now(),
        decomposed:!!e.decomposed,editing:false,page:e.page||0};
    });
  }catch(e){}
}
function execFind(nodeId){return _exec.find(function(e){return e.nodeId===nodeId})}
/* 执行标记就地更新（交互优化）：只改目标卡片，不重建整张清单（保留滚动/悬停态） */
function execMark(nodeId,on){
  var card=document.querySelector('#viewToday .td-task[data-nid="'+nodeId+'"]');
  if(!card)return;
  card.classList.toggle('executing',on);
  var sub=card.querySelector('.td-sub');
  if(!sub)return;
  var flag=sub.querySelector('.exec-flag');
  if(on&&!flag){
    sub.appendChild(document.createTextNode(' '));
    var s=document.createElement('span');s.className='exec-flag';s.textContent='⚡ 执行中';
    sub.appendChild(s);
  }else if(!on&&flag){
    var prev=flag.previousSibling;
    if(prev&&prev.nodeType===3)prev.remove();
    flag.remove();
  }
}
function execAdd(nodeId){
  if(_histRO)return;
  if(execFind(nodeId))return;
  _exec.push({nodeId:nodeId,startedAt:Date.now(),decomposed:false,editing:false,page:0});
  execSave();
  execRender();
  execMark(nodeId,true);          /* 清单侧"⚡ 执行中"就地打标（不重建列表） */
  execTick();
}
function execRemove(nodeId){
  _exec=_exec.filter(function(e){return e.nodeId!==nodeId});
  execSave();
  execRender();
  execMark(nodeId,false);
}
/* mm:ss（≥1h 为 H:MM:SS）——tabular-nums 下字宽不抖（05.6 v5 /《4》T19） */
function execFmt(ms){
  var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;
  var p2=function(n){return(n<10?'0':'')+n};
  return h>0?h+':'+p2(m)+':'+p2(ss):p2(m)+':'+p2(ss);
}
function execRender(){
  var zone=document.getElementById('execZone');
  if(!zone)return;
  viewsMark();   /* 执行区显式渲染过——吞掉 50ms 内的 data 兜底重渲染（防输入框被重建） */
  zone.classList.remove('collapsed');
  if(!_exec.length){
    zone.innerHTML='<div class="ez-pill">⚡ 点击右侧清单任务开始执行</div>';   /* 空态药丸（05.6 v5） */
    return;
  }
  var h='<div class="ez-title">⚡ 正在执行'+
    '<span class="ez-toggle" id="ezToggle" title="折叠/展开执行区">'+(_zoneCollapsed?'▸':'–')+'</span></div>';
  /* v11：多任务逐组竖向平铺；每组=主卡+右侧两排卫星 */
  if(!_zoneCollapsed)
  _exec.forEach(function(e){
    var n=nodeAnyById(e.nodeId);
    if(!n)return;
    var subs=n.checklist||[];
    var sn=subs.length;
    var doneS=subs.filter(function(x){return x.done}).length;
    var full=sn>0&&doneS===sn;
    var wait=sn>0&&!full;
    h+='<div class="ez-pair" data-grp="'+e.nodeId+'">';
    /* ── 主卡 ── */
    h+='<div class="ez-main">';
    h+='<div class="ez-main-top">';
    h+='<span class="ez-time num" data-exec-t="'+e.nodeId+'">'+execFmt(Date.now()-e.startedAt)+'</span>';
    h+='<span class="ez-name" title="'+escHtml(n.title)+'">'+escHtml(n.title)+'</span>';
    h+='<span class="ez-close" data-exec-x="'+e.nodeId+'" title="停止执行">×</span>';
    h+='</div>';
    h+='<div class="ez-prog-line"><span class="ez-bar">';
    for(var k=0;k<Math.max(sn,1);k++)h+='<i class="ez-seg'+(k<(sn?doneS:0)?' on':'')+'"></i>';
    h+='</span><span class="ez-prog">'+(sn?doneS:0)+'/'+Math.max(sn,1)+'</span></div>';
    h+='<div class="ez-mfoot">'+
      '<button class="ez-okbtn'+(wait?' wait':'')+'" data-exec-ok="'+e.nodeId+'">✓ 完成'+(sn?' · '+doneS+'/'+sn:'')+'</button>'+
      '<button class="ez-dcbtn" data-exec-decomp="'+e.nodeId+'" title="添加子任务">＋</button></div>'+
      '<span class="ez-hint" data-hint="'+e.nodeId+'">还差 '+(sn-doneS)+' 项</span>';
    h+='</div>';
    /* ── 右侧两排卫星 ── */
    if(sn>0||e.editing){
      h+='<div class="ez-rail"><div class="ez-trail" data-trail="'+e.nodeId+'">';
      subs.forEach(function(sub,si){
        h+='<div class="ez-sat'+(sub.done?' done':'')+'">'+
          '<span class="ez-sat-name" title="'+escHtml(sub.t)+'">'+escHtml(sub.t)+'</span>'+
          '<span class="ez-sat-row"><button class="ez-ck'+(sub.done?' on':'')+'" data-st="'+e.nodeId+'-'+si+'" title="'+(sub.done?'取消':'完成')+'">✓</button>'+
          '<span class="ez-sub-del" data-sd="'+e.nodeId+'-'+si+'" title="删除">×</span></span></div>';
      });
      if(e.editing)h+='<div class="ez-addsat"><input data-add="'+e.nodeId+'" placeholder="子项名…"></div>';
      h+='</div>'+
        '<span class="ez-tnav prev" data-nav="'+e.nodeId+'|-1" title="向左翻看">‹</span>'+
        '<span class="ez-tnav next" data-nav="'+e.nodeId+'|1" title="向右翻看">›</span></div>';
    }
    h+='</div>';
  });
  zone.innerHTML=h;
  zone.classList.toggle('collapsed',_zoneCollapsed);

  /* ── 绑定：面板折叠（T9j）／‹ › 翻看（v11） ── */
  var tg=document.getElementById('ezToggle');
  if(tg)tg.onclick=function(){_zoneCollapsed=!_zoneCollapsed;execSave();execRender()};
  zone.querySelectorAll('[data-nav]').forEach(function(b){
    b.onclick=function(ev){ev.stopPropagation();
      var q2=b.dataset.nav.split('|');
      var tr=zone.querySelector('[data-trail="'+q2[0]+'"]');
      if(tr)tr.scrollLeft+=(+q2[1])*100};
  });
  /* ── 绑定：完成钮（恒定，wait 态抖动+提示；全勾或无子项→完成→粒子→移出 T9c） ── */
  zone.querySelectorAll('[data-exec-ok]').forEach(function(btn){
    btn.onclick=function(ev){ev.stopPropagation();
      var n=nodeAnyById(+btn.dataset.execOk);
      if(!n||n.progress>=1)return;
      var subs=n.checklist||[];
      var doneS=subs.filter(function(s){return s.done}).length;
      if(subs.length===0||doneS===subs.length){
        if(writeDone(n,true))completeWithRitual(btn.closest('.ez-main'),n.id);
        return;
      }
      btn.classList.remove('shake');void btn.offsetWidth;btn.classList.add('shake');
      var hint=zone.querySelector('[data-hint="'+n.id+'"]');
      if(hint){hint.classList.add('show');setTimeout(function(){hint.classList.remove('show')},1600)};
    };
  });
  /* ── 绑定：停止执行（不改进度）── */
  zone.querySelectorAll('[data-exec-x]').forEach(function(x){
    x.onclick=function(ev){ev.stopPropagation();execRemove(+x.dataset.execX);enterToday()}; /* enterToday 同步清单执行标记 */
  });
  /* ── 绑定：子项完成/取消（全勾 → 父自动完成 → 粒子先于移出 T9g）── */
  zone.querySelectorAll('[data-st]').forEach(function(t){
    t.onclick=function(ev){ev.stopPropagation();
      var p=t.dataset.st.split('-');
      var n=nodeAnyById(+p[0]);
      if(n&&n.checklist&&n.checklist[+p[1]]){
        n.checklist[+p[1]].done=!n.checklist[+p[1]].done;
        var allDone=n.checklist.every(function(x){return x.done});
        if(allDone&&n.progress<1){
          if(writeDone(n,true))
            completeWithRitual(t.closest('.ez-pair').querySelector('.ez-main'),n.id);
        }else{
          touch();enterToday();
        }
      }
    };
  });
  /* ── 绑定：子项删除（hover ×，T9h）── */
  zone.querySelectorAll('[data-sd]').forEach(function(d){
    d.onclick=function(ev){ev.stopPropagation();
      var p=d.dataset.sd.split('-');
      var n=nodeAnyById(+p[0]);
      if(n&&n.checklist)n.checklist.splice(+p[1],1);
      touch();enterToday();
    };
  });
  /* ── 绑定：[＋ 分解]（05.6 v6：子面板尾部直接新增编辑态子块，主卡无输入行）── */
  zone.querySelectorAll('[data-exec-decomp]').forEach(function(btn){
    btn.onclick=function(ev){ev.stopPropagation();
      var e2=execFind(+btn.dataset.execDecomp);
      if(e2){e2.decomposed=true;e2.editing=true;execRender();execSave()}
    };
  });
  /* ── 绑定：编辑态子块（T9e：Enter=落名并追加下一块；Esc/空值失焦=收回空块）── */
  zone.querySelectorAll('.ez-addsat input').forEach(function(inp){
    inp.onkeydown=function(ev){ev.stopPropagation();
      var e2=execFind(+inp.dataset.add);
      if(ev.key==='Enter'){
        var v=inp.value.trim();
        if(v){
          var n=nodeAnyById(+inp.dataset.add);
          if(n){
            n.checklist=n.checklist||[];
            n.checklist.push({t:v,done:false});    /* 《6》§B：{t,done} */
            touch();enterToday();                  /* editing 保持 → 落名转成品卡并追加空块 */
          }
        }else if(e2){e2.editing=false;execRender()} /* 空 Enter = 收回 */
      }
      if(ev.key==='Escape'&&e2){e2.editing=false;execRender()}
    };
    inp.onblur=function(){                          /* 空值失焦收回；有值保留待录 */
      if(!inp.value.trim()){
        var e2=execFind(+inp.dataset.add);
        if(e2){e2.editing=false;setTimeout(execRender,0)}
      }
    };
    inp.onclick=function(ev){ev.stopPropagation()};
  });
  /* editing 态重渲染后回焦编辑块（连续录入；rAF 等布局落定再聚焦） */
  _exec.forEach(function(e){
    if(!e.editing)return;
    var nid=e.nodeId;
    requestAnimationFrame(function(){
      var inp=zone.querySelector('.ez-addsat input[data-add="'+nid+'"]');
      if(inp){inp.focus();try{inp.setSelectionRange(inp.value.length,inp.value.length)}catch(err){}}
    });
  });
  updateTrailNav();
}
function execTick(){
  if(_execTimer)clearInterval(_execTimer);
  _execTimer=setInterval(function(){
    if(!_exec.length)return;
    _exec.forEach(function(e){
      var el=document.querySelector('[data-exec-t="'+e.nodeId+'"]');
      if(el){
        el.textContent=execFmt(Date.now()-e.startedAt);
        el.classList.remove('pulse');void el.offsetWidth;el.classList.add('pulse');
      }
    });
  },1000);
}
/* trail ‹ › 可用态校准（v11）：溢出才亮箭头；输入态自动贴最右 */
function updateTrailNav(){
  var zone=document.getElementById('execZone');
  if(!zone)return;
  zone.querySelectorAll('.ez-trail').forEach(function(tr){
    var up=function(){
      var prev=tr.parentElement.querySelector('.prev'),next=tr.parentElement.querySelector('.next');
      if(prev)prev.classList.toggle('off',tr.scrollLeft<8);
      if(next)next.classList.toggle('off',tr.scrollLeft+tr.clientWidth>tr.scrollWidth-8)};
    if(tr.querySelector('.ez-addsat'))tr.scrollLeft=tr.scrollWidth;
    up();tr.addEventListener('scroll',up,{passive:true});
    setTimeout(up,220);
  });
}

/* ---------- 日视角（05.4：周泡泡点击进入，导航入口永远回真今天） ---------- */
var _viewDay=null;      /* null = 真今天 */
export function setDay(dk){_viewDay=dk||null}

function allLeaves(){
  var isles=getIslands(),roots=[];
  isles.forEach(function(i){i.trees.forEach(function(r){roots.push(r)})});
  return q.allLeaves(roots);
}
function treeRoots(){
  var roots=[];
  getIslands().forEach(function(i){i.trees.forEach(function(r){roots.push(r)})});
  return roots;
}
function treeName(n){
  var isles=getIslands();
  for(var i=0;i<isles.length;i++)
    for(var j=0;j<isles[i].trees.length;j++)
      if(isles[i].trees[j]===q.treeOf(n))return isles[i].name+' · '+isles[i].trees[j].title;
  return '';
}
function treeColorCss(n){
  var tr=q.treeOf(n);
  return tr?treeColorOf(tr):'#5E667C';
}

function injectCSS(){
  if(_cssDone)return;_cssDone=true;
  var css=document.createElement('style');css.textContent=`
/* ===== 今日面板（HUD · 右侧） ===== */
.tp{position:fixed;right:12px;top:64px;bottom:12px;width:400px;z-index:11;
  background:rgba(10,12,18,.78);border:1px solid var(--lx-line-1,rgba(255,255,255,.06));
  border-radius:var(--lx-r-lg,12px);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--lx-font,-apple-system,'Segoe UI','Microsoft YaHei',sans-serif);
  color:var(--lx-text-2,#9BA3B8);box-shadow:inset 0 1px 0 rgba(255,255,255,.03),0 20px 60px rgba(0,0,0,.35)}
.tp-head{flex:none;padding:16px 18px 12px;border-bottom:1px solid var(--lx-line-1);
  display:flex;align-items:center;gap:14px}
.tp-date{font-size:16px;font-weight:600;color:var(--lx-text-1,#EDEFF7);letter-spacing:-.01em;
  display:flex;align-items:center;gap:9px}
.tp-chip-today{display:inline-block;font-size:9.5px;font-weight:600;color:#4CC38A;
  border:1px solid rgba(76,195,138,.4);background:rgba(76,195,138,.08);
  border-radius:999px;padding:2px 8px;letter-spacing:.06em}
.tp-chip-m{display:inline-block;font-size:9.5px;font-weight:500;color:var(--lx-text-3);
  border:1px solid var(--lx-line-1);border-radius:999px;padding:2px 8px}
.tp-sub{font-size:10px;color:var(--lx-text-4,#3B4256);margin-top:2px;letter-spacing:.04em}
.tp-body{flex:1;overflow-y:auto;padding:10px 12px 14px;scrollbar-width:thin}
.tp-body.hist .td-task{cursor:default}
.tp-body.hist .ring{cursor:default;opacity:.7}
.tp-sec{font-size:10px;font-weight:600;letter-spacing:.1em;color:var(--lx-text-4);
  margin:10px 8px 6px;padding-top:8px;border-top:1px solid var(--lx-line-1);
  display:flex;align-items:center;gap:6px}
/* ===== 总进度环（05.5：工时加权） ===== */
.ring-big{width:44px;height:44px;border-radius:50%;position:relative;flex:none;margin-left:auto;
  background:conic-gradient(var(--lx-ph-ripe,#D97618) var(--p,0%),rgba(255,255,255,.09) 0);
  transition:--p .6s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
.ring-big::after{content:'';position:absolute;inset:5px;border-radius:50%;
  background:rgba(10,12,18,.95);box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.ring-big .rt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:600;color:var(--lx-text-1);z-index:1;font-variant-numeric:tabular-nums}
/* ===== 任务环（完成=绿色填充，05.2 v2） ===== */
.ring{width:20px;height:20px;border-radius:50%;flex:none;position:relative;
  background:conic-gradient(var(--lx-ok,#4CC38A) var(--p,0%),rgba(255,255,255,.09) 0);
  transition:--p .42s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
.ring::after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--lx-bg-2,#0E1119);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
.ring.zero{background:rgba(255,255,255,.09)}
.ring.done{background:var(--lx-ok,#4CC38A)}
.ring.done::after{background:transparent}
.ring.done::before{content:'\\2713';position:absolute;inset:0;display:flex;align-items:center;
  justify-content:center;font-size:10px;color:#fff;z-index:1}
/* ===== 清单卡（模块拼接式） ===== */
.td-task{display:flex;align-items:center;gap:11px;padding:10px 13px;margin-bottom:6px;
  background:linear-gradient(180deg,rgba(255,255,255,.02),transparent 50%),var(--lx-bg-2,#0E1119);
  border:1px solid var(--lx-line-1,rgba(255,255,255,.06));border-radius:var(--lx-r-md,8px);
  cursor:grab;user-select:none;touch-action:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.028);
  transition:border-color .16s,transform .16s}
.td-task:hover{border-color:var(--lx-line-3);transform:translateY(-1px)}
/* —— 熟柿仪式（T16：环充能→划线→脉冲→果粒迸发） —— */
.td-task.completing{animation:lx-ripe .62s var(--lx-m-out,cubic-bezier(.22,1,.36,1));
  pointer-events:none}
.td-task.completing .td-name{position:relative}
.td-task.completing .td-name::after{content:'';position:absolute;left:0;top:55%;height:1.5px;
  width:100%;background:var(--lx-text-3);transform:scaleX(0);transform-origin:left center;
  animation:lx-strike .34s ease-out .16s forwards}
@keyframes lx-strike{to{transform:scaleX(1)}}
.td-task.done{opacity:.5}
.td-task.done .td-name{text-decoration:line-through;color:var(--lx-text-4)}
.td-task .td-name{flex:1;min-width:0;font-size:12px;font-weight:500;color:var(--lx-text-1);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.005em}
.td-task .td-sub{display:block;font-size:9.5px;color:var(--lx-text-4);margin-top:1px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td-task .hrs{font-size:10.5px;color:var(--lx-text-3);font-variant-numeric:tabular-nums}
.td-task .tag{font-size:9px;color:var(--lx-dom-1,#5B9BE6);border:1px solid rgba(91,155,230,.22);
  background:rgba(91,155,230,.06);border-radius:999px;padding:1.5px 9px;letter-spacing:.03em}
.td-task .mk-tag{font-size:9px;color:var(--lx-ok,#4CC38A);border:1px solid rgba(76,195,138,.25);
  background:rgba(76,195,138,.06);border-radius:4px;padding:1px 6px;letter-spacing:.04em}
/* ===== 子项行内胶囊（卡内第二行，紧凑） ===== */
.sub-chips{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;margin-left:31px}
.sub-chip{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 3px 0 2px;
  border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
  font-size:10px;color:var(--lx-text-3);cursor:default;transition:all .12s;max-width:160px}
.sub-chip:hover{border-color:rgba(122,200,120,.3)}
.sub-chip .sub-cn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;cursor:default}
.sub-chip.done{opacity:.5;border-color:rgba(255,217,112,.35)}
.sub-chip.done .sub-cn{text-decoration:line-through}
.sub-ck{appearance:none;flex:none;width:16px;height:16px;border-radius:50%;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center;padding:0;line-height:1;
  border:1.5px solid rgba(122,200,120,.4);background:transparent;
  font-size:8px;font-weight:700;color:transparent;transition:all .12s}
.sub-ck:hover{border-color:#7AC878}
.sub-ck.on{border-color:#4CC38A;background:#4CC38A;color:#fff}
.sub-plus{display:inline-flex;align-items:center;justify-content:center;height:22px;width:22px;
  border-radius:50%;border:1px dashed rgba(122,200,120,.35);color:rgba(122,200,120,.6);
  cursor:pointer;font-size:12px;transition:all .12s;user-select:none}
.sub-plus:hover{color:#7AC878;border-color:#7AC878;background:rgba(122,200,120,.06)}
/* 任务卡 hover 删除 × */
.td-del{flex:none;font-size:12px;color:rgba(140,160,180,.4);cursor:pointer;min-width:18px;height:18px;
  display:inline-flex;align-items:center;justify-content:center;border-radius:5px;
  opacity:0;transition:all .12s;user-select:none}
.td-task:hover .td-del{opacity:.6}
.td-del:hover{opacity:1!important;color:#E66A6A;background:rgba(230,106,106,.1)}
/* 子项胶囊 hover 删除 × */
.sub-dl{flex:none;font-size:10px;color:rgba(140,160,180,.4);cursor:pointer;
  min-width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:4px;opacity:0;transition:all .12s;user-select:none}
.sub-chip:hover .sub-dl{opacity:.5}
.sub-dl:hover{opacity:1!important;color:#E66A6A}
/* 子项原位编辑输入框 */
.sub-edit{width:120px;height:20px;background:var(--lx-bg-3,#080A10);
  border:1px solid var(--lx-line-2);border-radius:5px;color:var(--lx-text-1);
  padding:0 6px;font-size:10.5px;font-family:inherit;outline:none}
.sub-edit:focus{border-color:rgba(122,200,120,.5)}
/* 分解占位（无子项时＋按钮旁的提示） */
.sub-hint{font-size:9.5px;color:var(--lx-text-4);margin-left:4px}
/* ===== 空态（精修：图标 + 标题 + 说明 + 行动按钮） ===== */
.tp-empty{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
  padding:26px 16px;margin-top:10px;border:1px dashed rgba(255,255,255,.08);
  border-radius:var(--lx-r-lg,12px);background:rgba(255,255,255,.012)}
.te-ico{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:15px;color:#4CC38A;background:rgba(76,195,138,.07);
  border:1px solid rgba(76,195,138,.22);box-shadow:0 0 18px rgba(76,195,138,.1)}
.te-t{font-size:12.5px;font-weight:600;color:var(--lx-text-2);margin-top:3px;letter-spacing:.01em}
.te-s{font-size:10.5px;color:var(--lx-text-3);line-height:1.7;max-width:232px}
.te-btn{margin-top:7px;height:26px;padding:0 15px;font-size:11px;border-radius:999px;
  color:#4CC38A;border:1px solid rgba(76,195,138,.3);background:rgba(76,195,138,.06);
  cursor:pointer;font-family:inherit;transition:all .16s ease}
.te-btn:hover{background:rgba(76,195,138,.12);border-color:rgba(76,195,138,.45);
  box-shadow:0 0 14px rgba(76,195,138,.14)}
/* ===== ＋临时按钮（R26：工时可空/0） ===== */
.tp-temp{flex:none;align-self:center;font-size:11px;font-weight:500;color:var(--lx-temp,#38BDF8);cursor:pointer;
  border:1px solid rgba(56,189,248,.25);background:rgba(56,189,248,.06);
  border-radius:999px;padding:4px 13px;margin-left:12px;user-select:none;transition:all .16s ease}
.tp-temp:hover{background:rgba(56,189,248,.13);border-color:rgba(56,189,248,.4)}
/* ===== 底部日条（05.4：与周规划同源泡泡陈列） ===== */
.tp-days{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:11;
  display:flex;gap:14px;pointer-events:auto;padding-top:14px}   /* dock 改隐藏式后复位（悬停浮现时临时覆盖可接受） */
.tp-days::before{content:'点当前日回周规划';position:absolute;top:-4px;left:50%;
  transform:translateX(-50%);font-size:9.5px;color:var(--lx-text-3,#5E667C);
  letter-spacing:.06em;white-space:nowrap}
.tp-days .bubble{cursor:pointer;transition:border-color .16s,box-shadow .16s,transform .18s var(--lx-m-out,cubic-bezier(.22,1,.36,1))}
.tp-days .bubble:hover{transform:translateY(-3px);border-color:var(--lx-line-3,rgba(255,255,255,.18))}
.tp-days .bubble:hover{transform:translateY(-2px)}
.tp-days .bubble.sel{border-color:rgba(139,150,248,.65);          /* 选中日描边高亮（05.4） */
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),inset 0 -12px 20px rgba(0,0,0,.22),
    0 0 0 3px rgba(122,134,248,.15),0 12px 30px rgba(0,0,0,.4)}
/* ===== 补点选择器（05.3：未来 14 天 / 满日灰显 / 今日高亮 / 可清除） ===== */
.mkp-overlay{position:fixed;inset:0;z-index:60;background:rgba(3,4,8,.62);
  backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center}
.mkp-overlay.open{display:flex}
.mkp{width:280px;background:var(--lx-bg-2,#0E1119);border:1px solid var(--lx-line-2);
  border-radius:var(--lx-r-lg,12px);padding:14px;
  box-shadow:0 24px 80px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.05)}
.mkp .mk-t{font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;
  margin-bottom:4px}
.mkp .mk-t i{width:7px;height:7px;border-radius:50%;background:var(--lx-ph-rotten);
  box-shadow:0 0 8px rgba(138,90,43,.5);flex:none}
.mkp .mk-s{font-size:9.5px;color:var(--lx-text-4);margin-bottom:12px}
.mk-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.mk-d{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0 5px;
  border-radius:6px;border:1px solid transparent;cursor:pointer;transition:all .15s;position:relative}
.mk-d:hover{border-color:rgba(139,150,248,.45);background:rgba(122,134,248,.08)}
.mk-d span{font-size:8px;color:var(--lx-text-4)}
.mk-d b{font-size:11px;font-weight:600;color:var(--lx-text-2)}
.mk-d.full b{color:var(--lx-warn,#D9A13E)}
.mk-d.today{border-color:rgba(217,196,106,.5);background:rgba(217,196,106,.08)}
.mk-d.today b{color:var(--lx-ph-yellow,#D9C46A)}
.mk-clear{grid-column:1/-1;font-size:10.5px;color:var(--lx-warn,#D9A13E);cursor:pointer;
  text-align:center;padding:5px 0;border:1px dashed rgba(217,161,62,.35);border-radius:6px;margin-top:4px}
.mk-clear:hover{background:rgba(217,161,62,.1)}
/* ===== 落叶堆欠账面板 ===== */
#backlogPanel{position:fixed;z-index:60;width:250px;max-height:60vh;overflow-y:auto;
  background:rgba(14,17,25,.94);backdrop-filter:blur(14px);border:1px solid var(--lx-line-2);
  border-radius:14px;box-shadow:0 18px 46px rgba(0,0,0,.6);padding:10px}
#backlogPanel .bl-head{font-size:11px;font-weight:600;color:var(--lx-text-2,#9BA3B8);
  padding:2px 6px 8px;border-bottom:1px solid var(--lx-line-1);margin-bottom:6px}
#backlogPanel .bl-it{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:7px;
  cursor:pointer;font-size:11.5px;color:var(--lx-text-3)}
#backlogPanel .bl-it:hover{background:rgba(255,255,255,.04);color:var(--lx-text-1)}
#backlogPanel .bl-it .num{font-size:10px;color:var(--lx-text-4);width:36px;flex:none}
#backlogPanel .bl-it .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#backlogPanel .bl-it .h{font-size:10px;color:var(--lx-text-4)}
#backlogPanel .bl-empty{font-size:11px;color:var(--lx-text-4);text-align:center;padding:10px 0}
.pt-np input{margin-bottom:6px;width:100%;background:var(--lx-bg-3,#080A10);
  border:1px solid var(--lx-line-1);border-radius:6px;color:var(--lx-text-1);
  padding:6px 10px;font-size:12px;font-family:inherit;outline:none}
/* ===== 执行区 v11（玻璃翡翠 · 主卡+右侧两排卫星） ===== */
#execZone{position:fixed;top:64px;left:16px;z-index:45;width:auto;max-width:44vw;pointer-events:auto;
  max-height:calc(100vh - 200px);overflow-y:auto;scrollbar-width:thin;
  transition:opacity .3s ease;
  --acc:#8de88d;--accMid:rgba(141,232,141,.55);--accDim:rgba(141,232,141,.35);
  --accFaint:rgba(141,232,141,.12);--accText:#a9f0c0;--glow:rgba(141,232,141,.28);
  --glowSoft:rgba(141,232,141,.1);--segGrad:linear-gradient(180deg,#b2f7c6,#5fce85);
  --nameTx:#e8f0fa;--subTx:#d5deed;--mutedTx:#8b9bb5;--cardBg:rgba(18,26,24,.66);
  --cardBorder:rgba(141,232,141,.32);--doneBorder:rgba(255,217,112,.42);
  --ckOnTx:#06231a;--danger:#ff8f95;
  --btnBg:linear-gradient(180deg,rgba(141,232,141,.14),rgba(141,232,141,.06));
  --btnPrimary:linear-gradient(180deg,rgba(141,232,141,.28),rgba(141,232,141,.14))}
#execZone.collapsed{width:auto}
.ez-title{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;
  letter-spacing:.1em;margin-bottom:12px;padding-bottom:6px;color:var(--acc);
  border-bottom:1px solid rgba(255,255,255,.08)}
.ez-title::after{content:'';flex:1;height:1px;opacity:.25}
.ez-toggle{margin-left:auto;cursor:pointer;padding:0 5px;font-weight:400;opacity:.6;user-select:none}
.ez-toggle:hover{opacity:1}
.ez-pill{display:inline-flex;align-items:center;gap:8px;font-size:11px;padding:7px 14px;
  border-radius:999px;border:1px solid var(--accDim);color:var(--accText);
  background:rgba(255,255,255,.04);animation:ez-pill-float 3s ease-in-out infinite;user-select:none}
@keyframes ez-pill-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
@keyframes ez-pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
/* —— 组：主卡（含分解钮）+ 右侧两排卫星网格 —— */
.ez-pair{display:flex;gap:8px;align-items:stretch;margin-bottom:12px;animation:ez-pop .2s ease-out}
.ez-main{flex:none;width:176px;display:flex;flex-direction:column;gap:6px;
  border:1px solid var(--cardBorder);background:var(--cardBg);backdrop-filter:blur(12px);
  border-radius:14px;padding:10px 12px;position:relative;
  animation:ez-card-glow 2.4s ease-in-out infinite}
@keyframes ez-card-glow{0%,100%{box-shadow:0 6px 20px rgba(0,0,0,.3),0 0 4px var(--glowSoft)}
  50%{box-shadow:0 6px 20px rgba(0,0,0,.3),0 0 12px var(--glow)}}
.ez-main-top{display:flex;align-items:center;gap:8px;flex:1;min-height:0}
.ez-name{flex:1;min-width:0;color:var(--nameTx);font-weight:600;font-size:12.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ez-close,.ez-sub-del{font-size:12px;color:var(--mutedTx);cursor:pointer;min-width:16px;min-height:16px;
  display:inline-flex;align-items:center;justify-content:center;border-radius:5px;opacity:.55;
  transition:all .15s;flex:none;user-select:none}
.ez-close:hover,.ez-sub-del:hover{opacity:1;color:var(--danger);background:rgba(255,110,120,.12)}
.ez-sub-del{position:absolute;top:1px;right:1px;font-size:10px;min-width:12px;height:12px;opacity:.35}
.ez-time{color:var(--acc);font-weight:700;font-size:13px;font-variant-numeric:tabular-nums;
  display:inline-flex;align-items:center;gap:5px;flex:none}
.ez-time::before{content:'\\23F1';font-size:10px;opacity:.75;font-family:'Segoe UI Symbol','Noto Sans Symbols2',sans-serif}
.ez-time.pulse{animation:ez-tick .5s ease-out}
@keyframes ez-tick{from{transform:scale(.97)}to{transform:scale(1)}}
/* 进度线 */
.ez-prog-line{display:flex;align-items:center;gap:8px}
.ez-bar{display:flex;gap:2px;height:3px;flex:1}
.ez-seg{flex:1;border-radius:1px;background:var(--accFaint);transition:background .2s}
.ez-seg.on{background:var(--segGrad);box-shadow:0 0 6px var(--glow)}
.ez-prog{font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;color:var(--accText);background:var(--accFaint)}
/* 底槽：完成 2/3 + 素 ＋ 1/3 */
.ez-mfoot{margin-top:auto;display:flex;align-items:center;gap:6px;height:26px}
.ez-okbtn{appearance:none;font-family:inherit;font:600 11px/1 inherit;height:26px;border-radius:9px;
  cursor:pointer;flex:2 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;
  transition:all .15s;border:1px solid var(--accMid);background:var(--btnPrimary);color:var(--accText)}
.ez-okbtn:hover{transform:translateY(-1px);border-color:rgba(255,217,112,.55);box-shadow:0 4px 14px rgba(255,217,112,.3)}
.ez-okbtn.wait{border-color:var(--accDim);background:var(--btnBg)}
.ez-okbtn.wait:hover{transform:none;box-shadow:none}
.ez-okbtn.shake{animation:ez-shake .3s ease}
@keyframes ez-shake{0%,100%{transform:translateX(0)}30%{transform:translateX(-3px)}60%{transform:translateX(3px)}}
.ez-dcbtn{appearance:none;font-family:inherit;font:400 15px/1 inherit;height:26px;border-radius:9px;
  cursor:pointer;flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;
  transition:all .15s;border:none;background:none;color:var(--mutedTx)}
.ez-dcbtn:hover{color:var(--accText);background:var(--accFaint)}
.ez-hint{font-size:10px;color:var(--mutedTx);position:absolute;bottom:4px;right:12px;
  opacity:0;transition:opacity .3s}
.ez-hint.show{opacity:1}
/* 右侧两排卫星网格 */
.ez-rail{display:flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0}
.ez-trail{display:grid;grid-auto-flow:column;grid-template-rows:repeat(2,56px);grid-auto-columns:94px;
  column-gap:6px;row-gap:6px;align-content:center;overflow:hidden;min-height:118px;max-width:294px;
  scroll-behavior:smooth}
.ez-sat{box-sizing:border-box;width:94px;height:56px;border-radius:11px;padding:6px 7px;position:relative;
  border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.045);backdrop-filter:blur(8px);
  display:flex;flex-direction:column;justify-content:space-between;gap:4px;transition:all .15s;
  animation:ez-pop .2s ease-out}
.ez-sat:hover{border-color:var(--accDim);transform:translateY(-1px)}
.ez-sat .ez-sat-name{font-size:11px;line-height:1.3;color:var(--subTx);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;
  padding-right:12px}
.ez-sat.done{opacity:.62;border-color:var(--doneBorder)}
.ez-sat.done .ez-sat-name{text-decoration:line-through;color:rgba(232,240,238,.78)}
.ez-sat .ez-sat-row{display:flex;align-items:center;justify-content:space-between}
.ez-ck{appearance:none;flex:none;min-width:24px;height:20px;border-radius:9px;font:700 10px/1 inherit;
  cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0 5px;
  transition:all .15s;color:transparent;border:1px solid var(--accDim);background:var(--btnBg)}
.ez-ck:hover{transform:translateY(-1px);border-color:var(--accMid);box-shadow:0 3px 10px var(--glowSoft)}
.ez-ck.on{background:var(--segGrad);border-color:var(--accMid);color:var(--ckOnTx);box-shadow:0 0 10px var(--glow)}
.ez-addsat{box-sizing:border-box;width:94px;height:56px;border-radius:11px;border:1px dashed var(--accMid);
  display:flex;align-items:center;padding:0 8px;cursor:text;box-shadow:0 0 0 1px var(--glowSoft)}
.ez-addsat input{width:100%;background:transparent;border:none;outline:none;
  font:500 11px/1.3 inherit;color:var(--nameTx)}
.ez-addsat input::placeholder{color:var(--mutedTx);opacity:.6}
.ez-tnav{flex:none;width:22px;height:56px;display:inline-flex;align-items:center;justify-content:center;
  cursor:pointer;color:var(--accText);opacity:.6;border-radius:8px;transition:all .15s;user-select:none}
.ez-tnav:hover{opacity:1;background:var(--accFaint)}
.ez-tnav.off{opacity:.12;cursor:default}
/* 完成脉冲（T16 仪式的卡片级反馈） */
.ez-main.completing{animation:ez-ripe .62s ease;pointer-events:none}
@keyframes ez-ripe{0%{box-shadow:0 0 0 0 rgba(141,232,141,0)}
  35%{box-shadow:0 0 18px 2px rgba(141,232,141,.4)}
  100%{box-shadow:0 0 0 0 rgba(141,232,141,0)}}
/* ===== 清单 v5：执行中呼吸边／树色点／程胶囊／负载条／组头吸顶／间隙线 ===== */
.td-task{transition:border-color .16s,transform .16s,box-shadow .16s}
.td-task.executing{border-left:2px solid rgba(122,200,120,.7)}  /* 静态标识，无动画 */
.exec-flag{color:rgba(122,200,120,.85);font-weight:600}
.tree-dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px;vertical-align:1px}
.temp-tag{font-size:9px;color:var(--lx-temp,#38BDF8);border:1px solid rgba(56,189,248,.3);
  background:rgba(56,189,248,.08);border-radius:999px;padding:1px 7px;letter-spacing:.05em}
.load-bar{display:inline-block;vertical-align:middle;width:64px;height:4px;border-radius:2px;
  background:rgba(255,255,255,.08);overflow:hidden;margin-left:6px}
.load-bar i{display:block;height:100%;border-radius:2px;background:rgba(126,186,104,.8);transition:width .3s ease}
.load-bar.warn i{background:rgba(217,161,62,.85)}
.load-bar.over i{background:rgba(229,105,111,.9)}
.tp-body{position:relative}
.tp-sec{position:sticky;top:0;z-index:2;background:rgba(10,12,18,.88);
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:6px}
.done-wrap{display:grid;grid-template-rows:0fr;transition:grid-template-rows .2s ease-out}
.done-wrap.open{grid-template-rows:1fr}
.done-inner{overflow:hidden;min-height:0}
#dropLine{position:absolute;left:12px;right:12px;height:2px;border-radius:1px;z-index:3;
  background:rgba(122,200,120,.85);box-shadow:0 0 8px rgba(122,200,120,.5);pointer-events:none}`;
  document.head.appendChild(css);
  /* 补点选择器 DOM（05.3） */
  var ov=document.createElement('div');ov.className='mkp-overlay';ov.id='mkpOverlay';
  ov.innerHTML='<div class="mkp"><div class="mk-t"><i></i>补点到哪天？</div>'+
    '<div class="mk-s" id="mkpSub"></div><div class="mk-grid" id="mkpGrid"></div></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('open')});
}

/* ---------- 补点选择器（05.3/R18：覆盖更新、清除） ---------- */
var mkpNode=null;
function openMkp(node){
  mkpNode=node;
  var ov=document.getElementById('mkpOverlay');
  if(!ov)return;
  document.getElementById('mkpSub').textContent=node.title+' · '+
    (node.hours||0)+'h · 原排期已过，选一天补做';
  var WD=['日','一','二','三','四','五','六'];
  var t0=today();
  var h='';
  for(var w=0;w<2;w++)for(var d=0;d<7;d++){          /* 未来 14 天网格 */
    var dt=addDays(parse(t0.d),w*7+d);
    var iso=dstr(dt);
    /* 满日灰显：与周泡泡/顶带同口径（R24） */
    var cap=dayCapOf(data.caps,iso);
    var ld=q.dayHours(treeRoots(),iso,data.temps);
    var full=cap>0?ld>=cap:ld>0;
    var isTd=iso===t0.d;
    h+='<div class="mk-d'+(isTd?' today':'')+(full?' full':'')+'" data-iso="'+iso+'">'+
      '<span>'+WD[dt.getDay()]+'</span><b>'+dt.getDate()+'</b></div>';
    if(d===6&&w===0)h+='<div style="grid-column:1/-1;height:5px"></div>';
  }
  h+=(mkpNode.makeup?'<div class="mk-clear" id="mkClear" title="清除补点，回到无补点状态">✕ 清除补点</div>':'');
  document.getElementById('mkpGrid').innerHTML=h;
  ov.querySelectorAll('.mk-d').forEach(function(el){
    el.onclick=function(){
      /* R17：原排期冻结为历史锚点，新排期写 makeup（经变更服务） */
      writeMakeup(el.dataset.iso);
      ov.classList.remove('open');
      enterToday();
    };
  });
  var mc=document.getElementById('mkClear');
  if(mc)mc.onclick=function(){
    writeMakeup(null);
    ov.classList.remove('open');
    enterToday();
  };
  ov.classList.add('open');
}
function writeMakeup(iso){
  if(!mkpNode)return;
  if(mkpNode.lvl==='temp')updateTemp(mkpNode.id,{makeup:iso});
  else updateTask(mkpNode,{makeup:iso});
}
/* 落果点击 → 补点选择器（interact 'fallen' 路由，T5） */
export function openFallenMkp(node){openMkp(node)}

/* ---------- 落叶堆点击 → 历史欠账清单（interact 'pile' 路由） ---------- */
var _backlog=null;
export function openBacklogPanel(){
  closeBacklogPanel();
  var t0=today();
  var vw=weekKeyOf(parse(_viewDay||t0.d));      /* 与呈现中的落叶堆同周（05.4） */
  var ls=q.leafPile(treeRoots(),data.temps,weekDays(vw)[0],t0.d);
  var el=document.createElement('div');el.id='backlogPanel';
  el.innerHTML='<div class="bl-head">落叶堆 \u00b7 本周前的欠账 '+ls.length+' 项 \u00b7 点击选补点</div>'+
    (ls.length?ls.map(function(l){
      return '<div class="bl-it" data-nid="'+l.id+'"><span class="num">'+escHtml((l.assignD||'').slice(5))+'</span>'+
        '<span class="n">'+escHtml(l.title)+'</span><span class="h num">'+Math.round(l.hours||0)+'h</span></div>';
    }).join(''):'<div class="bl-empty">没有历史欠账 🍃</div>');
  document.body.appendChild(el);_backlog=el;
  el.style.left='24px';el.style.top='84px';
  el.querySelectorAll('.bl-it').forEach(function(it){
    it.onclick=function(){
      var n=nodeAnyById(+it.dataset.nid);
      closeBacklogPanel();
      if(n)openMkp(n);
    };
  });
  setTimeout(function(){
    document.addEventListener('pointerdown',backlogOutside,true);
  },0);
}
function backlogOutside(ev){
  if(_backlog&&!_backlog.contains(ev.target))closeBacklogPanel();
}
function closeBacklogPanel(){
  if(_backlog){_backlog.remove();_backlog=null}
  document.removeEventListener('pointerdown',backlogOutside,true);
}

/* ---------- 今日页挂载/卸载/渲染 ---------- */
var _inToday=false,_savedRoot=null,_fruitGroup=null,_pileGroup=null;
var _lastListDay=null;   /* 交互优化：同日重渲染保持清单滚动位置 */

export function weekTreeMounted(){return _inToday}

/* 虚拟周树（05.1）：主干 → 一级枝（每目标一枝 + 临时枝）→ 果。
   口径=该周已落日/已补点任务"不多不少"：含完成（树语言之金叶），
   本周超时下树为落果（R21），临时枝只含本周。
   **空枝不渲染**：本周无叶的目标枝/临时枝不挂——空分组会被树管线当成
   无排期叶渲染成断梢红光（v4），周树只显示落实到本周的任务。 */
function buildWeekVTree(t0,vw){
  var vroot={id:-1,title:'本周',depth:0,parent:null,children:[],lvl:'virtual',_virtual:true};
  var inWeek=function(d){return d&&weekKeyOf(parse(d))===vw};
  var isFallen=function(d,prog){return prog<1&&!!d&&d<t0.d};   /* R21：本周超时 → 落果 */
  function wrap(real){
    return{id:real.id,title:real.title,depth:2,parent:null,children:[],leaf:true,
      hours:real.hours||0,progress:real.progress||0,overdue:false,
      lvl:real.lvl||'week',assignD:real.makeup||real.assignD||null,assignW:real.assignW,
      makeup:real.makeup,order:real.order,checklist:real.checklist,_real:real};
  }
  treeRoots().forEach(function(root){
    var goal={id:-root.id,title:root.title,depth:1,parent:vroot,children:[],lvl:'group',_group:true};
    q.allLeaves([root]).forEach(function(l){
      var d=l.makeup||l.assignD||effD(l);
      if(!d||!inWeek(d))return;
      if(isFallen(d,l.progress))return;
      var c=wrap(l);c.parent=goal;goal.children.push(c);
    });
    if(goal.children.length)vroot.children.push(goal);      /* 空枝不挂 */
  });
  /* 临时任务枝（仅当本周有临时任务才挂，含完成态） */
  var tempBranch={id:-999,title:'临时任务',depth:1,parent:vroot,children:[],lvl:'group',_group:true,_temp:true};
  (data.temps||[]).forEach(function(t){
    var d=t.makeup||t.assignD;
    if(!d||!inWeek(d))return;
    if(isFallen(d,t.progress))return;
    var c=wrap(t);c.parent=tempBranch;tempBranch.children.push(c);
  });
  if(tempBranch.children.length)vroot.children.push(tempBranch);   /* 空枝不挂 */
  vroot.children.forEach(function(g){g.children.forEach(function(c){c.parent=g})});
  derive(vroot);
  return vroot;
}

/* ===== 今日小岛 = 世界岛右下方那座带石环/心形耕地的卫星岛（同一座，不另建） ===== */
var _stageGroup=null,_stageBody=null,_stageHeightAt=null;
function stageGround(x,z){
  if(!_stageBody)return STAGE.y;
  const s=_stageBody.scale;
  const lx=(x-STAGE.x)/s, lz=(z-STAGE.z)/s;
  const h=_stageBody.heightAt(lx,lz);
  return h==null?STAGE.y:(_stageBody.position.y+h)*s;
}
function ensureStageRock(){
  const isl=getWorldIsland();
  const mini=isl&&isl._body&&isl._body.mini;
  if(!mini)return;
  _stageGroup=mini.group;
  _stageBody=mini;
  _stageHeightAt=stageGround;
  STAGE.x=mini.center.x;
  STAGE.y=mini.center.y;
  STAGE.z=mini.center.z;
  STAGE.groundY=mini.center.y;
  STAGE.R0=mini.radius;
  STAGE.t=0;
  STAGE.tipX=mini.center.x;
  STAGE.tipY=mini.center.y+0.04*mini.scale;
  STAGE.tipZ=mini.center.z+2.25*mini.scale;
  STAGE.treeX=mini.center.x+mini.lawnTree.x*mini.scale;
  STAGE.treeZ=mini.center.z+mini.lawnTree.z*mini.scale;
}
/* 启动即定位到世界岛上的卫星岛（不新增岛体） */
export function initTodayStage(){ensureStageRock()}

/* ---------- 落果 3D（05.3：树下散果，点击开补点） ---------- */
function buildFallenFruits(list){
  removeFallenFruits();
  if(!list||!list.length)return;
  var g=new THREE.Group();
  var n=Math.min(list.length,40);
  var cols=[0xD97618,0xC25A2B,0xE8A44C];
  for(var i=0;i<n;i++){
    var m=new THREE.Mesh(new THREE.SphereGeometry(2.6,10,8),
      new THREE.MeshStandardMaterial({color:new THREE.Color(cols[i%3]).convertSRGBToLinear(),roughness:.7,flatShading:true}));
    var a=Math.random()*Math.PI*2,r=30+Math.random()*45;
    var x=(STAGE.treeX!=null?STAGE.treeX:STAGE.x)+Math.cos(a)*r,z=(STAGE.treeZ!=null?STAGE.treeZ:STAGE.z)+Math.sin(a)*r*.8;
    m.position.set(x,(_stageHeightAt?_stageHeightAt(x,z):STAGE.groundY)+1+Math.random()*1.5,z);
    m.userData.pick={kind:'fallen',node:list[i]};   /* 真实任务节点：补点写真数据（R17） */
    pickMeshes.push(m);
    g.add(m);
  }
  scene.add(g);_fruitGroup=g;
}
function removeFallenFruits(){
  if(!_fruitGroup)return;
  _fruitGroup.traverse(function(o){
    if(o.isMesh){
      var i=pickMeshes.indexOf(o);
      if(i>=0)pickMeshes.splice(i,1);
      if(o.geometry)o.geometry.dispose();
      if(o.material)o.material.dispose();
    }
  });
  scene.remove(_fruitGroup);_fruitGroup=null;
}
/* ---------- 落叶堆 3D（05.3：左侧地面，点击回看欠账） ---------- */
var _pileGeo=null;
function buildLeafPile(list){
  removeLeafPile();
  if(!list||!list.length)return;
  var g=new THREE.Group();
  var n=Math.min(list.length,60);
  var cols=[0x6e4c1e,0x7d5a24,0x5f421c,0x8a6528];
  _pileGeo=new THREE.CircleGeometry(3.6,7);    /* 共享几何体（移除时统一释放） */
  var geo=_pileGeo;
  for(var i=0;i<n;i++){
    var c=cols[i%cols.length];
    var m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({
      color:new THREE.Color(c).convertSRGBToLinear(),roughness:.95,
      emissive:new THREE.Color(c).convertSRGBToLinear(),emissiveIntensity:.03,side:THREE.DoubleSide}));
    var a=Math.PI*(0.62+Math.random()*0.76);        /* 舞台左缘扇形（聚拢成"堆"而非铺满） */
    var r=50+Math.random()*22;
    var x=(STAGE.treeX!=null?STAGE.treeX:STAGE.x)+Math.cos(a)*r,z=(STAGE.treeZ!=null?STAGE.treeZ:STAGE.z)+Math.sin(a)*r*.8;
    m.position.set(x,(_stageHeightAt?_stageHeightAt(x,z):STAGE.groundY)+.3+Math.random()*.5,z);
    m.userData.pick={kind:'pile'};
    m.rotation.x=-Math.PI/2+(Math.random()-.5)*.7;
    m.rotation.z=Math.random()*Math.PI*2;
    var s=.5+Math.random()*.55;
    m.scale.set(s,s*(1.4+Math.random()*.5),s);
    g.add(m);
    pickMeshes.push(m);
  }
  scene.add(g);_pileGroup=g;
}
function removeLeafPile(){
  if(!_pileGroup)return;
  _pileGroup.traverse(function(o){
    var i=pickMeshes.indexOf(o);
    if(i>=0)pickMeshes.splice(i,1);
    if(o.material)o.material.dispose();
  });
  scene.remove(_pileGroup);_pileGroup=null;
  if(_pileGeo){_pileGeo.dispose();_pileGeo=null}
}

export function enterToday(){
  var el=document.getElementById('viewToday');
  if(!el)return;
  viewsMark();
  injectCSS();
  ensureWeekCSS();
  if(!_execRestored){execRestore();_execRestored=true}  /* 首次进今日页恢复执行状态 */
  var t0=today();
  var vd=_viewDay||t0.d;               /* 日视角：默认真今天（05.4） */
  /* 交互优化：同一日重渲染（完成/台账变更）保持清单滚动位置；切日则回顶 */
  var _scrollKeep=0;
  if(_lastListDay===vd){
    var _oldBody=el.querySelector('.tp-body');
    if(_oldBody)_scrollKeep=_oldBody.scrollTop;
  }
  _lastListDay=vd;
  var vw=weekKeyOf(parse(vd));         /* 周树/落果/落叶堆按该日所属周呈现 */
  var isTd=vd===t0.d;
  _histRO=vd<t0.d;                     /* 历史日视角：只读（R28/R33）；执行区不渲染但状态保留（05.6 v10） */
  ensureStageRock();                    /* 小岛常驻：世界岛不再隐藏，两岛同处一片天空 */
  if(!_inToday){_savedRoot=data.root;_inToday=true}
  var vroot=buildWeekVTree(t0,vw);
  data.root=vroot;
  var _treeX=STAGE.treeX!=null?STAGE.treeX:STAGE.x;
  var _treeZ=STAGE.treeZ!=null?STAGE.treeZ:STAGE.z;
  vroot._gx=_treeX;vroot._gz=_treeZ;
  vroot._groundY=_stageHeightAt?_stageHeightAt(_treeX,_treeZ):STAGE.groundY;
  rebuild();
  buildFallenFruits(q.fallenFruits(treeRoots(),data.temps,vw,t0.d));
  buildLeafPile(q.leafPile(treeRoots(),data.temps,weekDays(vw)[0],t0.d));
  try{setEnvFocus(STAGE.x,STAGE.groundY+20,STAGE.z,STAGE.R0*1.7)}catch(e){}
  frameToday();                        /* 只改取景：焦点从大岛移到小岛 */
  /* 渲染 DOM */
  var todayLs=q.dayItems(treeRoots(),vd,data.temps);
  var maxOrder=0;
  todayLs.forEach(function(l){if(l.order!=null&&l.order>maxOrder)maxOrder=l.order});
  todayLs.forEach(function(l){if(l.order==null)l.order=++maxOrder});
  todayLs.sort(function(a,b){return(a.order||0)-(b.order||0)});
  var undone=todayLs.filter(function(l){return l.progress<1});
  var done=todayLs.filter(function(l){return l.progress>=1});
  var totalH=todayLs.reduce(function(s,l){return s+(l.hours||0)},0);
  var doneH=todayLs.reduce(function(s,l){return s+(l.progress>=1?(l.hours||0):0)},0);
  var pct=totalH>0?Math.round(doneH/totalH*100):0;      /* 工时加权（05.5） */
  var dayCap=dayCapOf(data.caps,vd);
  var h='<div class="tp">';
  h+='<div class="tp-head"><div>';
  h+='<div class="tp-date">'+dayLabel(vd).split(' ')[0]+' '+(+vd.slice(8))+
    (isTd?'<span class="tp-chip-today">今天</span>':'<span class="tp-chip-m">'+(+vd.slice(5,7))+'月</span>')+'</div>';
  var loadPct=dayCap>0?totalH/dayCap:(totalH>0?1:0);            /* 与泡泡水位同口径（R24） */
  var loadCls=loadPct>=1?'over':loadPct>=.8?'warn':'ok';
  h+='<div class="tp-sub num"><b style="color:var(--lx-text-1)">'+undone.length+'</b> 项待完成 · 负载 <b style="color:var(--lx-text-1)">'+Math.round(totalH)+'/'+dayCap+'h</b>'+
    '<span class="load-bar '+loadCls+'"><i style="width:'+Math.min(loadPct,1)*100+'%"></i></span></div>';
  h+='</div><div class="ring-big" style="--p:'+pct+'%"><span class="rt num">'+pct+'%</span></div>';
  if(!_histRO)h+='<div class="tp-temp" id="tpTemp" title="新增临时任务并落到'+(isTd?'今天':'该日')+'">＋ 临时</div>';
  h+='</div>';
  h+='<div class="tp-body'+(_histRO?' hist':'')+'">';
  h+='<div class="tp-sec">☀ '+(_histRO?'历史 · ':'')+dayLabel(vd).split(' ')[0]+' \u00b7 任务</div>';
  _cardSeq=0;
  if(!todayLs.length){
    h+='<div class="tp-empty"><div class="te-ico">◌</div>'+
      '<div class="te-t">'+(isTd?'今天':'这一天')+'还没有排程</div>'+
      '<div class="te-s">到周规划把任务拖进日泡泡，或点右上「＋临时」快速添加</div>'+
      (!_histRO?'<button class="te-btn" id="teGoWeek">去周规划</button>':'')+'</div>';
  }
  undone.forEach(function(l){h+=taskCard(l)});
  if(done.length){
    h+='<div class="tp-sec done-hdr" data-act="donetoggle"><span class="dh-arrow">'+(_doneOpen?'▾':'▸')+
      '</span> 已完成 · '+done.length+'</div>';
    h+='<div class="done-wrap'+(_doneOpen?' open':'')+'"><div class="done-inner">';
    done.forEach(function(l){h+=taskCard(l)});
    h+='</div></div>';
  }
  h+='</div></div>';
  h+='<div class="tp-days" id="tpDays"></div>';
  if(!_histRO)h+='<div id="execZone"></div>';   /* 05.6/R33：仅非历史日渲染执行区 */
  el.innerHTML=h;
  if(_scrollKeep){var _nb=el.querySelector('.tp-body');if(_nb)_nb.scrollTop=_scrollKeep}
  bindToday();
  execRender();
  renderDayStrip(vd,vw,t0);
}
export function leaveToday(){
  /* 执行区状态保留（05.6 v10）——切视图不清空，计时以 startedAt 续算。
     小岛常驻场景：离开今日只把取景与环境焦点交还世界岛。 */
  removeFallenFruits();
  removeLeafPile();
  var wi2=getWorldIsland();
  if(_inToday){
    _inToday=false;
    data.root=_savedRoot;
    _savedRoot=null;
    rebuild();
    if(wi2&&wi2.boundingBox){
      /* 恢复世界取景（自适应岛幅，瞄准岛盘中心） */
      var R=wi2._R||islandRadiusOf(wi2);
      import('./camera.js').then(function(c){
        c.tgtGoal.set(wi2.boundingBox.cx,180,wi2.boundingBox.cz);
        c.sphGoal.r=clamp(R*2.05,700,2600);
        c.startCamEase(2200);
      });
      try{setEnvFocus(wi2.boundingBox.cx,120,wi2.boundingBox.cz,R*1.25)}catch(e){}
    }
  }
}

/* ---------- 底部日条（05.4：与周规划 7 泡泡同源同款） ----------
   点当前日回周规划（回到该日所属周，泡泡收拢飞回 T15）；点其他日切换日视角 */
function renderDayStrip(vd,vw,t0){
  var wrap=document.getElementById('tpDays');
  if(!wrap)return;
  var h='';
  weekDays(vw).forEach(function(dk,i){
    var ld=q.dayHours(treeRoots(),dk,data.temps),cap=dayCapOf(data.caps,dk);
    var pct=cap>0?ld/cap:(ld>0?1:0);
    var cls=pct>=1?'over':pct>=.8?'warn':'ok';
    var isTd=dk===t0.d;
    h+='<div class="bubble '+cls+(isTd?' today':'')+(dk===vd?' sel':'')+'" data-dk="'+dk+'"'+
      ' data-rise style="--i:'+i+';--rise-base:110ms"'+
      ' title="'+(dk===vd?'再点回周规划 · ':'切换到这一天 · ')+dayLabel(dk).split(' ')[0]+' '+dk.slice(8)+'">'+
      '<div class="wave" style="height:'+Math.min(pct,1)*82+'%"></div>'+
      '<span class="dw">'+dayLabel(dk).split(' ')[0]+(isTd?' \u00b7 今天':'')+'</span>'+
      '<span class="dd num">'+dk.slice(8)+'</span>'+
      '<span class="hh num"><b>'+Math.round(ld)+'</b>/'+cap+'h</span>'+
      '</div>';
  });
  wrap.innerHTML=h;
  wrap.querySelectorAll('.bubble').forEach(function(b){
    b.onclick=function(){
      var dk=b.dataset.dk;
      if(dk===vd)backToWeek(vw);        /* 再点当前日 = 回周规划（该日所属周） */
      else{setDay(dk);enterToday()}     /* 点其他日：切换日视角 */
    };
  });
}
/* 回周规划：日泡泡飞回周规划的日期列（T15，与月↔周反向同构）。 */
function makeWeekDayAnchors(){
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
function backToWeek(vw){
  var clicked=document.querySelector('#tpDays .bubble.sel');
  if(clicked)clicked.style.opacity='.55';
  setTimeout(function(){
    /* 起点矩形在切换视图前捕获 */
    var caps=[];
    document.querySelectorAll('#tpDays .bubble').forEach(function(el){
      caps.push({el:el,rect:el.getBoundingClientRect()})});
    setWeek(vw);                        /* 回到该日所属周（T6） */
    showView('week');
    var dest=makeWeekDayAnchors();
    flyWeekBubbles(caps.filter(function(c){return dest[c.el.dataset.dk]})
      .map(function(c){return {fromEl:c.el,fromRect:c.rect,toEl:dest[c.el.dataset.dk]}}));
    setTimeout(function(){
      Object.keys(dest).forEach(function(k){try{dest[k].remove()}catch(e){}});
    },1000);
  },50);
}

/* ---------- 清单卡 ---------- */
var _cardSeq=0;
function taskCard(l){
  var done=l.progress>=1;
  var subs=l.checklist||[];
  var doneSubs=subs.filter(function(s){return s.done}).length;
  var p=done?100:(subs.length?Math.round(doneSubs/subs.length*100):0);
  var hasSubs=subs.length>0;
  var executing=!!execFind(l.id);
  var sub;
  if(l.lvl==='temp'){
    sub='<span class="temp-tag" title="临时任务（全局日程池）">程</span>';
  }else{
    var tn=treeName(l),short=tn?tn.split(' · ').pop():'';
    sub=short?'<i class="tree-dot" style="background:'+treeColorCss(l)+'" title="'+escHtml(tn)+'"></i>'+escHtml(short):'';
  }
  if(hasSubs)sub+=' · '+doneSubs+'/'+subs.length;
  if(executing)sub+=' <span class="exec-flag">⚡ 执行中</span>';
  return '<div class="td-task'+(done?' done':'')+(executing?' executing':'')+'" data-nid="'+l.id+'"'+
    (done?'':' data-rise style="--i:'+(_cardSeq++)+';--rise-base:60ms"')+'>'+
    '<span class="ring'+(done?' done':(p===0?' zero':''))+'" style="--p:'+p+'%" data-act="done"></span>'+
    '<div style="flex:1;min-width:0"><span class="td-name" title="'+escHtml(l.title)+'">'+escHtml(l.title)+'</span>'+
    '<span class="td-sub">'+sub+'</span></div>'+
    (l.makeup?'<span class="mk-tag" title="补点 '+l.makeup+'">补 '+l.makeup.slice(5)+'</span>':'')+
    '<span class="hrs num">'+Math.round(l.hours||0)+'h</span>'+
    (!_histRO&&!done?'<span class="td-del" data-del="'+l.id+'" data-temp="'+(l.lvl==='temp'?1:0)+'" title="'+(l.lvl==='temp'?'删除临时任务':'移出今日排期')+'">×</span>':'')+
    '</div>'+
    (hasSubs||!done&&!_histRO?'<div class="sub-chips">'+
      subs.map(function(s,i){
        return '<span class="sub-chip'+(s.done?' done':'')+'" data-si="'+i+'" data-nid="'+l.id+'">'+
          '<button class="sub-ck'+(s.done?' on':'')+'" data-sub="'+l.id+'|'+i+'" title="'+(s.done?'取消':'完成')+'">\u2713</button>'+
          '<span class="sub-cn" title="'+escHtml(s.t)+'" data-edit="'+l.id+'|'+i+'">'+escHtml(s.t)+'</span>'+
          (!_histRO?'<span class="sub-dl" data-sd="'+l.id+'|'+i+'" title="删除">×</span>':'')+
          '</span>';
      }).join('')+
      (!_histRO&&!done?'<span class="sub-plus" data-nid="'+l.id+'" title="添加子项">\uff0b</span>':'')+
      '</div>':'');
}

/* ---------- 交互 ---------- */
function nodeByIdGlobal(id){
  var r=null;
  getIslands().forEach(function(isle){isle.trees.forEach(function(root){
    if(r)return;(function w(n){if(n.id===id)r=n;n.children.forEach(w)})(root)})});
  return r;
}
/* 树节点 + 日程池（临时任务）通用查找（§8.2：清单含临时任务） */
function nodeAnyById(id){
  var n=nodeByIdGlobal(id);
  if(n)return n;
  var ts=data.temps||[];
  for(var i=0;i<ts.length;i++)if(ts[i].id===id)return ts[i];
  return null;
}
/* 完成/撤回写入（R28）：完成=盖戳（updateTask/updateTemp 内）；撤回=仅"今天完成的"可撤 */
function writeDone(n,val){
  if(!val){
    var todayStart=new Date();todayStart.setHours(0,0,0,0);
    if(!n.completedAt||n.completedAt<todayStart.getTime()){
      notify.toast('仅限今天完成的任务可点环撤回（R28）');
      return false;
    }
  }
  if(n.lvl==='temp')updateTemp(n.id,{progress:val?1:0});
  else updateTask(n,{progress:val?1:0});
  return true;
}
/* 完成编排（T16/T9c/T9g）：金色粒子 → 移出执行区 → 重渲染（顺序不可倒） */
function completeWithRitual(ritualHost,nodeId){
  viewsMark();                                /* 仪式期间挡住订阅重渲染 */
  if(ritualHost)ripeRitual(ritualHost);
  setTimeout(function(){
    execRemove(nodeId);
    enterToday();
  },460);
}
var sortDrag=null;
function bindToday(){
  var goW=document.getElementById('teGoWeek');       /* 空态行动按钮：跳周规划 */
  if(goW)goW.onclick=function(){
    var b=document.querySelector('#navSeg [data-nav="week"]');
    if(b)b.click();
  };
  var tmpBtn=document.getElementById('tpTemp');
  if(tmpBtn)tmpBtn.onclick=function(){
    var vd=_viewDay||today().d;                 /* 落到当前查看的日（05.4） */
    tmpPrompt('新临时任务（落到'+(vd===today().d?'今天':dayLabel(vd).split(' ')[0]+' '+vd.slice(8))+'）',function(nm,hh){
      if(!nm)return;
      data.temps=data.temps||[];
      /* 置顶：order 取当日清单最小值-1（列表按 order 升序——无 order 的补位项
         会在渲染时拿 maxOrder+1 排尾，故 min-1 必在其上；修复"新增落最底"） */
      var minO=1;
      q.dayItems(treeRoots(),vd,data.temps).forEach(function(l){
        if(l.order!=null&&l.order<minO)minO=l.order});
      addTemp({title:nm,hours:hh,assignD:vd,assignW:weekKeyOf(parse(vd)),order:minO-1});   /* 可撤销（R34） */
      if(!(hh>0))notify.toast('临时任务未填工时——按 0h 计（R26）');
      enterToday();
    });
  };
  var el=document.getElementById('viewToday');
  /* 已完成组展开/收起（默认折叠） */
  /* 已完成组：就地展开/收起（200ms 高度过渡，不整页重渲染） */
  el.querySelectorAll('[data-act="donetoggle"]').forEach(function(t){
    t.onclick=function(){
      _doneOpen=!_doneOpen;
      var a=t.querySelector('.dh-arrow');if(a)a.textContent=_doneOpen?'▾':'▸';
      var w=el.querySelector('.done-wrap');if(w)w.classList.toggle('open',_doneOpen);
    };
  });
  /* 完成/取消：完成走「熟柿仪式」（环充能+果粒迸发）后延迟重渲染；
     取消即时重渲染；历史日一律只读（R28/R33） */
  el.querySelectorAll('[data-act="done"]').forEach(function(ck){
    ck.onclick=function(e){
      e.stopPropagation();
      var card=ck.closest('.td-task');
      var n=nodeAnyById(+card.dataset.nid);
      if(!n)return;
      if(_histRO){notify.toast('历史日视角只读（R33）');return}
      var toDone=n.progress<1;
      if(!writeDone(n,toDone))return;
      if(toDone)completeWithRitual(card,n.id);
      else enterToday();
    };
  });
  /* 执行区：点击任务卡主体（非环非按钮）= 开始执行（05.6 T9a） */
  el.querySelectorAll('.td-task').forEach(function(card){
    card.addEventListener('click',function(e){
      if(_histRO)return;
      if(e.target.closest('[data-act],.sub-plus,.sub-ck,.sub-chip,.sub-dl,.sub-edit'))return;
      var n=nodeAnyById(+card.dataset.nid);
      if(!n||n.progress>=1)return;
      execAdd(n.id);
    });
  });
  /* ＋ 子项按钮（卡内行内，点击添加占位子项） */
  el.querySelectorAll('.sub-plus').forEach(function(sp){
    sp.onclick=function(e){
      e.stopPropagation();
      var n=nodeAnyById(+sp.dataset.nid);
      if(n){
        n.checklist=n.checklist||[];
        n.checklist.push({t:'新子项',done:false});
        touch();
      }
      enterToday();
    };
  });
  /* ── 任务卡删除（临时=直接删 / 树任务=移出排期）── */
  el.querySelectorAll('.td-del').forEach(function(dl){
    dl.onclick=function(e){
      e.stopPropagation();
      var id=+dl.dataset.del;
      var isTemp=dl.dataset.temp==='1';
      if(isTemp){
        if(!confirm('删除此临时任务？'))return;
        removeTemp(id);                     /* 可撤销（R34） */
        execRemove(id);
      }else{
        var n=nodeAnyById(id);
        if(!n)return;
        if(!confirm('将「'+n.title+'」移出今日排期？（任务保留在树中，可在周规划重新排期）'))return;
        updateTask(n,{assignD:null});
        execRemove(id);
      }
      enterToday();
    };
  });
  /* ── 子项删除（hover ×，直接删）── */
  el.querySelectorAll('.sub-dl').forEach(function(sd){
    sd.onclick=function(e){
      e.stopPropagation();
      var p=sd.dataset.sd.split('|');
      var n=nodeAnyById(+p[0]);
      if(n&&n.checklist)n.checklist.splice(+p[1],1);
      touch();enterToday();
    };
  });
  /* ── 子项双击改名（原位输入框）── */
  el.querySelectorAll('.sub-cn[data-edit]').forEach(function(cn){
    cn.ondblclick=function(e){
      e.stopPropagation();
      if(_histRO)return;
      var p=cn.dataset.edit.split('|');
      var n=nodeAnyById(+p[0]);
      if(!n||!n.checklist||!n.checklist[+p[1]])return;
      /* 原位替换为输入框 */
      var old=cn.textContent;
      var inp=document.createElement('input');
      inp.className='sub-edit';
      inp.value=old;
      cn.style.display='none';
      cn.parentElement.insertBefore(inp,cn);
      inp.focus();inp.select();
      function fin(v){
        inp.remove();cn.style.display='';
        if(v&&v!==old){
          n.checklist[+p[1]].t=v;
          touch();
        }
        enterToday();
      }
      inp.onkeydown=function(ev){ev.stopPropagation();
        if(ev.key==='Enter')fin(inp.value.trim()||old);
        if(ev.key==='Escape')fin(null);
      };
      inp.onblur=function(){fin(inp.value.trim()||old)};
      inp.onclick=function(ev){ev.stopPropagation()};
    };
  });
  /* 勾选子项 → 全勾后自动完成（R28；粒子先于移出）；完成=正式 ✓ 钮（05.2） */
  el.querySelectorAll('.sub-ck').forEach(function(mr){
    mr.onclick=function(e){
      e.stopPropagation();
      if(_histRO)return;
      var p=mr.dataset.sub.split('|');
      var nid=+p[0],si=+p[1];
      var n=nodeAnyById(nid);
      if(!n||!n.checklist||!n.checklist[si])return;
      n.checklist[si].done=!n.checklist[si].done;
      var all=n.checklist.every(function(s){return s.done});
      if(all&&n.progress<1){
        if(writeDone(n,true))completeWithRitual(mr.closest('.td-task'),n.id);
      }else touch();
      enterToday();
    };
  });
  /* 拖动排序（order 持久化——含临时任务） */
  el.querySelectorAll('.td-task').forEach(function(card){
    card.addEventListener('pointerdown',function(e){
      if(e.button!==0)return;
      if(_histRO)return;
      if(e.target.closest('[data-act],.sub-plus,.sub-ck,.sub-chip,.sub-dl,.sub-edit,.td-del'))return;
      sortDrag={card:card,moved:false,px0:e.clientX,py0:e.clientY};
      window.addEventListener('pointermove',sortMove);
      window.addEventListener('pointerup',sortUp);
    });
  });
}
function sortMove(e){
  if(!sortDrag)return;
  if(!sortDrag.moved&&Math.abs(e.clientX-sortDrag.px0)+Math.abs(e.clientY-sortDrag.py0)>5){
    sortDrag.moved=true;
    /* 基准快照（未位移时的卡序与中点）——此后落点按基准计算，避免位移反馈抖动 */
    sortDrag.cards=[...document.querySelectorAll('#viewToday .tp-body .td-task')];
    sortDrag.mids=sortDrag.cards.map(function(c){
      var r=c.getBoundingClientRect();return r.top+r.height/2});
    sortDrag.h=sortDrag.card.getBoundingClientRect().height+6;
    sortDrag.cards.forEach(function(c){
      if(c!==sortDrag.card)c.style.transition='transform .08s ease'});
  }
  if(!sortDrag.moved)return;
  sortDrag.card.style.opacity=.4;
  /* 落点（与 sortUp 同口径：首个基准中点在指针之下的卡） */
  var ti=sortDrag.cards.length;
  for(var i=0;i<sortDrag.cards.length;i++){
    if(sortDrag.cards[i]===sortDrag.card)continue;
    if(e.clientY<sortDrag.mids[i]){ti=i;break}
  }
  var di=sortDrag.cards.indexOf(sortDrag.card);
  sortDrag.cards.forEach(function(c,i){
    if(c===sortDrag.card)return;
    var y=0;
    if(di<ti&&i>di&&i<ti)y=-sortDrag.h;
    else if(di>ti&&i>=ti&&i<di)y=sortDrag.h;
    c.style.transform=y?'translateY('+y+'px)':'';
  });
  /* 插入位间隙线 */
  var body=document.querySelector('#viewToday .tp-body');
  if(body){
    var line=document.getElementById('dropLine');
    if(!line){line=document.createElement('div');line.id='dropLine';body.appendChild(line)}
    var ref=(ti<sortDrag.cards.length)?sortDrag.cards[ti]:sortDrag.cards[sortDrag.cards.length-1];
    var rr=ref.getBoundingClientRect(),br=body.getBoundingClientRect();
    var topPx=(ti<sortDrag.cards.length?rr.top-3:rr.bottom+3)-br.top+body.scrollTop;
    line.style.top=topPx+'px';
  }
}

/* ---------- 熟柿仪式（T16：≈460ms 编排） ----------
   环充能至 100%（--p 过渡）→ 任务名划线扫过 → 熟柿金脉冲 →
   数粒柿色果粒自环心迸发；随后整体重渲染沉入已完成组 */
function ripeRitual(card){
  card.classList.add('completing');
  var ring=card.querySelector('.ring');
  if(ring)ring.style.setProperty('--p','100%');
  /* 果粒迸发（柿色系：熟柿/黄柿/半熟） */
  var COLORS=['#D97618','#E8A44C','#D9C46A','#C25A2B'];
  var host=ring||card;
  var hr=host.getBoundingClientRect(),cr=card.getBoundingClientRect();
  var cx=hr.left-cr.left+hr.width/2,cy=hr.top-cr.top+hr.height/2;
  if(!card.style.position||card.style.position==='static')card.style.position='relative';
  for(var i=0;i<7;i++){
    var p=document.createElement('span');
    var ang=Math.PI*2*(i/7)+Math.random()*.6;
    var dist=26+Math.random()*20;
    p.style.cssText='position:absolute;left:'+cx+'px;top:'+cy+'px;width:5px;height:5px;'+
      'border-radius:50%;background:'+COLORS[i%COLORS.length]+';'+
      'pointer-events:none;z-index:5;box-shadow:0 0 6px rgba(217,118,24,.5)';
    card.appendChild(p);
    try{
      p.animate([
        {transform:'translate(-50%,-50%) scale(1)',opacity:1},
        {transform:'translate(calc(-50% + '+Math.cos(ang)*dist+'px),calc(-50% + '+Math.sin(ang)*dist+'px)) scale(.25)',opacity:0}
      ],{duration:380+Math.random()*140,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
    }catch(e){}
    setTimeout(function(){p.remove()},560);
  }
  setTimeout(function(){card.classList.remove('completing')},620);
}
function sortUp(e){
  if(!sortDrag)return;
  var d=sortDrag;sortDrag=null;
  window.removeEventListener('pointermove',sortMove);
  window.removeEventListener('pointerup',sortUp);
  d.card.style.opacity='';
  /* 清让位与间隙线 */
  if(d.cards)d.cards.forEach(function(c){
    if(c!==d.card){c.style.transform='';c.style.transition=''}});
  var ln=document.getElementById('dropLine');if(ln)ln.remove();
  if(!d.moved)return;
  /* 找落点：插到哪个 .td-task 之前（优先用基准中点，与让位反馈一致） */
  var cards=d.cards||[...document.querySelectorAll('.td-task')];
  var target=null;
  if(d.mids){
    for(var i=0;i<cards.length;i++){
      if(cards[i]===d.card)continue;
      if(e.clientY<d.mids[i]){target=cards[i];break}
    }
  }else{
    for(var k=0;k<cards.length;k++){
      var r=cards[k].getBoundingClientRect();
      if(e.clientY<r.top+r.height/2){target=cards[k];break}
    }
  }
  if(target&&target!==d.card){
    target.parentElement.insertBefore(d.card,target);
  }else if(!target){
    d.card.parentElement.appendChild(d.card);
  }
  /* 更新 order（树任务 + 临时任务） */
  var ids=[...document.querySelectorAll('.td-task')].map(function(c){return +c.dataset.nid});
  ids.forEach(function(nid,idx){
    var n=nodeAnyById(nid);
    if(n)n.order=idx;
  });
  touch();
}

/* ＋临时：命名+工时小浮层（R26：工时可空/0，快速记录优先） */
function tmpPrompt(title,done){
  var ov=document.createElement('div');ov.className='pt-np-ov';
  ov.innerHTML='<div class="pt-np"><div class="t">'+title+'</div>'+
    '<input class="a" type="text" placeholder="名称…"><input class="b" type="text" placeholder="工时 h（可空）">'+
    '<div class="btns"><button class="no">取消</button><button class="ok">确定</button></div></div>';
  document.body.appendChild(ov);
  var a=ov.querySelector('.a'),b=ov.querySelector('.b');a.focus();
  function fin(v){ov.remove();if(v)done(v[0],v[1])}
  function tryOk(){var nm=a.value.trim(),hv=parseFloat(b.value)||0;fin(nm?[nm,hv]:null)}
  ov.querySelector('.no').onclick=function(){fin(null)};
  ov.querySelector('.ok').onclick=tryOk;
  ov.addEventListener('pointerdown',function(e){if(e.target===ov)fin(null)});
  ov.addEventListener('keydown',function(e){
    if(e.key==='Enter')tryOk();
    if(e.key==='Escape')fin(null);
    e.stopPropagation()});
}
/* 补点选择器 Esc 关闭（capture 阶段先于 interact 的相机复位） */
document.addEventListener('keydown',function(e){
  if(e.key!=='Escape')return;
  var ov=document.getElementById('mkpOverlay');
  if(ov&&ov.classList.contains('open')){
    ov.classList.remove('open');
    e.stopPropagation();
  }
},true);
