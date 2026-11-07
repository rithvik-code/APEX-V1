import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { psB64, runPowerShell, runPowerShellJson } from "./powershell.mjs";

const NATIVE = String.raw`
using System;
using System.Runtime.InteropServices;

public static class ApexNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }

  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags;
    public uint time; public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public uint dwFlags;
    public uint time; public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT {
    public uint uMsg; public ushort wParamL; public ushort wParamH;
  }

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);

  static INPUT KeyInput(ushort vk, bool up) {
    INPUT input = new INPUT();
    input.type = 1;
    input.U.ki.wVk = vk;
    input.U.ki.wScan = 0;
    input.U.ki.dwFlags = up ? 2u : 0u;
    return input;
  }

  static void SendKey(ushort vk, bool up) {
    INPUT[] inputs = new INPUT[] { KeyInput(vk, up) };
    SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static void KeyDown(ushort vk) { SendKey(vk, false); }
  public static void KeyUp(ushort vk) { SendKey(vk, true); }

  public static void Move(int x, int y) { SetCursorPos(x, y); }

  public static void Click(int x, int y, int button, int count) {
    SetCursorPos(x, y);
    uint down = button == 1 ? 8u : (button == 2 ? 32u : 2u);
    uint up = button == 1 ? 16u : (button == 2 ? 64u : 4u);
    for (int i = 0; i < count; i++) {
      mouse_event(down, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(40);
      mouse_event(up, 0, 0, 0, UIntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(80);
    }
  }

  public static void Scroll(int x, int y, int delta) {
    SetCursorPos(x, y);
    mouse_event(0x0800u, 0, 0, (uint)delta, UIntPtr.Zero);
  }

  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0002u, 0, 0, 0, UIntPtr.Zero);
    for (int i = 1; i <= 14; i++) {
      int x = x1 + (x2 - x1) * i / 14;
      int y = y1 + (y2 - y1) * i / 14;
      SetCursorPos(x, y);
      System.Threading.Thread.Sleep(16);
    }
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004u, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Type(string text) {
    foreach (char ch in text) {
      if (ch == '\r') continue;
      if (ch == '\n') { SendKey(0x0D, false); SendKey(0x0D, true); continue; }
      if (ch == '\t') { SendKey(0x09, false); SendKey(0x09, true); continue; }
      INPUT down = new INPUT();
      down.type = 1;
      down.U.ki.wScan = ch;
      down.U.ki.dwFlags = 0x0004u;
      INPUT up = new INPUT();
      up.type = 1;
      up.U.ki.wScan = ch;
      up.U.ki.dwFlags = 0x0004u | 0x0002u;
      SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(6);
    }
  }
}
`;

const PRELUDE = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
${NATIVE}
"@
`;

const shots = [];
const MAX_SHOTS = 12;

function decode(value) {
  return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${psB64(value)}'))`;
}

export async function screenInfo(signal) {
  return runPowerShellJson(
    `${PRELUDE}
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
@{ x = $b.X; y = $b.Y; w = $b.Width; h = $b.Height } | ConvertTo-Json -Compress`,
    { timeoutMs: 15000, signal },
  );
}

export async function capture({ quality = 68, maxWidth = 0, signal } = {}) {
  const file = path.join(
    os.tmpdir(),
    `apex-shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`,
  );
  const safeFile = file.replace(/\\/g, "/");
  const output = await runPowerShellJson(
    `${PRELUDE}
$q = [long]${Math.max(30, Math.min(92, Number(quality) || 68))}
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$maxW = ${Math.max(0, Number(maxWidth) || 0)}
if ($maxW -gt 0 -and $bmp.Width -gt $maxW) {
  $scale = $maxW / $bmp.Width
  $nw = [int]($bmp.Width * $scale)
  $nh = [int]($bmp.Height * $scale)
  $small = New-Object Drawing.Bitmap($nw, $nh)
  $sg = [Drawing.Graphics]::FromImage($small)
  $sg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.DrawImage($bmp, 0, 0, $nw, $nh)
  $gfx.Dispose()
  $bmp.Dispose()
  $bmp = $small
  $gfx = $sg
}
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, $q)
$out = ${decode(safeFile)}
$bmp.Save($out, $codec, $params)
$w = $bmp.Width
$h = $bmp.Height
$gfx.Dispose()
$bmp.Dispose()
@{ path = $out; width = $w; height = $h; bytes = (Get-Item $out).Length; ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress`,
    { timeoutMs: 30000, signal },
  );
  shots.push(output.path);
  while (shots.length > MAX_SHOTS) {
    const old = shots.shift();
    try {
      fs.unlinkSync(old);
    } catch {
      // Already gone.
    }
  }
  return output;
}

