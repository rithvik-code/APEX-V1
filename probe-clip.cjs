const puppeteer = require("puppeteer-core");

const URL_ = "http://127.0.0.1:5173/";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: false,
    protocolTimeout: 300000,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-gpu",
      "--use-gl=angle",
      "--use-angle=d3d11",
      "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--window-size=1280,720",
      "--window-position=-1600,0",
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    const logs = [];
    page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
    await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector(".site.is-ready", { timeout: 60000 });

    const raw = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      document.body.appendChild(canvas);
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      let frames = 0;
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const draw = () => {
        ctx.fillStyle = frames % 2 ? "#123" : "#321";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#c8ff16";
        ctx.fillText(`frame ${frames++}`, 20, 40);
        if (track.requestFrame) track.requestFrame();
      };
      const timer = setInterval(draw, 33);
      draw();
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
        ? "video/webm;codecs=vp8"
        : "video/webm";
      const chunks = [];
      let error = "";
      let recState = "";
      let dataEvents = 0;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
      rec.ondataavailable = (e) => {
        dataEvents++;
        chunks.push(e.data.size);
      };
      rec.onerror = (e) => (error = String(e.error || e));
      rec.start(33);
      await new Promise((r) => setTimeout(r, 2200));
      recState = rec.state;
      const blob = await new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
        rec.stop();
      });
      clearInterval(timer);
      return { mime, frames, recState, dataEvents, sizes: chunks, size: blob.size, hasReq: !!track.requestFrame, error, vis: document.visibilityState, ua: navigator.userAgent };
    });
    console.log("RAW", JSON.stringify(raw));
    console.log("LOGS", JSON.stringify(logs.slice(0, 10)));
  } finally {
    await browser.close();
  }
})();
