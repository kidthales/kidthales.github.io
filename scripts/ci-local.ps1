<#
.SYNOPSIS
    Runs continuous integration suite for kidthales.github.io.
.DESCRIPTION
    Single CI orchestrator for both local runs and GitHub Actions CI.
    Supports -BaseRef defaulting to merge-base with origin/next.
    Outputs GitHub Actions ::group:: markers for clear log folding.
.PARAMETER BaseRef
    Base git ref to compare against (defaults to merge-base with origin/next).
#>
[CmdletBinding()]
param(
    [string]$BaseRef = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

# Determine merge-base if BaseRef is omitted
if (-not $BaseRef) {
    $mergeBase = & git -C $RootDir merge-base HEAD origin/next 2>$null
    if ($LASTEXITCODE -eq 0 -and $mergeBase) {
        $BaseRef = $mergeBase.Trim()
    } else {
        $BaseRef = "origin/next"
    }
}

function Write-Group([string]$Name) {
    Write-Host "::group::$Name"
}

function Write-EndGroup {
    Write-Host "::endgroup::"
}

Push-Location $RootDir
try {
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host " kidthales.github.io CI Orchestrator" -ForegroundColor Cyan
    Write-Host " Root: $RootDir" -ForegroundColor Gray
    Write-Host " BaseRef: $BaseRef" -ForegroundColor Gray
    Write-Host "====================================================" -ForegroundColor Cyan

    # 1. Typecheck: astro check
    Write-Group "Typecheck (astro check)"
    Write-Host "Running: npm run check..." -ForegroundColor Yellow
    & npm run check
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: astro check returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # 2. Production Build: astro build
    Write-Group "Production Build (astro build)"
    Write-Host "Running: npm run build..." -ForegroundColor Yellow
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: astro build returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host " All CI Gates PASSED (astro check, astro build)" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Cyan
} finally {
    Pop-Location
}
