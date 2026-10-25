# ============================================================
# lxp-system · Dockerfile（多阶段构建）
#
# 阶段 1（builder）：安装依赖 + 跑测试
# 阶段 2（runtime）：只复制运行所需文件，最终镜像 ~80MB
#
# 构建：  docker build -t lxp-system .
# 运行：  docker run -p 8080:8080 -e TOKEN=你的密码 -v lxp-data:/app/data lxp-system
# ============================================================

# ── 阶段 1：构建 & 测试 ──
FROM node:22-alpine AS builder

WORKDIR /build

# 先复制 package 文件（利用 Docker 层缓存）
COPY app/package.json app/package-lock.json ./
RUN npm ci --production

# 复制源码
COPY app/ .
COPY ez-tree/ /ez-tree/

# 跑测试（测试不通过则构建失败）
RUN node tests/run.mjs && node tests/check.mjs

# ── 阶段 2：运行时 ──
FROM node:22-alpine

LABEL maintainer="lxp-system"
LABEL description="任务树管理系统（单用户·多设备）"

# 安全：不用 root 运行
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# 只复制运行所需的文件（不含 tests、node_modules 缓存）
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/src ./src
COPY --from=builder /build/vendor ./vendor
COPY --from=builder /build/index.html ./index.html
COPY --from=builder /build/server.js ./server.js
COPY --from=builder /build/package.json ./package.json

# ez-tree 依赖（eztree.js 通过相对路径引用）
COPY --from=builder /ez-tree /ez-tree

# 数据持久化目录
RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
