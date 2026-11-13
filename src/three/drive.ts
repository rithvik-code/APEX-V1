import * as THREE from "three";
import { GRAVITY, createProbe, type Track } from "./track";
import { sound } from "../lib/sound";
import {
  loadBoard,
  loadGhost,
  saveGhost,
  saveLap,
  TIRE_GRIP,
  type DriveEntry,
  type DriveSetup,
  type DriveVehicle,
  type GhostLap,
  type GhostSample,
  type SectorTimes,
} from "../lib/driveStore";

const ACID = 0xc8ff16;

export type {
  DriveEntry,
  DriveSetup,
  DriveVehicle,
  SectorTimes,
} from "../lib/driveStore";

export type DrivePhase = "countdown" | "racing";

export type DriveTouch = {
  throttle?: boolean;
  brake?: boolean;
  steer?: number;
  handbrake?: boolean;
};

export type DriveFlash = {
  kind: "go" | "lap" | "best" | "sector" | "recover" | "air" | "boost";
  text: string;
  at: number;
};

export type DriveLapEvent = {
  vehicle: DriveVehicle;
  time: number;
  best: boolean;
  lapCount: number;
};

export type AssistCallout = {
  kind: "corner" | "ramp" | "hop" | "boost";
  label: string;
  distM: number;
  kmh: number | null;
  dir: "L" | "R" | null;
  active: boolean;
};

export type DriveAssist = {
  on: boolean;
  mode: "push" | "lift" | "brake";
  targetKmh: number;
  next: AssistCallout | null;
};

