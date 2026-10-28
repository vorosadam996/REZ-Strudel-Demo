// SPDX-License-Identifier: AGPL-3.0-or-later
// Acid-only editable sequencer. PLAY runs acidCode(state) (src/state.js) —
// the bassline of the preserved USER_ACID_CODE stack without its drums, built
// from the step grid, TEMPO, CUTOFF and RESONANCE — through the real
// @strudel/web repl (1.3.0). Edits while playing re-evaluate the generated
// code on the SAME scheduler (autostart=false): no parallel loop, no cycle
// restart. LEVEL controls a REAL master gain — strudel's final output gain is
// re-routed through our own GainNode, and re-evaluation is NEVER used for
// volume. Manual PLAY only, no autoplay. Stop rapidly fades the master gain to
// 0 and hushes the scheduler (1.3.0 has no panic API); the audible result
// still needs the browser listening check.
import './style.css';
import { LOOP_LIMITS, freshLoopState, filterSetting, loopId, LoopPlayer } from './loopPlayer.js';
import { freshState, boundedValue, resumeAudioContext, acidCode, cutoffHz, resonanceQ, NOTES, Transport, createMasterLink, createStartGate, createSerialQueue, createLiveUpdate, requireStarted } from './state.js';

const $ = id => document.getElementById(id);
let state = freshState();
const loopState = freshLoopState();
let loopPlayer, loopData;
const loopWave = new Float32Array(2048);
const hz = value => value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${value} Hz`;
let lib, audio, ready = false;
let maxPeak = 0, frame = 0;
let playing = () => transport?.state === 'playing';

// soundEpoch: bumped by every stop/reset path. Each start captures it at
// request time, and createStartGate (state.js) serializes the evaluates and
// re-checks it: a start that went stale before its evaluate runs is skipped,
// and one that went stale while evaluating kills ONLY its own fresh arm
// (park + hush) — serialization guarantees no newer Play's evaluate has begun,
// so a late-resolving older start can never silence or stop a newer one.
// Stale rejections are swallowed by the Transport, never shown as an error
// for the newer playback.
let soundEpoch = 0;

// --- Real master gain (fail-closed) ---------------------------------------
// strudel chain: [voices] -> channelMerger -> destinationGain -> ctx.destination.
// createMasterLink (src/state.js) taps destinationGain and inserts our own
// GainNode: on ANY reroute failure the link reports unlinked, the
// chain stays silent/parked (never a direct full-volume bypass), and Play
// refuses to start instead of evaluating at uncontrolled volume.
const masterLink = createMasterLink({
  getController: () => lib?.getSuperdoughAudioController?.(),
  getContext: () => audio,
});

// Stop path: rapidly fade the master toward 0 FIRST,
// then hush the repl scheduler. No re-evaluation, no panic API needed. Also
// used by the start gate's stale branch — but only while it is guaranteed
// (via serialization) that no newer Play's sound exists yet.
function silence() {
  try { masterLink.park(); } catch (e) { console.error('[REZ demo] master park failed:', e); }
  try { lib.hush(); } catch (e) { console.error('[REZ demo] hush failed:', e); }
}

// --- Per-start evaluation reporting (@strudel/web 1.3.0 semantics) --------
// The repl's evaluate() CATCHES pattern errors, reports them through the
// onEvalError callback configured on initStrudel (NOT through a rejection
// and NOT through a global fail()) and then RESOLVES undefined. Evaluates
// are serialized by the start gate, so this one capture slot cannot race.
// Eval errors surface ONLY through the gate → Transport error path: a stale
// A's failure is silenced and swallowed there and can never stop or error
// out a newer playback B; a non-stale failure stops the transport and is
// surfaced by play()'s own catch.
let evalReportedError = null;

// Runs the code generated from the CURRENT UI state through the repl, with
// proof of start (requireStarted). autostart=true only for a manual PLAY; live
// updates pass false so they can never start a stopped scheduler.
// revision counts UI edits; appliedRevision is what the scheduler now plays.
let revision = 0, appliedRevision = -1;
function evaluateState(autostart) {
  const built = revision;
  evalReportedError = null;                    // capture ONLY this evaluate's error
  return requireStarted(
    () => lib.evaluate(acidCode(state), autostart),
    () => evalReportedError,
  ).then(pattern => { appliedRevision = built; return pattern; });
}

// --- UI / audio glue ------------------------------------------------------
function fail(error) {
  transport?.stop(); loopPlayer?.stop();
  $('error').hidden = false;
  $('error').textContent = `Audio could not continue. ${error?.message ?? 'Please reload and try again.'}`;
  $('status').textContent = 'Audio unavailable — see message below.';
  console.error('[REZ demo]', error);
}

function drawScope() {
  const canvas = $('scope'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const data = loopPlayer?.waveform(loopWave) ?? lib?.getAnalyzerData('time', 1);
  let peak = 0;
  ctx.lineWidth = 1.4; ctx.strokeStyle = (playing() || loopPlayer?.state === 'playing') ? '#d5ff70' : '#50594b'; ctx.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const sample = data?.[Math.floor(x / canvas.width * data.length)] ?? 0;
    peak = Math.max(peak, Math.abs(sample));
    const y = canvas.height / 2 - sample * canvas.height * 1.4;
    x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke(); maxPeak = Math.max(maxPeak, peak);
  if (loopPlayer?.state === 'playing' && loopPlayer.pending && loopPlayer.pendingIn() === null) $('loop-status').textContent = `Loop ${loopName()} playing.`;
  if (frame++ % 15 === 0) $('diagnostics').textContent = `Audio: ${audio?.state ?? 'not started'} · Transport: ${transport?.state ?? 'loading'} · Master: ${master_linked_label()} · Peak now: ${peak.toFixed(4)} · Peak max: ${maxPeak.toFixed(4)}`;
  requestAnimationFrame(drawScope);
}

function master_linked_label() {
  return masterLink.linked ? `live (${Math.round(masterLink.volume * 100)}%)` : 'unavailable';
}

const hzLabel = hz => hz >= 1000 ? `${(hz / 1000).toFixed(2)} kHz` : `${hz} Hz`;
function controls() {
  for (const key of ['bpm', 'cutoff', 'resonance', 'volume']) $(key).value = state[key];
  $('cutoff-value').value = hzLabel(cutoffHz(state.cutoff));
  $('resonance-value').value = `${state.resonance}% · Q ${resonanceQ(state.resonance)}`;
  $('volume-value').value = `${state.volume}%`;
}

// LEVEL acts ONLY on the master gain (state.volume never touches the user
// code, and the code is never re-evaluated for volume). It is live while
// playing; otherwise it settles the level the next PLAY arms itself with.
function applyLevel() {
  if (!ready) return;
  if (playing() && masterLink.linked) masterLink.setVolume(state.volume / 100);
}

// Fail-closed PLAY: the evaluate is reached ONLY when the master link exists.
// Any hookup failure aborts Play with an honest error — the direct strudel
// output can never sound at uncontrolled (possibly full) volume.
function ensureMasterLink() {
  if (masterLink.linked) return true;
  if (masterLink.hookup()) return true;
  throw new Error('LEVEL has no path to the speakers (master audio link failed), so playback stays silent instead of running at uncontrolled volume. Try reloading the page.');
}

// Serialized, stale-safe start path (createStartGate in state.js). The strudel
// evaluate is the only async audio-start operation, so it is queued behind any
// earlier start — including its stale cleanup — before it may begin. Each
// start captures soundEpoch when the start is requested (after unlock, before
// the evaluate is queued); the gate skips a start stale before evaluating, and
// a start stale after evaluating calls silence() to kill ONLY what THAT
// evaluate just armed — it can never touch a newer Play, because the newer
// Play's evaluate is still waiting behind this one.
const audioQueue = createSerialQueue();   // starts AND live updates: never overlapping
const startGate = createStartGate({
  queue: audioQueue,
  epoch: () => soundEpoch,
  // evaluateState(true) runs the code generated from the UI state through the
  // real Strudel repl and starts it on the repl scheduler. Never called
  // outside a manual PLAY — no autoplay, ever.
  // 1.3.0 repl semantics: a FAILED evaluation is reported to onEvalError and
  // RESOLVES undefined — so a plain resolution proves nothing. The serialized
  // gate makes this per-start slate safe: evaluateState clears the capture,
  // runs the raw evaluate, and requireStarted turns "resolved undefined" into
  // the real reported error (or an honest fallback) so the gate never arms a
  // start that did not start.
  evaluate: () => evaluateState(true), // new playthrough armed by onArmed
  onStale: () => silence(),                                       // kill only this start's own arm
  onArmed: () => masterLink.setVolume(state.volume / 100),        // guarded arm from 0 (parked)
});

// Live edits: one coalesced re-evaluation on the same queue, only while
// playing, with autostart=false — a late update after Stop is skipped and
// could not start the stopped scheduler anyway. A failed update keeps the
// previous pattern playing and says so.
const liveUpdate = createLiveUpdate({
  queue: audioQueue,
  isLive: playing,
  evaluate: () => evaluateState(false),
  onError: error => {
    $('error').hidden = false;
    $('error').textContent = `That edit could not be applied; the previous pattern keeps playing. ${error?.message ?? ''}`;
    console.error('[REZ demo] live update failed:', error);
  },
});
function edited() {
  revision++;
  if (playing()) liveUpdate();
}

// Fail-closed PLAY: the gate is reached ONLY when the master link exists.
// Any hookup failure aborts Play with an honest error — the direct strudel
// output can never sound at uncontrolled (possibly full) volume.
async function startSound() {
  if (!ready) throw new Error('The instrument is still loading.');
  ensureMasterLink();
  return startGate(soundEpoch);
}

let transport;

async function load() {
  if (!('AudioContext' in window)) throw new Error('This browser does not support Web Audio. Try a current browser.');
  lib = await import('@strudel/web');
  // This runtime MUST provide the official master-audio API, otherwise LEVEL
  // cannot work honestly and we stop rather than ship a fake knob.
  if (typeof lib.initStrudel !== 'function' || typeof lib.evaluate !== 'function'
    || typeof lib.hush !== 'function'
    || typeof lib.getSuperdoughAudioController !== 'function') {
    throw new Error('The installed Strudel runtime does not export the needed master-audio API (initStrudel/evaluate/hush/getSuperdoughAudioController).');
  }
  // initStrudel sets up the real repl (transpiler + its own webaudioScheduler).
  // 1.3.0 returns an initDone promise — initialization is awaited so PLAY can
  // never be armed against an unprepared repl. Eval errors are captured per
  // start (see evalReportedError), deliberately NOT routed to fail(): a stale
  // start's error must never stop or error out newer playback.
  await lib.initStrudel({ onEvalError: error => { evalReportedError = error; } });
  transport = new Transport({
    unlock: async () => {
      audio = lib.getAudioContext();
      // Resume on the Play gesture, before loading worklets or sample metadata.
      // Strudel 1.3.0's initAudio() does not reliably resume a suspended
      // context, so waiting for it first can lose the browser's user gesture.
      await resumeAudioContext(audio);
      await lib.initAudio();
      // Acid-only: the sawtooth is a built-in synth, so no drum samples are
      // loaded and none are needed to start (they stay bundled with the
      // preserved USER_ACID_CODE source).
      if (audio.state !== 'running') throw new Error('Audio is suspended. Tap Play again.');
      // The tap must exist by the first PLAY; attempt is free and idempotent.
      // If it fails here, startSound() later fails CLOSED with an honest error.
      masterLink.hookup();
    },
    start: () => {
      // async: the Transport becomes 'playing' only after the evaluate
      // actually started the pattern; Transport swallows stale outcomes
      // (a cancelled start never stops newer playback, see state.js).
      return startSound();
    },
    stop: () => {
      soundEpoch++;   // invalidates any evaluate() still in flight
      silence();
    },
  }, changeTransport);
  ready = true; controls(); changeTransport('stopped'); changeLoop('stopped');
}

function changeTransport(value) {
  const isPlaying = value === 'playing';
  $('play').disabled = !ready || value !== 'stopped';
  $('stop').disabled = !ready || value === 'stopped';
  $('live-dot').classList.toggle('lit', isPlaying || loopPlayer?.state === 'playing');
  $('status').textContent = isPlaying
    ? 'Playing — acid line, edits apply live.'
    : value === 'starting' ? 'Opening audio…' : 'Ready when you are.';
  // Edits made while the start was in flight are applied once it plays.
  if (isPlaying && revision !== appliedRevision) liveUpdate();
}

function loopControls() {
  for (const key of ['filter', 'resonance', 'level']) $(`loop-${key}`).value = loopState[key];
  const { type, frequency } = filterSetting(loopState.filter);
  $('loop-filter-value').value = loopState.filter === 0 ? 'Open' : `${type === 'lowpass' ? 'LP' : 'HP'} ${hz(frequency)}`;
  $('loop-resonance-value').value = `${loopState.resonance}%`;
  $('loop-level-value').value = `${loopState.level}%`;
  document.querySelectorAll('[data-recording]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.recording === loopState.recording)));
  document.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.part) === loopState.part)));
}

const loopName = () => `${loopState.recording}${loopState.part}`;
function changeLoop(value) {
  $('loop-play').disabled = !ready || value !== 'stopped';
  $('loop-stop').disabled = !ready || value === 'stopped';
  $('live-dot').classList.toggle('lit', value === 'playing' || transport?.state === 'playing');
  $('loop-status').textContent = value === 'playing' ? `Loop ${loopName()} playing.` : value === 'loading' ? 'Loading loops…' : loopPlayer ? 'Loop stopped.' : 'Loops (about 4 MB) load when you press Play loop.';
}

async function prepareLoops() {
  audio = lib.getAudioContext();
  await audio.resume();
  if (audio.state !== 'running') throw new Error('Audio is suspended. Tap Play loop again.');
  if (!loopData) {
    const response = await fetch('./loops/loops.json');
    if (!response.ok) throw new Error('The recorded loops could not be loaded.');
    loopData = await response.json();
  }
  await loopPlayer.prepare(loopData);
}

// Created on the first Play loop tap so no audio context opens before a gesture.
function createLoopPlayer() {
  const context = lib.getAudioContext();
  return new LoopPlayer(context, {
    load: async url => {
      const response = await fetch(`./${url}`);
      if (!response.ok) throw new Error('The recorded loops could not be loaded.');
      return context.decodeAudioData(await response.arrayBuffer());
    },
    onChange: changeLoop,
  });
}

function chooseLoop() {
  loopControls();
  const when = loopPlayer?.select(loopId(loopState.recording, loopState.part));
  if (when != null) $('loop-status').textContent = `Switching to ${loopName()} on the next bar…`;
}


// Step grid: the button switches a step on/off, each select sets a note.
// Step 08 keeps its two sub-notes, each with its own select.
function drawSteps() {
  $('steps').replaceChildren();
  state.steps.forEach((step, i) => {
    const cell = document.createElement('div');
    cell.className = step.notes.length > 1 ? 'step split' : 'step';
    const button = document.createElement('button');
    button.className = 'step-button'; button.type = 'button';
    button.setAttribute('aria-pressed', String(step.on));
    button.setAttribute('aria-label', `Step ${i + 1} on/off`);
    button.innerHTML = `<span class="step-number">${String(i + 1).padStart(2, '0')}</span><span class="step-light"></span><span class="step-mark">●</span>`;
    button.addEventListener('click', () => {
      step.on = !step.on; button.setAttribute('aria-pressed', String(step.on)); edited();
    });
    cell.append(button);
    step.notes.forEach((note, n) => {
      const select = document.createElement('select');
      select.setAttribute('aria-label', step.notes.length > 1 ? `Step ${i + 1} note ${n + 1} of ${step.notes.length}` : `Note for step ${i + 1}`);
      for (const name of NOTES) {
        const option = document.createElement('option');
        option.value = name; option.textContent = name; select.append(option);
      }
      select.value = note;
      select.addEventListener('change', () => {
        if (NOTES.includes(select.value)) { step.notes[n] = select.value; edited(); }
      });
      cell.append(select);
    });
    $('steps').append(cell);
  });
}

for (const key of ['cutoff', 'resonance']) {
  $(key).addEventListener('input', () => {
    state[key] = boundedValue(key, $(key).value, state[key]); controls(); edited();
  });
}
// Committed on change (not every keystroke), so typing "1" on the way to
// "140" never jumps the tempo to the 70 BPM floor.
$('bpm').addEventListener('change', () => {
  state.bpm = boundedValue('bpm', $('bpm').value, state.bpm); controls(); edited();
});

$('volume').addEventListener('input', () => {
  const next = boundedValue('volume', $('volume').value, state.volume);
  state.volume = next; controls();
  applyLevel();   // real master gain while playing; state-only otherwise
});

$('play').addEventListener('click', () => { $('error').hidden = true; loopPlayer?.stop(); transport?.play().catch(fail); });
$('stop').addEventListener('click', () => transport?.stop());
// Reset: stop the transport, then restore the acid-only starting line.
$('reset').addEventListener('click', () => {
  transport?.stop(); loopPlayer?.stop(); Object.assign(loopState, freshLoopState()); loopControls(); state = freshState(); revision++; controls(); drawSteps(); $('error').hidden = true;
});
for (const key of ['filter', 'resonance', 'level']) {
  $(`loop-${key}`).addEventListener('input', event => {
    const [min, max] = LOOP_LIMITS[key], value = Math.round(Number(event.target.value));
    loopState[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : loopState[key];
    loopControls(); loopPlayer?.set(loopState);
  });
}
document.querySelectorAll('[data-recording]').forEach(b => b.addEventListener('click', () => { loopState.recording = b.dataset.recording; chooseLoop(); }));
document.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => { loopState.part = Number(b.dataset.part); chooseLoop(); }));
$('loop-play').addEventListener('click', () => {
  if (!ready) return;
  $('error').hidden = true; transport?.stop();
  loopPlayer ??= createLoopPlayer();
  loopPlayer.play(loopId(loopState.recording, loopState.part), loopState, prepareLoops).catch(fail);
});
$('loop-stop').addEventListener('click', () => loopPlayer?.stop());
document.addEventListener('visibilitychange', () => { if (document.hidden) { transport?.stop(); loopPlayer?.stop(); } });
window.addEventListener('pagehide', () => { transport?.stop(); loopPlayer?.stop(); });
drawSteps(); loopControls(); drawScope();
load().catch(fail);
