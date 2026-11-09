import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createV12, type EngineAssembly } from "./engines";

export type VehicleAnchor = {
  id: string;
  index: string;
  label: string;
  value: string;
  position: THREE.Vector3;
};

const ACID = 0xc8ff16;

export function createSupercar(): {
  group: THREE.Group;
  wheels: THREE.Group[];
  anchors: VehicleAnchor[];
  engine: EngineAssembly;
  paint: THREE.MeshPhysicalMaterial;
} {
  const group = new THREE.Group();
  const wheels: THREE.Group[] = [];
  const anchors: VehicleAnchor[] = [];

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xaab2ba,
    metalness: 0.96,
    roughness: 0.17,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 1.6,
  });

  const carbon = new THREE.MeshStandardMaterial({
    color: 0x0b0d0f,
    metalness: 0.7,
    roughness: 0.42,
    envMapIntensity: 0.8,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x04070a,
    metalness: 0.9,
    roughness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.2,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });

  const acid = new THREE.MeshBasicMaterial({ color: ACID });
  const acidSoft = new THREE.MeshBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const headlight = new THREE.MeshBasicMaterial({ color: 0xf2ffe0 });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x9aa1a8,
    metalness: 1,
    roughness: 0.25,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x070808,
    metalness: 0.1,
    roughness: 0.92,
  });

  // ---------------------------------------------------------------------------
  // Body — extruded side profile, width on X, length on Z, nose facing +Z.
  // ---------------------------------------------------------------------------
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-2.34, 0.2);
  bodyShape.lineTo(2.08, 0.2);
  bodyShape.quadraticCurveTo(2.38, 0.21, 2.36, 0.38);
  bodyShape.quadraticCurveTo(2.16, 0.58, 1.68, 0.63);
  bodyShape.quadraticCurveTo(1.12, 0.69, 0.82, 0.73);
  bodyShape.lineTo(-1.32, 0.76);
  bodyShape.quadraticCurveTo(-1.98, 0.8, -2.3, 0.73);
  bodyShape.lineTo(-2.38, 0.44);
  bodyShape.quadraticCurveTo(-2.38, 0.2, -2.08, 0.2);

  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: 1.62,
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: 0.1,
    bevelThickness: 0.12,
    curveSegments: 22,
  });
  bodyGeo.translate(0, 0, -0.81);
  bodyGeo.rotateY(-Math.PI / 2);
  const body = new THREE.Mesh(bodyGeo, paint);
  group.add(body);

  // Canopy
  const canopyShape = new THREE.Shape();
  canopyShape.moveTo(-1.34, 0.72);
  canopyShape.quadraticCurveTo(-1.08, 1.04, -0.62, 1.16);
  canopyShape.quadraticCurveTo(0.28, 1.2, 1.06, 0.78);
  canopyShape.lineTo(1.17, 0.7);
  canopyShape.lineTo(-1.34, 0.72);
  const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
    depth: 1.2,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.055,
    bevelThickness: 0.055,
    curveSegments: 20,
  });
  canopyGeo.translate(0, 0, -0.6);
  canopyGeo.rotateY(-Math.PI / 2);
  const canopy = new THREE.Mesh(canopyGeo, glass);
  group.add(canopy);

  // Spine and canopy trim
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.012, 1.2),
    acidSoft,
  );
  spine.position.set(0, 1.185, -0.38);
  group.add(spine);

  // Front splitter + canards
  const splitter = new THREE.Mesh(
    new RoundedBoxGeometry(1.92, 0.055, 0.5, 3, 0.02),
    carbon,
  );
  splitter.position.set(0, 0.155, 2.16);
  group.add(splitter);

  for (const side of [-1, 1]) {
    const canard = new THREE.Mesh(
      new RoundedBoxGeometry(0.34, 0.025, 0.16, 2, 0.01),
      carbon,
    );
    canard.position.set(side * 0.76, 0.34, 1.94);
    canard.rotation.z = side * 0.12;
    group.add(canard);
  }

  // Side skirts with the single acid accent line
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(
      new RoundedBoxGeometry(0.09, 0.06, 2.5, 3, 0.02),
      carbon,
    );
    skirt.position.set(side * 0.9, 0.18, 0);
    group.add(skirt);

    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.022, 2.2), acid);
    glow.position.set(side * 0.952, 0.205, 0);
    group.add(glow);
  }

  // Rear wing
  const wing = new THREE.Mesh(
    new RoundedBoxGeometry(1.54, 0.06, 0.42, 3, 0.025),
    carbon,
  );
  wing.position.set(0, 1.08, -2.04);
  wing.rotation.x = -0.08;
  group.add(wing);

  for (const side of [-1, 1]) {
    const upright = new THREE.Mesh(
      new RoundedBoxGeometry(0.055, 0.34, 0.15, 3, 0.02),
      carbon,
    );
    upright.position.set(side * 0.56, 0.9, -2.02);
    group.add(upright);

    const plate = new THREE.Mesh(
      new RoundedBoxGeometry(0.02, 0.2, 0.5, 2, 0.01),
      carbon,
    );
    plate.position.set(side * 0.79, 1.06, -2.04);
    group.add(plate);
  }

  const wingGlow = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.008, 0.02), acidSoft);
  wingGlow.position.set(0, 1.04, -2.24);
  group.add(wingGlow);

  // Rear light bar and exhaust
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.02), acid);
  tail.position.set(0, 0.68, -2.38);
  group.add(tail);

  const tailGlow = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.14, 0.02),
    new THREE.MeshBasicMaterial({
      color: ACID,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  tailGlow.position.set(0, 0.68, -2.39);
  group.add(tailGlow);

  for (const side of [-1, 1]) {
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.18, 20), metal);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(side * 0.4, 0.33, -2.3);
    group.add(exhaust);

    const exhaustInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 0.19, 20),
      new THREE.MeshBasicMaterial({ color: 0x020202 }),
    );
    exhaustInner.rotation.x = Math.PI / 2;
    exhaustInner.position.set(side * 0.4, 0.33, -2.31);
    group.add(exhaustInner);
  }

  // Rear diffuser fins
  for (let i = 0; i < 7; i++) {
    const fin = new THREE.Mesh(
      new RoundedBoxGeometry(0.015, 0.13, 0.32, 2, 0.005),
      carbon,
    );
    fin.position.set(-0.6 + i * 0.2, 0.17, -2.22);
    group.add(fin);
  }

  // Headlights
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.055, 0.035, 3, 0.015), headlight);
    lamp.position.set(side * 0.52, 0.47, 2.3);
    lamp.rotation.x = -0.22;
    group.add(lamp);

    const lampGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.16, 0.02),
      new THREE.MeshBasicMaterial({
        color: 0xeaffc0,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    lampGlow.position.set(side * 0.52, 0.47, 2.32);
    group.add(lampGlow);
  }

  // Hood vents
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.015, 0.42, 2, 0.01), carbon);
    vent.position.set(side * 0.44, 0.685, 1.36);
    vent.rotation.x = -0.06;
    group.add(vent);
  }

  // ---------------------------------------------------------------------------
  // Cockpit — seats, dash, wheel and a rear cage, visible through the glass.
  // ---------------------------------------------------------------------------
  const cabin = new THREE.Group();
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(
      new RoundedBoxGeometry(0.4, 0.09, 0.46, 3, 0.04),
      carbon,
    );
    seat.position.set(side * 0.34, 0.6, 0.08);
    cabin.add(seat);

    const back = new THREE.Mesh(
      new RoundedBoxGeometry(0.4, 0.5, 0.1, 3, 0.04),
      carbon,
    );
    back.position.set(side * 0.34, 0.82, -0.16);
    back.rotation.x = -0.22;
    cabin.add(back);

    const bolster = new THREE.Mesh(
      new RoundedBoxGeometry(0.03, 0.32, 0.34, 2, 0.012),
      acidSoft,
    );
    bolster.position.set(side * 0.15, 0.66, 0.02);
    cabin.add(bolster);

    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.5, 0.01),
      acidSoft,
    );
    belt.position.set(side * 0.4, 0.81, 0.04);
    belt.rotation.z = side * 0.28;
    belt.rotation.x = -0.2;
    cabin.add(belt);
  }

  const dash = new THREE.Mesh(
    new RoundedBoxGeometry(1.16, 0.1, 0.18, 3, 0.03),
    carbon,
  );
  dash.position.set(0, 0.74, 0.5);
  dash.rotation.x = 0.18;
  cabin.add(dash);

  const cluster = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.08), acidSoft);
  cluster.position.set(-0.34, 0.79, 0.43);
  cluster.rotation.x = -0.6;
  cabin.add(cluster);

  const wheelRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.016, 8, 28),
    carbon,
  );
  wheelRim.position.set(-0.34, 0.76, 0.34);
  wheelRim.rotation.x = -0.42;
  cabin.add(wheelRim);

  const wheelSpoke = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.02, 0.02),
    metal,
  );
  wheelSpoke.position.copy(wheelRim.position);
  wheelSpoke.rotation.copy(wheelRim.rotation);
  cabin.add(wheelSpoke);

  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.025, 8, 24, Math.PI),
    metal,
  );
  hoop.position.set(0, 0.72, -0.42);
  hoop.rotation.z = Math.PI;
  hoop.rotation.x = -0.1;
  cabin.add(hoop);
  group.add(cabin);

  // ---------------------------------------------------------------------------
  // V12 twin-turbo, mounted behind the cabin under a glass power dome.
  // ---------------------------------------------------------------------------
  const engine = createV12();
  engine.group.scale.setScalar(0.46);
  engine.group.position.set(0, 0.78, -1.52);
  group.add(engine.group);

  const engineBase = new THREE.Mesh(
    new RoundedBoxGeometry(0.94, 0.06, 1.02, 3, 0.03),
    carbon,
  );
  engineBase.position.set(0, 0.87, -1.5);
  group.add(engineBase);

  const engineGlass = new THREE.Mesh(
    new RoundedBoxGeometry(0.86, 0.26, 0.92, 3, 0.06),
    glass,
  );
  engineGlass.position.set(0, 1.02, -1.5);
  group.add(engineGlass);

  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.02, 0.94),
      acid,
    );
    rail.position.set(side * 0.42, 1.15, -1.5);
    group.add(rail);
  }

  const engineVent = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.012, 0.03),
    carbon,
  );
  engineVent.position.set(0, 1.16, -1.92);
  group.add(engineVent);

  // Mirrors
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.02), carbon);
    stalk.position.set(side * 0.98, 0.84, 0.66);
    group.add(stalk);
    const mirror = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.065, 0.16, 2, 0.015), paint);
    mirror.position.set(side * 1.08, 0.86, 0.66);
    group.add(mirror);
  }

  // Underbody glow
  const glowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 5.6),
    new THREE.MeshBasicMaterial({
      color: ACID,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glowPlane.rotation.x = -Math.PI / 2;
  glowPlane.position.y = 0.025;
  group.add(glowPlane);

  // ---------------------------------------------------------------------------
  // Wheels
  // ---------------------------------------------------------------------------
  const wheelPositions: Array<[number, number]> = [
    [-1, 1.36],
    [1, 1.36],
    [-1, -1.42],
    [1, -1.42],
  ];

  for (const [side, z] of wheelPositions) {
    const wheel = new THREE.Group();
    wheel.position.set(side * 0.93, 0.46, z);

    const tireGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.33, 44, 1);
    tireGeo.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(tireGeo, rubber));

    const rimGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.35, 36);
    rimGeo.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, carbon);
    wheel.add(rim);

    const lipGeo = new THREE.TorusGeometry(0.3, 0.018, 8, 40);
    lipGeo.rotateY(Math.PI / 2);
    const lip = new THREE.Mesh(lipGeo, metal);
    lip.position.x = side * 0.17;
    wheel.add(lip);

    const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.018, 30);
    discGeo.rotateZ(Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, metal);
    disc.position.x = side * 0.02;
    wheel.add(disc);

    const caliper = new THREE.Mesh(
      new RoundedBoxGeometry(0.055, 0.16, 0.1, 2, 0.015),
      acid,
    );
    caliper.position.set(side * 0.06, 0.17, 0.08);
    wheel.add(caliper);

    for (let i = 0; i < 7; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.5, 0.055),
        metal,
      );
      spoke.rotation.x = (i / 7) * Math.PI * 2;
      spoke.position.x = side * 0.15;
      wheel.add(spoke);
    }

    group.add(wheel);
    wheels.push(wheel);
  }

  // Fender arches
  for (const [side, z] of wheelPositions) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(0.53, 0.055, 8, 34, Math.PI * 0.94),
      paint,
    );
    arch.rotation.y = Math.PI / 2;
    arch.position.set(side * 0.9, 0.47, z);
    group.add(arch);
  }

  anchors.push(
    {
      id: "car-aero",
      index: "A-01",
      label: "ACTIVE AERO",
      value: "1,240 KG DOWNFORCE",
      position: new THREE.Vector3(0.7, 1.16, -2.0),
    },
    {
      id: "car-sprint",
      index: "A-02",
      label: "0–100 TOKENS",
      value: "0.14 SEC",
      position: new THREE.Vector3(-0.87, 0.52, 1.32),
    },
    {
      id: "car-core",
      index: "A-03",
      label: "INFERENCE CORE",
      value: "LOCAL / 32K",
      position: new THREE.Vector3(0.6, 0.82, 0.1),
    },
    {
      id: "car-v12",
      index: "A-04",
      label: "V12 BITURBO",
      value: "6.5L / 48 VALVES",
      position: new THREE.Vector3(0, 1.14, -1.5),
    },
  );

  return { group, wheels, anchors, engine, paint };
}
