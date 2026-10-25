# FlowDoc inspector for Windows. Long-running helper: reads one JSON request
# per line on stdin and answers with one JSON line on stdout, using UI
# Automation to describe the element under a screen point or the focused element.
#   {"id":1,"op":"point","x":100,"y":200}   physical screen pixels
#   {"id":2,"op":"focus"}
#   {"id":3,"op":"ping"}
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FlowDocDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
# Per-monitor v2 awareness so coordinates match the (physical) mouse hook.
try { [void][FlowDocDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch {}

$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$appNames = @{}

function Get-AppName([int]$procId) {
  if ($appNames.ContainsKey($procId)) { return $appNames[$procId] }
  $name = $null
  try {
    $p = Get-Process -Id $procId
    try { $name = $p.MainModule.FileVersionInfo.FileDescription } catch {}
    if (-not $name) { $name = $p.ProcessName }
    $exe = $p.ProcessName
  } catch {}
  $result = @{ name = $name; exe = $exe }
  $appNames[$procId] = $result
  return $result
}

function Get-Rect($el) {
  $r = $el.Current.BoundingRectangle
  if ($r.IsEmpty -or [double]::IsInfinity($r.Width)) { return $null }
  return @{ x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height }
}

function Describe($el) {
  if ($null -eq $el) { return $null }
  $c = $el.Current
  $o = [ordered]@{
    name       = $c.Name
    type       = ($c.ControlType.ProgrammaticName -replace '^ControlType\.', '')
    className  = $c.ClassName
    automationId = $c.AutomationId
    isPassword = $c.IsPassword
    rect       = Get-Rect $el
    pid        = $c.ProcessId
  }
  if (-not $c.IsPassword) {
    try {
      $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $v = $vp.Current.Value
      if ($v -and $v.Length -gt 2000) { $v = $v.Substring(0, 2000) }
      $o.value = $v
    } catch {}
  }
  try {
    $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $o.toggle = "$($tp.Current.ToggleState)"
  } catch {}
  try {
    $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $o.selected = $sp.Current.IsSelected
  } catch {}

  # Unnamed elements (an icon inside a button, a text run inside a link) borrow
  # the nearest named ancestor.
  if (-not $c.Name) {
    $p = $walker.GetParent($el); $i = 0
    while ($null -ne $p -and $i -lt 4) {
      if ($p.Current.ControlType -eq $CT::Window) { break }
      if ($p.Current.Name) {
        $o.parentName = $p.Current.Name
        $o.parentType = ($p.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
        $o.parentRect = Get-Rect $p
        break
      }
      $p = $walker.GetParent($p); $i++
    }
  }

  # Top-level window title.
  $w = $el; $depth = 0; $lastWindow = $null
  while ($null -ne $w -and $depth -lt 40) {
    if ($w.Current.ControlType -eq $CT::Window) { $lastWindow = $w.Current.Name }
    $w = $walker.GetParent($w); $depth++
  }
  $o.window = $lastWindow
  $app = Get-AppName $c.ProcessId
  $o.app = $app.name
  $o.exe = $app.exe
  return $o
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $res = [ordered]@{}
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    switch ($req.op) {
      'point' { $res.el = Describe ($AE::FromPoint((New-Object System.Windows.Point([double]$req.x, [double]$req.y)))) }
      'focus' { $res.el = Describe ($AE::FocusedElement) }
      'ping'  { $res.ok = $true }
      default { $res.error = "unknown op $($req.op)" }
    }
  } catch {
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
