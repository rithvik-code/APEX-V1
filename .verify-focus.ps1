Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe' or Name='chromium.exe'" | ForEach-Object {
  $cl = $_.CommandLine
  $hasDbg = $cl -and ($cl -match 'remote-debugging-port=(\d+)')
  $port = if ($hasDbg) { $Matches[1] } else { '-' }
  $head = if ($cl -match 'headless') { 'HEADLESS' } else { 'headed' }
  Write-Output ("PID {0} :: {1} :: port {2}" -f $_.ProcessId, $head, $port)
}
