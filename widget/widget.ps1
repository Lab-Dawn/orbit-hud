# Orbit HUD floating widget: a pixel-art core that fills with the five-hour
# usage and glows while any Claude session works. Everything else stays tucked
# away: cards slide out of the core only when something needs a look or an answer
# (a question, a finished task, a warning), and slide back once dealt with.
# Hover the core for a glance, click it for the full panel, drag it anywhere,
# right-click for options.
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# ORBIT_HUD_LIVE points a second widget at another live folder (demo data for
# screenshots, say); it runs beside the usual one with its own single-instance lock.
$liveDir = if ($env:ORBIT_HUD_LIVE) { $env:ORBIT_HUD_LIVE } else { Join-Path $env:USERPROFILE '.claude\orbit-hud-live' }
$mutexName = if ($env:ORBIT_HUD_LIVE) { 'Local\orbit-hud-widget-' + [Math]::Abs($liveDir.ToLower().GetHashCode()) } else { 'Local\orbit-hud-widget' }
$isFirst = $false
$mutex = New-Object System.Threading.Mutex($true, $mutexName, [ref]$isFirst)
if (-not $isFirst) { exit }

$sessionDir = Join-Path $liveDir 'sessions'
$prefsPath = Join-Path $liveDir 'widget.json'
$snapRequest = Join-Path $liveDir 'snap-request'
$snapPath = Join-Path $liveDir 'snap.png'
$appSessionRoot = Join-Path $env:APPDATA 'Claude\claude-code-sessions'
$lingerMs = 12000
# The plugin rewrites its file at least every 30 s; older than this, the session is gone.
$aliveMs = 120000

$colors = @{
  Accent      = '#22D3EE'
  AccentLine  = '#3822D3EE'
  AccentWash  = '#1A22D3EE'
  Text        = '#E6EDF3'
  Sub         = '#C5CED8'
  Muted       = '#7D8A99'
  Faint       = '#5C6773'
  Divider     = '#4D7D8A99'
  Hover       = '#147D8A99'
  Warn        = '#F5B841'
  Danger      = '#FF5C6C'
  Ask         = '#A78BFA'
  AskLine     = '#B3A78BFA'
  AskWash     = '#26A78BFA'
  Field       = '#1A7D8A99'
  Done        = '#4ADE80'
  Edge        = '#804A5A6B'
  AskLift     = '#40A78BFA'
  AskFrame    = '#CCB49BFF'
  DoneFrame   = '#CC4ADE80'
  None        = '#00000000'
}
$converter = New-Object System.Windows.Media.BrushConverter
$brushes = @{}
foreach ($k in $colors.Keys) { $brushes[$k] = $converter.ConvertFromString($colors[$k]) }
$monoFont = New-Object System.Windows.Media.FontFamily 'Cascadia Mono, Consolas, Malgun Gothic'

[xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Orbit HUD" WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ShowActivated="False" ResizeMode="NoResize"
        SizeToContent="Manual" Width="400" Height="400" TextOptions.TextFormattingMode="Display"
        TextOptions.TextRenderingMode="Aliased" UseLayoutRounding="True"
        FontFamily="Segoe UI Variable Text, Segoe UI, Malgun Gothic" FontSize="13">
  <Canvas x:Name="Root">
    <Grid x:Name="Panel" Visibility="Collapsed" Width="360">
      <Grid.Effect><DropShadowEffect BlurRadius="0" ShadowDepth="3" Direction="315" Opacity="0.6" Color="Black" /></Grid.Effect>
      <Canvas><Path x:Name="PanelFrame" Fill="#F70B1118" Stroke="#664A5A6B" StrokeThickness="2" /></Canvas>
      <Rectangle Width="22" Height="2" Margin="16,4,0,0" HorizontalAlignment="Left" VerticalAlignment="Top" Fill="#99B8F6FF" />
      <StackPanel Margin="8,12,8,12">
        <StackPanel x:Name="UsageBox" Margin="6,0,6,0" />
        <Rectangle Height="1" Margin="4,8,4,8" Fill="#4D7D8A99" />
        <TextBlock x:Name="ListLabel" Margin="6,0,6,4" FontSize="12" Foreground="#7D8A99" />
        <StackPanel x:Name="SessionList" />
      </StackPanel>
    </Grid>
    <Grid x:Name="ChatCard" Visibility="Collapsed" Width="340">
      <Grid.Effect><DropShadowEffect BlurRadius="0" ShadowDepth="3" Direction="315" Opacity="0.6" Color="Black" /></Grid.Effect>
      <Canvas><Path x:Name="ChatFrame" Fill="#F70B1118" Stroke="#995CE1F5" StrokeThickness="2" /></Canvas>
      <Rectangle Width="22" Height="2" Margin="16,4,0,0" HorizontalAlignment="Left" VerticalAlignment="Top" Fill="#FFB8F6FF" />
      <StackPanel x:Name="ChatBody" Margin="10,12,10,8" />
    </Grid>
      <Grid x:Name="Core" Width="64" Height="64" Cursor="Hand" Background="Transparent">
        <Image x:Name="CoreImage" Width="64" Height="64" RenderOptions.BitmapScalingMode="NearestNeighbor" IsHitTestVisible="False" />
      </Grid>
      <StackPanel x:Name="Callouts">
        <Grid x:Name="QuestionCard" Visibility="Collapsed" Width="372" Margin="0,4,0,4">
          <Grid.Effect><DropShadowEffect BlurRadius="0" ShadowDepth="3" Direction="315" Opacity="0.6" Color="Black" /></Grid.Effect>
          <Canvas><Path x:Name="QuestionFrame" Fill="#F70B1118" Stroke="#CCB49BFF" StrokeThickness="2" /></Canvas>
          <Rectangle Width="22" Height="2" Margin="16,4,0,0" HorizontalAlignment="Left" VerticalAlignment="Top" Fill="#FFF6F0FF" />
          <StackPanel x:Name="QuestionBody" Margin="14,12,14,14" />
        </Grid>
        <Grid x:Name="NoticeCard" Visibility="Collapsed" MaxWidth="392" Margin="0,4,0,4" Cursor="Hand" HorizontalAlignment="Left">
          <Grid.Effect><DropShadowEffect BlurRadius="0" ShadowDepth="3" Direction="315" Opacity="0.6" Color="Black" /></Grid.Effect>
          <Canvas><Path x:Name="NoticeFrame" Fill="#F70B1118" StrokeThickness="2" /></Canvas>
          <Rectangle Width="22" Height="2" Margin="16,4,0,0" HorizontalAlignment="Left" VerticalAlignment="Top" Fill="#FFF2FFFF" />
          <StackPanel x:Name="NoticeBody" Margin="14,11,14,11" />
        </Grid>
        <Grid x:Name="HoverCard" Visibility="Collapsed" Width="330" Margin="0,4,0,4" HorizontalAlignment="Left">
          <Grid.Effect><DropShadowEffect BlurRadius="0" ShadowDepth="3" Direction="315" Opacity="0.6" Color="Black" /></Grid.Effect>
          <Canvas><Path x:Name="HoverFrame" Fill="#F70B1118" Stroke="#995CE1F5" StrokeThickness="2" /></Canvas>
          <Rectangle Width="22" Height="2" Margin="16,4,0,0" HorizontalAlignment="Left" VerticalAlignment="Top" Fill="#FFB8F6FF" />
          <StackPanel x:Name="HoverBody" Margin="14,11,14,12" />
        </Grid>
      </StackPanel>
  </Canvas>
</Window>
'@
$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
foreach ($name in 'Root', 'Panel', 'UsageBox', 'ListLabel', 'SessionList',
  'Core', 'CoreImage', 'Callouts', 'PanelFrame', 'QuestionFrame', 'NoticeFrame', 'HoverFrame',
  'QuestionCard', 'QuestionBody', 'NoticeCard', 'NoticeBody', 'HoverCard', 'HoverBody', 'ChatCard', 'ChatFrame', 'ChatBody') {
  Set-Variable -Name ($name.Substring(0, 1).ToLower() + $name.Substring(1)) -Value $window.FindName($name)
}
$cards = @($questionCard, $noticeCard, $hoverCard)

$script:isOpen = $false
$script:focusId = $null
$script:shownId = $null
$script:sessions = @()
$script:account = @()

# Keeps only the latest drawing error, for debugging.
function Write-Failure($err) {
  try { [IO.File]::WriteAllText((Join-Path $liveDir 'widget-error.log'), "$(Get-Date -Format o)`n$err`n$($err.ScriptStackTrace)") } catch {}
}

# ---------- small builders ----------

function New-Text {
  param([string]$Color = 'Text', [double]$Size = 13, [switch]$Mono, [switch]$Bold)
  $t = New-Object System.Windows.Controls.TextBlock
  $t.Foreground = $brushes[$Color]
  $t.FontSize = $Size
  $t.VerticalAlignment = 'Center'
  if ($Mono) { $t.FontFamily = $monoFont }
  if ($Bold) { $t.FontWeight = [System.Windows.FontWeights]::SemiBold }
  $t
}

function Add-Run {
  param($Block, [string]$Text, [string]$Color = 'Text', [double]$Size = 0, [switch]$Mono, [switch]$Bold)
  $run = New-Object System.Windows.Documents.Run $Text
  $run.Foreground = $brushes[$Color]
  if ($Size -gt 0) { $run.FontSize = $Size }
  if ($Mono) { $run.FontFamily = $monoFont }
  if ($Bold) { $run.FontWeight = [System.Windows.FontWeights]::SemiBold }
  $Block.Inlines.Add($run)
}

function Get-Level([double]$pct) {
  if ($pct -ge 85) { 'Danger' } elseif ($pct -ge 60) { 'Warn' } else { 'Accent' }
}

function Format-Clock([double]$ms) {
  $total = [Math]::Max(0, [Math]::Floor($ms / 1000))
  '{0}:{1:00}' -f [Math]::Floor($total / 60), ($total % 60)
}

function Format-Reset($iso) {
  if (-not $iso) { return '' }
  try { $left = [DateTimeOffset]::Parse($iso) - [DateTimeOffset]::Now } catch { return '' }
  if ($left.TotalMinutes -le 0) { return '' }
  if ($left.TotalMinutes -lt 60) { return "$([Math]::Ceiling($left.TotalMinutes))분 후 리셋" }
  if ($left.TotalHours -lt 24) { return ('{0}:{1:00} 후 리셋' -f [Math]::Floor($left.TotalHours), $left.Minutes) }
  if ($left.Hours -eq 0) { return "$($left.Days)일 후 리셋" }
  "$($left.Days)일 $($left.Hours)시간 후 리셋"
}

function Format-Tokens($n) {
  if ($null -eq $n) { return '' }
  if ($n -ge 1000000) { return ('{0:0.#}M' -f ($n / 1000000)) }
  if ($n -lt 1000) { return "$n" }
  '{0}k' -f [Math]::Round($n / 1000)
}

function Format-Usd([double]$usd) {
  if ($usd -ge 100) { return ('${0:0}' -f $usd) }
  '${0:0.00}' -f $usd
}

function Get-Color([string]$hex) { [System.Windows.Media.ColorConverter]::ConvertFromString($hex) }

function New-Duration([double]$ms) { New-Object System.Windows.Duration ([TimeSpan]::FromMilliseconds($ms)) }

# A blinking animation for a status dot in the panel; $false stops it.
$pulse = New-Object System.Windows.Media.Animation.DoubleAnimation 1.0, 0.3, (New-Duration 700)
$pulse.AutoReverse = $true
$pulse.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever

function Set-Pulse($shape, [bool]$on) {
  if ([bool]$shape.Tag -eq $on) { return }
  $shape.Tag = $on
  if ($on) {
    $shape.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $pulse)
  } else {
    $shape.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)
    $shape.Opacity = 1
  }
}

# ---------- the core: a 32x32 pixel-art ring, drawn live ----------

$N = 32
$mid = ($N - 1) / 2
$script:pixelScale = 2
$script:coreCenter = 32

function ConvertTo-Bgra([string]$hex, [int]$alpha = 255) {
  $c = Get-Color $hex
  , ([byte[]]@($c.B, $c.G, $c.R, $alpha))
}

$palettes = @{
  cyan   = @('#F2FFFF', '#B8F6FF', '#5CE1F5', '#22B8D6', '#137A93', '#0B4656' | ForEach-Object { , (ConvertTo-Bgra $_) })
  violet = @('#F6F0FF', '#D9CCFF', '#B49BFF', '#8B6CF0', '#5B44A8', '#33265F' | ForEach-Object { , (ConvertTo-Bgra $_) })
}
$ringColors = @{
  Accent = @((ConvertTo-Bgra '#5CE1F5'), (ConvertTo-Bgra '#B8F6FF'))
  Warn   = @((ConvertTo-Bgra '#FFB13B'), (ConvertTo-Bgra '#FFE0A3'))
  Danger = @((ConvertTo-Bgra '#FF4D5E'), (ConvertTo-Bgra '#FFB0B8'))
}
$pxOutline = ConvertTo-Bgra '#06090D'
$pxHousing = ConvertTo-Bgra '#18202A'
$pxTrack = ConvertTo-Bgra '#222C38'
$pxTrackHi = ConvertTo-Bgra '#2C3947'
$pxLampOff = ConvertTo-Bgra '#344050'
$pxGlow = @{ cyan = (ConvertTo-Bgra '#5CE1F5' 110); violet = (ConvertTo-Bgra '#B49BFF' 110) }

# What each pixel is, worked out once from its distance and angle to the centre:
# 1 outline, 2/3 usage ring (inner/outer half), 4/5 coil (inner/outer), 6 gap
# between coils, 7..9 the core from rim to heart, 10 halo (only while lit).
$pxRole = New-Object int[] ($N * $N)
$pxAngle = New-Object double[] ($N * $N)
for ($y = 0; $y -lt $N; $y++) {
  for ($x = 0; $x -lt $N; $x++) {
    $dx = $x - $mid; $dy = $y - $mid
    $d = [Math]::Sqrt($dx * $dx + $dy * $dy)
    $a = ([Math]::Atan2($dx, -$dy) * 180 / [Math]::PI + 360) % 360
    $i = $y * $N + $x
    $pxAngle[$i] = $a
    $pxRole[$i] =
      if ($d -gt 16.4) { 0 }
      elseif ($d -gt 15.6) { if ((($x + $y) % 2) -eq 0) { 10 } else { 0 } }
      elseif ($d -gt 13.6) { 0 }
      elseif ($d -gt 13.0) { 1 }
      elseif ($d -gt 10.4) { if ($d -lt 11.3) { 2 } else { 3 } }
      elseif ($d -gt 9.8) { 1 }
      elseif ($d -gt 7.2) { if (($a % 36) -lt 27) { if ($d -gt 9.0) { 5 } else { 4 } } else { 6 } }
      elseif ($d -gt 6.4) { 1 }
      elseif ($d -gt 4.8) { 7 }
      elseif ($d -gt 2.8) { 8 }
      else { 9 }
  }
}

# Twelve 2x2 lamps around the rim, clockwise from twelve o'clock.
$lamps = @()
for ($k = 0; $k -lt 12; $k++) {
  $rad = $k * 30 * [Math]::PI / 180
  $lx = [int][Math]::Round($mid + 14.6 * [Math]::Sin($rad) - 0.5)
  $ly = [int][Math]::Round($mid - 14.6 * [Math]::Cos($rad) - 0.5)
  $lamps += , @($lx, $ly)
}

$coreBitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap $N, $N, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
$coreImage.Source = $coreBitmap
$coreBuffer = New-Object byte[] ($N * $N * 4)
$coreRect = New-Object System.Windows.Int32Rect 0, 0, $N, $N

$script:coreMode = 'idle'
$script:corePct = 0
$script:coreFrame = 0
$script:coreDrawn = $null

# Everything but the lamps, for one mode, pulse shade and usage figure. Drawn once
# and kept, so an animation frame only copies it and adds the twelve lamps.
$script:bases = @{}
function Get-CoreBase([string]$mode, [int]$shift, [double]$pct) {
  $key = "$mode|$shift|$pct"
  $base = $script:bases[$key]
  if ($base) { return , $base }
  if ($script:bases.Count -gt 24) { $script:bases.Clear() }
  $hue = if ($mode -eq 'ask') { 'violet' } else { 'cyan' }
  $pal = $palettes[$hue]
  $ring = $ringColors[(Get-Level $pct)]
  $sweep = $pct * 3.6
  $colorOf = @{
    1 = $pxOutline; 4 = $pal[[Math]::Min(5, 3 + $shift)]; 5 = $pal[[Math]::Min(5, 4 + $shift)]; 6 = $pxHousing
    7 = $pal[2 + $shift]; 8 = $pal[1 + $shift]; 9 = $pal[0 + $shift]
  }
  $base = New-Object byte[] ($N * $N * 4)
  for ($i = 0; $i -lt $pxRole.Length; $i++) {
    $role = $pxRole[$i]
    if ($role -eq 0) { continue }
    $color = $null
    if ($role -eq 2 -or $role -eq 3) {
      $isFilled = $pct -gt 0 -and $pxAngle[$i] -le $sweep
      $color = if ($role -eq 2) { if ($isFilled) { $ring[1] } else { $pxTrackHi } } else { if ($isFilled) { $ring[0] } else { $pxTrack } }
    } elseif ($role -eq 10) {
      if ($mode -ne 'idle') { $color = $pxGlow[$hue] }
    } else {
      $color = $colorOf[$role]
    }
    if ($null -eq $color) { continue }
    $o = $i * 4
    $base[$o] = $color[0]; $base[$o + 1] = $color[1]; $base[$o + 2] = $color[2]; $base[$o + 3] = $color[3]
  }
  $script:bases[$key] = $base
  , $base
}

