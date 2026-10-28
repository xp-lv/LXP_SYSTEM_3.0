/* app 建造器（阶段四）：app 任务树 → lxp adapter → ez-tree（options.task 挂钩）→ 网格+装饰
   对外与 demo/goal.js 的 buildGoalTree 同构子集：{ grp, _beacons, appRoot, spec, meshes }
   - 数据映射（镜像 goal.js cfgFromApp 语义）：内节点→ch；叶子已完成/已排期→单日末梢 days；
     其余未完成叶→断枝 est
   - 尺寸：骨架原生 ~5-6 单位，按 H（岛高比例）整体缩放
   - perBranch：逐枝网格（激活树，可按节点拾取，mesh.userData.app 回挂 app 节点）；
     distant：整树合并单网格
   - beacons：断枝端盖→断梢红光（世界坐标，小地图/夜景）；pos 回写供拾取/聚焦/星球/大纲
   三态语言 v5（《02.4》红光/粉花/金叶——与大纲"断梢/细枝"口径 1:1）：
   开放粉花 = 已落日至日（assignD / makeup，真正进入执行轨道）；
   红光断梢 = 其余未完成叶——未分解、仅月度、以及**仅排到周但未落日**（assignW 不算落日）；
   金叶 = 已完成（保留枝干，金叶只做完成标记，不折叠枝形） */

import THREE from '../three.js';
import {isOverdue,today} from '../calendar.js';
import { prepareSpec } from '../../../ez-tree/src/lxp/adapter.js';
import { buildDecor } from '../../../ez-tree/src/lxp/decor.js';
import { Tree } from '../../../ez-tree/src/lib/tree.js';
import TreeOptions from '../../../ez-tree/src/lib/options.js';

function effField(n,key){
  for(let x=n;x;x=x.parent){if(x[key])return x[key]}
  return null;
}
function toTask(n) {
  const name = n.title || n.name;
  const id = String(n.id);
  if (n.children && n.children.length) {
    return { id, name, est: n.hours, ch: n.children.map(toTask) };
  }
  const done = (n.progress || 0) >= 1;
  /* 落日可能继承自父级：按有效 assignD 判断；只有 assignD / makeup 才算真正落日。
     逾期也用展示层口径（makeup||assignD 对比今天），不再依赖粘性的 overdue 标志。
     仅排到周（assignW）但没落日的叶子仍是断梢，不再误画成花。 */
  const effD=effField(n,'assignD'),effW=effField(n,'assignW');
  const planned = !!(effD || n.makeup) && !isOverdue(n, today().d);
  const h = Math.max(1, n.hours || 2);
  if (done || planned) {
    return { id, name, est: h, days: [{ n: name, h, w: effW ? 'week' : 'next', done }] };
  }
  return { id, name, est: h };
}

function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,170,125,.9)');
  gr.addColorStop(0.35, 'rgba(236,92,62,.34)');
  gr.addColorStop(1, 'rgba(210,55,40,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill();
  return new THREE.CanvasTexture(cv);
}

/* ---------- 树皮材质：ez-tree 上游贴图资产 + 顶点 AO（逼真度档） ---------- */
const BARK_DIR = '/ez-tree/src/app/public/textures/bark/Bark001_1K-JPG/';
let barkMat = (() => { const m = new THREE.MeshStandardMaterial({ color: 0x8a7355, roughness: 1, flatShading: true }); m.userData.shared = true; return m; })();
let barkReadyCbs = [];
let barkLoaded = false;

