# Cyrus Desktop Companion

A small floating Windows dog mascot named Scotch, paired with the Cyrus chat window. It runs separately from the APEX website, stays above other windows while pinned, and uses Ollama on this laptop for AI replies.

## Start

Double-click **Launch Cyrus.bat**. The Scotch pet's hotkey listener starts when you sign in to Windows. Press **Ctrl+Alt+Shift+C** to open or bring up Scotch. Hover over the floating dog to reveal **TALK TO CYRUS** and **TEXT CYRUS**. Talk opens the voice listener and sends the recognized phrase; Text opens chat with the typing field ready. The shaded 3D-style dog gently bobs and turns on a transparent desktop with no circular badge or backdrop. Drag Scotch with the left mouse button to move it. Right-click for the exit menu. In chat, drag the top bar to move the window, use the dash to collapse it, or use × to quit.

## AI connection

Ollama must be installed and running on this laptop with at least one chat model downloaded. Cyrus follows the model currently loaded in Ollama, then falls back to an installed model. Enter a model name in the bottom field and choose **SAVE MODEL** to save a preference. The default Ollama address is `http://127.0.0.1:11434`.

Replies use the selected local engine. The pet wags its tail on hover and wanders slowly when left alone. **VOICE ON** uses Windows' built-in female speech voice; turn it off at any time. The **MIC** button uses Windows speech recognition if an English recognizer is installed, then places the transcript in the input box for review before sending. The selected model and engine are saved in `%APPDATA%\CyrusCompanion\settings.json`; a Hermes API key is stored there only if you choose Hermes.

### Hermes Agent

The desktop companion can also use Hermes Agent. Install Hermes, enable its API server with `API_SERVER_ENABLED=true` and an `API_SERVER_KEY` in `%USERPROFILE%\.hermes\.env`, then start `hermes gateway`. Expand the companion, choose **HERMES** under **AI ENGINE**, enter that API key, and choose **SAVE ENGINE**. Hermes listens on `http://127.0.0.1:8642` by default. The key is saved in the companion's local settings file. See the [official Hermes API server guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/) for setup details.

Python 3 for Windows, Tkinter, and Pillow are required. Pillow renders the transparent animated 3D-style mascot sprite.
