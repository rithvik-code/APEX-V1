const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const out = await page.evaluate(async () => {
      const mime = "video/webm;codecs=vp9";
      const mk = (w, h) => {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        let live = true;
        const loop = () => { if (!live) return; ctx.fillStyle = "#222"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#c8ff16"; ctx.fillText("warm", 4, 12); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        return { c, stopDraw: () => { live = false; } };
      };
      // Prime: throwaway tiny recorder.
      const warm = mk(64, 64);
      const warmStream = warm.c.captureStream(30);
      const warmRec = new MediaRecorder(warmStream, { mimeType: mime });
      const warmParts = [];
      warmRec.ondataavailable = (e) => warmParts.push(e.data.size);
      warmRec.start(100);
      await new Promise((r) => setTimeout(r, 700));
      warmRec.stop();
      warm.stopDraw();
      // Real recorder right after warm-up.
      const real = mk(640, 360);
      const stream = real.c.captureStream(30);
      const chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.start(100);
      await new Promise((r) => setTimeout(r, 1800));
      const blob = await new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); rec.stop(); });
      real.stopDraw();
      return { warmParts, size: blob.size, mime };
    });
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})();
