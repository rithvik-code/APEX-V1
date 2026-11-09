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

  await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".site.is-ready", { timeout: 45000 });
  await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
  await new Promise((r) => setTimeout(r, 1500));

  // 1) Natural-language control request in the chat (demo mode is fine — the
  //    intent fallback must still offer the handoff).
  const request = "control my laptop and edit another website for me";
  await page.click(".term__input input");
  await page.type(".term__input input", request);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".term__handoff", { timeout: 15000 });
  const handoff = await page.evaluate(() => {
    const btn = document.querySelector(".term__handoff");
    return { present: !!btn, label: btn?.textContent?.replace(/\s+/g, " ").trim() };
  });
  console.log("HANDOFF BUTTON", JSON.stringify(handoff));
  await page.screenshot({ path: "shots/09-chat-handoff.png" });

  // 2) Click it -> Takeover opens with the goal pre-filled.
  await page.click(".term__handoff");
  await page.waitForSelector(".takeover", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 800));
  const prefilled = await page.evaluate(() => ({
    open: !!document.querySelector(".takeover"),
    goal: document.querySelector(".ctl-goal")?.value,
  }));
  console.log("TAKEOVER PREFILL", JSON.stringify(prefilled));
  await page.screenshot({ path: "shots/10-takeover-goal.png" });

  // 3) Release, then the /control slash command.
  await page.click(".takeover__release");
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => document.getElementById("pitwall").scrollIntoView());
  await new Promise((r) => setTimeout(r, 600));
  await page.click(".term__input input");
  await page.type(".term__input input", "/control open notepad and type hello world");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".takeover", { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  const slash = await page.evaluate(() => ({
    open: !!document.querySelector(".takeover"),
    goal: document.querySelector(".ctl-goal")?.value,
  }));
  console.log("SLASH CONTROL", JSON.stringify(slash));

  console.log("CONSOLE ERRORS", JSON.stringify(errors));
  await browser.close();
})().catch((e) => {
  console.error("FAILED", e.message);
  process.exit(1);
});