/**
 * lxp-system · 单用户生产服务器
 *
 * 用法：
 *   TOKEN=你的密码 node server.js          # 默认端口 3000
 *   TOKEN=你的密码 PORT=8080 node server.js
 *
 * 架构：
 *   /app/        → 静态前端（只暴露 src/vendor/assets 与 ez-tree/src）
 *   /api/data    → GET 读取 / PUT 写入（Bearer TOKEN 鉴权）
 *   /api/health  → 健康检查
 *
 * 数据存储：data.json 文件（与 server.js 同目录自动创建）
 * 首次启动时自动从 localStorage 导入（见客户端 sync.js）
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TOKEN || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

/* ── 确保数据目录存在 ── */
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ── 如果没有设 TOKEN，自动生成并提示 ── */
if (!TOKEN) {
  const auto = crypto.randomBytes(12).toString('hex');
  console.log(`
⚠️  未设置 TOKEN 环境变量——已生成临时令牌：
   ${auto}

   重启时请设置固定令牌：
   TOKEN=${auto} node server.js
`);
  process.env.TOKEN = auto;
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '10mb' }));

/* ── 鉴权中间件 ── */
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/* ── 静态资源：只暴露前端运行所需目录 ──
   不能直接 express.static(WORKSPACE_ROOT)：那会把 app/data/data.json、
   app/start.bat 以及 ez-tree/node_modules 一起暴露出去。 */
const WORKSPACE_ROOT = path.join(__dirname, '..');
const EZTREE_ROOT = path.join(WORKSPACE_ROOT, 'ez-tree');
const staticOpts = { dotfiles: 'ignore', etag: true, maxAge: 0 };

app.get(['/', '/index.html'], (req, res) => res.redirect(302, '/app/'));

app.use('/app/src', express.static(path.join(__dirname, 'src'), staticOpts));
app.use('/app/vendor', express.static(path.join(__dirname, 'vendor'), staticOpts));
app.use('/app/assets', express.static(path.join(__dirname, 'assets'), staticOpts));
app.use('/ez-tree/src', express.static(path.join(EZTREE_ROOT, 'src'), staticOpts));

app.get(['/app', '/app/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/app/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/app/island-demo.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'island-demo.html'));
});

/* ── API：健康检查 ── */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

/* ── API：读取数据 ── */
app.get('/api/data', auth, (req, res) => {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return res.json({ data: null, savedAt: null });
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const doc = JSON.parse(raw);
    res.json({ data: doc, savedAt: doc.savedAt });
  } catch (e) {
    console.error('[api/data:GET]', e.message);
    res.status(500).json({ error: 'read_failed' });
  }
});

/* ── API：写入数据（整包替换，带乐观锁） ── */
app.put('/api/data', auth, (req, res) => {
  try {
    const { data, baseVersion } = req.body;
    if (!data || data.schema !== 2) {
      return res.status(400).json({ error: 'invalid_schema' });
    }
    /* 乐观锁：baseVersion 非空且服务端更新 → 冲突（防多设备互相覆盖） */
    if (fs.existsSync(DATA_FILE)) {
      const current = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      if (baseVersion != null && current.savedAt > baseVersion) {
        return res.status(409).json({
          error: 'conflict',
          serverVersion: current.savedAt,
          message: '服务端有更新的版本，请刷新后重试',
        });
      }
    }
    data.savedAt = Date.now();
    /* 原子写入：先写临时文件再 rename（防半写） */
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);
    res.json({ ok: true, savedAt: data.savedAt });
  } catch (e) {
    console.error('[api/data:PUT]', e.message);
    res.status(500).json({ error: 'write_failed' });
  }
});

/* ── 未匹配路径统一 404（避免默认错误页泄露路径） ── */
app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

/* ── 启动 ── */
app.listen(PORT, () => {
  console.log(`
✅ lxp-system 已启动
   地址：http://localhost:${PORT}
   令牌：${process.env.TOKEN.slice(0, 4)}${'•'.repeat(8)}
   数据：${DATA_FILE}
`);
});