# idle: one shade down, lamps dark. working: a lamp runs round with a fading tail and
# the core pulses between two shades. ask: the same, in violet.
function Draw-Core {
  $mode = $script:coreMode
  $frame = $script:coreFrame
  $pct = [Math]::Round([Math]::Max(0, [Math]::Min(100, $script:corePct)), 1)
  $key = "$mode|$pct|$(if ($mode -eq 'idle') { 0 } else { $frame })"
  if ($key -eq $script:coreDrawn) { return }
  $script:coreDrawn = $key

  $shift = if ($mode -eq 'idle') { 1 } elseif (($frame % 4) -lt 2) { 0 } else { 1 }
  $base = Get-CoreBase $mode $shift $pct
  [Buffer]::BlockCopy($base, 0, $coreBuffer, 0, $base.Length)
  $pal = $palettes[$(if ($mode -eq 'ask') { 'violet' } else { 'cyan' })]
  for ($k = 0; $k -lt 12; $k++) {
    $color = if ($mode -eq 'idle') { $pxLampOff } else {
      switch (($frame - $k + 1200) % 12) { 0 { $pal[1] } 1 { $pal[2] } 2 { $pal[3] } default { $pal[4] } }
    }
    $at = $lamps[$k][1] * $N + $lamps[$k][0]
    foreach ($i in @($at, ($at + 1), ($at + $N), ($at + $N + 1))) {
      $o = $i * 4
      $coreBuffer[$o] = $color[0]; $coreBuffer[$o + 1] = $color[1]; $coreBuffer[$o + 2] = $color[2]; $coreBuffer[$o + 3] = $color[3]
    }
  }
  $coreBitmap.WritePixels($coreRect, $coreBuffer, $N * 4, 0)
}
function Set-CoreState([double]$pct, [string]$mode) {
  $script:corePct = $pct
  if ($mode -ne $script:coreMode) {
    $script:coreMode = $mode
    if ($mode -eq 'idle') { $coreAnimation.Stop() } else { $coreAnimation.Start() }
  }
  Draw-Core
}

# The lamp chase and pulse run on their own clock, a frame every 110 ms.
$coreAnimation = New-Object System.Windows.Threading.DispatcherTimer
$coreAnimation.Interval = [TimeSpan]::FromMilliseconds(110)
$coreAnimation.Add_Tick({
  $script:coreFrame = ($script:coreFrame + 1) % 1200
  if (($script:coreFrame % 2) -eq 0) { try { Step-MiniCores } catch { Write-Failure $_ } }
  try { Draw-Core } catch { Write-Failure $_ }
})

# Two, three or four screen pixels per art pixel.
function Set-CoreScale([int]$k) {
  $script:pixelScale = $k
  $size = $N * $k
  $core.Width = $size; $core.Height = $size
  $coreImage.Width = $size; $coreImage.Height = $size
  $script:coreCenter = $size / 2
}

# Cards and the panel wear a frame with clipped corners, redrawn to their size.
function Set-Frame($path, [double]$w, [double]$h) {
  if ($w -le 0 -or $h -le 0) { return }
  $c = 8; $t = 1
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $pts = @(@($c, $t), @(($w - $t), $t), @(($w - $t), ($h - $c)), @(($w - $c), ($h - $t)), @($t, ($h - $t)), @($t, $c))
  $text = 'M ' + (($pts | ForEach-Object { '{0},{1}' -f $_[0].ToString($inv), $_[1].ToString($inv) }) -join ' L ') + ' Z'
  $path.Data = [System.Windows.Media.Geometry]::Parse($text)
}

foreach ($pair in @(@($panel, $panelFrame), @($questionCard, $questionFrame), @($noticeCard, $noticeFrame), @($hoverCard, $hoverFrame), @($chatCard, $chatFrame))) {
  $pair[0].Tag = $null
  $pair[0].Add_SizeChanged({
    param($sender, $e)
    Set-Frame $sender.Children[0].Children[0] $sender.ActualWidth $sender.ActualHeight
  })
}
# ---------- pixel text: Malgun Gothic at 12px with no smoothing, shown twice the size ----------

$pixelZoom = 2
$pixelLine = 16
# Bold blots into lumps at 11px, so emphasis is carried by colour alone and the
# "bold" flag on a part draws in the regular weight.
$pixelRegular = New-Object System.Drawing.Font 'Malgun Gothic', 12, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$pixelFonts = @{ $false = $pixelRegular; $true = $pixelRegular }
$pixelFormat = [System.Drawing.StringFormat]::GenericTypographic.Clone()
$pixelFormat.FormatFlags = $pixelFormat.FormatFlags -bor [System.Drawing.StringFormatFlags]::MeasureTrailingSpaces
$measureCanvas = [System.Drawing.Graphics]::FromImage((New-Object System.Drawing.Bitmap 1, 1))
$measureCanvas.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
$script:pixelCache = @{}
$checkWidth = 10

# Width in art pixels; a leading check mark is drawn by hand, the font has none.
function Measure-PixelText([string]$text, [bool]$isBold) {
  if (-not $text) { return 0 }
  $extra = 0
  if ($text.StartsWith('✓')) { $extra = $checkWidth; $text = $text.Substring(1) }
  if (-not $text) { return $extra }
  $extra + [Math]::Ceiling($measureCanvas.MeasureString($text, $pixelFonts[$isBold], 100000, $pixelFormat).Width)
}

# Parts are @(text, colour name, bold?). One line, cut with an ellipsis past MaxWidth
# (screen pixels), or with -Wrap the first part's text broken over lines to fit.
function New-PixelText {
  param([object[]]$Parts, [double]$MaxWidth = 0, [switch]$Wrap)
  # PowerShell unwraps a lone part into its fields; put it back in a list.
  if ($Parts.Count -gt 0 -and $Parts[0] -isnot [array]) { $Parts = @(, $Parts) }
  $limit = if ($MaxWidth -gt 0) { [Math]::Floor($MaxWidth / $pixelZoom) } else { 100000 }
  $lines = New-Object System.Collections.ArrayList
  if ($Wrap) {
    $p = $Parts[0]
    $line = ''
    foreach ($ch in ([string]$p[0]).ToCharArray()) {
      $next = $line + $ch
      if ($line -and (Measure-PixelText $next ([bool]$p[2])) -gt $limit) {
        # Break at the last space if there is one, so words stay whole.
        $cut = $line.LastIndexOf(' ')
        if ($cut -gt 0) { [void]$lines.Add(@(, @($line.Substring(0, $cut), $p[1], $p[2]))); $line = $line.Substring($cut + 1) + $ch }
        else { [void]$lines.Add(@(, @($line, $p[1], $p[2]))); $line = [string]$ch }
      } else { $line = $next }
    }
    if ($line) { [void]$lines.Add(@(, @($line, $p[1], $p[2]))) }
  } else {
    $kept = @(); $used = 0
    $ellipsis = Measure-PixelText '…' $false
    foreach ($p in $Parts) {
      $text = [string]$p[0]
      $w = Measure-PixelText $text ([bool]$p[2])
      if ($used + $w -le $limit) { $kept += , @($text, $p[1], $p[2]); $used += $w; continue }
      while ($text.Length -gt 0 -and $used + (Measure-PixelText $text ([bool]$p[2])) + $ellipsis -gt $limit) { $text = $text.Substring(0, $text.Length - 1) }
      $kept += , @("$text…", $p[1], $p[2])
      break
    }
    [void]$lines.Add($kept)
  }

  $key = ($lines | ForEach-Object { ($_ | ForEach-Object { "$($_[0])|$($_[1])|$($_[2])" }) -join '¦' }) -join '¶'
  $source = $script:pixelCache[$key]
  if (-not $source) {
    $width = 1
    foreach ($l in $lines) { $w = 0; foreach ($p in $l) { $w += Measure-PixelText ([string]$p[0]) ([bool]$p[2]) }; $width = [Math]::Max($width, $w) }
    $height = [Math]::Max(1, $lines.Count) * $pixelLine
    $bitmap = New-Object System.Drawing.Bitmap ([int]$width + 1), ([int]$height)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    $g.Clear([System.Drawing.Color]::Transparent)
    $y = 0
    foreach ($l in $lines) {
      $x = 0
      foreach ($p in $l) {
        $text = [string]$p[0]
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($colors[[string]$p[1]].Substring(0, 7)))
        if ($text.StartsWith('✓')) {
          foreach ($pt in @(@(0, 6), @(1, 7), @(2, 8), @(3, 7), @(4, 6), @(5, 5), @(6, 4), @(7, 3))) {
            $g.FillRectangle($brush, $x + $pt[0], $y + $pt[1], 1, 2)
          }
          $x += $checkWidth; $text = $text.Substring(1)
        }
        if ($text) {
          $g.DrawString($text, $pixelFonts[[bool]$p[2]], $brush, [float]$x, [float]$y, $pixelFormat)
          $x += Measure-PixelText $text ([bool]$p[2])
        }
        $brush.Dispose()
      }
      $y += $pixelLine
    }
    $g.Dispose()
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    $stream.Position = 0
    $source = New-Object System.Windows.Media.Imaging.BitmapImage
    $source.BeginInit(); $source.CacheOption = 'OnLoad'; $source.StreamSource = $stream; $source.EndInit(); $source.Freeze()
    if ($script:pixelCache.Count -gt 400) { $script:pixelCache.Clear() }
    $script:pixelCache[$key] = $source
  }
  $image = New-Object System.Windows.Controls.Image
  $image.Source = $source
  $image.Stretch = 'Fill'
  $image.Width = $source.PixelWidth * $pixelZoom
  $image.Height = $source.PixelHeight * $pixelZoom
  $image.HorizontalAlignment = 'Left'
  $image.VerticalAlignment = 'Center'
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($image, 'NearestNeighbor')
  $image
}

# A pixel-text button face: a transparent box, so the whole label area takes clicks.
function New-PixelLink([object[]]$Parts, [string]$tag) {
  $box = New-Object System.Windows.Controls.Border
  $box.Background = $brushes['None']; $box.Cursor = 'Hand'; $box.Tag = $tag
  $box.Child = New-PixelText -Parts $Parts
  $box
}

# ---------- cards: slide out of the core, slide back in ----------

# +1 when the cards sit to the right of the core (they slide out rightward), -1 to the left.
$script:cardDir = 1

function Show-Card($card) {
  if ($card.Tag -eq 'in') { return }
  $card.Tag = 'in'
  $card.Visibility = 'Visible'
  $shift = New-Object System.Windows.Media.TranslateTransform (-14 * $script:cardDir), 0
  $card.RenderTransform = $shift
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = 'EaseOut'
  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation 0, 1, (New-Duration 220)
  $slide = New-Object System.Windows.Media.Animation.DoubleAnimation (-14 * $script:cardDir), 0, (New-Duration 260)
  $slide.EasingFunction = $ease
  $card.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
  $shift.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $slide)
}

function Hide-Card($card) {
  if ($card.Tag -ne 'in') { return }
  $card.Tag = 'out'
  $fade = New-Object System.Windows.Media.Animation.DoubleAnimation 0, (New-Duration 180)
  $fade.Add_Completed({ Complete-HiddenCards })
  $card.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
  if ($card.RenderTransform -is [System.Windows.Media.TranslateTransform]) {
    $back = New-Object System.Windows.Media.Animation.DoubleAnimation (-14 * $script:cardDir), (New-Duration 180)
    $card.RenderTransform.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $back)
  }
}

# Gone at once, no fade: for a card whose place is about to change (the glance
# when the panel opens), so it never slides off somewhere on its way out.
function Drop-Card($card) {
  $card.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)
  if ($card.RenderTransform -is [System.Windows.Media.TranslateTransform]) {
    $card.RenderTransform.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $null)
  }
  $card.Visibility = 'Collapsed'
  $card.Tag = $null
  $card.Opacity = 1
}

function Complete-HiddenCards {
  foreach ($c in $cards) {
    if ($c.Tag -ne 'out') { continue }
    $c.Visibility = 'Collapsed'
    $c.Tag = $null
    $c.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $null)
    $c.Opacity = 1
  }
}

# ---------- position: kept by the core's top-left; panel and cards open where there's room ----------

$panelGap = 10

function Get-DefaultPosition {
  $area = [System.Windows.SystemParameters]::WorkArea
  @{ left = $area.Right - 130; top = $area.Bottom - 150 }
}

$script:left = $null
$script:coreTop = $null
$script:isHidden = $false
$script:isAbove = $true
$script:isSideSet = $false
$script:isCardsLeft = $false
try {
  $prefs = [IO.File]::ReadAllText($prefsPath) | ConvertFrom-Json
  if ($null -ne $prefs.left -and $null -ne $prefs.top) {
    $script:left = [double]$prefs.left
    $script:coreTop = [double]$prefs.top
  }
  if ($prefs.scale -in 2, 3, 4) { Set-CoreScale ([int]$prefs.scale) }
  $script:isHidden = [bool]$prefs.hidden
} catch {}
# A saved spot on a monitor that has since gone (or moved) would leave the core
# off every screen; then it starts in the default corner instead.
if ($null -ne $script:left) {
  $dpi = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width / [System.Windows.SystemParameters]::PrimaryScreenWidth
  $center = New-Object System.Drawing.Point ([int](($script:left + $script:coreCenter) * $dpi)), ([int](($script:coreTop + $script:coreCenter) * $dpi))
  $isOnScreen = [System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.WorkingArea.Contains($center) }
  if (-not $isOnScreen) { $script:left = $null; $script:coreTop = $null }
}
if ($null -eq $script:left) {
  $p = Get-DefaultPosition
  $script:left = $p.left; $script:coreTop = $p.top
}

function Save-Prefs {
  try {
    New-Item -ItemType Directory -Force $liveDir | Out-Null
    $json = @{ left = $script:left; top = $script:coreTop; scale = $script:pixelScale; hidden = $script:isHidden } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($prefsPath, $json)
  } catch {}
}

function Get-Scale {
  $source = [System.Windows.PresentationSource]::FromVisual($window)
  if ($source) { $source.CompositionTarget.TransformToDevice.M11 } else { 1.0 }
}

# The work area of the monitor under the core, in WPF units.
function Get-WorkArea {
  $scale = Get-Scale
  $point = New-Object System.Drawing.Point ([int](($script:left + $script:coreCenter) * $scale)), ([int](($script:coreTop + $script:coreCenter) * $scale))
  $area = [System.Windows.Forms.Screen]::FromPoint($point).WorkingArea
  @{ Top = $area.Top / $scale; Bottom = $area.Bottom / $scale; Left = $area.Left / $scale; Right = $area.Right / $scale }
}

