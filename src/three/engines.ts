import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const ACID = 0xc8ff16;

/**
 * Shared materials. These are used by both the vehicles and the CORE LAB, so
 * they are intentionally module-level and never disposed by a single scene.
 */
const alloy = new THREE.MeshStandardMaterial({
  color: 0xb7c0c7,
  metalness: 1,
  roughness: 0.26,
  envMapIntensity: 1.4,
});

const steel = new THREE.MeshStandardMaterial({
  color: 0x7c8991,
  metalness: 0.95,
  roughness: 0.34,
  envMapIntensity: 1.2,
});

const dark = new THREE.MeshStandardMaterial({
  color: 0x14181b,
  metalness: 0.82,
  roughness: 0.42,
  envMapIntensity: 0.9,
});

const carbon = new THREE.MeshStandardMaterial({
  color: 0x0a0c0d,
  metalness: 0.5,
  roughness: 0.55,
});

const liner = new THREE.MeshStandardMaterial({
  color: 0x8fa0a8,
  metalness: 0.9,
  roughness: 0.2,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const cover = new THREE.MeshPhysicalMaterial({
  color: 0x1a2024,
  metalness: 0.6,
  roughness: 0.18,
  transparent: true,
  opacity: 0.34,
  clearcoat: 1,
  clearcoatRoughness: 0.06,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const acid = new THREE.MeshBasicMaterial({ color: ACID });
const acidSoft = new THREE.MeshBasicMaterial({
  color: ACID,
  transparent: true,
  opacity: 0.4,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const hot = new THREE.MeshBasicMaterial({ color: 0xff8a4a });
const brass = new THREE.MeshStandardMaterial({
  color: 0xc9a45a,
  metalness: 1,
  roughness: 0.28,
});

export type EngineAssembly = {
  group: THREE.Group;
  update: (t: number) => void;
};

const UP = new THREE.Vector3(0, 1, 0);

function rounded(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  radius = 0.02,
): THREE.Mesh {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, radius), material);
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  material: THREE.Material,
  segments = 18,
): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  );
}

function tube(
  points: Array<[number, number, number]>,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  );
  return new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(10, points.length * 5), radius, 8, false),
    material,
  );
}

function ring(radius: number, thickness: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 6, 32), material);
}

function withEdges(mesh: THREE.Mesh, opacity = 0.45): THREE.Mesh {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 30),
    new THREE.LineBasicMaterial({
      color: ACID,
      transparent: true,
      opacity,
    }),
  );
  mesh.add(edges);
  return mesh;
}

/* -------------------------------------------------------------------------- */
/* V12 — 6.5L, twin turbo, 60° banks                                          */
/* -------------------------------------------------------------------------- */

type BankRig = {
  piston: THREE.Mesh;
  rod: THREE.Mesh;
  phase: number;
  z: number;
  base: number;
};

