import { ACTIONS } from "./permissions.mjs";

/*
 * DESKTOP ACTIONS — the bridge between a spoken Cyrus command and the APEX
 * surface itself: open a section, search the project, launch a workflow.
 *
 * These helpers only build intent. The daemon decides whether the capability
 * is armed and whether the user must approve first, exactly like every other
 * control action.
 */

export const APEX_SECTIONS = {
  top: "top",
  ignition: "top",
  hero: "top",
  manifesto: "manifesto",
  machine: "machine",
  pitwall: "pitwall",
  terminal: "pitwall",
  grid: "grid",
  mesh: "mesh",
  crew: "crew",
  garage: "crew",
  vast: "vast",
  install: "install",
  command: "command",
  brain: "command",
  workflow: "command",
};

export function apexUrl(section, origin = "http://127.0.0.1:5173") {
  const key = String(section || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
  if (!key) return origin;
  const match = Object.keys(APEX_SECTIONS).find((name) => key === name || key.includes(name));
  if (!match) {
    throw new Error(
      `No APEX section called "${section}". Try: ignition, machine, pitwall, grid, mesh, crew, command.`,
    );
  }
  return `${origin}/#${APEX_SECTIONS[match]}`;
}

/** Risk metadata for actions that change the machine or the project. */
export function actionRisk(name) {
  return ACTIONS[name]?.risk ?? "medium";
}
