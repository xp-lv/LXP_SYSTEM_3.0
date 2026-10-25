/* lxp 阶段一测试（node 直跑）：node tests/lxp.test.mjs
   依赖 three（仅骨架段落）：npm install --no-save three@0.167.1 */
import assert from 'node:assert/strict';
import { prepareSpec, derive, fromApp, pathToTip, LAYER_NAMES } from '../src/lxp/adapter.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok ', name); }
  catch (e) { fail++; console.error('  FAIL', name, '\n      ', e.message); }
}

/* ---------- 内嵌夹具（与 demo/tree_v2 数据集同构的精简版） ---------- */
const EN = {
  id: 'en650', name: '英语 650', est: 500, ch: [
    { id: 'vocab', name: '词汇', est: 120, ch: [
      { id: 'vocab.book', name: '核心词书', days: [
        { n: 'U1', h: 2, w: 'week', done: true }, { n: 'U2', h: 2, w: 'next' },
        { n: 'U3', h: 2, w: null } ] } ] },
    { id: 'read', name: '阅读', est: 200, ch: [
      { id: 'read.paper', name: '真题阅读', est: 200, ch: [
        { id: 'read.bank', name: '题库月', est: 90, ch: [
          { id: 'read.w1', name: '题库周A', days: [
            { n: 'T1', h: 1.5, w: 'week' }, { n: 'T2', h: 1.5, done: true }, { n: 'T3', h: 1, w: 'next' } ] },
          { id: 'read.w2', name: '题库周B', est: 45 } ] } ] } ] },
    { id: 'listen', name: '听力', est: 100 },
    { id: 'write', name: '写作', est: 80, ch: [
      { id: 'write.m', name: '写作月', days: [
        { n: '框架课', h: 2, done: true }, { n: '段落', h: 2, done: true }, { n: '批改', h: 1, done: true } ] },
      { id: 'write.imit', name: '仿写月', est: 30 } ] },
    { id: 'speak', name: '口语', est: 60, ch: [
      { id: 'speak.w', name: '口语周', days: [
        { n: '跟读', h: 1, w: null }, { n: '模考', h: 1, w: 'next' } ] } ] },
  ],
};

const byId = (spec, id) => {
  if (spec.id === id) return spec;
  for (const c of spec.ch || []) { const r = byId(c, id); if (r) return r; }
  return null;
};

console.log('— 适配层 —');

test('确定性：同数据两次编译逐字节一致', () => {
  const a = JSON.stringify(prepareSpec(EN));
  const b = JSON.stringify(prepareSpec(structuredClone(EN)));
  assert.equal(a, b);
});

test('追加不变量：他枝 spec 逐字节不变，根长不变', () => {
  const before = prepareSpec(structuredClone(EN));
  const after = JSON.parse(JSON.stringify(EN));
  after.ch[1].ch[0].ch[0].ch.push({ id: 'read.w3', name: '题库周C', est: 30 });
  const changed = prepareSpec(after);

  for (const untouched of ['vocab', 'listen', 'write', 'speak']) {
    assert.equal(
      JSON.stringify(byId(changed.spec, untouched)),
      JSON.stringify(byId(before.spec, untouched)),
      `${untouched} 子树被意外重排`);
  }
  assert.equal(changed.spec.len, before.spec.len, '根段长应不变（预算走声明 est）');
  assert.equal(changed.budget, before.budget);
});

test('层级与形态判定：days=完整日梢（任意层）、无 days 叶=断枝、全完成=收敛', () => {
  const { spec } = prepareSpec(EN);
  assert.equal(byId(spec, 'vocab.book').kind, 'days');       // B2 层挂 days → 日梢
  assert.equal(byId(spec, 'vocab.book').layer, 2);
  assert.equal(byId(spec, 'read.w2').kind, 'broken');        // C2 层未落日 → 断枝
  assert.equal(byId(spec, 'read.w2').layer, 4);
  assert.equal(byId(spec, 'write.m').kind, 'converged');     // 全完成 → 金团
  assert.equal(spec.kind, 'org');
  assert.equal(LAYER_NAMES[byId(spec, 'read.paper').layer], 'B2');
});

