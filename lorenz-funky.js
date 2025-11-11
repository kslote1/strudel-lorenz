const avail = Object.keys(globalThis?.strudel?.sounds || {});
const pick = (cands) => cands.find(n => avail.includes(n)) || "sine";

const LEAD_SYNTH = pick(["tri", "pluck", "sine"]);
const PAD_SYNTH = pick(["saw", "pulse", "tri", "sine"]);

// --- Safety helpers ---------------------------------------------------------
const safeNum = (v, def=0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const safeArr = (arr, def=0) => (Array.isArray(arr) ? arr : [arr]).map(v => safeNum(v, def));
const clampArr = (arr, lo, hi) => safeArr(arr).map(v => Math.max(lo, Math.min(hi, v)));

// --- 1) Lorenz integrator (RK4) ---------------------------------------------
const lorenz = (steps = 4096, dt = 0.01, sigma = 10, rho = 28, beta = 8/3) => {
  let x = 1, y = 1, z = 1;
  const pts = [];
  const dx = (x, y) => sigma * (y - x);
  const dy = (x, y, z) => x * (rho - z) - y;
  const dz = (x, y, z) => x * y - beta * z;

  for (let i = 0; i < steps; i++) {
    const k1x = dx(x, y), k1y = dy(x, y, z), k1z = dz(x, y, z);
    const k2x = dx(x + 0.5*dt*k1x, y + 0.5*dt*k1y);
    const k2y = dy(x + 0.5*dt*k1x, y + 0.5*dt*k1y, z + 0.5*dt*k1z);
    const k2z = dz(x + 0.5*dt*k1x, y + 0.5*dt*k1y, z + 0.5*dt*k1z);
    const k3x = dx(x + 0.5*dt*k2x, y + 0.5*dt*k2y);
    const k3y = dy(x + 0.5*dt*k2x, y + 0.5*dt*k2y, z + 0.5*dt*k2z);
    const k3z = dz(x + 0.5*dt*k2x, y + 0.5*dt*k2y, z + 0.5*dt*k2z);
    const k4x = dx(x + dt*k3x, y + dt*k3y);
    const k4y = dy(x + dt*k3x, y + dt*k3y, z + dt*k3z);
    const k4z = dz(x + dt*k3x, y + dt*k3y, z + dt*k3z);

    x += (dt/6) * (k1x + 2*k2x + 2*k3x + k4x);
    y += (dt/6) * (k1y + 2*k2y + 2*k3y + k4y);
    z += (dt/6) * (k1z + 2*k2z + 2*k3z + k4z);

    pts.push({ x, y, z });
  }
  return pts;
};

const pts = lorenz(4096, 0.01);

// --- 2) Data Processing -----------------------------------------------------
const norm = arr => {
  const finite = arr.filter(v => isFinite(v));
  if (finite.length === 0) return arr.map(() => 0.5);
  const mn = Math.min(...finite);
  const mx = Math.max(...finite);
  if (mn === mx || !isFinite(mn) || !isFinite(mx)) return arr.map(() => 0.5); 
  return arr.map(v => {
    if (!isFinite(v)) return 0.5;
    const normalized = (v - mn) / (mx - mn);
    return isFinite(normalized) ? normalized : 0.5;
  });
};

const diff = (arr) => arr.map((v,i) => i ? v - arr[i-1] : 0);

// Normalized coordinates
const xs = norm(pts.map(p => p.x));
const ys = norm(pts.map(p => p.y));
const zs = norm(pts.map(p => p.z));

// Differences for velocity/energy
const dxs = diff(pts.map(p => p.x));
const dys = diff(pts.map(p => p.y));
const dzs = diff(pts.map(p => p.z));

// Speed/energy calculation
const rawSpd = pts.map((_, i) =>
    Math.sqrt(Math.pow(dxs[i] || 0, 2) + Math.pow(dys[i] || 0, 2) + Math.pow(dzs[i] || 0, 2))
);
const spd = norm(rawSpd);

// --- 3) Musical Mapping -----------------------------------------------------
// Use a minor pentatonic scale for more interesting melodies
// C minor pentatonic: C D# F G A# (relative to C)
const scale = [0, 3, 5, 7, 10]; // semitones
const octaves = [0, 12, 24, 36];

// Map X to scale degree (0-4), Y to octave (0-3), Z to expression
const scaleDegree = xs.map(v => Math.floor(v * scale.length));
const octave = ys.map(v => Math.floor(v * octaves.length));
const notes = scaleDegree.map((deg, i) => {
  const baseNote = 48; // C3
  const note = baseNote + octaves[octave[i]] + scale[deg];
  return note;
});

// Filter follows trajectory height (Z axis) with more range
const cut = zs.map(v => 300 + v * 8000);

// Pan follows X-Y plane rotation
const pan = xs.map((x, i) => {
  const angle = Math.atan2(ys[i] - 0.5, x - 0.5);
  return Math.sin(angle);
});

// Dynamic gain based on speed and position
const gain = spd.map((s, i) => {
  const base = 0.3 + 0.5 * s;
  const modulation = 0.1 * Math.sin(i * 0.05); // subtle pulsing
  return base + modulation;
});

// More varied percussion based on attractor regions
const kicks = spd.map((s, i) => {
  // Kick when entering high-speed regions
  return (s > 0.7 && (i % 4 === 0) && Math.random() < 0.8) ? "bd" : "~";
});

const snares = zs.map((z, i) => {
  // Snare on specific Z-plane crossings
  return (i > 0 && Math.abs(z - 0.5) < 0.1 && i % 3 === 0 && Math.random() < 0.4) ? "sd" : "~";
});

const hats = xs.map((x, i) => {
  // Hi-hats follow X dimension with varying probability
  return (i % 2 === 0 && x > 0.6 && Math.random() < 0.6) ? "hh" : "~";
});

// --- 4) Safe arrays ---------------------------------------------------------
const NOTES_SAFE = clampArr(notes, 36, 96);
const CUT_SAFE   = clampArr(cut, 100, 12000);
const PAN_SAFE   = clampArr(pan, -1, 1);
const GAIN_SAFE  = clampArr(gain, 0.1, 0.9);

// --- 5) Strudel Playback ----------------------------------------------------
setcps(1.2);

// Main Lorenz melody - slower to appreciate the pattern
note(NOTES_SAFE)
  .s(LEAD_SYNTH)
  .attack(0.01)
  .decay(0.1)
  .sustain(0.7)
  .release(0.3)
  .cutoff(CUT_SAFE)
  .resonance(5)
  .pan(PAN_SAFE)
  .gain(GAIN_SAFE)
  .room(0.3)
  .size(0.5)
  .fast(1);

// Percussion layer
stack(
  s(kicks).gain(1.2).lpf(200),
  s(snares).gain(0.9).delay(0.015).hpf(800),
  s(hats).gain(0.4).speed(1.5).hpf(5000)
).room(0.2).size(0.3);

// Ambient pad following slower trajectory
const padNotes = notes.filter((_, i) => i % 16 === 0);
const padCut = cut.filter((_, i) => i % 16 === 0);
const PAD_NOTES_SAFE = clampArr(padNotes, 36, 84);
const PAD_CUT_SAFE = clampArr(padCut, 200, 3000);

note(PAD_NOTES_SAFE)
  .s(PAD_SYNTH)
  .legato(4)
  .cutoff(PAD_CUT_SAFE)
  .gain(0.2)
  .room(0.8)
  .size(0.9)
  .slow(4);
