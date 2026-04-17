import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { encryptAndSave, keystoreExists } from "./keystore.js";
import { promptSecret, promptVisible } from "./prompt.js";
import { mnemonicToKeypair, keypairToBase58 } from "./mnemonic.js";

async function setup(): Promise<void> {
  console.log("=== Keystore Setup ===\n");

  if (keystoreExists()) {
    const overwrite = await promptVisible("Keystore already exists. Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const mode = await promptVisible("Import from (1) Private Key  or  (2) Mnemonic Phrase?  [1/2]: ");

  let privateKeyBase58: string;

  if (mode.trim() === "2") {
    const mnemonic = await promptSecret("Enter your mnemonic phrase (12/24 words): ");

    // Show first few derived wallets for user to pick
    console.log("\nDerived wallets:");
    const PREVIEW_COUNT = 5;
    for (let i = 0; i < PREVIEW_COUNT; i++) {
      try {
        const kp = mnemonicToKeypair(mnemonic, i);
        console.log(`  [${i}] ${kp.publicKey.toBase58()}  (m/44'/501'/${i}'/0')`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : "Invalid mnemonic.");
        process.exit(1);
      }
    }

    const indexInput = await promptVisible(`\nSelect wallet index [0-${PREVIEW_COUNT - 1}] (default 0): `);
    const index = indexInput.trim() === "" ? 0 : parseInt(indexInput.trim(), 10);

    if (isNaN(index) || index < 0) {
      console.error("Invalid index.");
      process.exit(1);
    }

    try {
      const kp = mnemonicToKeypair(mnemonic, index);
      privateKeyBase58 = keypairToBase58(kp);
      console.log(`\nSelected wallet #${index}: ${kp.publicKey.toBase58()}`);
      console.log(`(Path: m/44'/501'/${index}'/0')`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : "Invalid mnemonic.");
      process.exit(1);
    }
  } else {
    const privateKey = await promptSecret("Enter your base58 private key: ");
    try {
      const secretKey = bs58.decode(privateKey.trim());
      const kp = Keypair.fromSecretKey(secretKey);
      privateKeyBase58 = keypairToBase58(kp);
      console.log(`\nWallet address: ${kp.publicKey.toBase58()}`);
    } catch {
      console.error("Invalid private key format.");
      process.exit(1);
    }
  }

  await encryptAndSave(privateKeyBase58);

  console.log("\nDone! Run `npm start` to launch the bot.\n");
}

setup().catch(console.error);
