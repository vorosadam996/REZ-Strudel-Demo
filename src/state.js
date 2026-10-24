// SPDX-License-Identifier: AGPL-3.0-or-later
// Chromatic bass range offered by the step editor; only these names can ever
// reach the generated Strudel code (anything else becomes a rest).
export const NOTES = ['E1', 'F1', 'F#1', 'G1', 'G#1', 'A1', 'A#1', 'B1', 'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2', 'A2', 'A#2', 'B2', 'C3'];

// The user's ORIGINAL full Strudel stack, drums included. Kept verbatim as the
// source this acid-only demo is derived from (the RolandTR909 samples, the
// packs and the Hercules sources stay bundled with it) — it is NOT what PLAY
// runs any more. PLAY runs acidCode(state): the bassline of this stack only,
// built from the editable step grid and the live TEMPO/CUTOFF/RESONANCE.
export const USER_ACID_CODE = `setcpm(168/4)

let drums = stack(
  s("bd*4").bank("RolandTR909").gain(1.1).shape(0.3),
  s("~ cp ~ cp").bank("RolandTR909").gain(0.7).room(0.15),
  s("[~ hh]*4").bank("RolandTR909").gain(0.5),
  s("hh*16").bank("RolandTR909").gain(0.2).degradeBy(0.5)
)

stack(drums,
  note("a1 a1 a2 a1 a1 a2 a1 [a1 a2] a1 a1 a2 a1 c2 a1 g1 a1")
    .s("sawtooth").lpf(sine.range(400, 2000).slow(4)).lpq(15)
    .decay(0.1).sustain(0)
    .sometimesBy(0.2, x => x.add(note(12)))
    .shape(0.4).gain(0.7)
)`;

// The acid-only starting line: the bassline of USER_ACID_CODE. Step 08 holds
// two sub-notes ([a1 a2]), each editable on its own.
export const ACID_BASSLINE = 'a1 a1 a2 a1 a1 a2 a1 [a1 a2] a1 a1 a2 a1 c2 a1 g1 a1';
const acidSteps = ACID_BASSLINE.match(/\[[^\]]+\]|\S+/g)
  .map(step => step.replace(/[[\]]/g, '').split(' ').map(note => note.toUpperCase()));

export function freshState() {
  return { bpm: 168, cutoff: 50, resonance: 50, volume: 15,
    steps: acidSteps.map(notes => ({ on: true, notes: [...notes] })) };
}
export const LIMITS = { bpm: [70, 180], cutoff: [0, 100], resonance: [0, 100], volume: [0, 70] };
export function boundedValue(key, value, fallback) {
  if (String(value).trim() === '' || !Number.isFinite(Number(value))) return fallback;
  const [min, max] = LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(Number(value))));
}

// Called directly from the user-initiated Play handler, before any sample or
// worklet load can consume the browser's audio-unlock gesture.
export async function resumeAudioContext(audio) {
  if (!audio || typeof audio.resume !== 'function') throw new Error('Audio context is unavailable.');
  if (audio.state !== 'running') await audio.resume();
  if (audio.state !== 'running') throw new Error('Audio is suspended. Tap Play again.');
}

export const cutoffHz = value => Math.round(150 * Math.pow(40, value / 100));
// RESONANCE 0..100 -> lpq 0..30; the default 50 is the original lpq(15).
export const resonanceQ = value => Math.round(value * 3) / 10;
const safeNote = note => NOTES.includes(note) ? note.toLowerCase() : '~';
export const patternText = state => state.steps.map(step => {
  if (!step.on) return '~';
  const notes = step.notes.map(safeNote);
  return notes.length > 1 ? `[${notes.join(' ')}]` : notes[0];
}).join(' ');

// The code PLAY actually runs, generated from the UI state alone: tempo, the
// step grid, a STATIC cutoff (no LFO overriding the knob) and resonance. Every
// number is bounded and every note whitelisted, so nothing user-typed reaches
// the evaluator. Sound: sawtooth, decay 0.1, sustain 0, shape 0.4 — no drums.
export function acidCode(state) {
  const bpm = boundedValue('bpm', state.bpm, 168);
  const cutoff = cutoffHz(boundedValue('cutoff', state.cutoff, 50));
  const q = resonanceQ(boundedValue('resonance', state.resonance, 50));
  return `setcpm(${bpm}/4)

note("${patternText(state)}")
  .s("sawtooth").lpf(${cutoff}).lpq(${q})
  .decay(0.1).sustain(0)
  .shape(0.4).gain(0.7)`;
}

