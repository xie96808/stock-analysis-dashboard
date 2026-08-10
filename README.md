# Stock Analysis Dashboard

面向中国 A 股与港股的桌面优先技术分析工作台。产品方向是保留 TradingView 式的宽阔画布、自由缩放时间轴、精确画线与自由画笔体验，同时提供大字号坐标、线性/Log 价格轴、成交量、MACD、可视区/锚定成交量分布，以及按日期追溯的预测复盘日志。

## 当前状态

- 阶段：第一版 `v1.0.0` 已完成；当前维护版本为 `v1.0.2`；已修复滚轮缩放回跳，并为日 K 分时入口加入确认菜单与明确退出方式；P0–P7全部通过自动与浏览器验收。
- v1.0.1 修复记录：[`docs/BUGFIX_V1.0.1_CHART_ZOOM.md`](docs/BUGFIX_V1.0.1_CHART_ZOOM.md)
- v1.0.2 修复记录：[`docs/BUGFIX_V1.0.2_INTRADAY_ENTRY.md`](docs/BUGFIX_V1.0.2_INTRADAY_ENTRY.md)
- 运行形式：本机 Web 应用，桌面浏览器优先，平板横屏为第二优先级。
- 设计基准：用户提供的 TradingView 截图与同花顺对比截图。
- 核心需求：横轴按真实日期自由缩放和延伸；纵轴支持普通价格与 Log 价格切换。
- 默认行情：A 股前复权，可切换不复权和后复权。
- 记录范围：第一版每条记录关联一个个股，同日允许任意多条记录。

## 文档

- [开发计划](./docs/DEVELOPMENT_PLAN.md)
- [P0 验收记录](./docs/P0_REPORT.md)
- [P0 界面预览](./docs/p0-preview.jpg)
- [P1 验收记录](./docs/P1_REPORT.md)
- [P1 用户验收单](./docs/P1_ACCEPTANCE_CHECKLIST.md)
- [P1 1440×900 预览](./docs/p1-preview-1440x900.jpg)
- [P1 1920×1080 预览](./docs/p1-preview-1920x1080.jpg)
- [P2 验收报告](./docs/P2_REPORT.md)
- [P2 用户验收单](./docs/P2_ACCEPTANCE_CHECKLIST.md)
- [P2 1440×900 预览](./docs/p2-preview-1440x900.png)
- [P3 验收报告](./docs/P3_REPORT.md)
- [P3 用户验收单](./docs/P3_ACCEPTANCE_CHECKLIST.md)
- [P4 验收报告](./docs/P4_REPORT.md)
- [P4 用户验收单](./docs/P4_ACCEPTANCE_CHECKLIST.md)
- [P5 验收报告](./docs/P5_REPORT.md)
- [P5 用户验收单](./docs/P5_ACCEPTANCE_CHECKLIST.md)
- [P6 验收报告](./docs/P6_REPORT.md)
- [P6 用户验收单](./docs/P6_ACCEPTANCE_CHECKLIST.md)
- [P7 / v1验收报告](./docs/P7_REPORT.md)
- [P7 / v1用户验收单](./docs/P7_ACCEPTANCE_CHECKLIST.md)
- [第一版总验收矩阵](./docs/FINAL_ACCEPTANCE.md)
- [本地部署与发布](./docs/DEPLOYMENT.md)

## v1.0 已实现

- A股/港股代码识别，真实日线与分钟行情，周/月聚合及三种复权；
- 1/5/15/30/60分钟、日/周/月K，普通/Log/百分比价格轴；
- MA/EMA/VOL/MACD多Pane、参数编辑及纯净模式；
- 水平线、趋势线、射线、通道、矩形、文字、自由画笔和荧光笔；
- 金融坐标持久化、OHLC吸附、精确编辑、撤销/重做和命名工作区；
- 动态可视区/锚定Volume Profile及POC/VAH/VAL；
- 明确标注模型边界的A股筹码成本估算；
- SQLite研究日志、不可覆盖revision、PNG快照、当日视角、版本对比与回收站；
- 单条Markdown/PNG/JSON和带SHA-256的完整ZIP导入导出；
- 每日备份30份、2×高清截图、可校验源码发布包。

## 本地运行

```bash
git clone https://github.com/xie96808/stock-analysis-dashboard.git
cd stock-analysis-dashboard
npm install
npm run app
```

`npm run app` 会创建本地 Python 虚拟环境、安装 FastAPI 依赖，并同时启动：

- 看板：`http://127.0.0.1:4173/`
- 本地 API：`http://127.0.0.1:8000/`
- API 文档：`http://127.0.0.1:8000/docs`

重复执行 `npm run app` 时会复用已运行的看板与API；若端口被其他程序占用，会直接显示对应端口和处理提示。

生产构建：

```bash
npm run build
npm run test:backend
```

## P1 已实现

- React/Vite 前端与 FastAPI 本地后端工程边界；
- `/api/health` 健康检查与 `/api/demo/snapshot/001280` 样例接口；
- `./start.sh` 与 `npm run app` 一键启动；
- 标准/大/特大三档字号，默认使用大字号并保存在本机；
- Lightweight Charts 坐标字号随界面档位同步变化；
- 1440×900、1920×1080 视觉基线及 2560×1440 辅助检查；
- API 断开时自动回退到前端确定性样例，不影响画布查看；
- P0 的 Log/普通轴、日K/分时、日历和工具提示交互继续通过回归。

> P1中的分钟周期和画图按钮是后续里程碑入口：真实分钟/周/月周期属于P2，正式画线属于P4。P1不把这些入口标记为已实现功能。

## P2 已实现

- A股/港股/北交所代码解析与真实收盘/延时行情；
- 1/5/15/30/60分钟、日/周/月周期；
- 前复权、不复权、后复权及按标的本地记忆；
- 原子本地缓存、TTL和按时间键增量合并；
- 日K点击进入真实5分钟分时，历史分钟不可用时明确降级；
- 免费行情源和缓存/延时状态清晰标记。

## P0 已实现

- 中国铀业 `001280` 的确定性样例 K 线；
- TradingView 风格主画布与未来时间空白；
- 普通价格/Log 价格一键切换；
- VOL、MACD、可视区成交量分布；
- 初始画布保持干净，不预置水平线、趋势线或分析文字；
- 时间周期、复权、工作区、纯净模式等主要入口；
- 自由画笔、趋势线、水平线、橡皮擦等左侧工具入口及悬浮名称提示；
- 研究日志、Markdown 编辑、同日多记录、加载/删除及日历检索；
- 点击任意日 K 进入对应日期的分时视图，并可返回日线；
- 1440×900 大字号桌面布局。

## 产品原则

1. **画线优先**：行情信息服务于画布，不挤占画布。
2. **时间轴自由**：可连续拉长、压缩、平移，并可保留足够的未来空白区域。
3. **大字号但不拥挤**：坐标、筹码价格和 OHLC 信息优先保证可读性。
4. **概念清晰**：Volume Profile 与估算的筹码成本分布分开呈现。
5. **坐标可复现**：任何画线都以日期与价格存储，切换普通/Log 价格轴后仍落在同一金融语义位置。
6. **预测可追溯**：每次分析按日期归档当时的文字、图形、截图和数据截止时间，后续修订保留版本历史。
7. **数据可迁移**：记录使用标准 Markdown，图形和布局使用版本化 JSON，可单条导出或整体 ZIP 备份恢复。
8. **历史由用户控制**：记录可加载、恢复到工作区、移入回收站或永久删除。

## License

[MIT](./LICENSE)
