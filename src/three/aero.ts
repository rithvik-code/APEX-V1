import * as THREE from "three";

export type FlowColorMode = "velocity" | "pressure" | "acid";

const SAMPLES = 110;

type Streamline = {
  points: Float32Array;
  speed: Float32Array;
  pressure: Float32Array;
  length: number;
  seed: number;
  hot: boolean;
};

function knots(z: number, table: Array<[number, number]>): number {
  if (z >= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (z >= table[i][0]) {
      const [z0, y0] = table[i - 1];
      const [z1, y1] = table[i];
      const t = (z - z0) / (z1 - z0);
      return y0 + (y1 - y0) * t;
    }
  }
  return table[table.length - 1][1];
}

const CAR_TOP: Array<[number, number]> = [
  [2.4, 0.42],
  [1.6, 0.62],
  [1.0, 0.72],
  [0.4, 0.95],
  [-0.2, 1.2],
  [-0.8, 1.16],
  [-1.5, 1.14],
  [-2.0, 1.1],
  [-2.4, 0.72],
];

const BIKE_TOP: Array<[number, number]> = [
  [1.15, 1.05],
  [0.85, 1.32],
  [0.3, 1.24],
  [-0.5, 1.1],
  [-1.1, 1.04],
];

function gauss(x: number, center: number, width: number): number {
  const d = (x - center) / width;
  return Math.exp(-d * d);
}

function makeLine(
  ctrl: THREE.Vector3[],
  speedFn: (z: number, t: number) => number,
  pressureFn: (z: number, t: number, speed: number) => number,
  hot = false,
): Streamline {
  const curve = new THREE.CatmullRomCurve3(ctrl, false, "centripetal", 0.4);
  const points = new Float32Array(SAMPLES * 3);
  const speed = new Float32Array(SAMPLES);
  const pressure = new Float32Array(SAMPLES);
  const v = new THREE.Vector3();
  let length = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    curve.getPoint(t, v);
    points[i * 3] = v.x;
    points[i * 3 + 1] = v.y;
    points[i * 3 + 2] = v.z;
    const s = speedFn(v.z, t);
    speed[i] = s;
    pressure[i] = pressureFn(v.z, t, s);
    if (i > 0) {
      length += Math.hypot(v.x - px, v.y - py, v.z - pz);
    }
    px = v.x;
    py = v.y;
    pz = v.z;
  }
  return { points, speed, pressure, length, seed: Math.random(), hot };
}

function overBodySpeed(z: number): number {
  if (z < -2.6) return 0.5;
  return (
    0.58 +
    1.02 * gauss(z, -0.1, 1.5) +
    0.3 * gauss(z, -2.05, 0.5) -
    0.25 * gauss(z, 2.35, 0.45)
  );
}

function defaultPressure(z: number, _t: number, s: number): number {
  return THREE.MathUtils.clamp(1.05 - s * 0.62 + 0.55 * gauss(z, 2.35, 0.4), 0, 1);
}

