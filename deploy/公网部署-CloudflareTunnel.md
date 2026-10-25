# lxp-system · 公网部署（Cloudflare Tunnel 方案）

> 域名：lxpsystem.fun（已备案） · 家用电脑 + Docker · 免公网 IP · 免费 HTTPS
> 原理：本机跑一个 cloudflared 容器，主动向 Cloudflare 建立加密隧道，
> 外网经 `https://lxpsystem.fun` → Cloudflare 边缘 → 隧道 → 本机 `lxp:8080`。
> 全程无入站端口，家庭 IP 不暴露。

## 一、Cloudflare 侧（浏览器操作，约 10 分钟）

1. **注册/登录** [dash.cloudflare.com](https://dash.cloudflare.com)（免费计划即可）
2. **添加站点**：Add a domain → `lxpsystem.fun` → Free 计划
3. **改 NS**：Cloudflare 会给出两个域名服务器（如 `xxx.ns.cloudflare.com`），
   到你买域名的注册商后台把 NS 改成这两个，回 CF 点验证（生效几分钟到几小时）
4. **建隧道**：左侧 **Zero Trust** → Networks → Tunnels → Create a tunnel →
   选 **Cloudflared** → 命名 `lxp` → 部署方式选 **Docker**，**复制页面上的令牌**
   （形如 `eyJh...` 的长串，就是 `TUNNEL_TOKEN`，先不要管它给的 docker run 命令）
5. **配公网主机名**：同一向导或隧道详情 → **Public Hostname** → Add：
   - Subdomain 留空（主域名）、Domain 选 `lxpsystem.fun`
   - Service：`HTTP` → `lxp:8080`（**写容器服务名 lxp，不是 localhost**）
   - 保存后 CF 自动建好 DNS 与边缘证书（HTTPS 开箱即用）

## 二、本机启动（一次性）

```bash
cd deploy
export TOKEN=<原有访问令牌>            # 应用自身的 Bearer TOKEN
export TUNNEL_TOKEN=<第一步复制的令牌>  # Cloudflare Tunnel 令牌
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

国内拉不动 Docker Hub 时先换镜像源：

```bash
export TUNNEL_IMAGE=docker.1ms.run/cloudflare/cloudflared:latest
```

日常更新/重启同现有流程；不带 `-f docker-compose.tunnel.yml` 启动 = 回到纯本地模式。

## 三、验证

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml ps   # lxp-tunnel 应 Up
docker logs lxp-tunnel --tail 20        # 出现 "Registered tunnel connection" 即通
```

浏览器（可用手机流量）开 `https://lxpsystem.fun/app/?token=<你的TOKEN>` ——
首次经 URL 带入令牌后会存入 localStorage 并从地址栏清除，之后直接开域名即可。

## 四、安全与运维提示

- **公网后 `/api/data` 暴露在全网**：TOKEN 请用长随机串（≥20 位），当前令牌偏短建议换新
  （换法：改 compose 的 TOKEN 后 `docker compose up -d` 重建；客户端清 localStorage 重新带新 token 访问一次）
- 可选加固：隧道跑通后，把 `docker-compose.yml` 的端口映射改为 `127.0.0.1:8080:8080`，
  本地仍可访问但局域网直连关闭，公网唯一入口是隧道
- 家用电脑需保持开机与 Docker Desktop 运行；关机 = 站点下线（数据无损，都在卷里）
- Cloudflare 免费版代理超时 100s、无带宽上限；本应用流量极小，无压力
- 备案说明：流量不经国内机房，备案记录仅保留不受影响；日后若迁国内服务器可直接启用
