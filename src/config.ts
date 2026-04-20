import "dotenv/config";

export const CONFIG = {
  // RPC endpoints (auto fallback, no registration required)
  RPC_URLS: process.env["RPC_URL"]
    ? [process.env["RPC_URL"]]
    : [
        "https://api.mainnet-beta.solana.com",
        "https://rpc.ankr.com/solana",
        "https://solana-rpc.publicnode.com",
        "https://solana-api.projectserum.com",
      ],

  // Token Mints
  SOL_MINT: "So11111111111111111111111111111111111111112",
  USDC_MINT: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",

  // Swap settings
  MIN_AMOUNT_USD: 2,
  MAX_AMOUNT_USD: 13,
  SLIPPAGE_BPS: 150, // 1.5%

  // Schedule: ~100 round trips/day spread over 24h (each round trip = 2 txs)
  DAILY_ROUND_TRIP_COUNT: 100,
  // Min/max interval between round trips (seconds)
  MIN_INTERVAL_SEC: 300,   // 5 min
  MAX_INTERVAL_SEC: 1440,  // 24 min
  // Average ~14.4 min = 864 sec to hit ~100 round trips/day (~200 txs/day)

  // Jupiter API
  JUPITER_API_URL: "https://lite-api.jup.ag/swap/v1",

  // Safety guards
  MIN_SOL_RESERVE: 0.05,        // SOL→USDC 時保留的最低 SOL（確保不動到 gas 儲備）
  MIN_SOL_FOR_GAS: 0.005,       // USDC→SOL 時只需這麼多 SOL 即可付 gas（swap 本身會增加 SOL）
  MIN_USDC_RESERVE: 1,          // Keep at least 1 USDC as buffer
  DAILY_GAS_BUDGET_SOL: 0.1,    // Max SOL spent on gas per day
  MAX_PRIORITY_FEE_LAMPORTS: 500_000, // Cap priority fee at 0.0005 SOL
  MAX_FEE_LAMPORTS: 100_000,          // Skip swap if estimated fee > 0.0001 SOL (Leg 1)
  MAX_FEE_LAMPORTS_LEG2: 300_000,     // Leg 2 允許更高手續費，避免 SOL 卡在帳上

  // Logging
  LOG_DIR: "./logs",
} as const;
