// Uniform random float in [min, max]
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Random integer in [min, max]
export function randomInt(min: number, max: number): number {
  return Math.floor(randomFloat(min, max + 1));
}

export function randomAmountUSD(minUSD: number, maxUSD: number): number {
  const amount = randomFloat(minUSD, maxUSD);
  return Math.round(amount * 100) / 100;
}

export function randomDelayMs(minSec: number, maxSec: number): number {
  const sec = randomFloat(minSec, maxSec);
  return Math.round(sec * 1000);
}

// Random boolean to decide swap direction
export function randomDirection(): "SOL_TO_USDC" | "USDC_TO_SOL" {
  return Math.random() < 0.5 ? "SOL_TO_USDC" : "USDC_TO_SOL";
}
