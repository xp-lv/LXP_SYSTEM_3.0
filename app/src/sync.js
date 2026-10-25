/**
 * sync.js · 云端同步模块 v2（单用户多设备）
 *
 * 修复：
 *   1. 推送携带正确的 baseVersion（乐观锁真正生效）
 *   2. 定期拉取（5s）——及时发现其他设备的变更
 *   3. 冲突时服务端版本胜（拉取 + 覆盖 + 刷新页面）
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

/* ── 版本追踪 ── */
let lastSavedAt = 0;          /* 我已知的最新服务器版本 */
let isPushing = false;        /* 推送锁（防止推送期间拉取触发刷新） */

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

/* ── 对外接口 ── */

/** 启动时调用：拉取云端数据 → 与本地合并（云端优先）→ 初始化版本号 */
export async function pullOnBoot() {
  try {
    const meta = await fetchCloudMeta();
    if (meta && meta.error === 401) {
      promptToken();
      return { hasCloud: false };
    }
    if (!meta || !meta.data) return { hasCloud: false };
    if (meta.savedAt) lastSavedAt = meta.savedAt;
    const cloud = meta.data;
    const local = localStorage.getItem(DATA_KEY);
    if (local) {
      try {
        const localDoc = JSON.parse(local);
        if ((cloud.savedAt || 0) > (localDoc.savedAt || 0)) {
          localStorage.setItem(DATA_KEY, JSON.stringify(cloud));
          return { hasCloud: true, replaced: true };
        }
        /* 本地更新 → 不覆盖，但推送本地到服务器 */
        return { hasCloud: true, replaced: false, localNewer: true };
      } catch (e) {
        localStorage.setItem(DATA_KEY, JSON.stringify(cloud));
        return { hasCloud: true, replaced: true };
      }
    }
    localStorage.setItem(DATA_KEY, JSON.stringify(cloud));
    return { hasCloud: true, replaced: true };
  } catch (e) {
    return { hasCloud: false, error: e.message };
  }
}

/** 数据变更时调用（防抖推送，携带版本号做乐观锁） */
let pushTimer = null;
export function pushOnChange(exportFn) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    if (isPushing) return;
    isPushing = true;
    try {
      const doc = exportFn();
      doc.schema = 2;               /* 服务器校验必需（exportDoc 不含 schema） */
      doc.savedAt = Date.now();
      const result = await pushCloud(doc);
      if (result.ok) {
        lastSavedAt = result.savedAt;
        localStorage.setItem(DATA_KEY, JSON.stringify(doc));
      } else if (result.conflict) {
        console.warn('[sync] 服务器有更新版本——拉取覆盖本地');
        await pullAndReload();
      }
    } catch (e) {
      console.warn('[sync:push]', e.message);
    } finally {
      isPushing = false;
    }
  }, PUSH_DEBOUNCE);
}

/** 定期拉取：每 5 秒检查服务器是否有更新（其他设备的变更） */
export function startPeriodicPull() {
  setInterval(async () => {
    if (isPushing) return;
    try {
      const meta = await fetchCloudMeta();
      if (!meta || !meta.savedAt) return;
      /* 服务器版本比我已知的新 → 其他设备推了新数据 */
      if (meta.savedAt > lastSavedAt) {
        console.log('[sync] 检测到其他设备的更新:', new Date(meta.savedAt).toLocaleString());
        await pullAndReload();
      }
    } catch (e) {
      /* 网络不可达 → 静默跳过本轮 */
    }
  }, PULL_INTERVAL);
}

/** 拉取服务器数据 → 覆盖 localStorage → 刷新页面 */
async function pullAndReload() {
  const meta = await fetchCloudMeta();
  if (meta && meta.data) {
    localStorage.setItem(DATA_KEY, JSON.stringify(meta.data));
    if (meta.savedAt) lastSavedAt = meta.savedAt;
    location.reload();
  }
}

/* ── 令牌弹窗 ── */
function promptToken() {
  const t = window.prompt('请输入访问令牌（TOKEN）：');
  if (t) {
    setToken(t);
    location.reload();
  }
}
