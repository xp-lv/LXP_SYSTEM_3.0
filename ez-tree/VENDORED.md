# ez-tree（vendored）

本目录是 **ez-tree 的源码副本**，由 `lxp_system` 直接维护，不是 Git submodule，
也不再保留独立的 `.git` 仓库。

## 来源

- 上游仓库：<https://github.com/dgreenheck/ez-tree>
- 上游基线：`dcf309bd86bd521083d9c70f01f2de45fdc7c457`（`origin/main`）
- 本地分支：`lxp`
- 本地提交范围：`6d6fa10..f6e0fd3`（14 个提交）
- Vendor 日期：2026-10-25

## 本地修改

在上游基线之上，`lxp` 分支包含任务树适配、树形驱动、装饰、树皮材质等改动。
截至 vendor 时，工作区还有 3 个未提交的修改：

- `src/lxp/adapter.js`
- `src/lxp/decor.js`
- `tests/lxp.test.mjs`

这些修改已经直接包含在当前源码中。原始嵌套 Git 历史已备份到项目外
（bundle + 未提交补丁），不随本仓库提交。

### 2026-10-28 · 岛屿树木形态 P1

- `src/lxp/adapter.js`：根自留比例 `OWN_SHARE[0]` 0.50→0.40；
  `attachT` 侧枝展开 `spread` 0.24→0.36（首侧枝下移、侧枝带更开）；
  `R` 0.0115→0.0125 并给主干半径保底。
- `src/lxp/tasktree.js`：延长/换级/侧枝角度上调并加 hash 抖动；
  逐层蜷曲上调、主干/大枝径向分段增加；主干基部展宽加强。
- `src/lxp/decor.js`：状态标记精修——花/花苞/金叶纹理重绘；花由单张大花改为
  小花簇、金叶改为尖叶小簇、辉光收敛；断梢红浆果在宿主
  `app/src/demo/eztree.js`。
- 目的：改善任务树“光杆 + 分叉机械”的观感，不改变任务映射与拾取语义。
  树冠叶片/装饰小枝仍在宿主 `app/src/demo/eztree.js`，不属于本 vendor 目录。

## 依赖与资产

- 不包含 `node_modules/`；需要时在 `ez-tree/` 下执行 `npm install`。
- `src/app/public/textures/bark/` 中的树皮贴图随源码保留，应用只使用
  `Bark001_1K-JPG`。
- 上游许可证见 `LICENSE`（MIT）。

## 升级方式

升级上游版本时，不要重新引入嵌套 `.git`。直接在上游新版本源码上重新应用
`lxp` 改动，并更新本文件的基线 commit。
