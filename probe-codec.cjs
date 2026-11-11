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
      const res = { ua: navigator.userAgent, hasRecorder: typeof MediaRecorder, hasEncoder: typeof VideoEncoder, configs: {} };
      if (typeof VideoEncoder !== "undefined") {
        for (const codec of ["vp8", "vp09.00.10.08", "avc1.42001f", "h264"]) {
          try {
            const s = await VideoEncoder.isConfigSupported({ codec, width: 640, height: 360, bitrate: 1e6, framerate: 30 });
            res.configs[codec] = s.supported;
          } catch (e) { res.configs[codec] = String(e).slice(0, 80); }
        }
      }
      res.recTypes = ["video/webm", "video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/mp4", "video/x-matroska;codecs=avc1"].map((t) => [t, MediaRecorder.isTypeSupported(t)]);
      return res;
    });
    console.log(JSON.stringify(out, null, 1));
  } finally { await browser.close(); }
})();
