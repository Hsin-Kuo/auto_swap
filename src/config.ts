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

  // Schedule: ~100 txs/day spread over 24h
  DAILY_TX_COUNT: 100,
  // Min/max interval between swaps (seconds)
  MIN_INTERVAL_SEC: 300,   // 5 min
  MAX_INTERVAL_SEC: 1440,  // 24 min
  // Average ~14.4 min = 864 sec to hit ~100/day

  // Jupiter API
  JUPITER_API_URL: "https://lite-api.jup.ag/swap/v1",

  // Safety guards
  MIN_SOL_RESERVE: 0.05,        // Always keep at least 0.05 SOL for rent/gas
  MIN_USDC_RESERVE: 1,          // Keep at least 1 USDC as buffer
  DAILY_GAS_BUDGET_SOL: 0.1,    // Max SOL spent on gas per day
  MAX_PRIORITY_FEE_LAMPORTS: 500_000, // Cap priority fee at 0.0005 SOL
  MAX_FEE_LAMPORTS: 100_000,          // Skip swap if estimated fee > 0.0001 SOL

  // Logging
  LOG_DIR: "./logs",
} as const;
