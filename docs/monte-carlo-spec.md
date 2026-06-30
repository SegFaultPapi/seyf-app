# Mathematical Specification: Monte Carlo Yield & Portfolio Simulation

This document defines the mathematical models, stochastic processes, and financial formulas used to simulate the performance of Seyf's **$100,000 USD** loan-oriented yield fund.

---

## 1. Model Structure & Asset Allocation

The total fund capital at time $t$ is denoted by $F_t$ (in USD). The capital is allocated dynamically based on a target **utilization rate** $U$:
* **Loan Portfolio ($V_t$)**: The active capital loaned to borrowers.
  $$V_t = F_t \times U$$
* **Liquidity Buffer ($B_t$)**: The reserve capital held in sovereign debt (e.g., CETES or USD-equivalent).
  $$B_t = F_t \times (1 - U)$$

---

## 2. Stochastic Processes

We model three sources of uncertainty using discretized stochastic differential equations (SDEs) over a monthly time step $\Delta t = 1/12$.

### A. Sovereign Interest Rate ($r_t$)
The reference risk-free rate is modeled using the **Vasicek model** (a mean-reverting Ornstein-Uhlenbeck process). This captures the fluctuation of sovereign bond yields:
$$r_{t+1} = r_t + k_r(\theta_r - r_t)\Delta t + \sigma_r \sqrt{\Delta t} Z_t^1$$
where:
* $k_r$: Speed of mean reversion.
* $\theta_r$: Long-term mean interest rate (e.g., $11\%$ for CETES).
* $\sigma_r$: Interest rate volatility.
* $Z_t^1 \sim N(0, 1)$: Standard normal random variable.

### B. Exchange Rate ($S_t$, USD/MXN)
If the sovereign bonds are denominated in a foreign currency (MXN) while the fund is denominated in USD, we model the exchange rate $S_t$ (MXN per 1 USD) using **Geometric Brownian Motion (GBM)**:
$$S_{t+1} = S_t \exp\left( \left(\mu_{fx} - \frac{1}{2}\sigma_{fx}^2\right)\Delta t + \sigma_{fx}\sqrt{\Delta t} Z_t^2 \right)$$
where:
* $\mu_{fx}$: Drift rate of the exchange rate.
* $\sigma_{fx}$: Exchange rate volatility.
* $Z_t^2 \sim N(0, 1)$: Standard normal variable correlated with $Z_t^1$ via correlation coefficient $\rho$:
  $$Z_t^2 = \rho Z_t^1 + \sqrt{1 - \rho^2} W_t^1$$
  and $W_t^1 \sim N(0, 1)$ is independent of $Z_t^1$.

### C. Portfolio Default Rate ($p_t$)
The probability of default in the loan portfolio is modeled as a mean-reverting process to capture economic cycles:
$$p_{t+1} = p_t + k_p(\theta_p - p_t)\Delta t + \sigma_p \sqrt{\Delta t} Z_t^3$$
where:
* $k_p$: Speed of mean reversion for defaults.
* $\theta_p$: Long-term average default rate (e.g., $5\%$).
* $\sigma_p$: Default rate volatility.
* $Z_t^3 \sim N(0, 1)$: Standard normal variable independent of $Z_t^1$ and $Z_t^2$.

---

## 3. Financial Performance & Cashflows

At each step $t$, the net cashflows are calculated:

### A. Income
1. **Loan Interest Income ($\text{Inc}_{loan, t}$)**: Interest earned on the active loan portfolio.
   $$\text{Inc}_{loan, t} = V_t \times (r_t + \text{spread}_{loan}) \times \Delta t$$
2. **Sovereign Yield Income ($\text{Inc}_{bond, t}$)**: Yield earned on the liquidity buffer.
   $$\text{Inc}_{bond, t} = B_t \times r_t \times \Delta t$$
   *(If denominated in MXN, this is adjusted by the simulated exchange rate $S_t$)*.

### B. Credit Losses
**Default Losses ($\text{Loss}_{def, t}$)**: The portion of the active loan portfolio that defaults, adjusted by the **Loss Given Default (LGD)**:
$$\text{Loss}_{def, t} = V_t \times p_t \times LGD \times \Delta t$$

### C. Net Profit & Capital Growth
The net profit for period $t$ (in USD) is:
$$\text{Net Profit}_t = \text{Inc}_{loan, t} + \text{Inc}_{bond, t} - \text{Loss}_{def, t} - \text{OpEx}_t$$
The fund grows cumulatively:
$$F_{t+1} = F_t + \text{Net Profit}_t$$

---

## 4. Aggregate Output Metrics

After running $N$ Monte Carlo trials (e.g., $10,000$ trajectories), we compute the following statistics:
1. **Expected Net Return**: The mean net profit across all trials.
2. **Value at Risk (VaR at 95%)**: The 5th percentile of the net profit distribution (representing the maximum expected loss with $95\%$ confidence).
3. **Probability of Loss**: The percentage of trials where the cumulative net profit is negative.
4. **Suggested Capital Buffer**: The amount of additional capital required to ensure the probability of fund insolvency is $< 1\%$.
