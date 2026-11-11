const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage();
    const out = await page.evaluate(async () => {
      const results = [];
      for (const mime of ["video/mp4", "video/mp4;codecs=avc1.42001E", "video/webm;codecs=vp9", "video/webm;codecs=vp8"]) {
        const canvas = document.createElement("canvas");
        canvas.width = 640; canvas.height = 360;
        document.body.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        let n = 0;
        const draw = () => { ctx.fillStyle = n % 2 ? "#123" : "#321"; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "#c8ff16"; ctx.fillText("f" + (++n), 20, 40); requestAnimationFrame(draw); };
        requestAnimationFrame(draw);
        const stream = canvas.captureStream(30);
        const chunks = [];
        const rec = new MediaRecorder(stream, { mimeType: mime });
        rec.ondataavailable = (e) => chunks.push(e.data.size);
        rec.start(100);
        await new Promise((r) => setTimeout(r, 1600));
        const blob = await new Promise((resolve) => { rec.onstop = () => resolve(new Blob(chunks)); rec.stop(); });
        results.push({ mime, size: blob.size, chunks: chunks.length, last: chunks.slice(-2) });
        canvas.remove();
      }
      return results;
    });
    console.log(JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})();