export function buildCarStreamlines(): Streamline[] {
  const lines: Streamline[] = [];
  const zStops = [6.5, 3.2, 2.2, 1.2, 0.3, -0.6, -1.5, -2.05, -2.7, -3.7, -5.3, -7];

  // Over the body: five width lanes x three heights.
  for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) {
    for (const h of [0.07, 0.26, 0.52]) {
      const ctrl = zStops.map((z) => {
        let y: number;
        if (z > 2.4) y = 0.55 + h;
        else if (z < -2.4) y = Math.max(0.5 + h + (z + 2.4) * 0.055, 0.3 + h);
        else y = knots(z, CAR_TOP) + h;
        const spread = z < -2.4 ? 1 + (-z - 2.4) * 0.045 : 1;
        return new THREE.Vector3(x * spread, y, z);
      });
      lines.push(makeLine(ctrl, overBodySpeed, defaultPressure));
    }
  }

  // Around the flanks.
  for (const side of [-1, 1]) {
    for (const xOff of [1.06, 1.34, 1.62]) {
      for (const y of [0.32, 0.58, 0.86]) {
        const ctrl = zStops.map((z) => {
          const bulge = 0.2 * gauss(z, 0, 1.7);
          const wake = z < -2.4 ? (-z - 2.4) * 0.05 : 0;
          return new THREE.Vector3(
            side * (xOff + bulge + wake),
            y + (z < -3 ? (z + 3) * 0.03 : 0),
            z,
          );
        });
        lines.push(
          makeLine(
            ctrl,
            (z) => (z < -2.6 ? 0.52 : 0.62 + 0.85 * gauss(z, 0.1, 1.8)),
            defaultPressure,
          ),
        );
      }
    }
  }

  // Underbody venturi — accelerates under the floor, kicks up the diffuser.
  for (const x of [-0.62, -0.21, 0.21, 0.62]) {
    const ctrl = [
      new THREE.Vector3(x, 0.3, 6.5),
      new THREE.Vector3(x, 0.16, 3),
      new THREE.Vector3(x, 0.1, 1.6),
      new THREE.Vector3(x, 0.09, 0),
      new THREE.Vector3(x, 0.1, -1.6),
      new THREE.Vector3(x, 0.14, -2.3),
      new THREE.Vector3(x, 0.38, -3.1),
      new THREE.Vector3(x * 1.1, 0.52, -4.2),
      new THREE.Vector3(x * 1.15, 0.55, -5.6),
      new THREE.Vector3(x * 1.2, 0.5, -7),
    ];
    lines.push(
      makeLine(
        ctrl,
        (z) => (z < -2.6 ? 0.6 : 0.7 + 1.05 * gauss(z, -0.2, 1.9)),
        (_z, _t, s) => THREE.MathUtils.clamp(1.1 - s * 0.62, 0, 1),
      ),
    );
  }

  // Wing impact: stagnation at the leading edge, suction over the top.
  for (const x of [-0.52, -0.18, 0.18, 0.52]) {
    for (const over of [true, false]) {
      const ctrl = [
        new THREE.Vector3(x, 1.0, 6.5),
        new THREE.Vector3(x, 1.02, 2.4),
        new THREE.Vector3(x, 1.04, 0.4),
        new THREE.Vector3(x, 1.05, -1.3),
        new THREE.Vector3(x, over ? 1.12 : 1.0, -1.75),
        new THREE.Vector3(x, over ? 1.3 : 0.9, -2.1),
        new THREE.Vector3(x, over ? 1.18 : 0.78, -2.7),
        new THREE.Vector3(x * 1.05, over ? 0.95 : 0.62, -3.8),
        new THREE.Vector3(x * 1.1, 0.7, -5.4),
        new THREE.Vector3(x * 1.15, 0.6, -7),
      ];
      lines.push(
        makeLine(
          ctrl,
          (z) =>
            z < -2.6
              ? 0.5
              : 0.62 + (over ? 1.15 : 0.55) * gauss(z, -2.05, 0.55),
          (z, _t, s) =>
            THREE.MathUtils.clamp(
              1.05 - s * 0.6 + 0.7 * gauss(z, -1.8, 0.3),
              0,
              1,
            ),
        ),
      );
    }
  }

  // Internal cooling path: intake → engine bay → exhaust. Rendered x-ray.
  for (const side of [-1, 1]) {
    const ctrl = [
      new THREE.Vector3(side * 0.34, 0.42, 6.5),
      new THREE.Vector3(side * 0.34, 0.4, 2.4),
      new THREE.Vector3(side * 0.3, 0.45, 1.3),
      new THREE.Vector3(side * 0.2, 0.62, 0.2),
      new THREE.Vector3(side * 0.12, 0.9, -1.2),
      new THREE.Vector3(side * 0.12, 1.0, -1.6),
      new THREE.Vector3(side * 0.4, 0.36, -2.32),
      new THREE.Vector3(side * 0.46, 0.42, -3.6),
      new THREE.Vector3(side * 0.55, 0.5, -5.2),
      new THREE.Vector3(side * 0.62, 0.55, -6.8),
    ];
    lines.push(
      makeLine(
        ctrl,
        (z) => 0.7 + 0.7 * gauss(z, -1.4, 0.8),
        (_z, t) => 0.4 + 0.4 * t,
        true,
      ),
    );
  }

  return lines;
}

