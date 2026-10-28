/* ============================================================
   decomposer.js — 可复用「任务分解」模块 v2.1（零依赖）
   ------------------------------------------------------------
   形态：无限横向树画布（根在对称轴，每深一级向右一列，
         画布随内容自动扩展、滚动、保持滚动位置）。

   createDecomposer(container, {
     data,                    // 根节点 {title, hours, children[]}
     height: '480px',         // 视口高度（内容超出出滚动条）
     onChange(root, action),  // 变更回调 {type:'divide'|'rename'|'remove'|'hours', node, path}
     hoursEditable: true,
     hint: '...底部提示文案',
     —— 数据操作适配层（默认=模块内部直接改纯树；宿主可注入自己的收口）——
     ops: { divide(parent,fields)->node, remove(node), rename(node,t), setHours(node,h) },
     —— 渲染扩展钩子 ——
     filter(node)->bool,             // 返回 false 的节点（含子树）不渲染
     canPlus(node)->bool,            // 该节点是否显示「＋」（默认全部）
     meta(node)->html,               // 自定义节点第二行（含 data-role="h" 可点改工时）
     isSelected(node)->bool,         // 选中态描边
     onClick(node),                  // 单击（非拖拽）节点
     colorOf(node)->'css色值',        // 分支色：一级浅底、连线与箭头同色，写入 --dc-c
     reorder: {                      // 同级排序（只允许同一父级兄弟之间）
       canReorder(node)->bool,
       siblingsOf(node)->array,      // 可选：临时任务等没有 parent 的兄弟列表
       onReorder(node,before,after)->bool  // after=true 表示插到 before 之后；before=null 表示末尾
     },
     lanes: false,                   // 泳道模式：根节点不渲染，每个二级节点=一条横向泳道
     laneColor(node)->'css色值',      // 泳道左缘色（如按目标着色），写入 --cc
     —— 拖拽钩子（把节点拖到宿主指定的落点元素上）——
     drag: { canDrag(node), dropSelector, ghostText(node,dropEl), onDrop(node,dropEl) },
   })
   返回 {render, getData, destroy, divide, rename, setHours, remove}
   ============================================================ */