# The window is a fixed canvas with the core at a fixed point in it, room for the
# cards on one side and the panel above or below. Cards coming and going move
# nothing; the window only changes size when the panel opens or closes, the cards
# switch sides or the core is resized, and then moves and resizes in one step so
# the core never jumps (a jump under the pointer would flicker the hover card).
$canvasPad = 8
$cardGap = 12
$cardsRoom = 404
$cardsTall = 560
$panelWidth = 360

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class HudNative {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$script:hwnd = [IntPtr]::Zero
$script:placed = ''

function Set-Layout {
  $s = $N * $script:pixelScale
  $infinite = New-Object System.Windows.Size ([double]::PositiveInfinity), ([double]::PositiveInfinity)
  $callouts.Measure($infinite)
  $cw = $callouts.DesiredSize.Width; $ch = $callouts.DesiredSize.Height
  $hasPanel = $panel.Visibility -eq 'Visible'
  $ph = 0
  if ($hasPanel) { $panel.Measure($infinite); $ph = $panel.DesiredSize.Height }

  # Everything relative to the core's top-left corner first.
  $rowTall = [Math]::Max($cardsTall, [Math]::Max($s, $ch))
  $area = Get-WorkArea
  # With the panel shut, keep deciding where it would open, so the cards can
  # already stand clear of it.
  if (-not $hasPanel -and -not $script:drag) { $script:isAbove = ($script:coreTop - $script:panelTall - $panelGap) -ge $area.Top }
  if ($ph -gt $script:panelTall) { $script:panelTall = $ph }
  $panelX = if ($script:isCardsLeft) { $s - $panelWidth } else { 0 }
  $panelY = if ($script:isAbove) { -$panelGap - $ph } else { $s + $panelGap }
  $hasChat = $hasPanel -and $chatCard.Visibility -eq 'Visible'
  # With the panel open, everything lines up on the panel's edge next to the core.
  $base = if ($script:isAbove) { -$panelGap } else { $s + $panelGap }
  $edge = if ($script:isCardsLeft) { $panelX } else { $panelX + $panelWidth }
  $chatW = $chatCard.Width
  $chatX = if ($script:isCardsLeft) { $edge - $panelGap - $chatW } else { $edge + $panelGap }
  $chatEdge = if ($script:isCardsLeft) { $chatX } else { $chatX + $chatW }

  # The window keeps room for all of it, open or shut: the cards beside the core,
  # the panel at its tallest, the chat and the cards beyond it. Opening or closing
  # the panel or the chat then never resizes the window; a resize and a redraw
  # seldom land on the same frame, and whatever was leaving would jump away.
  $panelFar = if ($script:isAbove) { -$panelGap - $script:panelTall } else { $s + $panelGap + $script:panelTall }
  $roomX = if ($script:isCardsLeft) { $chatEdge - $panelGap - $cardsRoom } else { $chatEdge + $panelGap + $cardsRoom }
  $roomY = if ($script:isAbove) { $base - $cardsTall } else { $base + $cardsTall }
  $nearX = if ($script:isCardsLeft) { -$cardGap - $cardsRoom } else { $s + $cardGap + $cardsRoom }
  $nearTop = if ($script:isAbove) { 0 } else { $s - $rowTall }
  $nearBottom = if ($script:isAbove) { $rowTall } else { $s }
  $minX = [Math]::Min([Math]::Min(0, $nearX), [Math]::Min($panelX, [Math]::Min($chatX, $roomX)))
  $maxX = [Math]::Max([Math]::Max($s, $nearX), [Math]::Max($panelX + $panelWidth, [Math]::Max($chatX + $chatW, $roomX)))
  $minY = [Math]::Min([Math]::Min(0, $nearTop), [Math]::Min($panelFar, $roomY))
  $maxY = [Math]::Max([Math]::Max($s, $nearBottom), [Math]::Max($panelFar, $roomY))

  if (-not $hasPanel) {
    # Shut: the cards stand beside the core and grow away from the panel's side,
    # down from the core's top edge when it opens above, up from its bottom edge
    # when it opens below.
    $isDown = $script:isAbove
    $cardLeft = if ($script:isCardsLeft) { -$cardGap - $cw } else { $s + $cardGap }
    if ($isDown) { $cardTop = [Math]::Min(0, $area.Bottom - $canvasPad - $script:coreTop - $ch) }
    else { $cardTop = [Math]::Max($s - $ch, $area.Top + $canvasPad - $script:coreTop) }
  } else {
    # Open: panel, chat and cards side by side outward, each growing away from the core.
    $isDown = -not $script:isAbove
    if ($hasChat) {
      $chatCard.Measure($infinite)
      $chatH = $chatCard.DesiredSize.Height
      $chatY = if ($script:isAbove) { $base - $chatH } else { $base }
      $edge = $chatEdge
      $minY = [Math]::Min($minY, $chatY); $maxY = [Math]::Max($maxY, $chatY + $chatH)
    }
    $cardLeft = if ($script:isCardsLeft) { $edge - $panelGap - $cw } else { $edge + $panelGap }
    $cardTop = if ($script:isAbove) { $base - $ch } else { $base }
    # Kept on the screen, whatever the row would like.
    $cardTop = [Math]::Max($cardTop, $area.Top + $canvasPad - $script:coreTop)
    $cardTop = [Math]::Min($cardTop, $area.Bottom - $canvasPad - $script:coreTop - $ch)
  }
  $minX = [Math]::Min($minX, $cardLeft); $maxX = [Math]::Max($maxX, $cardLeft + $cw)
  $minY = [Math]::Min($minY, $cardTop); $maxY = [Math]::Max($maxY, $cardTop + $ch)
  Set-CardOrder $isDown
  $coreX = [Math]::Round($canvasPad - $minX)
  $coreY = [Math]::Round($canvasPad - $minY)
  $width = [Math]::Ceiling($maxX - $minX + 2 * $canvasPad)
  $height = [Math]::Ceiling($maxY - $minY + 2 * $canvasPad)

  [System.Windows.Controls.Canvas]::SetLeft($core, $coreX)
  [System.Windows.Controls.Canvas]::SetTop($core, $coreY)
  $cardsX = [Math]::Round($coreX + $cardLeft); $cardsY = [Math]::Round($coreY + $cardTop)
  [System.Windows.Controls.Canvas]::SetLeft($callouts, $cardsX)
  [System.Windows.Controls.Canvas]::SetTop($callouts, $cardsY)
  # Compared by the edges that stay put as the cards change size: the side facing
  # the core, and the top or bottom they grow from.
  $isTopHeld = $isDown
  $edgeX = $script:left - $coreX + $cardsX + $(if ($script:isCardsLeft) { $cw } else { 0 })
  $edgeY = $script:coreTop - $coreY + $cardsY + $(if ($isTopHeld) { 0 } else { $ch })
  Move-Cards $edgeX $edgeY
  if ($hasPanel) {
    [System.Windows.Controls.Canvas]::SetLeft($panel, $coreX + $panelX)
    [System.Windows.Controls.Canvas]::SetTop($panel, [Math]::Round($coreY + $panelY))
  }
  if ($hasChat) {
    [System.Windows.Controls.Canvas]::SetLeft($chatCard, [Math]::Round($coreX + $chatX))
    [System.Windows.Controls.Canvas]::SetTop($chatCard, [Math]::Round($coreY + $chatY))
  }

  $left = $script:left - $coreX
  $top = $script:coreTop - $coreY
  $key = "$left|$top|$width|$height"
  if ($key -eq $script:placed) { return }
  $script:placed = $key
  if ($script:hwnd -ne [IntPtr]::Zero) {
    $scale = Get-Scale
    # SWP_NOZORDER | SWP_NOACTIVATE: move and resize together, leave focus alone.
    [void][HudNative]::SetWindowPos($script:hwnd, [IntPtr]::Zero, [int][Math]::Round($left * $scale), [int][Math]::Round($top * $scale),
      [int][Math]::Round($width * $scale), [int][Math]::Round($height * $scale), 0x0014)
  }
  $window.Left = $left; $window.Top = $top; $window.Width = $width; $window.Height = $height
}

# The panel opens upward when it fits above the core on its monitor, otherwise
# downward; decided once per opening (and while dragging), flipped only if it stops fitting.
function Set-PanelSide {
  if ($script:drag -and $script:isSideSet) { return }
  $panel.Measure((New-Object System.Windows.Size ([double]::PositiveInfinity), ([double]::PositiveInfinity)))
  $script:panelTall = $panel.DesiredSize.Height
  $need = $panel.DesiredSize.Height + $panelGap
  $area = Get-WorkArea
  $fitsAbove = ($script:coreTop - $need) -ge $area.Top
  if ($script:isSideSet -and (-not $script:isAbove -or $fitsAbove)) { return }
  $script:isSideSet = $true
  $script:isAbove = $fitsAbove
}

# When the cards must step to a new spot on screen (aside for the panel, say), they
# glide there from where they were instead of jumping. Positions are compared on
# the screen, so the window resizing around them moves nothing by itself.
$script:cardsAt = $null
$cardsShift = New-Object System.Windows.Media.TranslateTransform
$callouts.RenderTransform = $cardsShift
function Move-Cards([double]$x, [double]$y) {
  $was = $script:cardsAt
  $script:cardsAt = @{ x = $x; y = $y }
  $isShown = @($cards | Where-Object { $_.Visibility -eq 'Visible' }).Count -gt 0
  if (-not $was -or -not $isShown -or $script:drag) {
    $cardsShift.BeginAnimation([System.Windows.Media.TranslateTransform]::XProperty, $null)
    $cardsShift.BeginAnimation([System.Windows.Media.TranslateTransform]::YProperty, $null)
    return
  }
  $dx = $was.x - $x; $dy = $was.y - $y
  if ([Math]::Abs($dx) -lt 1 -and [Math]::Abs($dy) -lt 1) { return }
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = 'EaseOut'
  foreach ($axis in @(@([System.Windows.Media.TranslateTransform]::XProperty, ($cardsShift.X + $dx)), @([System.Windows.Media.TranslateTransform]::YProperty, ($cardsShift.Y + $dy)))) {
    $glide = New-Object System.Windows.Media.Animation.DoubleAnimation $axis[1], 0, (New-Duration 200)
    $glide.EasingFunction = $ease
    $cardsShift.BeginAnimation($axis[0], $glide)
  }
}

# The panel's height as last opened, to tell where it would open while shut.
$script:panelTall = 420
$script:cardsDown = $null

# The question nearest the core's edge the cards grow from, notices and the glance beyond.
function Set-CardOrder([bool]$isDown) {
  if ($script:cardsDown -eq $isDown) { return }
  $script:cardsDown = $isDown
  $order = if ($isDown) { @($questionCard, $noticeCard, $hoverCard) } else { @($hoverCard, $noticeCard, $questionCard) }
  $callouts.Children.Clear()
  foreach ($c in $order) { [void]$callouts.Children.Add($c) }
}

# After a drag, the sides are settled for the new spot. When they change, the
# window changes size and the content moves within it, and those two seldom show
# on the same frame; so the widget fades out, rearranges unseen, and fades back.
function Set-SidesAfterDrag {
  $area = Get-WorkArea
  $willLeft = ($script:left + $script:coreCenter) -gt (($area.Left + $area.Right) / 2)
  $tall = if ($panel.Visibility -eq 'Visible') { $panel.DesiredSize.Height } else { $script:panelTall }
  $willAbove = ($script:coreTop - $tall - $panelGap) -ge $area.Top
  if ($willLeft -eq $script:isCardsLeft -and $willAbove -eq $script:isAbove) { return }
  $out = New-Object System.Windows.Media.Animation.DoubleAnimation 0, (New-Duration 60)
  $root.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $out)
  $settle = New-Object System.Windows.Threading.DispatcherTimer
  $settle.Interval = [TimeSpan]::FromMilliseconds(90)
  $settle.Add_Tick({
    param($sender, $e)
    $sender.Stop()
    try {
      Set-CardSide
      $script:isSideSet = $false
      if ($panel.Visibility -eq 'Visible') { Set-PanelSide }
      Set-Layout
    } catch { Write-Failure $_ }
    $back = New-Object System.Windows.Threading.DispatcherTimer
    $back.Interval = [TimeSpan]::FromMilliseconds(60)
    $back.Add_Tick({
      param($sender, $e)
      $sender.Stop()
      $in = New-Object System.Windows.Media.Animation.DoubleAnimation 0, 1, (New-Duration 120)
      $root.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $in)
    })
    $back.Start()
  })
  $settle.Start()
}

# Cards come out on the side of the core facing the middle of its monitor.
function Set-CardSide {
  if ($script:drag) { return }
  $area = Get-WorkArea
  $isLeft = ($script:left + $script:coreCenter) -gt (($area.Left + $area.Right) / 2)
  if ($isLeft -eq $script:isCardsLeft) { return }
  $script:isCardsLeft = $isLeft
  $script:cardDir = if ($isLeft) { -1 } else { 1 }
  $align = if ($isLeft) { 'Right' } else { 'Left' }
  foreach ($c in $cards) { $c.HorizontalAlignment = $align }
}

# Cards changing size only shift them within the canvas.
$callouts.Add_SizeChanged({ Set-Layout })
$panel.Add_SizeChanged({ Set-Layout })
# ---------- on and off: Ctrl+Alt+O anywhere, /hud on|off, or the menu ----------
# Hidden, the widget keeps running (and keeps the hotkey) with nothing on screen;
# the choice is saved, so new sessions leave it hidden until it is called back.
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class HudHotkey {
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hwnd, int id);
}
"@
$hotkeyId = 0x4A48
$widgetCommand = Join-Path $liveDir 'widget-command'

function Set-Hidden([bool]$isHidden) {
  if ($script:isHidden -eq $isHidden) { return }
  $script:isHidden = $isHidden
  if ($isHidden) { $script:isOpen = $false }
  Save-Prefs
  Update-View
  if (-not $isHidden) {
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation 0, 1, (New-Duration 180)
    $root.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
  }
}

$window.Add_SourceInitialized({
  $script:hwnd = (New-Object System.Windows.Interop.WindowInteropHelper $window).Handle
  # MOD_ALT | MOD_CONTROL | MOD_NOREPEAT, O
  if (-not [HudHotkey]::RegisterHotKey($script:hwnd, $hotkeyId, 0x4003, 0x4F)) {
    Write-Failure 'Ctrl+Alt+O is taken by another program; use /hud on|off or the menu.'
  }
  $source = [System.Windows.Interop.HwndSource]::FromHwnd($script:hwnd)
  $source.AddHook([System.Windows.Interop.HwndSourceHook] {
    param($hwnd, $msg, $wParam, $lParam, [ref]$handled)
    if ($msg -eq 0x0312 -and $wParam.ToInt32() -eq $hotkeyId) {
      $handled.Value = $true
      try { Set-Hidden (-not $script:isHidden) } catch { Write-Failure $_ }
    }
    [IntPtr]::Zero
  })
})
$window.Add_Closed({ if ($script:hwnd -ne [IntPtr]::Zero) { [void][HudHotkey]::UnregisterHotKey($script:hwnd, $hotkeyId) } })

function Get-CursorPoint {
  $scale = Get-Scale
  $c = [System.Windows.Forms.Cursor]::Position
  @{ X = $c.X / $scale; Y = $c.Y / $scale }
}

# Dragging moves the core (and whatever is open around it). A press on the core that
# ends where it started is a click, which opens or closes the panel.
$script:drag = $null
$window.Add_MouseLeftButtonDown({
  param($sender, $e)
  $script:drag = @{ cursor = Get-CursorPoint; left = $script:left; top = $script:coreTop; isMoved = $false; isOnCore = $core.IsMouseOver }
  [void]$window.CaptureMouse()
  $e.Handled = $true
})

$window.Add_MouseMove({
  if (-not $script:drag) { return }
  $c = Get-CursorPoint
  $dx = $c.X - $script:drag.cursor.X
  $dy = $c.Y - $script:drag.cursor.Y
  if (-not $script:drag.isMoved -and ([Math]::Abs($dx) + [Math]::Abs($dy)) -lt 4) { return }
  if (-not $script:drag.isMoved) { Hide-Card $hoverCard }
  $script:drag.isMoved = $true
  $script:left = $script:drag.left + $dx
  $script:coreTop = $script:drag.top + $dy
  # The sides cards and panel open towards stay put while dragging (they are
  # settled on release): flipping them mid-drag resizes the window, and crossing
  # onto another monitor would flip them right at its edge.
  Set-Layout
})

$window.Add_MouseLeftButtonUp({
  if (-not $script:drag) { return }
  $drag = $script:drag
  $script:drag = $null
  $window.ReleaseMouseCapture()
  if ($drag.isMoved) {
    Save-Prefs
    Set-SidesAfterDrag
  } elseif ($drag.isOnCore) {
    $script:isOpen = -not $script:isOpen
    $script:isSideSet = $false
    if ($script:isOpen) { Drop-Card $hoverCard }
  }
  Update-View
})

# Hovering the core brings out a glance card; it goes back when the pointer leaves.
$script:isHovering = $false
$core.Add_MouseEnter({ $script:isHovering = $true; Update-View })
$core.Add_MouseLeave({ $script:isHovering = $false; Update-View })

$menu = New-Object System.Windows.Controls.ContextMenu
$reset = New-Object System.Windows.Controls.MenuItem
$reset.Header = '위치 초기화'
$reset.Add_Click({
  $p = Get-DefaultPosition
  $script:left = $p.left; $script:coreTop = $p.top
  $script:isSideSet = $false
  Save-Prefs
  Update-View
})
$hide = New-Object System.Windows.Controls.MenuItem
$hide.Header = '숨기기'
$hide.InputGestureText = 'Ctrl+Alt+O'
$hide.Add_Click({ Set-Hidden $true })
$close = New-Object System.Windows.Controls.MenuItem
$close.Header = '위젯 종료'
$close.Add_Click({ $window.Close() })
# Core size: two, three or four screen pixels per art pixel.
$sizeMenu = New-Object System.Windows.Controls.MenuItem
$sizeMenu.Header = '코어 크기'
foreach ($choice in @(@(2, '작게 (64px)'), @(3, '보통 (96px)'), @(4, '크게 (128px)'))) {
  $item = New-Object System.Windows.Controls.MenuItem
  $item.Header = $choice[1]
  $item.Tag = $choice[0]
  $item.IsCheckable = $true
  $item.Add_Click({
    param($sender, $e)
    Set-CoreScale ([int]$sender.Tag)
    $script:placed = ''
    foreach ($other in $sizeMenu.Items) { $other.IsChecked = ([int]$other.Tag -eq $script:pixelScale) }
    $script:isSideSet = $false
    Save-Prefs
    Update-View
  })
  [void]$sizeMenu.Items.Add($item)
}
$menu.Add_Opened({ foreach ($other in $sizeMenu.Items) { $other.IsChecked = ([int]$other.Tag -eq $script:pixelScale) } })
[void]$menu.Items.Add($sizeMenu)
[void]$menu.Items.Add($reset)
[void]$menu.Items.Add($hide)
[void]$menu.Items.Add($close)
$core.ContextMenu = $menu

