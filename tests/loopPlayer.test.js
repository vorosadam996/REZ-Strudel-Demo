// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { filterSetting, filterQ, loopGain, loopId, nextBarTime, LoopPlayer } from '../src/loopPlayer.js';

const param = value => ({ value, calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); }, linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); }, setTargetAtTime(v, t) { this.calls.push(['target', v, t]); this.value = v; }, cancelScheduledValues(t) { this.calls.push(['cancel', t]); } });
function fakeContext() {
  const node = extra => ({ connect() {}, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 10, destination: node(), sources: [],
    createGain: () => node({ gain: param(1) }),
    createBiquadFilter: () => node({ type: 'lowpass', frequency: param(350), Q: param(1) }),
    createAnalyser: () => node({ fftSize: 0, getFloatTimeDomainData() {} }),
    createBufferSource() {
      const source = node({ starts: [], stops: [], start(t, o) { this.starts.push([t, o]); }, stop(t) { this.stops.push(t); } });
      ctx.sources.push(source); return source;
    },
  };
  return ctx;
}
const manifest = { bars: 4, loops: [{ id: 'a1', url: 'a1' }, { id: 'b1', url: 'b1' }] };
const settings = { filter: 0, resonance: 10, level: 35 };
async function playing() {
  const ctx = fakeContext(), player = new LoopPlayer(ctx, { load: async () => ({ duration: 8 }) });
  await player.play('a1', settings, () => player.prepare(manifest));
  return { ctx, player };
}

test('filter knob: centre is open, negative closes low-pass, positive raises high-pass', () => {
  assert.deepEqual(filterSetting(0), { type: 'lowpass', frequency: 20000 });
  assert.deepEqual(filterSetting(-100), { type: 'lowpass', frequency: 60 });
  assert.deepEqual(filterSetting(100), { type: 'highpass', frequency: 2000 });
  assert.equal(filterSetting(50).type, 'highpass');
  assert.deepEqual(filterSetting('junk'), filterSetting(0));
  assert.deepEqual(filterSetting(999), filterSetting(100));
  assert.equal(filterQ(0), 0.7); assert.equal(filterQ(100), 8); assert.equal(filterQ(1e6), 8);
  assert.equal(loopGain(70), 0.35); assert.equal(loopGain(500), 0.35); assert.equal(loopGain(-1), 0);
  assert.equal(loopId('B', 2), 'b2');
});

test('next bar boundary is on the grid and never too close to now', () => {
  assert.equal(nextBarTime(10, 10, 2), 12);
  assert.equal(nextBarTime(11.99, 10, 2), 14);
  assert.equal(nextBarTime(11.5, 10, 2), 12);
  assert.equal(nextBarTime(9, 10, 2), 10);
});

test('switching waits for the next bar and keeps the phrase position', async () => {
  const { ctx, player } = await playing();
  const origin = player.origin;
  ctx.currentTime = origin + 2.5; // bar = 8 s / 4 = 2 s
  const when = player.select('b1');
  assert.equal(when, origin + 4);
  const [oldSource, newSource] = ctx.sources;
  assert.deepEqual(newSource.starts, [[origin + 4, 4]]);
  assert.ok(oldSource.stops[0] > when && oldSource.stops[0] < when + 0.05);
  assert.equal(player.select('b1'), null, 'same choice is not queued twice');
});

test('a second choice before the bar replaces the queued one', async () => {
  const { ctx, player } = await playing();
  ctx.currentTime = player.origin + 0.5;
  const when = player.select('b1');
  ctx.currentTime += 0.2;
  assert.equal(player.select('a1'), when);
  const [, queued, back] = ctx.sources;
  assert.ok(queued.stops[0] <= when, 'queued voice never sounds');
  assert.equal(back.starts[0][0], when);
});

test('Stop during loading prevents delayed playback; Stop silences all voices', async () => {
  const ctx = fakeContext(), player = new LoopPlayer(ctx, { load: async () => ({ duration: 8 }) });
  let release;
  const pending = player.play('a1', settings, () => new Promise(r => release = r).then(() => player.prepare(manifest)));
  player.stop(); release(); await pending;
  assert.equal(ctx.sources.length, 0); assert.equal(player.state, 'stopped');
  const { ctx: c2, player: p2 } = await playing();
  c2.currentTime = p2.origin + 1; p2.select('b1'); p2.stop();
  assert.ok(c2.sources.every(s => s.stops.length > 0));
  assert.equal(p2.state, 'stopped');
});

test('failed loading leaves a stopped, retryable player', async () => {
  const player = new LoopPlayer(fakeContext(), { load: async () => { throw new Error('offline'); } });
  await assert.rejects(player.play('a1', settings, () => player.prepare(manifest)), /offline/);
  assert.equal(player.state, 'stopped');
});

test('generated loop files match the manifest', () => {
  const m = JSON.parse(readFileSync(new URL('../public/loops/loops.json', import.meta.url)));
  assert.equal(m.loops.length, 4);
  for (const loop of m.loops) {
    const wav = readFileSync(new URL(`../public/${loop.url}`, import.meta.url));
    assert.equal(createHash('sha256').update(wav).digest('hex'), loop.sha256);
    assert.equal(wav.readUInt16LE(22), 1, 'mono'); assert.equal(wav.readUInt32LE(24), 48000);
    assert.equal((wav.length - 44) / 2, loop.lengthSamples);
    assert.ok(Math.abs(loop.lengthSamples / loop.sampleRate - m.bars * 4 * 60 / m.bpm) < 1e-4, 'whole bars at the manifest tempo');
    assert.ok(loop.peakDbfs <= -1);
  }
});

test('selection during initial loading starts the last requested recording', async () => {
  const ctx = fakeContext(), player = new LoopPlayer(ctx, { load: async () => ({ duration: 8 }) });
  let release;
  const loading = player.play('a1', settings, () => new Promise(resolve => { release = resolve; }).then(() => player.prepare(manifest)));
  player.select('b1');
  release();
  await loading;
  assert.equal(player.voice.id, 'b1');
  assert.equal(ctx.sources.length, 1, 'only the final selection starts');
});
