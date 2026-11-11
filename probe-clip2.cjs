const puppeteer = require("puppeteer-core");
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: false,
    protocolTimeout: 120000,
    args: ["--window-position=-1600,0"],
  });
  try {
    const page = await browser.newPage();
    const raw = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 360;
      document.body.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      let frames = 0;
      const draw = () => {
        ctx.fillStyle = "#123";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#c8ff16";
        ctx.fillText("frame " + (++frames), 20, 40);
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0];
      const chunks = [];
      let events = 0;
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = (e) => { events++; chunks.push(e.data); };
      rec.start(200);
      await new Promise((r) => setTimeout(r, 2000));
      const blob = await new Promise((resolve) => {
        rec.onstop = () => setTimeout(() => resolve(new Blob(chunks, { type: mime })), 200);
        rec.stop();
      });
      return { mime, frames, events, size: blob.size, trackState: track.readyState, active: stream.active };
    });
    console.log("CLEAN", JSON.stringify(raw));
  } finally { await browser.close(); }
})();
