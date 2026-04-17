import { createObjectCsvWriter } from "csv-writer";
import { existsSync, mkdirSync } from "fs";
import { CONFIG } from "./config.js";

export interface TxRecord {
  timestamp: string;
  direction: "SOL_TO_USDC" | "USDC_TO_SOL";
  inputAmount: string;
  outputAmount: string;
  inputToken: string;
  outputToken: string;
  txHash: string;
  status: "success" | "failed";
  feeSol?: string;
  error?: string;
}

function getLogPath(): string {
  if (!existsSync(CONFIG.LOG_DIR)) {
    mkdirSync(CONFIG.LOG_DIR, { recursive: true });
  }
  const date = new Date().toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "-");
  return `${CONFIG.LOG_DIR}/transactions_${date}.csv`;
}

export async function logTransaction(record: TxRecord): Promise<void> {
  const filePath = getLogPath();
  const fileExists = existsSync(filePath);

  const writer = createObjectCsvWriter({
    path: filePath,
    header: [
      { id: "timestamp", title: "timestamp" },
      { id: "direction", title: "direction" },
      { id: "inputAmount", title: "input_amount" },
      { id: "outputAmount", title: "output_amount" },
      { id: "inputToken", title: "input_token" },
      { id: "outputToken", title: "output_token" },
      { id: "txHash", title: "tx_hash" },
      { id: "status", title: "status" },
      { id: "feeSol", title: "fee_sol" },
      { id: "error", title: "error" },
    ],
    append: fileExists,
  });

  await writer.writeRecords([record]);
}
