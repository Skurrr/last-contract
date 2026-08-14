/**
 * Shared browser-harness helpers.
 *
 * Both the tactical smoke run and the full-loop run need to get from the main menu into an
 * actual firefight. Keeping that path in one place means a change to the menu or the contract
 * board breaks one file, not two.
 */
import { chromium } from 'playwright-core';

export async function launch(viewport = { width: 1600, height: 900 }) {
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  page.on('pageerror', (e) =>
    errors.push(`PAGEERROR: ${e.message}\n${(e.stack ?? '').slice(0, 400)}`),
  );

  return { browser, page, errors };
}

/** Load the game and dismiss the first-run field manual. */
export async function boot(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/** Menu → new company → accept the first contract → deploy. Resolves once the canvas is live. */
export async function enterBattle(page) {
  await page.locator('.menu-actions button', { hasText: /New company/i }).first().click();
  await page.waitForTimeout(900);

  await page.locator('button', { hasText: /^ACCEPT$/i }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  // Signing is a confirmation step — the company is committing to the job.
  await page.locator('button', { hasText: /^SIGN$/i }).first().click().catch(() => {});
  await page.waitForTimeout(700);

  const deploy = page.locator('button.wm-deploy').first();
  const ok = await deploy.evaluate((b) => !b.hasAttribute('disabled')).catch(() => false);
  if (!ok) return false;

  await deploy.click();
  await page.waitForTimeout(1800);
  return page.evaluate(() => {
    const c = document.querySelector('canvas.stage');
    return Boolean(c) && getComputedStyle(c).display !== 'none';
  });
}

/** True once the after-action report is on screen. */
export const battleOver = (page) =>
  page.evaluate(() => Boolean(document.querySelector('.aar-continue')));

/** True while it is the player's phase and input is accepted. */
export const playerTurn = (page) =>
  page.evaluate(() => /YOUR MOVE/i.test(document.querySelector('.hud-banner')?.textContent ?? ''));
