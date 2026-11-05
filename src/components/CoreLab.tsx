import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
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

// Closed camera routes. The middle points deliberately pass through solid
// geometry: the V12 valley and plenum, then the I4 cam cover and crankcase.
const PATHS: Record<CoreVariant, Array<[number, number, number]>> = {
  v12: [
    [2.35, 1.45, 2.35],
    [1.1, 0.9, 1.55],
    [0.45, 0.68, 0.82],
    [0.1, 0.5, 0.2],
    [0.0, 0.42, -0.5],
    [0.12, 0.25, -1.05],
    [-0.55, 0.16, -1.3],
    [-1.3, 0.42, -0.9],
    [-2.0, 0.95, 0.2],
    [-2.3, 1.4, 1.7],
  ],
  i4: [
    [1.7, 1.2, 1.8],
    [0.85, 0.82, 1.0],
    [0.35, 0.65, 0.45],
    [0.12, 0.52, 0.1],
    [0.0, 0.38, 0.0],
    [0.05, 0.22, 0.05],
    [0.25, 0.06, 0.3],
    [0.75, 0.25, 0.55],
    [1.4, 0.7, 1.1],
    [1.85, 1.1, 1.6],
  ],
};

export function CoreLab({ variant, onClose, onChange }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const rpmRef = useRef<HTMLSpanElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pausedRef = useRef(false);
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
    renderer.toneMappingExposure = 1.15;
    stage.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050607);
    scene.fog = new THREE.FogExp2(0x050607, 0.035);

    const camera = new THREE.PerspectiveCamera(52, width / height, 0.015, 60);
    camera.position.set(...PATHS[variant][0]);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0x9fb4bd, 0x050607, 0.8));

    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 4.5, 3.5);
    scene.add(key);

    const rim = new THREE.PointLight(0xc8ff16, 8, 7, 2);
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
        envMapIntensity: 0.8,
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
    scene.add(assembly.group);

    // Sweeping diagnostic plane.
    const sweep = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.1),
      new THREE.MeshBasicMaterial({
        color: 0xc8ff16,
        transparent: true,
        opacity: 0.045,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    sweep.position.y = 0.25;
    assembly.group.add(sweep);

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

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, clock.getDelta());

      if (!pausedRef.current) {
        elapsed += dt;
        assembly.update(elapsed);
        sweep.position.z = -1.2 + ((elapsed * 0.55) % 1) * 2.4;
        sweep.rotation.y = Math.PI / 2;
      }

      if (reduced) {
        const fixed = curve.getPointAt(0.24);
        camera.position.copy(fixed);
        camera.lookAt(0, 0.2, 0);
      } else {
        const u = (elapsed * 0.038) % 1;
        const pos = curve.getPointAt(u);
        const ahead = curve.getPointAt((u + 0.035) % 1);
        pos.y += Math.sin(elapsed * 1.3) * 0.012;
        camera.position.copy(pos);
        camera.lookAt(ahead.x, ahead.y + 0.12, ahead.z);
      }

      if (rpmRef.current) {
        const target =
          variant === "v12"
            ? 4200 + Math.sin(elapsed * 2.1) * 2600
            : 7600 + Math.sin(elapsed * 2.6) * 4200;
        shownRpm += (target - shownRpm) * dt * 4;
        rpmRef.current.textContent = Math.round(shownRpm).toLocaleString("en-US");
      }

      renderer.render(scene, camera);
    };

    tick();

    const resize = () => {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
        }
      });
      scene.environment?.dispose();
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
          <span className="micro">FLYTHROUGH</span>
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
          <span className="corelab__hint">ESC TO CLOSE</span>
        </div>

        <div className="corelab__caption">
          <span className="corelab__caption-index">CORE / {variant.toUpperCase()}</span>
          <h3>{spec.title}</h3>
          <p>{spec.subtitle}</p>
          <span className="corelab__caption-note">
            CAMERA ROUTE INTERSECTS THE ASSEMBLY — CUTAWAY RENDER
          </span>
        </div>

        <div className="corelab__scan" aria-hidden="true" />
      </div>
    </div>
  );
}
