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

    # 2. Unit Tests: node test runner
    Write-Group "Unit Tests (node --test)"
    Write-Host "Running: npm test..." -ForegroundColor Yellow
    & npm test
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: npm test returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    $prodLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-prod-$PID.log"
    $fixtureLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-fixture-$PID.log"

    try {
        # 3. Production Build: astro build (fails if SITE_FIXTURES is set)
        Write-Group "Production Build (astro build)"
        if ($env:SITE_FIXTURES) {
            Write-EndGroup
            throw "CI Step Failed: Production build cannot run with SITE_FIXTURES set."
        }
        Write-Host "Running: npm run build..." -ForegroundColor Yellow
        $prodOutput = & npm run build 2>&1 | Out-String
        $prodExitCode = $LASTEXITCODE
        Write-Host $prodOutput
        Set-Content -Path $prodLogFile -Value $prodOutput -Encoding UTF8
        if ($prodExitCode -ne 0) {
            Write-EndGroup
            throw "CI Step Failed: astro build returned exit code $prodExitCode"
        }
        Write-EndGroup

        # 4. Fixture Build: astro build with SITE_FIXTURES=1
        Write-Group "Fixture Build (SITE_FIXTURES=1)"
        Write-Host "Running: astro build with SITE_FIXTURES=1..." -ForegroundColor Yellow
        $env:SITE_FIXTURES = "1"
        $env:WORDS_FIXTURE_PATH = ""
        try {
            $fixtureOutput = & npx astro build 2>&1 | Out-String
            $fixtureExitCode = $LASTEXITCODE
            Write-Host $fixtureOutput
            Set-Content -Path $fixtureLogFile -Value $fixtureOutput -Encoding UTF8
            if ($fixtureExitCode -ne 0) {
                throw "CI Step Failed: Fixture build returned exit code $fixtureExitCode"
            }
        } finally {
            $env:SITE_FIXTURES = ""
            $env:WORDS_FIXTURE_PATH = ""
        }
        Write-EndGroup

        # 5. Diagnostics Gate: validate production + fixture build logs against allowlist
        Write-Group "Diagnostics Gate (scripts/gates/diagnostics.ts)"
        Write-Host "Running: node --experimental-strip-types scripts/gates/diagnostics.ts..." -ForegroundColor Yellow
        & node --experimental-strip-types scripts/gates/diagnostics.ts --log $prodLogFile --log $fixtureLogFile
        if ($LASTEXITCODE -ne 0) {
            Write-EndGroup
            throw "CI Step Failed: Diagnostics gate returned exit code $LASTEXITCODE"
        }
        Write-EndGroup
    } finally {
        if (Test-Path $prodLogFile) { Remove-Item $prodLogFile -Force -ErrorAction SilentlyContinue }
        if (Test-Path $fixtureLogFile) { Remove-Item $fixtureLogFile -Force -ErrorAction SilentlyContinue }
    }

    # 6. Errata Guard Gate: validate src/content/words/*.md against BaseRef
    Write-Group "Errata Guard Gate (scripts/gates/errata-guard.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: errata-guard returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # 7. Negative Scenarios Gate (invalid fixtures)
    Write-Group "Negative Scenarios Gate (invalid fixtures)"
    $scenarios = @(
        @{ Id = "N1"; Dir = "n1-essay-missing-description"; Pattern = "description.*Required" },
        @{ Id = "N2"; Dir = "n2-dangling-superseded-by"; Pattern = "Dangling reference.*non-existent-target" },
        @{ Id = "N3"; Dir = "n3-wrong-kind"; Pattern = "kind.*Invalid option" },
        @{ Id = "N4"; Dir = "n4-published-without-published-on"; Pattern = "Published entries require published_on" },
        @{ Id = "N5"; Dir = "n5-reserved-slug"; Pattern = "Reserved slug error" },
        @{ Id = "N6"; Dir = "n6-unknown-form"; Pattern = "Did not match union" },
        @{ Id = "N7"; Dir = "n7-superseded-by-draft"; Pattern = "target is a draft" },
        @{ Id = "N8"; Dir = "n8-supersede-cycle"; Pattern = "Supersede cycle detected" },
        @{ Id = "N9"; Dir = "n9-bad-slug-grammar"; Pattern = "Invalid slug grammar error" }
    )

    foreach ($sc in $scenarios) {
        Write-Host "Testing negative scenario $($sc.Id) ($($sc.Dir))..." -ForegroundColor Yellow
        $env:SITE_FIXTURES = "1"
        $env:WORDS_FIXTURE_PATH = "tests/fixtures/invalid/$($sc.Dir)"
        try {
            $output = & npx astro build 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                throw "Negative scenario $($sc.Id) unexpectedly passed (expected failure matching '$($sc.Pattern)')"
            }
            if ($output -notmatch $sc.Pattern) {
                throw "Negative scenario $($sc.Id) failed with unexpected error. Expected match for '$($sc.Pattern)'. Output:`n$output"
            }
            Write-Host "  Scenario $($sc.Id) failed as expected matching pattern '$($sc.Pattern)'" -ForegroundColor Green
        } finally {
            $env:SITE_FIXTURES = ""
            $env:WORDS_FIXTURE_PATH = ""
            $global:LASTEXITCODE = 0
        }
    }
    Write-EndGroup

    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host " All CI Gates PASSED (typecheck, unit tests, prod build, fixture build, diagnostics, errata-guard, negative scenarios)" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    exit 0
} finally {
    Pop-Location
}
