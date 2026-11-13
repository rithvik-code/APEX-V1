import type { SceneConfig } from "../../lib/scene";

export type MeshNodeProps = {
  scene: SceneConfig;
  onTune: (patch: Partial<SceneConfig>) => void;
  onDrive: () => void;
};
