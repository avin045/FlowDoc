# FlowDoc inspector for Windows. Long-running helper: reads one JSON request
# per line on stdin and answers with one JSON line on stdout, using UI
# Automation to describe the element under a screen point or the focused element.
#   {"id":1,"op":"point","x":100,"y":200}   physical screen pixels
#   {"id":2,"op":"focus"}
#   {"id":3,"op":"windows"}                  open top-level windows, front to back
#   {"id":4,"op":"url","hwnd":123}           address shown in that (or the foreground) browser window
#   {"id":5,"op":"ping"}
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public static class FlowDocDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
// Top-level windows: which app shows them, where they are, and who owns them
// (a dialog run by another process still belongs to the app that opened it).
public static class FlowDocWin {
  public class Info { public long Hwnd; public string Title; public string Cls; public int Pid; public int OwnerPid; public bool Minimized; public int X, Y, W, H; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static long Foreground() { return GetForegroundWindow().ToInt64(); }
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

  static int PidOf(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return (int)pid; }

  public static Info Describe(IntPtr h) {
    var title = new StringBuilder(512); GetWindowText(h, title, 512);
    var cls = new StringBuilder(256); GetClassName(h, cls, 256);
    var i = new Info { Hwnd = h.ToInt64(), Title = title.ToString(), Cls = cls.ToString(), Pid = PidOf(h), Minimized = IsIconic(h) };
    // Store apps (Settings, Calculator...) run inside an ApplicationFrameHost frame.
    if (i.Cls == "ApplicationFrameWindow") {
      var core = FindWindowEx(h, IntPtr.Zero, "Windows.UI.Core.CoreWindow", null);
      if (core != IntPtr.Zero) i.Pid = PidOf(core);
    }
    var owner = GetWindow(h, 4); // GW_OWNER
    if (owner != IntPtr.Zero) i.OwnerPid = PidOf(owner);
    RECT r;
    // The visible frame, without the invisible resize borders.
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    i.X = r.L; i.Y = r.T; i.W = r.R - r.L; i.H = r.B - r.T;
    return i;
  }

  public static Info Top(long hwnd) {
    var h = new IntPtr(hwnd);
    var root = GetAncestor(h, 2); // GA_ROOT
    return Describe(root == IntPtr.Zero ? h : root);
  }

  public static List<Info> List() {
    var list = new List<Info>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int cloaked; // suspended Store apps, windows on other virtual desktops
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
      var i = Describe(h);
      if (i.Title.Length > 0 && i.W > 0 && i.H > 0) list.Add(i);
      return true;
    }, IntPtr.Zero);
    return list;
  }
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
    try { $path = $p.Path } catch {}
  } catch {}
  $result = @{ name = $name; exe = $exe; path = $path }
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

  # Top-level window title, and the top-level element (the one just below the
  # desktop) for its native window handle.
  $w = $el; $depth = 0; $lastWindow = $null; $prev = $null; $topEl = $el
  while ($null -ne $w -and $depth -lt 40) {
    if ($w.Current.ControlType -eq $CT::Window) { $lastWindow = $w.Current.Name }
    if ($null -ne $prev) { $topEl = $prev }
    $prev = $w
    $w = $walker.GetParent($w); $depth++
  }
  $hwnd = 0
  try { $hwnd = $topEl.Current.NativeWindowHandle } catch {}
  $o.window = $lastWindow
  $app = Get-AppName $c.ProcessId
  $o.app = $app.name
  $o.exe = $app.exe
  # The app showing the top-level window (so a menu or file dialog counts as
  # part of the app that opened it), its class and where it is.
  if ($hwnd) {
    try {
      $top = [FlowDocWin]::Top([long]$hwnd)
      $o.hwnd = $top.Hwnd
      $topApp = Get-AppName $top.Pid
      $o.topExe = $topApp.exe
      $o.topApp = $topApp.name
      $o.topClass = $top.Cls
      $o.topRect = @{ x = $top.X; y = $top.Y; w = $top.W; h = $top.H }
      if ($top.OwnerPid) { $o.ownerExe = (Get-AppName $top.OwnerPid).exe }
    } catch {}
  }
  return $o
}

function List-Windows {
  $out = @()
  foreach ($i in [FlowDocWin]::List()) {
    $app = Get-AppName $i.Pid
    $o = [ordered]@{
      title = $i.Title; cls = $i.Cls; pid = $i.Pid; exe = $app.exe; app = $app.name; path = $app.path
      minimized = $i.Minimized; rect = @{ x = $i.X; y = $i.Y; w = $i.W; h = $i.H }
    }
    if ($i.OwnerPid) { $o.ownerExe = (Get-AppName $i.OwnerPid).exe }
    $out += $o
  }
  return ,$out
}

# The address bar of the foreground browser window: Chromium browsers (Chrome,
# Edge, Brave, Vivaldi, Opera) call it OmniboxViewViews, Firefox urlbar-input.
$urlBar = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'OmniboxViewViews')),
  (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'urlbar-input')))

# `hwnd`: the browser window acted on; the foreground window when not given.
function Get-BrowserUrl([long]$hwnd) {
  $h = if ($hwnd) { $hwnd } else { [FlowDocWin]::Foreground() }
  if ($h -eq 0) { return $null }
  $root = $AE::FromHandle([IntPtr]$h)
  $bar = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $urlBar)
  if ($null -eq $bar) { return $null }
  $value = $bar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
  $app = Get-AppName $root.Current.ProcessId
  return [ordered]@{ url = $value; title = $root.Current.Name; exe = $app.exe; app = $app.name }
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
      'windows' { $res.el = List-Windows }
      'url'   { $res.el = Get-BrowserUrl ([long]$req.hwnd) }
      'ping'  { $res.ok = $true }
      default { $res.error = "unknown op $($req.op)" }
    }
  } catch {
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
