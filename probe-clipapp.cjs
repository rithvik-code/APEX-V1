const puppeteer = require("puppeteer-core");
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
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.evaluateOnNewDocument(() => {
      window.__downloads = [];
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download) window.__downloads.push({ name: this.download, href: this.href, read: false });
        return origClick.call(this);
      };
      window.__recs = [];
      const Orig = window.MediaRecorder;
      window.MediaRecorder = class extends Orig {
        constructor(stream, opts) {
          super(stream, opts);
          this.__sizes = [];
          this.addEventListener("dataavailable", (e) => this.__sizes.push(e.data.size));
          this.__opts = opts;
          window.__recs.push(this);
        }
      };
    });
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 4000));
    const recsAfterBoot = await page.evaluate(() => window.__recs.map((r) => ({ state: r.state, sizes: r.__sizes.length })));
    await page.click(".aero-launch");
    await page.waitForSelector(".aero-dock", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 800));
    const tab = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".aero-dock__tabs button")].find((x) => x.textContent.trim() === "REPLAY");
      b.click(); return !!b;
    });
    await new Promise((r) => setTimeout(r, 600));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".aero-btn")].find((x) => x.textContent.includes("RECORD VIEWPORT"));
      b.click();
    });
    await new Promise((r) => setTimeout(r, 5000));
    const during = await page.evaluate(() => window.__recs.map((r) => ({ state: r.state, sizes: r.__sizes.slice()})));
    await page.evaluate(() => {
      const b = [...document.querySelectorAll(".aero-btn")].find((x) => x.textContent.includes("STOP & SAVE WEBM"));
      b.click();
    });
    await new Promise((r) => setTimeout(r, 4000));
    const after = await page.evaluate(() => ({
      recs: window.__recs.map((r) => ({ state: r.state, sizes: r.__sizes.slice() })),
      downloads: (window.__downloads || []).map((d) => d.name),
      hrefs: (window.__downloads || []).map((d) => d.href.slice(0, 40)),
    }));
    console.log("BOOT", JSON.stringify(recsAfterBoot));
    console.log("DURING", JSON.stringify(during));
    console.log("AFTER", JSON.stringify(after));
    console.log("LOGS", JSON.stringify(logs.filter((l) => !/vite|DevTools/.test(l)).slice(0, 6)));
  } finally { await browser.close(); }
})();
