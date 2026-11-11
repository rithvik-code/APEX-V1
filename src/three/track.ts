import * as THREE from "three";

const ACID = 0xc8ff16;
const HALF_WIDTH = 3;
const RUNOFF = 2.4;
const RIBBON = 720;

// A technical circuit: long main straight, a fast opening right, a tight
// hairpin peninsula, a flowing esses section and a high-speed left sweeper
// back onto the straight. The control polygon is rounded with three Chaikin
// passes so the hairpin stays a hard-but-drivable ~6 unit radius and the
// ribbon never folds back on itself.
const BASE: Array<[number, number]> = [
  [-30, 0], [-6, 0], [18, 0], [32, -2],
  [41, -9], [43, -20],
  [44, -32], [40, -44], [30, -48], [22, -42],
  [12, -37], [2, -40], [-8, -37], [-18, -41],
  [-28, -38], [-36, -30], [-42, -20], [-43, -9], [-38, -2],
];

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

export type Track = {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  length: number;
  halfWidth: number;
  runoff: number;
  minimap: Array<[number, number]>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  start: { pos: THREE.Vector3; heading: number };
  nearestT: (x: number, z: number) => number;
  centerAt: (t: number, out: THREE.Vector3) => THREE.Vector3;
  tangentAt: (t: number, out: THREE.Vector3) => THREE.Vector3;
  distanceFromCenter: (x: number, z: number) => number;
  dispose: () => void;
};

function checkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const cell = 16;
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#e9efe6" : "#0a0c0a";
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildTrack(): Track {
  const group = new THREE.Group();
  const control = chaikin(BASE, 3).map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(control, true, "centripetal");
  const length = curve.getLength();

  // Dense centerline samples reused for the ribbon, nearest-point lookup and
  // the minimap so everything stays consistent.
  const centers: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const xs = new Float32Array(RIBBON + 1);
  const zs = new Float32Array(RIBBON + 1);
  const tangent = new THREE.Vector3();
  for (let i = 0; i <= RIBBON; i++) {
    const t = i / RIBBON;
    const p = curve.getPoint(t);
    curve.getTangent(t, tangent);
    const n = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
    centers.push(p);
    normals.push(n);
    xs[i] = p.x;
    zs[i] = p.z;
  }

  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  // Flat ribbon between two signed offsets from the centerline.
  const flatRibbon = (
    offA: number,
    offB: number,
    y: number,
    vertexColors: boolean,
  ): THREE.BufferGeometry => {
    const positions = new Float32Array((RIBBON + 1) * 2 * 3);
    const uvs = new Float32Array((RIBBON + 1) * 2 * 2);
    const colors = vertexColors ? new Float32Array((RIBBON + 1) * 2 * 3) : null;
    const indices: number[] = [];
    const acid = new THREE.Color(ACID);
    const dark = new THREE.Color(0x15181a);
    for (let i = 0; i <= RIBBON; i++) {
      const c = centers[i];
      const n = normals[i];
      const ax = c.x + n.x * offA;
      const az = c.z + n.z * offA;
      const bx = c.x + n.x * offB;
      const bz = c.z + n.z * offB;
      const v = i * 6;
      positions[v] = ax; positions[v + 1] = y; positions[v + 2] = az;
      positions[v + 3] = bx; positions[v + 4] = y; positions[v + 5] = bz;
      const u = (i / RIBBON) * length * 0.35;
      uvs[i * 4] = u; uvs[i * 4 + 1] = 0;
      uvs[i * 4 + 2] = u; uvs[i * 4 + 3] = 1;
      if (colors) {
        const band = Math.floor(i / 5) % 2 === 0 ? acid : dark;
        colors[v] = band.r; colors[v + 1] = band.g; colors[v + 2] = band.b;
        colors[v + 3] = band.r; colors[v + 4] = band.g; colors[v + 5] = band.b;
      }
      if (i < RIBBON) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    if (colors) geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  };

  // Asphalt.
  const asphaltMat = track(new THREE.MeshStandardMaterial({
    color: 0x121517,
    roughness: 0.94,
    metalness: 0.08,
    envMapIntensity: 0.3,
  }));
  const asphalt = new THREE.Mesh(track(flatRibbon(HALF_WIDTH, -HALF_WIDTH, 0, false)), asphaltMat);
  group.add(asphalt);

  // Rumble strips just outside each edge.
  const curbMat = track(new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.1,
  }));
  group.add(new THREE.Mesh(track(flatRibbon(HALF_WIDTH + 0.6, HALF_WIDTH, 0.012, true)), curbMat));
  group.add(new THREE.Mesh(track(flatRibbon(-HALF_WIDTH, -HALF_WIDTH - 0.6, 0.012, true)), curbMat));

  // Glowing edge lines.
  const edgeMat = track(new THREE.LineBasicMaterial({
    color: 0xa9d915,
    transparent: true,
    opacity: 0.5,
  }));
  for (const side of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= RIBBON; i++) {
      const c = centers[i];
      const n = normals[i];
      pts.push(new THREE.Vector3(c.x + n.x * HALF_WIDTH * side, 0.02, c.z + n.z * HALF_WIDTH * side));
    }
    const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
    group.add(new THREE.Line(geo, edgeMat));
  }

  // Center dashes.
  const dashMat = track(new THREE.LineDashedMaterial({
    color: 0x6f7a72,
    transparent: true,
    opacity: 0.4,
    dashSize: 1.4,
    gapSize: 1.6,
  }));
  const dashGeo = track(new THREE.BufferGeometry().setFromPoints(centers.map((c) => new THREE.Vector3(c.x, 0.02, c.z))));
  const dashLine = new THREE.Line(dashGeo, dashMat);
  dashLine.computeLineDistances();
  group.add(dashLine);

  // Start / finish checker.
  const up = new THREE.Vector3(0, 1, 0);
  const layFlat = (mesh: THREE.Mesh, center: THREE.Vector3, tan: THREE.Vector3, y: number) => {
    const across = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(across, tan, up));
    mesh.position.set(center.x, y, center.z);
  };
  const startTex = track(checkerTexture());
  const startMat = track(new THREE.MeshBasicMaterial({ map: startTex, transparent: true, opacity: 0.92 }));
  const startLine = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_WIDTH * 2, 1.4)), startMat);
  const sPos = centers[0];
  const sTan = curve.getTangent(0);
  layFlat(startLine, sPos, sTan, 0.025);
  group.add(startLine);

  // Sector gates at thirds.
  const gateMat = track(new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  for (const frac of [1 / 3, 2 / 3]) {
    const idx = Math.round(frac * RIBBON);
    const gateTan = curve.getTangent(frac);
    const gate = new THREE.Mesh(track(new THREE.PlaneGeometry(HALF_WIDTH * 2, 0.35)), gateMat);
    layFlat(gate, centers[idx], gateTan, 0.03);
    group.add(gate);
  }

  // Barriers: low walls at the runoff limit, both sides, with an acid cap.
  const wallMat = track(new THREE.MeshStandardMaterial({
    color: 0x0c0f11,
    roughness: 0.6,
    metalness: 0.3,
    side: THREE.DoubleSide,
  }));
  const capMat = track(new THREE.LineBasicMaterial({ color: 0x8fbf12, transparent: true, opacity: 0.55 }));
  const wallHeight = 0.7;
  for (const side of [1, -1]) {
    const offset = (HALF_WIDTH + RUNOFF) * side;
    const positions = new Float32Array((RIBBON + 1) * 2 * 3);
    const indices: number[] = [];
    const capPts: THREE.Vector3[] = [];
    for (let i = 0; i <= RIBBON; i++) {
      const c = centers[i];
      const n = normals[i];
      const x = c.x + n.x * offset;
      const z = c.z + n.z * offset;
      const v = i * 6;
      positions[v] = x; positions[v + 1] = 0; positions[v + 2] = z;
      positions[v + 3] = x; positions[v + 4] = wallHeight; positions[v + 5] = z;
      capPts.push(new THREE.Vector3(x, wallHeight, z));
      if (i < RIBBON) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, wallMat));
    group.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(capPts)), capMat));
  }

  // Ground + subtle grid surrounding the circuit.
  const groundMat = track(new THREE.MeshStandardMaterial({
    color: 0x080b09,
    roughness: 1,
    metalness: 0,
  }));
  const ground = new THREE.Mesh(track(new THREE.CircleGeometry(150, 72)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.03, -22);
  group.add(ground);

  const grid = new THREE.GridHelper(300, 150, 0x16201a, 0x0e1410);
  grid.position.set(0, -0.02, -22);
  const gridMat = grid.material as THREE.LineBasicMaterial;
  gridMat.transparent = true;
  gridMat.opacity = 0.35;
  track(gridMat);
  track(grid.geometry);
  group.add(grid);

  // Minimap outline + bounds.
  const minimap: Array<[number, number]> = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < RIBBON; i += 5) {
    minimap.push([xs[i], zs[i]]);
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minZ = Math.min(minZ, zs[i]); maxZ = Math.max(maxZ, zs[i]);
  }

  const startHeading = Math.atan2(sTan.x, sTan.z);

  const nearestT = (x: number, z: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < RIBBON; i++) {
      const dx = xs[i] - x;
      const dz = zs[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best / RIBBON;
  };

  const distanceFromCenter = (x: number, z: number): number => {
    const t = nearestT(x, z);
    const idx = Math.round(t * RIBBON);
    const dx = xs[idx] - x;
    const dz = zs[idx] - z;
    return Math.hypot(dx, dz);
  };

  return {
    group,
    curve,
    length,
    halfWidth: HALF_WIDTH,
    runoff: RUNOFF,
    minimap,
    bounds: { minX, maxX, minZ, maxZ },
    start: { pos: sPos.clone(), heading: startHeading },
    nearestT,
    centerAt: (t, out) => curve.getPoint(((t % 1) + 1) % 1, out),
    tangentAt: (t, out) => curve.getTangent(((t % 1) + 1) % 1, out),
    distanceFromCenter,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
}