/* lxp 驱动层（阶段二）：建造规格 → 骨架（sections 折线）+ 装饰锚点
   产出骨架与上游 Tree 兼容（经 options.task 挂钩或直接赋 skeleton）。
   - 延长枝：每叉第 1 子（最先分解）从母枝端头沿流向延续（挂点≈0.93），
     同级延续（B1→B2）小角近乎续接、换级（B→C）转折加大=主分岔感
   - 侧枝丛生端头：其余子按指数收敛槽位挂点（attachT 镜像预算），越后越贴端头；
     槽位只依赖自身序号 → 新增兄弟只取下一槽，老枝永不挪位
   - org 枝无针尖（母枝被延长枝延续，全长度线性收细）；
     日梢/收敛枝保留收尖（闭口）；断枝平齐（断口礼仪）
   - 姿态：前半段抬头（趋光）、末两段下垂（梢端垂头）
   - 确定性：每枝 RNG 由该枝 spec.hash 派生；一切抖动只由 hash 或父枝流水的稳定前缀决定 */

import * as THREE from 'three';
import RNG from '../lib/rng.js';
import { attachT } from './adapter.js';

const GOLDEN = 2.39996; // 黄金角 137.5°（rad）

/* 角度分档（度）与分层参数表（layer 0..6 = A,B1,B2,C1,C2,D1,D2） */
const EXT_ANGLE_SAME = 12;   // 同级延续：近乎续接（P1 略增）
const EXT_ANGLE_CROSS = 32;  // 换级延续：主分岔（P1 更有主次）
const lateralAngle = layer => Math.min(58, 42 + 3 * layer); // 侧枝扇形随层深递增
const SEGMENTS_BY_LAYER = [10, 8, 7, 6, 6, 5, 4];          // P1：主干/大枝更圆
const G_BASE_BY_LAYER = [0.12, 0.13, 0.14, 0.15, 0.16, 0.17, 0.17]; // P1：更自然的 S 弯
const TYPE_OF_LAYER = layer => (layer <= 0 ? 'A' : 'ABCD'[Math.floor((layer - 1) / 2)]);

const TIP_T = 0.82;   // 日梢/收敛枝的收尖起点（org 不收尖——被延长枝延续）
const TIP_R = 0.012;  // 收尖半径下限（可见性地板）

function upOf(orientation) {
  return new THREE.Vector3(0, 1, 0).applyEuler(orientation);
}

function sectionCountFor(spec) {
  return Math.max(3, Math.min(10, Math.round(spec.len / 0.4)));
}

/**
 * @param {object} spec prepareSpec 产出的规格树根
 * @returns {{branches: object[], leaves: [], decor: {caps: object[], golds: object[], markers: object[]}}}
 */
export function buildSkeleton(spec) {
  const branches = [];
  const decor = { caps: [], golds: [], markers: [] };
  const queue = [{
    spec, level: 0,
    origin: new THREE.Vector3(),
    orientation: new THREE.Euler(),
  }];

  while (queue.length > 0) {
    const item = queue.shift();
    growBranch(item, branches, decor, queue);
  }
  return { branches, leaves: [], decor };
}