/* -------------------------------------------------------------------------- */
/* LIVE FEED — one persistent PowerShell process streaming frames to disk      */
/* -------------------------------------------------------------------------- */

const LIVE_DIR = path.join(os.tmpdir(), "apex-live");
const LIVE_MAX_W = 1280;

const live = {
  proc: null,
  starting: false,
  users: 0,
  idleTimer: null,
  restartTimer: null,
  files: [],
  buffer: null,
  width: 0,
  height: 0,
  version: 0,
  updatedAt: 0,
  times: [],
  lastError: "",
  onFrame: null,
};

function handleLiveLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] === "E") {
    live.lastError = parts.slice(1).join(" ").slice(0, 200);
    return;
  }
  if (parts[0] !== "F") return;
  const width = Number(parts[1]);
  const height = Number(parts[2]);
  const index = Number(parts[3]);
  const file = live.files[index];
  if (!file || !width || !height) return;
  fs.readFile(file, (error, buffer) => {
    if (error) return;
    live.buffer = buffer;
    live.width = width;
    live.height = height;
    live.version += 1;
    live.updatedAt = Date.now();
    live.times.push(live.updatedAt);
    while (live.times.length > 24) live.times.shift();
    try {
      live.onFrame?.(getLiveFrame());
    } catch {
      // A broken frame consumer must not kill the feed.
    }
  });
}

