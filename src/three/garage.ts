import * as THREE from "three";
import { DIE_CAST_CATALOG, diecastUnlocked, type DieCastEntry } from "../lib/diecast";

const ACID = 0xc8ff16;
const ACID_HEX = "#c8ff16";

export type GarageHotspot = {
  id: string;
  label: string;
  position: THREE.Vector3;
  radius: number;
};

export type GarageTerminalState = {
  cp: number;
  licence: string;
  unlocks: number;
  rpm: number;
  door: boolean;
  lift: boolean;
  service: boolean;
  paint: string;
  knowledge: number;
};

export type GarageStage = {
  group: THREE.Group;
  setDoor: (open: number) => void;
  setLights: (level: number) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
  setRev: (rpm: number, kick: number) => void;
  setWeather: (wet: boolean, night: boolean) => void;
  setLift: (raised: number) => void;
  setTrophies: (count: number) => void;
  setActiveHotspot: (id: string | null) => void;
  setTerminal: (patch: Partial<GarageTerminalState>) => void;
  setDiecast: (unlocks: ReadonlySet<string>) => void;
  setService: (on: boolean) => void;
  hotspots: GarageHotspot[];
};

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is unavailable");
  return { canvas, ctx };
}

function texture(canvas: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = 4;
  return map;
}

function concreteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  ctx.fillStyle = "#2b2c28";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const shade = 32 + Math.random() * 26;
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade - 2},${Math.random() * 0.5})`;
    const size = Math.random() * 2.4 + 0.4;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, size, size);
  }
  ctx.strokeStyle = "rgba(12, 13, 11, 0.35)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let step = 0; step < 5; step++) {
      x += (Math.random() - 0.5) * 70;
      y += (Math.random() - 0.5) * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return texture(canvas, 3, 3.4);
}

function pegboardTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 256);
  ctx.fillStyle = "#171a16";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#080a07";
  for (let y = 14; y < 256; y += 22) {
    for (let x = 14; x < 512; x += 22) {
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(200,255,22,0.12)";
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, 504, 248);
  return texture(canvas, 1, 1);
}

function signTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  ctx.fillStyle = ACID_HEX;
  ctx.font = "800 132px Archivo, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("APEX", 36, 150);
  ctx.font = "500 32px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(233,237,232,0.86)";
  ctx.fillText("PRIVATE GARAGE", 430, 112);
  ctx.fillStyle = "rgba(200,255,22,0.55)";
  ctx.fillRect(430, 132, 520, 2);
  ctx.font = "500 24px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(176,186,176,0.8)";
  ctx.fillText("BAY 01 / NO METER / NO MIDDLEMAN", 430, 184);
  ctx.fillStyle = "rgba(200,255,22,0.9)";
  ctx.fillRect(36, 184, 300, 4);
  return texture(canvas);
}

function doorSpillTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(256, 256);
  const grad = ctx.createRadialGradient(128, 210, 8, 128, 200, 240);
  grad.addColorStop(0, "rgba(255,244,214,0.85)");
  grad.addColorStop(0.45, "rgba(220,232,255,0.32)");
  grad.addColorStop(1, "rgba(200,220,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  return texture(canvas);
}

function asphaltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  ctx.fillStyle = "#0a0d0b";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(128,148,126,${0.015 + Math.random() * 0.045})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4);
  }
  const sheen = ctx.createLinearGradient(0, 0, 0, 512);
  sheen.addColorStop(0, "rgba(150,180,140,0.05)");
  sheen.addColorStop(0.5, "rgba(0,0,0,0)");
  sheen.addColorStop(1, "rgba(150,180,140,0.025)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, 512, 512);
  return texture(canvas, 6, 10);
}

function portalGlowTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 512);
  const grad = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
  grad.addColorStop(0, "rgba(226,255,208,0.03)");
  grad.addColorStop(0.6, "rgba(200,255,22,0.07)");
  grad.addColorStop(0.86, "rgba(200,255,22,0.26)");
  grad.addColorStop(1, "rgba(200,255,22,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  return texture(canvas);
}

function wordmarkTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(1400, 420);
  ctx.clearRect(0, 0, 1400, 420);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(235,240,232,0.94)";
  ctx.font = "800 236px Archivo, sans-serif";
  ctx.fillText("APEX", 700, 176);
  ctx.fillStyle = "rgba(200,255,22,0.22)";
  ctx.fillRect(320, 222, 760, 2);
  ctx.font = "600 38px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(200,255,22,0.82)";
  ctx.fillText("TERMINAL INTELLIGENCE / THE OTHER SIDE", 700, 348);
  return texture(canvas);
}

function sideSignTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(256, 640);
  ctx.clearRect(0, 0, 256, 640);
  ctx.fillStyle = "#0b0d09";
  ctx.fillRect(0, 0, 256, 640);
  ctx.strokeStyle = ACID_HEX;
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 236, 620);
  ctx.save();
  ctx.translate(128, 320);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = ACID_HEX;
  ctx.font = "800 150px Archivo, sans-serif";
  ctx.fillText("APEX", 0, -18);
  ctx.font = "500 26px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "rgba(233,237,232,0.8)";
  ctx.fillText("SERVICE 24H / BAY 01", 0, 86);
  ctx.restore();
  return texture(canvas);
}

function terminalCanvas() {
  return canvas2d(512, 320);
}

function drawTerminal(
  ctx: CanvasRenderingContext2D,
  state: GarageTerminalState,
  time: number,
): void {
  ctx.fillStyle = "#050a06";
  ctx.fillRect(0, 0, 512, 320);
  ctx.fillStyle = "rgba(200,255,22,0.045)";
  for (let y = 0; y < 320; y += 4) ctx.fillRect(0, y, 512, 1);

  ctx.fillStyle = "rgba(200,255,22,0.92)";
  ctx.font = "700 21px 'IBM Plex Mono', monospace";
  ctx.fillText("APEX // BAY DIAGNOSTICS", 22, 36);
  ctx.fillStyle = "rgba(150,170,150,0.55)";
  ctx.font = "500 14px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("BAY 01", 490, 36);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(200,255,22,0.28)";
  ctx.fillRect(22, 48, 468, 1);

  const rows: Array<[string, string, boolean]> = [
    ["LICENCE", state.licence.toUpperCase(), false],
    ["CAREER", `${state.cp} CP`, false],
    ["UNLOCKS", `${state.unlocks} FITTED`, false],
    ["LIVERY", state.paint.toUpperCase(), false],
    ["KNOWLEDGE", `${state.knowledge} FACTS`, state.knowledge === 0],
    ["DOOR / LIFT", `${state.door ? "OPEN" : "SHUT"} / ${state.lift ? "UP" : "DOWN"}`, false],
    ["SERVICE", state.service ? "ENGAGED" : "IDLE", false],
  ];
  rows.forEach(([label, value, warn], index) => {
    const y = 80 + index * 26;
    ctx.fillStyle = "rgba(150,170,150,0.6)";
    ctx.font = "500 15px 'IBM Plex Mono', monospace";
    ctx.fillText(label, 22, y);
    ctx.fillStyle = warn ? "rgba(255,120,80,0.92)" : "rgba(232,238,230,0.92)";
    ctx.font = "600 15px 'IBM Plex Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(value, 490, y);
    ctx.textAlign = "left";
  });

  const rpm = Math.max(0, Math.min(1.12, state.rpm));
  ctx.fillStyle = "rgba(200,255,22,0.1)";
  ctx.fillRect(22, 278, 468, 9);
  ctx.fillStyle = rpm > 0.86 ? "#ff5a1f" : "#c8ff16";
  ctx.fillRect(22, 278, 468 * Math.min(1, rpm), 9);
  ctx.fillStyle = "rgba(150,170,150,0.55)";
  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.fillText("REV", 22, 270);
  ctx.textAlign = "right";
  ctx.fillText(`${(rpm * 9).toFixed(1)}K RPM`, 490, 270);
  ctx.textAlign = "left";

  if (Math.sin(time * 6) > 0) {
    ctx.fillStyle = "#c8ff16";
    ctx.fillRect(22, 296, 11, 13);
  }
}

function tachCanvas() {
  return canvas2d(512, 256);
}

function drawTach(ctx: CanvasRenderingContext2D, rpm: number, kick: number): void {
  const value = Math.min(1.06, Math.max(0, rpm + kick * 0.12));
  ctx.fillStyle = "#0a0c09";
  ctx.fillRect(0, 0, 512, 256);
  const cx = 256;
  const cy = 214;
  const r = 148;
  const a0 = Math.PI * 0.82;
  const a1 = Math.PI * 2.18;

  ctx.lineCap = "round";
  ctx.lineWidth = 20;
  ctx.strokeStyle = "#1b2118";
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();

  ctx.strokeStyle = value > 0.88 ? "#ff5a1f" : ACID_HEX;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.min(1, value));
  ctx.stroke();

  ctx.strokeStyle = "rgba(233,237,232,0.5)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    const inner = r - 26;
    const outer = r - 14;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
    ctx.stroke();
  }

  const needle = a0 + (a1 - a0) * Math.min(1, value);
  ctx.strokeStyle = "#f4f6ef";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(needle) * (r - 30), cy + Math.sin(needle) * (r - 30));
  ctx.stroke();
  ctx.fillStyle = ACID_HEX;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(233,237,232,0.9)";
  ctx.font = "600 22px 'IBM Plex Mono', monospace";
  ctx.fillText("RPM x1000", cx, cy - 44);
  ctx.fillStyle = value > 0.88 ? "#ff7950" : ACID_HEX;
  ctx.font = "800 34px Archivo, sans-serif";
  ctx.fillText((value * 9).toFixed(1), cx, cy + 4);

  const leds = 20;
  const lit = Math.round(value * leds);
  for (let i = 0; i < leds; i++) {
    ctx.fillStyle =
      i < lit
        ? i >= leds - 3
          ? "#ff5a1f"
          : ACID_HEX
        : "rgba(200,255,22,0.12)";
    ctx.fillRect(32 + i * 22.6, 236, 17, 6);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(160,175,160,0.55)";
  ctx.font = "500 13px 'IBM Plex Mono', monospace";
  ctx.fillText("BAY 01 / LIVE TELEMETRY", 24, 24);
}


function hazardTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(128, 64);
  ctx.fillStyle = "#151713";
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = ACID_HEX;
  for (let x = -64; x < 160; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.lineTo(x + 16, 64);
    ctx.lineTo(x + 48, 0);
    ctx.lineTo(x + 32, 0);
    ctx.closePath();
    ctx.fill();
  }
  return texture(canvas, 4, 1);
}

function posterTexture(index: number): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(320, 420);
  const bases = ["#101310", "#0d1014", "#141009"];
  ctx.fillStyle = bases[index % bases.length];
  ctx.fillRect(0, 0, 320, 420);
  ctx.strokeStyle = "rgba(200,255,22,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, 292, 392);
  ctx.fillStyle = index === 1 ? "#ff5a1f" : ACID_HEX;
  ctx.font = "800 54px Archivo, sans-serif";
  ctx.fillText(index === 0 ? "SECTOR" : index === 1 ? "NIGHT" : "LOCAL", 28, 92);
  ctx.fillText(index === 0 ? "07" : index === 1 ? "RUN" : "FIRST", 28, 148);
  ctx.strokeStyle = "rgba(233,237,232,0.35)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.moveTo(28, 210 + i * 22);
    ctx.lineTo(292 - (i % 3) * 40, 210 + i * 22);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(233,237,232,0.5)";
  ctx.font = "500 15px 'IBM Plex Mono', monospace";
  ctx.fillText("APEX / PRINT 0" + (index + 1), 28, 396);
  return texture(canvas);
}

export function createGarage(): GarageStage {
  const root = new THREE.Group();
  root.name = "garage";

  /* ------------------------------------------------------------------ */
  /* Materials                                                          */
  /* ------------------------------------------------------------------ */

  const concrete = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: concreteTexture(),
    roughness: 0.93,
    metalness: 0.05,
    envMapIntensity: 0.15,
  });
  const wall = new THREE.MeshStandardMaterial({
    color: 0x24261f,
    roughness: 0.96,
    metalness: 0.02,
    envMapIntensity: 0.08,
  });
  const wallDark = new THREE.MeshStandardMaterial({
    color: 0x171910,
    roughness: 0.94,
    metalness: 0.04,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x9aa2a4,
    roughness: 0.32,
    metalness: 0.92,
    envMapIntensity: 0.4,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 0x1d201d,
    roughness: 0.44,
    metalness: 0.82,
    envMapIntensity: 0.3,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x111311,
    roughness: 0.92,
    metalness: 0.08,
  });
  const acid = new THREE.MeshStandardMaterial({
    color: 0x10130a,
    emissive: ACID,
    emissiveIntensity: 2.2,
    roughness: 0.5,
    metalness: 0.4,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: 0xc9a24a,
    roughness: 0.22,
    metalness: 1,
    envMapIntensity: 0.7,
  });
  const paper = new THREE.MeshStandardMaterial({
    color: 0xdad6c8,
    roughness: 0.9,
    metalness: 0,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0x8c2a1c,
    roughness: 0.55,
    metalness: 0.35,
  });
  const slat = new THREE.MeshStandardMaterial({
    color: 0x6f7779,
    roughness: 0.45,
    metalness: 0.75,
    envMapIntensity: 0.35,
  });
  const hazard = new THREE.MeshStandardMaterial({
    map: hazardTexture(),
    roughness: 0.68,
    metalness: 0.25,
  });

  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = root,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  const cylinder = (
    radius: number,
    height: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = root,
    segments = 18,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  /* ------------------------------------------------------------------ */
  /* Room shell                                                          */
  /* ------------------------------------------------------------------ */

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 18), concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  root.add(floor);

  // Bay marking under the lift.
  const bayLine = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    fog: false,
  });
  for (const side of [-1, 1]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 5.6), bayLine);
    line.rotation.x = -Math.PI / 2;
    line.position.set(side * 1.55, 0.012, 0.2);
    root.add(line);
  }
  const bayDash = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.05), bayLine);
  bayDash.rotation.x = -Math.PI / 2;
  bayDash.position.set(0, 0.012, 3.05);
  root.add(bayDash);

  // Walls.
  box(0.3, 4.6, 18, wall, -7.85, 2.3, 0);
  box(0.3, 4.6, 18, wall, 7.85, 2.3, 0);
  box(16, 4.6, 0.3, wall, 0, 2.3, -8.85);
  box(4.8, 4.6, 0.3, wall, -5.6, 2.3, 8.85);
  box(4.8, 4.6, 0.3, wall, 5.6, 2.3, 8.85);
  box(6.4, 1.1, 0.3, wall, 0, 4.05, 8.85);
  box(16, 0.2, 18, wallDark, 0, 4.6, 0);

  // Skirting boards add a finished-home read.
  box(15.7, 0.16, 0.06, darkSteel, 0, 0.08, -8.68);
  box(0.06, 0.16, 17.7, darkSteel, -7.68, 0.08, 0);
  box(0.06, 0.16, 17.7, darkSteel, 7.68, 0.08, 0);

  // Ceiling rafters.
  for (const z of [-6.4, -3.2, 0, 3.2, 6.4]) {
    box(15.6, 0.16, 0.22, wallDark, 0, 4.48, z);
  }

  /* ------------------------------------------------------------------ */
  /* Roller door                                                         */
  /* ------------------------------------------------------------------ */

  box(0.36, 3.6, 0.5, darkSteel, -3.32, 1.8, 8.9);
  box(0.36, 3.6, 0.5, darkSteel, 3.32, 1.8, 8.9);
  box(7.0, 0.5, 0.5, darkSteel, 0, 3.6, 8.9);

  const roll = new THREE.Group();
  roll.position.set(0, 3.7, 8.88);
  root.add(roll);
  for (let i = 0; i < 9; i++) {
    const panel = box(6.35, 0.37, 0.1, slat, 0, -0.2 - i * 0.39, 0, roll);
    panel.material = i % 2 === 0 ? slat : steel;
    box(6.35, 0.03, 0.12, darkSteel, 0, -0.39 - i * 0.39, 0, roll);
  }
  const drum = cylinder(0.24, 6.55, steel, 0, 3.68, 8.92);
  drum.rotation.z = Math.PI / 2;

  /* ------------------------------------------------------------------ */
  /* Tunnel approach beyond the door                                     */
  /* ------------------------------------------------------------------ */

  const asphaltMap = asphaltTexture();
  const portalMap = portalGlowTexture();
  const wordmarkMap = wordmarkTexture();

  const exterior = new THREE.Group();
  exterior.position.set(0, 0, 9.2);
  root.add(exterior);

  const roadMat = new THREE.MeshBasicMaterial({ map: asphaltMap, color: 0xdfe7da });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(64, 72), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.012, 32);
  exterior.add(road);

  const laneMat = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  for (const x of [-3.3, 3.3]) {
    const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 56), laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(x, 0.012, 30);
    exterior.add(lane);
  }

  // Guide lights marching down the approach.
  for (let i = 0; i < 5; i++) {
    const z = 4 + i * 7;
    for (const side of [-1, 1]) {
      box(0.16, 3.1, 0.16, darkSteel, side * 4.7, 1.55, z, exterior);
      box(0.05, 2.1, 0.05, acid, side * 4.62, 1.5, z, exterior);
    }
  }

  // Three arches straddle the road, growing as they recede into the tunnel.
  // Half-torus arches keep their crowns inside the door's view cone.
  const archSpecs: Array<[number, number, number, number]> = [
    [4.2, 8, 0.1, 0.34],
    [5.2, 22, 0.13, 0.5],
    [6.4, 36, 0.16, 0.68],
  ];
  for (const [radius, z, tube, strength] of archSpecs) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(radius, tube, 10, 72, Math.PI),
      new THREE.MeshBasicMaterial({
        color: ACID,
        transparent: true,
        opacity: strength,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    arch.position.set(0, 0.16, z);
    exterior.add(arch);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(radius + 0.35, 0.028, 8, 72, Math.PI),
      new THREE.MeshBasicMaterial({
        color: 0xe9f6e2,
        transparent: true,
        opacity: strength * 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    halo.position.set(0, 0.16, z + 0.02);
    exterior.add(halo);
  }

  const glowMat = new THREE.MeshBasicMaterial({
    map: portalMap,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 11), glowMat);
  glow.position.set(0, 4.6, 40.5);
  exterior.add(glow);

  // Distant skyline flanking the tunnel.
  const towerMat = new THREE.MeshBasicMaterial({ color: 0x111a14, fog: false });
  const windowMat = new THREE.MeshBasicMaterial({
    color: 0xbfe6ff,
    transparent: true,
    opacity: 0.08,
    fog: false,
  });
  const towers: Array<[number, number, number, number, number]> = [
    [-24, 46, 7, 16, 8],
    [-17, 57, 5, 11, 6],
    [20, 44, 8, 19, 9],
    [27, 55, 6, 12, 7],
    [12, 61, 5, 9, 5],
  ];
  for (const [x, z, w, h, d] of towers) {
    box(w, h, d, towerMat, x, h / 2, z, exterior);
    for (let i = 0; i < 4; i++) {
      box(
        w * 0.72,
        0.035,
        0.02,
        windowMat,
        x,
        2.4 + i * (h * 0.18),
        z - d / 2 - 0.02,
        exterior,
      );
    }
  }

  // The showroom wordmark hanging in the mouth of the tunnel.
  const wordmark = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4.8),
    new THREE.MeshBasicMaterial({
      map: wordmarkMap,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  wordmark.position.set(0, 8.6, 39.6);
  wordmark.rotation.y = Math.PI;
  exterior.add(wordmark);

  const spillMat = new THREE.MeshBasicMaterial({
    map: doorSpillTexture(),
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 7), spillMat);
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, 0.02, 6.2);
  root.add(spill);

  // Sun shafts falling through the open door.
  const shaftMat = new THREE.MeshBasicMaterial({
    color: 0xffeecc,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(6.1, 6.6), shaftMat);
  shaft.rotation.x = -Math.PI / 2;
  shaft.position.set(0, 0.035, 5.5);
  root.add(shaft);
  const hazeMat = new THREE.MeshBasicMaterial({
    color: 0xdfeaff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.4), hazeMat);
  haze.position.set(0, 1.75, 8.55);
  root.add(haze);

  // Tunnel traffic. Opposing streams: headlights coming in, tail lights leaving.
  const traffic: Array<{ group: THREE.Group; dir: number; speed: number }> = [];
  const trafficBody = new THREE.MeshBasicMaterial({ color: 0x0d120e, fog: false });
  const headlightMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false });
  const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff3b1f, fog: false });
  for (let i = 0; i < 5; i++) {
    const car = new THREE.Group();
    const direction = i % 2 === 0 ? -1 : 1;
    car.position.set(direction > 0 ? 1.9 : -1.9, 0.34, 6 + i * 11);
    car.rotation.y = direction > 0 ? 0 : Math.PI;
    box(1.5, 0.5, 2.9, trafficBody, 0, 0, 0, car);
    box(1.2, 0.32, 1.3, trafficBody, 0, 0.38, -0.1, car);
    for (const side of [-1, 1]) {
      const head = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.14), headlightMat);
      head.position.set(side * 0.5, 0.04, 1.48);
      car.add(head);
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.12), taillightMat);
      tail.position.set(side * 0.5, 0.06, -1.48);
      tail.rotation.y = Math.PI;
      car.add(tail);
    }
    exterior.add(car);
    traffic.push({ group: car, dir: direction, speed: 8 + Math.random() * 9 });
  }

  // Illuminated pylon beside the tunnel mouth.
  const pylonMat = new THREE.MeshBasicMaterial({
    map: sideSignTexture(),
    transparent: true,
    side: THREE.DoubleSide,
    fog: false,
  });  const pylon = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 6), pylonMat);
  pylon.position.set(6.6, 4.2, 13.5);
  pylon.rotation.y = Math.PI;
  exterior.add(pylon);
  for (const y of [1.2, 7.2]) {
    box(0.12, 0.12, 0.12, darkSteel, 6.6, y, 13.6, exterior);
  }

  // Rain, only visible through the door when the weather turns.
  const rainCount = 460;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 44;
    rainPositions[i * 3 + 1] = Math.random() * 18;
    rainPositions[i * 3 + 2] = Math.random() * 66;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rainMat = new THREE.PointsMaterial({
    color: 0xb8cfe0,
    size: 0.055,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    fog: false,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.visible = false;
  exterior.add(rain);

  /* ------------------------------------------------------------------ */
  /* Two-post lift                                                       */
  /* ------------------------------------------------------------------ */

  const lift = new THREE.Group();
  root.add(lift);
  const carriage = new THREE.Group();
  lift.add(carriage);
  for (const side of [-1, 1]) {
    box(0.34, 3.1, 0.6, darkSteel, side * 2.0, 1.55, 0.2, lift);
    box(0.62, 0.16, 1.0, darkSteel, side * 2.0, 0.08, 0.2, lift);
    box(0.2, 2.4, 0.16, hazard, side * 2.0, 1.55, 0.52, lift);
    cylinder(0.1, 2.3, steel, side * 1.92, 1.5, 0.2, lift);
    box(0.64, 0.16, 4.7, darkSteel, side * 0.86, 0.32, 0.2, carriage);
    box(0.42, 0.05, 4.5, steel, side * 0.86, 0.41, 0.2, carriage);
    const ramp = box(0.64, 0.05, 0.8, steel, side * 0.86, 0.3, 2.86, carriage);
    ramp.rotation.x = -0.18;
    const rampBack = box(0.64, 0.05, 0.8, steel, side * 0.86, 0.3, -2.46, carriage);
    rampBack.rotation.x = 0.18;
    box(0.06, 0.04, 4.2, acid, side * 1.16, 0.44, 0.2, carriage);
  }
  box(4.35, 0.26, 0.52, darkSteel, 0, 3.12, 0.2, lift);
  box(0.5, 0.36, 0.3, darkSteel, -2.0, 1.55, 0.62, lift);
  const liftLamp = cylinder(0.06, 0.04, acid, -2.0, 1.62, 0.79, lift);
  liftLamp.rotation.x = Math.PI / 2;

  /* ------------------------------------------------------------------ */
  /* Tool wall + workbench                                               */
  /* ------------------------------------------------------------------ */

  const pegboard = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 2.5),
    new THREE.MeshStandardMaterial({
      map: pegboardTexture(),
      roughness: 0.9,
      metalness: 0.05,
    }),
  );
  pegboard.position.set(0, 2.02, -8.68);
  root.add(pegboard);
  box(7.6, 0.08, 0.1, steel, 0, 3.3, -8.64);
  box(7.6, 0.08, 0.1, steel, 0, 0.74, -8.64);

  const toolGroup = new THREE.Group();
  root.add(toolGroup);
  // Every tool remembers where it hangs and where it gets laid down, so
  // service mode can physically pull the wall down onto the shop floor.
  const tools: Array<{
    node: THREE.Object3D;
    home: THREE.Vector3;
    homeQuat: THREE.Quaternion;
    rest: THREE.Vector3;
    restQuat: THREE.Quaternion;
  }> = [];
  let toolIndex = 0;
  const registerTool = (node: THREE.Object3D, restY: number): void => {
    const index = toolIndex++;
    const row = Math.floor(index / 5);
    const col = index % 5;
    const home = node.position.clone();
    const homeQuat = node.quaternion.clone();
    const rest = new THREE.Vector3(
      -3.2 + col * 0.86 + row * 0.3,
      restY,
      -7.6 + row * 0.36,
    );
    const restQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, (index % 3 - 1) * 0.14, -Math.PI / 2, "YXZ"),
    );
    tools.push({ node, home, homeQuat, rest, restQuat });
  };
  const wrench = (x: number, y: number, length: number, rotate: number) => {
    const arm = new THREE.Group();
    arm.position.set(x, y, -8.6);
    arm.rotation.z = rotate;
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.045, length, 0.03), steel);
    arm.add(shaft);
    const head = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 16, Math.PI * 1.4), steel);
    head.position.y = length / 2;
    head.rotation.z = Math.PI * 0.2;
    arm.add(head);
    toolGroup.add(arm);
    registerTool(arm, 0.045);
  };
  for (let i = 0; i < 5; i++) {
    wrench(-2.9 + i * 0.3, 2.5, 0.42 + i * 0.06, -0.28 + i * 0.12);
  }
  wrench(1.4, 2.55, 0.5, 0.5);
  wrench(2.5, 2.5, 0.44, -0.4);

  const screwdriver = (x: number, y: number, length: number, tint: THREE.Material) => {
    const group = new THREE.Group();
    group.position.set(x, y, -8.6);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.2, 10), tint);
    handle.position.y = length / 2 - 0.1;
    group.add(handle);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, length, 8), steel);
    shaft.position.y = -0.05;
    group.add(shaft);
    toolGroup.add(group);
    registerTool(group, 0.05);
  };
  screwdriver(-1.55, 2.55, 0.5, red);
  screwdriver(-1.32, 2.55, 0.44, darkSteel);
  screwdriver(-1.09, 2.55, 0.38, red);
  screwdriver(-0.86, 2.55, 0.34, darkSteel);

  const hammer = new THREE.Group();
  hammer.position.set(0.35, 2.4, -8.6);
  const hammerHandle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.04), darkSteel);
  hammer.add(hammerHandle);
  const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.09), steel);
  hammerHead.position.y = 0.32;
  hammer.add(hammerHead);
  toolGroup.add(hammer);
  registerTool(hammer, 0.14);

  const pliers = (x: number) => {
    const group = new THREE.Group();
    group.position.set(x, 2.42, -8.6);
    for (const tilt of [-0.18, 0.18]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.4, 0.02), darkSteel);
      part.rotation.z = tilt;
      group.add(part);
    }
    toolGroup.add(group);
    registerTool(group, 0.04);
  };
  pliers(3.05);
  pliers(3.25);

  // Socket rail.
  box(0.9, 0.05, 0.04, steel, -0.1, 1.72, -8.63);
  for (let i = 0; i < 6; i++) {
    cylinder(0.035, 0.08, steel, -0.5 + i * 0.16, 1.68, -8.6, root, 10).rotation.x = Math.PI / 2;
  }

  // Bench.
  box(4.1, 0.11, 0.95, steel, 0, 0.94, -8.16);
  box(4.1, 0.05, 0.95, darkSteel, 0, 0.6, -8.16);
  for (const x of [-1.8, -0.6, 0.6, 1.8]) {
    box(0.09, 0.9, 0.09, darkSteel, x, 0.45, -7.76);
    box(0.09, 0.9, 0.09, darkSteel, x, 0.45, -8.56);
  }
  // Vise.
  box(0.3, 0.18, 0.24, steel, -1.55, 1.09, -8.05);
  box(0.34, 0.08, 0.12, darkSteel, -1.55, 1.25, -7.98);
  cylinder(0.02, 0.34, steel, -1.55, 1.25, -7.9, root, 8).rotation.z = Math.PI / 2;
  // Tool chest.
  const chest = box(0.95, 0.56, 0.56, red, 1.35, 1.27, -8.1);
  chest.rotation.y = 0.04;
  for (let i = 0; i < 3; i++) {
    box(0.8, 0.03, 0.02, steel, 1.35, 1.12 + i * 0.16, -7.81);
    box(0.26, 0.03, 0.03, acid, 1.35, 1.12 + i * 0.16, -7.8);
  }
  // Oil cans.
  for (let i = 0; i < 3; i++) {
    cylinder(0.07, 0.24, i === 1 ? acid : darkSteel, -0.55 + i * 0.18, 1.13, -8.15, root, 12);
  }
  const radio = box(0.42, 0.24, 0.18, darkSteel, 2.05, 1.13, -8.2);
  radio.rotation.y = -0.05;
  const dial = new THREE.Mesh(
    new THREE.PlaneGeometry(0.14, 0.05),
    new THREE.MeshBasicMaterial({ color: ACID }),
  );
  dial.position.set(2.05, 1.16, -8.1);
  dial.rotation.x = -0.1;
  root.add(dial);

  // Die-cast display rack on the bench: two stepped tiers of 1:18 models.
  // Each casting mirrors a career unlock, so the shelf fills as the ladder
  // is climbed and empty slots stay visible until you have earned them.
  const display = new THREE.Group();
  display.position.set(0.42, 0.995, -8.2);
  root.add(display);
  const toyBody = new THREE.BoxGeometry(0.085, 0.034, 0.185);
  const toyCabin = new THREE.BoxGeometry(0.07, 0.03, 0.08);
  const toyWheel = new THREE.CylinderGeometry(0.017, 0.017, 0.014, 10);
  const diecastCars: Array<{ group: THREE.Group; entry: DieCastEntry }> = [];
  for (let tier = 0; tier < 2; tier++) {
    const y = 0.01 + tier * 0.135;
    const z = 0.1 - tier * 0.062;
    box(0.96, 0.022, 0.21, darkSteel, 0, y, z, display);
    box(0.96, 0.012, 0.014, steel, 0, y + 0.014, z + 0.1, display);
    for (let slot = 0; slot < 4; slot++) {
      const entry = DIE_CAST_CATALOG[tier * 4 + slot];
      const paint = new THREE.MeshStandardMaterial({
        color: entry.hex,
        roughness: 0.3,
        metalness: 0.6,
      });
      const car = new THREE.Group();
      car.position.set(-0.315 + slot * 0.21, y + 0.02, z);
      car.rotation.y = ((tier + slot) % 3 - 1) * 0.08;
      const body = new THREE.Mesh(toyBody, paint);
      body.position.y = 0.026;
      car.add(body);
      const cabin = new THREE.Mesh(toyCabin, paint);
      cabin.position.set(0, 0.055, -0.012);
      car.add(cabin);
      for (const wx of [-0.05, 0.05]) {
        for (const wz of [-0.062, 0.062]) {
          const wheel = new THREE.Mesh(toyWheel, rubber);
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(wx, 0.015, wz);
          car.add(wheel);
        }
      }
      display.add(car);
      diecastCars.push({ group: car, entry });
    }
  }
  for (const side of [-1, 1]) {
    box(0.03, 0.34, 0.44, darkSteel, side * 0.495, 0.17, -0.03, display);
  }
  box(0.96, 0.3, 0.02, wallDark, 0, 0.17, -0.17, display);
  box(0.34, 0.05, 0.01, acid, 0, 0.05, 0.24, display);

  // Paddock notes pinned to the pegboard.
  for (let i = 0; i < 3; i++) {
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), paper);
    note.position.set(-3.5 + i * 0.62, 2.0, -8.62);
    note.rotation.z = (i - 1) * 0.05;
    root.add(note);
    const pin = cylinder(0.02, 0.03, acid, -3.5 + i * 0.62, 2.22, -8.6, root, 8);
    pin.rotation.x = Math.PI / 2;
    box(0.34, 0.015, 0.01, darkSteel, -3.5 + i * 0.62, 2.02, -8.61);
    box(0.26, 0.015, 0.01, darkSteel, -3.5 + i * 0.62, 1.94, -8.61);
  }

  // Stool.
  cylinder(0.22, 0.06, darkSteel, 2.85, 0.62, -7.2, root, 18);
  cylinder(0.035, 0.58, steel, 2.85, 0.31, -7.2, root, 10);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = box(0.04, 0.55, 0.04, steel, 2.85 + Math.cos(a) * 0.16, 0.28, -7.2 + Math.sin(a) * 0.16);
    leg.rotation.z = Math.cos(a) * 0.2;
  }

  // Bay computer on the bench: paint, service and knowledge in one screen.
  box(0.52, 0.02, 0.34, darkSteel, -0.85, 1.0, -8.08);
  for (let i = 0; i < 4; i++) {
    box(0.05, 0.004, 0.02, steel, -1.03 + i * 0.05, 1.012, -7.94);
    box(0.05, 0.004, 0.02, steel, -1.03 + i * 0.05, 1.012, -8.22);
  }
  const terminal = terminalCanvas();
  const terminalTexture = texture(terminal.canvas);
  terminalTexture.wrapS = THREE.ClampToEdgeWrapping;
  terminalTexture.wrapT = THREE.ClampToEdgeWrapping;
  const terminalState: GarageTerminalState = {
    cp: 0,
    licence: "ROOKIE",
    unlocks: 0,
    rpm: 0,
    door: false,
    lift: false,
    service: false,
    paint: "STOCK",
    knowledge: 0,
  };
  drawTerminal(terminal.ctx, terminalState, 0);
  terminalTexture.needsUpdate = true;
  const laptopScreenMat = new THREE.MeshBasicMaterial({
    map: terminalTexture,
    transparent: true,
    fog: false,
  });
  const laptopLid = new THREE.Group();
  laptopLid.position.set(-0.85, 1.01, -8.22);
  laptopLid.rotation.x = -0.28;
  root.add(laptopLid);
  box(0.52, 0.34, 0.02, darkSteel, 0, 0.17, 0, laptopLid);
  const laptopScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), laptopScreenMat);
  laptopScreen.position.set(0, 0.17, 0.012);
  laptopLid.add(laptopScreen);

  // Door remote on the front wall.
  box(0.3, 0.44, 0.08, darkSteel, -4.35, 1.5, 8.64);
  const remoteButton = box(
    0.11,
    0.11,
    0.05,
    new THREE.MeshStandardMaterial({
      color: 0x3d120c,
      emissive: 0xff4b1f,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }),
    -4.35,
    1.6,
    8.58,
  );
  remoteButton.rotation.x = 0.02;
  box(0.16, 0.02, 0.01, acid, -4.35, 1.4, 8.59);

  // Launch-control practice area near the door.
  const padMat = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    fog: false,
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 3.1), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(3.6, 0.016, 6.0);
  root.add(pad);
  for (const [px, pz] of [
    [2.7, 4.6],
    [4.5, 4.6],
    [2.7, 7.4],
    [4.5, 7.4],
  ]) {
    box(0.09, 0.5, 0.09, darkSteel, px, 0.25, pz);
    cylinder(0.06, 0.06, acid, px, 0.54, pz, root, 10);
  }

  // The bay cat, asleep by the tyre stack until it decides otherwise.
  const cat = new THREE.Group();
  cat.position.set(6.05, 0, 2.6);
  root.add(cat);
  const fur = new THREE.MeshStandardMaterial({ color: 0x2b2c26, roughness: 0.92 });
  const furLight = new THREE.MeshStandardMaterial({ color: 0x4a4b40, roughness: 0.9 });
  const catBody = box(0.24, 0.17, 0.46, fur, 0, 0.2, 0, cat);
  box(0.17, 0.14, 0.15, fur, 0, 0.27, 0.26, cat);
  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), fur);
  catHead.position.set(0, 0.34, 0.33);
  cat.add(catHead);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 6), furLight);
    ear.position.set(side * 0.06, 0.43, 0.33);
    cat.add(ear);
    const leg = box(0.045, 0.14, 0.045, furLight, side * 0.085, 0.08, 0.15, cat);
    leg.rotation.x = 0.1;
    box(0.045, 0.14, 0.045, furLight, side * 0.085, 0.08, -0.16, cat);
  }
  const catTail = new THREE.Group();
  catTail.position.set(0, 0.2, -0.24);
  cat.add(catTail);
  const tailSeg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, 0.34, 8), fur);
  tailSeg.position.set(0, 0.12, -0.04);
  tailSeg.rotation.x = -0.6;
  catTail.add(tailSeg);
  const catBed = cylinder(0.42, 0.09, red, 6.3, 0.045, 3.5, root, 20);
  catBed.scale.z = 0.8;
  catBed.rotation.y = 0.4;

  // Wall tachometer: live rpm off the rev rig.
  const tach = tachCanvas();
  const tachTexture = texture(tach.canvas);
  tachTexture.wrapS = THREE.ClampToEdgeWrapping;
  tachTexture.wrapT = THREE.ClampToEdgeWrapping;
  drawTach(tach.ctx, 0, 0);
  tachTexture.needsUpdate = true;
  const tachPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 1.35),
    new THREE.MeshBasicMaterial({ map: tachTexture, fog: false }),
  );
  tachPanel.position.set(-7.66, 3.05, 1.7);
  tachPanel.rotation.y = Math.PI / 2;
  root.add(tachPanel);
  box(0.08, 1.5, 2.86, darkSteel, -7.7, 3.05, 1.7);

  // Rev-reactive LED strips under the bench and along the left wall.
  const revLeds: Array<{ mat: THREE.MeshBasicMaterial }> = [];
  const ledGeo = new THREE.PlaneGeometry(0.17, 0.055);
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x141a11, fog: false });
    const led = new THREE.Mesh(ledGeo, mat);
    led.position.set(-1.8 + i * 0.24, 0.72, -7.66);
    root.add(led);
    revLeds.push({ mat });
  }
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x141a11, fog: false });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.42), mat);
    led.position.set(-7.63, 1.2, -6.4 + i * 0.62);
    led.rotation.y = Math.PI / 2;
    root.add(led);
    revLeds.push({ mat });
  }

  /* ------------------------------------------------------------------ */
  /* Wall details: sign, posters, clock, trophy shelf                    */
  /* ------------------------------------------------------------------ */

  const signMat = new THREE.MeshBasicMaterial({
    map: signTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    fog: false,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.4), signMat);
  sign.position.set(0, 3.78, -8.66);
  root.add(sign);

  for (let i = 0; i < 3; i++) {
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.5),
      new THREE.MeshStandardMaterial({ map: posterTexture(i), roughness: 0.8 }),
    );
    poster.position.set(-6.2 + i * 1.5, 2.4, -8.67);
    root.add(poster);
  }

  // Clock with live hands.
  const clockFace = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 32),
    new THREE.MeshStandardMaterial({ color: 0xe7e2d2, roughness: 0.6 }),
  );
  clockFace.position.set(7.66, 2.75, -5.4);
  clockFace.rotation.y = -Math.PI / 2;
  root.add(clockFace);
  const clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.025, 8, 32), darkSteel);
  clockRim.position.copy(clockFace.position);
  clockRim.rotation.y = -Math.PI / 2;
  root.add(clockRim);
  const hourHand = box(0.018, 0.17, 0.012, darkSteel, 0, 0, 0);
  const minuteHand = box(0.014, 0.25, 0.012, darkSteel, 0, 0, 0);
  hourHand.geometry.translate(0, 0.085, 0);
  minuteHand.geometry.translate(0, 0.125, 0);
  for (const hand of [hourHand, minuteHand]) {
    hand.position.set(7.64, 2.75, -5.4);
    hand.rotation.y = -Math.PI / 2;
    root.add(hand);
  }

  // Trophy shelf on the right wall.
  box(0.36, 0.06, 3.4, darkSteel, 7.6, 1.72, -3.1);
  box(0.36, 0.06, 3.4, darkSteel, 7.6, 2.34, -3.1);
  for (const z of [-4.6, -1.6]) {
    box(0.06, 0.32, 0.06, steel, 7.5, 1.9, z);
  }
  const trophyGroups: THREE.Group[] = [];
  const trophy = (x: number, y: number, z: number, scale: number) => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.scale.setScalar(scale);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), darkSteel);
    base.position.y = 0.03;
    group.add(base);
    cylinder(0.03, 0.16, gold, 0, 0.14, 0, group, 10);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.06, 0.2, 18, 1, true), gold);
    cup.position.y = 0.31;
    group.add(cup);
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 8, 16, Math.PI), gold);
      handle.position.set(side * 0.13, 0.32, 0);
      handle.rotation.z = side * Math.PI * 0.5;
      group.add(handle);
    }
    root.add(group);
    trophyGroups.push(group);
  };
  trophy(7.5, 1.75, -4.3, 1);
  trophy(7.5, 1.75, -3.35, 0.85);
  trophy(7.5, 1.75, -2.5, 0.7);
  trophy(7.5, 2.37, -4.0, 0.6);
  trophy(7.5, 2.37, -3.1, 0.55);
  trophy(7.5, 2.37, -2.2, 0.5);
  trophy(7.5, 1.75, -3.9, 0.45);
  trophy(7.5, 1.75, -2.9, 0.42);

  /* ------------------------------------------------------------------ */
  /* Tyre stack, shelves, bike mat, fridge                              */
  /* ------------------------------------------------------------------ */

  const tyre = (x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.13, 12, 28), rubber);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    root.add(mesh);
    cylinder(0.24, 0.1, steel, x, y, z, root, 20);
  };
  for (let i = 0; i < 4; i++) tyre(6.7, 0.16 + i * 0.27, 1.2);

  // Wall shelves with parts boxes.
  for (const y of [1.5, 2.15]) {
    box(0.5, 0.05, 2.2, darkSteel, 7.55, y, 3.4);
  }
  for (let i = 0; i < 4; i++) {
    box(0.36, 0.28, 0.42, i % 2 ? red : paper, 7.55, 1.68 + (i > 1 ? 0.65 : 0), 2.7 + (i % 2) * 0.55);
  }

  const matBorder = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    fog: false,
  });
  const bikeMat = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 3.8),
    new THREE.MeshStandardMaterial({ color: 0x0d0f0c, roughness: 0.95 }),
  );
  bikeMat.rotation.x = -Math.PI / 2;
  bikeMat.position.set(5.5, 0.015, 3.4);
  root.add(bikeMat);
  for (const side of [-1, 1]) {
    const border = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 3.8), matBorder);
    border.rotation.x = -Math.PI / 2;
    border.position.set(5.5 + side * 1.18, 0.02, 3.4);
    root.add(border);
  }

  // Mini fridge in the back-left corner.
  box(0.72, 1.5, 0.66, paper, -7.1, 0.75, -8.3);
  box(0.7, 0.05, 0.64, darkSteel, -7.1, 1.52, -8.3);
  box(0.06, 0.5, 0.05, steel, -6.86, 1.15, -7.98);
  box(0.34, 0.12, 0.01, acid, -7.12, 1.2, -7.96);
  for (let i = 0; i < 2; i++) {
    box(0.6, 0.5, 0.52, new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.9 }), -6.4 + i * 0.75, 0.25, -8.2);
  }

  /* ------------------------------------------------------------------ */
  /* Lights                                                              */
  /* ------------------------------------------------------------------ */

  const garageLights: Array<{ light: THREE.Light; base: number }> = [];
  const addLight = <T extends THREE.Light>(light: T, base: number): T => {
    light.intensity = base;
    root.add(light);
    garageLights.push({ light, base });
    return light;
  };

  addLight(new THREE.HemisphereLight(0xffe7c6, 0x0a0b07, 0.55), 0.55);
  const bayLightA = addLight(new THREE.PointLight(0xffdba8, 26, 14, 2), 26);
  bayLightA.position.set(0, 3.7, 1.6);
  const bayLightB = addLight(new THREE.PointLight(0xffe2bb, 18, 12, 2), 18);
  bayLightB.position.set(0, 3.4, -2.1);
  const doorFill = addLight(new THREE.PointLight(0xfff2d6, 12, 10, 2), 12);
  doorFill.position.set(0, 2.6, 6.4);
  const benchLight = addLight(new THREE.PointLight(0xffe3b0, 14, 9, 2), 14);
  benchLight.position.set(0, 2.6, -7.2);
  const trophyLight = addLight(new THREE.PointLight(0xffd28a, 5, 5, 2), 5);
  trophyLight.position.set(7.1, 2.3, -3.1);
  const doorLight = addLight(new THREE.DirectionalLight(0xdfeaff, 1.1), 1.1);
  doorLight.position.set(0, 4, 14);
  doorLight.target.position.set(0, 0.8, 1);
  root.add(doorLight.target);

  // Strip lights + hanging lamps.
  const stripMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d2,
    transparent: true,
    opacity: 0.95,
    fog: false,
  });
  for (const z of [-6.2, -3.1, 0, 3.1, 6.2]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.06, 0.2), stripMat);
    strip.position.set(0, 4.44, z);
    root.add(strip);
    box(12, 0.08, 0.34, darkSteel, 0, 4.5, z);
  }
  const bulbMat = new THREE.MeshBasicMaterial({
    color: 0xfff4da,
    transparent: true,
    opacity: 1,
    fog: false,
  });
  for (const x of [-2.2, 2.2]) {
    for (const z of [-1.4, 1.8]) {
      cylinder(0.015, 0.5, darkSteel, x, 4.3, z, root, 6);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.24, 16, 1, true), darkSteel);
      shade.position.set(x, 4.04, z);
      root.add(shade);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), bulbMat);
      bulb.position.set(x, 3.94, z);
      root.add(bulb);
    }
  }

  // Dust motes.
  const dustCount = 220;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 14;
    dustPositions[i * 3 + 1] = 0.3 + Math.random() * 4;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 16;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xffe0b0,
      size: 0.028,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  root.add(dust);

  /* ------------------------------------------------------------------ */
  /* Hotspots                                                            */
  /* ------------------------------------------------------------------ */

  const hotspots: GarageHotspot[] = [
    { id: "lift", label: "LIFT CONTROLS", position: new THREE.Vector3(-2, 1.5, 0.62), radius: 1.7 },
    { id: "door", label: "DOOR REMOTE", position: new THREE.Vector3(-4.35, 1.5, 8.3), radius: 1.8 },
    { id: "shelf", label: "DIE-CAST SHELF", position: new THREE.Vector3(0.42, 1.25, -8.2), radius: 1.3 },
    { id: "computer", label: "BAY COMPUTER", position: new THREE.Vector3(-0.85, 1.2, -8.1), radius: 1.25 },
    { id: "radio", label: "RADIO TUNER", position: new THREE.Vector3(2.05, 1.2, -8.15), radius: 1.35 },
    { id: "stool", label: "SIT ON STOOL", position: new THREE.Vector3(2.85, 0.7, -7.2), radius: 1.4 },
    { id: "trophies", label: "TROPHY WALL", position: new THREE.Vector3(7.1, 2.1, -3.1), radius: 1.9 },
    { id: "cat", label: "THE BAY CAT", position: new THREE.Vector3(6.05, 0.3, 2.6), radius: 1.7 },
    { id: "launch", label: "LAUNCH PRACTICE", position: new THREE.Vector3(3.6, 0.3, 6.0), radius: 2 },
  ];

  const ringMat = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    fog: false,
  });
  const ringGeo = new THREE.RingGeometry(0.3, 0.42, 36);
  const rings = new Map<string, THREE.Mesh>();
  for (const spot of hotspots) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(spot.position.x, 0.028, spot.position.z);
    ring.visible = false;
    root.add(ring);
    rings.set(spot.id, ring);
  }
  let activeRing: THREE.Mesh | null = null;

  /* ------------------------------------------------------------------ */
  /* Animation                                                           */
  /* ------------------------------------------------------------------ */

  let lightLevel = 1;
  let doorOpen = 0;
  let revRpm = 0;
  let revKick = 0;
  let lastTach = -1;

  const setRev = (rpm: number, kick: number): void => {
    revRpm = Math.max(0, Math.min(1.12, rpm));
    revKick = Math.max(0, Math.min(1, kick));
  };

  const setLift = (raised: number): void => {
    carriage.position.y = Math.max(0, Math.min(1, raised)) * 1.32;
  };

  const setTrophies = (count: number): void => {
    const shown = Math.max(0, Math.min(trophyGroups.length, Math.round(count)));
    trophyGroups.forEach((group, index) => {
      group.visible = index < shown;
    });
  };

  const setActiveHotspot = (id: string | null): void => {
    for (const [key, ring] of rings) ring.visible = key === id;
    activeRing = id ? rings.get(id) ?? null : null;
  };

  const setDoor = (open: number): void => {
    doorOpen = Math.max(0, Math.min(1, open));
    roll.scale.y = Math.max(0.035, 1 - doorOpen * 0.965);
    spillMat.opacity = doorOpen * 0.3;
    shaftMat.opacity = doorOpen * 0.055;
    hazeMat.opacity = doorOpen * 0.03;
    doorLight.intensity = 0.15 + doorOpen * 1.05;
  };

  const setLights = (level: number): void => {
    lightLevel = Math.max(0, Math.min(1, level));
    for (const { light, base } of garageLights) {
      if (light === doorLight) continue;
      light.intensity = base * (0.06 + lightLevel * 0.94);
    }
    stripMat.opacity = 0.05 + lightLevel * 0.95;
    bulbMat.opacity = 0.1 + lightLevel * 0.9;
    signMat.opacity = (0.35 + lightLevel * 0.6) * (0.86 + 0.14 * Math.sin(lightLevel * 24));
  };

  const setWeather = (wet: boolean, night: boolean): void => {
    rain.visible = wet;
    roadMat.color.setHex(wet ? 0x93a49a : 0xdfe7da);
    towerMat.color.setHex(night ? 0x070c09 : 0x111a14);
    laneMat.opacity = night ? 0.55 : 0.4;
    pylonMat.opacity = wet ? 0.7 : 0.95;
  };

  const update = (dt: number, time: number): void => {
    const now = new Date();
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    minuteHand.rotation.z = -(minutes / 60) * Math.PI * 2;
    hourHand.rotation.z = -(hours / 12) * Math.PI * 2;
    drum.rotation.x += dt * 0.4 * doorOpen;
    dust.rotation.y += dt * 0.008;
    dust.position.y = Math.sin(time * 0.16) * 0.06;
    signMat.opacity = (0.35 + lightLevel * 0.6) * (0.82 + 0.18 * Math.abs(Math.sin(time * 2.1)));
    liftLamp.visible = Math.sin(time * 2.4) > -0.4;
    spillMat.opacity = doorOpen * (0.27 + 0.04 * Math.sin(time * 1.7));
    shaftMat.opacity = doorOpen * (0.05 + 0.014 * Math.sin(time * 0.9));
    hazeMat.opacity = doorOpen * (0.026 + 0.008 * Math.sin(time * 1.3));
    glowMat.opacity = 0.84 + 0.09 * Math.sin(time * 1.15);
    pylonMat.opacity = 0.82 + 0.16 * Math.sin(time * 1.4);
    toolGroup.position.y = Math.sin(time * 0.5) * 0.002;

    // Tachometer + shift lights.
    if (Math.abs(revRpm - lastTach) > 0.003 || revKick > 0.06) {
      drawTach(tach.ctx, revRpm, revKick);
      tachTexture.needsUpdate = true;
      lastTach = revRpm;
    }
    const fuel = Math.min(1, revRpm + revKick * 0.18);
    const hot = revRpm > 0.86;
    revLeds.forEach(({ mat }, index) => {
      const point = index / (revLeds.length - 1);
      mat.color.setHex(point <= fuel ? (hot && point > 0.7 ? 0xff5a1f : ACID) : 0x141a11);
    });

    // Traffic down the approach and rain through the door.
    for (const trafficCar of traffic) {
      const group = trafficCar.group;
      group.position.z += trafficCar.dir * trafficCar.speed * dt;
      if (group.position.z > 64) group.position.z = 2;
      if (group.position.z < 2) group.position.z = 64;
    }
    if (rain.visible) {
      const positions = rainGeo.getAttribute("position") as THREE.BufferAttribute;
      const array = positions.array as Float32Array;
      for (let i = 0; i < rainCount; i++) {
        array[i * 3 + 1] -= dt * (7 + (i % 4) * 2.3);
        if (array[i * 3 + 1] < 0) array[i * 3 + 1] = 18;
      }
      positions.needsUpdate = true;
    }

    // The cat patrols its corner and never hurries.
    cat.position.x = 6.05 + Math.sin(time * 0.17) * 0.55;
    cat.position.z = 2.6 + Math.cos(time * 0.23) * 0.85;
    cat.rotation.y = Math.sin(time * 0.17) * 0.7;
    catBody.position.y = 0.2 + Math.sin(time * 1.7) * 0.006;
    catHead.rotation.y = Math.sin(time * 0.6) * 0.4;
    catTail.rotation.z = Math.sin(time * 2.6) * 0.42;
    catTail.rotation.x = Math.sin(time * 1.3) * 0.18;

    if (activeRing) activeRing.rotation.z += dt * 0.5;
    ringMat.opacity = 0.26 + 0.16 * Math.sin(time * 3.6);
  };

  setDoor(0);
  setLights(0);

  return {
    group: root,
    setDoor,
    setLights,
    update,
    setRev,
    setWeather,
    setLift,
    setTrophies,
    setActiveHotspot,
    hotspots,
    dispose: () => {
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      for (const { light } of garageLights) light.dispose();
      concrete.map?.dispose();
      asphaltMap.dispose();
      portalMap.dispose();
      wordmarkMap.dispose();
      spillMat.map?.dispose();
      stripMat.dispose();
      bulbMat.dispose();
      signMat.map?.dispose();
      signMat.dispose();
      ringMat.dispose();
      ringGeo.dispose();
      rainGeo.dispose();
      rainMat.dispose();
    },
  };
}
