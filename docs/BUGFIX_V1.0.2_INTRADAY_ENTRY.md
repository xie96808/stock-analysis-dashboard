# v1.0.2 日 K 分时入口与退出修复验收记录

日期：2026-08-10
分支：`fix/intraday-entry-menu`
基线：`v1.0.1` / `a1bd20fc6831389972f134a6ba435c379de4151d`

## 1. 行为变更

基线版本把任意一次日 K 点击直接解释为进入分时图，用户没有确认机会；分时界面仅在图表标题栏提供返回入口，识别度和可达性不足。

修改后：

1. 选择工具下左键点击有效日 K，只显示包含日期、开盘价、收盘价的轻量操作菜单。
2. 只有点击菜单中的“查看当日分时图”才进入分时图。
3. 菜单可通过关闭按钮、点击浮层外部或 `Esc` 关闭。
4. 只有日 K 支持该菜单；1/5/15/30/60 分、周 K、月 K 均不响应分时入口。
5. 分时图同时提供标题栏与图内“返回日K”按钮，并支持 `Esc` 返回。

## 2. 浏览器验收

目标：`http://127.0.0.1:4173/`，视口 `1280×720`。

### 日 K 确认菜单

输入：选择日 K，在有效 K 线坐标 `x=300,y=400` 单击。

```text
dailyStillVisible: true
promptVisible: true
intradayOpened: false
```

关闭菜单后再次点击相同 K 线，并点击“查看当日分时图”：

```text
cancelKeptDaily: true
enteredIntraday: true
exitButtonCount: 2
```

### 退出

```text
returnedDaily: true
intradayGone: true
promptClosedByEsc: true
intradayExitedByEsc: true
closedByOutsideClick: true
```

### 非日 K 门禁

```text
15分: active=true, prompt=false, intraday=false
周K: active=true, prompt=false, intraday=false
```

最终浏览器控制台：

```text
errors/warnings: []
```

## 3. 自动验收

命令：

```bash
npm run check
```

字面结果：

```text
Test Files  5 passed (5)
Tests       12 passed (12)
22 passed
202 modules transformed
All release checks passed.
EXIT=0
```

新增单元测试固定两项规则：仅日 K + 选择工具可以打开入口；菜单在图表边缘时仍保持在可视区域内。

## 4. 可验证角色

### 修改后制品

- `src/App.tsx`：`44b5c9245931a61e00c0f4f9b6642e983ddf687e1ef5f79ffc58b052353ab628`
- `src/chart/intraday.ts`：`e28966dd504a3dacab092dfef10f83240de00a38dc8d9c670ff345e3e88cc592`
- `src/chart/intraday.test.ts`：`ab02b54d1b45385a8297853b5128801090d2fbcda5aa2d53d4a4951a4b26a043`
- `src/components/ChartWorkbench.tsx`：`e1c9423ff26dc84f4e2dd655f9ab65bc13f7f109a8039aaa745560aac4c9a4b7`
- `src/components/IntradayView.tsx`：`95312d65eaa77658a105abbf4543d8ee2dd307a0d9fd49e3690294bceb1f09ef`
- `src/styles.css`：`d1f2044be4966a48e5f0d01b2cdaa2ece418e7ccddfeed6b2599500bb9936042`

### 补丁

- `docs/bugfix-intraday-entry-v1.0.2/source-fix.patch`
- SHA-256：`1037625653a9ad86bf83c553cc810f6592821bba926cf08ec34ac60488f4256a`
- 在隔离的 `v1.0.1` 工作树使用 `git apply --unidiff-zero` 和
  `git apply --reverse --unidiff-zero`，逐文件核对哈希，结果：`PASS / EXIT=0`。

### 截图证据

- `docs/bugfix-intraday-entry-v1.0.2/daily-click-menu.png`
- `docs/bugfix-intraday-entry-v1.0.2/intraday-with-return.png`
- `docs/bugfix-intraday-entry-v1.0.2/daily-after-return.png`

### 回滚

- `scripts/rollback-v1.0.2.sh`
- SHA-256：`2ee61e278797edc0eaf122e6f7fa57d8de843b521adf80490a83ea528347a5f4`
- 已在隔离工作树执行：

```bash
scripts/rollback-v1.0.2.sh /tmp/stock-dashboard-v1.0.2-rollback-check
```

实际输出：

```text
rollback verified: v1.0.2 working tree now matches v1.0.1
rollback App.tsx: b582323ba3bb337c56858c9543fc01cec92c6166554e1e0847e589504f2c6b7b
baseline App.tsx: b582323ba3bb337c56858c9543fc01cec92c6166554e1e0847e589504f2c6b7b
rollback ChartWorkbench.tsx: ece4db46d85f6340123fabb8655c339bf72b53bd9e7e746e9a458782ad115bba
baseline ChartWorkbench.tsx: ece4db46d85f6340123fabb8655c339bf72b53bd9e7e746e9a458782ad115bba
rollback full-tree comparison: PASS
EXIT=0
```
