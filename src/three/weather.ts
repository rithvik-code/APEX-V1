import * as THREE from "three";
import type { SceneConfig } from "../lib/scene";

// Rain, wheel spray, headlight volumetrics and a wet reflective floor. The
// system eases between clear/dry and rain/night so toggles never hard-cut.
export class WeatherSystem {
  private rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private rainPositions: Float32Array;
  private rainSpeeds: Float32Array;
  private spray: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private sprayPositions: Float32Array;
  private sprayVel: Float32Array;
  private beams: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>[] = [];
  private headlights: THREE.SpotLight[] = [];
  private floor: THREE.MeshStandardMaterial;
  private rainTarget = 0;
  private rainCurrent = 0;
  private nightTarget = 0;
  private nightCurrent = 0;
  private reducedMotion: boolean;

  constructor(
    scene: THREE.Scene,
    carGroup: THREE.Group,
    floor: THREE.MeshStandardMaterial,
    reducedMotion: boolean,
  ) {
    this.floor = floor;
    this.reducedMotion = reducedMotion;

    const count = reducedMotion ? 500 : 1500;
    const positions = new Float32Array(count * 6);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 34;
      const y = Math.random() * 15;
      const z = -22 + Math.random() * 40;
      const len = 0.5 + Math.random() * 0.9;
      positions.set([x, y, z, x + 0.06, y - len, z + 0.5], i * 6);
      speeds[i] = 16 + Math.random() * 20;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({
        color: 0xbfe0ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.rain.visible = false;
    this.rainPositions = positions;
    this.rainSpeeds = speeds;
    scene.add(this.rain);

    // Wheel spray kicked backward off the rear tyres.
    const sprayCount = reducedMotion ? 120 : 360;
    const sprayPos = new Float32Array(sprayCount * 3);
    const sprayVel = new Float32Array(sprayCount * 3);
    for (let i = 0; i < sprayCount; i++) {
      this.resetSpray(sprayPos, sprayVel, i, true);
    }
    const sprayGeo = new THREE.BufferGeometry();
    sprayGeo.setAttribute("position", new THREE.BufferAttribute(sprayPos, 3));
    this.spray = new THREE.Points(
      sprayGeo,
      new THREE.PointsMaterial({
        color: 0xcfe6ff,
        size: 0.07,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.spray.visible = false;
    this.sprayPositions = sprayPos;
    this.sprayVel = sprayVel;
    carGroup.add(this.spray);

    // Headlight cones + real spotlights, mounted on the car so they steer with it.
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(1.5, 8, 24, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xeaffd0,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(side * 0.52, 0.46, 6.3);
      beam.visible = false;
      carGroup.add(beam);
      this.beams.push(beam);

      const lamp = new THREE.SpotLight(0xf2ffe0, 0, 34, 0.46, 0.7, 1.4);
      lamp.position.set(side * 0.52, 0.5, 2.3);
      lamp.target.position.set(side * 0.7, 0.1, 14);
      carGroup.add(lamp);
      carGroup.add(lamp.target);
      this.headlights.push(lamp);
    }
  }

  private resetSpray(pos: Float32Array, vel: Float32Array, i: number, randomAge = false): void {
    const side = i % 2 === 0 ? -1 : 1;
    const age = randomAge ? Math.random() : 0;
    pos[i * 3] = side * 0.93 + (Math.random() - 0.5) * 0.3;
    pos[i * 3 + 1] = 0.1 + age * 0.7;
    pos[i * 3 + 2] = -1.5 - age * 2.4;
    vel[i * 3] = (Math.random() - 0.5) * 0.7;
    vel[i * 3 + 1] = 1.1 + Math.random() * 1.6;
    vel[i * 3 + 2] = -(2.4 + Math.random() * 3.2);
  }

  configure(config: SceneConfig): void {
    this.rainTarget = config.weather === "rain" ? config.rainAmount : 0;
    this.nightTarget = config.nightRace ? 1 : 0;
  }

  get night(): number {
    return this.nightCurrent;
  }

  get wet(): number {
    return this.rainCurrent;
  }

  update(dt: number): void {
    const ease = 1 - Math.exp(-dt * 2.6);
    this.rainCurrent += (this.rainTarget - this.rainCurrent) * ease;
    this.nightCurrent += (this.nightTarget - this.nightCurrent) * ease;
    const rain = this.rainCurrent;
    const night = this.nightCurrent;

    // Wet floor: a rain-soaked mirror instead of a dry matte disc.
    this.floor.roughness = THREE.MathUtils.lerp(0.42, 0.07, rain);
    this.floor.metalness = THREE.MathUtils.lerp(0.8, 0.96, rain);
    this.floor.envMapIntensity = THREE.MathUtils.lerp(0.35, 1.25, rain);

    this.rain.visible = rain > 0.01;
    this.rain.material.opacity = rain * 0.5;
    if (this.rain.visible && !this.reducedMotion) {
      const pos = this.rainPositions;
      for (let i = 0; i < this.rainSpeeds.length; i++) {
        const fall = this.rainSpeeds[i] * dt;
        pos[i * 6 + 1] -= fall;
        pos[i * 6 + 4] -= fall;
        pos[i * 6 + 2] += fall * 0.42;
        pos[i * 6 + 5] += fall * 0.42;
        if (pos[i * 6 + 1] < 0) {
          const x = (Math.random() - 0.5) * 34;
          const y = 13 + Math.random() * 3;
          const z = -22 + Math.random() * 40;
          const len = 0.5 + Math.random() * 0.9;
          pos.set([x, y, z, x + 0.06, y - len, z + 0.5], i * 6);
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    this.spray.visible = rain > 0.05;
    this.spray.material.opacity = rain * 0.4;
    if (this.spray.visible && !this.reducedMotion) {
      const pos = this.sprayPositions;
      const vel = this.sprayVel;
      for (let i = 0; i < pos.length / 3; i++) {
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= 3.4 * dt;
        if (pos[i * 3 + 1] < 0.02 || pos[i * 3 + 2] < -5) {
          this.resetSpray(pos, vel, i);
        }
      }
      this.spray.geometry.attributes.position.needsUpdate = true;
    }

    const beamOn = night > 0.02;
    for (const beam of this.beams) {
      beam.visible = beamOn;
      beam.material.opacity = night * (0.07 + rain * 0.12);
    }
    for (const lamp of this.headlights) {
      lamp.intensity = night * (10 + rain * 6);
    }
  }

  dispose(): void {
    this.rain.geometry.dispose();
    this.rain.material.dispose();
    this.spray.geometry.dispose();
    this.spray.material.dispose();
    for (const beam of this.beams) {
      beam.geometry.dispose();
      beam.material.dispose();
    }
  }
}