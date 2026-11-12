Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinEnum2 {
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id, ProcessName, MainWindowTitle
$procs | ForEach-Object {
  Write-Output ("PID {0} :: {1} :: {2}" -f $_.Id, $_.ProcessName, $_.MainWindowTitle)
}
Write-Output "---- windows with browser-ish process names ----"
$browserNames = @('chrome','chromium','msedge','brave','vivaldi','opera','firefox','headless')
$hits = New-Object System.Collections.ArrayList
$cb = [WinEnum2+EnumWindowsProc]{
  param($h, $l)
  if ([WinEnum2]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][WinEnum2]::GetWindowText($h, $sb, 512)
    $t = $sb.ToString()
    if ($t.Trim().Length -gt 0) {
      $pid2 = 0
      [void][WinEnum2]::GetWindowThreadProcessId($h, [ref]$pid2)
      $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
      $pn = if ($p) { $p.ProcessName } else { '?' }
      if ($browserNames -contains $pn.ToLower()) {
        Write-Output ("HWND {0} :: pid {1} :: {2} :: {3}" -f $h, $pid2, $pn, $t)
      }
    }
  }
  return $true
}
[void][WinEnum2]::EnumWindows($cb, [IntPtr]::Zero)
