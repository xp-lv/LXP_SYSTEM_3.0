/* ================= 月卡区组件（自 planner 拆出） =================
   渲染本月+往后6个月的月卡；只显顶层目标任务。
   共享态（selected/MONTHS/工具函数）经 planner.js 导入（运行期循环引用安全）。 */
import {data} from './state.js';
import {unassignFromMonthDeep} from './mutations.js';
import {escHtml} from './utils.js';
import * as q from './queries.js';
import {monthWeeks,weekLabel,today} from './calendar.js';
import {renderPlan,inline,mLabel,nodeById,colorOf,getSelected,setSelected,toastPlan,MONTHS,monthTopEntries,monthLoad,monthHasAssign,monthLeafSum,num} from './planner.js';

/* ---------- ② 月度分配 ---------- */
export function renderMonths(){
  var sel0=getSelected();
  var list=MONTHS.slice();
  /* 回退落月跟随（§7.0）：选中的月不在滚动窗口内（如从上月周框回宏观）→ 头部动态补卡 */
  if(sel0&&sel0.mk&&!list.some(function(m){return m.key===sel0.mk}))
    list.unshift({key:sel0.mk,name:(+sel0.mk.slice(5))+'月'});
  var h='';
  var curMk=today().m;
  var maxLoad=0;
  list.forEach(function(mo){maxLoad=Math.max(maxLoad,monthLoad(mo.key))});
  list.forEach(function(mo,i){
    var isSel=!!(sel0&&sel0.mk===mo.key);
    var isNow=mo.key===curMk;
    var ls=monthTopEntries(mo.key);
    var load=monthLoad(mo.key);
    var pct=maxLoad?Math.max(4,Math.min(100,load/maxLoad*100)):0;
    h+='<div class="month-card'+(isSel?' sel':'')+(isNow?' now':'')+(ls.length?'':' empty')+'" data-mk="'+mo.key+'"'+
      ' data-rise style="--i:'+i+';--rise-base:110ms">'+
      '<div class="mc-head"><div class="mc-title"><span class="mc-name">'+mo.name+'</span>'+
        (isNow?'<span class="mc-badge">本月</span>':'')+'</div>'+
      '<div class="mc-sub"><span>'+ls.length+' 项</span><span>'+(load?load+'h':'空')+'</span></div></div>'+
      '<div class="mc-load"><i style="width:'+pct+'%"></i></div>'+
      '<div class="mc-tasks">';
    ls.slice(0,3).forEach(function(l){
      h+='<div class="mc-leaf" data-nid="'+l.id+'" title="'+escHtml(l.title)+
        (!l.children.length?'':'（月度分解汇总）')+' · 点击查看月度详情">'+
        '<span class="mt-dot" style="background:'+colorOf(l)+'"></span>'+
        '<span class="mt-name">'+escHtml(l.title)+'</span>'+
        '<span class="mt-x" title="移出该月">×</span></div>';
    });
    if(ls.length>3)h+='<div class="mc-more">+ '+(ls.length-3)+' 项</div>';
    if(!ls.length)h+='<div class="mc-empty">拖入任务</div>';
    h+='</div></div>';
  });
  var track=document.getElementById('plMonthTrack');
  var keep=track.scrollLeft;
  track.innerHTML=h;
  function centerMonth(i){
    var el=track.children[i];
    if(!el)return 0;
    var er=el.getBoundingClientRect(),tr=track.getBoundingClientRect();
    return Math.max(0,track.scrollLeft+(er.left-tr.left)-(track.clientWidth-er.width)/2);
  }
  if(track.scrollWidth>track.clientWidth&&keep>0)track.scrollLeft=keep;
  if(sel0&&sel0.mk){
    var si=list.findIndex(function(m){return m.key===sel0.mk});
    if(si>=0)track.scrollLeft=centerMonth(si);
    track.dataset.scrolled='1';
  }
  if(!track.dataset.scrolled){
    var fb=-1;
    for(var k=0;k<list.length;k++)
      if(monthHasAssign(list[k].key)||monthLoad(list[k].key)>0){fb=k;break}
    if(fb<0)fb=list.findIndex(function(m){return m.key===today().m});
    if(fb>0){
      var go=function(){if(track.scrollWidth>track.clientWidth)track.scrollLeft=centerMonth(fb)};
      requestAnimationFrame(function(){requestAnimationFrame(go)});
      setTimeout(go,150);
    }
    track.dataset.scrolled='1';
  }
  track.querySelectorAll('.month-card').forEach(function(mc){
    mc.addEventListener('dragover',function(e){e.preventDefault()});
    mc.addEventListener('click',function(e){
      var mk=mc.dataset.mk;
              var row=e.target.closest('.mc-leaf');
      if(row){
        e.stopPropagation();
        var nd=nodeById(+row.dataset.nid);
        if(e.target.closest('.mt-x')){
          /* 移出该月：收口原语（可撤销、可持久化、3D 同步） */
          unassignFromMonthDeep(nd,mk);
          toastPlan('已移出'+mLabel(mk)+' · 任务保留，重新拖入可再规划');
          renderPlan();
          return;
        }
        setSelected({node:nd,mk:mk});
        renderPlan();
        return;
      }
      setSelected({mk:mk});
      renderPlan();
    });
  });
}
