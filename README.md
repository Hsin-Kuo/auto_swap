# Solana Auto Swap Bot

自動執行 USDC ↔ SOL 小額 swap，用於刷鏈上活動量。透過 Jupiter V6 聚合器執行交易，金額與時間間隔皆隨機化。

採用 **Round-trip 模式（USDC→SOL→USDC）**：以 USDC 為本金，每輪先換成 SOL 再立即換回，不持有 SOL 方向性曝險。損耗只有來回 slippage + 手續費，透過 `usdc_delta` 欄位可直接觀察每輪磨損。

## 功能

- **Round-trip swap**：USDC→SOL（Leg 1）→ SOL→USDC（Leg 2）成對執行
- **USDC 為本金**：SOL 僅作為 gas 儲備，不受 SOL 價格波動影響
- **損耗追蹤**：每輪記錄 `usdc_delta`（收回 USDC − 投入 USDC），可直接加總看累積磨損
- 每筆金額 2~13 USDC 隨機，Leg 2 使用 Leg 1 實際收到的 SOL 精確換回
- 每天約 100 輪 round-trip（200 筆交易），間隔 5~24 分鐘隨機分散
- AES-256-GCM 加密私鑰，啟動時密碼解鎖
- 支援助記詞（mnemonic）匯入
- Leg 2 失敗自動重試最多 3 次（間隔 10 秒）
- 每日 gas 預算上限
- CSV 列式儲存交易紀錄（Leg 1 / Leg 2 各自一筆）

## 安裝

```bash
npm install
```

## 設定

### 1. 設定 RPC

複製 `.env.example` 為 `.env`，填入 RPC endpoint（建議使用付費 RPC 如 Helius、QuickNode）：

```bash
cp .env.example .env
```

```env
RPC_URL=https://api.mainnet-beta.solana.com
```

### 2. 匯入錢包

```bash
npm run setup
```

可選擇兩種匯入方式：

- **(1) Private Key** — 輸入 base58 格式私鑰
- **(2) Mnemonic Phrase** — 輸入 12/24 個助記詞，會列出前 5 個衍生錢包供選擇

所有敏感輸入皆以 `*` 遮罩顯示。私鑰經加密後存為 `keystore.enc`，原始私鑰不會被儲存。

## 啟動

```bash
npm start
```

啟動時需輸入 keystore 密碼解鎖錢包。

## Dashboard

在另一個終端機執行：

```bash
npm run dashboard
```

開啟瀏覽器前往 `http://localhost:3000`，可查看：

- 每日交易統計（筆數、成功/失敗、交易量、手續費）
- **累積 USDC 損耗**與**平均每輪損耗**
- **USDC 損耗曲線圖**（每輪 round-trip 的累積 delta）
- 逐筆交易明細（含 USDC Delta 欄位）

## 參數調整

編輯 `src/config.ts`：

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `MIN_AMOUNT_USD` | 2 | 最小 swap 金額（USDC） |
| `MAX_AMOUNT_USD` | 13 | 最大 swap 金額（USDC） |
| `SLIPPAGE_BPS` | 150 | 滑點容忍度（150 = 1.5%） |
| `MIN_INTERVAL_SEC` | 300 | 最短交易間隔（秒） |
| `MAX_INTERVAL_SEC` | 1440 | 最長交易間隔（秒） |
| `MIN_SOL_RESERVE` | 0.05 | SOL 最低保留量（gas 用途，不動） |
| `MIN_USDC_RESERVE` | 1 | USDC 最低保留量 |
| `DAILY_GAS_BUDGET_SOL` | 0.1 | 每日 gas 花費上限（SOL） |
| `MAX_PRIORITY_FEE_LAMPORTS` | 500,000 | 單筆 priority fee 上限（lamports） |

## 交易紀錄

每日自動產生 CSV 檔案於 `logs/` 目錄：

```
logs/transactions_2026-04-18.csv
```

欄位：

```
timestamp, direction, input_amount, output_amount, input_token, output_token,
tx_hash, status, fee_sol, usdc_delta, error
```

`usdc_delta` 只出現在 Leg 2（SOL→USDC）成功的紀錄，負數代表當輪損耗。加總所有 `usdc_delta` 即為總磨損金額。

## 安全機制

- **私鑰加密儲存** — AES-256-GCM + scrypt KDF，密碼錯誤無法解鎖
- **輸入遮罩** — 私鑰、助記詞、密碼輸入時以 `*` 顯示
- **Round-trip 設計** — USDC 本金不受 SOL 價格波動影響
- **Leg 2 重試** — 回程 swap 失敗自動重試最多 3 次（間隔 10 秒）
- **餘額保護** — 保留最低 SOL（gas）與 USDC（本金下限），不會把餘額用完
- **Gas 預算** — 每日上限，耗盡自動暫停到隔天
- **Priority fee 上限** — 防止高峰期被收高額手續費
- **連續失敗熔斷** — 連續 5 次失敗暫停 30 分鐘

## 專案結構

```
auto_swap/
├── src/
│   ├── index.ts        # 主迴圈入口
│   ├── config.ts       # 設定參數
│   ├── setup.ts        # 錢包匯入 & keystore 建立
│   ├── keystore.ts     # AES-256-GCM 加解密
│   ├── wallet.ts       # 錢包載入
│   ├── mnemonic.ts     # 助記詞 → 私鑰衍生（BIP44）
│   ├── swap.ts         # Jupiter V6 swap 執行
│   ├── balance.ts      # 餘額檢查
│   ├── gas-tracker.ts  # 每日 gas 預算追蹤
│   ├── random.ts       # 隨機金額/間隔
│   ├── logger.ts       # CSV 交易紀錄
│   └── prompt.ts       # 安全輸入（遮罩）
├── logs/               # 交易紀錄 CSV
├── keystore.enc        # 加密後的私鑰（勿外傳）
├── .env                # RPC 設定
└── .gitignore
```