export function ensureLiveFeed() {
  if (live.proc || live.starting) return;
  live.starting = true;
  try {
    fs.mkdirSync(LIVE_DIR, { recursive: true });
    live.files = [path.join(LIVE_DIR, "a.jpg"), path.join(LIVE_DIR, "b.jpg")];
    const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$out0 = ${decode(live.files[0].replace(/\\/g, "/"))}
$out1 = ${decode(live.files[1].replace(/\\/g, "/"))}
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$maxW = ${LIVE_MAX_W}
$flip = 0
while ($true) {
  try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object Drawing.Bitmap($bounds.Width, $bounds.Height)
    $gfx = [Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
    $gfx.Dispose()
    if ($bmp.Width -gt $maxW) {
      $scale = $maxW / $bmp.Width
      $nw = [int]($bmp.Width * $scale)
      $nh = [int]($bmp.Height * $scale)
      $small = New-Object Drawing.Bitmap($nw, $nh)
      $sg = [Drawing.Graphics]::FromImage($small)
      $sg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $sg.DrawImage($bmp, 0, 0, $nw, $nh)
      $sg.Dispose()
      $bmp.Dispose()
      $bmp = $small
    }
    $params = New-Object Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]55)
    $framePath = if ($flip -eq 0) { $out0 } else { $out1 }
    $bmp.Save($framePath, $codec, $params)
    $params.Dispose()
    $w = $bmp.Width
    $h = $bmp.Height
    $bmp.Dispose()
    [Console]::Out.WriteLine("F $w $h $flip")
    [Console]::Out.Flush()
    $flip = 1 - $flip
  } catch {
    $msg = ($_.Exception.Message -replace "[\\r\\n]+", " ")
    [Console]::Out.WriteLine("E $msg")
    [Console]::Out.Flush()
    Start-Sleep -Milliseconds 800
  }
  Start-Sleep -Milliseconds 60
}`;
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    live.proc = child;
    let lineBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) handleLiveLine(line);
    });
    child.stderr.on("data", () => {});
    child.on("close", () => {
      if (live.proc === child) live.proc = null;
      live.starting = false;
      if (live.users > 0 && !live.restartTimer) {
        live.restartTimer = setTimeout(() => {
          live.restartTimer = null;
          ensureLiveFeed();
        }, 2000);
      }
    });
  } finally {
    live.starting = false;
  }
}

export function getLiveFrame() {
  if (!live.buffer) return null;
  let fps = 0;
  if (live.times.length >= 2) {
    const span = (live.times[live.times.length - 1] - live.times[0]) / 1000;
    if (span > 0) fps = (live.times.length - 1) / span;
  }
  return {
    buffer: live.buffer,
    width: live.width,
    height: live.height,
    version: live.version,
    ts: live.updatedAt,
    fps: Math.round(fps * 10) / 10,
    ageMs: Date.now() - live.updatedAt,
  };
}

export function retainLive() {
  live.users += 1;
  if (live.idleTimer) {
    clearTimeout(live.idleTimer);
    live.idleTimer = null;
  }
  ensureLiveFeed();
}

export function releaseLive() {
  live.users = Math.max(0, live.users - 1);
  if (live.users === 0 && !live.idleTimer) {
    live.idleTimer = setTimeout(() => {
      live.idleTimer = null;
      stopLiveFeed();
    }, 12_000);
  }
}

export function stopLiveFeed() {
  if (live.restartTimer) {
    clearTimeout(live.restartTimer);
    live.restartTimer = null;
  }
  if (live.proc) {
    try {
      live.proc.kill();
    } catch {
      // Already gone.
    }
    live.proc = null;
  }
  live.buffer = null;
  live.times = [];
}

export function setLiveFrameHandler(handler) {
  live.onFrame = typeof handler === "function" ? handler : null;
}

export function liveInfo() {
  const frame = getLiveFrame();
  return {
    active: Boolean(live.proc),
    users: live.users,
    fps: frame?.fps ?? 0,
    ageMs: frame?.ageMs ?? null,
    lastError: live.lastError,
  };
}

/* -------------------------------------------------------------------------- */
/* OCR — Windows.Media.Ocr over the live frame or a fresh full-res capture     */
/* -------------------------------------------------------------------------- */

export async function ocrScreen({ screen, framePath, scale = 1, signal } = {}) {
  let useFrame = "";
  let originX = 0;
  let originY = 0;
  let scaleValue = 1;
  if (framePath && fs.existsSync(framePath)) {
    useFrame = framePath.replace(/\\/g, "/");
    scaleValue = Number(scale) || 1;
    if (screen) {
      originX = Number(screen.x) || 0;
      originY = Number(screen.y) || 0;
    }
  }
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
$ox = ${originX}
$oy = ${originY}
$scale = ${scaleValue}
$bytes = $null
$fromFile = ${useFrame ? "$true" : "$false"}
if ($fromFile) {
  $bytes = [IO.File]::ReadAllBytes(${decode(useFrame)})
} else {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $bmp = New-Object Drawing.Bitmap($bounds.Width, $bounds.Height)
  $gfx = [Drawing.Graphics]::FromImage($bmp)
  $gfx.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
  $gfx.Dispose()
  $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
  $params = New-Object Drawing.Imaging.EncoderParameters(1)
  $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]85)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, $codec, $params)
  $params.Dispose()
  $bytes = $ms.ToArray()
  $ms.Dispose()
  $bmp.Dispose()
  $ox = $bounds.X
  $oy = $bounds.Y
  $scale = 1
}
$ras = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
$writer = New-Object Windows.Storage.Streams.DataWriter($ras.GetOutputStreamAt(0))
$writer.WriteBytes($bytes)
Await ($writer.StoreAsync()) ([UInt32]) | Out-Null
Await ($writer.FlushAsync()) ([Boolean]) | Out-Null
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  $lang = New-Object Windows.Globalization.Language('en-US')
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
if (-not $engine) { throw 'No Windows OCR language is installed' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) {
  $r = $line.BoundingRect
  $t = $line.Text
  if ($t.Length -gt 240) { $t = $t.Substring(0, 240) }
  $lines += [pscustomobject]@{
    text = $t
    x = [int]($ox + $r.X / $scale)
    y = [int]($oy + $r.Y / $scale)
    w = [int]($r.Width / $scale)
    h = [int]($r.Height / $scale)
  }
}
$full = (@($result.Lines | ForEach-Object { $_.Text }) -join [char]10)
if ($full.Length -gt 8000) { $full = $full.Substring(0, 8000) }
@{ engine = $engine.RecognizedLanguage.ToString(); lines = @($lines | Select-Object -First 80); text = $full } | ConvertTo-Json -Compress -Depth 3`;
  const parsed = await runPowerShellJson(script, { timeoutMs: 30_000, signal });
  return {
    engine: String(parsed.engine ?? ""),
    text: String(parsed.text ?? ""),
    lines: Array.isArray(parsed.lines) ? parsed.lines : [],
  };
}

/* -------------------------------------------------------------------------- */
/* CLIPBOARD                                                                   */
/* -------------------------------------------------------------------------- */

export async function clipboardGet(signal) {
  const parsed = await runPowerShellJson(
    `$ErrorActionPreference = 'Stop'
$text = Get-Clipboard -Raw
if ($null -eq $text) { $text = '' }
if ($text.Length -gt 20000) { $text = $text.Substring(0, 20000) }
@{ text = $text } | ConvertTo-Json -Compress`,
    { timeoutMs: 12_000, signal },
  );
  return { text: String(parsed.text ?? "") };
}

