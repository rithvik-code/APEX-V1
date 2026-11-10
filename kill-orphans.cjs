/* Kill only puppeteer-launched scratch Chrome processes (temp profiles). */
const { execFileSync } = require("child_process");
const out = execFileSync("powershell", [
  "-NoProfile",
  "-Command",
  "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*puppeteer_dev_chrome_profile*' } | Select-Object -ExpandProperty ProcessId",
]).toString();
const pids = out.split(/\s+/).map((s) => s.trim()).filter(Boolean);
console.log("orphan puppeteer chrome pids:", pids.length ? pids.join(",") : "none");
for (const pid of pids) {
  try {
    execFileSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "pipe" });
    console.log("killed", pid);
  } catch (e) {
    console.log("skip", pid, String(e.message).split("\n")[0]);
  }
}