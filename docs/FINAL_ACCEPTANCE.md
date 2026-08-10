# 第一版总验收矩阵

| 原计划验收项 | 实现与证据 | 结果 |
|---|---|---|
| 1440×900主图占主要空间 | v1视觉基线 | PASS |
| 横纵轴大字号 | 三档字号，默认大；Lightweight Charts同步 | PASS |
| 20–2000根缩放能力 | 图表最小/最大barSpacing与API 2000上限 | PASS |
| 至少一年未来空白 | 270个未来交易bar | PASS |
| 未来区域趋势线 | P4金融坐标SVG层 | PASS |
| 普通/Log切换锚点语义不变 | 锚点保存timestampMs/price | PASS |
| Log真实价格标签 | Lightweight Log价格轴 | PASS |
| 主图/VOL/MACD同步 | 单一Chart多Pane | PASS |
| 动态Profile及POC/VAH/VAL | P5 48档、防抖、标签避让 | PASS |
| 画线刷新恢复 | localStorage版本化工作区 | PASS |
| 高清截图含全部画布信息 | html-to-image 2×PNG | PASS |
| 纯净分析模式 | 隐藏指标/Profile/筹码 | PASS |
| 日期检索全部预测 | SQLite查询+日历/时间线 | PASS |
| 修改预测产生revision | 追加式SQLite唯一版本 | PASS |
| 无账号完整导出恢复 | Markdown目录+校验ZIP | PASS |
| 同日多记录 | dateKey非唯一、独立UUID | PASS |
| 直线/笔迹编辑擦除撤销 | P4画线系统 | PASS |
| 单条Markdown/PNG/JSON导出 | P6 export_record | PASS |
| 多命名工作区 | 三个隔离持久化工作区 | PASS |
| 周期可见性 | 全部周期/仅当前周期 | PASS |
| 回收站/恢复/永久删除 | SQLite软删+二次永久确认 | PASS |
| A股默认前复权且不丢画线 | 按标的复权偏好；画线层解耦 | PASS |
| 每日备份30份 | SQLite backup API+轮换 | PASS |

各阶段详细操作步骤见 `P1_ACCEPTANCE_CHECKLIST.md` 至 `P7_ACCEPTANCE_CHECKLIST.md`。

