param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $repoRoot 'dist' }
if (!(Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\level-party'))) { throw 'Run npm ci before packaging.' }
Push-Location $repoRoot
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed; no package created.' }
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $files = @('main.js','imgDownloader.js','rkeyManager.js','renderer.js','preload.js','manifest.json','icon.png','LICENSE','README.md','package.json','package-lock.json','node_modules') | ForEach-Object { Join-Path $repoRoot $_ }
    $archive = Join-Path $OutputDirectory 'qq-anti-recall.zip'
    Compress-Archive -LiteralPath $files -DestinationPath $archive -Force
    Get-FileHash -LiteralPath $archive -Algorithm SHA256 | Format-List
} finally { Pop-Location }
