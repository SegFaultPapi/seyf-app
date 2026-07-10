# Mathematical Specification: Monte Carlo Yield & Portfolio Simulation

This document defines the mathematical models, stochastic processes, and financial formulas used to simulate the performance of Seyf's **$100,000 USD** loan-oriented yield fund.

> [!WARNING]
> **Internal Use Only**: This simulation model and mathematical specification are for internal planning, stress-testing, and product design purposes only. They do not constitute financial advice, projections, or guarantees of return to end-users or clients. All outcomes are estimates subject to significant market risk and must be reviewed and approved by Legal and Risk teams before any customer-facing communication.

---

## 1. Variables & Assumptions

The simulation incorporates both stochastic (random) and deterministic parameters to project the fund's monthly financial trajectory.

### A. Variable Classification Table

| Variable Name | Symbol | Type | Default Value | Description |
| :--- | :---: | :---: | :---: | :--- |
| **Initial Capital** | $F_0$ | Deterministic | \$100,000 USD | Total starting capital of the fund. |
| **Utilization Rate** | $U$ | Deterministic | $80\%$ | Target proportion of capital allocated to loans. |
| **Loan Spread** | $\text{spread}_{loan}$ | Deterministic | $15\%$ | Margin added to the reference rate for loans. |
| **Loss Given Default** | $LGD$ | Deterministic | $60\%$ | Percentage of active loan capital lost upon default. |
| **Monthly OpEx** | $\text{OpEx}$ | Deterministic | \$500 USD | Fixed operating expenses deducted monthly. |
| **Sovereign Interest Rate** | $r_t$ | Stochastic | $11\%$ (initial) | Reference risk-free rate (e.g., CETES yield). |
| **Exchange Rate** | $S_t$ | Stochastic | $18.0$ (initial) | Currency exchange rate in MXN per 1 USD. |
| **Portfolio Default Rate** | $p_t$ | Stochastic | $5\%$ (initial) | The probability of defaults in the loan portfolio. |

---

## 2. Model Structure & Asset Allocation

The total fund capital at time $t$ is denoted by $F_t$ (in USD). The capital is allocated dynamically based on a target **utilization rate** $U$:
* **Loan Portfolio ($V_t$)**: The active capital loaned to borrowers.
  $$V_t = F_t \times U$$
* **Liquidity Buffer ($B_t$)**: The reserve capital held in MXN sovereign debt (e.g., CETES).
  $$B_t = F_t \times (1 - U)$$

---

## 3. Stochastic Processes

We model three sources of uncertainty using discretized stochastic differential equations (SDEs) over a monthly time step $\Delta t = 1/12$.

### A. Sovereign Interest Rate ($r_t$)
The reference risk-free rate is modeled using the **Vasicek model** (a mean-reverting Ornstein-Uhlenbeck process). This captures the fluctuation of sovereign bond yields:
$$r_{t+1} = r_t + k_r(\theta_r - r_t)\Delta t + \sigma_r \sqrt{\Delta t} Z_t^1$$
where:
* $k_r$: Speed of mean reversion ($2.0$).
* $\theta_r$: Long-term mean interest rate ($11\%$).
* $\sigma_r$: Interest rate volatility ($2\%$).
* $Z_t^1 \sim N(0, 1)$: Standard normal random variable.
* The interest rate is constrained to be non-negative: $r_t \ge 0$.

### B. Exchange Rate ($S_t$, USD/MXN)
The exchange rate $S_t$ (MXN per 1 USD) is modeled using **Geometric Brownian Motion (GBM)**:
$$S_{t+1} = S_t \exp\left( \left(\mu_{fx} - \frac{1}{2}\sigma_{fx}^2\right)\Delta t + \sigma_{fx}\sqrt{\Delta t} Z_t^2 \right)$$
where:
* $\mu_{fx}$: Drift rate of the exchange rate ($0.0$).
* $\sigma_{fx}$: Exchange rate volatility ($10\%$).
* $Z_t^2 \sim N(0, 1)$: Standard normal variable correlated with $Z_t^1$ via correlation coefficient $\rho$ (default $-0.30$):
  $$Z_t^2 = \rho Z_t^1 + \sqrt{1 - \rho^2} W_t^1$$
  and $W_t^1 \sim N(0, 1)$ is independent of $Z_t^1$.

