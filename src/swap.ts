import {
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import { CONFIG } from "./config.js";
import type { GasTracker } from "./gas-tracker.js";
import type { RpcManager } from "./rpc.js";

const USDC_DECIMALS = 6;
const SOL_DECIMALS = 9;

export class FeeExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeeExceededError";
  }
}

interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  routePlan: unknown[];
}

interface SwapResult {
  txHash: string;
  inAmount: string;
  outAmount: string;
  feeLamports: number;
}

// Get quote from Jupiter
async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: CONFIG.SLIPPAGE_BPS.toString(),
  });

  const res = await fetch(`${CONFIG.JUPITER_API_URL}/quote?${params}`);
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<JupiterQuote>;
}

// Get swap transaction from Jupiter
async function getSwapTransaction(
  quote: JupiterQuote,
  userPublicKey: string,
): Promise<string> {
  const res = await fetch(`${CONFIG.JUPITER_API_URL}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: CONFIG.MAX_PRIORITY_FEE_LAMPORTS,
          priorityLevel: "medium",
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Jupiter swap failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { swapTransaction: string };
  return data.swapTransaction;
}

// Get SOL price in USD (via Jupiter quote)
export async function getSolPrice(): Promise<number> {
  const priceQuote = await getQuote(
    CONFIG.USDC_MINT,
    CONFIG.SOL_MINT,
    1_000_000, // 1 USDC
  );
  const solPerUsdc = Number(priceQuote.outAmount) / 10 ** SOL_DECIMALS;
  return 1 / solPerUsdc;
}

// Execute a swap: SOL -> USDC or USDC -> SOL
// amountRawOverride: pass exact lamports/units directly, bypassing USD conversion
export async function executeSwap(
  rpc: RpcManager,
  wallet: Keypair,
  direction: "SOL_TO_USDC" | "USDC_TO_SOL",
  amountUSD: number,
  gasTracker: GasTracker,
  solPrice: number,
  amountRawOverride?: number,
): Promise<SwapResult> {
  let inputMint: string;
  let outputMint: string;
  let amountRaw: number;

  if (amountRawOverride !== undefined) {
    amountRaw = amountRawOverride;
    inputMint = direction === "SOL_TO_USDC" ? CONFIG.SOL_MINT : CONFIG.USDC_MINT;
    outputMint = direction === "SOL_TO_USDC" ? CONFIG.USDC_MINT : CONFIG.SOL_MINT;
  } else if (direction === "SOL_TO_USDC") {
    const solAmount = amountUSD / solPrice;
    inputMint = CONFIG.SOL_MINT;
    outputMint = CONFIG.USDC_MINT;
    amountRaw = Math.round(solAmount * 10 ** SOL_DECIMALS);
  } else {
    inputMint = CONFIG.USDC_MINT;
    outputMint = CONFIG.SOL_MINT;
    amountRaw = Math.round(amountUSD * 10 ** USDC_DECIMALS);
  }

  // Get quote
  const quote = await getQuote(inputMint, outputMint, amountRaw);

  // Get serialized transaction
  const swapTxBase64 = await getSwapTransaction(
    quote,
    wallet.publicKey.toBase58(),
  );

  // Deserialize and check estimated fee before signing
  const txBuf = Buffer.from(swapTxBase64, "base64");
  const tx = VersionedTransaction.deserialize(txBuf);

  const feeResult = await rpc.withFallback((conn) =>
    conn.getFeeForMessage(tx.message),
  );
  const estimatedFee = feeResult.value;
  if (estimatedFee !== null && estimatedFee > CONFIG.MAX_FEE_LAMPORTS) {
    const feeSol = (estimatedFee / 1e9).toFixed(6);
    throw new FeeExceededError(`預估手續費 ${feeSol} SOL 超過上限，跳過本次 swap`);
  }

  tx.sign([wallet]);

  const txHash = await rpc.withFallback((conn) =>
    conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    }),
  );

  // Confirm (with RPC fallback)
  await rpc.withFallback(async (conn) => {
    const latestBlockhash = await conn.getLatestBlockhash();
    await conn.confirmTransaction({
      signature: txHash,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
  });

  // Get actual fee from confirmed transaction
  let feeLamports = 5000; // default base fee
  try {
    const txDetails = await rpc.withFallback((conn) =>
      conn.getTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
      }),
    );
    if (txDetails?.meta?.fee) {
      feeLamports = txDetails.meta.fee;
    }
  } catch {
    // Use default fee estimate if lookup fails
  }
  gasTracker.record(feeLamports);

  const inDecimals = direction === "SOL_TO_USDC" ? SOL_DECIMALS : USDC_DECIMALS;
  const outDecimals = direction === "SOL_TO_USDC" ? USDC_DECIMALS : SOL_DECIMALS;

  return {
    txHash,
    feeLamports,
    inAmount: (amountRaw / 10 ** inDecimals).toFixed(inDecimals === 9 ? 6 : 2),
    outAmount: (Number(quote.outAmount) / 10 ** outDecimals).toFixed(
      outDecimals === 9 ? 6 : 2,
    ),
  };
}
