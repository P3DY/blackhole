import * as THREE from 'three';
import { AUDIO, DRAG, REACH, THRUST } from './config.js';
import { readChoice, readFlag, writeChoice, writeFlag } from './settings.js';
import { mulberry32 } from './utils.js';

const { clamp, smoothstep } = THREE.MathUtils;

// --- The score --------------------------------------------------------------------
//
// A slow progression in D minor, one chord every CHORD_TIME seconds, as [bass, pad voicing] in MIDI notes.
// It's rendered once, offline, into a buffer that loops for the rest of the game.
const CHORDS = [
  [38, [50, 57, 60, 64, 65]], // Dm9
  [34, [46, 53, 57, 60, 62]], // B♭maj9
  [31, [43, 50, 53, 58, 60]], // Gm11
  [33, [45, 52, 55, 60, 62]], // Am7 add 11
];
const CHORD_TIME = 10;
const LOOP = CHORDS.length * CHORD_TIME; // seconds
const TAIL = 14; // seconds of release, echo and reverb after the loop's end, folded back onto its start
const MUSIC_RATE = 32000; // it's dark music, so 16 kHz of bandwidth is plenty
const MUSIC_SEED = 40; // its own stream: the universe's must not be touched
const PENTATONIC = [50, 53, 55, 57, 60, 62]; // D minor pentatonic, D3–D4: a hum for each star you absorb
const REWARD = [50, 57, 62, 64, 69, 74]; // an open Dsus2, hummed upward when you swallow a black hole
const SIDE_UP = [57, 62]; // A3 up to D4: a black hole near you is now lighter than you…
const SIDE_DOWN = [57, 51]; // …or A3 down to E♭3: it now outweighs you
const OPEN = 20000; // the horizon filter's cutoff while you're alive…
const SLOWED = 900; // …and while a hint has slowed time right down

// What feeding sounds like, under the swirl: [key, label, description]. It's the player's choice: all of them
// are built, and the Feeding section of the settings menu picks the one you hear.
const FEEDS = [
  ['crackle', 'Crackle', 'Sparse bright clicks, like embers'],
  ['tuned', 'Tuned', 'Breathy noise tuned to D minor, like blowing across a bottle'],
  ['drone', 'Drone', 'A low chord that swells and opens up as you feed'],
  ['rain', 'Rain', 'A soft, low patter, like rain on a tent'],
  ['whoosh', 'Whoosh', 'Low noise circling you at the speed of the disk'],
  ['gulps', 'Gulps', 'Soft low swallows, quicker the harder you feed'],
];
const FEED_STORAGE = 'black-hole:feeding';
const PREVIEW = 2.5; // seconds you hear a feeding sound when you pick it, as if feeding hard

// Each switch in the settings menu, remembered in localStorage. `sound` is the master mute (M).
const SWITCHES = [
  { key: 'sound', label: 'Sound', storage: 'black-hole:muted' },
  { key: 'music', label: 'Music', storage: 'black-hole:music-muted' },
  { key: 'effects', label: 'Effects', storage: 'black-hole:effects-muted' },
];
// Activation-triggering events (pointerdown only counts for a mouse, hence pointerup and touchend).
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'keydown'];

const midi = (note) => 440 * 2 ** ((note - 69) / 12);