export async function clipboardSet(text, signal) {
  await runPowerShell(
    `$ErrorActionPreference = 'Stop'
$value = ${decode(String(text ?? ""))}
Set-Clipboard -Value $value
'ok'`,
    { timeoutMs: 12_000, signal },
  );
  return { chars: String(text ?? "").length };
}

const WINDOW_SCRIPT = `
$fg = [ApexNative]::GetForegroundWindow()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$list = @()
foreach ($w in $windows) {
  try {
    $r = $w.Current.BoundingRectangle
    if ($r.X -lt -30000 -or $r.Width -le 0) { continue }
    $proc = Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue
    $h = [IntPtr]$w.Current.NativeWindowHandle
    $list += [pscustomobject]@{
      title = $w.Current.Name
      pid = $w.Current.ProcessId
      process = if ($proc) { $proc.ProcessName } else { '' }
      x = [int]$r.X
      y = [int]$r.Y
      w = [int]$r.Width
      h = [int]$r.Height
      handle = [int64]$w.Current.NativeWindowHandle
      active = ($h -eq $fg)
    }
  } catch {}
}
$list = @($list | Sort-Object @{ Expression = 'active'; Descending = $true }, title)
@($list | Select-Object -First 40) | ConvertTo-Json -Compress -Depth 3
`;

export async function listWindows(signal) {
  const output = await runPowerShell(
    `${PRELUDE}
${WINDOW_SCRIPT}`,
    { timeoutMs: 25000, signal },
  );
  const line = output.split(/\r?\n/).filter(Boolean).pop();
  const parsed = line ? JSON.parse(line) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function foreground(signal) {
  const windows = await listWindows(signal);
  return windows.find((w) => w.active) ?? null;
}

export async function observe({
  maxElements = 70,
  maxDepth = 5,
  signal,
} = {}) {
  const output = await runPowerShellJson(
    `${PRELUDE}
${WINDOW_SCRIPT}
$active = @($list | Where-Object { $_.active })[0]
$elements = @()
$focused = $null
if ($active) {
  $windowEl = $null
  foreach ($w in $windows) {
    try {
      if ([int64]$w.Current.NativeWindowHandle -eq [int64]$active.handle) { $windowEl = $w; break }
    } catch {}
  }
  if ($windowEl) {
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@{ el = $windowEl; depth = 0 })
    $limit = ${Math.max(10, Math.min(150, Number(maxElements) || 70))}
    $depthLimit = ${Math.max(1, Math.min(8, Number(maxDepth) || 5))}
    while ($queue.Count -gt 0 -and $elements.Count -lt $limit) {
      $item = $queue.Dequeue()
      $el = $item.el
      try {
        $r = $el.Current.BoundingRectangle
        $type = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\\.', ''
        $name = $el.Current.Name
        if ($r.Width -gt 0 -and $r.Height -gt 0 -and ($name -or $type -in @('Edit','Button','Hyperlink','ListItem','MenuItem','ComboBox','TabItem','CheckBox','RadioButton','Slider','Document','Window'))) {
          $elements += [pscustomobject]@{
            control = $type
            name = if ($name) { $name.Substring(0, [Math]::Min($name.Length, 140)) } else { '' }
            id = $el.Current.AutomationId
            x = [int]$r.X
            y = [int]$r.Y
            w = [int]$r.Width
            h = [int]$r.Height
            enabled = $el.Current.IsEnabled
            focus = $el.Current.HasKeyboardFocus
          }
        }
        if ($item.depth -lt $depthLimit) {
          $child = $walker.GetFirstChild($el)
          while ($child -and $elements.Count -lt $limit) {
            $queue.Enqueue(@{ el = $child; depth = $item.depth + 1 })
            $child = $walker.GetNextSibling($child)
          }
        }
      } catch {}
    }
  }
}
try {
  $f = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($f) {
    $r = $f.Current.BoundingRectangle
    $focused = [pscustomobject]@{
      name = $f.Current.Name
      control = $f.Current.ControlType.ProgrammaticName -replace 'ControlType\\.', ''
      pid = $f.Current.ProcessId
      x = [int]$r.X
      y = [int]$r.Y
      w = [int]$r.Width
      h = [int]$r.Height
    }
    try {
      $pattern = $null
      if ($f.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $focusedValue = $pattern.Current.Value
      } else {
        $pattern = $null
        if ($f.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
          $focusedValue = $pattern.DocumentRange.GetText(1200)
        }
      }
    } catch {}
  }
} catch {}
@{ active = $active; windows = @($list); elements = @($elements); focused = $focused; focusedValue = $focusedValue } | ConvertTo-Json -Compress -Depth 5`,
    { timeoutMs: 40000, signal },
  );
  return output;
}

const VK = {
  ctrl: 0x11,
  control: 0x11,
  shift: 0x10,
  alt: 0x12,
  win: 0x5b,
  windows: 0x5b,
  enter: 0x0d,
  return: 0x0d,
  esc: 0x1b,
  escape: 0x1b,
  tab: 0x09,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  del: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  printscreen: 0x2c,
};

function keyCode(name) {
  const clean = String(name).trim().toLowerCase();
  if (VK[clean]) return VK[clean];
  if (/^f([1-9]|1[0-2])$/.test(clean)) return 0x70 + Number(clean.slice(1)) - 1;
  if (/^[a-z]$/.test(clean)) return clean.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(clean)) return clean.charCodeAt(0);
  if (clean.length === 1) return clean.toUpperCase().charCodeAt(0);
  throw new Error(`Unknown key: ${name}`);
}

