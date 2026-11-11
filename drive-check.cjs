/* Scratch harness: drive-mode verification over the Chrome DevTools Protocol. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9334;
const OUT = path.join(os.tmpdir(), "apex-drive-shots");
const PROFILE = path.join(os.tmpdir(), "apex-cdp-profile-" + process.pid);
const APP_URL = process.env.APEX_URL || "http://127.0.0.1:5173/";

fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      "--user-data-dir=" + PROFILE,
      "--window-size=1440,900",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--enable-gpu",
      "--use-gl=angle",
      "--use-angle=d3d11",
      "--ignore-gpu-blocklist",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const killChrome = () => {
    try {
      require("node:child_process").execSync(`taskkill /PID ${chrome.pid} /T /F`, {
        stdio: "ignore",
      });
    } catch {
      /* already gone */
    }
  };
  process.on("exit", killChrome);
  process.on("SIGINT", () => process.exit(1));

  let version;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      break;
    } catch {
      await sleep(300);
    }
  }
  if (!version) throw new Error("Chrome CDP did not come up");

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(" ");
      if (msg.params.type === "error" || msg.params.type === "warning") {
        consoleLines.push(`${msg.params.type}: ${text}`);
      }
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleLines.push(
        "exception: " +
          (msg.params.exceptionDetails.exception?.description ||
            msg.params.exceptionDetails.text),
      );
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      consoleLines.push("log: " + msg.params.entry.text);
    }
  };

  const send = (method, params = {}, timeoutMs = 90000) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) {
          pending.delete(mid);
          reject(new Error(`timeout: ${method}`));
        }
      }, timeoutMs);
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Storage.clearDataForOrigin", {
    origin: new URL(APP_URL).origin,
    storageTypes: "local_storage",
  });

  const evaluate = async (expression, timeoutMs = 90000) => {
    const res = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (res.exceptionDetails) {
      throw new Error(
        "eval: " +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text),
      );
    }
    return res.result.value;
  };

  const setViewport = (width, height, mobile = false) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: width,
      screenHeight: height,
    });

  const shot = async (name) => {
    const res = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(res.data, "base64"));
    return name + ".png";
  };

  const waitFor = async (expression, timeout = 20000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(`!!(${expression})`)) return true;
      await sleep(250);
    }
    throw new Error("waitFor timeout: " + expression);
  };

  const clickText = (text) =>
    evaluate(
      `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(
        text,
      )})); if (!b) return false; b.click(); return true; })()`,
    );

  const results = {};
  const errors = [];
  const check = (name, ok, detail) => {
    results[name] = { ok, ...(detail === undefined ? {} : { detail }) };
    if (!ok) errors.push(name + (detail ? ": " + JSON.stringify(detail) : ""));
    console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + JSON.stringify(detail) : ""));
  };

  try {
    await setViewport(1440, 900);
    await send("Page.navigate", { url: APP_URL });
    await waitFor("document.querySelector('.site.is-ready')", 30000);
    await sleep(1200);
    check("desktop hero ready", true);
    await shot("01-hero-desktop");

    const launched = await clickText("TIME ATTACK");
    check("time attack launches", launched === true);
    await sleep(700);
    check(
      "countdown visible",
      await evaluate("!!document.querySelector('.dhud__countdown')"),
    );
    await shot("02-countdown-desktop");

    await waitFor("window.__apexDrive && window.__apexDrive.phase === 'racing'", 10000);
    await sleep(300);

    const hudInfo = await evaluate(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      return {
        panels: {
          timing: r('.dhud__timing'), board: r('.dhud__board'), setup: r('.dhud__setup'),
          speed: r('.dhud__speed'), controls: r('.dhud__controls'), touch: r('.dhud__touch'),
        },
        vw: innerWidth, vh: innerHeight,
        boardRows: document.querySelectorAll('.dhud__board li').length,
        sliders: document.querySelectorAll('.dhud__slider input').length,
        buttons: document.querySelectorAll('.dhud__seg button, .dhud__toggle, .dhud__btn').length,
        minimap: !!document.querySelector('.dhud__minimap-canvas'),
        ghostText: document.querySelector('.dhud__toggle')?.textContent,
        chromeHidden: getComputedStyle(document.querySelector('.topbar')).visibility === 'hidden',
        drivingClass: document.body.classList.contains('driving'),
        webglPixels: (() => { const c = document.querySelector('canvas.webgl'); const gl = c.getContext('webgl2') || c.getContext('webgl'); return gl ? true : false; })(),
      };
    })()`);
    check(
      "hud panels laid out",
      hudInfo.panels.timing && hudInfo.panels.setup && hudInfo.panels.speed && hudInfo.panels.controls,
      hudInfo.panels,
    );
    check("site chrome hidden while driving", hudInfo.chromeHidden && hudInfo.drivingClass);
    check("hud live tools >= 8", hudInfo.buttons >= 8, { buttons: hudInfo.buttons });
    check("minimap rendered", hudInfo.minimap === true);

    // Arrange layout check: panels must not overlap each other.
    const overlap = (a, b) =>
      a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const pairs = [
      ["timing", "board"],
      ["timing", "setup"],
      ["board", "setup"],
      ["board", "speed"],
      ["setup", "speed"],
      ["setup", "controls"],
      ["speed", "controls"],
      ["timing", "controls"],
    ];
    const overlapped = pairs.filter(([a, b]) => overlap(hudInfo.panels[a], hudInfo.panels[b]));
    check("desktop panels do not overlap", overlapped.length === 0, overlapped);

    const inViewport = Object.entries(hudInfo.panels)
      .filter(([, r]) => r)
      .filter(
        ([, r]) => r.x < -1 || r.y < -1 || r.x + r.w > hudInfo.vw + 1 || r.y + r.h > hudInfo.vh + 1,
      )
      .map(([k]) => k);
    check("desktop panels inside viewport", inViewport.length === 0, inViewport);

    // Autopilot: steer to a lookahead point on the centerline, manage speed.
    const lapRun = await evaluate(`(async () => {
      const d = window.__apexDrive;
      const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
      const log = { laps: [], maxSpeed: 0, offTrackFrames: 0, frames: 0, stuck: 0, ghostSeen: false, midSectors: null, activeRow: 0 };
      let lastLap = d.lapCount;
      const start = performance.now();
      while (performance.now() - start < 190000) {
        const t = d.track.nearestT(d.pos.x, d.pos.z);
        const speed = Math.abs(d.speed);
        const aheadT = (t + 0.01 + speed * 0.00042) % 1;
        const target = d.track.centerAt(aheadT, d.tmp);
        const desired = Math.atan2(target.x - d.pos.x, target.z - d.pos.z);
        const err = wrap(desired - d.heading);
        d.touch.steer = Math.max(-1, Math.min(1, -err * 2.4));
        const p1 = d.track.curve.getPoint(t);
        const p2 = d.track.curve.getPoint((t + 0.028) % 1);
        const turn = Math.abs(wrap(Math.atan2(p2.x - p1.x, p2.z - p1.z) - Math.atan2(target.x - d.pos.x, target.z - d.pos.z)));
        const targetSpeed = Math.max(9, 24 - turn * 34 - Math.abs(err) * 6);
        d.touch.throttle = speed < targetSpeed;
        d.touch.brake = speed > targetSpeed + 3.5;
        if (d.ghostHasPos) log.ghostSeen = true;
        if (d.sectors[0] !== null && d.sectors[1] === null) {
          const shown = [...document.querySelectorAll('.dhud__sector b')].map((e) => e.textContent);
          if (shown[0] !== "--:--.---") {
            log.midSectors = shown;
            log.activeRow = document.querySelectorAll('.dhud__sector.is-active').length;
          }
        }
        log.maxSpeed = Math.max(log.maxSpeed, speed);
        if (d.offTrack) log.offTrackFrames++;
        log.frames++;
        if (d.lapCount > lastLap) {
          lastLap = d.lapCount;
          log.laps.push({ time: d.lastTime, sectors: [...(d.board[0]?.sectors || [])] });
          if (log.laps.length >= 2) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      d.touch.steer = 0; d.touch.throttle = false; d.touch.brake = false;
      log.raceTime = d.raceTime;
      log.board = d.board.map((e) => ({ time: e.time, vehicle: e.vehicle }));
      log.bestTime = d.bestTime;
      log.hasGhost = d.ghost !== null;
      return log;
    })()`, 240000);

    check("autopilot completed 2 laps", lapRun.laps.length >= 2, lapRun.laps);
    if (lapRun.laps.length) {
      const first = lapRun.laps[0];
      check(
        "lap has three sectors",
        first.sectors.length === 3 && first.sectors.every((s) => typeof s === "number" && s > 0),
        first.sectors,
      );
      check(
        "lap time plausible",
        first.time > 8 && first.time < 45,
        first.time,
      );
      check(
        "sector splits ascend to lap time",
        first.sectors[0] < first.sectors[1] &&
          first.sectors[1] < first.sectors[2] &&
          Math.abs(first.sectors[2] - first.time) < 0.05,
        { sectors: first.sectors, time: first.time },
      );
    }
    check("board logged laps", lapRun.board.length >= 1, lapRun.board);
    check("best time set", typeof lapRun.bestTime === "number" && lapRun.bestTime > 0, lapRun.bestTime);
    check("ghost stored", lapRun.hasGhost === true);
    check("ghost replayed", lapRun.ghostSeen === true);
    check(
      "stays mostly on track",
      lapRun.frames > 0 && lapRun.offTrackFrames / lapRun.frames < 0.35,
      { off: lapRun.offTrackFrames, frames: lapRun.frames },
    );
    await shot("03-lap-desktop");

    const hudAfter = await evaluate(`(() => ({
      board: document.querySelectorAll('.dhud__board li').length,
      best: document.querySelector('.dhud__best-last b')?.textContent,
      sectors: [...document.querySelectorAll('.dhud__sector b')].map(e => e.textContent),
      fresh: !!document.querySelector('.dhud__board li.is-fresh'),
      lap: document.querySelector('.dhud__lap b')?.textContent,
    }))()`);
    check("leaderboard row rendered", hudAfter.board >= 1, hudAfter);
    check("best label updated", hudAfter.best && hudAfter.best !== "--:--.---", hudAfter.best);
    check(
      "sector splits rendered",
      Array.isArray(lapRun.midSectors) &&
        lapRun.midSectors[0] !== "--:--.---" &&
        lapRun.activeRow === 1,
      { mid: lapRun.midSectors, active: lapRun.activeRow },
    );

    // Toggle ghost off/on through the real button.
    await evaluate(
      `(() => { const b = document.querySelector('.dhud__toggle'); b.click(); return true; })()`,
    );
    check(
      "ghost toggle switches off",
      (await evaluate("window.__apexDrive.ghostEnabled")) === false,
    );
    await evaluate(
      `(() => { document.querySelector('.dhud__toggle').click(); return true; })()`,
    );
    check("ghost toggle switches on", (await evaluate("window.__apexDrive.ghostEnabled")) === true);

    // Setup sliders feed the physics.
    const setupBefore = await evaluate("({ ...window.__apexDrive.setup })");
    await evaluate(`(() => {
      const ranges = document.querySelectorAll('.dhud__slider input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(ranges[0], '0.1');
      ranges[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(ranges[1], '0.95');
      ranges[1].dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.dhud__seg button')].find(b => b.textContent.trim() === 'S')?.click();
      return true;
    })()`);
    await sleep(250);
    const setupAfter = await evaluate("({ ...window.__apexDrive.setup })");
    check(
      "setup sliders + tires drive the car",
      setupAfter.downforce < 0.2 && setupAfter.power > 0.9 && setupAfter.tires === "soft",
      { setupBefore, setupAfter },
    );

    // Vehicle switch to bike.
    await evaluate(
      `(() => { [...document.querySelectorAll('.dhud__seg button')].find(b => b.textContent.trim() === 'BIKE').click(); return true; })()`,
    );
    await sleep(600);
    const bikeState = await evaluate(
      "window.__apexDrive ? { vehicle: window.__apexDrive.vehicle, heading: window.__apexDrive.heading, speed: window.__apexDrive.speed } : null",
    );
    check("bike switch works", bikeState && bikeState.vehicle === "bike" && bikeState.speed === 0, bikeState);
    await sleep(3400);
    await shot("04-bike-desktop");

    // Restart + recover buttons.
    await evaluate(
      `(() => { [...document.querySelectorAll('.dhud__btn')].find(b => b.textContent.includes('RESTART')).click(); return true; })()`,
    );
    await sleep(200);
    check(
      "restart resets to countdown",
      await evaluate("window.__apexDrive.phase === 'countdown' && window.__apexDrive.lapCount === 0"),
    );
    await evaluate(
      `(() => { [...document.querySelectorAll('.dhud__btn')].find(b => b.textContent.includes('RECOVER')).click(); return true; })()`,
    );
    await sleep(200);
    check(
      "recover returns to the centerline",
      await evaluate(
        "window.__apexDrive.speed === 0 && window.__apexDrive.track.distanceFromCenter(window.__apexDrive.pos.x, window.__apexDrive.pos.z) < 0.6",
      ),
    );

    // Exit back to the showroom.
    await evaluate(
      `(() => { [...document.querySelectorAll('.dhud__btn')].find(b => b.textContent.includes('EXIT')).click(); return true; })()`,
    );
    await sleep(900);
    const exited = await evaluate(`(() => ({
      hud: !!document.querySelector('.drive-hud'),
      driving: document.body.classList.contains('driving'),
      brandVisible: getComputedStyle(document.querySelector('.brand')).visibility,
      heroVisible: document.querySelector('.hero__title') ? getComputedStyle(document.querySelector('.hero__title')).visibility : 'n/a',
      driveSession: !!window.__apexDrive,
    }))()`);
    check(
      "exit restores showroom",
      !exited.hud && !exited.driving && exited.brandVisible !== "hidden",
      exited,
    );
    await shot("05-exited-showroom");

    // Mobile layout.
    await setViewport(390, 844, true);
    await sleep(500);
    await clickText("TIME ATTACK");
    await sleep(400);
    const mobile = await evaluate(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom), display: getComputedStyle(el).display }; };
      return {
        vw: innerWidth, vh: innerHeight,
        timing: r('.dhud__timing'), speed: r('.dhud__speed'), setup: r('.dhud__setup'),
        controls: r('.dhud__controls'), touch: r('.dhud__touch'), board: r('.dhud__board'),
        touchButtons: [...document.querySelectorAll('.dhud__touch button')].map(el => r('.dhud__touch button')),
        gasVisible: !!document.querySelector('.is-throttle') && getComputedStyle(document.querySelector('.dhud__touch')).display !== 'none',
      };
    })()`);
    check("mobile touch controls visible", mobile.gasVisible === true, mobile.gasVisible);
    check("mobile board hidden", !mobile.board || mobile.board.display === "none", mobile.board);
    const mobIn = ["timing", "speed", "setup", "controls", "touch"].filter((k) => {
      const b = mobile[k];
      return !b || b.x < -1 || b.y < -1 || b.right > mobile.vw + 1 || b.bottom > mobile.vh + 1;
    });
    check("mobile panels inside viewport", mobIn.length === 0, mobIn);
    const mo = (a, b) =>
      a && b && a.display !== "none" && b.display !== "none" && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const mobileOverlap = [
      ["timing", "speed"],
      ["setup", "controls"],
      ["timing", "setup"],
      ["speed", "controls"],
    ].filter(([a, b]) => mo(mobile[a], mobile[b]));
    check("mobile panels do not overlap", mobileOverlap.length === 0, mobileOverlap);
    await waitFor("window.__apexDrive && window.__apexDrive.phase === 'racing'", 12000);
    await sleep(1500);
    await shot("06-drive-mobile");

    // Touch throttle: pointer events on the GAS button.
    const touchRun = await evaluate(`(async () => {
      const btn = document.querySelector('.is-throttle');
      const rect = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, isPrimary: true };
      btn.dispatchEvent(new PointerEvent('pointerdown', opts));
      await new Promise(r => setTimeout(r, 2200));
      const speedDown = Math.abs(window.__apexDrive.speed);
      const steer = document.querySelector('.dhud__touch-steer button');
      const sr = steer.getBoundingClientRect();
      steer.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
      await new Promise(r => setTimeout(r, 900));
      const steerValue = window.__apexDrive.steer;
      steer.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: sr.x + sr.width / 2, clientY: sr.y + sr.height / 2 }));
      btn.dispatchEvent(new PointerEvent('pointerup', opts));
      return { speedDown, steerValue, touch: { ...window.__apexDrive.touch } };
    })()`);
    check("mobile gas drives the car", touchRun.speedDown > 2, touchRun);
    check("mobile steer input works", Math.abs(touchRun.steerValue) > 0.05, touchRun.steerValue);

    // Mobile countdown/shots after reset.
    await evaluate(
      `(() => { [...document.querySelectorAll('.dhud__btn')].find(b => b.textContent.includes('RESTART')).click(); return true; })()`,
    );
    await sleep(400);
    await shot("07-mobile-countdown");
    await sleep(3200);
    await shot("08-mobile-racing");

    // Tablet viewport quick check.
    await setViewport(820, 1180, true);
    await sleep(600);
    const tablet = await evaluate(`(() => {
      const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
      return { vw: innerWidth, vh: innerHeight, timing: r('.dhud__timing'), speed: r('.dhud__speed'), setup: r('.dhud__setup'), controls: r('.dhud__controls'), touch: r('.dhud__touch') };
    })()`);
    const tabBad = ["timing", "speed", "setup", "controls", "touch"].filter((k) => {
      const b = tablet[k];
      return b && (b.x < -1 || b.y < -1 || b.right > tablet.vw + 1 || b.bottom > tablet.vh + 1);
    });
    check("tablet panels inside viewport", tabBad.length === 0, tabBad);
    const mt = (a, b) =>
      a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    check(
      "tablet setup/controls clear",
      !mt(tablet.setup, tablet.controls) && !mt(tablet.timing, tablet.speed),
      tablet,
    );
    await shot("09-drive-tablet");

    check("no runtime errors", consoleLines.length === 0, consoleLines.slice(0, 8));
  } catch (err) {
    errors.push(String(err));
    console.log("HARNESS ERROR", err);
    try {
      await shot("99-failure");
    } catch {
      /* ignore */
    }
  } finally {
    try {
      await send("Browser.close");
    } catch {
      /* ignore */
    }
    killChrome();
    ws.close();
    const summary = {
      results,
      errors,
      console: consoleLines,
      shots: fs.readdirSync(OUT).sort(),
    };
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(summary, null, 2));
    console.log("\nSUMMARY", JSON.stringify({ failures: errors }), "\n");
    process.exit(errors.length ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
