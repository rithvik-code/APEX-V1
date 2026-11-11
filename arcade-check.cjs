const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const OUT = "C:/Users/Rithvik/AppData/Local/Temp/apex-arcade";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? "PASS" : "FAIL", name, detail ? `— ${detail}` : "");
}

async function setInput(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function send(page, text) {
  await page.waitForFunction(
    () =>
      document
        .querySelector(".term__status-right")
        ?.textContent?.includes("READY"),
    { timeout: 60000 },
  );
  await setInput(page, "#terminal-widget .term__input input", text);
  await page.focus("#terminal-widget .term__input input");
  await page.keyboard.press("Enter");
}

async function shot(page, name) {
  await page.evaluate(() => document.getElementById("pitwall")?.scrollIntoView());
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function applyHarnessEnv(page) {
  // Keep the run deterministic: no Ollama detection, no web grounding, demo
  // provider, arcade on, fresh XP.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem("apex.web.v1", "0");
      localStorage.setItem("apex.arcade.mode.v1", "1");
      localStorage.removeItem("apex.arcade.stats.v1");
    } catch {
      /* ignore */
    }
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? "";
      if (url.includes(":11434")) {
        return Promise.reject(new Error("ollama disabled in harness"));
      }
      return realFetch(input, init);
    };
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1280,940",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 940 });
  await applyHarnessEnv(page);

  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
  await page.waitForSelector("#terminal-widget .term__input input", {
    timeout: 60000,
  });
  await sleep(1200);

  const toggle = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".term__bar button")].find((el) =>
      el.textContent?.toUpperCase().includes("ARCADE"),
    );
    return btn ? { text: btn.textContent.trim(), pressed: btn.getAttribute("aria-pressed") } : null;
  });
  check("arcade toggle present and on", toggle?.text === "ARCADE ON", toggle?.text);
  check("toggle aria-pressed", toggle?.pressed === "true", toggle?.pressed);
  await shot(page, "01-terminal");

  /* ------------------------------- quiz -------------------------------- */
  await send(page, "what is downforce?");
  await page.waitForSelector(".arcade--quiz", { timeout: 45000 });
  const quiz = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--quiz")].pop();
    return {
      kicker: card.querySelector(".arcade__kicker")?.textContent,
      question: card.querySelector(".arcade__question")?.textContent,
      options: [...card.querySelectorAll(".arcade__option")].map((b) =>
        b.textContent.trim(),
      ),
      source: card.querySelector(".arcade__chip")?.textContent,
    };
  });
  check("quiz card has 4 options", quiz.options.length === 4, `${quiz.options.length}`);
  check("quiz question populated", (quiz.question ?? "").length > 12, quiz.question);
  await shot(page, "02-quiz");

  await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--quiz")].pop();
    card.querySelector(".arcade__option").click();
  });
  await sleep(500);
  const answered = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--quiz")].pop();
    const result = card.querySelector(".arcade__result")?.textContent ?? "";
    const status = document.querySelector(".term__status")?.textContent ?? "";
    const xp = Number((status.match(/XP\s+(\d+)/) ?? [])[1] ?? 0);
    const marks = card.querySelectorAll(
      ".arcade__option--correct, .arcade__option--wrong",
    ).length;
    card.querySelector(".arcade__revealbtn")?.click();
    return { result, xp, marks };
  });
  check("answer reveal result shown", /XP/.test(answered.result), answered.result);
  check("options marked after pick", answered.marks >= 1, `${answered.marks} marks`);
  check("XP awarded", answered.xp >= 4, `xp=${answered.xp}`);
  await sleep(300);
  const revealed = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--quiz")].pop();
    return {
      open: Boolean(card.querySelector(".arcade__answer")),
      len: card.querySelector(".arcade__answer")?.textContent?.length ?? 0,
    };
  });
  check("full answer one click away", revealed.open && revealed.len > 40, `len=${revealed.len}`);
  await shot(page, "03-quiz-answered");

  /* ------------------------------- intel ------------------------------- */
  await send(page, "show me a picture of the circuit");
  await page.waitForSelector(".arcade--intel", { timeout: 45000 });
  const intel = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--intel")].pop();
    const canvas = card.querySelector("canvas");
    const text = card.querySelector(".arcade__intel-text")?.textContent ?? "";
    let data = "";
    try {
      data = canvas.toDataURL("image/png");
    } catch (err) {
      data = `err:${err}`;
    }
    return {
      w: canvas.width,
      h: canvas.height,
      bytes: data.length,
      textLen: text.length,
      hasDownload: Boolean(card.querySelector(".arcade__chip--btn")),
    };
  });
  check("intel canvas painted", intel.w === 1920 && intel.h === 1080, `${intel.w}x${intel.h}`);
  check("intel poster has pixels", intel.bytes > 20000, `${intel.bytes} b64 chars`);
  check("intel keeps full text", intel.textLen > 80, `len=${intel.textLen}`);
  check("intel download control", intel.hasDownload);
  await shot(page, "04-intel");

  /* ------------------------------ mission ------------------------------ */
  await send(page, "open notepad and type hello");
  await page.waitForSelector(".arcade--mission", { timeout: 45000 });
  const mission = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".arcade--mission")].pop();
    return {
      kicker: card.querySelector(".arcade__kicker")?.textContent,
      goal: card.querySelector(".arcade__goal")?.textContent,
      risk: card.querySelector(".arcade__chip")?.textContent,
      caps: [...card.querySelectorAll(".arcade__cap")].map((c) => c.textContent),
      steps: card.querySelectorAll(".arcade__steps li").length,
      run: card.querySelector(".arcade__run")?.textContent ?? "",
      standaloneHandoff: Boolean(
        card.closest(".term__entry")?.querySelector(".term__handoff"),
      ),
    };
  });
  check("mission kicker", /MISSION/.test(mission.kicker ?? ""), mission.kicker);
  check("mission risk chip", /RISK/.test(mission.risk ?? ""), mission.risk);
  check("mission capability chips", mission.caps.length >= 2, mission.caps.join(","));
  check("mission has steps", mission.steps >= 2, `${mission.steps}`);
  check("mission has run button", /TAKE CONTROL/.test(mission.run), mission.run.trim());
  check("no duplicate handoff button", !mission.standaloneHandoff);
  await shot(page, "05-mission");

  /* --------------------------- toggle to plain ------------------------- */
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".term__bar button")].find((el) =>
      el.textContent?.toUpperCase().includes("ARCADE"),
    );
    btn?.click();
  });
  const off = await page.evaluate(() =>
    [...document.querySelectorAll(".term__bar button")]
      .find((el) => el.textContent?.toUpperCase().includes("ARCADE"))
      ?.textContent.trim(),
  );
  check("toggle turns arcade off", off === "ARCADE OFF", off);

  const beforeCards = await page.evaluate(
    () => document.querySelectorAll(".arcade").length,
  );
  await send(page, "hello");
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".arcade").length === count &&
      [...document.querySelectorAll(".term__entry--assistant")]
        .pop()
        ?.textContent?.includes("APEX ONLINE"),
    { timeout: 45000 },
    beforeCards,
  );
  const afterCards = await page.evaluate(
    () => document.querySelectorAll(".arcade").length,
  );
  check("plain reply when arcade off", afterCards === beforeCards, `${afterCards} cards`);
  await shot(page, "06-plain");

  const board = await page.evaluate(() => ({
    xp: document.querySelector(".term__status")?.textContent?.match(/XP\s+(\d+)/)?.[1],
    cards: document.querySelectorAll(".arcade").length,
  }));
  check("session survived all cards", board.cards === 3, `${board.cards} cards`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  /* ------------------------------- mobile ------------------------------ */
  const mob = await browser.newPage();
  await mob.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const mobErrors = [];
  mob.on("pageerror", (e) => mobErrors.push(e.message));
  await applyHarnessEnv(mob);
  await mob.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
  await mob.waitForSelector("#terminal-widget .term__input input", {
    timeout: 60000,
  });
  await mob.evaluate(() =>
    document.getElementById("pitwall")?.scrollIntoView({ block: "start" }),
  );
  await sleep(700);
  await send(mob, "what is downforce?");
  await mob.waitForSelector(".arcade--quiz", { timeout: 45000 });
  await sleep(1800);
  const mobile = await mob.evaluate(() => {
    const term = document.querySelector(".term");
    const card = [...document.querySelectorAll(".arcade--quiz")].pop();
    const tr = term.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      inside: cr.left >= tr.left - 1 && cr.right <= tr.right + 1,
      options: card.querySelectorAll(".arcade__option").length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check("mobile card fits the terminal", mobile.inside, "");
  check("mobile quiz options", mobile.options === 4, `${mobile.options}`);
  check("mobile no horizontal overflow", !mobile.overflow);
  check("mobile no page errors", mobErrors.length === 0, mobErrors.slice(0, 2).join(" | "));
  await mob.screenshot({ path: path.join(OUT, "07-mobile-quiz.png") });

  await browser.close();
  const failures = results.filter((r) => !r.ok);
  console.log("\nSUMMARY", JSON.stringify({ failures: failures.map((f) => f.name) }));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error("HARNESS ERROR", error);
  process.exit(2);
});
