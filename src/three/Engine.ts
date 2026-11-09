import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createSupercar, type VehicleAnchor } from "./car";
import { createSuperbike } from "./bike";
import { AeroFlow, buildBikeStreamlines, buildCarStreamlines } from "./aero";
import {
  LIVERIES,
  type LightingPreset,
  type SceneConfig,
} from "../lib/scene";

const ACID = 0xc8ff16;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);

// Retina-crisp output, but cap the fill cost on low-core machines.
function renderPixelRatio(): number {
  const dpr = window.devicePixelRatio || 1;
  const cores = navigator.hardwareConcurrency;
  return Math.min(dpr, cores && cores <= 4 ? 1.5 : 2);
}

type Keyframe = {
  p: number;
  pos: [number, number, number];
  tgt: [number, number, number];
  fov: number;
};

const KEYFRAMES: Keyframe[] = [
  { p: 0.0, pos: [7.4, 2.0, 9.2], tgt: [0, 0.62, 0], fov: 40 },
  { p: 0.12, pos: [3.5, 1.12, 6.5], tgt: [0, 0.62, 0], fov: 40 },
  { p: 0.25, pos: [-5.4, 1.9, 5.8], tgt: [-0.4, 0.68, 0], fov: 41 },
  { p: 0.35, pos: [-5.8, 1.8, -0.7], tgt: [-9, 0.86, -6], fov: 38 },
  { p: 0.45, pos: [-11.6, 2.5, -3.3], tgt: [-9, 0.82, -6], fov: 36 },
  { p: 0.56, pos: [-3.2, 2.0, 3.4], tgt: [-2.2, 0.62, -2.4], fov: 42 },
  { p: 0.68, pos: [0.2, 6.8, 14.5], tgt: [-0.4, 0.2, -3], fov: 46 },
  { p: 0.8, pos: [0, 2.7, 6.4], tgt: [0, 3.0, -34], fov: 48 },
  { p: 0.9, pos: [0, 3.9, -12], tgt: [0, 4.7, -62], fov: 55 },
  { p: 1.0, pos: [0, 4.7, -30], tgt: [0, 4.7, -96], fov: 62 },
];

const CRTShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberration: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAberration;
    uniform vec2 uRes;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float dist = length(dir);
      float ab = (0.0005 + 0.0018 * uAberration) * (0.6 + dist);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      float scan = sin(uv.y * uRes.y * 1.6 + uTime * 1.4);
      col *= 1.0 - 0.015 * scan;

      float grain = hash(uv * uRes.xy + uTime * 60.0) - 0.5;
      col += grain * 0.022;

      col *= smoothstep(1.18, 0.3, dist);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "rgba(200,255,22,0.55)");
  g.addColorStop(0.3, "rgba(200,255,22,0.13)");
  g.addColorStop(1, "rgba(200,255,22,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shaftTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const vertical = ctx.createLinearGradient(0, 0, 0, 256);
  vertical.addColorStop(0, "rgba(220,255,170,0)");
  vertical.addColorStop(0.35, "rgba(220,255,170,0.5)");
  vertical.addColorStop(1, "rgba(220,255,170,0)");
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 64, 256);
  ctx.globalCompositeOperation = "destination-in";
  const horizontal = ctx.createLinearGradient(0, 0, 64, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.5, "rgba(255,255,255,1)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, 64, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type LightRig = {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  cool: THREE.DirectionalLight;
  acid: THREE.DirectionalLight;
  under: THREE.PointLight;
  bikeLight: THREE.PointLight;
  rim: THREE.PointLight;
};

type LightTarget = {
  intensity: number;
  color?: THREE.Color;
};

const LIGHTING_TARGETS: Record<
  LightingPreset,
  { exposure: number; lights: Record<keyof LightRig, LightTarget> }
