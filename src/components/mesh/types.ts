// Structural subset of SceneConfig — avoids a circular import with lib/scene.
export type SceneConfigLike = {
  windSpeed: number;
  turbulence: number;
  density: number;
  rainAmount: number;
  explode: number;
  rpm: number;
  nightRace: boolean;
  weather: string;
  dyno: boolean;
};

export type MeshNodeProps = {
  scene: SceneConfigLike;
  onTune: (patch: Record<string, unknown>) => void;
  onDrive: () => void;
};
