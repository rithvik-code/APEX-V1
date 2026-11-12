import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createSupercar, badgeTexture, numberTexture, type Assembly, type VehicleAnchor } from "./car";
import { createSuperbike } from "./bike";
import { createGarage, type GarageHotspot, type GarageStage, type GarageTerminalState } from "./garage";
import { AeroFlow, buildBikeStreamlines, buildCarStreamlines } from "./aero";
import { WeatherSystem } from "./weather";
import { buildTrack, type Track } from "./track";
import {
  DriveSession,
  type DriveHudState,
  type DriveLapEvent,
  type DriveOptions,
  type DriveSetup,
  type DriveTouch,
  type DriveVehicle,
} from "./drive";
import {
  LIVERIES,
  type LightingPreset,
  type SceneConfig,
} from "../lib/scene";
import {
  ClipRecorder,
  newLapId,
  primeClipEncoder,
  sampleLap,
  type CameraSample,
  type LapRecording,
} from "../lib/clip";
import { REV_SHIFTS, sound } from "../lib/sound";

const ACID = 0xc8ff16;
const TUNNEL_DIVE_DURATION = 1.2;
const UP_AXIS = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);

const GARAGE_ENTRY_DURATION = 3.9;
const GARAGE_CAR_LIFT_Y = 0.36;
const GARAGE_CAR_HOVER_Y = 1.22;
const GARAGE_FIRST_FOV = 58;
const GARAGE_WALK_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ShiftLeft",
  "ShiftRight",
]);

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

