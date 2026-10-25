# 升级指南

## 三层升级影响

| 改什么 | 文件 | 需要重启服务器？ | 运行中的用户受影响？ |
|---|---|---|---|
| 前端代码 | `src/*.js` `index.html` `*.css` | ❌ 不需要 | ❌ 刷新才生效 |
| 服务器代码 | `server.js` | ✅ 需要（1-2 秒） | ⚠️ 推送暂失败，下次自动恢复 |
| 数据结构 | `persistence.js` | 视情况 | 🔴 需要迁移 |

## 日常升级流程（改前端）

```bash
# 1. 改代码
vim src/today.js

# 2. 跑测试
node tests/run.mjs && node tests/check.mjs

# 3. 浏览器刷新验证

# 4. 提交
git add -A && git commit -m "改动说明"
# 完成——其他设备刷新即获得新版
```

## 服务器升级流程

```bash
# 1. 改 server.js
# 2. 语法检查
node --check server.js

# 3. 重启
taskkill /F /IM node.exe
start.bat

# 4. 验证
curl http://localhost:8080/api/health
```

## 数据结构变更（慎行）

### 安全：加新字段
```js
// 旧数据没有 priority → undefined → 新代码用默认值
node.priority = node.priority || 0;
```

### 危险：删/改字段名
```js
// ❌ 旧数据还有 done，新代码找不到 → 数据丢失
// 安全做法：读旧写新
node.completed = node.done;  // 迁移
delete node.done;
```

### 必须写迁移：改结构
```js
// checklist 从 [{t,done}] 改成 {items:[], meta:{}}
// 需要在 persistence.js 的 deserializeTree 里加转换逻辑
```

## 备份策略

```bash
# 手动备份（随时）
# 浏览器顶栏 → ⇩ 备份 → 下载 JSON

# 自动备份（建议加到 start.bat 里）
# 每天启动时拷贝 data.json
copy data.json "backups\data_%date%.json"
```

## 回滚

```bash
# 代码回滚
git log --oneline          # 找到好的版本
git checkout <hash> -- src/  # 只回滚源码

# 数据回滚
# 用「⇧ 导入」恢复之前备份的 JSON
```
