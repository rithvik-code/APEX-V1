const THREE = require("three");
const candidates = {
  original: [
    [-30, 0], [-6, 0], [18, 0], [32, -2],
    [41, -9], [43, -20],
    [44, -32], [40, -44], [30, -48], [22, -42],
    [12, -37], [2, -40], [-8, -37], [-18, -41],
    [-28, -38], [-36, -30], [-42, -20], [-43, -9], [-38, -2],
  ],
  longE2: [
    [-110, 0], [-70, 0], [-30, 0], [10, 0], [50, 0], [90, 0], [115, 0],
    [140, -6], [158, -20], [166, -42],
    [168, -68], [164, -94], [152, -114],
    [132, -132], [108, -146],
    [84, -152], [62, -148],
    [50, -136], [46, -116], [50, -98], [52, -78], [48, -58], [40, -48],
    [28, -38], [18, -42], [14, -54], [16, -70],
    [18, -86], [22, -104], [18, -122], [12, -136],
    [-8, -150], [-32, -154], [-58, -150], [-82, -154], [-106, -152],
    [-124, -146], [-138, -134], [-148, -118],
    [-158, -100], [-168, -80], [-178, -58], [-188, -36], [-192, -16],
    [-186, -5], [-170, 0], [-148, 0],
  ],
  longG: [
    [-160, 0], [-120, 0], [-80, 0], [-40, 0], [0, 0], [40, 0], [80, 0], [115, 0],
    [140, -6], [158, -20], [166, -42],
    [170, -70], [172, -98], [166, -126], [152, -148],
    [130, -166], [104, -178],
    [84, -184], [62, -176],
    [50, -160], [46, -140], [50, -120], [52, -100], [48, -80], [40, -66],
    [28, -56], [18, -60], [14, -74], [16, -92],
    [18, -110], [22, -128], [18, -146], [12, -160],
    [-8, -172], [-32, -176],
    [-56, -166], [-70, -148], [-82, -142], [-94, -150], [-104, -164], [-120, -172],
    [-142, -176], [-160, -168], [-176, -152], [-188, -132],
    [-198, -110], [-206, -86], [-212, -62], [-214, -40], [-210, -22], [-202, -8], [-194, 0], [-180, 0],
  ],
  longH: [
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
  ],
};
function chaikin(points, passes) {
  let p = points;
  for (let pass = 0; pass < passes; pass++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    p = out;
  }
  return p;
}
function lapEstimate(samples, N, top, accel, brake, steerAuth) {
  const L = [];
  for (let i = 0; i < N; i++) {
    const p0 = samples[(i - 1 + N) % N], p1 = samples[i], p2 = samples[(i + 1) % N];
    const ax = p1.x - p0.x, az = p1.z - p0.z;
    const bx = p2.x - p1.x, bz = p2.z - p1.z;
    const cross = Math.abs(ax * bz - az * bx);
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(p2.x - p0.x, p2.z - p0.z);
    L.push((la + lb) / 2);
    if (cross < 1e-7) { samples[i].r = 1e4; continue; }
    samples[i].r = (la * lb * lc) / (2 * cross);
  }
  const v = samples.map((p) => Math.min(top, steerAuth * p.r * 0.92));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i <= N; i++) {
      const a = (i - 1) % N, b = i % N;
      v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * accel * L[a]));
    }
    for (let i = N - 1; i >= 0; i--) {
      const a = (i + 1) % N;
      v[i] = Math.min(v[i], Math.sqrt(v[a] * v[a] + 2 * brake * L[i]));
    }
  }
  let time = 0;
  for (let i = 0; i < N; i++) time += L[i] / Math.max(1, v[i]);
  return time;
}
function measure(pts2, label) {
  const pts = pts2.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const N = 1400;
  const s = [];
  for (let i = 0; i < N; i++) s.push(curve.getPoint(i / N));
  let minR = Infinity, minAt = 0;
  const radii = [];
  for (let i = 0; i < N; i++) {
    const p0 = s[(i - 1 + N) % N], p1 = s[i], p2 = s[(i + 1) % N];
    const ax = p1.x - p0.x, az = p1.z - p0.z;
    const bx = p2.x - p1.x, bz = p2.z - p1.z;
    const cross = Math.abs(ax * bz - az * bx);
    if (cross < 1e-7) continue;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(p2.x - p0.x, p2.z - p0.z);
    const r = (la * lb * lc) / (2 * cross);
    radii.push([r, i / N]);
    if (r < minR) { minR = r; minAt = i / N; }
  }
  radii.sort((a, b) => a[0] - b[0]);
  console.log("worst", radii.slice(0, 6).map(([r, t]) => `${r.toFixed(1)}@${t.toFixed(2)}`).join(" "));
  function si(a, b, c, d) {
    const d1x = b.x - a.x, d1z = b.z - a.z, d2x = d.x - c.x, d2z = d.z - c.z;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((c.x - a.x) * d2z - (c.z - a.z) * d2x) / den;
    const u = ((c.x - a.x) * d1z - (c.z - a.z) * d1x) / den;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
  }
  let hits = 0;
  const hitAt = [];
  for (let i = 0; i < N; i++) for (let j = i + 2; j < N; j++) {
    if (i === 0 && j === N - 1) continue;
    if (si(s[i], s[(i + 1) % N], s[j], s[(j + 1) % N])) { hits++; if (hitAt.length < 8) hitAt.push(`${(i / N).toFixed(2)}x${(j / N).toFixed(2)}@(${s[i].x.toFixed(0)},${s[i].z.toFixed(0)})-(${s[j].x.toFixed(0)},${s[j].z.toFixed(0)})`); }
  }
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of s) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const len = curve.getLength();
  const car = lapEstimate(s.map((p) => p.clone()), N, 69, 20, 46, 2.2);
  const bike = lapEstimate(s.map((p) => p.clone()), N, 78, 26, 58, 2.7);
  console.log(label, "len", len.toFixed(1), "minR", minR.toFixed(2), "@", minAt.toFixed(3), "xings", hits, hitAt.join(","), "bounds", minX.toFixed(0), maxX.toFixed(0), minZ.toFixed(0), maxZ.toFixed(0));
  console.log("  est car", car.toFixed(1) + "s", "bike", bike.toFixed(1) + "s");
}
for (const [name, base] of Object.entries(candidates)) measure(chaikin(base, 3), name);
