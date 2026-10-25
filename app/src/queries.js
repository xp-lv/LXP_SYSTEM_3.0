/**
 * @file 查询层（选择器）——派生集合的唯一口径
 * 全部纯函数，入参显式传 root/roots，node 可单测。
 */
import {effM,effW,effD,weekKeyOf,parse} from './calendar.js';

/** @typedef {{id:number,title:string,depth:number,parent:Node|null,children:Node[],leaf?:boolean,hours?:number,lvl?:string,assignM?:string,assignW?:string,assignD?:string,planned?:boolean,progress?:number,overdue?:boolean,abandoned?:boolean,makeup?:string,order?:number,checklist?:Array<{t:string,done:boolean}>,ph?:string}} Node */

/**
 * @param {Node} n
 * @returns {boolean}
 */
export function isLeaf(n){return !n.children||!n.children.length}

/**
 * @param {Node} n
 * @returns {Node[]}
 */
export function leavesUnder(n){
  var out=[];
  if(isLeaf(n)){out.push(n);return out}
  (function w(x){x.children.forEach(function(c){
    if(isLeaf(c))out.push(c);else w(c)})})(n);
  return out;
}

export function treeLeaves(root){
  if(!root)return[];return leavesUnder(root)}

/**
 * @param {Node} n
 * @returns {Node|null}
 */
export function nearestTop(n){
  for(var x=n;x;x=x.parent){if(x.lvl!=='month'&&x.lvl!=='week')return x}
  return null;
}

/**
 * @param {Node} root
 * @param {string} mk 月键 'YYYY-MM'
 * @returns {Node[]}
 */
export function monthTopEntries(root,mk){
  if(!root)return[];
  var out=[];
  (function w(n){n.children.forEach(function(c){
    if(c.lvl!=='month'&&c.lvl!=='week'){
      if(c.assignM===mk)out.push(c);
      if(c.children.length)w(c);
    }
  })})(root);
  return out;
}

/**
 * @param {Node} t 顶层任务
 * @param {string} mk
 * @returns {number} 月度分解工时合计
 */
export function monthLeafSum(t,mk){
  var s=0;
  (function w(n){n.children.forEach(function(c){
    if(c.children.length)w(c);
    else if(c.lvl==='month'&&c.assignM===mk)s+=c.hours||0;
  })})(t);
  return s;
}

/**
 * @param {Node} t
 * @param {string} mk
 * @returns {number}
 */
export function countMonthLeaves(t,mk){
  var c=0;
  (function w(n){n.children.forEach(function(x){
    if(x.children.length)w(x);
    else if(x.lvl==='month'&&x.assignM===mk)c++;
  })})(t);
  return c;
}

/**
 * @param {Node} root
 * @param {string} mk
 * @returns {number}
 */
export function monthLoad(root,mk){
  if(!root)return 0;
  var s=0;
  monthTopEntries(root,mk).forEach(function(c){
    if(!c.children.length)s+=c.hours||0;
    else s+=monthLeafSum(c,mk);
  });
  (function w2(n){n.children.forEach(function(c){
    if(c.children.length)w2(c);
    else if(c.lvl==='month'&&c.assignM===mk){
      var t=nearestTop(c);
      if(!(t&&t!==root&&t.assignM===mk))s+=c.hours||0;
    }
  })})(root);
  return s;
}

/**
 * @param {Node} root
 * @param {string} mk
 * @returns {boolean}
 */
export function monthHasAssign(root,mk){
  if(!root)return false;
  return monthTopEntries(root,mk).length>0||monthLoad(root,mk)>0;
}

/**
 * @param {Node[]} roots
 * @param {string} wk 周键（周四日期串）
 * @returns {Node[]}
 */

/**
 * @param {Node[]} roots
 * @param {string} dayKey 'YYYY-MM-DD'
 * @returns {Node[]}
 */

/**
 * @param {Node[]} roots
 * @returns {Node[]}
 */

/**
 * @param {Node[]} roots
 * @param {string} dayKey
 * @returns {Node[]}
 */
export function pendingOverdue(roots,dayKey){
  var out=[];
  roots.forEach(function(root){
    treeLeaves(root).forEach(function(l){
      if(l.assignD&&l.assignD<dayKey&&!l.overdue&&!l.abandoned&&l.progress<1)
        out.push(l);
    });
  });
  return out;
}

/**
 * @param {Node[]} roots
 * @returns {Node[]}
 */
