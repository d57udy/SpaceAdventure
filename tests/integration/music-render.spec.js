// Offline render check for the generated music (no ears in CI): every tune in every mood
// is rendered for about 8 s through an OfflineAudioContext and must be audible but not clip.
// The engine is driven by a stand-in clock so the whole window is scheduled before rendering.
import { test, expect } from '@playwright/test';

const SECONDS = 8;
const TUNES = ['synthwave', 'ambient', 'chiptune'];
const MOODS = ['menu', 'calm', 'danger', 'boss', 'paused', 'gameover'];

test.describe('music: offline render', () => {
  test.beforeEach(async ({}, testInfo) => {
    // One Chromium and one WebKit run is enough (the other projects repeat the same engines)
    test.skip(!['desktop-chromium', 'ipad-webkit'].includes(testInfo.project.name), 'render check runs once per engine');
  });

  for (const tune of TUNES) {
    test(`${tune}: every mood is audible and stays below full scale`, async ({ page }) => {
      test.setTimeout(90000);
      await page.goto('/');
      const results = await page.evaluate(async ({ tune, moods, seconds }) => {
        const { MusicEngine } = await import('/js/music.js');
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const out = {};
        for (const mood of moods) {
          const rate = 22050;
          const off = new OfflineCtx(2, Math.round(seconds * rate), rate);
          let now = 0;
          // Stand-in context: the real offline context's nodes, with a clock we advance.
          const ctx = {
            get currentTime() { return now; },
            state: 'running',
            sampleRate: rate,
            destination: off.destination,
            createGain: () => off.createGain(),
            createOscillator: () => off.createOscillator(),
            createBiquadFilter: () => off.createBiquadFilter(),
            createDelay: (max) => off.createDelay(max),
            createBufferSource: () => off.createBufferSource(),
            createBuffer: (c, l, r) => off.createBuffer(c, l, r),
          };
          let seed = 7;
          const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const engine = new MusicEngine(ctx, off.destination, { rng });
          engine.setVolume(10); // loudest setting: worst case for clipping
          const playMood = mood === 'paused' || mood === 'gameover' ? 'calm' : mood;
          engine.setMood(playMood);
          engine.setTune(tune);
          let errors = 0;
          for (now = 0; now < seconds; now += 0.05) {
            if (mood !== playMood && Math.abs(now - 1) < 0.001) engine.setMood(mood); // switch after 1 s
            try { engine.update(); } catch (e) { errors++; }
          }
          const buf = await off.startRendering();
          let peak = 0;
          let sum = 0;
          let n = 0;
          let nonFinite = 0;
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) {
              const v = d[i];
              if (!Number.isFinite(v)) { nonFinite++; continue; }
              const a = Math.abs(v);
              if (a > peak) peak = a;
              sum += v * v;
              n++;
            }
          }
          out[mood] = { peak, rms: Math.sqrt(sum / Math.max(1, n)), nonFinite, errors, events: engine.stats.events };
        }
        return out;
      }, { tune, moods: MOODS, seconds: SECONDS });

      console.log(`[music-render] ${tune}: ${Object.entries(results)
        .map(([m, r]) => `${m} peak=${r.peak.toFixed(3)} rms=${r.rms.toFixed(4)}`).join(', ')}`);
      for (const mood of MOODS) {
        const r = results[mood];
        expect(r.errors, `${tune}/${mood} scheduling errors`).toBe(0);
        expect(r.nonFinite, `${tune}/${mood} NaN samples`).toBe(0);
        expect(r.peak, `${tune}/${mood} peak`).toBeLessThan(1.0);
        expect(r.rms, `${tune}/${mood} rms`).toBeGreaterThan(0.003);
      }
      // Moods sound different: boss is busier than menu
      expect(results.boss.events).toBeGreaterThan(results.menu.events);
    });
  }
});
