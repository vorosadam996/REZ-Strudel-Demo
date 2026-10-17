// SPDX-License-Identifier: AGPL-3.0-or-later
export const NOTES = ['C2', 'D2', 'Eb2', 'F2', 'G2', 'Ab2', 'Bb2', 'C3'];
const sequence = ['C2', null, 'C2', 'Eb2', null, 'C2', 'G2', null, 'C2', null, 'Bb2', 'G2', null, 'Eb2', null, 'G2'];
export function freshState() {
  return { bpm: 128, cutoff: 50, resonance: 24, volume: 35,
    steps: sequence.map(note => ({ on: note !== null, note: note ?? 'C2' })) };
}
export const LIMITS = { bpm: [70, 180], cutoff: [0, 100], resonance: [0, 100], volume: [0, 70] };
export function boundedValue(key, value, fallback) {
  if (String(value).trim() === '' || !Number.isFinite(Number(value))) return fallback;
  const [min, max] = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}
export const cutoffHz = value => Math.round(150 * Math.pow(40, value / 100));
export const patternText = state => state.steps.map(step => step.on && NOTES.includes(step.note) ? step.note.toLowerCase() : '~').join(' ');

// Cancels an in-flight audio unlock if Stop or tab hiding happens first.
export class Transport {
  constructor(engine, onChange) { this.engine = engine; this.onChange = onChange; this.state = 'stopped'; this.epoch = 0; }
  async play() {
    if (this.state !== 'stopped') return;
    const epoch = ++this.epoch;
    this.state = 'starting'; this.onChange(this.state);
    try {
      await this.engine.unlock();
      if (epoch !== this.epoch) return;
      this.engine.start();
      this.state = 'playing'; this.onChange(this.state);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.stop(); throw error;
    }
  }
  stop() {
    ++this.epoch;
    this.engine.stop(); this.state = 'stopped'; this.onChange(this.state);
  }
}
