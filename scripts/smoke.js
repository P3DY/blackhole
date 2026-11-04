// A smoke test: runs the game headless in Chromium (WebGL in software, so slow but real) at a few scales, steers
// it with the keyboard for a while, pauses, retries, and fails on any page error or an empty canvas.
//
//   npm run smoke              every tier in TIERS, 10 s each
//   npm run smoke -- 0 12      just these tiers
//
// Needs Playwright and its Chromium (`npx playwright install chromium`), which aren't dependencies of the game.
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const TIERS = process.argv.slice(2).map(Number);
if (TIERS.length === 0) TIERS.push(0, 4, 10, 20);
const SECONDS = 10;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  // A copy installed globally can still be found through NODE_PATH, which only require() reads.
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    // none at all
  }
}
if (!chromium) {
  console.error('The smoke test needs Playwright: npm install --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;

try {
  for (const tier of TIERS) {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

    await page.goto(tier > 0 ? `${url}?tier=${tier}` : url);
    await page.waitForFunction(() => window.blackHole?.renderer.info.render.frame > 10, null, { timeout: 60000 });

    // Drift around, boosting now and then, turning as we go.
    const keys = ['KeyW', 'KeyA', 'KeyD', 'KeyS'];
    const end = Date.now() + SECONDS * 1000;
    for (let i = 0; Date.now() < end; i++) {
      const key = keys[i % keys.length];
      if (i % 3 === 0) await page.keyboard.down('Shift');
      await page.keyboard.down(key);
      await page.waitForTimeout(700);
      await page.keyboard.up(key);
      await page.keyboard.up('Shift');
    }

    // Pause and carry on, then hold R long enough to retry.
    const frames = () => page.evaluate(() => window.blackHole.renderer.info.render.frame);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(500);
    await page.keyboard.press('KeyP');
    await page.keyboard.down('KeyR');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyR');
    const before = await frames();
    await page.waitForTimeout(1500);
    const after = await frames();
    if (after <= before) errors.push(`no frames drawn after the retry (${before} → ${after})`);

    // Read in an animation frame, after the game's own callback has drawn: the canvas doesn't keep its picture.
    const lit = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const canvas = window.blackHole.renderer.domElement;
      const probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 40;
      const context = probe.getContext('2d');
      context.drawImage(canvas, 0, 0, probe.width, probe.height);
      const { data } = context.getImageData(0, 0, probe.width, probe.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      resolve(sum / (probe.width * probe.height * 3));
    })));
    if (!(lit > 1)) errors.push(`the canvas is blank (mean level ${lit.toFixed(2)})`);

    console.log(`tier ${tier}: ${errors.length === 0 ? 'ok' : 'FAILED'} (${after} frames, mean level ${lit.toFixed(1)})`);
    for (const error of errors) console.log(`  ${error}`);
    failed ||= errors.length > 0;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