// Waits for the async audio unlock AND the async engine start, so `state`
// says 'playing' only after the sound is actually started. A start whose
// epoch was invalidated while awaiting (Stop, tab hide, a newer Play) is
// stale: its success is ignored and its rejection is swallowed here — a
// cancelled start must never stop or error out the newer playback that owns
// the transport by then.
export class Transport {
  constructor(engine, onChange) { this.engine = engine; this.onChange = onChange; this.state = 'stopped'; this.epoch = 0; }
  async play() {
    if (this.state !== 'stopped') return;
    const epoch = ++this.epoch;
    this.state = 'starting'; this.onChange(this.state);
    try {
      await this.engine.unlock();
      if (epoch !== this.epoch) return;
      await this.engine.start();          // async: the real start, awaited
      if (epoch !== this.epoch) return;   // Stop raced the async start
      this.state = 'playing'; this.onChange(this.state);
    } catch (error) {
      if (epoch !== this.epoch) return;   // stale start's error: swallow, don't stop a newer Play
      this.stop(); throw error;
    }
  }
  stop() {
    ++this.epoch;
    this.engine.stop(); this.state = 'stopped'; this.onChange(this.state);
  }
}

// Serialized, stale-safe audio starts: the fix for the Play→Stop→Play race.
//
// evaluate() (the async audio start) NEVER overlaps itself: each request is
// queued behind the previous one — including its stale cleanup — so when a
// start's continuation runs, no newer evaluate has begun and its cleanup
// cannot silence a newer Play's sound. epoch() reads the global sound epoch
// (bumped by every Stop/reset); each start captures it at request time and
// the gate re-checks it twice:
// - stale BEFORE the evaluate runs → the start is skipped entirely:
//   nothing was armed, nothing needs silencing;
// - stale WHILE the evaluate was in flight → onStale() kills ONLY the arm
//   THIS evaluate just created (park + hush) — safe here precisely because
//   serialization guarantees no newer Play's sound exists yet. This holds
//   for stale REJECTION too: an evaluate may partially schedule voices and
//   then fail, so its leftover voices must be silenced before the newer
//   Play's evaluate begins; the stale rejection itself is swallowed (a
//   cancelled start never stops or errors out the newer playback);
// - still current after evaluating → onArmed() arms the master level.
//
// A non-stale rejection propagates unchanged to its own caller; the
// Transport stops, surfaces the real error and stays retryable.
//
// `queue` (optional) is a createSerialQueue() shared with createLiveUpdate,
// so live re-evaluations and starts never overlap either.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return task => {
    const next = tail.then(task, task);                   // run after the previous task settles, error or not
    tail = next.catch(() => {});                          // the queue itself never rejects
    return next;
  };
}

export function createStartGate({ epoch, evaluate, onStale, onArmed, queue = createSerialQueue() }) {
  return (requestEpoch) => {
    const run = async () => {
      if (requestEpoch !== epoch()) return;               // cancelled before arming
      try {
        await evaluate();
        if (requestEpoch !== epoch()) { onStale(); return; } // kill only this arm
        onArmed();
      } catch (error) {
        if (requestEpoch !== epoch()) { onStale(); return; } // stale voices scheduled then failed: silence the leftovers, swallow the error
        throw error;                                      // non-stale: real error path (Transport stops + surfaces)
      }
    };
    return queue(run);
  };
}

// Live edits while playing (steps, TEMPO, CUTOFF, RESONANCE). Each edit asks
// for ONE re-evaluation on the shared serial queue; edits arriving while one
// is already queued coalesce into it, because the queued run builds its code
// from the latest state when it runs. The re-evaluation swaps the pattern on
// the single running scheduler (main.js evaluates with autostart=false), so it
// never adds a parallel loop and never restarts the cycle. Stop-safety:
// - not live when the run comes up (stopped, starting) → skipped, nothing evaluated;
// - the evaluate itself cannot start a stopped scheduler (autostart=false),
//   so a Stop landing while it is in flight leaves the sound stopped;
// - a failure is reported via onError only if still live; the scheduler
//   keeps the previous pattern (the repl only swaps on success).
export function createLiveUpdate({ queue, isLive, evaluate, onError = () => {} }) {
  let queued = null;
  return () => {
    queued ??= queue(async () => {
      queued = null;
      if (!isLive()) return 'skipped';
      try {
        await evaluate();
        return 'applied';
      } catch (error) {
        if (isLive()) onError(error);
        return 'failed';
      }
    });
    return queued;
  };
}

