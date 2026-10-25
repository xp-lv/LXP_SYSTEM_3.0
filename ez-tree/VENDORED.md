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

## 依赖与资产

- 不包含 `node_modules/`；需要时在 `ez-tree/` 下执行 `npm install`。
- `src/app/public/textures/bark/` 中的树皮贴图随源码保留，应用只使用
  `Bark001_1K-JPG`。
- 上游许可证见 `LICENSE`（MIT）。

## 升级方式

升级上游版本时，不要重新引入嵌套 `.git`。直接在上游新版本源码上重新应用
`lxp` 改动，并更新本文件的基线 commit。