### C. Portfolio Default Rate ($p_t$)
The probability of default in the loan portfolio is modeled as a mean-reverting process to capture economic cycles:
$$p_{t+1} = p_t + k_p(\theta_p - p_t)\Delta t + \sigma_p \sqrt{\Delta t} Z_t^3$$
where:
* $k_p$: Speed of mean reversion for defaults ($1.5$).
* $\theta_p$: Long-term average default rate ($5\%$).
* $\sigma_p$: Default rate volatility ($1.5\%$).
* $Z_t^3 \sim N(0, 1)$: Standard normal variable independent of $Z_t^1$ and $Z_t^2$.
* The default rate is clipped to $[0, 1]$ since probability must reside in this range.

---

## 4. Financial Performance, Cashflows & Reinvestment

At each step $t$, the net cashflows are calculated using beginning-of-period state variables:

### A. Income
1. **Loan Interest Income ($\text{Inc}_{loan, t}$)**: Interest earned on the active loan portfolio.
   $$\text{Inc}_{loan, t} = V_t \times (r_t + \text{spread}_{loan}) \times \Delta t$$
2. **Sovereign Yield Income ($\text{Inc}_{bond, t}$)**: Yield earned on the liquidity buffer. Since the liquidity buffer is held in MXN sovereign bonds, USD capital is converted to MXN at $S_t$, accrues interest at rate $r_t$, and is converted back to USD at the end-of-period exchange rate $S_{t+1}$:
   $$\text{Inc}_{bond, t} = B_t \times \left( (1 + r_t \Delta t) \frac{S_t}{S_{t+1}} - 1 \right)$$

### B. Credit Losses
**Default Losses ($\text{Loss}_{def, t}$)**: The portion of the active loan portfolio that defaults, adjusted by the **Loss Given Default (LGD)**:
$$\text{Loss}_{def, t} = V_t \times p_t \times LGD \times \Delta t$$

### C. Net Profit & Compounding (Reinvestment)
The net profit for period $t$ (in USD) is:
$$\text{Net Profit}_t = \text{Inc}_{loan, t} + \text{Inc}_{bond, t} - \text{Loss}_{def, t} - \text{OpEx}_t$$

**Coupon & Profit Reinvestment**:
Earnings are immediately added back to the total fund capital $F_{t+1}$ at the end of each month:
$$F_{t+1} = F_t + \text{Net Profit}_t$$
In the subsequent month, new allocations $V_{t+1}$ and $B_{t+1}$ are calculated based on the updated fund balance $F_{t+1}$, achieving complete automatic compounding of all yield and recovered principal.

---

## 5. Aggregate Output Metrics

After running $N$ Monte Carlo trials (e.g., $10,000$ trajectories), we compute the following statistics:
1. **Expected Net Return**: The mean net profit across all trials.
2. **Value at Risk (VaR at 95%)**: The 5th percentile of the net profit distribution (representing the maximum expected loss with $95\%$ confidence).
3. **Probability of Loss**: The percentage of trials where the cumulative net profit is negative.
4. **Suggested Capital Buffer**: The worst 1% drawdown from the initial capital, calculated as:
   $$\text{Buffer} = \max\left(0, F_0 - \text{Percentile}_{1\%}(\min_{t} F_t)\right)$$

---

## 6. How to Run the Simulation

The simulation engine is implemented as a TS script inside this repository. You can execute it directly to print results in the console and export the raw trial data.

### Run command:
```bash
npx tsx scripts/simulate-yield.ts
```

### Options:
- `--trials <number>`: Set the number of trajectories (default: `10000`).
- `--capital <number>`: Set the initial capital in USD (default: `100000`).
- `--utilization <number>`: Set target allocation rate to loans (default: `0.8`).

### Output CSV:
The script automatically exports the detailed trial profits and drawdowns to:
`data/simulation-results.csv`
