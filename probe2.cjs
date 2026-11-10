/* Probe 2: Page-level download behavior + origin without trailing slash. */
const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");
const OUT = "C:/Users/Rithvik/AppData/Local/Temp/apex-probe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1280,720"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const pc = await page.createCDPSession();
  await pc.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: OUT });
  await browser.defaultBrowserContext().overridePermissions("http://127.0.0.1:5173", ["clipboard-read", "clipboard-write"]);
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(1500);

  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(["probe2"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "probe2-raw.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  await sleep(2000);
  console.log("download:", fs.existsSync(path.join(OUT, "probe2-raw.txt")) ? "FILE LANDED" : "NO FILE");

  const clip = await page.evaluate(async () => {
    try {
      await navigator.clipboard.writeText("APX1.probe2");
      return { ok: true, back: await navigator.clipboard.readText() };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });
  console.log("clipboard:", JSON.stringify(clip));
  await browser.close();
})().catch((e) => { console.error("PROBE2 ERROR:", e); process.exit(2); });