export async function pressKeys(keys, signal) {
  const parts = String(keys)
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("No keys supplied");
  const codes = parts.map(keyCode);
  const down = codes.map((code) => `[ApexNative]::KeyDown(${code})`).join("\n");
  const up = [...codes]
    .reverse()
    .map((code) => `[ApexNative]::KeyUp(${code})`)
    .join("\n");
  await runPowerShell(
    `${PRELUDE}
${down}
Start-Sleep -Milliseconds 40
${up}
'ok'`,
    { timeoutMs: 15000, signal },
  );
  return { keys: parts.join("+") };
}

export async function typeText(text, signal) {
  await runPowerShell(
    `${PRELUDE}
$text = ${decode(String(text))}
[ApexNative]::Type($text)
'ok'`,
    { timeoutMs: 20000, signal },
  );
  return { chars: String(text).length };
}

export async function moveMouse(x, y, signal) {
  await runPowerShell(
    `${PRELUDE}
[ApexNative]::Move(${Math.round(x)}, ${Math.round(y)})
'ok'`,
    { timeoutMs: 12000, signal },
  );
  return { x, y };
}

export async function click({ x, y, button = "left", count = 1 }, signal) {
  const buttonIndex = button === "right" ? 1 : button === "middle" ? 2 : 0;
  await runPowerShell(
    `${PRELUDE}
[ApexNative]::Click(${Math.round(x)}, ${Math.round(y)}, ${buttonIndex}, ${Math.max(1, Math.min(3, Number(count) || 1))})
'ok'`,
    { timeoutMs: 15000, signal },
  );
  return { x, y, button, count };
}

export async function scroll({ x, y, amount = -3 }, signal) {
  const delta = Math.round(Number(amount) || 0) * 120;
  await runPowerShell(
    `${PRELUDE}
[ApexNative]::Scroll(${Math.round(x)}, ${Math.round(y)}, ${delta})
'ok'`,
    { timeoutMs: 12000, signal },
  );
  return { x, y, amount };
}

export async function drag({ fromX, fromY, toX, toY }, signal) {
  await runPowerShell(
    `${PRELUDE}
[ApexNative]::Drag(${Math.round(fromX)}, ${Math.round(fromY)}, ${Math.round(toX)}, ${Math.round(toY)})
'ok'`,
    { timeoutMs: 20000, signal },
  );
  return { fromX, fromY, toX, toY };
}

export async function launchApp({ app, args = [], cwd = "" }, signal) {
  const arr = Array.isArray(args) ? args.map(String) : [];
  const argsJson = JSON.stringify(arr);
  return runPowerShellJson(
    `${PRELUDE}
$app = ${decode(String(app))}
$argJson = ${decode(argsJson)}
$argList = @()
if ($argJson -and $argJson -ne '[]') { $argList = @(ConvertFrom-Json $argJson) }
$cwd = ${decode(String(cwd || ""))}
$params = @{ FilePath = $app; PassThru = $true }
if ($argList.Count -gt 0) { $params.ArgumentList = $argList }
if ($cwd) { $params.WorkingDirectory = $cwd }
$p = Start-Process @params
$stubPid = $p.Id
Start-Sleep -Milliseconds 1400
$procName = $p.ProcessName
$realPid = $stubPid
$realTitle = $p.MainWindowTitle
$fg = [ApexNative]::GetForegroundWindow()
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($w in $wins) {
  try {
    $proc = Get-Process -Id $w.Current.ProcessId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq $procName -and $w.Current.Name) {
      $isActive = ([IntPtr]$w.Current.NativeWindowHandle -eq $fg)
      if ($realPid -eq $stubPid -or $isActive) {
        $realPid = $w.Current.ProcessId
        $realTitle = $w.Current.Name
      }
      if ($isActive) { break }
    }
  } catch {}
}
@{ pid = $realPid; stubPid = $stubPid; process = $procName; title = $realTitle } | ConvertTo-Json -Compress`,
    { timeoutMs: 20000, signal },
  );
}