> = {
  studio: {
    exposure: 1.05,
    lights: {
      hemi: { intensity: 0.7 },
      key: { intensity: 2.1, color: new THREE.Color(0xffffff) },
      cool: { intensity: 1.7, color: new THREE.Color(0x93b8d8) },
      acid: { intensity: 1.35, color: new THREE.Color(ACID) },
      under: { intensity: 6 },
      bikeLight: { intensity: 5 },
      rim: { intensity: 22, color: new THREE.Color(0xdff5ff) },
    },
  },
  midnight: {
    exposure: 0.82,
    lights: {
      hemi: { intensity: 0.22 },
      key: { intensity: 0.7, color: new THREE.Color(0x8fb8ff) },
      cool: { intensity: 0.9, color: new THREE.Color(0x5f88c8) },
      acid: { intensity: 0.55, color: new THREE.Color(ACID) },
      under: { intensity: 3 },
      bikeLight: { intensity: 3 },
      rim: { intensity: 30, color: new THREE.Color(0xbfe8ff) },
    },
  },
  neon: {
    exposure: 1.18,
    lights: {
      hemi: { intensity: 0.45 },
      key: { intensity: 1.4, color: new THREE.Color(0xffffff) },
      cool: { intensity: 2.4, color: new THREE.Color(0xff2fb3) },
      acid: { intensity: 2.6, color: new THREE.Color(ACID) },
      under: { intensity: 8 },
      bikeLight: { intensity: 7 },
      rim: { intensity: 14, color: new THREE.Color(0x7fd0ff) },
    },
  },
};

const CAMERA_TARGETS: Record<
  SceneConfig["camera"],
  { yaw: number; pitch: number; dist: number }
> = {
  hero: { yaw: 0, pitch: 0, dist: 1 },
  side: { yaw: 1.35, pitch: 0.06, dist: 1.04 },
  top: { yaw: 0.35, pitch: -1.12, dist: 1.32 },
  wing: { yaw: -2.45, pitch: 0.14, dist: 0.88 },
};

