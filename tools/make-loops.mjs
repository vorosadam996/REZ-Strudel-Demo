// SPDX-License-Identifier: AGPL-3.0-or-later
// Offline loop extraction for the recorded-loop player.
// Usage: node tools/make-loops.mjs <folder with the source WAVs>
// Reads the source recordings (never writes them) and writes 4-bar mono
// 16-bit WAV loops plus a manifest to public/loops/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BPM = 88; // Measured: a sharp beat-grid peak at 88.00 BPM in both recordings.
const BARS = 4;
const SEAM_MS = 10; // Tail-into-head crossfade so the loop wraps without a click.
const TARGET_RMS_DB = -20, PEAK_LIMIT = 0.891; // -1 dBFS.
// Start times are bar starts on the measured 88 BPM grid (downbeat position is an estimate).
const LOOPS = [
  { id: 'a1', recording: 'A', part: 1, file: 'track_m125.5 - Main - 20261024T060330.wav', startSec: 156.12 },
  { id: 'a2', recording: 'A', part: 2, file: 'track_m125.5 - Main - 20261024T060330.wav', startSec: 257.03 },
  { id: 'b1', recording: 'B', part: 1, file: 'track_m125.5 - Main - 20261024T061612.wav', startSec: 63.35 },
  { id: 'b2', recording: 'B', part: 2, file: 'track_m125.5 - Main - 20261024T061612.wav', startSec: 172.45 },
];

const sourceDir = process.argv[2];
if (!sourceDir) { console.error('Usage: node tools/make-loops.mjs <source folder>'); process.exit(1); }
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'loops');
mkdirSync(outDir, { recursive: true });

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let p = 12, fmt;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 24 || fmt.channels !== 2) throw new Error('Expected 24-bit stereo PCM');
      return { ...fmt, offset: p + 8, frames: Math.floor(size / 6) };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('No data chunk');
}

const s24 = (buf, o) => { let v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16); if (v & 0x800000) v |= ~0xffffff; return v / 8388608; };
function monoSlice(buf, wav, start, length) {
  if (start < 0 || start + length > wav.frames) throw new Error('Loop outside recording');
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) { const o = wav.offset + (start + i) * 6; out[i] = (s24(buf, o) + s24(buf, o + 3)) / 2; }
  return out;
}

function writeWav16(samples, rate) {
  const data = Buffer.alloc(samples.length * 2), header = Buffer.alloc(44);
  let seed = 1;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < samples.length; i++) {
    const dithered = samples[i] * 32767 + (rnd() - rnd()); // TPDF dither, deterministic.
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(dithered))), i * 2);
  }
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const sha256 = b => createHash('sha256').update(b).digest('hex');
const sources = new Map();
const manifest = { bpm: BPM, bars: BARS, beatsPerBar: 4, loops: [] };
for (const loop of LOOPS) {
  if (!sources.has(loop.file)) {
    const buf = readFileSync(join(sourceDir, loop.file));
    sources.set(loop.file, { buf, wav: readWav(buf), sha256: sha256(buf) });
  }
  const { buf, wav, sha256: sourceHash } = sources.get(loop.file);
  const length = Math.round(BARS * 4 * 60 / BPM * wav.rate), seam = Math.round(SEAM_MS / 1000 * wav.rate);
  const start = Math.round(loop.startSec * wav.rate);
  const raw = monoSlice(buf, wav, start, length + seam);
  const body = raw.slice(0, length);
  // Blend the audio that follows the loop end into the loop start (equal power).
  for (let i = 0; i < seam; i++) {
    const t = (i + 0.5) / seam;
    body[i] = body[i] * Math.sin(t * Math.PI / 2) + raw[length + i] * Math.cos(t * Math.PI / 2);
  }
  let sum = 0, peak = 0;
  for (const v of body) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
  const rms = Math.sqrt(sum / length);
  const gain = Math.min(10 ** (TARGET_RMS_DB / 20) / rms, PEAK_LIMIT / peak);
  for (let i = 0; i < length; i++) body[i] *= gain;
  // Seam check: the wrap step (last -> first sample) should match the source's own step
  // at the loop end; a large step there is a transient in the recording, not a click.
  const wav16 = writeWav16(body, wav.rate), name = `${loop.id}.wav`;
  writeFileSync(join(outDir, name), wav16);
  manifest.loops.push({
    id: loop.id, recording: loop.recording, part: loop.part, url: `loops/${name}`,
    source: loop.file, sourceSha256: sourceHash, startSample: start, lengthSamples: length, sampleRate: wav.rate,
    gainDb: +(20 * Math.log10(gain)).toFixed(2), peakDbfs: +(20 * Math.log10(peak * gain)).toFixed(2),
    wrapStep: +Math.abs(body[0] - body[length - 1]).toFixed(5), sourceStep: +(Math.abs(raw[length] - raw[length - 1]) * gain).toFixed(5),
    sha256: sha256(wav16),
  });
}
writeFileSync(join(outDir, 'loops.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.loops.map(({ id, startSample, lengthSamples, gainDb, peakDbfs, wrapStep, sourceStep }) => ({ id, startSample, lengthSamples, gainDb, peakDbfs, wrapStep, sourceStep }))));
