const THREE = require("three");

const base = [
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

function chaikin(pts, iterations) {
  let p = pts.map(([x, z]) => [x, z]);
  for (let it = 0; it < iterations; it++) {
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

function measure(pts2, label) {
  const pts = pts2.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const N = 1000;
  const s = [];
  for (let i = 0; i < N; i++) s.push(curve.getPoint(i / N));
  let minR = Infinity, minAt = 0;
  for (let i = 0; i < N; i++) {
    const p0 = s[(i - 1 + N) % N], p1 = s[i], p2 = s[(i + 1) % N];
    const ax = p1.x - p0.x, az = p1.z - p0.z;
    const bx = p2.x - p1.x, bz = p2.z - p1.z;
    const cross = Math.abs(ax * bz - az * bx);
    if (cross < 1e-7) continue;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz), lc = Math.hypot(p2.x - p0.x, p2.z - p0.z);
    const r = (la * lb * lc) / (2 * cross);
    if (r < minR) { minR = r; minAt = i / N; }
  }
  function si(a, b, c, d) {
    const d1x = b.x - a.x, d1z = b.z - a.z, d2x = d.x - c.x, d2z = d.z - c.z;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) return false;
    const t = ((c.x - a.x) * d2z - (c.z - a.z) * d2x) / den;
    const u = ((c.x - a.x) * d1z - (c.z - a.z) * d1x) / den;
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
  }
  let hits = 0;
  for (let i = 0; i < N; i += 1) {
    const a = s[i], b = s[(i + 1) % N];
    for (let j = i + 2; j < N; j += 1) {
      if (i === 0 && j === N - 1) continue;
      if (si(a, b, s[j], s[(j + 1) % N])) hits++;
    }
  }
  console.log(label, "pts", pts.length, "len", curve.getLength().toFixed(1), "minR", minR.toFixed(2), "@", minAt.toFixed(3), "xings", hits);
}

for (const n of [0, 1, 2, 3, 4]) measure(chaikin(base, n), "chaikin" + n);

const finalCurve = new THREE.CatmullRomCurve3(
  chaikin(base, 3).map(([x, z]) => new THREE.Vector3(x, 0, z)),
  true,
  "centripetal",
);
const finalLen = finalCurve.getLength();
console.log(finalLen >= 1400 ? "PASS" : "FAIL", "circuit length", finalLen.toFixed(1), "m (>= 1400)");