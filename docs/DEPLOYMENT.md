# 本地部署与发布

## 环境

- macOS / Linux；
- Node.js 20+；
- Python 3.11+；
- 可访问首个免费行情Provider的网络。

## 开发与个人使用

```bash
git clone https://github.com/xie96808/stock-analysis-dashboard.git
cd stock-analysis-dashboard
npm install
npm run app
```

打开 `http://127.0.0.1:4173/`。数据目录默认为仓库下的`data/`，包括SQLite、行情缓存、截图、导出和30份每日备份；这些个人数据均被`.gitignore`排除。

## 完整检查

```bash
npm run check
```

该命令依次执行TypeScript检查、前端算法测试、后端/API/SQLite测试、生产构建和diff空白检查。

## 生成源码发布包

```bash
npm run release:bundle
```

输出：

- `release/stock-analysis-dashboard-v1.0.0.tar.gz`
- `release/stock-analysis-dashboard-v1.0.0.tar.gz.sha256`

脚本会重新打开tar包并执行SHA-256校验。恢复时解压、运行`npm install && npm run app`；用户研究数据通过看板中的项目ZIP导出/恢复，不打入公开源码包。

## 数据声明

默认Provider提供免费收盘/延时数据，不适合作为交易下单源。Volume Profile的买卖拆分以及A股筹码成本均为OHLCV模型估算，界面会持续显示来源和估算说明。
