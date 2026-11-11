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
      const results = [];
      for (let i = 0; i < 3; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 360;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        let n = 0;
        const draw = () => { ctx.fillStyle = n % 2 ? "#123" : "#321"; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "#c8ff16"; ctx.fillText("f" + (++n), 20, 40); requestAnimationFrame(draw); };
        requestAnimationFrame(draw);
        const stream = canvas.captureStream(30);
        const chunks = [];
        const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 8000000 });
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.start(100);
        await new Promise((r) => setTimeout(r, 1500));
        const blob = await new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks)); rec.stop(); });
        results.push({ run: i, size: blob.size });
        canvas.remove();
      }
      return results;
    });
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})();