export function allLeaves(roots){
  if(!roots)return[]
  var out=[];
  roots.forEach(function(root){
    if(isLeaf(root)){out.push(root);return}
    out.push.apply(out,treeLeaves(root));
  });
  return out;
}

/**
 * 某周的任务叶集合（月度/周度域）——月详情周泡泡与周画布共用的口径：
 * 叶子的有效周（自身或最近祖先 assignW）命中该周，或补点落在本周。
 * 已分解的月度任务按其周级叶子计（父级非叶不重复计）。
 * @param {Node[]} roots
 * @param {string} wk 周键
 * @returns {Node[]}
 */
export function weekLeaves(roots,wk){
  var out=[];
  allLeaves(roots).forEach(function(l){
    if(l.lvl!=='month'&&l.lvl!=='week')return;
    if(effW(l)===wk){out.push(l);return}
    if(l.makeup&&weekKeyOf(parse(l.makeup))===wk)out.push(l);
  });
  return out;
}

/**
 * 当日事项：有效落日（沿父链）或补点在该日的叶任务 + 落日临时任务。
 * 今日清单、补点满日灰显、周泡泡水位共用此口径。
 * @param {Node[]} roots
 * @param {string} dayKey 'YYYY-MM-DD'
 * @param {Object[]} [temps] 全局日程池
 * @returns {Node[]}
 */
export function dayItems(roots,dayKey,temps){
  var out=[];
  /* R17 展示层：归属按有效日 makeup||assignD（单日归属，不双列） */
  allLeaves(roots).forEach(function(l){
    var d=l.makeup||effD(l);
    if(d===dayKey)out.push(l);
  });
  (temps||[]).forEach(function(t){if((t.makeup||t.assignD)===dayKey)out.push(t)});
  return out;
}

/**
 * R21 落果（展示层，不要求 overdue 标志）：
 * 有效日（makeup || 有效 assignD）在 weekKey 这一周 && 有效日 < dayKey(今天) && progress<1。
 * 含临时任务（有效日语义同树任务）。
 * @param {Node[]} roots
 * @param {Object[]} temps
 * @param {string} weekKey 查看日所属周
 * @param {string} dayKey 今天 'YYYY-MM-DD'
 * @returns {Node[]}
 */
export function fallenFruits(roots,temps,weekKey,dayKey){
  var out=[];
  allLeaves(roots).forEach(function(l){
    var d=l.makeup||effD(l);
    if(!d||l.progress>=1)return;
    if(weekKeyOf(parse(d))===weekKey&&d<dayKey)out.push(l);
  });
  (temps||[]).forEach(function(t){
    var d=t.makeup||t.assignD;
    if(!d||t.progress>=1)return;
    if(weekKeyOf(parse(d))===weekKey&&d<dayKey)out.push(t);
  });
  return out;
}

/**
 * R21 落叶堆（历史欠账）：assignD < weekStart(本周起始日=周日) && 无有效补点
 * （makeup 缺失或已过期 < 今天）&& progress<1。含临时任务。
 * @param {Node[]} roots
 * @param {Object[]} temps
 * @param {string} weekStart 本周起始日 'YYYY-MM-DD'（weekDays(weekKey)[0]）
 * @param {string} dayKey 今天
 * @returns {Node[]}
 */
export function leafPile(roots,temps,weekStart,dayKey){
  var valid=function(n){
    if(!n.assignD||n.assignD>=weekStart||n.progress>=1)return false;
    if(n.makeup&&n.makeup>=weekStart)return false;
    /* makeup≥weekStart：未过期=有效补点挂枝（R21）；本周内过期=落果（R16"补点也过期才落地"）。
       剩余=无补点或补点在本周前已过期 → 历史欠账 */
    return true;
  };
  var out=allLeaves(roots).filter(valid);
  return out.concat((temps||[]).filter(valid));
}

/**
 * 当日已排工时（含临时/补点）。
 * @param {Node[]} roots
 * @param {string} dayKey
 * @param {Object[]} [temps]
 * @returns {number}
 */
export function dayHours(roots,dayKey,temps){
  return dayItems(roots,dayKey,temps).reduce(function(s,l){return s+(l.hours||0)},0);
}

/**
 * @param {Node} n
 * @returns {Node}
 */
export function treeOf(n){for(var x=n;x;x=x.parent)if(!x.parent)return x;return n}
