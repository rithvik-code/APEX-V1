(() => {
  if (window.__scotchReaderInstalled) return;
  window.__scotchReaderInstalled = true;

  const visible = (element) => {
    if (!element || element.closest("[hidden], [aria-hidden='true'], script, style, noscript, template")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  };
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

  function extract() {
    const records = [];
    const blocks = [];
    const seen = new Set();
    const add = (kind, label, text) => {
      const value = clean(text);
      if (!value || value.length < 2) return;
      const key = `${kind}:${value}`;
      if (seen.has(key)) return;
      seen.add(key);
      blocks.push({ kind, label: clean(label) || kind, text: value });
    };

    const selectors = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd,figcaption,caption,table,a";
    for (const element of document.querySelectorAll(selectors)) {
      if (!visible(element)) continue;
      const tag = element.tagName.toLowerCase();
      if (tag === "table") continue;
      if (tag === "a") {
        const text = clean(element.innerText || element.getAttribute("aria-label"));
        const href = element.href;
        if (text && href) add("link", "Link", `${text} — ${href}`);
        continue;
      }
      const text = element.innerText || element.textContent;
      const kind = tag[0] === "h" ? "heading" : tag === "li" ? "list item" : tag === "pre" ? "code" : tag;
      const label = tag[0] === "h" ? `Heading ${tag.slice(1)}` : tag === "li" ? "List" : tag === "blockquote" ? "Quote" : tag === "figcaption" ? "Image caption" : tag === "caption" ? "Table caption" : tag === "pre" ? "Code" : "Page text";
      records.push({ node: element, kind, label, text });
    }

    for (const table of document.querySelectorAll("table")) {
      if (!visible(table)) continue;
      const caption = clean(table.caption?.innerText) || "Table";
      const rows = [...table.querySelectorAll("tr")].filter(visible).map((row) =>
        [...row.querySelectorAll("th,td")].map((cell) => clean(cell.innerText)).filter(Boolean).join(" | ")
      ).filter(Boolean);
      if (rows.length) records.push({ node: table, kind: "table", label: caption, text: rows.join("\n") });
    }

    const directText = new Map();
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const parent = node.parentElement;
      if (!parent || !visible(parent) || parent.closest("h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dt,dd,figcaption,caption,table,a,button,script,style,noscript,svg")) continue;
      const value = clean(node.nodeValue);
      if (value.length < 2) continue;
      directText.set(parent, `${directText.get(parent) || ""} ${value}`.trim());
    }
    for (const [node, text] of directText) records.push({ node, kind: "text", label: "Page text", text });

    records.sort((a, b) => a.node === b.node ? 0 : (a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    for (const record of records) add(record.kind, record.label, record.text);

    if (!blocks.length && document.body) add("page text", "Page text", document.body.innerText);

    // Significant images tell Scotch to offer the vision model; alt text gives
    // a text model something honest to work with when no screenshot is sent.
    const images = [...document.images].filter((img) => {
      if (!visible(img) || img.naturalWidth < 240 || img.naturalHeight < 120) return false;
      const rect = img.getBoundingClientRect();
      return rect.width >= 160 && rect.height >= 90;
    });
    const imageNotes = images.slice(0, 12).map((img) => clean(img.alt || img.title || "")).filter(Boolean);
    if (imageNotes.length) add("image", "Image alt text", imageNotes.join(" | "));
    const maxChars = 150000;
    let used = 0;
    const limited = [];
    for (const block of blocks) {
      if (used >= maxChars) break;
      const text = block.text.slice(0, maxChars - used);
      limited.push({ ...block, text });
      used += text.length;
    }
    return {
      title: clean(document.title) || location.hostname,
      url: location.href,
      blocks: limited,
      images: images.length,
      charCount: used,
      truncated: blocks.reduce((sum, block) => sum + block.text.length, 0) > used,
      readAt: new Date().toISOString(),
    };
  }

  /** Scroll to the passage an answer came from and flash it. */
  function highlight(snippet) {
    const wanted = clean(snippet).slice(0, 160).toLowerCase();
    if (!wanted) return { ok: false };
    const nodes = [...document.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,figcaption")].filter(visible);
    const match =
      nodes.find((node) => clean(node.innerText).toLowerCase().includes(wanted)) ??
      nodes.find((node) => {
        const text = clean(node.innerText).toLowerCase();
        const words = wanted.split(/\s+/).filter((word) => word.length > 4);
        return words.length > 0 && words.every((word) => text.includes(word));
      });
    if (!match) return { ok: false };
    match.scrollIntoView({ behavior: "smooth", block: "center" });
    const previous = match.style.outline;
    match.style.outline = "2px solid #c8ff16";
    match.style.outlineOffset = "3px";
    setTimeout(() => { match.style.outline = previous; match.style.outlineOffset = ""; }, 2600);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCOTCH_HIGHLIGHT") {
      sendResponse(highlight(message.text));
      return;
    }
    if (message?.type !== "SCOTCH_READ_PAGE") return;
    const delay = Math.min(1500, Math.max(0, Number(message.waitMs) || 0));
    setTimeout(() => sendResponse({ ok: true, page: extract() }), delay);
    return true;
  });
})();
