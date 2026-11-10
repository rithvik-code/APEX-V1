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

// Angular body panel extruded from a side profile: [z (forward+), y].
function panel(
  profile: Array<[number, number]>,
  width: number,
  material: THREE.Material,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i][0], profile[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
    steps: 1,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return new THREE.Mesh(geo, material);
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
    metalness: 0.9,
    roughness: 0.26,
    envMapIntensity: 1.1,
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: 0x0a0c0d,
    metalness: 0.6,
    roughness: 0.52,
  });
  const mirror = new THREE.MeshStandardMaterial({
    color: 0xc7ced4,
    metalness: 1,
    roughness: 0.07,
    envMapIntensity: 1.7,
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
    side: THREE.DoubleSide,
  });

  // Wheels: turbine-blade rims, wide rear slick, acid containment rings -------
  function buildWheel(z: number, rear: boolean): THREE.Group {
    const wheel = new THREE.Group();
    wheel.position.set(0, 0.56, z);

    const tireR = rear ? 0.5 : 0.52;
    const tireTube = rear ? 0.105 : 0.075;
    const tireGeo = new THREE.TorusGeometry(tireR, tireTube, 14, 56);
    tireGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(tireGeo, rubber));

    const outerGeo = new THREE.TorusGeometry(tireR + tireTube + 0.004, 0.005, 4, 64);
    outerGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(outerGeo, acid));

    const rimGeo = new THREE.TorusGeometry(0.3, 0.016, 6, 44);
    rimGeo.rotateY(Math.PI / 2);
    wheel.add(new THREE.Mesh(rimGeo, acid));

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, rear ? 0.17 : 0.12, 16),
      metal,
    );
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);

    for (let i = 0; i < 6; i++) {
      const holder = new THREE.Group();
      holder.rotation.x = (i / 6) * Math.PI * 2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.52, 0.014), metal);
      blade.rotation.y = 0.42;
      holder.add(blade);
      wheel.add(holder);
    }

    const discSides = rear ? [-0.07] : [-0.06, 0.06];
    for (const x of discSides) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 32), metal);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = x;
      wheel.add(disc);
      const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.06), acid);
      caliper.position.set(x, 0.17, 0.08);
      wheel.add(caliper);
    }

    return wheel;
  }

  group.add(buildWheel(1.02, false));
  group.add(buildWheel(-0.98, true));

  // Front fender: carbon arc hugging the front slick -------------------------
  const fenderArc = 2.2;
  const fenderGeo = new THREE.TorusGeometry(0.64, 0.028, 8, 32, fenderArc);
  fenderGeo.rotateY(Math.PI / 2);
  const fender = new THREE.Mesh(fenderGeo, carbon);
  fender.rotation.x = Math.PI / 2 - fenderArc / 2;
  fender.position.set(0, 0.56, 1.02);
  fender.scale.set(2.6, 1, 1);
  group.add(fender);

  const fenderLineGeo = new THREE.TorusGeometry(0.665, 0.004, 4, 32, fenderArc);
  fenderLineGeo.rotateY(Math.PI / 2);
  const fenderLine = new THREE.Mesh(fenderLineGeo, acid);
  fenderLine.rotation.x = Math.PI / 2 - fenderArc / 2;
  fenderLine.position.set(0, 0.56, 1.02);
  fenderLine.scale.set(2.6, 1, 1);
  group.add(fenderLine);

  // Lime trellis frame --------------------------------------------------------
  const frame = new THREE.Group();
  const trellis: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (const side of [-1, 1]) {
    const x = side * 0.12;
    const head = new THREE.Vector3(x, 1.08, 0.68);
    const mid = new THREE.Vector3(x, 0.95, 0.25);
    const pivot = new THREE.Vector3(x, 0.62, -0.15);
    const sub = new THREE.Vector3(x * 0.7, 0.98, -0.55);
    trellis.push([head, mid], [mid, pivot], [head, pivot], [mid, sub], [pivot, sub]);
  }
  for (const [a, b] of trellis) {
    frame.add(strut(a, b, 0.02, acid));
  }

  // Inverted forks + clip-ons -------------------------------------------------
  for (const side of [-1, 1]) {
    const x = side * 0.11;
    frame.add(
      strut(new THREE.Vector3(x, 1.16, 0.7), new THREE.Vector3(x, 0.86, 0.86), 0.026, metal),
    );
    frame.add(
      strut(new THREE.Vector3(x, 0.86, 0.86), new THREE.Vector3(x, 0.56, 1.02), 0.018, metal),
    );
    frame.add(
      strut(new THREE.Vector3(side * 0.1, 1.12, 0.68), new THREE.Vector3(side * 0.3, 1.1, 0.6), 0.015, metal),
    );
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 10), carbon);
    grip.position.set(side * 0.32, 1.1, 0.59);
    grip.rotation.z = Math.PI / 2;
    frame.add(grip);
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.08), metal);
  crown.position.set(0, 1.15, 0.71);
  frame.add(crown);

  // Single-sided swingarm: rear wheel hangs exposed on the right --------------
  const swingarm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.92), carbon);
  swingarm.position.set(-0.18, 0.59, -0.55);
  swingarm.rotation.x = 0.05;
  frame.add(edgesOf(swingarm, wire, 30));
  frame.add(
    strut(new THREE.Vector3(-0.18, 0.62, -0.12), new THREE.Vector3(-0.18, 0.56, -0.98), 0.04, metal),
  );
  const axleNut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 6), acid);
  axleNut.rotation.z = Math.PI / 2;
  axleNut.position.set(-0.24, 0.56, -0.98);
  frame.add(axleNut);

  const rearShock = strut(
    new THREE.Vector3(0, 0.64, -0.28),
    new THREE.Vector3(0, 0.98, -0.52),
    0.032,
    acid,
  );
  frame.add(rearShock);
  group.add(frame);

  // Faceted stealth bodywork --------------------------------------------------
  const fairing = edgesOf(
    panel(
      [
        [1.3, 0.92],
        [1.28, 1.06],
        [1.05, 1.16],
        [0.72, 1.18],
        [0.45, 1.1],
        [0.38, 0.9],
        [0.5, 0.62],
        [0.72, 0.5],
        [1.05, 0.62],
        [1.22, 0.78],
      ],
      0.44,
      shell,
    ),
    wire,
    24,
  );
  group.add(fairing);

  const belly = edgesOf(
    panel(
      [
        [0.55, 0.5],
        [0.45, 0.38],
        [-0.15, 0.34],
        [-0.4, 0.45],
        [-0.35, 0.55],
        [0.2, 0.55],
      ],
      0.36,
      carbon,
    ),
    wire,
    26,
  );
  group.add(belly);

  // Mirrored fuel tank — the H2R signature finish -----------------------------
  const tank = edgesOf(
    panel(
      [
        [0.42, 1.02],
        [0.3, 1.14],
        [-0.05, 1.16],
        [-0.28, 1.08],
        [-0.3, 0.98],
        [0.1, 0.94],
      ],
      0.36,
      mirror,
    ),
    wire,
    24,
  );
  group.add(tank);

  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.06, 0.5, 2, 0.02), carbon);
  seat.position.set(0, 1.0, -0.5);
  group.add(seat);

  const tail = edgesOf(
    panel(
      [
        [-0.35, 1.02],
        [-0.6, 1.06],
        [-1.05, 1.12],
        [-1.28, 1.06],
        [-1.26, 0.98],
        [-0.9, 0.94],
        [-0.55, 0.92],
        [-0.35, 0.96],
      ],
      0.22,
      shell,
    ),
    wire,
    24,
  );
  group.add(tail);

  const tailLed = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.012), acid);
  tailLed.position.set(0, 1.05, -1.29);
  group.add(tailLed);

  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), glass);
  screen.position.set(0, 1.24, 0.78);
  screen.rotation.x = -0.55;
  group.add(screen);

  // Ram-air nose intake + angular LED eyes ------------------------------------
  const intake = edgesOf(
    new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.12), carbon),
    wire,
    20,
  );
  intake.position.set(0, 1.0, 1.26);
  group.add(intake);
  const intakeGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09), acid);
  intakeGlow.position.set(0, 1.0, 1.325);
  group.add(intakeGlow);

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.02), acid);
    eye.position.set(side * 0.16, 0.9, 1.22);
    eye.rotation.y = -side * 0.35;
    eye.rotation.z = side * 0.12;
    group.add(eye);
  }

  // Carbon winglets with acid endplates ---------------------------------------
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.14), carbon);
    wing.position.set(side * 0.32, 0.98, 0.85);
    wing.rotation.z = -side * 0.12;
    wing.rotation.y = side * 0.1;
    group.add(wing);

    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.09, 0.14), carbon);
    endplate.position.set(side * 0.49, 1.0, 0.85);
    group.add(endplate);
    const tipLine = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.006, 0.14), acid);
    tipLine.position.set(side * 0.49, 1.048, 0.85);
    group.add(tipLine);

    // Mirror-delete camera pods on stalks.
    group.add(
      strut(
        new THREE.Vector3(side * 0.22, 1.05, 0.8),
        new THREE.Vector3(side * 0.32, 1.14, 0.75),
        0.008,
        metal,
      ),
    );
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 10), carbon);
    pod.position.set(side * 0.33, 1.15, 0.75);
    group.add(pod);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.01, 12), acid);
    lens.position.set(side * 0.33, 1.15, 0.773);
    group.add(lens);
  }

  // Energy lines tracing the bodywork -----------------------------------------
  for (const side of [-1, 1]) {
    const fairingLine = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.5), acid);
    fairingLine.position.set(side * 0.24, 0.88, 0.75);
    group.add(fairingLine);
    const tailLine = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.008, 0.6), acid);
    tailLine.position.set(side * 0.125, 1.02, -0.8);
    group.add(tailLine);
  }
  const spineLine = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, 0.5), acid);
  spineLine.position.set(0, 1.175, 0.05);
  group.add(spineLine);

  // Supercharged inline-four ---------------------------------------------------
  const engineAssembly = createInlineFour();
  engineAssembly.group.scale.setScalar(0.5);
  engineAssembly.group.position.set(0, 0.55, 0.08);
  group.add(engineAssembly.group);

  // Supercharger housing + intake plumbing behind the block.
  const supercharger = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.16, 0.18, 2, 0.03), metal);
  supercharger.position.set(0, 0.5, -0.28);
  group.add(edgesOf(supercharger, wire, 30));
  const scRing = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 28), acid);
  scRing.rotation.y = Math.PI / 2;
  scRing.position.set(-0.11, 0.5, -0.28);
  group.add(scRing);
  for (const side of [-1, 1]) {
    group.add(
      strut(
        new THREE.Vector3(side * 0.06, 0.58, -0.28),
        new THREE.Vector3(side * 0.07, 0.8, -0.1),
        0.028,
        metal,
      ),
    );
    group.add(
      strut(
        new THREE.Vector3(side * 0.07, 0.8, -0.1),
        new THREE.Vector3(side * 0.08, 0.95, 0.15),
        0.028,
        metal,
      ),
    );
  }

  // Exhaust: four headers into a short right-side canister ---------------------
  for (let i = 0; i < 4; i++) {
    const x = -0.12 + i * 0.08;
    group.add(
      strut(new THREE.Vector3(x, 0.5, 0.32), new THREE.Vector3(x, 0.32, 0.15), 0.016, metal),
    );
  }
  group.add(strut(new THREE.Vector3(0, 0.32, 0.1), new THREE.Vector3(0.2, 0.34, -0.3), 0.028, metal));
  group.add(strut(new THREE.Vector3(0.2, 0.34, -0.3), new THREE.Vector3(0.3, 0.5, -0.5), 0.028, metal));
  const muffler = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.42, 18), metal);
  muffler.rotation.x = Math.PI / 2;
  muffler.position.set(0.31, 0.52, -0.62);
  group.add(muffler);
  const exhaustTip = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 28), acid);
  exhaustTip.position.set(0.31, 0.52, -0.84);
  group.add(exhaustTip);

  // Floating detail ring --------------------------------------------------------
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

  // Scanning beam ---------------------------------------------------------------
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
      value: "310 HP / 32K CTX",
      position: new THREE.Vector3(0.24, 1.1, 0.3),
    },
    {
      id: "bike-mass",
      index: "B-02",
      label: "DRY MASS",
      value: "216 KG",
      position: new THREE.Vector3(0.26, 0.6, -0.15),
    },
    {
      id: "bike-aero",
      index: "B-03",
      label: "AERO WINGLETS",
      value: "0.24 CD",
      position: new THREE.Vector3(0.45, 1.05, 0.85),
    },
    {
      id: "bike-dohc",
      index: "B-04",
      label: "SC / DOHC 16V",
      value: "SUPERCHARGED I4",
      position: new THREE.Vector3(0, 0.82, 0.05),
    },
  );

  return { group, scan, anchors, engine: engineAssembly, accent: wire };
}