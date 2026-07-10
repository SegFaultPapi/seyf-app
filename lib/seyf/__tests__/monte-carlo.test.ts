import { describe, expect, it } from "vitest";
import { SeededRandom } from "../../math/prng";
import { runYieldSimulation } from "../../math/simulation-engine";

describe("Monte Carlo PRNG & Normal Distribution", () => {
  it("generates deterministic uniform random numbers with a fixed seed", () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);

    const sequence1 = Array.from({ length: 10 }, () => rng1.next());
    const sequence2 = Array.from({ length: 10 }, () => rng2.next());

    expect(sequence1).toEqual(sequence2);
    expect(sequence1.every((val) => val >= 0 && val < 1)).toBe(true);
  });

  it("generates deterministic normally distributed numbers Z ~ N(0,1)", () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const normal1 = Array.from({ length: 10 }, () => rng1.nextNormal());
    const normal2 = Array.from({ length: 10 }, () => rng2.nextNormal());

    expect(normal1).toEqual(normal2);
  });
});

describe("Monte Carlo Simulation Engine", () => {
  it("produces identical outputs on consecutive runs with the same seed", () => {
    const result1 = runYieldSimulation({ seed: 42, numTrials: 100 });
    const result2 = runYieldSimulation({ seed: 42, numTrials: 100 });

    expect(result1).toEqual(result2);
  });

  it("calculates expected net profit, standard deviation, and VaR correctly", () => {
    const result = runYieldSimulation({
      seed: 42,
      numTrials: 500,
      initialCapital: 100000,
      utilizationRate: 0.8,
    });

    // Check that we have reasonable expected outputs
    expect(result.expectedNetProfit).toBeGreaterThan(0);
    expect(result.profitStandardDeviation).toBeGreaterThan(0);
    expect(result.valueAtRisk95).toBeTypeOf("number");
    expect(result.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfLoss).toBeLessThanOrEqual(1);

    // Verify percentiles are sorted
    const { p5, p10, p50, p90, p95 } = result.percentiles;
    expect(p5).toBeLessThanOrEqual(p10);
    expect(p10).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
  });

  it("exhibits sensitivity to default rate (higher defaults -> lower expected profit & higher VaR)", () => {
    const lowDefaultResult = runYieldSimulation({
      seed: 42,
      numTrials: 200,
      initialDefaultRate: 0.02,
      defaultLongTermMean: 0.02,
    });

    const highDefaultResult = runYieldSimulation({
      seed: 42,
      numTrials: 200,
      initialDefaultRate: 0.15,
      defaultLongTermMean: 0.15,
    });

    expect(highDefaultResult.expectedNetProfit).toBeLessThan(lowDefaultResult.expectedNetProfit);
    expect(highDefaultResult.valueAtRisk95).toBeGreaterThan(lowDefaultResult.valueAtRisk95);
  });

  it("exhibits sensitivity to volatility (higher interest rate volatility -> higher standard deviation)", () => {
    const lowVolResult = runYieldSimulation({
      seed: 100,
      numTrials: 200,
      rateVolatility: 0.005,
    });

    const highVolResult = runYieldSimulation({
      seed: 100,
      numTrials: 200,
      rateVolatility: 0.08,
    });

    expect(highVolResult.profitStandardDeviation).toBeGreaterThan(lowVolResult.profitStandardDeviation);
  });
});