export function createV12(): EngineAssembly {
  const group = new THREE.Group();
  const riders: BankRig[] = [];
  const camshafts: THREE.Object3D[] = [];
  const turboWheels: THREE.Object3D[] = [];
  const valves: Array<{ mesh: THREE.Mesh; phase: number }> = [];

  // Crankcase / block core ------------------------------------------------
  const caseMesh = withEdges(
    rounded(0.5, 0.22, 1.34, dark, 0.05),
    0.3,
  );
  caseMesh.position.y = 0.0;
  group.add(caseMesh);

  const sump = rounded(0.62, 0.12, 1.4, carbon, 0.04);
  sump.position.y = -0.16;
  group.add(sump);

  // Crankshaft ------------------------------------------------------------
  const crank = new THREE.Group();
  const shaft = cylinder(0.055, 0.055, 1.44, alloy, 20);
  shaft.rotation.x = Math.PI / 2;
  crank.add(shaft);

  for (let i = 0; i < 12; i++) {
    const z = -0.55 + (i % 6) * 0.22;
    const web = rounded(0.035, 0.2, 0.035, steel, 0.012);
    web.position.set(0, 0.02, z);
    web.rotation.z = (i / 12) * Math.PI * 2;
    crank.add(web);
  }

  const flywheel = cylinder(0.19, 0.19, 0.045, steel, 28);
  flywheel.rotation.x = Math.PI / 2;
  flywheel.position.z = 0.71;
  crank.add(flywheel);

  const flywheelTeeth = cylinder(0.205, 0.205, 0.03, dark, 32);
  flywheelTeeth.rotation.x = Math.PI / 2;
  flywheelTeeth.position.z = 0.71;
  crank.add(flywheelTeeth);

  const crankRing = ring(0.19, 0.006, acidSoft);
  crankRing.position.z = 0.735;
  crank.add(crankRing);
  group.add(crank);

  // Two banks of six ------------------------------------------------------
  for (const side of [-1, 1]) {
    const bank = new THREE.Group();
    bank.rotation.z = side * (Math.PI / 6);

    const skirt = withEdges(rounded(0.27, 0.14, 1.3, dark, 0.03), 0.25);
    skirt.position.y = 0.12;
    bank.add(skirt);

    const head = withEdges(rounded(0.25, 0.13, 1.28, alloy, 0.025), 0.22);
    head.position.y = 0.56;
    bank.add(head);

    const coverMesh = rounded(0.26, 0.1, 1.2, cover, 0.045);
    coverMesh.position.y = 0.665;
    bank.add(coverMesh);

    const coverStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.012, 1.02),
      acid,
    );
    coverStripe.position.set(0, 0.715, 0);
    bank.add(coverStripe);

    for (let i = 0; i < 6; i++) {
      const z = -0.55 + i * 0.22;
      const phase = i * 1.15 + (side > 0 ? 0 : Math.PI);

      // Liner
      const linerMesh = cylinder(0.083, 0.083, 0.3, liner, 16);
      linerMesh.position.set(0, 0.37, z);
      bank.add(linerMesh);

      const linerTop = ring(0.083, 0.006, liner);
      linerTop.rotation.x = Math.PI / 2;
      linerTop.position.set(0, 0.47, z);
      bank.add(linerTop);

      const linerBottom = ring(0.083, 0.006, liner);
      linerBottom.rotation.x = Math.PI / 2;
      linerBottom.position.set(0, 0.27, z);
      bank.add(linerBottom);

      // Piston (moves along local Y) and connecting rod.
      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.072, 0.072, 0.09, 18),
        steel,
      );
      piston.position.set(0, 0.38, z);
      bank.add(piston);

      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.074, 0.074, 0.012, 18),
        alloy,
      );
      crown.position.y = 0.05;
      piston.add(crown);

      const rod = cylinder(0.017, 0.022, 1, alloy, 10);
      rod.geometry.translate(0, 0.5, 0);
      bank.add(rod);

      riders.push({ piston, rod, phase, z, base: 0.38 });

      // Four valves per cylinder.
      for (const lateral of [-0.048, 0.048]) {
        for (const dz of [-0.035, 0.035]) {
          const valve = cylinder(0.011, 0.014, 0.14, steel, 8);
          valve.position.set(lateral, 0.52, z + dz);
          bank.add(valve);

          const spring = cylinder(0.018, 0.018, 0.035, dark, 8);
          spring.position.set(lateral, 0.575, z + dz);
          bank.add(spring);

          valves.push({ mesh: valve, phase });
        }
      }
    }

    // Twin overhead cams.
    for (const lateral of [-0.078, 0.078]) {
      const cam = new THREE.Group();
      const camShaft = cylinder(0.022, 0.022, 1.26, alloy, 12);
      camShaft.rotation.x = Math.PI / 2;
      cam.add(camShaft);

      for (let i = 0; i < 6; i++) {
        const lobe = new THREE.Mesh(
          new THREE.BoxGeometry(0.052, 0.05, 0.055),
          steel,
        );
        lobe.position.set(0, 0.028, -0.55 + i * 0.22);
        cam.add(lobe);
      }

      cam.position.set(lateral, 0.64, 0);
      bank.add(cam);
      camshafts.push(cam);
    }

    // Six exhaust primaries curving down the outside of the bank.
    for (let i = 0; i < 6; i++) {
      const z = -0.55 + i * 0.22;
      const x = side > 0 ? -0.13 : 0.13;
      const primary = tube(
        [
          [x, 0.53, z],
          [x * 1.6, 0.33, z],
          [x * 2.2, 0.0, z - 0.08],
          [x * 2.1, -0.12, z - 0.35],
        ],
        0.018,
        steel,
      );
      bank.add(primary);
    }

    group.add(bank);
  }

  // Intake plenum in the valley -------------------------------------------
  const plenum = withEdges(rounded(0.32, 0.22, 1.04, dark, 0.06), 0.35);
  plenum.position.set(0, 0.47, -0.03);
  group.add(plenum);

  const plenumStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.012, 0.92),
    acid,
  );
  plenumStripe.position.set(0, 0.585, -0.03);
  group.add(plenumStripe);

  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -0.55 + i * 0.22;
      const runner = tube(
        [
          [side * 0.13, 0.5, z],
          [side * 0.22, 0.56, z],
          [side * 0.3, 0.57, z],
        ],
        0.019,
        alloy,
      );
      group.add(runner);
    }
  }

  // Twin turbos -----------------------------------------------------------
  for (const side of [-1, 1]) {
    const turbo = new THREE.Group();
    turbo.position.set(side * 0.63, 0.13, -0.72);
    turbo.rotation.y = side * 0.12;

    const volute = new THREE.Mesh(
      new THREE.TorusGeometry(0.135, 0.055, 12, 28),
      alloy,
    );
    volute.rotation.y = Math.PI / 2;
    turbo.add(volute);

    const housing = cylinder(0.14, 0.14, 0.09, steel, 24);
    housing.rotation.z = Math.PI / 2;
    housing.position.x = side * 0.02;
    turbo.add(housing);

    const wheel = new THREE.Group();
    const hub = cylinder(0.035, 0.035, 0.05, dark, 14);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    for (let i = 0; i < 9; i++) {
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.085, 0.028),
        alloy,
      );
      blade.position.y = 0.045;
      blade.rotation.x = 0.5;
      const holder = new THREE.Group();
      holder.rotation.x = (i / 9) * Math.PI * 2;
      holder.add(blade);
      wheel.add(holder);
    }
    wheel.position.x = side * 0.08;
    turbo.add(wheel);
    turboWheels.push(wheel);

    const acidBand = ring(0.135, 0.008, acidSoft);
    acidBand.rotation.y = Math.PI / 2;
    turbo.add(acidBand);

    const wastegate = cylinder(0.032, 0.032, 0.12, dark, 12);
    wastegate.position.set(side * 0.05, 0.17, 0.02);
    turbo.add(wastegate);

    group.add(turbo);

    const intercooler = withEdges(
      rounded(0.1, 0.3, 0.42, dark, 0.02),
      0.25,
    );
    intercooler.position.set(side * 0.74, 0.32, -0.34);
    group.add(intercooler);

    for (let i = 0; i < 6; i++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.26, 0.014),
        steel,
      );
      fin.position.set(side * 0.74, 0.32, -0.5 + i * 0.064);
      group.add(fin);
    }

    const charge = tube(
      [
        [side * 0.72, 0.42, -0.5],
        [side * 0.55, 0.55, -0.45],
        [side * 0.3, 0.55, -0.2],
        [side * 0.16, 0.5, -0.08],
      ],
      0.032,
      alloy,
    );
    group.add(charge);
  }

  // Engine mounts + sensors ----------------------------------------------
  for (const side of [-1, 1]) {
    const mount = rounded(0.08, 0.1, 0.22, steel, 0.02);
    mount.position.set(side * 0.32, 0.18, 0.15);
    group.add(mount);

    const sensor = cylinder(0.022, 0.022, 0.05, brass, 10);
    sensor.position.set(side * 0.18, 0.61, 0.42);
    group.add(sensor);
  }

  const tmpPin = new THREE.Vector3();
  const tmpPiston = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const update = (t: number) => {
    const a = t * 3.4;
    crank.rotation.z = a;

    for (const rig of riders) {
      const angle = a + rig.phase;
      const travel = Math.cos(angle) * 0.055;
      rig.piston.position.y = rig.base + travel;

      tmpPin.set(Math.cos(angle) * 0.09, Math.sin(angle) * 0.09, rig.z);
      tmpPiston.set(0, rig.piston.position.y, rig.z);
      tmpDir.copy(tmpPiston).sub(tmpPin);
      const length = tmpDir.length();
      rig.rod.position.copy(tmpPin);
      rig.rod.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
      rig.rod.scale.y = length;
    }

    for (let i = 0; i < camshafts.length; i++) {
      camshafts[i].rotation.z = a * 0.5 + i * 0.7;
    }

    for (const valve of valves) {
      valve.mesh.position.y = 0.52 - Math.abs(Math.sin(a * 0.5 + valve.phase)) * 0.014;
    }

    for (const wheel of turboWheels) {
      wheel.rotation.x += 0.0;
      wheel.rotation.z = t * 22;
    }
  };

  return { group, update };
}

