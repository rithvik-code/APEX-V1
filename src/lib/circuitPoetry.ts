import type { DriveVehicle, SectorTimes } from "./driveStore";

export type CircuitPoem = {
  lines: [string, string, string, string];
  vehicle: DriveVehicle;
  time: number;
  sectors: SectorTimes;
};

/** A fast, offline verse shaped by the lap's real split pattern. */
export function composeCircuitPoem(vehicle: DriveVehicle, time: number, sectors: SectorTimes): CircuitPoem {
  const fastest = sectors.indexOf(Math.min(...sectors));
  const machine = vehicle === "bike" ? "two bright wheels" : "silver wings";
  const sectorLine = [
    "The first curve opened like a gate.",
    "The middle bends fell into rhythm.",
    "The final arc carried the whole sky.",
  ][fastest];
  const finalLine = time < 60 ? "A minute folded into a heartbeat." : "The clock let the last light pass.";
  return {
    lines: [
      `A clean line wakes ${machine}.`,
      sectorLine,
      `Three sectors stitch one unbroken trace.`,
      finalLine,
    ],
    vehicle,
    time,
    sectors,
  };
}