# ---------- data ----------

$script:files = @{}
# What every session (closed ones too) spent in its five-hour window, for the shares.
$script:windowSpends = @()

# Every session whose plugin is still writing, each with its age and derived state.
function Read-Sessions {
  if (-not (Test-Path $sessionDir)) { return @() }
  $now = [DateTime]::Now
  $list = @()
  $spends = @()
  foreach ($file in Get-ChildItem $sessionDir -Filter '*.json' -File) {
    $age = ($now - $file.LastWriteTime).TotalMilliseconds
    # Files untouched for over five hours cannot belong to the running window.
    if ($age -gt 5 * 3600 * 1000) { continue }
    $cached = $script:files[$file.FullName]
    if (-not $cached -or $cached.stamp -ne $file.LastWriteTime) {
      try {
        $data = [IO.File]::ReadAllText($file.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $cached = @{ stamp = $file.LastWriteTime; data = $data }
        $script:files[$file.FullName] = $cached
      } catch { if (-not $cached) { continue } }
    }
    $d = $cached.data
    if ($d.spend -and $null -ne $d.spend.windowUsd) {
      $spends += [pscustomobject]@{
        id = $file.BaseName; resetsAt = $d.spend.resetsAt; usd = [double]$d.spend.windowUsd
        isPartial = [bool]$d.spend.isPartial; isLive = (-not $d.isEnded -and $age -le $aliveMs); project = $d.project
      }
    }
    if ($d.isEnded -or $age -gt $aliveMs) { continue }
    $list += Get-SessionView $file.BaseName $d $age $file.LastWriteTime
  }
  $script:windowSpends = $spends
  , $list
}

function ConvertTo-Time($iso) {
  if (-not $iso) { return $null }
  try { [DateTimeOffset]::Parse($iso) } catch { $null }
}

function Test-SameWindow($a, $b) {
  $ta = ConvertTo-Time $a; $tb = ConvertTo-Time $b
  $ta -and $tb -and [Math]::Abs(($ta - $tb).TotalSeconds) -lt 60
}

# The rate limits are the account's, but each session only knows what its own last
# API response said, so an idle session keeps an ended window's figures. Take the
# freshest reading of each limit across sessions (the latest window, its highest
# figure); a window whose reset time has passed with no newer reading reads 0%.
function Get-AccountUsage($list) {
  # Per limit: the reading of the newest window, and within one window the one a
  # session measured most recently (a plan change can lower the figure mid-window,
  # and an idle session keeps the old one). Without measuring times, the higher.
  $best = @{}
  $bestAt = @{}
  $order = New-Object System.Collections.Generic.List[string]
  foreach ($s in $list) {
    $at = if ($s.data.limitsAt) { [double]$s.data.limitsAt } else { 0 }
    foreach ($m in $s.data.usage) {
      if ($m.short -eq 'ctx') { continue }
      if (-not $order.Contains([string]$m.short)) { $order.Add([string]$m.short) }
      $have = $best[$m.short]
      if (-not $have) { $best[$m.short] = $m; $bestAt[$m.short] = $at; continue }
      $mine = ConvertTo-Time $m.resetsAt
      $theirs = ConvertTo-Time $have.resetsAt
      $isLater = $mine -and (-not $theirs -or ($mine - $theirs).TotalSeconds -gt 60)
      $isSame = $mine -and $theirs -and [Math]::Abs(($mine - $theirs).TotalSeconds) -le 60
      $haveAt = $bestAt[$m.short]
      $isNewer = if ($at -gt 0 -or $haveAt -gt 0) { $at -gt $haveAt } else { $m.pct -gt $have.pct }
      if ($isLater -or ($isSame -and $isNewer)) { $best[$m.short] = $m; $bestAt[$m.short] = $at }
    }
  }
  $now = [DateTimeOffset]::Now
  $result = @()
  foreach ($short in $order) {
    $m = $best[$short]
    $resets = ConvertTo-Time $m.resetsAt
    if ($resets -and $resets -lt $now) {
      $result += [pscustomobject]@{ label = $m.label; short = $m.short; pct = 0; resetsAt = $null; isStale = $true }
    } else {
      $result += [pscustomobject]@{ label = $m.label; short = $m.short; pct = $m.pct; resetsAt = $m.resetsAt; isStale = $false }
    }
  }
  $result
}

function Get-FivePct {
  $five = @($script:account) | Where-Object { $_.short -eq '5h' } | Select-Object -First 1
  if ($five) { [double]$five.pct } else { $null }
}

# What the panel shows for a session: its own context, then the account's limits.
function Get-DisplayUsage($s) {
  $list = @()
  foreach ($m in $s.data.usage) { if ($m.short -eq 'ctx') { $list += $m } }
  $list + @($script:account)
}

# Shares each session's spend in the running five-hour window out of the window's
# usage: its cost over every session's cost in that window, times the 5h percent.
# Spending outside Claude Code sessions is not seen, so these are estimates.
function Set-WindowShares($list) {
  $five = @($script:account) | Where-Object { $_.short -eq '5h' } | Select-Object -First 1
  $script:fivePct = if ($five) { [double]$five.pct } else { $null }
  # A window that has ended with no newer reading has no spending yet.
  $resetsAt = if ($five -and -not $five.isStale) { $five.resetsAt } else { $null }
  $inWindow = @($script:windowSpends | Where-Object { Test-SameWindow $_.resetsAt $resetsAt })
  $script:windowSpendsNow = $inWindow
  $sum = ($inWindow | Measure-Object usd -Sum).Sum
  $script:windowSum = $sum
  foreach ($s in $list) {
    $mine = $inWindow | Where-Object { $_.id -eq $s.id } | Select-Object -First 1
    $s.windowUsd = if ($mine) { $mine.usd } else { $null }
    $s.isPartial = if ($mine) { $mine.isPartial } else { $false }
    $s.windowPct = if ($mine -and $sum -gt 0 -and $null -ne $script:fivePct) { $script:fivePct * $mine.usd / $sum } else { $null }
  }
}

function Format-Share($pct, [bool]$isPartial) {
  if ($null -eq $pct) { return '' }
  $mark = if ($isPartial) { '≥' } else { '≈' }
  if ($pct -lt 1) { return "$($mark)<1%" }
  "$mark$([Math]::Round($pct))%"
}

function Get-SessionView([string]$id, $d, [double]$ageMs, [DateTime]$stamp) {
  $w = $d.work
  $state = 'idle'; $elapsed = 0
  if ($d.question) {
    $state = 'ask'
  } elseif ($w -and $w.isActive) {
    $state = 'working'; $elapsed = ($d.writtenAt - $w.startedAt) + $ageMs
  } elseif ($w -and $w.endedAt -gt 0 -and $w.actions -gt 0 -and (($d.writtenAt - $w.endedAt) + $ageMs) -lt $lingerMs) {
    $state = 'done'; $elapsed = $w.endedAt - $w.startedAt
  }
  $ctx = $null
  foreach ($m in $d.usage) { if ($m.short -eq 'ctx') { $ctx = $m.pct } }
  $app = Resolve-AppSession $id
  $title = if ($app.title) { $app.title } elseif ($d.project) { $d.project } else { $id.Substring(0, 8) }
  [pscustomobject]@{
    id = $id; data = $d; state = $state; elapsed = $elapsed; ctx = $ctx; stamp = $stamp
    startedAt = if ($w) { $w.startedAt } else { 0 }
    title = $title; appId = $app.appId
    windowUsd = $null; windowPct = $null; isPartial = $false
  }
}

# The Claude app keeps a file per session naming its CLI session id; it gives the
# session's title and the id its claude:// link needs.
$script:appSessions = @{}
function Resolve-AppSession([string]$cliId) {
  $known = $script:appSessions[$cliId]
  $now = [DateTime]::Now
  if ($known) {
    $age = ($now - $known.checkedAt).TotalSeconds
    if ($known.path -and $age -lt 60) { return $known }
    if (-not $known.path -and $age -lt 20) { return $known }
  }
  $entry = @{ appId = $null; title = $null; path = $null; checkedAt = $now }
  try {
    $path = if ($known -and $known.path) { $known.path } else {
      $hit = Get-ChildItem $appSessionRoot -Recurse -Filter 'local_*.json' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-String -Pattern $cliId -SimpleMatch -List -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($hit) { $hit.Path } else { $null }
    }
    if ($path) {
      $j = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
      if ($j.cliSessionId -eq $cliId) {
        $entry.appId = $j.sessionId; $entry.title = $j.title; $entry.path = $path
      }
    }
  } catch {}
  $script:appSessions[$cliId] = $entry
  $entry
}

# Handed to explorer.exe to open, so the widget's own thread does not stall while
# Windows resolves the link and brings the app forward (the core would stutter).
function Open-AppSession($s) {
  if (-not $s -or -not $s.appId) { return }
  try { Start-Process explorer.exe -ArgumentList "claude://claude.ai/epitaxy/$($s.appId)" } catch { Write-Failure $_ }
}

function Find-Session([string]$id) {
  $script:sessions | Where-Object { $_.id -eq $id } | Select-Object -First 1
}

# Which session the panel's detail follows: the one picked in the list while it
# lives, else one asking a question, else the newest working one, else the one written last.
function Get-FocusSession($list) {
  if ($script:focusId) {
    $picked = $list | Where-Object { $_.id -eq $script:focusId } | Select-Object -First 1
    if ($picked) { return $picked }
    $script:focusId = $null
  }
  $asking = $list | Where-Object { $_.state -eq 'ask' } | Select-Object -First 1
  if ($asking) { return $asking }
  $working = @($list | Where-Object { $_.state -eq 'working' } | Sort-Object startedAt -Descending)
  if ($working.Count -gt 0) { return $working[0] }
  $list | Sort-Object stamp -Descending | Select-Object -First 1
}

# ---------- session list (panel): rows are kept per session and updated in place ----------

$script:rows = @{}
$script:order = New-Object System.Collections.Generic.List[string]

function Get-StateColor([string]$state) {
  switch ($state) { 'ask' { 'Ask' } 'working' { 'Accent' } 'done' { 'Done' } default { 'Faint' } }
}

# Each row leads with a small pixel core (12x12, shown at twice the size) in the
# big core's language: dim when idle, a lamp running round while working, violet
# when asking, green when just done. Frames are drawn once and reused.
$palettes['green'] = @('#EFFFF4', '#A8F5C3', '#4ADE80', '#22A55A', '#137A3F', '#0B4626' | ForEach-Object { , (ConvertTo-Bgra $_) })
$miniN = 12
function New-MiniFrame([string]$hue, [int]$shift, [int]$lit) {
  $pal = $palettes[$hue]
  $mid = ($miniN - 1) / 2
  $buffer = New-Object byte[] ($miniN * $miniN * 4)
  for ($y = 0; $y -lt $miniN; $y++) {
    for ($x = 0; $x -lt $miniN; $x++) {
      $dx = $x - $mid; $dy = $y - $mid
      $d = [Math]::Sqrt($dx * $dx + $dy * $dy)
      $a = ([Math]::Atan2($dx, -$dy) * 180 / [Math]::PI + 360) % 360
      $color = $null
      if ($d -gt 5.7) { continue }
      elseif ($d -gt 4.5) {
        $color = $pal[4]
        if ($lit -ge 0) {
          switch ((($lit - [int][Math]::Floor($a / 45)) + 8) % 8) { 0 { $color = $pal[1] } 1 { $color = $pal[2] } 2 { $color = $pal[3] } }
        }
      }
      elseif ($d -gt 3.5) { $color = $pxOutline }
      elseif ($d -gt 2.0) { $color = $pal[2 + $shift] }
      else { $color = $pal[0 + $shift] }
      $o = ($y * $miniN + $x) * 4
      $buffer[$o] = $color[0]; $buffer[$o + 1] = $color[1]; $buffer[$o + 2] = $color[2]; $buffer[$o + 3] = $color[3]
    }
  }
  $bitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap $miniN, $miniN, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
  $bitmap.WritePixels((New-Object System.Windows.Int32Rect 0, 0, $miniN, $miniN), $buffer, $miniN * 4, 0)
  $bitmap.Freeze()
  , $bitmap
}
$miniFrames = @{
  idle    = @(New-MiniFrame 'cyan' 3 -1)
  done    = @(New-MiniFrame 'green' 0 -1)
  working = @(0..7 | ForEach-Object { New-MiniFrame 'cyan' ($_ % 2) $_ })
  ask     = @(0..7 | ForEach-Object { New-MiniFrame 'violet' ($_ % 2) $_ })
}
$script:miniFrame = 0

# A row's context as ten pixel cells, one per 10%, coloured like the usage ring.
$gaugeCells = 10
$gaugeArtWidth = $gaugeCells * 3 - 1
$gaugeArtHeight = 6
$script:gauges = @{}
function Get-CtxGauge([double]$pct) {
  $filled = [int][Math]::Round([Math]::Max(0, [Math]::Min(100, $pct)) / 10)
  $level = Get-Level $pct
  $key = "$filled|$level"
  if ($script:gauges[$key]) { return , $script:gauges[$key] }
  $main = $ringColors[$level][0]; $hi = $ringColors[$level][1]
  $buffer = New-Object byte[] ($gaugeArtWidth * $gaugeArtHeight * 4)
  for ($cell = 0; $cell -lt $gaugeCells; $cell++) {
    for ($dx = 0; $dx -lt 2; $dx++) {
      for ($y = 0; $y -lt $gaugeArtHeight; $y++) {
        $color = if ($cell -lt $filled) { if ($y -eq 0) { $hi } else { $main } } else { if ($y -eq 0) { $pxTrackHi } else { $pxTrack } }
        $o = ($y * $gaugeArtWidth + $cell * 3 + $dx) * 4
        $buffer[$o] = $color[0]; $buffer[$o + 1] = $color[1]; $buffer[$o + 2] = $color[2]; $buffer[$o + 3] = $color[3]
      }
    }
  }
  $bitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap $gaugeArtWidth, $gaugeArtHeight, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
  $bitmap.WritePixels((New-Object System.Windows.Int32Rect 0, 0, $gaugeArtWidth, $gaugeArtHeight), $buffer, $gaugeArtWidth * 4, 0)
  $bitmap.Freeze()
  $script:gauges[$key] = $bitmap
  , $bitmap
}
function Set-MiniCore($row) {
  $frames = $miniFrames[$(if ($miniFrames.ContainsKey($row.state)) { $row.state } else { 'idle' })]
  $row.mini.Source = $frames[$script:miniFrame % $frames.Count]
}

# Called from the core's animation clock; turns the row lamps every other frame.
function Step-MiniCores {
  $script:miniFrame = ($script:miniFrame + 1) % 8
  if ($script:q -and -not $script:q.isSent -and $questionCard.Visibility -eq 'Visible') { $script:q.mini.Source = $miniFrames['ask'][$script:miniFrame] }
  if ($panel.Visibility -ne 'Visible') { return }
  foreach ($row in $script:rows.Values) { if ($row.state -eq 'working' -or $row.state -eq 'ask') { Set-MiniCore $row } }
}

function Set-RowBackground($row) {
  $row.border.Background = if ($row.id -eq $script:chatId) { $brushes['AccentWash'] }
    elseif ($row.border.IsMouseOver) { $brushes['Hover'] } else { $brushes['None'] }
}

# The small square buttons at the end of a row.
function New-RowButton([string]$tag, [string]$tip) {
  $b = New-Object System.Windows.Controls.Border
  $b.Height = 24; $b.MinWidth = 26; $b.CornerRadius = 2; $b.Margin = '6,0,0,0'; $b.Padding = '6,0,6,0'
  $b.VerticalAlignment = 'Center'; $b.Cursor = 'Hand'; $b.BorderThickness = 1
  $b.Background = $brushes['None']; $b.BorderBrush = $brushes['None']
  $b.Tag = $tag; $b.ToolTip = $tip
  $label = New-Text -Color Muted -Size 12.5; $label.HorizontalAlignment = 'Center'
  $b.Child = $label
  , $b
}

function New-SessionRow([string]$id) {
  $border = New-Object System.Windows.Controls.Border
  $border.CornerRadius = 2; $border.Padding = '6,6,4,6'
  $border.Background = $brushes['None']

  $dock = New-Object System.Windows.Controls.DockPanel
  $mini = New-Object System.Windows.Controls.Image
  $mini.Width = 24; $mini.Height = 24; $mini.Margin = '0,2,10,0'; $mini.VerticalAlignment = 'Top'
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($mini, 'NearestNeighbor')
  [System.Windows.Controls.DockPanel]::SetDock($mini, 'Left')
  [void]$dock.Children.Add($mini)

  $jump = New-RowButton $id '이 세션으로 이동'
  $jump.Child.Text = '↗'
  [System.Windows.Controls.DockPanel]::SetDock($jump, 'Right')
  [void]$dock.Children.Add($jump)


  $meters = New-Object System.Windows.Controls.StackPanel
  $meters.Margin = '8,0,0,0'; $meters.VerticalAlignment = 'Center'
  # The context gauge is also the compact button: press it twice to compact.
  $gauge = New-Object System.Windows.Controls.Image
  $gauge.Width = $gaugeArtWidth * 2; $gauge.Height = $gaugeArtHeight * 2
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($gauge, 'NearestNeighbor')
  $gaugeBox = New-Object System.Windows.Controls.Border
  $gaugeBox.Width = $gaugeArtWidth * 2 + 10; $gaugeBox.Height = 24
  $gaugeBox.BorderThickness = 2; $gaugeBox.CornerRadius = 0
  $gaugeBox.Background = $brushes['None']; $gaugeBox.BorderBrush = $brushes['None']
  $gaugeBox.Cursor = 'Hand'; $gaugeBox.HorizontalAlignment = 'Right'; $gaugeBox.Tag = $id
  $gauge.HorizontalAlignment = 'Center'; $gauge.VerticalAlignment = 'Center'
  $gaugeFace = New-Text -Color Warn -Size 12.5 -Bold
  $gaugeFace.Text = '▼ 압축'; $gaugeFace.HorizontalAlignment = 'Center'; $gaugeFace.VerticalAlignment = 'Center'
  $gaugeBox.Child = $gauge
  [void]$meters.Children.Add($gaugeBox)
  $share = New-Text -Size 11.5 -Mono; $share.HorizontalAlignment = 'Right'; $share.Margin = '0,1,0,0'
  $share.ToolTip = '이번 5시간 창에서 이 세션이 쓴 비중 (비용 비중으로 나눈 추정치)'
  [void]$meters.Children.Add($share)
  [System.Windows.Controls.DockPanel]::SetDock($meters, 'Right')
  [void]$dock.Children.Add($meters)

  $stack = New-Object System.Windows.Controls.StackPanel
  $stack.VerticalAlignment = 'Center'
  $title = New-Text -Size 13.5 -Bold; $title.TextTrimming = 'CharacterEllipsis'
  [void]$stack.Children.Add($title)
  $doing = New-Text -Size 12.5; $doing.TextTrimming = 'CharacterEllipsis'; $doing.Margin = '0,2,0,0'
  [void]$stack.Children.Add($doing)
  [void]$dock.Children.Add($stack)
  $border.Child = $dock

  $border.Tag = $id
  $row = @{ id = $id; border = $border; mini = $mini; jump = $jump; gaugeBox = $gaugeBox; gauge = $gauge; gaugeFace = $gaugeFace; share = $share; title = $title; doing = $doing; view = $null; state = 'idle'; canCompact = $true }

  # Handlers find their row by the id in Tag; they run in the script's scope.
  $border.Add_MouseEnter({ param($sender, $e) Set-RowBackground $script:rows[[string]$sender.Tag] })
  $border.Add_MouseLeave({ param($sender, $e) Set-RowBackground $script:rows[[string]$sender.Tag] })
  $border.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Set-ChatSession ([string]$sender.Tag) })
  $border.Cursor = 'Hand'

  $jump.Add_MouseLeftButtonDown({
    param($sender, $e)
    $e.Handled = $true
    $r = $script:rows[[string]$sender.Tag]
    if ($r -and $r.view) { Open-AppSession $r.view }
  })
  $gaugeBox.Add_MouseLeftButtonDown({
    param($sender, $e)
    $e.Handled = $true
    Press-Compact ([string]$sender.Tag)
  })
  foreach ($b in @($jump, $gaugeBox)) {
    $b.Add_MouseEnter({ param($sender, $e) Update-RowButtons $script:rows[[string]$sender.Tag] })
    $b.Add_MouseLeave({ param($sender, $e) Update-RowButtons $script:rows[[string]$sender.Tag] })
  }
  $row
}

