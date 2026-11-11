const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
    await new Promise((r) => setTimeout(r, 900));
    const info = await page.evaluate(() => {
      const btn = document.querySelector("#terminal-widget .term__input button[type=submit]");
      const r = btn.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const at = document.elementFromPoint(cx, cy);
      const chain = [];
      let n = at;
      while (n && chain.length < 6) { chain.push(`${n.tagName}.${String(n.className).slice(0, 40)}`); n = n.parentElement; }
      const cs = getComputedStyle(btn);
      return {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        at: `${at?.tagName}.${String(at?.className).slice(0, 50)}`,
        chain,
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        viewport: { w: innerWidth, h: innerHeight },
      };
    });
    console.log(JSON.stringify(info, null, 1));
  } finally { await browser.close(); }
})();
