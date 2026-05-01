#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error('Usage: node curvo_build_portfolio.js <payload.json>');
    process.exit(1);
  }

  const absolutePayloadPath = path.resolve(payloadPath);
  const payload = JSON.parse(fs.readFileSync(absolutePayloadPath, 'utf8'));

  validatePayload(payload);

  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    console.error('Missing dependency: playwright. Install it with `npm install playwright` or run with `npx playwright`.');
    throw error;
  }

  const browser = await playwright.chromium.launch({
    headless: payload.headless !== false,
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const baseUrl = payload.baseUrl || 'https://curvo.eu/backtest/en/portfolio/new';

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await dismissConsentIfPresent(page);

    for (const asset of payload.portfolio) {
      await addAsset(page, asset);
    }

    const visibleRows = await readPortfolioRows(page);
    const totalWeight = visibleRows.reduce((sum, row) => sum + row.weight, 0);

    const validation = validateVisibleRows(payload.portfolio, visibleRows);
    if (Math.abs(totalWeight - 100) > 0.05) {
      throw new Error(
        `Visible allocations sum to ${totalWeight}, expected 100. Parsed rows: ${JSON.stringify(visibleRows)}`
      );
    }

    let finalUrl = page.url();
    let summary = null;
    let diagnostics = null;

    if (payload.runBacktest !== false) {
      diagnostics = await readDiagnostics(page);
      await runBacktest(page);
      finalUrl = page.url();
      summary = await readSummary(page);
    }

    const result = {
      finalUrl,
      validation,
      visibleRows,
      diagnostics,
      summary,
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.portfolio) || payload.portfolio.length === 0) {
    throw new Error('Payload must include a non-empty portfolio array.');
  }

  const totalWeight = payload.portfolio.reduce((sum, asset) => sum + Number(asset.weight || 0), 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    throw new Error(`Portfolio weights must sum to 100. Received ${totalWeight}.`);
  }

  for (const asset of payload.portfolio) {
    if (!asset.label || typeof asset.label !== 'string') {
      throw new Error('Each asset requires a string label.');
    }
    if (typeof asset.weight !== 'number') {
      throw new Error(`Asset ${asset.label} requires a numeric weight.`);
    }
  }
}

async function dismissConsentIfPresent(page) {
  const candidates = [
    page.getByRole('button', { name: /accept/i }),
    page.getByRole('button', { name: /agree/i }),
    page.getByRole('button', { name: /got it/i }),
  ];

  for (const candidate of candidates) {
    try {
      if (await candidate.first().isVisible({ timeout: 500 })) {
        await candidate.first().click();
        return;
      }
    } catch {
      // Ignore missing consent UI.
    }
  }
}

async function addAsset(page, asset) {
  const rowCountBefore = await page.locator('input[name="ratio"]').count();
  const searchInput = page.getByPlaceholder('Search by name, ticker, index or ISIN');
  const searchVisible = await searchInput.isVisible().catch(() => false);

  if (!searchVisible) {
    const addButton = page.getByRole('button', { name: /^\+?\s*add fund$/i });
    await addButton.waitFor({ state: 'visible', timeout: 10000 });
    await addButton.click({ force: true });
    await searchInput.waitFor({ state: 'visible', timeout: 10000 });
  }

  await searchInput.fill(asset.isin || asset.label);

  const option = await findBestFundOption(page, asset);
  const selectedText = (await option.innerText().catch(() => asset.label)).split('\n')[0].trim();
  await option.click();

  await page.waitForFunction(
    (previousCount) => document.querySelectorAll('input[name="ratio"]').length > previousCount,
    rowCountBefore,
    { timeout: 10000 }
  ).catch(() => undefined);

  const weightInput = await findWeightInputForAsset(page, asset, selectedText);
  await weightInput.fill(String(asset.weight));
  await weightInput.press('Tab').catch(() => undefined);
}

async function findBestFundOption(page, asset) {
  let optionLocator = page.locator('[role="option"]');
  let optionCount = await optionLocator.count();

  if (optionCount === 0) {
    optionLocator = page.locator('button, li, article');
    optionCount = await optionLocator.count();
  }

  if (optionCount === 0) {
    throw new Error(`Curvo search returned no visible options for ${asset.label}.`);
  }

  const loweredLabel = asset.label.toLowerCase();
  const loweredIsin = asset.isin ? asset.isin.toLowerCase() : null;
  const count = optionCount;

  let partialMatch = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = optionLocator.nth(index);
    const text = (await candidate.innerText().catch(() => '')).toLowerCase();
    if (!text) {
      continue;
    }
    if (loweredIsin && text.includes(loweredIsin)) {
      return candidate;
    }
    if (text.includes(loweredLabel)) {
      if (text.startsWith(loweredLabel) || text.includes(`${loweredLabel} (`)) {
        return candidate;
      }
      partialMatch = partialMatch || candidate;
    }
  }

  if (partialMatch) {
    return partialMatch;
  }

  throw new Error(`Could not find a Curvo option for ${asset.label}${asset.isin ? ` (${asset.isin})` : ''}.`);
}

