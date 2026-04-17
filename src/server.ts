import express from "express";
import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { CONFIG } from "./config.js";

const app = express();
const PORT = 3000;

app.use(express.static(path.join(process.cwd(), "public")));

// List available dates
app.get("/api/dates", (_req, res) => {
  if (!existsSync(CONFIG.LOG_DIR)) {
    res.json([]);
    return;
  }
  const files = readdirSync(CONFIG.LOG_DIR)
    .filter((f) => f.startsWith("transactions_") && f.endsWith(".csv"))
    .map((f) => f.replace("transactions_", "").replace(".csv", ""))
    .sort()
    .reverse();
  res.json(files);
});

// Return transactions for a given date
app.get("/api/transactions", (req, res) => {
  const date = req.query["date"] as string;
  if (!date) {
    res.status(400).json({ error: "Missing date parameter" });
    return;
  }

  const filePath = path.join(CONFIG.LOG_DIR, `transactions_${date}.csv`);
  if (!existsSync(filePath)) {
    res.json([]);
    return;
  }

  const lines = readFileSync(filePath, "utf8").trim().split("\n");
  if (lines.length < 2) {
    res.json([]);
    return;
  }

  const headers = parseCSVLine(lines[0]);
  const records = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });

  res.json(records);
});

// Minimal CSV parser that handles quoted fields with commas/newlines
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});
