import { CONFIG } from "./config.js";

// Uniform random float in [min, max]
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Random integer in [min, max]
export function randomInt(min: number, max: number): number {
  return Math.floor(randomFloat(min, max + 1));
}

// Random swap amount in USDC (2~13), returns with 2 decimal places
export function randomAmountUSD(): number {
  const amount = randomFloat(CONFIG.MIN_AMOUNT_USD, CONFIG.MAX_AMOUNT_USD);
  return Math.round(amount * 100) / 100;
}

// Random delay between swaps (in ms)
export function randomDelayMs(): number {
  const sec = randomFloat(CONFIG.MIN_INTERVAL_SEC, CONFIG.MAX_INTERVAL_SEC);
  return Math.round(sec * 1000);
}

// Random boolean to decide swap direction
export function randomDirection(): "SOL_TO_USDC" | "USDC_TO_SOL" {
  return Math.random() < 0.5 ? "SOL_TO_USDC" : "USDC_TO_SOL";
}