// Proof-of-start validation for a repl evaluate() call under
// @strudel/web 1.3.0 semantics — used by src/main.js as its gate evaluate,
// so tests exercise the exact same helper/path.
//
// The runtime's repl evaluate() CATCHES pattern errors internally, reports
// them via the onEvalError callback configured on initStrudel (it does NOT
// reject) and then RESOLVES undefined; only a real success returns the
// pattern (a truthy value). A resolution alone therefore never proves the
// pattern started, so this helper:
// - awaits the raw evaluate; a genuine rejection propagates UNCHANGED;
// - any resolved value other than undefined counts as a real start;
// - a resolved UNDEFINED is turned into a rejection carrying the error the
//   runtime actually reported (read back through `reportedError` — safe to
//   capture per start because evaluates are serialized by the start gate),
//   or an honest fallback error when the runtime reported none. "Started"
//   is never claimed without evidence, and no count/status is invented.
export async function requireStarted(runEvaluate, reportedError = () => undefined) {
  try {
    const result = await runEvaluate();
    if (result !== undefined) return result;
  } catch (error) {
    throw error;                          // real runtime failure: propagate unchanged
  }
  const reported = reportedError();
  if (reported) throw reported;           // the REAL captured error, rethrown
  throw new Error('The pattern engine completed the evaluation without a startable result and reported no error — playback cannot be claimed to have started. Try Play again.');
}

// Real master-chain link for the Strudel runtime (fail-closed decision logic;
// src/main.js supplies the runtime getters). It reroutes the final superdough
// output (destinationGain, the last GainNode before ctx.destination) through an
// OWN GainNode so LEVEL acts on the whole stack while the user's code stays
// verbatim. Fail-closed by design:
// - the inserted gain starts parked at 0 (audible only after an armed start),
// - any reroute failure reports linked=false and leaves the chain disconnected
//   or parked-to-zero — NEVER reconnected directly at full volume — so PLAY
//   must refuse to evaluate instead of bypassing the master level.
export function createMasterLink({ getController, getContext, rampTime = 0.02 }) {
  let gain = null, linked = false, volume = 0;
  const ctx = () => getContext();
  const clamp01 = v => Math.min(1, Math.max(0, v));

  return {
    get linked() { return linked; },
    get volume() { return volume; },
    // Idempotent. True only when the chain is fully rerouted:
    // destinationGain -> gain -> ctx.destination with gain parked at 0.
    hookup() {
      if (linked && gain) return true;
      try {
        const context = ctx();
        const dg = getController?.()?.output?.destinationGain;
        if (!context || !dg) return false;
        gain ??= context.createGain();
        volume = 0;
        gain.gain.value = volume;          // parked: silent until an armed start
        gain.disconnect();                 // clean state for retry after a partial failure
        dg.disconnect();                   // from here the old chain cannot sound directly
        dg.connect(gain);
        gain.connect(context.destination);
        linked = true;
        return true;
      } catch (e) {
        // A partial reroute must not remain a direct, loud bypass: keep or drop
        // the inserted gain (parked at 0) and disconnect the tap. Result is a
        // SILENT or unlinked chain — never a full-volume direct route.
        console.error('[REZ demo] master reroute failed — playback stays fail-closed:', e);
        try { gain?.disconnect(); } catch { /* already clean */ }
        linked = false;
        return false;
      }
    },
    // LEVEL: real master-gain ramp on the whole stack. No-op while unlinked.
    setVolume(v01) {
      if (!linked || !gain || !ctx()) return;
      volume = clamp01(v01);
      gain.gain.setTargetAtTime(volume, ctx().currentTime, rampTime);
    },
    // Stop path: ramp toward 0 first. The time constant is deliberately short.
    park(timeConstant = 0.01) {
      if (!linked || !gain || !ctx()) return;
      volume = 0;
      gain.gain.setTargetAtTime(0, ctx().currentTime, timeConstant);
    },
    disarm() {
      if (gain) { try { gain.disconnect(); } catch { /* ignore */ } }
      gain = null; linked = false; volume = 0;
    },
  };
}
