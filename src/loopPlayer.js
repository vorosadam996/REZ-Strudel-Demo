// SPDX-License-Identifier: AGPL-3.0-or-later
// Recorded-loop player: plain Web Audio, independent of the Strudel scheduler.
// source (per voice) -> voice gain -> filter -> level -> analyser -> destination
export const LOOP_LIMITS = { filter: [-100, 100], resonance: [0, 100], level: [0, 70] };
export const freshLoopState = () => ({ recording: 'A', part: 1, filter: 0, resonance: 10, level: 35 });

// One knob: below 0 closes a low-pass (20 kHz -> 60 Hz), above 0 raises a high-pass (20 Hz -> 2 kHz).
export function filterSetting(value) {
  const v = Math.max(-100, Math.min(100, Number(value) || 0));
  if (v < 0) return { type: 'lowpass', frequency: Math.round(20000 * Math.pow(60 / 20000, -v / 100)) };
  if (v > 0) return { type: 'highpass', frequency: Math.round(20 * Math.pow(100, v / 100)) };
  return { type: 'lowpass', frequency: 20000 };
}
export const filterQ = resonance => 0.7 + Math.max(0, Math.min(100, resonance)) / 100 * 7.3;
export const loopGain = level => Math.max(0, Math.min(70, level)) / 100 * 0.5;
export const loopId = (recording, part) => `${recording.toLowerCase()}${part}`;

// First bar boundary at least `lead` seconds after `now`, on the grid that starts at `origin`.
export function nextBarTime(now, origin, barSec, lead = 0.03) {
  if (now + lead <= origin) return origin;
  return origin + Math.ceil((now + lead - origin) / barSec - 1e-9) * barSec;
}

const FADE = 0.01;
export class LoopPlayer {
  constructor(ctx, { load, onChange = () => {} }) {
    Object.assign(this, { ctx, load, onChange, state: 'stopped', epoch: 0, buffers: new Map(), voices: new Set(), voice: null, pending: null });
  }

  graph() {
    if (this.filter) return;
    const { ctx } = this;
    this.filter = ctx.createBiquadFilter();
    this.level = ctx.createGain();
    this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048;
    this.filter.connect(this.level); this.level.connect(this.analyser); this.analyser.connect(ctx.destination);
  }

  set(settings) {
    this.graph();
    const { type, frequency } = filterSetting(settings.filter), t = this.ctx.currentTime;
    this.filter.type = type;
    this.filter.frequency.setTargetAtTime(frequency, t, 0.02);
    this.filter.Q.setTargetAtTime(filterQ(settings.resonance), t, 0.02);
    if (this.state === 'playing') this.level.gain.setTargetAtTime(loopGain(settings.level), t, 0.02);
    this.settings = { ...settings };
  }

  async prepare(manifest) {
    const missing = manifest.loops.filter(loop => !this.buffers.has(loop.id));
    const loaded = await Promise.all(missing.map(loop => this.load(loop.url)));
    missing.forEach((loop, i) => this.buffers.set(loop.id, loaded[i]));
    this.bars = manifest.bars;
  }

  startVoice(id, when, offset) {
    const buffer = this.buffers.get(id);
    if (!buffer) throw new Error(`Loop ${id} is not loaded.`);
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = buffer; source.loop = true;
    source.connect(gain); gain.connect(this.filter);
    gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(1, when + FADE);
    source.start(when, offset);
    const voice = { id, source, gain };
    this.voices.add(voice);
    source.onended = () => { this.voices.delete(voice); source.disconnect(); gain.disconnect(); };
    return voice;
  }

  endVoice(voice, when) {
    voice.gain.gain.setValueAtTime(1, when); voice.gain.gain.linearRampToValueAtTime(0, when + FADE);
    voice.source.stop(when + FADE * 2);
  }

  silence(voice, when) {
    voice.gain.gain.cancelScheduledValues(when);
    voice.gain.gain.setValueAtTime(0, when);
    voice.source.stop(when);
  }

  // `prepareAudio` loads/decodes and resumes audio; Stop during it cancels the start.
  async play(id, settings, prepareAudio) {
    if (this.state !== 'stopped') return;
    const epoch = ++this.epoch;
    this.requestedId = id;
    this.state = 'loading'; this.onChange(this.state);
    try {
      await prepareAudio();
      if (epoch !== this.epoch) return;
      id = this.requestedId;
      this.set(settings);
      const when = this.ctx.currentTime + 0.03;
      this.level.gain.cancelScheduledValues(when);
      this.level.gain.setValueAtTime(loopGain(settings.level), when);
      this.origin = when;
      this.loopSec = this.buffers.get(id)?.duration;
      this.barSec = this.loopSec / this.bars;
      this.voice = this.startVoice(id, when, 0);
      this.state = 'playing'; this.onChange(this.state);
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.stop(); throw error;
    }
  }

  // Switches on the next bar, keeping the position inside the 4-bar phrase.
  // A second choice before that bar replaces the queued one.
  select(id) {
    if (this.state === 'loading') {
      this.requestedId = id;
      return null;
    }
    if (this.state !== 'playing') return null;
    const queued = this.pendingIn() !== null;
    if (this.voice.id === id) return null;
    let when;
    if (queued) {
      when = this.pending.when;
      this.silence(this.voice, this.ctx.currentTime);
    } else {
      when = nextBarTime(this.ctx.currentTime, this.origin, this.barSec);
      this.endVoice(this.voice, when);
    }
    const offset = ((when - this.origin) % this.loopSec + this.loopSec) % this.loopSec;
    this.voice = this.startVoice(id, when, offset);
    this.pending = { when };
    return when;
  }

  // Seconds until the queued switch, or null when none is pending.
  pendingIn() {
    if (!this.pending) return null;
    const left = this.pending.when - this.ctx.currentTime;
    if (left <= 0.005) { this.pending = null; return null; }
    return left;
  }

  stop() {
    ++this.epoch;
    if (this.level) {
      const t = this.ctx.currentTime;
      this.level.gain.cancelScheduledValues(t);
      this.level.gain.setTargetAtTime(0, t, 0.01);
      for (const voice of this.voices) voice.source.stop(t + 0.08);
    }
    this.voice = null; this.pending = null;
    this.state = 'stopped'; this.onChange(this.state);
  }

  waveform(data) {
    if (this.state !== 'playing' || !this.analyser) return null;
    this.analyser.getFloatTimeDomainData(data);
    return data;
  }
}
