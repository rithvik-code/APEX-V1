/* Focused probe: isolate the 5 verification failures (harness vs app). */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const OUT = "C:/Users/Rithvik/AppData/Local/Temp/apex-probe";
fs.mkdirSync(OUT, { recursive: true });
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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
      "--window-size=1280,720",
    ],
  });
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: OUT,
    eventsEnabled: true,
  });
  cdp.on("Browser.downloadWillBegin", (e) => log("DOWNLOAD BEGIN:", e.suggestedFilename));
  cdp.on("Browser.downloadProgress", (e) => {
    if (e.state !== "inProgress") log("DOWNLOAD STATE:", e.state, e.receivedBytes);
  });
  await browser.defaultBrowserContext().overridePermissions(URL, ["clipboard-read", "clipboard-write"]);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on("pageerror", (e) => { errors.push(e.message); log("PAGEERROR:", e.message); });
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".site.is-ready", { timeout: 60000 });
  await sleep(2500);

  /* A: raw blob download, exactly like downloadBlob */
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(["probe"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "probe-raw.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  await sleep(2000);
  log("A raw blob download:", fs.existsSync(path.join(OUT, "probe-raw.txt")) ? "FILE LANDED" : "NO FILE");

  /* B: clipboard */
  const clip = await page.evaluate(async () => {
    try {
      await navigator.clipboard.writeText("APX1.probe");
      const back = await navigator.clipboard.readText();
      return { ok: true, back, focus: document.hasFocus() };
    } catch (e) {
      return { ok: false, err: String(e), focus: document.hasFocus() };
    }
  });
  log("B clipboard:", JSON.stringify(clip));

  /* C: dyno export via DOM click */
  await page.click(".aero-launch");
  await page.waitForSelector(".aero-dock", { timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll(".aero-dock__tabs button")].find((b) => b.textContent.trim() === "DYNO")?.click();
  });
  await sleep(600);
  const dynoBtn = await page.evaluate(() => {
    const btn = document.querySelector(".aero-dock__actions--single .aero-dock__export");
    if (!btn) return "ABSENT";
    btn.click();
    return btn.textContent.trim();
  });
  log("C dyno export button:", dynoBtn);
  await sleep(2000);
  log("C dyno csv:", fs.existsSync(path.join(OUT, "apex-dyno-sheet.csv")) ? "FILE LANDED" : "NO FILE");

  /* D: VOX toggle with real click + settle time */
  await page.evaluate(() => document.getElementById("pitwall")?.scrollIntoView());
  await sleep(800);
  const voxBefore = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".term__webbtn")].find((b) => b.textContent.includes("VOX"));
    return btn ? btn.textContent.trim() : "ABSENT";
  });
  await page.evaluate(() => {
    [...document.querySelectorAll(".term__webbtn")].find((b) => b.textContent.includes("VOX"))?.click();
  });
  await sleep(600);
  const voxAfter = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".term__webbtn")].find((b) => b.textContent.includes("VOX"));
    return btn ? btn.textContent.trim() : "ABSENT";
  });
  log("D vox:", voxBefore, "->", voxAfter);

  /* E: /control handoff */
  await page.evaluate(() => {
    const input = document.querySelector("#terminal-widget .term__input input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "/control open notepad and type hello");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(200);
  const submitInfo = await page.evaluate(() => {
    const btn = document.querySelector("#terminal-widget .term__input button[type=submit]");
    if (!btn) return "ABSENT";
    const disabled = btn.disabled;
    btn.click();
    return `clicked, disabled=${disabled}`;
  });
  log("E submit:", submitInfo);
  await sleep(1500);
  const takeover = await page.evaluate(() => ({
    present: !!document.querySelector(".takeover"),
    lastEntries: [...document.querySelectorAll(".term__entry p, .term__meta")].slice(-3).map((e) => e.textContent.slice(0, 90)),
    inputValue: document.querySelector("#terminal-widget .term__input input")?.value,
  }));
  log("E takeover:", JSON.stringify(takeover, null, 1));
  if (takeover.present) {
    await page.keyboard.press("Escape");
    await sleep(500);
  }

  /* F: clip record -> stop, watch download events */
  await page.evaluate(() => {
    [...document.querySelectorAll(".aero-dock__tabs button")].find((b) => b.textContent.trim() === "REPLAY")?.click();
  });
  await sleep(500);
  const recStart = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".aero-btn")].find((b) => b.textContent.includes("RECORD VIEWPORT"));
    if (!btn) return "ABSENT";
    btn.click();
    return "clicked";
  });
  log("F record:", recStart);
  await sleep(2500);
  const recState = await page.evaluate(() => {
    const stop = [...document.querySelectorAll(".aero-btn")].find((b) => b.textContent.includes("STOP & SAVE WEBM"));
    return stop ? "clipping" : "not clipping";
  });
  log("F state:", recState);
  await page.evaluate(() => {
    [...document.querySelectorAll(".aero-btn")].find((b) => b.textContent.includes("STOP & SAVE WEBM"))?.click();
  });
  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    if (fs.existsSync(path.join(OUT, "apex-cinematic.webm"))) break;
  }
  const webm = path.join(OUT, "apex-cinematic.webm");
  log("F webm:", fs.existsSync(webm) ? `${fs.statSync(webm).size} bytes` : "NO FILE after 60s");

  log("ERRORS:", errors.length ? errors.join(" | ") : "none");
  await browser.close();
})().catch((e) => { console.error("PROBE ERROR:", e); process.exit(2); });