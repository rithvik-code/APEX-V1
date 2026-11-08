import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createInlineFour, createV12 } from "../three/engines";

export type CoreVariant = "v12" | "i4";

type Props = {
  variant: CoreVariant;
  onClose: () => void;
  onChange: (variant: CoreVariant) => void;
};

const SPECS: Record<
  CoreVariant,
  { title: string; subtitle: string; rows: Array<[string, string]> }
> = {
  v12: {
    title: "V12 BITURBO",
    subtitle: "6.5 L · 60° V · TWIN TURBO · 48 VALVES",
    rows: [
      ["DISPLACEMENT", "6,498 CC"],
      ["BANKS", "60° V / 12"],
      ["VALVETRAIN", "DOHC / 48V"],
      ["INDUCTION", "TWIN TURBO"],
      ["FIRING ORDER", "1-12-5-8-3-10…"],
      ["REDLINE", "9,500 RPM"],
    ],
  },
  i4: {
    title: "IN-LINE FOUR",
    subtitle: "998 CC · DOHC · 16 VALVES · NATURALLY ASPIRATED",
    rows: [
      ["DISPLACEMENT", "998 CC"],
      ["LAYOUT", "IN-LINE FOUR"],
      ["VALVETRAIN", "DOHC / 16V"],
      ["BORE × STROKE", "79 × 50.9 MM"],
      ["THROTTLE", "4 × 52 MM"],
      ["REDLINE", "14,500 RPM"],
    ],
  },
};

// Closed camera routes. Each lap is a hero orbit that skims the outside of the
// block — down the header side, up over the cam cover, around the intake — so
// the camera weaves through the engine bay without ever sitting inside metal.
const PATHS: Record<CoreVariant, Array<[number, number, number]>> = {
  v12: [
    [2.45, 1.7, 2.65],
    [1.78, 1.25, 1.9],
    [1.55, 0.85, 1.32],
    [1.72, 0.95, 0.63],
    [1.03, 1.5, 0.4],
    [0.0, 1.8, 0.0],
    [-1.03, 1.5, 0.4],
    [-1.72, 0.95, 0.63],
    [-1.78, 1.25, 1.9],
    [-2.45, 1.7, 2.65],
  ],
  i4: [
    [2.18, 1.6, 2.42],
    [1.55, 1.15, 1.72],
    [1.38, 0.7, 1.15],
    [1.5, 0.8, 0.46],
    [0.92, 1.3, 0.23],
    [0.0, 1.55, 0.0],
    [-0.92, 1.3, 0.23],
    [-1.5, 0.8, 0.46],
    [-1.55, 1.15, 1.72],
    [-2.18, 1.6, 2.42],
  ],
};

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

type CameraApi = {
  zoom: (factor: number) => void;
  reset: () => void;
};

