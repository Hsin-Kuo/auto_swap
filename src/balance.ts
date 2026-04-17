import { Keypair, PublicKey } from "@solana/web3.js";
import { CONFIG } from "./config.js";
import type { RpcManager } from "./rpc.js";

// Get SOL balance in SOL units
export async function getSolBalance(
  rpc: RpcManager,
  wallet: Keypair,
): Promise<number> {
  const lamports = await rpc.withFallback((conn) =>
    conn.getBalance(wallet.publicKey),
  );
  return lamports / 1e9;
}

// Get USDC balance via token account
export async function getUsdcBalance(
  rpc: RpcManager,
  wallet: Keypair,
): Promise<number> {
  const usdcMint = new PublicKey(CONFIG.USDC_MINT);
  const accounts = await rpc.withFallback((conn) =>
    conn.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: usdcMint }),
  );

  if (accounts.value.length === 0) return 0;

  const parsed = accounts.value[0]!.account.data.parsed as {
    info: { tokenAmount: { uiAmount: number } };
  };
  return parsed.info.tokenAmount.uiAmount;
}

// Check if we have enough balance for a swap in a given direction
export async function checkBalance(
  rpc: RpcManager,
  wallet: Keypair,
  direction: "SOL_TO_USDC" | "USDC_TO_SOL",
  amountUSD: number,
  solPrice: number,
): Promise<{ ok: boolean; reason?: string }> {
  const solBalance = await getSolBalance(rpc, wallet);
  const usdcBalance = await getUsdcBalance(rpc, wallet);

  if (direction === "SOL_TO_USDC") {
    const solNeeded = amountUSD / solPrice;
    const available = solBalance - CONFIG.MIN_SOL_RESERVE;
    if (available < solNeeded) {
      return {
        ok: false,
        reason: `SOL insufficient: have ${solBalance.toFixed(4)} SOL (${available.toFixed(4)} available after reserve), need ${solNeeded.toFixed(4)}`,
      };
    }
  } else {
    const available = usdcBalance - CONFIG.MIN_USDC_RESERVE;
    if (available < amountUSD) {
      return {
        ok: false,
        reason: `USDC insufficient: have ${usdcBalance.toFixed(2)} USDC (${available.toFixed(2)} available after reserve), need ${amountUSD.toFixed(2)}`,
      };
    }
    // Ensure minimum SOL for gas fees when swapping USDC -> SOL
    if (solBalance < CONFIG.MIN_SOL_RESERVE) {
      return {
        ok: false,
        reason: `SOL below minimum reserve (${CONFIG.MIN_SOL_RESERVE} SOL) for gas fees. Balance: ${solBalance.toFixed(4)}`,
      };
    }
  }

  return { ok: true };
}
