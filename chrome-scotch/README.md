# Scotch — Chrome Page Companion

Scotch is a Chrome Manifest V3 side panel that reads the active webpage after you open it, answers questions from that page, and summarizes long pages. It uses the existing APEX local service and Ollama model, so page text and questions are not sent to a hosted AI provider and no API key is stored in the extension.

## Folder contents

```text
chrome-scotch/
├── manifest.json       Chrome MV3 permissions and side-panel declaration
├── service-worker.js   Calls the loopback APEX page-assistant endpoint
├── content.js          Extracts visible headings, prose, lists, links and tables
├── sidepanel.html      Companion interface
├── sidepanel.css       Dark, responsive HUD styling and motion
├── sidepanel.js        Page reading, chunking, follow-up context and controls
└── README.md           Setup and deployment guide
```

The endpoint implementation lives in `cli/server/apexd.mjs` and uses APEX's configured local Ollama model. The daemon listens on loopback, caps page requests, checks the browser origin and forwards prompts only to the configured local Ollama endpoint.

## Install in Chrome

1. Start Ollama and make sure at least one chat model is installed.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select this project's `chrome-scotch` folder.
4. Copy the extension ID shown on its card.
5. In the same PowerShell window where you start APEX, allow that exact extension ID and start the local assistant service:

   ```powershell
   $env:APEX_CHROME_EXTENSION_ID = "paste-the-extension-id-here"
   npm run apexd
   ```

   Keep that terminal running. If APEX is already running, stop it and start it again with the environment variable set.

6. Pin **Scotch — Page Companion** to Chrome’s toolbar. Open a normal website and click the Scotch toolbar icon. Chrome opens the side panel and grants the extension temporary access to that tab. Click **↻** any time to reread the current page.

The unpacked extension ID is tied to its local folder. Keep the folder in the same location after setting `APEX_CHROME_EXTENSION_ID`; if Chrome shows a different ID, update the environment variable and restart `npm run apexd`.

## Use Scotch

- Ask a question in the bottom box. Scotch searches page passages, answers from the most relevant ones, and shows the source headings/passages below the answer.
- Ask follow-up questions in the same panel; recent conversation context is retained for follow-ups.
- Click **SUMMARIZE PAGE** to summarize the full captured page. Long pages are processed in ordered chunks, then combined into one summary.
- Click **↻** after a site loads more content to reread its current DOM.
- Answers are grounded in page content. When the captured text does not include the answer, Scotch is instructed to say so rather than fill gaps from general knowledge.

## Access and limits

Chrome grants `activeTab` access when you open the extension from its toolbar icon. The extension does not request permanent access to every site. It reads visible DOM text, semantic headings, paragraphs, lists, links and tables from the current tab. It does not submit page content until you ask a question or request a summary.

Chrome’s internal pages, sign-in/protected surfaces, and built-in PDF viewer prevent content-script access. Scotch reports that access limit and offers a text-view workaround. On infinite-scroll pages, scroll the site to load more content and then refresh Scotch. The reader captures up to 150,000 characters per page; longer pages are marked as capped. Image-only text, canvas content and inaccessible shadow roots are not OCRed.

## Local API and secrets

This build uses Ollama locally at `http://127.0.0.1:11434`. There is no cloud-provider API key to put in Chrome or the extension source. If you later add a hosted provider, keep its key in the backend environment or a server-side secret store and never put it in `manifest.json`, `service-worker.js`, or `sidepanel.js`.

To use another local model, choose it in the APEX control configuration or set `APEX_MODEL` before starting the daemon. Restart the daemon after changing environment variables.

## Deployment

For personal use, use **Load unpacked** and keep the APEX service running on the same laptop. To distribute it to other users, publish/sign the extension through the Chrome Web Store (or an organization-managed Chrome policy), then deploy the APEX backend on each user's device and allow that user's exact extension ID through `APEX_CHROME_EXTENSION_ID`. Do not expose this loopback service to the public internet or put provider credentials in the extension package.
