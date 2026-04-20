import { createInterface } from "readline";
import { loadWallet } from "./wallet.js";
import { executeSwap, getSolPrice, FeeExceededError } from "./swap.js";
import { logTransaction, type TxRecord } from "./logger.js";
import { randomAmountUSD, randomDelayMs } from "./random.js";
import { checkBalance, getSolBalance, getUsdcBalance } from "./balance.js";
import { GasTracker } from "./gas-tracker.js";
import { RpcManager } from "./rpc.js";
import { CONFIG } from "./config.js";

interface RunConfig {
  minAmountUSD: number;
  maxAmountUSD: number;
  dailyRoundTripCount: number;
  minIntervalSec: number;
  maxIntervalSec: number;
}

async function logDailySnapshot(rpc: RpcManager, wallet: import("@solana/web3.js").Keypair): Promise<void> {
  const sol  = await getSolBalance(rpc, wallet);
  const usdc = await getUsdcBalance(rpc, wallet);
  await logTransaction({
    timestamp: new Date().toISOString(),
    type: "balance_snapshot",
    direction: "SOL_TO_USDC",
    inputAmount: sol.toFixed(6),
    inputToken: "SOL",
    outputAmount: usdc.toFixed(2),
    outputToken: "USDC",
    txHash: "",
    status: "success",
  });
  console.log(`[Snapshot] SOL: ${sol.toFixed(6)} | USDC: ${usdc.toFixed(2)}`);
}

async function stopBot(reason: string): Promise<never> {
  console.error(`[Stop] ${reason}`);
  await logTransaction({
    timestamp: new Date().toISOString(),
    type: "stopped",
    direction: "SOL_TO_USDC",
    inputAmount: "",
    outputAmount: "",
    inputToken: "",
    outputToken: "",
    txHash: "",
    status: "failed",
    error: reason,
  });
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

async function promptConfig(): Promise<RunConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  const defaults: RunConfig = {
    minAmountUSD: CONFIG.MIN_AMOUNT_USD,
    maxAmountUSD: CONFIG.MAX_AMOUNT_USD,
    dailyRoundTripCount: CONFIG.DAILY_ROUND_TRIP_COUNT,
    minIntervalSec: CONFIG.MIN_INTERVAL_SEC,
    maxIntervalSec: CONFIG.MAX_INTERVAL_SEC,
  };

  console.log("=== 參數設定 ===\n");
  console.log(`  1) 使用預設值`);
  console.log(`       金額 $${defaults.minAmountUSD}–$${defaults.maxAmountUSD}　每日 ${defaults.dailyRoundTripCount} 次　間隔 ${defaults.minIntervalSec}s–${defaults.maxIntervalSec}s`);
  console.log(`  2) 自訂\n`);

  const choice = (await ask("選擇 [1]: ")).trim();
  if (choice !== "2") {
    rl.close();
    console.log();
    return defaults;
  }

  console.log();
  const parseFloat2 = (s: string, def: number) => { const n = parseFloat(s.trim()); return isNaN(n) ? def : n; };
  const parseInt2   = (s: string, def: number) => { const n = parseInt(s.trim(), 10); return isNaN(n) ? def : n; };

  const minAmt  = parseFloat2(await ask(`交易金額下限 USD [${defaults.minAmountUSD}]: `), defaults.minAmountUSD);
  const maxAmt  = parseFloat2(await ask(`交易金額上限 USD [${defaults.maxAmountUSD}]: `), defaults.maxAmountUSD);
  const rtCount = parseInt2(await ask(`每日 round trip 次數 [${defaults.dailyRoundTripCount}]: `), defaults.dailyRoundTripCount);
  const minInt  = parseInt2(await ask(`交易間隔下限（秒）[${defaults.minIntervalSec}]: `), defaults.minIntervalSec);
  const maxInt  = parseInt2(await ask(`交易間隔上限（秒）[${defaults.maxIntervalSec}]: `), defaults.maxIntervalSec);

  rl.close();
  console.log();

  return {
    minAmountUSD: minAmt,
    maxAmountUSD: Math.max(maxAmt, minAmt),
    dailyRoundTripCount: rtCount,
    minIntervalSec: minInt,
    maxIntervalSec: Math.max(maxInt, minInt),
  };
}

