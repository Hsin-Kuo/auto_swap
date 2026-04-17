import { Keypair } from "@solana/web3.js";
import { mnemonicToSeedSync, validateMnemonic } from "bip39";
import { derivePath } from "ed25519-hd-key";
import bs58 from "bs58";

// Solana BIP44 derivation path (Phantom, Solflare default)
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";

export function mnemonicToKeypair(mnemonic: string, index = 0): Keypair {
  const trimmed = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");

  if (!validateMnemonic(trimmed)) {
    throw new Error("Invalid mnemonic phrase.");
  }

  const seed = mnemonicToSeedSync(trimmed);
  const path = index === 0
    ? SOLANA_DERIVATION_PATH
    : `m/44'/501'/${index}'/0'`;

  const derived = derivePath(path, seed.toString("hex"));
  return Keypair.fromSeed(derived.key);
}

export function keypairToBase58(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}
