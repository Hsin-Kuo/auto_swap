import { loadWallet } from "./wallet.js";
import { executeSwap, getSolPrice, FeeExceededError } from "./swap.js";
import { logTransaction, type TxRecord } from "./logger.js";
import { randomAmountUSD, randomDelayMs, randomDirection } from "./random.js";
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
  console.log("=== Solana Auto Swap Bot ===");
  console.log(`Target: ~${CONFIG.DAILY_TX_COUNT} txs/day`);
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

    let direction = randomDirection();
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

    // Balance check — if insufficient, try flipping direction
    let balCheck = await checkBalance(rpc, wallet, direction, amountUSD, solPrice);
    if (!balCheck.ok) {
      const flipped = direction === "SOL_TO_USDC" ? "USDC_TO_SOL" : "SOL_TO_USDC";
      const flippedCheck = await checkBalance(rpc, wallet, flipped, amountUSD, solPrice);
      if (flippedCheck.ok) {
        console.log(`  [Balance] ${balCheck.reason}`);
        console.log(`  [Balance] Flipping direction to ${flipped}`);
        direction = flipped;
        balCheck = flippedCheck;
      } else {
        console.log(`  [Balance] Insufficient in both directions:`);
        console.log(`    SOL→USDC: ${balCheck.reason}`);
        console.log(`    USDC→SOL: ${flippedCheck.reason}`);
        console.log(`  Waiting 5 minutes before retry...\n`);
        await sleep(300_000);
        continue;
      }
    }

    txCount++;
    console.log(
      `[#${txCount}] ${direction} | $${amountUSD.toFixed(2)} | ${gasTracker.summary()} | RPC: ${rpc.currentUrl}`,
    );

    const record: TxRecord = {
      timestamp: new Date().toISOString(),
      direction,
      inputAmount: "",
      outputAmount: "",
      inputToken: direction === "SOL_TO_USDC" ? "SOL" : "USDC",
      outputToken: direction === "SOL_TO_USDC" ? "USDC" : "SOL",
      txHash: "",
      status: "failed",
    };

    try {
      const result = await executeSwap(rpc, wallet, direction, amountUSD, gasTracker, solPrice);

      record.txHash = result.txHash;
      record.inputAmount = result.inAmount;
      record.outputAmount = result.outAmount;
      record.feeSol = (result.feeLamports / 1e9).toFixed(6);
      record.status = "success";
      consecutiveFailures = 0;

      console.log(
        `  ✓ ${record.inputAmount} ${record.inputToken} → ${record.outputAmount} ${record.outputToken}`,
      );
      console.log(`    tx: ${result.txHash}`);
      console.log(`    fee: ${(result.feeLamports / 1e9).toFixed(6)} SOL`);
    } catch (err) {
      if (err instanceof FeeExceededError) {
        console.log(`  ⚠ ${err.message}`);
        console.log(`  Retrying in 2 minutes...\n`);
        await sleep(120_000);
        continue;
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      record.error = errorMsg;
      consecutiveFailures++;
      console.log(`  ✗ Failed: ${errorMsg}`);

      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.log(
          `\n[Safety] ${MAX_CONSECUTIVE_FAILURES} consecutive failures. Pausing 30 minutes...`,
        );
        await sleep(1_800_000);
        consecutiveFailures = 0;
      }
    }

    await logTransaction(record);

    console.log(`  Next swap in ${formatTime(delayMs)}\n`);
    await sleep(delayMs);
  }
}

main().catch(console.error);
