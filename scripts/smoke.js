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
const MIN_LIT = 0.5; // percent of pixels the star fields light on their own

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

    // Whether the star fields draw, from where the game starts you, once the cells around you have arrived
    // (slowly, in development) and before the drive takes you anywhere. The scene is drawn straight to the canvas
    // twice, with the fields and without them, and the fields have to light a share of the pixels themselves. So
    // a field shader that runs but draws nothing (as when an attribute format breaks it) fails, which a check of
    // the whole picture can miss: the disks, bloom and backdrop light it anyway.
    await page.waitForTimeout(3000);
    const lit = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      const { renderer, scene, camera } = window.blackHole;
      const canvas = renderer.domElement;
      const probe = document.createElement('canvas');
      probe.width = canvas.width;
      probe.height = canvas.height;
      const context = probe.getContext('2d');
      const share = () => {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        context.clearRect(0, 0, probe.width, probe.height);
        context.drawImage(canvas, 0, 0);
        const { data } = context.getImageData(0, 0, probe.width, probe.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) count++;
        return (100 * count) / (probe.width * probe.height);
      };
      const fields = scene.children.filter((object) => object.isPoints && object.geometry.attributes.aAlive && object.visible);
      const all = share();
      for (const field of fields) field.visible = false;
      const without = share();
      for (const field of fields) field.visible = true;
      resolve(all - without);
    })));
    if (!(lit > MIN_LIT)) errors.push(`the star fields light ${lit.toFixed(2)}% of the pixels, expected over ${MIN_LIT}%`);

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

    console.log(`tier ${tier}: ${errors.length === 0 ? 'ok' : 'FAILED'} (${after} frames, the fields light ${lit.toFixed(2)}%)`);
    for (const error of errors) console.log(`  ${error}`);
    failed ||= errors.length > 0;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
