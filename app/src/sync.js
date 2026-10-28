/**
 * sync.js · 云端同步模块 v3（单用户多设备）
 *
 * v3 修复：
 *   1. 合并本地新建的临时任务——整包推拉不再把刚建的临时任务覆盖掉
 *   2. 启动时本地较新 → 主动推送（此前只保留不推送，换设备即丢）
 *   3. 推送进行中不再丢弃变更（重新排队）
 *   4. 定期拉取避让本地待推送变更，减少无谓重载
 *
 * 合并口径：临时任务按 id 做“只补新增”——云端已有的 id 不覆盖；
 * 上次同步时已知、云端已不存在的 id 视为远端删除，不复活。
 * 树/领域/岛等其余字段仍以云端为准。
 */

const TOKEN_KEY = 'lxp_token';
const DATA_KEY = 'lxp_redesign';
const PULL_INTERVAL = 5000;   /* 每 5 秒检查一次服务器是否有更新 */
const PUSH_DEBOUNCE = 2000;   /* 数据变更后 2 秒防抖推送 */

/* ── 令牌管理 ── */
export function getToken() {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete('token');
    history.replaceState({}, '', url);
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}

/* ── 版本/同步状态 ── */
let lastSavedAt = 0;          /* 我已知的最新服务器版本 */
let isPushing = false;        /* 推送锁（防止推送期间拉取触发刷新） */
let pushTimer = null;
let _exportFn = null;         /* 当前内存文档导出函数（冲突合并用） */
let _knownTempIds = new Set();/* 上次同步时云端已知的临时任务 id（含子级） */
let lastChangeAt = 0;         /* 最近一次本地变更时间（拉取避让） */
let _remotePending = false;   /* 检测到其他标签/设备更新：暂停自动重载 */
let _pendingMeta = null;      /* 待应用的最新云端版本 */
let _applying = false;
let _syncBar = null;

/* ── API ── */
async function fetchCloudMeta() {
  const token = getToken();
  if (!token) return null;
  const r = await fetch('/api/data', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) return { error: 401 };
  if (!r.ok) return null;
  const json = await r.json();
  return { savedAt: json.savedAt, data: json.data };
}

async function pushCloud(data) {
  const token = getToken();
  if (!token) return { ok: false };
  const r = await fetch('/api/data', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data, baseVersion: lastSavedAt || null }),
  });
  if (r.status === 409) {
    return { ok: false, conflict: true };
  }
  if (!r.ok) return { ok: false };
  return await r.json().catch(() => ({ ok: false }));
}

/* ── 临时任务合并（只补本地新增，不覆盖云端已有） ── */
function collectTempIds(list, out) {
  (list || []).forEach(function (t) {
    out.add(t.id);
    collectTempIds(t.children, out);
  });
  return out;
}
function knownTempIdsOf(list) {
  return collectTempIds(list, new Set());
}
function setKnownTempIds(list) {
  _knownTempIds = knownTempIdsOf(list);
}
function cloneTemp(t) {
  const o = {};
  for (const k in t) if (k !== 'parent' && k !== 'children') o[k] = t[k];
  o.children = (t.children || []).map(cloneTemp);
  return o;
}
/* 把 local 中“云端没有、且不是上次同步已知”的临时任务补进 cloud。
   新增子级会挂回云端已有的父级；整棵新增子树原样保留。 */