async function main(): Promise<void> {
  console.log("=== Solana Auto Swap Bot (Round-trip mode: USDC→SOL→USDC) ===\n");

  const run = await promptConfig();

  console.log(`Target: ~${run.dailyRoundTripCount} round-trips/day (~${run.dailyRoundTripCount * 2} txs)`);
  console.log(`Amount range: $${run.minAmountUSD} - $${run.maxAmountUSD}`);
  console.log(`Interval: ${run.minIntervalSec}s - ${run.maxIntervalSec}s`);
  console.log(`SOL reserve (Leg2): ${CONFIG.MIN_SOL_RESERVE} SOL`);
  console.log(`SOL min for gas:    ${CONFIG.MIN_SOL_FOR_GAS} SOL`);
  console.log(`USDC reserve: ${CONFIG.MIN_USDC_RESERVE} USDC`);
  console.log(`Daily gas budget: ${CONFIG.DAILY_GAS_BUDGET_SOL} SOL\n`);

  const wallet = await loadWallet();
  const rpc = new RpcManager();
  const gasTracker = new GasTracker();

  console.log(`\nWallet: ${wallet.publicKey.toBase58()}`);

  const solBal = await getSolBalance(rpc, wallet);
  const usdcBal = await getUsdcBalance(rpc, wallet);
  console.log(`SOL Balance:  ${solBal.toFixed(4)} SOL`);
  console.log(`USDC Balance: ${usdcBal.toFixed(2)} USDC\n`);

  if (solBal < CONFIG.MIN_SOL_FOR_GAS) {
    await stopBot(`SOL 餘額不足以支付 gas（${solBal.toFixed(6)} SOL < ${CONFIG.MIN_SOL_FOR_GAS} SOL）`);
  }

  await logDailySnapshot(rpc, wallet);

  let txCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;

  while (true) {
    // Gas budget check
    if (!gasTracker.hasBudget()) {
      console.log(`[Budget] Daily gas budget exhausted. ${gasTracker.summary()}`);
      console.log("[Budget] Waiting until next day...\n");
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const msUntilMidnight = tomorrow.getTime() - now.getTime() + 60_000;
      await sleep(msUntilMidnight);
      await logDailySnapshot(rpc, wallet);
      continue;
    }

    const amountUSD = randomAmountUSD(run.minAmountUSD, run.maxAmountUSD);
    const delayMs = randomDelayMs(run.minIntervalSec, run.maxIntervalSec);

    // Get SOL price for balance check
    let solPrice: number;
    try {
      solPrice = await getSolPrice();
    } catch {
      console.log(`  ✗ Failed to fetch SOL price, skipping this round.`);
      await sleep(30_000);
      continue;
    }

    const leg1SolBal  = await getSolBalance(rpc, wallet);
    const leg1UsdcBal = await getUsdcBalance(rpc, wallet);
    if (leg1SolBal < CONFIG.MIN_SOL_FOR_GAS) {
      await stopBot(`SOL 不足以支付 gas（${leg1SolBal.toFixed(6)} SOL < ${CONFIG.MIN_SOL_FOR_GAS}）`);
    }
    if (leg1UsdcBal - CONFIG.MIN_USDC_RESERVE < amountUSD) {
      await stopBot(`USDC 不足（可用 ${(leg1UsdcBal - CONFIG.MIN_USDC_RESERVE).toFixed(2)}，需要 ${amountUSD.toFixed(2)}）`);
    }

    txCount++;
    console.log(
      `[#${txCount}] Round-trip | $${amountUSD.toFixed(2)} | ${gasTracker.summary()} | RPC: ${rpc.currentUrl}`,
    );

    // --- Leg 1: USDC → SOL ---
    const leg1: TxRecord = {
      timestamp: new Date().toISOString(),
      type: "leg1",
      direction: "USDC_TO_SOL",
      inputAmount: "",
      outputAmount: "",
      inputToken: "USDC",
      outputToken: "SOL",
      txHash: "",
      status: "failed",
    };


    try {
      const result1 = await executeSwap(rpc, wallet, "USDC_TO_SOL", amountUSD, gasTracker, solPrice);
      leg1.txHash = result1.txHash;
      leg1.inputAmount = result1.inAmount;
      leg1.outputAmount = result1.outAmount;
      leg1.feeSol = (result1.feeLamports / 1e9).toFixed(6);
      leg1.status = "success";

      consecutiveFailures = 0;
      console.log(`  ✓ Leg1: ${leg1.inputAmount} USDC → ${leg1.outputAmount} SOL`);
      console.log(`    tx: ${result1.txHash} | fee: ${leg1.feeSol} SOL`);
    } catch (err) {
      if (err instanceof FeeExceededError) {
        leg1.error = err.message;
        console.log(`  ⚠ Leg1: ${err.message}`);
        await logTransaction(leg1);
        console.log(`  Retrying in 2 minutes...\n`);
        await sleep(120_000);
        continue;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      leg1.error = errorMsg;
      consecutiveFailures++;
      console.log(`  ✗ Leg1 Failed: ${errorMsg}`);
      await logTransaction(leg1);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(`\n[Safety] ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Pausing 30 minutes...`);
        await sleep(1_800_000);
        consecutiveFailures = 0;
      }
      console.log(`  Next swap in ${formatTime(delayMs)}\n`);
      await sleep(delayMs);
      continue;
    }
    await logTransaction(leg1);

    // 讀取 Leg 1 後的實際 SOL 餘額，扣掉 reserve 才是可用量
    // 額外預留 MAX_FEE_LAMPORTS_LEG2 作為 Leg 2 本身的 gas buffer，
    // 避免 gas 從 reserve 扣除導致下一輪 balance check 失敗
    const solAfterLeg1 = await getSolBalance(rpc, wallet);
    const availableSolLamports = Math.floor((solAfterLeg1 - CONFIG.MIN_SOL_RESERVE) * 1e9);
    if (availableSolLamports <= 0) {
      console.log(`  [Leg2] Leg1 後 SOL 餘額不足以換回（${solAfterLeg1.toFixed(6)} SOL），跳過\n`);
      await sleep(delayMs);
      continue;
    }

    // --- Leg 2: SOL → USDC (用 Leg1 實際收到的 SOL lamports 全部換回) ---
    const leg2: TxRecord = {
      timestamp: new Date().toISOString(),
      type: "leg2",
      direction: "SOL_TO_USDC",
      inputAmount: "",
      outputAmount: "",
      inputToken: "SOL",
      outputToken: "USDC",
      txHash: "",
      status: "failed",
    };

    const LEG2_MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= LEG2_MAX_RETRIES; attempt++) {
      try {
        const result2 = await executeSwap(
          rpc, wallet, "SOL_TO_USDC", amountUSD, gasTracker, solPrice,
          availableSolLamports, CONFIG.MAX_FEE_LAMPORTS_LEG2,
        );
        leg2.txHash = result2.txHash;
        leg2.inputAmount = result2.inAmount;
        leg2.outputAmount = result2.outAmount;
        leg2.feeSol = (result2.feeLamports / 1e9).toFixed(6);
        leg2.status = "success";
        leg2.error = undefined;
        // USDC delta：收回 - 投入（負數 = 損耗）
        const usdcDelta = Number(result2.outAmount) - amountUSD;
        leg2.usdcDelta = usdcDelta.toFixed(4);
        consecutiveFailures = 0;
        console.log(`  ✓ Leg2: ${leg2.inputAmount} SOL → ${leg2.outputAmount} USDC`);
        console.log(`    tx: ${result2.txHash} | fee: ${leg2.feeSol} SOL`);
        console.log(`    USDC delta: ${usdcDelta >= 0 ? "+" : ""}${leg2.usdcDelta} (投入 $${amountUSD.toFixed(2)})`);
        break;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        leg2.error = errorMsg;
        if (err instanceof FeeExceededError) {
          console.log(`  ⚠ Leg2 attempt ${attempt}: ${err.message}`);
          if (attempt < LEG2_MAX_RETRIES) {
            console.log(`    等待 2 分鐘後重試...`);
            await sleep(120_000);
          } else {
            console.log(`  ⚠ Leg2 手續費持續過高，殘留 SOL 將於下輪 sweep`);
          }
          continue;
        }
        console.log(`  ✗ Leg2 attempt ${attempt}/${LEG2_MAX_RETRIES} failed: ${errorMsg}`);
        if (attempt < LEG2_MAX_RETRIES) {
          console.log(`    Retrying in 10s...`);
          await sleep(10_000);
        } else {
          consecutiveFailures++;
          console.log(`  ⚠ Leg2 gave up after ${LEG2_MAX_RETRIES} attempts — ${(availableSolLamports / 1e9).toFixed(6)} SOL left in wallet`);
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.log(`\n[Safety] ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Pausing 30 minutes...`);
            await sleep(1_800_000);
            consecutiveFailures = 0;
          }
        }
      }
    }
    await logTransaction(leg2);

    console.log(`  Next round-trip in ${formatTime(delayMs)}\n`);
    await sleep(delayMs);
  }
}

main().catch(console.error);