// Everything you hear, synthesised with the Web Audio API: there are no sound files. Browsers only allow sound
// after a click, tap or key press, so nothing is built until the first one. `camera` pans distant sounds.
// It adds its switches and the feeding sounds to `settings` (the menu); M toggles the master mute too (game.js
// handles the key).
export function createAudio({ camera, settings }) {
  const off = Object.fromEntries(SWITCHES.map(({ key, storage }) => [key, readFlag(storage)]));
  let feed = readChoice(FEED_STORAGE, FEEDS.map(([key]) => key), AUDIO.feeding);
  const menu = buildMenu();

  let ctx = null;
  let muted = off.sound;
  let master, horizon, musicBus, ambience, effects, reverb, chimeSend, pink, brown;
  let wind, rumble, tension, vortex;
  let feeds = null; // the feeding sounds, by key, once built
  // Rendering needs no click, so it starts now and is usually done before the first one.
  const score = typeof OfflineAudioContext === 'undefined' ? null : renderMusic();
  let music = null; // the looping source, once the score has rendered
  const shots = new Set(); // outputs of sound effects that may still be ringing
  let starCredit = 0; // stars absorbed since the last chime
  let chimeWait = 0;
  let gulpWait = 0;
  let previewUntil = 0; // context time until which the chosen feeding sound plays as if you were feeding
  let sinceGlide = 0;

  const offset = new THREE.Vector3();
  const right = new THREE.Vector3();

  const running = () => ctx !== null && ctx.state === 'running' && !muted;
  const glide = (param, value, time = 0.15) => param.setTargetAtTime(value, ctx.currentTime, time);

  function start() {
    if (typeof AudioContext === 'undefined') return;
    ctx = new AudioContext();
    const context = ctx;

    // master ──► highpass ──► limiter ──► speakers. Music and ambience pass through the horizon filter first,
    // which closes when you fall in; effects and the reverb skip it. The highpass drops rumble below what
    // speakers can play, which would only eat into the limiter's headroom.
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -8, knee: 4, ratio: 16, attack: 0.002, release: 0.2 });
    limiter.connect(ctx.destination);
    const floor = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 30 });
    floor.connect(limiter);
    master = new GainNode(ctx, { gain: 0 });
    master.connect(floor);
    glide(master.gain, AUDIO.master, 0.4);
    horizon = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: OPEN, Q: 0.7 });
    horizon.connect(master);
    musicBus = new GainNode(ctx, { gain: off.music ? 0 : AUDIO.music });
    musicBus.connect(horizon);
    ambience = new GainNode(ctx, { gain: off.effects ? 0 : AUDIO.ambience });
    ambience.connect(horizon);
    effects = new GainNode(ctx, { gain: off.effects ? 0 : AUDIO.effects });
    effects.connect(master);
    reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, 4, Math.random) });
    reverb.connect(effects);
    chimeSend = new GainNode(ctx, { gain: 0.4 });
    chimeSend.connect(reverb);

    pink = noiseBuffer(ctx, 8, 'pink', 2);
    brown = noiseBuffer(ctx, 6, 'brown', 1);

    // Wind: the hiss of drifting through space, brighter and louder the faster you go.
    wind = { filter: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 350, Q: 0.9 }), gain: new GainNode(ctx, { gain: 0 }) };
    loopNoise(pink).connect(wind.filter).connect(wind.gain).connect(ambience);
    wobble(0.05, 120, wind.filter.frequency);

    // Rumble: a low roar that gets heavier as you grow.
    rumble = new GainNode(ctx, { gain: 0 });
    loopNoise(brown).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 110 })).connect(rumble).connect(ambience);

    // Tension: two low sawtooths a semitone apart, growling and throbbing faster as you near something heavier.
    tension = {
      filter: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 80, Q: 3 }),
      throb: new GainNode(ctx, { gain: 0.6 }),
      gain: new GainNode(ctx, { gain: 0 }),
    };
    for (const note of [28, 29]) {
      const growl = new OscillatorNode(ctx, { type: 'sawtooth', frequency: midi(note) });
      growl.connect(tension.filter);
      growl.start();
    }
    tension.filter.connect(tension.throb).connect(tension.gain).connect(ambience);
    tension.rate = wobble(1.5, 0.4, tension.throb.gain);

    // Feeding: a swirl of noise circling at about the disk's pace, with the chosen feeding sound under it.
    vortex = { filter: new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 600, Q: 5 }), gain: new GainNode(ctx, { gain: 0 }) };
    loopNoise(pink).connect(vortex.filter).connect(vortex.gain).connect(effects);
    wobble(0.7, 250, vortex.filter.frequency);
    feeds = buildFeeds();

    score?.then((buffer) => {
      if (ctx !== context) return; // disposed while it rendered
      music = new AudioBufferSourceNode(ctx, { buffer, loop: true });
      const fade = new GainNode(ctx, { gain: 0 });
      fade.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
      music.connect(fade).connect(musicBus);
      music.start();
    });
  }

  function loopNoise(buffer) {
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    source.start(0, Math.random() * buffer.duration);
    return source;
  }

  // A sine LFO added to `param`, `depth` either side of its value. `wave` swaps in another shape.
  function wobble(rate, depth, param, wave) {
    const lfo = new OscillatorNode(ctx, { frequency: rate });
    if (wave) lfo.setPeriodicWave(wave);
    lfo.connect(new GainNode(ctx, { gain: depth })).connect(param);
    lfo.start();
    return lfo;
  }

  // The sounds in FEEDS, all running and all silent but the chosen one. Each has an output gain and
  // `follow(feeding)`, which sets it from your feeding rate (0–1) at 20 Hz. Gulps are events, fired by update().
  function buildFeeds() {
    const send = new GainNode(ctx, { gain: 0.3 });
    send.connect(reverb);
    const output = () => {
      const out = new GainNode(ctx, { gain: 0 });
      out.connect(effects);
      out.connect(send);
      return out;
    };

    // Crackle: sparse, bright clicks, the original.
    const crackle = { out: output() };
    loopNoise(grainBuffer(ctx, 4, 1, 90, [0.0003, 0.0023]))
      .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 1800 }))
      .connect(crackle.out);
    crackle.follow = (f) => glide(crackle.out.gain, 0.6 * f ** 1.5);

    // Tuned: noise through narrow filters on D minor chord tones, so it rings like breath across a bottle. The
    // upper three join in as you feed harder.
    const tuned = { out: output(), upper: new GainNode(ctx, { gain: 0 }) };
    const breath = loopNoise(pink);
    for (const [note, upper] of [[38, false], [45, false], [50, false], [53, true], [57, true], [62, true]]) {
      breath.connect(new BiquadFilterNode(ctx, { type: 'bandpass', frequency: midi(note), Q: 12 })).connect(upper ? tuned.upper : tuned.out);
    }
    tuned.upper.connect(tuned.out);
    tuned.follow = (f) => {
      glide(tuned.out.gain, 2.5 * f, 0.25);
      glide(tuned.upper.gain, f, 0.25);
    };

    // Drone: a low D–A chord, each note a pair of slowly beating oscillators, opening up as you feed.
    const drone = { out: output(), filter: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.7 }) };
    drone.filter.connect(drone.out);
    for (const [note, type, level] of [[38, 'sine', 1], [45, 'sine', 0.7], [50, 'triangle', 0.5], [57, 'triangle', 0.3]]) {
      for (const detune of [-5, 5]) {
        const voice = new OscillatorNode(ctx, { type, frequency: midi(note), detune });
        voice.connect(new GainNode(ctx, { gain: level / 2 })).connect(drone.filter);
        voice.start();
      }
    }
    drone.follow = (f) => {
      glide(drone.out.gain, 0.12 * f, 0.3);
      glide(drone.filter.frequency, 150 + 1000 * f, 0.3);
    };

    // Rain: fewer, longer grains than the crackle, kept low, and pattering faster as you feed.
    const rain = { out: output(), source: loopNoise(grainBuffer(ctx, 4, 2, 45, [0.004, 0.016])) };
    rain.source
      .connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 800 }))
      .connect(new BiquadFilterNode(ctx, { type: 'highpass', frequency: 250 }))
      .connect(rain.out);
    rain.follow = (f) => {
      glide(rain.out.gain, 3.5 * f);
      glide(rain.source.playbackRate, 0.7 + 0.6 * f);
    };

    // Whoosh: low noise swept around you, left to right and back, swelling each time it passes in front (a
    // cosine at twice the sweep's rate, so it peaks as the pan crosses the middle).
    const whoosh = {
      out: output(),
      filter: new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 350 }),
      swell: new GainNode(ctx, { gain: 0.6 }),
      panner: new StereoPannerNode(ctx),
    };
    loopNoise(brown).connect(whoosh.filter).connect(whoosh.swell).connect(whoosh.panner).connect(whoosh.out);
    whoosh.sweep = wobble(0.5, 0.8, whoosh.panner.pan);
    whoosh.pass = wobble(1, 0.4, whoosh.swell.gain, new PeriodicWave(ctx, { real: [0, 1], imag: [0, 0] }));
    whoosh.follow = (f) => {
      const orbit = 0.4 + 0.8 * f; // turns a second
      glide(whoosh.out.gain, 1.1 * f);
      glide(whoosh.filter.frequency, 300 + 500 * f);
      glide(whoosh.sweep.frequency, orbit, 0.5);
      glide(whoosh.pass.frequency, 2 * orbit, 0.5);
    };

    // Gulps: the sounds come from gulp(); this only opens their output.
    const gulps = { out: output() };
    gulps.follow = (f) => glide(gulps.out.gain, f > 0.03 ? 1 : 0, 0.05);

    return { crackle, tuned, drone, rain, whoosh, gulps };
  }

  // One swallow: a low note sliding down into place, with a soft muffled click at the start.
  function gulp(f) {
    const t = ctx.currentTime;
    const note = midi([45, 50, 53][Math.floor(Math.random() * 3)]); // A2, D3, F3
    const level = 0.25 * (0.4 + 0.6 * f);
    const body = new GainNode(ctx, { gain: 0 });
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(level, t + 0.015);
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    body.connect(feeds.gulps.out);
    for (const [type, gain] of [['sine', 1], ['triangle', 0.3]]) {
      const slide = tone(ctx, type, note * 1.8, t, 0.35);
      sweep(slide.frequency, t, note * 1.8, note, 0.12);
      slide.connect(new GainNode(ctx, { gain })).connect(body);
    }
    const click = new GainNode(ctx, { gain: 0 });
    envelope(click.gain, t, [[0, 0], [0.008, 0.4 * level], [0.08, 0]]);
    noise(brown, t, 0.1).connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 500 })).connect(click).connect(feeds.gulps.out);
  }

  function unlock() {
    if (muted || document.hidden) return;
    if (!ctx) start();
    if (ctx && ctx.state !== 'running') ctx.resume();
  }

  // No sound while the tab is hidden; the game is paused then anyway.
  function onVisibility() {
    if (!ctx) return;
    if (document.hidden) ctx.suspend();
    else if (!muted) ctx.resume();
  }

  for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);

  // Its rows in the settings menu: a switch for each of SWITCHES, then the feeding sounds.
  function buildMenu() {
    const inputs = {};
    for (const { key, label } of SWITCHES) inputs[key] = settings.addSwitch(label, key === 'sound' ? 'M toggles' : '', (on) => set(key, !on));

    // Which feeding sound plays. Picking one (even the current one) plays it for a moment.
    const feeding = settings.addGroup('Feeding');
    const choices = settings.addChoices(feeding, FEEDS, chooseFeed);

    return {
      draw() {
        for (const { key } of SWITCHES) inputs[key].checked = !off[key];
        choices[feed].checked = true;
        // Music and effects only matter while the sound is on, and the feeding sounds while effects are on.
        for (const key of ['music', 'effects']) inputs[key].closest('label').classList.toggle('dim', off.sound);
        feeding.classList.toggle('dim', off.sound || off.effects);
      },
    };
  }
  menu.draw();

  function set(key, value) {
    if (key === 'sound') return setMuted(value);
    off[key] = value;
    writeFlag(SWITCHES.find((s) => s.key === key).storage, value);
    menu.draw();
    if (!ctx) return;
    if (key === 'music') glide(musicBus.gain, value ? 0 : AUDIO.music, 0.1);
    else {
      // Effects covers the ambience too: wind, rumble and tension.
      glide(effects.gain, value ? 0 : AUDIO.effects, 0.1);
      glide(ambience.gain, value ? 0 : AUDIO.ambience, 0.1);
    }
  }

  function chooseFeed(key) {
    feed = key;
    writeChoice(FEED_STORAGE, key);
    menu.draw();
    if (ctx) previewUntil = ctx.currentTime + PREVIEW;
  }

  function setMuted(value) {
    muted = off.sound = value;
    writeFlag(SWITCHES[0].storage, value);
    menu.draw();
    if (muted) {
      if (!ctx) return;
      glide(master.gain, 0, 0.05);
      setTimeout(() => muted && ctx?.suspend(), 250); // fade out first, then stop the audio thread
    } else {
      if (!ctx) start();
      if (!ctx) return; // no Web Audio
      ctx.resume();
      glide(master.gain, AUDIO.master, 0.1);
    }
  }

  // The output of one sound effect: panned, partly sent to the reverb. reset() silences any still ringing.
  function shot(wet, pan = 0, level = 1) {
    const out = new GainNode(ctx, { gain: level });
    const panner = new StereoPannerNode(ctx, { pan });
    out.connect(panner).connect(effects);
    panner.connect(new GainNode(ctx, { gain: wet })).connect(reverb);
    shots.add(out);
    return out;
  }

  function noise(buffer, time, duration) {
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    source.start(time, Math.random() * buffer.duration);
    source.stop(time + duration);
    return source;
  }

  // A deep thud: a sine dropping in pitch (with an octave above it, for small speakers) over a burst of
  // darkening noise.
  function boom(out, time, { from, to, length, level, grit, bright }) {
    const body = new GainNode(ctx, { gain: 0 });
    body.gain.setValueAtTime(0, time);
    body.gain.linearRampToValueAtTime(level, time + 0.008);
    body.gain.exponentialRampToValueAtTime(0.0001, time + length);
    body.connect(out);
    for (const [type, octave, gain] of [['sine', 1, 1], ['triangle', 2, 0.3]]) {
      const drop = tone(ctx, type, from * octave, time, length);
      sweep(drop.frequency, time, from * octave, to * octave, length * 0.4);
      drop.connect(new GainNode(ctx, { gain })).connect(body);
    }

    const filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.5 });
    sweep(filter.frequency, time, bright, 60, length * 0.8);
    const hiss = new GainNode(ctx, { gain: 0 });
    hiss.gain.setValueAtTime(0, time);
    hiss.gain.linearRampToValueAtTime(grit, time + 0.01);
    hiss.gain.exponentialRampToValueAtTime(0.0001, time + length);
    noise(brown, time, length).connect(filter).connect(hiss).connect(out);
  }

  // A star crossing your shadow: a short low hum from the pentatonic scale, louder when many land at once.
  function chime(count) {
    const out = new StereoPannerNode(ctx, { pan: Math.random() * 1.2 - 0.6 });
    out.connect(effects);
    out.connect(chimeSend);
    const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
    const level = 0.06 + 0.1 * Math.min(1, Math.log2(1 + count) / 6);
    hum(ctx, out, ctx.currentTime, midi(note), level, 0.08, 1.1);
  }

  return {
    get muted() {
      return muted;
    },

    // Returns the new state.
    toggleMute() {
      setMuted(!muted);
      return muted;
    },

    // Every frame, with the frame's real delta. `danger` is the HUD's (0 when you're safe), `stars` how many
    // stars you absorbed this frame, and `timeScale` how fast the game runs (below 1 while a hint slows it).
    update(delta, { player, danger, stars, timeScale = 1 }) {
      if (!running()) {
        starCredit = 0;
        return;
      }
      const alive = player.state === 'alive';
      const previewing = ctx.currentTime < previewUntil;
      const feeding = Math.max(alive ? player.appetite : 0, previewing ? 0.85 : 0);

      // Chimes are rate-limited: a frame's worth of stars rings once, and a flood of them rings no faster.
      starCredit += stars;
      chimeWait -= delta;
      if (starCredit > 0 && chimeWait <= 0) {
        chime(starCredit);
        starCredit = 0;
        chimeWait = 0.06 + 0.16 * Math.random();
      }

      // Gulps are events too, quicker the harder you feed.
      gulpWait -= delta;
      if (feed === 'gulps' && feeding > 0.03 && gulpWait <= 0) {
        gulp(feeding);
        gulpWait = (0.8 + 0.4 * Math.random()) / (1 + 3 * feeding);
      }

      // The layers follow the game at 20 Hz, which is plenty for gains that glide anyway.
      sinceGlide += delta;
      if (sinceGlide < 0.05) return;
      sinceGlide = 0;

      const speed = alive ? player.velocity.length() / ((THRUST / DRAG) * player.shadow) : 0; // 1 at top speed
      const threat = alive ? smoothstep(danger, 0.2, 1) : 0;
      const weight = Math.log10(Math.max(player.mass, 1)); // 0 at the start, about 3 by the end

      glide(wind.filter.frequency, 350 + 450 * speed);
      glide(wind.gain.gain, 0.05 + 0.1 * Math.min(speed, 1.8));
      glide(rumble.gain, alive ? 0.15 + 0.08 * weight : 0.1, 0.5);
      glide(vortex.filter.frequency, 500 + 1500 * feeding, 0.3);
      glide(vortex.gain.gain, 0.3 * feeding);
      for (const [key, layer] of Object.entries(feeds)) {
        if (key === feed) layer.follow(feeding);
        else glide(layer.out.gain, 0, 0.1);
      }
      glide(tension.filter.frequency, 70 + 450 * threat, 0.3);
      glide(tension.rate.frequency, 1.5 + 5 * threat, 0.3);
      glide(tension.gain.gain, 0.45 * threat * threat, 0.3);
      glide(musicBus.gain, off.music ? 0 : AUDIO.music * (1 - 0.4 * threat), 0.5); // the music backs off when it's dangerous

      // Slow motion: the music drags down to half speed and the world goes muffled. Once you're falling in,
      // fall() and swallowed() have these instead.
      if (alive) {
        const stall = 1 - timeScale;
        if (music) glide(music.playbackRate, 1 - 0.5 * stall, 0.2);
        glide(horizon.frequency, OPEN * (SLOWED / OPEN) ** stall, 0.2);
      }
    },

    // A black hole starts falling into you. `share` is its mass as a share of yours.
    pull(share) {
      if (!running()) return;
      const t = ctx.currentTime;
      const out = shot(0.4, 0, clamp(Math.sqrt(2 * share), 0.4, 1));

      // A rising rush of air, and a tone sliding up under it.
      const filter = new BiquadFilterNode(ctx, { type: 'bandpass', Q: 2 });
      sweep(filter.frequency, t, 180, 2600, 0.8);
      const rush = new GainNode(ctx, { gain: 0 });
      envelope(rush.gain, t, [[0, 0], [0.6, 0.5], [0.85, 0]]);
      noise(pink, t, 0.9).connect(filter).connect(rush).connect(out);

      const rise = tone(ctx, 'sine', 90, t, 0.9);
      sweep(rise.frequency, t, 90, 360, 0.8);
      const level = new GainNode(ctx, { gain: 0 });
      envelope(level.gain, t, [[0, 0], [0.6, 0.15], [0.85, 0]]);
      rise.connect(level).connect(out);
    },

    // You swallowed a black hole. `share` is its mass as a share of yours, after the meal.
    devour(share) {
      if (!running()) return;
      const t = ctx.currentTime;
      const size = clamp(Math.sqrt(2 * share), 0.4, 1);
      boom(shot(0.5, 0, size), t, { from: 120, to: 32, length: 2.2, level: 0.9, grit: 0.7, bright: 2500 });
      const chord = shot(0.8, 0, size);
      REWARD.forEach((note, i) => hum(ctx, chord, t + 0.05 + i * 0.08, midi(note), 0.08, 0.4, 3.5));
    },

    // A black hole near you changed sides: two hummed notes, up a fourth if you now outweigh it, or down a
    // tritone if it now outweighs you.
    sideChange(prey) {
      if (!running()) return;
      const t = ctx.currentTime;
      const out = shot(0.6);
      (prey ? SIDE_UP : SIDE_DOWN).forEach((note, i) => hum(ctx, out, t + i * 0.14, midi(note), 0.1, 0.04, 1.4));
    },

    // You crossed a shadow, or something heavier caught you. Time slows and the universe goes dark.
    fall() {
      if (!ctx) return;
      glide(horizon.frequency, 300, 0.6);
      if (music) glide(music.playbackRate, 0.35, 1);
      if (!running()) return;
      const t = ctx.currentTime;
      const out = shot(0.5);

      // Stretched thin: a falling tone that wavers more and more…
      const whine = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 2 });
      sweep(whine.frequency, t, 2400, 160, 2.6);
      const level = new GainNode(ctx, { gain: 0 });
      envelope(level.gain, t, [[0, 0], [0.3, 0.2], [1.8, 0.2], [2.8, 0]]);
      whine.connect(level).connect(out);
      const vibrato = new GainNode(ctx, { gain: 0 });
      envelope(vibrato.gain, t, [[0, 0], [2.5, 80]]); // cents
      tone(ctx, 'sine', 7, t, 2.8).connect(vibrato);
      for (const detune of [-15, 15]) {
        const saw = tone(ctx, 'sawtooth', 330, t, 2.8);
        saw.detune.value = detune;
        sweep(saw.frequency, t, 330, 41, 2.6);
        vibrato.connect(saw.detune);
        saw.connect(whine);
      }

      // …over a roar that builds as you go.
      const filter = new BiquadFilterNode(ctx, { type: 'lowpass' });
      sweep(filter.frequency, t, 150, 1200, 2);
      const roar = new GainNode(ctx, { gain: 0 });
      envelope(roar.gain, t, [[0, 0], [1.8, 0.6], [3, 0]]);
      noise(brown, t, 3).connect(filter).connect(roar).connect(out);
    },

    // You're gone. One last thud, and the music sinks to a crawl.
    swallowed() {
      if (!ctx) return;
      glide(horizon.frequency, 180, 1);
      if (music) glide(music.playbackRate, 0.25, 2);
      if (!running()) return;
      boom(shot(0.8), ctx.currentTime, { from: 75, to: 22, length: 4, level: 1, grit: 0.8, bright: 900 });
    },

    // Two other black holes merged at `position`: a muffled thud, quieter the further it is from you.
    distant(position, player) {
      if (!running() || player.state !== 'alive') return;
      offset.subVectors(position, player.position).setY(0);
      const distance = offset.length();
      const volume = 1 / (1 + (distance / (12 * REACH * player.shadow)) ** 2);
      if (volume < 0.03) return;
      right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
      const pan = distance > 0 ? 0.8 * clamp(offset.dot(right) / distance, -1, 1) : 0;
      boom(shot(0.7, pan, volume), ctx.currentTime, { from: 90, to: 30, length: 2, level: 0.6, grit: 0.5, bright: 500 });
    },

    // Silences anything still ringing and lifts the horizon filter.
    reset() {
      starCredit = 0;
      if (!ctx) return;
      for (const out of shots) out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      shots.clear();
      glide(horizon.frequency, OPEN, 0.4);
      if (music) glide(music.playbackRate, 1, 0.6);
    },

    dispose() {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      ctx?.close();
      ctx = null;
    },
  };
}

