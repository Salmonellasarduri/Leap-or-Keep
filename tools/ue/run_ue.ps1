# run_ue.ps1 — UEヘッドレス実行の監視ラッパー(deadman watchdog)
# 71分ゾンビ事故(L-046)の構造対策: すべてのUEヘッドレス実行はこれ経由で行う。
#   ①ログが StallMin 分伸びない → 停滞と判定して kill
#   ②総時間が TimeoutMin 分を超過 → タイムアウトで kill
#   ③マーカー(既定 BOOT_CHECK_OK / SCENE_OK)を見つけたら成功
# 出力: [WATCHDOG] 行で常に判定を1行出す。exit 0=成功 / 2=停滞kill / 3=timeout kill / それ以外=UEのexit code
param(
  [Parameter(Mandatory=$true)][string]$Script,           # 実行する .py(絶対パス)
  [string]$Project = "E:\Project\lok-warroom-ue\LokWarroom.uproject",
  [string]$Marker = "BOOT_CHECK_OK|SCENE_OK|RENDER_OK",
  [int]$TimeoutMin = 25,
  [int]$StallMin = 6,
  [switch]$WithRHI                                        # レンダが要る時だけ RHI 有効(既定 -nullrhi)
)
$UE = "E:\Unreal Engine 5\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$log = Join-Path (Split-Path $Project) ("Saved\Logs\watchdog-" + (Get-Date -Format "HHmmss") + ".log")
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
$rhi = if ($WithRHI) { @() } else { @("-nullrhi") }
$args = @($Project, "-ExecCmds=`"py $Script`"", "-stdout", "-unattended", "-nosplash") + $rhi
$p = Start-Process -FilePath $UE -ArgumentList $args -RedirectStandardOutput $log -PassThru -WindowStyle Hidden
$t0 = Get-Date; $lastSize = 0; $lastGrow = Get-Date
while ($true) {
  Start-Sleep -Seconds 20
  if ($p.HasExited) { break }
  $size = (Get-Item $log -ErrorAction SilentlyContinue).Length
  if ($size -gt $lastSize) { $lastSize = $size; $lastGrow = Get-Date }
  $stallMinutes = ((Get-Date) - $lastGrow).TotalMinutes
  $totalMinutes = ((Get-Date) - $t0).TotalMinutes
  # 成功マーカーが出たのに終了しない場合も停滞扱いになる(quit_editor忘れ検出)
  if ($stallMinutes -ge $StallMin) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output "[WATCHDOG] STALL-KILL: ログが $([math]::Round($stallMinutes,1)) 分停止(仕事をしていない)。log=$log"
    exit 2
  }
  if ($totalMinutes -ge $TimeoutMin) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output "[WATCHDOG] TIMEOUT-KILL: $TimeoutMin 分超過。log=$log"
    exit 3
  }
}
# 判定はプロジェクト本ログを正とする(stdout捕捉はLogPython行を落とすことがある — 実測)
$projLog = Join-Path (Split-Path $Project) ("Saved\Logs\" + [IO.Path]::GetFileNameWithoutExtension($Project) + ".log")
$scan = @($log, $projLog) | Where-Object { Test-Path $_ }
$hit = Select-String -Path $scan -Pattern $Marker -ErrorAction SilentlyContinue | Select-Object -First 1
$boot = Select-String -Path $scan -Pattern "\[BOOT\]|\[SCENE\]|LogPython: Error" -ErrorAction SilentlyContinue | Select-Object -Last 8
$boot | ForEach-Object { Write-Output $_.Line.Substring(0, [Math]::Min(160, $_.Line.Length)) }
if ($hit) { Write-Output "[WATCHDOG] OK: マーカー検出・正常終了(exit $($p.ExitCode))。log=$log"; exit 0 }
Write-Output "[WATCHDOG] FAILED: マーカー無しで終了(exit $($p.ExitCode))。log=$log"
if ($p.ExitCode -ne 0) { exit $p.ExitCode } else { exit 1 }  # 三項演算子はPS5.1非対応(L-046の系)