export function buildBikeStreamlines(): Streamline[] {
  const lines: Streamline[] = [];
  const zStops = [5.2, 2.6, 1.6, 1.0, 0.4, -0.3, -0.9, -1.4, -2.2, -3.4, -5.2];

  for (const x of [-0.26, 0, 0.26]) {
    for (const h of [0.06, 0.24]) {
      const ctrl = zStops.map((z) => {
        let y: number;
        if (z > 1.2) y = 0.8 + h;
        else if (z < -1.1) y = Math.max(0.75 + h + (z + 1.1) * 0.06, 0.4 + h);
        else y = knots(z, BIKE_TOP) + h;
        return new THREE.Vector3(x, y, z);
      });
      lines.push(
        makeLine(
          ctrl,
          (z) => (z < -1.4 ? 0.55 : 0.6 + 1.0 * gauss(z, 0.35, 1.0)),
          (z, _t, s) =>
            THREE.MathUtils.clamp(1.05 - s * 0.62 + 0.5 * gauss(z, 1.15, 0.3), 0, 1),
        ),
      );
    }
  }

  for (const side of [-1, 1]) {
    for (const xOff of [0.42, 0.62]) {
      for (const y of [0.42, 0.72, 1.0]) {
        const ctrl = zStops.map((z) => {
          const bulge = 0.14 * gauss(z, 0.5, 0.9);
          return new THREE.Vector3(side * (xOff + bulge), y, z);
        });
        lines.push(
          makeLine(
            ctrl,
            (z) => (z < -1.4 ? 0.55 : 0.65 + 0.8 * gauss(z, 0.4, 1.1)),
            defaultPressure,
          ),
        );
      }
    }
  }

  // Wheel wake: low air deflected up over the front contact patch.
  for (const side of [-1, 1]) {
    const ctrl = [
      new THREE.Vector3(side * 0.18, 0.22, 5.2),
      new THREE.Vector3(side * 0.18, 0.2, 2.2),
      new THREE.Vector3(side * 0.2, 0.42, 1.4),
      new THREE.Vector3(side * 0.24, 0.72, 1.0),
      new THREE.Vector3(side * 0.26, 0.5, 0.4),
      new THREE.Vector3(side * 0.26, 0.3, -0.6),
      new THREE.Vector3(side * 0.28, 0.5, -1.1),
      new THREE.Vector3(side * 0.3, 0.42, -2.2),
      new THREE.Vector3(side * 0.32, 0.35, -3.6),
      new THREE.Vector3(side * 0.34, 0.3, -5.2),
    ];
    lines.push(
      makeLine(
        ctrl,
        (z) => 0.6 + 0.9 * gauss(z, 1.0, 0.5) + 0.6 * gauss(z, -1.0, 0.5),
        defaultPressure,
      ),
    );
  }

  // Internal: intake through the frame, over the cylinders, out the header.
  const ctrl = [
    new THREE.Vector3(0, 1.02, 5.2),
    new THREE.Vector3(0, 1.0, 1.2),
    new THREE.Vector3(0, 0.86, 0.55),
    new THREE.Vector3(0, 0.72, 0.1),
    new THREE.Vector3(0.1, 0.66, -0.1),
    new THREE.Vector3(0.24, 0.64, -0.35),
    new THREE.Vector3(0.33, 0.78, -1.06),
    new THREE.Vector3(0.36, 0.82, -2.2),
    new THREE.Vector3(0.4, 0.85, -3.8),
    new THREE.Vector3(0.44, 0.85, -5.2),
  ];
  lines.push(
    makeLine(
      ctrl,
      (z) => 0.7 + 0.75 * gauss(z, 0.0, 0.6),
      (_z, t) => 0.4 + 0.4 * t,
      true,
    ),
  );

  return lines;
}

