import {
  aeroTelemetry,
  DEFAULT_SCENE,
  dynoPeak,
  dynoPoint,
  LIVERIES,
  rpmValue,
  type SceneConfig,
} from "./scene";

export type EngineerAction = {
  patch: Partial<SceneConfig>;
  reply: string;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round5 = (value: number) => Math.round(value / 5) * 5;

// A tuning request needs a topic plus an actual imperative. Weak helpers like
// "can", "please" or "want" are deliberately absent: "can you explain
// wet-weather downforce?" is a question and belongs to the model, not the tuner.
const TOPIC_RE =
  /\b(downforce|drag|grip|wet|rain|storm|drizzle|night|dark|daylight|dyno|rev|redline|throttle|power curve|torque|horsepower|explode|exploded|apart|assemble|paint|livery|colou?r|stripe|wind|faster|slower|camera|overhead|neon|studio|midnight|grid|superbike|motorcycle|reset|stock|factory|random|shuffle|pressure|velocity|orbit)\b/i;
const ACTION_RE =
  /\b(set|setup|switch|turn|make|give|add|drop|raise|lower|increase|decrease|run|go|put|paint|show|enable|disable|start|stop|kill|reset|change|trim|load|apply|fit|arm|engage|launch|crank|rev|clear|hide|explode|assemble|roll|bring)\b/i;
const STRONG_RE =
  /\b(more downforce|less drag|more grip|less grip|more wing|less wing|wet setup|night race|rain mode|run the dyno|redline it|rev it|explode the car|paint it|top speed|flat out|surprise me|show me the engine|take it apart|put it back)\b/i;

export function engineerIntent(text: string): boolean {
  return STRONG_RE.test(text) || (TOPIC_RE.test(text) && ACTION_RE.test(text));
}

const PAINT_COLORS: Array<[RegExp, string, string]> = [
  [/\b(acid|lime)\b/i, "#c8ff16", "acid green"],
  [/\b(red|crimson|scarlet)\b/i, "#e01818", "racing red"],
  [/\b(blue|azure)\b/i, "#2f7bff", "azure blue"],
  [/\b(black|stealth|midnight black)\b/i, "#101214", "stealth black"],
  [/\b(white|pearl)\b/i, "#f2f4f0", "pearl white"],
  [/\b(green)\b/i, "#2fff6a", "green"],
  [/\b(yellow|gold)\b/i, "#ffd400", "yellow"],
  [/\b(orange|ember|papaya)\b/i, "#ff5a1f", "papaya orange"],
  [/\b(purple|violet)\b/i, "#8b3dff", "violet"],
  [/\b(pink|magenta)\b/i, "#ff2fb3", "magenta"],
  [/\b(silver|grey|gray|graphite)\b/i, "#aab2ba", "liquid silver"],
  [/\b(cyan|teal|turquoise)\b/i, "#2fe0ff", "cyan"],
];

export function tuneFromText(
  text: string,
  current: SceneConfig,
): EngineerAction | null {
  if (!engineerIntent(text)) return null;

  const patch: Partial<SceneConfig> = {};
  const notes: string[] = [];
  const trades: string[] = [];
  const next = (): SceneConfig => ({ ...current, ...patch });

  /* Weather -------------------------------------------------------------- */
  if (/\b(stop|clear|dry|no|end|kill)\b.{0,12}\b(rain|wet|storm)\b|\b(dry setup|clear skies|sun out)\b/i.test(text)) {
    patch.weather = "clear";
    notes.push("Switching to a dry setup — rain cleared, floor back to full roughness.");
    trades.push("The wet line is gone; you can lean on the aero again.");
  } else if (/\b(rain|wet|storm|drizzle|monsoon|soaked|slicks are useless)\b/i.test(text)) {
    const heavy = /\b(heavy|storm|monsoon|pouring|deluge)\b/i.test(text);
    const light = /\b(light|drizzle|sprinkle|damp)\b/i.test(text);
    patch.weather = "rain";
    patch.rainAmount = heavy ? 1 : light ? 0.35 : 0.75;
    patch.windSpeed = round5(clamp(next().windSpeed - 20, 40, 400));
    patch.turbulence = clamp(Math.round((next().turbulence + 0.15) * 100) / 100, 0, 1);
    notes.push(
      `Rain mode on at ${Math.round(patch.rainAmount * 100)}% intensity. Easing the wind to ${patch.windSpeed} km/h and stirring the wake for the wet.`,
    );
    trades.push(
      "Downforce falls with speed squared, so keep the wing loaded — spray and visibility are the real cost now.",
    );
  }

  /* Night ---------------------------------------------------------------- */
  if (/\b(day|daylight|sunrise|lights on|studio lights|morning)\b/i.test(text) && /\b(set|switch|make|turn|go|run|mode)\b/i.test(text)) {
    patch.nightRace = false;
    patch.lighting = "studio";
    notes.push("Back to daylight — studio rig up, headlights stood down.");
  } else if (/\b(night|dark|midnight|evening|under the lights)\b/i.test(text)) {
    patch.nightRace = true;
    patch.lighting = "midnight";
    notes.push("Night race armed — headlight beams live, rig dimmed to midnight.");
    trades.push("You trade ambient visibility for beam contrast; the neon reads harder in the dark.");
  }

  /* Downforce / drag ------------------------------------------------------ */
  if (/\b(more|add|increase|raise|load|need|want|give me)\b.{0,16}\b(downforce|grip)\b|\b(downforce|grip)\b.{0,12}\b(up|more|please)\b|\b(high[- ]speed corner|planted|stick to the floor)\b/i.test(text)) {
    patch.windSpeed = round5(clamp(next().windSpeed + 60, 40, 400));
    patch.turbulence = clamp(Math.round((next().turbulence - 0.1) * 100) / 100, 0, 1);
    notes.push(`Loading the wing at ${patch.windSpeed} km/h and calming the wake.`);
    trades.push("Drag climbs with the same square law — the straights will feel longer.");
  } else if (/\b(less|reduce|drop|lower|trim|cut)\b.{0,16}\b(downforce|drag|wing)\b|\b(low drag|top speed|straight[- ]line speed|monza|slippery)\b/i.test(text)) {
    patch.windSpeed = round5(clamp(next().windSpeed - 70, 40, 400));
    notes.push(`Trimming the wing load to ${patch.windSpeed} km/h for the straights.`);
    trades.push("Less drag, more terminal speed — but the fast corners get nervous without the load.");
  }

  /* Speed ---------------------------------------------------------------- */
  const carContext = /\b(car|setup|tunnel|wind|speed|pace|km\/h|machine|vehicle|wing)\b/i.test(text);
  if (/\b(flat out|full throttle|max(imum)? speed|send it|all out)\b/i.test(text)) {
    patch.windSpeed = 400;
    notes.push("Flat out — 400 km/h through the tunnel.");
    trades.push("Everything scales with v²: downforce, drag and the noise in the wake.");
  } else if (carContext && /\b(faster|speed up|quicker|more speed|push the pace)\b/i.test(text)) {
    patch.windSpeed = round5(clamp(next().windSpeed + 80, 40, 400));
    notes.push(`Picking up the pace to ${patch.windSpeed} km/h.`);
  } else if (carContext && /\b(slower|slow down|ease off|back off|less speed|cruise)\b/i.test(text)) {
    patch.windSpeed = round5(clamp(next().windSpeed - 60, 40, 400));
    notes.push(`Easing off to ${patch.windSpeed} km/h.`);
  }

  /* Dyno ----------------------------------------------------------------- */
  if (/\b(stop|kill|shut)\b.{0,12}\b(dyno|engine|rev)\b|\b(engine off|idle only)\b/i.test(text)) {
    patch.dyno = false;
    notes.push("Dyno stood down — engine back to idle.");
  } else if (/\b(dyno|rev|redline|throttle|power curve|torque|horsepower|wake the engine)\b/i.test(text)) {
    patch.dyno = true;
    patch.rpm = /\b(redline|limit|bang off)\b/i.test(text)
      ? 1
      : /\bidle\b/i.test(text)
        ? 0
        : 0.82;
    const point = dynoPoint(patch.rpm);
    notes.push(
      `Dyno live at ${rpmValue(patch.rpm).toLocaleString()} rpm — ${Math.round(point.torqueNm)} Nm, ${Math.round(point.powerHp)} hp at the crank.`,
    );
    trades.push("Watch the curve: torque peaks mid-range, power keeps climbing to the redline.");
  }

  /* Exploded view --------------------------------------------------------- */
  if (/\b(assemble|put it back|back together|reassemble)\b/i.test(text)) {
    patch.explode = 0;
    notes.push("Bolting it back together — assemblies home.");
  } else if (/\b(explode|exploded|apart|disassemble|strip it|internals|show me the engine|x[- ]?ray)\b/i.test(text)) {
    patch.explode = /\b(fully|completely|all the way)\b/i.test(text) ? 1 : 0.85;
    notes.push("Pulling the assemblies apart — monocoque, canopy, aero and V12 on display.");
  }

  /* Paint / livery --------------------------------------------------------- */
  const paintMatch = PAINT_COLORS.find(([re]) => re.test(text));
  const numberMatch = text.match(/\bnumber\s*(?:to\s*)?([a-z0-9]{1,3})\b/i);
  const stripeOff = /\b(no|remove|delete|kill|without)\b.{0,8}\bstripe\b/i.test(text);
  const stripeOn = /\bstripe\b/i.test(text) && !stripeOff;
  if (paintMatch || numberMatch || stripeOn || stripeOff || /\b(paint|livery|colou?r)\b/i.test(text)) {
    const paint = { ...next().paint, enabled: true };
    if (paintMatch) {
      paint.base = paintMatch[1];
      notes.push(`Repainting the shell ${paintMatch[2]}.`);
    } else {
      notes.push("Opening the painter.");
    }
    if (numberMatch) {
      paint.number = numberMatch[1].toUpperCase();
      notes.push(`Running number ${paint.number} on the roundels.`);
    }
    if (stripeOn) paint.stripe = true;
    if (stripeOff) paint.stripe = false;
    patch.paint = paint;
  }
  const preset = LIVERIES.find((entry) =>
    new RegExp(`\\b${entry.name.toLowerCase()}\\b`).test(text.toLowerCase()),
  );
  if (preset && /\b(livery|paint|preset|scheme)\b/i.test(text)) {
    patch.livery = preset.id;
    patch.paint = { ...next().paint, enabled: false };
    notes.push(`Fitting the ${preset.name} preset livery.`);
  }

  /* Camera / lighting / flow ---------------------------------------------- */
  const view = text.match(
    /(?:camera|view|shot|angle).{0,16}\b(side|top|wing|hero|overhead|profile|rear)\b|\b(side|top|wing|hero|overhead|profile)\b.{0,10}(?:camera|view|shot|angle)/i,
  );
  if (view) {
    const word = (view[1] ?? view[2]).toLowerCase();
    const camera =
      word === "overhead" || word === "profile"
        ? word === "overhead"
          ? "top"
          : "side"
        : word === "rear"
          ? "wing"
          : (word as SceneConfig["camera"]);
    patch.camera = camera;
    notes.push(`Swinging the camera to the ${camera} preset.`);
  }
  if (/\bneon\b/i.test(text)) {
    patch.lighting = "neon";
    notes.push("Neon rig up — magenta cool light, hot acid key.");
  } else if (/\bstudio\b/i.test(text)) {
    patch.lighting = "studio";
    notes.push("Studio rig restored.");
  } else if (/\bmidnight\b/i.test(text) && !patch.nightRace) {
    patch.lighting = "midnight";
    notes.push("Midnight lighting on.");
  }
  if (/\bpressure\b/i.test(text) && /\b(flow|colou?r|mode|show|paint)\b/i.test(text)) {
    patch.colorMode = "pressure";
    notes.push("Flow coloured by pressure — watch the stagnation point at the nose.");
  } else if (/\bvelocity\b/i.test(text) && /\b(flow|colou?r|mode|show)\b/i.test(text)) {
    patch.colorMode = "velocity";
    notes.push("Flow coloured by velocity.");
  }

  /* Focus / grid / orbit --------------------------------------------------- */
  if (/\b(bike|superbike|motorcycle)\b/i.test(text) && /\b(focus|only|just|show|flow)\b/i.test(text)) {
    patch.focus = "bike";
    notes.push("Focusing the streamlines on the superbike.");
  } else if (/\b(only|just|focus)\b.{0,10}\bcar\b/i.test(text)) {
    patch.focus = "car";
    notes.push("Car-only flow.");
  } else if (/\bboth\b.{0,10}\b(cars?|bikes?|machines|vehicles)\b|\bshow both\b/i.test(text)) {
    patch.focus = "both";
    notes.push("Both machines in the flow.");
  }
  if (/\b(grid on|show (the )?grid|grid floor on)\b/i.test(text)) {
    patch.grid = true;
    notes.push("Grid floor on.");
  } else if (/\b(grid off|hide (the )?grid|no grid)\b/i.test(text)) {
    patch.grid = false;
    notes.push("Grid floor hidden.");
  }
  if (/\b(stop|kill|halt)\b.{0,8}\borbit\b/i.test(text)) {
    patch.autoOrbit = false;
    notes.push("Auto-orbit stopped.");
  } else if (/\b(orbit|rotate|spin)\b.{0,14}\b(camera|car|it|auto)\b|\bauto[- ]?orbit\b/i.test(text)) {
    patch.autoOrbit = true;
    notes.push("Auto-orbit engaged — slow cinematic spin.");
  }

  /* Reset / random --------------------------------------------------------- */
  if (/\b(reset|stock|factory|default)\b/i.test(text) && /\b(setup|car|scene|everything|config|it)\b/i.test(text)) {
    Object.assign(patch, { ...DEFAULT_SCENE, aero: current.aero });
    notes.length = 0;
    trades.length = 0;
    notes.push("Back to the factory setup — every dial home.");
  } else if (/\b(random|shuffle|surprise me|roll the dice|mix it up)\b/i.test(text)) {
    const pick = <T,>(list: ReadonlyArray<T>): T =>
      list[Math.floor(Math.random() * list.length)];
    patch.livery = pick(LIVERIES).id;
    patch.lighting = pick(["studio", "midnight", "neon"] as const);
    patch.colorMode = pick(["velocity", "pressure", "acid"] as const);
    patch.windSpeed = round5(120 + Math.random() * 240);
    patch.turbulence = Math.round(Math.random() * 20) * 5 / 100;
    patch.paint = { ...next().paint, enabled: false };
    notes.push("Rolled a fresh setup out of the garage lottery.");
    trades.push("It's a lottery ticket — tell me what to fix and I'll dial it in.");
  }

  if (!notes.length) return null;

  const result = next();
  const flow = aeroTelemetry(result.windSpeed);
  const lines = [
    `COPY THAT. ${notes.join(" ")}`,
    "",
    `TELEMETRY → ${result.windSpeed} KM/H · ${Math.round(flow.downforceKg).toLocaleString()} KG DOWNFORCE · ${Math.round(flow.dragN).toLocaleString()} N DRAG · L/D ${flow.efficiency.toFixed(2)}`,
  ];
  if (result.dyno) {
    const point = dynoPoint(result.rpm);
    const peak = dynoPeak();
    lines.push(
      `ENGINE → ${point.rpm.toLocaleString()} RPM · ${Math.round(point.torqueNm)} Nm · ${Math.round(point.powerHp)} HP (PEAK ${Math.round(peak.powerHp)} HP @ ${peak.powerRpm.toLocaleString()})`,
    );
  }
  if (trades.length) {
    lines.push("", `TRADE-OFF → ${trades.join(" ")}`);
  }
  return { patch, reply: lines.join("\n") };
}