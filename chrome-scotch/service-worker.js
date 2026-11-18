const API = "http://127.0.0.1:4317/api/page-assistant";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCOTCH_PAGE_AI") return;
  fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.payload),
    signal: AbortSignal.timeout(180000),
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Local AI returned ${response.status}`);
    sendResponse({ ok: true, data });
  }).catch((error) => {
    sendResponse({ ok: false, error: error.message || "Scotch could not reach the local AI." });
  });
  return true;
});