function growBranch({ spec, level, origin, orientation, isLateral }, branches, decor, queue) {
  const rng = new RNG(Math.floor(spec.hash * 2147483647) || 1);
  const n = sectionCountFor(spec);
  const stepLen = spec.len / n;
  const layer = Math.min(spec.layer ?? level, 6);
  const segments = SEGMENTS_BY_LAYER[Math.min(layer, SEGMENTS_BY_LAYER.length - 1)];
  const gBase = G_BASE_BY_LAYER[Math.min(layer, G_BASE_BY_LAYER.length - 1)];

  /* 逼真度扩展：
     - 领口（叉口蹼）：附着基部 26% 段半径鼓包——侧枝强、延长枝弱、主干无
     - 基部 AO：附着处变暗（0.62→1.0，18% 段内渐亮），蒙皮输出顶点色
     - 根部展宽：主干基部 12% 段展宽（root flare）
     - 截面椭圆：每枝低频扰动（hash 决定，蒙皮消费） */
  const collarK = level === 0 ? 0 : (isLateral ? 0.38 : 0.12);
  const ellipse = {
    amp: level === 0 ? 0.02 : 0.025 + 0.035 * ((spec.hash * 7.13) % 1),
    phase: spec.hash * 6.28,
  };
  const smooth01 = x => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

  /* 半径纵剖：断枝平齐（断口礼仪）；org 全长度线性收细（无针尖——被延长枝延续）；
     日梢/收敛主段收至 TIP_T 后收尖闭口（圆头收尖） */
  const hasTaper = spec.kind !== 'org' && spec.kind !== 'broken';
  const sections = [];
  let pos = origin.clone();
  let ori = orientation.clone();

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let radius;
    if (spec.kind === 'broken') {
      radius = spec.entryR;
    } else if (!hasTaper) {
      radius = spec.entryR + (spec.exitR * 0.96 - spec.entryR) * t;
    } else if (t <= TIP_T) {
      radius = spec.entryR + (spec.exitR - spec.entryR) * (t / TIP_T);
    } else {
      const k = (t - TIP_T) / (1 - TIP_T);
      radius = spec.exitR + (TIP_R - spec.exitR) * Math.pow(k, 1.35);
    }
    if (level === 0) {
      /* P1：更强的根部展宽（板根感），只影响主干最下段 */
      radius *= 1 + 1.25 * Math.pow(Math.max(0, 1 - t / 0.16), 2);
    }

    const collar = collarK * Math.pow(Math.max(0, 1 - t / 0.26), 1.7);
    const ao = 0.62 + 0.38 * smooth01(t / 0.18);

    sections.push({ origin: pos.clone(), orientation: ori.clone(), radius, collar, ao });

    pos.addScaledVector(upOf(ori), stepLen);
    if (i === n) break;

    /* 蜷曲：幅度只按层级（与绝对半径解耦，见阶段一），每枝专属 rng */
    const g = Math.min(0.25, gBase);
    ori.x += rng.random(g, -g);
    ori.z += rng.random(g, -g);

    /* 分节姿态：前半段抬头（趋光）、末两段下垂（梢端垂头），限幅防甩头 */
    const lift = t < 0.6 ? 0.018 : t > 0.82 ? -0.02 : 0.008;
    const q = new THREE.Quaternion().setFromEuler(ori);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const axis = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
    const sin = axis.length();
    if (sin > 1e-6) {
      axis.divideScalar(sin);
      const full = Math.atan2(sin, up.y);
      const step = Math.max(-full, Math.min(full, lift));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, step));
      ori.setFromQuaternion(q);
    }
  }

  branches.push({
    sections,
    segmentCount: segments,
    baseRadius: spec.entryR,
    taskId: spec.id,
    ellipse,
  });

  const last = sections[sections.length - 1];

  /* 末梢三态：断枝=端盖锚点；收敛=金团锚点；日梢=指扇 */
  if (spec.kind === 'broken') {
    decor.caps.push({ origin: last.origin, orientation: last.orientation, radius: last.radius });
  } else if (spec.kind === 'converged') {
    decor.golds.push({ origin: last.origin, hours: spec.doneH });
  } else if (spec.kind === 'days') {
    const fanBase = sections[Math.floor(TIP_T * (sections.length - 1))];
    spawnFingers(spec, fanBase, branches, decor);
  }

  /* 子枝群：第 1 子=延长枝（端头沿流向延续），其余=侧枝（丛生槽位+黄金角） */
  if (spec.ch && spec.ch.length) {
    for (let i = 0; i < spec.ch.length; i++) {
      const child = spec.ch[i];
      const isExt = i === 0;

      /* 挂点：attachT 槽位 + 父枝流水的稳定前缀抖动（每子一笔，追加不移前缀） */
      let t = attachT(i, layer) + rng.random(-0.03, 0.03);
      t = isExt ? Math.max(0.88, t) : Math.min(ATTACH_CAP, Math.max(0.3, t));

      const f = t * (sections.length - 1);
      const idx = Math.min(sections.length - 2, Math.floor(f));
      const alpha = f - idx;
      const a = sections[idx], b = sections[idx + 1];

      const childOrigin = new THREE.Vector3().lerpVectors(a.origin, b.origin, alpha);
      const radiusAt = a.radius + (b.radius - a.radius) * alpha;
      const qA = new THREE.Quaternion().setFromEuler(a.orientation);
      const qB = new THREE.Quaternion().setFromEuler(b.orientation);
      const parentQ = qB.slerp(qA, alpha);

      /* 角度分档：延长枝同级小角/换级大角；侧枝扇形随层深，
         并按挂高做形态梯度（低处更平展、高处更上仰）；P1 每枝加 hash 抖动 */
      const childLayer = Math.min(child.layer ?? layer + 1, 6);
      const sameType = TYPE_OF_LAYER(layer) === TYPE_OF_LAYER(childLayer);
      const baseTilt = isExt
        ? (sameType ? EXT_ANGLE_SAME : EXT_ANGLE_CROSS)
        : lateralAngle(childLayer) * (1.15 - 0.35 * t);
      const jitterDeg = (child.hash - 0.5) * (isExt ? 14 : 18);
      const tiltDeg = Math.max(4, Math.min(68, baseTilt + jitterDeg));
      const az = GOLDEN * i + child.hash * 1.5;
      const qTilt = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), tiltDeg / (180 / Math.PI));
      const qAz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), az);
      const childOri = new THREE.Euler().setFromQuaternion(
        parentQ.clone().multiply(qAz).multiply(qTilt));

      /* 永不逆粗：子枝基径 ≤ 母枝挂点局部半径，超限整枝等比收缩 */
      let childSpec = child;
      if (child.entryR > radiusAt * 1.02) {
        const k = (radiusAt * 1.02) / child.entryR;
        childSpec = { ...child, entryR: child.entryR * k, exitR: child.exitR * k };
      }

      queue.push({
        spec: childSpec, level: level + 1,
        origin: childOrigin, orientation: childOri,
        isLateral: !isExt,
      });
    }
  }
}

