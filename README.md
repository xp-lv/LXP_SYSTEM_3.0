# lxp-system · 任务树管理系统

以 3D 树为视觉载体的个人目标·任务·日程管理工具。

## 项目结构

```
lxp-system/
├── app/          ← 应用工程
│   ├── src/      ← 源码（ES Module，零构建）
│   ├── vendor/   ← three.js r128
│   ├── tests/    ← 单测 + 架构规则
│   └── server.js ← 生产服务器
├── deploy/       ← 部署配置
│   ├── Dockerfile              ← 多阶段构建
│   ├── docker-compose.yml      ← 正式环境（端口 8080）
│   ├── docker-compose.dev.yml  ← 开发环境（端口 8081，源码挂载）
│   └── 部署方案.md              ← 完整部署知识 & 操作指南
├── docs/design/  ← 设计规范（模块定义/交互/规则/数据契约）
├── ez-tree/      ← 3D 树生成库（vendored 源码，见 ez-tree/VENDORED.md）
└── README.md
```

## 快速开始

### 开发模式（Docker，推荐）
```bash
cd deploy
docker compose -f docker-compose.dev.yml up
# → http://localhost:8081/app/
```

### 开发模式（无 Docker）
```bash
cd app
npm install
node server.js
# → http://localhost:3000/app/
```

### 生产部署
```bash
cd deploy
TOKEN=你的密码 docker compose up -d
# → http://localhost:8080/app/
```

### 运行测试
```bash
cd app
node tests/run.mjs     # 23 个单元测试
node tests/check.mjs   # 10 条架构规则
```

## 版本管理

- 单一仓库：`ez-tree/` 以 vendored 源码纳入本仓库，不是 submodule；来源与本地改动见
  [`ez-tree/VENDORED.md`](ez-tree/VENDORED.md)。
- 远程仓库：<https://github.com/xp-lv/LXP_SYSTEM_3.0>
- 不提交运行时数据、备份和本地令牌：`.gitignore` 已忽略 `app/data/`、
  `deploy/lxp-data-backup-*.tar.gz`、`app/start.bat` 和 `.env`。
  启动脚本只从 `TOKEN` 环境变量读取令牌，不要把令牌写进文件。
- 树皮贴图使用 Git LFS；克隆前先安装并初始化：
  ```bash
  git lfs install
  git clone https://github.com/xp-lv/LXP_SYSTEM_3.0.git
  ```
  日常提交后推送：
  ```bash
  git push origin main
  ```
- CI 在 `.github/workflows/ci.yml` 中运行单元测试与架构规则。

## 技术栈

- **前端**：原生 ES Module + three.js r128（零构建、零框架）
- **后端**：Node.js 22 + Express
- **存储**：服务端 data.json + 客户端 localStorage（自动同步）
- **部署**：Docker 多阶段构建（正式镜像 ~80MB）
- **测试**：Node.js 原生 assert

## 详细文档

| 文档 | 内容 |
|---|---|
| [部署方案](deploy/部署方案.md) | Docker 知识、架构、升级回滚、VPS 部署 |
| [升级指南](app/UPGRADE.md) | 代码变更影响分析、数据迁移注意事项 |
| [设计规范](docs/design/0-模块分解.md) | 11 个功能模块定义 |
| [AI 规划模块](docs/design/1-模块细分解/11-AI规划模块.md) | 对话澄清、系统化分解、文档链、确认后落库 |
| [业务规则](docs/design/5-业务规则.md) | R1–R57 精确规则语义 |
| [数据契约](docs/design/6-数据契约.md) | schema v2 + 派生字段 + AI 受管目录 |
