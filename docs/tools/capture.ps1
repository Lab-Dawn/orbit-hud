# Captures the README pictures from a second widget running on made-up sessions
# (nothing real is shown), into docs/raw; then run make_docs.py.
$ErrorActionPreference = 'Stop'
$demo = Join-Path $env:USERPROFILE '.claude\jarvis-hud-demo'
$repo = Split-Path (Split-Path $PSScriptRoot)
$out = Join-Path $repo 'docs\raw'
$widget = Join-Path $repo 'widget\widget.ps1'
$utf8 = New-Object Text.UTF8Encoding $false
if (Test-Path $demo) { Remove-Item $demo -Recurse -Force }
foreach ($d in 'sessions', 'chat', 'prompts', 'answers', 'commands') { New-Item -ItemType Directory -Force (Join-Path $demo $d) | Out-Null }
New-Item -ItemType Directory -Force $out | Out-Null
[IO.File]::WriteAllText((Join-Path $demo 'widget.json'), '{"left":1560,"top":760,"scale":2,"hidden":false}', $utf8)

$reset5h = [DateTime]::UtcNow.AddMinutes(162).ToString('yyyy-MM-ddTHH:mm:00.000Z')
$reset7d = [DateTime]::UtcNow.AddDays(3).AddHours(5).ToString('yyyy-MM-ddTHH:00:00.000Z')

function Write-Session([string]$id, [string]$project, [int]$ctx, [double]$usd, [bool]$isActive, $current, $question, [int]$startedAgo) {
  $now = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  $s = [ordered]@{
    version = 1; project = $project; writtenAt = $now; isEnded = $false; compact = 'idle'; compactError = $null; question = $question
    spend = @{ resetsAt = $reset5h; windowUsd = $usd; isPartial = $false; turnUsd = 0; totalUsd = $usd }
    usage = @(
      @{ label = '컨텍스트'; short = 'ctx'; pct = $ctx; resetsAt = $null; tokens = $ctx * 10000; window = 1000000 },
      @{ label = '5시간'; short = '5h'; pct = 38; resetsAt = $reset5h },
      @{ label = '7일'; short = '7d'; pct = 54; resetsAt = $reset7d })
    work = @{ isActive = $isActive; startedAt = $now - $startedAgo * 1000; endedAt = $(if ($isActive) { 0 } else { $now - 600000 }); files = 3; edited = 2; actions = 14; current = $current; recent = @() }
  }
  [IO.File]::WriteAllText((Join-Path $demo "sessions\$id.json"), ($s | ConvertTo-Json -Depth 8), $utf8)
}

$question = @{ id = 'demo-q'; questions = @(@{
  question = '다크 모드 색상은 어떤 방식으로 적용할까요?'; header = '구현 방식'; multiSelect = $false
  options = @(
    @{ label = 'CSS 변수'; description = '테마 토큰으로 한 번에 전환' },
    @{ label = 'Tailwind dark:'; description = '클래스마다 다크 색 지정' },
    @{ label = '둘 다 섞어서' }) }) }

function Write-All([bool]$isAsking) {
  Write-Session 'a1000000-0000-0000-0000-000000000001' '결제 모듈 리팩터링' 46 6.2 $true @{ glyph = '✎'; label = 'payment.ts'; action = '수정' } $null 194
  Write-Session 'a1000000-0000-0000-0000-000000000002' '블로그 다크 모드' 23 2.1 $false $null $(if ($isAsking) { $question } else { $null }) 0
  Write-Session 'a1000000-0000-0000-0000-000000000003' 'API 문서 정리' 72 3.4 $false $null $null 0
  Write-Session 'a1000000-0000-0000-0000-000000000004' '테스트 커버리지 올리기' 18 0.9 $false $null $null 0
}

$chat = @{ writtenAt = 0; isActive = $true; ack = $null; lines = @(
  @{ role = 'user'; text = '결제 실패하면 재시도하게 해줘' },
  @{ role = 'assistant'; text = '결제 요청을 감싸서 최대 3번, 간격을 늘려 가며 다시 시도하게 할게요.' },
  @{ role = 'tools'; tools = @('Read', 'Read', 'Grep', 'Edit') },
  @{ role = 'assistant'; text = '재시도 로직을 넣었어요. 이제 테스트를 돌려 볼게요.' },
  @{ role = 'tools'; tools = @('Bash') }) }
[IO.File]::WriteAllText((Join-Path $demo 'chat\a1000000-0000-0000-0000-000000000001.json'), ($chat | ConvertTo-Json -Depth 6 -Compress), $utf8)

function Request([string]$what) {
  $req = Join-Path $demo 'snap-request'
  [IO.File]::WriteAllText($req, $what, $utf8)
  $t = 0; while ((Test-Path $req) -and $t -lt 60) { Start-Sleep -Milliseconds 100; $t++ }
  Start-Sleep -Milliseconds 300
}
function Snap([string]$name, [string]$what = '') {
  Request $what
  Copy-Item (Join-Path $demo 'snap.png') (Join-Path $out "$name.png") -Force
}

Write-All $true
$env:JARVIS_HUD_LIVE = $demo
$proc = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', "`"$widget`""
try {
  Start-Sleep -Seconds 5
  # 1. A question out beside the core.
  Snap 'question'
  # 2. The core's animation frames, per mode.
  foreach ($mode in 'idle', 'working', 'ask') { Request "coreframes:$mode|38" }
  # 3. The panel with a chat open, and a prompt waiting its turn.
  Write-All $false
  Request 'chat:a1000000-0000-0000-0000-000000000001'
  Start-Sleep -Milliseconds 800
  Request 'say:끝나면 PR 설명도 써줘'
  Start-Sleep -Milliseconds 600
  Snap 'panel-chat'
  # 4. The panel alone.
  Request 'chat:a1000000-0000-0000-0000-000000000001'
  Start-Sleep -Milliseconds 600
  Snap 'panel'
  # 5. A finished task, with everything else shut.
  Request 'panel-close'
  Write-All $false
  Request 'notice:Done|✓ API 문서 정리|끝났어요 · 3:12 · 파일 4개 수정'
  Start-Sleep -Milliseconds 900
  Snap 'notice'
  foreach ($mode in 'idle', 'working', 'ask') {
    for ($k = 0; $k -lt 12; $k++) { Move-Item (Join-Path $demo "core-$mode-$k.png") (Join-Path $out "core-$mode-$k.png") -Force }
  }
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\JARVIS_HUD_LIVE
}
if (Test-Path (Join-Path $demo 'widget-error.log')) { Get-Content (Join-Path $demo 'widget-error.log') -TotalCount 6 }
Get-ChildItem $out -Name