// --- Synthesis helpers (for live and offline contexts alike) ------------------------

// Linear ramps through [seconds after `time`, value] pairs.
function envelope(param, time, points) {
  param.setValueAtTime(points[0][1], time + points[0][0]);
  for (let i = 1; i < points.length; i++) param.linearRampToValueAtTime(points[i][1], time + points[i][0]);
}

function sweep(param, time, from, to, duration) {
  param.setValueAtTime(from, time);
  param.exponentialRampToValueAtTime(to, time + duration);
}

function tone(ctx, type, frequency, time, duration) {
  const oscillator = new OscillatorNode(ctx, { type, frequency });
  oscillator.start(time);
  oscillator.stop(time + duration);
  return oscillator;
}

// A hummed tone with no strike: two sines a few cents apart, so it beats slowly, with quiet second and third
// harmonics, swelling in over `attack` and dying away by `length`.
function hum(ctx, out, time, frequency, level, attack, length) {
  const amp = new GainNode(ctx, { gain: 0 });
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(level, time + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
  amp.connect(out);
  for (const [harmonic, detune, gain] of [[1, -4, 0.4], [1, 4, 0.4], [2, 0, 0.15], [3, 0, 0.05]]) {
    const partial = tone(ctx, 'sine', frequency * harmonic, time, length);
    partial.detune.value = detune;
    partial.connect(new GainNode(ctx, { gain })).connect(amp);
  }
}

// Noise that loops without a click: the extra second past the end is crossfaded (at equal power) into the start.
function noiseBuffer(ctx, seconds, color, channels) {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const fade = rate;
  const buffer = ctx.createBuffer(channels, length, rate);
  const raw = new Float32Array(length + fade);
  for (let c = 0; c < channels; c++) {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let last = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * white) / 1.02;
        raw[i] = last * 3.5;
      } else {
        // Paul Kellet's economy pink filter.
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        raw[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
      }
    }
    const data = buffer.getChannelData(c);
    data.set(raw.subarray(0, length));
    for (let i = 0; i < fade; i++) {
      const angle = (i / fade) * (Math.PI / 2);
      data[i] = raw[i] * Math.sin(angle) + raw[length + i] * Math.cos(angle);
    }
  }
  return buffer;
}