# ---------- per-row compaction: hovering the gauge turns it into a button, one press sends it ----------

$script:sentId = $null
$script:sentAt = [DateTime]::MinValue

function Send-Compact([string]$sessionId) {
  try {
    $dir = Join-Path $liveDir 'commands'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $json = @{ action = 'compact'; id = [guid]::NewGuid().ToString() } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText((Join-Path $dir "$sessionId.json"), $json)
    $script:sentId = $sessionId
    $script:sentAt = [DateTime]::Now
  } catch { Write-Failure $_ }
}

function Press-Compact([string]$id) {
  $row = $script:rows[$id]
  if (-not $row -or -not $row.canCompact) { return }
  Send-Compact $id
  Update-RowButtons $row
}
function Set-RowButton($button, [string]$text, [string]$color, [bool]$isLit, [bool]$isEnabled) {
  $button.Child.Text = $text
  $button.Child.Foreground = $brushes[$color]
  $button.IsEnabled = $isEnabled
  $button.Cursor = if ($isEnabled) { 'Hand' } else { 'Arrow' }
  $button.Background = if ($isLit) { $brushes['AccentWash'] } else { $brushes['None'] }
  $button.BorderBrush = if ($isLit) { $brushes['AccentLine'] } else { $brushes['None'] }
}

function Update-RowButtons($row) {
  if (-not $row -or -not $row.view) { return }
  $s = $row.view
  $j = $row.jump
  Set-RowButton $j '↗' $(if ($j.IsMouseOver -and $s.appId) { 'Accent' } else { 'Muted' }) ($j.IsMouseOver -and [bool]$s.appId) ([bool]$s.appId)

  $box = $row.gaugeBox
  $state = $s.data.compact
  $isSent = $script:sentId -eq $s.id -and ([DateTime]::Now - $script:sentAt).TotalSeconds -lt 3
  $failure = $s.data.compactError
  $isFailed = $failure -and ($s.data.writtenAt - $failure.at) -lt 20000
  $isBusy = $state -eq 'running' -or $state -eq 'queued' -or $state -eq 'submitted'
  $row.canCompact = -not ($isBusy -or $isSent)
  $isOffered = $box.IsMouseOver -and $row.canCompact
  $box.Cursor = if ($row.canCompact) { 'Hand' } else { 'Arrow' }
  $box.BorderBrush = if ($isOffered) { $brushes['Warn'] } else { $brushes['None'] }
  $box.Background = if ($isOffered) { $converter.ConvertFromString('#26F5B841') } else { $brushes['None'] }
  $face = if ($isOffered) { $row.gaugeFace } else { $row.gauge }
  if (-not [object]::ReferenceEquals($box.Child, $face)) { $box.Child = $face }
  Set-Pulse $row.gauge $isBusy
  $ctxText = if ($null -ne $s.ctx) { "컨텍스트 $($s.ctx)%" } else { '컨텍스트' }
  $box.ToolTip = if ($row.canCompact) { "$ctxText · 눌러서 압축" } else { $ctxText }

  # The line under the gauge: the compaction's progress when there is one, else the 5h share.
  $row.share.Inlines.Clear()
  $row.share.ToolTip = '이번 5시간 창에서 이 세션이 쓴 비중 (비용 비중으로 나눈 추정치)'
  if ($state -eq 'running') { Add-Run $row.share '압축 중…' 'Faint' }
  elseif ($state -eq 'queued') { Add-Run $row.share '끝나면 압축' 'Warn' }
  elseif ($state -eq 'submitted') { Add-Run $row.share '곧 압축' 'Warn' }
  elseif ($isSent) { Add-Run $row.share '보냄' 'Faint' }
  elseif ($isFailed) { Add-Run $row.share '압축 실패' 'Danger'; $row.share.ToolTip = [string]$failure.message }
  elseif ($null -ne $s.windowPct) {
    Add-Run $row.share '5h ' 'Faint'
    Add-Run $row.share (Format-Share $s.windowPct $s.isPartial) 'Warn'
  }
}
function Update-SessionList($list) {
  $alive = @{}
  foreach ($s in $list) { $alive[$s.id] = $s }
  foreach ($id in @($script:rows.Keys)) {
    if (-not $alive.ContainsKey($id)) {
      $sessionList.Children.Remove($script:rows[$id].border)
      $script:rows.Remove($id)
    }
  }
  foreach ($s in $list) {
    if (-not $script:rows.ContainsKey($s.id)) {
      $script:rows[$s.id] = New-SessionRow $s.id
      [void]$sessionList.Children.Add($script:rows[$s.id].border)
    }
    $row = $script:rows[$s.id]
    $row.view = $s
    $row.state = $s.state
    $w = $s.data.work

    Set-MiniCore $row
    $row.title.Text = $s.title
    $row.title.Foreground = if ($s.state -eq 'idle') { $brushes['Sub'] } else { $brushes['Text'] }

    # One line: what the session is doing right now.
    $row.doing.Inlines.Clear()
    switch ($s.state) {
      'ask' {
        Add-Run $row.doing '? ' 'Ask'
        Add-Run $row.doing (@($s.data.question.questions)[0].question) 'Sub'
      }
      'working' {
        Add-Run $row.doing "$(Format-Clock $s.elapsed)  " 'Sub' -Mono
        if ($w.current) {
          Add-Run $row.doing "$($w.current.glyph) " 'Accent'
          Add-Run $row.doing "$($w.current.label) $($w.current.action) 중" 'Muted'
        } else {
          Add-Run $row.doing '생각하는 중' 'Muted'
        }
      }
      'done' {
        Add-Run $row.doing '✓ 끝났어요' 'Done'
        Add-Run $row.doing $(if ($w.edited -gt 0) { "  ·  파일 $($w.edited)개 수정" } else { '' }) 'Muted'
      }
      default {
        Add-Run $row.doing '대기' 'Faint'
        if ($s.data.project) { Add-Run $row.doing "  ·  $($s.data.project)" 'Faint' }
      }
    }

    if ($null -ne $s.ctx) {
      $row.gauge.Source = Get-CtxGauge $s.ctx
      $row.gauge.Visibility = 'Visible'
    } else {
      $row.gauge.Visibility = 'Hidden'
    }

    Update-RowButtons $row
    Set-RowBackground $row
  }
  $listLabel.Text = "세션 $($list.Count)개  ·  눌러서 대화  ·  게이지 압축  ·  ↗ 이동"
}

# ---------- chat: a session's recent conversation under its row, and a line to prompt it ----------
# A click on a row opens it there, another closes it. The plugin writes the
# conversation only while the chat is open: the widget keeps touching a watch file.

$chatDir = Join-Path $liveDir 'chat'
$promptDir = Join-Path $liveDir 'prompts'
$script:chatId = $null
$script:chatStamp = $null
$script:chatWatchAt = [DateTime]::MinValue
$script:chatData = $null
$script:chatReadAt = $null
$script:chatStatus = $null

$chatCard.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true })
$chatStack = $chatBody

# Header: the session's small core and title, and a close mark.
$chatHead = New-Object System.Windows.Controls.DockPanel
$chatHead.Margin = '4,0,0,8'
$chatMini = New-Object System.Windows.Controls.Image
$chatMini.Width = 24; $chatMini.Height = 24; $chatMini.Margin = '0,0,8,0'
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($chatMini, 'NearestNeighbor')
[System.Windows.Controls.DockPanel]::SetDock($chatMini, 'Left')
[void]$chatHead.Children.Add($chatMini)
$chatClose = New-PixelLink @(, @('✕', 'Muted', $false)) 'close'
$chatClose.Padding = '8,0,4,0'; $chatClose.ToolTip = '닫기 (Esc)'
$chatClose.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Set-ChatSession $script:chatId })
[System.Windows.Controls.DockPanel]::SetDock($chatClose, 'Right')
[void]$chatHead.Children.Add($chatClose)
$chatTitle = New-Text -Size 13.5 -Bold
$chatTitle.TextTrimming = 'CharacterEllipsis'
[void]$chatHead.Children.Add($chatTitle)
[void]$chatStack.Children.Add($chatHead)

# The conversation: scrolls with the wheel, no bar, follows the newest line.
$chatWell = New-Object System.Windows.Controls.Border
$chatWell.BorderThickness = 2; $chatWell.BorderBrush = $brushes['Edge']
$chatWell.Background = $converter.ConvertFromString('#CC070B10')
$chatScroll = New-Object System.Windows.Controls.ScrollViewer
$chatScroll.Height = 270
$chatScroll.VerticalScrollBarVisibility = 'Hidden'; $chatScroll.HorizontalScrollBarVisibility = 'Disabled'
$chatLines = New-Object System.Windows.Controls.StackPanel
$chatLines.Margin = '10,6,10,6'
$chatScroll.Content = $chatLines
$chatWell.Child = $chatScroll
[void]$chatStack.Children.Add($chatWell)

# The prompt line: Enter sends, Shift+Enter breaks the line.
$chatInputDock = New-Object System.Windows.Controls.DockPanel
$chatInputDock.Margin = '0,8,0,0'
$chatSend = New-Object System.Windows.Controls.Border
$chatSend.Width = 36; $chatSend.Height = 34; $chatSend.Margin = '6,0,0,0'; $chatSend.VerticalAlignment = 'Bottom'
$chatSend.BorderThickness = 2; $chatSend.BorderBrush = $brushes['Accent']; $chatSend.Background = $brushes['AccentWash']
$chatSend.Cursor = 'Hand'; $chatSend.ToolTip = '보내기 (Enter)'
# A hand-drawn arrow, 7x8 art at twice the size, so it sits dead centre.
$arrowArt = @('...#...', '..###..', '.#.#.#.', '#..#..#', '...#...', '...#...', '...#...', '...#...')
$arrowColor = $palettes['cyan'][2]
$arrowBuffer = New-Object byte[] (7 * 8 * 4)
for ($y = 0; $y -lt 8; $y++) {
  for ($x = 0; $x -lt 7; $x++) {
    if ($arrowArt[$y][$x] -ne '#') { continue }
    $o = ($y * 7 + $x) * 4
    $arrowBuffer[$o] = $arrowColor[0]; $arrowBuffer[$o + 1] = $arrowColor[1]; $arrowBuffer[$o + 2] = $arrowColor[2]; $arrowBuffer[$o + 3] = $arrowColor[3]
  }
}
$arrowBitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap 7, 8, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
$arrowBitmap.WritePixels((New-Object System.Windows.Int32Rect 0, 0, 7, 8), $arrowBuffer, 28, 0)
$arrowBitmap.Freeze()
$sendArrow = New-Object System.Windows.Controls.Image
$sendArrow.Source = $arrowBitmap; $sendArrow.Width = 14; $sendArrow.Height = 16
$sendArrow.HorizontalAlignment = 'Center'; $sendArrow.VerticalAlignment = 'Center'
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($sendArrow, 'NearestNeighbor')
$chatSend.Child = $sendArrow
$chatSend.Add_MouseEnter({ param($sender, $e) $sender.Background = $converter.ConvertFromString('#4022D3EE') })
$chatSend.Add_MouseLeave({ param($sender, $e) $sender.Background = $brushes['AccentWash'] })
$chatSend.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Send-ChatPrompt })
[System.Windows.Controls.DockPanel]::SetDock($chatSend, 'Right')
[void]$chatInputDock.Children.Add($chatSend)
$chatField = New-Object System.Windows.Controls.Grid
$chatInput = New-Object System.Windows.Controls.TextBox
$chatInput.FontFamily = 'Malgun Gothic'; $chatInput.FontSize = 13; $chatInput.Padding = '8,6,8,6'
$chatInput.MinHeight = 34; $chatInput.MaxHeight = 80; $chatInput.BorderThickness = 2
$chatInput.AcceptsReturn = $true; $chatInput.TextWrapping = 'Wrap'; $chatInput.VerticalScrollBarVisibility = 'Hidden'
$chatInput.Background = $brushes['Field']; $chatInput.Foreground = $brushes['Text']
$chatInput.BorderBrush = $brushes['Edge']; $chatInput.CaretBrush = $brushes['Accent']; $chatInput.SelectionBrush = $brushes['Accent']
$chatHint = New-Text -Color Faint -Size 13
$chatHint.Text = '메시지 보내기'; $chatHint.Margin = '11,0,0,0'; $chatHint.IsHitTestVisible = $false
$chatInput.Add_TextChanged({ param($sender, $e) $chatHint.Visibility = if ($sender.Text) { 'Collapsed' } else { 'Visible' } })
$chatInput.Add_GotKeyboardFocus({ param($sender, $e) $sender.BorderBrush = $brushes['Accent'] })
$chatInput.Add_LostKeyboardFocus({ param($sender, $e) $sender.BorderBrush = $brushes['Edge'] })
$chatInput.Add_PreviewKeyDown({
  param($sender, $e)
  $isShift = ([System.Windows.Input.Keyboard]::Modifiers -band [System.Windows.Input.ModifierKeys]::Shift) -ne 0
  if ($e.Key -eq 'Return' -and -not $isShift) { $e.Handled = $true; Send-ChatPrompt }
  elseif ($e.Key -eq 'Escape') { $e.Handled = $true; Set-ChatSession $script:chatId }
})
[void]$chatField.Children.Add($chatInput)
[void]$chatField.Children.Add($chatHint)
[void]$chatInputDock.Children.Add($chatField)
[void]$chatStack.Children.Add($chatInputDock)

