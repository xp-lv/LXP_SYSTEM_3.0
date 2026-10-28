/**
 * @file 规则引擎——不变量守卫 + undo/redo 快照栈
 * 全部纯函数，node 可测。mutations.js 消费这些原语。
 */

/**
 * 在写操作前校验域模型不变量，违规抛 Error（被视图错误边界接住）。
 * @param {Object} node - 目标节点
 * @param {Object} patch - 补丁对象（字段名→新值）
 * @throws {Error} 顶级>3级 / 月度assignM冻结 / temp入树 / 容器直改工时
 */
export function assertInvariant(node,patch){
  if(!node)return;
  const p=patch||{};
  if(p.lvl==='top'&&node.depth>=2)
    throw new Error('顶级目标最多3级（当前深度'+node.depth+'），请在月度详情做月度分解');
  if(node.lvl==='month'&&p.assignM!==undefined&&node.assignM&&p.assignM!==node.assignM)
    throw new Error('月度任务的月份锚点已冻结为 '+node.assignM);
  if(p.lvl==='temp'&&node.parent)
    throw new Error('临时任务不挂任务树');
  if(p.hours!==undefined&&node.children&&node.children.length>0)
    throw new Error('容器节点的工时由子任务汇总，不可直接修改');
  /* 周度两层封顶：只拦「在二层周任务下再创建子级」（patch 带 lvl=week 的写入），
     不影响对已存在二层节点的普通修改（工时/进度/补点） */
  if(p.lvl==='week'&&node.lvl==='week'&&node.parent&&node.parent.lvl==='week')
    throw new Error('周度分解最多两层');
}

/**
 * 创建 undo/redo 快照栈。
 * @param {number} [maxSize=50] - 最大深度
 * @returns {{push:Function,undo:Function,redo:Function,canUndo:boolean,canRedo:boolean,depth:number}}
 */
export function createUndoStack(maxSize){
  const max=maxSize||50;
  const undoS=[];const redoS=[];
  return{
    /** @param {Object} snapshot */
    push(snapshot){
      undoS.push(snapshot);
      if(undoS.length>max)undoS.shift();
      redoS.length=0;
    },
    /**
     * @param {Object} current - 当前状态快照
     * @returns {Object|null} 上一个快照，空栈返回 null
     */
    undo(current){
      if(!undoS.length)return null;
      redoS.push(current);
      return undoS.pop();
    },
    /**
     * @param {Object} current
     * @returns {Object|null}
     */
    redo(current){
      if(!redoS.length)return null;
      undoS.push(current);
      return redoS.pop();
    },
    get canUndo(){return undoS.length>0},
    get canRedo(){return redoS.length>0},
    get depth(){return undoS.length}
  };
}

/**
 * 生成节点快照（仅原子字段，不含派生/parent/pos）。
 * @param {Object} n
 * @returns {Object}
 */
export function snapNode(n){
  return{id:n.id,title:n.title,leaf:!!n.leaf,hours:n.hours,lvl:n.lvl,
    progress:n.progress||0,overdue:!!n.overdue,abandoned:!!n.abandoned,
    completedAt:n.completedAt||null,
    assignM:n.assignM||null,assignW:n.assignW||null,assignD:n.assignD||null,
    makeup:n.makeup||null,order:n.order!=null?n.order:null,
    wOrder:n.wOrder!=null?n.wOrder:null,
    checklist:(n.checklist||null)&&n.checklist.map(c=>({t:c.t,done:!!c.done})),
    children:(n.children||[]).map(snapNode)};
}

/**
 * 从快照恢复节点树（重建 parent 指针）。
 * @param {Object} snap
 * @returns {Object}
 */
export function reviveNode(snap){
  const n={id:snap.id,title:snap.title,leaf:!!snap.leaf,hours:snap.hours,
    lvl:snap.lvl,progress:snap.progress||0,
    overdue:!!snap.overdue,abandoned:!!snap.abandoned,
    completedAt:snap.completedAt||null,
    assignM:snap.assignM,assignW:snap.assignW,
    assignD:snap.assignD,makeup:snap.makeup||null,
    order:snap.order!=null?snap.order:null,
    wOrder:snap.wOrder!=null?snap.wOrder:null,
    checklist:(snap.checklist||null)&&snap.checklist.map(c=>({t:c.t,done:!!c.done})),
    children:[]};
  (snap.children||[]).forEach(c=>{
    const child=reviveNode(c);child.parent=n;n.children.push(child);
  });
  return n;
}
