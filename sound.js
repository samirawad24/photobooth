// Synthesized sounds, so there are no audio files to load at the venue.

let ctx = null;

export function unlock() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

function noise(duration, { freq = 2000, q = 1, gain = 0.4, delay = 0 } = {}) {
  if (!ctx) return;
  const len = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

function tone(freq, duration, gain = 0.18) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + duration + 0.02);
}

export function beep() { tone(880, 0.16); }

export function shutter() {
  noise(0.025, { freq: 3500, q: 0.8, gain: 0.9 });
  noise(0.06, { freq: 1200, q: 1.2, gain: 0.6, delay: 0.045 });
}

export function tap() {
  noise(0.012, { freq: 4200, q: 3, gain: 0.25 });
}

export function chime() {
  tone(1046.5, 0.5, 0.12);
  setTimeout(() => tone(1568, 0.7, 0.09), 120);
}