export type GarageEvent =
  | { type: "focus"; id: string | null; label: string }
  | { type: "action"; id: string }
  | { type: "driveout"; vehicle: DriveVehicle };

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
  private portalFlare: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private tunnelDive = -1;
  private tunnelDiveFrom = new THREE.Vector3();
  private tunnelDiveTarget = new THREE.Vector3(0, 5, -116.6);
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
  private groundDecor: THREE.Group;
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
  private weather: WeatherSystem;
  private floorMat: THREE.MeshStandardMaterial;
  private explodeTarget = 0;
  private explodeCurrent = 0;
  private rpmTarget = 0.32;
  private rpmCurrent = 0.32;
  private dynoOn = false;
  private engineTime = 0;
  private carRoundels: THREE.Object3D[] = [];
  private assemblyLabels: Array<{ el: HTMLElement; assembly: Assembly }> = [];
  private clip: ClipRecorder | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lapSamples: CameraSample[] = [];
  private lapStart = 0;
  private lapConfig: SceneConfig | null = null;
  private recordingLap = false;
  private lastSampleAt = 0;
  private replay: LapRecording | null = null;
  private replayTime = 0;
  private replayPlaying = false;
  private ghostLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private replayPos = new THREE.Vector3();
  private replayTgt = new THREE.Vector3();
  private drive: DriveSession | null = null;
  private track: Track | null = null;
  private driveVehicle: DriveVehicle = "car";
  private lastConfig: SceneConfig | null = null;
  private savedCarPos = new THREE.Vector3();
  private savedCarRot = new THREE.Euler();
  private savedBikePos = new THREE.Vector3();
  private savedBikeRot = new THREE.Euler();
  private driveCamPos = new THREE.Vector3();
  private driveCamTgt = new THREE.Vector3();
  private driveWheelSpin = 0;
  private driveForward = new THREE.Vector3();
  private careerUnlocks: ReadonlySet<string> = new Set();
  private careerLicence = "ROOKIE";
  private careerBadgeLabel = "";
  private onDriveLap: ((lap: DriveLapEvent) => void) | null = null;

  /* ---- Garage mode -------------------------------------------------------- */

  private garageStage: GarageStage | null = null;
  private garageOn = false;
  private garageEntryT = GARAGE_ENTRY_DURATION;
  private garageWalk = new THREE.Vector3(0, 0, 6.3);
  private garageBob = 0;
  private garageLookYaw = 0;
  private garageLookYawT = 0;
  private garageLookPitch = -0.02;
  private garageLookPitchT = -0.02;
  private garageMoving = false;
  private garageKeys = new Set<string>();
  private garagePointerX = 0;
  private garagePointerY = 0;
  private garagePointerPX = 0;
  private garagePointerPY = 0;
  private garagePointerSeen = false;
  private garageSavedCarPos = new THREE.Vector3();
  private garageSavedCarRot = new THREE.Euler();
  private garageSavedBikePos = new THREE.Vector3();
  private garageSavedBikeRot = new THREE.Euler();
  private garageEntryFrom = new THREE.Vector3();
  private garageEntryEye = new THREE.Vector3();
  private garageEntryLook = new THREE.Vector3();
  private garageEntryTarget = new THREE.Vector3();
  private garageListener: ((event: GarageEvent) => void) | null = null;
  private garageFocus: GarageHotspot | null = null;
  private garageDoor = 1;
  private garageDoorTarget = 1;
  private garageLift = 0;
  private garageLiftTarget = 0;
  private garageService = false;
  private garageServiceOpen = 0;
  private garageSeated = false;
  private garageVirtualForward = 0;
  private garageVirtualStrafe = 0;
  private garageStepT = 0;
  private revHeld = false;
  private revWasActive = false;
  private revT = 0;
  private revGear = 0;
  private revKind: "car" | "bike" = "car";
  private revRpm = 0;
  private revKick = 0;
  private revReleaseAt = -1;
  private revReleaseFrom = 0;

  constructor(canvas: HTMLCanvasElement, labelsEl: HTMLElement, onReady?: () => void) {
    this.labelsEl = labelsEl;
    this.onReady = onReady;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    primeClipEncoder();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
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
      900,
    );
    this.camera.position.set(7.4, 2, 9.2);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = new RoomEnvironment();
    const envTarget = pmrem.fromScene(env, 0.04);
    this.envTarget = envTarget;
    this.scene.environment = envTarget.texture;
    env.dispose();
    pmrem.dispose();

    this.lights = this.buildLights();
    const ground = this.buildGround();
    this.gridHelper = ground.grid;
    this.floorMat = ground.floor;
    this.groundDecor = ground.decor;

    this.car = createSupercar();
    this.carGroup.add(this.car.group);
    this.scene.add(this.carGroup);
    this.car.group.traverse((object) => {
      if (object.userData.isNumber) this.carRoundels.push(object);
    });
    this.weather = new WeatherSystem(
      this.scene,
      this.carGroup,
      this.floorMat,
      this.reducedMotion,
    );

    for (const assembly of this.car.assemblies) {
      const el = document.createElement("div");
      el.className = "assembly-label";
      el.textContent = assembly.label;
      el.style.opacity = "0";
      this.labelsEl.appendChild(el);
      this.assemblyLabels.push({ el, assembly });
    }

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

    this.portalFlare = new THREE.Mesh(
      new THREE.CircleGeometry(11.4, 64),
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: ACID,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.portalFlare.position.set(0, 5, -117.8);
    this.portalFlare.visible = false;
    this.scene.add(this.portalFlare);

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
    window.addEventListener("pointermove", this.onPointerLook, { passive: true });
    window.addEventListener("pointerout", this.onPointerOut);
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragEnd);
    window.addEventListener("dblclick", this.onResetView);
    window.addEventListener("keydown", this.onGarageKeyDown);
    window.addEventListener("keyup", this.onGarageKeyUp);
    this.onScroll();
    this.progress = this.targetProgress;
    this.lastCameraPos.copy(this.camera.position);
    if (import.meta.env.DEV) {
      (window as unknown as { __apexEngine?: ApexEngine }).__apexEngine = this;
    }
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

  private buildGround(): { grid: THREE.GridHelper; floor: THREE.MeshStandardMaterial; decor: THREE.Group } {
    const grid = new THREE.GridHelper(240, 240, 0x1d2a16, 0x111713);
    grid.position.y = 0.002;
    const gridMat = grid.material as unknown as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.5;
    this.scene.add(grid);

    const decor = new THREE.Group();
    this.scene.add(decor);

    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x070909,
      metalness: 0.8,
      roughness: 0.42,
      envMapIntensity: 0.35,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    decor.add(floor);

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
      decor.add(ring);
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
    decor.add(ticks);

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
    decor.add(bikeRing);

    return { grid, floor: floorMat, decor };
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

  private updateTunnelDive(dt: number): void {
    this.tunnelDive += dt;
    const raw = THREE.MathUtils.clamp(
      this.tunnelDive / TUNNEL_DIVE_DURATION,
      0,
      1,
    );
    const t = Math.pow(raw, 2.4);
    this.camera.position.lerpVectors(this.tunnelDiveFrom, this.tunnelDiveTarget, t);
    const shake = (1 - t) * 0.16;
    this.camera.position.x += Math.sin(raw * 46) * shake;
    this.camera.position.y += Math.cos(raw * 39) * shake * 0.7;
    this.camera.lookAt(0, 5, -160);
    this.camera.rotateZ(Math.sin(raw * Math.PI) * 0.06);
    this.camera.fov = THREE.MathUtils.lerp(62, 108, Math.pow(raw, 1.6));
    this.camera.updateProjectionMatrix();

    this.tunnel.visible = true;
    this.tunnel.children.forEach((child, index) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        const material = child.material as THREE.Material & { opacity: number };
        if ("opacity" in material) {
          const wave = 0.5 + 0.5 * Math.sin(this.clockTime * 16 - index * 0.9);
          material.opacity = 0.25 + 0.5 * wave;
        }
      }
    });
    this.endRing.material.opacity = 0.7 + raw * 0.3;
    this.portalFlare.visible = true;
    this.portalFlare.material.opacity = Math.min(
      1,
      0.12 + Math.pow(raw, 2.6) * 1.1,
    );
    this.portalFlare.scale.setScalar(0.35 + Math.pow(raw, 1.4) * 1.15);
    (this.scene.fog as THREE.FogExp2).density = 0.004;
  }

  startTunnelEntry(): boolean {
    if (this.garageOn || this.drive) return false;
    this.tunnelDive = 0;
    this.tunnelDiveFrom.copy(this.camera.position);
    this.tunnel.visible = true;
    this.portalFlare.visible = true;
    return true;
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
    const target = event.target;
    if (!(target instanceof Element)) return null;
    if (
      target.closest(
        "a, button, input, textarea, select, label, [contenteditable], .terminal, .grid, .corelab, .ctl-shell, .aero-dock, .aero-launch, .drive-hud, .garage__panel, .garage__bar, .garage__hint, nav, header, footer",
      )
    ) {
      return null;
    }
    return target as HTMLElement;
  }

  private onDragStart = (event: PointerEvent): void => {
    if (this.paused || this.drive || event.button !== 0) return;
    if (this.garageOn) {
      // Touch keeps drag-to-look; a mouse simply moves to look.
      if (event.pointerType !== "touch" || !this.orbitTarget(event)) return;
      this.dragging = true;
      this.dragX = event.clientX;
      this.dragY = event.clientY;
      this.lastOrbitInput = performance.now();
      return;
    }
    if (event.pointerType === "touch") return;
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
    if (this.garageOn) {
      this.garageLookYawT -= dx * 0.004;
      this.garageLookPitchT = THREE.MathUtils.clamp(
        this.garageLookPitchT - dy * 0.003,
        -1.15,
        1.15,
      );
      return;
    }
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

  // First-person garage look: moving the pointer turns the head, no button
  // held. Deltas are ignored over the overlay so clicking REV or the door
  // button never yanks the camera.
  private onPointerLook = (event: PointerEvent): void => {
    if (!this.garageOn || this.paused || this.drive) {
      this.garagePointerSeen = false;
      return;
    }
    const overScene = this.orbitTarget(event) !== null;
    const nx = (event.clientX / window.innerWidth) * 2 - 1;
    const ny = (event.clientY / window.innerHeight) * 2 - 1;
    this.garagePointerX = overScene ? THREE.MathUtils.clamp(nx, -1, 1) : 0;
    this.garagePointerY = overScene ? THREE.MathUtils.clamp(ny, -1, 1) : 0;
    if (event.pointerType === "touch") return;
    if (!this.garagePointerSeen) {
      this.garagePointerSeen = true;
      this.garagePointerPX = event.clientX;
      this.garagePointerPY = event.clientY;
      return;
    }
    const dx = event.clientX - this.garagePointerPX;
    const dy = event.clientY - this.garagePointerPY;
    this.garagePointerPX = event.clientX;
    this.garagePointerPY = event.clientY;
    if ((!dx && !dy) || !overScene) return;
    this.garageLookYawT -= dx * 0.003;
    this.garageLookPitchT = THREE.MathUtils.clamp(
      this.garageLookPitchT - dy * 0.0024,
      -1.05,
      1.05,
    );
  };

  private onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget) return;
    this.garagePointerX = 0;
    this.garagePointerY = 0;
    this.garagePointerSeen = false;
  };

  private onDragEnd = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.lastOrbitInput = performance.now();
    document.body.classList.remove("is-orbiting");
  };

  private onResetView = (event: MouseEvent): void => {
    if (this.paused || this.drive) return;
    if (this.garageOn) {
      if (!this.orbitTarget(event)) return;
      this.garageWalk.set(4.4, 0, 5.6);
      this.garageBob = 0;
      this.garageLookYaw = 0.7;
      this.garageLookYawT = 0.7;
      this.garageLookPitch = -0.04;
      this.garageLookPitchT = -0.04;
      return;
    }
    if (!this.heroVisible() || !this.orbitTarget(event)) return;
    this.userYawT = 0;
    this.userPitchT = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.lastOrbitInput = performance.now();
  };

  private onGarageKeyDown = (event: KeyboardEvent): void => {
    if (!this.garageOn) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable]")
    ) {
      return;
    }
    if (event.code === "KeyE") {
      event.preventDefault();
      this.garageInteract();
      return;
    }
    if (event.code === "KeyP") {
      event.preventDefault();
      this.emitGarage({ type: "action", id: "photo" });
      return;
    }
    if (!GARAGE_WALK_KEYS.has(event.code)) return;
    event.preventDefault();
    this.garageKeys.add(event.code);
  };

  private onGarageKeyUp = (event: KeyboardEvent): void => {
    this.garageKeys.delete(event.code);
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

  private updateAssemblyLabels(): void {
    const show = this.explodeCurrent > 0.04;
    const v = new THREE.Vector3();
    for (const { el, assembly } of this.assemblyLabels) {
      if (!show) {
        el.style.opacity = "0";
        continue;
      }
      assembly.group.getWorldPosition(v);
      v.y += 0.35;
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const inFront = v.z < 1 && v.z > -1;
      el.style.opacity = inFront
        ? String(Math.min(1, this.explodeCurrent * 1.5))
        : "0";
      el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    }
  }

  configure(config: SceneConfig): void {
    this.lastConfig = config;
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
    this.explodeTarget = config.explode;
    this.rpmTarget = config.rpm;
    this.dynoOn = config.dyno;
    this.weather.configure(config);
    if (config.focus === "bike") {
      this.focusTarget.copy(this.bikeGroup.position).sub(this.carGroup.position);
      this.focusDist = 0.58;
    } else {
      this.focusTarget.set(0, 0, 0);
      this.focusDist = 1;
    }

    const livery =
      LIVERIES.find((entry) => entry.id === config.livery) ?? LIVERIES[0];

    if (config.paint.enabled) {
      // Livery painter overrides the preset swatches with a custom scheme.
      this.car.paint.color.set(config.paint.base);
      for (const material of this.car.accentMats) material.color.set(config.paint.accent);
      (this.car.stripe.material as THREE.MeshBasicMaterial).color.set(config.paint.accent);
      this.car.stripe.visible = config.paint.stripe;
      this.car.numberMat.map?.dispose();
      this.car.numberMat.map = numberTexture(config.paint.number, config.paint.accent);
      this.car.numberMat.needsUpdate = true;
      for (const roundel of this.carRoundels) roundel.visible = true;
      this.bike.accent.color.set(config.paint.accent);
    } else {
      this.car.paint.color.setHex(livery.hex);
      for (const material of this.car.accentMats) material.color.setHex(ACID);
      this.car.stripe.visible = false;
      for (const roundel of this.carRoundels) roundel.visible = false;
      this.bike.accent.color.setHex(
        livery.id === "silver" || livery.id === "graphite" ? ACID : livery.hex,
      );
    }
    this.applyCareerVisuals();
    if (this.drive) this.applyDriveVisibility();
    if (this.garageOn) {
      this.aeroCar.setEnabled(false);
      this.aeroBike.setEnabled(false);
      this.gridHelper.visible = false;
      this.labelsEl.style.opacity = "0";
      this.carGroup.visible = true;
      this.bikeGroup.visible = true;
    }
  }

  /* ---- Constructor Series cosmetic unlocks -------------------------------- */

  setCareer(unlocks: ReadonlySet<string>, licence: string): void {
    this.careerUnlocks = new Set(unlocks);
    this.careerLicence = licence;
    this.applyCareerVisuals();
    this.drive?.setGhostTrail(unlocks.has("ghostTrail"));
  }

  setDriveLapListener(listener: ((lap: DriveLapEvent) => void) | null): void {
    this.onDriveLap = listener;
  }

  private applyCareerVisuals(): void {
    const u = this.careerUnlocks;
    const c = this.car.career;
    const show = (objects: THREE.Object3D[], on: boolean) => {
      for (const object of objects) object.visible = on;
    };

    show(c.wheelCovers, u.has("wheelCovers"));
    show(c.canards, u.has("canards"));
    show(c.gurney, u.has("gurney"));
    show(c.plateFrames, u.has("plateFrame") && this.carRoundels.some((r) => r.visible));
    show(c.soot, u.has("soot"));
    show(c.veteran, u.has("veteran"));
    show(c.fullKit, u.has("fullKit"));

    const badgeOn = u.has("wingBadge") || u.has("veteran");
    c.badgeMesh.visible = badgeOn;
    const badgeLabel = u.has("veteran") ? "VETERAN" : this.careerLicence;
    if (badgeOn && badgeLabel !== this.careerBadgeLabel) {
      this.careerBadgeLabel = badgeLabel;
      c.badgeMat.map?.dispose();
      c.badgeMat.map = badgeTexture(badgeLabel);
      c.badgeMat.needsUpdate = true;
    }

    show(c.flames, u.has("flame"));
    c.flameMat.opacity = u.has("flame") ? 0.5 : 0;
    c.cockpitGlow.opacity = u.has("cockpitGlow") ? 0.5 : 0;

    this.car.headlamp.color.setHex(u.has("headlamp") ? 0xd8f4ff : 0xf2ffe0);

    if (u.has("chrome")) {
      this.car.paint.color.setHex(0xd7dee4);
      this.car.paint.metalness = 1;
      this.car.paint.roughness = 0.05;
      this.car.paint.clearcoat = 1;
    } else if (u.has("wear")) {
      this.car.paint.roughness = 0.34;
      this.car.paint.clearcoat = 0.45;
    } else {
      this.car.paint.roughness = 0.17;
      this.car.paint.clearcoat = 1;
    }

    const bikeBody = this.bike.career.bodyMat;
    bikeBody.color.setHex(u.has("chrome") ? 0xcfd6dc : 0x121518);
    bikeBody.metalness = u.has("chrome") ? 1 : 0.9;
    bikeBody.roughness = u.has("chrome") ? 0.06 : u.has("wear") ? 0.38 : 0.26;

    this.bike.career.tailStrip.visible = u.has("tailStrip");
    this.bike.career.tailStripMat.opacity = u.has("tailStrip") ? 0.5 : 0;

    // Pulsing accent is animated in animateCareer; reset baselines here.
    this.car.accentMats[1].opacity = 0.55;
    this.bike.accent.opacity = 0.85;

    this.garageStage?.setDiecast(u);
  }

  private animateCareer(): void {
    if (this.careerUnlocks.has("flame")) {
      const flick = 0.55 + 0.45 * Math.abs(Math.sin(this.clockTime * 31));
      this.car.career.flameMat.opacity = 0.28 + flick * 0.34;
      for (const flame of this.car.career.flames) {
        flame.scale.set(0.85 + flick * 0.4, 0.7 + flick * 0.7, 0.85 + flick * 0.4);
      }
    }
    if (this.careerUnlocks.has("pulse")) {
      const wave = 0.5 + 0.5 * Math.sin(this.clockTime * 5.2);
      this.car.accentMats[1].opacity = 0.35 + wave * 0.4;
      this.bike.accent.opacity = 0.55 + wave * 0.4;
      this.bike.career.tailStripMat.opacity = 0.35 + wave * 0.35;
    }
  }

  private animateRev(dt: number): void {
    const car = this.car;
    const releasing = this.revReleaseAt >= 0;
    if (!this.revHeld && !releasing) {
      if (!this.revWasActive) return;
      this.revWasActive = false;
      this.revRpm = 0;
      this.revKick = 0;
      if (!this.dynoOn) car.exhaustGlow.opacity = 0;
      for (const flame of car.career.flames) flame.scale.set(1, 1, 1);
      this.applyCareerVisuals();
      return;
    }

    const shifts = REV_SHIFTS[this.revKind];
    let target: number;
    if (releasing) {
      this.revReleaseAt += dt;
      const r = this.revReleaseAt;
      const flicker = r < 0.34 ? Math.sin(r * 84) * 0.05 * (1 - r / 0.34) : 0;
      target = Math.max(0, this.revReleaseFrom * Math.exp(-r * 4.6) + flicker);
      this.revKick *= Math.exp(-dt * 9);
      if (r > 0.58) {
        this.revReleaseAt = -1;
        this.revRpm = 0;
        this.revKick = 0;
      }
    } else {
      this.revT += dt;
      const t = this.revT;
      let gear = 0;
      while (gear < shifts.length && t >= shifts[gear]) gear++;
      const sinceShift = t - (gear > 0 ? shifts[gear - 1] : 0);
      if (gear !== this.revGear) {
        // Ignition cut: the needle blips down and the exhaust cracks.
        this.revKick = 1;
        this.revGear = gear;
      }
      this.revKick *= Math.exp(-dt * 11);
      if (gear >= shifts.length) {
        target = 0.955 + Math.sin(this.clockTime * 46) * 0.035;
      } else {
        const start = gear > 0 ? shifts[gear - 1] : 0;
        const u = THREE.MathUtils.clamp((t - start) / (shifts[gear] - start), 0, 1);
        target = 0.18 + Math.pow(u, 0.75) * 0.78;
        if (sinceShift < 0.07) target *= 0.72;
      }
    }

    this.revRpm += (target - this.revRpm) * (1 - Math.exp(-dt * 22));
    this.revRpm = Math.min(1.12, this.revRpm);
    this.engineTime += dt * (this.revRpm + this.revKick * 0.5) * 14;

    if (this.revKind === "car") {
      car.exhaustGlow.opacity =
        0.16 + this.revRpm * 0.8 + this.revKick * 0.35;
      for (const flame of car.career.flames) {
        const kick = this.revKick * 0.8;
        const s = 0.75 + this.revRpm * 1.7 + kick + Math.random() * 0.25 * this.revRpm;
        flame.scale.set(s, s * (0.7 + this.revRpm * 1.1), s);
      }
      if (this.careerUnlocks.has("flame")) {
        car.career.flameMat.opacity =
          Math.min(1, 0.3 + this.revRpm * 0.5 + this.revKick * 0.25);
      }
    } else {
      this.bike.accent.opacity = 0.5 + this.revRpm * 0.5;
      if (this.careerUnlocks.has("tailStrip")) {
        this.bike.career.tailStripMat.opacity = 0.25 + this.revRpm * 0.55;
      }
    }
  }

  exportPNG(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
  }

  /* ---- Cinematic WebM capture ------------------------------------------- */

  startClip(provider: () => string[]): boolean {
    if (this.clip || typeof MediaRecorder === "undefined") return false;
    try {
      this.clip = new ClipRecorder(this.renderer.domElement, provider);
      this.clip.start();
      return true;
    } catch {
      this.clip = null;
      return false;
    }
  }

  async stopClip(): Promise<Blob | null> {
    if (!this.clip) return null;
    const clip = this.clip;
    this.clip = null;
    return clip.stop();
  }

  get isClipping(): boolean {
    return this.clip !== null;
  }

  /* ---- Ghost lap recording ---------------------------------------------- */

  startLap(config: SceneConfig): void {
    this.stopLapReplay();
    this.lapSamples = [];
    this.lapConfig = { ...config, paint: { ...config.paint } };
    this.lapStart = performance.now();
    this.lastSampleAt = 0;
    this.recordingLap = true;
  }

  stopLap(): LapRecording | null {
    if (!this.recordingLap) return null;
    this.recordingLap = false;
    const duration = (performance.now() - this.lapStart) / 1000;
    if (this.lapSamples.length < 2 || !this.lapConfig) return null;
    return {
      id: newLapId(),
      name: `LAP ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      createdAt: Date.now(),
      duration,
      samples: this.lapSamples,
      config: this.lapConfig,
    };
  }

  get isRecordingLap(): boolean {
    return this.recordingLap;
  }

  get lapElapsed(): number {
    return this.recordingLap ? (performance.now() - this.lapStart) / 1000 : 0;
  }

  /* ---- Ghost lap replay -------------------------------------------------- */

  playLap(lap: LapRecording): void {
    this.replay = lap;
    this.replayTime = 0;
    this.replayPlaying = true;
    this.buildGhostLine(lap);
  }

  pauseLap(): void {
    this.replayPlaying = false;
  }

  resumeLap(): void {
    if (!this.replay) return;
    if (this.replayTime >= this.replay.duration) this.replayTime = 0;
    this.replayPlaying = true;
  }

  seekLap(time: number): void {
    if (!this.replay) return;
    this.replayTime = Math.min(this.replay.duration, Math.max(0, time));
    this.replayPlaying = false;
  }

  stopLapReplay(): void {
    this.replay = null;
    this.replayPlaying = false;
    this.clearGhostLine();
  }

  get isReplaying(): boolean {
    return this.replay !== null;
  }

  get replayPaused(): boolean {
    return this.replay !== null && !this.replayPlaying;
  }

  get replayDuration(): number {
    return this.replay?.duration ?? 0;
  }

  get currentReplayTime(): number {
    return this.replayTime;
  }

  private buildGhostLine(lap: LapRecording): void {
    this.clearGhostLine();
    if (lap.samples.length < 2) return;
    const points = lap.samples.map((s) => new THREE.Vector3(...s.pos));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.ghostLine = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(this.ghostLine);
  }

  private clearGhostLine(): void {
    if (!this.ghostLine) return;
    this.scene.remove(this.ghostLine);
    this.ghostLine.geometry.dispose();
    this.ghostLine.material.dispose();
    this.ghostLine = null;
  }

  /* ---- Time attack ------------------------------------------------------ */

  get driveActive(): boolean {
    return this.drive !== null;
  }

  /* ---- Garage mode -------------------------------------------------------- */

  get garageActive(): boolean {
    return this.garageOn;
  }

  get garageDoorOpen(): boolean {
    return this.garageDoorTarget > 0.5;
  }

  get garageLiftRaised(): boolean {
    return this.garageLiftTarget > 0.5;
  }

  get garageServiceMode(): boolean {
    return this.garageService;
  }

  setGarageListener(listener: ((event: GarageEvent) => void) | null): void {
    this.garageListener = listener;
  }

  private emitGarage(event: GarageEvent): void {
    this.garageListener?.(event);
  }

  setGarageMove(forward: number, strafe: number): void {
    this.garageVirtualForward = THREE.MathUtils.clamp(forward, -1, 1);
    this.garageVirtualStrafe = THREE.MathUtils.clamp(strafe, -1, 1);
    if (forward || strafe) this.garageSeated = false;
  }

  toggleGarageDoor(): boolean {
    this.garageDoorTarget = this.garageDoorTarget > 0.5 ? 0 : 1;
    this.saveGarageState();
    return this.garageDoorTarget > 0.5;
  }

  toggleGarageLift(): boolean {
    this.garageLiftTarget = this.garageLiftTarget > 0.5 ? 0 : 1;
    this.garageService = false;
    this.saveGarageState();
    return this.garageLiftTarget > 0.5;
  }

  setGarageService(on: boolean): void {
    this.garageService = on;
    this.garageLiftTarget = on ? 1 : 0;
    this.saveGarageState();
  }

  sitGarage(): void {
    this.garageSeated = true;
    this.garageWalk.set(2.85, 0, -6.55);
    this.garageLookYaw = Math.PI;
    this.garageLookYawT = Math.PI;
    this.garageLookPitch = -0.08;
    this.garageLookPitchT = -0.08;
    this.garageBob = 0;
  }

  setGarageWeather(wet: boolean, night: boolean): void {
    this.garageStage?.setWeather(wet, night);
  }

  setGarageTrophies(count: number): void {
    this.garageStage?.setTrophies(count);
  }

  setGarageTerminal(patch: Partial<GarageTerminalState>): void {
    this.garageStage?.setTerminal(patch);
  }

  private garageInteract(): void {
    if (!this.garageFocus) return;
    const id = this.garageFocus.id;
    if (id === "car" || id === "bike") {
      this.emitGarage({ type: "driveout", vehicle: id });
      return;
    }
    this.emitGarage({ type: "action", id });
  }

  private loadGarageState(): void {
    try {
      const raw = localStorage.getItem("apex.garage.state.v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { door?: unknown; lift?: unknown; service?: unknown };
      this.garageDoorTarget = parsed.door === false ? 0 : 1;
      this.garageLiftTarget = parsed.lift === true ? 1 : 0;
      this.garageService = parsed.service === true;
      if (this.garageService) this.garageLiftTarget = 1;
    } catch {
      // Storage can be unavailable; the bay simply starts at defaults.
    }
  }

  private saveGarageState(): void {
    try {
      localStorage.setItem(
        "apex.garage.state.v1",
        JSON.stringify({
          door: this.garageDoorTarget > 0.5,
          lift: this.garageLiftTarget > 0.5,
          service: this.garageService,
        }),
      );
    } catch {
      // Non-fatal: state simply will not survive a reload.
    }
  }

  captureFrame(): string {
    this.composer.render();
    const source = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext("2d");
    if (!ctx) return source.toDataURL("image/png");
    ctx.drawImage(source, 0, 0);

    // Every frame leaves the bay with the APEX mark and the maker's name.
    const w = out.width;
    const h = out.height;
    const unit = Math.max(1, Math.min(w, h) / 900);
    const pad = 34 * unit;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(9,11,9,0.42)";
    ctx.fillRect(0, h - 132 * unit, 420 * unit, 132 * unit);
    ctx.fillStyle = "#c8ff16";
    ctx.font = `800 ${Math.round(52 * unit)}px Archivo, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText("APEX", pad, h - 66 * unit);
    ctx.fillStyle = "rgba(233,237,232,0.86)";
    ctx.font = `600 ${Math.round(17 * unit)}px "IBM Plex Mono", "Courier New", monospace`;
    ctx.fillText("MADE BY RITHVIK", pad, h - 38 * unit);
    ctx.fillStyle = "rgba(200,255,22,0.85)";
    ctx.fillRect(pad, h - 92 * unit, 150 * unit, 3 * unit);

    ctx.fillStyle = "rgba(9,11,9,0.42)";
    ctx.fillRect(w - 250 * unit, pad - 22 * unit, 216 * unit, 44 * unit);
    ctx.fillStyle = "rgba(233,237,232,0.86)";
    ctx.font = `600 ${Math.round(15 * unit)}px "IBM Plex Mono", "Courier New", monospace`;
    ctx.fillText("BAY 01 / PRIVATE GARAGE", w - 250 * unit + 12 * unit, pad + 6 * unit);

    return out.toDataURL("image/png");
  }

  enterGarage(): void {
    if (this.drive) this.exitDrive();
    this.stopLap();
    this.stopLapReplay();

    this.garageSavedCarPos.copy(this.carGroup.position);
    this.garageSavedCarRot.copy(this.carGroup.rotation);
    this.garageSavedBikePos.copy(this.bikeGroup.position);
    this.garageSavedBikeRot.copy(this.bikeGroup.rotation);

    if (!this.garageStage) {
      this.garageStage = createGarage();
      this.scene.add(this.garageStage.group);
    }
    const stage = this.garageStage;
    stage.group.visible = true;
    stage.setDoor(0);
    stage.setLights(0);
    this.loadGarageState();
    stage.setLift(0);
    this.garageLift = 0;
    this.garageDoor = 1;
    this.garageSeated = false;
    this.garageVirtualForward = 0;
    this.garageVirtualStrafe = 0;
    this.garageFocus = null;
    stage.setActiveHotspot(null);
    this.emitGarage({ type: "focus", id: null, label: "" });
    stage.setWeather(
      this.lastConfig?.weather === "rain",
      Boolean(this.lastConfig?.nightRace),
    );
    sound.startIdle("car");

    this.garageOn = true;
    this.garageEntryT = 0;
    this.garageWalk.set(4.4, 0, 5.6);
    this.garageBob = 0;
    this.garageLookYaw = 0.7;
    this.garageLookYawT = 0.7;
    this.garageLookPitch = -0.04;
    this.garageLookPitchT = -0.04;
    this.garagePointerX = 0;
    this.garagePointerY = 0;
    this.garagePointerSeen = false;
    this.garageKeys.clear();
    this.dragging = false;
    this.revHeld = false;
    this.revWasActive = false;
    this.revReleaseAt = -1;
    this.revRpm = 0;
    this.revKick = 0;

    this.carGroup.position.set(0, GARAGE_CAR_HOVER_Y, 0.2);
    this.carGroup.rotation.set(0, 0, 0);
    this.bikeGroup.position.set(5.5, 0, 3.4);
    this.bikeGroup.rotation.set(0, -0.35, 0);
    for (const wheel of this.car.wheels) {
      wheel.rotation.y = 0;
      wheel.position.x = wheel.userData.baseX as number;
    }

    this.tunnel.visible = false;
    this.tunnelDive = -1;
    this.portalFlare.visible = false;
    this.portalFlare.material.opacity = 0;
    this.shafts.visible = false;
    this.streaks.visible = false;
    this.dust.visible = false;
    this.gridHelper.visible = false;
    this.groundDecor.visible = false;
    this.bike.scan.visible = false;
    this.labelsEl.style.opacity = "0";
    this.aeroCar.setEnabled(false);
    this.aeroBike.setEnabled(false);
    this.applyCareerVisuals();

    // The studio rig is omnidirectional and would shine straight through the
    // garage walls; dim it and let the bay fixtures carry the room.
    (Object.keys(this.lights) as Array<keyof LightRig>).forEach((name) => {
      this.lights[name].intensity *= 0.05;
    });

    (this.scene.fog as THREE.FogExp2).density = 0.022;
    this.scene.environmentIntensity = 0.6;
    if (this.lastConfig) this.weather.configure({ ...this.lastConfig, weather: "clear" });

    this.camera.rotation.order = "XYZ";
    this.camera.fov = 56;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 2.1, 14.6);
    this.camera.lookAt(0, 1.15, 0.2);
  }

  exitGarage(): void {
    if (!this.garageOn) return;
    this.garageOn = false;
    this.garageKeys.clear();
    this.garageVirtualForward = 0;
    this.garageVirtualStrafe = 0;
    this.garageSeated = false;
    this.garageFocus = null;
    this.garageStage?.setActiveHotspot(null);
    sound.stopIdle();
    this.dragging = false;
    this.revHeld = false;
    this.revWasActive = false;
    this.revReleaseAt = -1;
    this.revRpm = 0;
    this.revKick = 0;
    document.body.classList.remove("is-orbiting");

    if (this.garageStage) {
      this.garageStage.setDoor(0);
      this.garageStage.setLights(0);
      this.garageStage.group.visible = false;
    }

    this.carGroup.position.copy(this.garageSavedCarPos);
    this.carGroup.rotation.copy(this.garageSavedCarRot);
    this.bikeGroup.position.copy(this.garageSavedBikePos);
    this.bikeGroup.rotation.copy(this.garageSavedBikeRot);
    for (const wheel of this.car.wheels) {
      wheel.rotation.y = 0;
      wheel.position.x = wheel.userData.baseX as number;
    }

    this.applyShowroomVisibility();
    this.car.exhaustGlow.opacity = 0;
    this.car.career.flameMat.opacity = this.careerUnlocks.has("flame") ? 0.5 : 0;
    for (const flame of this.car.career.flames) flame.scale.set(1, 1, 1);

    this.camera.rotation.order = "XYZ";
    this.camera.fov = 40;
    this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.FogExp2).density = 0.017;
    this.scene.environmentIntensity = 1;
    if (this.lastConfig) this.configure(this.lastConfig);
  }

  replayGarageEntry(): void {
    if (!this.garageOn) return;
    this.garageEntryT = 0;
    this.garageStage?.setDoor(0);
    this.garageStage?.setLights(0);
    this.carGroup.position.set(0, GARAGE_CAR_HOVER_Y, 0.2);
    this.carGroup.rotation.set(0, 0, 0);
    this.revHeld = false;
    this.revWasActive = false;
    this.revReleaseAt = -1;
    this.revRpm = 0;
    this.revKick = 0;
  }

  startRev(vehicle: "car" | "bike"): void {
    if (this.drive) return;
    if (this.revHeld && this.revKind === vehicle) return;
    this.revHeld = true;
    this.revWasActive = true;
    this.revT = 0;
    this.revGear = 0;
    this.revKind = vehicle;
    this.revReleaseAt = -1;
    this.revReleaseFrom = 0;
  }

  endRev(): void {
    if (!this.revHeld) return;
    this.revHeld = false;
    this.revReleaseAt = 0;
    this.revReleaseFrom = Math.max(0.3, this.revRpm);
  }

  enterDrive(vehicle: DriveVehicle, setup: DriveSetup, options: DriveOptions): void {
    const wasDriving = this.drive !== null;
    if (!wasDriving) {
      this.savedCarPos.copy(this.carGroup.position);
      this.savedCarRot.copy(this.carGroup.rotation);
      this.savedBikePos.copy(this.bikeGroup.position);
      this.savedBikeRot.copy(this.bikeGroup.rotation);
    }
    this.drive?.dispose();
    // A lap started in the showroom would otherwise keep sampling through the
    // whole drive and save a replay with a huge camera jump.
    this.stopLap();
    if (!this.track) {
      this.track = buildTrack();
      this.scene.add(this.track.group);
    }
    this.track.group.visible = true;
    this.driveVehicle = vehicle;

    this.explodeTarget = 0;
    this.explodeCurrent = 0;
    this.revHeld = false;
    this.revWasActive = false;
    this.revReleaseAt = -1;
    this.revRpm = 0;
    this.revKick = 0;
    for (const assembly of this.car.assemblies) assembly.group.position.set(0, 0, 0);
    this.stopLapReplay();

    this.drive = new DriveSession(this.track, this.scene, vehicle, setup, options);
    this.drive.setGhostTrail(this.careerUnlocks.has("ghostTrail"));
    this.drive.onLap = (lap) => this.onDriveLap?.(lap);
    this.driveWheelSpin = 0;
    this.applyDriveVisibility();
    (this.scene.fog as THREE.FogExp2).density = 0.0042;
    // The showroom environment is a bright studio; the circuit needs a night
    // mood so the tarmac reads against the run-off.
    this.scene.environmentIntensity = 0.32;

    const start = this.track.start;
    this.driveForward.set(Math.sin(start.heading), 0, Math.cos(start.heading));
    this.driveCamPos.copy(start.pos).addScaledVector(this.driveForward, -8);
    this.driveCamPos.y += 3.2;
    this.driveCamTgt.copy(start.pos);
    this.driveCamTgt.y += 1;
    this.camera.position.copy(this.driveCamPos);
    this.camera.lookAt(this.driveCamTgt);
  }

  exitDrive(): void {
    if (!this.drive) return;
    this.drive.dispose();
    this.drive = null;
    if (this.track) this.track.group.visible = false;

    this.carGroup.position.copy(this.savedCarPos);
    this.carGroup.rotation.copy(this.savedCarRot);
    this.bikeGroup.position.copy(this.savedBikePos);
    this.bikeGroup.rotation.copy(this.savedBikeRot);
    for (const wheel of this.car.wheels) {
      wheel.rotation.y = 0;
      wheel.position.x = wheel.userData.baseX as number;
    }
    this.applyShowroomVisibility();
    (this.scene.fog as THREE.FogExp2).density = 0.017;
    this.scene.environmentIntensity = 1;
    if (this.lastConfig) this.configure(this.lastConfig);
  }

  private applyDriveVisibility(): void {
    this.aeroCar.setEnabled(false);
    this.aeroBike.setEnabled(false);
    this.tunnel.visible = false;
    this.tunnelDive = -1;
    this.portalFlare.visible = false;
    this.portalFlare.material.opacity = 0;
    this.shafts.visible = false;
    this.streaks.visible = false;
    this.dust.visible = false;
    this.gridHelper.visible = false;
    this.groundDecor.visible = false;
    this.bike.scan.visible = false;
    this.labelsEl.style.opacity = "0";
    this.carGroup.visible = this.driveVehicle === "car";
    this.bikeGroup.visible = this.driveVehicle === "bike";
  }

  private applyShowroomVisibility(): void {
    this.shafts.visible = true;
    this.streaks.visible = true;
    this.dust.visible = true;
    this.groundDecor.visible = true;
    this.labelsEl.style.opacity = "";
    this.carGroup.visible = true;
    this.bikeGroup.visible = true;
  }

  private updateGarage(dt: number): void {
    const stage = this.garageStage;
    if (!stage) return;
    stage.update(dt, this.clockTime);
    this.weather.update(dt);

    if (this.garageEntryT < GARAGE_ENTRY_DURATION) {
      this.garageEntryT = Math.min(GARAGE_ENTRY_DURATION, this.garageEntryT + dt);
    }
    const e = this.garageEntryT;
    if (e < GARAGE_ENTRY_DURATION) {
      const door = smoothstep((e - 0.15) / 1.4);
      const lightsRaw = smoothstep((e - 1.0) / 1.15);
      const flicker = e < 2.2 ? 0.5 + 0.5 * Math.abs(Math.sin(e * 47)) : 1;
      stage.setDoor(door);
      stage.setLights(lightsRaw * flicker);
      this.garageDoor = 1;

      const drop = smoothstep((e - 1.9) / 1.45);
      const bounceT = e - 3.35;
      const bounce =
        bounceT > 0 ? Math.sin(bounceT * 10) * Math.exp(-bounceT * 4.5) * 0.045 : 0;
      this.carGroup.position.y =
        GARAGE_CAR_HOVER_Y +
        (GARAGE_CAR_LIFT_Y - GARAGE_CAR_HOVER_Y) * drop +
        bounce;
    } else {
      // Once the bay is live the door, lift and service lights belong to the
      // player: ramp toward their targets instead of replaying the entry.
      this.garageDoor +=
        (this.garageDoorTarget - this.garageDoor) * (1 - Math.exp(-dt * 2.6));
      stage.setDoor(this.garageDoor);
      this.garageLift +=
        (this.garageLiftTarget - this.garageLift) * (1 - Math.exp(-dt * 3.2));
      stage.setLift(this.garageLift);
      stage.setLights(this.garageService ? 0.24 : 1);
      this.carGroup.position.y = GARAGE_CAR_LIFT_Y + this.garageLift * 1.32;
    }
    this.carGroup.rotation.y = 0;
    stage.setRev(this.revRpm, this.revKick);
    stage.setService(this.garageService);
    stage.setTerminal({
      rpm: this.revRpm,
      door: this.garageDoorTarget > 0.5,
      lift: this.garageLiftTarget > 0.5,
      service: this.garageService,
    });

    // Service mode cracks the power dome open so the V12 is on show.
    const serviceTarget = this.garageService ? 1 : 0;
    this.garageServiceOpen += (serviceTarget - this.garageServiceOpen) * (1 - Math.exp(-dt * 2.8));
    this.car.service.setOpen(this.garageServiceOpen);

    this.engineTime += dt * (1 + this.revRpm * 30);
    this.car.engine.update(this.engineTime);
    this.bike.engine.update(this.clockTime);

    if (e < GARAGE_ENTRY_DURATION) {
      const d = smoothstep(e / 3.4);
      const firstFov =
        this.camera.aspect < 0.9 ? GARAGE_FIRST_FOV + 9 : GARAGE_FIRST_FOV;
      const cosP = Math.cos(this.garageLookPitch);
      this.garageEntryFrom.set(0, 2.1, 14.6);
      this.garageEntryLook.set(0, 1.15, 0.2);
      this.garageEntryEye.set(this.garageWalk.x, 1.62, this.garageWalk.z);
      this.garageEntryTarget.set(
        this.garageEntryEye.x - Math.sin(this.garageLookYaw) * cosP * 4,
        this.garageEntryEye.y + Math.sin(this.garageLookPitch) * 4,
        this.garageEntryEye.z - Math.cos(this.garageLookYaw) * cosP * 4,
      );
      this.garageEntryLook.lerp(this.garageEntryTarget, d);
      this.camera.position.lerpVectors(this.garageEntryFrom, this.garageEntryEye, d);
      this.camera.position.x += Math.sin(e * 0.9) * 0.25 * (1 - d);
      this.camera.lookAt(this.garageEntryLook);
      this.camera.fov = THREE.MathUtils.lerp(56, firstFov, d);
      this.camera.updateProjectionMatrix();
      return;
    }

    this.updateGarageWalk(dt);
    const firstFov = this.camera.aspect < 0.9 ? GARAGE_FIRST_FOV + 9 : GARAGE_FIRST_FOV;
    this.camera.fov += (firstFov - this.camera.fov) * (1 - Math.exp(-dt * 6));
    this.camera.updateProjectionMatrix();

    if (this.revRpm > 0.02 || this.revKick > 0.02) {
      const amp =
        (this.revRpm + this.revKick * 0.45) *
        (this.revKind === "car" ? 0.01 : 0.007);
      this.camera.position.x += Math.sin(this.clockTime * 73) * amp;
      this.camera.position.y += Math.cos(this.clockTime * 91) * amp;
      this.camera.rotateZ(Math.sin(this.clockTime * 57) * amp * 0.6);
    }
  }

  private updateGarageWalk(dt: number): void {
    const keys = this.garageKeys;
    // Park the pointer near a screen edge and the head keeps turning, so the
    // user never has to lift the mouse to keep walking around the bay.
    const edgeX = Math.abs(this.garagePointerX);
    if (edgeX > 0.72) {
      const push = (edgeX - 0.72) / 0.28;
      this.garageLookYawT -=
        Math.sign(this.garagePointerX) * push * push * 2.2 * dt;
    }
    const edgeY = Math.abs(this.garagePointerY);
    if (edgeY > 0.82) {
      const push = (edgeY - 0.82) / 0.18;
      this.garageLookPitchT -=
        Math.sign(this.garagePointerY) * push * push * 1.1 * dt;
      this.garageLookPitchT = THREE.MathUtils.clamp(this.garageLookPitchT, -1.05, 1.05);
    }
    const lookEase = 1 - Math.exp(-dt * 16);
    this.garageLookYaw += (this.garageLookYawT - this.garageLookYaw) * lookEase;
    this.garageLookPitch +=
      (this.garageLookPitchT - this.garageLookPitch) * lookEase;

    const keyboardForward =
      (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
      (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const keyboardStrafe =
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
    const forward = THREE.MathUtils.clamp(
      keyboardForward + this.garageVirtualForward,
      -1,
      1,
    );
    const strafe = THREE.MathUtils.clamp(
      keyboardStrafe + this.garageVirtualStrafe,
      -1,
      1,
    );
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = sprint ? 4.8 : 2.7;
    const sin = Math.sin(this.garageLookYaw);
    const cos = Math.cos(this.garageLookYaw);

    if (this.garageSeated && (forward !== 0 || strafe !== 0)) {
      this.garageSeated = false;
    }
    this.garageMoving = !this.garageSeated && (forward !== 0 || strafe !== 0);
    if (this.garageMoving) {
      this.garageWalk.x += (-sin * forward + cos * strafe) * speed * dt;
      this.garageWalk.z += (-cos * forward - sin * strafe) * speed * dt;
      this.garageBob += dt * (sprint ? 11 : 7.5);
      this.garageStepT += dt * (sprint ? 1.9 : 1.35);
      if (this.garageStepT > 1) {
        this.garageStepT = 0;
        sound.footstep(sprint);
      }
    } else {
      this.garageStepT = 0;
    }
    // With the door up you can walk out onto the apron; shut, the bay is
    // sealed. The doorway itself is narrow, so the thread through it is too.
    const doorUp = this.garageDoorTarget > 0.5;
    const maxX = doorUp ? 9.4 : 6.7;
    const maxZ = doorUp ? 14.2 : 7.4;
    this.garageWalk.x = THREE.MathUtils.clamp(this.garageWalk.x, -maxX, maxX);
    this.garageWalk.z = THREE.MathUtils.clamp(this.garageWalk.z, -6.8, maxZ);
    if (doorUp && this.garageWalk.z > 6.4 && this.garageWalk.z < 9.8) {
      this.garageWalk.x = THREE.MathUtils.clamp(this.garageWalk.x, -2.9, 2.9);
    }

    // Stay clear of the lift runways and the parked bike.
    this.pushOut(0, 0.2, 2.6);
    this.pushOut(5.5, 3.4, 1.7);

    // Nearest hotspot in the view cone becomes the interaction target.
    const stage = this.garageStage;
    if (stage) {
      const fx = -Math.sin(this.garageLookYaw);
      const fz = -Math.cos(this.garageLookYaw);
      let best: GarageHotspot | null = null;
      let bestScore = 0;
      for (const spot of stage.hotspots) {
        const dx = spot.position.x - this.garageWalk.x;
        const dz = spot.position.z - this.garageWalk.z;
        const dist = Math.hypot(dx, dz);
        if (dist > spot.radius) continue;
        const dot = (dx * fx + dz * fz) / Math.max(dist, 0.001);
        if (dot < 0.35) continue;
        const score = dot - dist * 0.12;
        if (!best || score > bestScore) {
          best = spot;
          bestScore = score;
        }
      }
      const id = best?.id ?? null;
      if (id !== (this.garageFocus?.id ?? null)) {
        this.garageFocus = best;
        stage.setActiveHotspot(id);
        this.emitGarage({ type: "focus", id, label: best?.label ?? "" });
      }
    }

    const eye = this.garageSeated ? 1.18 : 1.62;
    const bob = this.garageMoving ? Math.sin(this.garageBob) * 0.028 : 0;
    const sway = this.garageMoving ? Math.cos(this.garageBob * 0.5) * 0.014 : 0;
    this.camera.position.set(this.garageWalk.x + sway, eye + bob, this.garageWalk.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.garageLookPitch, this.garageLookYaw, 0);
  }

  private pushOut(cx: number, cz: number, radius: number): void {
    const dx = this.garageWalk.x - cx;
    const dz = this.garageWalk.z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist >= radius) return;
    if (dist < 1e-4) {
      this.garageWalk.x = cx + radius;
      return;
    }
    this.garageWalk.x = cx + (dx / dist) * radius;
    this.garageWalk.z = cz + (dz / dist) * radius;
  }

  private updateLighting(dt: number): void {
    const lightEase = Math.min(1, dt * 3.4);
    const targets = this.lightTargets;
    const nightDim = 1 - this.weather.night * 0.66;
    (Object.keys(this.lights) as Array<keyof LightRig>).forEach((name) => {
      const light = this.lights[name];
      const target = targets.lights[name];
      const dim = name === "hemi" || name === "key" || name === "cool" ? nightDim : 1;
      light.intensity += (target.intensity * dim - light.intensity) * lightEase;
      if (target.color) light.color.lerp(target.color, lightEase);
    });
    const exposureTarget = targets.exposure * (1 - this.weather.night * 0.16);
    this.renderer.toneMappingExposure +=
      (exposureTarget - this.renderer.toneMappingExposure) * lightEase;
  }

  private updateDrive(dt: number, adt: number): void {
    const drive = this.drive!;
    drive.update(dt);
    const bike = this.driveVehicle === "bike";
    const group = bike ? this.bikeGroup : this.carGroup;

    group.position.set(drive.pos.x, 0, drive.pos.z);
    group.rotation.y = drive.heading;
    group.rotation.z = drive.lean;
    group.rotation.x = drive.accelPitch;

    if (bike) {
      this.bike.engine.update(this.clockTime * 2 + Math.abs(drive.speed) * 0.04);
    } else {
      this.driveWheelSpin += (adt * drive.speed) / 0.47;
      for (let i = 0; i < this.car.wheels.length; i++) {
        const wheel = this.car.wheels[i];
        wheel.rotation.x = this.driveWheelSpin;
        wheel.rotation.y = i < 2 ? -drive.steer * 0.42 : 0;
        wheel.position.x = wheel.userData.baseX as number;
      }
      this.car.engine.update(this.clockTime * 2 + Math.abs(drive.speed) * 0.04);
      const glow = drive.throttleLevel * (0.2 + Math.min(0.4, Math.abs(drive.speed) / 160));
      this.car.exhaustGlow.opacity += (glow - this.car.exhaustGlow.opacity) * (1 - Math.exp(-dt * 8));
    }

    const sn = Math.min(1, Math.abs(drive.speed) / 72);
    this.driveForward.set(Math.sin(drive.heading), 0, Math.cos(drive.heading));
    const mobile = this.camera.aspect < 0.9;

    if (drive.countingDown) {
      const angle = this.clockTime * 0.6;
      const orbit = mobile ? 10.5 : 8;
      this.driveCamPos.lerp(
        new THREE.Vector3(
          drive.pos.x + Math.sin(angle) * orbit,
          mobile ? 4 : 3.4,
          drive.pos.z + Math.cos(angle) * orbit,
        ),
        1 - Math.exp(-dt * 3),
      );
      this.driveCamTgt.lerp(
        new THREE.Vector3(drive.pos.x, 1.1, drive.pos.z),
        1 - Math.exp(-dt * 3),
      );
    } else {
      const dist = (bike ? 6.3 : 7.8) + (mobile ? 2.8 : 0);
      const height = (bike ? 3 : 3.7) + (mobile ? 1.4 : 0);
      const desired = new THREE.Vector3(
        drive.pos.x - this.driveForward.x * dist,
        height,
        drive.pos.z - this.driveForward.z * dist,
      );
      this.driveCamPos.lerp(desired, 1 - Math.exp(-dt * 6));
      const ahead = mobile ? 8 : 6;
      this.driveCamTgt.lerp(
        new THREE.Vector3(
          drive.pos.x + this.driveForward.x * ahead,
          1.35,
          drive.pos.z + this.driveForward.z * ahead,
        ),
        1 - Math.exp(-dt * 7),
      );
    }

    this.camera.position.copy(this.driveCamPos);
    this.camera.lookAt(this.driveCamTgt);
    const targetFov = (drive.countingDown ? 52 : 56 + sn * 16) + (mobile ? 17 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
    if (!this.reducedMotion) this.camera.rotateZ(-drive.lean * 0.12);

    this.crt.uniforms.uTime.value = this.clockTime;
    this.crt.uniforms.uAberration.value = THREE.MathUtils.lerp(
      this.crt.uniforms.uAberration.value,
      1 + sn * 4,
      0.1,
    );
  }

  getDriveState(): DriveHudState | null {
    return this.drive ? this.drive.getState() : null;
  }

  getTrackOutline(): {
    points: Array<[number, number]>;
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    start: { x: number; z: number; heading: number };
  } | null {
    if (!this.track) return null;
    return {
      points: this.track.minimap.map((p) => [p[0], p[1]]),
      bounds: { ...this.track.bounds },
      start: {
        x: this.track.start.pos.x,
        z: this.track.start.pos.z,
        heading: this.track.start.heading,
      },
    };
  }

  setDriveTouch(touch: DriveTouch): void {
    this.drive?.setTouch(touch);
  }

  setDriveSetup(setup: DriveSetup): void {
    this.drive?.setSetup(setup);
  }

  setDriveGhost(enabled: boolean): void {
    this.drive?.setGhostEnabled(enabled);
  }

  restartDrive(): void {
    this.drive?.reset();
  }

  recoverDrive(): void {
    this.drive?.recover();
  }

  private tick = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.paused) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    const adt = dt * this.timeScale;
    this.clockTime += adt;

    if (this.garageOn) {
      this.updateGarage(dt);
      this.animateCareer();
      this.animateRev(dt);
      this.composer.render();
      this.clip?.frame(this.renderer.domElement);
      if (!this.readySent) {
        this.readySent = true;
        this.onReady?.();
      }
      return;
    }

    if (this.drive) {
      this.updateDrive(dt, adt);
      this.animateCareer();
      this.updateLighting(dt);
      this.weather.update(dt);
      this.composer.render();
      this.clip?.frame(this.renderer.domElement);
      if (!this.readySent) {
        this.readySent = true;
        this.onReady?.();
      }
      return;
    }

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

    // Ghost-lap replay overrides the live rig with the recorded camera flight.
    if (this.replay) {
      if (this.replayPlaying) {
        this.replayTime += dt;
        if (this.replayTime >= this.replay.duration) {
          this.replayTime = this.replay.duration;
          this.replayPlaying = false;
        }
      }
      const sample = sampleLap(this.replay, this.replayTime);
      this.replayPos.set(...sample.pos);
      this.replayTgt.set(...sample.tgt);
      this.camera.position.copy(this.replayPos);
      this.camera.fov = sample.fov;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.replayTgt);
    }

    if (this.recordingLap) {
      const nowMs = performance.now();
      if (nowMs - this.lastSampleAt > 33 && this.lapSamples.length < 4000) {
        this.lastSampleAt = nowMs;
        this.lapSamples.push({
          t: (nowMs - this.lapStart) / 1000,
          pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
          tgt: [this.lookTarget.x, this.lookTarget.y, this.lookTarget.z],
          fov: this.camera.fov,
        });
      }
    }

    this.carGroup.rotation.y = Math.sin(this.clockTime * 0.08) * 0.012;

    // Exploded view eases assemblies apart along their offset vectors and
    // spreads the wheels outward so the internals read clearly.
    this.explodeCurrent +=
      (this.explodeTarget - this.explodeCurrent) * (1 - Math.exp(-dt * 4));
    for (const assembly of this.car.assemblies) {
      assembly.group.position
        .copy(assembly.offset)
        .multiplyScalar(this.explodeCurrent);
    }

    // Dyno: RPM drives a continuously accumulated engine clock so the crank
    // never jumps when the rev slider moves, and the wheels/exhaust respond.
    this.rpmCurrent += (this.rpmTarget - this.rpmCurrent) * (1 - Math.exp(-dt * 5));
    const spin = this.dynoOn ? 0.6 + this.rpmCurrent * 7.5 : 1;
    this.engineTime += adt * spin;
    const wheelSpin = 0.55 + (this.dynoOn ? this.rpmCurrent * 9 : 0);
    for (const wheel of this.car.wheels) {
      wheel.rotation.x += adt * wheelSpin;
      const side = wheel.userData.side as number;
      wheel.position.x =
        (wheel.userData.baseX as number) + side * 1.5 * this.explodeCurrent;
    }
    this.car.engine.update(this.engineTime);
    this.bike.engine.update(this.dynoOn ? this.engineTime : this.clockTime);
    const glowTarget = this.dynoOn
      ? 0.22 + this.rpmCurrent * 0.6 + Math.sin(this.clockTime * 40) * 0.05 * this.rpmCurrent
      : 0;
    this.car.exhaustGlow.opacity +=
      (glowTarget - this.car.exhaustGlow.opacity) * (1 - Math.exp(-dt * 8));
    this.animateCareer();
    this.animateRev(dt);

    this.weather.update(dt);
    this.updateAssemblyLabels();
    this.bikeGroup.position.y = Math.sin(this.clockTime * 0.6) * 0.008;
    this.bike.scan.position.y = 0.35 + ((this.clockTime * 0.42) % 1.4);
    this.bike.scan.material.opacity =
      0.16 + 0.3 * Math.abs(Math.sin((this.clockTime * 0.42 * Math.PI) % 1));
    this.bike.scan.visible = p > 0.24 && p < 0.56;

    this.aeroCar.update(dt);
    this.aeroBike.update(dt);

    // Lighting presets cross-fade instead of cutting. Night race dims the
    // ambient rig so the headlights and neon carry the scene.
    this.updateLighting(dt);

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
      const gate = smoothstep((p - 0.72) / 0.18);
      this.portalFlare.visible = gate > 0.01;
      this.portalFlare.material.opacity =
        gate * (0.07 + 0.05 * (0.5 + 0.5 * Math.sin(this.clockTime * 2.6)));
      this.portalFlare.scale.setScalar(1);
      (this.scene.fog as THREE.FogExp2).density = THREE.MathUtils.lerp(
        0.017,
        0.004,
        smoothstep((p - 0.62) / 0.3),
      );
    } else {
      this.tunnel.visible = false;
      if (this.tunnelDive < 0) this.portalFlare.visible = false;
    }

    if (this.tunnelDive >= 0) this.updateTunnelDive(dt);

    if (!this.reducedMotion) {
      const positions = this.streakPositions;
      const rush =
        0.4 +
        (this.tunnelDive >= 0 ? 8 : 0) +
        Math.min(2.4, scrollSpeed * 26);
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
    const diveSurge =
      this.tunnelDive >= 0
        ? Math.pow(
            THREE.MathUtils.clamp(
              this.tunnelDive / TUNNEL_DIVE_DURATION,
              0,
              1,
            ),
            3,
          ) * 13
        : 0;
    this.crt.uniforms.uAberration.value = THREE.MathUtils.lerp(
      this.crt.uniforms.uAberration.value,
      1 + Math.min(speed * 0.16, 6) + diveSurge,
      this.tunnelDive >= 0 ? 0.4 : 0.1,
    );

    this.updateLabels(p);
    this.composer.render();
    this.clip?.frame(this.renderer.domElement);

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
    window.removeEventListener("pointermove", this.onPointerLook);
    window.removeEventListener("pointerout", this.onPointerOut);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragEnd);
    window.removeEventListener("dblclick", this.onResetView);
    window.removeEventListener("keydown", this.onGarageKeyDown);
    window.removeEventListener("keyup", this.onGarageKeyUp);
    document.body.classList.remove("is-orbiting");
    for (const { el } of this.assemblyLabels) el.remove();
    this.weather.dispose();
    this.clearGhostLine();
    this.drive?.dispose();
    this.drive = null;
    if (this.garageStage) {
      this.scene.remove(this.garageStage.group);
      this.garageStage.dispose();
      this.garageStage = null;
    }
    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
      this.track = null;
    }
    this.recordingLap = false;
    if (this.clip) {
      void this.clip.stop();
      this.clip = null;
    }
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
    this.envTarget?.dispose();
    this.envTarget = null;
    this.scene.environment = null;
    this.renderer.dispose();
    this.composer.dispose();
  }
}