/* -------------------------------------------------------------------------- */
/* In-line four — DOHC, 16 valves                                             */
/* -------------------------------------------------------------------------- */

type I4Rig = {
  piston: THREE.Mesh;
  rod: THREE.Mesh;
  x: number;
  phase: number;
};

export function createInlineFour(): EngineAssembly {
  const group = new THREE.Group();
  const riders: I4Rig[] = [];
  const cams: THREE.Object3D[] = [];
  const valves: Array<{ mesh: THREE.Mesh; phase: number }> = [];
  const sprockets: THREE.Object3D[] = [];

  const spacing = 0.21;
  const xs = [-1.5, -0.5, 0.5, 1.5].map((n) => n * spacing);

  // Crankcase — open front so the crank is visible ------------------------
  const lowerCase = withEdges(rounded(0.98, 0.2, 0.46, dark, 0.04), 0.3);
  lowerCase.position.set(0, -0.06, 0);
  group.add(lowerCase);

  const sump = rounded(1.02, 0.09, 0.5, carbon, 0.03);
  sump.position.set(0, -0.2, 0);
  group.add(sump);

  const backWall = rounded(0.96, 0.3, 0.03, dark, 0.015);
  backWall.position.set(0, 0.08, -0.23);
  group.add(backWall);

  // Crankshaft along X ----------------------------------------------------
  const crank = new THREE.Group();
  const shaft = cylinder(0.05, 0.05, 1.02, alloy, 20);
  shaft.rotation.z = Math.PI / 2;
  crank.add(shaft);

  for (const x of xs) {
    const web = rounded(0.035, 0.19, 0.035, steel, 0.01);
    web.position.set(x, 0.0, 0);
    crank.add(web);
  }

  const clutch = cylinder(0.17, 0.17, 0.05, alloy, 30);
  clutch.rotation.z = Math.PI / 2;
  clutch.position.x = -0.55;
  crank.add(clutch);

  const clutchRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.008, 6, 36),
    acidSoft,
  );
  clutchRing.rotation.y = Math.PI / 2;
  clutchRing.position.x = -0.58;
  crank.add(clutchRing);
  group.add(crank);

  // Cylinders -------------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const x = xs[i];
    const phase = [0, Math.PI, Math.PI, 0][i];

    const linerMesh = cylinder(0.078, 0.078, 0.3, liner, 16);
    linerMesh.position.set(x, 0.19, 0);
    group.add(linerMesh);

    for (const y of [0.04, 0.34]) {
      const lip = ring(0.078, 0.006, liner);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(x, y, 0);
      group.add(lip);
    }

    const piston = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.068, 0.09, 18),
      steel,
    );
    piston.position.set(x, 0.17, 0);
    group.add(piston);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.012, 18),
      alloy,
    );
    crown.position.y = 0.05;
    piston.add(crown);

    const rod = cylinder(0.016, 0.021, 1, alloy, 10);
    rod.geometry.translate(0, 0.5, 0);
    group.add(rod);

    riders.push({ piston, rod, x, phase });

    // 16 valves total, four per cylinder.
    for (const dx of [-0.038, 0.038]) {
      for (const dz of [-0.036, 0.036]) {
        const valve = cylinder(0.01, 0.013, 0.13, steel, 8);
        valve.position.set(x + dx, 0.36, dz);
        group.add(valve);
        valves.push({ mesh: valve, phase });
      }
    }
  }

  // Head and cam cover ----------------------------------------------------
  const head = withEdges(rounded(1.0, 0.13, 0.44, alloy, 0.03), 0.25);
  head.position.set(0, 0.4, 0);
  group.add(head);

  const coverMesh = rounded(0.98, 0.1, 0.3, cover, 0.045);
  coverMesh.position.set(0, 0.5, 0);
  group.add(coverMesh);

  const coverStripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.78, 0.012, 0.04),
    acid,
  );
  coverStripe.position.set(0, 0.556, 0);
  group.add(coverStripe);

  // Two camshafts ---------------------------------------------------------
  for (const z of [-0.1, 0.1]) {
    const cam = new THREE.Group();
    const camShaft = cylinder(0.02, 0.02, 0.96, alloy, 12);
    camShaft.rotation.z = Math.PI / 2;
    cam.add(camShaft);

    for (const x of xs) {
      const lobe = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.045, 0.05),
        steel,
      );
      lobe.position.set(x, 0.025, 0);
      cam.add(lobe);
    }

    cam.position.set(0, 0.47, z);
    group.add(cam);
    cams.push(cam);
  }

  // Timing side — sprockets + chain ---------------------------------------
  for (const [y, z, radius] of [
    [-0.04, 0.0, 0.085],
    [0.47, -0.1, 0.06],
    [0.47, 0.1, 0.06],
  ] as const) {
    const sprocket = new THREE.Group();
    const disc = cylinder(radius, radius, 0.02, steel, 20);
    disc.rotation.z = Math.PI / 2;
    sprocket.add(disc);

    for (let i = 0; i < 10; i++) {
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.018, 0.018),
        alloy,
      );
      tooth.position.set(0, radius, 0);
      const holder = new THREE.Group();
      holder.rotation.x = (i / 10) * Math.PI * 2;
      holder.add(tooth);
      sprocket.add(holder);
    }

    sprocket.position.set(0.52, y, z);
    group.add(sprocket);
    sprockets.push(sprocket);
  }

  const chainMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b7278,
    metalness: 0.9,
    roughness: 0.4,
  });
  group.add(
    tube(
      [
        [0.52, -0.02, 0.025],
        [0.52, 0.2, 0.1],
        [0.52, 0.47, 0.13],
      ],
      0.012,
      chainMaterial,
    ),
  );
  group.add(
    tube(
      [
        [0.52, -0.02, -0.025],
        [0.52, 0.2, -0.1],
        [0.52, 0.47, -0.13],
      ],
      0.012,
      chainMaterial,
    ),
  );

  // Throttle bodies / velocity stacks -------------------------------------
  const plenum = withEdges(rounded(0.86, 0.1, 0.2, dark, 0.03), 0.3);
  plenum.position.set(0, 0.58, -0.13);
  group.add(plenum);

  for (const x of xs) {
    const stack = cylinder(0.042, 0.055, 0.08, alloy, 16);
    stack.position.set(x, 0.66, -0.13);
    group.add(stack);

    const trumpet = cylinder(0.058, 0.042, 0.03, steel, 16);
    trumpet.position.set(x, 0.71, -0.13);
    group.add(trumpet);

    const butterfly = cylinder(0.036, 0.036, 0.006, brass, 12);
    butterfly.position.set(x, 0.615, -0.13);
    group.add(butterfly);
  }

  // Exhaust headers -------------------------------------------------------
  for (let i = 0; i < 4; i++) {
    const x = xs[i];
    const header = tube(
      [
        [x, 0.38, 0.2],
        [x, 0.24, 0.3],
        [x * 0.9, 0.02, 0.34],
        [0.0, -0.16, 0.34],
      ],
      0.02,
      steel,
    );
    group.add(header);
  }

  const collector = cylinder(0.055, 0.065, 0.1, alloy, 16);
  collector.rotation.x = Math.PI / 2;
  collector.position.set(0, -0.16, 0.4);
  group.add(collector);

  const collectorGlow = ring(0.055, 0.008, hot);
  collectorGlow.rotation.x = Math.PI / 2;
  collectorGlow.position.set(0, -0.16, 0.45);
  group.add(collectorGlow);

  // Oil filter, sensors, mounts ------------------------------------------
  const filter = cylinder(0.055, 0.055, 0.09, acid, 16);
  filter.rotation.z = Math.PI / 2;
  filter.position.set(0.34, -0.17, 0.2);
  group.add(filter);

  const camSensor = cylinder(0.02, 0.02, 0.045, brass, 10);
  camSensor.position.set(-0.3, 0.5, 0.16);
  group.add(camSensor);

  for (const x of [-0.4, 0.4]) {
    const mount = rounded(0.05, 0.18, 0.18, steel, 0.012);
    mount.position.set(x, -0.12, -0.26);
    group.add(mount);
  }

  const tmpPin = new THREE.Vector3();
  const tmpPiston = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  const update = (t: number) => {
    const a = t * 4.1;
    crank.rotation.x = a;

    for (const rig of riders) {
      const angle = a + rig.phase;
      const travel = Math.cos(angle) * 0.06;
      rig.piston.position.y = 0.17 + travel;

      tmpPin.set(rig.x, Math.cos(angle) * 0.08, Math.sin(angle) * 0.08);
      tmpPiston.set(rig.x, rig.piston.position.y, 0);
      tmpDir.copy(tmpPiston).sub(tmpPin);
      const length = tmpDir.length();
      rig.rod.position.copy(tmpPin);
      rig.rod.quaternion.setFromUnitVectors(UP, tmpDir.normalize());
      rig.rod.scale.y = length;
    }

    for (let i = 0; i < cams.length; i++) {
      cams[i].rotation.x = a * 0.5 + (i === 0 ? 0 : Math.PI * 0.5);
    }

    for (const sprocket of sprockets) {
      sprocket.rotation.x = a * 0.5;
    }

    for (const valve of valves) {
      valve.mesh.position.y =
        0.36 - Math.abs(Math.sin(a * 0.5 + valve.phase)) * 0.012;
    }
  };

  return { group, update };
}