export function CoreLab({ variant, onClose, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rpmRef = useRef<HTMLSpanElement>(null);
  const routeRef = useRef<HTMLSpanElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pausedRef = useRef(false);
  const camApi = useRef<CameraApi | null>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("core-open");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("core-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050607);
    scene.fog = new THREE.FogExp2(0x050607, 0.035);

    const camera = new THREE.PerspectiveCamera(54, width / height, 0.015, 60);
    camera.position.set(...PATHS[variant][0]);
    const headlight = new THREE.PointLight(0xa8d8ff, 0.85, 2.6, 2);
    headlight.position.set(0, 0.06, 0.04);
    camera.add(headlight);
    scene.add(camera);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0x9fb4bd, 0x050607, 1.15));
    scene.add(new THREE.AmbientLight(0x6d7f8c, 0.35));

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 4.5, 3.5);
    scene.add(key);

    const rim = new THREE.PointLight(0xc8ff16, 3.2, 5, 2);
    rim.position.set(-1.6, 0.9, 1.4);
    scene.add(rim);

    const cool = new THREE.PointLight(0x7fb6e6, 6, 6, 2);
    cool.position.set(1.8, 0.6, -1.4);
    scene.add(cool);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(5, 64),
      new THREE.MeshStandardMaterial({
        color: 0x070908,
        metalness: 0.9,
        roughness: 0.32,
        envMapIntensity: 0.45,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.45;
    scene.add(floor);

    const grid = new THREE.GridHelper(9, 44, 0xc8ff16, 0x1b241d);
    grid.position.y = -0.44;
    const gridMaterial = grid.material as THREE.Material & { opacity: number };
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.18;
    scene.add(grid);

    const assembly = variant === "v12" ? createV12() : createInlineFour();
    assembly.group.position.y = 0.04;
    // The route passes through solid geometry. Clone the shared materials so
    // this scene can render a DoubleSide X-ray pass without touching the hero
    // vehicles, then fade the shells while the camera is inside the block.
    const xray: Array<{
      material: THREE.Material & { opacity: number };
      opacity: number;
      depthWrite: boolean;
    }> = [];
    assembly.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const clone = (material: THREE.Material) => {
        const copy = material.clone();
        copy.side = THREE.DoubleSide;
        copy.transparent = true;
        xray.push({ material: copy, opacity: copy.opacity, depthWrite: copy.depthWrite });
        return copy;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(clone)
        : clone(object.material);
    });
    scene.add(assembly.group);

    // Sweeping diagnostic scan line.
    const sweep = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.012),
      new THREE.MeshBasicMaterial({
        color: 0xc8ff16,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    sweep.rotation.x = -Math.PI / 2;
    sweep.position.y = 0.2;
    sweep.renderOrder = 3;
    assembly.group.add(sweep);

    const stageRing = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.53, 128),
      new THREE.MeshBasicMaterial({
        color: 0xc8ff16,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    stageRing.rotation.x = -Math.PI / 2;
    stageRing.position.y = -0.435;
    scene.add(stageRing);

    const curve = new THREE.CatmullRomCurve3(
      PATHS[variant].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      true,
      "catmullrom",
      0.35,
    );

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let elapsed = 0;
    let raf = 0;
    let disposed = false;
    let shownRpm = 3200;
    let u = 0.02;

    // Embers drifting up through the cutaway.
    const emberCount = reduced ? 70 : 260;
    const emberPositions = new Float32Array(emberCount * 3);
    const emberSeeds = new Float32Array(emberCount);
    for (let i = 0; i < emberCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.4 + Math.random() * 1.9;
      emberPositions[i * 3] = Math.cos(angle) * radius;
      emberPositions[i * 3 + 1] = -0.4 + Math.random() * 2.1;
      emberPositions[i * 3 + 2] = Math.sin(angle) * radius;
      emberSeeds[i] = Math.random();
    }
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(emberPositions, 3),
    );
    const embers = new THREE.Points(
      emberGeometry,
      new THREE.PointsMaterial({
        color: 0xc8ff16,
        size: 0.014,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    scene.add(embers);

    // Camera rig: the route flies itself; the user can orbit it at any time.
    const rig = {
      yaw: 0,
      pitch: 0,
      zoom: 1,
      yawT: 0,
      pitchT: 0,
      zoomT: 1,
      velYaw: 0,
      velPitch: 0,
      dragging: false,
      lastX: 0,
      lastY: 0,
      lastInput: performance.now(),
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    const clampZoom = (value: number) =>
      THREE.MathUtils.clamp(value, 0.5, 2.3);
    const isControl = (target: EventTarget | null) =>
      Boolean((target as HTMLElement | null)?.closest?.("button, a, input, label"));

    const touch = (): void => {
      rig.lastInput = performance.now();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (isControl(event.target)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may already be released.
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
      rig.dragging = pointers.size === 1;
      rig.lastX = event.clientX;
      rig.lastY = event.clientY;
      stage.classList.add("is-grabbing");
      touch();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const point = pointers.get(event.pointerId);
      if (!point) return;
      point.x = event.clientX;
      point.y = event.clientY;
      touch();

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0 && distance > 0) {
          rig.zoomT = clampZoom(rig.zoomT * (pinchDistance / distance));
        }
        pinchDistance = distance;
        return;
      }

      const dx = event.clientX - rig.lastX;
      const dy = event.clientY - rig.lastY;
      rig.lastX = event.clientX;
      rig.lastY = event.clientY;
      if (!rig.dragging) return;

      rig.yawT -= dx * 0.006;
      rig.pitchT = THREE.MathUtils.clamp(rig.pitchT + dy * 0.004, -0.85, 0.85);
      rig.velYaw = -dx * 0.045;
      rig.velPitch = dy * 0.03;
    };

    const onPointerEnd = (event: PointerEvent): void => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (pointers.size === 0) {
        rig.dragging = false;
        stage.classList.remove("is-grabbing");
      }
      touch();
    };

    const onWheel = (event: WheelEvent): void => {
      if (isControl(event.target)) return;
      event.preventDefault();
      rig.zoomT = clampZoom(rig.zoomT * Math.exp(event.deltaY * 0.0011));
      touch();
    };

    const onDoubleClick = (event: MouseEvent): void => {
      if (isControl(event.target)) return;
      rig.yawT = 0;
      rig.pitchT = 0;
      rig.zoomT = 1;
      rig.velYaw = 0;
      rig.velPitch = 0;
      touch();
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerEnd);
    stage.addEventListener("pointercancel", onPointerEnd);
    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("dblclick", onDoubleClick);

    camApi.current = {
      zoom: (factor) => {
        rig.zoomT = clampZoom(rig.zoomT * factor);
        touch();
      },
      reset: () => {
        rig.yawT = 0;
        rig.pitchT = 0;
        rig.zoomT = 1;
        rig.velYaw = 0;
        rig.velPitch = 0;
        touch();
      },
    };

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.28,
      0.4,
      1.15,
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const offset = new THREE.Vector3();
    const focus = new THREE.Vector3();
    const center = new THREE.Vector3(0, 0.26, 0);
    const qYaw = new THREE.Quaternion();
    const qPitch = new THREE.Quaternion();

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());

      if (!pausedRef.current) {
        elapsed += dt;
        // Linger on the wide reveal and the crest pass, then coast around.
        const wrap = (at: number) => {
          const d = Math.abs(u - at);
          return Math.min(d, 1 - d);
        };
        const pace =
          (1 - 0.55 * Math.exp(-Math.pow(wrap(0.92) / 0.09, 2))) *
          (1 - 0.32 * Math.exp(-Math.pow(wrap(0.45) / 0.12, 2)));
        const breathe = 0.82 + 0.18 * Math.sin(elapsed * 0.55);
        u = (u + dt * 0.035 * pace * breathe) % 1;
        assembly.update(elapsed);
        sweep.position.y = -0.35 + ((elapsed * 0.34) % 1) * 1.22;

        const positions = emberGeometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < emberCount; i++) {
          const y = positions.getY(i) + dt * (0.035 + emberSeeds[i] * 0.09);
          positions.setY(i, y > 1.7 ? -0.44 : y);
          const x = positions.getX(i);
          positions.setX(
            i,
            x + Math.sin(elapsed * 0.7 + emberSeeds[i] * 12) * dt * 0.02,
          );
        }
        positions.needsUpdate = true;
        embers.rotation.y += dt * 0.05;
      }

      const rpmTarget =
        variant === "v12"
          ? 4200 + Math.sin(elapsed * 2.1) * 2600
          : 7600 + Math.sin(elapsed * 2.6) * 4200;
      shownRpm += (rpmTarget - shownRpm) * dt * 4;
      const rpmNorm = THREE.MathUtils.clamp((shownRpm - 2600) / 9600, 0, 1);
      if (rpmRef.current) {
        rpmRef.current.textContent = Math.round(shownRpm).toLocaleString("en-US");
      }
      if (routeRef.current) {
        routeRef.current.textContent = String(Math.round(u * 100)).padStart(2, "0");
      }

      // Inertia after release, then drift back to the route once idle.
      if (!rig.dragging && pointers.size === 0) {
        rig.yawT += rig.velYaw * dt;
        rig.pitchT = THREE.MathUtils.clamp(
          rig.pitchT + rig.velPitch * dt,
          -0.85,
          0.85,
        );
        const decay = Math.exp(-dt * 2.8);
        rig.velYaw *= decay;
        rig.velPitch *= decay;
        if (performance.now() - rig.lastInput > 4200) {
          const ease = 1 - Math.exp(-dt * 1.15);
          rig.yawT += (0 - rig.yawT) * ease;
          rig.pitchT += (0 - rig.pitchT) * ease;
          rig.zoomT += (1 - rig.zoomT) * ease;
        }
      }

      const ease = 1 - Math.exp(-dt * 8);
      rig.yaw += (rig.yawT - rig.yaw) * ease;
      rig.pitch += (rig.pitchT - rig.pitch) * ease;
      rig.zoom += (rig.zoomT - rig.zoom) * ease;

      const basePos = curve.getPointAt(u);
      const ahead = curve.getPointAt((u + 0.045) % 1);
      // Hold the block in frame for the whole lap; the route supplies the
      // movement, a small path bias keeps the framing alive.
      focus.copy(center).lerp(ahead, 0.16);

      offset.copy(basePos).sub(focus).multiplyScalar(rig.zoom);
      qPitch.setFromAxisAngle(RIGHT, rig.pitch);
      qYaw.setFromAxisAngle(UP, rig.yaw);
      offset.applyQuaternion(qPitch).applyQuaternion(qYaw);
      camera.position.copy(focus).add(offset);

      if (!reduced) {
        const shake = 0.4 + rpmNorm;
        camera.position.x += Math.sin(elapsed * 11.3) * 0.0032 * shake;
        camera.position.y += Math.sin(elapsed * 13.7 + 1.3) * 0.0026 * shake;
        camera.position.z += Math.cos(elapsed * 9.1) * 0.002;
      }

      camera.lookAt(focus);
      const roll =
        Math.sin(elapsed * 0.35) * 0.01 +
        THREE.MathUtils.clamp(rig.velYaw * 0.55, -0.05, 0.05);
      if (!reduced) camera.rotateZ(roll);

      // X-ray the shells while the camera is inside the block so the pass
      // reads as a schematic cutaway rather than a wall of metal.
      const interiorMix =
        1 - THREE.MathUtils.smoothstep(camera.position.distanceTo(center), 0.35, 0.75);
      const ghost = 1 - interiorMix * 0.9;
      for (const entry of xray) {
        entry.material.opacity = entry.opacity * ghost;
        entry.material.depthWrite = interiorMix > 0.5 ? false : entry.depthWrite;
      }

      const jitter = reduced ? 0 : rpmNorm * 0.0021;
      assembly.group.position.y = 0.04 + Math.sin(elapsed * 57) * jitter;
      assembly.group.rotation.z = Math.sin(elapsed * 43) * jitter * 0.7;
      rim.intensity = 2.6 + rpmNorm * 1.7 + Math.sin(elapsed * 5) * 0.5;
      stageRing.material.opacity = 0.16 + 0.12 * Math.sin(elapsed * 2.2);
      const ringScale = 1 + Math.sin(elapsed * 1.6) * 0.015;
      stageRing.scale.set(ringScale, ringScale, 1);
      sweep.material.opacity = 0.2 + 0.1 * Math.sin(elapsed * 3.1);

      composer.render();
    };

    tick();

    const resize = () => {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerEnd);
      stage.removeEventListener("pointercancel", onPointerEnd);
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("dblclick", onDoubleClick);
      stage.classList.remove("is-grabbing");
      camApi.current = null;
      scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh ||
          object instanceof THREE.LineSegments ||
          object instanceof THREE.Points
        ) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material?.dispose());
        }
      });
      scene.environment?.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement === stage) {
        stage.removeChild(renderer.domElement);
      }
    };
  }, [variant]);

  const spec = SPECS[variant];

  return (
    <div className="corelab" role="dialog" aria-modal="true" aria-label="Engine core lab">
      <div className="corelab__bar">
        <span className="corelab__tag">
          <i /> CORE LAB / CUTAWAY
        </span>

        <div className="corelab__tabs" role="tablist" aria-label="Engine">
          <button
            type="button"
            role="tab"
            aria-selected={variant === "v12"}
            className={variant === "v12" ? "is-active" : ""}
            onClick={() => onChange("v12")}
          >
            V12 BITURBO
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={variant === "i4"}
            className={variant === "i4" ? "is-active" : ""}
            onClick={() => onChange("i4")}
          >
            I4 DOHC 16V
          </button>
        </div>

        <button type="button" className="corelab__close" onClick={onClose} ref={closeRef}>
          CLOSE <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="corelab__stage">
        <div className="corelab__canvas" ref={stageRef} />

        <div className="corelab__bracket corelab__bracket--tl" aria-hidden="true" />
        <div className="corelab__bracket corelab__bracket--tr" aria-hidden="true" />
        <div className="corelab__bracket corelab__bracket--bl" aria-hidden="true" />
        <div className="corelab__bracket corelab__bracket--br" aria-hidden="true" />

        <div className="corelab__left">
          <span className="micro">CUTAWAY / LIVE TELEMETRY</span>
          <ul>
            {spec.rows.map(([label, value]) => (
              <li key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </li>
            ))}
          </ul>
        </div>

        <div className="corelab__right">
          <span className="micro">
            FLYTHROUGH / ROUTE <span ref={routeRef}>0</span>%
          </span>
          <div className="corelab__rpm">
            <b>
              <span ref={rpmRef}>4,200</span>
            </b>
            <span>RPM</span>
          </div>
          <button
            type="button"
            className="corelab__pause"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
          >
            {paused ? "RESUME" : "HOLD"}
          </button>
          <div className="corelab__cam">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => camApi.current?.zoom(0.84)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => camApi.current?.zoom(1.19)}
            >
              −
            </button>
            <button type="button" onClick={() => camApi.current?.reset()}>
              RESET VIEW
            </button>
          </div>
          <span className="corelab__hint">
            DRAG TO ORBIT · WHEEL / PINCH TO ZOOM · ESC TO CLOSE
          </span>
        </div>

        <div className="corelab__caption">
          <span className="corelab__caption-index">CORE / {variant.toUpperCase()}</span>
          <h3>{spec.title}</h3>
          <p>{spec.subtitle}</p>
          <span className="corelab__caption-note">
            AUTO ORBIT — DRAG TO FLY IT YOURSELF, IT RESUMES WHEN IDLE
          </span>
        </div>

        <div className="corelab__scan" aria-hidden="true" />
      </div>
    </div>
  );
}
