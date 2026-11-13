import * as THREE from "three";

const ACID = 0xc8ff16;
const BOOST = 0x6ff9ff;
const HALF_WIDTH = 4.6;
const RUNOFF = 2.6;
const EDGE = HALF_WIDTH + RUNOFF;
const RIBBON = 3600;

export const GRAVITY = 22;

// A 1.7 km technical circuit: a long main straight, a fast right-hand
// descent, a deep southern spur, an infield hairpin, a second spur and a
// sweeping return. The control polygon is rounded with three Chaikin passes
// so every corner stays drivable (~6.4 unit minimum radius) and the ribbon
// never folds back on itself.
const BASE: Array<[number, number]> = [
  [-160, 0], [-120, 0], [-80, 0], [-40, 0], [0, 0], [40, 0], [80, 0], [115, 0],
  [140, -6], [158, -20], [166, -42],
  [170, -70], [172, -98], [166, -126], [152, -148],
  [130, -166], [142, -186],
  [150, -210], [152, -240], [150, -270], [144, -298],
  [132, -314], [114, -320], [100, -308],
  [104, -280], [108, -252], [110, -226], [112, -206], [114, -192],
  [96, -186], [84, -190], [62, -176],
  [50, -160], [46, -140], [50, -120], [52, -100], [48, -80], [40, -66],
  [28, -56], [18, -60], [14, -74], [16, -92],
  [18, -110], [22, -128], [18, -146], [12, -160],
  [-8, -172], [-32, -176],
  [-52, -192], [-62, -216], [-68, -244], [-70, -272], [-72, -300],
  [-84, -320], [-104, -326], [-124, -318],
  [-138, -298], [-146, -274], [-148, -248], [-152, -222], [-158, -200], [-164, -184],
  [-180, -176], [-192, -160], [-202, -140],
  [-212, -118], [-220, -92], [-222, -64], [-218, -40], [-210, -22], [-202, -8], [-194, 0], [-180, 0],
];

// Placed on the measured straights (fractions of lap distance) so every
// take-off and landing happens with the wheels pointing straight.
const RAMPS = [
  { at: 0.073, run: 30, lift: 3.4, drop: 1.8, land: 64, label: "MEGA RAMP" },
  { at: 0.681, run: 20, lift: 2.1, drop: 1.0, land: 36, label: "KICKER" },
];
const HOPS = [
  { at: 0.791, span: 20, lift: 1.2 },
  { at: 0.8035, span: 20, lift: 1.2 },
];
const BOOSTS = [0.05, 0.306, 0.394, 0.6705, 0.873];
const BOOST_LENGTH = 14;
const BOOST_HALF = 1.8;

const V_TOP = 78;
const LATERAL_GRIP = 40;
const BRAKE_DECEL = 30;
const DRIVE_ACCEL = 14;

function chaikin(points: Array<[number, number]>, passes: number): Array<[number, number]> {
  let p = points;
  for (let pass = 0; pass < passes; pass++) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = out;
  }
  return p;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Circular moving average; the circuit is a loop so the window wraps.
function ringSmooth(src: Float32Array, radius: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  let acc = 0;
  for (let j = -radius; j <= radius; j++) acc += src[(j + n) % n];
  const span = radius * 2 + 1;
  for (let i = 0; i < n; i++) {
    out[i] = acc / span;
    acc += src[(i + radius + 1) % n] - src[(i - radius + n) % n];
  }
  return out;
}

export type FeatureKind = "ramp" | "hop" | "boost";

export type TrackFeature = {
  kind: FeatureKind;
  label: string;
  start: number;
  lip: number;
  end: number;
  x: number;
  z: number;
};

export type TrackCorner = {
  id: number;
  label: string;
  dir: "L" | "R";
  brake: number;
  entry: number;
  apex: number;
  exit: number;
  kmh: number;
  entryKmh: number;
};

/** 0 = push, 1 = lift / carry speed, 2 = brake. */
export type AssistMode = 0 | 1 | 2;

export type CircuitPlan = {
  count: number;
  length: number;
  step: number;
  xs: Float32Array;
  zs: Float32Array;
  nx: Float32Array;
  nz: Float32Array;
  heading: Float32Array;
  curvature: Float32Array;
  height: Float32Array;
  bank: Float32Array;
  line: Float32Array;
  target: Float32Array;
  mode: Uint8Array;
  boostAt: Uint8Array;
  features: TrackFeature[];
  corners: TrackCorner[];
};

