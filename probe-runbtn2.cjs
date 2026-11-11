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
    const logs = [];
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
    await new Promise((r) => setTimeout(r, 900));
    await page.evaluate(() => {
      window.__ev = [];
      const form = document.querySelector("#terminal-widget .term__input");
      const btn = form.querySelector("button[type=submit]");
      btn.addEventListener("click", () => window.__ev.push("button-click"));
      form.addEventListener("submit", (e) => { window.__ev.push("submit prevented=" + e.defaultPrevented); });
      window.addEventListener("click", (e) => window.__ev.push("doc-click " + e.target.tagName + "." + e.target.className), true);
      window.__form = form;
      window.__btn = btn;
    });
    await page.type("#terminal-widget .term__input input", "/help");
    await new Promise((r) => setTimeout(r, 300));
    console.log("disabled before:", await page.evaluate(() => window.__btn.disabled));
    // programmatic click first
    await page.evaluate(() => window.__btn.click());
    await new Promise((r) => setTimeout(r, 1200));
    const afterProg = await page.evaluate(() => ({
      ev: window.__ev.slice(),
      entries: [...document.querySelectorAll(".term__entry")].slice(-2).map((e) => e.textContent.slice(0, 80)),
      value: document.querySelector("#terminal-widget .term__input input").value,
    }));
    console.log("PROG", JSON.stringify(afterProg, null, 1));
    await browser.close();
  } catch (e) { console.log("ERR", e.message); }
})();
