import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  }
} catch {}
@{ active = $active; windows = @($list); elements = @($elements); focused = $focused } | ConvertTo-Json -Compress -Depth 5`,
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
$argList = @(ConvertFrom-Json ${decode(argsJson)})
$cwd = ${decode(String(cwd || ""))}
$p = if ($cwd) { Start-Process -FilePath $app -ArgumentList $argList -WorkingDirectory $cwd -PassThru } else { Start-Process -FilePath $app -ArgumentList $argList -PassThru }
Start-Sleep -Milliseconds 250
@{ pid = $p.Id; process = $p.ProcessName; title = $p.MainWindowTitle } | ConvertTo-Json -Compress`,
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
