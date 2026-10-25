/* ================= 周度框飞移 v4（共享元素变形，§7.0） =================
   月→周：月详情的周度球按原样克隆起飞（同尺寸/椭圆/底色/内容），
   飞行中几何形态（尺寸/圆角/底色/边色）连续演变为周度条胶囊，
   相邻框波浪式错峰起飞，落位带轻微回弹后撤克隆显真身；
   邻月框随之淡入上浮。周→月：反向同构。页面本体由 views.js 淡入承接。

   设计取舍（v4）：飞行容器内**只承载源框内容**，不做源/目标内容交叉淡换——
   源球标签与目标胶囊文字本就是同一串字，交叉淡换只引入文字在框内
   重排/字号作用域/居中基准的漂移风险，无任何收益。 */

var D=460;                                   /* 单框飞行时长 ms */
var STAG=26;                                 /* 相邻框错峰间隔 ms */
var MOVE='cubic-bezier(.3,1.18,.36,1)';      /* 带轻微回弹的落位曲线 */

/* 下一绘制帧（双 rAF 对齐帧边界；rAF 冻结环境用定时兜底，先到先得） */
function nextPaint(fn){
  var done=false;
  var go=function(){if(done)return;done=true;fn()};
  try{
    requestAnimationFrame(function(){requestAnimationFrame(go)});
  }catch(e){}
  setTimeout(go,80);
}

/**
 * @param {Array<{fromEl:Element,fromRect:{left:number,top:number,width:number,height:number},toEl:Element}>} pairs
 *   fromRect 必须在旧视图隐藏前捕获（视图 display:none 后 rect 归零）；
 *   toEl 需已可见（新视图渲染完成后取落位）
 * @param {Element[]} [fades] 落位处淡入浮现的邻月框（周度条的上月/下月部分）
 */
export function flyWeekBubbles(pairs,fades){
  if(!pairs||!pairs.length)return;
  var layer=document.createElement('div');
  layer.style.cssText='position:fixed;inset:0;z-index:120;pointer-events:none';
  document.body.appendChild(layer);
  var flights=[];
  pairs.forEach(function(p,i){
    if(!p||!p.fromEl||!p.toEl)return;
    var r=p.fromRect||p.fromEl.getBoundingClientRect();
    /* 入场编排保护：落位框若还在错峰浮现动画中（translateY 偏移），
       先强制完成到终态再取矩形——克隆落位与真身终位一致，杜绝 10px 级错位 */
    try{(p.toEl.getAnimations&&p.toEl.getAnimations()||[]).forEach(function(a){
      try{a.finish()}catch(e){}})}catch(e){}
    var t=p.toEl.getBoundingClientRect();
    var cs=getComputedStyle(p.fromEl);
    var ct=getComputedStyle(p.toEl);
    var delay=i*STAG;
    /* 几何容器：承载位置/尺寸/圆角/底色/边色的连续变形 */
    var c=document.createElement('div');
    c.style.cssText='position:absolute;box-sizing:border-box;'+
      'left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;'+
      'margin:0;background:'+cs.backgroundColor+';'+
      'border:1px solid '+cs.borderTopColor+';border-radius:'+cs.borderRadius+';'+
      'box-shadow:0 14px 34px rgba(0,0,0,.45);overflow:hidden;pointer-events:none;'+
      'transition:left '+D+'ms '+MOVE+',top '+D+'ms '+MOVE+
      ',width '+D+'ms '+MOVE+',height '+D+'ms '+MOVE+
      ',border-radius '+D+'ms ease,background-color '+D+'ms ease,'+
      'border-color '+D+'ms ease;'+
      'transition-delay:'+delay+'ms';
    /* 内容层 = 源框整体克隆（保留自身 class，作用域字号/颜色/布局全部生效）；
       剥掉外观（边/底/影/尺寸）只留内容，铺满容器，全程不换行不重排 */
    var a=p.fromEl.cloneNode(true);
    a.classList.remove('drop-in','sel','cur','cur-week');
    a.style.cssText+=';position:absolute;left:0;top:0;width:100%;height:100%;min-width:0;'+
      'margin:0;border:none;background:none;box-shadow:none;backdrop-filter:none;'+
      'cursor:default;pointer-events:none;white-space:nowrap';
    c.appendChild(a);
    layer.appendChild(c);
    void c.offsetWidth;                      /* 强制提交初始样式：过渡从首帧开始 */
    p.toEl.style.visibility='hidden';
    /* 落地：transitionend 优先触发，定时器兜底（后台标签定时器被节流也能正确落地） */
    var flight={clone:c,toEl:p.toEl,landed:false};
    function takeoff(){                      /* 起飞：几何演变到目标形态 */
      c.style.left=t.left+'px';c.style.top=t.top+'px';
      c.style.width=t.width+'px';c.style.height=t.height+'px';
      c.style.borderRadius=ct.borderRadius;
      c.style.background=ct.backgroundColor;
      c.style.borderColor=ct.borderTopColor;
    }
    function land(){                         /* 落地：真身浮现 + 克隆淡出（十字淡换，
                                               遮蔽克隆/真身间的亚像素接缝） */
      if(flight.landed)return;flight.landed=true;
      var el=flight.toEl;
      el.style.visibility='';
      try{
        el.animate([{opacity:0},{opacity:1}],{duration:160,easing:'ease-out'});
        flight.clone.animate([{opacity:1},{opacity:0}],{duration:160,easing:'ease-in'})
          .onfinish=function(){flight.clone.remove()};
        setTimeout(function(){flight.clone.remove()},420);
      }catch(e){flight.clone.remove()}
    }
    c.addEventListener('transitionend',function(ev){
      if(ev.propertyName==='left'||ev.propertyName==='width')land();
    });
    flight.takeoff=takeoff;flight.land=land;
    flights.push(flight);
  });
  /* 对齐下一绘制帧起飞；落地各自排程（起飞之后算，杜绝半空撤框） */
  nextPaint(function(){
    flights.forEach(function(f){
      f.takeoff();
      setTimeout(f.land,D+120);
    });
    /* 兜底清扫：无论如何最迟此刻恢复原状 */
    setTimeout(function(){
      flights.forEach(function(f){f.land()});
      layer.remove();
    },STAG*flights.length+D+400);
  });
  /* 邻月框：随分散浮现（淡入 + 轻微上浮），错峰展开 */
  (fades||[]).forEach(function(el,i){
    if(!el)return;
    el.style.opacity='0';
    el.style.transform='translateY(10px)';
    el.style.transition='opacity 240ms ease '+(140+i*18)+'ms,'+
      'transform 300ms '+MOVE+' '+(140+i*18)+'ms';
    setTimeout(function(){el.style.opacity='1';el.style.transform=''},40);
    setTimeout(function(){el.style.transition=''},720);
  });
}