function mergeNewTemps(cloudList, localList) {
  const out = (cloudList || []).map(cloneTemp);
  const cloudById = new Set();
  const outById = new Map();
  const handled = new Set();
  (function idxCloud(list) {
    (list || []).forEach(function (t) {
      cloudById.add(t.id);
      idxCloud(t.children);
    });
  })(cloudList);
  (function idxOut(list) {
    (list || []).forEach(function (t) {
      outById.set(t.id, t);
      idxOut(t.children);
    });
  })(out);
  function mark(t) {
    handled.add(t.id);
    (t.children || []).forEach(mark);
  }
  function attach(copy, parentId) {
    const parent = parentId != null ? outById.get(parentId) : null;
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push(copy);
      parent.leaf = false;
    } else {
      out.push(copy);
    }
    (function idxNew(x) {
      outById.set(x.id, x);
      (x.children || []).forEach(idxNew);
    })(copy);
    mark(copy);
  }
  (function walk(list, parentId) {
    (list || []).forEach(function (t) {
      if (handled.has(t.id)) return;
      if (cloudById.has(t.id)) { walk(t.children, t.id); return; }
      /* 上次同步已知、云端已无 → 远端删除，不复活 */
      if (_knownTempIds.has(t.id)) return;
      /* 父级被远端删除时，不把新子级提升成孤立任务 */
      if (parentId != null && _knownTempIds.has(parentId) && !cloudById.has(parentId)) return;
      attach(cloneTemp(t), parentId);
    });
  })(localList, null);
  return out;
}
function hasUnsyncedTemps(local) {
  const ids = knownTempIdsOf(local && local.temps);
  for (const id of ids) if (!_knownTempIds.has(id)) return true;
  return false;
}
function mergeDocs(cloud, local) {
  const out = JSON.parse(JSON.stringify(cloud || {}));
  out.temps = mergeNewTemps((cloud && cloud.temps) || [], (local && local.temps) || []);
  return out;
}
function prepare(doc) {
  doc.schema = 2;               /* 服务器校验必需（exportDoc 不含 schema） */
  doc.savedAt = Date.now();
  return doc;
}

/* ── 对外接口 ── */

/** 启动时调用：拉取云端数据 → 合并本地新建临时任务 → 初始化版本号 */
export async function pullOnBoot() {
  try {
    const meta = await fetchCloudMeta();
    if (meta && meta.error === 401) {
      promptToken();
      return { hasCloud: false };
    }
    let localDoc = null;
    try {
      const raw = localStorage.getItem(DATA_KEY);
      if (raw) localDoc = JSON.parse(raw);
    } catch (e) { localDoc = null; }

    /* 云端为空：把本地存档推上去（首次部署 / 重建服务器后恢复） */
    if (!meta || !meta.data) {
      if (localDoc) {
        try {
          const r = await pushCloud(prepare(localDoc));
          if (r && r.ok) {
            lastSavedAt = r.savedAt;
            setKnownTempIds(localDoc.temps);
          }
        } catch (e) { /* 离线 */ }
      }
      return { hasCloud: false };
    }

    if (meta.savedAt) lastSavedAt = meta.savedAt;
    const cloud = meta.data;
    setKnownTempIds(cloud.temps);

    if (!localDoc) {
      localStorage.setItem(DATA_KEY, JSON.stringify(cloud));
      return { hasCloud: true, replaced: true };
    }

    /* 本地更新：保留本地并推送（此前只保留不推送，换设备即丢） */
    if ((localDoc.savedAt || 0) > (cloud.savedAt || 0)) {
      try {
        const r = await pushCloud(prepare(localDoc));
        if (r && r.ok) {
          lastSavedAt = r.savedAt;
          setKnownTempIds(localDoc.temps);
        }
      } catch (e) { /* 离线 */ }
      return { hasCloud: true, replaced: false, localNewer: true };
    }

    /* 云端更新：把本地新建、云端没有的临时任务并回去 */
    const merged = mergeDocs(cloud, localDoc);
    const unsynced = hasUnsyncedTemps(localDoc);
    if (unsynced) {
      prepare(merged);
      localStorage.setItem(DATA_KEY, JSON.stringify(merged));
      try {
        const r = await pushCloud(merged);
        if (r && r.ok) {
          lastSavedAt = r.savedAt;
          setKnownTempIds(merged.temps);
        }
      } catch (e) { /* 离线 */ }
    } else {
      localStorage.setItem(DATA_KEY, JSON.stringify(merged));
      setKnownTempIds(merged.temps);
    }
    return { hasCloud: true, replaced: true, merged: unsynced };
  } catch (e) {
    return { hasCloud: false, error: e.message };
  }
}

/** 数据变更时调用（防抖推送，携带版本号做乐观锁） */
export function pushOnChange(exportFn) {
  if (exportFn) _exportFn = exportFn;
  lastChangeAt = Date.now();
  schedulePush();
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(function () {
    pushTimer = null;
    flushPush();
  }, PUSH_DEBOUNCE);
}

