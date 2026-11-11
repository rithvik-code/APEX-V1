const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function clickText(page, sel, text) {
  return page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.textContent.trim().includes(t));
    if (!el) return false;
    el.click();
    return true;
  }, sel, text);
}
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const logs = [];
    page.on("console", (m) => { if (m.type() === "error") logs.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => logs.push("pageerror " + e.message));
    await page.evaluateOnNewDocument(() => {
      window.__downloads = [];
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__downloads.push({ name: this.download, href: this.href, read: false });
        return origClick.call(this);
      };
    });
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await sleep(3500);
    await page.click(".aero-launch");
    await page.waitForSelector(".aero-dock", { timeout: 10000 });
    await sleep(600);
    // ghost lap record + replay
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
    const lapSaved = await page.evaluate(() => document.querySelectorAll(".aero-list__load").length);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll(".aero-list__load")].find((b) => b.textContent.includes("LAP"));
      if (btn) btn.click();
    });
    await sleep(1200);
    const playing = await page.evaluate(() => !!document.querySelector(".aero-scrub"));
    await clickText(page, ".aero-btn", "PAUSE");
    await sleep(300);
    const exited = await clickText(page, ".aero-btn", "EXIT");
    await sleep(400);
    const started = await clickText(page, ".aero-btn", "RECORD VIEWPORT");
    await sleep(2500);
    const clipState = await page.evaluate(() => {
      const head = [...document.querySelectorAll(".aero-ctl__head")].find((h) => h.textContent.includes("CINEMATIC CLIP"));
      const stop = [...document.querySelectorAll(".aero-btn")].some((b) => b.textContent.includes("STOP & SAVE WEBM"));
      return { head: head?.textContent, stop, recordBtn: [...document.querySelectorAll(".aero-btn")].some((b) => b.textContent.includes("RECORD VIEWPORT")) };
    });
    const stopped = await clickText(page, ".aero-btn--acid", "STOP & SAVE WEBM");
    await sleep(2500);
    const dl = await page.evaluate(async () => {
      const d = (window.__downloads || []).find((x) => x.name === "apex-cinematic.webm");
      if (!d) return { found: false };
      const blob = await (await fetch(d.href)).blob();
      return { found: true, size: blob.size };
    });
    console.log(JSON.stringify({ lapSaved, playing, exited, started, clipState, stopped, dl, logs }, null, 1));
  } finally { await browser.close(); }
})();