const ATTACH_CAP = 0.82; // 侧枝挂点上限（不进 org 的收尾区）

/* 日梢指扇：从收尖起点（粗段末端）放射 K 根短指（每根=一个日任务），指尖记物候 marker */
function spawnFingers(spec, last, branches, decor) {
  const up = upOf(last.orientation).normalize();
  const K = spec.days.length;
  const spread = Math.min(1.0, 0.35 + 0.18 * K);

  for (let i = 0; i < K; i++) {
    const day = spec.days[i];
    const fanT = K === 1 ? 0 : spread * (i / (K - 1) - 0.5);
    const dir = up.clone()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), fanT + 0.15)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), GOLDEN * i + day.hash * 1.2)
      .normalize();

    const flen = 0.24 + 0.09 * Math.sqrt(day.h);
    const fr = Math.max(0.012, Math.min(day.entryR, last.radius * 0.9)); // 指基径不逆粗于扇基
    const tip = last.origin.clone().addScaledVector(dir, flen);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    const secs = [];
    const m = 3;
    const tipR = Math.max(0.012, fr * 0.18); // 指尖同样收细闭口
    for (let k = 0; k <= m; k++) {
      const t = k / m;
      secs.push({
        origin: last.origin.clone().lerp(tip, t),
        orientation: new THREE.Euler().setFromQuaternion(q),
        radius: Math.max(0.008, fr + (tipR - fr) * t),
      });
    }
    branches.push({ sections: secs, segmentCount: 5, baseRadius: fr, taskId: spec.id + '#' + i });

    decor.markers.push({
      origin: tip.clone().addScaledVector(dir, 0.02),
      type: day.type, h: day.h,
    });
  }
}