export async function focusWindow(pid, signal) {
  return runPowerShellJson(
    `${PRELUDE}
$pidTarget = [int]${Math.max(0, Number(pid) || 0)}
$p = Get-Process -Id $pidTarget -ErrorAction Stop
$h = $p.MainWindowHandle
if ($h -eq [IntPtr]::Zero) {
  Start-Sleep -Milliseconds 400
  $p.Refresh()
  $h = $p.MainWindowHandle
}
if ($h -eq [IntPtr]::Zero) { throw "Process $pidTarget has no main window" }
[ApexNative]::ShowWindow($h, 9) | Out-Null
[ApexNative]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 260
$fg = [ApexNative]::GetForegroundWindow()
if ($fg -ne $h) {
  $shell = New-Object -ComObject WScript.Shell
  $shell.AppActivate($pidTarget) | Out-Null
  Start-Sleep -Milliseconds 260
  $fg = [ApexNative]::GetForegroundWindow()
}
@{ pid = $pidTarget; focused = ($fg -eq $h); handle = [int64]$h } | ConvertTo-Json -Compress`,
    { timeoutMs: 20000, signal },
  );
}

export async function closeProcess(pid, signal) {
  return runPowerShellJson(
    `${PRELUDE}
$p = Get-Process -Id ${Math.max(0, Number(pid) || 0)} -ErrorAction Stop
$p.CloseMainWindow() | Out-Null
Start-Sleep -Milliseconds 500
if (-not $p.HasExited) { $p.Kill() }
@{ pid = $p.Id; closed = $true } | ConvertTo-Json -Compress`,
    { timeoutMs: 15000, signal },
  );
}

export async function focusedValue(signal) {
  return runPowerShellJson(
    `${PRELUDE}
$f = [System.Windows.Automation.AutomationElement]::FocusedElement
$value = ''
$pattern = $null
if ($f) {
  try {
    if ($f.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
      $value = $pattern.Current.Value
    } else {
      $pattern = $null
      if ($f.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
        $value = $pattern.DocumentRange.GetText(4000)
      }
    }
  } catch {}
}
$name = if ($f) { $f.Current.Name } else { '' }
$control = if ($f) { $f.Current.ControlType.ProgrammaticName -replace 'ControlType\\.', '' } else { '' }
@{ control = $control; name = $name; value = $value } | ConvertTo-Json -Compress`,
    { timeoutMs: 15000, signal },
  );
}

export function describeObservation(observation) {
  if (!observation) return "No observation.";
  const lines = [];
  if (observation.active) {
    lines.push(
      `Active window: ${observation.active.title} (pid ${observation.active.pid}, ${observation.active.process})`,
    );
  }
  if (observation.focused) {
    lines.push(
      `Focused: ${observation.focused.control} "${observation.focused.name}" at ${observation.focused.x},${observation.focused.y} ${observation.focused.w}x${observation.focused.h}`,
    );
  }
  if (observation.focusedValue) {
    lines.push(`Focused value: "${String(observation.focusedValue).slice(0, 1200)}"`);
  }
  if (observation.windows?.length) {
    lines.push("Windows:");
    for (const win of observation.windows.slice(0, 14)) {
      lines.push(
        `- ${win.active ? "[ACTIVE] " : ""}${win.title} (pid ${win.pid}, ${win.process})`,
      );
    }
  }
  if (observation.elements?.length) {
    lines.push("Actionable UI elements in the active window:");
    for (const el of observation.elements.slice(0, 70)) {
      lines.push(
        `- ${el.control} "${el.name}" ${el.enabled ? "" : "(disabled) "}${el.focus ? "(focus) " : ""}at ${el.x},${el.y} ${el.w}x${el.h}`,
      );
    }
  }
  return lines.join("\n");
}
