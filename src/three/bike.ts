import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { VehicleAnchor } from "./car";
import { createInlineFour, type EngineAssembly } from "./engines";

const ACID = 0xc8ff16;

function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
): THREE.Mesh {
  const length = a.distanceTo(b);
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8);
  geo.translate(0, length / 2, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  return mesh;
}

function edgesOf(
  mesh: THREE.Mesh,
  material: THREE.LineBasicMaterial,
  threshold = 28,
): THREE.Mesh {
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, threshold),
    material,
  );
  mesh.add(edges);
  return mesh;
}

function radialTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(200,255,22,0.9)");
  gradient.addColorStop(0.45, "rgba(200,255,22,0.25)");
  gradient.addColorStop(1, "rgba(200,255,22,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSuperbike(): {
  group: THREE.Group;
  scan: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  anchors: VehicleAnchor[];
  engine: EngineAssembly;
  accent: THREE.LineBasicMaterial;
} {
  const group = new THREE.Group();
  const anchors: VehicleAnchor[] = [];

  const shell = new THREE.MeshStandardMaterial({
    color: 0x121518,
    metalness: 0.82,
    roughness: 0.3,
    envMapIntensity: 0.9,
  });
  const wire = new THREE.LineBasicMaterial({
    color: ACID,
    transparent: true,
    opacity: 0.85,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: 0xa7b0b8,
    metalness: 1,
    roughness: 0.22,
  });
  const acid = new THREE.MeshBasicMaterial({ color: ACID });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x080909,
    metalness: 0.15,
    roughness: 0.9,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x05090b,
    metalness: 0.85,
    roughness: 0.04,
    clearcoat: 1,
    envMapIntensity: 2,
  });

  // Wheels ------------------------------------------------------------------
  for (const z of [1.02, -0.98]) {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.56, z);

    const tireGeo = new THREE.TorusGeometry(0.54, 0.075, 12, 52);
    tireGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(tireGeo, rubber));

    const outerGeo = new THREE.TorusGeometry(0.615, 0.006, 4, 64);
    outerGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(outerGeo, acid));

    const rimGeo = new THREE.TorusGeometry(0.3, 0.014, 6, 44);
    rimGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(rimGeo, acid));

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.13, 16), metal);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.56, 0.012), metal);
      spoke.rotation.x = angle;
      wheel.add(spoke);
    }

    group.add(wheel);
  }

  // Frame -------------------------------------------------------------------
  const frame = new THREE.Group();
  const framePoints: Array<[THREE.Vector3, THREE.Vector3, number]> = [
    [new THREE.Vector3(0.13, 1.12, 0.72), new THREE.Vector3(0.13, 0.56, 1.03), 0.026],
    [new THREE.Vector3(-0.13, 1.12, 0.72), new THREE.Vector3(-0.13, 0.56, 1.03), 0.026],
    [new THREE.Vector3(0.14, 0.58, -0.98), new THREE.Vector3(0.14, 0.68, -0.08), 0.03],
    [new THREE.Vector3(-0.14, 0.58, -0.98), new THREE.Vector3(-0.14, 0.68, -0.08), 0.03],
    [new THREE.Vector3(0.14, 0.62, -0.1), new THREE.Vector3(0.14, 1.02, -0.64), 0.022],
    [new THREE.Vector3(-0.14, 0.62, -0.1), new THREE.Vector3(-0.14, 1.02, -0.64), 0.022],
    [new THREE.Vector3(0.12, 0.7, 0.1), new THREE.Vector3(0.12, 0.85, 0.92), 0.02],
    [new THREE.Vector3(-0.12, 0.7, 0.1), new THREE.Vector3(-0.12, 0.85, 0.92), 0.02],
  ];
  for (const [a, b, radius] of framePoints) {
    frame.add(strut(a, b, radius, metal));
  }

  const handlebar = strut(
    new THREE.Vector3(-0.34, 1.19, 0.62),
    new THREE.Vector3(0.34, 1.19, 0.62),
    0.018,
    metal,
  );
  frame.add(handlebar);

  const rearShock = strut(
    new THREE.Vector3(0, 0.62, -0.28),
    new THREE.Vector3(0, 1.0, -0.56),
    0.035,
    acid,
  );
  frame.add(rearShock);

  const exhaust = strut(
    new THREE.Vector3(0.24, 0.62, -0.2),
    new THREE.Vector3(0.33, 0.78, -1.02),
    0.055,
    metal,
  );
  frame.add(exhaust);

  const exhaustTip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.16, 18), acid);
  exhaustTip.position.set(0.33, 0.79, -1.06);
  exhaustTip.rotation.x = Math.PI / 2;
  frame.add(exhaustTip);

  group.add(frame);

  // Bodywork ----------------------------------------------------------------
  const tank = edgesOf(
    new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), shell),
    wire,
    32,
  );
  tank.scale.set(0.34, 0.27, 0.56);
  tank.position.set(0, 1.0, 0.32);
  group.add(tank);

  const fairing = edgesOf(
    new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), shell),
    wire,
    26,
  );
  fairing.scale.set(0.32, 0.34, 0.46);
  fairing.position.set(0, 1.0, 0.8);
  fairing.rotation.x = 0.16;
  group.add(fairing);

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.28), glass);
  screen.position.set(0, 1.28, 0.86);
  screen.rotation.x = -0.66;
  group.add(screen);

  const seat = edgesOf(
    new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.09, 0.62, 3, 0.025), shell),
    wire,
    32,
  );
  seat.position.set(0, 1.055, -0.48);
  group.add(seat);

  const tail = edgesOf(
    new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 4), shell),
    wire,
    24,
  );
  tail.rotation.x = Math.PI / 2;
  tail.rotation.z = Math.PI / 4;
  tail.position.set(0, 1.06, -1.05);
  group.add(tail);

  // In-line four: DOHC, 16 valves, exposed in the frame.
  const engineAssembly = createInlineFour();
  engineAssembly.group.scale.setScalar(0.5);
  engineAssembly.group.position.set(0, 0.55, 0.08);
  group.add(engineAssembly.group);

  // Engine cradle tubes.
  for (const side of [-1, 1]) {
    group.add(
      strut(
        new THREE.Vector3(side * 0.24, 0.84, 0.38),
        new THREE.Vector3(side * 0.24, 0.44, 0.38),
        0.013,
        metal,
      ),
    );
    group.add(
      strut(
        new THREE.Vector3(side * 0.24, 0.44, 0.38),
        new THREE.Vector3(side * 0.24, 0.44, -0.2),
        0.013,
        metal,
      ),
    );
  }

  const headlight = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), acid);
  headlight.position.set(0, 1.04, 1.16);
  headlight.rotation.x = -0.2;
  group.add(headlight);

  // Swinging detail ring + floating bolts
  const detailRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.82, 0.004, 3, 72),
    new THREE.MeshBasicMaterial({
      color: 0xe6ffd0,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  detailRing.rotation.y = Math.PI / 2;
  detailRing.position.set(0, 0.95, 0);
  group.add(detailRing);

  // Scanning beam -----------------------------------------------------------
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.4),
    new THREE.MeshBasicMaterial({
      map: radialTexture(),
      color: ACID,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  scan.rotation.x = -Math.PI / 2;
  scan.position.y = 0.02;
  group.add(scan);

  anchors.push(
    {
      id: "bike-power",
      index: "B-01",
      label: "OUTPUT",
      value: "210 HP / 32K CTX",
      position: new THREE.Vector3(0.2, 1.15, 0.32),
    },
    {
      id: "bike-mass",
      index: "B-02",
      label: "DRY MASS",
      value: "186 KG",
      position: new THREE.Vector3(0.22, 0.7, 0.12),
    },
    {
      id: "bike-aero",
      index: "B-03",
      label: "AERO SHELL",
      value: "0.21 CD",
      position: new THREE.Vector3(0.18, 1.14, 0.86),
    },
    {
      id: "bike-dohc",
      index: "B-04",
      label: "DOHC / 16V",
      value: "IN-LINE FOUR",
      position: new THREE.Vector3(0, 0.92, 0.08),
    },
  );

  return { group, scan, anchors, engine: engineAssembly, accent: wire };
}