# A line under the prompt only when something went wrong.
$chatStatusText = New-Text -Size 11.5
$chatStatusText.Margin = '2,6,2,0'; $chatStatusText.TextTrimming = 'CharacterEllipsis'; $chatStatusText.Visibility = 'Collapsed'
[void]$chatStack.Children.Add($chatStatusText)

function Set-ChatStatus([string]$text, [string]$color = 'Faint') {
  $key = "$text|$color"
  if ($script:chatStatus -eq $key) { return }
  $script:chatStatus = $key
  $chatStatusText.Text = $text; $chatStatusText.Foreground = $brushes[$color]; $chatStatusText.ToolTip = $text
  $chatStatusText.Visibility = if ($text) { 'Visible' } else { 'Collapsed' }
}

# Three pixel squares pulsing in turn: the session is on it.
$chatLoader = New-Object System.Windows.Controls.StackPanel
$chatLoader.Orientation = 'Horizontal'; $chatLoader.Margin = '0,8,0,2'
for ($i = 0; $i -lt 3; $i++) {
  $dot = New-Object System.Windows.Shapes.Rectangle
  $dot.Width = 6; $dot.Height = 6; $dot.Margin = '0,0,4,0'; $dot.Fill = $brushes['Accent']; $dot.VerticalAlignment = 'Center'
  $blink = New-Object System.Windows.Media.Animation.DoubleAnimation 0.2, 1.0, (New-Duration 420)
  $blink.AutoReverse = $true
  $blink.RepeatBehavior = [System.Windows.Media.Animation.RepeatBehavior]::Forever
  $blink.BeginTime = [TimeSpan]::FromMilliseconds(140 * $i)
  $dot.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $blink)
  [void]$chatLoader.Children.Add($dot)
}
$chatLoaderText = New-Text -Color Muted -Size 11.5
$chatLoaderText.Margin = '4,0,0,0'
[void]$chatLoader.Children.Add($chatLoaderText)

function Add-ChatText([string]$text, [string]$color, [double]$size, [string]$margin) {
  $t = New-Text -Color $color -Size $size
  $t.Text = $text; $t.TextWrapping = 'Wrap'; $t.Margin = $margin
  [void]$chatLines.Children.Add($t)
  $t
}

function Add-UserBubble([string]$text, [bool]$isPending, [string]$note, [string]$cancelId) {
  $bubble = New-Object System.Windows.Controls.Border
  $bubble.HorizontalAlignment = 'Right'; $bubble.MaxWidth = 250; $bubble.Margin = '40,5,0,5'; $bubble.Padding = '8,4,8,5'
  $bubble.Background = $brushes['AccentWash']; $bubble.BorderBrush = $brushes['AccentLine']; $bubble.BorderThickness = 1
  if ($isPending) { $bubble.Opacity = 0.7 }
  $t = New-Text -Color Text -Size 12.5
  $t.Text = $text; $t.TextWrapping = 'Wrap'
  $bubble.Child = $t
  [void]$chatLines.Children.Add($bubble)
  if ($note) {
    # Under a waiting prompt: why it waits, and a way to take it back.
    $line = New-Object System.Windows.Controls.StackPanel
    $line.Orientation = 'Horizontal'; $line.HorizontalAlignment = 'Right'; $line.Margin = '0,-3,0,4'
    $n = New-Text -Color Faint -Size 11
    $n.Text = $note
    [void]$line.Children.Add($n)
    if ($cancelId) {
      $cancel = New-Text -Color Muted -Size 11
      $cancel.Text = '취소'; $cancel.Margin = '8,0,0,0'; $cancel.Cursor = 'Hand'; $cancel.Tag = $cancelId
      $cancel.TextDecorations = [System.Windows.TextDecorations]::Underline
      $cancel.ToolTip = '보내지 않고 지우기'
      $cancel.Add_MouseEnter({ param($sender, $e) $sender.Foreground = $brushes['Danger'] })
      $cancel.Add_MouseLeave({ param($sender, $e) $sender.Foreground = $brushes['Muted'] })
      $cancel.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Remove-Outgoing ([string]$sender.Tag) })
      [void]$line.Children.Add($cancel)
    }
    [void]$chatLines.Children.Add($line)
  }
}

# Takes back a prompt the widget still holds; one already handed over has gone in.
function Remove-Outgoing([string]$itemId) {
  $box = $script:outboxes[$script:chatId]
  if (-not $box) { return }
  $item = $box | Where-Object { $_.id -eq $itemId -and $_.state -eq 'queued' } | Select-Object -First 1
  if ($item) { $box.Remove($item) }
  if ($box.Count -eq 0) { $script:outboxes.Remove($script:chatId) }
  Show-Chat
}

# Tool calls fold into one dim line: "› Read ×3 · Edit".
function Format-Tools($tools) {
  $counts = [ordered]@{}
  foreach ($t in @($tools)) { $counts[[string]$t] = 1 + [int]$counts[[string]$t] }
  '› ' + (($counts.Keys | ForEach-Object { if ($counts[$_] -gt 1) { "$_ ×$($counts[$_])" } else { $_ } }) -join ' · ')
}

# ---------- outgoing prompts: shown at once as sent, delivered one at a time ----------
# Each session has a small outbox. A prompt shows in the chat the moment it is
# typed; the widget hands the plugin one at a time through the session's prompt
# file and drops the line once the conversation itself carries it. A prompt sent
# while the session works waits its turn, and the chat says so.

$script:outboxes = @{}

function Get-Prefix([string]$text) { $text.Substring(0, [Math]::Min(60, $text.Length)) }

function Get-UserCount($data, [string]$prefix) {
  if (-not $data) { return 0 }
  @($data.lines | Where-Object { $_.role -eq 'user' -and ([string]$_.text).StartsWith($prefix) }).Count
}

# The conversation carries a prompt once there are more lines like it than when it
# went out, or the newest line from the person is it.
function Test-Delivered($item, $data) {
  if (-not $data -or $item.state -ne 'taken') { return $false }
  if ((Get-UserCount $data $item.prefix) -gt $item.baseline) { return $true }
  $last = @($data.lines | Where-Object { $_.role -eq 'user' }) | Select-Object -Last 1
  $last -and ([string]$last.text).StartsWith($item.prefix) -and $script:chatReadAt -gt $item.at
}

function Show-Chat {
  $id = $script:chatId
  if (-not $id) { return }
  $data = $script:chatData
  $atEnd = $chatScroll.VerticalOffset -ge $chatScroll.ScrollableHeight - 4
  $chatLines.Children.Clear()
  $box = $script:outboxes[$id]
  if ($box) {
    foreach ($item in @($box)) { if (Test-Delivered $item $data) { $box.Remove($item) } }
  }
  $lines = if ($data) { @($data.lines) } else { @() }
  if (-not $data -and -not $box) { [void](Add-ChatText '불러오는 중…' 'Faint' 12 '0,4,0,4') }
  elseif ($lines.Count -eq 0 -and -not $box) { [void](Add-ChatText '아직 대화가 없어요' 'Faint' 12 '0,4,0,4') }
  foreach ($l in $lines) {
    switch ([string]$l.role) {
      'user' { Add-UserBubble ([string]$l.text) $false '' }
      'assistant' { [void](Add-ChatText ([string]$l.text) 'Sub' 12.5 '0,4,16,4') }
      'tools' { [void](Add-ChatText (Format-Tools $l.tools) 'Faint' 11.5 '0,1,0,1') }
    }
  }
  $isWaiting = $false
  if ($box) {
    foreach ($item in @($box)) {
      if ($item.state -eq 'queued') { Add-UserBubble $item.text $true '대기 중 · 작업이 끝나면 보내요' $item.id }
      else { Add-UserBubble $item.text $true '' '' }
      $isWaiting = $true
    }
  }
  $isActive = ($data -and $data.isActive) -or $script:rows[$id].state -eq 'working'
  if ($isActive -or $isWaiting) {
    $chatLoaderText.Text = if ($isActive) { '작업 중' } else { '' }
    [void]$chatLines.Children.Add($chatLoader)
  }
  if ($atEnd -or -not $script:chatStamp) { $chatScroll.UpdateLayout(); $chatScroll.ScrollToEnd() }
}

# Every tick: hand each session's next prompt over once its prompt file is free.
function Send-Outboxes {
  $now = [DateTime]::Now
  $changed = $false
  foreach ($sid in @($script:outboxes.Keys)) {
    $box = $script:outboxes[$sid]
    $path = Join-Path $promptDir "$sid.json"
    $text = ''
    if (Test-Path $path) { try { $text = ([IO.File]::ReadAllText($path)).Trim() } catch { $text = 'busy' } }
    $isFree = $text -eq '' -or $text -eq '{}'
    foreach ($item in @($box)) {
      if ($item.state -eq 'sent') {
        if ($isFree) { $item.state = 'taken'; $item.at = $now; $changed = $true }
        elseif (($now - $item.at).TotalSeconds -gt 15) {
          $box.Remove($item); $changed = $true
          if ($sid -eq $script:chatId) { Set-ChatStatus '세션이 받지 않았어요 · 플러그인이 다시 불러와지는 중일 수 있어요' 'Warn' }
        }
      } elseif ($item.state -eq 'taken' -and ($now - $item.at).TotalMinutes -gt 10) {
        $box.Remove($item); $changed = $true
      }
    }
    $isHanded = @($box | Where-Object { $_.state -eq 'sent' }).Count -gt 0
    # Prompts wait in the widget while the session works or asks, so they can still
    # be taken back; the next goes over once it is free.
    $session = $script:sessions | Where-Object { $_.id -eq $sid } | Select-Object -First 1
    $isBusy = $session -and ($session.state -eq 'working' -or $session.state -eq 'ask')
    $isInFlight = @($box | Where-Object { $_.state -eq 'taken' -and ([DateTime]::Now - $_.at).TotalSeconds -lt 4 }).Count -gt 0
    if ($isFree -and -not $isHanded -and -not $isBusy -and -not $isInFlight) {
      $next = $box | Where-Object { $_.state -eq 'queued' } | Select-Object -First 1
      if ($next) {
        try {
          New-Item -ItemType Directory -Force $promptDir | Out-Null
          [IO.File]::WriteAllText($path, (@{ id = $next.id; text = $next.text } | ConvertTo-Json -Compress))
          $next.state = 'sent'; $next.at = $now
        } catch { Write-Failure $_ }
      }
    }
    if ($box.Count -eq 0) { $script:outboxes.Remove($sid) }
  }
  if ($changed -and $script:chatId) { Show-Chat }
}

function Send-ChatPrompt {
  $text = $chatInput.Text.Trim()
  $id = $script:chatId
  if (-not $text -or -not $id) { return }
  if (-not $script:outboxes[$id]) { $script:outboxes[$id] = New-Object System.Collections.ArrayList }
  $data = $script:chatData
  $prefix = Get-Prefix $text
  $isBusy = ($data -and $data.isActive) -or $script:rows[$id].state -eq 'working' -or $script:outboxes[$id].Count -gt 0
  [void]$script:outboxes[$id].Add(@{
    id = [guid]::NewGuid().ToString(); text = $text; prefix = $prefix; baseline = (Get-UserCount $data $prefix)
    state = 'queued'; at = [DateTime]::Now; isQueued = [bool]$isBusy
  })
  $chatInput.Text = ''
  Set-ChatStatus ''
  Send-Outboxes
  $chatScroll.ScrollToEnd()
  Show-Chat
  $chatScroll.UpdateLayout(); $chatScroll.ScrollToEnd()
}

# Opens the chat card for a row's session, or closes it when that one is open.
function Set-ChatSession([string]$id) {
  if ($script:chatId -eq $id) { $id = $null }
  $script:chatId = $id
  $script:chatStamp = $null
  $script:chatData = $null
  $script:chatStatus = $null
  Set-ChatStatus ''
  if ($id -and $script:rows.ContainsKey($id)) {
    $chatInput.Text = ''
    $script:chatWatchAt = [DateTime]::MinValue
    Update-Chat
    Show-Chat
    $chatCard.Visibility = 'Visible'
    # Placed before it is first drawn, then faded in, so it never shows at the wrong spot.
    Set-Layout
    $fade = New-Object System.Windows.Media.Animation.DoubleAnimation 0, 1, (New-Duration 140)
    $chatCard.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $fade)
  } else {
    $script:chatId = $null
    $chatCard.Visibility = 'Collapsed'
    Set-Layout
  }
  foreach ($r in $script:rows.Values) { Set-RowBackground $r }
}

# Every tick while the panel is open: keep the watch alive, redraw on a new file.
function Update-Chat {
  $id = $script:chatId
  if (-not $id) { return }
  if (-not $script:rows.ContainsKey($id)) { Set-ChatSession $id; return }
  $row = $script:rows[$id]
  $chatTitle.Text = [string]$row.view.title
  $frames = $miniFrames[$(if ($miniFrames.ContainsKey($row.state)) { $row.state } else { 'idle' })]
  $chatMini.Source = $frames[$script:miniFrame % $frames.Count]
  $now = [DateTime]::Now
  if (($now - $script:chatWatchAt).TotalSeconds -ge 2) {
    try {
      New-Item -ItemType Directory -Force $chatDir | Out-Null
      [IO.File]::WriteAllText((Join-Path $chatDir "$id.watch"), [string]$now.Ticks)
    } catch {}
    $script:chatWatchAt = $now
  }
  $path = Join-Path $chatDir "$id.json"
  if (-not (Test-Path $path)) { return }
  $stamp = (Get-Item $path).LastWriteTimeUtc.Ticks
  if ($stamp -eq $script:chatStamp) { return }
  try { $data = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return }
  $script:chatData = $data
  $script:chatReadAt = $now
  # A prompt the session refused: take it back out and say why.
  $box = $script:outboxes[$id]
  if ($box -and $data.ack -and $data.ack.error) {
    $failed = $box | Where-Object { $_.id -eq $data.ack.id } | Select-Object -First 1
    if ($failed) { $box.Remove($failed); Set-ChatStatus "보내지 못했어요: $($data.ack.error)" 'Danger' }
  }
  Show-Chat
  $script:chatStamp = $stamp
}

# ---------- questions: Claude's AskUserQuestion, answered from a card beside the core ----------
# One question to a page, in the asking violet with square pixel edges. A tap picks
# an option; on a single-choice page that also moves on (or, for a lone question,
# answers it). Typed text stands in for the options.

$script:q = $null
$qInner = 344
$qTextWidth = 296

# Option markers, 7x7 art at twice the size: a cut-corner ring for one choice, a box for many.
$script:markers = @{}
function Get-Marker([bool]$isMulti, [bool]$isOn) {
  $key = "$isMulti|$isOn"
  if ($script:markers[$key]) { return , $script:markers[$key] }
  $n = 7
  $edge = if ($isOn) { $palettes['violet'][2] } else { ConvertTo-Bgra '#5C6773' }
  $fill = $palettes['violet'][0]
  $check = @('1,3', '2,4', '3,3', '4,2', '5,1')
  $buffer = New-Object byte[] ($n * $n * 4)
  for ($y = 0; $y -lt $n; $y++) {
    for ($x = 0; $x -lt $n; $x++) {
      $isEdge = $x -eq 0 -or $y -eq 0 -or $x -eq ($n - 1) -or $y -eq ($n - 1)
      $isCorner = ($x -eq 0 -or $x -eq ($n - 1)) -and ($y -eq 0 -or $y -eq ($n - 1))
      $color = $null
      if ($isMulti) {
        if ($isEdge) { $color = $edge }
        elseif ($isOn -and $check -contains "$x,$y") { $color = $fill }
      } else {
        if ($isEdge -and -not $isCorner) { $color = $edge }
        elseif ($isOn -and $x -ge 2 -and $x -le 4 -and $y -ge 2 -and $y -le 4) { $color = $fill }
      }
      if (-not $color) { continue }
      $o = ($y * $n + $x) * 4
      $buffer[$o] = $color[0]; $buffer[$o + 1] = $color[1]; $buffer[$o + 2] = $color[2]; $buffer[$o + 3] = $color[3]
    }
  }
  $bitmap = New-Object System.Windows.Media.Imaging.WriteableBitmap $n, $n, 96, 96, ([System.Windows.Media.PixelFormats]::Bgra32), $null
  $bitmap.WritePixels((New-Object System.Windows.Int32Rect 0, 0, $n, $n), $buffer, $n * 4, 0)
  $bitmap.Freeze()
  $script:markers[$key] = $bitmap
  , $bitmap
}