// Sparse, random grains, each a tiny burst of decaying noise: `density` a second, each fading over somewhere
// between `shortest` and `longest` seconds. Short grains crackle like embers; longer ones patter like rain.
function grainBuffer(ctx, seconds, channels, density, [shortest, longest]) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(channels, Math.floor(seconds * rate), rate);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    let level = 0;
    let decay = 0;
    for (let i = 0; i < data.length; i++) {
      if (Math.random() < density / rate) {
        level = Math.random() ** 2;
        decay = Math.exp(-1 / (rate * (shortest + (longest - shortest) * Math.random())));
      }
      data[i] = (Math.random() * 2 - 1) * level;
      level *= decay;
    }
  }
  return buffer;
}

// A stereo impulse response for the reverb: noise that fades by 60 dB over `seconds` and darkens as it goes.
function impulse(ctx, seconds, random) {
  const length = Math.floor(seconds * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      smooth += (random() * 2 - 1 - smooth) * (0.55 - 0.5 * t); // a one-pole lowpass that closes over time
      data[i] = smooth * Math.exp(-6.9 * t);
    }
  }
  return buffer;
}

// --- The music loop -------------------------------------------------------------

// Detuned sawtooths spread left and right, filtered dark, swelling in and out over one chord.
function pad(ctx, out, notes, start, length) {
  const filter = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0.8 });
  filter.frequency.setValueAtTime(250, start);
  filter.frequency.exponentialRampToValueAtTime(1000, start + length * 0.5);
  filter.frequency.exponentialRampToValueAtTime(300, start + length + 5);
  const gain = new GainNode(ctx, { gain: 0 });
  envelope(gain.gain, start, [[0, 0], [3.5, 1], [length + 0.5, 1], [length + 5, 0]]);
  filter.connect(gain).connect(out);
  for (const note of notes) {
    for (const pan of [-0.6, 0.6]) {
      const saw = tone(ctx, 'sawtooth', midi(note), start, length + 5);
      saw.detune.value = pan * 12; // ±7 cents
      saw.connect(new GainNode(ctx, { gain: 0.035 })).connect(new StereoPannerNode(ctx, { pan })).connect(filter);
    }
  }
}