const lineVertex = /* glsl */ `
  attribute float aT;
  attribute float aSpeed;
  attribute float aPressure;
  attribute float aSeed;
  uniform float uTime;
  uniform float uTurb;
  varying float vT;
  varying float vSpeed;
  varying float vPressure;
  varying float vSeed;
  void main() {
    vT = aT;
    vSpeed = aSpeed;
    vPressure = aPressure;
    vSeed = aSeed;
    vec3 p = position;
    float wake = smoothstep(0.58, 1.0, aT);
    float wob = uTurb * wake;
    p.x += sin(uTime * 2.6 + aSeed * 37.0 + aT * 26.0) * wob * 0.16;
    p.y += cos(uTime * 3.1 + aSeed * 51.0 + aT * 31.0) * wob * 0.11;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const lineFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFlow;
  uniform float uOpacity;
  uniform int uMode;
  uniform float uHot;
  varying float vT;
  varying float vSpeed;
  varying float vPressure;
  varying float vSeed;

  vec3 velColor(float s) {
    float t = clamp((s - 0.45) / 1.35, 0.0, 1.0);
    vec3 c1 = vec3(0.14, 0.72, 1.0);
    vec3 c2 = vec3(0.78, 1.0, 0.09);
    vec3 c3 = vec3(1.0, 1.0, 1.0);
    return t < 0.5 ? mix(c1, c2, t * 2.0) : mix(c2, c3, (t - 0.5) * 2.0);
  }

  void main() {
    float u = fract(vT * 2.0 - uTime * uFlow + vSeed);
    float pulse = smoothstep(0.0, 0.05, u) * smoothstep(0.42, 0.05, u);
    float ends = smoothstep(0.0, 0.03, vT) * smoothstep(1.0, 0.97, vT);
    vec3 col = uMode == 0
      ? velColor(vSpeed)
      : uMode == 1
        ? mix(vec3(0.16, 0.36, 1.0), vec3(1.0, 0.22, 0.82), clamp(vPressure, 0.0, 1.0))
        : vec3(0.78, 1.0, 0.09);
    col = mix(col, mix(vec3(1.0, 0.5, 0.08), vec3(1.0, 0.95, 0.75), pulse), uHot);
    float glow = 0.2 + pulse * 1.6;
    float alpha = ends * uOpacity * glow * mix(1.0, 0.6, uHot);
    gl_FragColor = vec4(col * glow, alpha);
  }
`;

const pointVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uScale;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale * (120.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const pointFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    float a = smoothstep(1.0, 0.08, r);
    float core = smoothstep(0.4, 0.0, r);
    gl_FragColor = vec4(vColor + core * 0.35, a * uOpacity);
  }
