import THREE from '../three.js';

/* ================= Floating island scenery (ported from demo) =================
   静态造景：主浮岛 + 小卫星岛 + 草/花/石/根/藤/泉水/瀑布 + 云海 + 鸟。
   不含装饰树；任务树仍由 app 的 ez-tree 管线种植。
   天空、昼夜、夕阳、星星仍由 app 的 demo/env.js 负责。
   R0 为世界岛半径；demo 原岛半径 21.5，构建后整体等比缩放。
   ===================================================================== */

const ACTIVE_BODIES = [];

export function stepFloatingIslands(elapsed) {
  for (let i = 0; i < ACTIVE_BODIES.length; i++) ACTIVE_BODIES[i].step(elapsed);
}

export function setFloatingIslandEnv(ambC, ambI) {
  for (let i = 0; i < ACTIVE_BODIES.length; i++) {
    if (ACTIVE_BODIES[i].applyEnv) ACTIVE_BODIES[i].applyEnv(ambC, ambI);
  }
}

export function buildFloatingIslandBody(opts = {}) {
  const R0 = opts.R0 || 880;
  const SCALE = R0 / 21.5;
  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  const scene = root;
  const mainGroup = new THREE.Group();
  scene.add(mainGroup);
  const maxAniso = 8;
  const includeMini = opts.includeMini !== false;
  const includeClouds = opts.includeClouds !== false;
  const includeBirds = opts.includeBirds !== false;
  const flattenLocal = opts.flattenLocal || [];


    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const smoothstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const angDiff = (a, b) => {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };

    let rngState = 20261023;
    const rand = () => {
      rngState = (rngState * 1664525 + 1013904223) >>> 0;
      return rngState / 4294967296;
    };
    const randRange = (a, b) => a + (b - a) * rand();

    const hash2 = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return s - Math.floor(s);
    };
    const noise2 = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      const a = hash2(xi, yi), b = hash2(xi + 1, yi);
      const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
    const fbm = (x, y, octaves = 4) => {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += amp * noise2(x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2.03;
      }
      return sum / norm;
    };
    const ridge = (x, y, octaves = 4) => {
      let amp = 0.5, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(noise2(x * freq, y * freq) * 2 - 1);
        n *= n;
        sum += amp * n;
        norm += amp;
        amp *= 0.52;
        freq *= 2.05;
      }
      return sum / norm;
    };

    // ---------- Procedural detail textures ----------

    function canvasTexture(size, painter, srgb = true) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      painter(ctx, size);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding;
      texture.anisotropy = maxAniso;
      return texture;
    }

    const grassTexture = canvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#eef1e8';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 130; i++) {
        const x = rand() * size, y = rand() * size, r = 16 + rand() * 76;
        const dark = rand() > 0.5;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? 'rgba(92,102,80,0.09)' : 'rgba(255,255,255,0.14)');
        g.addColorStop(1, dark ? 'rgba(92,102,80,0)' : 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.lineCap = 'round';
      for (let i = 0; i < 9500; i++) {
        const x = rand() * size, y = rand() * size;
        const len = 2 + rand() * 8;
        const ang = -Math.PI / 2 + (rand() - 0.5) * 0.85;
        const shade = 76 + Math.floor(rand() * 138);
        ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.1 + rand() * 0.3})`;
        ctx.lineWidth = 0.45 + rand() * 0.8;
        const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
        const draw = (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + dx, py + dy);
          ctx.stroke();
        };
        draw(x, y);
        if (x < 12) draw(x + size, y); else if (x > size - 12) draw(x - size, y);
        if (y < 12) draw(x, y + size); else if (y > size - 12) draw(x, y - size);
      }
      for (let i = 0; i < 800; i++) {
        const x = rand() * size, y = rand() * size, r = 0.6 + rand() * 1.4;
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(64,74,58,0.16)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const snowTexture = canvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#f2f7fc';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 90; i++) {
        const x = rand() * size, y = rand() * size, r = 8 + rand() * 46;
        const dark = rand() > 0.4;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? 'rgba(166,189,212,0.2)' : 'rgba(255,255,255,0.35)');
        g.addColorStop(1, dark ? 'rgba(166,189,212,0)' : 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let i = 0; i < 220; i++) {
        const x = rand() * size, y = rand() * size;
        const len = 5 + rand() * 36;
        ctx.strokeStyle = `rgba(148,171,195,${0.04 + rand() * 0.12})`;
        ctx.lineWidth = 0.5 + rand() * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 10, y + len);
        ctx.stroke();
      }
      for (let i = 0; i < 420; i++) {
        const x = rand() * size, y = rand() * size, r = 0.4 + rand() * 1.3;
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const rockTexture = canvasTexture(512, (ctx, size) => {
      ctx.fillStyle = '#cecece';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 170; i++) {
        const x = rand() * size, y = rand() * size, r = 7 + rand() * 46;
        const dark = rand() > 0.45;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, dark ? 'rgba(62,62,62,0.13)' : 'rgba(255,255,255,0.14)');
        g.addColorStop(1, dark ? 'rgba(62,62,62,0)' : 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (let y = 0; y < size; y += 5 + rand() * 15) {
        const shade = 105 + Math.floor(rand() * 95);
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.05 + rand() * 0.16})`;
        ctx.fillRect(0, y, size, 1 + rand() * 6);
      }
      for (let i = 0; i < 38; i++) {
        let x = rand() * size, y = rand() * size;
        ctx.strokeStyle = `rgba(42,42,42,${0.18 + rand() * 0.34})`;
        ctx.lineWidth = 0.8 + rand() * 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let k = 0; k < 12; k++) {
          x += (rand() - 0.5) * 18;
          y += 8 + rand() * 18;
          if (y > size) break;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 2400; i++) {
        const x = rand() * size, y = rand() * size, r = 0.5 + rand() * 1.6;
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.26)' : 'rgba(52,52,52,0.2)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    const barkTexture = canvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#dedede';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 950; i++) {
        const x = rand() * size, y = rand() * size;
        const len = 6 + rand() * 38;
        const shade = 72 + Math.floor(rand() * 110);
        ctx.strokeStyle = `rgba(${shade},${shade},${shade},${0.08 + rand() * 0.22})`;
        ctx.lineWidth = 0.8 + rand() * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 5, y + len);
        ctx.stroke();
      }
      for (let i = 0; i < 40; i++) {
        const x = rand() * size, y = rand() * size;
        ctx.fillStyle = `rgba(55,55,55,${0.18 + rand() * 0.25})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 1.2 + rand() * 2.4, 0.6 + rand() * 1.2, rand() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    barkTexture.repeat.set(2, 2);

    const leafTexture = canvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#edf2e6';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 900; i++) {
        const x = rand() * size, y = rand() * size;
        const r = 1.4 + rand() * 5;
        const shade = 66 + Math.floor(rand() * 128);
        ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.08 + rand() * 0.2})`;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.6, r, rand() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 160; i++) {
        const x = rand() * size, y = rand() * size, r = 0.8 + rand() * 2;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    leafTexture.repeat.set(1.6, 1.6);

    function makeWaterNormalTexture(size) {
      const height = new Float32Array(size * size);
      const waves = [
        [2, 1, 0.55, 0.0], [4, -3, 0.32, 1.7], [7, 5, 0.22, 4.1],
        [-5, 8, 0.16, 2.6], [9, -6, 0.12, 0.8], [13, 3, 0.08, 5.3]
      ];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let v = 0;
          for (let w = 0; w < waves.length; w++) {
            const kx = waves[w][0], ky = waves[w][1];
            v += waves[w][2] * Math.sin((x / size) * Math.PI * 2 * kx + (y / size) * Math.PI * 2 * ky + waves[w][3]);
          }
          height[x + y * size] = v;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(size, size);
      const strength = 2.4;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const xl = (x - 1 + size) % size, xr = (x + 1) % size;
          const yd = (y - 1 + size) % size, yu = (y + 1) % size;
          const dx = height[xr + y * size] - height[xl + y * size];
          const dy = height[x + yu * size] - height[x + yd * size];
          let nx = -dx * strength, ny = -dy * strength, nz = 1;
          const len = Math.hypot(nx, ny, nz);
          nx /= len; ny /= len; nz /= len;
          const i = (x + y * size) * 4;
          image.data[i] = (nx * 0.5 + 0.5) * 255;
          image.data[i + 1] = (ny * 0.5 + 0.5) * 255;
          image.data[i + 2] = (nz * 0.5 + 0.5) * 255;
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.encoding = THREE.LinearEncoding;
      texture.anisotropy = maxAniso;
      texture.repeat.set(3, 10);
      return texture;
    }
    const waterNormalTexture = makeWaterNormalTexture(256);

    const waterFoamTexture = canvasTexture(256, (ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < 850; i++) {
        const x = rand() * size, y = rand() * size;
        const len = 3 + rand() * 18;
        ctx.strokeStyle = `rgba(255,255,255,${0.1 + rand() * 0.34})`;
        ctx.lineWidth = 0.8 + rand() * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 3, y + len);
        ctx.stroke();
      }
      for (let i = 0; i < 180; i++) {
        const x = rand() * size, y = rand() * size, r = 0.4 + rand() * 1.2;
        ctx.fillStyle = `rgba(255,255,255,${0.12 + rand() * 0.24})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    waterFoamTexture.repeat.set(1, 4);

    const contactShadowTexture = canvasTexture(128, (ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(10,18,8,0.6)');
      g.addColorStop(0.5, 'rgba(10,18,8,0.28)');
      g.addColorStop(1, 'rgba(10,18,8,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    });
    contactShadowTexture.wrapS = contactShadowTexture.wrapT = THREE.ClampToEdgeWrapping;

    const terrainNormalTexture = canvasTexture(256, (ctx, size) => {
      const periodic = (x, y, period) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf);
        const v = yf * yf * (3 - 2 * yf);
        const wrap = (n) => ((n % period) + period) % period;
        const a = hash2(wrap(xi), wrap(yi));
        const b = hash2(wrap(xi + 1), wrap(yi));
        const c = hash2(wrap(xi), wrap(yi + 1));
        const d = hash2(wrap(xi + 1), wrap(yi + 1));
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      };
      const octaves = [[4, 0.5], [8, 0.25], [16, 0.15], [32, 0.1]];
      const height = new Float32Array(size * size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let v = 0;
          for (let o = 0; o < octaves.length; o++) {
            const p = octaves[o][0];
            v += octaves[o][1] * periodic((x / size) * p, (y / size) * p, p);
          }
          height[x + y * size] = v;
        }
      }
      const image = ctx.createImageData(size, size);
      const strength = 3.2;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const xl = (x - 1 + size) % size, xr = (x + 1) % size;
          const yd = (y - 1 + size) % size, yu = (y + 1) % size;
          const dx = height[xr + y * size] - height[xl + y * size];
          const dy = height[x + yu * size] - height[x + yd * size];
          let nx = -dx * strength, ny = -dy * strength, nz = 1;
          const len = Math.hypot(nx, ny, nz);
          nx /= len; ny /= len; nz /= len;
          const i = (x + y * size) * 4;
          image.data[i] = (nx * 0.5 + 0.5) * 255;
          image.data[i + 1] = (ny * 0.5 + 0.5) * 255;
          image.data[i + 2] = (nz * 0.5 + 0.5) * 255;
          image.data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }, false);

    // ---------- Island shape ----------
    const SEG = 320;
    const RINGS = 120;
    const CLIFF_LEVELS = 30;
    const DEPTH = 27;
    const RIVER_END_THETA = 0.9;

    function rimRadius(theta) {
      return 21.5 * (1
        + 0.075 * Math.sin(2 * theta + 0.5)
        + 0.045 * Math.sin(3 * theta - 0.9)
        + 0.03 * Math.sin(5 * theta + 2.2)
        + 0.018 * Math.sin(7 * theta + 0.2));
    }

    function mountainHeight(x, z) {
      let h = 0;
      const peaks = [
        [-13.0, -7.5, 19.0, 8.8, 8.4, 1.38, 3.1],
        [-17.5, -4.0, 9.5, 6.6, 7.0, 1.5, 9.4],
        [-7.0, -10.0, 11.0, 6.2, 6.2, 1.6, 15.2],
        [-3.5, -15.0, 7.5, 6.8, 5.2, 1.7, 21.6],
        [-9.0, -13.0, 8.0, 4.8, 4.8, 1.85, 27.0]
      ];
      for (let i = 0; i < peaks.length; i++) {
        const p = peaks[i];
        const d = Math.hypot((x - p[0]) / p[3], (z - p[1]) / p[4]);
        if (d < 1) {
          const m = 1 - d;
          const large = ridge(x * 0.14 + p[6], z * 0.14 - p[6], 3);
          const fine = ridge(x * 0.45 - p[6], z * 0.45 + p[6], 4);
          const roughness = 0.4 + 0.62 * large + 0.5 * fine;
          h += p[2] * Math.pow(m, p[5]) * roughness;
        }
      }
      return h;
    }

    function hillGauss(x, z, cx, cz, sx, sz, amp) {
      return amp * Math.exp(-(Math.pow((x - cx) / sx, 2) + Math.pow((z - cz) / sz, 2)) * 1.7);
    }

    function baseHeight(x, z) {
      let h = 0.9 + (fbm(x * 0.07 + 5.2, z * 0.07 + 7.7, 4) - 0.5) * 2.6;
      h += 2.6 * Math.exp(-Math.pow((x - 9) / 10, 2) * 2 - Math.pow((z + 8) / 7, 2) * 2);
      h += 0.9 * Math.exp(-Math.pow((x - 16) / 8, 2) * 2 - Math.pow(z / 7, 2) * 2);

      // Higher foothill near the snow mountain: multiple lobes and a noisy crest.
      const bigHill = (
        hillGauss(x, z, 5.8, -5.2, 6.2, 5.2, 4.2) +
        hillGauss(x, z, 8.6, -1.4, 4.0, 3.6, 2.0) +
        hillGauss(x, z, 3.2, -8.2, 4.4, 3.8, 0.6)
      ) * (0.82 + 0.32 * fbm(x * 0.3 + 4.0, z * 0.3 - 6.0, 3));
      // Lower hill moved east, away from the river.
      const smallHill = (
        hillGauss(x, z, 16.8, 6.8, 4.2, 3.8, 3.0) +
        hillGauss(x, z, 18.4, 9.2, 3.4, 3.0, 1.5) +
        hillGauss(x, z, 14.8, 9.2, 3.0, 2.6, 1.1)
      ) * (0.82 + 0.3 * fbm(x * 0.34 - 2.0, z * 0.34 + 5.0, 2));
      // A third, smaller hill between the big hill and the snow mountain,
      // pushed toward the back edge of the island.
      const edgeHill = (
        hillGauss(x, z, 1.2, -10.2, 3.4, 3.1, 4.2) +
        hillGauss(x, z, 4.2, -11.8, 3.0, 2.6, 1.4) +
        hillGauss(x, z, -2.2, -8.6, 3.0, 2.6, 0.9)
      ) * (0.8 + 0.3 * fbm(x * 0.36 + 7.0, z * 0.36 - 3.0, 2));
      const hillMass = bigHill + smallHill + edgeHill;
      h += hillMass;
      const hillDetail = smoothstep(0.4, 2.6, hillMass);
      h += (fbm(x * 0.55 + 8.1, z * 0.55 - 2.2, 3) - 0.5) * hillDetail * 1.2;
      h += (fbm(x * 1.15 - 3.0, z * 1.15 + 4.5, 2) - 0.5) * hillDetail * 0.38;
      // Saddle between the big hill and the lower hill.
      const saddle = Math.exp(-(Math.pow((x - 10.5) / 4.2, 2) + Math.pow((z - 0.5) / 3.4, 2)) * 2.0);
      h -= 0.85 * saddle;

      // Flat alluvial plain on the left bank of the river.
      const leftPlainD = Math.hypot((x + 2.5) / 13.0, (z - 5.5) / 10.0);
      const leftPlainMask = smoothstep(1.0, 0.35, leftPlainD);
      const leftPlainTarget = 1.8 + (fbm(x * 0.14 + 11.0, z * 0.14 - 5.0, 2) - 0.5) * 0.5;
      h = lerp(h, leftPlainTarget, leftPlainMask * 0.85);
      const mount = mountainHeight(x, z);
      h += mount;
      h += (fbm(x * 0.62 + 2.7, z * 0.62 - 4.4, 3) - 0.5) * smoothstep(6.5, 11.5, mount) * 1.3;
      h += (fbm(x * 1.35 + 7.7, z * 1.35 - 3.2, 3) - 0.5) * smoothstep(9.0, 13.0, mount) * 0.35;
      h += (fbm(x * 2.4 + 13.1, z * 2.4 - 6.3, 2) - 0.5) * smoothstep(10.5, 14.0, mount) * 0.32;
      const plainD = Math.hypot((x - 15.2) / 7.6, (z - 12.2) / 6.0);
      const plainMask = smoothstep(1.0, 0.25, plainD);
      const plainTarget = 1.6 + (fbm(x * 0.2 + 5.0, z * 0.2 - 2.0, 2) - 0.5) * 0.4;
      h = lerp(h, plainTarget, plainMask * 0.9);
      return h;
    }

    // River spline.
    const riverEndTheta = RIVER_END_THETA;
    const riverEndRadius = rimRadius(riverEndTheta) * 0.995;
    const riverPoints = [
      [-6.2, -4.2], [-3.8, -1.0], [-1.2, 2.5], [3.0, 4.5],
      [6.5, 1.8], [9.5, 4.0], [11.0, 9.0], [13.5, 12.5]
    ].map(p => new THREE.Vector3(p[0], 0, p[1]));
    riverPoints.push(new THREE.Vector3(
      Math.cos(riverEndTheta) * riverEndRadius,
      0,
      Math.sin(riverEndTheta) * riverEndRadius
    ));
    const riverCurve = new THREE.CatmullRomCurve3(riverPoints, false, 'centripetal');
    const riverDistanceSamples = riverCurve.getSpacedPoints(100);

    function riverDist(x, z) {
      let best = 1e9;
      for (let i = 0; i < riverDistanceSamples.length; i++) {
        const p = riverDistanceSamples[i];
        const dx = x - p.x;
        const dz = z - p.z;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    }

    function heightAt(x, z) {
      const theta = Math.atan2(z, x);
      const rn = Math.hypot(x, z) / rimRadius(theta);
      let h = baseHeight(x, z);
      h -= smoothstep(0.92, 1.0, rn) * 0.7;
      const notch = Math.exp(-Math.pow(angDiff(theta, riverEndTheta) / 0.075, 2));
      h -= notch * smoothstep(0.84, 1.0, rn) * 1.6;
      const d = riverDist(x, z);
      const half = 1.15 + 0.35 * (fbm(x * 0.24 + 9.0, z * 0.24 - 3.0, 2) - 0.5);
      h -= 0.75 * (1 - smoothstep(half, half + 1.6, d));
      return h;
    }

    const _baseHeightAt = heightAt;
    const _flattenPads = (flattenLocal || []).map(p => ({ x: p.x, z: p.z, r: p.r, h: _baseHeightAt(p.x, p.z) }));
    heightAt = function (x, z) {
      let h = _baseHeightAt(x, z);
      if (h == null) return h;
      for (let i = 0; i < _flattenPads.length; i++) {
        const p = _flattenPads[i];
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) {
          const w = smoothstep(p.r, p.r * 0.55, d);
          h = lerp(h, p.h, w);
        }
      }
      return h;
    };

    function slopeAt(x, z) {
      const e = 0.55;
      const dx = heightAt(x + e, z) - heightAt(x - e, z);
      const dz = heightAt(x, z + e) - heightAt(x, z - e);
      return Math.hypot(dx, dz) / (2 * e);
    }

    // ---------- Palette ----------
    const COL = {
      grassDark: new THREE.Color(0x265014).convertSRGBToLinear(),
      grassDeep: new THREE.Color(0x1c3a0e).convertSRGBToLinear(),
      grassLight: new THREE.Color(0x5a8a2a).convertSRGBToLinear(),
      grassDry: new THREE.Color(0x878246).convertSRGBToLinear(),
      soil: new THREE.Color(0x655b3b).convertSRGBToLinear(),
      rock: new THREE.Color(0x6f706d).convertSRGBToLinear(),
      rockDark: new THREE.Color(0x464847).convertSRGBToLinear(),
      snow: new THREE.Color(0xf4f8fb).convertSRGBToLinear(),
      snowShadow: new THREE.Color(0xd8e5f1).convertSRGBToLinear(),
      sand: new THREE.Color(0xb1a17b).convertSRGBToLinear(),
      cliffA: new THREE.Color(0x63656a).convertSRGBToLinear(),
      cliffB: new THREE.Color(0x8b8c88).convertSRGBToLinear(),
      cliffDark: new THREE.Color(0x36383b).convertSRGBToLinear(),
      moss: new THREE.Color(0x496e2f).convertSRGBToLinear()
    };
    const tmpColor = new THREE.Color();
    const tmpColor2 = new THREE.Color();
    const tmpColor3 = new THREE.Color();

    function terrainColor(x, z, h, slope, dRiver, cavity, out) {
      const n = fbm(x * 0.16 + 3.1, z * 0.16 + 9.4, 4);
      const n2 = fbm(x * 0.5 - 2.0, z * 0.5 + 4.0, 3);
      const broad = fbm(x * 0.05 + 2.0, z * 0.05 - 8.0, 3);
      out.copy(COL.grassDark).lerp(COL.grassLight, clamp(0.18 + n * 1.0, 0, 1));
      out.lerp(COL.grassLight, smoothstep(0.42, 0.78, broad) * 0.3);
      out.lerp(COL.grassDry, smoothstep(0.6, 0.86, n) * 0.28);
      const patches = fbm(x * 0.045 + 21.0, z * 0.045 - 3.0, 3);
      out.lerp(COL.grassDeep, (1 - smoothstep(0.4, 0.72, patches)) * 0.25);
      out.lerp(COL.grassDry, smoothstep(0.55, 0.86, patches) * 0.22);
      out.multiplyScalar(0.9 + patches * 0.17);
      const grassPatch = fbm(x * 0.16 + 9.2, z * 0.16 - 4.1, 3);
      const bare = smoothstep(0.46, 0.18, grassPatch) * smoothstep(6.0, 3.0, h);
      out.lerp(COL.soil, bare * 0.6);

      const rock = tmpColor2.copy(COL.rock).lerp(COL.rockDark, n2);
      const rockStart = h < 8.0 ? 0.85 : 0.58;
      const rockAmt = smoothstep(rockStart, rockStart + 0.4, slope) * 0.85;
      out.lerp(rock, rockAmt);

      const high = smoothstep(8.0, 11.5, h - 1.5 + n2 * 2.0);
      out.lerp(rock, high * 0.8);

      const scree = smoothstep(8.5, 12.0, h) * smoothstep(0.2, 0.55, n) * 0.42;
      out.lerp(COL.rockDark, scree);

      const vein = smoothstep(0.6, 0.86, ridge(x * 0.4 + 3.2, z * 0.4 - 6.8, 3));
      out.lerp(COL.rockDark, vein * smoothstep(6.5, 10.0, h) * 0.32);

      const snowNoise = fbm(x * 0.29 + 7.0, z * 0.29 - 3.0, 4);
      const snowStreak = fbm(x * 0.42 + 1.3, z * 0.42 - 8.1, 3);
      const snowLine = 9.4 + (snowNoise - 0.5) * 4.6;
      let snow = smoothstep(snowLine, snowLine + 2.3, h + (n2 - 0.5) * 2.2);
      snow *= 0.45 + 0.55 * smoothstep(1.5, 0.4, slope);
      snow *= 0.76 + 0.24 * smoothstep(0.32, 0.62, snowNoise);
      snow = Math.max(snow, smoothstep(10.6, 13.6, h) * smoothstep(0.5, 0.8, snowStreak) * smoothstep(1.5, 0.5, slope) * 0.7);
      const snowRib = ridge(x * 0.5 + 5.0, z * 0.5 - 2.0, 3);
      snow *= 1 - smoothstep(0.55, 0.82, snowRib) * 0.55;
      const snowDetail = fbm(x * 0.75 + 11.0, z * 0.75 - 4.0, 3);
      const snowCol = tmpColor3.copy(COL.snow);
      snowCol.lerp(COL.snowShadow, smoothstep(0.5, 0.8, snowDetail) * 0.7);
      snowCol.multiplyScalar(0.8 + 0.26 * snowDetail);
      out.lerp(snowCol, clamp(snow, 0, 1));

      const bank = (1 - smoothstep(1.2, 3.1, dRiver)) * smoothstep(0.3, 0.75, fbm(x * 0.8 + 1, z * 0.8, 2));
      out.lerp(COL.sand, bank * 0.6);
      const plainD = Math.hypot((x - 15.2) / 7.6, (z - 12.2) / 6.0);
      const plainMask = smoothstep(1.0, 0.35, plainD);
      const silt = plainMask * smoothstep(0.32, 0.68, fbm(x * 0.3 + 7.0, z * 0.3 - 1.0, 2)) * 0.45;
      out.lerp(COL.sand, silt);

      const shade = 0.9 + n2 * 0.18;
      out.multiplyScalar(shade);
      out.multiplyScalar(1 - clamp(-cavity * 0.16, 0, 0.22));
      return out;
    }

    // ---------- Terrain ----------
    const terrainPositions = [];
    const terrainColors = [];
    const terrainUvs = [];
    const terrainIndices = [];
    const centerHeight = heightAt(0, 0);
    terrainPositions.push(0, centerHeight, 0);
    terrainColors.push(COL.grassDark.r, COL.grassDark.g, COL.grassDark.b);
    terrainUvs.push(0, 0);

    const ringVerts = RINGS * SEG;
    for (let i = 1; i <= RINGS; i++) {
      const t = i / RINGS;
      for (let j = 0; j < SEG; j++) {
        const theta = (j / SEG) * Math.PI * 2;
        const R = rimRadius(theta) * t;
        const x = Math.cos(theta) * R;
        const z = Math.sin(theta) * R;
        const h = heightAt(x, z);
        const dR = riverDist(x, z);
        const e = 0.55;
        const hL = heightAt(x - e, z);
        const hR = heightAt(x + e, z);
        const hD = heightAt(x, z - e);
        const hU = heightAt(x, z + e);
        const slope = Math.hypot(hR - hL, hU - hD) / (2 * e);
        const cavity = h - (hL + hR + hD + hU) * 0.25;
        terrainPositions.push(x, h, z);
        terrainUvs.push(x / 8, z / 8);
        const c = terrainColor(x, z, h, slope, dR, cavity, tmpColor);
        terrainColors.push(c.r, c.g, c.b);
      }
    }

    for (let j = 0; j < SEG; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % SEG);
      terrainIndices.push(0, b, a);
    }
    for (let i = 1; i < RINGS; i++) {
      const rowA = 1 + (i - 1) * SEG;
      const rowB = 1 + i * SEG;
      for (let j = 0; j < SEG; j++) {
        const j2 = (j + 1) % SEG;
        const a = rowA + j;
        const b = rowA + j2;
        const c = rowB + j;
        const d = rowB + j2;
        terrainIndices.push(a, b, c);
        terrainIndices.push(b, d, c);
      }
    }

    const terrainGeometry = new THREE.BufferGeometry();
    terrainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(terrainPositions, 3));
    terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
    terrainGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(terrainUvs, 2));
    terrainGeometry.setIndex(terrainIndices);
    terrainGeometry.computeVertexNormals();
    const terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: grassTexture,
      normalMap: terrainNormalTexture,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 0.93,
      metalness: 0,
      envMapIntensity: 0.45
    });
    terrainMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.snowMap = { value: snowTexture };
      shader.fragmentShader = `uniform sampler2D snowMap;
${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float snowMask = smoothstep(0.82, 0.95, dot(vColor, vec3(0.3333)));
        vec3 snowDetail = texture2D(snowMap, vUv * 2.5).rgb;
        diffuseColor.rgb *= mix(vec3(1.0), snowDetail * 1.12, snowMask);`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        float snowRough = smoothstep(0.82, 0.95, dot(vColor, vec3(0.3333)));
        roughnessFactor = mix(roughnessFactor, 0.45, snowRough);`
      );
    };
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    mainGroup.add(terrain);

    // ---------- Cliff and underside ----------
    function cliffPoint(theta, t, target) {
      const rr = rimRadius(theta);
      const bx = Math.cos(theta) * rr;
      const bz = Math.sin(theta) * rr;
      const rimY = heightAt(bx, bz);
      const s = smoothstep(0, 1, t);
      let rf = 1 - 0.9 * Math.pow(smoothstep(0.25, 1, t), 1.2);
      const fallCut = Math.exp(-Math.pow(angDiff(theta, riverEndTheta) / 0.24, 2));
      rf += 0.09 * Math.sin(Math.PI * clamp(t / 0.4, 0, 1)) * (1 - 0.9 * fallCut);
      rf -= 0.035 * fallCut * smoothstep(0.02, 0.2, t);
      const n = fbm(Math.cos(theta) * 2.6 + 9.1, Math.sin(theta) * 2.6 - 4.2 + t * 2.5, 4);
      const nAng = fbm(theta * 5.2 + 1.7, t * 6.0 + 8.3, 4);
      const strata = fbm(theta * 9.0, t * 16.0, 3);
      const amp = smoothstep(0.0, 0.06, t);
      rf *= 1 + (0.115 * (n - 0.5) + 0.09 * (nAng - 0.5) + 0.05 * (strata - 0.5)) * amp;
      rf -= 0.045 * Math.pow(0.5 + 0.5 * Math.sin(theta * 13.0 + n * 5.0), 3) * amp;
      rf += 0.06 * Math.sin(t * Math.PI * 11.0 + theta * 2.2) * (1 - t) * 0.7 * amp;
      const drift = t * t;
      const driftX = 2.2 * drift + 0.9 * Math.sin(theta * 2.1) * drift;
      const driftZ = -1.4 * drift + 0.9 * Math.cos(theta * 1.7) * drift;
      const x = bx * rf + driftX;
      const z = bz * rf + driftZ;
      const jag = (fbm(theta * 7.0, t * 22.0, 2) - 0.5) * 1.6 * amp;
      const depthVar = DEPTH * (0.9 + 0.2 * fbm(theta * 2.0 + 4.0, 5.0, 2));
      const y = rimY - (0.22 * t + 0.78 * Math.pow(t, 1.8)) * depthVar + jag;
      target.set(x, y, z);
      return { n, nAng, y, rimY };
    }

    const cliffPositions = [];
    const cliffColors = [];
    const cliffUvs = [];
    const cliffIndices = [];
    const cp = new THREE.Vector3();
    for (let i = 0; i <= CLIFF_LEVELS; i++) {
      const t = i / CLIFF_LEVELS;
      for (let j = 0; j < SEG; j++) {
        const theta = (j / SEG) * Math.PI * 2;
        const info = cliffPoint(theta, t, cp);
        cliffPositions.push(cp.x, cp.y, cp.z);
        cliffUvs.push((j / SEG) * 6, t * 5.5);
        const band = fbm(theta * 4.1 + 2.7, t * 7.0 + 3.4, 4);
        const dark = smoothstep(0.5, 0.82, fbm(theta * 6.7 + t * 4.0, t * 11.0, 3));
        const crack = smoothstep(0.56, 0.86, fbm(theta * 7.5 + 1.0, t * 4.5, 3));
        const col = new THREE.Color(COL.cliffA).lerp(COL.cliffB, band);
        col.lerp(COL.cliffDark, dark * 0.62);
        col.lerp(COL.cliffDark, crack * 0.45);
        const mossAmt = smoothstep(0.17, 0.01, t) * (0.35 + 0.55 * fbm(theta * 5.0, t * 9.0, 3));
        col.lerp(COL.moss, clamp(mossAmt, 0, 1) * 0.85);
        const vertShade = 0.88 + 0.2 * fbm(theta * 2.0, cp.y * 0.4, 2);
        col.multiplyScalar(vertShade);
        cliffColors.push(col.r, col.g, col.b);
      }
    }
    const bottomCenterIndex = cliffPositions.length / 3;
    cliffPositions.push(2.2, heightAt(Math.cos(riverEndTheta) * rimRadius(riverEndTheta), Math.sin(riverEndTheta) * rimRadius(riverEndTheta)) - DEPTH - 1.6, -1.4);
    cliffColors.push(COL.cliffDark.r, COL.cliffDark.g, COL.cliffDark.b);
    cliffUvs.push(0.5, 5.5);

    for (let i = 0; i < CLIFF_LEVELS; i++) {
      const rowA = i * SEG;
      const rowB = (i + 1) * SEG;
      for (let j = 0; j < SEG; j++) {
        const j2 = (j + 1) % SEG;
        const a = rowA + j;
        const b = rowA + j2;
        const c = rowB + j;
        const d = rowB + j2;
        cliffIndices.push(a, b, c);
        cliffIndices.push(b, d, c);
      }
    }
    const bottomRow = CLIFF_LEVELS * SEG;
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      cliffIndices.push(bottomRow + j, bottomRow + j2, bottomCenterIndex);
    }

    const cliffGeometry = new THREE.BufferGeometry();
    cliffGeometry.setAttribute('position', new THREE.Float32BufferAttribute(cliffPositions, 3));
    cliffGeometry.setAttribute('color', new THREE.Float32BufferAttribute(cliffColors, 3));
    cliffGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(cliffUvs, 2));
    cliffGeometry.setIndex(cliffIndices);
    cliffGeometry.computeVertexNormals();
    const cliffMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: rockTexture,
      bumpMap: rockTexture,
      bumpScale: 0.38,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
      envMapIntensity: 0.3
    });
    const cliff = new THREE.Mesh(cliffGeometry, cliffMaterial);
    cliff.castShadow = true;
    cliff.receiveShadow = true;
    mainGroup.add(cliff);

    // ---------- River ----------
    const riverSamples = riverCurve.getSpacedPoints(300);
    const waterHeights = riverSamples.map(p => heightAt(p.x, p.z) + 0.16);
    for (let pass = 0; pass < 3; pass++) {
      const smoothed = waterHeights.slice();
      for (let i = 0; i < waterHeights.length; i++) {
        let sum = 0, count = 0;
        for (let k = -6; k <= 6; k++) {
          const idx = i + k;
          if (idx >= 0 && idx < waterHeights.length) {
            sum += waterHeights[idx];
            count++;
          }
        }
        smoothed[i] = sum / count;
      }
      for (let i = 0; i < waterHeights.length; i++) waterHeights[i] = smoothed[i];
    }

    const riverPositions = [];
    const riverIndices = [];
    const riverUvs = [];
    const riverWidths = [];
    const riverTangents = [];
    for (let i = 0; i < riverSamples.length; i++) {
      const p = riverSamples[i];
      const prev = riverSamples[Math.max(0, i - 1)];
      const next = riverSamples[Math.min(riverSamples.length - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const endTaper = smoothstep(0, 0.06, i / riverSamples.length);
      const width = (2.35 + 0.4 * Math.sin(i * 0.31)) * endTaper;
      riverWidths.push(width);
      riverTangents.push([tx / len, tz / len]);
      const y = waterHeights[i];
      riverPositions.push(p.x + nx * width * 0.5, y, p.z + nz * width * 0.5);
      riverPositions.push(p.x - nx * width * 0.5, y, p.z - nz * width * 0.5);
      riverUvs.push(0, i / riverSamples.length, 1, i / riverSamples.length);
      if (i < riverSamples.length - 1) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        riverIndices.push(a, b, c);
        riverIndices.push(b, d, c);
      }
    }
    const riverGeometry = new THREE.BufferGeometry();
    riverGeometry.setAttribute('position', new THREE.Float32BufferAttribute(riverPositions, 3));
    riverGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(riverUvs, 2));
    riverGeometry.setIndex(riverIndices);
    riverGeometry.computeVertexNormals();
    const riverMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x2f748a,
      roughness: 0.045,
      metalness: 0.06,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
      clearcoatNormalMap: waterNormalTexture,
      clearcoatNormalScale: new THREE.Vector2(1.1, 1.1),
      normalMap: waterNormalTexture,
      normalScale: new THREE.Vector2(1.5, 1.5),
      transparent: true,
      opacity: 0.97,
      envMapIntensity: 0.85,
      side: THREE.DoubleSide
    });
    riverMaterial.userData.waterEnv = true;
    const river = new THREE.Mesh(riverGeometry, riverMaterial);
    river.receiveShadow = true;
    mainGroup.add(river);

    const riverFoamMaterial = new THREE.MeshBasicMaterial({
      map: waterFoamTexture,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const riverFoam = new THREE.Mesh(riverGeometry, riverFoamMaterial);
    riverFoam.position.y = 0.025;
    riverFoam.renderOrder = 2;
    mainGroup.add(riverFoam);

    // Foam on rapids.
    const foamGeo = new THREE.CircleGeometry(1, 10);
    const foamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false
    });
    const foamCount = 110;
    const foam = new THREE.InstancedMesh(foamGeo, foamMat, foamCount);
    const dummy = new THREE.Object3D();
    let foamIndex = 0;
    for (let i = 4; i < riverSamples.length - 4 && foamIndex < foamCount; i += 2) {
      if (rand() < 0.45) continue;
      const p = riverSamples[i];
      const t = riverTangents[i];
      const w = riverWidths[i];
      dummy.position.set(p.x + (rand() - 0.5) * w * 0.7, waterHeights[i] + 0.035, p.z + (rand() - 0.5) * w * 0.7);
      dummy.rotation.set(-Math.PI / 2, 0, Math.atan2(t[1], t[0]));
      dummy.scale.set(0.2 + rand() * 0.42, 0.1 + rand() * 0.18, 1);
      dummy.updateMatrix();
      foam.setMatrixAt(foamIndex++, dummy.matrix);
    }
    foam.count = foamIndex;
    mainGroup.add(foam);

    // Riverbank pebbles.
    const pebbleGeo = new THREE.DodecahedronGeometry(0.24, 0);
    const pebbleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: rockTexture,
      bumpMap: rockTexture,
      bumpScale: 0.08,
      roughness: 0.95,
      flatShading: true,
      envMapIntensity: 0.3
    });
    const pebbleCount = 230;
    const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, pebbleCount);
    const pebblePalette = [0xb5a98f, 0x948a78, 0xc6bba4, 0x7d7566];
    let pebbleIndex = 0;
    for (let i = 8; i < riverSamples.length - 4 && pebbleIndex < pebbleCount; i += 2) {
      const p = riverSamples[i];
      const t = riverTangents[i];
      const nx = -t[1], nz = t[0];
      const w = riverWidths[i] * 0.5 + 0.45 + rand() * 0.5;
      for (const side of [-1, 1]) {
        if (rand() < 0.5) continue;
        const px = p.x + nx * w * side + (rand() - 0.5) * 0.6;
        const pz = p.z + nz * w * side + (rand() - 0.5) * 0.6;
        const s = 0.35 + rand() * 0.9;
        dummy.position.set(px, heightAt(px, pz) + 0.1 * s, pz);
        dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        dummy.scale.set(s, s * (0.6 + rand() * 0.4), s);
        dummy.updateMatrix();
        pebbles.setMatrixAt(pebbleIndex, dummy.matrix);
        pebbles.setColorAt(pebbleIndex, new THREE.Color(pebblePalette[Math.floor(rand() * pebblePalette.length)]));
        pebbleIndex++;
        if (pebbleIndex >= pebbleCount) break;
      }
    }
    pebbles.count = pebbleIndex;
    pebbles.castShadow = true;
    pebbles.receiveShadow = true;
    if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true;
    mainGroup.add(pebbles);

    // ---------- Waterfall ----------
    const waterfallUniforms = [];
    function makeWaterfallSheet(widthTop, widthBottom, height, speed, opacity, offset) {
      const segX = 18, segY = 56;
      const positions = [], uvs = [], indices = [];
      for (let j = 0; j <= segY; j++) {
        const v = j / segY;
        const w = widthTop + (widthBottom - widthTop) * Math.pow(v, 0.65);
        for (let i = 0; i <= segX; i++) {
          const u = i / segX;
          const x = (u - 0.5) * w + Math.sin(v * 6.0 + u * 2.0) * 0.12 * v;
          const z = offset + 0.35 * Math.sin(v * Math.PI * 0.55) + 2.1 * Math.pow(v, 1.35) + 0.12 * Math.sin(v * 8.0 + u * 4.0) * v;
          const y = -height * v;
          positions.push(x, y, z);
          uvs.push(u, v);
        }
      }
      for (let j = 0; j < segY; j++) {
        for (let i = 0; i < segX; i++) {
          const a = j * (segX + 1) + i;
          const b = a + 1;
          const c = a + segX + 1;
          const d = c + 1;
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      const uniforms = {
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uOpacity: { value: opacity },
        uSeed: { value: rand() * 10 },
        uTint: { value: new THREE.Color(1, 1, 1) }
      };
      waterfallUniforms.push(uniforms);
      const mat = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        vertexShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying float vDepth;
          void main() {
            vUv = uv;
            vec3 p = position;
            p.x += sin(uv.y * 15.0 - uTime * 2.2 + uv.x * 5.0) * 0.10 * uv.y;
            p.z += sin(uv.y * 9.0 + uTime * 1.4) * 0.06 * uv.y;
            vDepth = uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uSpeed;
          uniform float uOpacity;
          uniform float uSeed;
          uniform vec3 uTint;
          varying vec2 vUv;
          float hash21(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
                       mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
          }
          float fbm(vec2 p) {
            float v = 0.0;
            float a = 0.5;
            for (int i = 0; i < 5; i++) {
              v += a * noise(p);
              p = p * 2.03 + 17.0;
              a *= 0.5;
            }
            return v;
          }
          void main() {
            vec2 q = vec2(vUv.x * 6.0 + uSeed, vUv.y * 4.5 - uTime * uSpeed);
            float n = fbm(q * 1.6);
            float streak = fbm(vec2(vUv.x * 20.0 + uSeed, vUv.y * 3.0 - uTime * uSpeed * 2.3));
            float a = 0.62 + 0.38 * smoothstep(0.3, 0.7, n * 0.58 + streak * 0.62);
            float edge = smoothstep(0.0, 0.11, vUv.x) * smoothstep(1.0, 0.89, vUv.x);
            float top = smoothstep(0.0, 0.02, vUv.y);
            float bottom = 1.0 - smoothstep(0.7, 1.0, vUv.y);
            a *= edge * top * bottom;
            vec3 col = mix(vec3(0.44, 0.67, 0.82), vec3(1.0), smoothstep(0.16, 0.74, n));
            col += vec3(0.04, 0.07, 0.09) * smoothstep(0.5, 0.9, streak);
            gl_FragColor = vec4(col * uTint, a * uOpacity);
          }
        `
      });
      return new THREE.Mesh(geo, mat);
    }

    const waterfall = new THREE.Group();
    const endRim = new THREE.Vector3(
      Math.cos(riverEndTheta) * rimRadius(riverEndTheta),
      0,
      Math.sin(riverEndTheta) * rimRadius(riverEndTheta)
    );
    const rimTopY = heightAt(endRim.x, endRim.z);
    const fallTopY = Math.max(waterHeights[waterHeights.length - 1] + 0.04, rimTopY - 0.12);
    waterfall.position.set(endRim.x, fallTopY, endRim.z);
    const outward = new THREE.Vector3(Math.cos(riverEndTheta), 0, Math.sin(riverEndTheta));
    waterfall.rotation.y = Math.atan2(outward.x, outward.z);
    const fallHeight = 37;
    waterfall.add(makeWaterfallSheet(4.6, 7.4, fallHeight, 1.7, 1.0, 0.35));
    waterfall.add(makeWaterfallSheet(5.4, 8.4, fallHeight - 0.6, 2.5, 0.5, 0.54));
    waterfall.add(makeWaterfallSheet(1.6, 2.6, fallHeight - 0.8, 3.2, 0.8, 0.66));
    mainGroup.add(waterfall);

    const lipFoam = new THREE.Mesh(
      new THREE.CircleGeometry(1, 20),
      new THREE.MeshBasicMaterial({
        color: 0xf4fbff,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false
      })
    );
    lipFoam.rotation.x = -Math.PI / 2;
    lipFoam.position.set(endRim.x, fallTopY + 0.01, endRim.z);
    lipFoam.scale.set(2.0, 2.0, 1);
    mainGroup.add(lipFoam);
    const frontInfo = {
      theta: riverEndTheta,
      x: endRim.x * SCALE,
      y: fallTopY * SCALE,
      z: endRim.z * SCALE
    };

    // Soft mist at the foot of the fall.
    const softTexture = makeRadialTexture(128, 'rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
    const mistSprites = [];
    for (let i = 0; i < 10; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTexture,
        color: 0xeef6fb,
        transparent: true,
        opacity: 0.24 + rand() * 0.2,
        depthWrite: false
      }));
      const along = rand();
      sprite.position.set(
        endRim.x + outward.x * (2.5 + rand() * 8) + (rand() - 0.5) * 6,
        fallTopY - fallHeight * (0.55 + along * 0.45),
        endRim.z + outward.z * (2.5 + rand() * 8) + (rand() - 0.5) * 6
      );
      const s = 6 + rand() * 11;
      sprite.scale.set(s, s * 0.7, 1);
      sprite.userData.baseOpacity = sprite.material.opacity;
      sprite.userData.phase = rand() * 10;
      mistSprites.push(sprite);
      mainGroup.add(sprite);
    }

    // ---------- Trees ----------
    const contactShadows = [];
    function queueContactShadow(x, z, radius) {
      const e = 0.45;
      const nx = heightAt(x - e, z) - heightAt(x + e, z);
      const nz = heightAt(x, z - e) - heightAt(x, z + e);
      const normal = new THREE.Vector3(nx, 2 * e, nz).normalize();
      contactShadows.push({
        x: x + normal.x * 0.035,
        y: heightAt(x, z) + normal.y * 0.035,
        z: z + normal.z * 0.035,
        radius,
        nx: normal.x, ny: normal.y, nz: normal.z
      });
    }
    // ---------- Flowers ----------
    const flowerCount = 300;
    const flowerGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, envMapIntensity: 0.4 });
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
    const flowerPalette = [0xffffff, 0xffe9a8, 0xf7c3d6, 0xf2f5f8, 0xffd36e, 0xcbb7ff, 0xffb36b];
    let flowerIndex = 0;
    let flowerAttempts = 0;
    while (flowerIndex < flowerCount && flowerAttempts < 4000) {
      flowerAttempts++;
      const theta = rand() * Math.PI * 2;
      const radius = Math.sqrt(rand()) * rimRadius(theta) * 0.9;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const h = heightAt(x, z);
      if (h < 0.7 || h > 7.5) continue;
      if (slopeAt(x, z) > 0.42) continue;
      if (riverDist(x, z) < 2.6) continue;
      dummy.position.set(x, h + 0.08, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      const s = 0.6 + rand() * 0.9;
      dummy.scale.set(s, s * 0.8, s);
      dummy.updateMatrix();
      flowers.setMatrixAt(flowerIndex, dummy.matrix);
      flowers.setColorAt(flowerIndex, new THREE.Color(flowerPalette[Math.floor(rand() * flowerPalette.length)]));
      flowerIndex++;
    }
    flowers.count = flowerIndex;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    mainGroup.add(flowers);

    // ---------- Grass cards (natural meadow) ----------
    const bladeTexture = canvasTexture(256, (ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      const base = ctx.createLinearGradient(0, size, 0, size - 52);
      base.addColorStop(0, 'rgba(20,36,14,0.42)');
      base.addColorStop(0.62, 'rgba(28,46,18,0.18)');
      base.addColorStop(1, 'rgba(28,46,18,0)');
      ctx.fillStyle = base;
      ctx.fillRect(0, size - 52, size, 52);
      const blades = 38;
      for (let i = 0; i < blades; i++) {
        const x0 = 14 + i * (228 / blades) + (rand() - 0.5) * 11;
        const hh = 84 + rand() * 130;
        const wd = 3.2 + rand() * 3.8;
        const bend = (rand() - 0.5) * 36;
        const dry = rand() < 0.07;
        const gr = ctx.createLinearGradient(0, size, 0, size - hh);
        if (dry) {
          gr.addColorStop(0, 'rgba(60,66,34,0.92)');
          gr.addColorStop(0.5, 'rgba(112,114,62,0.92)');
          gr.addColorStop(1, 'rgba(158,152,88,0.95)');
        } else {
          gr.addColorStop(0, 'rgba(26,44,18,0.94)');
          gr.addColorStop(0.45, 'rgba(56,94,36,0.94)');
          gr.addColorStop(1, 'rgba(124,170,82,0.96)');
        }
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(x0 - wd, size);
        ctx.quadraticCurveTo(x0 - wd * 0.35 + bend * 0.4, size - hh * 0.55, x0 + bend, size - hh);
        ctx.quadraticCurveTo(x0 + wd * 0.35 + bend * 0.4, size - hh * 0.55, x0 + wd, size);
        ctx.closePath();
        ctx.fill();
      }
    });
    bladeTexture.wrapS = bladeTexture.wrapT = THREE.ClampToEdgeWrapping;

    const grassCardGeometry = (() => {
      const positions = [], uvs = [], indices = [];
      let offset = 0;
      for (let p = 0; p < 3; p++) {
        const plane = new THREE.PlaneGeometry(1.35, 1.65, 1, 2);
        plane.translate(0, 0.825, 0);
        if (p) plane.rotateY((p * Math.PI) / 3);
        const pos = plane.attributes.position;
        const uv = plane.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          uvs.push(uv.getX(i), uv.getY(i));
        }
        for (let i = 0; i < plane.index.count; i++) indices.push(plane.index.getX(i) + offset);
        offset += pos.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      const normals = new Float32Array(positions.length);
      for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      return geo;
    })();

    const grassWind = { value: 0 };
    const grassCardMaterial = new THREE.MeshStandardMaterial({
      map: bladeTexture,
      alphaTest: 0.28,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
      envMapIntensity: 0.3
    });
    grassCardMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uGrassTime = grassWind;
      shader.vertexShader = 'uniform float uGrassTime;\nattribute float aPh;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float sway = sin(uGrassTime * 1.35 + aPh) * 0.10;
        float sway2 = cos(uGrassTime * 1.1 + aPh * 1.3) * 0.06;
        transformed.x += sway * uv.y * uv.y;
        transformed.z += sway2 * uv.y * uv.y;`
      );
    };

    const grassCardCount = 3800;
    const grassCards = new THREE.InstancedMesh(grassCardGeometry, grassCardMaterial, grassCardCount);
    const grassPhases = new Float32Array(grassCardCount);
    const grassTint = new THREE.Color();
    let grassPlaced = 0;
    let grassTries = 0;
    while (grassPlaced < grassCardCount && grassTries < 45000) {
      grassTries++;
      const theta = rand() * Math.PI * 2;
      const radius = Math.sqrt(rand()) * rimRadius(theta) * 0.92;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const h = heightAt(x, z);
      if (h < 0.5 || h > 8.3) continue;
      if (riverDist(x, z) < 1.55) continue;
      const edgeFade = smoothstep(0.94, 0.85, radius / rimRadius(theta));
      if (rand() > edgeFade) continue;
      const patch = fbm(x * 0.16 + 9.2, z * 0.16 - 4.1, 3);
      if (rand() > 0.45 + 0.55 * patch) continue;
      const plainD = Math.hypot((x - 15.2) / 7.6, (z - 12.2) / 6.0);
      if (rand() < smoothstep(1.0, 0.35, plainD) * 0.38) continue;
      if (slopeAt(x, z) > 0.85) continue;
      const s = 0.58 + rand() * 0.62;
      dummy.position.set(x, h - 0.09, z);
      dummy.rotation.set((rand() - 0.5) * 0.12, rand() * 6.283, (rand() - 0.5) * 0.12);
      dummy.scale.set(s * (0.9 + rand() * 0.22), s * (0.75 + rand() * 0.42), s * (0.9 + rand() * 0.22));
      dummy.updateMatrix();
      grassCards.setMatrixAt(grassPlaced, dummy.matrix);
      const dry = smoothstep(0.55, 0.85, fbm(x * 0.2 + 4.0, z * 0.2 - 7.0, 2));
      grassTint.setRGB(0.95 + dry * 0.12, 0.98 - dry * 0.06, 0.85 - dry * 0.02);
      grassTint.multiplyScalar(0.95 + rand() * 0.2);
      grassCards.setColorAt(grassPlaced, grassTint);
      grassPhases[grassPlaced] = x * 0.15 + z * 0.12 + rand() * 0.7;
      grassPlaced++;
    }
    grassCards.count = grassPlaced;
    if (grassCards.instanceColor) grassCards.instanceColor.needsUpdate = true;
    grassCardGeometry.setAttribute('aPh', new THREE.InstancedBufferAttribute(grassPhases, 1));
    grassCards.receiveShadow = true;
    grassCards.castShadow = false;
    mainGroup.add(grassCards);

    // ---------- Moss lip and boulders ----------
    const mossGeo = new THREE.IcosahedronGeometry(0.7, 0);
    const mossMat = new THREE.MeshStandardMaterial({
      color: 0x6b8f4a,
      map: grassTexture,
      bumpMap: grassTexture,
      bumpScale: 0.14,
      roughness: 1,
      flatShading: true,
      envMapIntensity: 0.25
    });
    const mossCount = 130;
    const moss = new THREE.InstancedMesh(mossGeo, mossMat, mossCount);
    const mossPalette = [0x4e7c33, 0x5d8f3a, 0x406b2b, 0x6b9c45];
    for (let i = 0; i < mossCount; i++) {
      const theta = (i / mossCount) * Math.PI * 2 + (rand() - 0.5) * 0.04;
      const R = rimRadius(theta) * (0.975 + rand() * 0.02);
      const x = Math.cos(theta) * R;
      const z = Math.sin(theta) * R;
      const h = heightAt(x, z);
      dummy.position.set(x, h + 0.05, z);
      dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3);
      dummy.scale.set(0.7 + rand() * 1.1, 0.22 + rand() * 0.3, 0.7 + rand() * 1.1);
      dummy.updateMatrix();
      moss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(mossPalette[Math.floor(rand() * mossPalette.length)]);
      c.multiplyScalar(0.85 + rand() * 0.3);
      moss.setColorAt(i, c);
    }
    if (moss.instanceColor) moss.instanceColor.needsUpdate = true;
    moss.castShadow = true;
    moss.receiveShadow = true;
    mainGroup.add(moss);

    const boulderGeo = new THREE.DodecahedronGeometry(1, 0);
    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: rockTexture,
      bumpMap: rockTexture,
      bumpScale: 0.28,
      roughness: 0.98,
      flatShading: true,
      envMapIntensity: 0.3
    });
    const boulderCount = 30;
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, boulderCount);
    const boulderPalette = [0x7d766d, 0x69635a, 0x91887a, 0x57524c];
    for (let i = 0; i < boulderCount; i++) {
      let x, y, z;
      if (i < 8) {
        const theta = -0.6 + rand() * 2.8;
        const R = rimRadius(theta) * (0.55 + rand() * 0.3);
        x = Math.cos(theta) * R;
        z = Math.sin(theta) * R;
        y = heightAt(x, z);
      } else {
        let theta = rand() * Math.PI * 2;
        if (Math.abs(angDiff(theta, riverEndTheta)) < 0.4) theta += 0.55;
        const t = 0.06 + rand() * 0.72;
        cliffPoint(theta, t, cp);
        x = cp.x * 1.015;
        y = cp.y;
        z = cp.z * 1.015;
      }
      const s = 0.4 + rand() * 0.8;
      if (i < 8) queueContactShadow(x, z, 1.1 * s);
      dummy.position.set(x, y + s * 0.25, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(s * (0.8 + rand() * 0.5), s * (0.6 + rand() * 0.5), s * (0.8 + rand() * 0.5));
      dummy.updateMatrix();
      boulders.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(boulderPalette[Math.floor(rand() * boulderPalette.length)]);
      c.multiplyScalar(0.85 + rand() * 0.3);
      boulders.setColorAt(i, c);
    }
    if (boulders.instanceColor) boulders.instanceColor.needsUpdate = true;
    boulders.castShadow = true;
    boulders.receiveShadow = true;
    mainGroup.add(boulders);

    if (contactShadows.length > 0) {
      const contactGeometry = new THREE.CircleGeometry(1, 24);
      const contactMaterial = new THREE.MeshBasicMaterial({
        map: contactShadowTexture,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const contactMesh = new THREE.InstancedMesh(contactGeometry, contactMaterial, contactShadows.length);
      const up = new THREE.Vector3(0, 0, 1);
      const quat = new THREE.Quaternion();
      const mat4 = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      contactShadows.forEach((s, i) => {
        quat.setFromUnitVectors(up, new THREE.Vector3(s.nx, s.ny, s.nz));
        pos.set(s.x, s.y, s.z);
        scl.set(s.radius, s.radius, s.radius);
        mat4.compose(pos, quat, scl);
        contactMesh.setMatrixAt(i, mat4);
      });
      contactMesh.renderOrder = 1;
      mainGroup.add(contactMesh);
    }

    // ---------- Vines ----------
    const vineGroup = new THREE.Group();
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x3f6c29, roughness: 0.95, envMapIntensity: 0.3 });
    const vineMatDark = new THREE.MeshStandardMaterial({ color: 0x315421, roughness: 0.95, envMapIntensity: 0.3 });
    const leafTransforms = [];
    const vineThetas = [];
    for (let i = 0; i < 26; i++) {
      let theta = rand() * Math.PI * 2;
      if (Math.abs(angDiff(theta, riverEndTheta)) < 0.16) theta += 0.35;
      vineThetas.push(theta);
    }
    vineThetas.forEach((theta, vi) => {
      const R = rimRadius(theta) * 0.992;
      const sx = Math.cos(theta) * R;
      const sz = Math.sin(theta) * R;
      const y0 = heightAt(sx, sz);
      const out = Math.cos(theta), outz = Math.sin(theta);
      const tanx = -Math.sin(theta), tanz = Math.cos(theta);
      const strandCount = 3 + Math.floor(rand() * 3);
      for (let s = 0; s < strandCount; s++) {
        const len = 2.5 + rand() * 11.5;
        const drift = 0.25 + rand() * 1.4;
        const side = (rand() - 0.5) * 1.8;
        const phase = rand() * 6.28;
        const pts = [];
        const steps = 7;
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const sway = Math.sin(u * 3.4 + phase) * 0.35 * u;
          pts.push(new THREE.Vector3(
            sx + out * (0.15 + drift * Math.sin(u * 1.2)) + tanx * (side * u + sway),
            y0 - 0.12 - len * Math.pow(u, 1.04),
            sz + outz * (0.15 + drift * Math.sin(u * 1.2)) + tanz * (side * u + sway)
          ));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 16, 0.045 + rand() * 0.035, 4, false),
          rand() > 0.5 ? vineMat : vineMatDark
        );
        tube.castShadow = false;
        vineGroup.add(tube);
        const leafSamples = 20;
        for (let l = 0; l < leafSamples; l++) {
          const u = 0.06 + (l / leafSamples) * 0.9 + rand() * 0.04;
          const p = curve.getPoint(clamp(u, 0, 1));
          const spread = 0.45 + rand() * 0.6;
          leafTransforms.push({
            x: p.x + (rand() - 0.5) * spread,
            y: p.y + (rand() - 0.5) * 0.35,
            z: p.z + (rand() - 0.5) * spread,
            s: 0.5 + rand() * 0.45,
            rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
          });
        }
      }
    });
    mainGroup.add(vineGroup);

    // ---------- Ancient roots on the underside ----------
    const rootBarkTexture = barkTexture.clone();
    rootBarkTexture.repeat.set(6, 2.5);
    rootBarkTexture.needsUpdate = true;
    const rootMaterial = new THREE.MeshStandardMaterial({
      map: rootBarkTexture,
      bumpMap: rootBarkTexture,
      bumpScale: 0.32,
      roughness: 1,
      metalness: 0,
      vertexColors: true,
      emissive: 0x140e09,
      emissiveIntensity: 0.18,
      envMapIntensity: 0.22,
      side: THREE.DoubleSide
    });

    const rootTmp = new THREE.Vector3();
    function rootSurfacePoint(theta, t, clear) {
      cliffPoint(theta, t, rootTmp);
      const rr = Math.hypot(rootTmp.x, rootTmp.z) || 1;
      const k = 1 + clear / rr;
      return new THREE.Vector3(rootTmp.x * k, rootTmp.y, rootTmp.z * k);
    }

    function makeRootGeometry(points, r0, r1, seed, radialSegments, material) {
      const curve = new THREE.CatmullRomCurve3(points);
      const tubular = 40;
      const geo = new THREE.TubeGeometry(curve, tubular, 1, radialSegments, false);
      const pos = geo.attributes.position;
      const ringSize = radialSegments + 1;
      const colors = new Float32Array(pos.count * 3);
      const center = new THREE.Vector3();
      for (let ring = 0; ring <= tubular; ring++) {
        const t = ring / tubular;
        curve.getPointAt(t, center);
        const taper = r0 + (r1 - r0) * Math.pow(t, 0.88);
        const knot = 1 + 0.34 * Math.sin(t * 13.5 + seed) + 0.2 * Math.sin(t * 31 + seed * 1.7);
        const baseRadius = Math.max(0.035, taper * knot);
        for (let j = 0; j < ringSize; j++) {
          const id = ring * ringSize + j;
          const dx = pos.getX(id) - center.x;
          const dy = pos.getY(id) - center.y;
          const dz = pos.getZ(id) - center.z;
          const len = Math.hypot(dx, dy, dz) || 1;
          const ox = dx / len, oy = dy / len, oz = dz / len;
          const angular = 1 + 0.22 * Math.sin(j * 1.7 + t * 18 + seed) + 0.11 * Math.sin(j * 4.3 - t * 11 + seed * 1.6);
          const radius = baseRadius * angular;
          pos.setXYZ(id, center.x + ox * radius, center.y + oy * radius, center.z + oz * radius);
          const up = Math.max(0, oy);
          const mossNoise = fbm(center.x * 0.3 + seed, center.z * 0.3 - seed, 2);
          const moss = smoothstep(0.2, 0.75, up) * smoothstep(0.4, 0.72, mossNoise) * 0.8;
          const variation = 0.5 + 0.5 * Math.sin(t * 24 + seed + j * 0.7);
          const shade = 0.36 + 0.3 * up + 0.09 * variation;
          colors[id * 3] = shade * (0.52 * (1 - moss) + 0.18 * moss);
          colors[id * 3 + 1] = shade * (0.39 * (1 - moss) + 0.29 * moss);
          colors[id * 3 + 2] = shade * (0.27 * (1 - moss) + 0.11 * moss);
        }
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material || rootMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    }

    function addRootLeaves(points, every, sizeMin, sizeMax) {
      for (let i = 3; i < points.length - 2; i += every) {
        const p = points[i];
        const r = Math.hypot(p.x, p.z) || 1;
        leafTransforms.push({
          x: p.x + (p.x / r) * 0.35,
          y: p.y + 0.12,
          z: p.z + (p.z / r) * 0.35,
          s: sizeMin + rand() * (sizeMax - sizeMin),
          rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
        });
      }
    }

    const rootDefs = [
      { th: 1.22, sweep: -0.32, t0: 0.2, t1: 0.9, r0: 0.72, seed: 5.3 },
      { th: 1.72, sweep: 0.4, t0: 0.14, t1: 0.94, r0: 0.8, seed: 8.9 },
      { th: 2.3, sweep: -0.36, t0: 0.24, t1: 0.92, r0: 0.62, seed: 11.5 },
      { th: 3.0, sweep: 0.34, t0: 0.3, t1: 0.96, r0: 0.64, seed: 12.7 },
      { th: 3.75, sweep: -0.36, t0: 0.16, t1: 0.9, r0: 0.7, seed: 16.1 },
      { th: 4.55, sweep: 0.32, t0: 0.24, t1: 0.92, r0: 0.6, seed: 19.3 },
      { th: 5.3, sweep: -0.3, t0: 0.18, t1: 0.88, r0: 0.68, seed: 22.7 },
      { th: 1.46, sweep: 0.5, t0: 0.08, t1: 0.94, r0: 0.9, seed: 27.4 }
    ];
    const rootLeafSource = [];
    rootDefs.forEach((rd, idx) => {
      const pts = [], ths = [], ts = [];
      const N = 22;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const t = rd.t0 + (rd.t1 - rd.t0) * Math.pow(u, 0.92);
        const th = rd.th + rd.sweep * Math.pow(u, 0.9) + Math.sin(u * 4.2 + rd.seed) * 0.04;
        const rr = lerp(rd.r0, 0.12, Math.pow(u, 0.85));
        const embed = u < 0.12 ? (1 - u / 0.12) * 0.4 : 0;
        pts.push(rootSurfacePoint(th, t, 0.12 + rr * 0.55 + Math.sin(u * 7 + rd.seed) * 0.1 - embed));
        ths.push(th);
        ts.push(t);
      }
      mainGroup.add(makeRootGeometry(pts, rd.r0, 0.12, rd.seed, 8));
      addRootLeaves(pts, 2, 0.17, 0.28);
      rootLeafSource.push(pts);
      if (idx % 2 === 0) {
        const bi = Math.floor(N * 0.58);
        const bPts = [pts[bi].clone()];
        const side = idx % 4 === 0 ? 1 : -1;
        for (let k = 1; k <= 9; k++) {
          const u = k / 9;
          const th = ths[bi] + side * 0.22 * u + Math.sin(u * 4 + rd.seed) * 0.03;
          const t = Math.min(0.97, ts[bi] + 0.18 * u);
          bPts.push(rootSurfacePoint(th, t, 0.1 + 0.16 * (1 - u)));
        }
        mainGroup.add(makeRootGeometry(bPts, rd.r0 * 0.34, 0.05, rd.seed + 4.2, 6));
        addRootLeaves(bPts, 3, 0.14, 0.22);
      }
    });

    const hangDefs = [
      { th: 1.6, t0: 0.72, len: 5.5, seed: 31.7 },
      { th: 2.0, t0: 0.78, len: 9.0, seed: 42.1, r0: 0.46 },
      { th: 3.3, t0: 0.78, len: 6.5, seed: 35.3 },
      { th: 5.1, t0: 0.7, len: 4.5, seed: 38.9 }
    ];
    hangDefs.forEach((hg) => {
      const pts = [];
      const N = 18;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        if (u < 0.55) {
          const t = hg.t0 + (0.92 - hg.t0) * (u / 0.55);
          pts.push(rootSurfacePoint(hg.th + Math.sin(u * 3.1 + hg.seed) * 0.05, t, 0.1));
        } else {
          const last = pts[pts.length - 1];
          const drop = ((u - 0.55) / 0.45) * hg.len;
          pts.push(new THREE.Vector3(
            last.x + Math.sin(u * 7 + hg.seed) * 0.18,
            last.y - drop,
            last.z + Math.cos(u * 6 + hg.seed) * 0.18
          ));
        }
      }
      mainGroup.add(makeRootGeometry(pts, hg.r0 || 0.34, 0.045, hg.seed, 6));
      addRootLeaves(pts, 3, 0.13, 0.2);
      rootLeafSource.push(pts);
    });

    if (rootLeafSource.length > 0) {
      const rootMossCount = 54;
      const rootMoss = new THREE.InstancedMesh(mossGeo, mossMat, rootMossCount);
      const mossTint = new THREE.Color();
      for (let i = 0; i < rootMossCount; i++) {
        const pts = rootLeafSource[Math.floor(rand() * rootLeafSource.length)];
        const p = pts[Math.floor(rand() * pts.length)];
        const r = Math.hypot(p.x, p.z) || 1;
        dummy.position.set(p.x + (p.x / r) * 0.28, p.y + 0.15, p.z + (p.z / r) * 0.28);
        dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        const sm = 0.26 + rand() * 0.34;
        dummy.scale.set(sm, sm * 0.4, sm);
        dummy.updateMatrix();
        rootMoss.setMatrixAt(i, dummy.matrix);
        mossTint.setRGB(0.3 + rand() * 0.1, 0.4 + rand() * 0.12, 0.16 + rand() * 0.06);
        rootMoss.setColorAt(i, mossTint);
      }
      rootMoss.castShadow = false;
      rootMoss.receiveShadow = true;
      if (rootMoss.instanceColor) rootMoss.instanceColor.needsUpdate = true;
      mainGroup.add(rootMoss);
    }

    const leafPositions = [];
    const leafIndices = [];
    let leafBase = 0;
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3;
      const ca = Math.cos(a), sa = Math.sin(a);
      const pts = [
        [0, 0.02, 0.62], [-0.34, 0, 0.1], [0, 0, -0.62], [0.34, 0, 0.1]
      ];
      for (let q = 0; q < pts.length; q++) {
        leafPositions.push(pts[q][0] * ca - pts[q][2] * sa, pts[q][1], pts[q][0] * sa + pts[q][2] * ca);
      }
      leafIndices.push(leafBase, leafBase + 1, leafBase + 2, leafBase, leafBase + 2, leafBase + 3);
      leafBase += 4;
    }
    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(leafPositions, 3));
    leafGeo.setIndex(leafIndices);
    leafGeo.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true, side: THREE.DoubleSide, envMapIntensity: 0.3 });
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, Math.max(1, leafTransforms.length));
    const leafPalette = [0x517f32, 0x64983d, 0x446f2c, 0x74a848];
    leafTransforms.forEach((l, i) => {
      dummy.position.set(l.x, l.y, l.z);
      dummy.rotation.set(l.rx, l.ry, l.rz);
      dummy.scale.set(l.s * 0.8, l.s * 0.6, l.s * 1.0);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(leafPalette[Math.floor(rand() * leafPalette.length)]);
      c.multiplyScalar(0.85 + rand() * 0.3);
      leaves.setColorAt(i, c);
    });
    leaves.count = leafTransforms.length;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    mainGroup.add(leaves);
    // ---------- Small satellite island (about 1/10 area) ----------
    const miniIsland = new THREE.Group();
    miniIsland.position.set(27.5, -7.0, 16.0);
    scene.add(miniIsland);
    miniIsland.visible = includeMini;

    const MINI_SEG = 128;
    const MINI_RINGS = 40;
    const MINI_DEPTH = 10.0;
    const miniRingRadius = 4.7;
    const miniOutflowTheta = 0.95;
    const miniTmp = new THREE.Vector3();

    function miniRim(theta) {
      return 7.0 * (1 + 0.075 * Math.sin(3 * theta + 0.8) + 0.05 * Math.sin(5 * theta - 1.3) + 0.03 * Math.sin(7 * theta + 2.1));
    }

    function miniHeartField(x, z) {
      const hx = x / 2.45;
      const hz = -z / 2.2;
      const a = hx * hx + hz * hz - 1;
      return a * a * a - hx * hx * hz * hz * hz;
    }
    function miniInHeart(x, z) {
      return miniHeartField(x, z) < 0;
    }

    const miniStreamCtrl = [
      new THREE.Vector3(Math.cos(miniOutflowTheta) * (miniRingRadius + 0.05), 0, Math.sin(miniOutflowTheta) * (miniRingRadius + 0.05)),
      new THREE.Vector3(Math.cos(miniOutflowTheta + 0.05) * 5.5, 0, Math.sin(miniOutflowTheta + 0.05) * 5.5),
      new THREE.Vector3(Math.cos(miniOutflowTheta + 0.02) * 6.3, 0, Math.sin(miniOutflowTheta + 0.02) * 6.3),
      new THREE.Vector3(Math.cos(miniOutflowTheta) * miniRim(miniOutflowTheta) * 0.99, 0, Math.sin(miniOutflowTheta) * miniRim(miniOutflowTheta) * 0.99)
    ];
    const miniStreamCurve = new THREE.CatmullRomCurve3(miniStreamCtrl, false, 'centripetal');
    const miniStreamSamples = miniStreamCurve.getSpacedPoints(18);
    const miniStreamWater = miniStreamSamples.map((p, i) => {
      const t = i / (miniStreamSamples.length - 1);
      return lerp(1.15, 0.8, Math.pow(t, 0.9));
    });
    function miniStreamInfo(x, z) {
      let bestD = 1e9, bestY = 0;
      for (let i = 0; i < miniStreamSamples.length; i += 2) {
        const p = miniStreamSamples[i];
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < bestD) {
          bestD = d;
          bestY = miniStreamWater[i];
        }
      }
      return { d: bestD, y: bestY };
    }

    function miniLawnHeight(x, z) {
      const r = Math.hypot(x, z);
      let h = 1.2 + 0.2 * Math.exp(-Math.pow(r / 5.2, 2) * 1.2);
      h += (fbm(x * 0.45 + 3.1, z * 0.45 - 2.4, 2) - 0.5) * 0.07;
      h += 0.32 * smoothstep(miniRingRadius + 0.15, miniRingRadius - 0.75, r);
      return h;
    }

    function miniTerrainHeight(x, z) {
      let h = miniLawnHeight(x, z);
      const rn = Math.hypot(x, z) / miniRim(Math.atan2(z, x));
      h -= smoothstep(0.84, 1.0, rn) * 0.35;
      const si = miniStreamInfo(x, z);
      if (si.d < 0.9) {
        const channel = smoothstep(0.9, 0.15, si.d);
        h = lerp(h, si.y - 0.1, channel * 0.85);
      }
      const heartMask = smoothstep(0.12, -0.06, miniHeartField(x, z));
      h -= heartMask * 0.13;
      return h;
    }

    const miniColor = new THREE.Color();
    const miniRock = new THREE.Color();
    const miniSoilColor = new THREE.Color(0x3f2c1d).convertSRGBToLinear();
    function miniTerrainColor(x, z, h, slope) {
      const n = fbm(x * 0.45 + 2.1, z * 0.45 + 7.3, 3);
      miniColor.copy(COL.grassDark).lerp(COL.grassLight, clamp(0.25 + n * 0.8, 0, 1));
      miniColor.lerp(COL.grassDry, smoothstep(0.62, 0.86, n) * 0.2);
      miniRock.copy(COL.rock).lerp(COL.rockDark, n);
      miniColor.lerp(miniRock, smoothstep(0.8, 1.2, slope) * 0.28);
      const si = miniStreamInfo(x, z);
      miniColor.lerp(COL.sand, (1 - smoothstep(0.25, 0.85, si.d)) * 0.45);
      const heartMask = smoothstep(0.12, -0.06, miniHeartField(x, z));
      miniColor.lerp(miniSoilColor, heartMask * 0.9);
      miniColor.multiplyScalar(0.92 + n * 0.14);
      return miniColor;
    }

    const miniPositions = [];
    const miniColors = [];
    const miniUvs = [];
    const miniIndices = [];
    const miniCenterH = miniTerrainHeight(0, 0);
    miniPositions.push(0, miniCenterH, 0);
    const miniCenterColor = miniTerrainColor(0, 0, miniCenterH, 0);
    miniColors.push(miniCenterColor.r, miniCenterColor.g, miniCenterColor.b);
    miniUvs.push(0, 0);
    for (let i = 1; i <= MINI_RINGS; i++) {
      const t = i / MINI_RINGS;
      for (let j = 0; j < MINI_SEG; j++) {
        const theta = (j / MINI_SEG) * Math.PI * 2;
        const R = miniRim(theta) * t;
        const x = Math.cos(theta) * R;
        const z = Math.sin(theta) * R;
        const h = miniTerrainHeight(x, z);
        const e = 0.3;
        const hx = miniTerrainHeight(x + e, z);
        const hz = miniTerrainHeight(x, z + e);
        const slope = Math.hypot(hx - h, hz - h) / e;
        miniPositions.push(x, h, z);
        miniUvs.push(x / 6, z / 6);
        const c = miniTerrainColor(x, z, h, slope);
        miniColors.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < MINI_SEG; j++) {
      const a = 1 + j;
      const b = 1 + ((j + 1) % MINI_SEG);
      miniIndices.push(0, b, a);
    }
    for (let i = 1; i < MINI_RINGS; i++) {
      const rowA = 1 + (i - 1) * MINI_SEG;
      const rowB = 1 + i * MINI_SEG;
      for (let j = 0; j < MINI_SEG; j++) {
        const j2 = (j + 1) % MINI_SEG;
        const a = rowA + j, b = rowA + j2, c = rowB + j, d = rowB + j2;
        miniIndices.push(a, b, c);
        miniIndices.push(b, d, c);
      }
    }
    const miniTerrainGeo = new THREE.BufferGeometry();
    miniTerrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(miniPositions, 3));
    miniTerrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(miniColors, 3));
    miniTerrainGeo.setAttribute('uv', new THREE.Float32BufferAttribute(miniUvs, 2));
    miniTerrainGeo.setIndex(miniIndices);
    miniTerrainGeo.computeVertexNormals();
    const miniTerrain = new THREE.Mesh(miniTerrainGeo, terrainMaterial);
    miniTerrain.castShadow = true;
    miniTerrain.receiveShadow = true;
    miniIsland.add(miniTerrain);

    const lipPositions = [];
    const lipUvs = [];
    const lipIndices = [];
    for (let j = 0; j <= MINI_SEG; j++) {
      const th = (j / MINI_SEG) * Math.PI * 2;
      const rOuter = miniRim(th);
      const rInner = rOuter * 0.985;
      const xi = Math.cos(th) * rInner, zi = Math.sin(th) * rInner;
      const xo = Math.cos(th) * rOuter, zo = Math.sin(th) * rOuter;
      lipPositions.push(xi, miniTerrainHeight(xi, zi) + 0.035, zi);
      lipPositions.push(xo, miniTerrainHeight(xo, zo) + 0.02, zo);
      lipUvs.push(0, j * 0.5, 1, j * 0.5);
    }
    for (let j = 0; j < MINI_SEG; j++) {
      const a = j * 2, b = j * 2 + 1, c = j * 2 + 2, d = j * 2 + 3;
      lipIndices.push(a, c, b, b, c, d);
    }
    const miniLipGeo = new THREE.BufferGeometry();
    miniLipGeo.setAttribute('position', new THREE.Float32BufferAttribute(lipPositions, 3));
    miniLipGeo.setAttribute('uv', new THREE.Float32BufferAttribute(lipUvs, 2));
    miniLipGeo.setIndex(lipIndices);
    miniLipGeo.computeVertexNormals();
    const miniLipMat = new THREE.MeshStandardMaterial({
      map: grassTexture, color: 0x5f8c3e, roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    const miniLip = new THREE.Mesh(miniLipGeo, miniLipMat);
    miniLip.receiveShadow = true;
    miniIsland.add(miniLip);

    function miniCliffPoint(theta, t, target) {
      const rr = miniRim(theta);
      const bx = Math.cos(theta) * rr;
      const bz = Math.sin(theta) * rr;
      const rimY = miniTerrainHeight(bx, bz);
      let rf = 1 - 0.9 * Math.pow(smoothstep(0.2, 1, t), 1.2);
      rf += 0.055 * Math.sin(Math.PI * clamp(t / 0.4, 0, 1));
      const amp = smoothstep(0, 0.08, t);
      const n = fbm(Math.cos(theta) * 2.4 + 3.7, Math.sin(theta) * 2.4 - 1.2 + t * 2.0, 3);
      rf *= 1 + (0.12 * (n - 0.5) + 0.06 * (fbm(theta * 5.1 + 2.3, t * 6.1 + 4.4, 3) - 0.5)) * amp;
      rf += 0.045 * Math.sin(t * Math.PI * 8 + theta * 2.5) * (1 - t) * amp;
      const driftX = 0.9 * t * t, driftZ = -0.5 * t * t;
      const jag = (fbm(theta * 6.5, t * 20.0, 2) - 0.5) * 0.7 * amp;
      const y = rimY - (0.22 * t + 0.78 * Math.pow(t, 1.8)) * MINI_DEPTH + jag;
      target.set(bx * rf + driftX, y, bz * rf + driftZ);
      return target;
    }

    const MINI_CLIFF_LEVELS = 18;
    const miniCliffPos = [];
    const miniCliffCol = [];
    const miniCliffUvs = [];
    const miniCliffIndices = [];
    for (let i = 0; i <= MINI_CLIFF_LEVELS; i++) {
      const t = i / MINI_CLIFF_LEVELS;
      for (let j = 0; j < MINI_SEG; j++) {
        const theta = (j / MINI_SEG) * Math.PI * 2;
        miniCliffPoint(theta, t, miniTmp);
        miniCliffPos.push(miniTmp.x, miniTmp.y, miniTmp.z);
        miniCliffUvs.push((j / MINI_SEG) * 4, t * 3.5);
        const band = fbm(theta * 4.0 + 1.7, t * 6.0 + 3.1, 3);
        const dark = smoothstep(0.5, 0.82, fbm(theta * 6.2 + t * 4.0, t * 10.0, 3));
        const col = new THREE.Color(COL.cliffA).lerp(COL.cliffB, band);
        col.lerp(COL.cliffDark, dark * 0.55);
        const layer = 0.5 + 0.5 * Math.sin(t * 30.0 + 0.8 + fbm(theta * 2.0, t * 3.0, 2) * 1.8);
        col.lerp(COL.sand, 0.6 + layer * 0.24);
        col.lerp(COL.cliffDark, (1 - layer) * 0.09);
        const mossAmt = smoothstep(0.17, 0.01, t) * (0.35 + 0.5 * fbm(theta * 5.0, t * 9.0, 3));
        col.lerp(COL.moss, clamp(mossAmt, 0, 1) * 0.8);
        miniCliffCol.push(col.r, col.g, col.b);
      }
    }
    const miniBottomIndex = miniCliffPos.length / 3;
    miniCliffPos.push(0.9, miniTerrainHeight(Math.cos(0.9) * miniRim(0.9), Math.sin(0.9) * miniRim(0.9)) - MINI_DEPTH - 0.7, -0.5);
    miniCliffCol.push(COL.cliffDark.r, COL.cliffDark.g, COL.cliffDark.b);
    miniCliffUvs.push(0.5, 3.8);
    for (let i = 0; i < MINI_CLIFF_LEVELS; i++) {
      const rowA = i * MINI_SEG, rowB = (i + 1) * MINI_SEG;
      for (let j = 0; j < MINI_SEG; j++) {
        const j2 = (j + 1) % MINI_SEG;
        const a = rowA + j, b = rowA + j2, c = rowB + j, d = rowB + j2;
        miniCliffIndices.push(a, b, c);
        miniCliffIndices.push(b, d, c);
      }
    }
    const miniBottomRow = MINI_CLIFF_LEVELS * MINI_SEG;
    for (let j = 0; j < MINI_SEG; j++) {
      const j2 = (j + 1) % MINI_SEG;
      miniCliffIndices.push(miniBottomRow + j, miniBottomRow + j2, miniBottomIndex);
    }
    const miniCliffGeo = new THREE.BufferGeometry();
    miniCliffGeo.setAttribute('position', new THREE.Float32BufferAttribute(miniCliffPos, 3));
    miniCliffGeo.setAttribute('color', new THREE.Float32BufferAttribute(miniCliffCol, 3));
    miniCliffGeo.setAttribute('uv', new THREE.Float32BufferAttribute(miniCliffUvs, 2));
    miniCliffGeo.setIndex(miniCliffIndices);
    miniCliffGeo.computeVertexNormals();
    const miniCliff = new THREE.Mesh(miniCliffGeo, cliffMaterial);
    miniCliff.castShadow = true;
    miniCliff.receiveShadow = true;
    miniIsland.add(miniCliff);

    // Continuous layered lips around the underside, like exposed strata.
    const miniStrataTs = [0.14, 0.26, 0.38, 0.5, 0.62, 0.74, 0.86];
    const strataPositions = [];
    const strataColors = [];
    const strataIndices = [];
    const strataPalette = [0xc9baa0, 0xbbab90, 0xd6c7ad, 0xae9f86, 0xc3b398];
    miniStrataTs.forEach((t, row) => {
      const baseIndex = strataPositions.length / 3;
      for (let j = 0; j < MINI_SEG; j++) {
        const th = (j / MINI_SEG) * Math.PI * 2;
        miniCliffPoint(th, t, miniTmp);
        const rr = Math.hypot(miniTmp.x, miniTmp.z) || 1;
        const ox = miniTmp.x / rr, oz = miniTmp.z / rr;
        const lip = 0.16 + 0.06 * (0.5 + 0.5 * Math.sin(th * 7 + t * 20));
        strataPositions.push(miniTmp.x, miniTmp.y + 0.02, miniTmp.z);
        strataPositions.push(miniTmp.x + ox * lip, miniTmp.y - 0.03, miniTmp.z + oz * lip);
        const c = new THREE.Color(strataPalette[(row + j) % strataPalette.length]).convertSRGBToLinear();
        c.multiplyScalar(0.85 + 0.15 * fbm(th * 5 + 1.2, t * 9 + 3.4, 2));
        strataColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
      for (let j = 0; j < MINI_SEG; j++) {
        const j2 = (j + 1) % MINI_SEG;
        const a = baseIndex + j * 2;
        const b = baseIndex + j * 2 + 1;
        const c = baseIndex + j2 * 2;
        const d = baseIndex + j2 * 2 + 1;
        strataIndices.push(a, c, b, b, c, d);
      }
    });
    const miniStrataGeo = new THREE.BufferGeometry();
    miniStrataGeo.setAttribute('position', new THREE.Float32BufferAttribute(strataPositions, 3));
    miniStrataGeo.setAttribute('color', new THREE.Float32BufferAttribute(strataColors, 3));
    miniStrataGeo.setIndex(strataIndices);
    miniStrataGeo.computeVertexNormals();
    const miniStrataMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: rockTexture, vertexColors: true,
      roughness: 1, metalness: 0, side: THREE.DoubleSide,
      emissive: 0x3a3022, emissiveIntensity: 0.35
    });
    const miniStrata = new THREE.Mesh(miniStrataGeo, miniStrataMat);
    miniStrata.castShadow = true;
    miniStrata.receiveShadow = true;
    miniIsland.add(miniStrata);

    // Horizontal strata shelves protruding from the underside.
    const miniShelfRows = [0.3, 0.55, 0.8];
    const miniShelfPerRow = 12;
    const miniShelfCount = miniShelfRows.length * miniShelfPerRow;
    const miniShelfPalette = [0xc8b99c, 0xb9aa8d, 0xd4c5a8, 0xa89a80];
    const miniShelves = new THREE.InstancedMesh(boulderGeo, boulderMat, miniShelfCount);
    let miniShelfIndex = 0;
    miniShelfRows.forEach((t, row) => {
      for (let k = 0; k < miniShelfPerRow; k++) {
        const th = (k / miniShelfPerRow) * Math.PI * 2 + row * 0.21;
        miniCliffPoint(th, t, miniTmp);
        const rr = Math.hypot(miniTmp.x, miniTmp.z) || 1;
        const ox = miniTmp.x / rr, oz = miniTmp.z / rr;
        const sw = 0.24 + rand() * 0.18;
        dummy.position.set(miniTmp.x + ox * 0.06, miniTmp.y + 0.02, miniTmp.z + oz * 0.06);
        dummy.rotation.set((rand() - 0.5) * 0.25, rand() * 6.28, (rand() - 0.5) * 0.25);
        dummy.scale.set(sw, 0.11 + rand() * 0.06, 0.2 + rand() * 0.12);
        dummy.updateMatrix();
        miniShelves.setMatrixAt(miniShelfIndex, dummy.matrix);
        miniShelves.setColorAt(miniShelfIndex,
          new THREE.Color(miniShelfPalette[Math.floor(rand() * miniShelfPalette.length)]));
        miniShelfIndex++;
      }
    });
    if (miniShelves.instanceColor) miniShelves.instanceColor.needsUpdate = true;
    miniShelves.castShadow = true;
    miniShelves.receiveShadow = true;
    miniIsland.add(miniShelves);

    const pondNormalTexture = terrainNormalTexture.clone();
    pondNormalTexture.repeat.set(2, 2);
    pondNormalTexture.needsUpdate = true;
    const miniStreamMat = new THREE.MeshPhysicalMaterial({
      color: 0x4fa9bd,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      normalMap: pondNormalTexture,
      normalScale: new THREE.Vector2(0.22, 0.22),
      envMapIntensity: 0.55,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });

    // Blue-gray stone ring with a gap for the outflow.
    const stoneCanvas = document.createElement('canvas');
    stoneCanvas.width = stoneCanvas.height = 256;
    const stoneCtx = stoneCanvas.getContext('2d');
    stoneCtx.fillStyle = '#78b0b0';
    stoneCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      const x = rand() * 256, y = rand() * 256, rr = 8 + rand() * 42;
      const g = stoneCtx.createRadialGradient(x, y, 0, x, y, rr);
      const dark = rand() > 0.5;
      g.addColorStop(0, dark ? 'rgba(86,124,126,0.22)' : 'rgba(228,244,242,0.28)');
      g.addColorStop(1, dark ? 'rgba(86,124,126,0)' : 'rgba(228,244,242,0)');
      stoneCtx.fillStyle = g;
      stoneCtx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    for (let i = 0; i < 1200; i++) {
      const x = rand() * 256, y = rand() * 256;
      stoneCtx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(55,78,84,0.18)';
      stoneCtx.beginPath();
      stoneCtx.arc(x, y, 0.5 + rand() * 1.6, 0, Math.PI * 2);
      stoneCtx.fill();
    }
    stoneCtx.strokeStyle = 'rgba(62,86,92,0.38)';
    stoneCtx.lineWidth = 12;
    stoneCtx.strokeRect(6, 6, 244, 244);
    for (let i = 0; i < 9; i++) {
      let x = rand() * 256, y = rand() * 256;
      stoneCtx.strokeStyle = 'rgba(60,82,88,0.25)';
      stoneCtx.lineWidth = 1 + rand() * 2;
      stoneCtx.beginPath();
      stoneCtx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rand() - 0.5) * 60;
        y += (rand() - 0.5) * 60;
        stoneCtx.lineTo(x, y);
      }
      stoneCtx.stroke();
    }
    const stoneTexture = new THREE.CanvasTexture(stoneCanvas);
    stoneTexture.encoding = THREE.sRGBEncoding;
    stoneTexture.anisotropy = maxAniso;
    function roundedBoxGeometry(w, h, d, r, seg) {
      const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
      const pos = geo.attributes.position;
      const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const cx = Math.max(-hw, Math.min(hw, x));
        const cy = Math.max(-hh, Math.min(hh, y));
        const cz = Math.max(-hd, Math.min(hd, z));
        let nx = x - cx, ny = y - cy, nz = z - cz;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        pos.setXYZ(i, cx + nx * r, cy + ny * r, cz + nz * r);
      }
      geo.computeVertexNormals();
      return geo;
    }
    const ringBlockGeo = roundedBoxGeometry(1.38, 0.58, 0.95, 0.13, 4);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: stoneTexture,
      bumpMap: stoneTexture,
      bumpScale: 0.08,
      roughness: 0.95,
      metalness: 0,
      flatShading: false
    });
    const ringPalette = [0xa4d2d0, 0x94c8c9, 0x86bcbf, 0xb4dcd8, 0x7aafb3, 0x9ccacb];
    const ringBlocks = new THREE.InstancedMesh(ringBlockGeo, ringMat, 26);
    let ringIndex = 0;
    for (let i = 0; i < 26; i++) {
      const theta = (i / 26) * Math.PI * 2;
      if (Math.abs(angDiff(theta, miniOutflowTheta)) < 0.18) continue;
      const radial = miniRingRadius + (rand() - 0.5) * 0.06;
      const x = Math.cos(theta) * radial;
      const z = Math.sin(theta) * radial;
      const base = miniTerrainHeight(x, z);
      const blockScaleY = 0.9 + rand() * 0.2;
      dummy.position.set(x, base + 0.29 * blockScaleY + 0.01, z);
      dummy.rotation.set((rand() - 0.5) * 0.06, Math.PI / 2 - theta, (rand() - 0.5) * 0.06);
      const blockScale = 0.97 + rand() * 0.06;
      dummy.scale.set(blockScale, blockScaleY, blockScale);
      dummy.updateMatrix();
      ringBlocks.setMatrixAt(ringIndex, dummy.matrix);
      ringBlocks.setColorAt(ringIndex, new THREE.Color(ringPalette[Math.floor(rand() * ringPalette.length)]).convertSRGBToLinear());
      ringIndex++;
    }
    ringBlocks.count = ringIndex;
    if (ringBlocks.instanceColor) ringBlocks.instanceColor.needsUpdate = true;
    ringBlocks.castShadow = true;
    ringBlocks.receiveShadow = true;
    miniIsland.add(ringBlocks);

    const ringFoundationPalette = [0x8fb2b4, 0x7fa2a5, 0x9abbbd, 0x86aaad];
    const ringFoundation = new THREE.InstancedMesh(ringBlockGeo, ringMat, 18);
    let foundationIndex = 0;
    for (let i = 0; i < 18; i++) {
      const theta = (i / 18) * Math.PI * 2 + 0.08;
      if (Math.abs(angDiff(theta, miniOutflowTheta)) < 0.18) continue;
      const x = Math.cos(theta) * (miniRingRadius + 0.03);
      const z = Math.sin(theta) * (miniRingRadius + 0.03);
      const base = miniTerrainHeight(x, z);
      dummy.position.set(x, base + 0.1, z);
      dummy.rotation.set((rand() - 0.5) * 0.04, Math.PI / 2 - theta, (rand() - 0.5) * 0.04);
      dummy.scale.set(1.0, 0.42, 1.0);
      dummy.updateMatrix();
      ringFoundation.setMatrixAt(foundationIndex, dummy.matrix);
      ringFoundation.setColorAt(foundationIndex,
        new THREE.Color(ringFoundationPalette[Math.floor(rand() * ringFoundationPalette.length)]));
      foundationIndex++;
    }
    ringFoundation.count = foundationIndex;
    if (ringFoundation.instanceColor) ringFoundation.instanceColor.needsUpdate = true;
    ringFoundation.castShadow = true;
    ringFoundation.receiveShadow = true;
    miniIsland.add(ringFoundation);

    const ringBaseY = miniTerrainHeight(-miniRingRadius, 0);
    const mortarMat = new THREE.MeshStandardMaterial({
      color: 0x4a5c5e, roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    const mortarGeo = new THREE.CylinderGeometry(
      miniRingRadius + 0.02, miniRingRadius + 0.02, 0.52, 48, 1, true,
      0.84, Math.PI * 2 - 0.44
    );
    const mortar = new THREE.Mesh(mortarGeo, mortarMat);
    mortar.position.y = ringBaseY + 0.26;
    mortar.receiveShadow = true;
    miniIsland.add(mortar);

    const ringBaseGeo = new THREE.RingGeometry(4.2, 5.2, 48, 1, 1.17, Math.PI * 2 - 0.44);
    const ringBaseMesh = new THREE.Mesh(ringBaseGeo, new THREE.MeshStandardMaterial({
      color: 0x3e4d47, roughness: 1, metalness: 0, side: THREE.DoubleSide
    }));
    ringBaseMesh.rotation.x = -Math.PI / 2;
    ringBaseMesh.position.y = ringBaseY + 0.03;
    ringBaseMesh.receiveShadow = true;
    miniIsland.add(ringBaseMesh);

    const ringMossCount = 16;
    const ringMoss = new THREE.InstancedMesh(mossGeo, mossMat, ringMossCount);
    for (let i = 0; i < ringMossCount; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.3) a += 0.5;
      const x = Math.cos(a) * miniRingRadius;
      const z = Math.sin(a) * miniRingRadius;
      const base = miniTerrainHeight(x, z);
      dummy.position.set(x, base + 0.62, z);
      dummy.rotation.set((rand() - 0.5) * 0.4, rand() * 6.28, (rand() - 0.5) * 0.4);
      const sm = 0.09 + rand() * 0.12;
      dummy.scale.set(sm * 1.3, sm * 0.35, sm * 1.3);
      dummy.updateMatrix();
      ringMoss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(0x4e7c33).convertSRGBToLinear();
      c.multiplyScalar(0.8 + rand() * 0.35);
      ringMoss.setColorAt(i, c);
    }
    if (ringMoss.instanceColor) ringMoss.instanceColor.needsUpdate = true;
    miniIsland.add(ringMoss);

    const ringFaceMossCount = 16;
    const ringFaceMoss = new THREE.InstancedMesh(mossGeo, mossMat, ringFaceMossCount);
    for (let i = 0; i < ringFaceMossCount; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.35) a += 0.7;
      const rr = miniRingRadius + 0.33;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const base = miniTerrainHeight(Math.cos(a) * miniRingRadius, Math.sin(a) * miniRingRadius);
      dummy.position.set(x, base + 0.16 + (i % 2) * 0.3, z);
      dummy.rotation.set((rand() - 0.5) * 0.5, rand() * 6.28, (rand() - 0.5) * 0.5);
      const sm = 0.075 + rand() * 0.075;
      dummy.scale.set(sm * 1.2, sm * 0.55, sm * 0.7);
      dummy.updateMatrix();
      ringFaceMoss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(0x466f2f).convertSRGBToLinear();
      c.multiplyScalar(0.78 + rand() * 0.35);
      ringFaceMoss.setColorAt(i, c);
    }
    if (ringFaceMoss.instanceColor) ringFaceMoss.instanceColor.needsUpdate = true;
    miniIsland.add(ringFaceMoss);

    for (let i = 0; i < 6; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.4) a += 0.6;
      const x = Math.cos(a) * (miniRingRadius + 0.15);
      const z = Math.sin(a) * (miniRingRadius + 0.15);
      const base = miniTerrainHeight(x, z) + 0.62;
      const pts = [
        new THREE.Vector3(x, base, z),
        new THREE.Vector3(x * 1.02, base - 0.26, z * 1.02),
        new THREE.Vector3(x * 1.05, base - 0.58, z * 1.05)
      ];
      miniIsland.add(new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 7, 0.022, 3, false),
        vineMat
      ));
    }


    // Heart-shaped tilled soil in the middle of the lawn.
    const soilCanvas = document.createElement('canvas');
    soilCanvas.width = soilCanvas.height = 256;
    const soilCtx = soilCanvas.getContext('2d');
    soilCtx.fillStyle = '#352317';
    soilCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 520; i++) {
      const x = rand() * 256, y = rand() * 256;
      soilCtx.fillStyle = rand() > 0.5 ? 'rgba(115,84,55,0.35)' : 'rgba(30,20,12,0.35)';
      soilCtx.beginPath();
      soilCtx.ellipse(x, y, 0.8 + rand() * 2.8, 0.6 + rand() * 1.8, rand() * 3, 0, Math.PI * 2);
      soilCtx.fill();
    }
    for (let i = 0; i < 14; i++) {
      let x = rand() * 256, y = rand() * 256;
      soilCtx.strokeStyle = 'rgba(35,23,14,0.35)';
      soilCtx.lineWidth = 1.2 + rand() * 2;
      soilCtx.beginPath();
      soilCtx.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (rand() - 0.5) * 55;
        y += (rand() - 0.5) * 40;
        soilCtx.lineTo(x, y);
      }
      soilCtx.stroke();
    }
    for (let row = 0; row < 16; row++) {
      const y0 = 10 + row * 15.5;
      soilCtx.strokeStyle = 'rgba(20,11,6,0.68)';
      soilCtx.lineWidth = 3.2;
      soilCtx.beginPath();
      for (let x = 0; x <= 256; x += 8) {
        const yy = y0 + Math.sin(x * 0.07 + row * 0.9) * 2.6;
        if (x === 0) soilCtx.moveTo(x, yy); else soilCtx.lineTo(x, yy);
      }
      soilCtx.stroke();
      soilCtx.strokeStyle = 'rgba(158,120,82,0.32)';
      soilCtx.lineWidth = 1.4;
      soilCtx.beginPath();
      for (let x = 0; x <= 256; x += 8) {
        const yy = y0 + 3 + Math.sin(x * 0.07 + row * 0.9) * 2.6;
        if (x === 0) soilCtx.moveTo(x, yy); else soilCtx.lineTo(x, yy);
      }
      soilCtx.stroke();
    }
    const soilTexture = new THREE.CanvasTexture(soilCanvas);
    soilTexture.encoding = THREE.sRGBEncoding;
    soilTexture.anisotropy = maxAniso;

    const heartShape = new THREE.Shape();
    heartShape.moveTo(0, -2.25);
    heartShape.bezierCurveTo(-2.5, -0.5, -2.4, 2.1, -0.85, 2.1);
    heartShape.bezierCurveTo(-0.35, 2.1, 0, 1.25, 0, 0.82);
    heartShape.bezierCurveTo(0, 1.25, 0.35, 2.1, 0.85, 2.1);
    heartShape.bezierCurveTo(2.4, 2.1, 2.5, -0.5, 0, -2.25);
    const heartGeo = new THREE.ShapeGeometry(heartShape, 32);
    heartGeo.rotateX(-Math.PI / 2);
    const heartPos = heartGeo.attributes.position;
    for (let i = 0; i < heartPos.count; i++) {
      const px = heartPos.getX(i), pz = heartPos.getZ(i);
      const n = fbm(px * 1.8 + 2.3, pz * 1.8 - 1.7, 2) - 0.5;
      heartPos.setY(i, heartPos.getY(i) + n * 0.04);
    }
    heartGeo.computeVertexNormals();
    const heartMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: soilTexture,
      bumpMap: soilTexture,
      bumpScale: 0.06,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const heartBorderMat = new THREE.MeshStandardMaterial({
      color: 0x4a3122,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide
    });
    const heartBorder = new THREE.Mesh(heartGeo, heartBorderMat);
    heartBorder.scale.set(1.055, 1.055, 1);
    heartBorder.position.set(0, miniTerrainHeight(0, 0) + 0.015, 0);
    heartBorder.receiveShadow = true;
    miniIsland.add(heartBorder);
    const heartMesh = new THREE.Mesh(heartGeo, heartMat);
    heartMesh.position.set(0, miniTerrainHeight(0, 0) + 0.035, 0);
    heartMesh.receiveShadow = true;
    miniIsland.add(heartMesh);

    // Stream from the ring gap to the rim.
    const streamPositions = [];
    const streamUvs = [];
    const streamIndices = [];
    for (let i = 0; i < miniStreamSamples.length; i++) {
      const p = miniStreamSamples[i];
      const prev = miniStreamSamples[Math.max(0, i - 1)];
      const next = miniStreamSamples[Math.min(miniStreamSamples.length - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;
      const w = 0.3 + 0.05 * (0.5 + 0.5 * Math.sin(i * 1.7 + 0.4));
      const y = miniStreamWater[i];
      streamPositions.push(p.x + nx * w * 0.5, y, p.z + nz * w * 0.5);
      streamPositions.push(p.x - nx * w * 0.5, y, p.z - nz * w * 0.5);
      streamUvs.push(0, i / (miniStreamSamples.length - 1), 1, i / (miniStreamSamples.length - 1));
      if (i < miniStreamSamples.length - 1) {
        const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
        streamIndices.push(a, b, c);
        streamIndices.push(b, d, c);
      }
    }
    const miniStreamGeo = new THREE.BufferGeometry();
    miniStreamGeo.setAttribute('position', new THREE.Float32BufferAttribute(streamPositions, 3));
    miniStreamGeo.setAttribute('uv', new THREE.Float32BufferAttribute(streamUvs, 2));
    miniStreamGeo.setIndex(streamIndices);
    miniStreamGeo.computeVertexNormals();
    miniStreamMat.userData.waterEnv = true;
    const miniStreamMesh = new THREE.Mesh(miniStreamGeo, miniStreamMat);
    miniStreamMesh.receiveShadow = true;
    miniIsland.add(miniStreamMesh);

    const miniStreamFoamTex = waterFoamTexture.clone();
    miniStreamFoamTex.repeat.set(1, 3);
    miniStreamFoamTex.needsUpdate = true;
    const miniStreamFoamMat = new THREE.MeshBasicMaterial({
      map: miniStreamFoamTex,
      color: 0xdff8ff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const miniStreamFoam = new THREE.Mesh(miniStreamGeo, miniStreamFoamMat);
    miniStreamFoam.position.y = 0.02;
    miniStreamFoam.renderOrder = 2;
    miniIsland.add(miniStreamFoam);

    // Waterfall where the stream leaves the island.
    const miniFall = new THREE.Group();
    const fallEnd = miniStreamSamples[miniStreamSamples.length - 1];
    const fallOutX = Math.cos(miniOutflowTheta);
    const fallOutZ = Math.sin(miniOutflowTheta);
    const fallTop = miniStreamWater[miniStreamWater.length - 1];
    miniFall.position.set(fallEnd.x, fallTop, fallEnd.z);
    miniFall.rotation.y = Math.atan2(fallOutX, fallOutZ);
    miniFall.add(makeWaterfallSheet(0.6, 1.05, 13.2, 1.7, 0.78, 0.12));
    miniFall.add(makeWaterfallSheet(0.72, 1.2, 12.8, 2.5, 0.35, 0.2));
    miniFall.add(makeWaterfallSheet(0.3, 0.58, 13.0, 3.2, 0.55, 0.28));
    miniFall.add(makeWaterfallSheet(0.9, 1.55, 12.7, 1.2, 0.15, 0.04));
    miniIsland.add(miniFall);

    const miniLipFoam = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({
        map: waterFoamTexture,
        color: 0xf4fbff,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    miniLipFoam.rotation.x = -Math.PI / 2;
    miniLipFoam.position.set(fallEnd.x, fallTop + 0.02, fallEnd.z);
    miniLipFoam.scale.set(1.4, 0.9, 1);
    miniIsland.add(miniLipFoam);

    for (let i = 0; i < 3; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTexture,
        color: 0xeaf4fa,
        transparent: true,
        opacity: 0.28,
        depthWrite: false
      }));
      sprite.position.set(
        fallEnd.x + fallOutX * (0.2 + rand() * 0.7),
        fallTop - 10.5 - rand() * 2.0,
        fallEnd.z + fallOutZ * (0.2 + rand() * 0.7)
      );
      const sc = 1.8 + rand() * 1.8;
      sprite.scale.set(sc, sc * 0.7, 1);
      miniIsland.add(sprite);
    }

    for (let i = 0; i < 5; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTexture,
        color: 0xeaf4fa,
        transparent: true,
        opacity: 0.16 + rand() * 0.12,
        depthWrite: false
      }));
      const along = rand();
      sprite.position.set(
        fallEnd.x + fallOutX * (0.15 + rand() * 0.55),
        fallTop - 0.6 - along * 6.0,
        fallEnd.z + fallOutZ * (0.15 + rand() * 0.55)
      );
      const sc = 0.7 + rand() * 1.2;
      sprite.scale.set(sc, sc * 0.7, 1);
      miniIsland.add(sprite);
    }

    // Rounded blue-gray boulders on the outer lawn.
    const miniBoulderGeo = new THREE.IcosahedronGeometry(1, 2);
    const miniBoulderPos = miniBoulderGeo.attributes.position;
    for (let i = 0; i < miniBoulderPos.count; i++) {
      const vx = miniBoulderPos.getX(i), vy = miniBoulderPos.getY(i), vz = miniBoulderPos.getZ(i);
      const n = 1 + (fbm(vx * 1.6 + 4.2, vz * 1.6 - 2.1, 2) - 0.5) * 0.3
                  + (fbm(vy * 2.0 + 1.3, vx * 2.0 + 3.7, 2) - 0.5) * 0.16;
      miniBoulderPos.setXYZ(i, vx * n, vy * n * 0.88, vz * n);
    }
    miniBoulderGeo.computeVertexNormals();
    const miniBoulderMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.07,
      roughness: 0.95, metalness: 0, flatShading: false
    });
    const miniBoulderCount = 6;
    const miniBoulderPalette = [0x7f9fa2, 0x6f8f93, 0x8fadaf, 0x5f7f84, 0x86a4a7];
    const miniBoulders = new THREE.InstancedMesh(miniBoulderGeo, miniBoulderMat, miniBoulderCount);
    const miniBoulderSpots = [];
    for (let i = 0; i < miniBoulderCount; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.4) a += 0.55;
      const R = miniRingRadius + 0.9 + rand() * 0.6;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const h = miniTerrainHeight(x, z);
      const sc = 0.55 + rand() * 0.35;
      dummy.position.set(x, h + sc * 0.22, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * (0.6 + rand() * 0.3), sc);
      dummy.updateMatrix();
      miniBoulders.setMatrixAt(i, dummy.matrix);
      miniBoulders.setColorAt(i, new THREE.Color(miniBoulderPalette[Math.floor(rand() * miniBoulderPalette.length)]).convertSRGBToLinear());
      miniBoulderSpots.push({ x, z, h, sc });
    }
    if (miniBoulders.instanceColor) miniBoulders.instanceColor.needsUpdate = true;
    miniBoulders.castShadow = true;
    miniBoulders.receiveShadow = true;
    miniIsland.add(miniBoulders);

    const miniBoulderMoss = new THREE.InstancedMesh(mossGeo, mossMat, miniBoulderSpots.length);
    miniBoulderSpots.forEach((b, i) => {
      dummy.position.set(b.x, b.h + b.sc * 0.82, b.z);
      dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3);
      const sm = 0.14 + rand() * 0.1;
      dummy.scale.set(sm * 1.3, sm * 0.35, sm * 1.3);
      dummy.updateMatrix();
      miniBoulderMoss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(0x4e7c33).convertSRGBToLinear();
      c.multiplyScalar(0.8 + rand() * 0.3);
      miniBoulderMoss.setColorAt(i, c);
    });
    if (miniBoulderMoss.instanceColor) miniBoulderMoss.instanceColor.needsUpdate = true;
    miniIsland.add(miniBoulderMoss);

    const miniStreamRockCount = 22;
    const miniStreamRocks = new THREE.InstancedMesh(miniBoulderGeo, miniBoulderMat, miniStreamRockCount);
    for (let i = 0; i < miniStreamRockCount; i++) {
      const si = 2 + Math.floor(rand() * (miniStreamSamples.length - 4));
      const p0 = miniStreamSamples[si];
      const prev = miniStreamSamples[Math.max(0, si - 1)];
      const next = miniStreamSamples[Math.min(miniStreamSamples.length - 1, si + 1)];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len, nz = tx / len;
      const side = (i % 2 === 0 ? 1 : -1) * (0.2 + rand() * 0.2);
      const x = p0.x + nx * side, z = p0.z + nz * side;
      const y = miniStreamWater[si] - 0.03;
      const sc = 0.06 + rand() * 0.08;
      dummy.position.set(x, y, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * (0.6 + rand() * 0.3), sc);
      dummy.updateMatrix();
      miniStreamRocks.setMatrixAt(i, dummy.matrix);
      miniStreamRocks.setColorAt(i,
        new THREE.Color(miniBoulderPalette[Math.floor(rand() * miniBoulderPalette.length)]).convertSRGBToLinear());
    }
    if (miniStreamRocks.instanceColor) miniStreamRocks.instanceColor.needsUpdate = true;
    miniStreamRocks.castShadow = true;
    miniStreamRocks.receiveShadow = true;
    miniIsland.add(miniStreamRocks);

    // Small spring basin just outside the ring gap.
    const springR = 5.35;
    const springX = Math.cos(miniOutflowTheta) * springR;
    const springZ = Math.sin(miniOutflowTheta) * springR;
    const springWaterY = miniStreamInfo(springX, springZ).y + 0.02;
    const miniSpringMat = miniStreamMat.clone();
    miniSpringMat.userData.waterEnv = true;
    miniSpringMat.color.set(0x5bbfcf);
    miniSpringMat.opacity = 0.74;
    miniSpringMat.roughness = 0.05;
    miniSpringMat.clearcoat = 0.9;
    miniSpringMat.normalScale.set(0.18, 0.18);
    const springGeo = new THREE.CircleGeometry(0.72, 32);
    springGeo.rotateX(-Math.PI / 2);
    const springPool = new THREE.Mesh(springGeo, miniSpringMat);
    springPool.position.set(springX, springWaterY, springZ);
    springPool.scale.set(1.35, 1, 0.95);
    springPool.receiveShadow = true;
    miniIsland.add(springPool);

    const springStoneCount = 12;
    const springStones = new THREE.InstancedMesh(miniBoulderGeo, miniBoulderMat, springStoneCount);
    for (let i = 0; i < springStoneCount; i++) {
      const a = (i / springStoneCount) * Math.PI * 2 + rand() * 0.12;
      const rr = 0.8 + rand() * 0.18;
      const x = springX + Math.cos(a) * rr;
      const z = springZ + Math.sin(a) * rr;
      const h = miniTerrainHeight(x, z);
      const sc = 0.08 + rand() * 0.1;
      dummy.position.set(x, h + sc * 0.2, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * 0.6, sc);
      dummy.updateMatrix();
      springStones.setMatrixAt(i, dummy.matrix);
      springStones.setColorAt(i,
        new THREE.Color(miniBoulderPalette[Math.floor(rand() * miniBoulderPalette.length)]).convertSRGBToLinear());
    }
    if (springStones.instanceColor) springStones.instanceColor.needsUpdate = true;
    springStones.castShadow = true;
    springStones.receiveShadow = true;
    miniIsland.add(springStones);

    const miniSpringBubbles = [];
    for (let i = 0; i < 5; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softTexture,
        color: 0xe8fbff,
        transparent: true,
        opacity: 0.25,
        depthWrite: false
      }));
      const a = rand() * Math.PI * 2;
      const rr = rand() * 0.35;
      sprite.position.set(
        springX + Math.cos(a) * rr,
        springWaterY + 0.05 + rand() * 0.08,
        springZ + Math.sin(a) * rr
      );
      const sc = 0.18 + rand() * 0.22;
      sprite.scale.set(sc, sc * 0.7, 1);
      sprite.userData.baseY = sprite.position.y;
      sprite.userData.baseScale = sc;
      sprite.userData.phase = rand() * 6.28;
      miniSpringBubbles.push(sprite);
      miniIsland.add(sprite);
    }

    const miniSpringRipples = [];
    for (let i = 0; i < 3; i++) {
      const ripple = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.13, 24),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false
        })
      );
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(
        springX + (rand() - 0.5) * 0.2,
        springWaterY + 0.035,
        springZ + (rand() - 0.5) * 0.2
      );
      ripple.userData.phase = i / 3 + rand() * 0.1;
      miniSpringRipples.push(ripple);
      miniIsland.add(ripple);
    }

    const miniBedPebbleCount = 20;
    const miniBedPebbles = new THREE.InstancedMesh(miniBoulderGeo, miniBoulderMat, miniBedPebbleCount);
    for (let i = 0; i < miniBedPebbleCount; i++) {
      const si = 2 + Math.floor(rand() * (miniStreamSamples.length - 4));
      const p0 = miniStreamSamples[si];
      const prev = miniStreamSamples[Math.max(0, si - 1)];
      const next = miniStreamSamples[Math.min(miniStreamSamples.length - 1, si + 1)];
      const tx = next.x - prev.x, tz = next.z - prev.z;
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len, nz = tx / len;
      const side = (rand() - 0.5) * 0.24;
      const x = p0.x + nx * side, z = p0.z + nz * side;
      const y = miniStreamWater[si] - 0.025;
      const sc = 0.035 + rand() * 0.05;
      dummy.position.set(x, y, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * 0.65, sc);
      dummy.updateMatrix();
      miniBedPebbles.setMatrixAt(i, dummy.matrix);
      miniBedPebbles.setColorAt(i,
        new THREE.Color(miniBoulderPalette[Math.floor(rand() * miniBoulderPalette.length)]).convertSRGBToLinear());
    }
    if (miniBedPebbles.instanceColor) miniBedPebbles.instanceColor.needsUpdate = true;
    miniBedPebbles.receiveShadow = true;
    miniIsland.add(miniBedPebbles);

    // Floating stones with hanging vines.
    const floatDefs = [
      { x: -8.2, y: -1.2, z: 2.0, s: 0.7 },
      { x: 0.0, y: -2.6, z: 8.6, s: 0.55 },
      { x: -6.0, y: -3.2, z: -5.2, s: 0.6 },
      { x: 7.6, y: -2.2, z: 5.8, s: 0.5 }
    ];
    const floatVineCurves = [];
    const floatRocks = new THREE.InstancedMesh(miniBoulderGeo, miniBoulderMat, floatDefs.length);
    floatDefs.forEach((fd, i) => {
      dummy.position.set(fd.x, fd.y, fd.z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(fd.s, fd.s * 0.8, fd.s);
      dummy.updateMatrix();
      floatRocks.setMatrixAt(i, dummy.matrix);
      floatRocks.setColorAt(i, new THREE.Color(miniBoulderPalette[i % miniBoulderPalette.length]).convertSRGBToLinear());
      const pts = [
        new THREE.Vector3(fd.x, fd.y - fd.s * 0.45, fd.z),
        new THREE.Vector3(fd.x + (rand() - 0.5) * 0.45, fd.y - fd.s * 1.3, fd.z + (rand() - 0.5) * 0.45),
        new THREE.Vector3(fd.x + (rand() - 0.5) * 0.65, fd.y - fd.s * 2.2, fd.z + (rand() - 0.5) * 0.65)
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      floatVineCurves.push(curve);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 8, 0.025, 3, false),
        vineMat
      );
      miniIsland.add(tube);
    });
    if (floatRocks.instanceColor) floatRocks.instanceColor.needsUpdate = true;
    miniIsland.add(floatRocks);

    const floatMoss = new THREE.InstancedMesh(mossGeo, mossMat, floatDefs.length);
    floatDefs.forEach((fd, i) => {
      dummy.position.set(fd.x, fd.y + fd.s * 0.68, fd.z);
      dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3);
      const sm = 0.12 + rand() * 0.06;
      dummy.scale.set(sm * 1.3, sm * 0.4, sm * 1.3);
      dummy.updateMatrix();
      floatMoss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(0x4e7c33).convertSRGBToLinear();
      c.multiplyScalar(0.8 + rand() * 0.3);
      floatMoss.setColorAt(i, c);
    });
    if (floatMoss.instanceColor) floatMoss.instanceColor.needsUpdate = true;
    miniIsland.add(floatMoss);

    const miniBladeTexture = canvasTexture(256, (ctx, size) => {
      ctx.clearRect(0, 0, size, size);
      const base = ctx.createLinearGradient(0, size, 0, size - 38);
      base.addColorStop(0, 'rgba(92,140,58,0.12)');
      base.addColorStop(1, 'rgba(92,140,58,0)');
      ctx.fillStyle = base;
      ctx.fillRect(0, size - 38, size, 38);
      const blades = 46;
      for (let i = 0; i < blades; i++) {
        const x0 = 10 + i * (236 / blades) + (rand() - 0.5) * 9;
        const hh = 96 + rand() * 136;
        const wd = 2.4 + rand() * 3.0;
        const bend = (rand() - 0.5) * 30;
        const gr = ctx.createLinearGradient(0, size, 0, size - hh);
        gr.addColorStop(0, 'rgba(92,138,56,0.86)');
        gr.addColorStop(0.45, 'rgba(132,180,78,0.95)');
        gr.addColorStop(1, 'rgba(205,236,152,1)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.moveTo(x0 - wd, size);
        ctx.quadraticCurveTo(x0 - wd * 0.35 + bend * 0.4, size - hh * 0.55, x0 + bend, size - hh);
        ctx.quadraticCurveTo(x0 + wd * 0.35 + bend * 0.4, size - hh * 0.55, x0 + wd, size);
        ctx.closePath();
        ctx.fill();
      }
    });
    miniBladeTexture.wrapS = miniBladeTexture.wrapT = THREE.ClampToEdgeWrapping;
    const miniGrassCount = 1200;
    const miniGrassMaterial = grassCardMaterial.clone();
    miniGrassMaterial.map = miniBladeTexture;
    miniGrassMaterial.color.setRGB(1.05, 1.06, 0.98);
    miniGrassMaterial.emissive = new THREE.Color(0x223318).convertSRGBToLinear();
    miniGrassMaterial.emissiveIntensity = 0.25;
    miniGrassMaterial.onBeforeCompile = grassCardMaterial.onBeforeCompile;
    miniGrassMaterial.customProgramCacheKey = () => 'miniGrassCard';
    miniGrassMaterial.needsUpdate = true;
    const miniGrassGeometry = grassCardGeometry.clone();
    const miniGrassPhases = new Float32Array(miniGrassCount);
    const miniGrass = new THREE.InstancedMesh(miniGrassGeometry, miniGrassMaterial, miniGrassCount);
    const miniGrassTint = new THREE.Color();
    let miniGrassPlaced = 0, miniGrassTries = 0;
    while (miniGrassPlaced < miniGrassCount && miniGrassTries < 16000) {
      miniGrassTries++;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * miniRim(theta) * 0.96;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const h = miniTerrainHeight(x, z);
      const rrMini = Math.hypot(x, z);
      if (miniInHeart(x, z)) continue;
      if (Math.abs(rrMini - miniRingRadius) < 0.5) continue;
      if (miniStreamInfo(x, z).d < 0.6) continue;
      const e = 0.25;
      const slope = Math.hypot(miniTerrainHeight(x + e, z) - h, miniTerrainHeight(x, z + e) - h) / e;
      if (slope > 1.2) continue;
      if (rand() > 0.55 + 0.45 * fbm(x * 0.35 + 3.0, z * 0.35 - 1.0, 2)) continue;
      const sc = 0.06 + rand() * 0.06;
      dummy.position.set(x, h - 0.04, z);
      dummy.rotation.set((rand() - 0.5) * 0.1, rand() * 6.283, (rand() - 0.5) * 0.1);
      dummy.scale.set(sc * (0.9 + rand() * 0.2), sc * (0.8 + rand() * 0.35), sc * (0.9 + rand() * 0.2));
      dummy.updateMatrix();
      miniGrass.setMatrixAt(miniGrassPlaced, dummy.matrix);
      miniGrassTint.setRGB(0.95 + rand() * 0.08, 1.0, 0.85 + rand() * 0.08);
      miniGrassTint.multiplyScalar(0.95 + rand() * 0.1);
      miniGrass.setColorAt(miniGrassPlaced, miniGrassTint);
      miniGrassPhases[miniGrassPlaced] = x * 0.2 + z * 0.17 + rand() * 0.7;
      miniGrassPlaced++;
    }
    miniGrass.count = miniGrassPlaced;
    if (miniGrass.instanceColor) miniGrass.instanceColor.needsUpdate = true;
    miniGrassGeometry.setAttribute('aPh', new THREE.InstancedBufferAttribute(miniGrassPhases, 1));
    miniGrass.receiveShadow = false;
    miniGrass.castShadow = false;
    miniIsland.add(miniGrass);

    const miniFlowerCount = 240;
    const miniFlowerPalette = [0xf7f4ef, 0xffd9e5, 0xd9a7ff, 0xfff2b8, 0xf2c4d8, 0xb18cff, 0xffc7dd, 0xc78bff];
    const miniFlowerClusters = [];
    for (let i = 0; i < 12; i++) {
      let a = rand() * Math.PI * 2;
      if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.3) a += 0.5;
      const r = 5.2 + rand() * 1.5;
      miniFlowerClusters.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    const miniStemGeo = new THREE.CylinderGeometry(0.008, 0.012, 1, 3);
    const miniStemMat = new THREE.MeshStandardMaterial({ color: 0x4f7a2e, roughness: 1, metalness: 0 });
    const miniStems = new THREE.InstancedMesh(miniStemGeo, miniStemMat, miniFlowerCount);
    const miniFlowerCenterGeo = new THREE.IcosahedronGeometry(0.045, 0);
    const miniFlowerCenterMat = new THREE.MeshStandardMaterial({
      color: 0xffd85e, roughness: 0.8, metalness: 0,
      emissive: 0x3a2a00, emissiveIntensity: 0.2
    });
    const miniFlowerCenters = new THREE.InstancedMesh(miniFlowerCenterGeo, miniFlowerCenterMat, miniFlowerCount);
    const miniFlowers = new THREE.InstancedMesh(flowerGeo, flowerMat, miniFlowerCount);
    let miniFlowerPlaced = 0, miniFlowerTries = 0;
    while (miniFlowerPlaced < miniFlowerCount && miniFlowerTries < 4200) {
      miniFlowerTries++;
      let x, z;
      if (rand() < 0.68) {
        const c = miniFlowerClusters[Math.floor(rand() * miniFlowerClusters.length)];
        const a = rand() * Math.PI * 2;
        const rr = Math.sqrt(rand()) * 0.9;
        x = c.x + Math.cos(a) * rr;
        z = c.z + Math.sin(a) * rr;
      } else {
        const theta = rand() * Math.PI * 2;
        const r = Math.sqrt(rand()) * miniRim(theta) * 0.94;
        x = Math.cos(theta) * r;
        z = Math.sin(theta) * r;
      }
      const h = miniTerrainHeight(x, z);
      const rrMini = Math.hypot(x, z);
      if (rrMini > miniRim(Math.atan2(z, x)) * 0.97) continue;
      if (miniInHeart(x, z)) continue;
      if (Math.abs(rrMini - miniRingRadius) < 0.45) continue;
      if (miniStreamInfo(x, z).d < 0.45) continue;
      const e = 0.25;
      const slope = Math.hypot(miniTerrainHeight(x + e, z) - h, miniTerrainHeight(x, z + e) - h) / e;
      if (slope > 0.9) continue;
      if (rrMini < miniRingRadius - 0.05 && rand() < 0.62) continue;
      const stemH = 0.12 + rand() * 0.16;
      const sc = 0.45 + rand() * 0.35;
      dummy.position.set(x, h + stemH * 0.5, z);
      dummy.rotation.set(0, rand() * 6.28, 0);
      dummy.scale.set(1, stemH, 1);
      dummy.updateMatrix();
      miniStems.setMatrixAt(miniFlowerPlaced, dummy.matrix);
      dummy.position.set(x, h + stemH + 0.02, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * 0.8, sc);
      dummy.updateMatrix();
      miniFlowers.setMatrixAt(miniFlowerPlaced, dummy.matrix);
      miniFlowers.setColorAt(miniFlowerPlaced, new THREE.Color(miniFlowerPalette[Math.floor(rand() * miniFlowerPalette.length)]));
      dummy.position.set(x, h + stemH + 0.035, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.setScalar(0.7);
      dummy.updateMatrix();
      miniFlowerCenters.setMatrixAt(miniFlowerPlaced, dummy.matrix);
      miniFlowerPlaced++;
    }
    miniFlowers.count = miniFlowerPlaced;
    miniStems.count = miniFlowerPlaced;
    miniFlowerCenters.count = miniFlowerPlaced;
    if (miniFlowers.instanceColor) miniFlowers.instanceColor.needsUpdate = true;
    miniIsland.add(miniStems, miniFlowers, miniFlowerCenters);

    const miniPebbleCount = 46;
    const miniPebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, miniPebbleCount);
    const miniPebblePalette = [0xb5a98f, 0x948a78, 0xc6bba4, 0x7d7566];
    for (let i = 0; i < miniPebbleCount; i++) {
      let x, z;
      if (i < 26) {
        let a = rand() * Math.PI * 2;
        if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.3) a += 0.45;
        const R = miniRingRadius + 0.55 + rand() * 0.4;
        x = Math.cos(a) * R;
        z = Math.sin(a) * R;
      } else {
        let a = rand() * Math.PI * 2;
        if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.3) a += 0.45;
        const R = miniRingRadius + 0.9 + rand() * 1.2;
        x = Math.cos(a) * R;
        z = Math.sin(a) * R;
      }
      const h = miniTerrainHeight(x, z);
      const sc = 0.25 + rand() * 0.4;
      dummy.position.set(x, h + sc * 0.08, z);
      dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      dummy.scale.set(sc, sc * (0.6 + rand() * 0.4), sc);
      dummy.updateMatrix();
      miniPebbles.setMatrixAt(i, dummy.matrix);
      miniPebbles.setColorAt(i, new THREE.Color(miniPebblePalette[Math.floor(rand() * miniPebblePalette.length)]));
    }
    if (miniPebbles.instanceColor) miniPebbles.instanceColor.needsUpdate = true;
    miniPebbles.castShadow = true;
    miniPebbles.receiveShadow = true;
    miniIsland.add(miniPebbles);

    const miniMossCount = 26;
    const miniMoss = new THREE.InstancedMesh(mossGeo, mossMat, miniMossCount);
    for (let i = 0; i < miniMossCount; i++) {
      let a = rand() * Math.PI * 2;
      let R;
      if (i < 14) {
        if (Math.abs(angDiff(a, miniOutflowTheta)) < 0.25) a += 0.4;
        R = miniRingRadius + (rand() > 0.5 ? 0.28 : -0.28);
      } else {
        R = miniRim(a) * (0.95 + rand() * 0.05);
      }
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const h = miniTerrainHeight(x, z);
      const sc = 0.12 + rand() * 0.18;
      dummy.position.set(x, h + 0.03, z);
      dummy.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3);
      dummy.scale.set(sc * 1.2, sc * 0.35, sc * 1.2);
      dummy.updateMatrix();
      miniMoss.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color(0x4e7c33).convertSRGBToLinear();
      c.multiplyScalar(0.85 + rand() * 0.3);
      miniMoss.setColorAt(i, c);
    }
    if (miniMoss.instanceColor) miniMoss.instanceColor.needsUpdate = true;
    miniMoss.castShadow = true;
    miniMoss.receiveShadow = true;
    miniIsland.add(miniMoss);

    const miniVineGroup = new THREE.Group();
    const miniLeafTransforms = [];
    floatVineCurves.forEach((curve) => {
      for (let l = 0; l < 12; l++) {
        const p = curve.getPoint(0.08 + l * 0.078);
        miniLeafTransforms.push({
          x: p.x + (rand() - 0.5) * 0.18,
          y: p.y + (rand() - 0.5) * 0.1,
          z: p.z + (rand() - 0.5) * 0.18,
          s: 0.09 + rand() * 0.06,
          rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
        });
      }
    });
    const miniVineThetas = [0.25, 0.8, 1.35, 1.9, 2.5, 3.1, 3.7, 4.3, 4.9, 5.5, 6.0];
    miniVineThetas.forEach((theta) => {
      const R = miniRim(theta) * 0.995;
      const sx = Math.cos(theta) * R;
      const sz = Math.sin(theta) * R;
      const y0 = miniTerrainHeight(sx, sz);
      const outX = Math.cos(theta), outZ = Math.sin(theta);
      const tanX = -Math.sin(theta), tanZ = Math.cos(theta);
      const strands = 3 + Math.floor(rand() * 2);
      for (let s = 0; s < strands; s++) {
        const len = 3.5 + rand() * 4.0;
        const drift = 0.2 + rand() * 0.7;
        const side = (rand() - 0.5) * 0.5;
        const phase = rand() * 6.28;
        const pts = [];
        for (let k = 0; k <= 6; k++) {
          const u = k / 6;
          const sway = Math.sin(u * 3.2 + phase) * 0.24 * u;
          pts.push(new THREE.Vector3(
            sx + outX * (0.08 + drift * Math.sin(u * 1.2)) + tanX * (side * u + sway),
            y0 - 0.06 - len * Math.pow(u, 1.05),
            sz + outZ * (0.08 + drift * Math.sin(u * 1.2)) + tanZ * (side * u + sway)
          ));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, 10, 0.04 + rand() * 0.03, 3, false),
          rand() > 0.5 ? vineMat : vineMatDark
        );
        miniVineGroup.add(tube);
        for (let l = 0; l < 18; l++) {
          const u = 0.08 + (l / 18) * 0.89;
          const p = curve.getPoint(clamp(u, 0, 1));
          miniLeafTransforms.push({
            x: p.x + (rand() - 0.5) * 0.36,
            y: p.y + (rand() - 0.5) * 0.2,
            z: p.z + (rand() - 0.5) * 0.36,
            s: 0.12 + rand() * 0.1,
            rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
          });
        }
      }
    });
    miniIsland.add(miniVineGroup);

    function miniRootPoint(theta, t, clear) {
      miniCliffPoint(theta, t, miniTmp);
      const rr = Math.hypot(miniTmp.x, miniTmp.z) || 1;
      const k = 1 + clear / rr;
      return new THREE.Vector3(miniTmp.x * k, miniTmp.y, miniTmp.z * k);
    }

    const miniRootMaterial = rootMaterial.clone();
    miniRootMaterial.color.set(0xc4a482);
    miniRootMaterial.emissive.set(0x2a1c12);
    miniRootMaterial.emissiveIntensity = 0.3;

    const miniRootDefs = [
      { th: 0.5, sweep: 0.36, t0: 0.22, t1: 0.9, r0: 0.27, seed: 3.1 },
      { th: 1.2, sweep: -0.3, t0: 0.18, t1: 0.92, r0: 0.3, seed: 4.6 },
      { th: 1.8, sweep: -0.2, t0: 0.12, t1: 0.95, r0: 0.34, seed: 5.9 },
      { th: 2.2, sweep: 0.34, t0: 0.28, t1: 0.95, r0: 0.28, seed: 6.7 },
      { th: 3.2, sweep: -0.3, t0: 0.2, t1: 0.88, r0: 0.24, seed: 8.2 },
      { th: 4.3, sweep: 0.3, t0: 0.3, t1: 0.9, r0: 0.22, seed: 9.3 }
    ];
    miniRootDefs.forEach((rd, idx) => {
      const pts = [], ths = [], ts = [];
      const N = 14;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const t = rd.t0 + (rd.t1 - rd.t0) * Math.pow(u, 0.92);
        const th = rd.th + rd.sweep * Math.pow(u, 0.9) + Math.sin(u * 4.2 + rd.seed) * 0.04;
        const rr = lerp(rd.r0, 0.05, Math.pow(u, 0.85));
        pts.push(miniRootPoint(th, t, 0.04 + rr * 0.55));
        ths.push(th);
        ts.push(t);
      }
      miniIsland.add(makeRootGeometry(pts, rd.r0, 0.05, rd.seed, 6, miniRootMaterial));
      for (let i = 2; i < pts.length - 1; i += 3) {
        const p = pts[i];
        const rr = Math.hypot(p.x, p.z) || 1;
        miniLeafTransforms.push({
          x: p.x + (p.x / rr) * 0.15, y: p.y + 0.05, z: p.z + (p.z / rr) * 0.15,
          s: 0.09 + rand() * 0.08, rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
        });
      }
      if (idx === 0 || idx === 2) {
        const bi = Math.floor(N * 0.55);
        const bPts = [pts[bi].clone()];
        for (let k = 1; k <= 6; k++) {
          const u = k / 6;
          const th = ths[bi] + 0.18 * u + Math.sin(u * 4 + rd.seed) * 0.02;
          const t = Math.min(0.96, ts[bi] + 0.14 * u);
          bPts.push(miniRootPoint(th, t, 0.03 + 0.05 * (1 - u)));
        }
        miniIsland.add(makeRootGeometry(bPts, rd.r0 * 0.4, 0.03, rd.seed + 3.1, 5, miniRootMaterial));
      }
    });

    const miniHangDefs = [
      { th: 1.55, t0: 0.72, len: 3.8, seed: 12.4 },
      { th: 2.55, t0: 0.78, len: 4.4, seed: 14.1 },
      { th: 2.0, t0: 0.75, len: 5.0, seed: 17.2, r0: 0.16 },
      { th: 3.55, t0: 0.74, len: 3.2, seed: 15.8 }
    ];
    miniHangDefs.forEach((hg) => {
      const pts = [];
      const N = 12;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        if (u < 0.55) {
          const t = hg.t0 + (0.92 - hg.t0) * (u / 0.55);
          pts.push(miniRootPoint(hg.th + Math.sin(u * 3.1 + hg.seed) * 0.04, t, 0.04));
        } else {
          const last = pts[pts.length - 1];
          const drop = ((u - 0.55) / 0.45) * hg.len;
          pts.push(new THREE.Vector3(
            last.x + Math.sin(u * 7 + hg.seed) * 0.06,
            last.y - drop,
            last.z + Math.cos(u * 6 + hg.seed) * 0.06
          ));
        }
      }
      miniIsland.add(makeRootGeometry(pts, hg.r0 || 0.12, 0.02, hg.seed, 5, miniRootMaterial));
      for (let i = 3; i < pts.length - 1; i += 2) {
        const p = pts[i];
        const rr = Math.hypot(p.x, p.z) || 1;
        miniLeafTransforms.push({
          x: p.x + (p.x / rr) * 0.1, y: p.y + 0.03, z: p.z + (p.z / rr) * 0.1,
          s: 0.07 + rand() * 0.06, rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
        });
      }
    });

    const miniBottomRootDefs = [
      { x: 0.4, z: -0.2, len: 6.0, seed: 21.1, sway: 0.8 },
      { x: -0.8, z: 0.5, len: 5.0, seed: 23.4, sway: 0.6 },
      { x: 1.2, z: -1.0, len: 7.0, seed: 25.7, sway: 1.0 },
      { x: -0.4, z: -1.3, len: 5.6, seed: 27.9, sway: 0.7 },
      { x: 0.2, z: 0.9, len: 6.6, seed: 29.2, sway: 0.9 },
      { x: 1.6, z: 0.5, len: 5.2, seed: 31.5, sway: 0.6 },
      { x: -1.2, z: -0.4, len: 6.2, seed: 33.1, sway: 0.8 },
      { x: 1.0, z: 1.2, len: 5.8, seed: 35.4, sway: 0.7 },
      { x: -1.7, z: 1.0, len: 6.8, seed: 37.8, sway: 0.9 },
      { x: 0.9, z: -1.7, len: 5.4, seed: 39.2, sway: 0.7 }
    ];
    miniBottomRootDefs.forEach((br) => {
      const pts = [];
      for (let k = 0; k <= 16; k++) {
        const u = k / 16;
        const cu = Math.max(0, (u - 0.66) / 0.34);
        const curlR = Math.sin(cu * Math.PI * 1.1) * 0.6;
        const cx = Math.cos(br.seed + cu * 7.5) * curlR;
        const cz = Math.sin(br.seed + cu * 7.5) * curlR;
        pts.push(new THREE.Vector3(
          br.x + Math.sin(u * 3.6 + br.seed) * br.sway * u + cx,
          -5.8 - br.len * u + cu * cu * 1.1,
          br.z + Math.cos(u * 3.1 + br.seed) * br.sway * u + cz
        ));
      }
      miniIsland.add(makeRootGeometry(pts, 0.38, 0.05, br.seed, 7, miniRootMaterial));
      for (let k = 4; k < pts.length - 2; k += 4) {
        const p = pts[k];
        miniLeafTransforms.push({
          x: p.x, y: p.y, z: p.z,
          s: 0.07 + rand() * 0.06, rx: rand() * 3, ry: rand() * 3, rz: rand() * 3
        });
      }
    });
    const miniRootKnot = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), miniRootMaterial);
    miniRootKnot.position.set(0, -9.4, 0);
    miniRootKnot.scale.set(1.0, 1.4, 1.0);
    miniRootKnot.castShadow = true;
    miniIsland.add(miniRootKnot);

    if (miniLeafTransforms.length > 0) {
      const miniLeaves = new THREE.InstancedMesh(leafGeo, leafMat, miniLeafTransforms.length);
      miniLeafTransforms.forEach((l, i) => {
        dummy.position.set(l.x, l.y, l.z);
        dummy.rotation.set(l.rx, l.ry, l.rz);
        dummy.scale.set(l.s * 0.8, l.s * 0.6, l.s);
        dummy.updateMatrix();
        miniLeaves.setMatrixAt(i, dummy.matrix);
        const c = new THREE.Color(leafPalette[Math.floor(rand() * leafPalette.length)]);
        c.multiplyScalar(0.85 + rand() * 0.3);
        miniLeaves.setColorAt(i, c);
      });
      if (miniLeaves.instanceColor) miniLeaves.instanceColor.needsUpdate = true;
      miniIsland.add(miniLeaves);
    }



    // ---------- Clouds ----------
    function makeCloudTexture(variant = 0) {
      const size = 512;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const halo = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size * 0.48);
      halo.addColorStop(0, 'rgba(255,255,255,0.55)');
      halo.addColorStop(0.55, 'rgba(255,255,255,0.24)');
      halo.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
      ctx.fill();
      const lobes = variant === 0 ? 27 : variant === 1 ? 36 : 22;
      for (let i = 0; i < lobes; i++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.pow(rand(), 0.6);
        const x = cx + Math.cos(a) * rr * size * 0.28;
        const y = cy + Math.sin(a) * rr * size * 0.12;
        const rad = size * (0.09 + rand() * (variant === 2 ? 0.13 : 0.09));
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const hard = variant === 0 ? 0.66 : variant === 1 ? 0.56 : 0.72;
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(hard, 'rgba(255,255,255,1)');
        g.addColorStop(0.9, 'rgba(255,255,255,0.82)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-atop';
      const shade = ctx.createLinearGradient(0, size * 0.24, 0, size);
      shade.addColorStop(0, 'rgba(255,255,255,0)');
      shade.addColorStop(0.4, 'rgba(138,166,194,0.5)');
      shade.addColorStop(0.72, 'rgba(80,110,140,0.74)');
      shade.addColorStop(1, 'rgba(46,75,106,0.88)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 16; i++) {
        const a = rand() * Math.PI * 2;
        const rr = Math.pow(rand(), 0.7);
        const x = cx + Math.cos(a) * rr * size * 0.27;
        const y = cy + size * 0.1 + Math.sin(a) * rr * size * 0.11;
        const rad = size * (0.06 + rand() * 0.1);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const dark = rand() > 0.5;
        g.addColorStop(0, dark ? 'rgba(105,131,158,0.22)' : 'rgba(255,255,252,0.24)');
        g.addColorStop(1, dark ? 'rgba(105,131,158,0)' : 'rgba(255,255,252,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      const highlight = ctx.createRadialGradient(size * 0.36, size * 0.34, 0, size * 0.36, size * 0.34, size * 0.3);
      highlight.addColorStop(0, 'rgba(255,250,238,0.42)');
      highlight.addColorStop(1, 'rgba(255,250,238,0)');
      ctx.fillStyle = highlight;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = maxAniso;
      return tex;
    }
    const cloudTextures = includeClouds ? [makeCloudTexture(0), makeCloudTexture(1), makeCloudTexture(2)] : [];
    const clouds = [];
    const miniCloudClear = (x, z) => Math.hypot(x - 27.5, z - 16.0) < 11.5;
    function addCloud(x, y, z, size, opacity, color, textureIndex) {
      if (!includeClouds) return;
      const material = new THREE.SpriteMaterial({
        map: cloudTextures[textureIndex % cloudTextures.length],
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        fog: true
      });
      material.userData.noTint = true;
      const sprite = new THREE.Sprite(material);
      sprite.position.set(x, y, z);
      sprite.scale.set(size, size * 0.55, 1);
      sprite.userData.baseX = x;
      sprite.userData.baseY = y;
      sprite.userData.phase = rand() * 10;
      sprite.userData.speed = 0.5 + rand() * 1.2;
      sprite.userData.vx = 0.08 + rand() * 0.08;
      sprite.userData.y0 = y;
      sprite.userData.ph = sprite.userData.phase;
      sprite.userData.bob = 0.35;
      scene.add(sprite);
      clouds.push(sprite);
    }

    // Cloud sea below the island.
    for (let i = 0; i < 58; i++) {
      const theta = rand() * Math.PI * 2;
      const dist = 28 + rand() * 42;
      const x = Math.cos(theta) * dist;
      const z = Math.sin(theta) * dist * 0.85 + 6;
      if (miniCloudClear(x, z)) continue;
      const y = -23 + rand() * 11;
      const size = 20 + rand() * 18;
      const tint = rand();
      addCloud(x, y, z, size, 0.8 + rand() * 0.2,
        tint > 0.55 ? 0xfff3e2 : 0xe8f1f9, Math.floor(rand() * 3));
    }
    // Cloud tops hugging the underside.
    for (let i = 0; i < 12; i++) {
      const theta = rand() * Math.PI * 2;
      const dist = 18 + rand() * 10;
      const x = Math.cos(theta) * dist;
      const z = Math.sin(theta) * dist;
      const y = -23 + rand() * 8;
      addCloud(x, y, z, 14 + rand() * 12, 0.72 + rand() * 0.22,
        rand() > 0.5 ? 0xfff4e6 : 0xe9f2fa, Math.floor(rand() * 3));
    }
    // Foreground cloud tops framing the lower edge.
    for (let i = 0; i < 20; i++) {
      const x = (rand() - 0.5) * 110;
      const z = 34 + rand() * 44;
      if (miniCloudClear(x, z)) continue;
      const y = -25 + rand() * 10;
      const size = 20 + rand() * 16;
      addCloud(x, y, z, size, 0.78 + rand() * 0.2,
        rand() > 0.5 ? 0xfff4e6 : 0xe9f2fa, Math.floor(rand() * 3));
    }
    // Mist hugging the lower cliffs.
    for (let i = 0; i < 10; i++) {
      const theta = rand() * Math.PI * 2;
      const dist = 23 + rand() * 9;
      const x = Math.cos(theta) * dist;
      const z = Math.sin(theta) * dist;
      if (miniCloudClear(x, z)) continue;
      const y = -12 + rand() * 7;
      addCloud(x, y, z, 11 + rand() * 14, 0.5 + rand() * 0.3, 0xf4f9fd, Math.floor(rand() * 3));
    }
    // Distant cloud bank.
    for (let i = 0; i < 22; i++) {
      const x = (rand() - 0.5) * 170;
      const z = -52 - rand() * 44;
      const y = -12 + rand() * 14;
      const size = 26 + rand() * 22;
      addCloud(x, y, z, size, 0.68 + rand() * 0.28,
        rand() > 0.5 ? 0xfff1df : 0xe6eff8, Math.floor(rand() * 3));
    }
    // Clouds rising behind the island on the horizon.
    for (let i = 0; i < 10; i++) {
      const x = (rand() - 0.5) * 120;
      const z = -34 - rand() * 24;
      const y = -4 + rand() * 13;
      const size = 30 + rand() * 26;
      addCloud(x, y, z, size, 0.6 + rand() * 0.3,
        rand() > 0.4 ? 0xfff3e4 : 0xe7f0f8, Math.floor(rand() * 3));
    }
    // Mid-height cloud puffs on the far left and right.
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      addCloud(
        side * (20 + rand() * 46),
        1 + rand() * 14,
        -28 - rand() * 28,
        24 + rand() * 22, 0.6 + rand() * 0.26,
        rand() > 0.5 ? 0xfff4e8 : 0xe9f1f9, Math.floor(rand() * 3)
      );
    }
    // Big cloud tops in the lower corners.
    for (let i = 0; i < 12; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (25 + rand() * 36);
      const y = -21 + rand() * 11;
      const z = 4 + rand() * 34;
      if (miniCloudClear(x, z)) continue;
      addCloud(x, y, z, 26 + rand() * 24, 0.72 + rand() * 0.24,
        rand() > 0.5 ? 0xfff5e8 : 0xe8f2fa, Math.floor(rand() * 3));
    }
    // Tall clouds behind the island.
    for (let i = 0; i < 9; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      addCloud(
        side * (20 + rand() * 30),
        5 + rand() * 15,
        -32 - rand() * 20,
        28 + rand() * 18, 0.8 + rand() * 0.16,
        rand() > 0.5 ? 0xfff3e5 : 0xe7f0f9, Math.floor(rand() * 3)
      );
    }
    // Mist around the foot of the waterfall.
    for (let i = 0; i < 5; i++) {
      addCloud(
        endRim.x + outward.x * (1 + rand() * 9) + (rand() - 0.5) * 8,
        -27 + rand() * 12,
        endRim.z + outward.z * (1 + rand() * 9) + (rand() - 0.5) * 8,
        13 + rand() * 13, 0.42 + rand() * 0.22, 0xe6f1f8, Math.floor(rand() * 3)
      );
    }
    // Light spray near the fall.
    for (let i = 0; i < 4; i++) {
      addCloud(
        endRim.x + outward.x * (1 + rand() * 6) + (rand() - 0.5) * 6,
        -21 + rand() * 8,
        endRim.z + outward.z * (1 + rand() * 6) + (rand() - 0.5) * 6,
        8 + rand() * 8, 0.35 + rand() * 0.2, 0xeaf4fb, Math.floor(rand() * 3)
      );
    }
    // Cool backdrop clouds for the fall.
    for (let i = 0; i < 4; i++) {
      addCloud(
        13 + rand() * 23,
        -18 + rand() * 11,
        -8 - rand() * 20,
        26 + rand() * 16, 0.84 + rand() * 0.12, 0xc6d8e6, Math.floor(rand() * 3)
      );
    }
    // A dense ring of cloud tops around the underside.
    for (let i = 0; i < 10; i++) {
      const theta = rand() * Math.PI * 2;
      const dist = 22 + rand() * 9;
      const x = Math.cos(theta) * dist;
      const z = Math.sin(theta) * dist;
      if (miniCloudClear(x, z)) continue;
      const y = -19 + rand() * 8;
      addCloud(x, y, z, 17 + rand() * 15, 0.7 + rand() * 0.24,
        rand() > 0.5 ? 0xfff4e5 : 0xe9f2fa, Math.floor(rand() * 3));
    }
    // A cool bank behind the waterfall so the fall reads clearly.
    for (let i = 0; i < 6; i++) {
      addCloud(
        30 + rand() * 24,
        -16 + rand() * 12,
        -16 + rand() * 20,
        24 + rand() * 18, 0.7 + rand() * 0.24, 0xd3e1ec, Math.floor(rand() * 3)
      );
    }
    // Spray at the foot of the fall.
    for (let i = 0; i < 6; i++) {
      addCloud(
        endRim.x + outward.x * (3 + rand() * 8) + (rand() - 0.5) * 10,
        -10 - rand() * 12,
        endRim.z + outward.z * (3 + rand() * 8) + (rand() - 0.5) * 10,
        12 + rand() * 12, 0.4 + rand() * 0.28, 0xe9f3fa, Math.floor(rand() * 3)
      );
    }

    // Clouds around the small satellite island.
    for (let i = 0; i < 5; i++) {
      addCloud(
        27.5 + (rand() - 0.5) * 12,
        -27 + rand() * 6,
        10 + rand() * 6,
        8 + rand() * 6,
        0.25 + rand() * 0.15,
        rand() > 0.5 ? 0xf4f9fd : 0xfff5e8,
        Math.floor(rand() * 3)
      );
    }

    // ---------- Birds ----------
    const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x2a3138, side: THREE.DoubleSide, toneMapped: false });
    birdMaterial.userData.noTint = true;
    function makeWingGeometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0,
        1.05, 0, 0.2,
        0.95, 0, -0.16,
        0.95, 0, -0.16,
        0.4, 0, -0.24,
        0, 0, 0
      ], 3));
      return g;
    }
    const wingGeo = makeWingGeometry();
    const birds = [];
    for (let i = 0; i < (includeBirds ? 10 : 0); i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 4), birdMaterial);
      body.rotation.x = Math.PI / 2;
      group.add(body);
      const left = new THREE.Mesh(wingGeo, birdMaterial);
      left.scale.x = -1;
      group.add(left);
      const right = new THREE.Mesh(wingGeo, birdMaterial);
      group.add(right);
      const isMini = i >= 8;
      const scale = isMini ? 0.3 + rand() * 0.2 : 0.45 + rand() * 0.45;
      group.scale.setScalar(scale);
      const radius = isMini ? 8 + rand() * 5 : 24 + rand() * 17;
      const height = isMini ? -1 + rand() * 6 : 4 + rand() * 17;
      const speed = (0.08 + rand() * 0.12) * (rand() > 0.5 ? 1 : -1);
      const phase = rand() * Math.PI * 2;
      const flapSpeed = 6 + rand() * 4;
      const cx = isMini ? 27.5 : 0;
      const cz = isMini ? 16.0 : 0;
      birds.push({ group, left, right, radius, height, speed, phase, flapSpeed, scale, cx, cz });
      scene.add(group);
    }

    function makeRadialTexture(size, inner, outer) {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, inner);
      g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.35)'));
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      const tex = new THREE.CanvasTexture(c);
      tex.encoding = THREE.sRGBEncoding;
      return tex;
    }
    function step(elapsed) {
      for (let i = 0; i < waterfallUniforms.length; i++) {
        waterfallUniforms[i].uTime.value = elapsed;
      }
      waterNormalTexture.offset.x = (elapsed * 0.018) % 1;
      waterNormalTexture.offset.y = (elapsed * 0.05) % 1;
      pondNormalTexture.offset.x = (elapsed * 0.022) % 1;
      pondNormalTexture.offset.y = (elapsed * 0.06) % 1;
      waterFoamTexture.offset.y = (elapsed * 0.065) % 1;
      waterFoamTexture.offset.x = (elapsed * 0.012) % 1;
      miniStreamFoamTex.offset.y = (elapsed * 0.22) % 1;
      grassWind.value = elapsed;
      for (let i = 0; i < mistSprites.length; i++) {
        const m = mistSprites[i];
        const base = m.userData.baseOpacity;
        m.material.opacity = base * (0.8 + 0.2 * Math.sin(elapsed * 0.45 + m.userData.phase));
      }
      for (let i = 0; i < miniSpringBubbles.length; i++) {
        const b = miniSpringBubbles[i];
        const t = elapsed * 1.6 + b.userData.phase;
        b.material.opacity = 0.14 + 0.16 * (0.5 + 0.5 * Math.sin(t));
        const s = b.userData.baseScale * (0.85 + 0.2 * Math.sin(t * 1.3));
        b.scale.set(s, s * 0.7, 1);
        b.position.y = b.userData.baseY + 0.02 * Math.sin(t * 0.8);
      }
      for (let i = 0; i < miniSpringRipples.length; i++) {
        const r = miniSpringRipples[i];
        const cycle = (elapsed * 0.32 + r.userData.phase) % 1;
        const sc = 0.6 + cycle * 2.8;
        r.scale.set(sc, sc, 1);
        r.material.opacity = 0.22 * (1 - cycle);
      }
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        const angle = b.phase + elapsed * b.speed;
        b.group.position.set(
          b.cx + Math.cos(angle) * b.radius,
          b.height + Math.sin(elapsed * 0.6 + b.phase) * 1.5,
          b.cz + Math.sin(angle) * b.radius
        );
        b.group.rotation.y = -angle;
        b.group.rotation.z = 0.15;
        const flap = Math.sin(elapsed * b.flapSpeed + b.phase) * 0.55;
        b.left.rotation.z = flap;
        b.right.rotation.z = -flap;
      }
    }

    const localHeightAt = heightAt;
    const heightAtWorld = function (x, z) {
      const h = localHeightAt(x / SCALE, z / SCALE);
      return h == null ? null : h * SCALE;
    };
    const localHeightAtScaled = function (x, z) {
      const h = localHeightAt(x, z);
      return h == null ? null : h * SCALE;
    };

    const miniCenterY = (miniIsland.position.y + miniTerrainHeight(0, 0)) * SCALE;
    const miniInfo = includeMini ? {
      group: miniIsland,
      heightAt: miniTerrainHeight,
      scale: SCALE,
      position: miniIsland.position.clone(),
      center: new THREE.Vector3(miniIsland.position.x * SCALE, miniCenterY, miniIsland.position.z * SCALE),
      radius: 7.0 * SCALE,
      ringRadius: miniRingRadius * SCALE,
      outflowTheta: miniOutflowTheta,
      lawnTree: { x: -5.4, z: 0.0 }
    } : null;

    const body = {
      inner: root,
      scale: SCALE,
      R0,
      heightAt: heightAtWorld,
      localHeightAt,
      localHeightAtScaled,
      mini: miniInfo,
      front: frontInfo,
      mainGroup,
      clouds,
      birds,
      step,
      dispose
    };

    function dispose() {
      const idx = ACTIVE_BODIES.indexOf(body);
      if (idx >= 0) ACTIVE_BODIES.splice(idx, 1);
      if (root.parent) root.parent.remove(root);
      const mats = new Set(), texs = new Set();
      root.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        const list = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
        list.forEach(function (m) {
          if (mats.has(m)) return;
          mats.add(m);
          ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'envMap', 'clearcoatNormalMap'].forEach(function (k) {
            const t = m[k];
            if (t && t.isTexture && !texs.has(t)) { texs.add(t); t.dispose(); }
          });
          m.dispose();
        });
      });
      root.clear();
    }

    root.traverse(function (o) {
      if (!o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (m) {
        if (m.color && !m.userData._linear) {
          m.color.convertSRGBToLinear();
          m.userData._linear = true;
        }
      });
    });

    const unlitTintMats = [];
    const waterEnvMats = [];
    root.traverse(function (o) {
      if (!o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(function (m) {
        if ((m.isMeshBasicMaterial || m.isSpriteMaterial) && !m.userData.noTint) {
          unlitTintMats.push({ mat: m, base: m.color.clone() });
        }
        if (m.userData.waterEnv) {
          waterEnvMats.push({ mat: m, base: m.envMapIntensity, baseColor: m.color.clone() });
        }
      });
    });

    const _envWhite = new THREE.Color(1, 1, 1);
    const _envTint = new THREE.Color();
    function applyEnv(ambC, ambI) {
      const dayF = clamp(ambI / 0.5, 0, 1);
      const dayK = Math.pow(dayF, 3.2);
      _envTint.copy(ambC).multiplyScalar(0.35 + 0.65 * dayK).lerp(_envWhite, dayK * 0.95);
      for (let i = 0; i < unlitTintMats.length; i++) {
        unlitTintMats[i].mat.color.copy(unlitTintMats[i].base).multiply(_envTint);
      }
      for (let i = 0; i < waterfallUniforms.length; i++) {
        waterfallUniforms[i].uTint.value.copy(_envTint);
      }
      for (let i = 0; i < waterEnvMats.length; i++) {
        const w = waterEnvMats[i];
        w.mat.envMapIntensity = w.base * (0.05 + 0.95 * dayK);
        w.mat.color.copy(w.baseColor).multiplyScalar(0.35 + 0.65 * dayK);
      }
    }
    body.applyEnv = applyEnv;

    ACTIVE_BODIES.push(body);
    return body;

}
