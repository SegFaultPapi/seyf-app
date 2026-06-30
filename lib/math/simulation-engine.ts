import { SeededRandom } from "./prng";

export interface SimulationParams {
  seed?: number;
  numTrials?: number;          // Default: 10,000
  initialCapital?: number;     // Default: 100,000 (USD)
  horizonMonths?: number;      // Default: 12
  utilizationRate?: number;    // Default: 0.80 (80% loans, 20% bonds)

  // Sovereign rate (Vasicek)
  rateMeanReversion?: number;  // k_r, Default: 2.0
  rateLongTermMean?: number;   // theta_r, Default: 0.11 (11%)
  rateVolatility?: number;     // sigma_r, Default: 0.02 (2%)
  initialRate?: number;        // Default: 0.11 (11%)

  // FX (Geometric Brownian Motion)
  fxDrift?: number;            // mu_fx, Default: 0.00
  fxVolatility?: number;       // sigma_fx, Default: 0.10 (10%)
  rateFxCorrelation?: number;  // rho, Default: -0.30
  initialFxRate?: number;      // S_0, Default: 18.0 (USD/MXN)

  // Loan Portfolio
  loanSpread?: number;         // Default: 0.15 (15% spread above reference rate)
  defaultMeanReversion?: number; // k_p, Default: 1.5
  defaultLongTermMean?: number;  // theta_p, Default: 0.05 (5%)
  defaultVolatility?: number;    // sigma_p, Default: 0.015 (1.5%)
  initialDefaultRate?: number;   // Default: 0.05 (5%)
  lgd?: number;                  // Loss Given Default, Default: 0.60 (60%)

  // Costs
  monthlyOpEx?: number;         // Default: 500 (USD)
}

export interface SimulationResult {
  expectedNetProfit: number;
  profitStandardDeviation: number;
  probabilityOfLoss: number;
  valueAtRisk95: number;
  suggestedCapitalBuffer: number;
  percentiles: {
    p5: number;
    p10: number;
    p50: number;
    p90: number;
    p95: number;
  };
}

/**
 * Runs the Monte Carlo simulation based on the provided parameters.
 */
export function runYieldSimulation(params: SimulationParams = {}): SimulationResult {
  const seed = params.seed ?? 42;
  const numTrials = params.numTrials ?? 10000;
  const initialCapital = params.initialCapital ?? 100000;
  const horizonMonths = params.horizonMonths ?? 12;
  const utilizationRate = params.utilizationRate ?? 0.8;

  const k_r = params.rateMeanReversion ?? 2.0;
  const theta_r = params.rateLongTermMean ?? 0.11;
  const sigma_r = params.rateVolatility ?? 0.02;
  const initialRate = params.initialRate ?? 0.11;

  const mu_fx = params.fxDrift ?? 0.0;
  const sigma_fx = params.fxVolatility ?? 0.1;
  const rho = params.rateFxCorrelation ?? -0.3;
  const initialFxRate = params.initialFxRate ?? 18.0;

  const loanSpread = params.loanSpread ?? 0.15;
  const k_p = params.defaultMeanReversion ?? 1.5;
  const theta_p = params.defaultLongTermMean ?? 0.05;
  const sigma_p = params.defaultVolatility ?? 0.015;
  const initialDefaultRate = params.initialDefaultRate ?? 0.05;
  const lgd = params.lgd ?? 0.6;

  const monthlyOpEx = params.monthlyOpEx ?? 500;

  const rng = new SeededRandom(seed);
  const dt = 1 / 12; // Monthly steps
  const sqrtDt = Math.sqrt(dt);

  const trialNetProfits: number[] = [];
  const trialMinCapitals: number[] = [];

  for (let i = 0; i < numTrials; i++) {
    let F = initialCapital;
    let r = initialRate;
    let S = initialFxRate;
    let p = initialDefaultRate;
    let minCapital = initialCapital;

    for (let t = 0; t < horizonMonths; t++) {
      // Generate correlated random variables
      const Z1 = rng.nextNormal();
      const W = rng.nextNormal();
      const Z2 = rho * Z1 + Math.sqrt(1 - rho * rho) * W;
      const Z3 = rng.nextNormal(); // Independent default rate shock

      // Update stochastic rates
      r = r + k_r * (theta_r - r) * dt + sigma_r * sqrtDt * Z1;
      r = Math.max(0, r); // Interest rates cannot be negative

      const nextS = S * Math.exp((mu_fx - 0.5 * sigma_fx * sigma_fx) * dt + sigma_fx * sqrtDt * Z2);
      p = p + k_p * (theta_p - p) * dt + sigma_p * sqrtDt * Z3;
      p = Math.max(0, p); // Default rate cannot be negative

      // Allocations
      const V = F * utilizationRate;
      const B = F * (1 - utilizationRate);

      // Cashflows
      const incLoan = V * (r + loanSpread) * dt;
      // Sovereign bond is in MXN. We convert USD to MXN at S, earn yield r, and convert back at nextS
      const incBond = B * ((1 + r * dt) * (S / nextS) - 1);
      const lossDef = V * p * lgd * dt;

      const netProfitMonth = incLoan + incBond - lossDef - monthlyOpEx;
      F += netProfitMonth;
      minCapital = Math.min(minCapital, F);

      // Update exchange rate for the next step
      S = nextS;
    }

    trialNetProfits.push(F - initialCapital);
    trialMinCapitals.push(minCapital);
  }

  // Sort profits to compute statistics and percentiles
  trialNetProfits.sort((a, b) => a - b);
  trialMinCapitals.sort((a, b) => a - b);

  const sumProfit = trialNetProfits.reduce((sum, val) => sum + val, 0);
  const expectedNetProfit = sumProfit / numTrials;

  const varianceProfit = trialNetProfits.reduce((sum, val) => sum + Math.pow(val - expectedNetProfit, 2), 0) / numTrials;
  const profitStandardDeviation = Math.sqrt(varianceProfit);

  const lossesCount = trialNetProfits.filter((val) => val < 0).length;
  const probabilityOfLoss = lossesCount / numTrials;

  // Percentiles
  const getPercentile = (arr: number[], pct: number) => {
    const idx = Math.floor((pct / 100) * arr.length);
    return arr[Math.min(idx, arr.length - 1)];
  };

  const p5 = getPercentile(trialNetProfits, 5);
  const p10 = getPercentile(trialNetProfits, 10);
  const p50 = getPercentile(trialNetProfits, 50);
  const p90 = getPercentile(trialNetProfits, 90);
  const p95 = getPercentile(trialNetProfits, 95);

  const valueAtRisk95 = -p5;

  // Suggested Capital Buffer: worst 1st percentile drop in capital
  const p1MinCapital = getPercentile(trialMinCapitals, 1);
  const suggestedCapitalBuffer = Math.max(0, initialCapital - p1MinCapital);

  return {
    expectedNetProfit,
    profitStandardDeviation,
    probabilityOfLoss,
    valueAtRisk95,
    suggestedCapitalBuffer,
    percentiles: { p5, p10, p50, p90, p95 },
  };
}
