/* Scratch runtime verification for the 10 new APEX features. */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const OUT = "C:/Users/Rithvik/AppData/Local/Temp/apex-verify";
fs.mkdirSync(OUT, { recursive: true });
const URL = "http://127.0.0.1:5173/";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({
    path: path.join(OUT, `${name}.jpg`),
    type: "jpeg",
    quality: 72,
    optimizeForSpeed: true,
    captureBeyondViewport: false,
  });
}

async function setRange(page, labelText, value) {
  return page.evaluate(
    (label, val) => {
      const labels = [...document.querySelectorAll(".aero-ctl, .aero-dock label")];
      const target = labels.find((l) => l.textContent.includes(label));
      const el = target && target.querySelector('input[type="range"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(el, String(val));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    labelText,
    value,
  );
}

async function clickText(page, selector, text) {
  return page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) =>
        e.textContent.trim().includes(t),
      );
      if (!el) return false;
      el.click();
      return true;
    },
    selector,
    text,
  );
}

async function setInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, selector, value);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1280,720",
    ],
  });
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: OUT,
    eventsEnabled: true,
  });
  const ctx = browser.defaultBrowserContext();
  await ctx.overridePermissions(URL, ["clipboard-read", "clipboard-write"]);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (/ERR_CONNECTION_REFUSED|11434|4317|\/api\/|ollama|Failed to load resource/i.test(t)) return;
      errors.push(`console: ${t}`);
    }
  });

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".site.is-ready", { timeout: 60000 });
  await sleep(3500);
  ok("boot + preloader", true);

  const webgl = await page.evaluate(() => {
    const c = document.querySelector("canvas.webgl");
    return !!c && c.width > 0;
  });
  ok("webgl canvas live", webgl);

  /* ---- open dock ---- */
  await page.click(".aero-launch");
  await page.waitForSelector(".aero-dock", { timeout: 10000 });
  await sleep(800);
  const tabs = await page.$$eval(".aero-dock__tabs button", (b) =>
    b.map((x) => x.textContent.trim()),
  );
  ok("dock tabs", tabs.join(",") === "FLOW,STYLE,DYNO,GARAGE,REPLAY", tabs.join(","));
  await shot(page, "01-dock-flow");

  /* ---- #2 rain + night ---- */
  await clickText(page, ".aero-seg button", "RAIN");
  await clickText(page, ".aero-toggle", "NIGHT RACE");
  await sleep(2200);
  const rainOn = await page.evaluate(() => {
    const seg = [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent.trim() === "RAIN");
    const night = [...document.querySelectorAll(".aero-toggle")].find((b) => b.textContent.includes("NIGHT RACE"));
    return seg?.classList.contains("is-on") && night?.classList.contains("is-on");
  });
  ok("rain + night toggles", !!rainOn);
  await shot(page, "02-rain-night");

  /* ---- #5 exploded view + #6 painter ---- */
  await clickText(page, ".aero-dock__tabs button", "STYLE");
  await sleep(400);
  await clickText(page, ".aero-toggle", "CUSTOM PAINT");
  await sleep(300);
  const painted = await page.evaluate(() => {
    const el = document.querySelector(".aero-paint__color input");
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "#e01818");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  });
  ok("painter color input", painted);
  const exploded = await setRange(page, "EXPLODED VIEW", 85);
  await sleep(1800);
  const labelCount = await page.evaluate(
    () => [...document.querySelectorAll(".assembly-label")].filter((e) => getComputedStyle(e).opacity !== "0").length,
  );
  ok("exploded view + labels", exploded && labelCount >= 4, `${labelCount} labels visible`);
  await shot(page, "03-exploded-paint");
  await setRange(page, "EXPLODED VIEW", 0);
  await sleep(900);

  /* ---- #4 dyno ---- */
  await clickText(page, ".aero-dock__tabs button", "DYNO");
  await sleep(400);
  await clickText(page, ".aero-toggle", "RUN DYNO");
  await setRange(page, "THROTTLE / RPM", 90);
  await sleep(1500);
  const dynoText = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".aero-telemetry b")];
    return cells.map((c) => c.textContent).join(" | ");
  });
  ok("dyno telemetry", /10,?900/.test(dynoText) && /HP/.test(dynoText), dynoText);
  const chartPainted = await page.evaluate(() => {
    const c = document.querySelector(".aero-dyno canvas");
    if (!c) return false;
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonzero = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonzero++;
    return nonzero > 500;
  });
  ok("dyno chart drawn", chartPainted);
  await shot(page, "04-dyno");
  await page.click(".aero-dock__actions--single .aero-dock__export");
  await sleep(1200);
  ok("dyno sheet export", fs.existsSync(path.join(OUT, "apex-dyno-sheet.csv")));

  /* ---- #7 garage + share codes ---- */
  await clickText(page, ".aero-dock__tabs button", "GARAGE");
  await sleep(400);
  await setInput(page, '.aero-row input[placeholder="BUILD NAME"]', "WET SPEC");
  await clickText(page, ".aero-btn", "SAVE");
  await sleep(400);
  const saved = await page.evaluate(() =>
    [...document.querySelectorAll(".aero-list__load b")].some((b) => b.textContent === "WET SPEC"),
  );
  ok("garage save", saved);
  await clickText(page, ".aero-btn", "COPY CODE");
  await sleep(500);
  const code = await page.evaluate(() => navigator.clipboard.readText());
  ok("share code copied", typeof code === "string" && code.startsWith("APX1."), String(code).slice(0, 18));
  await setInput(page, ".aero-input--area", code);
  await clickText(page, ".aero-btn--acid", "LOAD CODE");
  await sleep(500);
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll(".aero-dock__flash")].some((f) => f.textContent.includes("SETUP LOADED")),
  );
  ok("share code import roundtrip", loaded);
  await shot(page, "05-garage");

  /* ---- #3 ghost lap + #9 clip ---- */
  await clickText(page, ".aero-dock__tabs button", "REPLAY");
  await sleep(400);
  await clickText(page, ".aero-btn", "RECORD LAP");
  await sleep(2000);
  await page.evaluate(() => window.scrollBy(0, 300));
  await sleep(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);
  await clickText(page, ".aero-btn--acid", "STOP & SAVE LAP");
  await sleep(600);
  const lapSaved = await page.evaluate(
    () => document.querySelectorAll(".aero-list__load").length >= 1,
  );
  ok("ghost lap record + save", lapSaved);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".aero-list__load")].find((b) => b.textContent.includes("LAP"));
    if (btn) btn.click();
  });
  await sleep(1200);
  const replayUI = await page.evaluate(() => !!document.querySelector(".aero-scrub"));
  ok("ghost lap replay + scrubber", replayUI);
  await shot(page, "06-replay");
  await clickText(page, ".aero-btn", "PAUSE");
  await sleep(300);
  await clickText(page, ".aero-btn", "EXIT");
  await sleep(400);

  await clickText(page, ".aero-btn", "RECORD VIEWPORT");
  await sleep(2500);
  await clickText(page, ".aero-btn--acid", "STOP & SAVE WEBM");
  await sleep(2500);
  const webm = path.join(OUT, "apex-cinematic.webm");
  const webmSize = fs.existsSync(webm) ? fs.statSync(webm).size : 0;
  ok("cinematic webm export", webmSize > 10000, `${(webmSize / 1024).toFixed(0)} KB`);

  /* ---- png export ---- */
  await page.click(".aero-dock__actions .aero-dock__export");
  await sleep(1200);
  ok("png export", fs.existsSync(path.join(OUT, "apex-wind-tunnel.png")));

  /* ---- #1 race engineer via chat ---- */
  await page.click(".aero-dock__close");
  await sleep(500);
  await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
  await sleep(900);
  await page.type("#terminal-widget .term__input input", "more downforce for the wet");
  await page.click("#terminal-widget .term__input button[type=submit]");
  await sleep(1500);
  const engineer = await page.evaluate(() => {
    const tag = [...document.querySelectorAll(".term__tag--engineer")];
    const entry = tag[tag.length - 1]?.closest(".term__entry")?.textContent ?? "";
    return { count: tag.length, entry: entry.slice(0, 220) };
  });
  ok("race engineer reply", engineer.count >= 1 && engineer.entry.includes("COPY THAT"), engineer.entry.slice(0, 100));
  const tunedDock = await page.evaluate(() => {
    const dock = document.querySelector(".aero-dock");
    const rain = [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent.trim() === "RAIN");
    return !!dock && rain?.classList.contains("is-on");
  });
  ok("engineer tuned scene live", !!tunedDock);
  await shot(page, "07-engineer");

  /* ---- #32 vox ---- */
  const vox = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".term__webbtn")].find((b) => b.textContent.includes("VOX"));
    if (!btn) return "absent";
    btn.click();
    return btn.textContent.trim();
  });
  ok("vox radio toggle", vox === "VOX ON", vox);

  /* ---- #33 playbooks ---- */
  await setInput(page, "#terminal-widget .term__input input", "/control open notepad and type hello");
  await page.click("#terminal-widget .term__input button[type=submit]");
  await sleep(800);
  await page.evaluate(() => {
    const btn = document.querySelector(".term__handoff");
    if (btn) btn.click();
  });
  await page.waitForSelector(".takeover", { timeout: 10000 });
  await sleep(800);
  const pbBlock = await page.evaluate(() =>
    [...document.querySelectorAll(".ctl-block__head span")].some((s) => s.textContent === "PLAYBOOKS"),
  );
  ok("playbooks panel", pbBlock);
  await setInput(page, ".ctl-playbook-name", "NOTEPAD TEST");
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".ctl-playbook-save .ctl-link")].find((b) => b.textContent === "SAVE");
    if (btn) btn.click();
  });
  await sleep(500);
  const pbSaved = await page.evaluate(() =>
    [...document.querySelectorAll(".ctl-playbook b")].some((b) => b.textContent === "NOTEPAD TEST"),
  );
  ok("playbook save", pbSaved);
  await page.evaluate(() => {
    const btn = document.querySelector(".ctl-playbook");
    if (btn) btn.click();
  });
  await sleep(400);
  const pbLoaded = await page.evaluate(() => {
    const notice = document.querySelector(".ctl-notice")?.textContent ?? "";
    const goal = document.querySelector(".ctl-goal")?.value ?? "";
    return notice.includes("LOADED") && goal.includes("notepad");
  });
  ok("playbook load restores mission", pbLoaded);
  await shot(page, "08-playbooks");
  await page.keyboard.press("Escape");
  await sleep(600);

  /* ---- mobile ---- */
  const mob = await browser.newPage();
  const mobErrors = [];
  mob.on("pageerror", (e) => mobErrors.push(e.message));
  await mob.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await mob.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await mob.waitForSelector(".site.is-ready", { timeout: 60000 });
  await sleep(3000);
  await mob.click(".aero-launch");
  await mob.waitForSelector(".aero-dock", { timeout: 10000 });
  await sleep(800);
  const mobBox = await mob.evaluate(() => {
    const d = document.querySelector(".aero-dock");
    const r = d.getBoundingClientRect();
    return {
      inside: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.top >= 0,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom },
    };
  });
  ok("mobile dock fits viewport", mobBox.inside && !mobBox.overflow, JSON.stringify(mobBox.rect));
  await shot(mob, "09-mobile-flow");
  await clickText(mob, ".aero-dock__tabs button", "DYNO");
  await sleep(500);
  await shot(mob, "10-mobile-dyno");
  const mobTab = await mob.evaluate(() => !!document.querySelector(".aero-dyno canvas"));
  ok("mobile tab switch", mobTab);
  ok("mobile no page errors", mobErrors.length === 0, mobErrors.join("; "));

  ok("desktop no page errors", errors.length === 0, errors.slice(0, 6).join(" | "));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("SCRIPT ERROR:", e);
  process.exit(2);
});