(function loadBark() {
  const loader = new THREE.TextureLoader();
  const load = f => new Promise((res, rej) => loader.load(BARK_DIR + f, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1.6);
    t.anisotropy = 4;
    res(t);
  }, undefined, rej));
  Promise.all([
    load('Bark001_1K-JPG_Color.jpg'),
    load('Bark001_1K-JPG_NormalGL.jpg'),
    load('Bark001_1K-JPG_Roughness.jpg'),
  ]).then(([map, normalMap, roughnessMap]) => {
    /* 原地更新共享材质（不能替换对象——已建成的树持有旧引用，
       替换会导致贴图不生效、树干惨白） */
    barkMat.map = map;
    barkMat.normalMap = normalMap;
    barkMat.roughnessMap = roughnessMap;
    /* 暖棕乘色 + sRGB→线性补偿（r128 纯色 hex 按线性进 shader，会整体偏白） */
    barkMat.color.set(0x897965).convertSRGBToLinear();
    barkMat.roughness = 1;
    barkMat.metalness = 0;
    barkMat.flatShading = false;
    barkMat.vertexColors = true;
    barkMat.normalScale.set(1.1, 1.1);
    barkMat.needsUpdate = true;
    barkLoaded = true;
    barkReadyCbs.forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
  }).catch(e => console.warn('[eztree] 树皮贴图加载失败，平色兜底：', e.message));
})();

/* 红光呼吸注册表（tree.js dispose 时 clear；loop 每帧 stepEzTree） */
const ezBeacons = [];
export function clearEzBeacons() { ezBeacons.length = 0; }
export function stepEzTree(tG) {
  for (const b of ezBeacons) {
    const w = Math.sin(tG * 1.6 + b.ph);
    b.core.scale.setScalar(1 + w * .05);
    b.spr.material.opacity = b.op * (.9 + .1 * w);
    b.spr.scale.setScalar((b.glowScale || b.r * 4.2) * (1 + w * .06));
  }
}

export function onBarkReady(cb) {
  if (barkLoaded) cb();
  else barkReadyCbs.push(cb);
}

/* 共享树皮材质（古树根等复用同一套扫描贴图与乘色） */
function getBarkMat() { return barkMat; }

/* ---------- P0 冠层补全：装饰小枝 + 实例化叶片 ----------
   task 模式的骨架只有任务枝、没有叶子，视觉上像光杆。这里在骨架之上补一层
   “非任务”的冠层：沿枝段撒绿色叶片、在侧枝中后段生细枝。冠层不进入
   pickMeshes（不改变任务拾取），只负责树冠体量与剪影；三态标记仍是唯一状态语言。 */
let _leafMat = null, _leafTex = null;
function makeLeafTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  /* 白灰叶形 + 叶脉：颜色交给实例色，避免贴图与实例色双重染色 */
  g.beginPath();
  g.moveTo(32, 3);
  g.bezierCurveTo(60, 18, 60, 46, 32, 61);
  g.bezierCurveTo(4, 46, 4, 18, 32, 3);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#d6d6d6');
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(110,110,110,.35)';
  g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(32, 57); g.stroke();
  g.lineWidth = .8;
  for (let i = 1; i <= 3; i++) {
    const y = 10 + i * 10;
    g.beginPath(); g.moveTo(32, y); g.lineTo(20, y + 5); g.stroke();
    g.beginPath(); g.moveTo(32, y); g.lineTo(44, y + 5); g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
}
function ensureLeafMat() {
  if (_leafMat) return _leafMat;
  _leafTex = makeLeafTexture();
  _leafMat = new THREE.MeshStandardMaterial({
    map: _leafTex, alphaTest: .45, side: THREE.DoubleSide,
    roughness: .9, metalness: 0, color: 0xffffff,
    emissive: new THREE.Color(0x061206).convertSRGBToLinear(), emissiveIntensity: .2,
  });
  _leafMat.userData.shared = true;
  return _leafMat;
}
/* 折叠叶：沿中脉做浅 V 折，不再用两片 90° 交叉平面——
   交叉叶近景会形成贯穿的 X 形自穿模；折叠叶有体积但不自交。 */
