# Cyrus Desktop Companion

A small floating Windows mascot and chat window. It runs separately from the APEX website, stays above other windows while pinned, and uses Ollama on this laptop for AI replies.

## Start

Double-click **Launch Cyrus.bat**. Click the mascot to open chat; drag it with the left mouse button to move it. Right-click for the exit menu. In chat, drag the top bar to move the window, use the dash to collapse it, or use × to quit.

## AI connection

Ollama must be installed and running on this laptop with at least one chat model downloaded. Cyrus discovers the first installed model automatically. Enter a model name in the bottom field and choose **SAVE MODEL** to select one explicitly. The default Ollama address is `http://127.0.0.1:11434`.

Replies are generated locally by Ollama. **VOICE ON** uses Windows' built-in female speech voice; turn it off at any time. The **MIC** button uses Windows speech recognition if an English recognizer is installed, then places the transcript in the input box for review before sending. The selected model is saved in `%APPDATA%\CyrusCompanion\settings.json`. No API key is stored.

Python 3 for Windows is required. The companion uses only Python's standard library and Tkinter.
