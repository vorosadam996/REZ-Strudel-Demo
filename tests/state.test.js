// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshState, patternText, boundedValue, cutoffHz, Transport } from '../src/state.js';
test('pattern has exactly 16 safe notes/rests; unknown notes become rests', () => {
  const state = freshState();
  assert.equal(patternText(state).split(' ').length, 16);
  state.steps[0].note = 'invalid code';
  assert.equal(patternText(state).split(' ')[0], '~');
  state.steps.forEach(step => step.on = false);
  assert.equal(patternText(state), Array(16).fill('~').join(' '));
});
test('numeric input cannot escape musical bounds or admit invalid values', () => {
  assert.equal(boundedValue('bpm', '', 128), 128);
  assert.equal(boundedValue('bpm', 'NaN', 128), 128);
  assert.equal(boundedValue('bpm', 9999, 128), 180);
  assert.equal(boundedValue('volume', -10, 35), 0);
  assert.equal(boundedValue('resonance', Infinity, 24), 24);
  assert.equal(cutoffHz(0), 150); assert.equal(cutoffHz(100), 6000);
});
test('reset state does not retain edited step references', () => {
  const old = freshState(); old.steps[0].on = false;
  assert.equal(freshState().steps[0].on, true);
});
test('Stop during pending audio unlock prevents delayed playback', async () => {
  let unlock, starts = 0, stops = 0;
  const t = new Transport({ unlock: () => new Promise(r => unlock = r), start: () => starts++, stop: () => stops++ }, () => {});
  const pending = t.play(); t.stop(); unlock(); await pending;
  assert.equal(starts, 0); assert.equal(stops, 1); assert.equal(t.state, 'stopped');
});
test('repeated Play does not stack transports; restart works after Stop', async () => {
  let starts = 0;
  const t = new Transport({ unlock: async () => {}, start: () => starts++, stop: () => {} }, () => {});
  await Promise.all([t.play(), t.play()]); await t.play();
  assert.equal(starts, 1); t.stop(); await t.play(); assert.equal(starts, 2);
});
test('failed audio unlock restores a stopped, retryable transport', async () => {
  const t = new Transport({ unlock: async () => { throw new Error('blocked'); }, start: () => {}, stop: () => {} }, () => {});
  await assert.rejects(t.play(), /blocked/); assert.equal(t.state, 'stopped');
});
