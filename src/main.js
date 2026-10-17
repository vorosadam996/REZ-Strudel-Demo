// SPDX-License-Identifier: AGPL-3.0-or-later
import './style.css';
import { NOTES, freshState, boundedValue, cutoffHz, patternText, Transport } from './state.js';

const $ = id => document.getElementById(id);
let state = freshState();
let lib, scheduler, audio, transport, ready = false;
let events = 0, maxPeak = 0, activeStep = -1, frame = 0;
const stepNodes = [];

function fail(error) {
  transport?.stop();
  $('error').hidden = false;
  $('error').textContent = `Audio could not continue. ${error?.message ?? 'Please reload and try again.'}`;
  $('status').textContent = 'Audio unavailable — see message below.';
  console.error('[REZ demo]', error);
}

function updateSound() {
  if (!ready) return;
  scheduler.setCps(state.bpm / 240); // One 16-step pattern = four beats.
  const pattern = lib.controls.note(patternText(state)).s('sawtooth')
    .attack(0.006).decay(0.09).sustain(0.1).release(0.065)
    .lpf(cutoffHz(state.cutoff)).lpq(0.6 + state.resonance * 0.055)
    .gain(state.volume / 100 * 0.32).analyze(1);
  scheduler.setPattern(pattern);
}

function controls() {
  for (const key of ['bpm', 'cutoff', 'resonance', 'volume']) $(key).value = state[key];
  const hz = cutoffHz(state.cutoff);
  $('cutoff-value').value = hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`;
  $('resonance-value').value = `${state.resonance}%`;
  $('volume-value').value = `${state.volume}%`;
}

function drawSteps() {
  $('steps').replaceChildren(); stepNodes.length = 0;
  state.steps.forEach((step, i) => {
    const cell = document.createElement('div'); cell.className = 'step';
    const button = document.createElement('button');
    button.className = 'step-button';
    button.setAttribute('aria-label', `Step ${i + 1}`);
    button.setAttribute('aria-pressed', String(step.on));
    button.innerHTML = `<span class="step-number">${String(i + 1).padStart(2, '0')}</span><span class="step-light"></span><span class="step-mark">${step.on ? '●' : '—'}</span>`;
    button.addEventListener('click', () => {
      step.on = !step.on; button.setAttribute('aria-pressed', String(step.on));
      button.querySelector('.step-mark').textContent = step.on ? '●' : '—'; updateSound();
    });
    const select = document.createElement('select'); select.setAttribute('aria-label', `Note for step ${i + 1}`);
    for (const note of NOTES) { const option = document.createElement('option'); option.value = note; option.textContent = note; select.append(option); }
    select.value = step.note;
    select.addEventListener('change', () => { step.note = select.value; updateSound(); });
    cell.append(button, select); $('steps').append(cell); stepNodes.push(cell);
  });
}

function changeTransport(value) {
  const playing = value === 'playing';
  $('play').disabled = !ready || value !== 'stopped';
  $('stop').disabled = !ready || value === 'stopped';
  $('live-dot').classList.toggle('lit', playing);
  $('status').textContent = playing ? 'Playing — make it yours.' : value === 'starting' ? 'Opening audio…' : 'Ready when you are.';
  if (!playing) {
    activeStep = -1; stepNodes.forEach(node => node.classList.remove('current'));
  }
}

function animate() {
  const canvas = $('scope'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const playing = transport?.state === 'playing';
  const data = lib?.getAnalyzerData();
  let peak = 0;
  ctx.lineWidth = 1.4; ctx.strokeStyle = playing ? '#d5ff70' : '#50594b'; ctx.beginPath();
  for (let x = 0; x < canvas.width; x++) {
    const sample = data?.[Math.floor(x / canvas.width * data.length)] ?? 0;
    peak = Math.max(peak, Math.abs(sample));
    const y = canvas.height / 2 - sample * canvas.height * 1.4;
    x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke(); maxPeak = Math.max(maxPeak, peak);
  if (playing) {
    const cycle = scheduler.now() - scheduler.latency * scheduler.cps;
    const step = cycle >= 0 ? Math.floor(((cycle % 1) + 1) % 1 * 16) : -1;
    if (step !== activeStep) { stepNodes.forEach((node, i) => node.classList.toggle('current', i === step)); activeStep = step; }
  }
  if (frame++ % 15 === 0) $('diagnostics').textContent = `Audio: ${audio?.state ?? 'not started'} · Transport: ${transport?.state ?? 'loading'} · Notes scheduled: ${events} · Peak now: ${peak.toFixed(4)} · Peak max: ${maxPeak.toFixed(4)}`;
  requestAnimationFrame(animate);
}

for (const key of ['cutoff', 'resonance', 'volume']) {
  $(key).addEventListener('input', () => { state[key] = boundedValue(key, $(key).value, state[key]); controls(); updateSound(); });
}
$('bpm').addEventListener('change', () => { state.bpm = boundedValue('bpm', $('bpm').value, state.bpm); controls(); updateSound(); });
$('play').addEventListener('click', () => { $('error').hidden = true; transport?.play().catch(fail); });
$('stop').addEventListener('click', () => transport?.stop());
$('reset').addEventListener('click', () => { transport?.stop(); state = freshState(); controls(); drawSteps(); updateSound(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) transport?.stop(); });
window.addEventListener('pagehide', () => transport?.stop());
drawSteps(); controls(); animate();

async function load() {
  if (!('AudioContext' in window)) throw new Error('This browser does not support Web Audio. Try a current browser.');
  lib = await import('@strudel/web');
  lib.miniAllStrings();
  await lib.registerSynthSounds();
  scheduler = lib.webaudioScheduler({
    latency: 0.06,
    defaultOutput: (hap, deadline, duration) => {
      events++;
      lib.webaudioOutput(hap, deadline, duration)?.catch(fail);
    },
    onError: fail,
  });
  transport = new Transport({
    unlock: async () => {
      audio = lib.getAudioContext();
      await lib.initAudio({ disableWorklets: true }); // This small synth uses only standard Web Audio nodes.
      if (audio.state !== 'running') throw new Error('Audio is suspended. Tap Play again.');
    },
    start: () => {
      // A fresh output ensures the previous panic fade cannot leak into the next playback.
      lib.initializeAudioOutput();
      updateSound(); scheduler.start();
    },
    stop: () => { scheduler.stop(); if (audio) lib.panic(); },
  }, changeTransport);
  ready = true; updateSound(); changeTransport('stopped');
}
load().catch(fail);
