"""CYRUS desktop companion for Windows. Uses Tkinter and Python's standard library."""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import urllib.error
import urllib.request
from pathlib import Path
import tkinter as tk
from tkinter import ttk


BG = "#071016"
PANEL = "#0b151d"
BLUE = "#526dff"
CYAN = "#83edff"
TEXT = "#e9f3f8"
MUTED = "#8ca2ae"
GREEN = "#b7fa42"
APP_DIR = Path(os.environ.get("APPDATA", str(Path.home()))) / "CyrusCompanion"
SETTINGS_PATH = APP_DIR / "settings.json"


def read_settings():
    try:
        value = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return {
            "endpoint": str(value.get("endpoint", "http://127.0.0.1:11434")).rstrip("/"),
            "model": str(value.get("model", "")),
        }
    except (OSError, ValueError, TypeError):
        return {"endpoint": "http://127.0.0.1:11434", "model": ""}


class CyrusCompanion:
    HOTKEY = "<Control-Alpha>"

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("SCOTCH Desktop Companion")
        self.root.configure(bg=BG)
        self.root.attributes("-topmost", True)
        self.root.overrideredirect(False)
        self.settings = read_settings()
        self.events = queue.Queue()
        self.messages = []
        self.expanded = False
        self.busy = False
        self.voice_on = True
        self.always_listen = True
        self._drag = None
        self._bubble_pointer = None
        self._wake_repeat_until = 0.0
        self._last_heard_lowercase = ""
        self.bubble = None
        self._draw_bubble()
        self.root.bind(self.HOTKEY, lambda _e: self._on_hotkey(), "+")
        self.root.bind("<Escape>", lambda _e: self.collapse())
        self.root.after(350, self._animate_bubble)
        self.root.after(80, self._drain_events)
        self.root.after(60, self._wake_poll)
        self.root.mainloop()

    def _mascot(self, canvas, cx, cy, scale=1.0, animated=False):
        s = scale
        def box(x1, y1, x2, y2, radius, fill, outline=""):
            x1, y1, x2, y2 = cx + int(x1*s), cy + int(y1*s), cx + int(x2*s), cy + int(y2*s)
            r = int(radius*s)
            canvas.create_arc(x1, y1, x1+2*r, y1+2*r, start=90, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x2-2*r, y1, x2, y1+2*r, start=0, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x1, y2-2*r, x1+2*r, y2, start=180, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x2-2*r, y2-2*r, x2, y2, start=270, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_rectangle(x1+r, y1, x2-r, y2, fill=fill, outline=fill)
            canvas.create_rectangle(x1, y1+r, x2, y2-r, fill=fill, outline=fill)
        def xy(x, y): return cx + int(x*s), cy + int(y*s)

        # Soft floating shadow, little shoulder fins and rounded cobalt helmet.
        canvas.create_oval(*xy(-44, 39), *xy(44, 53), fill="#09101a", outline="")
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(-32, 16), (-48, 31), (-44, 43), (-29, 34)]), ()), fill="#3548cc", outline="")
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(32, 16), (48, 31), (44, 43), (29, 34)]), ()), fill="#3548cc", outline="")
        box(-39, -34, 39, 31, 14, BLUE)
        box(-28, -23, 28, 19, 8, "#101a2c", "#8092ff")
        # Expressive cyan eyes; blinking is a restrained periodic animation.
        if animated and (self.root.winfo_fpixels("1i") and (int(self.root.tk.call("clock", "seconds")) % 7 == 0)):
            canvas.create_line(*xy(-14, -3), *xy(-7, -3), fill=CYAN, width=max(2, int(3*s)), capstyle="round")
            canvas.create_line(*xy(7, -3), *xy(14, -3), fill=CYAN, width=max(2, int(3*s)), capstyle="round")
        else:
            canvas.create_oval(*xy(-15, -8), *xy(-7, 4), fill=CYAN, outline="")
            canvas.create_oval(*xy(7, -8), *xy(15, 4), fill=CYAN, outline="")
        canvas.create_arc(*xy(-8, 0), *xy(8, 12), start=205, extent=130, style="arc", outline="#b2f8ff", width=max(1, int(s)))
        # Tiny flight jacket and reactor badge.
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(-19, 30), (-27, 39), (-24, 56), (-11, 50), (0, 55), (11, 50), (24, 56), (27, 39), (19, 30)]), ()), fill="#4059e9", outline="")
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(-11, 31), (0, 40), (11, 31)]), ()), fill="#a6f5ff", outline="")
        canvas.create_oval(*xy(-4, 42), *xy(4, 50), fill=GREEN, outline="#e8ffae")

    def _scotch(self, canvas, cx, cy, scale=1.0, animated=False):
        s = scale
        def box(x1, y1, x2, y2, radius, fill, outline=""):
            x1, y1, x2, y2 = cx + int(x1*s), cy + int(y1*s), cx + int(x2*s), cy + int(y2*s)
            r = int(radius*s)
            canvas.create_arc(x1, y1, x1+2*r, y1+2*r, start=90, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x2-2*r, y1, x2, y1+2*r, start=0, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x1, y2-2*r, x2, y2, start=180, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_arc(x2-2*r, y2-2*r, x2, y2, start=270, extent=90, fill=fill, outline=outline, style="pieslice")
            canvas.create_rectangle(x1+r, y1, x2-r, y2, fill=fill, outline=fill)
            canvas.create_rectangle(x1, y1+r, x2, y2-r, fill=fill, outline=fill)
        def xy(x, y): return cx + int(x*s), cy + int(y*s)

        # Soft floating shadow and warm cream-white Labrador body.
        canvas.create_oval(*xy(-46, 36), *xy(46, 54), fill="#09101a", outline="")
        box(-38, -30, 38, 33, 15, "#fff6e7", "#d8b88c")
        box(-30, -20, 30, 23, 9, "#f4e2c8", "#caa46a")
        # Floppy ears.
        canvas.create_oval(*xy(-34, -18), *xy(-22, -6), fill="#e9c9a3", outline="#caa46a")
        canvas.create_oval(*xy(34, -18), *xy(22, -6), fill="#e9c9a3", outline="#caa46a")
        # Scotch muzzle.
        canvas.create_oval(*xy(-13, -3), *xy(13, 15), fill="#fff0db", outline="#e6c499")
        # Warm brown eyes.
        if animated and (self.root.winfo_fpixels("1i") and (int(self.root.tk.call("clock", "seconds")) % 7 == 0)):
            canvas.create_line(*xy(-9, -1), *xy(-5, -1), fill="#7a4a25", width=max(2, int(3*s)), capstyle="round")
            canvas.create_line(*xy(5, -1), *xy(9, -1), fill="#7a4a25", width=max(2, int(3*s)), capstyle="round")
        else:
            canvas.create_oval(*xy(-9, -5), *xy(-6, -1), fill="#7a4a25", outline="")
            canvas.create_oval(*xy(6, -5), *xy(9, -1), fill="#7a4a25", outline="")
        canvas.create_oval(*xy(-8, 2), *xy(-6, 4), fill="#fff6e7")
        canvas.create_oval(*xy(6, 2), *xy(8, 4), fill="#fff6e7")
        # Nose.
        canvas.create_oval(*xy(-3, 6), *xy(3, 10), fill="#3a2417", outline="#24160f")
        # Happy mouth.
        canvas.create_arc(*xy(-7, 8), *xy(7, 12), start=180, extent=180, style="arc", outline="#3a2417", width=max(1, int(s)))
        # Scotchy collar tag.
        canvas.create_oval(*xy(-3, 26), *xy(3, 33), fill="#c8ff16", outline="#7a7a00")
        canvas.create_text(*xy(0, 30), text="S", fill="#1a1a00", font=("Segoe UI Semibold", max(7, int(9*s)), "bold"))
        canvas.create_arc(*xy(-8, 0), *xy(8, 12), start=205, extent=130, style="arc", outline="#b2f8ff", width=max(1, int(s)))
        # Tiny flight jacket and reactor badge.
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(-19, 30), (-27, 39), (-24, 56), (-11, 50), (0, 55), (11, 50), (24, 56), (27, 39), (19, 30)]), ()), fill="#4059e9", outline="")
        canvas.create_polygon(*sum((xy(x, y) for x, y in [(-11, 31), (0, 40), (11, 31)]), ()), fill="#a6f5ff", outline="")
        canvas.create_oval(*xy(-4, 42), *xy(4, 50), fill=GREEN, outline="#e8ffae")

    def _draw_bubble(self):
        c = self.bubble
        if c is None:
            x = max(12, self.root.winfo_screenwidth() - 140)
            y = max(12, self.root.winfo_screenheight() - 180)
            self.root.geometry(f"112x126+{x}+{y}")
            c = tk.Canvas(self.root, width=112, height=126, bg=BG, highlightthickness=0)
            self.bubble = c
            c.pack()
        else:
            c.pack()
            c.delete("all")
        c.create_oval(9, 4, 103, 98, fill="#0c1b2b", outline="#7086ff", width=2)
        self._mascot(c, 56, 48, .82, True)
        c.create_text(56, 111, text="SCOTCH", fill=TEXT, font=("Segoe UI Semibold", 9, "bold"))
        c.create_text(56, 122, text="TAP TO TALK", fill=CYAN, font=("Consolas", 6, "bold"))
        c.bind("<ButtonPress-1>", self._bubble_press)
        c.bind("<B1-Motion>", self._bubble_move)
        c.bind("<ButtonRelease-1>", self._bubble_release)
        c.bind("<Button-3>", self._bubble_menu)
        c.bind("<Double-Button-1>", lambda _e: self.expand())
        c.configure(cursor="hand2")

    def _animate_bubble(self):
        if self.expanded: return
        self._draw_bubble()
        self.root.after(350, self._animate_bubble)

    def _start_drag(self, event):
        self._drag = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def _bubble_press(self, event):
        self._bubble_pointer = [event.x_root, event.y_root, self.root.winfo_x(), self.root.winfo_y(), False]

    def _bubble_move(self, event):
        if self._bubble_pointer is None: return
        dx, dy = event.x_root-self._bubble_pointer[0], event.y_root-self._bubble_pointer[1]
        if abs(dx) + abs(dy) > 5: self._bubble_pointer[4] = True
        if self._bubble_pointer[4]:
            self.root.geometry(f"+{self._bubble_pointer[2]+dx}+{self._bubble_pointer[3]+dy}")

    def _bubble_release(self, _event):
        pointer, self._bubble_pointer = self._bubble_pointer, None
        if pointer and not pointer[4]: self.expand()

    def _drag_window(self, event):
        if self._drag:
            self.root.geometry(f"+{event.x_root-self._drag[0]}+{event.y_root-self._drag[1]}")

    def _drag_header(self, event):
        self._drag = (event.x_root-self.root.winfo_x(), event.y_root-self.root.winfo_y())

    def _move_header(self, event):
        self._drag_window(event)

    def expand(self):
        if self.expanded: return
        self.expanded = True
        if self.bubble is not None: self.bubble.pack_forget()
        x = min(self.root.winfo_x(), max(12, self.root.winfo_screenwidth()-372))
        y = min(self.root.winfo_y(), max(12, self.root.winfo_screenheight()-578))
        self.root.geometry(f"360x550+{x}+{y}")
        self.root.configure(bg=BG, highlightthickness=1, highlightbackground="#334fff")
        self._panel()
        self.root.focus_force()
        self.root.after(80, self.entry.focus_force)

    def collapse(self):
        if not self.expanded: return
        self.expanded = False
        for child in self.root.winfo_children(): child.destroy()
        self.bubble = None
        self.root.configure(highlightthickness=0)
        self._draw_bubble()
        self.root.after(350, self._animate_bubble)

    def _panel(self):
        self.root.grid_columnconfigure(0, weight=1)
        self.root.grid_rowconfigure(1, weight=1)
        head = tk.Frame(self.root, bg="#111e2e", height=92)
        head.grid(row=0, column=0, sticky="ew")
        head.pack_propagate(False)
        head.bind("<ButtonPress-1>", self._drag_header)
        head.bind("<B1-Motion>", self._move_header)
        art = tk.Canvas(head, width=78, height=86, bg="#111e2e", highlightthickness=0)
        art.pack(side="left", padx=(8, 3))
        self._scotch(art, 39, 39, .61)
        identity = tk.Frame(head, bg="#111e2e")
        identity.pack(side="left", fill="both", expand=True, pady=17)
        tk.Label(identity, text="SCOTCH", fg=TEXT, bg="#111e2e", font=("Segoe UI Semibold", 15, "bold")).pack(anchor="w")
        self.status = tk.Label(identity, text="DESKTOP COMPANION · LOCAL AI", fg=CYAN, bg="#111e2e", font=("Consolas", 7))
        self.status.pack(anchor="w", pady=(3, 0))
        for widget in (art, identity, *identity.winfo_children()):
            widget.bind("<ButtonPress-1>", self._drag_header)
            widget.bind("<B1-Motion>", self._move_header)
        controls = tk.Frame(head, bg="#111e2e")
        controls.pack(side="right", anchor="n", padx=7, pady=7)
        self.pin_button = tk.Button(controls, text="PIN", command=self._toggle_pin, bg="#1a2a38", fg=GREEN, relief="flat", font=("Consolas", 8, "bold"), cursor="hand2")
        self.pin_button.pack(pady=(0, 4))
        tk.Button(controls, text="—", command=self.collapse, bg="#1a2a38", fg=TEXT, relief="flat", font=("Segoe UI", 10), width=3, cursor="hand2").pack()
        tk.Button(controls, text="×", command=self.root.destroy, bg="#1a2a38", fg="#ff9b9b", relief="flat", font=("Segoe UI", 10), width=3, cursor="hand2").pack(pady=(4, 0))

        self.chat = tk.Text(self.root, bg=BG, fg=TEXT, insertbackground=CYAN, relief="flat", wrap="word", padx=13, pady=12, font=("Segoe UI", 10), spacing3=5, state="disabled")
        self.chat.grid(row=1, column=0, sticky="nsew", padx=1)
        self.chat.tag_configure("you", foreground=GREEN, font=("Consolas", 8, "bold"))
        self.chat.tag_configure("cyrus", foreground=CYAN, font=("Consolas", 8, "bold"))
        self.chat.tag_configure("body", foreground=TEXT)
        if not self.messages: self._append("CYRUS", "Hey. I'm right here on your desktop. Ask me anything.", False)
        else:
            for who, message in self.messages: self._append(who, message, False)

        self.status_line = tk.Label(self.root, text="OLLAMA · " + (self.settings["model"] or "CHOOSE A MODEL BELOW"), fg=MUTED, bg=BG, anchor="w", padx=12, font=("Consolas", 7))
        self.status_line.grid(row=2, column=0, sticky="ew", pady=(3, 4))
        row = tk.Frame(self.root, bg=BG)
        row.grid(row=3, column=0, sticky="ew", padx=9, pady=(0, 9))
        self.entry = tk.Entry(row, bg="#111e2a", fg=TEXT, insertbackground=CYAN, relief="flat", font=("Segoe UI", 10))
        self.entry.pack(side="left", fill="x", expand=True, ipady=9, padx=(0, 6))
        self.entry.bind("<Return>", lambda _e: self.send())
        tk.Button(row, text="MIC", command=self.listen, bg="#172732", fg=CYAN, relief="flat", font=("Consolas", 8, "bold"), padx=9, pady=8, cursor="hand2").pack(side="right", padx=(0, 5))
        tk.Button(row, text="SEND", command=self.send, bg="#273dd3", fg="white", activebackground=BLUE, activeforeground="white", relief="flat", font=("Consolas", 8, "bold"), padx=12, pady=8, cursor="hand2").pack(side="right")

        settings = tk.Frame(self.root, bg="#0b141c")
        settings.grid(row=4, column=0, sticky="ew", padx=1, pady=(0, 1))
        self.model_var = tk.StringVar(value=self.settings["model"])
        self.model_entry = tk.Entry(settings, textvariable=self.model_var, bg="#111e2a", fg=MUTED, insertbackground=CYAN, relief="flat", font=("Consolas", 8))
        self.model_entry.pack(side="left", fill="x", expand=True, padx=(9, 4), pady=8, ipady=5)
        tk.Button(settings, text="SAVE MODEL", command=self.save_model, bg="#172732", fg=CYAN, relief="flat", font=("Consolas", 7, "bold"), padx=8, cursor="hand2").pack(side="left", padx=(0, 5))
        self.voice_button = tk.Button(settings, text="VOICE ON", command=self._toggle_voice, bg="#172732", fg=GREEN, relief="flat", font=("Consolas", 7, "bold"), padx=8, cursor="hand2")
        self.voice_button.pack(side="right", padx=(0, 9))

    def _append(self, who, message, store=True):
        if store:
            self.messages.append((who, message))
            self.messages = self.messages[-40:]
        if not self.expanded or not hasattr(self, "chat") or not self.chat.winfo_exists(): return
        self.chat.configure(state="normal")
        self.chat.insert("end", who + "\n", "you" if who == "YOU" else "cyrus")
        self.chat.insert("end", message + "\n\n", "body")
        self.chat.see("end")
        self.chat.configure(state="disabled")

    def send(self):
        message = self.entry.get().strip()
        if not message or self.busy: return
        self.entry.delete(0, "end")
        self._append("YOU", message)
        self.busy = True
        self.status.configure(text="CYRUS IS THINKING…", fg=GREEN)
        threading.Thread(target=self._ask, args=(message,), daemon=True).start()

    def _ask(self, message):
        endpoint = self.settings["endpoint"].rstrip("/")
        model = self.settings["model"].strip()
        if not model:
            try:
                req = urllib.request.Request(endpoint + "/api/tags", headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=4) as response:
                    models = json.loads(response.read().decode()).get("models", [])
                    model = models[0]["name"] if models else ""
                    if model: self.settings["model"] = model
            except Exception:
                pass

        if not model:
            self.events.put(("error", "I couldn't reach Ollama. Start Ollama and install a chat model, then ask me again."))
            return

        history = [{"role": "system", "content": "You are SCOTCH, a confident, warm and thoughtful desktop AI companion for K Rithvik. Answer naturally and directly. Help with any topic. You are a small native Windows companion that follows the user across websites. If asked who made you, say K Rithvik made you. If asked your name, say Scotch."}]
        history.extend({"role": "user" if who == "YOU" else "assistant", "content": text} for who, text in self.messages[-14:])

        payload = json.dumps({"model": model, "messages": history, "stream": False, "options": {"temperature": .65, "num_predict": 500}}).encode()
        request = urllib.request.Request(endpoint + "/api/chat", data=payload, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.loads(response.read().decode())
            answer = result.get("message", {}).get("content", "").strip()
            if not answer: raise RuntimeError("The model returned an empty answer.")
            self.events.put(("answer", answer, model))
            if self.voice_on: threading.Thread(target=self._speak, args=(answer,), daemon=True).start()
        except urllib.error.URLError as error:
            self.events.put(("error", f"I couldn't reach Ollama at {endpoint}. Check that it's running. ({error.reason})"))
        except Exception as error:
            self.events.put(("error", f"That request didn't complete: {error}"))

    def listen(self):
        self.status.configure(text="LISTENING · SPEAK NOW", fg=GREEN)
        threading.Thread(target=self._recognize, daemon=True).start()

    def _recognize(self):
        script = "Add-Type -AssemblyName System.Speech; $r=New-Object System.Speech.Recognition.SpeechRecognitionEngine; $r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)); $r.SetInputToDefaultAudioDevice(); $x=$r.Recognize([TimeSpan]::FromSeconds(12)); if ($x) { [Console]::Out.Write($x.Text) }"
        try:
            result = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, timeout=16, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            phrase = result.stdout.strip()
            if result.returncode != 0:
                detail = result.stderr.strip().splitlines()[-1:] or ["Windows speech recognition is unavailable."]
                self.events.put(("mic_error", detail[0][-180:]))
            elif phrase:
                self.events.put(("heard", phrase))
            else:
                self.events.put(("mic_error", "I didn't catch that. Try again or type your question."))
        except Exception as error:
            self.events.put(("mic_error", f"Microphone recognition unavailable: {error}"))

    def _speak(self, text):
        # Windows built-in speech; answer text travels through stdin, never a shell command.
        script = "Add-Type -AssemblyName System.Speech; $v=New-Object System.Speech.Synthesis.SpeechSynthesizer; try {$v.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female)} catch {}; $v.Rate=1; $v.Speak([Console]::In.ReadToEnd())"
        try: subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], input=text, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception: pass

    def _drain_events(self):
        try:
            while True:
                event = self.events.get_nowait()
                if event[0] == "answer":
                    _, answer, model = event
                    self._append("CYRUS", answer)
                    self.settings["model"] = model
                    if self.expanded:
                        self.status_line.configure(text=f"OLLAMA · {model}")
                        self.status.configure(text="READY WHEN YOU ARE", fg=CYAN)
                elif event[0] == "heard":
                    if self.expanded:
                        self.entry.delete(0, "end")
                        self.entry.insert(0, event[1])
                        self.status.configure(text="VOICE CAPTURED · REVIEW AND SEND", fg=CYAN)
                    else:
                        self._last_heard_lowercase = event[1]
                elif event[0] == "mic_error":
                    if self.expanded: self.status.configure(text=event[1][:72], fg="#ffbb69")
                else:
                    self._append("CYRUS", event[1])
                    if self.expanded: self.status.configure(text="CHECK LOCAL AI CONNECTION", fg="#ffbb69")
                self.busy = False
        except queue.Empty: pass
        if self.root.winfo_exists(): self.root.after(80, self._drain_events)

    def save_model(self):
        self.settings["model"] = self.model_var.get().strip()
        APP_DIR.mkdir(parents=True, exist_ok=True)
        SETTINGS_PATH.write_text(json.dumps(self.settings, indent=2), encoding="utf-8")
        self.status_line.configure(text="OLLAMA · " + (self.settings["model"] or "AUTO MODEL DISCOVERY"))
        self.status.configure(text="MODEL PREFERENCE SAVED", fg=GREEN)

    def _toggle_voice(self):
        self.voice_on = not self.voice_on
        self.voice_button.configure(text="VOICE ON" if self.voice_on else "VOICE OFF", fg=GREEN if self.voice_on else MUTED)

    def _bubble_menu(self, event):
        menu = tk.Menu(self.root, tearoff=False, bg=PANEL, fg=TEXT, activebackground=BLUE, activeforeground="white")
        menu.add_command(label="Open Scotch", command=self.expand)
        menu.add_command(label="Quit Scotch", command=self.root.destroy)
        menu.tk_popup(event.x_root, event.y_root)

    def _toggle_pin(self):
        current = str(self.root.attributes("-topmost")).lower() in ("1", "true")
        pinned = not current
        self.root.attributes("-topmost", pinned)
        self.pin_button.configure(text="PIN" if pinned else "FLOAT", fg=GREEN if pinned else MUTED)

    def _on_hotkey(self):
        now = self.root.winfo_exists()
        if not now:
            return
        if self.expanded:
            self.collapse()
            return
        self.expand()

    def _wake_poll(self):
        if not self.root.winfo_exists():
            return
        if not self.always_listen:
            self.root.after(60, self._wake_poll)
            return

        phrase = self._last_heard_lowercase.strip()
        tick = self.root.tk.call("clock", "seconds")

        if phrase:
            if phrase.startswith("hey scotch"):
                self._on_hotkey()
                self._say("I'm here.")

            lowered_and_clean = phrase.lower().replace("_", " ").strip()
            wake = lowered_and_clean.split(" ", 1)[0] if " " in lowered_and_clean else lowered_and_clean
            if wake in ("hey", "hi", "hello", "ok", "okay", "yo"):
                if "cyrus" in lowered_and_clean.split(" ", 1)[1] if " " in lowered_and_clean else False:
                    self._on_hotkey()
                    self._say("I'm listening.")

            self._last_heard_lowercase = ""

        self.root.after(60, self._wake_poll)

    def _say(self, text):
        if not self.voice_on:
            return
        try:
            script = "Add-Type -AssemblyName System.Speech; $v=New-Object System.Speech.Synthesis.SpeechSynthesizer; try {$v.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female)} catch {}; $v.Speak([Console]::In.ReadToEnd())"
            subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], input=text, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except Exception:
            pass

    def _hotkey_bind_cleanup(self):
        pass


if __name__ == "__main__":
    try:
        CyrusCompanion()
    except BaseException as error:
        try:
            APP_DIR.mkdir(parents=True, exist_ok=True)
            (APP_DIR / "startup-error.log").write_text(repr(error), encoding="utf-8")
        except OSError:
            pass
        raise
