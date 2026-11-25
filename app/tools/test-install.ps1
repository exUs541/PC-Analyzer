<#
  Real test of installing, updating and uninstalling, with a separate test id (LaptopCheckE2E), so a real installation of
  LaptopCheck is never touched. It
    1. builds two versions (3.0.1 and 3.0.2) into a temporary folder,
    2. installs 3.0.1 silently (per user, no admin rights needed),
    3. starts it without a window and waits until it has loaded 3.0.2 in the background,
    4. presses "update now" and checks that the app comes back as 3.0.2 with the same start parameters,
    5. presses it again (nothing newer: must say so and keep running),
    6. closes the app, then uninstalls everything and checks that nothing is left (shortcuts, folder, registry entry).
  The data folder of the test is a temporary folder too. Exit code 0 = everything worked.
#>
param(
  [int]$Port = 48791,
  [int]$WaitSeconds = 120
)
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$packId = 'LaptopCheckE2E'
$title = 'LaptopCheck E2E Test'
$installDir = Join-Path $env:LOCALAPPDATA $packId
if (Test-Path $installDir) { throw "$installDir already exists (a test install that was not removed?). Remove it first." }

$work = Join-Path ([IO.Path]::GetTempPath()) ('lc-install-test-' + [Guid]::NewGuid().ToString('N'))
$rel = Join-Path $work 'rel'
$data = Join-Path $work 'data'
New-Item -ItemType Directory -Force -Path $work, $data | Out-Null

$failures = New-Object System.Collections.ArrayList
function Check($ok, $what) {
  if ($ok) { Write-Host "  ok   $what" } else { Write-Host "  FAIL $what"; [void]$failures.Add($what) }
}
function Get-Token($port) {
  $html = (Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5).Content
  [regex]::Match($html, 'lc-token" content="([a-f0-9]+)"').Groups[1].Value
}
function Api($port, $token, $path, $method = 'GET') {
  (Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -Method $method -Headers @{ 'X-LC-Token' = $token } -UseBasicParsing -TimeoutSec 30).Content
}
function Test-Running() {
  [bool](Get-Process -Name LaptopCheck -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" })
}
function Wait-For($seconds, [scriptblock]$test) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { $r = & $test; if ($r) { return $r } } catch { }
    Start-Sleep -Seconds 2
  }
  return $null
}

$saved = @{}
foreach ($n in 'LC_DATA_DIR', 'LC_UPDATE_SOURCE', 'LC_NO_SYSCRED', 'LC_NO_GH') { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
try {
  Write-Host "Building test versions in $work ..."
  $pack = Join-Path $PSScriptRoot 'pack.ps1'
  & $pack -Version 3.0.1 -Out $rel -PackId $packId -Title $title | Out-Null
  Copy-Item (Join-Path $rel "$packId-win-Setup.exe") (Join-Path $work 'Setup-3.0.1.exe')
  & $pack -Version 3.0.2 -Out $rel -PackId $packId -Title $title | Out-Null

  # the installed app and everything it starts inherit these: own data folder, local update source, no real logins
  $env:LC_DATA_DIR = $data; $env:LC_UPDATE_SOURCE = $rel; $env:LC_NO_SYSCRED = '1'; $env:LC_NO_GH = '1'

  Write-Host 'Installing 3.0.1 ...'
  $p = Start-Process -FilePath (Join-Path $work 'Setup-3.0.1.exe') -ArgumentList '--silent' -PassThru -Wait
  Check ($p.ExitCode -eq 0) 'installer finished'
  $exe = Join-Path $installDir 'current\LaptopCheck.exe'
  Check (Test-Path $exe) 'program files are in the install folder'
  Check ((Get-Item $exe).VersionInfo.ProductVersion -like '3.0.1*') 'installed version is 3.0.1'
  $stub = Join-Path $installDir "$title.exe"
  Check (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$packId") 'listed in the installed programs of Windows'
  Check (@(Get-ChildItem ([Environment]::GetFolderPath('Desktop')), ([Environment]::GetFolderPath('Programs')) -Filter "*$title*" -ErrorAction SilentlyContinue).Count -eq 2) 'desktop and start menu shortcuts exist'

  Write-Host 'Starting and waiting for the background update ...'
  Start-Process -FilePath $stub -ArgumentList '--no-window', '--port', "$Port" -WindowStyle Hidden | Out-Null
  $tok = Wait-For 30 { Get-Token $Port }
  Check ([bool]$tok) 'app answers'
  $ready = Wait-For $WaitSeconds { $r = ((Api $Port $tok '/api/state') | ConvertFrom-Json).update.result; if ($r -in 'ready', 'error', 'offline', 'no-access') { $r } }
  Check ($ready -eq 'ready') "background check loaded the new version (state: $ready)"

  Write-Host 'Update now ...'
  $answer = Api $Port $tok '/api/update/restart' 'POST'
  Check ($answer -match '"updating":true') 'update now was accepted'
  $new = Wait-For $WaitSeconds { $t = Get-Token $Port; if ($t -and $t -ne $tok) { $t } }
  Check ([bool]$new) 'app came back on the same port (same start parameters)'
  if ($new) {
    $s = (Api $Port $new '/api/state') | ConvertFrom-Json
    Check ($s.meta.version -eq '3.0.2') "restarted app is 3.0.2 (is $($s.meta.version))"
    Check ($s.update.result -eq 'updated') "dashboard says it was updated (state: $($s.update.result))"
    $again = Api $Port $new '/api/update/restart' 'POST'
    Check ($again -match '"noUpdate":true') 'no newer version: says so'
    Check (Test-Running) 'app keeps running after that'
    try { Api $Port $new '/api/shutdown' 'POST' | Out-Null } catch { }
  }
  Check ($null -ne (Wait-For 30 { if (-not (Test-Running)) { 'gone' } })) 'app ends when asked to'
  Check (-not (Test-Path (Join-Path $data 'app-errors.log'))) 'no errors were logged'
}
finally {
  foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
  Get-Process -Name LaptopCheck -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$installDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue   # only the test install's own processes
  $upd = Join-Path $installDir 'Update.exe'
  if (Test-Path $upd) {
    Write-Host 'Uninstalling ...'
    Start-Process -FilePath $upd -ArgumentList '--uninstall', '--silent' -Wait | Out-Null
    Start-Sleep -Seconds 4
  }
  Check (-not (Test-Path $installDir)) 'install folder is gone'
  $lnk = @(Get-ChildItem ([Environment]::GetFolderPath('Desktop')), ([Environment]::GetFolderPath('Programs')) -Filter "*$title*" -ErrorAction SilentlyContinue)
  Check ($lnk.Count -eq 0) 'shortcuts are gone'
  Check (-not (Test-Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$packId")) 'entry in the list of installed programs is gone'
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count -gt 0) {
  Write-Host ''
  Write-Host ("FAILED: " + ($failures -join '; '))
  exit 1
}
Write-Host ''
Write-Host 'All install/update/uninstall checks passed.'
