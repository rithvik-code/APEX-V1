/* Beauty shots of the redesigned H2R bike. */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const OUT = "C:/Users/Rithvik/AppData/Local/Temp/apex-verify";
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      "--window-size=1280,720",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".site.is-ready", { timeout: 60000 });
  await sleep(2500);
  await page.click(".aero-launch");
  await page.waitForSelector(".aero-dock", { timeout: 10000 });
  await sleep(500);
  await page.evaluate(() => {
    [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent.trim() === "BIKE")?.click();
  });
  await sleep(2500);
  await page.evaluate(() => document.querySelector(".aero-dock__close")?.click());
  await sleep(800);
  await page.evaluate(() => document.getElementById("machine")?.scrollIntoView({ behavior: "instant", block: "start" }));
  await sleep(3000);
  await page.screenshot({ path: path.join(OUT, "11-bike-hero.jpg"), type: "jpeg", quality: 80, optimizeForSpeed: true });
  console.log("bike hero shot saved");
  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, "12-bike-alt.jpg"), type: "jpeg", quality: 80, optimizeForSpeed: true });
  console.log("bike alt shot saved");
  await browser.close();
})().catch((e) => { console.error("SHOT ERROR:", e); process.exit(2); });