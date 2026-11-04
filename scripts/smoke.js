// A smoke test: runs the game headless in Chromium (WebGL in software, so slow but real) at a few scales, steers
// it with the keyboard for a while, pauses, retries, and fails on any page error or an empty canvas. Then it saves
// a checkpoint, reloads, and checks the game carries on from exactly what was saved.
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

  // A checkpoint survives a reload: save one partway through a run, reload, and compare.
  {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    const started = () => page.waitForFunction(() => window.blackHole?.renderer.info.render.frame > 10, null, { timeout: 60000 });

    await page.goto(url);
    await started();
    if ((await page.evaluate(() => window.blackHole.debug.resumed)) !== null) errors.push('a fresh page carried on from a checkpoint');
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Shift');
    await page.waitForTimeout(3000);
    await page.keyboard.up('Shift');
    await page.keyboard.up('KeyW');
    const saved = await page.evaluate(() => window.blackHole.debug.save());
    await page.reload();
    await started();
    const back = await page.evaluate(() => window.blackHole.debug.resumed);
    errors.push(...compare(saved, back));

    console.log(`reload: ${errors.length === 0 ? 'ok' : 'FAILED'} (${saved.stats.stars} stars eaten, ${saved.disk[0]} in disks)`);
    for (const error of errors) console.log(`  ${error}`);
    failed ||= errors.length > 0;
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);

// What differs between a checkpoint as saved and the game straight after restoring it, both as described by
// game.js's describe(). A core the streamer hasn't built again (or a new one it has) doesn't count, since which
// cells are around you depends on more than where you are.
function compare(saved, back) {
  if (!back) return ['the reloaded page did not carry on from the checkpoint'];
  const errors = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of ['fields', 'cosmos', 'disk', 'stats', 'visited', 'won']) {
    if (!same(saved[key], back[key])) errors.push(`${key} differ: saved ${JSON.stringify(saved[key])}, back ${JSON.stringify(back[key])}`.slice(0, 400));
  }
  const holes = new Map(saved.holes.map((hole) => [hole[0], hole]));
  for (const hole of back.holes) {
    const was = holes.get(hole[0]);
    if (was ? !same(was, hole) : !hole[0].startsWith('core:')) errors.push(`hole ${hole[0]}: saved ${JSON.stringify(was)}, back ${JSON.stringify(hole)}`);
    holes.delete(hole[0]);
  }
  for (const key of holes.keys()) if (!key.startsWith('core:')) errors.push(`hole ${key} did not come back`);
  return errors;
}