let cachedPlan: CircuitPlan | null = null;

export function planCircuit(): CircuitPlan {
  if (cachedPlan) return cachedPlan;
  const control = chaikin(BASE, 3).map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(control, true, "centripetal");
  curve.arcLengthDivisions = 6000;
  curve.updateArcLengths();
  const n = RIBBON;
  const length = curve.getLength();
  const step = length / n;
  const idxAt = (s: number) => ((Math.round(s / step) % n) + n) % n;

  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const nx = new Float32Array(n);
  const nz = new Float32Array(n);
  const heading = new Float32Array(n);
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    curve.getPointAt(i / n, p);
    curve.getTangentAt(i / n, tan);
    const len = Math.hypot(tan.x, tan.z) || 1;
    xs[i] = p.x;
    zs[i] = p.z;
    nx[i] = -tan.z / len;
    nz[i] = tan.x / len;
    heading[i] = Math.atan2(tan.x, tan.z);
  }

  // Signed curvature: positive means the heading increases, i.e. a left-hander.
  const rawK = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    rawK[i] = wrapAngle(heading[(i + 1) % n] - heading[(i - 1 + n) % n]) / (2 * step);
  }
  const curvature = ringSmooth(ringSmooth(rawK, 12), 12);

  // Banking leans every corner into itself; the outside edge (+n for a
  // left-hander) sits higher.
  const bankRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) bankRaw[i] = clamp(curvature[i] * 1.8, -0.2, 0.2);
  const bank = ringSmooth(bankRaw, 20);

  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const win = smoothstep(s / 80) * smoothstep((length - s) / 60);
    let h = win * (
      1.4 * (1 - Math.cos((Math.PI * 2 * 3 * s) / length + 0.6)) +
      0.6 * (1 - Math.cos((Math.PI * 2 * 7 * s) / length + 2.1))
    );
    for (const ramp of RAMPS) {
      const u = s - ramp.at * length;
      if (u < 0) continue;
      if (u < ramp.run) {
        h += ramp.lift * Math.pow(u / ramp.run, 1.7);
      } else if (u < ramp.run + ramp.land) {
        const k = (u - ramp.run) / ramp.land;
        h += ramp.drop * 0.5 * (1 + Math.cos(Math.PI * k));
      }
    }
    for (const hop of HOPS) {
      const u = s - hop.at * length;
      if (u >= 0 && u < hop.span) {
        h += hop.lift * 0.5 * (1 - Math.cos((Math.PI * 2 * u) / hop.span));
      }
    }
    // Lift banked sections so their low edge never dips under the ground.
    h += Math.abs(bank[i]) * EDGE;
    height[i] = h;
  }

  const features: TrackFeature[] = [];
  const boostAt = new Uint8Array(n);
  for (const ramp of RAMPS) {
    const s0 = ramp.at * length;
    const lip = idxAt(s0 + ramp.run);
    features.push({
      kind: "ramp",
      label: ramp.label,
      start: idxAt(s0),
      lip,
      end: idxAt(s0 + ramp.run + ramp.land),
      x: xs[lip],
      z: zs[lip],
    });
  }
  for (let h = 0; h < HOPS.length; h++) {
    const hop = HOPS[h];
    const s0 = hop.at * length;
    const mid = idxAt(s0 + hop.span / 2);
    features.push({
      kind: "hop",
      label: h === 0 ? "DOUBLE HOP" : "HOP",
      start: idxAt(s0),
      lip: mid,
      end: idxAt(s0 + hop.span),
      x: xs[mid],
      z: zs[mid],
    });
  }
  for (const at of BOOSTS) {
    const s0 = at * length;
    const start = idxAt(s0);
    const end = idxAt(s0 + BOOST_LENGTH);
    for (let i = start; i !== end; i = (i + 1) % n) boostAt[i] = 1;
    features.push({ kind: "boost", label: "BOOST PAD", start, lip: start, end, x: xs[start], z: zs[start] });
  }
  features.sort((a, b) => a.start - b.start);

  // Suggested racing line: a difference of a tight and a wide curvature
  // average puts the car outside on entry, on the apex mid-corner and back
  // out on exit.
  const near = ringSmooth(curvature, 16);
  const far = ringSmooth(curvature, 120);
  const lineRaw = new Float32Array(n);
  const reach = HALF_WIDTH - 1.1;
  for (let i = 0; i < n; i++) {
    const raw = -(100 * near[i] - 110 * far[i]);
    lineRaw[i] = reach * Math.tanh(raw / reach);
  }
  const line = ringSmooth(lineRaw, 10);

  // Speed envelope: corner limit, then braking (backwards) and traction
  // (forwards) passes around the loop twice so the seam is consistent.
  const corner = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    corner[i] = Math.min(V_TOP, Math.sqrt(LATERAL_GRIP / Math.max(Math.abs(curvature[i]), 1e-5)));
  }
  const back = Float32Array.from(corner);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const nextV = back[(i + 1) % n];
      back[i] = Math.min(back[i], Math.sqrt(nextV * nextV + 2 * BRAKE_DECEL * step));
    }
  }
  const target = Float32Array.from(back);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const prevV = target[(i - 1 + n) % n];
      target[i] = Math.min(back[i], Math.sqrt(prevV * prevV + 2 * DRIVE_ACCEL * step));
    }
  }
  const mode = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const brakeLimited = back[i] < corner[i] - 0.5 && target[i] >= back[i] - 0.01;
    const cornerLimited = corner[i] < V_TOP - 1 && Math.abs(target[i] - corner[i]) < 0.6;
    mode[i] = brakeLimited ? 2 : cornerLimited ? 1 : 0;
  }

  // Corners: stretches tighter than a 50 m radius, merged when close.
  const corners: TrackCorner[] = [];
  const spans: Array<[number, number]> = [];
  let open = -1;
  for (let i = 0; i <= n; i++) {
    const tight = i < n && Math.abs(curvature[i]) > 0.02;
    if (tight && open < 0) open = i;
    if (!tight && open >= 0) {
      spans.push([open, i - 1]);
      open = -1;
    }
  }
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (
      last &&
      span[0] - last[1] < 40 &&
      Math.sign(curvature[span[0]]) === Math.sign(curvature[last[1]])
    ) {
      last[1] = span[1];
    } else {
      merged.push([span[0], span[1]]);
    }
  }
  for (const [a, b] of merged) {
    let apex = a;
    let minV = Infinity;
    for (let i = a; i <= b; i++) {
      if (Math.abs(curvature[i]) > Math.abs(curvature[apex])) apex = i;
      minV = Math.min(minV, target[i]);
    }
    const radius = 1 / Math.abs(curvature[apex]);
    if (radius > 48) continue;
    let brake = a;
    for (let k = 1; k < 500; k++) {
      const j = (a - k + n) % n;
      if (mode[j] !== 2) break;
      brake = j;
    }
    const severity =
      radius < 16 ? "HAIRPIN" : radius < 28 ? "TIGHT" : radius < 40 ? "MEDIUM" : "FAST";
    const dir = curvature[apex] > 0 ? "L" : "R";
    corners.push({
      id: corners.length + 1,
      label: `${severity} ${dir === "L" ? "LEFT" : "RIGHT"}`,
      dir,
      brake,
      entry: a,
      apex,
      exit: b,
      kmh: Math.round(minV * 3.6),
      entryKmh: Math.round(target[brake] * 3.6),
    });
  }

  cachedPlan = {
    count: n,
    length,
    step,
    xs,
    zs,
    nx,
    nz,
    heading,
    curvature,
    height,
    bank,
    line,
    target,
    mode,
    boostAt,
    features,
    corners,
  };
  return cachedPlan;
}