function New-PixelImage([double]$size) {
  $image = New-Object System.Windows.Controls.Image
  $image.Width = $size; $image.Height = $size
  [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($image, 'NearestNeighbor')
  $image
}

# A typed answer: a square field, the hint in pixel text until something is typed.
function New-Field([string]$hint) {
  $grid = New-Object System.Windows.Controls.Grid
  $grid.Margin = '0,2,0,0'
  $box = New-Object System.Windows.Controls.TextBox
  $box.FontFamily = 'Malgun Gothic'; $box.FontSize = 13; $box.Padding = '8,6,8,6'; $box.BorderThickness = 2
  $box.Background = $brushes['Field']; $box.Foreground = $brushes['Text']
  $box.BorderBrush = $brushes['Edge']; $box.CaretBrush = $brushes['Ask']
  $box.SelectionBrush = $brushes['Ask']
  $hintText = New-PixelText -Parts @(, @($hint, 'Faint', $false)) -MaxWidth ($qInner - 24)
  $hintText.Margin = '10,0,0,0'; $hintText.IsHitTestVisible = $false
  $box.Tag = $hintText
  $box.Add_TextChanged({
    param($sender, $e)
    $sender.Tag.Visibility = if ($sender.Text) { 'Collapsed' } else { 'Visible' }
    Set-QuestionError ''
  })
  $box.Add_GotKeyboardFocus({ param($sender, $e) $sender.BorderBrush = $brushes['Ask'] })
  $box.Add_LostKeyboardFocus({ param($sender, $e) $sender.BorderBrush = $brushes['Edge'] })
  $box.Add_KeyDown({ param($sender, $e) if ($e.Key -eq 'Return') { $e.Handled = $true; Invoke-QuestionAction 'next' } })
  [void]$grid.Children.Add($box)
  [void]$grid.Children.Add($hintText)
  @{ grid = $grid; box = $box }
}

# An option: marker, label, and what it means beneath in a dimmer line.
function New-OptionRow([string]$label, [string]$about, [string]$tag, [bool]$isMulti) {
  $border = New-Object System.Windows.Controls.Border
  $border.BorderThickness = 2; $border.Padding = '8,2,8,2'; $border.Margin = '0,0,0,4'; $border.Cursor = 'Hand'
  $border.Tag = $tag
  $dock = New-Object System.Windows.Controls.DockPanel
  $mark = New-PixelImage 14
  $mark.Margin = '0,9,10,0'; $mark.VerticalAlignment = 'Top'
  [System.Windows.Controls.DockPanel]::SetDock($mark, 'Left')
  [void]$dock.Children.Add($mark)
  $text = New-Object System.Windows.Controls.StackPanel
  [void]$dock.Children.Add($text)
  $border.Child = $dock
  $border.Add_MouseEnter({ param($sender, $e) Set-OptionStyle ([string]$sender.Tag) })
  $border.Add_MouseLeave({ param($sender, $e) Set-OptionStyle ([string]$sender.Tag) })
  $border.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Select-Option ([string]$sender.Tag) })
  @{ border = $border; mark = $mark; text = $text; label = $label; about = $about; isMulti = $isMulti }
}

function Get-Option([string]$tag) {
  if (-not $script:q) { return $null }
  $parts = $tag.Split('|')
  $item = $script:q.items[[int]$parts[0]]
  @{ item = $item; option = $item.options[[int]$parts[1]] }
}

# Picked: violet wash and edge; under the pointer: a faint lift; otherwise quiet.
function Set-OptionStyle([string]$tag) {
  $hit = Get-Option $tag
  if (-not $hit) { return }
  $o = $hit.option
  $isOn = $hit.item.selected.Contains($o.label)
  $o.border.Background = if ($isOn) { $brushes['AskWash'] } elseif ($o.border.IsMouseOver) { $brushes['Hover'] } else { $brushes['None'] }
  $o.border.BorderBrush = if ($isOn) { $brushes['Ask'] } elseif ($o.border.IsMouseOver) { $brushes['AskLine'] } else { $brushes['Edge'] }
  $o.mark.Source = Get-Marker $o.isMulti $isOn
  $key = "$isOn"
  if ($o.styled -eq $key) { return }
  $o.styled = $key
  $o.text.Children.Clear()
  [void]$o.text.Children.Add((New-PixelText -Parts @(, @($o.label, $(if ($isOn) { 'Text' } else { 'Sub' }), $false)) -MaxWidth $qTextWidth))
  if ($o.about) {
    $about = New-PixelText -Parts @(, @($o.about, 'Muted', $false)) -MaxWidth $qTextWidth -Wrap
    $about.Margin = '0,-6,0,2'
    [void]$o.text.Children.Add($about)
  }
}

function Test-Answered($item) {
  ($item.field -and $item.field.Text.Trim()) -or $item.selected.Count -gt 0
}

# A word under the options when the answer can't go yet.
function Set-QuestionError([string]$text) {
  $q = $script:q
  if (-not $q -or $q.error -eq $text) { return }
  $q.error = $text
  $q.errorBox.Child = if ($text) { New-PixelText -Parts @(, @($text, 'Warn', $false)) -MaxWidth $qInner } else { $null }
  $q.errorBox.Visibility = if ($text) { 'Visible' } else { 'Collapsed' }
}

function New-QuestionButton([string]$text, [string]$action, [bool]$isPrimary) {
  $b = New-Object System.Windows.Controls.Border
  $b.Cursor = 'Hand'; $b.Tag = $action; $b.VerticalAlignment = 'Center'
  if ($isPrimary) {
    $b.BorderThickness = 2; $b.Padding = '14,0,14,0'; $b.MinWidth = 96
    $b.Background = $brushes['AskWash']; $b.BorderBrush = $brushes['Ask']
    $b.Add_MouseEnter({ param($sender, $e) $sender.Background = $brushes['AskLift'] })
    $b.Add_MouseLeave({ param($sender, $e) $sender.Background = $brushes['AskWash'] })
  } else {
    $b.Background = $brushes['None']; $b.Padding = '0,0,10,0'
  }
  $face = New-PixelText -Parts @(, @($text, $(if ($isPrimary) { 'Text' } else { 'Muted' }), $false))
  $face.HorizontalAlignment = 'Center'
  $b.Child = $face
  $b.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Invoke-QuestionAction ([string]$sender.Tag) })
  $b
}

# The header line: a small violet core, who is asking, and on the right the pages
# (one square each: bright for this one, violet once answered) and the jump link.
function Update-QuestionHead {
  $q = $script:q
  $q.headRight.Children.Clear()
  if ($q.others -gt 0) {
    $more = New-PixelText -Parts @(, @("+$($q.others)", 'Ask', $false))
    $more.Margin = '0,0,10,0'
    $more.ToolTip = "다른 세션의 질문 $($q.others)개가 기다리고 있어요"
    [void]$q.headRight.Children.Add($more)
  }
  if ($q.items.Count -gt 1 -and -not $q.isSent) {
    $dots = New-Object System.Windows.Controls.StackPanel
    $dots.Orientation = 'Horizontal'; $dots.VerticalAlignment = 'Center'; $dots.Margin = '0,0,10,0'
    for ($i = 0; $i -lt $q.items.Count; $i++) {
      $dot = New-Object System.Windows.Shapes.Rectangle
      $dot.Width = 6; $dot.Height = 6; $dot.Margin = '0,0,3,0'
      $dot.Fill = if ($i -eq $q.page) { $brushes['Text'] } elseif (Test-Answered $q.items[$i]) { $brushes['Ask'] } else { $brushes['Edge'] }
      [void]$dots.Children.Add($dot)
    }
    [void]$q.headRight.Children.Add($dots)
  }
  [void]$q.headRight.Children.Add($q.jump)
}

# Built once per question (not every tick), so choices and typed text survive redraws.
function Build-Question($s, [string]$key) {
  $qd = $s.data.question
  $questionFrame.Stroke = $brushes['AskFrame']

  $head = New-Object System.Windows.Controls.DockPanel
  $mini = New-PixelImage 24
  $mini.Margin = '0,0,8,0'; $mini.Source = $miniFrames['ask'][0]
  [System.Windows.Controls.DockPanel]::SetDock($mini, 'Left')
  [void]$head.Children.Add($mini)
  $headRight = New-Object System.Windows.Controls.StackPanel
  $headRight.Orientation = 'Horizontal'; $headRight.Margin = '8,0,0,0'
  [System.Windows.Controls.DockPanel]::SetDock($headRight, 'Right')
  [void]$head.Children.Add($headRight)
  $jump = New-PixelLink @(, @('↗', 'Muted', $false)) $s.id
  $jump.ToolTip = '앱에서 이 세션 열기'
  $jump.Add_MouseLeftButtonDown({
    param($sender, $e)
    $e.Handled = $true
    Open-AppSession (Find-Session ([string]$sender.Tag))
  })
  [void]$head.Children.Add((New-PixelText -Parts @(@('질문', 'Ask', $false), @(' · ', 'Faint', $false), @($s.title, 'Sub', $false)) -MaxWidth ($qInner - 110)))

  $items = New-Object System.Collections.ArrayList
  $qi = 0
  foreach ($qq in @($qd.questions)) {
    $item = @{
      question = [string]$qq.question; isMulti = [bool]$qq.multiSelect; isChoice = $true
      options = New-Object System.Collections.ArrayList
      selected = New-Object System.Collections.Generic.List[string]; field = $null; fieldGrid = $null; list = $null; tag = $null
    }
    if ($qq.header) {
      $tag = New-Object System.Windows.Controls.Border
      $tag.BorderThickness = 1; $tag.BorderBrush = $brushes['AskLine']; $tag.Background = $brushes['AskWash']
      $tag.Padding = '6,0,6,0'; $tag.HorizontalAlignment = 'Left'; $tag.Margin = '0,10,0,0'
      $tag.Child = New-PixelText -Parts @(@([string]$qq.header, 'Ask', $false), @($(if ($qq.multiSelect) { ' · 여러 개' } else { '' }), 'Muted', $false)) -MaxWidth ($qInner - 20)
      $item.tag = $tag
    }
    $item.text = New-PixelText -Parts @(, @($item.question, 'Text', $false)) -MaxWidth $qInner -Wrap
    $item.text.Margin = $(if ($item.tag) { '0,4,0,8' } else { '0,10,0,8' })
    $kind = if ($qq.kind) { [string]$qq.kind } else { 'choice' }
    if ($kind -eq 'text' -or $kind -eq 'number') {
      $item.isChoice = $false
      $hint = if ($qq.placeholder) { [string]$qq.placeholder }
        elseif ($kind -eq 'number') { "$($qq.min) ~ $($qq.max) $($qq.unit)".Trim() } else { '답을 입력하세요' }
      $field = New-Field $hint
    } else {
      $list = New-Object System.Windows.Controls.StackPanel
      $oi = 0
      foreach ($o in @($qq.options)) {
        $option = New-OptionRow ([string]$o.label) ([string]$o.description) "$qi|$oi" $item.isMulti
        [void]$item.options.Add($option)
        [void]$list.Children.Add($option.border)
        $oi++
      }
      $item.list = $list
      $field = New-Field '직접 입력'
    }
    $item.field = $field.box
    $item.fieldGrid = $field.grid
    [void]$items.Add($item)
    $qi++
  }

  $errorBox = New-Object System.Windows.Controls.Border
  $errorBox.Margin = '0,6,0,0'; $errorBox.Visibility = 'Collapsed'

  # One question with one choice to make: a tap on an option answers it.
  $isOneTap = $items.Count -eq 1 -and $items[0].isChoice -and -not $items[0].isMulti
  $script:q = @{
    key = $key; sessionId = $s.id; id = [string]$qd.id; items = $items; page = 0; isSent = $false
    isOneTap = $isOneTap; head = $head; headRight = $headRight; jump = $jump; mini = $mini
    errorBox = $errorBox; error = ''; others = 0
  }
  foreach ($item in $items) { for ($i = 0; $i -lt $item.options.Count; $i++) { Set-OptionStyle "$($items.IndexOf($item))|$i" } }
  Show-QuestionPage
}

# Lays out the current page; the pieces are kept per question and only re-hung here.
function Show-QuestionPage {
  $q = $script:q
  $questionBody.Children.Clear()
  [void]$questionBody.Children.Add($q.head)
  Update-QuestionHead
  if ($q.isSent) {
    $q.mini.Source = $miniFrames['done'][0]
    $done = New-PixelText -Parts @(, @('✓ 답을 보냈어요', 'Done', $false))
    $done.Margin = '0,10,0,0'
    [void]$questionBody.Children.Add($done)
    [void]$questionBody.Children.Add((New-PixelText -Parts @(, @('세션이 이어서 작업해요', 'Muted', $false))))
    $questionFrame.Stroke = $brushes['DoneFrame']
    return
  }
  $item = $q.items[$q.page]
  if ($item.tag) { [void]$questionBody.Children.Add($item.tag) }
  [void]$questionBody.Children.Add($item.text)
  if ($item.list) { [void]$questionBody.Children.Add($item.list) }
  [void]$questionBody.Children.Add($item.fieldGrid)
  [void]$questionBody.Children.Add($q.errorBox)

  $foot = New-Object System.Windows.Controls.DockPanel
  $foot.Margin = '0,10,0,0'; $foot.LastChildFill = $false
  $isLast = $q.page -eq ($q.items.Count - 1)
  if ($q.isOneTap) {
    [void]$foot.Children.Add((New-PixelText -Parts @(, @('고르면 바로 답해요', 'Faint', $false))))
  } else {
    if ($q.page -gt 0) {
      $back = New-QuestionButton '← 이전' 'back' $false
      [System.Windows.Controls.DockPanel]::SetDock($back, 'Left')
      [void]$foot.Children.Add($back)
    }
    $go = New-QuestionButton $(if ($isLast) { '답하기' } else { '다음 →' }) 'next' $true
    [System.Windows.Controls.DockPanel]::SetDock($go, 'Right')
    [void]$foot.Children.Add($go)
  }
  [void]$questionBody.Children.Add($foot)
}

# The question card follows whichever session is asking; it slides back once answered.
function Update-Question($list) {
  $askers = @($list | Where-Object { $_.state -eq 'ask' })
  if ($askers.Count -eq 0) {
    Hide-Card $questionCard
    $script:q = $null
    return
  }
  # Stay on the question in hand while another session asks too.
  $asking = $null
  if ($script:q) { $asking = $askers | Where-Object { $_.id -eq $script:q.sessionId } | Select-Object -First 1 }
  if (-not $asking) { $asking = $askers[0] }
  $key = "$($asking.id)|$($asking.data.question.id)"
  if (-not $script:q -or $script:q.key -ne $key) { Build-Question $asking $key }
  $others = $askers.Count - 1
  if ($script:q.others -ne $others) { $script:q.others = $others; Update-QuestionHead }
  Show-Card $questionCard
}

function Select-Option([string]$tag) {
  $q = $script:q
  if (-not $q -or $q.isSent) { return }
  $hit = Get-Option $tag
  $item = $hit.item
  $label = [string]$hit.option.label
  if ($item.isMulti) {
    if (-not $item.selected.Remove($label)) { $item.selected.Add($label) }
  } else {
    $item.selected.Clear()
    $item.selected.Add($label)
  }
  for ($i = 0; $i -lt $item.options.Count; $i++) { Set-OptionStyle "$($tag.Split('|')[0])|$i" }
  Set-QuestionError ''
  Update-QuestionHead
  if ($item.isMulti -or $item.field.Text.Trim()) { return }
  # A single choice settles the page: answer a lone question, or turn to the next one.
  if ($q.isOneTap) { Submit-Answer; return }
  if ($q.page -lt $q.items.Count - 1) {
    $turn = New-Object System.Windows.Threading.DispatcherTimer
    $turn.Interval = [TimeSpan]::FromMilliseconds(220)
    $turn.Tag = $q.key
    $turn.Add_Tick({
      param($sender, $e)
      $sender.Stop()
      $q = $script:q
      if ($q -and $q.key -eq $sender.Tag -and -not $q.isSent) { $q.page += 1; Show-QuestionPage }
    })
    $turn.Start()
  }
}

