// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { freshState, patternText, boundedValue, resumeAudioContext, cutoffHz, resonanceQ, acidCode, ACID_BASSLINE, NOTES, Transport, USER_ACID_CODE, createMasterLink, createStartGate, createSerialQueue, createLiveUpdate, requireStarted } from '../src/state.js';

// The user's original full Strudel stack (drums included) stays stored
// verbatim as the source of the acid-only demo — it is no longer what PLAY runs.
const USER_ACID_EXACT = `setcpm(168/4)

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
test('the original User Acid 168 stack, drums included, is preserved verbatim as source', () => {
  assert.equal(USER_ACID_CODE, USER_ACID_EXACT);
  assert.match(USER_ACID_CODE, /setcpm\(168\/4\)/);
  assert.match(USER_ACID_CODE, /s\("bd\*4"\)\.bank\("RolandTR909"\)/);
  assert.match(USER_ACID_CODE, /sawtooth/);
  assert.ok(!/patternText|\.setCps|mono/.test(USER_ACID_CODE));
});
test('acid-only default steps are the original bassline; step 08 keeps its two sub-notes', () => {
  const phrase = USER_ACID_CODE.match(/note\("([^"]+)"\)\s*\.s\("sawtooth"\)/)?.[1];
  assert.equal(phrase, 'a1 a1 a2 a1 a1 a2 a1 [a1 a2] a1 a1 a2 a1 c2 a1 g1 a1');
  assert.equal(ACID_BASSLINE, phrase);
  const state = freshState();
  assert.equal(state.steps.length, 16);
  assert.ok(state.steps.every(step => step.on));
  assert.deepEqual(state.steps[7].notes, ['A1', 'A2']);
  assert.ok(state.steps.every((step, i) => step.notes.length === (i === 7 ? 2 : 1)));
  assert.equal(patternText(state), phrase);
});
test('acid-only playback has no WAV or sample-manifest dependency', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(USER_ACID_CODE, /bank\("RolandTR909"\)/);
  assert.ok(!/\b(?:loadSamples|samples)\s*\(/.test(main));
  assert.ok(!/samples\.json|\.wav/.test(acidCode(freshState())));
  assert.ok(!/\.bank\(|RolandTR909/.test(acidCode(freshState())));
});
test('fresh state starts at 168 BPM with the master level at 15%', () => {
  const state = freshState();
  assert.equal(state.bpm, 168);
  assert.equal(state.volume, 15);
  assert.equal(resonanceQ(state.resonance), 15);   // the original lpq(15)
});
test('Play resumes a suspended AudioContext before worklet/sample loading', async () => {
  const audio = { state: 'suspended', calls: 0, async resume() { this.calls++; this.state = 'running'; } };
  await resumeAudioContext(audio);
  assert.equal(audio.calls, 1);
  await resumeAudioContext(audio);
  assert.equal(audio.calls, 1);
});
test('Play refuses a context that remains suspended after resume', async () => {
  const audio = { state: 'suspended', async resume() {} };
  await assert.rejects(resumeAudioContext(audio), /Audio is suspended/);
});
test('LEVEL is a real master-gain level: state volume maps below unity and honors its limit', () => {
  const state = freshState();
  assert.equal(state.volume / 100, 0.15);          // the value PLAY arms the master gain with
  assert.equal(boundedValue('volume', 100, 0), 70); // the slider can never exceed the honest cap
  assert.equal(boundedValue('volume', 0, 0), 0);
});
const stepTokens = text => text.match(/\[[^\]]+\]|\S+/g);
test('pattern has exactly 16 safe steps; unknown notes become rests; muted steps rest', () => {
  const state = freshState();
  assert.equal(stepTokens(patternText(state)).length, 16);
  state.steps[0].notes[0] = 'invalid") code';
  assert.equal(stepTokens(patternText(state))[0], '~');
  state.steps[7].notes[0] = 'nope';
  assert.equal(stepTokens(patternText(state))[7], '[~ a2]');
  state.steps.forEach(step => step.on = false);
  assert.equal(patternText(state), Array(16).fill('~').join(' '));
});
test('acidCode is drum-free and carries the specified acid sound', () => {
  const code = acidCode(freshState());
  assert.ok(code.startsWith('setcpm(168/4)'));
  assert.ok(code.includes(`note("${ACID_BASSLINE}")`));
  for (const part of ['.s("sawtooth")', '.lpf(949)', '.lpq(15)', '.decay(0.1)', '.sustain(0)', '.shape(0.4)']) assert.ok(code.includes(part), part);
  assert.ok(!/bank\(|\bs\("(bd|cp|hh)|drums|stack\(|sine\.|sometimesBy/.test(code));   // no drums, no LFO, no random octaves
});
test('acidCode only ever emits bounded numbers and whitelisted notes', () => {
  const state = { ...freshState(), bpm: '9999', cutoff: 'x', resonance: -5 };
  state.steps[0].notes[0] = '"); evil(); ("';
  const code = acidCode(state);
  assert.ok(code.startsWith('setcpm(180/4)'));
  assert.ok(code.includes('.lpf(949)') && code.includes('.lpq(0)'));
  assert.ok(!code.includes('evil'));
  assert.ok(NOTES.every(n => n === n.toUpperCase()));
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
  const old = freshState(); old.steps[0].on = false; old.steps[7].notes[1] = 'C3';
  assert.equal(freshState().steps[0].on, true);
  assert.deepEqual(freshState().steps[7].notes, ['A1', 'A2']);
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

// --- Fail-closed master link (the SAME createMasterLink src/main.js uses) ---
// Behaviour tests over a fake Web Audio graph — no audio, no DOM needed.
function fakeGainParam() {
  return { value: 1, last: null, setTargetAtTime(v, t, tc) { this.last = { v, t, tc }; }, cancelScheduledValues() {} };
}
function fakeNode(name) {
  return {
    name, gain: fakeGainParam(), connections: [], connectedTo: [],
    disconnect() { this.connectedTo.length = 0; },
    connect(node) { this.connectedTo.push(node); },
  };
}
function makeContext({ failConnectToDestination = false } = {}) {
  return {
    currentTime: 100,
    destination: fakeNode('ctx.destination'),
    createGain() { const g = fakeNode('masterGain'); if (failConnectToDestination) g.connect = () => { throw new Error('connect to destination failed'); }; return g; },
  };
}
test('master link hookup failure is fail-closed: unlinked, silent, LEVEL inert; PLAY path refuses to evaluate', () => {
  const ctx = makeContext();
  const link = createMasterLink({ getController: () => undefined, getContext: () => ctx });
  assert.equal(link.linked, false);
  assert.equal(link.hookup(), false);
  assert.equal(link.linked, false);
  // mirrors main.js ensureMasterLink(): Play throws instead of evaluating
  assert.throws(() => { if (!link.hookup()) throw new Error('LEVEL has no path to the speakers (master audio link failed), so playback stays silent instead of running at uncontrolled volume. Try reloading the page.'); },
    /no path to the speakers/);
  link.setVolume(0.8);                     // LEVEL inert while unlinked
  assert.equal(link.volume, 0);
  assert.doesNotThrow(() => link.park());  // park stays safe while unlinked
});
test('master link partial reroute leaves NO direct loud bypass: tap redirected to a dead, parked gain', () => {
  const ctx = makeContext({ failConnectToDestination: true });
  const dg = fakeNode('strudel.destinationGain');
  const link = createMasterLink({ getController: () => ({ output: { destinationGain: dg } }), getContext: () => ctx });
  assert.equal(link.hookup(), false);
  assert.equal(link.linked, false);
  const masterGain = dg.connectedTo[0];    // its only neighbour is the parked gain
  assert.equal(masterGain.name, 'masterGain');
  assert.ok(dg.connectedTo.every(n => n.name !== 'ctx.destination'));  // never direct at full volume
  assert.equal(masterGain.connectedTo.length, 0);                      // chain end => silent
  link.setVolume(0.8); assert.equal(link.volume, 0);
});
test('master link parked by default: hookup starts at 0, guarded start arms 0.35, stop parks to 0', () => {
  const ctx = makeContext();
  const dg = fakeNode('strudel.destinationGain');
  const link = createMasterLink({ getController: () => ({ output: { destinationGain: dg } }), getContext: () => ctx });
  assert.equal(link.hookup(), true);
  assert.equal(link.linked, true);
  const masterGain = dg.connectedTo.at(-1);
  assert.ok(masterGain.connectedTo.includes(ctx.destination));         // dg -> masterGain -> destination
  assert.equal(masterGain.gain.value, 0);                              // parked, not 1
  link.setVolume(0.35);
  assert.equal(masterGain.gain.last.v, 0.35);                          // the real LEVEL of the whole stack
  assert.equal(masterGain.gain.last.tc, 0.02);
  link.park();
  assert.equal(masterGain.gain.last.v, 0);
});
// --- requireStarted: the SAME proof-of-start helper/path src/main.js gates
// with. @strudel/web 1.3.0 repl semantics: a FAILED evaluation is reported to
// onEvalError and RESOLVES undefined; only a real success returns the pattern.
test('requireStarted: a resolved pattern counts as started and is returned untouched', async () => {
  const pattern = { started: true };
  assert.equal(await requireStarted(() => Promise.resolve(pattern)), pattern);
});

test('requireStarted: an UNDEFINED resolution becomes the runtime\u2019s REPORTED error — the real captured error, rethrown', async () => {
  const boom = new Error('bd is not defined');
  await assert.rejects(
    requireStarted(() => Promise.resolve(undefined), () => boom),
    error => error === boom,                        // no invented message, no silent pass
  );
});

test('requireStarted: UNDEFINED with no reported error is an honest fallback, never a claimed start', async () => {
  await assert.rejects(
    requireStarted(() => Promise.resolve(undefined)),
    /cannot be claimed to have started/,
  );
});

test('requireStarted: a genuine evaluate rejection propagates UNCHANGED (identity preserved)', async () => {
  const boom = new Error('audio graph failed');
  await assert.rejects(
    requireStarted(() => Promise.reject(boom), () => new Error('not this one')),
    error => error === boom,
  );
});

// --- Play→Stop→Play race: the REAL Transport + REAL start gate paths ---------
// These tests run the actual shared logic main.js uses (Transport.play with an
// awaited async engine.start, and createStartGate's serialized, stale-checked
// evaluate queue) over the real createMasterLink — no copied snippets.

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function linkedLink() {
  const ctx = makeContext();
  const dg = fakeNode('strudel.destinationGain');
  const link = createMasterLink({ getController: () => ({ output: { destinationGain: dg } }), getContext: () => ctx });
  link.hookup();
  return { link, dg };
}

// An engine whose evaluate registers a manual resolver per call, so a test
// decides exactly when each (possibly stale) evaluate resolves or rejects.
function raceTransport(link, { onChange = () => {} } = {}) {
  let soundEpoch = 0;
  const hushes = [];              // every park+hush event, in order
  const resolvers = [];           // resolve A/B/... raw evaluate
  const rejecters = [];           // reject A/B/... raw evaluate
  const evaluateLog = [];         // run order of the evaluates (serialization proof)
  let reportedEvalError = null;   // the onEvalError sink, captured like main.js
  const gate = createStartGate({
    epoch: () => soundEpoch,
    // SAME validation helper/path as src/main.js: the raw evaluate is wrapped
    // in requireStarted, so a resolved UNDEFINED (1.3.0 repl failure shape)
    // becomes the reported runtime error or an honest fallback — only a
    // truthy resolution proves the start.
    evaluate: () => requireStarted(
      () => new Promise((resolve, reject) => {
        evaluateLog.push(resolvers.length + 1); // call id, in run order
        resolvers.push(resolve); rejecters.push(reject);
      }),
      () => reportedEvalError,
    ),
    onStale: () => { link.park(); hushes.push('stale'); },
    onArmed: () => link.setVolume(0.35),
  });
  const t = new Transport({
    unlock: async () => {},
    start: () => gate(soundEpoch),                 // capture at request time, like main.js
    stop: () => { soundEpoch++; link.park(); hushes.push('stop'); },
  }, onChange);
  return { t, stateEpoch: () => soundEpoch, hushes, resolvers, rejecters, evaluateLog, reportEvalError: e => { reportedEvalError = e; } };
}

test('REAL Transport + start gate: Stop racing a delayed start parks instead of arming; state stays stopped', async () => {
  const { link, dg } = linkedLink();
  const { t, hushes, resolvers, evaluateLog } = raceTransport(link);
  const pending = t.play();
  await flush();                                   // the evaluate is now in flight
  t.stop();                                        // Stop races the in-flight evaluate
  resolvers[0]();                                  // the raw A evaluate resolves undefined LATE (1.3.0 failure shape)
  await pending;
  await flush();                                   // the gate's stale cleanup ran
  // requireStarted turned the undefined resolution into a failure; the gate's
  // stale branch silenced it and swallowed it — the observable outcome is the
  // same honest stop, exactly like a resolving stale start used to be.
  assert.deepEqual(evaluateLog, [1]);
  assert.equal(t.state, 'stopped');
  assert.deepEqual(hushes, ['stop', 'stale']);     // stopped first, stale arm killed after
  const masterGain = dg.connectedTo.find(n => n.name === 'masterGain');
  assert.equal(masterGain.gain.last.v, 0);         // last ramp was the PARK, never an arm
  assert.equal(link.volume, 0);
});

test('Playback A → Stop → Playback B: the stale start resolves FIRST (serialized) and cannot silence B armed at 35%', async () => {
  const { link, dg } = linkedLink();
  const seen = [];
  const { t, hushes, resolvers, evaluateLog } = raceTransport(link, { onChange: v => seen.push(v) });

  const playA = t.play();
  await flush();                                   // A's evaluate is in flight
  assert.equal(t.state, 'starting');
  assert.deepEqual(evaluateLog, [1]);
  t.stop();                                        // user presses Stop during A's evaluate
  const playB = t.play();                          // B starts while A's evaluate is STILL in flight
  await flush();
  assert.equal(t.state, 'starting');
  assert.deepEqual(evaluateLog, [1]);              // SERIALIZED: B's evaluate has not begun
  resolvers[0]();                                  // A's raw evaluate resolves undefined late (stale → silenced + swallowed)
  await playA;                                     // A settles without changing the state
  await flush();
  assert.deepEqual(hushes, ['stop', 'stale']);     // A's own arm killed BEFORE B armed
  assert.deepEqual(evaluateLog, [1, 2]);           // only NOW does B's evaluate run
  assert.equal(t.state, 'starting');               // 'playing' must wait for the real start
  resolvers[1]('pattern');                         // B's raw evaluate resolves a REAL pattern
  await playB;
  assert.equal(t.state, 'playing');                // B SURVIVES the stale A
  assert.deepEqual(evaluateLog, [1, 2]);
  assert.deepEqual(hushes, ['stop', 'stale']);     // no late silencing after B armed
  assert.deepEqual(seen, ['starting', 'stopped', 'starting', 'playing']);
  const masterGain = dg.connectedTo.find(n => n.name === 'masterGain');
  assert.equal(masterGain.gain.last.v, 0.35);      // the LAST ramp is B's 35% arm, tc 0.02
  assert.equal(masterGain.gain.last.tc, 0.02);
});

test('Playback A → Stop → Playback B: a late REJECTING stale start is silenced and swallowed; B still plays at 35%', async () => {
  const { link, dg } = linkedLink();
  const seen = [];
  const { t, hushes, resolvers, rejecters, evaluateLog } = raceTransport(link, { onChange: v => seen.push(v) });

  const playA = t.play();
  await flush();
  t.stop();
  const playB = t.play();
  await flush();
  assert.deepEqual(evaluateLog, [1]);              // B waits on the serialized slot
  rejecters[0](new Error('stale engine failure')); // A's evaluate PARTIALLY scheduled voices, then rejects late
  await assert.doesNotReject(playA);               // stale rejection: swallowed at the gate, never stops B
  await flush();
  assert.deepEqual(hushes, ['stop', 'stale']);     // stale cleanup ran for the REJECTION too
  assert.deepEqual(evaluateLog, [1, 2]);           // and it ran BEFORE B's evaluate could begin
  assert.equal(t.state, 'starting');
  resolvers[1]('pattern');                         // B's raw evaluate resolves a REAL pattern
  await playB;
  assert.equal(t.state, 'playing');                // B keeps playing
  assert.deepEqual(seen, ['starting', 'stopped', 'starting', 'playing']); // no failure detour
  const masterGain = dg.connectedTo.find(n => n.name === 'masterGain');
  assert.equal(masterGain.gain.last.v, 0.35);      // B arms at 35% — last ramp after the stale cleanup
  assert.equal(masterGain.gain.last.tc, 0.02);
  const hushCount = hushes.length;                 // A's leftovers must stay dead: no hush AFTER B armed
  await flush();
  assert.equal(hushes.length, hushCount);
});

test('REAL Transport: a non-stale async start failure stops the transport and propagates the error', async () => {
  const stops = [];
  const t = new Transport({
    unlock: async () => {},
    start: async () => { throw new Error('evaluate failed'); },
    stop: () => stops.push('stop'),
  }, () => {});
  await assert.rejects(t.play(), /evaluate failed/);
  assert.equal(t.state, 'stopped');                // honest, retryable, error surfaced
  assert.deepEqual(stops, ['stop']);
});

test('REAL path: stale A whose evaluate RESOLVES UNDEFINED (runtime reported an error) is silenced and swallowed; B plays', async () => {
  const { link, dg } = linkedLink();
  const seen = [];
  const { t, hushes, resolvers, evaluateLog, reportEvalError } = raceTransport(link, { onChange: v => seen.push(v) });

  const playA = t.play();
  await flush();                                   // A's evaluate is in flight
  t.stop();                                        // user presses Stop during A's evaluate
  const playB = t.play();                          // B queues behind A on the serialized slot
  await flush();
  assert.deepEqual(evaluateLog, [1]);              // B's raw evaluate has not begun
  reportEvalError(new Error('eval error: nonsense is not defined')); // what onEvalError captured
  resolvers[0](undefined);                         // A resolves UNDEFINED while stale — repl failure shape
  await assert.doesNotReject(playA);               // requireStarted → failure → stale branch: silenced + swallowed
  await flush();
  assert.deepEqual(hushes, ['stop', 'stale']);     // A's (never-armed) start killed BEFORE B evaluated
  assert.deepEqual(evaluateLog, [1, 2]);           // only now does B's evaluate run
  assert.equal(t.state, 'starting');               // no failure detour through the transport
  resolvers[1]('pattern');                         // B resolves a REAL pattern (truthy)
  await playB;
  assert.equal(t.state, 'playing');                // B survives and plays
  assert.deepEqual(seen, ['starting', 'stopped', 'starting', 'playing']);
  const masterGain = dg.connectedTo.find(n => n.name === 'masterGain');
  assert.equal(masterGain.gain.last.v, 0.35);      // the LAST ramp is B's 35% arm, tc 0.02
  assert.equal(masterGain.gain.last.tc, 0.02);
});

test('REAL path: a NON-stale start whose evaluate resolves UNDEFINED stops the transport and surfaces the reported error', async () => {
  const { link } = linkedLink();
  const { t, hushes, resolvers, reportEvalError } = raceTransport(link);
  reportEvalError(new Error('eval error: setcpm is broken'));
  const pending = t.play();
  await flush();
  resolvers[0](undefined);                         // unresolved success was never proven: undefined + reported error
  await assert.rejects(pending, /setcpm is broken/); // the REAL error surfaces to play()'s catch
  assert.equal(t.state, 'stopped');                // honest stop, retryable
  assert.deepEqual(hushes, ['stop']);
});

// --- The PLAYED pattern, queried silently from the real Strudel runtime ----
// acidCode(state) is transpiled and evaluated by @strudel/transpiler and its
// events are read with queryArc — no scheduler, no AudioContext, no sound.
// Node resolves @kabelsalat/web to its CJS `main`; bundlers (Vite) use its ESM
// `module`, so this test-only hook points Node at the same ESM build.
const kabelsalatEsm = new URL('../node_modules/@kabelsalat/web/dist/index.mjs', import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => spec === '@kabelsalat/web' ? { url: kabelsalatEsm, shortCircuit: true } : next(spec, ctx) });
let strudel;
async function queryAcid(state, cycles = 1) {
  if (!strudel) {
    const core = await import('@strudel/core');
    const mini = await import('@strudel/mini');
    const { evaluate } = await import('@strudel/transpiler');
    strudel = { core, evaluate, cpm: [] };
    await core.evalScope(core, mini, { setcpm: cpm => { strudel.cpm.push(cpm); return core.silence; } });
  }
  strudel.cpm.length = 0;
  const { pattern } = await strudel.evaluate(acidCode(state));
  const haps = pattern.queryArc(0, cycles).filter(hap => hap.hasOnset());
  return { cpm: strudel.cpm.at(-1), haps: haps.map(h => ({ begin: h.whole.begin.valueOf(), end: h.whole.end.valueOf(), ...h.value })) };
}

test('Strudel events of the default state: the acid line, 168 BPM, step 08 split in two, no drums', async () => {
  const { cpm, haps } = await queryAcid(freshState());
  assert.equal(cpm, 42);                                          // 168/4 cycles per minute
  assert.equal(haps.length, 17);                                  // 15 single steps + 2 sub-notes
  assert.deepEqual(haps.map(h => h.note), ['a1', 'a1', 'a2', 'a1', 'a1', 'a2', 'a1', 'a1', 'a2', 'a1', 'a1', 'a2', 'a1', 'c2', 'a1', 'g1', 'a1']);
  assert.deepEqual([haps[7].begin, haps[7].end, haps[8].begin, haps[8].end], [7 / 16, 15 / 32, 15 / 32, 8 / 16]);
  for (const h of haps) {
    assert.equal(h.s, 'sawtooth');
    assert.equal(h.decay, 0.1); assert.equal(h.sustain, 0); assert.equal(h.shape, 0.4);
    assert.equal(h.cutoff, 949); assert.equal(h.resonance, 15);   // static: no LFO overriding CUTOFF
    assert.equal(h.bank, undefined);
  }
});

test('Strudel events follow UI edits: mute, note, sub-note, TEMPO, CUTOFF, RESONANCE', async () => {
  const state = freshState();
  state.steps[1].on = false;                 // mute step 02
  state.steps[3].notes[0] = 'C#2';           // re-note step 04
  state.steps[7].notes[1] = 'G1';            // edit step 08's second sub-note
  state.bpm = 140; state.cutoff = 100; state.resonance = 80;
  const { cpm, haps } = await queryAcid(state, 2);
  assert.equal(cpm, 35);
  assert.equal(haps.length, 32);             // 16 events per cycle, both cycles identical
  assert.ok(!haps.some(h => h.begin === 1 / 16 || h.begin === 1 + 1 / 16));
  assert.equal(haps.find(h => h.begin === 3 / 16).note, 'c#2');
  assert.deepEqual(haps.filter(h => h.begin >= 7 / 16 && h.begin < 8 / 16).map(h => h.note), ['a1', 'g1']);
  assert.ok(haps.every(h => h.cutoff === 6000 && h.resonance === 24));
});

// --- Live updates: shared serial queue with the start gate -------------------
test('live update: skipped when not playing (late update after Stop starts nothing)', async () => {
  const evaluated = [];
  const update = createLiveUpdate({ queue: createSerialQueue(), isLive: () => false, evaluate: async () => evaluated.push(1) });
  assert.equal(await update(), 'skipped');
  assert.deepEqual(evaluated, []);
});

test('live update: rapid edits coalesce into one re-evaluation; later edits queue one more', async () => {
  let release; const runs = [];
  const queue = createSerialQueue();
  queue(() => new Promise(r => release = r));         // something (a start) is still in flight
  const update = createLiveUpdate({ queue, isLive: () => true, evaluate: async () => runs.push('eval') });
  const a = update(), b = update(), c = update();
  assert.equal(a, b); assert.equal(b, c);              // one queued run for the burst
  await flush(); release(); assert.equal(await a, 'applied');
  assert.deepEqual(runs, ['eval']);
  await update(); assert.deepEqual(runs, ['eval', 'eval']);
});

test('live update never overlaps a start evaluate and is skipped when Stop lands before it runs', async () => {
  let soundEpoch = 0, live = false; const log = [];
  const queue = createSerialQueue();
  let finishStart;
  const gate = createStartGate({ queue, epoch: () => soundEpoch,
    evaluate: () => { log.push('start:begin'); return new Promise(r => finishStart = () => { log.push('start:end'); r('pattern'); }); },
    onStale: () => log.push('stale'), onArmed: () => { live = true; log.push('armed'); } });
  const update = createLiveUpdate({ queue, isLive: () => live, evaluate: async () => log.push('update') });
  const started = gate(soundEpoch);
  await flush();
  const pending = update();                            // edit while the start is in flight
  finishStart(); await started;
  assert.equal(await pending, 'applied');
  assert.deepEqual(log, ['start:begin', 'start:end', 'armed', 'update']);
  const late = update(); soundEpoch++; live = false;    // Stop right after the edit
  assert.equal(await late, 'skipped');
  assert.deepEqual(log.at(-1), 'update');              // no further evaluate
});

test('live update failure keeps playing and is reported only while still live', async () => {
  const errors = [];
  let live = true;
  const update = createLiveUpdate({ queue: createSerialQueue(), isLive: () => live,
    evaluate: async () => { live = false; throw new Error('bad edit'); }, onError: e => errors.push(e.message) });
  assert.equal(await update(), 'failed');
  assert.deepEqual(errors, []);                        // Stop landed during the evaluate: nothing surfaced
  live = true;
  const update2 = createLiveUpdate({ queue: createSerialQueue(), isLive: () => live,
    evaluate: async () => { throw new Error('bad edit'); }, onError: e => errors.push(e.message) });
  assert.equal(await update2(), 'failed');
  assert.deepEqual(errors, ['bad edit']);
});

// --- Static wiring checks of the shipped page (no DOM, no audio) ------------
test('main.js wiring: PLAY autostarts the generated code, live edits never autostart, no sample gate', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /lib\.evaluate\(acidCode\(state\), autostart\)/);
  assert.match(main, /evaluate: \(\) => evaluateState\(true\)/);
  assert.match(main, /evaluate: \(\) => evaluateState\(false\)/);
  assert.ok(!main.includes('lib.evaluate(USER_ACID_CODE'));
  assert.ok(!/lib\.samples\(|loadSamples\(/.test(main));          // drum samples are not a start condition
  assert.ok(!/\.disabled = true/.test(main));                       // no retired/decorative controls
});
test('index.html: TEMPO, CUTOFF, RESONANCE and LEVEL are enabled; LEVEL starts at 15%', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const id of ['bpm', 'cutoff', 'resonance', 'volume']) {
    const tag = html.match(new RegExp(`<input id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, id); assert.ok(!/\sdisabled/.test(tag), `${id} is enabled`);
  }
  assert.match(html, /<input id="volume"[^>]*value="15"/);
  assert.ok(!/fixed pattern|step editing is unavailable/i.test(html));
});

test('acid notes feed the same analyser read by the waveform display, including live edits', async () => {
  const state = freshState();
  for (const cutoff of [state.cutoff, 90]) {
    state.cutoff = cutoff;
    const { haps } = await queryAcid(state, 1);
    assert.ok(haps.length > 0);
    assert.ok(haps.every(h => h.analyze === 1), 'each sounding note must feed scope analyser 1');
  }
});
