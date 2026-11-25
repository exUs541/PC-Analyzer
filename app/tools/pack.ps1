<#
  Builds the installer and the update packages of the native app (Velopack).
  The same script runs on the build server and on a developer PC, so what is tested locally is what gets released.

    -Version   semantic version, e.g. 3.0.12 (default: 3.0.<number of commits>)
    -Out       folder for the result (default: app\artifacts\releases). Put the earlier release files here first and
               Velopack builds a small delta package next to the full one.
    -PackId    default LaptopCheck. Tests use another id so they never touch a real installation.
    -Title     name of the shortcuts and in the list of installed programs (default LaptopCheck)

  Result in -Out: <PackId>-win-Setup.exe (installer), <PackId>-<version>-full.nupkg (+ -delta.nupkg), releases.win.json
#>
param(
  [string]$Version,
  [string]$Out,
  [string]$PackId = 'LaptopCheck',
  [string]$Title = 'LaptopCheck'
)
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$repoDir = Split-Path -Parent $appDir
if (-not $Version) {
  $count = (& git -C $repoDir rev-list --count HEAD).Trim()
  $Version = "3.0.$count"
}
if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw "Not a valid version: $Version" }
if (-not $Out) { $Out = Join-Path $appDir 'artifacts\releases' }
$publish = Join-Path $appDir "artifacts\publish-$Version"
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

Write-Host "Publishing $PackId $Version (self-contained, win-x64) ..."
& dotnet publish (Join-Path $appDir 'src\LaptopCheck.App\LaptopCheck.App.csproj') -c Release -r win-x64 --self-contained true `
  "-p:Version=$Version" -o $publish --nologo -v q
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }
if (-not (Test-Path (Join-Path $publish 'web\index.html'))) { throw 'The dashboard (web\) is missing from the publish folder.' }

Push-Location $appDir
try {
  & dotnet tool restore
  if ($LASTEXITCODE -ne 0) { throw "dotnet tool restore failed ($LASTEXITCODE)" }
  Write-Host "Packing ..."
  & dotnet vpk pack --packId $PackId --packVersion $Version --packDir $publish --mainExe LaptopCheck.exe --runtime win-x64 `
    --icon (Join-Path $appDir 'src\LaptopCheck.App\app.ico') --packTitle $Title -o $Out
  if ($LASTEXITCODE -ne 0) { throw "vpk pack failed ($LASTEXITCODE)" }
}
finally {
  Pop-Location
}
Write-Host "Done: $Out"
Get-ChildItem $Out | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
