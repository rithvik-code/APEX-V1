const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 3000));
    const info = await page.evaluate(() => {
      const el = document.querySelector(".aero-launch");
      if (!el) return { missing: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents,
        position: cs.position, zIndex: cs.zIndex,
        at: at ? `${at.tagName}.${String(at.className).slice(0, 50)}` : null,
        scrollY: window.scrollY, vh: innerHeight, vw: innerWidth, scrollW: document.documentElement.scrollWidth, dpr: devicePixelRatio, vv: { w: visualViewport.width, h: visualViewport.height, s: visualViewport.scale },
      };
    });
    console.log(JSON.stringify(info, null, 1));
  } finally { await browser.close(); }
})();
