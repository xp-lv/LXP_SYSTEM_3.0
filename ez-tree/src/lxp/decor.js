/* lxp 形态层（阶段三）：装饰锚点 → 网格
   - 断口端盖：平齐浅木切面（CircleGeometry 平面 + 年轮贴图），绝不外凸（规格§2 断口礼仪）
   - 物候 markers（三态语言 v3）：粉花苞（就绪待排期）/开放粉花（已排期）/
     小金团（单叶完成）；断枝红光由宿主 eztree.js 挂在端盖上（此处不管）
   - 金叶团：辉光 + 金叶 sprite 聚合（大小∝√工时，黄金角散布，确定性）
   仅浏览器环境（document）；锚点数据来自 tasktree 的 decor 输出，形态只供锚点、不做状态判定。 */

import * as THREE from 'three';

const CAP_WOOD = '#d9c9ae';

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
    bud: makeTexture(g => {                       // 粉花苞：闭合粉色滴形 + 中缝 + 淡绿花萼
      const gr = g.createRadialGradient(29, 25, 3, 32, 33, 22);
      gr.addColorStop(0, '#ffd6e4'); gr.addColorStop(1, '#e57cab');
      g.fillStyle = gr; g.beginPath(); g.ellipse(32, 31, 11, 17, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(205,90,130,.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(32, 15); g.lineTo(32, 46); g.stroke();
      g.fillStyle = '#86b060'; g.beginPath(); g.ellipse(32, 47, 8, 6, 0, 0, 7); g.fill();
    }),
    flower: makeTexture(g => {                    // 花：五瓣粉白 + 金芯
      g.fillStyle = '#f6b9d2';
      for (let k = 0; k < 5; k++) {
        g.save(); g.translate(32, 34); g.rotate(k * Math.PI * 2 / 5);
        g.beginPath(); g.ellipse(0, -13, 8, 14, 0, 0, 7); g.fill(); g.restore();
      }
      g.fillStyle = '#fff3d6'; g.beginPath(); g.arc(32, 34, 6.5, 0, 7); g.fill();
    }),
    gold: makeTexture(g => {                      // 金叶：旋转金椭圆 + 叶脉
      const gr = g.createRadialGradient(32, 30, 3, 32, 34, 20);
      gr.addColorStop(0, '#ffe98a'); gr.addColorStop(1, '#d99a12');
      g.fillStyle = gr; g.save(); g.translate(32, 34); g.rotate(0.5);
      g.beginPath(); g.ellipse(0, 0, 9, 17, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(160,100,0,.5)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -15); g.lineTo(0, 15); g.stroke(); g.restore();
    }),
    glow: makeTexture(g => {                      // 金团辉光
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,224,110,.95)');
      gr.addColorStop(0.5, 'rgba(250,196,60,.45)');
      gr.addColorStop(1, 'rgba(250,196,60,0)');
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

  const sprite = (tex, pos, s) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      toneMapped: false, // 宿主用 ACES 色调映射时保持 v2 的鲜艳度
    }));
    m.position.copy(pos);
    m.scale.setScalar(s);
    group.add(m);
    return m;
  };

  /* 物候 markers（三态 v3）：粉花苞/开放粉花（尺寸∝√工时，散布确定性）；
     gold=单叶完成的小金团（辉光+金叶聚合，收敛分叉的大金团在下方 golds 段） */
  for (const mk of decor.markers) {
    const jitter = hashOf(mk.origin.x, mk.origin.y, mk.origin.z);
    if (mk.type === 'gold') {
      const size = 0.26 + 0.1 * Math.sqrt(mk.h);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.glow, transparent: true, depthWrite: false, opacity: 0.8,
        toneMapped: false }));
      glow.position.copy(mk.origin);
      glow.scale.setScalar(size * 1.7);
      group.add(glow);
      for (let i = 0; i < 4; i++) {
        const a = i * 2.39996 + jitter * 6.28;
        const rr = size * (0.18 + 0.3 * ((i * 0.618) % 1));
        sprite(TEX.gold,
          new THREE.Vector3(
            mk.origin.x + Math.cos(a) * rr,
            mk.origin.y + ((i * 0.37 + jitter) % 1 - 0.5) * size * 0.9,
            mk.origin.z + Math.sin(a) * rr),
          size * (0.5 + 0.28 * ((i * 0.777) % 1)));
      }
      continue;
    }
    sprite(TEX[mk.type] ?? TEX.bud, mk.origin, 0.22 + 0.07 * Math.sqrt(mk.h) + 0.03 * jitter);
  }

  /* 金叶团：辉光 + 金叶聚合（大小∝√完成工时，黄金角散布） */
  for (const gd of decor.golds) {
    const size = Math.min(1.6, 0.3 + 0.16 * Math.sqrt(gd.hours));
    const count = Math.min(18, 6 + Math.round(Math.sqrt(gd.hours) * 1.6));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, transparent: true, depthWrite: false, opacity: 0.85,
      toneMapped: false }));
    glow.position.copy(gd.origin);
    glow.scale.setScalar(size * 1.5);
    group.add(glow);
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996 + hashOf(gd.origin.x, gd.origin.y, gd.origin.z) * 6.28;
      const rr = size * (0.15 + 0.45 * ((i * 0.618) % 1));
      sprite(TEX.gold,
        new THREE.Vector3(
          gd.origin.x + Math.cos(a) * rr,
          gd.origin.y + ((i * 0.37 + hashOf(gd.origin.z, gd.origin.x, gd.origin.y)) % 1 - 0.5) * size,
          gd.origin.z + Math.sin(a) * rr),
        size * (0.4 + 0.35 * ((i * 0.777) % 1)));
    }
  }

  /* 断口端盖：平齐浅木切面（面片法向对齐枝轴，微抬 1mm 防 z-fight） */
  const capTex = makeTexture(g => {
    g.fillStyle = CAP_WOOD;
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(120,98,70,.4)';
    g.lineWidth = 2.4;
    for (let r = 26; r > 3; r -= 5) { g.beginPath(); g.arc(32, 32, r, 0, 7); g.stroke(); }
  });
  const capMat = new THREE.MeshStandardMaterial({ map: capTex, roughness: 1 });
  const capGeoCache = new Map();
  for (const c of decor.caps) {
    const r = c.radius * 1.02;
    const key = r.toFixed(3);
    if (!capGeoCache.has(key)) {
      capGeoCache.set(key, new THREE.CircleGeometry(r, 14));
    }
    const m = new THREE.Mesh(capGeoCache.get(key), capMat);
    const up = new THREE.Vector3(0, 1, 0).applyEuler(c.orientation).normalize();
    m.position.copy(c.origin).addScaledVector(up, 0.001);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    group.add(m);
  }

  return group;
}