# next: on to the next page once this one is answered, or send from the last;
# back: the page before.
function Invoke-QuestionAction([string]$action) {
  $q = $script:q
  if (-not $q -or $q.isSent) { return }
  if ($action -eq 'back') {
    if ($q.page -gt 0) { $q.page -= 1; Set-QuestionError ''; Show-QuestionPage }
    return
  }
  if (-not (Test-Answered $q.items[$q.page])) { Set-QuestionError '고르거나 입력해 주세요'; return }
  if ($q.page -lt $q.items.Count - 1) { $q.page += 1; Set-QuestionError ''; Show-QuestionPage; return }
  Submit-Answer
}

# Typed text wins over chosen options; every question needs one or the other.
function Submit-Answer {
  $q = $script:q
  if (-not $q -or $q.isSent) { return }
  $answers = @{}
  for ($i = 0; $i -lt $q.items.Count; $i++) {
    $item = $q.items[$i]
    $typed = if ($item.field) { $item.field.Text.Trim() } else { '' }
    if ($typed) { $answers[$item.question] = $typed }
    elseif ($item.selected.Count -gt 0) { $answers[$item.question] = ($item.selected -join ', ') }
    else {
      # Back to the first page still waiting for an answer.
      $q.page = $i
      Show-QuestionPage
      Set-QuestionError '고르거나 입력해 주세요'
      return
    }
  }
  try {
    $dir = Join-Path $liveDir 'answers'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $json = @{ questionId = $q.id; answers = $answers } | ConvertTo-Json -Compress -Depth 4
    [IO.File]::WriteAllText((Join-Path $dir "$($q.sessionId).json"), $json)
    $q.isSent = $true
    Show-QuestionPage
  } catch { Write-Failure $_ }
}

# ---------- notices: a finished task, a limit running out; each shows a few seconds ----------

$script:prevStates = @{}
$script:warned = New-Object System.Collections.Generic.HashSet[string]
$script:notices = New-Object System.Collections.Generic.Queue[object]
$script:notice = $null

function Push-Notice([string]$color, [string]$head, [string]$body, [string]$sessionId, [string]$action, [double]$seconds) {
  $script:notices.Enqueue(@{ color = $color; head = $head; body = $body; sessionId = $sessionId; action = $action; seconds = $seconds })
}

# Turns changes between ticks into notices: a session that stops working has finished;
# the 5h limit or a session's context crossing 85% is worth a word, once per crossing.
function Watch-Events($list) {
  foreach ($s in $list) {
    $prev = $script:prevStates[$s.id]
    if ($prev -eq 'working' -and ($s.state -eq 'done' -or $s.state -eq 'idle')) {
      $w = $s.data.work
      $what = if ($w.edited -gt 0) { "파일 $($w.edited)개 수정" } else { "동작 $($w.actions)회" }
      Push-Notice 'Done' "✓ $($s.title)" "끝났어요 · $(Format-Clock ($w.endedAt - $w.startedAt)) · $what" $s.id 'open' 6
    }
    $script:prevStates[$s.id] = $s.state

    $key = "ctx|$($s.id)"
    if ($null -ne $s.ctx -and $s.ctx -ge 85 -and $script:warned.Add($key)) {
      Push-Notice 'Danger' "컨텍스트 $($s.ctx)% · $($s.title)" '곧 자동 압축돼요. 눌러서 세션 열기' $s.id 'focus' 8
    } elseif ($null -ne $s.ctx -and $s.ctx -lt 80) {
      [void]$script:warned.Remove($key)
    }
  }
  $five = @($script:account) | Where-Object { $_.short -eq '5h' } | Select-Object -First 1
  if ($five -and $five.resetsAt) {
    $key = "5h|$($five.resetsAt)"
    if ($five.pct -ge 85 -and $script:warned.Add($key)) {
      Push-Notice 'Danger' "5시간 사용량 $($five.pct)%" "$(Format-Reset $five.resetsAt) · 눌러서 많이 쓴 세션 보기" $null 'panel' 8
    }
  }
}

function Update-Notice {
  $now = [DateTime]::Now
  if ($script:notice -and $now -ge $script:notice.until -and ($script:notice.isDismissed -or -not $noticeCard.IsMouseOver)) {
    $script:notice = $null
    Hide-Card $noticeCard
  }
  if ($script:notice -or $script:notices.Count -eq 0 -or $noticeCard.Tag -eq 'out') { return }
  $n = $script:notices.Dequeue()
  $n.until = $now.AddSeconds($n.seconds)
  $script:notice = $n
  $noticeBody.Children.Clear()
  # The head line, with a close mark at its end.
  $head = New-Object System.Windows.Controls.DockPanel
  $close = New-PixelLink @(, @('✕', 'Muted', $false)) 'close'
  $close.Padding = '12,0,0,0'; $close.ToolTip = '닫기'; $close.VerticalAlignment = 'Top'
  $close.Add_MouseEnter({ param($sender, $e) $sender.Opacity = 0.6 })
  $close.Add_MouseLeave({ param($sender, $e) $sender.Opacity = 1 })
  $close.Add_MouseLeftButtonDown({ param($sender, $e) $e.Handled = $true; Close-Notice })
  [System.Windows.Controls.DockPanel]::SetDock($close, 'Right')
  [void]$head.Children.Add($close)
  [void]$head.Children.Add((New-PixelText -Parts @(, @($n.head, $n.color, $true)) -MaxWidth 330))
  [void]$noticeBody.Children.Add($head)
  $body = New-PixelText -Parts @(, @($n.body, 'Sub', $false)) -MaxWidth 362 -Wrap
  $body.Margin = '0,2,0,0'
  [void]$noticeBody.Children.Add($body)
  $noticeFrame.Stroke = $converter.ConvertFromString(('#CC' + $colors[$n.color].Substring(1)))
  Show-Card $noticeCard
}

function Close-Notice {
  if (-not $script:notice) { return }
  $script:notice.until = [DateTime]::MinValue
  $script:notice.isDismissed = $true
  Update-View
}

$noticeCard.Add_MouseLeftButtonDown({
  param($sender, $e)
  $e.Handled = $true
  $n = $script:notice
  if (-not $n) { return }
  Close-Notice
  switch ($n.action) {
    'open'  { Open-AppSession (Find-Session $n.sessionId) }
    'focus' { $script:focusId = $n.sessionId; $script:isOpen = $true; $script:isSideSet = $false; Update-View }
    'panel' { $script:isOpen = $true; $script:isSideSet = $false; Update-View }
  }
})

# ---------- the glance card (hover) ----------

function Show-Glance($list) {
  $hoverBody.Children.Clear()
  $inner = 302
  $usage = @($script:account)
  if ($usage.Count -eq 0) {
    [void]$hoverBody.Children.Add((New-PixelText -Parts @(, @('사용량 기다리는 중', 'Muted', $false))))
  }
  foreach ($m in $usage) {
    $row = New-Object System.Windows.Controls.DockPanel
    $reset = Format-Reset $m.resetsAt
    if ($reset) {
      $note = New-PixelText -Parts @(, @($reset, 'Faint', $false))
      [System.Windows.Controls.DockPanel]::SetDock($note, 'Right')
      [void]$row.Children.Add($note)
    }
    [void]$row.Children.Add((New-PixelText -Parts @(@("$($m.label) ", 'Muted', $false), @("$($m.pct)%", (Get-Level $m.pct), $true))))
    [void]$hoverBody.Children.Add($row)
  }
  $active = @($list | Where-Object { $_.state -ne 'idle' })
  $rule = New-Object System.Windows.Shapes.Rectangle
  $rule.Height = 2; $rule.Margin = '0,6,0,6'; $rule.Fill = $brushes['Divider']
  [void]$hoverBody.Children.Add($rule)
  if ($active.Count -eq 0) {
    [void]$hoverBody.Children.Add((New-PixelText -Parts @(, @("세션 $($list.Count)개 · 모두 대기 중", 'Faint', $false))))
  }
  foreach ($s in $active) {
    $line = New-Object System.Windows.Controls.DockPanel
    $when = switch ($s.state) {
      'working' { , @((Format-Clock $s.elapsed), 'Sub', $false) }
      'ask'     { , @('질문', 'Ask', $true) }
      'done'    { , @('완료', 'Done', $true) }
    }
    $right = New-PixelText -Parts @(, $when)
    $right.Margin = '8,0,0,0'
    [System.Windows.Controls.DockPanel]::SetDock($right, 'Right')
    [void]$line.Children.Add($right)
    [void]$line.Children.Add((New-PixelText -Parts @(@('● ', (Get-StateColor $s.state), $false), @($s.title, 'Text', $false)) -MaxWidth ($inner - $right.Width - 8)))
    [void]$hoverBody.Children.Add($line)
  }
}

# ---------- the panel (click) ----------

# The panel's fixed head: the account's limits with their reset times.
function Show-Usage($s) {
  $usageBox.Children.Clear()
  $usage = @($script:account)
  if ($usage.Count -eq 0) {
    $none = New-Text -Color Muted -Size 13; $none.Text = '사용량 기다리는 중'
    [void]$usageBox.Children.Add($none)
    return
  }
  foreach ($m in $usage) {
    $row = New-Object System.Windows.Controls.DockPanel
    $row.Margin = '0,1,0,1'
    $note = New-Text -Color Faint -Size 12 -Mono
    $note.Text = if ($m.short -eq 'ctx' -and $m.tokens) { "$(Format-Tokens $m.tokens) / $(Format-Tokens $m.window)" } else { Format-Reset $m.resetsAt }
    [System.Windows.Controls.DockPanel]::SetDock($note, 'Right')
    [void]$row.Children.Add($note)
    $what = New-Text -Size 13
    Add-Run $what "$($m.label) " 'Muted'
    Add-Run $what "$($m.pct)%" (Get-Level $m.pct) -Mono -Bold
    [void]$row.Children.Add($what)
    [void]$usageBox.Children.Add($row)
  }
}

# ---------- a picture of the widget itself, for checking how it looks ----------

# Touch `snap-request` in the live folder and the widget saves `snap.png` of its own
# window on a dark backdrop: nothing else on the screen is captured.
function Save-Snapshot {
  try {
    Remove-Item $snapRequest -Force -ErrorAction SilentlyContinue
    $window.UpdateLayout()
    $w =[int][Math]::Ceiling($window.ActualWidth); $h = [int][Math]::Ceiling($window.ActualHeight)
    if ($w -le 0 -or $h -le 0) { return }
    $visual = New-Object System.Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()
    $dc.DrawRectangle($converter.ConvertFromString('#FF15181D'), $null, (New-Object System.Windows.Rect 0, 0, $w, $h))
    $brush = New-Object System.Windows.Media.VisualBrush $root
    # One to one: the brush shows exactly the window's area, not the content's bounds.
    $brush.ViewboxUnits = 'Absolute'
    $brush.Viewbox = New-Object System.Windows.Rect 0, 0, $w, $h
    $brush.Stretch = 'Fill'
    $dc.DrawRectangle($brush, $null, (New-Object System.Windows.Rect 0, 0, $w, $h))
    $dc.Close()
    $bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap ($w * 2), ($h * 2), 192, 192, ([System.Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($visual)
    $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = [IO.File]::Create($snapPath)
    $encoder.Save($stream)
    $stream.Close()
  } catch { Write-Failure $_ }
}

# ---------- every tick ----------

function Update-View {
  if (Test-Path $widgetCommand) {
    $command = try { ([IO.File]::ReadAllText($widgetCommand)).Trim() } catch { '' }
    try { [IO.File]::Delete($widgetCommand) } catch {}
    switch ($command) { 'hide' { Set-Hidden $true } 'show' { Set-Hidden $false } 'toggle' { Set-Hidden (-not $script:isHidden) } }
  }
  $list = Read-Sessions
  $script:sessions = $list
  if ($list.Count -eq 0 -or $script:isHidden) {
    # Prompts already queued still go out while out of sight.
    if ($script:isHidden) { Send-Outboxes }
    $window.Visibility = 'Hidden'
    return
  }
  $window.Visibility = 'Visible'

  # Sessions keep the place they first appeared in, so rows don't jump around.
  $ids = @($list | ForEach-Object { $_.id })
  foreach ($id in @($script:order)) { if ($ids -notcontains $id) { [void]$script:order.Remove($id) } }
  foreach ($id in $ids) { if (-not $script:order.Contains($id)) { $script:order.Add($id) } }
  $list = @($script:order | ForEach-Object { $oid = $_; $list | Where-Object { $_.id -eq $oid } | Select-Object -First 1 })
  $script:sessions = $list
  $script:account = Get-AccountUsage $list
  Set-WindowShares $list

  # The core: the 5h figure as its ring, the busiest state as its light.
  $five = Get-FivePct
  $mode = if ($list | Where-Object { $_.state -eq 'ask' }) { 'ask' }
    elseif ($list | Where-Object { $_.state -eq 'working' }) { 'working' } else { 'idle' }
  Set-CoreState $(if ($null -ne $five) { $five } else { 0 }) $mode

  Set-CardSide
  Send-Outboxes
  Watch-Events $list
  Update-Question $list
  Update-Notice
  # While a question is out the glance stays in: the core already says it is asking.
  if ($script:isHovering -and -not $script:isOpen -and -not $script:drag -and -not $script:q) {
    Show-Glance $list
    Show-Card $hoverCard
  } else {
    Hide-Card $hoverCard
  }

  $s = Get-FocusSession $list
  $script:shownId = $s.id
  if ($script:isOpen) {
    $panel.Visibility = 'Visible'
    Show-Usage $s
    Update-SessionList $list
    Update-Chat
    $chatCard.Visibility = if ($script:chatId) { 'Visible' } else { 'Collapsed' }
    Set-PanelSide
  } else {
    $panel.Visibility = 'Collapsed'
    $chatCard.Visibility = 'Collapsed'
  }
  Set-Layout
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  try { Update-View } catch { Write-Failure $_ }
  if (Test-Path $snapRequest) {
    # A request reading "panel" opens the panel just for the picture.
    $wanted = try { ([IO.File]::ReadAllText($snapRequest)).Trim() } catch { '' }
    # "pick:<question>|<option>" or "act:next|back" presses the question card first.
    try {
      if ($wanted.StartsWith('pick:')) { Select-Option $wanted.Substring(5) }
      elseif ($wanted.StartsWith('act:')) { Invoke-QuestionAction $wanted.Substring(4) }
      elseif ($wanted.StartsWith('say:')) { $chatInput.Text = $wanted.Substring(4); Send-ChatPrompt }
      elseif ($wanted -eq 'hover') { $script:isHovering = $true; Update-View }
      elseif ($wanted.StartsWith('drag:')) {
        # A drag to x,y and a release there, as the mouse would do it.
        $to = $wanted.Substring(5).Split(',')
        $script:drag = @{ isMoved = $true }
        $script:left = [double]$to[0]; $script:coreTop = [double]$to[1]
        Set-Layout
        $script:drag = $null
        Set-SidesAfterDrag
      }
      elseif ($wanted -eq 'panel-close') { if ($script:chatId) { Set-ChatSession $script:chatId }; $script:isOpen = $false; Update-View }
      elseif ($wanted.StartsWith('notice:')) {
        $parts = $wanted.Substring(7).Split('|')
        Push-Notice $parts[0] $parts[1] $parts[2] $null 'panel' 30
        Update-View
      }
      elseif ($wanted.StartsWith('coreframes:')) {
        # Each animation frame of the core, as 32x32 PNGs, for an animated picture.
        $parts = $wanted.Substring(11).Split('|')
        $script:coreMode = $parts[0]; $script:corePct = [double]$parts[1]
        $coreAnimation.Stop()
        for ($k = 0; $k -lt 12; $k++) {
          $script:coreFrame = $k; $script:coreDrawn = $null
          Draw-Core
          $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
          $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($coreBitmap.Clone()))
          $stream = [IO.File]::Create((Join-Path $liveDir "core-$($parts[0])-$k.png"))
          $encoder.Save($stream); $stream.Close()
        }
        if ($script:coreMode -ne 'idle') { $coreAnimation.Start() }
      }
      elseif ($wanted.StartsWith('chat:')) {
        # Opens the panel with that session's chat, for the picture.
        $script:isOpen = $true; $script:isSideSet = $false
        Update-View
        Set-ChatSession $wanted.Substring(5)
        Update-View
      }
    } catch { Write-Failure $_ }
    if ($wanted -eq 'panel' -and -not $script:isOpen) {
      $script:isOpen = $true; $script:isSideSet = $false
      try { Update-View } catch { Write-Failure $_ }
      $window.UpdateLayout()
      Save-Snapshot
      $script:isOpen = $false
      try { Update-View } catch { Write-Failure $_ }
    } else {
      Save-Snapshot
    }
  }})
$window.Add_Closed({ $timer.Stop() })

$window.Add_Loaded({
  Draw-Core
  Set-CardSide
  Set-Layout
  try { Update-View } catch { Write-Failure $_ }
  $timer.Start()
})

$app = New-Object System.Windows.Application
[void]$app.Run($window)
$mutex.ReleaseMutex()
