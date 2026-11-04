import { createPacer } from './pacer.js';
import { readChoice, readFlag, writeChoice, writeFlag } from './settings.js';

// How sharp the picture is, as [key, label, title, the most screen pixels per CSS pixel]. Fill rate is what limits
// the game on a phone (additive points, the lens pass and bloom, all into half-float buffers), and the pixel
// ratio is the biggest lever on it: 1.5 instead of 2 draws 44% fewer pixels.
const RESOLUTIONS = [
  ['sharp', 'Sharp', 'Up to two pixels per point on high-density screens', 2],
  ['balanced', 'Balanced', 'Up to one and a half: much lighter on the graphics chip', 1.5],
  ['fast', 'Fast', 'One pixel per point: the lightest, a little soft on high-density screens', 1],
];
const RESOLUTION_STORAGE = 'black-hole:resolution';
const BLOOM_STORAGE = 'black-hole:no-bloom';
const ADAPT_STORAGE = 'black-hole:no-adapt';
// The pixel ratio never drops below this, however slow it gets.
const LEAST_RATIO = 0.6;

// The Video tab of the settings menu: the resolution, whether it adapts to the frame rate, the bloom, and full
// screen where the browser allows it. Touch screens start on Balanced, everything else on Sharp. While adapting
// (the default), the resolution chosen is the most it goes up to, and it's scaled down while frames are slow
// (see pacer.js). Call update() every frame.
//
// It sets `renderer`'s pixel ratio itself, and again whenever the screen's density changes (a window moved to
// another monitor, or the page zoomed). The game picks up a new ratio or size on its next frame. `onBloom(on)`
// is called at once and whenever the bloom is switched.
export function createGraphics({ renderer, settings, onBloom }) {
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  let resolution = readChoice(RESOLUTION_STORAGE, RESOLUTIONS.map(([key]) => key), touch ? 'balanced' : 'sharp');
  let bloom = !readFlag(BLOOM_STORAGE);
  let adapt = !readFlag(ADAPT_STORAGE);
  const pacer = createPacer();
  const seconds = () => performance.now() / 1000;

  function apply() {
    const [, , , most] = RESOLUTIONS.find(([key]) => key === resolution);
    const best = Math.min(window.devicePixelRatio || 1, most);
    const ratio = adapt ? Math.max(Math.min(best, LEAST_RATIO), best * pacer.scale) : best;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  }

  // A media query that matches only the current density, so it fires once when that changes.
  let density = null;
  function watchDensity() {
    density?.removeEventListener('change', onDensity);
    density = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    density?.addEventListener('change', onDensity);
  }
  function onDensity() {
    apply();
    watchDensity();
  }

  const page = settings.addTab('Video');
  const resolutionGroup = settings.addGroup(page, 'Resolution');
  const choices = settings.addChoices(resolutionGroup, RESOLUTIONS, (key) => {
    resolution = key;
    writeChoice(RESOLUTION_STORAGE, key);
    pacer.reset(seconds());
    apply();
  });
  choices[resolution].checked = true;

  const adaptSwitch = settings.addSwitch(
    resolutionGroup,
    'Adapt to frame rate',
    'Lower the resolution while the game can’t keep up, and raise it again when it can',
    (checked) => {
      adapt = checked;
      writeFlag(ADAPT_STORAGE, !checked);
      pacer.reset(seconds());
      apply();
    },
  );
  adaptSwitch.checked = adapt;

  const effects = settings.addGroup(page, 'Effects');
  const bloomSwitch = settings.addSwitch(effects, 'Bloom', 'The glow around bright stars and black holes', (checked) => {
    bloom = checked;
    writeFlag(BLOOM_STORAGE, !checked);
    onBloom(bloom);
  });
  bloomSwitch.checked = bloom;

  // Full screen, where it's offered (not on iPhones). On phones it also hides the browser's bars.
  let fullscreen = null;
  const onFullscreen = () => fullscreen && (fullscreen.checked = document.fullscreenElement !== null);
  if (document.fullscreenEnabled) {
    fullscreen = settings.addSwitch(effects, 'Full screen', 'Fill the whole screen', (checked) => {
      const change = checked ? document.documentElement.requestFullscreen() : document.exitFullscreen();
      change?.catch(onFullscreen);
    });
    document.addEventListener('fullscreenchange', onFullscreen);
  }

  apply();
  watchDensity();
  onBloom(bloom);

  return {
    // Every frame.
    update() {
      if (adapt && pacer.sample(seconds()) !== null) apply();
    },

    dispose() {
      density?.removeEventListener('change', onDensity);
      document.removeEventListener('fullscreenchange', onFullscreen);
    },
  };
}
