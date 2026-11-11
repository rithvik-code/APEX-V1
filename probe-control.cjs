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
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
    await new Promise((r) => setTimeout(r, 900));
    const before = await page.evaluate(() => ({
      inputs: document.querySelectorAll("#terminal-widget .term__input input").length,
      term: !!document.querySelector("#terminal-widget"),
    }));
    await page.type("#terminal-widget .term__input input", "/control open notepad and type hello");
    await new Promise((r) => setTimeout(r, 400));
    const val = await page.evaluate(() => {
      const input = document.querySelector("#terminal-widget .term__input input");
      const btn = document.querySelector("#terminal-widget .term__input button[type=submit]");
      return { value: input.value, disabled: btn.disabled, text: btn.textContent };
    });
    await page.focus("#terminal-widget .term__input input");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 6000));
    const after = await page.evaluate(() => ({
      takeover: !!document.querySelector(".takeover"),
      entries: [...document.querySelectorAll(".term__entry")].slice(-4).map((e) => e.textContent.slice(0, 140)),
      bodyClass: document.body.className,
      ctl: !!document.querySelector(".ctl"),
    }));
    console.log("BEFORE", JSON.stringify(before));
    console.log("VAL", JSON.stringify(val));
    console.log("AFTER", JSON.stringify(after, null, 1));
    const errs = logs.filter((l) => /error|warn/i.test(l));
    console.log("LOGS", JSON.stringify(errs.slice(0, 8), null, 1));
  } finally { await browser.close(); }
})();
