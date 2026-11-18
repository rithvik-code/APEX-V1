const $ = (selector) => document.querySelector(selector);
const state = { tabId: null, page: null, chunks: [], history: [], busy: false, truncated: false };
const apiRequest = (payload) => new Promise((resolve, reject) => {
  chrome.runtime.sendMessage({ type: "SCOTCH_PAGE_AI", payload }, (response) => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error || "The local AI did not respond."));
    resolve(response.data);
  });
});

function splitIntoChunks(blocks) {
  const chunks = [];
  let current = "";
  let currentLabel = "Page content";
  let lastHeading = "";
  const flush = () => {
    if (!current.trim()) return;
    chunks.push({ id: `S${String(chunks.length + 1).padStart(3, "0")}`, label: currentLabel, text: current.trim() });
    current = "";
  };
  for (const block of blocks) {
    const text = String(block.text || "").trim();
    if (!text) continue;
    if (block.kind === "heading") lastHeading = text;
    const prefix = block.kind === "heading" ? `${block.label}: ` : `${block.label}${lastHeading ? ` · ${lastHeading}` : ""}: `;
    const pieces = text.match(/[\s\S]{1,1500}(?:\s|$)/g) || [text];
    for (const piece of pieces) {
      const addition = `${prefix}${piece.trim()}`;
      if (current.length + addition.length > 1900) flush();
      if (!current) currentLabel = lastHeading || block.label || "Page content";
      current += `${current ? "\n" : ""}${addition}`;
    }
  }
  flush();
  return chunks;
}

function setState(label, kind = "") {
  $("#state").textContent = label;
  $(".live-dot").style.background = kind === "error" ? "#ff887d" : "";
  $(".live-dot").style.boxShadow = kind === "error" ? "0 0 8px #ff887d" : "";
}

function showPage(page) {
  state.page = page;
  state.chunks = splitIntoChunks(page.blocks || []);
  state.truncated = Boolean(page.truncated);
  $("#page-title").textContent = page.title || "Untitled page";
  $("#page-url").textContent = page.url || "";
  $("#page-url").title = page.url || "";
  $("#length").textContent = `${state.chunks.length} PASSAGES${page.truncated ? " · CAPPED" : ""}`;
  $("#summarize").disabled = !state.chunks.length || state.busy;
  $("#send").disabled = !state.chunks.length || state.busy;
  setState(state.chunks.length ? "PAGE READ · READY" : "NO READABLE PAGE TEXT", state.chunks.length ? "" : "error");
  if (!state.chunks.length) showError("This page did not expose readable text to the extension. Try refreshing after the page finishes loading, or use the page’s normal text view.");
}

function showError(text) {
  const card = document.createElement("article");
  card.className = "message";
  const heading = document.createElement("div"); heading.className = "message-head"; heading.textContent = "SCOTCH / NOTICE";
  const body = document.createElement("div"); body.className = "bubble"; body.textContent = text;
  card.append(heading, body); $("#messages").append(card); card.scrollIntoView({ block: "end", behavior: "smooth" });
}

function resetConversation() {
  state.history = [];
  $("#messages").replaceChildren();
  const welcome = document.createElement("article"); welcome.className = "welcome";
  const mark = document.createElement("span"); mark.className = "welcome-mark"; mark.textContent = "✦";
  const title = document.createElement("h2"); title.textContent = "Your page, understood.";
  const copy = document.createElement("p"); copy.textContent = "Ask Scotch about anything on this page. Answers use page content only and show the passages they came from.";
  const suggestions = document.createElement("div"); suggestions.className = "suggestions";
  for (const [label, prompt] of [["Key points", "Give me the key points from this page."], ["Important details", "What are the most important details and caveats?"]]) {
    const button = document.createElement("button"); button.textContent = label; button.dataset.prompt = prompt; button.addEventListener("click", () => ask(prompt)); suggestions.append(button);
  }
  welcome.append(mark, title, copy, suggestions); $("#messages").append(welcome);
}

function appendMessage(role, text, sources = []) {
  const emptyWelcome = $(".welcome"); if (emptyWelcome) emptyWelcome.remove();
  const article = document.createElement("article"); article.className = `message ${role}`;
  const heading = document.createElement("div"); heading.className = "message-head"; heading.textContent = role === "user" ? "YOU / ASK" : "SCOTCH / PAGE ANSWER";
  const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = text;
  article.append(heading, bubble);
  if (sources.length) {
    const list = document.createElement("div"); list.className = "sources";
    for (const source of sources.slice(0, 8)) {
      const row = document.createElement("div"); row.className = "source";
      const cite = document.createElement("b"); cite.textContent = source.citation || source.id;
      const label = document.createElement("span"); label.textContent = source.label;
      row.append(cite, label); list.append(row);
    }
    article.append(list);
  }
  $("#messages").append(article); article.scrollIntoView({ block: "end", behavior: "smooth" });
}

function showTyping() {
  const typing = document.createElement("article"); typing.className = "message"; typing.id = "typing";
  const label = document.createElement("div"); label.className = "message-head"; label.textContent = "SCOTCH / READING THE PAGE";
  const dots = document.createElement("div"); dots.className = "bubble typing"; dots.innerHTML = "<i></i><i></i><i></i>";
  typing.append(label, dots); $("#messages").append(typing); typing.scrollIntoView({ block: "end", behavior: "smooth" });
}

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

