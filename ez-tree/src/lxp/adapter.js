/* lxp 适配层 v2（阶段一）：任务树数据 → 建造规格
   - 层级模型：深度 → 组织层 B1..D2（任务层级上限 6，A=根）；
     days 可挂任意叶子层（时间粒度由分解者定，《状态语义》1.1）
   - 长度预算：根预算 = KB·√(goal 工时)，逐级下拨；断枝**长满**本级预算后截断
     （"分解深浅不改已分解部分树冠轮廓"）；下拨权重用声明的 est（分解后不随子树
     变化）→ 追加任务不改变其他子树的预算（只追加不挪位的地基）
   - 校验只翻译不判定：违规以 flags 返回（overDepth / daysWithCh / missingEst）
   - 全 hash 化：一切随机量由节点 id 的 hash 派生
   输入两套：ch/days 数据集（本文件直接消费）+ app 数据（fromApp 先归一化）。 */

export function hash01(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/* 派生量：子树工时 / 完成工时 / 是否收敛（分叉下全部完成） */
export function derive(node) {
  if (node.days) {
    let hours = 0, doneH = 0;
    for (const d of node.days) { hours += d.h; if (d.done) doneH += d.h; }
    return { hours, doneH, converged: node.days.length > 0 && doneH >= hours - 1e-9 };
  }
  if (node.ch && node.ch.length) {
    let hours = 0, doneH = 0, all = true;
    for (const c of node.ch) {
      const k = derive(c);
      hours += k.hours; doneH += k.doneH;
      if (!k.converged) all = false;
    }
    return { hours, doneH, converged: all };
  }
  return { hours: node.est || 1, doneH: 0, converged: false }; // 断枝只有 est（V4）
}

/* 组织层命名：0=A(根)，1..6=B1,B2,C1,C2,D1,D2 */
export const LAYER_NAMES = ['A', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2'];
const MAX_LAYERS = 6;

/* ---- 长度预算参数（demo 基准，阶段二随丛生端头微调） ---- */
const KB = 0.24;                    // 根预算 = KB·√工时
const BUDGET_MIN = 2.6, BUDGET_MAX = 6.5;
const OWN_SHARE = [0.40, 0.50, 0.45, 0.45, 0.40, 0.40, 0.40]; // 各层自留比例（根更短→首侧枝下移）
const ATTACH_END = 0.80;            // 与 tasktree 挂点带上限一致（避开收尖段）
const WEIGHT_POW = 0.35;            // 子预算按工时份额的软化指数
const MIN_REACH = 0.35;

const TIP_R = 0.02;                 // 顶梢保底半径（父截面公式里的 +tip²）
const R = h => 0.0125 * Math.sqrt(h); // 达芬奇：r ∝ √工时（P1：主干略增粗）

/**
 * 任务树 → 建造规格。
 * @returns {{spec: object, flags: {rule: string, id: string, depth?: number}[], budget: number}}
 *   spec 节点：{ id, kind: 'org'|'broken'|'converged'|'days', depth, layer, hash,
 *               hours, doneH, entryR, exitR, len, ch?[], days?[] }
 */
export function prepareSpec(root, opts = {}) {
  const flags = [];
  const d0 = derive(root);
  /* 根预算用**声明的 est**（分解不改变目标的申报规模）→ 追加任务不动根预算；
     无声明才退回派生工时（此时追加会重排，文档化取舍） */
  const budget = Math.min(BUDGET_MAX,
    Math.max(BUDGET_MIN, KB * Math.sqrt(root.est || d0.hours || 1)));

  function build(node, depth, reach) {
    const d = derive(node);
    const hash = hash01(node.id);
    const layer = Math.min(depth, MAX_LAYERS);
    const jit = suffix => 0.9 + 0.2 * hash01(node.id + '~' + suffix);
    const spec = {
      id: node.id, kind: 'org', depth, layer, hash, reach,
      hours: d.hours, doneH: d.doneH,
    };

    if (depth > MAX_LAYERS) flags.push({ rule: 'overDepth', id: node.id, depth });
    if (node.days && node.ch && node.ch.length) {
      flags.push({ rule: 'daysWithCh', id: node.id }); // days 不得再有 ch（状态语义 1.1）
    }

    /* 收敛呈现两式（opts.converge）：
       'collapse'（默认，设计语言"细枝退场"）：子树折叠为短残段+金叶团，子枝不渲染；
       'keep'（对比形态）：结构全保留，不折叠（完成标记同为金叶） */
    if (d.converged && depth > 0 && opts.converge !== 'keep') {
      spec.kind = 'converged';
      spec.entryR = Math.max(0.028, R(d.hours));
      spec.exitR = spec.entryR * 0.85;
      spec.len = reach * 0.5 * jit('len'); // 细枝退场：短残段
      return spec;
    }
    /* 日梢父节点：days 挂叶子层即"分解到日"=完整末梢（层粒度由分解者定）
       物候三色（三态语言 v4）：done→gold；week/next（周/日在轨）→flower；
       bud 为库层能力保留（app 不发射——断梢一律红光，与大纲口径 1:1） */
    if (node.days) {
      spec.kind = 'days';
      spec.entryR = Math.max(0.02, R(d.hours));
      spec.exitR = spec.entryR * 0.8;
      spec.len = reach * 0.55 * (0.9 + 0.1 * hash01(node.id + '~len')); // 抖动不增路径
      spec.days = node.days.map((day, i) => ({
        n: day.n,
        h: day.h,
        type: day.done ? 'gold'
          : (day.w === 'week' || day.w === 'next') ? 'flower' : 'bud',
        hash: hash01(node.id + '#' + i),
        entryR: Math.max(0.012, R(day.h) * 0.75),
      }));
      return spec;
    }
    /* 组织节点：预算下拨——自留一段，其余按子节点声明工时份额分掉 */
    if (node.ch && node.ch.length) {
      const ownShare = OWN_SHARE[Math.min(depth, OWN_SHARE.length - 1)];
      const own = reach * ownShare;
      /* 自留段抖动收幅（≤1.04）：深链抖动相乘会推高根→梢路径，破坏预算守恒 */
      spec.len = own * (0.92 + 0.12 * hash01(node.id + '~len'));
      spec.ch = [];

      // 下拨权重用声明的 est（分解后稳定），无 est 才退回派生工时
      const wOf = n => Math.sqrt(n.est || derive(n).hours || 1);
      const ws = node.ch.map(wOf);
      const wMax = Math.max(...ws);
      const count = node.ch.length;

      let area = TIP_R * TIP_R;
      for (let i = 0; i < count; i++) {
        const tHat = attachT(i, depth); // 期望挂点（抖动均值）
        const childReach = Math.max(MIN_REACH,
          (reach - tHat * own) * Math.pow(ws[i] / wMax, WEIGHT_POW));
        spec.ch.push(build(node.ch[i], depth + 1, childReach));
      }
      for (const c of spec.ch) area += c.entryR * c.entryR;
      spec.entryR = Math.sqrt(area);
      if (depth === 0) spec.entryR = Math.max(spec.entryR, 0.055); // P1：主干半径保底
      /* 末端延续=延长枝（第一子）：出口径由它决定（旧链模型的"末子延续"公式已废） */
      const extR = spec.ch[0].entryR;
      spec.exitR = Math.sqrt(extR * extR + TIP_R * TIP_R);
      return spec;
    }
    /* 断枝：未分解叶子。**短桩**——断枝不兑现剩余预算（树冠随分解生长=滚动波前缘可视），
       桩长按本级粗细给（粗枝留长茬、细枝短茬）；根例外：光杆主干=满预算 */
    if (!(node.est > 0)) flags.push({ rule: 'missingEst', id: node.id }); // V4：断枝必带 est
    spec.kind = 'broken';
    spec.entryR = Math.max(0.03, R(node.est || 1));
    spec.exitR = spec.entryR;
    spec.len = depth === 0
      ? reach * jit('len')
      : Math.min(reach * 0.6, Math.max(0.35, 2.2 * Math.sqrt(spec.entryR)) * jit('len'));
    return spec;
  }

  const spec = build(root, 0, budget);
  return { spec, flags, budget };
}

/* 根→梢最大路径长（期望挂点口径）：长度预算的验收度量。
   弯曲几何下"路径守恒"才是预算模型保证的量；树冠半径受拐角影响，阶段二角度分档后收紧。 */
export function pathToTip(spec) {
  if (spec.kind === 'days') {
    const hMax = spec.days.reduce((m, d) => Math.max(m, d.h), 1);
    return spec.len + 0.24 + 0.09 * Math.sqrt(hMax); // 指扇延伸的期望值
  }
  if (!spec.ch || !spec.ch.length) return spec.len;
  let best = 0;
  for (let i = 0; i < spec.ch.length; i++) {
    const tHat = attachT(i, spec.depth);
    best = Math.max(best, tHat * spec.len + pathToTip(spec.ch[i]));
  }
  return best;
}

/* 期望挂点 t（tasktree 实际挂点的无抖动镜像，预算下拨用）：
   i=0 → 延长枝（端头延续，母枝流向）；i≥1 → 侧枝丛生带，指数收敛槽位——
   每根侧枝的槽位只依赖自己的序号（不除以总数），新增兄弟只取下一槽，
   老兄弟挂点永不移动（只追加不挪位）；越靠后的侧枝越贴近端头（丛生端头）。 */
export function attachT(i, depth = 0) {
  if (i === 0) return 0.93;
  const spread = 0.36 - 0.03 * Math.min(depth, 4); // P1：首侧枝下移、侧枝带更开；深层略抱端
  return ATTACH_END - spread * Math.pow(0.6, i - 1);
}

/* app 数据 → ch/days 归一化（阶段四接入前的初版约定）：
   - 字段容错：name|title、est|hours、children、lvl、assignW/assignD、progress|done
   - 叶子视为日任务当：lvl==='day' 或已落日（assignD）；否则保留为断枝
   - 落日档位近似：assignW→'week'，仅 assignD→'next'（无日历时无法判当周）
   - 层级推断暂按深度（B1..D2）；lvl 的显式类型留待阶段四覆盖 */
export function fromApp(node, depth = 0, idBase = 'app') {
  const name = node.name || node.title;
  const id = String(node.id ?? idBase + '.' + (name || depth));
  const est = Number(node.est ?? node.hours ?? 0) || undefined;
  const kids = (node.children || []).filter(Boolean);

  if (!kids.length) {
    if (node.lvl === 'day' || node.assignD) {
      const done = node.progress >= 1 || node.done === true;
      const w = node.assignW ? 'week' : node.assignD ? 'next' : null;
      return { id, name, est, days: [{ n: name || id, h: est || 1, w, done }] };
    }
    return { id, name, est };
  }
  return {
    id, name, est,
    ch: kids.map((k, i) => fromApp(k, depth + 1, id + '.' + i)),
  };
}
