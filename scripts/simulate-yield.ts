import fs from 'node:fs';
import path from 'node:path';
import { runYieldSimulation, SimulationParams } from '../lib/math/simulation-engine.ts';

// Helper to format currency
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Helper to format percentage
function formatPercent(val: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Seyf Monte Carlo Yield & Portfolio Simulator CLI

Options:
  --trials <number>        Number of simulation trajectories (default: 10000)
  --capital <number>       Initial fund capital in USD (default: 100000)
  --utilization <number>   Target loan portfolio utilization rate (default: 0.8)
  --help, -h               Show this help message

Usage:
  node --experimental-strip-types scripts/simulate-yield.ts
    `);
    process.exit(0);
  }

  // Parse arguments
  let numTrials = 10000;
  let initialCapital = 100000;
  let utilizationRate = 0.8;

  const trialsIdx = args.indexOf('--trials');
  if (trialsIdx !== -1 && args[trialsIdx + 1]) {
    numTrials = parseInt(args[trialsIdx + 1], 10);
  }

  const capitalIdx = args.indexOf('--capital');
  if (capitalIdx !== -1 && args[capitalIdx + 1]) {
    initialCapital = parseFloat(args[capitalIdx + 1]);
  }

  const utilIdx = args.indexOf('--utilization');
  if (utilIdx !== -1 && args[utilIdx + 1]) {
    utilizationRate = parseFloat(args[utilIdx + 1]);
  }

  console.log(`Running Seyf Monte Carlo Yield Simulation...`);
  console.log(`-------------------------------------------`);
  console.log(`Initial Capital   : ${formatCurrency(initialCapital)}`);
  console.log(`Number of Trials  : ${numTrials}`);
  console.log(`Utilization Rate  : ${formatPercent(utilizationRate)}`);
  console.log(`-------------------------------------------`);

  const params: SimulationParams = {
    numTrials,
    initialCapital,
    utilizationRate,
    seed: 42, // Fixed seed for reproducibility
  };

  // Measure time
  const startTime = performance.now();
  const results = runYieldSimulation(params);
  const endTime = performance.now();

  console.log(`Simulation finished in ${((endTime - startTime) / 1000).toFixed(3)}s.\n`);

  // Print Summary Table
  console.log(`================ SIMULATION RESULTS ================`);
  console.log(`Expected Net Profit       : ${formatCurrency(results.expectedNetProfit)}`);
  console.log(`Profit Std Dev            : ${formatCurrency(results.profitStandardDeviation)}`);
  console.log(`Probability of Loss       : ${formatPercent(results.probabilityOfLoss)}`);
  console.log(`Value at Risk (VaR 95%)   : ${formatCurrency(results.valueAtRisk95)}`);
  console.log(`Suggested Capital Buffer  : ${formatCurrency(results.suggestedCapitalBuffer)}`);
  console.log(`====================================================\n`);

  console.log(`=================== PERCENTILES ===================`);
  console.log(`5th Percentile (Worst 5%) : ${formatCurrency(results.percentiles.p5)}`);
  console.log(`10th Percentile           : ${formatCurrency(results.percentiles.p10)}`);
  console.log(`50th Percentile (Median)  : ${formatCurrency(results.percentiles.p50)}`);
  console.log(`90th Percentile           : ${formatCurrency(results.percentiles.p90)}`);
  console.log(`95th Percentile (Best 5%)  : ${formatCurrency(results.percentiles.p95)}`);
  console.log(`====================================================\n`);

  // To export the raw trial data to CSV, we run a custom path trace
  console.log(`Exporting trial results to CSV...`);
  
  // We re-run the simulation logic inside this CLI to extract individual trial data,
  // since the engine only returns aggregate statistics to save memory.
  const rng = new (await import('../lib/math/prng.ts')).SeededRandom(params.seed!);
  const dt = 1 / 12;
  const sqrtDt = Math.sqrt(dt);
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

  const csvRows: string[] = ['Trial,Net Profit (USD),Min Capital (USD)'];

  for (let i = 0; i < numTrials; i++) {
    let F = initialCapital;
    let r = initialRate;
    let S = initialFxRate;
    let p = initialDefaultRate;
    let minCapital = initialCapital;

    for (let t = 0; t < 12; t++) {
      const Z1 = rng.nextNormal();
      const W = rng.nextNormal();
      const Z2 = rho * Z1 + Math.sqrt(1 - rho * rho) * W;
      const Z3 = rng.nextNormal();

      const nextS = S * Math.exp((mu_fx - 0.5 * sigma_fx * sigma_fx) * dt + sigma_fx * sqrtDt * Z2);

      const V = F * utilizationRate;
      const B = F * (1 - utilizationRate);

      const incLoan = V * (r + loanSpread) * dt;
      const incBond = B * ((1 + r * dt) * (S / nextS) - 1);
      const lossDef = V * p * lgd * dt;

      const netProfitMonth = incLoan + incBond - lossDef - monthlyOpEx;
      F += netProfitMonth;
      minCapital = Math.min(minCapital, F);

      r = r + k_r * (theta_r - r) * dt + sigma_r * sqrtDt * Z1;
      r = Math.max(0, r);
      p = p + k_p * (theta_p - p) * dt + sigma_p * sqrtDt * Z3;
      p = Math.min(1, Math.max(0, p));
      S = nextS;
    }
    csvRows.push(`${i + 1},${(F - initialCapital).toFixed(2)},${minCapital.toFixed(2)}`);
  }

  const csvContent = csvRows.join('\n');
  const outputDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'simulation-results.csv');
  fs.writeFileSync(outputPath, csvContent, 'utf-8');

  console.log(`Saved trial results to: ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Error running simulation script:', err);
  process.exit(1);
});