async function flushPush() {
  if (!_exportFn) return;
  if (_remotePending) return;   /* 等用户手动应用云端版本，避免反复冲突/自动刷新 */
  if (isPushing) {              /* 推送进行中：排队重试，不丢变更 */
    schedulePush();
    return;
  }
  isPushing = true;
  try {
    const doc = _exportFn();
    prepare(doc);
    const result = await pushCloud(doc);
    if (result.ok) {
      lastSavedAt = result.savedAt;
      setKnownTempIds(doc.temps);
      localStorage.setItem(DATA_KEY, JSON.stringify(doc));
    } else if (result.conflict) {
      console.warn('[sync] 服务器有更新版本——暂停自动刷新，等待手动同步');
      await markRemotePending();
    }
  } catch (e) {
    console.warn('[sync:push]', e.message);
  } finally {
    isPushing = false;
  }
}

/** 定期拉取：每 5 秒检查服务器是否有更新（其他设备的变更） */
export function startPeriodicPull() {
  setInterval(async () => {
    if (isPushing || _remotePending) return;
    if (Date.now() - lastChangeAt < PUSH_DEBOUNCE + 1500) return;  /* 本地变更待推送，本轮避让 */
    try {
      const meta = await fetchCloudMeta();
      if (!meta || !meta.savedAt) return;
      /* 服务器版本比我已知的新 → 其他设备推了新数据；提示用户，不自动重载 */
      if (meta.savedAt > lastSavedAt) {
        console.log('[sync] 检测到其他设备的更新:', new Date(meta.savedAt).toLocaleString());
        markRemotePending(meta);
      }
    } catch (e) {
      /* 网络不可达 → 静默跳过本轮 */
    }
  }, PULL_INTERVAL);
}

/** 检测到其他标签/设备的更新：只提示，不自动刷新页面 */
async function markRemotePending(meta) {
  if (_remotePending) {
    if (meta) _pendingMeta = meta;
    return;
  }
  _remotePending = true;
  _pendingMeta = meta || null;
  if (!_pendingMeta) {
    try { _pendingMeta = await fetchCloudMeta(); } catch (e) { _pendingMeta = null; }
  }
  showSyncBar();
}

/** 用户点击「刷新应用」：合并本地新建临时任务 → 应用云端最新版本 */
async function applyPending() {
  if (_applying) return;
  _applying = true;
  let meta = _pendingMeta;
  try {
    const fresh = await fetchCloudMeta();
    if (fresh && fresh.data) meta = fresh;
  } catch (e) { /* 离线：用上次拿到的 meta */ }
  if (!meta || !meta.data) {
    _applying = false;
    location.reload();
    return;
  }
  const local = _exportFn ? _exportFn() : null;
  const merged = local ? mergeDocs(meta.data, local) : meta.data;
  const unsynced = local ? hasUnsyncedTemps(local) : false;
  if (unsynced) prepare(merged);
  localStorage.setItem(DATA_KEY, JSON.stringify(merged));
  if (unsynced) {
    try {
      const r = await pushCloud(merged);
      if (r && r.ok) {
        lastSavedAt = r.savedAt;
        setKnownTempIds(merged.temps);
      }
    } catch (e) { /* 离线：本地已含合并结果，下轮再推 */ }
  }
  location.reload();
}

/** 非阻塞同步提示条：不自动刷新，用户决定何时应用 */
function showSyncBar() {
  if (_syncBar) return;
  const bar = document.createElement('div');
  bar.id = 'syncBar';
  bar.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:97;' +
    'display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;' +
    'background:rgba(28,22,12,.96);border:1px solid rgba(217,161,62,.55);' +
    'font:600 12px/1.5 "Microsoft YaHei",sans-serif;color:#F2D8A0;' +
    'box-shadow:0 12px 40px rgba(0,0,0,.5)';
  const txt = document.createElement('span');
  txt.textContent = '检测到其他标签/设备更新';
  const btn = document.createElement('button');
  btn.textContent = '刷新应用';
  btn.style.cssText = 'height:26px;padding:0 12px;border-radius:7px;cursor:pointer;' +
    'border:1px solid rgba(217,161,62,.55);background:rgba(217,161,62,.12);' +
    'color:#F2D8A0;font:600 11.5px/1 inherit';
  btn.onclick = applyPending;
  bar.appendChild(txt);
  bar.appendChild(btn);
  document.body.appendChild(bar);
  _syncBar = bar;
}

/* ── 令牌弹窗 ── */
function promptToken() {
  const t = window.prompt('请输入访问令牌（TOKEN）：');
  if (t) {
    setToken(t);
    location.reload();
  }
}
