# P1 视觉骨架与工程化验收记录

> 日期：2026-08-10
> 分支：`feat/p1-visual-foundation`
> 版本：`0.2.0`
> 样例标的：中国铀业 `001280`

## 交付范围

- React/Vite 前端与 Python/FastAPI 本地后端边界；
- `/api/health` 健康检查；
- `/api/demo/snapshot/001280` 样例标的清单接口；
- `./start.sh` 和 `npm run app` 一键启动；
- Vite `/api` 反向代理；
- API在线、连接中、样例降级三种状态；
- 标准/大/特大三档字号，默认大字号；
- 字号偏好使用 `localStorage` 保存；
- 图表坐标字号和价格轴宽度跟随字号档位；
- 1440×900、1920×1080视觉快照及2560×1440辅助布局检查。

## 后端接口

| 路径 | 结果 |
|---|---|
| `GET /api/health` | `200 OK`，返回P1版本和上海时区时间 |
| `GET /api/demo/snapshot/001280` | `200 OK`，返回样例标的、前复权和支持周期声明 |

P1仍使用确定性样例。A/H股真实行情Provider、分钟/日线缓存和复权计算进入P2。

## 自动化验证

```text
npm run typecheck             PASS
npm run build                 PASS
npm run test:backend          2 passed
GET /api/health               200 OK
GET /api/demo/snapshot/001280 200 OK
browser console errors        0
browser console warnings      0
```

生产构建：

```text
28 modules transformed
dist/index.html                  0.46 kB
dist/assets/index-U6jcObnf.css  21.33 kB
dist/assets/index-U4kFL38g.js  391.73 kB
```

## 视觉与交互验收

| 项目 | 结果 |
|---|---|
| 1440×900默认大字号 | 通过，无页面级横向或纵向溢出 |
| 1920×1080默认大字号 | 通过，主图宽度1498px |
| 2560×1440辅助检查 | 通过，主图宽度2138px |
| 标准/大/特大切换 | 通过 |
| 字号刷新后保留 | 通过 |
| 本地API状态 | 通过，显示 `0.2.0-p1` |
| 普通/Log价格轴 | 通过 |
| 日历检索 | 通过，定位到2026-08-03全部记录 |
| 日K进入分时并返回 | 通过，样例日期2026-02-26 |

## 快照

- [`p1-preview-1440x900.jpg`](./p1-preview-1440x900.jpg)
  SHA-256：`3dee2b5fdb592109fedc74f96fe3776a4631f223a5d5627c6a9c35f7be3adbe0`
- [`p1-preview-1920x1080.jpg`](./p1-preview-1920x1080.jpg)
  SHA-256：`633ea4304b67f427120fa785670d0b07d73b9d9b8f3e9b785361bdbe9828d99a`

## P1边界

- 真实A/H股行情、周期和复权：P2；
- 正式指标参数与多面板编辑：P3；
- 正式画线与持久化：P4；
- 动态Volume Profile：P5；
- 研究日志SQLite、版本和导入导出：P6。
