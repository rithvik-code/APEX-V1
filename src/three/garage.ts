import * as THREE from "three";

const ACID = 0xc8ff16;
const ACID_HEX = "#c8ff16";

export type GarageStage = {
  group: THREE.Group;
  setDoor: (open: number) => void;
  setLights: (level: number) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
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

function outsideTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = canvas2d(512, 256);
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#cfd9e4");
  grad.addColorStop(0.55, "#8ea4b6");
  grad.addColorStop(1, "#3d4a3e");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(40 + i * 120, 40, 2, 200);
  }
  ctx.fillStyle = "rgba(30,40,30,0.55)";
  ctx.fillRect(0, 196, 512, 60);
  return texture(canvas);
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

  const outsideMat = new THREE.MeshBasicMaterial({
    map: outsideTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.2), outsideMat);
  outside.position.set(0, 2.4, 10.4);
  outside.rotation.y = Math.PI;
  root.add(outside);

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

  /* ------------------------------------------------------------------ */
  /* Two-post lift                                                       */
  /* ------------------------------------------------------------------ */

  const lift = new THREE.Group();
  root.add(lift);
  for (const side of [-1, 1]) {
    box(0.34, 3.1, 0.6, darkSteel, side * 2.0, 1.55, 0.2, lift);
    box(0.62, 0.16, 1.0, darkSteel, side * 2.0, 0.08, 0.2, lift);
    box(0.2, 2.4, 0.16, hazard, side * 2.0, 1.55, 0.52, lift);
    cylinder(0.1, 2.3, steel, side * 1.92, 1.5, 0.2, lift);
    box(0.64, 0.16, 4.7, darkSteel, side * 0.86, 0.32, 0.2, lift);
    box(0.42, 0.05, 4.5, steel, side * 0.86, 0.41, 0.2, lift);
    const ramp = box(0.64, 0.05, 0.8, steel, side * 0.86, 0.3, 2.86, lift);
    ramp.rotation.x = -0.18;
    const rampBack = box(0.64, 0.05, 0.8, steel, side * 0.86, 0.3, -2.46, lift);
    rampBack.rotation.x = 0.18;
    box(0.06, 0.04, 4.2, acid, side * 1.16, 0.44, 0.2, lift);
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

  const pliers = (x: number) => {
    for (const tilt of [-0.18, 0.18]) {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.4, 0.02), darkSteel);
      part.position.set(x, 2.42, -8.6);
      part.rotation.z = tilt;
      toolGroup.add(part);
    }
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
  };
  trophy(7.5, 1.75, -4.3, 1);
  trophy(7.5, 1.75, -3.35, 0.85);
  trophy(7.5, 1.75, -2.5, 0.7);
  trophy(7.5, 2.37, -4.0, 0.6);
  trophy(7.5, 2.37, -2.9, 0.55);

  // Blackboard: the local file index chalked onto the left wall.
  const board = createChalkboard();
  board.group.position.set(-7.68, 2.24, 2.6);
  board.group.rotation.y = Math.PI / 2;
  root.add(board.group);

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
  const boardLight = addLight(new THREE.PointLight(0xffeccb, 6, 6, 2), 6);
  boardLight.position.set(-6.7, 3.05, 2.6);
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
  /* Animation                                                           */
  /* ------------------------------------------------------------------ */

  let lightLevel = 1;
  let doorOpen = 0;

  const setDoor = (open: number): void => {
    doorOpen = Math.max(0, Math.min(1, open));
    roll.scale.y = Math.max(0.035, 1 - doorOpen * 0.965);
    outsideMat.opacity = doorOpen;
    spillMat.opacity = doorOpen * 0.5;
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
    spillMat.opacity = doorOpen * (0.46 + 0.06 * Math.sin(time * 1.7));
    toolGroup.position.y = Math.sin(time * 0.5) * 0.002;
    board.update(dt);
  };

  setDoor(0);
  setLights(0);

  return {
    group: root,
    setDoor,
    setLights,
    setFiles: board.setBoard,
    update,
    dispose: () => {
      board.dispose();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      for (const { light } of garageLights) light.dispose();
      concrete.map?.dispose();
      outsideMat.map?.dispose();
      spillMat.map?.dispose();
      stripMat.dispose();
      bulbMat.dispose();
      signMat.map?.dispose();
      signMat.dispose();
    },
  };
}