test('校验只翻译不判定：overDepth / daysWithCh / missingEst', () => {
  const bad = {
    id: 'bad', est: 100, ch: [
      { id: 'd1', est: 60, ch: [{ id: 'd2', est: 40, ch: [{ id: 'd3', est: 30, ch: [
        { id: 'd4', est: 20, ch: [{ id: 'd5', est: 15, ch: [{ id: 'd6', est: 10, ch: [
          { id: 'd7', est: 5 } ] } ] } ] } ] } ] } ] },
      { id: 'mix', est: 30, days: [{ n: 'x', h: 2 }], ch: [{ id: 'mix.c', est: 10 }] },
      { id: 'noest', name: '缺est' },
    ],
  };
  const { flags } = prepareSpec(bad);
  const rules = flags.map(f => f.rule);
  assert.ok(rules.includes('overDepth') && flags.some(f => f.id === 'd7'));
  assert.ok(rules.includes('daysWithCh') && flags.some(f => f.id === 'mix'));
  assert.ok(rules.includes('missingEst') && flags.some(f => f.id === 'noest'));
});

test('fromApp：app 叶子带 assignD → day；组织嵌套保留', () => {
  const app = {
    name: '目标', est: 100, children: [
      { title: '月度A', est: 60, children: [
        { title: '周任务', est: 30, assignD: '2026-10-12', assignW: 'W41', progress: 0 },
        { title: '未落日', est: 30 },
      ] },
    ],
  };
  const n = fromApp(app);
  assert.equal(n.ch[0].ch[0].days[0].w, 'week');
  assert.equal(n.ch[0].ch[0].days[0].h, 30);
  assert.equal(n.ch[0].ch[1].est, 30);
  assert.ok(!n.ch[0].ch[1].days);
});

