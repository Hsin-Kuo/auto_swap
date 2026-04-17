import { CONFIG } from "./config.js";

// Track daily gas spending to enforce budget
export class GasTracker {
  private spentLamports = 0;
  private currentDate: string;

  constructor() {
    this.currentDate = this.today();
  }

  private today(): string {
    return new Date().toISOString().split("T")[0]!;
  }

  private resetIfNewDay(): void {
    const now = this.today();
    if (now !== this.currentDate) {
      console.log(`[GasTracker] New day (${now}), resetting gas budget.`);
      this.spentLamports = 0;
      this.currentDate = now;
    }
  }

  get budgetLamports(): number {
    return CONFIG.DAILY_GAS_BUDGET_SOL * 1e9;
  }

  get remainingLamports(): number {
    this.resetIfNewDay();
    return this.budgetLamports - this.spentLamports;
  }

  canAfford(estimatedFeeLamports: number): boolean {
    this.resetIfNewDay();
    return this.spentLamports + estimatedFeeLamports <= this.budgetLamports;
  }

  record(feeLamports: number): void {
    this.resetIfNewDay();
    this.spentLamports += feeLamports;
  }

  hasBudget(): boolean {
    this.resetIfNewDay();
    return this.spentLamports < this.budgetLamports;
  }

  summary(): string {
    this.resetIfNewDay();
    const spent = (this.spentLamports / 1e9).toFixed(6);
    const budget = CONFIG.DAILY_GAS_BUDGET_SOL.toFixed(6);
    const pct = ((this.spentLamports / this.budgetLamports) * 100).toFixed(1);
    return `Gas: ${spent}/${budget} SOL (${pct}%)`;
  }
}
