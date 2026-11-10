/* Probe 3: appended anchor vs detached, trusted activation for clipboard. */
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

  /* 1: appended anchor */
  await page.evaluate(() => {
    const url = URL.createObjectURL(new Blob(["probe3-appended"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "probe3-appended.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
  await sleep(2000);
  console.log("1 appended anchor:", fs.existsSync(path.join(OUT, "probe3-appended.txt")) ? "FILE LANDED" : "NO FILE");

  /* 2: trusted click on a real button that downloads */
  await page.evaluate(() => {
    const btn = document.createElement("button");
    btn.id = "probe-dl";
    btn.textContent = "probe download";
    btn.style.cssText = "position:fixed;top:4px;left:4px;z-index:99999";
    btn.onclick = () => {
      const url = URL.createObjectURL(new Blob(["probe3-trusted"], { type: "text/plain" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "probe3-trusted.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    document.body.appendChild(btn);
  });
  await page.click("#probe-dl");
  await sleep(2000);
  console.log("2 trusted click detached:", fs.existsSync(path.join(OUT, "probe3-trusted.txt")) ? "FILE LANDED" : "NO FILE");

  /* 3: clipboard write inside a trusted click */
  await page.evaluate(() => {
    const btn = document.createElement("button");
    btn.id = "probe-clip";
    btn.textContent = "probe clipboard";
    btn.style.cssText = "position:fixed;top:40px;left:4px;z-index:99999";
    btn.onclick = async () => {
      try {
        await navigator.clipboard.writeText("APX1.probe3");
        window.__clipResult = "ok:" + (await navigator.clipboard.readText());
      } catch (e) {
        window.__clipResult = "err:" + String(e);
      }
    };
    document.body.appendChild(btn);
  });
  await page.click("#probe-clip");
  await sleep(800);
  console.log("3 clipboard trusted:", await page.evaluate(() => window.__clipResult));

  await browser.close();
})().catch((e) => { console.error("PROBE3 ERROR:", e); process.exit(2); });