async function readCurrentPage(showNotice = true) {
  try {
    const tab = await currentTab();
    if (!tab?.id || !tab.url) throw new Error("Open a regular website tab, then click Scotch again.");
    const changedTab = state.tabId !== null && state.tabId !== tab.id;
    const changedPage = state.page?.url && state.page.url !== tab.url;
    if (changedTab || changedPage) resetConversation();
    state.tabId = tab.id;
    if (changedTab || changedPage) { state.page = null; state.chunks = []; $("#send").disabled = true; $("#summarize").disabled = true; }
    const url = new URL(tab.url);
    const pdf = /\.pdf(?:$|[?#])/i.test(url.pathname + url.search + url.hash);
    if (pdf || !["http:", "https:"].includes(url.protocol)) {
      $("#page-title").textContent = pdf ? "PDF viewer" : "Protected browser page";
      $("#page-url").textContent = tab.url;
      state.page = null; state.chunks = [];
      $("#summarize").disabled = true; $("#send").disabled = true;
      setState("PAGE CONTENT IS RESTRICTED", "error");
      showError(pdf ? "Chrome’s built-in PDF viewer blocks page scripts. Open a text version of the PDF or copy its text into a normal page, then ask Scotch." : "Chrome protects this browser page from extensions. Switch to a regular website tab and refresh Scotch.");
      return;
    }
    setState("READING PAGE CONTENT…");
    $("#page-title").textContent = tab.title || "Reading current page…";
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const result = await chrome.tabs.sendMessage(tab.id, { type: "SCOTCH_READ_PAGE", waitMs: showNotice ? 650 : 250 });
    if (!result?.ok) throw new Error("The page didn’t return readable content. Try refreshing once it finishes loading.");
    showPage(result.page);
  } catch (error) {
    state.page = null; state.chunks = [];
    $("#summarize").disabled = true; $("#send").disabled = true;
    setState("PAGE ACCESS BLOCKED", "error");
    $("#page-title").textContent = "This page could not be read";
    $("#page-url").textContent = "";
    showError(`${error.message || "Chrome blocked access to this page."} Some sign-in, browser, and protected pages do not allow extensions to read them.`);
  }
}

async function ask(question, action = "ask") {
  if (state.busy) return;
  if (!state.chunks.length) return showError("Read a regular webpage first, then ask Scotch about it.");
  const tab = await currentTab();
  if (!tab || tab.id !== state.tabId) {
    await readCurrentPage();
    if (!state.chunks.length) return;
  }
  state.busy = true;
  $("#send").disabled = true; $("#summarize").disabled = true;
  $("#composer").classList.add("working");
  const userText = action === "summarize" ? "Summarize this entire webpage in simple language." : question.trim();
  if (action === "ask") appendMessage("user", userText);
  showTyping();
  setState(action === "summarize" ? "SUMMARIZING WHOLE PAGE…" : "SCOTCH IS FINDING PAGE PASSAGES…");
  try {
    const result = await apiRequest({
      action,
      question: userText,
      pageTitle: state.page.title,
      pageUrl: state.page.url,
      chunks: state.chunks,
      truncated: state.truncated,
      history: state.history,
    });
    $("#typing")?.remove();
    appendMessage("assistant", result.answer || "The local model returned an empty answer.", result.sources || []);
    if (action === "ask") {
      state.history.push({ role: "user", content: userText }, { role: "assistant", content: result.answer || "" });
      state.history = state.history.slice(-8);
    }
    $("#model-label").textContent = `LOCAL AI · ${result.model || "OLLAMA"}`;
    setState(state.truncated ? "PAGE READ · FIRST 150K CHARACTERS" : "ANSWER GROUNDED IN PAGE CONTENT");
  } catch (error) {
    $("#typing")?.remove();
    showError(`${error.message} Make sure Ollama and the APEX local service are running.`);
    setState("LOCAL AI NEEDS ATTENTION", "error");
  } finally {
    state.busy = false;
    $("#send").disabled = !state.chunks.length;
    $("#summarize").disabled = !state.chunks.length;
    $("#composer").classList.remove("working");
  }
}

$("#refresh").addEventListener("click", () => { resetConversation(); readCurrentPage(); });
$("#summarize").addEventListener("click", () => ask("", "summarize"));
$("#composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#question"); const value = input.value.trim();
  if (!value) return;
  input.value = ""; input.style.height = "auto";
  ask(value);
});
$("#question").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("#composer").requestSubmit(); }
});
$("#question").addEventListener("input", (event) => { const input = event.currentTarget; input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; });
$("#messages").addEventListener("click", (event) => { const button = event.target.closest("[data-prompt]"); if (button) ask(button.dataset.prompt); });
chrome.tabs.onActivated.addListener(({ tabId }) => { if (state.tabId !== tabId) readCurrentPage(); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (tabId === state.tabId && change.status === "complete") readCurrentPage(false); });
readCurrentPage();
