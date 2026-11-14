// Geräusche, im Browser erzeugt (Web Audio): keine Tondateien, nur Rauschen und Schwingungen.
export type Sfx = 'march' | 'hooves' | 'motor' | 'tracks' | 'rifle' | 'tank' | 'artillery' | 'bomb' | 'order' | 'battle' | 'win' | 'lose' | 'alarm' | 'turn';

const KEY = 'feldzug_sound';
let ctx: AudioContext | null = null, out: GainNode | null = null, noiseBuf: AudioBuffer | null = null;
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* ohne Speicher bleibt der Ton an */ }
const last: Partial<Record<Sfx, number>> = {};

export const soundOn = () => on;
export function setSound(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* nur Komfort */ }
}

function audio(): AudioContext | null {
  if (!on) return null;
  try {
    if (!ctx) {
      ctx = new AudioContext();
      out = ctx.createGain();
      out.gain.value = 0.5;
      out.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Rauschen durch ein Filter: Schüsse, Schritte, Einschläge. */
function noise(c: AudioContext, t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1, freqEnd?: number) {
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf;
  src.loop = true;
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(out!);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}
/** Ton mit fallender oder steigender Höhe. */
function tone(c: AudioContext, t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1 = f0, attack = 0.005) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out!);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const boom = (c: AudioContext, t: number, vol: number, dur: number, f0 = 110) => {
  tone(c, t, dur, vol, 'sine', f0, 32);
  noise(c, t, dur * 0.8, vol * 0.7, 'lowpass', 900, 0.7, 120);
};
/** Laufender Motor: tiefer Sägezahn, dessen Lautstärke im Takt der Zylinder schwankt. */
function engine(c: AudioContext, t: number, dur: number, vol: number, freq: number, rattle: boolean) {
  const o = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(freq * 0.8, t);
  o.frequency.linearRampToValueAtTime(freq, t + dur * 0.3);
  lfo.frequency.value = freq / 4;
  depth.gain.value = vol * 0.5;
  f.type = 'lowpass';
  f.frequency.value = 420;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.12);
  g.gain.setValueAtTime(vol, t + dur - 0.25);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  lfo.connect(depth).connect(g.gain);
  o.connect(f).connect(g).connect(out!);
  o.start(t); lfo.start(t);
  o.stop(t + dur); lfo.stop(t + dur);
  // Kettenrasseln
  if (rattle) for (let x = 0.05; x < dur - 0.1; x += 0.07) noise(c, t + x, 0.04, vol * 0.35, 'bandpass', 2600, 3);
}

const PLAY: Record<Sfx, (c: AudioContext, t: number) => void> = {
  // Marschtritt: vier dumpfe Schritte
  march: (c, t) => { for (let i = 0; i < 4; i++) noise(c, t + i * 0.2, 0.09, 0.5, 'lowpass', 300 + (i % 2) * 60, 1); },
  // Hufgetrappel im Galopp: je drei rasche Schläge
  hooves: (c, t) => { for (let i = 0; i < 3; i++) for (const [o, f] of [[0, 900], [0.07, 1100], [0.14, 800]]) noise(c, t + i * 0.3 + o, 0.045, 0.45, 'bandpass', f, 4); },
  motor: (c, t) => engine(c, t, 1.0, 0.22, 95, false),
  tracks: (c, t) => engine(c, t, 1.2, 0.26, 62, true),
  // Gewehr- und MG-Feuer
  rifle: (c, t) => {
    for (const o of [0, 0.13, 0.31]) noise(c, t + o, 0.08, 0.5, 'highpass', 1800, 0.8);
    for (let i = 0; i < 6; i++) noise(c, t + 0.48 + i * 0.065, 0.05, 0.4, 'bandpass', 1400, 1.5);
  },
  // Panzerkanone: harter Abschuss, kurzer Nachhall
  tank: (c, t) => { noise(c, t, 0.06, 0.8, 'highpass', 900, 0.7); boom(c, t, 0.8, 0.45, 140); },
  // Artillerie: Abschuss in der Ferne, dann der Einschlag
  artillery: (c, t) => { boom(c, t, 0.45, 0.35, 90); boom(c, t + 0.55, 0.95, 0.9, 80); },
  // Bomben: fallendes Heulen, dann zwei Einschläge
  bomb: (c, t) => { tone(c, t, 0.7, 0.2, 'sine', 1500, 420, 0.05); boom(c, t + 0.7, 1, 0.9, 75); boom(c, t + 0.95, 0.8, 0.8, 65); },
  // Angriffsbefehl: zwei Trommelschläge
  order: (c, t) => { for (const o of [0, 0.16]) { tone(c, t + o, 0.14, 0.5, 'sine', 170, 90); noise(c, t + o, 0.07, 0.25, 'bandpass', 2400, 2); } },
  // ferner Gefechtslärm für automatisch entschiedene Schlachten
  battle: (c, t) => { PLAY.rifle(c, t); boom(c, t + 0.3, 0.6, 0.6, 85); boom(c, t + 0.75, 0.5, 0.7, 70); },
  win: (c, t) => [392, 494, 587].forEach((f, i) => tone(c, t + i * 0.13, 0.28, 0.22, 'triangle', f)),
  lose: (c, t) => [330, 262, 196].forEach((f, i) => tone(c, t + i * 0.16, 0.35, 0.22, 'triangle', f)),
  alarm: (c, t) => { for (const o of [0, 0.35]) tone(c, t + o, 0.3, 0.2, 'square', 520, 390, 0.02); },
  turn: (c, t) => tone(c, t, 0.12, 0.15, 'triangle', 660, 880),
};

/** Spielt ein Geräusch; dasselbe nicht öfter als alle 150 ms, damit Sammelbefehle nicht dröhnen. */
export function sfx(name: Sfx, delay = 0) {
  const c = audio();
  if (!c) return;
  const now = performance.now() + delay * 1000;
  if (now - (last[name] ?? -1e9) < 150) return;
  last[name] = now;
  try { PLAY[name](c, c.currentTime + delay + 0.01); } catch { /* Ton ist Beiwerk */ }
}
/** Geräusch der Bewegung nach Fortbewegungsart. */
export const moveSfx = (move: string): Sfx => (move === 'track' ? 'tracks' : move === 'wheel' ? 'motor' : move === 'horse' ? 'hooves' : 'march');