async function findWeightInputForAsset(page, asset, selectedText) {
  const candidateLabels = [selectedText, asset.label]
    .filter(Boolean)
    .map((value) => value.trim())
    .filter(Boolean);

  for (const label of candidateLabels) {
    const rowLocator = page
      .locator('tr')
      .filter({ hasText: label })
      .filter({ has: page.locator('input[name="ratio"]') })
      .first();
    try {
      await rowLocator.waitFor({ state: 'visible', timeout: 5000 });
      const inputs = rowLocator.locator('input[name="ratio"]');
      const count = await inputs.count();
      for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        const type = await input.getAttribute('type');
        const placeholder = await input.getAttribute('placeholder');
        if (type === 'number' && placeholder === '0') {
          return input;
        }
      }
    } catch {
      // Try the next candidate label.
    }
  }

  const numberInputs = page.locator('input[name="ratio"]');
  const numberInputCount = await numberInputs.count();
  if (numberInputCount > 0) {
    for (let index = 0; index < numberInputCount; index += 1) {
      const candidate = numberInputs.nth(index);
      const value = await candidate.inputValue().catch(() => '');
      if (!value) {
        return candidate;
      }
    }
    return numberInputs.last();
  }

  throw new Error(`Could not find a weight input for ${asset.label}.`);
}

async function readPortfolioRows(page) {
  const rowLocator = page.locator('tr').filter({
    has: page.locator('input[name="ratio"]'),
  });
  const rows = [];
  const count = await rowLocator.count();

  for (let index = 0; index < count; index += 1) {
    const row = rowLocator.nth(index);
    const text = (await row.innerText().catch(() => '')).trim();
    if (!text) {
      continue;
    }

    const weightInput = row.locator('input[name="ratio"]').first();
    const value = await weightInput.inputValue().catch(() => '');
    const weight = Number(value);
    if (Number.isNaN(weight)) {
      continue;
    }

    rows.push({
      text,
      weight,
    });
  }

  return rows;
}

function validateVisibleRows(expectedAssets, visibleRows) {
  const issues = [];
  const loweredRows = visibleRows.map((row) => row.text.toLowerCase());

  for (const asset of expectedAssets) {
    const label = asset.label.toLowerCase();
    const isin = asset.isin ? asset.isin.toLowerCase() : null;
    const found = loweredRows.some((row) => row.includes(label) || (isin ? row.includes(isin) : false));
    if (!found) {
      issues.push(`Missing visible row for ${asset.label}.`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

async function runBacktest(page) {
  const runButton = page.getByRole('button', { name: /run backtest/i });
  await runButton.waitFor({ state: 'visible', timeout: 10000 });

  await page.keyboard.press('Escape').catch(() => undefined);
  await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.waitForFunction(() => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
      /run backtest/i.test((candidate.textContent || '').trim())
    );
    return button && !button.disabled;
  }, { timeout: 10000 }).catch(() => undefined);

  await Promise.all([
    page.waitForURL(
      (url) => /\/backtest\/en\/portfolio\//.test(url.toString()) && !url.toString().endsWith('/portfolio/new'),
      { timeout: 30000 }
    ).catch(() => undefined),
    runButton.click({ force: true }),
  ]);
}

async function readSummary(page) {
  const summaryText = await page.locator('main').innerText();
  return {
    cagr: matchMetric(summaryText, /Compound annual growth rate\s+([\d.]+%)/i),
    standardDeviation: matchMetric(summaryText, /Standard deviation\s+([\d.]+%)/i),
    sharpeRatio: matchMetric(summaryText, /Sharpe ratio\s+([\d.]+)/i),
    netAssetValue: matchMetric(summaryText, /Net asset value\s+([^\n]+)/i),
  };
}

async function readDiagnostics(page) {
  const runButton = page.getByRole('button', { name: /run backtest/i });
  const bodyText = await page.locator('body').innerText().catch(() => '');
  return {
    runButtonDisabled: await runButton.isDisabled().catch(() => null),
    distributionMessage: bodyText.split('\n').find((line) => /distribute .* more/i.test(line)) || null,
  };
}

function matchMetric(text, regex) {
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});