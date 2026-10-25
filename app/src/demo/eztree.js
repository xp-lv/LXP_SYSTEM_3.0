/* app 建造器（阶段四）：app 任务树 → lxp adapter → ez-tree（options.task 挂钩）→ 网格+装饰
   对外与 demo/goal.js 的 buildGoalTree 同构子集：{ grp, _beacons, appRoot, spec, meshes }
   - 数据映射（镜像 goal.js cfgFromApp 语义）：内节点→ch；叶子已完成/已排期→单日末梢 days；
     其余未完成叶→断枝 est
   - 尺寸：骨架原生 ~5-6 单位，按 H（岛高比例）整体缩放
   - perBranch：逐枝网格（激活树，可按节点拾取，mesh.userData.app 回挂 app 节点）；
     distant：整树合并单网格
   - beacons：断枝端盖→断梢红光（世界坐标，小地图/夜景）；pos 回写供拾取/聚焦/星球/大纲
   三态语言 v4（《02.4》红光/粉花/金叶团——与大纲"断梢/细枝"口径 1:1）：
   开放粉花 = 已排期到周/日（assignD/W，进入执行轨道）；
   红光 = 其余未完成叶（断枝短桩+呼吸灯）——含未分解与**仅月度分配**（assignM 未落到周/日
   =未分解到位，不算排期）；金叶团 = 已完成（叶完成小金团，分叉全完成大金团） */

import THREE from '../three.js';
import { prepareSpec } from '../../../ez-tree/src/lxp/adapter.js';
import { buildDecor } from '../../../ez-tree/src/lxp/decor.js';
import { Tree } from '../../../ez-tree/src/lib/tree.js';
import TreeOptions from '../../../ez-tree/src/lib/options.js';

function toTask(n) {
  const name = n.title || n.name;
  const id = String(n.id);
  if (n.children && n.children.length) {
    return { id, name, est: n.hours, ch: n.children.map(toTask) };
  }
  const done = (n.progress || 0) >= 1;
  const planned = !!(n.assignD || n.assignW);   /* 周/日=执行轨道；assignM 不算（未分解到位） */
  const h = Math.max(1, n.hours || 2);
  if (done || planned) {
    return { id, name, est: h, days: [{ n: name, h, w: n.assignW ? 'week' : 'next', done }] };
  }
  return { id, name, est: h };
}

function makeGlowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,90,60,.95)');
  gr.addColorStop(0.5, 'rgba(255,68,38,.45)');
  gr.addColorStop(1, 'rgba(255,68,38,0)');
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
    const w = Math.sin(tG * 2.2 + b.ph);
    b.core.scale.setScalar(1 + w * .12);
    b.spr.material.opacity = b.op * (.78 + .22 * w);
    b.spr.scale.setScalar(b.r * 7.5 * (1 + w * .16));
  }
}

export function onBarkReady(cb) {
  if (barkLoaded) cb();
  else barkReadyCbs.push(cb);
}

/* 共享树皮材质（古树根等复用同一套扫描贴图与乘色） */
function getBarkMat() { return barkMat; }

/**
 * @param {object} appRoot app 任务树根节点（children/title/hours/progress/assign*）
 * @param {number} seed 种子（任务模式下仅影响未来扩展）
 * @param {number} H 树高（世界单位）
 * @param {{x:number,y:number,z:number}} base 树基世界坐标
 * @param {{perBranch?:boolean,distant?:boolean,treeRoot?:object,onMesh?:Function}} opts
 */
export function buildEzTreeApp(appRoot, seed, H, base, opts = {}) {
  const task = toTask(appRoot);
  const { spec, flags } = prepareSpec(task);
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
  inner.add(buildDecor(tree.taskDecor));
  inner.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(inner);
  const height = Math.max(0.001, box.max.y - box.min.y);
  const s = H / height;
  inner.scale.setScalar(s);

  /* beacons：断枝端盖 → 断梢红光（grp 未缩放层，直接世界坐标） */
  const beacons = [];
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xFF3B2A });
  dotMat.toneMapped = false;
  const glowTex = makeGlowTexture();
  for (const c of tree.taskDecor.caps) {
    const p = new THREE.Vector3(c.origin.x, c.origin.y, c.origin.z)
      .multiplyScalar(s).add(new THREE.Vector3(base.x, base.y, base.z));
    const r = Math.max(1.2, c.radius * s * 2.2);
    const core = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), dotMat);
    core.position.copy(p);
    grp.add(core);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xFF4426, transparent: true, opacity: .5,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    spr.position.copy(p);
    spr.scale.setScalar(r * 7.5);
    grp.add(spr);
    beacons.push({ core, spr, r, op: .5, ph: (p.x * .13 + p.z * .17) % 6.283 });
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
