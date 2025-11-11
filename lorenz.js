const avail = Object.keys(globalThis?.strudel?.sounds || {});
// Use "sine" as the reliable fallback if "tri", "square", or "saw" cause issues
const pick = (cands) => cands.find(n => avail.includes(n)) || "sine";

const LEAD_SYNTH = pick(["tri", "pluck", "sine"]);
const PAD_SYNTH = pick(["saw", "pulse", "tri", "sine"]);

// --- Safety helper to ensure finite values --------------------------------
const ensureFinite = (arr, defaultVal = 0.5) => {
  if (!Array.isArray(arr)) return [defaultVal];
  return arr.map(v => {
    if (Array.isArray(v)) {
      return v.map(x => (isFinite(x) ? x : defaultVal));
    }
    return (isFinite(v) ? v : defaultVal);
  });
};

const clamp = (val, min, max) => {
  const v = isFinite(val) ? val : (min + max) / 2;
  return Math.max(min, Math.min(max, v));
};

// --- 1) Lorenz integrator (RK4) - optimized --------------------------------
const lorenz = (steps = 1536, dt = 0.01, sigma = 10, rho = 28, beta = 8/3) => {
  let x = 1, y = 1, z = 1;
  const pts = [];
  // Define derivative functions OUTSIDE the loop for efficiency
  const dx = (x, y) => sigma * (y - x);
  const dy = (x, y, z) => x * (rho - z) - y;
  const dz = (x, y, z) => x * y - beta * z;

  for (let i = 0; i < steps; i++) {
    // k1 is calculated from (x, y, z)
    const k1x = dx(x, y), k1y = dy(x, y, z), k1z = dz(x, y, z);
    
    // k2 is calculated from the half-step prediction
    const k2x = dx(x + 0.5*dt*k1x, y + 0.5*dt*k1y);
    const k2y = dy(x + 0.5*dt*k1x, y + 0.5*dt*k1y, z + 0.5*dt*k1z);
    const k2z = dz(x + 0.5*dt*k1x, y + 0.5*dt*k1y, z + 0.5*dt*k1z);

    // k3 is calculated from another half-step prediction
    const k3x = dx(x + 0.5*dt*k2x, y + 0.5*dt*k2y);
    const k3y = dy(x + 0.5*dt*k2x, y + 0.5*dt*k2y, z + 0.5*dt*k2z);
    const k3z = dz(x + 0.5*dt*k2x, y + 0.5*dt*k2y, z + 0.5*dt*k2z);

    // k4 is calculated from the full-step prediction
    const k4x = dx(x + dt*k3x, y + dt*k3y);
    const k4y = dy(x + dt*k3x, y + dt*k3y, z + dt*k3z);
    const k4z = dz(x + dt*k3x, y + dt*k3y, z + dt*k3z);

    // Update coordinates
    x += (dt/6) * (k1x + 2*k2x + 2*k3x + k4x);
    y += (dt/6) * (k1y + 2*k2y + 2*k3y + k4y);
    z += (dt/6) * (k1z + 2*k2z + 2*k3z + k4z);

    pts.push({ x, y, z });
  }
  return pts;
};

const pts = lorenz(1536, 0.01);

// --- 2) Data Processing (Revised) -------------------------------------------
// helpers (norm is already robust)
const norm = arr => {
  const finite = arr.filter(v => isFinite(v));
  if (finite.length === 0) return arr.map(() => 0.5);
  
  const mn = Math.min(...finite);
  const mx = Math.max(...finite);
  
  if (mn === mx || !isFinite(mn) || !isFinite(mx)) {
    return arr.map(() => 0.5); 
  }
  return arr.map(v => {
    if (!isFinite(v)) return 0.5;
    const normalized = (v - mn) / (mx - mn);
    return isFinite(normalized) ? normalized : 0.5;
  });
};

// diff returns an array of length N, where the first element is 0
const diff = (arr) => arr.map((v,i) => i ? v - arr[i-1] : 0);

// pre-calculate all difference arrays
const dxs = diff(pts.map(p => p.x));
const dys = diff(pts.map(p => p.y));
const dzs = diff(pts.map(p => p.z));

