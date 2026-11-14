/*
 * The phone remote. Served by apexd at /m, same-origin, no build step and no
 * external assets. It speaks to /api/cyrus with the pairing token issued by
 * `apexd --lan`, shows the approval card for high-risk actions, and uses the
 * phone's own speech recognition for voice input.
 */
export function mobilePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#050607">
<title>APEX // REMOTE</title>
<style>
  :root { --acid:#c8ff16; --ink:#050607; --line:#1b2320; --dim:#6e7871; --white:#e9ede8; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin:0; height:100%; }
  body { background:var(--ink); color:var(--white); font:14px/1.45 ui-monospace, "SFMono-Regular", Menlo, monospace; display:flex; flex-direction:column; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 16px 12px; border-bottom:1px solid var(--line); }
  header b { letter-spacing:.22em; font-size:12px; }
  header b i { color:var(--acid); font-style:normal; }
  #state { font-size:9px; letter-spacing:.14em; color:var(--dim); border:1px solid var(--line); padding:5px 8px; border-radius:999px; }
  #state.ok { color:var(--acid); border-color:rgba(200,255,22,.45); }
  main { flex:1; overflow:auto; padding:16px; display:flex; flex-direction:column; gap:10px; }
  .row { max-width:92%; padding:10px 12px; border-radius:12px; border:1px solid var(--line); background:#0a0d0c; white-space:pre-wrap; word-break:break-word; font-size:13px; }
  .row.you { align-self:flex-end; border-color:rgba(200,255,22,.35); color:var(--acid); }
  .row.sys { color:var(--dim); font-size:11px; letter-spacing:.05em; }
  .row.err { border-color:#5a1f1a; color:#ff8a7a; }
  #approval { margin:0 16px 10px; padding:14px; border:1px solid rgba(200,255,22,.5); border-radius:12px; background:rgba(200,255,22,.06); display:none; }
  #approval.show { display:block; }
  #approval p { margin:0 0 10px; font-size:12px; letter-spacing:.06em; }
  #approval .btns { display:flex; gap:8px; }
  #approval button { flex:1; padding:12px; border-radius:10px; border:1px solid var(--line); background:transparent; color:var(--white); font:inherit; font-size:11px; letter-spacing:.12em; }
  #approval button.allow { background:var(--acid); color:#0a0d05; border-color:var(--acid); font-weight:700; }
  form { display:flex; gap:8px; padding:10px 16px calc(12px + env(safe-area-inset-bottom)); border-top:1px solid var(--line); background:#070a09; }
  form input { flex:1; min-width:0; background:#0b0f0d; border:1px solid var(--line); border-radius:11px; color:var(--white); padding:13px 12px; font:inherit; font-size:13px; }
  form input:focus { outline:none; border-color:rgba(200,255,22,.5); }
  form button { border:1px solid var(--line); background:#0b0f0d; color:var(--white); border-radius:11px; padding:0 14px; font:inherit; font-size:10px; letter-spacing:.12em; }
  form button#mic { color:var(--acid); border-color:rgba(200,255,22,.4); }
  form button#send { background:var(--acid); color:#0a0d05; border-color:var(--acid); font-weight:700; }
  form button:disabled { opacity:.4; }
</style>
</head>
<body>
<header>
  <b>APEX<i>//</i>REMOTE</b>
  <span id="state">LINKING</span>
</header>
<main id="log"></main>
<div id="approval">
  <p id="approval-text">Approve this action?</p>
  <div class="btns">
    <button class="allow" id="allow">ALLOW ONCE</button>
    <button id="deny">DENY</button>
  </div>
</div>
<form id="bar">
  <button type="button" id="mic" aria-label="Speak a command">MIC</button>
  <input id="q" autocomplete="off" autocapitalize="off" placeholder="open notepad" aria-label="Command">
  <button id="send" type="submit">SEND</button>
</form>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var token = params.get("token") || "";
  try {
    if (token) { localStorage.setItem("apex.token", token); history.replaceState(null, "", "/m"); }
    else { token = localStorage.getItem("apex.token") || ""; }
  } catch (e) { /* private mode */ }

  var pending = "";
  var busy = false;

  function line(who, text, cls) {
    var el = document.createElement("div");
    el.className = "row " + (cls || who);
    el.textContent = text;
    $("log").appendChild(el);
    $("log").scrollTop = $("log").scrollHeight;
    return el;
  }

  function speak(text) {
    if (!text || !("speechSynthesis" in window)) return;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {}
  }

  function setState(text, ok) {
    $("state").textContent = text;
    $("state").className = ok ? "ok" : "";
  }

  function call(body) {
    return fetch("/api/cyrus", {
      method: "POST",
      headers: { "content-type": "application/json", "x-apex-token": token },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 401) throw new Error("PAIRING TOKEN REJECTED — reopen the URL printed by apexd");
      return res.json();
    });
  }

  function showApproval(text) {
    $("approval-text").textContent = text || "Approve this action?";
    $("approval").classList.add("show");
    speak(text || "Approval needed");
  }

  function hideApproval() {
    $("approval").classList.remove("show");
    pending = "";
  }

  function send(text) {
    if (!text || busy) return;
    busy = true;
    line("you", text);
    call({ text: text, confirm: false }).then(function (data) {
      if (data.needsApproval) {
        pending = text;
        showApproval(data.speech);
        line("sys", "WAITING FOR APPROVAL", "sys");
      } else {
        line("cyrus", data.speech || "(no reply)", data.ok ? "cyrus" : "err");
        if (data.ok) speak(data.speech);
      }
    }).catch(function (error) {
      line("sys", error.message, "err");
      setState("OFFLINE", false);
    }).then(function () { busy = false; });
  }

  $("bar").addEventListener("submit", function (event) {
    event.preventDefault();
    var value = $("q").value.trim();
    if (!value) return;
    $("q").value = "";
    send(value);
  });

  $("allow").addEventListener("click", function () {
    var text = pending;
    hideApproval();
    if (!text) return;
    busy = true;
    call({ text: text, confirm: true }).then(function (data) {
      line("cyrus", data.speech || "(no reply)", data.ok ? "cyrus" : "err");
      if (data.ok) speak(data.speech);
    }).catch(function (error) { line("sys", error.message, "err"); })
      .then(function () { busy = false; });
  });

  $("deny").addEventListener("click", function () {
    hideApproval();
    line("sys", "DENIED", "sys");
  });

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $("mic").disabled = true;
    $("mic").title = "Speech recognition unavailable in this browser";
  } else {
    $("mic").addEventListener("click", function () {
      var rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (event) {
        var text = event.results[0][0].transcript;
        if (text) send(text.trim());
      };
      rec.onerror = function () { line("sys", "MIC BLOCKED — type instead", "err"); };
      try { rec.start(); setState("LISTENING", true); } catch (e) { line("sys", "MIC BUSY", "err"); }
      rec.onend = function () { setState("LINKED", true); };
    });
  }

  if (!token) {
    line("sys", "NO PAIRING TOKEN. Start the daemon with: npm run apexd -- --lan, then open the /m URL it prints.", "err");
    setState("UNPAIRED", false);
  } else {
    fetch("/api/health", { headers: { "x-apex-token": token } })
      .then(function (res) {
        if (res.status === 401) throw new Error("TOKEN REJECTED");
        return res.json();
      })
      .then(function (health) {
        setState("LINKED · " + (health.defaults && health.defaults.plannerModel ? health.defaults.plannerModel : "LOCAL"), true);
        line("sys", "CYRUS REMOTE READY. Say or type a command.", "sys");
      })
      .catch(function (error) {
        setState("UNPAIRED", false);
        line("sys", error.message, "err");
      });
  }
})();
</script>
</body>
</html>`;
}