export type DriveHudState = {
  phase: DrivePhase;
  countdown: number;
  vehicle: DriveVehicle;
  speedKmh: number;
  speedNorm: number;
  gear: number;
  rpmNorm: number;
  lapTime: number;
  lastTime: number | null;
  bestTime: number | null;
  sectors: Array<number | null>;
  bestSectors: Array<number | null>;
  sectorIndex: number;
  progress: number;
  lapCount: number;
  offTrack: boolean;
  drift: number;
  distanceM: number;
  pos: { x: number; z: number };
  heading: number;
  ghostPos: { x: number; z: number } | null;
  ghostEnabled: boolean;
  hasGhost: boolean;
  board: DriveEntry[];
  lastRank: number;
  flash: DriveFlash | null;
  wet: boolean;
  setup: DriveSetup;
  throttle: number;
  brake: number;
  steer: number;
  airborne: boolean;
  airTime: number;
  bestAir: number;
  boost: number;
  assist: DriveAssist;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export type DriveOptions = {
  wet: boolean;
  night: boolean;
};

export class DriveSession {
  readonly track: Track;
  readonly vehicle: DriveVehicle;
  setup: DriveSetup;
  wet: boolean;
  distanceM = 0;
  onLap: ((lap: DriveLapEvent) => void) | null = null;

  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  lean = 0;
  steer = 0;
  slip = 0;
  offTrack = false;
  accelPitch = 0;
  throttleLevel = 0;
  y = 0;
  vy = 0;
  airborne = false;
  pitch = 0;
  roll = 0;
  impact = 0;
  boost = 0;

  private probe = createProbe();
  private ghostProbe = createProbe();
  private prevGround = 0;
  private airTime = 0;
  private bestAir = 0;
  private onPad = false;
  private assist = true;
  private scene: THREE.Scene;
  private velDir = 0;
  private yaw = 0;
  private phase: DrivePhase = "countdown";
  private countdown = 3;
  private raceTime = 0;
  private lapStart = 0;
  private totalProgress = 0;
  private lastT = 0;
  private sectors: Array<number | null> = [null, null, null];
  private bestSectors: Array<number | null> = [null, null, null];
  private lastTime: number | null = null;
  private bestTime: number | null = null;
  private lapCount = 0;
  private lastRank = 0;
  private board: DriveEntry[];
  private flash: DriveFlash | null = null;

  private ghost: GhostLap | null;
  private ghostEnabled: boolean;
  private ghostRecording: GhostSample[] = [];
  private lastGhostSample = 0;
  private ghostPos = new THREE.Vector3();
  private ghostHeading = 0;
  private ghostHasPos = false;
  private ghostGroup: THREE.Group;
  private ghostBody: THREE.Group;
  private trail: THREE.Line;
  private trailPositions: Float32Array;
  private trailCount = 0;

  private keys = { throttle: false, brake: false, left: false, right: false, handbrake: false };
  private touch: Required<DriveTouch> = { throttle: false, brake: false, steer: 0, handbrake: false };
  private topSpeed = 70;
  private tmp = new THREE.Vector3();

  constructor(
    track: Track,
    scene: THREE.Scene,
    vehicle: DriveVehicle,
    setup: DriveSetup,
    options: DriveOptions,
  ) {
    this.track = track;
    this.scene = scene;
    this.vehicle = vehicle;
    this.setup = { ...setup };
    this.wet = options.wet;
    this.board = loadBoard(vehicle);
    this.bestTime = this.board[0]?.time ?? null;
    this.bestSectors = this.board[0]?.sectors
      ? [...this.board[0].sectors]
      : [null, null, null];
    this.ghost = loadGhost(vehicle);
    this.ghostEnabled = this.ghost !== null;

    this.pos.copy(track.start.pos);
    this.heading = track.start.heading;
    this.velDir = this.heading;
    this.snapToGround();
    this.lastT = this.probe.t;
    try {
      this.assist = localStorage.getItem("apex.drive.assist") !== "0";
    } catch { /* Storage is optional. */ }
    track.setAssist(this.assist);

    this.ghostGroup = new THREE.Group();
    this.ghostBody = this.buildGhostBody();
    this.ghostGroup.add(this.ghostBody);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1.05, 40),
      new THREE.MeshBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.ghostGroup.add(ring);
    this.ghostGroup.scale.setScalar(vehicle === "bike" ? 0.62 : 0.82);
    this.ghostGroup.visible = false;
    scene.add(this.ghostGroup);

    const maxTrail = 48;
    this.trailPositions = new Float32Array(maxTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.trail = new THREE.Line(
      trailGeo,
      new THREE.LineBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    if (import.meta.env.DEV) {
      (window as unknown as { __apexDrive?: DriveSession }).__apexDrive = this;
    }
  }

  private buildGhostBody(): THREE.Group {
    const group = new THREE.Group();
    const holo = new THREE.MeshBasicMaterial({
      color: ACID,
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const wire = new THREE.MeshBasicMaterial({
      color: ACID,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bodyGeo = new THREE.ConeGeometry(0.5, 2.5, 5);
    bodyGeo.rotateX(Math.PI / 2);
    bodyGeo.translate(0, 0.55, 0.2);
    group.add(new THREE.Mesh(bodyGeo, holo));
    group.add(new THREE.Mesh(bodyGeo, wire));
    const cabinGeo = new THREE.BoxGeometry(0.7, 0.4, 1);
    cabinGeo.translate(0, 0.85, -0.3);
    group.add(new THREE.Mesh(cabinGeo, wire));
    return group;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    // A focused HUD button must keep its native Space/Enter activation.
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      tag === "A" ||
      target?.isContentEditable
    ) {
      return;
    }
    const k = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
      event.preventDefault();
    }
    switch (k) {
      case "w": case "arrowup": this.keys.throttle = true; break;
      case "s": case "arrowdown": this.keys.brake = true; break;
      case "a": case "arrowleft": this.keys.left = true; break;
      case "d": case "arrowright": this.keys.right = true; break;
      case " ": this.keys.handbrake = true; break;
      case "r": this.reset(); break;
      case "c": this.recover(); break;
      case "l": if (!event.repeat) this.setAssist(!this.assist); break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const k = event.key.toLowerCase();
    switch (k) {
      case "w": case "arrowup": this.keys.throttle = false; break;
      case "s": case "arrowdown": this.keys.brake = false; break;
      case "a": case "arrowleft": this.keys.left = false; break;
      case "d": case "arrowright": this.keys.right = false; break;
      case " ": this.keys.handbrake = false; break;
    }
  };

  private onBlur = (): void => {
    this.keys = { throttle: false, brake: false, left: false, right: false, handbrake: false };
  };

  setTouch(partial: DriveTouch): void {
    if (partial.throttle !== undefined) this.touch.throttle = partial.throttle;
    if (partial.brake !== undefined) this.touch.brake = partial.brake;
    if (partial.steer !== undefined) this.touch.steer = clamp(partial.steer, -1, 1);
    if (partial.handbrake !== undefined) this.touch.handbrake = partial.handbrake;
  }

  setSetup(setup: DriveSetup): void {
    this.setup = { ...setup };
  }

  setGhostEnabled(enabled: boolean): void {
    this.ghostEnabled = enabled;
  }

  setAssist(on: boolean): void {
    this.assist = on;
    this.track.setAssist(on);
    try {
      localStorage.setItem("apex.drive.assist", on ? "1" : "0");
    } catch { /* Storage is optional. */ }
  }

  private snapToGround(): void {
    const p = this.track.probe(this.pos.x, this.pos.z, this.probe);
    this.y = this.prevGround = this.pos.y = p.height;
    this.vy = 0;
    this.airborne = false;
    this.airTime = 0;
    this.impact = 0;
    const align = Math.cos(angleDelta(this.heading, p.heading));
    this.pitch = -Math.atan(p.slope * align);
    this.roll = -Math.atan(p.bank) * align;
  }

  setGhostTrail(enabled: boolean): void {
    const material = this.trail.material as THREE.LineBasicMaterial;
    material.color.setHex(enabled ? 0x6ff9ff : ACID);
    material.opacity = enabled ? 0.42 : 0.24;
  }

  get countingDown(): boolean {
    return this.phase === "countdown";
  }

  reset(): void {
    this.pos.copy(this.track.start.pos);
    this.heading = this.track.start.heading;
    this.velDir = this.heading;
    this.speed = 0;
    this.lean = 0;
    this.steer = 0;
    this.slip = 0;
    this.yaw = 0;
    this.phase = "countdown";
    this.countdown = 3;
    this.raceTime = 0;
    this.lapStart = 0;
    this.totalProgress = 0;
    this.boost = 0;
    this.onPad = false;
    this.snapToGround();
    this.lastT = this.probe.t;
    this.sectors = [null, null, null];
    this.ghostRecording = [];
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.lapCount = 0;
    this.flash = null;
  }

  recover(): void {
    const t = this.track.nearestT(this.pos.x, this.pos.z);
    this.track.centerAt(t, this.pos);
    this.track.tangentAt(t, this.tmp);
    this.heading = Math.atan2(this.tmp.x, this.tmp.z);
    this.velDir = this.heading;
    this.yaw = 0;
    this.speed = 0;
    this.boost = 0;
    this.snapToGround();
    this.lastT = this.probe.t;
    this.flash = { kind: "recover", text: "RECOVERED", at: performance.now() };
    sound.tick("click");
  }

  private derive(): { topSpeed: number; accel: number; grip: number; steerAuth: number; brake: number } {
    const bike = this.vehicle === "bike";
    const baseTop = bike ? 82 : 72;
    const baseAccel = bike ? 30 : 23;
    const baseGrip = bike ? 6.1 : 7.7;
    const baseSteer = bike ? 3.0 : 2.6;
    const power = this.setup.power;
    const down = this.setup.downforce;
    const tire = TIRE_GRIP[this.setup.tires];
    const topSpeed = baseTop * (0.74 + power * 0.5) * (1 - down * 0.16);
    const accel = baseAccel * (0.66 + power * 0.7);
    const grip = baseGrip * (0.62 + tire * 0.42 + down * 0.5) * (this.wet ? 0.66 : 1);
    const steerAuth = baseSteer * (0.9 + tire * 0.16);
    return { topSpeed, accel, grip, steerAuth, brake: accel * 1.7 + 8 };
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const d = this.derive();
    this.topSpeed = d.topSpeed;
    this.impact = Math.max(0, this.impact - dt * 3.2);

    if (this.phase === "countdown") {
      this.countdown -= dt;
      this.speed = 0;
      this.steer = 0;
      this.yaw = 0;
      this.lean += (0 - this.lean) * (1 - Math.exp(-dt * 6));
      this.ghostGroup.visible = false;
      this.trail.visible = false;
      if (this.countdown <= 0) {
        this.phase = "racing";
        this.raceTime = 0;
        this.lapStart = 0;
        this.totalProgress = 0;
        this.lastT = this.track.nearestT(this.pos.x, this.pos.z);
        this.flash = { kind: "go", text: "GO", at: performance.now() };
        sound.tick("start");
      }
      return;
    }

    this.raceTime += dt;
    const p = this.track.probe(this.pos.x, this.pos.z, this.probe);
    const grounded = !this.airborne;
    const padHit = grounded && this.track.plan.boostAt[p.index] === 1 && Math.abs(p.lateral) < 2.3;
    if (padHit && !this.onPad) {
      this.flash = { kind: "boost", text: "BOOST", at: performance.now() };
      sound.whoosh();
    }
    if (padHit) this.boost = 1;
    this.onPad = padHit;
    this.boost = Math.max(0, this.boost - dt * 0.5);

    const throttle = this.keys.throttle || this.touch.throttle ? 1 : 0;
    const brake = this.keys.brake || this.touch.brake ? 1 : 0;
    this.throttleLevel = throttle;
    const handbrake = this.keys.handbrake || this.touch.handbrake;
    const steerInput = clamp(
      this.touch.steer + (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0),
      -1,
      1,
    );
    // Ramp into a turn over ~0.13 s but let go over ~0.08 s, so held keys still
    // arc smoothly while the car straightens the moment you release.
    const steerRate =
      Math.abs(steerInput) > Math.abs(this.steer) ? 7.5 : 13;
    this.steer += (steerInput - this.steer) * (1 - Math.exp(-dt * steerRate));

    const drag = 0.0011 * this.speed * Math.abs(this.speed) + (grounded ? 0.7 : 0.2);
    let accel = -drag;
    if (grounded) {
      accel += throttle * d.accel + this.boost * 22;
      if (brake) accel -= this.speed > 0.4 ? d.brake : d.accel * 0.5;
      accel -= GRAVITY * p.slope * Math.cos(angleDelta(this.velDir, p.heading)) * 0.6;
    }
    this.speed += accel * dt;
    if (grounded && !throttle && !brake) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 1.2 * dt);
    }

    this.offTrack = grounded && p.dist > this.track.halfWidth + 0.3;
    if (this.offTrack) {
      this.speed -= this.speed * 2.6 * dt;
      if (this.speed > d.topSpeed * 0.42) this.speed = d.topSpeed * 0.42;
    }
    const ceiling = d.topSpeed * (1 + 0.3 * this.boost);
    if (this.speed > ceiling) this.speed -= (this.speed - ceiling) * (1 - Math.exp(-dt * 1.4));
    this.speed = clamp(this.speed, -d.topSpeed * 0.18, d.topSpeed * 1.45);

    // Steering + grip. Positive steer is "screen right"; because the chase
    // camera looks along +Z, screen right is world -X, hence the negation.
    const speedAbs = Math.abs(this.speed);
    // Authority comes in earlier and stays strong at speed, then tapers just
    // enough that a held key arcs into a corner instead of snapping into a
    // spin. Grip does the rest of the work.
    const speedFactor = clamp(speedAbs / 8, 0, 1);
    const taper = 1 / (1 + speedAbs * (this.vehicle === "bike" ? 0.0032 : 0.0042));
    const dirSign = this.speed >= 0 ? 1 : -1;
    const turn = -this.steer * d.steerAuth * speedFactor * taper * dirSign * (grounded ? 1 : 0.18);
    this.yaw += (turn - this.yaw) * (1 - Math.exp(-dt * (grounded ? 12 : 3)));
    this.heading += this.yaw * dt;
    this.slip = angleDelta(this.heading, this.velDir);
    if (grounded) {
      let gripEff = d.grip * (handbrake ? 0.22 : 1) * (this.offTrack ? 0.55 : 1);
      gripEff *= (1 + Math.abs(p.bank) * 2.4) / (1 + Math.abs(this.yaw) * speedAbs * 0.008);
      this.velDir += this.slip * (1 - Math.exp(-gripEff * dt));
      this.speed -= Math.abs(this.slip) * speedAbs * 0.26 * dt;
    }

    this.pos.x += Math.sin(this.velDir) * this.speed * dt;
    this.pos.z += Math.cos(this.velDir) * this.speed * dt;
    this.distanceM += Math.abs(this.speed) * dt;

    // Barrier at the runoff limit: kill the outward velocity component and
    // let the car scrape along the wall instead of gluing to it.
    const q = this.track.probe(this.pos.x, this.pos.z, this.probe);
    const limit = this.track.halfWidth + this.track.runoff;
    if (q.dist > limit) {
      const t = q.t;
      this.track.centerAt(t, this.tmp);
      const nx = this.pos.x - this.tmp.x;
      const nz = this.pos.z - this.tmp.z;
      const len = Math.hypot(nx, nz) || 1;
      const ux = nx / len;
      const uz = nz / len;
      this.pos.x = this.tmp.x + ux * limit;
      this.pos.z = this.tmp.z + uz * limit;

      let vx = Math.sin(this.velDir) * this.speed;
      let vz = Math.cos(this.velDir) * this.speed;
      const vn = vx * ux + vz * uz;
      if (vn > 0) {
        if (vn > 5) sound.tick("key");
        vx -= ux * vn * 1.15;
        vz -= uz * vn * 1.15;
        const scrub = Math.max(0.55, 1 - vn * 0.02);
        vx *= scrub;
        vz *= scrub;
      } else {
        const scrape = 1 - 0.8 * dt;
        vx *= scrape;
        vz *= scrape;
      }
      this.speed = Math.hypot(vx, vz) * (this.speed < 0 ? -1 : 1);
      this.velDir = Math.atan2(vx, vz);
      this.yaw *= 0.7;
      this.lean *= 0.9;
    }

    this.track.probe(this.pos.x, this.pos.z, this.probe);
    this.updateVertical(dt);

    // Body attitude.
    const leanTarget = this.airborne ? 0 : this.vehicle === "bike"
      ? -this.yaw * speedFactor * 0.5
      : -this.yaw * speedFactor * 0.12;
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-dt * 6));
    const pitchTarget = clamp(-accel * 0.004, -0.05, 0.05);
    this.accelPitch += (pitchTarget - this.accelPitch) * (1 - Math.exp(-dt * 5));

    this.updateTiming();
    this.updateGhost();

    const sn = clamp(Math.abs(this.speed) / d.topSpeed, 0, 1);
    sound.setEngine(this.airborne ? 0.3 + throttle * 0.7 : clamp(0.16 + sn * 0.84 * (throttle ? 1 : 0.6) + this.boost * 0.12, 0, 1));
    sound.setWind(clamp(sn * 0.7 + (this.airborne ? 0.25 : this.boost * 0.2), 0, 1));
  }

  private updateVertical(dt: number): void {
    const p = this.probe;
    const ground = p.height;
    const groundVy = (ground - this.prevGround) / dt;
    this.prevGround = ground;
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y <= ground) {
      if (this.airborne) {
        const hit = clamp((groundVy - this.vy) / 16, 0, 1);
        this.impact = hit;
        this.speed *= 1 - hit * 0.08;
        if (hit > 0.15) sound.tick("key");
        if (this.airTime > 0.45) {
          const best = this.airTime > this.bestAir;
          this.bestAir = Math.max(this.bestAir, this.airTime);
          this.flash = { kind: "air", text: `${best ? "BEST" : "BIG"} AIR ${this.airTime.toFixed(2)}S`, at: performance.now() };
        }
      }
      this.y = ground;
      this.vy = groundVy;
      this.airborne = false;
    } else if (!this.airborne && this.y - ground > 0.18) {
      this.airborne = true;
      this.airTime = 0;
      if (Math.abs(this.speed) > 18) sound.whoosh();
    } else if (!this.airborne) {
      this.y = ground;
      this.vy = Math.max(this.vy, groundVy);
    }
    this.pos.y = this.y;
    const align = Math.cos(angleDelta(this.heading, p.heading));
    const pitchTarget = this.airborne
      ? -Math.atan2(this.vy, Math.max(8, Math.abs(this.speed))) * 0.8
      : -Math.atan(p.slope * align);
    const rollTarget = this.airborne ? 0 : -Math.atan(p.bank) * align;
    if (this.airborne) this.airTime += dt;
    const ease = 1 - Math.exp(-dt * (this.airborne ? 2.2 : 14));
    this.pitch += (pitchTarget - this.pitch) * ease;
    this.roll += (rollTarget - this.roll) * ease;
  }

  private updateTiming(): void {
    const t = this.probe.t;
    let delta = t - this.lastT;
    if (delta > 0.5) delta -= 1;
    else if (delta < -0.5) delta += 1;
    this.totalProgress += delta;
    this.lastT = t;

    const lapElapsed = this.raceTime - this.lapStart;
    if (this.sectors[0] === null && this.totalProgress >= 1 / 3) {
      this.sectors[0] = lapElapsed;
    }
    if (this.sectors[1] === null && this.totalProgress >= 2 / 3) {
      this.sectors[1] = lapElapsed;
    }
    if (this.totalProgress >= 1) {
      this.sectors[2] = lapElapsed;
      this.completeLap(lapElapsed);
    }
  }

  private completeLap(time: number): void {
    this.lastTime = time;
    this.lapCount += 1;
    const sectors = [...this.sectors] as SectorTimes;
    const result = saveLap(this.vehicle, time, sectors, this.setup);
    this.board = result.board;
    this.lastRank = result.rank;
    if (result.isBest) {
      this.bestTime = time;
      this.bestSectors = [...sectors];
      if (this.ghostRecording.length > 2) {
        const lap: GhostLap = {
          vehicle: this.vehicle,
          time,
          samples: this.ghostRecording,
        };
        saveGhost(this.vehicle, lap);
        this.ghost = lap;
        this.ghostEnabled = true;
      }
      this.flash = { kind: "best", text: `NEW BEST ${time.toFixed(3)}`, at: performance.now() };
      sound.whoosh();
    } else {
      this.flash = { kind: "lap", text: `LAP ${this.lapCount} · ${time.toFixed(3)}`, at: performance.now() };
      sound.tick("start");
    }
    this.totalProgress -= 1;
    this.lapStart = this.raceTime;
    this.sectors = [null, null, null];
    this.ghostRecording = [];
    this.lastGhostSample = 0;
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
    this.onLap?.({
      vehicle: this.vehicle,
      time,
      best: result.isBest,
      lapCount: this.lapCount,
    });
  }

  private updateGhost(): void {
    const lapElapsed = this.raceTime - this.lapStart;

    // Record the current lap for a future best.
    if (this.raceTime - this.lastGhostSample > 0.05 && this.ghostRecording.length < 6000) {
      this.lastGhostSample = this.raceTime;
      this.ghostRecording.push({
        t: lapElapsed,
        x: this.pos.x,
        z: this.pos.z,
        h: this.heading,
        y: this.y,
      });
    }

    if (!this.ghost || !this.ghostEnabled) {
      this.ghostGroup.visible = false;
      this.trail.visible = false;
      this.ghostHasPos = false;
      return;
    }

    const samples = this.ghost.samples;
    const gt = clamp(lapElapsed, 0, this.ghost.time);
    let i = 0;
    while (i < samples.length - 2 && samples[i + 1].t < gt) i++;
    const a = samples[i];
    const b = samples[Math.min(i + 1, samples.length - 1)];
    const span = Math.max(1e-4, b.t - a.t);
    const f = clamp((gt - a.t) / span, 0, 1);
    this.ghostPos.set(
      a.x + (b.x - a.x) * f,
      0,
      a.z + (b.z - a.z) * f,
    );
    this.ghostPos.y = a.y !== undefined && b.y !== undefined
      ? a.y + (b.y - a.y) * f
      : this.track.probe(this.ghostPos.x, this.ghostPos.z, this.ghostProbe).height;
    this.ghostHeading = a.h + angleDelta(b.h, a.h) * f;
    this.ghostHasPos = true;

    this.ghostGroup.visible = true;
    this.ghostGroup.position.copy(this.ghostPos);
    this.ghostGroup.rotation.y = this.ghostHeading;
    this.ghostBody.rotation.z = Math.sin(lapElapsed * 2) * 0.02;

    // Fading trail behind the ghost.
    const maxTrail = this.trailPositions.length / 3;
    if (this.trailCount < maxTrail) {
      this.trailCount += 1;
    } else {
      this.trailPositions.copyWithin(0, 3);
    }
    const idx = (this.trailCount - 1) * 3;
    this.trailPositions[idx] = this.ghostPos.x;
    this.trailPositions[idx + 1] = this.ghostPos.y + 0.1;
    this.trailPositions[idx + 2] = this.ghostPos.z;
    this.trail.geometry.setDrawRange(0, this.trailCount);
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.trail.visible = true;
  }

  private assistState(): DriveAssist {
    const plan = this.track.plan;
    const n = plan.count;
    const i = this.probe.t * n;
    const speed = Math.abs(this.speed);
    const ahead = Math.floor(i + speed * 0.35 / plan.step) % n;
    const targetKmh = plan.target[ahead] * 3.6;
    const over = speed * 3.6 - targetKmh;
    const planned = plan.mode[ahead];
    const mode: DriveAssist["mode"] = over > 12 ? "brake" : over < -4 ? "push" : planned === 2 ? "brake" : planned === 1 ? "lift" : "push";
    const wrap = (value: number) => ((value % n) + n) % n;
    const inside = (from: number, to: number) => wrap(i - from) <= wrap(to - from);
    let next: AssistCallout | null = null;
    const consider = (callout: AssistCallout) => {
      if (callout.distM > 420 && !callout.active) return;
      if (!next || (callout.active && !next.active) || (callout.active === next.active && callout.distM < next.distM)) next = callout;
    };
    for (const c of plan.corners) {
      const active = inside(c.brake, c.exit);
      consider({ kind: "corner", label: `T${c.id} ${c.label}`, distM: active ? 0 : wrap(c.entry - i) * plan.step, kmh: c.kmh, dir: c.dir, active });
    }
    for (const f of plan.features) {
      const active = inside(f.start, f.end);
      consider({ kind: f.kind, label: f.label, distM: active ? 0 : wrap(f.start - i) * plan.step, kmh: null, dir: null, active });
    }
    return { on: this.assist, mode, targetKmh, next };
  }

  getState(): DriveHudState {
    const sn = clamp(Math.abs(this.speed) / this.topSpeed, 0, 1);
    const gear = clamp(Math.floor(sn * 6) + 1, 1, 6);
    const band = sn * 6 - (gear - 1);
    const throttle = this.keys.throttle || this.touch.throttle ? 1 : 0;
    const brake = this.keys.brake || this.touch.brake ? 1 : 0;
    const now = performance.now();
    const sectorIndex = this.sectors[1] !== null ? 2 : this.sectors[0] !== null ? 1 : 0;
    return {
      phase: this.phase,
      countdown: Math.max(0, this.countdown),
      vehicle: this.vehicle,
      speedKmh: Math.abs(this.speed) * 3.6,
      speedNorm: sn,
      gear,
      rpmNorm: clamp(0.18 + band * 0.82 + throttle * 0.04, 0, 1),
      lapTime: this.phase === "racing" ? this.raceTime - this.lapStart : 0,
      lastTime: this.lastTime,
      bestTime: this.bestTime,
      sectors: [...this.sectors],
      bestSectors: [...this.bestSectors],
      sectorIndex,
      progress: ((this.totalProgress % 1) + 1) % 1,
      lapCount: this.lapCount,
      offTrack: this.offTrack,
      drift: clamp(Math.abs(this.slip) / 0.6, 0, 1),
      distanceM: this.distanceM,
      pos: { x: this.pos.x, z: this.pos.z },
      heading: this.heading,
      ghostPos: this.ghostHasPos ? { x: this.ghostPos.x, z: this.ghostPos.z } : null,
      ghostEnabled: this.ghostEnabled,
      hasGhost: this.ghost !== null,
      board: this.board,
      lastRank: this.lastRank,
      flash: this.flash && now - this.flash.at < 1800 ? this.flash : null,
      wet: this.wet,
      setup: { ...this.setup },
      throttle,
      brake,
      steer: this.steer,
      airborne: this.airborne,
      airTime: this.airborne ? this.airTime : 0,
      bestAir: this.bestAir,
      boost: this.boost,
      assist: this.assistState(),
    };
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.scene.remove(this.ghostGroup);
    this.scene.remove(this.trail);
    this.ghostGroup.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      }
    });
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    sound.setEngine(0);
    sound.setWind(0);
  }
}