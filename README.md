# cortico-world-token-cost

给 [Coopanion](https://github.com/Pal-AI-Lab/Cortico) 桌宠加一页「模型花销」：**每一次模型调用**的时间、模型、输入 / 输出 tokens 和这一条花了多少钱，显示成一张表头固定、可以上下滚动的表。

数据不是另起炉灶记的，而是读 Coopanion 自己写的 `data/usage.jsonl`——里面每条记录本来就带着这次调用的费用（按 DeepSeek 官网价目表算的，含高峰 / 空闲价），所以表里的金额和平台账单是同一套口径。

## 它会显示什么

| 列 | 内容 |
| --- | --- |
| 时间 | 这次调用的本地时间 |
| 模型 | 实际调用的模型名（如 `deepseek-flash`） |
| 输入 | 输入 tokens，括号里是命中缓存的部分 |
| 输出 | 输出 tokens |
| 费用 | 这一条的费用（USD）；没有计价记录的旧数据会标 `≈`，按内置价目表估算 |

顶部有条状徽标：总调用次数、总花费、缓存命中的 tokens。表最多显示最近 400 条，每 3 秒自动刷新。

## 计价

优先使用记录自带的 `attempt.charges[0].amount`（Coopanion 按 DeepSeek 官方价目表计算）。

记录里没有费用时，回退到内置表（USD / 1M tokens，高峰为 01:00–04:00、06:00–10:00 UTC 工作日，其余为空闲价）：

| 模型 | 缓存命中（空闲/高峰） | 未命中输入（空闲/高峰） | 输出（空闲/高峰） |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.003 / 0.006 | 0.15 / 0.3 | 0.6 / 1.2 |
| `deepseek-v4-pro` | 0.022 / 0.044 | 0.66 / 1.32 | 1.98 / 3.96 |

价目表随 DeepSeek 调整而变，以官网 [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing) 为准。


## 界面：每天花费（CNY）

设置里的 World 页面除了「每次模型调用」，还有一页「每天花费（CNY）」：

- 按**本地日期**汇总每天：调用次数、USD、CNY
- 顶部：合计人民币、今日人民币、当前汇率
- 表头固定，列表可上下滚动，每 5 秒刷新
- 汇率在设置里可改（`worlds.token-cost.cnyRate`，默认 7.2）

CNY 只是按汇率从 USD 换算，不是另一套账单。
## 安装

前置：Coopanion（Cortico 6.x）、Node ≥ 22、pnpm。

```powershell
# <data> 是 Coopanion 的数据目录：%LOCALAPPDATA%\Coopanion\data-location.json 里的 "data"
cd "<data>\extensions"
pnpm add link:"<本仓库的绝对路径>"
```

如果 pnpm 报 `ERR_PNPM_UNEXPECTED_STORE`，把 `<data>\extensions\node_modules\.modules.yaml` 里的 `storeDir` 加到命令后面：

```powershell
pnpm add link:"<本仓库的绝对路径>" --store-dir "<storeDir>"
```

然后在 `<data>\home\companion\config.json` 的 `worlds` 里加一行（没有就新建）：

```json
"token-cost": { "enabled": true }
```

完全退出 Coopanion（含托盘）再打开。日志里会出现：

```
token-cost: 读取 <data>\home\companion\data\usage.jsonl，已载入 N 条记录
```

设置里的 World 页面会多出「Token 用量」，面板里就是那张表。

## 排错

| 现象 | 先看 |
| --- | --- |
| 面板是空的 | `usage.jsonl` 里有没有新记录；日志里是否 `找不到 usage.jsonl` |
| 金额全是 `≈` | 记录里没有 `charges`（旧版本 Coopanion），按内置表估算，可自行改 `index.js` 的价目表 |
| 数字不刷新 | 面板每 3 秒拉一次；Host 卡住时下次请求会失败重试 |
| 想换行数 | 改 `client.js` 里的 `limit`（默认 400） |

## 开发

```bash
node test/run.mjs
```

测试用一个假的 `usage.jsonl` 覆盖：读取、按记录计费、无记录时回退估价、追加后增量更新、文件缺失时报错。

## 许可

MIT。社区扩展，与 Coopanion / Pal AI Lab / DeepSeek 官方无关。