export type TrackProbe = {
  t: number;
  index: number;
  dist: number;
  lateral: number;
  height: number;
  slope: number;
  bank: number;
  heading: number;
};

export function createProbe(): TrackProbe {
  return { t: 0, index: 0, dist: 0, lateral: 0, height: 0, slope: 0, bank: 0, heading: 0 };
}

export type Track = {
  group: THREE.Group;
  plan: CircuitPlan;
  length: number;
  halfWidth: number;
  runoff: number;
  minimap: Array<[number, number]>;
  minimapFeatures: Array<{ kind: FeatureKind; x: number; z: number }>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  start: { pos: THREE.Vector3; heading: number };
  probe: (x: number, z: number, out: TrackProbe) => TrackProbe;
  nearestT: (x: number, z: number) => number;
  centerAt: (t: number, out: THREE.Vector3) => THREE.Vector3;
  tangentAt: (t: number, out: THREE.Vector3) => THREE.Vector3;
  distanceFromCenter: (x: number, z: number) => number;
  setAssist: (on: boolean) => void;
  update: (dt: number) => void;
  dispose: () => void;
};

function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  repeat = false,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

function checkerTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 32, (ctx) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#e9efe6" : "#0a0c0a";
        ctx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
  });
}

// Chevrons pointing up the canvas, i.e. along the direction of travel.
export function chevronTexture(fill: string, back = "rgba(0,0,0,0)"): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 18;
    ctx.lineJoin = "miter";
    ctx.beginPath();
    ctx.moveTo(14, 98);
    ctx.lineTo(64, 40);
    ctx.lineTo(114, 98);
    ctx.stroke();
  }, true);
}

function hazardTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = "#0b0e08";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#c8ff16";
    for (let k = -2; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(k * 64, 128);
      ctx.lineTo(k * 64 + 32, 128);
      ctx.lineTo(k * 64 + 160, 0);
      ctx.lineTo(k * 64 + 128, 0);
      ctx.closePath();
      ctx.fill();
    }
  }, true);
}

export function radialTexture(inner = "rgba(255,255,255,1)"): THREE.CanvasTexture {
  return canvasTexture(128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, "0.45)"));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function signTexture(title: string, sub: string, color: string): THREE.CanvasTexture {
  return canvasTexture(512, 192, (ctx) => {
    ctx.fillStyle = "rgba(5,6,7,0.92)";
    ctx.fillRect(0, 0, 512, 192);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 502, 182);
    ctx.fillStyle = color;
    ctx.font = "800 84px 'Archivo', 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(title, 256, 80);
    ctx.font = "600 34px 'IBM Plex Mono', monospace";
    ctx.fillStyle = "#e9ede8";
    ctx.fillText(sub, 256, 152);
  });
}

export function buildTrack(): Track {
  const plan = planCircuit();
  const { count: n, step, xs, zs, nx, nz, heading, height, bank } = plan;
  const group = new THREE.Group();
  const wrap = (i: number) => ((i % n) + n) % n;

  const disposables: Array<{ dispose: () => void }> = [];
  const keep = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const surfaceY = (i: number, off: number) => height[i] + bank[i] * off;

  // A ribbon between two lateral offsets that follows height and banking.
  // uv.x runs across (0 at edge A), uv.y runs along: metres * vScale, or 0..1
  // over the span when vScale is null.
  const strip = (
    edgeA: (i: number) => number,
    edgeB: (i: number) => number,
    lift: number,
    from = 0,
    to = n,
    vScale: number | null = 0.35,
    color?: (i: number, out: THREE.Color) => void,
  ): THREE.BufferGeometry => {
    const count = to - from + 1;
    const positions = new Float32Array(count * 6);
    const uvs = new Float32Array(count * 4);
    const colors = color ? new Float32Array(count * 6) : null;
    const indices: number[] = [];
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const i = wrap(from + k);
      const a = edgeA(i);
      const b = edgeB(i);
      const v = k * 6;
      positions[v] = xs[i] + nx[i] * a;
      positions[v + 1] = surfaceY(i, a) + lift;
      positions[v + 2] = zs[i] + nz[i] * a;
      positions[v + 3] = xs[i] + nx[i] * b;
      positions[v + 4] = surfaceY(i, b) + lift;
      positions[v + 5] = zs[i] + nz[i] * b;
      const along = vScale === null ? k / Math.max(1, count - 1) : k * step * vScale;
      uvs[k * 4] = 0; uvs[k * 4 + 1] = along;
      uvs[k * 4 + 2] = 1; uvs[k * 4 + 3] = along;
      if (colors && color) {
        color(i, c);
        colors[v] = c.r; colors[v + 1] = c.g; colors[v + 2] = c.b;
        colors[v + 3] = c.r; colors[v + 4] = c.g; colors[v + 5] = c.b;
      }
      if (k < count - 1) {
        const q = k * 2;
        indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    if (colors) geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return keep(geo);
  };
  const constant = (v: number) => () => v;

  const polyline = (off: number, lift: number): THREE.BufferGeometry => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) {
      const i = wrap(k);
      pts.push(new THREE.Vector3(xs[i] + nx[i] * off, surfaceY(i, off) + lift, zs[i] + nz[i] * off));
    }
    return keep(new THREE.BufferGeometry().setFromPoints(pts));
  };

  const additive = (color: number, opacity: number, extra: THREE.MeshBasicMaterialParameters = {}) =>
    keep(new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...extra,
    }));

  // Asphalt, run-off and kerbs.
  const asphaltMat = keep(new THREE.MeshStandardMaterial({
    color: 0x1b2023,
    roughness: 0.96,
    metalness: 0.05,
    envMapIntensity: 0.22,
    side: THREE.DoubleSide,
  }));
  group.add(new THREE.Mesh(strip(constant(HALF_WIDTH), constant(-HALF_WIDTH), 0), asphaltMat));

  const runoffMat = keep(new THREE.MeshStandardMaterial({
    color: 0x0c100e,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.12,
    side: THREE.DoubleSide,
  }));
  group.add(new THREE.Mesh(strip(constant(EDGE), constant(HALF_WIDTH + 0.8), -0.004), runoffMat));
  group.add(new THREE.Mesh(strip(constant(-HALF_WIDTH - 0.8), constant(-EDGE), -0.004), runoffMat));

  const acidColor = new THREE.Color(ACID);
  const dark = new THREE.Color(0x15181a);
  const curbMat = keep(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.05,
    envMapIntensity: 0.4,
    emissive: 0x0d1202,
    emissiveIntensity: 0.7,
    side: THREE.DoubleSide,
  }));
  const band = (i: number, out: THREE.Color) => out.copy(Math.floor(i / 5) % 2 === 0 ? acidColor : dark);
  group.add(new THREE.Mesh(strip(constant(HALF_WIDTH + 0.8), constant(HALF_WIDTH), 0.012, 0, n, 0.35, band), curbMat));
  group.add(new THREE.Mesh(strip(constant(-HALF_WIDTH), constant(-HALF_WIDTH - 0.8), 0.012, 0, n, 0.35, band), curbMat));

  const edgeMat = keep(new THREE.LineBasicMaterial({ color: ACID, transparent: true, opacity: 0.72 }));
  group.add(new THREE.Line(polyline(HALF_WIDTH, 0.02), edgeMat));
  group.add(new THREE.Line(polyline(-HALF_WIDTH, 0.02), edgeMat));

  const dashMat = keep(new THREE.LineDashedMaterial({
    color: 0x6f7a72,
    transparent: true,
    opacity: 0.4,
    dashSize: 1.4,
    gapSize: 1.6,
  }));
  const dashLine = new THREE.Line(polyline(0, 0.02), dashMat);
  dashLine.computeLineDistances();
  group.add(dashLine);

  // Start / finish checker and sector gates.
  const startMat = keep(new THREE.MeshBasicMaterial({ map: keep(checkerTexture()), transparent: true, opacity: 0.92 }));
  group.add(new THREE.Mesh(strip(constant(HALF_WIDTH), constant(-HALF_WIDTH), 0.025, -1, 2, null), startMat));
  const gateMat = additive(ACID, 0.16);
  for (const frac of [1 / 3, 2 / 3]) {
    const idx = Math.round(frac * n);
    group.add(new THREE.Mesh(strip(constant(HALF_WIDTH), constant(-HALF_WIDTH), 0.03, idx, idx + 1, null), gateMat));
  }

  // Barriers at the run-off limit. They drop to the ground so raised
  // sections read as solid embankments rather than floating ribbons.
  const wallMat = keep(new THREE.MeshStandardMaterial({
    color: 0x11161a,
    roughness: 0.62,
    metalness: 0.2,
    envMapIntensity: 0.25,
    side: THREE.DoubleSide,
  }));
  const capMat = keep(new THREE.LineBasicMaterial({ color: 0x8fbf12, transparent: true, opacity: 0.55 }));
  const wallHeight = 0.7;
  for (const side of [1, -1]) {
    const off = EDGE * side;
    const positions = new Float32Array((n + 1) * 6);
    const indices: number[] = [];
    for (let k = 0; k <= n; k++) {
      const i = wrap(k);
      const x = xs[i] + nx[i] * off;
      const z = zs[i] + nz[i] * off;
      const v = k * 6;
      positions[v] = x; positions[v + 1] = -0.03; positions[v + 2] = z;
      positions[v + 3] = x; positions[v + 4] = surfaceY(i, off) + wallHeight; positions[v + 5] = z;
      if (k < n) {
        const q = k * 2;
        indices.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
      }
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, wallMat));
    group.add(new THREE.Line(polyline(off, wallHeight), capMat));
  }

  // Ramps: hazard-striped kicker, glowing lip, landing grid and an arch.
  const hazard = keep(hazardTexture());
  const rampMat = keep(new THREE.MeshStandardMaterial({
    map: hazard,
    emissive: ACID,
    emissiveMap: hazard,
    emissiveIntensity: 0.32,
    roughness: 0.55,
    metalness: 0.1,
    side: THREE.DoubleSide,
  }));
  const lipMat = additive(ACID, 0.95);
  const landTex = keep(chevronTexture("rgba(200,255,22,0.9)"));
  const landMat = additive(ACID, 0.22, { map: landTex });
  const archMats: THREE.MeshBasicMaterial[] = [];
  const archGeo = keep(new THREE.TorusGeometry(HALF_WIDTH + 1.7, 0.14, 8, 56, Math.PI));
  for (const feature of plan.features) {
    if (feature.kind === "boost") continue;
    if (feature.kind === "ramp") {
      group.add(new THREE.Mesh(strip(constant(HALF_WIDTH), constant(-HALF_WIDTH), 0.014, feature.start, feature.lip, 0.22), rampMat));
      group.add(new THREE.Mesh(strip(constant(HALF_WIDTH), constant(-HALF_WIDTH), 0.04, feature.lip - 2, feature.lip, null), lipMat));
      group.add(new THREE.Mesh(strip(constant(HALF_WIDTH - 0.6), constant(-HALF_WIDTH + 0.6), 0.02, feature.lip + 1, feature.end, 0.5), landMat));
    } else {
      const hopMat = additive(0xe9ede8, 0.2, { map: landTex });
      group.add(new THREE.Mesh(strip(constant(HALF_WIDTH - 0.4), constant(-HALF_WIDTH + 0.4), 0.02, feature.start, feature.end, 0.5), hopMat));
    }
    const at = feature.start;
    const archMat = additive(ACID, 0.8);
    archMats.push(archMat);
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(xs[at], height[at], zs[at]);
    arch.rotation.y = heading[at];
    group.add(arch);
    const sign = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(4.2, 1.575)),
      keep(new THREE.MeshBasicMaterial({
        map: keep(signTexture(feature.label, feature.kind === "ramp" ? "FULL THROTTLE · HOLD STRAIGHT" : "STAY LOOSE · LAND FLAT", "#c8ff16")),
        transparent: true,
        side: THREE.DoubleSide,
      })),
    );
    sign.position.set(xs[at], height[at] + HALF_WIDTH + 2.9, zs[at]);
    sign.rotation.y = heading[at] + Math.PI;
    group.add(sign);
  }

  // Boost pads with chevrons that stream forward.
  const boostTex = keep(chevronTexture("rgba(111,249,255,1)"));
  const boostMat = additive(BOOST, 0.95, { map: boostTex });
  const boostEdgeMat = additive(BOOST, 0.6);
  for (const feature of plan.features) {
    if (feature.kind !== "boost") continue;
    group.add(new THREE.Mesh(strip(constant(BOOST_HALF), constant(-BOOST_HALF), 0.032, feature.start, feature.end, 0.42), boostMat));
    group.add(new THREE.Mesh(strip(constant(BOOST_HALF + 0.12), constant(BOOST_HALF), 0.034, feature.start, feature.end, null), boostEdgeMat));
    group.add(new THREE.Mesh(strip(constant(-BOOST_HALF), constant(-BOOST_HALF - 0.12), 0.034, feature.start, feature.end, null), boostEdgeMat));
  }

  // Floodlight towers with pools of light on the tarmac.
  const poleGeo = keep(new THREE.CylinderGeometry(0.12, 0.2, 1, 6));
  poleGeo.translate(0, 0.5, 0);
  const poleMat = keep(new THREE.MeshStandardMaterial({ color: 0x1a2024, roughness: 0.6, metalness: 0.5 }));
  const headGeo = keep(new THREE.BoxGeometry(2.2, 0.42, 0.5));
  const headMat = keep(new THREE.MeshBasicMaterial({ color: 0xf6ffe9 }));
  const haloTex = keep(radialTexture("rgba(255,246,220,1)"));
  const haloMat = keep(new THREE.SpriteMaterial({
    map: haloTex,
    color: 0xfff1d2,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  const poolMat = additive(0xfff1d2, 0.13, { map: haloTex });
  const towerEvery = 180;
  for (let k = 0, j = 0; k < n; k += towerEvery, j++) {
    const i = wrap(k + 60);
    const side = j % 2 === 0 ? 1 : -1;
    const off = side * (EDGE + 2.4);
    const x = xs[i] + nx[i] * off;
    const z = zs[i] + nz[i] * off;
    const top = height[i] + 10;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 0, z);
    pole.scale.y = top;
    group.add(pole);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(x, top, z);
    head.rotation.y = heading[i];
    head.rotation.x = side * 0.5;
    group.add(head);
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(x - nx[i] * side * 0.5, top, z - nz[i] * side * 0.5);
    halo.scale.setScalar(7);
    group.add(halo);
    group.add(new THREE.Mesh(
      strip(constant(HALF_WIDTH + 0.8), constant(-HALF_WIDTH - 0.8), 0.05, i - 24, i + 24, null),
      poolMat,
    ));
  }

  // Assist layer: the suggested line coloured by push / lift / brake, and
  // brake boards ahead of the big stops.
  const assist = new THREE.Group();
  group.add(assist);
  const red = new Float32Array(n);
  const amber = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    red[i] = plan.mode[i] === 2 ? 1 : 0;
    amber[i] = plan.mode[i] === 1 ? 1 : 0;
  }
  const redS = ringSmooth(red, 6);
  const amberS = ringSmooth(amber, 6);
  const pushC = new THREE.Color(ACID);
  const liftC = new THREE.Color(0xffb21f);
  const brakeC = new THREE.Color(0xff3b2f);
  const lineColor = (i: number, out: THREE.Color) => {
    out.copy(pushC).lerp(liftC, clamp(amberS[i], 0, 1)).lerp(brakeC, clamp(redS[i], 0, 1));
  };
  const lineTex = keep(chevronTexture("rgba(255,255,255,1)"));
  const lineMat = keep(new THREE.MeshBasicMaterial({
    map: lineTex,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  assist.add(new THREE.Mesh(
    strip((i) => plan.line[i] + 0.42, (i) => plan.line[i] - 0.42, 0.026, 0, n, 0.5, lineColor),
    lineMat,
  ));
  const boardGeo = keep(new THREE.PlaneGeometry(2.4, 0.9));
  for (const c of plan.corners) {
    if (c.entryKmh - c.kmh < 30) continue;
    const i = c.brake;
    const side = c.dir === "L" ? 1 : -1;
    const off = side * (HALF_WIDTH + 1.7);
    const board = new THREE.Mesh(boardGeo, keep(new THREE.MeshBasicMaterial({
      map: keep(signTexture("BRAKE", `T${c.id} · ${c.kmh} KM/H`, "#ff3b2f")),
      transparent: true,
      side: THREE.DoubleSide,
    })));
    board.position.set(xs[i] + nx[i] * off, surfaceY(i, off) + 1.5, zs[i] + nz[i] * off);
    board.rotation.y = heading[i] + Math.PI;
    assist.add(board);
    const post = new THREE.Mesh(poleGeo, poleMat);
    post.position.set(board.position.x, surfaceY(i, off), board.position.z);
    post.scale.set(0.4, 1.05, 0.4);
    assist.add(post);
  }

  // Ground + subtle grid surrounding the circuit.
  const groundMat = keep(new THREE.MeshStandardMaterial({
    color: 0x040605,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0.1,
  }));
  const ground = new THREE.Mesh(keep(new THREE.CircleGeometry(330, 96)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-25, -0.03, -162);
  group.add(ground);

  const grid = new THREE.GridHelper(720, 240, 0x16201a, 0x0e1410);
  grid.position.set(-25, -0.02, -162);
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  keep(gridMat);
  keep(grid.geometry);
  group.add(grid);

  // Minimap outline + bounds.
  const minimap: Array<[number, number]> = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i += 5) {
    minimap.push([xs[i], zs[i]]);
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minZ = Math.min(minZ, zs[i]); maxZ = Math.max(maxZ, zs[i]);
  }

  const probe = (x: number, z: number, out: TrackProbe): TrackProbe => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - x;
      const dz = zs[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    let seg = best;
    let segU = 0;
    let segD = Infinity;
    for (const a of [wrap(best - 1), best]) {
      const b = wrap(a + 1);
      const ex = xs[b] - xs[a];
      const ez = zs[b] - zs[a];
      const len2 = ex * ex + ez * ez || 1e-9;
      const u = clamp(((x - xs[a]) * ex + (z - zs[a]) * ez) / len2, 0, 1);
      const d = Math.hypot(x - (xs[a] + ex * u), z - (zs[a] + ez * u));
      if (d < segD) {
        segD = d;
        seg = a;
        segU = u;
      }
    }
    const b = wrap(seg + 1);
    const cx = xs[seg] + (xs[b] - xs[seg]) * segU;
    const cz = zs[seg] + (zs[b] - zs[seg]) * segU;
    const nxv = nx[seg] + (nx[b] - nx[seg]) * segU;
    const nzv = nz[seg] + (nz[b] - nz[seg]) * segU;
    const lateral = (x - cx) * nxv + (z - cz) * nzv;
    const bk = bank[seg] + (bank[b] - bank[seg]) * segU;
    out.t = (seg + segU) / n;
    out.index = seg;
    out.dist = segD;
    out.lateral = lateral;
    out.bank = bk;
    out.height = height[seg] + (height[b] - height[seg]) * segU + bk * clamp(lateral, -EDGE, EDGE);
    out.slope = (height[b] - height[seg]) / step;
    out.heading = heading[seg] + wrapAngle(heading[b] - heading[seg]) * segU;
    return out;
  };
  const scratch = createProbe();

  const sampleAt = (t: number) => {
    const f = (((t % 1) + 1) % 1) * n;
    const a = Math.floor(f) % n;
    return { a, b: (a + 1) % n, u: f - Math.floor(f) };
  };

  let time = 0;
  const update = (dt: number): void => {
    time += dt;
    boostTex.offset.y -= dt * 2.4;
    lineTex.offset.y -= dt * 0.6;
    boostMat.opacity = 0.75 + 0.2 * Math.sin(time * 9);
    for (let k = 0; k < archMats.length; k++) {
      archMats[k].opacity = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(time * 3.2 - k));
    }
    lipMat.opacity = 0.7 + 0.28 * Math.sin(time * 6);
  };

  return {
    group,
    plan,
    length: plan.length,
    halfWidth: HALF_WIDTH,
    runoff: RUNOFF,
    minimap,
    minimapFeatures: plan.features.map((f) => ({ kind: f.kind, x: f.x, z: f.z })),
    bounds: { minX, maxX, minZ, maxZ },
    start: { pos: new THREE.Vector3(xs[0], height[0], zs[0]), heading: heading[0] },
    probe,
    nearestT: (x, z) => probe(x, z, scratch).t,
    centerAt: (t, out) => {
      const { a, b, u } = sampleAt(t);
      return out.set(
        xs[a] + (xs[b] - xs[a]) * u,
        height[a] + (height[b] - height[a]) * u,
        zs[a] + (zs[b] - zs[a]) * u,
      );
    },
    tangentAt: (t, out) => {
      const { a, b, u } = sampleAt(t);
      const h = heading[a] + wrapAngle(heading[b] - heading[a]) * u;
      return out.set(Math.sin(h), 0, Math.cos(h));
    },
    distanceFromCenter: (x, z) => probe(x, z, scratch).dist,
    setAssist: (on) => {
      assist.visible = on;
    },
    update,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}