console.log('— 驱动层（阶段二）—');
try {
  const { buildSkeleton } = await import('../src/lxp/tasktree.js');
  const { attachT } = await import('../src/lxp/adapter.js');

  test('延长枝挂点：第一子挂端头（t≥0.86），侧枝丛生带（t≤0.84）', () => {
    const sk = buildSkeleton(prepareSpec(EN).spec);
    const trunk = sk.branches[0];
    /* 挂点 t = 子枝基点在母枝折线上的投影位置（段内插值，不受截面稀疏量化影响） */
    const childT = tid => {
      const b = sk.branches.find(x => x.taskId === tid);
      const p = b.sections[0].origin;
      let best = { d2: Infinity, t: 0 };
      for (let i = 0; i < trunk.sections.length - 1; i++) {
        const A = trunk.sections[i].origin, B = trunk.sections[i + 1].origin;
        const ab = [B.x - A.x, B.y - A.y, B.z - A.z];
        const ap = [p.x - A.x, p.y - A.y, p.z - A.z];
        const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
        let u = ab2 > 0 ? (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2 : 0;
        u = Math.max(0, Math.min(1, u));
        const dx = ap[0] - u * ab[0], dy = ap[1] - u * ab[1], dz = ap[2] - u * ab[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best.d2) best = { d2, t: (i + u) / (trunk.sections.length - 1) };
      }
      return best.t;
    };
    const tVocab = childT('vocab');       // ch[0] = 延长枝
    assert.ok(tVocab >= 0.86, `延长枝 vocab 挂点 ${tVocab.toFixed(2)} 不在端头`);
    for (const id of ['read', 'listen', 'write', 'speak']) {
      const t = childT(id);
      assert.ok(t <= 0.84, `侧枝 ${id} 挂点 ${t.toFixed(2)} 超出丛生带`);
    }
  });

  test('org 无针尖（末端≈延长枝口径），日梢收尖闭口', () => {
    const { spec } = prepareSpec(EN);
    const sk = buildSkeleton(spec);
    const trunk = sk.branches[0];
    const lastR = trunk.sections.at(-1).radius;
    assert.ok(lastR >= spec.exitR * 0.9,
      `org 末端半径 ${lastR.toFixed(3)} 未达延续口径 ${spec.exitR.toFixed(3)}（针尖）`);
    const days = sk.branches.find(b => b.taskId === 'vocab.book');
    assert.ok(days.sections.at(-1).radius <= 0.05, '日梢末端应收尖闭口');
  });

  test('兄弟级追加不变量：新增第 3 子，老二子的截面逐点不变', () => {
    const stripRadius = b => JSON.stringify(b.sections.map(s => ({ o: s.origin, d: s.orientation })));
    const base = buildSkeleton(prepareSpec(structuredClone(EN)).spec);
    const added = JSON.parse(JSON.stringify(EN));
    added.ch[1].ch[0].ch[0].ch.push({ id: 'read.w3', name: '题库周C', est: 30 }); // read.bank 加第 3 子
    const mod = buildSkeleton(prepareSpec(added).spec);
    for (const tid of ['read.w1', 'read.w2']) {
      assert.equal(
        stripRadius(mod.branches.find(b => b.taskId === tid)),
        stripRadius(base.branches.find(b => b.taskId === tid)),
        `兄弟枝 ${tid} 被新增兄弟挪动`);
    }
  });

  test('断口愈合：分解断枝→其端盖消失、子枝出现，他枝逐点不动', () => {
    const stripRadius = b => JSON.stringify(b.sections.map(s => ({ o: s.origin, d: s.orientation })));
    const base = buildSkeleton(prepareSpec(structuredClone(EN)).spec);
    const before = {
      caps: base.decor.caps.length,
      hasListen: base.branches.some(b => b.taskId === 'listen'),
    };
    assert.equal(before.caps, 3);
    assert.ok(before.hasListen);

    const added = JSON.parse(JSON.stringify(EN));
    added.ch[2].ch = [                                   // listen（断枝）被分解
      { id: 'listen.1', name: '听力·1', est: 55 },
      { id: 'listen.2', name: '听力·2', est: 45 }];
    const mod = buildSkeleton(prepareSpec(added).spec);

    /* listen 愈合（自身端盖消失），新子任务是更细的断枝（各带新端盖）：3−1+2=4 */
    assert.equal(mod.decor.caps.length, 4, '端盖数应为 3−1(愈合)+2(新断枝)');
    const oldCap = base.branches.find(b => b.taskId === 'listen').sections.at(-1).origin;
    const nearOld = mod.decor.caps.filter(c =>
      Math.hypot(c.origin.x - oldCap.x, c.origin.y - oldCap.y, c.origin.z - oldCap.z) < 0.25);
    assert.equal(nearOld.length, 0, 'listen 原端盖位置不应再有端盖（已愈合）');
    assert.ok(mod.branches.some(b => b.taskId === 'listen.1'), '新子枝应出现');
    assert.ok(mod.branches.some(b => b.taskId === 'listen.2'));
    for (const tid of ['vocab', 'read', 'write', 'speak', 'read.w2', 'write.imit']) {
      assert.equal(
        stripRadius(mod.branches.find(b => b.taskId === tid)),
        stripRadius(base.branches.find(b => b.taskId === tid)),
        `他枝 ${tid} 被意外挪动`);
    }
  });

  test('attachT 槽位只依赖序号（与总数无关）', () => {
    for (const depth of [0, 2, 4]) {
      for (const i of [1, 2, 3]) {
        assert.equal(attachT(i, depth), attachT(i, depth)); // 确定性
        assert.ok(attachT(i, depth) <= 0.80 + 1e-9, `槽位 ${i} 超出丛生带`);
        if (i > 1) assert.ok(attachT(i, depth) > attachT(i - 1, depth), '槽位应向端头收敛');
      }
    }
  });
} catch (e) {
  console.error('  SKIP 驱动层段落：', e.message);
}
let skeletonOk = true;
try {
  const { buildSkeleton } = await import('../src/lxp/tasktree.js');

  test('骨架确定性：同规格两次生成截面逐点一致', () => {
    const s = prepareSpec(EN).spec;
    const a = JSON.stringify(buildSkeleton(s).branches);
    const b = JSON.stringify(buildSkeleton(structuredClone(s)).branches);
    assert.equal(a, b);
  });

  test('骨架追加不变量：他枝截面位置/朝向逐点不变（半径可随母枝增粗微调）', () => {
    const stripRadius = b => JSON.stringify(b.sections.map(s => ({ o: s.origin, d: s.orientation })));
    const base = structuredClone(EN);
    const skA = buildSkeleton(prepareSpec(base).spec);
    const added = JSON.parse(JSON.stringify(EN));
    added.ch[1].ch[0].ch[0].ch.push({ id: 'read.w3', name: '题库周C', est: 30 });
    const skB = buildSkeleton(prepareSpec(added).spec);
    for (const tid of ['vocab', 'listen', 'write', 'speak']) {
      const a = stripRadius(skA.branches.find(b => b.taskId === tid));
      const b = stripRadius(skB.branches.find(x => x.taskId === tid));
      assert.equal(b, a, `枝 ${tid} 被意外挪动`);
    }
  });

  test('收敛呈现两式：collapse 折叠为金团残段 / keep 保留全结构+金叶挂梢', () => {
  const done = {
    id: 'g', est: 100, ch: [
      { id: 'a', est: 60, ch: [
        { id: 'a1', days: [{ n: 'x', h: 3, done: true }, { n: 'y', h: 2, done: true }] },
        { id: 'a2', days: [{ n: 'z', h: 1, done: true }] } ] },
      { id: 'b', est: 30, days: [{ n: 'w', h: 2, w: 'week' }] },
    ],
  };
  const col = prepareSpec(structuredClone(done));
  const keep = prepareSpec(structuredClone(done), { converge: 'keep' });

  assert.equal(byId(col.spec, 'a').kind, 'converged');            // 折叠：子树收残段
  assert.equal(col.spec.ch[0].ch, undefined);
  assert.equal(byId(keep.spec, 'a').kind, 'org');                 // 保留：结构完整
  const a1k = byId(keep.spec, 'a1');
  assert.equal(a1k.kind, 'days');
  assert.ok(a1k.days.every(d => d.type === 'gold'));              // 全完成末梢挂金叶
  assert.equal(byId(keep.spec, 'b').days[0].type, 'flower');      // 未收敛分支不受影响（三态语言 v4：在轨=粉花）
});

test('断枝短桩：不兑现剩余预算（≤60% reach），桩长按粗细给；光杆例外（满预算）', () => {
    const { spec } = prepareSpec(EN);
    for (const id of ['listen', 'read.w2', 'write.imit']) {
      const s = byId(spec, id);
      assert.ok(s.len <= s.reach * 0.6 + 1e-9, `${id} 断枝过长: ${s.len.toFixed(2)} > 0.6·${s.reach.toFixed(2)}`);
      assert.ok(s.len >= 0.3 && s.len <= 1.0, `${id} 桩长出自然范围: ${s.len.toFixed(2)}`);
    }
    const bare = prepareSpec({ id: 'idea', est: 120 });
    assert.ok(bare.spec.len > bare.budget * 0.85, '光杆主干应保持满预算');
  });

  test('长度预算：拆0层 vs 拆满层 根→梢路径差 ≤8%（半径受拐角影响，阶段二收紧）', () => {
    const bare = { id: 'g', name: '满额', est: 500 };
    const full = {
      id: 'g', name: '满额', est: 500, ch: [
        { id: 'g.a', est: 250, ch: [
          { id: 'g.a1', days: [{ n: 'a1', h: 120 }] },
          { id: 'g.a2', days: [{ n: 'a2', h: 130 }] } ] },
        { id: 'g.b', est: 250, ch: [
          { id: 'g.b1', days: [{ n: 'b1', h: 100 }] },
          { id: 'g.b2', est: 150, ch: [
            { id: 'g.b2w', days: [{ n: 'b2', h: 150 }] } ] } ] },
      ],
    };
    const pBare = pathToTip(prepareSpec(bare).spec);
    const pFull = pathToTip(prepareSpec(full).spec);
    const delta = Math.abs(pBare - pFull) / pBare;
    console.log(`      光杆路径 ${pBare.toFixed(2)} vs 拆满路径 ${pFull.toFixed(2)} → ${(delta * 100).toFixed(1)}%`);

    const canopy = sk => Math.max(...sk.branches.flatMap(b =>
      b.sections.map(s => Math.hypot(s.origin.x, s.origin.y, s.origin.z))));
    const rBare = canopy(buildSkeleton(prepareSpec(bare).spec));
    const rFull = canopy(buildSkeleton(prepareSpec(full).spec));
    const rDelta = Math.abs(rBare - rFull) / rBare;
    console.log(`      （观察值）光杆半径 ${rBare.toFixed(2)} vs 拆满 ${rFull.toFixed(2)} → ${(rDelta * 100).toFixed(1)}%`);

    assert.ok(delta <= 0.08, `路径差 ${(delta * 100).toFixed(1)}% 超限`);
    assert.ok(rDelta <= 0.08, `半径差 ${(rDelta * 100).toFixed(1)}% 超限（规格目标 5%，断言留余量）`);
  });
} catch (e) {
  skeletonOk = false;
  console.error('  SKIP 骨架段落：', e.message, '（先 npm install --no-save three@0.167.1）');
}

console.log(`\n${pass} 通过 · ${fail} 失败${skeletonOk ? '' : ' · 骨架段跳过'}`);
process.exit(fail ? 1 : 0);
