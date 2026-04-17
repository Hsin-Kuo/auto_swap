import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { keystoreExists, loadFromKeystore } from "./keystore.js";

export async function loadWallet(): Promise<Keypair> {
  let privateKeyBase58: string;

  if (keystoreExists()) {
    console.log("Loading wallet from encrypted keystore...");
    privateKeyBase58 = await loadFromKeystore();
  } else {
    throw new Error(
      "No keystore found. Run `npm run setup` to encrypt your private key first.",
    );
  }

  const secretKey = bs58.decode(privateKeyBase58);
  return Keypair.fromSecretKey(secretKey);
}
