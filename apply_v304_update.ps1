$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$obsolete = Join-Path $root 'law_order_tracker_app\assets\CIA_1992.svg'

if (Test-Path $obsolete) {
    Remove-Item $obsolete -Force
    Write-Host 'Removed obsolete CIA_1992.svg asset.' -ForegroundColor Yellow
}

Write-Host 'v3.0.4 files are in place.' -ForegroundColor Green
Write-Host 'Run: npm test' -ForegroundColor Cyan
