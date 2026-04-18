import { loadWallet } from "./wallet.js";
import { executeSwap, getSolPrice, FeeExceededError } from "./swap.js";
import { logTransaction, type TxRecord } from "./logger.js";
import { randomAmountUSD, randomDelayMs } from "./random.js";
import { checkBalance, getSolBalance, getUsdcBalance } from "./balance.js";
import { GasTracker } from "./gas-tracker.js";
import { RpcManager } from "./rpc.js";
import { CONFIG } from "./config.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTime(ms: number): string {
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

async function main(): Promise<void> {
  console.log("=== Solana Auto Swap Bot (Round-trip mode: USDC→SOL→USDC) ===");
  console.log(`Target: ~${CONFIG.DAILY_TX_COUNT} txs/day (2 txs per round-trip)`);
  console.log(`Amount range: $${CONFIG.MIN_AMOUNT_USD} - $${CONFIG.MAX_AMOUNT_USD}`);
  console.log(`Interval: ${CONFIG.MIN_INTERVAL_SEC}s - ${CONFIG.MAX_INTERVAL_SEC}s`);
  console.log(`SOL reserve: ${CONFIG.MIN_SOL_RESERVE} SOL`);
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

  if (solBal < CONFIG.MIN_SOL_RESERVE) {
    console.error(
      `SOL balance (${solBal.toFixed(4)}) below minimum reserve (${CONFIG.MIN_SOL_RESERVE}). Exiting.`,
    );
    process.exit(1);
  }

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
      continue;
    }

    const amountUSD = randomAmountUSD();
    const delayMs = randomDelayMs();

    // Get SOL price for balance check
    let solPrice: number;
    try {
      solPrice = await getSolPrice();
    } catch {
      console.log(`  ✗ Failed to fetch SOL price, skipping this round.`);
      await sleep(30_000);
      continue;
    }

    // Leg 1 是 USDC→SOL，檢查 USDC 餘額
    const balCheck = await checkBalance(rpc, wallet, "USDC_TO_SOL", amountUSD, solPrice);
    if (!balCheck.ok) {
      console.log(`  [Balance] ${balCheck.reason}`);
      console.log(`  Waiting 5 minutes before retry...\n`);
      await sleep(300_000);
      continue;
    }

    txCount++;
    console.log(
      `[#${txCount}] Round-trip | $${amountUSD.toFixed(2)} | ${gasTracker.summary()} | RPC: ${rpc.currentUrl}`,
    );

    // --- Leg 1: USDC → SOL ---
    const leg1: TxRecord = {
      timestamp: new Date().toISOString(),
      direction: "USDC_TO_SOL",
      inputAmount: "",
      outputAmount: "",
      inputToken: "USDC",
      outputToken: "SOL",
      txHash: "",
      status: "failed",
    };

    let solReceivedLamports = 0;
    try {
      const result1 = await executeSwap(rpc, wallet, "USDC_TO_SOL", amountUSD, gasTracker, solPrice);
      leg1.txHash = result1.txHash;
      leg1.inputAmount = result1.inAmount;
      leg1.outputAmount = result1.outAmount;
      leg1.feeSol = (result1.feeLamports / 1e9).toFixed(6);
      leg1.status = "success";
      solReceivedLamports = Math.round(Number(result1.outAmount) * 1e9);
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

    // --- Leg 2: SOL → USDC (用 Leg1 實際收到的 SOL lamports 全部換回) ---
    const leg2: TxRecord = {
      timestamp: new Date().toISOString(),
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
          solReceivedLamports,
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
          console.log(`  ⚠ Leg2: ${err.message}`);
          break;
        }
        console.log(`  ✗ Leg2 attempt ${attempt}/${LEG2_MAX_RETRIES} failed: ${errorMsg}`);
        if (attempt < LEG2_MAX_RETRIES) {
          console.log(`    Retrying in 10s...`);
          await sleep(10_000);
        } else {
          consecutiveFailures++;
          console.log(`  ⚠ Leg2 gave up after ${LEG2_MAX_RETRIES} attempts — ${(solReceivedLamports / 1e9).toFixed(6)} SOL left in wallet`);
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
