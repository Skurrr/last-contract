/**
 * Headless smoke run. Boots the built game in a real browser, plays a few turns through the
 * actual input path, and reports console errors plus screenshots.
 *
 * This exists because a game that typechecks is not a game that runs — every bug worth
 * catching here (a null sprite, an NaN camera, a HUD that throws on a dead merc) is invisible
 * to `tsc` and to the headless sim tests.
 *
 * Usage: node scripts/smoke.mjs [outputDir]
 */
import { mkdirSync } from 'node:fs';
import { boot, enterBattle, launch } from './lib/harness.mjs';

const OUT = process.argv[2] ?? '.scratch/shots';
const URL = process.env.SMOKE_URL ?? 'http://localhost:4173/last-contract/';

mkdirSync(OUT, { recursive: true });

const { browser, page, errors } = await launch();
const warnings = [];

console.log(`→ loading ${URL}`);
await boot(page, URL);

// The game opens on the main menu now, so get into a real firefight before testing one.
const started = await enterBattle(page);
if (!started) {
  console.log('✗ could not reach a battle from the menu');
  await page.screenshot({ path: `${OUT}/00-stuck.png` });
  await browser.close();
  process.exit(1);
}

// The canvas must actually have painted something other than the clear colour.
const painted = await page.evaluate(() => {
  const c = document.querySelector('canvas.stage');
  if (!c) return { ok: false, reason: 'no canvas' };
  const ctx = c.getContext('2d');
  if (!ctx) return { ok: false, reason: 'no 2d context' };
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 997) {
    seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  }
  return { ok: seen.size > 8, distinctColors: seen.size, w: c.width, h: c.height };
});
console.log('→ canvas:', JSON.stringify(painted));

const hudPresent = await page.evaluate(() => ({
  squadCards: document.querySelectorAll('.hud-squad button, .sq-card').length,
  buttons: document.querySelectorAll('.btn').length,
  panels: document.querySelectorAll('.panel').length,
}));
console.log('→ hud:', JSON.stringify(hudPresent));

await page.screenshot({ path: `${OUT}/01-boot.png` });

// Play: move the cursor across the map so hover/path preview run, then click around.
const box = await page.locator('canvas.stage').boundingBox();
for (const [dx, dy] of [[0.35, 0.45], [0.5, 0.5], [0.62, 0.42], [0.45, 0.6]]) {
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy);
  await page.waitForTimeout(140);
}
await page.screenshot({ path: `${OUT}/02-hover.png` });

// Move a merc.
await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-moved.png` });

// Exercise the keyboard surface: modes, stances, reload, noise overlay, character sheet.
for (const key of ['2', '3', '4', '1', 'x', 'z', 'r', 'o', 'n', 'Tab']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(160);
}
await page.screenshot({ path: `${OUT}/04-modes.png` });
await page.keyboard.press('n'); // noise overlay back off

// Character sheet.
await page.keyboard.press('i');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/05-sheet.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// End turns so the AI actually runs and the dead get to move.
for (let t = 0; t < 4; t++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2600);
}
await page.screenshot({ path: `${OUT}/06-after-ai.png` });

// Fire mode against whatever is nearest, to exercise the shot panel.
await page.keyboard.press('2');
for (const [dx, dy] of [[0.55, 0.4], [0.6, 0.5], [0.5, 0.35], [0.65, 0.55], [0.4, 0.45]]) {
  await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy);
  await page.waitForTimeout(220);
}
await page.screenshot({ path: `${OUT}/07-fire.png` });
await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/08-shot.png` });

const state = await page.evaluate(() => ({
  logLines: document.querySelectorAll('.log-line, .log-scroll > *').length,
  bodyText: (document.body.innerText || '').slice(0, 400),
}));

console.log('\n=== RESULT ===');
console.log('log lines:', state.logLines);
console.log('errors:', errors.length);
for (const e of errors.slice(0, 12)) console.log('  ✗', e.slice(0, 300));
if (warnings.length) console.log('warnings:', warnings.length, warnings[0]?.slice(0, 160));

await browser.close();
process.exit(errors.length > 0 || !painted.ok ? 1 : 0);
