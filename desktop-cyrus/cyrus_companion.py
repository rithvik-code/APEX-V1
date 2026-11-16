"""CYRUS desktop companion for Windows. Uses Tkinter and Python's standard library."""
from __future__ import annotations

import json
import math
import os
import queue
import subprocess
import threading
import urllib.error
import urllib.request
import random
from pathlib import Path
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageDraw, ImageFilter, ImageTk


BG = "#071016"
PANEL = "#0b151d"
BLUE = "#526dff"
CYAN = "#83edff"
TEXT = "#e9f3f8"
MUTED = "#8ca2ae"
GREEN = "#b7fa42"
TRANSPARENT = "#010101"
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


def discover_ollama_model(endpoint):
    """Prefer a model currently loaded by this Ollama server, then its first installed model."""
    for route, key in (("/api/ps", "models"), ("/api/tags", "models")):
        req = urllib.request.Request(endpoint.rstrip("/") + route, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as response:
            models = json.loads(response.read().decode()).get(key, [])
        if models:
            return str(models[0].get("name") or models[0].get("model") or "").strip()
    return ""


class CyrusCompanion:
    # Tk uses Mod1 for the Alt key on Windows; "Alt" is parsed as an event name.
    HOTKEY = "<Control-Mod1-c>"

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("CYRUS Desktop Companion")
        self.root.configure(bg=BG)
        self.root.attributes("-topmost", True)
        self.root.overrideredirect(True)
        self.settings = read_settings()
        self.events = queue.Queue()
        self.messages = []
        self.expanded = False
        self.busy = False
        self.voice_on = False
        self.always_listen = True
        self._drag = None
        self._bubble_pointer = None
        self._wake_repeat_until = 0.0
        self._last_heard_lowercase = ""
        self.bubble = None
        self.actions_visible = False
        self.auto_send_voice = False
        self.anim_tick = 0
        self._hover_after = None
        self.hovering = False
        self._last_pet_motion = 0.0
        self._wander_target = None
        self.walking = False
        self._sprite_photo = None
        self.root.wm_attributes("-transparentcolor", TRANSPARENT)
        self._draw_bubble()
        # Key-sequence parsing differs across bundled Windows Tk versions.
        # A malformed optional shortcut must never prevent the desktop pet opening.
        try:
            self.root.bind(self.HOTKEY, lambda _e: self._on_hotkey(), "+")
        except tk.TclError:
            pass
        self.root.bind("<Escape>", lambda _e: self.collapse())
        self.root.after(120, self._animate_bubble)
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
        # Render a shaded, orthographic 3D-style dog into a transparent sprite.
        # Supersampling keeps the rounded toy-like forms crisp at desktop size.
        frame = self.anim_tick if animated else 0
        w, h, k = 104, 104, 3
        im = Image.new("RGBA", (w*k, h*k), (0, 0, 0, 0))
        d = ImageDraw.Draw(im, "RGBA")
        yaw = math.sin(frame * .045) * 2.2
        lift = math.sin(frame * .09) * 1.3
        def p(x, y): return (x + (y-52)*yaw/52, y + lift)
        def poly(points, fill, edge=None):
            pts = [(round(x*k), round(y*k)) for x,y in points]
            d.polygon(pts, fill=fill)
            if edge: d.line(pts+[pts[0]], fill=edge, width=2*k)
        def ellipse(bounds, fill, edge=None):
            b = tuple(round(v*k) for v in bounds)
            d.ellipse(b, fill=fill, outline=edge, width=2*k if edge else 1)
        def rounded(bounds, radius, fill, edge=None):
            b = tuple(round(v*k) for v in bounds)
            d.rounded_rectangle(b, radius=radius*k, fill=fill, outline=edge, width=2*k if edge else 1)

        # soft contact shadow, not a circle or badge behind the character
        shadow = Image.new("RGBA", im.size, (0,0,0,0))
        ImageDraw.Draw(shadow, "RGBA").ellipse((22*k,87*k,85*k,97*k), fill=(10,15,20,68))
        im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(4*k)))
        # Side profile: the little tail sits at the left, with the muzzle facing right.
        wag = math.sin(frame * .42) * (16 if self.hovering else 2)
        d.line([p(31,52), p(22,49+wag*.25), p(13,42+wag), p(7,45+wag)], fill=(205,203,197,255), width=6*k, joint="curve")
        d.line([p(29,52), p(22,49+wag*.25)], fill=(255,255,249,255), width=3*k)
        step = math.sin(frame * .72) * 3 if self.walking else 0
        # Far legs first, then the long body and the near legs.
        rounded((*p(39-step,62),*p(48-step,84)), 4, (224,223,217,255), (198,197,191,255))
        rounded((*p(69+step,62),*p(78+step,83)), 4, (227,226,220,255), (198,197,191,255))
        rounded((*p(25,39),*p(77,68)), 13, (252,251,246,255), (216,215,209,255))
        rounded((*p(31+step,64),*p(43+step,89)), 4, (250,249,244,255), (209,208,202,255))
        rounded((*p(66-step,63),*p(79-step,89)), 4, (247,246,241,255), (207,206,200,255))
        d.line([p(27,53), p(22,51+wag*.2)], fill=(252,251,246,255), width=5*k)
        # Neck, upright ear and profile head.
        poly([p(61,42),p(72,39),p(78,63),p(67,68)], (232,231,225,255), (205,204,198,255))
        poly([p(63,28),p(68,17),p(77,27),p(74,43),p(64,43)], (231,230,224,255), (202,201,195,255))
        ellipse((*p(59,17),*p(87,53)), (253,252,247,255), (215,214,208,255))
        ellipse((*p(65,19),*p(75,27)), (255,255,255,150))
        shift = math.sin(frame*.045)*.5
        ellipse((*p(78+shift,31),*p(82+shift,36)), (112,110,104,255))
        # Forward muzzle, dark nose and a slight happy mouth line.
        poly([p(78,36),p(96,38),p(99,46),p(94,52),p(78,49)], (239,238,232,255), (211,210,204,255))
        ellipse((*p(95,39),*p(100,44)), (91,90,87,255))
        d.line([p(84,48),p(90,50),p(94,48)], fill=(150,147,141,255), width=1*k)
        d.arc((57*k,15*k,89*k,55*k), 195, 282, fill=(255,255,255,190), width=2*k)
        im = im.resize((w, h), Image.Resampling.LANCZOS)
        if scale != 1:
            im = im.resize((max(1, round(w*scale)), max(1, round(h*scale))), Image.Resampling.LANCZOS)
        self._sprite_photo = ImageTk.PhotoImage(im)
        canvas.create_image(cx, cy, image=self._sprite_photo, anchor="center")

    def _draw_bubble(self):
        c = self.bubble
        if c is None:
            x = max(12, self.root.winfo_screenwidth() - 202)
            y = max(12, self.root.winfo_screenheight() - 260)
            self.root.geometry(f"190x122+{x}+{y}")
            self.root.configure(bg=TRANSPARENT, highlightthickness=0)
            c = tk.Canvas(self.root, width=190, height=122, bg=TRANSPARENT, highlightthickness=0)
            self.bubble = c
            c.pack()
        else:
            c.pack()
            c.delete("all")
        self.anim_tick += 1
        bob = math.sin(self.anim_tick / 8) * 1.7
        # The mascot floats directly on the transparent desktop; no badge or disc.
        self._scotch(c, 47, 48 + bob, .70, True)
        c.create_text(47, 108, text="CYRUS", fill=TEXT, font=("Segoe UI Semibold", 8, "bold"))
        if self.actions_visible:
            self._action_pill(c, 105, 31, 187, 65, "TALK TO CYRUS", "talk")
            self._action_pill(c, 105, 72, 187, 106, "TEXT CYRUS", "text")
        c.bind("<ButtonPress-1>", self._bubble_press)
        c.bind("<B1-Motion>", self._bubble_move)
        c.bind("<ButtonRelease-1>", self._bubble_release)
        c.bind("<Button-3>", self._bubble_menu)
        c.bind("<Double-Button-1>", lambda _e: self.expand())
        c.bind("<Enter>", self._bubble_enter)
        c.bind("<Leave>", self._bubble_leave)
        c.configure(cursor="hand2")

    def _action_pill(self, canvas, x1, y1, x2, y2, label, action):
        canvas.create_rectangle(x1, y1, x2, y2, fill="#101c29", outline="#526dff", width=1, tags=(action,))
        canvas.create_text((x1+x2)//2, (y1+y2)//2, text=label, fill=CYAN if action == "talk" else TEXT, font=("Segoe UI Semibold", 8, "bold"), tags=(action,))
        canvas.tag_bind(action, "<Enter>", lambda _event, name=action: self._highlight_action(name, True))
        canvas.tag_bind(action, "<Leave>", lambda _event, name=action: self._highlight_action(name, False))

    def _highlight_action(self, action, hovered):
        if self.bubble is None:
            return
        self.bubble.itemconfigure(action, fill="#2944df" if hovered else "#101c29")

    def _animate_bubble(self):
        if self.expanded: return
        self._wander_if_idle()
        self._draw_bubble()
        self.root.after(120, self._animate_bubble)

    def _wander_if_idle(self):
        import time
        now = time.monotonic()
        if self.hovering or self._bubble_pointer or now - self._last_pet_motion < 10:
            self._wander_target = None
            self.walking = False
            return
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        x, y = self.root.winfo_x(), self.root.winfo_y()
        if self._wander_target is None or (abs(self._wander_target[0]-x) < 8 and abs(self._wander_target[1]-y) < 8):
            self._wander_target = (random.randint(12, max(13, sw-205)), random.randint(12, max(13, sh-150)))
        tx, ty = self._wander_target
        dx, dy = tx-x, ty-y
        distance = max(1.0, math.hypot(dx, dy))
        self.walking = distance > 8
        self.root.geometry(f"+{round(x+dx/distance*2)}+{round(y+dy/distance*2)}")

    def _bubble_enter(self, _event):
        self.hovering = True
        self._last_pet_motion = __import__("time").monotonic()
        if self._hover_after:
            self.root.after_cancel(self._hover_after)
            self._hover_after = None
        if not self.actions_visible:
            self.actions_visible = True
            self._draw_bubble()

    def _bubble_leave(self, _event):
        self.hovering = False
        self._last_pet_motion = __import__("time").monotonic()
        if self._hover_after:
            self.root.after_cancel(self._hover_after)
        self._hover_after = self.root.after(420, self._hide_actions)

    def _hide_actions(self):
        self._hover_after = None
        if self.expanded or not self.actions_visible: return
        px, py = self.root.winfo_pointerxy()
        inside = self.root.winfo_rootx() <= px < self.root.winfo_rootx()+self.root.winfo_width() and self.root.winfo_rooty() <= py < self.root.winfo_rooty()+self.root.winfo_height()
        if not inside:
            self.actions_visible = False
            self._draw_bubble()

    def _talk_action(self):
        self.expand()
        self.auto_send_voice = True
        self.root.after(160, lambda: self.listen(auto_send=True))

    def _text_action(self):
        self.expand()
        self.root.after(100, self.entry.focus_force)

    def _start_drag(self, event):
        self._drag = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def _bubble_press(self, event):
        self._last_pet_motion = __import__("time").monotonic()
        self._bubble_pointer = [event.x_root, event.y_root, self.root.winfo_x(), self.root.winfo_y(), False]

    def _bubble_move(self, event):
        if self._bubble_pointer is None: return
        dx, dy = event.x_root-self._bubble_pointer[0], event.y_root-self._bubble_pointer[1]
        if abs(dx) + abs(dy) > 5: self._bubble_pointer[4] = True
        if self._bubble_pointer[4]:
            self.root.geometry(f"+{self._bubble_pointer[2]+dx}+{self._bubble_pointer[3]+dy}")

    def _bubble_release(self, _event):
        pointer, self._bubble_pointer = self._bubble_pointer, None
        if not pointer or pointer[4]: return
        x, y = self.root.winfo_pointerxy()
        x -= self.root.winfo_rootx()
        y -= self.root.winfo_rooty()
        if self.actions_visible and 105 <= x <= 187 and 31 <= y <= 65:
            self._talk_action()
        elif self.actions_visible and 105 <= x <= 187 and 72 <= y <= 106:
            self._text_action()
        else:
            self.expand()

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
        self.actions_visible = False
        if self.bubble is not None: self.bubble.pack_forget()
        self.root.overrideredirect(False)
        self.root.configure(bg=BG, highlightthickness=1, highlightbackground="#334fff")
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
        self.actions_visible = False
        for child in self.root.winfo_children(): child.destroy()
        self.bubble = None
        self.root.overrideredirect(True)
        self.root.configure(bg=TRANSPARENT, highlightthickness=0)
        self._draw_bubble()
        self.root.after(120, self._animate_bubble)

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
        tk.Label(identity, text="CYRUS", fg=TEXT, bg="#111e2e", font=("Segoe UI Semibold", 15, "bold")).pack(anchor="w")
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

        self.chat = tk.Text(self.root, bg="#08111b", fg=TEXT, insertbackground=CYAN, relief="flat", wrap="word", padx=16, pady=14, font=("Segoe UI", 10), spacing3=6, state="disabled", borderwidth=0)
        self.chat.grid(row=1, column=0, sticky="nsew", padx=1)
        self.chat.tag_configure("you", foreground="#91ff70", font=("Segoe UI Semibold", 9, "bold"), spacing1=5)
        self.chat.tag_configure("cyrus", foreground="#67e7ff", font=("Segoe UI Semibold", 9, "bold"), spacing1=5)
        self.chat.tag_configure("body", foreground="#e5f1fb", lmargin1=8, lmargin2=8, spacing3=9)
        if not self.messages: self._append("CYRUS", "Hey. I'm right here on your desktop. Ask me anything.", False)
        else:
            for who, message in self.messages: self._append(who, message, False)

        self.status_line = tk.Label(self.root, text="OLLAMA · " + (self.settings["model"] or "CHOOSE A MODEL BELOW"), fg=MUTED, bg=BG, anchor="w", padx=12, font=("Consolas", 7))
        self.status_line.grid(row=2, column=0, sticky="ew", pady=(3, 4))
        row = tk.Frame(self.root, bg="#0b1520", highlightthickness=1, highlightbackground="#243c52")
        row.grid(row=3, column=0, sticky="ew", padx=9, pady=(0, 9))
        self.entry = tk.Entry(row, bg="#0b1520", fg=TEXT, insertbackground=CYAN, relief="flat", font=("Segoe UI", 10))
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
        self.status.configure(text="● CONNECTED  ·  THINKING", fg=GREEN)
        threading.Thread(target=self._ask, args=(message,), daemon=True).start()

    def _ask(self, message):
        endpoint = self.settings["endpoint"].rstrip("/")
        try:
            # Never pin Cyrus to a stale saved model: follow the active server each request.
            model = discover_ollama_model(endpoint)
            if model:
                self.settings["model"] = model
        except Exception:
            model = ""

        if not model:
            self.events.put(("error", "I couldn't reach Ollama. Start Ollama and install a chat model, then ask me again."))
            return

        history = [{"role": "system", "content": "You are Cyrus, a confident, warm, concise female desktop AI companion for K Rithvik. Output only the final answer. Never reveal internal reasoning or narrate thoughts. Answer directly in one to three short sentences. Help with any topic. You live on this Windows desktop and are the companion for the APEX/CYRUS OS project; use that context when relevant, but never pretend you can inspect files or control apps unless a connected tool actually did so. If asked who made you, say K Rithvik. If asked your name, say Cyrus."}]
        history.extend({"role": "user" if who == "YOU" else "assistant", "content": text} for who, text in self.messages[-14:])

        payload = json.dumps({"model": model, "messages": history, "stream": True, "think": False, "keep_alive": "24h", "options": {"temperature": .35, "num_predict": 120}}).encode()
        request = urllib.request.Request(endpoint + "/api/chat", data=payload, headers={"Content-Type": "application/json"}, method="POST")
        try:
            parts = []
            with urllib.request.urlopen(request, timeout=120) as response:
                for raw_line in response:
                    if not raw_line.strip():
                        continue
                    packet = json.loads(raw_line)
                    token = packet.get("message", {}).get("content", "")
                    if token:
                        parts.append(token)
                        self.events.put(("token", token))
            answer = "".join(parts).strip()
            if not answer: raise RuntimeError("The model returned an empty answer.")
            self.events.put(("answer", answer, model))
            if self.voice_on: threading.Thread(target=self._speak, args=(answer,), daemon=True).start()
        except urllib.error.URLError as error:
            self.events.put(("error", f"I couldn't reach Ollama at {endpoint}. Check that it's running. ({error.reason})"))
        except Exception as error:
            self.events.put(("error", f"That request didn't complete: {error}"))

    def listen(self, auto_send=False):
        self.auto_send_voice = auto_send
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
                    self.messages.append(("CYRUS", answer))
                    self.messages = self.messages[-40:]
                    self.settings["model"] = model
                    if self.expanded:
                        self.status_line.configure(text=f"OLLAMA · {model}")
                        self.status.configure(text="READY WHEN YOU ARE", fg=CYAN)
                    if self.expanded:
                        self.chat.configure(state="normal")
                        self.chat.insert("end", "\n\n")
                        self.chat.configure(state="disabled")
                elif event[0] == "token":
                    if self.expanded:
                        self.chat.configure(state="normal")
                        self.chat.insert("end", event[1], "body")
                        self.chat.see("end")
                        self.chat.configure(state="disabled")
                elif event[0] == "heard":
                    if self.expanded:
                        self.entry.delete(0, "end")
                        self.entry.insert(0, event[1])
                        if self.auto_send_voice:
                            self.auto_send_voice = False
                            self.status.configure(text="VOICE CAPTURED · SENDING…", fg=CYAN)
                            self.root.after(120, self.send)
                        else:
                            self.status.configure(text="VOICE CAPTURED · REVIEW AND SEND", fg=CYAN)
                    else:
                        self._last_heard_lowercase = event[1]
                elif event[0] == "mic_error":
                    if self.expanded: self.status.configure(text=event[1][:72], fg="#ffbb69")
                else:
                    self._append("CYRUS", event[1])
                    if self.expanded:
                        self.status.configure(text="CHECK LOCAL AI CONNECTION", fg="#ffbb69")
                        self.chat.configure(state="normal")
                        self.chat.insert("end", "\n\n")
                        self.chat.configure(state="disabled")
                if event[0] in ("answer", "error"):
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
        menu.add_command(label="Open Cyrus", command=self.expand)
        menu.add_command(label="Quit Cyrus", command=self.root.destroy)
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
