# v1.0.1 图表缩放回跳修复与验收记录

日期：2026-08-10
分支：`fix/chart-hover-zoom-reset`
基线：`v1.0.0` / `d26bf9c4b394467a6b40f4866dc02387859eab68`

## 1. 缺陷

日 K 图使用滚轮放大后，只要鼠标第一次移入有效 K 线，时间可视区就恢复到 `fitContent()` 的初始状态；继续移动时整张图表反复销毁、创建，表现为闪烁。

根因是 `App` 在每次渲染时创建新的 `onSelectBar` 闭包，而 `ChartWorkbench` 将该闭包放入创建图表的 `useEffect` 依赖。十字光标更新顶部 OHLC 后触发父组件渲染，新闭包使 effect 清理旧图并再次执行 `fitContent()`。

## 2. 修改

1. `App` 使用 `useCallback` 固定日 K 选择回调。
2. `ChartWorkbench` 用最新值 ref 转发 hover/click 回调，不再让 UI 回调身份进入图表生命周期依赖。
3. 十字光标仍更新 OHLC，日 K 点击仍进入目标日期的分时图。

## 3. 基线与修复行为

### 基线命令及输入

```bash
git worktree add --detach /tmp/stock-dashboard-v1.0.0-baseline-20260810 v1.0.0
cd /tmp/stock-dashboard-v1.0.0-baseline-20260810
./node_modules/.bin/vite --host 127.0.0.1 --port 4174 --strictPort
# 浏览器输入：在未来空白区连续 5 次滚轮输入 scrollY=-1200，随后移动到有效 K 线 x=100,y=390
```

字面结果：

```text
VITE v8.2.1 ready
Local: http://127.0.0.1:4174/
滚轮后：保持局部放大
首次有效K线悬浮后：恢复fitContent初始可视区
console errors/warnings: []
EXIT=0
```

截图像素对比：基线滚轮后与首次悬浮后有 `195764 / 921600 = 21.2418%` 像素变化，K 线横向范围恢复到初始全量视图。

### 修复版命令及输入

```bash
cd /Users/xiexuan/codes/ariston/stock-analysis-dashboard
npm run app
# 浏览器输入：相同滚轮输入，随后在有效K线范围连续移动30次
```

字面结果：

```text
zoomBytes: 111036
rapidBytes: 111737
consoleIssues: []
时间可视区：保持局部放大
日K点击：进入“中国铀业 · 2026-05-19 分时”
EXIT=0
```

修复版滚轮后与连续 30 次移动后的像素变化为 `45779 / 921600 = 4.9673%`，变化仅来自十字光标、OHLC 与随可视区计算的覆盖层，K 线横向范围没有回跳。

## 4. 自动验收

```bash
npm run check
```

字面结果：

```text
Test Files  4 passed (4)
Tests       10 passed (10)
22 passed
vite v8.2.1 building client environment for production...
201 modules transformed
All release checks passed.
EXIT=0
```

服务重启核验：

```text
GET /api/health -> version=1.0.1
GET http://127.0.0.1:4173/ -> HTTP 200
浏览器：本地API · 1.0.1
滚轮后连续移动20次：保持缩放
console errors/warnings: []
```

## 5. 可验证角色

### 修改后制品

- `src/App.tsx`
  - 基线 SHA-256：`6e35ca3bc26ce12ebf63c2c4a8d1b71af99c29602d390b2b772adf19a3a5a832`
  - 修改后 SHA-256：`b582323ba3bb337c56858c9543fc01cec92c6166554e1e0847e589504f2c6b7b`
- `src/components/ChartWorkbench.tsx`
  - 基线 SHA-256：`872bd7de1ab1b977cb2bd88f82bf8b7dbf585d6bd0cf5dab2d04e762149b1928`
  - 修改后 SHA-256：`ece4db46d85f6340123fabb8655c339bf72b53bd9e7e746e9a458782ad115bba`

### 补丁

- `docs/bugfix-chart-hover-zoom-reset/source-fix.patch`
- SHA-256：`660001f201de5687a8d84c5ecfdc18d6318ea30a319e59ba3577504a4c2217d4`
- 该文件是零上下文补丁；在干净 `v1.0.0` 工作树执行
  `git apply --unidiff-zero`、`git apply --reverse --unidiff-zero` 并核对源码哈希，结果：`PASS / EXIT=0`。

### 验证证据

- `docs/bugfix-chart-hover-zoom-reset/baseline-zoomed.png`
- `docs/bugfix-chart-hover-zoom-reset/baseline-after-hover.png`
- `docs/bugfix-chart-hover-zoom-reset/fixed-zoomed.png`
- `docs/bugfix-chart-hover-zoom-reset/fixed-after-30-mouse-moves.png`
- `docs/bugfix-chart-hover-zoom-reset/v1.0.1-post-restart-20-moves.png`

### 回滚

- `scripts/rollback-v1.0.1.sh`
- SHA-256：`96071290e42601c05a4db9912e1b5b1b106320d4609ca671608e4f3850257201`
- 发布标签创建后，在隔离工作树执行：

```bash
scripts/rollback-v1.0.1.sh /tmp/stock-dashboard-v1.0.1-rollback-check
```

预期输出：

```text
rollback verified: v1.0.1 working tree now matches v1.0.0
```
