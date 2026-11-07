$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$fg = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
$target = $null
foreach ($w in $windows) {
  try { if ($w.Current.Name -eq 'Qoder') { $target = $w } } catch {}
}
foreach ($walkerName in @('ControlViewWalker','RawViewWalker','ContentViewWalker')) {
  $walker = [System.Windows.Automation.TreeWalker]::$walkerName
  $count = 0
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@{ el = $target; depth = 0 })
  while ($queue.Count -gt 0 -and $count -lt 60) {
    $item = $queue.Dequeue()
    $el = $item.el
    try {
      $r = $el.Current.BoundingRectangle
      $type = $el.Current.ControlType.ProgrammaticName
      $name = $el.Current.Name
      if ($r.Width -gt 0) {
        $count++
        if ($count -le 12) { Write-Output ("{0} {1} {2} {3}" -f $walkerName, $type, $name, $r) }
      }
      if ($item.depth -lt 8) {
        $child = $walker.GetFirstChild($el)
        while ($child) { $queue.Enqueue(@{ el = $child; depth = $item.depth + 1 }); $child = $walker.GetNextSibling($child) }
      }
    } catch {}
  }
  Write-Output ("TOTAL {0} {1}" -f $walkerName, $count)
}