export function createDecomposer(container, opts){
  const o=Object.assign({hoursEditable:true,height:'480px',lanes:false,padBottom:0,
    hint:'悬停节点点＋加子级 · 双击改名 · 悬停×删除 · 叶子工时点改 · 画布随内容自动扩展'},opts||{});
  const root=o.data;
  if(!root)throw new Error('decomposer: 缺少 data（根节点）');
  const COMPACT=!!o.compact;
  if(COMPACT)container.classList.add('dc-compact');
  const PAD_X=COMPACT?54:70,PAD_Y=COMPACT?44:56,COL_STEP=COMPACT?210:252,ROW_STEP=COMPACT?58:62,FREE_PAD=COMPACT?200:260;
  let addCtx=null;
  let rowMap=[];
  /* 视口自适应缩放：只随屏幕尺寸变化，不随任务数量变化。
     大屏放大卡片/文字，小屏保持 1:1 可读尺寸，内容溢出交给画布平移。 */
  function baseZoom(){
    const vw=(typeof window!=='undefined'&&window.innerWidth)||1600;
    const vh=(typeof window!=='undefined'&&window.innerHeight)||1000;
    return Math.max(1,Math.min(1.6,Math.min(vw/1600,vh/800)));
  }
  let zoom=baseZoom();
  let viewportTO=null;
  let lastLayout=null;
  let destroyed=false;
  let scrollEl=null;

  /* ---------- 数据操作：默认实现（纯树直改），可被 ops 覆盖 ---------- */
  const OPS=Object.assign({
    divide(parent,fields){
      const f=fields||{};
      const c={title:f.title||('新任务'+(((parent.children)||[]).length+1)),
        hours:+f.hours||0,children:[],parent:parent};
      parent.children=parent.children||[];
      parent.children.push(c);
      return c;
    },
    remove(node){
      if(!node||!node.parent)return false;
      const list=node.parent.children;
      list.splice(list.indexOf(node),1);
      return true;
    },
    rename(node,title){if(node&&title)node.title=title},
    setHours(node,h){if(node)node.hours=Math.max(0,h)},
  },o.ops||{});

  function isLeaf(n){return !n.children||!n.children.length}
  function nodeH(n){return isLeaf(n)?(+n.hours||0):n.children.reduce((s,c)=>s+nodeH(c),0)}
  function leafCount(n){return isLeaf(n)?1:n.children.reduce((s,c)=>s+leafCount(c),0)}
  function pathOf(n){const p=[];for(let x=n;x&&x!==root&&x.parent;x=x.parent)p.unshift(x.title);return p}

  /* ---------- 样式 ---------- */
  let styleEl=null;
  function injectCSS(){
    if(styleEl)return;
    styleEl=document.createElement('style');
    styleEl.textContent=`
/* 色彩全部走宿主页面的 --lx-* token（带独立运行回退值），与《UI设计规范》同源 */
.dc-scroll{overflow:hidden;height:${o.height};position:relative;
  border-radius:0;                                      /* 画板即画布：不再套圆角卡片框 */
  background-color:var(--bd-canvas,#0F1218);            /* 画板底：平色 + 细点阵 */
  background-image:radial-gradient(circle,rgba(255,255,255,.05) 1px,transparent 1.2px);
  background-size:24px 24px;cursor:grab;touch-action:none}
.dc-scroll.panning{cursor:grabbing}
.dc-canvas{position:relative}
.dc-svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.dc-svg path{fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;
  transition:stroke .15s,stroke-opacity .15s,stroke-width .15s}
.dc-svg path.hl{stroke:var(--bd-accent,#8B96F8)!important;stroke-opacity:.95!important;stroke-width:2!important}
.dc-node{position:absolute;transform:translateY(-50%);
  background:var(--bd-surface,#151922);
  border:1px solid var(--bd-line,rgba(255,255,255,.10));
  border-radius:var(--bd-r-node,10px);padding:8px 13px 7px 11px;user-select:none;z-index:2;
  box-shadow:none;
  transition:border-color .15s,background .15s,box-shadow .15s,transform .15s;max-width:206px}
.dc-node:hover{border-color:var(--bd-line-strong,rgba(255,255,255,.18));
  transform:translateY(calc(-50% - 1px));   /* 悬浮抬升（保留居中基准） */
  box-shadow:0 2px 10px rgba(0,0,0,.22)}
.dc-node.sel{border-color:var(--bd-accent,#8B96F8);
  box-shadow:0 0 0 3px rgba(139,150,248,.16)}
.dc-node.dragging{opacity:.58;box-shadow:0 8px 24px rgba(0,0,0,.45);z-index:6}
/* 一级 = 分支色浅底；二级 = 中性底，靠连线/圆点保留归属 */
.dc-node[data-depth="1"]{background:var(--bd-surface,#151922);
  background:color-mix(in srgb,var(--dc-c,var(--bd-accent)) 8%,var(--bd-surface,#151922));
  border-color:color-mix(in srgb,var(--dc-c,var(--bd-accent)) 34%,var(--bd-line,rgba(255,255,255,.10)))}
.dc-node[data-depth="2"]{background:var(--bd-surface,#151922);border-color:var(--bd-line,rgba(255,255,255,.10))}
.dc-node.sel,.dc-node.sel[data-depth]{border-color:var(--bd-accent,#8B96F8)}
.dc-node .n-name{font-size:12.5px;font-weight:600;color:var(--bd-text,#E9ECF4);line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:166px;cursor:text}
.dc-node .n-meta{font-size:9.5px;font-weight:500;color:var(--bd-text-3,#6E7689);margin-top:3px;
  line-height:1.35;white-space:nowrap}
.dc-node .n-meta .sum{font-weight:500}
.dc-node .n-meta .hz{color:var(--bd-accent,#8B96F8);cursor:pointer;padding:1px 3px;border-radius:4px}
.dc-node .n-meta .hz:hover{background:rgba(139,150,248,.10)}
.dc-node.root{background:color-mix(in srgb,var(--bd-accent,#8B96F8) 13%,var(--bd-surface,#151922));
  border:1.5px solid var(--bd-accent,#8B96F8);padding:11px 16px 10px 14px;
  box-shadow:0 0 0 3px rgba(139,150,248,.08)}
.dc-node.root:hover{box-shadow:0 0 0 3px rgba(139,150,248,.12)}
.dc-node.root .n-name{font-size:13.5px;color:var(--bd-text,#E9ECF4);max-width:176px}
/* 虚拟根（“10月”“本周”）= 流程图起点：胶囊形，和普通目标卡区分 */
.dc-node.dc-virtual{border-radius:999px;padding:8px 18px 7px 16px}
.dc-node.dc-virtual .n-name{max-width:190px}
.dc-node .n-plus{position:absolute;right:-11px;top:50%;transform:translateY(-50%);
  width:20px;height:20px;border-radius:50%;background:var(--bd-surface-2,#1A1F2A);
  border:1px solid color-mix(in srgb,var(--bd-accent,#8B96F8) 45%,var(--bd-line,rgba(255,255,255,.10)));
  color:var(--bd-accent,#8B96F8);font-size:13px;
  line-height:18px;text-align:center;cursor:pointer;z-index:3;user-select:none;
  opacity:0;transition:background .12s,color .12s,opacity .15s,border-color .12s}
.dc-node:hover .n-plus,.dc-node.sel .n-plus{opacity:1}
.dc-node .n-plus:hover{background:var(--bd-accent,#8B96F8);color:#fff;border-color:var(--bd-accent,#8B96F8)}
.dc-node .n-x{display:none;position:absolute;right:4px;top:2px;font-size:12px;
  color:var(--bd-text-3,#6E7689);cursor:pointer;line-height:1;padding:2px 4px;border-radius:4px;z-index:3}
.dc-node:hover .n-x{display:block}
.dc-node .n-x:hover{color:var(--lx-danger,#E5696F);background:rgba(229,105,111,.10)}
.dc-node .n-dot{position:absolute;right:5px;top:5px;width:6px;height:6px;border-radius:50%;
  background:#FF5A4E;pointer-events:none}   /* 宿主 badge：未落日红点 */
/* 宿主警示徽标：逾期未重新排期（红色感叹号，压在卡片右上角外沿） */
.dc-node .n-alert{position:absolute;right:-8px;top:-8px;width:17px;height:17px;border-radius:50%;
  background:#F5222D;color:#fff;font:800 11px/17px -apple-system,'Segoe UI',sans-serif;
  text-align:center;z-index:4;pointer-events:none;
  box-shadow:0 0 0 2px var(--bd-surface,#151922),0 2px 8px rgba(245,34,45,.5)}
/* 已完成：左上角大拇指徽标（周/月/宏观画布通用） */
.dc-node .n-done{position:absolute;left:-9px;top:-9px;width:20px;height:20px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1;
  background:var(--bd-surface,#151922);border:1px solid rgba(76,195,138,.6);
  box-shadow:0 0 0 2px var(--bd-surface,#151922),0 2px 8px rgba(76,195,138,.35);
  z-index:4;pointer-events:none}
/* 已放弃：虚线 + 降透明度 + 名称划线；悬停仍可恢复 */
.dc-node.abandoned{opacity:.55;border-style:dashed}
.dc-node.abandoned:hover{opacity:.82}
.dc-node.abandoned .n-name{text-decoration:line-through;color:var(--bd-text-3,#6E7689)}
/* 断梢：未落日叶子的残桩形态（虚线右缘 + 红色断口） */
.dc-node.broken-tip{border-right:2px dashed rgba(255,90,74,.55)}
.dc-node.broken-tip::after{content:'';position:absolute;right:-9px;top:50%;transform:translateY(-50%);
  width:9px;height:2px;border-radius:1px;
  background:repeating-linear-gradient(90deg,#FF5A4E 0 2px,transparent 2px 4px);
  box-shadow:0 0 6px rgba(255,90,74,.3);pointer-events:none}
.dc-node .n-abandon{display:none;position:absolute;right:23px;top:1px;font-size:12px;
  color:var(--bd-text-3,#6E7689);cursor:pointer;line-height:1;padding:2px 4px;border-radius:4px;z-index:3}
.dc-node:hover .n-abandon,.dc-node.sel .n-abandon{display:block}
.dc-node .n-abandon:hover{color:#D9A13E;background:rgba(217,161,62,.12)}
.dc-newrow{position:absolute;transform:translateY(-50%);z-index:2}
.dc-newrow input{background:var(--bd-surface-3,#11151C);border:1px solid var(--bd-line,rgba(255,255,255,.10));
  border-radius:var(--bd-r-node,10px);color:var(--bd-text,#E9ECF4);padding:7px 11px;font-size:12px;
  font-family:inherit;outline:none;width:164px}
.dc-newrow input:focus{border-color:var(--bd-accent,#8B96F8)}
.dc-newrow .nr-hint{position:absolute;left:0;top:100%;font-size:9.5px;
  color:var(--bd-text-3,#6E7689);margin-top:4px;white-space:nowrap}
.dc-hint{position:absolute;bottom:8px;left:0;right:0;text-align:center;
  font-size:10px;color:var(--bd-text-3,#6E7689);pointer-events:none;z-index:1}
.dc-input{background:var(--bd-surface-3,#11151C);border:1px solid var(--bd-line,rgba(255,255,255,.10));
  border-radius:6px;
  color:var(--bd-text,#E9ECF4);padding:2px 6px;font-size:12px;font-family:inherit;outline:none}
.dc-input:focus{border-color:var(--bd-accent,#8B96F8)}
.dc-ghost{position:fixed;z-index:999;pointer-events:none;display:none;
  background:var(--bd-surface-2,#1A1F2A);border:1px solid var(--bd-accent,#8B96F8);
  border-radius:8px;padding:6px 11px;
  font-size:11px;color:var(--bd-text,#E9ECF4);box-shadow:var(--bd-shadow-float,0 12px 32px rgba(0,0,0,.45));white-space:nowrap}
.dc-ghost.bad{border-color:var(--lx-danger,#E5696F);color:var(--lx-danger,#E5696F)}
.dc-drop-in{outline:2px dashed var(--bd-accent,#8B96F8);outline-offset:2px}
/* 同级排序插入线：两端小圆点，像飞书画板的连接锚点 */
.dc-insert{position:absolute;height:2px;border-radius:2px;background:var(--bd-accent,#8B96F8);
  z-index:5;pointer-events:none;box-shadow:0 0 0 2px rgba(15,18,24,.45)}
.dc-insert::before,.dc-insert::after{content:'';position:absolute;top:50%;width:7px;height:7px;
  border-radius:50%;background:var(--bd-accent,#8B96F8);transform:translateY(-50%)}
.dc-insert::before{left:-3px}.dc-insert::after{right:-3px}
/* ---- 泳道模式：二级节点=泳道（浅色分组容器 + 左缘色带 + 无框头部） ---- */
.dc-lane-bg{position:absolute;left:16px;border-radius:var(--bd-r-zone,12px);z-index:0;
  background:color-mix(in srgb,var(--cc,#8B96F8) 6%,transparent);
  border:1px solid color-mix(in srgb,var(--cc,#8B96F8) 18%,transparent);
  border-left:2px solid var(--cc,#8B96F8)}
.dc-node.dc-lane{background:none;border:none;box-shadow:none;padding:0;max-width:290px;
  display:flex;align-items:baseline;gap:8px}
.dc-node.dc-lane:hover{border-color:transparent;box-shadow:none}
.dc-node.dc-lane .n-name{font-size:13px;font-weight:600;max-width:196px}
.dc-node.dc-lane .n-name::before{content:'';display:inline-block;width:7px;height:7px;
  border-radius:50%;background:var(--cc,#8B96F8);margin-right:8px}
.dc-node.dc-lane .n-meta{margin:0;white-space:nowrap;color:var(--bd-text-3,#6E7689)}
.dc-node.dc-lane .n-x{top:-4px;right:-6px}
.dc-node.dc-lane.sel .n-name{color:var(--bd-text,#E9ECF4)}
/* 紧凑三层树（宏观画布/月度详情）：只允许根 + 2 层 */
.dc-compact .dc-node{max-width:190px;padding:7px 11px 6px 10px}
.dc-compact .dc-node .n-name{max-width:158px;font-size:12px}
.dc-compact .dc-node.root .n-name{max-width:150px;font-size:13px}
.dc-compact .dc-node .n-meta{font-size:9.5px}
.dc-compact .dc-node .n-plus{width:19px;height:19px;line-height:17px;font-size:12px}
.dc-compact .dc-node.dc-virtual{padding:7px 16px 6px 14px}
`;
    document.head.appendChild(styleEl);
  }

  /* ---------- 收口包装：op → onChange → 由调用方决定重渲染 ---------- */
  function opDivide(parent,fields){
    const c=OPS.divide(parent,fields);
    if(c&&!c.parent)c.parent=parent;          /* 宿主实现可能不带 parent 回填 */
    emit('divide',c);
    render();
    return c;
  }
  function opRemove(node){
    const ok=OPS.remove(node);
    if(ok){if(addCtx===node||isAncestor(node,addCtx))addCtx=null;
      emit('remove',node);render()}
    return ok;
  }
  function opRename(node,title){OPS.rename(node,title);emit('rename',node);render()}
  function opSetHours(node,h){OPS.setHours(node,h);emit('hours',node);render()}
  function emit(type,node){
    if(o.onChange&&!destroyed)o.onChange(root,{type:type,node:node,path:pathOf(node)});
  }

  function isAncestor(a,n){for(let x=n;x;x=x.parent)if(x===a)return true;return false}

  /* ---------- 布局 ---------- */
  function showChild(c){return !o.filter||o.filter(c)}
  function layout(){
    let slot=0,md=0;
    (function walk(n,d){
      if(d>md)md=d;
      const kids=(n.children||[]).filter(showChild);
      if(!kids.length){n._y=slot++;return}
      kids.forEach(c=>walk(c,d+1));
      n._y=(kids[0]._y+kids[kids.length-1]._y)/2;
      if(o.lanes&&d===1)slot+=.7;   /* 泳道（二级节点）之间留垂直间隙 */
    })(root,0);
    const totalH=slot*ROW_STEP;
    const contentW=PAD_X*2+(md+1)*COL_STEP+40;
    const reserve=o.padBottom||0;
    /* 自由画布：四周预留 FREE_PAD 余量——内容不足视口大小时也能上下左右拖动 */
    const vw=(container.clientWidth||0)+FREE_PAD*2;
    const vh=(container.clientHeight||parseInt(o.height)||480)+FREE_PAD*2;
    const canvasW=Math.max(contentW,vw);
    const canvasH=Math.max(totalH+PAD_Y*2+reserve,vh);
    const availH=canvasH-reserve;   /* padBottom=底部预留区（如浮动泡泡），内容不占 */
    const offsetY=(availH-totalH)/2+ROW_STEP/2;
    const offsetX=PAD_X+Math.max(0,(canvasW-contentW)/2);   /* 内容在画布中居中 */
    const contentLeft=offsetX;
    const contentRight=offsetX+md*COL_STEP+(COMPACT?190:214);
    const contentTop=offsetY-ROW_STEP/2;
    const contentBottom=offsetY+Math.max(0,slot-1)*ROW_STEP+ROW_STEP/2;
    return{offsetY:offsetY,offsetX:offsetX,canvasW:canvasW,canvasH:canvasH,contentW:contentW,contentH:totalH+PAD_Y*2,contentLeft:contentLeft,contentRight:contentRight,contentTop:contentTop,contentBottom:contentBottom};
  }
  function depthOf(n){let d=0;for(let x=n;x&&x!==root;x=x.parent)d++;return d}
  function py(n,L){return n._y*ROW_STEP+L.offsetY}

  /* ---------- 渲染 ---------- */
  function render(){
    if(destroyed)return;
    injectCSS();
    let sl=0,st=0,first=!scrollEl;
    if(!first){sl=scrollEl.scrollLeft;st=scrollEl.scrollTop}
    const L=layout();
    lastLayout=L;
    rowMap=[];
    const z=zoom;
    let h='<div class="dc-scroll"><div class="dc-canvas" style="width:'+(L.canvasW*z)+
      'px;height:'+(L.canvasH*z)+'px;transform:scale('+z+');transform-origin:0 0">';
    h+='<svg class="dc-svg" width="'+L.canvasW+'" height="'+L.canvasH+
      '" viewBox="0 0 '+L.canvasW+' '+L.canvasH+'"></svg>';
    if(o.lanes){                     /* 泳道模式：每个二级节点画一条背景泳道 */
      root.children.filter(showChild).forEach(function(c){
        let mn=1e9,mx=-1e9;
        (function w2(n){const ks=(n.children||[]).filter(showChild);
          if(!ks.length){if(n._y<mn)mn=n._y;if(n._y>mx)mx=n._y;return}
          ks.forEach(w2)})(c);
        c._laneTop=mn*ROW_STEP+L.offsetY-ROW_STEP/2-4;
        c._laneH=(mx-mn+1)*ROW_STEP+8;
        c._laneColor=o.laneColor?o.laneColor(c):null;
        h+='<div class="dc-lane-bg" style="top:'+c._laneTop+'px;height:'+c._laneH+
          'px;width:'+(L.canvasW-32)+'px'+(c._laneColor?';--cc:'+c._laneColor:'')+'"></div>';
      });
    }
    h+=nodeHtml(root,0,L);
    (function walk(n,d){(n.children||[]).forEach(function(c){
      if(!showChild(c))return;
      h+=nodeHtml(c,d+1,L);walk(c,d+1)})})(root,0);
    if(addCtx){
      const d=depthOf(addCtx)+(o.lanes?0:1);
      const kids=(addCtx.children||[]).filter(showChild);
      const iy=kids.length?py(kids[kids.length-1],L)+ROW_STEP:py(addCtx,L);
      h+='<div class="dc-newrow" style="left:'+(L.offsetX+d*COL_STEP-10)+'px;top:'+
        Math.min(iy,L.canvasH-24)+'px">'+
        '<input placeholder="子任务名，回车连续创建" autocomplete="off">'+
        '<span class="nr-hint">Enter 下一个 · Esc 结束</span></div>';
    }
    h+=(o.hint?'<div class="dc-hint">'+o.hint+'</div>':'');
    h+='</div></div>';
    container.innerHTML=h;
    container._rowMap=rowMap;  /* 暴露行映射，供宿主拖拽按索引查找节点 */
    let _cl=L.contentLeft,_cr=L.contentRight,_ct=L.contentTop,_cb=L.contentBottom;
    const _nw=COMPACT?190:214;
    rowMap.forEach(function(n){
      if(n._baseX==null)return;
      const nx=n._baseX+(n._freeDX||0), ny=n._baseY+(n._freeDY||0);
      if(nx<_cl)_cl=nx; if(nx+_nw>_cr)_cr=nx+_nw;
      if(ny-24<_ct)_ct=ny-24; if(ny+24>_cb)_cb=ny+24;
    });
    L.contentLeft=_cl;L.contentRight=_cr;L.contentTop=_ct;L.contentBottom=_cb;
    scrollEl=container.querySelector('.dc-scroll');
    if(first){
      centerContent();                 /* 首次进入：内容居中 */
    }else{
      scrollEl.scrollLeft=sl;scrollEl.scrollTop=st;
      clampScroll();                   /* 重渲染保留用户当前平移位置 */
    }
    bind();
    requestAnimationFrame(drawLinks);
  }
  /* 把内容中心对齐到视口中心（只在首次/手动适应时调用；普通平移不再强制回中） */
  function centerContent(){
    if(!scrollEl||!lastLayout)return;
    const z=zoom||1;
    const cw=(lastLayout.contentRight-lastLayout.contentLeft)*z;
    const ch=(lastLayout.contentBottom-lastLayout.contentTop)*z;
    if(cw>scrollEl.clientWidth){
      /* 内容超宽时优先保证根节点可见，右侧继续平移 */
      scrollEl.scrollLeft=Math.max(0,(root._baseX||0)*z-24);
    }else{
      scrollEl.scrollLeft=lastLayout.contentLeft*z-(scrollEl.clientWidth-cw)/2;
    }
    scrollEl.scrollTop=lastLayout.contentTop*z-(scrollEl.clientHeight-ch)/2;
    clampScroll();
  }
  /* 画布平移：只限制在画布自身范围内，不再因为“内容比视口小”而回弹到中心 */
  function clampScroll(){
    if(!scrollEl)return;
    const maxX=Math.max(0,scrollEl.scrollWidth-scrollEl.clientWidth);
    const maxY=Math.max(0,scrollEl.scrollHeight-scrollEl.clientHeight);
    scrollEl.scrollLeft=Math.max(0,Math.min(maxX,scrollEl.scrollLeft));
    scrollEl.scrollTop=Math.max(0,Math.min(maxY,scrollEl.scrollTop));
  }

  function defaultMeta(n){
    const leaf=isLeaf(n);
    if(leaf){
      const hrs='<span class="'+((+n.hours||0)?'':'z')+'" style="'+
        ((+n.hours||0)?'':'color:var(--lx-warn,#D9A13E);')+'">'+round(+n.hours||0)+'h</span>';
      return o.hoursEditable?'<span class="hz" data-role="h">'+hrs+'</span>':hrs;
    }
    return '<span class="sum" title="由子任务汇总">'+round(nodeH(n))+'h · '+leafCount(n)+' 叶</span>';
  }
  function nodeHtml(n,d,L){
    const i=rowMap.length;rowMap.push(n);
    if(o.lanes&&n===root)return'';   /* 泳道模式：根节点不渲染（标题由宿主头部承担） */
    const isLane=o.lanes&&d===1;
    const baseX=isLane?26:(o.lanes?L.offsetX+(d-1)*COL_STEP:L.offsetX+d*COL_STEP);
    const baseY=isLane?(n._laneTop+13):py(n,L);
    n._baseX=baseX;n._baseY=baseY;
    const x=baseX+(n._freeDX||0), y=baseY+(n._freeDY||0);
    const meta=o.meta?o.meta(n):defaultMeta(n);
    const sel=o.isSelected&&o.isSelected(n)?' sel':'';
    const branch=o.colorOf?o.colorOf(n):null;
    const broken=!!(o.brokenTip&&o.brokenTip(n));
    return '<div class="dc-node'+(n===root?' root':'')+(n._virtualRoot?' dc-virtual':'')+(isLane?' dc-lane':'')+(n.abandoned?' abandoned':'')+(broken?' broken-tip':'')+sel+
      '" data-i="'+i+'" data-depth="'+d+'" style="left:'+x+'px;top:'+y+'px;'+(isLane?'transform:none':'')+
      (isLane&&n._laneColor?';--cc:'+n._laneColor:'')+(branch?';--dc-c:'+branch:'')+'">'+
      '<div class="n-name" title="'+esc(n.title)+' · 双击改名">'+esc(n.title)+'</div>'+
      ((n.leaf&&n.progress>=1&&!n.abandoned)?'<span class="n-done" title="已完成">👍</span>':'')+
      '<div class="n-meta">'+meta+'</div>'+
      ((o.badge&&o.badge(n))?'<span class="n-dot" title="未落日"></span>':'')+
      ((o.alert&&o.alert(n))?'<span class="n-alert" title="已逾期 · 补到今天或以后即消除">!</span>':'')+
      ((o.canAbandon&&o.canAbandon(n))?'<span class="n-abandon" data-role="abandon" title="'+
        (n.abandoned?'恢复任务':'放弃任务')+'">'+(n.abandoned?'↺':'⊘')+'</span>':'')+
      ((!n.abandoned&&(!o.canPlus||o.canPlus(n)))?'<span class="n-plus" data-role="plus" title="加子级">＋</span>':'')+
      (n!==root?'<span class="n-x" data-role="x" title="删除">×</span>':'')+
      '</div>';
  }
  function drawLinks(){
    const svg=container.querySelector('.dc-svg');
    if(!svg)return;
    svg.innerHTML='';
    const cv=container.querySelector('.dc-canvas');
    const cb=cv.getBoundingClientRect();
    const elCache=new Map();
    const elOf=n=>{
      if(elCache.has(n))return elCache.get(n);
      let r=null;
      const els=container.querySelectorAll('.dc-node');
      for(let i=0;i<els.length;i++)if(rowMap[+els[i].dataset.i]===n){r=els[i];break}
      elCache.set(n,r);return r};
    const zz=zoom||1;
    const rel=el=>{const r=el.getBoundingClientRect();
      return{l:(r.left-cb.left)/zz,r:(r.right-cb.left)/zz,y:(r.top-cb.top+r.height/2)/zz}};
    (function walk(n){
      (n.children||[]).forEach(c=>{
        if(!showChild(c))return;
        const a=elOf(n),b=elOf(c);
        if(a&&b){
          const p1=rel(a),p2=rel(b);
          const dep=depthOf(c);
          const branch=n._laneColor||(o.colorOf?o.colorOf(c):null);
          const stroke=branch||(dep<=1?'rgba(167,174,192,.62)':'rgba(140,148,168,.52)');
          const op=n._laneColor?.42:(dep<=1?.58:.42);
          const p=document.createElementNS('http://www.w3.org/2000/svg','path');
          const mx=(p1.r+p2.l)/2;
          p.setAttribute('d','M'+p1.r+' '+p1.y+' C'+mx+' '+p1.y+' '+mx+' '+p2.y+' '+p2.l+' '+p2.y);
          p.setAttribute('class','dc-edge');
          p.style.stroke=stroke;
          p.setAttribute('stroke-opacity',op);
          p.dataset.fi=a.dataset.i;p.dataset.ti=b.dataset.i;  /* 卡片索引标记——悬停高亮直接连线用（虚拟节点无 id，不用 id 匹配） */
          svg.appendChild(p);
          /* 开放 V 形箭头：飞书画板的“细线折角”，不是实心三角 */
          const ar=document.createElementNS('http://www.w3.org/2000/svg','path');
          ar.setAttribute('d','M'+(p2.l-8)+' '+(p2.y-4.5)+' L'+p2.l+' '+p2.y+' L'+(p2.l-8)+' '+(p2.y+4.5));
          ar.setAttribute('class','dc-arrow');
          ar.style.stroke=stroke;
          ar.setAttribute('stroke-opacity',op);
          ar.dataset.fi=a.dataset.i;ar.dataset.ti=b.dataset.i;
          svg.appendChild(ar);
        }
        walk(c);
      });
    })(root);
  }

  /* ---------- 绑定 ---------- */
  let outsideBound=false,dragSt=null,dragEndAt=0,ghostEl=null;
  function nodeOf(el){
    const nd=el.closest('.dc-node');
    return nd?rowMap[+nd.dataset.i]:null;
  }
  /* 悬停 → 高亮该卡片的直接连线（父→它、它→子；按卡片索引匹配） */
  function hlLinks(idx,on){
    const svg=container.querySelector('.dc-svg');
    if(!svg)return;
    svg.querySelectorAll('path').forEach(function(p){
      if(p.dataset.fi==idx||p.dataset.ti==idx){
        if(on)p.classList.add('hl');
        else p.classList.remove('hl');
      }
    });
  }
  function bind(){
    container.querySelectorAll('.dc-node').forEach(function(nd){
      const n=rowMap[+nd.dataset.i];
      nd.addEventListener('mouseenter',function(){hlLinks(nd.dataset.i,true)});
      nd.addEventListener('mouseleave',function(){hlLinks(nd.dataset.i,false)});
      nd.querySelector('.n-name').addEventListener('dblclick',function(e){
        e.stopPropagation();
        inline(this,n.title,function(v){opRename(n,v)});
      });      const pl=nd.querySelector('[data-role="plus"]');
      if(pl){
        pl.addEventListener('pointerdown',e=>e.stopPropagation());
        pl.onclick=function(e){
          e.stopPropagation();
          /* v2 交互：点＋ → 先创建节点 → 光标直接在新节点名里；
             空名失焦/Esc = 误触 → 撤销创建（不留"新任务"垃圾节点） */
          var child=opDivide(n,{title:''});
          if(child){
            /* render 后找到新节点，进入改名编辑（不滚动画布——新节点就在父节点旁边，本来就在视野内） */
            requestAnimationFrame(function(){
              var els=container.querySelectorAll('.dc-node');
              for(var i=0;i<els.length;i++){
                if(rowMap[+els[i].dataset.i]===child){
                  var nameEl=els[i].querySelector('.n-name');
                  if(nameEl){
                    nameEl.textContent='';
                    inline(nameEl,'',function(v){
                      var t=v.trim();
                      if(!t){opRemove(child);return}
                      child.title=t;opRename(child,t);
                    });
                  }
                  break;
                }
              }
            });
          }
        };
      }
      const xx=nd.querySelector('[data-role="x"]');
      if(xx){
        xx.addEventListener('pointerdown',e=>e.stopPropagation());
        xx.onclick=function(e){e.stopPropagation();opRemove(n)};
      }
      const ab=nd.querySelector('[data-role="abandon"]');
      if(ab){
        ab.addEventListener('pointerdown',e=>e.stopPropagation());
        ab.onclick=function(e){
          e.stopPropagation();
          if(o.ops&&o.ops.abandon)o.ops.abandon(n,!n.abandoned);
        };
      }
      const hh=nd.querySelector('[data-role="h"]');
      if(hh&&o.hoursEditable)hh.addEventListener('click',function(e){
        e.stopPropagation();
        inline(hh,round(+n.hours||0)+'',function(v){opSetHours(n,parseFloat(v)||0)},true);
      });
      /* 单击（非拖拽） */
      nd.addEventListener('click',function(e){
        if(e.target.closest('.n-plus,.n-x,.n-abandon,.dc-input'))return;
        if(Date.now()-dragEndAt<350)return;
        if(o.onClick)o.onClick(n);
      });
      /* 拖拽（宿主提供 drag 钩子时启用） */
      if(o.drag){
        nd.addEventListener('pointerdown',function(e){
          if(e.button!==0)return;
          if(e.target.closest('.n-plus,.n-x,.n-abandon')||e.target.tagName==='INPUT')return;
          const canAssign=!o.drag.canDrag||o.drag.canDrag(n);
          const canFree=!!o.drag.free&&(!o.drag.canFreeDrag||o.drag.canFreeDrag(n));
          const canReorder=!!o.reorder&&(!o.reorder.canReorder||o.reorder.canReorder(n));
          if(!canAssign&&!canFree&&!canReorder)return;
          dragSt={n:n,el:nd,px0:e.clientX,py0:e.clientY,moved:false,canAssign:canAssign,
            canFree:canFree,canReorder:canReorder,mode:null,
            freeDX:n._freeDX||0,freeDY:n._freeDY||0};
          window.addEventListener('pointermove',onDragMove);
          window.addEventListener('pointerup',onDragUp);
        });
      }
    });
    const inp=container.querySelector('.dc-newrow input');
    if(inp){
      inp.focus();
      inp.addEventListener('keydown',function(e){
        e.stopPropagation();
        if(e.key==='Enter'){
          const v=inp.value.trim();
          if(!v){addCtx=null;render();return}
          opDivide(addCtx,{title:v,hours:0});
          const nr=container.querySelector('.dc-newrow');
          if(nr&&scrollEl)scrollEl.scrollTo({top:nr.offsetTop-120,behavior:'smooth'});
        }
        if(e.key==='Escape'){addCtx=null;render()}
      });
    }
    if(!outsideBound){
      outsideBound=true;
      document.addEventListener('pointerdown',onOutside,true);
    }
  }
  function dropAt(px,py2){
    if(!o.drag)return null;
    const els=document.querySelectorAll(o.drag.dropSelector);
    for(let i=0;i<els.length;i++){
      const r=els[i].getBoundingClientRect();
      if(px>=r.left&&px<=r.right&&py2>=r.top&&py2<=r.bottom)return els[i];
    }
    return null;
  }
  function nodeEl(n){
    const els=container.querySelectorAll('.dc-node');
    for(let i=0;i<els.length;i++)if(rowMap[+els[i].dataset.i]===n)return els[i];
    return null;
  }
  /* 同级排序落点：只认同一父级、可见兄弟之间的空隙（含最前/最后）。
     返回 {before,after,y,left,right,noop}；不在合法空隙内返回 null。 */
  function reorderGap(n,px,py2){
    if(!o.reorder)return null;
    if(o.reorder.canReorder&&!o.reorder.canReorder(n))return null;
    const siblings=o.reorder.siblingsOf?o.reorder.siblingsOf(n):(n.parent?n.parent.children:[]);
    const sibs=(siblings||[]).filter(showChild);
    if(sibs.length<2)return null;
    const all=[];
    sibs.forEach(function(s){
      const el=nodeEl(s);if(!el)return;
      const r=el.getBoundingClientRect();
      all.push({n:s,el:el,rect:r});
    });
    if(all.length<2)return null;
    all.sort(function(a,b){return a.rect.top-b.rect.top});
    const others=all.filter(function(it){return it.n!==n});
    if(!others.length)return null;
    const left=Math.min.apply(null,all.map(function(it){return it.rect.left}));
    const right=Math.max.apply(null,all.map(function(it){return it.rect.right}));
    if(px<left-28||px>right+28)return null;
    const gaps=[];
    gaps.push({y:others[0].rect.top-8,before:others[0].n,after:false});
    for(let i=0;i<others.length-1;i++)
      gaps.push({y:(others[i].rect.bottom+others[i+1].rect.top)/2,before:others[i+1].n,after:false});
    const last=others[others.length-1];
    gaps.push({y:last.rect.bottom+8,before:null,after:true});
    let best=null;
    gaps.forEach(function(g){
      const d=Math.abs(py2-g.y);
      if(d<=20&&(!best||d<best.d))best={y:g.y,before:g.before,after:g.after,d:d};
    });
    if(!best)return null;
    const idx=all.findIndex(function(it){return it.n===n});
    const next=idx>=0&&all[idx+1]?all[idx+1].n:null;
    const noop=(best.before===next)||(best.before===null&&idx===all.length-1);
    return {before:best.before,after:best.after,y:best.y,left:left,right:right,noop:noop};
  }
  function clearInsert(){
    const el=container.querySelector('.dc-insert');
    if(el)el.remove();
  }
  function showInsert(gap){
    const cv=container.querySelector('.dc-canvas');
    if(!cv)return;
    clearInsert();
    const cr=cv.getBoundingClientRect(),z=zoom||1;
    const line=document.createElement('div');
    line.className='dc-insert';
    line.style.left=((gap.left-cr.left)/z)+'px';
    line.style.top=(((gap.y-cr.top)/z)-1)+'px';
    line.style.width=((gap.right-gap.left)/z)+'px';
    cv.appendChild(line);
  }
  function ensureGhost(){
    if(!ghostEl){ghostEl=document.createElement('div');ghostEl.className='dc-ghost';
      document.body.appendChild(ghostEl)}
    return ghostEl;
  }
  function onDragMove(e){
    if(!dragSt)return;
    if(!dragSt.moved&&Math.abs(e.clientX-dragSt.px0)+Math.abs(e.clientY-dragSt.py0)>4)
      dragSt.moved=true;
    if(!dragSt.moved)return;
    dragSt.el.classList.add('dragging');
    let hit=null,gap=null,mode=null;
    if(dragSt.canAssign)hit=dropAt(e.clientX,e.clientY);
    if(hit){
      mode='assign';
    }else if(dragSt.canReorder){
      gap=reorderGap(dragSt.n,e.clientX,e.clientY);
      mode=gap?(gap.noop?'noop':'reorder'):'invalid';
    }else if(dragSt.canFree){
      mode='free';
    }else{
      mode='invalid';
    }
    dragSt.mode=mode;
    if(o.drag&&o.drag.dropSelector){
      document.querySelectorAll(o.drag.dropSelector).forEach(function(t){
        t.classList.toggle('dc-drop-in',mode==='assign'&&t===hit)});
    }
    if(mode==='reorder'||mode==='noop')showInsert(gap);
    else clearInsert();
    const g=ensureGhost();
    g.style.display='block';
    g.style.left=(e.clientX+14)+'px';
    g.style.top=(e.clientY-10)+'px';
    g.classList.toggle('bad',mode==='invalid');
    if(mode==='assign')g.textContent=o.drag&&o.drag.ghostText?o.drag.ghostText(dragSt.n,hit):dragSt.n.title;
    else if(mode==='reorder')g.textContent=dragSt.n.title+' · 同级排序';
    else if(mode==='noop')g.textContent=dragSt.n.title+' · 当前顺序';
    else if(mode==='invalid')g.textContent='不可放置 · 只能同级排序';
    else g.textContent=o.drag&&o.drag.ghostText?o.drag.ghostText(dragSt.n,null):dragSt.n.title;
  }
  function onDragUp(e){
    if(!dragSt)return;
    const d=dragSt;dragSt=null;
    window.removeEventListener('pointermove',onDragMove);
    window.removeEventListener('pointerup',onDragUp);
    if(ghostEl){ghostEl.style.display='none';ghostEl.classList.remove('bad')}
    if(o.drag&&o.drag.dropSelector){
      document.querySelectorAll(o.drag.dropSelector).forEach(function(t){t.classList.remove('dc-drop-in')});
    }
    clearInsert();
    if(!d.moved)return;
    dragEndAt=Date.now();
    const hit=d.canAssign?dropAt(e.clientX,e.clientY):null;
    if(hit&&o.drag&&o.drag.onDrop){
      o.drag.onDrop(d.n,hit);
    }else if(d.canReorder&&o.reorder&&o.reorder.onReorder){
      const gap=reorderGap(d.n,e.clientX,e.clientY);
      if(gap&&!gap.noop)o.reorder.onReorder(d.n,gap.before,gap.after);
    }else if(o.drag&&o.drag.free&&scrollEl){
      const rect=scrollEl.getBoundingClientRect();
      if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom){
        const z=zoom||1;
        d.n._freeDX=d.freeDX+(e.clientX-d.px0)/z;
        d.n._freeDY=d.freeDY+(e.clientY-d.py0)/z;
      }
    }
    render();                                    /* 落点无效/无操作时恢复卡片 */
  }
  function onOutside(ev){
    if(destroyed){document.removeEventListener('pointerdown',onOutside,true);return}
    if(!container.contains(ev.target))return;
    if(ev.target.closest('.dc-newrow,.n-plus'))return;
    if(addCtx){addCtx=null;render()}
  }

  /* ---------- 内联编辑（numMode：工时等数字窄框；名称宽框） ---------- */
  function inline(el,cur,done,numMode){
    const i=document.createElement('input');
    i.className='dc-input';i.value=cur;
    i.style.width=numMode?'52px':'150px';
    el.textContent='';el.appendChild(i);i.focus();i.select();
    let fin=false;
    const finish=v=>{if(fin)return;fin=true;done(v)};
    i.onblur=()=>finish(i.value.trim()||cur);
    i.onkeydown=e=>{
      if(e.key==='Enter')finish(i.value.trim()||cur);
      if(e.key==='Escape')finish(cur);
      e.stopPropagation();
    };
  }

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function round(v){return Math.round((+v||0)*10)/10}

  function fit(){
    if(!scrollEl||!lastLayout)return;
    const vw=scrollEl.clientWidth, vh=scrollEl.clientHeight;
    /* 手动“适应画布”仍可缩放；默认不再随任务数量自动缩小 */
    const minZ=COMPACT?0.8:0.7;
    const z=Math.max(minZ,Math.min(1.2,Math.min(vw/lastLayout.contentW,vh/lastLayout.contentH)));
    zoom=z;
    render();
    scrollEl=container.querySelector('.dc-scroll');
    if(scrollEl)centerContent();
  }
  function zoomBy(d){
    zoom=Math.max(.5,Math.min(1.6,zoom+d));
    render();
    scrollEl=container.querySelector('.dc-scroll');
    if(scrollEl)centerContent();
  }
  function onViewportResize(){
    if(viewportTO)clearTimeout(viewportTO);
    viewportTO=setTimeout(function(){
      if(destroyed)return;
      zoom=baseZoom();
      render();
      requestAnimationFrame(function(){if(!destroyed)centerContent()});
    },120);
  }
  function getData(){return root}
  function destroy(){
    destroyed=true;
    if(viewportTO){clearTimeout(viewportTO);viewportTO=null}
    if(typeof window!=='undefined')window.removeEventListener('resize',onViewportResize);
    if(fitRO){fitRO.disconnect();fitRO=null}
    if(visRO){visRO.disconnect();visRO=null}
    if(outsideBound){document.removeEventListener('pointerdown',onOutside,true);outsideBound=false}
    if(ghostEl)ghostEl.remove();
    container.innerHTML='';
  }

  render();
  let fitRO=null;
  if(o.autoFit){
    fitRO=new ResizeObserver(function(){
      if(destroyed)return;
      clearTimeout(fitRO._t);
      fitRO._t=setTimeout(function(){if(!destroyed)fit()},120);
    });
    fitRO.observe(container);
    requestAnimationFrame(function(){if(!destroyed)fit()});
  }
  /* 首次可见时补一次居中（防止视图先渲染在 display:none 里，尺寸为 0） */
  let centeredOnce=false,visRO=null;
  if(scrollEl&&scrollEl.clientWidth>0&&scrollEl.clientHeight>0)centeredOnce=true;
  if(!centeredOnce){
    visRO=new ResizeObserver(function(){
      if(destroyed)return;
      if(scrollEl&&scrollEl.clientWidth>0&&scrollEl.clientHeight>0){
        centeredOnce=true;
        centerContent();
        visRO.disconnect();visRO=null;
      }
    });
    visRO.observe(container);
  }
  if(typeof window!=='undefined')window.addEventListener('resize',onViewportResize);
  /* ---- 一次性：右键拖动/空白左键拖动 → 画布平移（替代滚动条） ---- */
  if(!container._panBound){
    container._panBound=true;
    container.addEventListener('pointerdown',function(e){
      var se=container.querySelector('.dc-scroll');
      if(!se)return;
      var isNode=e.target.closest('.dc-node,.dc-newrow,.dc-input,.n-plus,.n-x');
      var isRight=e.button===2;
      var isBlank=e.button===0&&!isNode;
      if(!isRight&&!isBlank)return;
      if(isRight)e.preventDefault();
      se.classList.add('panning');
      var sx=e.clientX,sy=e.clientY,ssl=se.scrollLeft,sst=se.scrollTop;
      function mv(ev){
        se.scrollLeft=ssl-(ev.clientX-sx);
        se.scrollTop=sst-(ev.clientY-sy);
        clampScroll();
      }
      function up(){
        se.classList.remove('panning');
        window.removeEventListener('pointermove',mv);
        window.removeEventListener('pointerup',up);
      }
      window.addEventListener('pointermove',mv);
      window.addEventListener('pointerup',up);
    });
    container.addEventListener('contextmenu',function(e){
      e.preventDefault();
    });
  }
  return{render:render,getData:getData,destroy:destroy,fit:fit,zoomBy:zoomBy,
    divide:opDivide,rename:opRename,setHours:opSetHours,remove:opRemove};
}