function makeFoldedLeafGeometry() {
  const w = .5, h = .5, fold = .34;
  const pos = [], uv = [], ind = [];
  const quad = (x0, x1) => {
    const base = pos.length / 3;
    [[x0, -h], [x1, -h], [x1, h], [x0, h]].forEach(([x, y]) => {
      pos.push(x, y, -Math.abs(x) * fold);
      uv.push(x + w, y + h);
    });
    ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  quad(-w, 0);
  quad(0, w);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(ind);
  geo.computeVertexNormals();
  return geo;
}
/* 标记净空：叶片中心离花/金叶/断口浆果太近就不生成，
   避免冠层叶片穿花、穿红点（净空半径由调用方按标记尺寸给） */
function canopyClear(pos, size, clear) {
  for (let i = 0; i < clear.length; i++) {
    const c = clear[i];
    const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
    const rr = (c.r || .15) + size * .5;
    if (dx * dx + dy * dy + dz * dz < rr * rr) return false;
  }
  return true;
}
function canopyRng(seed) {
  let s = (seed | 0) >>> 0 || 1;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const CANOPY_GREENS = [0x355c2c, 0x3f6a34, 0x4f7a3a, 0x5f8a42, 0x6f9a4e, 0x2f5228];
function buildCanopy(branches, opts) {
  if (!branches || !branches.length) return null;
  const rng = canopyRng((opts && opts.seed) || 1);
  const distant = !!(opts && opts.distant);
  const density = distant ? .85 : 1;
  const clear = (opts && opts.clear) || [];
  const twigs = [], leaves = [];
  const dummy = new THREE.Object3D();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(), perp = new THREE.Vector3(), dir = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let bi = 0; bi < branches.length; bi++) {
    const br = branches[bi], secs = br.sections;
    if (!secs || secs.length < 2) continue;
    const isTrunk = bi === 0;
    const baseT = isTrunk ? .55 : .30;
    const stride = isTrunk ? 2 : 1;
    for (let si = Math.floor((secs.length - 1) * baseT); si < secs.length; si += stride) {
      const sec = secs[si];
      up.set(0, 1, 0).applyEuler(sec.orientation).normalize();
      perp.set(1, 0, 0).cross(up);
      if (perp.lengthSq() < 1e-4) perp.set(0, 0, 1);
      perp.normalize();
      /* 叶片簇：非任务，仅给树冠体量 */
      if (rng() < density) {
        const nLeaf = distant
          ? (2 + (rng() < .5 ? 1 : 0))
          : (2 + (rng() < .55 ? 1 : 0) + (rng() < .35 ? 1 : 0));
        for (let li = 0; li < nLeaf; li++) {
          const az = rng() * Math.PI * 2;
          const size = (distant ? .13 : .11) + rng() * .08;
          const off = perp.clone().applyAxisAngle(up, az)
            .multiplyScalar(sec.radius * 1.15 + size * .55 + rng() * .05);
          const pos = sec.origin.clone().add(off);
          if (!canopyClear(pos, size, clear)) continue;
          leaves.push({
            pos: pos,
            rot: [(rng() - .5) * 1.5, rng() * Math.PI * 2, (rng() - .5) * 1.2],
            size: size,
            color: CANOPY_GREENS[Math.floor(rng() * CANOPY_GREENS.length)],
          });
        }
      }
      /* 装饰小枝：激活树多、远景树少量；主干不长 */
      if (!isTrunk && sec.radius > .012 &&
          si >= Math.floor(secs.length * .45) && rng() < (distant ? .12 : .33)) {
        dir.copy(perp).applyAxisAngle(up, rng() * Math.PI * 2)
          .multiplyScalar(.9).addScaledVector(up, .35);
        dir.y -= .12;
        dir.normalize();
        const len = (distant ? .13 : .16) + rng() * (distant ? .14 : .2);
        const rad = Math.max(.008, Math.min(sec.radius * .45, .034));
        twigs.push({ pos: sec.origin.clone().addScaledVector(dir, len * .5), dir: dir.clone(), len: len, rad: rad });
        /* 枝梢补几片叶 */
        const tip = sec.origin.clone().addScaledVector(dir, len);
        const tipLeaves = distant ? 2 : 3;
        for (let li = 0; li < tipLeaves; li++) {
          const size = .10 + rng() * .08;
          const off = perp.clone().applyAxisAngle(up, rng() * Math.PI * 2)
            .multiplyScalar(rad * 1.2 + size * .55 + rng() * .04)
            .addScaledVector(dir, rng() * .04);
          const pos = tip.clone().add(off);
          if (!canopyClear(pos, size, clear)) continue;
          leaves.push({
            pos: pos,
            rot: [(rng() - .5) * 1.5, rng() * Math.PI * 2, (rng() - .5) * 1.2],
            size: size,
            color: CANOPY_GREENS[Math.floor(rng() * CANOPY_GREENS.length)],
          });
        }
      }
    }
  }
  if (!twigs.length && !leaves.length) return null;
  const group = new THREE.Group();
  group.name = 'lxpCanopy';
  if (twigs.length) {
    const geo = new THREE.CylinderGeometry(.22, 1, 1, 5, 1);
    const cnt = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).fill(1), 3));
    const mesh = new THREE.InstancedMesh(geo, barkMat, twigs.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    twigs.forEach(function (t, i) {
      q.setFromUnitVectors(Y, t.dir);
      dummy.position.copy(t.pos);
      dummy.quaternion.copy(q);
      dummy.scale.set(t.rad, t.len, t.rad);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  if (leaves.length) {
    const geo = makeFoldedLeafGeometry();
    const mesh = new THREE.InstancedMesh(geo, ensureLeafMat(), leaves.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const col = new THREE.Color();
    leaves.forEach(function (l, i) {
      dummy.position.copy(l.pos);
      dummy.rotation.set(l.rot[0], l.rot[1], l.rot[2]);
      dummy.scale.set(l.size * 1.25, l.size, l.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, col.set(l.color).convertSRGBToLinear());
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

/**
 * @param {object} appRoot app 任务树根节点（children/title/hours/progress/assign*）
 * @param {number} seed 种子（任务模式下仅影响未来扩展）
 * @param {number} H 树高（世界单位）
 * @param {{x:number,y:number,z:number}} base 树基世界坐标
 * @param {{perBranch?:boolean,distant?:boolean,treeRoot?:object,onMesh?:Function}} opts
 */
export function buildEzTreeApp(appRoot, seed, H, base, opts = {}) {
  const task = toTask(appRoot);
  /* P1.5：完成子树不折叠（keep）——金叶只做完成标记，不吞掉已完成枝干 */
  const { spec, flags } = prepareSpec(task, { converge: 'keep' });
  if (flags.length) console.warn('[eztree] 结构违规（只翻译不判定）:', flags);

  const tree = new Tree(new TreeOptions());
  tree.options.task = spec;
  tree.options.seed = seed;

  const grp = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(base.x, base.y, base.z);
  grp.add(inner);


  /* taskId → app 节点（拾取回挂 / pos 回写） */
  const idToApp = new Map();
  (function walk(n) {
    idToApp.set(String(n.id), n);
    (n.children || []).forEach(walk);
  })(appRoot);

  /* 网格：激活树逐枝（可拾取），远景合并 */
  const meshes = [];
  if (opts.perBranch) {
    for (const { taskId, geometry } of tree.createBranchGeometries()) {
      const m = new THREE.Mesh(geometry, barkMat);
      m.userData.taskId = taskId;
      const nApp = idToApp.get(taskId.split('#')[0]) || null;
      m.userData.app = nApp;
      m.userData.node = nApp || (opts.treeRoot || appRoot); /* impl 机制 D 契约 */
      m.castShadow = true;
      inner.add(m);
      meshes.push(m);
      if (opts.onMesh) opts.onMesh(m);
    }
  } else {
    const geoms = tree.createGeometry();
    const m = new THREE.Mesh(geoms.branches, barkMat);
    m.castShadow = true;
    m.userData.node = opts.treeRoot || appRoot; /* 远景点树=整树级 */
    inner.add(m);
    meshes.push(m);
    if (opts.onMesh) opts.onMesh(m);
  }

  /* 装饰 + 缩放到目标树高 */
  const decorGroup = buildDecor(tree.taskDecor);
  /* 状态标记保持克制：冠层已经提供体量，花/红点只做状态提示 */
  decorGroup.traverse(function (o) { if (o.isSprite) o.scale.multiplyScalar(.95); });
  inner.add(decorGroup);
  inner.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(inner);
  const height = Math.max(0.001, box.max.y - box.min.y);
  const s = H / height;
  inner.scale.setScalar(s);
  /* 冠层在缩放后挂载：坐标仍是骨架原生单位，随 inner 一起缩放。
     标记净空：花/金叶/断口浆果周围不生成叶片，避免冠层穿模。 */
  const clear = [];
  (tree.taskDecor.markers || []).forEach(function (m) {
    clear.push({ x: m.origin.x, y: m.origin.y, z: m.origin.z, r: .16 });
  });
  (tree.taskDecor.golds || []).forEach(function (g) {
    clear.push({ x: g.origin.x, y: g.origin.y, z: g.origin.z, r: .17 });
  });
  (tree.taskDecor.caps || []).forEach(function (c) {
    clear.push({ x: c.origin.x, y: c.origin.y, z: c.origin.z, r: Math.max(.10, c.radius * 2.0) });
  });
  const canopy = buildCanopy(tree.skeleton.branches, {
    seed: seed, distant: !!opts.distant, clear: clear,
  });
  if (canopy) inner.add(canopy);

  /* beacons：断枝端盖 → 断梢红色浆果 + 柔光（grp 未缩放层，直接世界坐标） */
  const beacons = [];
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xD9483B });
  dotMat.toneMapped = false;
  const berryGeo = new THREE.SphereGeometry(1, 10, 8);
  const glowTex = makeGlowTexture();
  for (const c of tree.taskDecor.caps) {
    const p = new THREE.Vector3(c.origin.x, c.origin.y, c.origin.z)
      .multiplyScalar(s).add(new THREE.Vector3(base.x, base.y, base.z));
    const r = Math.max(1.0, c.radius * s * 1.7);
    /* 浆果稍微探出断口，避免与切面/枝端穿模 */
    const up = new THREE.Vector3(0, 1, 0).applyEuler(c.orientation).normalize();
    const pOut = p.clone().addScaledVector(up, r * .3);
    /* 一簇 3 颗小浆果，比单颗红球更像“断口上的果/芽” */
    const core = new THREE.Group();
    const berry = (sc, dx, dy, dz) => {
      const m = new THREE.Mesh(berryGeo, dotMat);
      m.scale.setScalar(r * sc);
      m.position.set(dx, dy, dz);
      core.add(m);
    };
    berry(.55, 0, 0, 0);
    berry(.30, r * .42, r * .14, -r * .22);
    berry(.22, -r * .36, r * .20, r * .18);
    core.position.copy(pOut);
    grp.add(core);
    const glowScale = r * 4.2;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xFF6A4A, transparent: true, opacity: .3,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    spr.position.copy(pOut);
    spr.scale.setScalar(glowScale);
    grp.add(spr);
    beacons.push({ core, spr, r, glowScale, op: .3, ph: (pOut.x * .13 + pOut.z * .17) % 6.283 });
    ezBeacons.push(beacons[beacons.length - 1]);
  }

  /* pos 回写（非远景）：拾取 / 相机聚焦 / 星球 / 大纲的锚点来源 */
  if (!opts.distant) {
    for (const b of tree.skeleton.branches) {
      const node = idToApp.get(b.taskId.split('#')[0]);
      if (node && !node.pos) {
        const last = b.sections[b.sections.length - 1].origin;
        node.pos = new THREE.Vector3(base.x + last.x * s, base.y + last.y * s, base.z + last.z * s);
      }
    }
  }

  return {
    grp, _beacons: beacons, meshes, barkMat,
    spec, skeleton: tree.skeleton, decor: tree.taskDecor,
    appRoot: opts.treeRoot || appRoot,
  };
}
