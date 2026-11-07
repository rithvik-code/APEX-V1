$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bmp.Size)
$out = Join-Path $env:TEMP 'apex-probe.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$list = @()
foreach ($w in $windows) {
  $r = $w.Current.BoundingRectangle
  $list += [pscustomobject]@{
    title = $w.Current.Name
    pid = $w.Current.ProcessId
    x = [int]$r.X
    y = [int]$r.Y
    w = [int]$r.Width
    h = [int]$r.Height
  }
}

$focus = [System.Windows.Automation.AutomationElement]::FocusedElement
$focusInfo = if ($focus) {
  $r = $focus.Current.BoundingRectangle
  [pscustomobject]@{
    name = $focus.Current.Name
    control = $focus.Current.ControlType.ProgrammaticName
    pid = $focus.Current.ProcessId
    x = [int]$r.X
    y = [int]$r.Y
    w = [int]$r.Width
    h = [int]$r.Height
  }
} else { $null }

[pscustomobject]@{
  screen = [pscustomobject]@{ x = $bounds.X; y = $bounds.Y; w = $bounds.Width; h = $bounds.Height }
  capture = [pscustomobject]@{ path = $out; bytes = (Get-Item $out).Length }
  windowCount = $list.Count
  windows = $list
  focus = $focusInfo
} | ConvertTo-Json -Depth 6 -Compress
