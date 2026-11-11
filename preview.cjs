const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--window-size=1440,900"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await sleep(3200);
    await page.screenshot({ path: "C:/Users/Rithvik/AppData/Local/Temp/apex-preview/hero.png" });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /TIME ATTACK/i.test(x.textContent || ""));
      if (b) b.click();
    });
    await sleep(1500);
    await page.screenshot({ path: "C:/Users/Rithvik/AppData/Local/Temp/apex-preview/countdown.png" });
    await sleep(2600);
    await page.evaluate(async () => {
      const d = window.__apexDrive;
      if (!d) return;
      const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
      const start = performance.now();
      while (performance.now() - start < 14000) {
        const t = d.track.nearestT(d.pos.x, d.pos.z);
        const speed = Math.abs(d.speed);
        const aheadT = (t + 0.01 + speed * 0.00042) % 1;
        const target = d.track.centerAt(aheadT, d.tmp);
        const desired = Math.atan2(target.x - d.pos.x, target.z - d.pos.z);
        const err = wrap(desired - d.heading);
        d.touch.steer = Math.max(-1, Math.min(1, err * 2.4));
        const p1 = d.track.curve.getPoint(t);
        const p2 = d.track.curve.getPoint((t + 0.028) % 1);
        const turn = Math.abs(wrap(Math.atan2(p2.x - p1.x, p2.z - p1.z) - Math.atan2(target.x - d.pos.x, target.z - d.pos.z)));
        const targetSpeed = Math.max(9, 24 - turn * 34 - Math.abs(err) * 6);
        d.touch.throttle = speed < targetSpeed;
        d.touch.brake = speed > targetSpeed + 3.5;
        await new Promise((r) => setTimeout(r, 50));
      }
      d.touch.steer = 0; d.touch.throttle = false; d.touch.brake = false;
    });
    await page.screenshot({ path: "C:/Users/Rithvik/AppData/Local/Temp/apex-preview/lap.png" });
    console.log("done");
  } finally { await browser.close(); }
})();
