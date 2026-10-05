// Original 29s music bed (A minor, 96 BPM), synthesised so there is nothing to license.
// Intro = dark pad; from 5s (the logo) a pluck arpeggio, bass and soft hats come in; last chord rings out.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SR = 44100, DUR = 29, BEAT = 60 / 96, EIGHTH = BEAT / 2, TAU = Math.PI * 2;
const n = SR * DUR;
const L = new Float32Array(n), R = new Float32Array(n);
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const CHORDS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62], [53, 57, 60], [57, 60, 64]]; // Am F C G F Am
const CH = 8 * BEAT; // 5s per chord
const clamp = (x) => Math.max(0, Math.min(1, x));
const add = (i, v, pan = 0.5) => { L[i] += v * (1 - pan) * 1.4; R[i] += v * pan * 1.4; };

// pad: detuned sines + a little 2nd harmonic, overlapping chord crossfades
CHORDS.forEach((notes, c) => {
  const t0 = c * CH - 0.5, t1 = (c + 1) * CH + 0.5;
  for (let i = Math.max(0, Math.floor(t0 * SR)); i < Math.min(n, Math.floor(t1 * SR)); i++) {
    const t = i / SR;
    const w = clamp((t - t0) / 1.0) * clamp((t1 - t) / 1.0);
    let s = 0;
    for (const m of notes) {
      const f = hz(m);
      s += Math.sin(TAU * f * t) + Math.sin(TAU * f * 1.004 * t + 1) * 0.7 + 0.25 * Math.sin(TAU * f * 2 * t);
    }
    const v = s * w * 0.035;
    L[i] += v; R[i] += v;
  }
});

// pluck arpeggio, bass, hats
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const ARP = [0, 1, 2, 3, 2, 1, 2, 1];
const ARP_FROM = 5, ARP_TO = 26.5;
for (let step = 0; step * EIGHTH < DUR; step++) {
  const t0 = step * EIGHTH;
  if (t0 < ARP_FROM || t0 > ARP_TO) continue;
  const chord = CHORDS[Math.min(CHORDS.length - 1, Math.floor(t0 / CH))];
  const tones = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24];
  const f = hz(tones[ARP[step % ARP.length]]);
  const pan = step % 2 ? 0.65 : 0.35;
  const lvl = t0 < 7 ? 0.5 : 1;
  for (let k = 0, len = Math.floor(0.55 * SR); k < len && t0 * SR + k < n; k++) {
    const tau = k / SR, i = Math.floor(t0 * SR) + k;
    const env = clamp(tau / 0.004) * Math.exp(-7 * tau);
    add(i, (Math.sin(TAU * f * tau) + 0.35 * Math.sin(TAU * f * 2 * tau)) * env * 0.11 * lvl, pan);
  }
  if (step % 2 === 1) { // off-beat hat
    for (let k = 0, len = Math.floor(0.05 * SR); k < len && t0 * SR + k < n; k++) {
      const i = Math.floor(t0 * SR) + k;
      add(i, rnd() * Math.exp(-70 * (k / SR)) * 0.03, 0.55);
    }
  }
}
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT;
  if (t0 < ARP_FROM || t0 > ARP_TO + 1) continue;
  const f = hz(CHORDS[Math.min(CHORDS.length - 1, Math.floor(t0 / CH))][0] - 12);
  for (let k = 0, len = Math.floor(0.5 * SR); k < len && t0 * SR + k < n; k++) {
    const tau = k / SR, i = Math.floor(t0 * SR) + k;
    add(i, Math.sin(TAU * f * tau) * clamp(tau / 0.01) * Math.exp(-5 * tau) * 0.22, 0.5);
  }
}

// 16-bit WAV
const buf = Buffer.alloc(44 + n * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  buf.writeInt16LE(Math.round(Math.tanh(L[i]) * 32000), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.tanh(R[i]) * 32000), 46 + i * 4);
}
fs.writeFileSync('/tmp/gpvid/bgm.wav', buf);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', '/tmp/gpvid/bgm.wav',
  '-af', 'aecho=0.8:0.55:90|210:0.25|0.15,loudnorm=I=-19:TP=-2,afade=t=in:d=1.2,afade=t=out:st=26.5:d=2.5',
  '-t', '29', '-ar', '44100', '-b:a', '192k', process.argv[2]]);
console.log('wrote', process.argv[2]);
