/* lxp 形态层（阶段三）：装饰锚点 → 网格
   - 断口端盖：平齐浅木切面（CircleGeometry 平面 + 年轮贴图），绝不外凸（规格§2 断口礼仪）
   - 物候 markers（三态语言 v3）：粉花苞（就绪待排期）/开放粉花（已排期）/
     小金团（单叶完成）；断枝红光由宿主 eztree.js 挂在端盖上（此处不管）
   - 金叶团：辉光 + 金叶 sprite 聚合（大小∝√工时，黄金角散布，确定性）
   仅浏览器环境（document）；锚点数据来自 tasktree 的 decor 输出，形态只供锚点、不做状态判定。 */

import * as THREE from 'three';

const CAP_WOOD = '#c6ad86';

function makeTexture(draw) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  draw(cv.getContext('2d'));
  return new THREE.CanvasTexture(cv);
}

let _TEX = null;
function textures() {
  if (_TEX) return _TEX;
  _TEX = {
    bud: makeTexture(g => {                       // 花苞：闭合粉色滴形 + 中缝 + 淡绿花萼
      const gr = g.createRadialGradient(29, 24, 2, 32, 34, 22);
      gr.addColorStop(0, '#ffe6ee'); gr.addColorStop(.55, '#f4b3cb'); gr.addColorStop(1, '#d977a2');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(32, 31, 10.5, 17, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(190,95,135,.35)'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(32, 16); g.lineTo(32, 45); g.stroke();
      const cal = g.createLinearGradient(0, 42, 0, 55);
      cal.addColorStop(0, '#9cc472'); cal.addColorStop(1, '#6f9a4e');
      g.fillStyle = cal;
      g.beginPath(); g.ellipse(32, 48, 7.5, 6, 0, 0, 7); g.fill();
    }),
    flower: makeTexture(g => {                    // 开放花：五瓣柔光 + 金蕊
      const aura = g.createRadialGradient(32, 32, 3, 32, 32, 31);
      aura.addColorStop(0, 'rgba(255,224,236,.42)');
      aura.addColorStop(.55, 'rgba(255,200,222,.12)');
      aura.addColorStop(1, 'rgba(255,200,222,0)');
      g.fillStyle = aura; g.beginPath(); g.arc(32, 32, 31, 0, 7); g.fill();
      for (let k = 0; k < 5; k++) {
        g.save(); g.translate(32, 34); g.rotate(k * Math.PI * 2 / 5);
        const pg = g.createLinearGradient(0, -4, 0, -25);
        pg.addColorStop(0, '#fff4f8');
        pg.addColorStop(.55, '#f7c4d8');
        pg.addColorStop(1, '#e58bb2');
        g.fillStyle = pg;
        g.beginPath();
        g.moveTo(0, -3);
        g.bezierCurveTo(9, -10, 12, -21, 0, -26);
        g.bezierCurveTo(-12, -21, -9, -10, 0, -3);
        g.fill();
        g.strokeStyle = 'rgba(198,110,148,.22)'; g.lineWidth = .8;
        g.beginPath(); g.moveTo(0, -6); g.lineTo(0, -23); g.stroke();
        g.restore();
      }
      const cg = g.createRadialGradient(32, 33, 1, 32, 33, 7);
      cg.addColorStop(0, '#fff8d8'); cg.addColorStop(.55, '#f7d874'); cg.addColorStop(1, '#e5b544');
      g.fillStyle = cg; g.beginPath(); g.arc(32, 33, 6, 0, 7); g.fill();
      g.fillStyle = 'rgba(160,105,22,.5)';
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3;
        g.beginPath(); g.arc(32 + Math.cos(a) * 3.1, 33 + Math.sin(a) * 3.1, .65, 0, 7); g.fill();
      }
    }),
    gold: makeTexture(g => {                      // 金叶：尖叶形 + 叶脉
      const gr = g.createLinearGradient(0, 2, 0, 62);
      gr.addColorStop(0, '#fff4b8');
      gr.addColorStop(.45, '#f6cb55');
      gr.addColorStop(1, '#cf8f18');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(32, 3);
      g.bezierCurveTo(54, 16, 52, 44, 32, 61);
      g.bezierCurveTo(12, 44, 10, 16, 32, 3);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(150,95,10,.32)'; g.lineWidth = 1;
      g.stroke();
      g.strokeStyle = 'rgba(120,70,0,.32)'; g.lineWidth = 1.1;
      g.beginPath(); g.moveTo(32, 7); g.lineTo(32, 57); g.stroke();
      g.lineWidth = .7;
      for (let i = 1; i <= 3; i++) {
        const y = 12 + i * 10;
        g.beginPath(); g.moveTo(32, y); g.lineTo(22, y + 6); g.stroke();
        g.beginPath(); g.moveTo(32, y); g.lineTo(42, y + 6); g.stroke();
      }
    }),
    glow: makeTexture(g => {                      // 金团辉光：更收敛的柔光
      const gr = g.createRadialGradient(32, 32, 1, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,239,175,.82)');
      gr.addColorStop(.35, 'rgba(250,204,90,.3)');
      gr.addColorStop(1, 'rgba(240,170,40,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill();
    }),
  };
  return _TEX;
}

const hashOf = (x, y, z) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * @param {{caps: object[], golds: object[], markers: object[]}} decor buildSkeleton 的装饰锚点
 * @returns {THREE.Group}
 */
export function buildDecor(decor) {
  const group = new THREE.Group();
  group.name = 'lxpDecor';
  const TEX = textures();

  const sprite = (tex, pos, s, opacity, color) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      toneMapped: false, // 宿主用 ACES 色调映射时保持 v2 的鲜艳度
      opacity: opacity != null ? opacity : 1,
      color: color != null ? color : 0xffffff,
    }));
    m.position.copy(pos);
    m.scale.setScalar(s);
    group.add(m);
    return m;
  };

  /* 物候 markers（三态 v3）：粉花/花苞/小金叶簇；
     gold=单叶完成的小金叶团（辉光+金叶聚合，收敛分叉的大金团在下方 golds 段） */
  for (const mk of decor.markers) {
    const jitter = hashOf(mk.origin.x, mk.origin.y, mk.origin.z);
    if (mk.type === 'gold') {
      const size = 0.15 + 0.045 * Math.sqrt(mk.h);
      sprite(TEX.glow, mk.origin, size * 1.45, 0.18);
      const count = 5 + Math.round(Math.min(4, Math.sqrt(mk.h)));
      for (let i = 0; i < count; i++) {
        const a = i * 2.39996 + jitter * 6.28;
        const rr = size * (0.10 + 0.32 * ((i * 0.618) % 1));
        sprite(TEX.gold,
          new THREE.Vector3(
            mk.origin.x + Math.cos(a) * rr,
            mk.origin.y + ((i * 0.37 + jitter) % 1 - 0.5) * size * 0.75,
            mk.origin.z + Math.sin(a) * rr),
          size * (0.38 + 0.26 * ((i * 0.777) % 1)), 0.95,
          i % 3 === 0 ? 0xFFF0C0 : (i % 3 === 1 ? 0xFFFFFF : 0xFFE2A0));
      }
      continue;
    }
    const isFlower = mk.type === 'flower';
    const base = (isFlower ? 0.13 : 0.10) + (isFlower ? 0.035 : 0.025) * Math.sqrt(mk.h);
    sprite(TEX[mk.type] ?? TEX.bud, mk.origin, base);
    /* 小花簇：主花 + 一朵更小的花/花苞，避免单张大花“贴纸感” */
    const n = isFlower ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const a = jitter * 6.28 + (i + 1) * 2.39996;
      const rr = base * (0.55 + 0.25 * ((i * 0.618) % 1));
      const pos = new THREE.Vector3(
        mk.origin.x + Math.cos(a) * rr,
        mk.origin.y + (i === 0 ? 0.05 : -0.035) * base,
        mk.origin.z + Math.sin(a) * rr);
      sprite(i === 0 && isFlower ? TEX.flower : TEX.bud, pos,
        base * (0.42 + 0.16 * ((i * 0.777) % 1)), 0.9);
    }
  }

  /* 金叶团：辉光 + 金叶聚合（大小∝√完成工时，黄金角散布） */
  for (const gd of decor.golds) {
    const size = Math.min(1.15, 0.22 + 0.12 * Math.sqrt(gd.hours));
    const count = Math.min(16, 6 + Math.round(Math.sqrt(gd.hours) * 1.3));
    sprite(TEX.glow, gd.origin, size * 1.35, 0.18);
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996 + hashOf(gd.origin.x, gd.origin.y, gd.origin.z) * 6.28;
      const rr = size * (0.08 + 0.36 * ((i * 0.618) % 1));
      sprite(TEX.gold,
        new THREE.Vector3(
          gd.origin.x + Math.cos(a) * rr,
          gd.origin.y + ((i * 0.37 + hashOf(gd.origin.z, gd.origin.x, gd.origin.y)) % 1 - 0.5) * size,
          gd.origin.z + Math.sin(a) * rr),
        size * (0.26 + 0.22 * ((i * 0.777) % 1)), 0.95,
        i % 3 === 0 ? 0xFFF0C0 : (i % 3 === 1 ? 0xFFFFFF : 0xFFE2A0));
    }
  }

  /* 断口端盖：平齐浅木切面（面片法向对齐枝轴，微抬 1mm 防 z-fight） */
  const capTex = makeTexture(g => {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, '#d8c3a2');
    gr.addColorStop(.65, CAP_WOOD);
    gr.addColorStop(1, '#a98a62');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(95,72,48,.28)';
    g.lineWidth = 1.4;
    for (let r = 27; r > 3; r -= 4) { g.beginPath(); g.arc(32, 32, r, 0, 7); g.stroke(); }
  });
  const capMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 1 });
  const capGeoCache = new Map();
  for (const c of decor.caps) {
    const r = c.radius * 1.02;
    const key = r.toFixed(3);
    if (!capGeoCache.has(key)) {
      capGeoCache.set(key, new THREE.CircleGeometry(r, 18));
    }
    const m = new THREE.Mesh(capGeoCache.get(key), capMat);
    const up = new THREE.Vector3(0, 1, 0).applyEuler(c.orientation).normalize();
    m.position.copy(c.origin).addScaledVector(up, 0.001);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    group.add(m);
  }

  return group;
}
