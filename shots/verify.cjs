const puppeteer = require("puppeteer-core");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--window-size=1600,900",
      "--hide-scrollbars",
    ],
    defaultViewport: { width: 1600, height: 900 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push("PAGE: " + e.message));

  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector(".site.is-ready", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: "shots/01-hero.png" });

  // Open the wind tunnel.
  await page.click(".aero-launch");
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: "shots/02-aero-velocity.png" });

  const state = await page.evaluate(() => ({
    dock: !!document.querySelector(".aero-dock"),
    telemetry: document.querySelector(".aero-telemetry")?.textContent,
    sliders: document.querySelectorAll(".aero-dock input[type=range]").length,
  }));
  console.log("AERO STATE", JSON.stringify(state));

  // Pressure mode + neon lighting + magenta livery + TOP camera.
  await page.evaluate(() => {
    const click = (t) => [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent === t)?.click();
    click("PRESSURE");
    click("NEON");
    click("TOP");
    document.querySelectorAll(".aero-swatches button")[3].click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: "shots/03-pressure-neon-top.png" });

  // Side camera, ember livery, midnight.
  await page.evaluate(() => {
    const click = (t) => [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent === t)?.click();
    click("VELOCITY");
    click("MIDNIGHT");
    click("SIDE");
    document.querySelectorAll(".aero-swatches button")[4].click();
  });
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: "shots/04-side-midnight.png" });

  // Bike focus (scrolls to machine).
  await page.evaluate(() => {
    [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent === "BIKE")?.click();
    [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent === "STUDIO")?.click();
    [...document.querySelectorAll(".aero-seg button")].find((b) => b.textContent === "HERO")?.click();
  });
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: "shots/05-bike-flow.png" });
  const reveal = await page.evaluate(() => {
    const el = document.querySelector(".machine__copy");
    const cs = el && getComputedStyle(el);
    return { cls: el?.className, filter: cs?.filter, opacity: cs?.opacity };
  });
  console.log("MACHINE REVEAL", JSON.stringify(reveal));

  // Export PNG produces a downloadable data URL.
  const exportOk = await page.evaluate(() => {
    let captured = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { captured = this.href?.slice(0, 30); };
    [...document.querySelectorAll(".aero-dock__actions button")].find((b) => b.textContent.includes("EXPORT"))?.click();
    HTMLAnchorElement.prototype.click = orig;
    return captured;
  });
  console.log("EXPORT", exportOk);

  // Close, then check the terminal still works and typography.
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 800));
  const closed = await page.evaluate(() => !document.querySelector(".aero-dock"));
  console.log("CLOSED", closed);

  await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
  await new Promise((r) => setTimeout(r, 1800));
  await page.screenshot({ path: "shots/06-pitwall.png" });

  const fonts = await page.evaluate(() => {
    const tiny = [];
    document.querySelectorAll("body *").forEach((el) => {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 9 && el.textContent.trim() && el.children.length === 0 && el.offsetParent) {
        tiny.push(el.className + ":" + fs);
      }
    });
    return tiny.slice(0, 12);
  });
  console.log("TINY VISIBLE TEXT", JSON.stringify(fonts));

  // Mobile viewport.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 2000));
  await page.screenshot({ path: "shots/07-mobile-hero.png" });
  await page.click(".aero-launch");
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: "shots/08-mobile-aero.png" });
  const mobile = await page.evaluate(() => {
    const dock = document.querySelector(".aero-dock");
    const r = dock?.getBoundingClientRect();
    return { dock: !!dock, rect: r && { x: r.x, y: r.y, w: r.width, h: r.height }, overflowX: document.documentElement.scrollWidth > innerWidth };
  });
  console.log("MOBILE", JSON.stringify(mobile));

  console.log("CONSOLE ERRORS", JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});