`;

const C_LOW = new THREE.Color(0.14, 0.72, 1.0);
const C_MID = new THREE.Color(0.78, 1.0, 0.09);
const C_HIGH = new THREE.Color(1, 1, 1);
const C_P_LOW = new THREE.Color(0.16, 0.36, 1.0);
const C_P_HIGH = new THREE.Color(1.0, 0.22, 0.82);

function velocityColor(s: number, out: THREE.Color): THREE.Color {
  const t = THREE.MathUtils.clamp((s - 0.45) / 1.35, 0, 1);
  if (t < 0.5) {
    out.copy(C_LOW).lerp(C_MID, t * 2);
  } else {
    out.copy(C_MID).lerp(C_HIGH, (t - 0.5) * 2);
  }
  return out;
}

export class AeroFlow {
  readonly group = new THREE.Group();
  private lines: Streamline[];
  private extMaterial: THREE.ShaderMaterial;
  private hotMaterial: THREE.ShaderMaterial;
  private pointMaterial: THREE.ShaderMaterial;
  private points: THREE.Points;
  private particleCount: number;
  private particleLine: Uint16Array;
  private particleT: Float32Array;
  private particleJit: Float32Array;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private opacity = 0;
  private opacityTarget = 0;
  private windSpeed = 180;
  private density = 0.7;
  private turbulence = 0.35;
  private timeScale = 1;
  private mode = 0;
  private time = 0;
  private tmpColor = new THREE.Color();
  private hotColor = new THREE.Color(1.0, 0.62, 0.15);

  constructor(lines: Streamline[], particleCount: number) {
    this.lines = lines;
    this.particleCount = particleCount;

    const ext = lines.filter((l) => !l.hot);
    const hot = lines.filter((l) => l.hot);
    this.group.add(this.buildLineMesh(ext, false));
    if (hot.length) this.group.add(this.buildLineMesh(hot, true));

    this.extMaterial = (this.group.children[0] as THREE.LineSegments)
      .material as THREE.ShaderMaterial;
    this.hotMaterial = hot.length
      ? ((this.group.children[1] as THREE.LineSegments)
          .material as THREE.ShaderMaterial)
      : this.extMaterial;

    this.particleLine = new Uint16Array(particleCount);
    this.particleT = new Float32Array(particleCount);
    this.particleJit = new Float32Array(particleCount);
    this.positions = new Float32Array(particleCount * 3);
    this.colors = new Float32Array(particleCount * 3);
    this.sizes = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      this.particleLine[i] = Math.floor(Math.random() * lines.length);
      this.particleT[i] = Math.random();
      this.particleJit[i] = 0.7 + Math.random() * 0.6;
      this.sizes[i] = 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));
    this.pointMaterial = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: {
        uOpacity: { value: 0 },
        uScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.pointMaterial);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.group.visible = false;
  }

  private buildLineMesh(
    lines: Streamline[],
    hot: boolean,
  ): THREE.LineSegments {
    const segCount = lines.length * (SAMPLES - 1);
    const positions = new Float32Array(segCount * 6);
    const aT = new Float32Array(segCount * 2);
    const aSpeed = new Float32Array(segCount * 2);
    const aPressure = new Float32Array(segCount * 2);
    const aSeed = new Float32Array(segCount * 2);
    let vp = 0;
    let vi = 0;
    for (const line of lines) {
      for (let i = 0; i < SAMPLES - 1; i++) {
        for (const j of [i, i + 1]) {
          positions[vp++] = line.points[j * 3];
          positions[vp++] = line.points[j * 3 + 1];
          positions[vp++] = line.points[j * 3 + 2];
          aT[vi] = j / (SAMPLES - 1);
          aSpeed[vi] = line.speed[j];
          aPressure[vi] = line.pressure[j];
          aSeed[vi] = line.seed;
          vi++;
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
    geo.setAttribute("aSpeed", new THREE.BufferAttribute(aSpeed, 1));
    geo.setAttribute("aPressure", new THREE.BufferAttribute(aPressure, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      uniforms: {
        uTime: { value: 0 },
        uFlow: { value: 1 },
        uOpacity: { value: 0 },
        uMode: { value: 0 },
        uTurb: { value: 0.35 },
        uHot: { value: hot ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: !hot,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.LineSegments(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = hot ? 12 : 10;
    return mesh;
  }

  setEnabled(on: boolean): void {
    this.opacityTarget = on ? 1 : 0;
  }

  setWindSpeed(kmh: number): void {
    this.windSpeed = kmh;
  }

  setDensity(value: number): void {
    this.density = value;
  }

  setTurbulence(value: number): void {
    this.turbulence = value;
  }

  setTimeScale(value: number): void {
    this.timeScale = value;
  }

  setColorMode(mode: FlowColorMode): void {
    this.mode = mode === "velocity" ? 0 : mode === "pressure" ? 1 : 2;
  }

  update(dt: number): void {
    this.opacity += (this.opacityTarget - this.opacity) * Math.min(1, dt * 2.6);
    this.group.visible = this.opacity > 0.02;
    if (!this.group.visible) return;

    const scaled = dt * this.timeScale;
    this.time += scaled;
    const rate = (this.windSpeed / 3.6) * 0.135;
    const flow = 0.3 + (this.windSpeed / 400) * 1.35;

    for (const material of [this.extMaterial, this.hotMaterial]) {
      material.uniforms.uTime.value = this.time;
      material.uniforms.uFlow.value = flow;
      material.uniforms.uOpacity.value = this.opacity;
      material.uniforms.uMode.value = this.mode;
      material.uniforms.uTurb.value = this.turbulence;
    }
    this.pointMaterial.uniforms.uOpacity.value = this.opacity * 0.9;

    const active = Math.floor(this.particleCount * this.density);
    this.points.geometry.setDrawRange(0, active);
    const pos = this.positions;
    const col = this.colors;
    const size = this.sizes;
    for (let i = 0; i < active; i++) {
      let line = this.lines[this.particleLine[i]];
      const oldT = this.particleT[i];
      const si = Math.min(SAMPLES - 1, Math.floor(oldT * (SAMPLES - 1)));
      let t =
        oldT +
        (scaled * rate * this.particleJit[i] * (0.45 + line.speed[si])) /
          line.length;
      if (t >= 1) {
        t -= 1;
        this.particleLine[i] = Math.floor(Math.random() * this.lines.length);
        line = this.lines[this.particleLine[i]];
      }
      this.particleT[i] = t;
      const fi = t * (SAMPLES - 1);
      const i0 = Math.min(SAMPLES - 2, Math.floor(fi));
      const f = fi - i0;
      const p = line.points;
      const wake = t > 0.58 ? (t - 0.58) / 0.42 : 0;
      const wobX =
        Math.sin(this.time * 2.6 + line.seed * 37 + t * 26) *
        this.turbulence *
        wake *
        0.16;
      const wobY =
        Math.cos(this.time * 3.1 + line.seed * 51 + t * 31) *
        this.turbulence *
        wake *
        0.11;
      pos[i * 3] = p[i0 * 3] + (p[(i0 + 1) * 3] - p[i0 * 3]) * f + wobX;
      pos[i * 3 + 1] =
        p[i0 * 3 + 1] + (p[(i0 + 1) * 3 + 1] - p[i0 * 3 + 1]) * f + wobY;
      pos[i * 3 + 2] = p[i0 * 3 + 2] + (p[(i0 + 1) * 3 + 2] - p[i0 * 3 + 2]) * f;

      const s = line.speed[i0] + (line.speed[i0 + 1] - line.speed[i0]) * f;
      if (line.hot) {
        col[i * 3] = this.hotColor.r;
        col[i * 3 + 1] = this.hotColor.g;
        col[i * 3 + 2] = this.hotColor.b;
      } else if (this.mode === 1) {
        const pr =
          line.pressure[i0] + (line.pressure[i0 + 1] - line.pressure[i0]) * f;
        this.tmpColor
          .copy(C_P_LOW)
          .lerp(C_P_HIGH, THREE.MathUtils.clamp(pr, 0, 1));
        col[i * 3] = this.tmpColor.r;
        col[i * 3 + 1] = this.tmpColor.g;
        col[i * 3 + 2] = this.tmpColor.b;
      } else if (this.mode === 2) {
        col[i * 3] = 0.78;
        col[i * 3 + 1] = 1.0;
        col[i * 3 + 2] = 0.09;
      } else {
        velocityColor(s, this.tmpColor);
        col[i * 3] = this.tmpColor.r;
        col[i * 3 + 1] = this.tmpColor.g;
        col[i * 3 + 2] = this.tmpColor.b;
      }
      size[i] = (0.3 + s * 0.26) * (line.hot ? 1.25 : 1);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aColor.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
  setPointScale(scale: number): void {
    this.pointMaterial.uniforms.uScale.value = scale;
  }
}