// The chord's root, low, with a soft octave above it.
function drone(ctx, out, note, start, length) {
  const gain = new GainNode(ctx, { gain: 0 });
  envelope(gain.gain, start, [[0, 0], [3, 0.09], [length + 0.5, 0.09], [length + 5, 0]]);
  gain.connect(out);
  tone(ctx, 'sine', midi(note), start, length + 5).connect(gain);
  tone(ctx, 'triangle', midi(note + 12), start, length + 5).connect(new GainNode(ctx, { gain: 0.5 })).connect(gain);
}

// Quiet triangles an octave above the pad's top notes that fade in late and linger: the air above it.
function shimmer(ctx, out, notes, start, length) {
  const gain = new GainNode(ctx, { gain: 0 });
  envelope(gain.gain, start, [[0, 0], [5, 1], [length + 1, 1], [length + 6, 0]]);
  gain.connect(out);
  for (const note of notes.slice(-3)) {
    tone(ctx, 'triangle', midi(note + 12), start, length + 6).connect(new GainNode(ctx, { gain: 0.012 })).connect(gain);
  }
}

// Renders the loop offline. Whatever is still sounding when it ends (the last chord's release, the hums,
// reverb) is folded back onto its start, which is exactly what the next time round would have heard, so it
// loops without a seam.
async function renderMusic() {
  const offline = new OfflineAudioContext(2, (LOOP + TAIL) * MUSIC_RATE, MUSIC_RATE);
  const random = mulberry32(MUSIC_SEED);

  const reverb = new ConvolverNode(offline, { buffer: impulse(offline, 6, random) });
  reverb.connect(offline.destination);
  const bus = (dry, wet) => {
    const node = new GainNode(offline);
    node.connect(new GainNode(offline, { gain: dry })).connect(offline.destination);
    node.connect(new GainNode(offline, { gain: wet })).connect(reverb);
    return node;
  };
  const pads = bus(0.7, 0.6);
  const lows = bus(1, 0.2);
  const air = bus(0.3, 1);
  const hums = bus(0.7, 0.6);

  CHORDS.forEach(([bass, voicing], i) => {
    const start = i * CHORD_TIME;
    pad(offline, pads, voicing, start, CHORD_TIME);
    drone(offline, lows, bass, start, CHORD_TIME);
    shimmer(offline, air, voicing, start, CHORD_TIME);

    // A few of the chord's tones, hummed at the pad's own pitch and swelling out of it, at loose, unhurried
    // intervals.
    for (let t = start + 0.8 + random() * 1.5; t < start + CHORD_TIME - 0.3; t += 1.1 + random() * 1.8) {
      if (random() < 0.25) continue;
      const note = voicing[Math.floor(random() * voicing.length)];
      const level = 0.075 + 0.075 * random();
      const length = 4 + 2 * random();
      hum(offline, hums, t, midi(note), level, 1, length);
    }
  });

  const rendered = await offline.startRendering();
  const length = LOOP * MUSIC_RATE;
  const channels = [0, 1].map((c) => {
    const data = rendered.getChannelData(c);
    for (let i = length; i < data.length; i++) data[i - length] += data[i];
    return data.subarray(0, length);
  });

  let peak = 0;
  for (const data of channels) for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const music = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: MUSIC_RATE });
  channels.forEach((data, c) => {
    for (let i = 0; i < length; i++) data[i] *= 0.9 / peak;
    music.copyToChannel(data, c);
  });
  return music;
}
