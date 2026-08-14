/**
 * Full-loop smoke run: menu → new company → world map → accept a contract → assign a squad →
 * deploy → fight → after-action → back to the map, plus every campaign screen and a save/load
 * round trip.
 *
 * The tactical smoke run (`smoke.mjs`) only proves a battle boots. This proves the game is a
 * game: that the pieces hand off to each other without dropping the player somewhere broken.
 *
 * Usage: node scripts/loop.mjs [outputDir]
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const OUT = process.argv[2] ?? '.scratch/loop';
const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/last-contract/';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${(e.stack ?? '').slice(0, 400)}`));

const steps = [];
const step = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? '  ok ' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

/** Click the first element matching any of these texts. Returns what it clicked. */
async function clickText(texts, within = 'body') {
  for (const t of texts) {
    const loc = page.locator(`${within} >> text=${t}`).first();
    if ((await loc.count()) > 0 && (await loc.isVisible())) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      return t;
    }
  }
  return null;
}

console.log(`→ ${URL}\n`);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(900);

// The field manual opens on first run; dismiss it.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('01-menu');
step('menu renders', (await page.locator('.menu').count()) > 0);

// ── new company ───────────────────────────────────────────────
await page.locator('.menu-actions button', { hasText: /New company/i }).first().click();
await page.waitForTimeout(900);
await shot('02-map');
const mapCells = await page.locator('button.wm-cell').count();
step('world map renders', mapCells >= 40, `${mapCells} sectors`);

const hasContracts = await page.locator('.ct-desc').count();
step('contract board populated', hasContracts > 0, `${hasContracts} contract elements`);

// ── every campaign screen ─────────────────────────────────────
for (const [name, label] of [
  ['03-hiring', /Hiring|Recruit|Hire/i],
  ['04-market', /Market|Trade/i],
  ['05-workshop', /Workshop|Bench/i],
]) {
  const nav = page.locator('.nav-tabs button', { hasText: label }).first();
  if ((await nav.count()) > 0) {
    await nav.click().catch(() => {});
    await page.waitForTimeout(700);
    await shot(name);
    const empty = await page.evaluate(() => (document.querySelector('.screen-root')?.textContent ?? '').trim().length);
    step(`${name.slice(3)} screen renders`, empty > 200, `${empty} chars`);
  } else {
    step(`${name.slice(3)} screen reachable`, false, 'nav button not found');
  }
}

// Back to the map.
const back = page.locator('.nav-tabs button', { hasText: /Basin|Map/i }).first();
if ((await back.count()) > 0) await back.click().catch(() => {});
await page.waitForTimeout(600);

// ── accept a contract and deploy ──────────────────────────────
// Record the board before accepting, so we can prove navigation does not reshuffle it.
const boardBefore = await page.evaluate(() =>
  [...document.querySelectorAll('.ct-desc')].map((n) => n.textContent?.slice(0, 40) ?? '').join('|'),
);

await page.locator('button', { hasText: /^ACCEPT$/i }).first().click().catch(() => {});
await page.waitForTimeout(500);
await shot('06-accept-dialog');
// Accepting asks for confirmation before committing the company.
await page.locator('button', { hasText: /^SIGN$/i }).first().click().catch(() => {});
await page.waitForTimeout(700);
await shot('06-accepted');

const boardAfter = await page.evaluate(() =>
  [...document.querySelectorAll('.ct-desc')].map((n) => n.textContent?.slice(0, 40) ?? '').join('|'),
);
step('contract board is stable across navigation', boardBefore === boardAfter && boardBefore.length > 0);

// The starting roster is already assigned to the squad, so leave it alone. Toggling here
// would bench the only merc the company has and leave nobody to deploy.

const deployBtn = page.locator('button.wm-deploy').first();
const deployable = await deployBtn.evaluate((b) => !b.hasAttribute('disabled')).catch(() => false);
step('deploy button available', deployable);

if (deployable) {
  await deployBtn.click();
  await page.waitForTimeout(1800);
  await shot('07-battle');
  const inBattle = await page.evaluate(() => {
    const c = document.querySelector('canvas.stage');
    return Boolean(c) && getComputedStyle(c).display !== 'none';
  });
  step('battle starts from a contract', inBattle);

  if (inBattle) {
    // Play it out. Enter only does anything during the player phase — the AI phases lock
    // input while they resolve, so wait for the turn to come back before pressing again.
    const isOver = () =>
      page.evaluate(() => Boolean(document.querySelector('.aar-continue')));
    const myTurn = () =>
      page.evaluate(() => {
        const banner = document.querySelector('.hud-banner')?.textContent ?? '';
        return /YOUR MOVE/i.test(banner);
      });

    for (let t = 0; t < 60; t++) {
      if (await isOver()) break;
      // Wait up to ~12s for the player phase.
      for (let w = 0; w < 40 && !(await myTurn()); w++) {
        if (await isOver()) break;
        await page.waitForTimeout(300);
      }
      if (await isOver()) break;
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    await shot('08-after-battle');
    const reached = await isOver();
    step('battle resolves into an after-action report', reached);

    if (reached) {
      await page.locator('.aar-continue').first().click().catch(() => {});
      await page.waitForTimeout(900);
      await shot('09-back-to-map');
      const backOnMap = await page.evaluate(() =>
        (document.querySelector('.screen-root')?.textContent ?? '').length > 200,
      );
      step('returns to the campaign', backOnMap);
    }
  }
}

// ── save / load ───────────────────────────────────────────────
const saved = await page.evaluate(() => {
  const before = localStorage.getItem('lc.save.v1');
  return { had: before !== null };
});
await page.locator('.nav-tabs ~ * button, button', { hasText: /^SAVE$/i }).first().click().catch(() => {});
await page.waitForTimeout(500);
const afterSave = await page.evaluate(() => localStorage.getItem('lc.save.v1') !== null);
step('save writes to storage', afterSave, saved.had ? '(overwrote)' : '(new)');

if (afterSave) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.keyboard.press('Escape');
  const cont = page.locator('.menu-actions button', { hasText: /Continue/i }).first();
  const hasContinue = (await cont.count()) > 0;
  step('save is offered on reload', hasContinue);
  if (hasContinue) {
    await cont.click();
    await page.waitForTimeout(900);
    await shot('10-loaded');
    const loaded = await page.evaluate(() =>
      (document.querySelector('.screen-root')?.textContent ?? '').length > 200,
    );
    step('loaded campaign renders', loaded);
  }
}

// ── verdict ───────────────────────────────────────────────────
console.log('\n=== RESULT ===');
const failed = steps.filter((s) => !s.ok);
console.log(`${steps.length - failed.length}/${steps.length} steps passed`);
console.log(`console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log(`  ✗ ${e.slice(0, 260)}`);

await browser.close();
process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