export class ApexEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private crt: ShaderPass;
  private clock = new THREE.Clock();
  private raf = 0;
  private car: ReturnType<typeof createSupercar>;
  private bike: ReturnType<typeof createSuperbike>;
  private carGroup = new THREE.Group();
  private bikeGroup = new THREE.Group();
  private anchors: Array<VehicleAnchor & { group: THREE.Group }> = [];
  private labels = new Map<string, HTMLElement>();
  private labelsEl: HTMLElement;
  private streaks: THREE.LineSegments;
  private streakSpeeds: Float32Array;
  private streakPositions: Float32Array;
  private dust: THREE.Points;
  private tunnel: THREE.Group;
  private endRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private progress = 0;
  private targetProgress = 0;
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private clockTime = 0;
  private reducedMotion: boolean;
  private disposed = false;
  private lastCameraPos = new THREE.Vector3();
  private basePos = new THREE.Vector3();
  private baseTarget = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private orbitOffset = new THREE.Vector3();
  private posPoints = KEYFRAMES.map(
    (key) => new THREE.Vector3(...key.pos),
  );
  private tgtPoints = KEYFRAMES.map(
    (key) => new THREE.Vector3(...key.tgt),
  );
  private keyP = KEYFRAMES.map((key) => key.p);
  private userYaw = 0;
  private userPitch = 0;
  private userYawT = 0;
  private userPitchT = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private lastOrbitInput = 0;
  private lastProgress = 0;
  private onReady?: () => void;
  private readySent = false;
  private paused = false;
  private aeroCar: AeroFlow;
  private aeroBike: AeroFlow;
  private bloom: UnrealBloomPass;
  private gridHelper: THREE.GridHelper;
  private lights: LightRig;
  private lightTargets = LIGHTING_TARGETS.studio;
  private shafts: THREE.Group;
  private timeScale = 1;
  private autoOrbit = false;
  private presetTarget = CAMERA_TARGETS.hero;
  private presetCurrent = { yaw: 0, pitch: 0, dist: 1 };
  private focusTarget = new THREE.Vector3();
  private focusCurrent = new THREE.Vector3();
  private focusDist = 1;
  private focusDistCurrent = 1;

  constructor(canvas: HTMLCanvasElement, labelsEl: HTMLElement, onReady?: () => void) {
    this.labelsEl = labelsEl;
    this.onReady = onReady;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(renderPixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050607);
    this.scene.fog = new THREE.FogExp2(0x050607, 0.017);

    this.camera = new THREE.PerspectiveCamera(
      40,
      window.innerWidth / window.innerHeight,
      0.1,
      300,
    );
    this.camera.position.set(7.4, 2, 9.2);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.04).texture;
    env.dispose();
    pmrem.dispose();

    this.lights = this.buildLights();
    this.gridHelper = this.buildGround();

    this.car = createSupercar();
    this.carGroup.add(this.car.group);
    this.scene.add(this.carGroup);

    this.bike = createSuperbike();
    this.bikeGroup.add(this.bike.group);
    this.bikeGroup.position.set(-9, 0, -6);
    this.bikeGroup.rotation.y = 0.18;
    this.scene.add(this.bikeGroup);

    this.aeroCar = new AeroFlow(buildCarStreamlines(), 720);
    this.aeroCar.setPointScale(renderPixelRatio());
    this.carGroup.add(this.aeroCar.group);
    this.aeroBike = new AeroFlow(buildBikeStreamlines(), 400);
    this.aeroBike.setPointScale(renderPixelRatio());
    this.bikeGroup.add(this.aeroBike.group);

    this.anchors = [
      ...this.car.anchors.map((a) => ({ ...a, group: this.carGroup })),
      ...this.bike.anchors.map((a) => ({ ...a, group: this.bikeGroup })),
    ];

    this.labelsEl
      .querySelectorAll<HTMLElement>("[data-anchor]")
      .forEach((el) => this.labels.set(el.dataset.anchor!, el));

    const streakData = this.buildStreaks();
    this.streaks = streakData.mesh;
    this.streakSpeeds = streakData.speeds;
    this.streakPositions = streakData.positions;
    this.scene.add(this.streaks);

    this.dust = this.buildDust();
    this.scene.add(this.dust);

    const tunnelData = this.buildTunnel();
    this.tunnel = tunnelData.group;
    this.endRing = tunnelData.endRing;
    this.tunnel.visible = false;
    this.scene.add(this.tunnel);

    this.shafts = this.buildShafts();
    this.scene.add(this.shafts);

    const bgGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 26),
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    bgGlow.position.set(0, 4.6, -112);
    this.scene.add(bgGlow);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(renderPixelRatio());
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.55,
      0.55,
      0.9,
    );
    this.composer.addPass(this.bloom);
    this.crt = new ShaderPass(CRTShader);
    this.composer.addPass(this.crt);
    this.composer.addPass(new OutputPass());

    this.onScroll = this.onScroll.bind(this);
    this.onPointer = this.onPointer.bind(this);
    this.onResize = this.onResize.bind(this);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointerdown", this.onDragStart);
    window.addEventListener("pointermove", this.onDragMove, { passive: true });
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragEnd);
    window.addEventListener("dblclick", this.onResetView);

    this.onScroll();
    this.progress = this.targetProgress;
    this.lastCameraPos.copy(this.camera.position);
    this.tick();
  }

  private buildLights(): LightRig {
    const hemi = new THREE.HemisphereLight(0x9fb4bd, 0x050607, 0.7);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(6, 9, 5);
    this.scene.add(key);

    const cool = new THREE.DirectionalLight(0x93b8d8, 1.7);
    cool.position.set(-7, 4, -9);
    this.scene.add(cool);

    const acid = new THREE.DirectionalLight(ACID, 1.35);
    acid.position.set(-5, 2, 4);
    this.scene.add(acid);

    const under = new THREE.PointLight(ACID, 6, 6, 2);
    under.position.set(0, 0.35, 0);
    this.scene.add(under);

    const bikeLight = new THREE.PointLight(ACID, 5, 8, 2);
    bikeLight.position.set(-9, 0.9, -4);
    this.scene.add(bikeLight);

    const rim = new THREE.PointLight(0xdff5ff, 22, 20, 2);
    rim.position.set(0, 4.5, -12);
    this.scene.add(rim);

    return { hemi, key, cool, acid, under, bikeLight, rim };
  }

  private buildShafts(): THREE.Group {
    const group = new THREE.Group();
    const texture = shaftTexture();
    const spots: Array<[number, number, number, number]> = [
      [-3.4, 6.4, -1.5, 0.3],
      [-0.6, 6.8, -3.2, 0.36],
      [2.4, 6.2, -0.6, 0.28],
      [-8.2, 6.0, -5.2, 0.34],
      [-10.4, 6.4, -7.4, 0.26],
    ];
    for (const [x, y, z, tilt] of spots) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.4, 15),
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: 0.04,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      mesh.position.set(x, y, z);
      mesh.rotation.set(0.24, 0.18, tilt);
      mesh.userData.tilt = tilt;
      group.add(mesh);
    }
    return group;
  }

  private buildGround(): THREE.GridHelper {
    const grid = new THREE.GridHelper(240, 240, 0x1d2a16, 0x111713);
    grid.position.y = 0.002;
    const gridMat = grid.material as unknown as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    this.scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({
        color: 0x070909,
        metalness: 0.8,
        roughness: 0.42,
        envMapIntensity: 0.35,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    this.scene.add(floor);

    const rings = [3.2, 5.2, 5.205, 6.6, 9.4, 14.2];
    rings.forEach((radius, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + (i === 2 ? 0.024 : 0.008), 128),
        new THREE.MeshBasicMaterial({
          color: i === 2 ? ACID : 0xaebdb3,
          transparent: true,
          opacity: i === 2 ? 0.7 : 0.14,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.012;
      this.scene.add(ring);
    });

    // Radar ticks
    const tickGeo = new THREE.BufferGeometry();
    const tickPositions: number[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r0 = 5.24;
      const r1 = i % 10 === 0 ? 5.5 : 5.36;
      tickPositions.push(Math.cos(a) * r0, 0.014, Math.sin(a) * r0);
      tickPositions.push(Math.cos(a) * r1, 0.014, Math.sin(a) * r1);
    }
    tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(tickPositions, 3));
    const ticks = new THREE.LineSegments(
      tickGeo,
      new THREE.LineBasicMaterial({
        color: 0xd8e6d6,
        transparent: true,
        opacity: 0.3,
        fog: false,
      }),
    );
    this.scene.add(ticks);

    // Bike stage ring
    const bikeRing = new THREE.Mesh(
      new THREE.RingGeometry(2.02, 2.16, 96),
      new THREE.MeshBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    bikeRing.rotation.x = -Math.PI / 2;
    bikeRing.position.set(-9, 0.014, -6);
    this.scene.add(bikeRing);

    return grid;
  }

  private buildStreaks(): {
    mesh: THREE.LineSegments;
    speeds: Float32Array;
    positions: Float32Array;
  } {
    const count = this.reducedMotion ? 70 : 360;
    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 6);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 3.4 + Math.random() * 13;
      const x = Math.cos(angle) * radius;
      const y = Math.random() * 7.5 + 0.1;
      const z = -95 + Math.random() * 115;
      const len = 0.8 + Math.random() * 3.4;
      positions.set([x, y, z, x, y, z + len], i * 6);
      const hot = Math.random() > 0.72;
      const c = hot ? [0.78, 1.0, 0.09] : [0.66, 0.74, 0.7];
      colors.set([...c, ...c], i * 6);
      speeds[i] = 12 + Math.random() * 42;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    return { mesh, speeds, positions };
  }

  private buildDust(): THREE.Points {
    const count = this.reducedMotion ? 300 : 1100;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 40;
      positions[i * 3 + 1] = Math.random() * 12;
      positions[i * 3 + 2] = -80 + Math.random() * 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xb8ccb4,
      size: 0.035,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    return new THREE.Points(geometry, material);
  }

  private buildTunnel(): {
    group: THREE.Group;
    endRing: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  } {
    const group = new THREE.Group();
    for (let i = 0; i < 22; i++) {
      const radius = 3.9 + i * 0.14;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.013 + (i % 5 === 0 ? 0.012 : 0), 4, 96),
        new THREE.MeshBasicMaterial({
          color: i % 6 === 0 ? 0xffffff : ACID,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      ring.position.set(0, 5, -24 - i * 4.1);
      group.add(ring);
    }

    const railGeo = new THREE.BufferGeometry();
    const rail: number[] = [];
    for (const x of [-5.2, 5.2]) {
      rail.push(x, 0.03, -18, x, 0.03, -112);
    }
    railGeo.setAttribute("position", new THREE.Float32BufferAttribute(rail, 3));
    group.add(
      new THREE.LineSegments(
        railGeo,
        new THREE.LineBasicMaterial({
          color: ACID,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          fog: false,
        }),
      ),
    );

    const endRing = new THREE.Mesh(
      new THREE.TorusGeometry(11, 0.06, 8, 128),
      new THREE.MeshBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    endRing.position.set(0, 5, -118);
    group.add(endRing);

    return { group, endRing };
  }

  private onScroll(): void {
    const max = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    this.targetProgress = Math.min(1, Math.max(0, window.scrollY / max));
  }

  private onPointer(event: PointerEvent): void {
    this.pointerTarget.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      (event.clientY / window.innerHeight) * 2 - 1,
    );
  }

  private heroVisible(): boolean {
    return window.scrollY <= window.innerHeight * 1.4;
  }

  private orbitTarget(event: Event): HTMLElement | null {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "a, button, input, textarea, select, label, [contenteditable], .terminal, .grid, .corelab, .ctl-shell, .aero-dock, .aero-launch, nav, header, footer",
      )
    ) {
      return null;
    }
    return target;
  }

  private onDragStart = (event: PointerEvent): void => {
    if (this.paused || event.button !== 0 || event.pointerType === "touch") return;
    if (!this.heroVisible() || !this.orbitTarget(event)) return;
    this.dragging = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastOrbitInput = performance.now();
    document.body.classList.add("is-orbiting");
  };

  private onDragMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = event.clientX - this.dragX;
    const dy = event.clientY - this.dragY;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.userYawT -= dx * 0.004;
    this.userPitchT = THREE.MathUtils.clamp(
      this.userPitchT + dy * 0.003,
      -0.45,
      0.45,
    );
    this.yawVel = -dx * 0.03;
    this.pitchVel = dy * 0.02;
    this.lastOrbitInput = performance.now();
  };

  private onDragEnd = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastOrbitInput = performance.now();
    document.body.classList.remove("is-orbiting");
  };

  private onResetView = (event: MouseEvent): void => {
    if (this.paused || !this.heroVisible() || !this.orbitTarget(event)) return;
    this.userYawT = 0;
    this.userPitchT = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastOrbitInput = performance.now();
  };

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(renderPixelRatio());
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(renderPixelRatio());
    this.composer.setSize(w, h);
    this.crt.uniforms.uRes.value.set(w, h);
    this.aeroCar.setPointScale(renderPixelRatio());
    this.aeroBike.setPointScale(renderPixelRatio());
  }

  // Catmull-Rom over the keyframes keeps keyframe pacing while making camera
  // velocity continuous across segment joints.
  private sampleTrack(
    points: THREE.Vector3[],
    p: number,
    out: THREE.Vector3,
  ): void {
    const keys = this.keyP;
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1]) i++;
    const span = Math.max(keys[i + 1] - keys[i], 1e-5);
    const t = Math.min(1, Math.max(0, (p - keys[i]) / span));
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    out.set(
      0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      0.5 *
        (2 * p1.z +
          (-p0.z + p2.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    );
  }

  private sampleCamera(p: number): void {
    let a = KEYFRAMES[0];
    let b = KEYFRAMES[KEYFRAMES.length - 1];
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (p >= KEYFRAMES[i].p && p <= KEYFRAMES[i + 1].p) {
        a = KEYFRAMES[i];
        b = KEYFRAMES[i + 1];
        break;
      }
    }
    const raw = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p);
    const t = smoothstep(raw);
    this.sampleTrack(this.posPoints, p, this.basePos);
    this.sampleTrack(this.tgtPoints, p, this.baseTarget);

    const mobile = this.camera.aspect < 0.9;
    if (mobile) {
      this.basePos
        .sub(this.baseTarget)
        .multiplyScalar(1.16)
        .add(this.baseTarget);
      this.basePos.y += 0.2;
    }

    const targetFov = THREE.MathUtils.lerp(a.fov, b.fov, t) + (mobile ? 9 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * 0.08;
    this.camera.updateProjectionMatrix();
  }

  private updateLabels(p: number): void {
    const v = new THREE.Vector3();
    for (const anchor of this.anchors) {
      const el = this.labels.get(anchor.id);
      if (!el) continue;
      const isBike = anchor.id.startsWith("bike");
      const range = isBike ? [0.28, 0.52] : [0.005, 0.31];
      const fadeIn = smoothstep((p - range[0]) / 0.03);
      const fadeOut = 1 - smoothstep((p - range[1]) / 0.03);
      const visibility = Math.min(fadeIn, fadeOut);

      v.copy(anchor.position);
      anchor.group.localToWorld(v);
      const world = v.clone();
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const inFront = v.z < 1 && v.z > -1;
      const onScreen = x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight;
      const show = visibility > 0.01 && inFront && onScreen;
      el.style.opacity = show ? String(visibility) : "0";
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      el.style.setProperty("--leader", String(Math.min(1, Math.max(0, v.z))));
      el.dataset.world = `${world.x.toFixed(1)},${world.y.toFixed(1)}`;
    }
  }

  setPaused(value: boolean): void {
    this.paused = value;
    if (!value) this.clock.getDelta();
  }

  configure(config: SceneConfig): void {
    this.aeroCar.setEnabled(config.aero && config.focus !== "bike");
    this.aeroBike.setEnabled(config.aero && config.focus !== "car");
    for (const flow of [this.aeroCar, this.aeroBike]) {
      flow.setWindSpeed(config.windSpeed);
      flow.setDensity(config.density);
      flow.setTurbulence(config.turbulence);
      flow.setTimeScale(config.timeScale);
      flow.setColorMode(config.colorMode);
    }
    this.timeScale = config.timeScale;
    this.autoOrbit = config.autoOrbit;
    this.gridHelper.visible = config.grid;
    this.bloom.strength = 0.18 + config.glow * 0.6;
    this.lightTargets = LIGHTING_TARGETS[config.lighting];
    this.presetTarget = CAMERA_TARGETS[config.camera];
    if (config.focus === "bike") {
      this.focusTarget.copy(this.bikeGroup.position).sub(this.carGroup.position);
      this.focusDist = 0.58;
    } else {
      this.focusTarget.set(0, 0, 0);
      this.focusDist = 1;
    }

    const livery =
      LIVERIES.find((entry) => entry.id === config.livery) ?? LIVERIES[0];
    this.car.paint.color.setHex(livery.hex);
    this.bike.accent.color.setHex(
      livery.id === "silver" || livery.id === "graphite" ? ACID : livery.hex,
    );
  }

  exportPNG(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.paused) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const adt = dt * this.timeScale;
    this.clockTime += adt;
    this.pointer.lerp(this.pointerTarget, 0.05);
    this.progress += (this.targetProgress - this.progress) * Math.min(1, dt * 6);
    const p = this.progress;
    const scrollSpeed =
      Math.abs(p - this.lastProgress) / Math.max(dt, 0.001);
    this.lastProgress = p;

    this.sampleCamera(p);
    this.camera.position.copy(this.basePos);
    this.camera.position.x += this.pointer.x * 0.55;
    this.camera.position.y += this.pointer.y * -0.28;
    this.lookTarget.copy(this.baseTarget);
    this.lookTarget.x += this.pointer.x * 0.35;
    this.lookTarget.y += this.pointer.y * -0.18;

    // User orbit layered over the cinematic path; drifts back when idle.
    const now = performance.now();
    if (!this.dragging) {
      if (this.autoOrbit && this.heroVisible()) {
        this.userYawT += dt * 0.14;
      } else {
        this.userYawT += this.yawVel * dt;
        this.userPitchT = THREE.MathUtils.clamp(
          this.userPitchT + this.pitchVel * dt,
          -0.45,
          0.45,
        );
        const decay = Math.exp(-dt * 3.2);
        this.yawVel *= decay;
        this.pitchVel *= decay;
        if (now - this.lastOrbitInput > 2800) {
          const ease = 1 - Math.exp(-dt * 1.3);
          this.userYawT += (0 - this.userYawT) * ease;
          this.userPitchT += (0 - this.userPitchT) * ease;
        }
      }
    }
    const orbitEase = 1 - Math.exp(-dt * 8);
    this.userYaw += (this.userYawT - this.userYaw) * orbitEase;
    this.userPitch += (this.userPitchT - this.userPitch) * orbitEase;
    this.orbitOffset.copy(this.camera.position).sub(this.lookTarget);
    this.orbitOffset.applyAxisAngle(UP_AXIS, this.userYaw);
    this.orbitOffset.applyAxisAngle(RIGHT_AXIS, this.userPitch);

    // Camera presets ease in over the orbit and fade out as the scroll
    // narrative leaves the hero, so the fly-through is never hijacked.
    const presetEase = 1 - Math.exp(-dt * 3.6);
    this.presetCurrent.yaw +=
      (this.presetTarget.yaw - this.presetCurrent.yaw) * presetEase;
    this.presetCurrent.pitch +=
      (this.presetTarget.pitch - this.presetCurrent.pitch) * presetEase;
    this.presetCurrent.dist +=
      (this.presetTarget.dist - this.presetCurrent.dist) * presetEase;
    const presetWeight = 1 - smoothstep((p - 0.16) / 0.16);
    this.orbitOffset.applyAxisAngle(
      UP_AXIS,
      this.presetCurrent.yaw * presetWeight,
    );
    this.orbitOffset.applyAxisAngle(
      RIGHT_AXIS,
      this.presetCurrent.pitch * presetWeight,
    );
    this.orbitOffset.multiplyScalar(
      1 + (this.presetCurrent.dist - 1) * presetWeight,
    );
    const focusEase = 1 - Math.exp(-dt * 3);
    this.focusCurrent.lerp(this.focusTarget, focusEase);
    this.focusDistCurrent += (this.focusDist - this.focusDistCurrent) * focusEase;
    this.orbitOffset.multiplyScalar(
      1 + (this.focusDistCurrent - 1) * presetWeight,
    );
    this.lookTarget.addScaledVector(this.focusCurrent, presetWeight);
    this.camera.position.copy(this.lookTarget).add(this.orbitOffset);

    if (!this.reducedMotion) {
      this.camera.position.x += Math.sin(this.clockTime * 0.42) * 0.045;
      this.camera.position.y += Math.cos(this.clockTime * 0.33) * 0.03;
    }

    this.camera.lookAt(this.lookTarget);
    if (!this.reducedMotion) {
      this.camera.rotateZ(
        THREE.MathUtils.clamp(this.yawVel * 0.4, -0.03, 0.03),
      );
    }

    this.carGroup.rotation.y = Math.sin(this.clockTime * 0.08) * 0.012;
    for (const wheel of this.car.wheels) {
      wheel.rotation.x += adt * 0.55;
    }
    this.car.engine.update(this.clockTime);
    this.bike.engine.update(this.clockTime);
    this.bikeGroup.position.y = Math.sin(this.clockTime * 0.6) * 0.008;
    this.bike.scan.position.y = 0.35 + ((this.clockTime * 0.42) % 1.4);
    this.bike.scan.material.opacity =
      0.16 + 0.3 * Math.abs(Math.sin((this.clockTime * 0.42 * Math.PI) % 1));
    this.bike.scan.visible = p > 0.24 && p < 0.56;

    this.aeroCar.update(dt);
    this.aeroBike.update(dt);

    // Lighting presets cross-fade instead of cutting.
    const lightEase = Math.min(1, dt * 3.4);
    const targets = this.lightTargets;
    (Object.keys(this.lights) as Array<keyof LightRig>).forEach((name) => {
      const light = this.lights[name];
      const target = targets.lights[name];
      light.intensity += (target.intensity - light.intensity) * lightEase;
      if (target.color) light.color.lerp(target.color, lightEase);
    });
    this.renderer.toneMappingExposure +=
      (targets.exposure - this.renderer.toneMappingExposure) * lightEase;

    this.shafts.children.forEach((child, index) => {
      const mesh = child as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      mesh.rotation.z =
        mesh.userData.tilt + Math.sin(this.clockTime * 0.12 + index * 1.7) * 0.06;
      mesh.material.opacity =
        0.03 + 0.014 * (0.5 + 0.5 * Math.sin(this.clockTime * 0.2 + index * 2.1));
    });

    if (p > 0.58) {
      this.tunnel.visible = true;
      const fade = smoothstep((p - 0.58) / 0.22);
      this.tunnel.children.forEach((child, index) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          const material = child.material as THREE.Material & { opacity: number };
          if ("opacity" in material) {
            const wave = 0.5 + 0.5 * Math.sin(this.clockTime * 2.1 - index * 0.55);
            material.opacity =
              fade * (0.14 + 0.28 * wave) * (index % 6 === 0 ? 1.3 : 1);
          }
        }
      });
      this.endRing.material.opacity = 0.25 + 0.55 * smoothstep((p - 0.85) / 0.15);
      (this.scene.fog as THREE.FogExp2).density = THREE.MathUtils.lerp(
        0.017,
        0.004,
        smoothstep((p - 0.62) / 0.3),
      );
    } else {
      this.tunnel.visible = false;
    }

    if (!this.reducedMotion) {
      const positions = this.streakPositions;
      const rush = 0.4 + Math.min(2.4, scrollSpeed * 26);
      for (let i = 0; i < this.streakSpeeds.length; i++) {
        const speed = this.streakSpeeds[i] * adt * rush;
        positions[i * 6 + 2] += speed;
        positions[i * 6 + 5] += speed;
        if (positions[i * 6 + 2] > 34) {
          const angle = Math.random() * Math.PI * 2;
          const radius = 3.4 + Math.random() * 13;
          const x = Math.cos(angle) * radius;
          const y = Math.random() * 7.5 + 0.1;
          const z = -95;
          const len = 0.8 + Math.random() * 3.4;
          positions.set([x, y, z, x, y, z + len], i * 6);
        }
      }
      this.streaks.geometry.attributes.position.needsUpdate = true;
      this.dust.rotation.y += adt * 0.004;
      this.dust.position.y = Math.sin(this.clockTime * 0.1) * 0.15;
    }

    const speed = this.camera.position.distanceTo(this.lastCameraPos) / Math.max(dt, 0.001);
    this.lastCameraPos.copy(this.camera.position);
    this.crt.uniforms.uTime.value = this.clockTime;
    this.crt.uniforms.uAberration.value = THREE.MathUtils.lerp(
      this.crt.uniforms.uAberration.value,
      1 + Math.min(speed * 0.16, 6),
      0.1,
    );

    this.updateLabels(p);
    this.composer.render();

    if (!this.readySent) {
      this.readySent = true;
      this.onReady?.();
    }
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointerdown", this.onDragStart);
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragEnd);
    window.removeEventListener("dblclick", this.onResetView);
    document.body.classList.remove("is-orbiting");
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => {
          if ("map" in material && material.map instanceof THREE.Texture) {
            material.map.dispose();
          }
          material.dispose();
        });
      }
    });
    this.renderer.dispose();
    this.composer.dispose();
  }
}