// normalized coords
const xs = norm(pts.map(p => p.x));
const ys = norm(pts.map(p => p.y));
const zs = norm(pts.map(p => p.z));

// maps (MIDI, Filter Cutoff, Pan, Gain) - all with safety checks
const midiBase = 60;
const span = 24;
const notes = xs.map(v => clamp(Math.round(midiBase + v * span), 36, 96));
const cut   = ys.map(v => clamp(200 + v * 5000, 200, 8000));
const pan   = zs.map(v => clamp(v * 2 - 1, -1, 1));

// **REVISED spd CALCULATION with safety**
const rawSpd = pts.map((_, i) =>
    Math.sqrt(
        Math.pow(dxs[i] || 0, 2) +
        Math.pow(dys[i] || 0, 2) +
        Math.pow(dzs[i] || 0, 2)
    )
);

const spd = norm(rawSpd);
const gain  = spd.map(v => clamp(0.2 + 0.6 * v, 0.1, 1.0));

// percussion events (using dxs instead of cross and diff(xs))
const cross = dxs.map(d => isFinite(d) ? Math.sign(d) : 0);
const crossings = cross.map((v,i) => (i>0 && v !== cross[i-1]) ? 1 : 0);
const kicks  = crossings.map(c => (c && Math.random() < 0.6) ? "bd" : "~");
const snares = spd.map(v => (v < 0.15 && Math.random() < 0.25) ? "sd" : "~");
const hats   = zs.map(v => (v > 0.7 && Math.random() < 0.5) ? "hh" : "~");

// --- 3) Strudel Playback ----------------------------------------------------
setcps(0.9);

// --- Final safety net -------------------------------------------------------
const safeNum = (v, def=0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};
const safeArr = (arr, def=0) => (Array.isArray(arr) ? arr : [arr]).map(v => safeNum(v, def));
const clampArr = (arr, lo, hi) => safeArr(arr).map(v => Math.max(lo, Math.min(hi, v)));

// Build sanitized, clamped patterns for audio params
const NOTES_SAFE = clampArr(notes, 36, 96);
const CUT_SAFE   = clampArr(ys.map(v => 200 + v * 5000), 20, 12000); // widen safe range a bit
const PAN_SAFE   = clampArr(zs.map(v => v * 2 - 1), -1, 1);
const SPD_SAFE   = safeArr(spd, 0.0);
const GAIN_SAFE  = clampArr(SPD_SAFE.map(v => 0.2 + 0.6 * v), 0.0, 1.0);

// --- Playback (sanitized) ---------------------------------------------------
setcps(0.9);

// Layer 1: Lorenz melody (all params safe)
note(NOTES_SAFE)
  .s(LEAD_SYNTH)
  .attack(0.005)
  .release(0.25)
  .cutoff(CUT_SAFE)
  .pan(PAN_SAFE)
  .gain(GAIN_SAFE)
  .fast(2);

// Layer 2: Percussion (strings are fine; keep numeric params finite)
stack(
  s(kicks).gain(1.0),
  s(snares).gain(0.8).delay(0.01),
  s(hats).gain(0.5).speed(2)       // constant 2 is finite
).room(0.15).size(0.2);

// Optional chord wash — avoid array-of-arrays; use 3 mono voices instead
const roots = notes.filter((_, i) => i % 8 === 0).map(n => clamp(n, 36, 84));
const thirds = roots.map(r => clamp(r + 4, 36, 96));
const fifths = roots.map(r => clamp(r + 7, 36, 96));

const ROOTS_SAFE  = clampArr(roots, 36, 96);
const THIRDS_SAFE = clampArr(thirds, 36, 96);
const FIFTHS_SAFE = clampArr(fifths, 36, 96);

stack(
  note(ROOTS_SAFE).s(PAD_SYNTH).legato(2.5).cutoff(1200).gain(0.05).slow(2),
  note(THIRDS_SAFE).s(PAD_SYNTH).legato(2.5).cutoff(1200).gain(0.05).slow(2),
  note(FIFTHS_SAFE).s(PAD_SYNTH).legato(2.5).cutoff(1200).gain(0.05).slow(2)
);
