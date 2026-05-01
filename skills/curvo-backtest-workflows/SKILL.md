---
name: curvo-backtest-workflows
description: Build, compare, and validate ETF portfolios on Curvo Backtest. Use this skill whenever the user mentions Curvo, curvo.eu/backtest, ETF allocations, ISIN-based portfolio construction, portfolio comparison, or wants historical performance metrics from Curvo, even if they do not explicitly ask for a "skill" or a "backtest workflow". Prefer deterministic URL or script-driven steps over fragile click-by-click browser interaction.
---

# Curvo Backtest Workflows

Use this skill to build ETF portfolios on Curvo, run backtests, compare portfolios, and report the results in a reproducible way.

## Goals

- Translate a user portfolio specification into a Curvo-compatible portfolio.
- Prefer deterministic operations such as URL construction, page parameters, or in-page scripting.
- Avoid brittle UI automation unless there is no more direct path.
- Validate the final composition and the key metrics before reporting back.

## When This Skill Fits Best

Use this skill when the user:

- Provides ETF weights and wants a Curvo backtest.
- Gives one or more ISINs and wants the exact funds used.
- Wants to compare two Curvo portfolios.
- Wants CAGR, volatility, Sharpe ratio, drawdown, or final value from Curvo.
- Wants the process captured in a repeatable workflow rather than one-off browser clicking.

## Operating Principles

1. Start from the user's exact portfolio spec.
2. Resolve ambiguous instruments with the exact ISIN when one is provided.
3. Prefer direct navigation to stable Curvo routes over manual UI traversal.
4. Prefer script-assisted form filling over repeated element-by-element clicking when browser scripting is available.
5. Treat Curvo compare URLs with care: some routes accept only stored portfolio IDs, while ad hoc encoded portfolio payloads may fail in compare mode.
6. If compare mode fails, open each portfolio separately, align the simulation period and rebalancing settings, then compare the metrics manually.
7. Report the exact funds Curvo ended up using, not just the user-facing nicknames.

## Inputs To Collect

Capture these fields before acting:

- Allocation list with percentages that sum to 100.
- Exact fund names when given.
- Exact ISINs when given.
- Desired comparison portfolio URL if present.
- Language to use in the final response.
- Whether the user wants only the final metrics or also the Curvo URL and composition table.

## Suggested Working Object

When script execution is available, normalize the request into a simple object before touching Curvo:

```json
{
   "portfolio": [
      {"label": "Vanguard FTSE All-World UCITS ETF", "weight": 40},
      {"label": "iShares MSCI World Small Cap UCITS ETF", "weight": 10},
      {"label": "Invesco Physical Gold", "weight": 15},
      {"label": "XEON", "weight": 10, "isin": "LU0290358497"},
      {"label": "Amundi Euro Government Bond 7-10Y UCITS ETF", "weight": 25}
   ],
   "compare_url": null,
   "response_language": "en"
}
```

The point is not the exact field names. The point is to separate portfolio normalization from page interaction so the workflow can be reused across different environments.

## Recommended Workflow

### 1. Normalize the portfolio

- Convert the user request into a structured list of `{name_or_hint, weight, isin_optional}`.
- If the user gives an alias and an ISIN, trust the ISIN over the alias.
- If the user gives percentages that do not sum to 100, stop and resolve that first.

### 2. Choose the least fragile execution path

Prefer these options in order:

1. Direct portfolio URL already supplied by the user.
2. Existing Curvo portfolio page that already matches the requested composition.
3. Curvo portfolio builder with script-driven insertion of funds and weights.
4. Manual browser interaction as a last resort.

Do not depend on a specific browser tool name. Use whatever generic browser navigation, DOM interaction, or script execution capability is available in the environment.

## Building A Portfolio On Curvo

When constructing from scratch:

1. Open the Curvo portfolio builder.
2. Add funds one by one.
3. After each fund is selected, set the intended allocation immediately.
4. Once all funds are present, verify the total is 100 and the portfolio title or summary reflects the expected structure.
5. Run the backtest.

When scripting is available, prefer one small script that:

- finds the add-fund controls,
- inserts the requested funds,
- sets allocations,
- and confirms the expected rows exist.

This is usually more reliable than repeated clicks, especially with long Curvo selectors.

Before running the backtest, have the script verify:

- every requested fund was matched,
- ISIN-constrained funds were not substituted,
- weights sum to 100,
- no duplicate rows were introduced,
- and the visible portfolio rows match the normalized working object.

## Comparison Workflow

### Preferred path

- If Curvo compare mode accepts both portfolio identifiers, use it.

### Fallback path

If Curvo compare mode rejects one portfolio identifier or the compare route is incomplete:

1. Open each portfolio separately.
2. Align the simulation period using Curvo's period controls or query parameters when available.
3. Align rebalancing frequency.
4. Align currency and investment pattern if relevant.
5. Read the same summary metrics from each portfolio.
6. Compare them explicitly in the final answer.

This fallback is valid and often more reliable than forcing the compare route.

## Validation Checklist

Before reporting success, verify:

- The fund list on Curvo matches the requested assets.
- The allocations match the requested weights.
- Any ambiguous instrument was resolved with the correct ISIN.
- The final page loaded successfully.
- The summary metrics are visible.

If comparing portfolios, also verify:

- Both portfolios use the same period start and end.
- Both portfolios use the same rebalancing setting.
- The comparison explicitly notes if a fallback method was used.

## Reporting Format

Use a concise result with:

1. Status: built, compared, or both.
2. Final Curvo URL when available.
3. Exact composition Curvo used.
4. Summary metrics:
   - CAGR
   - Standard deviation / volatility
   - Sharpe ratio
   - Net asset value or final value
5. Comparison deltas when relevant.
6. Any caveat about compare-mode limitations or period alignment.

## Known Curvo Behaviors

- Curvo may show multiple similar overnight cash ETFs. Exact ISIN matching matters.
- Curvo compare mode may reject an encoded ad hoc portfolio identifier that works fine on a standalone portfolio page.
- A click timeout during navigation does not necessarily mean failure if the target page loaded and the URL changed.
- The compare page may only list recent or stored portfolios rather than every portfolio reachable by URL.

## Conversation-Derived Reference Case

Use this as a known-good example of ambiguity resolution:

- User label: XEON
- Exact ISIN: LU0290358497
- Correct Curvo fund to select: Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C

Do not silently substitute a similar Lyxor overnight ETF when the user explicitly requested `LU0290358497`.

## Example Response Shape

Use prose unless the result is naturally tabular. Keep it compact.

Example:

"The portfolio is built and the backtest page is open. Curvo used Vanguard FTSE All-World 40%, iShares MSCI World Small Cap 10%, Invesco Physical Gold 15%, Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C 10%, and Amundi Euro Government Bond 7-10Y 25%. Summary metrics: CAGR 7.67%, volatility 7.47%, Sharpe 0.95, final value EUR 26,954."

## Anti-Patterns

Avoid these mistakes:

- Referring to a tool that may not exist in the target environment.
- Reporting the requested ticker when Curvo actually selected a different fund.
- Comparing portfolios with different date ranges without saying so.
- Treating a broken compare route as a blocker when separate validated portfolio pages can still be compared.
- Overusing fragile click-by-click automation when a single script or direct route would do.
