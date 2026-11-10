<#
.SYNOPSIS
    Runs continuous integration suite for kidthales.github.io.
.DESCRIPTION
    Single CI orchestrator for both local runs and GitHub Actions CI:
    - Gate 0: Workflow single-source-of-truth contract & exact step allowlist
    - Gate 1: Action commit SHA pin verification & agent file leak audit
    - Gate 2: PowerShell AST parse validation (*.ps1)
    - Gate 3: Typecheck, contrast pairs & unit tests (astro check, contrast-pairs.ts, node --test)
    - Gate 4: Production build, structural gates & weight budgets
    - Gate 5: Fixture build, diagnostics, accessibility & fixture budgets
    - Gate 6: Content lints, errata guard, negative smoke checks & dist restore
.PARAMETER BaseRef
    Base git ref to compare against (defaults to merge-base with origin/main).
.PARAMETER CI
    Enforces strict fail-closed contract for CI runners: emits GitHub Actions log groups and annotations.
.PARAMETER Quick
    Skips E2E negative build smoke checks. Forbidden in -CI mode.
.PARAMETER Gate0Only
    Executes Gate 0 workflow contract verification and exits. Forbidden in -CI mode.
.PARAMETER WorkflowsPath
    Custom path to workflow definitions directory (defaults to .github/workflows). Forbidden in -CI mode.
#>
[CmdletBinding()]
param(
    [string]$BaseRef = "",
    [switch]$CI,
    [switch]$Quick,
    [switch]$Gate0Only,
    [string]$WorkflowsPath = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$IsCI = $CI.IsPresent -or (-not [string]::IsNullOrWhiteSpace($env:GITHUB_ACTIONS))
$script:InGroup = $false

$TotalTimer = [System.Diagnostics.Stopwatch]::StartNew()

function Enter-Gate([int]$Gate, [int]$MaxGate, [string]$Title) {
    $Header = "[Gate $Gate/$MaxGate] $Title"
    if ($IsCI) {
        Write-Host "::group::$Header"
        $script:InGroup = $true
    } else {
        Write-Host "`n=== $Header ===" -ForegroundColor Yellow
    }
}

function Exit-GatePass([string]$Message, [System.Diagnostics.Stopwatch]$Timer) {
    $elapsed = [math]::Round($Timer.Elapsed.TotalSeconds, 2)
    Write-Host "  -> [OK] $Message (${elapsed}s)" -ForegroundColor Green
    if ($IsCI -and $script:InGroup) {
        Write-Host "::endgroup::"
        $script:InGroup = $false
    }
}

function Write-Fail([string]$Message) {
    if ($IsCI) {
        Write-Host "::error::$Message"
    }
    Write-Host "  -> [FAIL] $Message" -ForegroundColor Red
}

$GateResults = [ordered]@{
    "gate0_workflow_contract"           = "fail"
    "gate1_action_pins_and_leaks"       = "fail"
    "gate2_pwsh_ast"                    = "fail"
    "gate3_typecheck_contrast_and_unit" = "fail"
    "gate4_prod_build_and_structural"   = "fail"
    "gate5_fixture_axe_and_budgets"     = "fail"
    "gate6_lints_errata_and_negative"   = "fail"
}

function Write-GateSummary {
    Write-Host "`nGate Summary:" -ForegroundColor Cyan
    foreach ($k in $GateResults.Keys) {
        $v = "$($GateResults[$k])".ToUpperInvariant()
        Write-Host "  [${k}: $v]"
    }
}

# Fail-closed guard for -CI mode: reject skip or partial flags immediately
if ($IsCI) {
    $rejectedFlags = @()
    if ($Quick) { $rejectedFlags += "-Quick" }
    if ($Gate0Only) { $rejectedFlags += "-Gate0Only" }
    if ($WorkflowsPath) { $rejectedFlags += "-WorkflowsPath" }
    if ($rejectedFlags.Count -gt 0) {
        $flagList = $rejectedFlags -join ", "
        Write-Fail "CI mode is fail-closed and cannot be combined with skip or partial flags ($flagList)."
        exit 1
    }

    # Verify required tools upfront under -CI so missing binaries never silently degrade
    $requiredTools = @(
        @{ Name = "git"; Hint = "Install Git and ensure 'git' is on PATH." },
        @{ Name = "node"; Hint = "Install Node.js (via .nvmrc) and ensure 'node' is on PATH." },
        @{ Name = "npm"; Hint = "Install npm and ensure 'npm' is on PATH." },
        @{ Name = "npx"; Hint = "Install npx and ensure 'npx' is on PATH." }
    )
    foreach ($tool in $requiredTools) {
        if (-not (Get-Command $tool.Name -ErrorAction SilentlyContinue)) {
            Write-Fail "-CI mode requires '$($tool.Name)' in PATH, but it was not found. $($tool.Hint)"
            exit 1
        }
    }
}

# Determine merge-base if BaseRef is omitted
if (-not $BaseRef) {
    $mergeBase = & git -C $RootDir merge-base HEAD origin/main 2>$null
    if ($LASTEXITCODE -eq 0 -and $mergeBase) {
        $BaseRef = $mergeBase.Trim()
    } else {
        $BaseRef = "origin/main"
    }
}

Push-Location $RootDir
$prodLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-prod-$PID.log"
$fixtureLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-fixture-$PID.log"
$prodDistBackup = Join-Path ([System.IO.Path]::GetTempPath()) "kidthales-dist-prod-$PID"

try {
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host " kidthales.github.io CI Orchestrator$(if ($IsCI) { ' [-CI Fail-Closed Mode]' } elseif ($Quick) { ' [-Quick Mode]' } else { '' })" -ForegroundColor Cyan
    Write-Host " Root: $RootDir" -ForegroundColor Gray
    Write-Host " BaseRef: $BaseRef" -ForegroundColor Gray
    Write-Host "====================================================" -ForegroundColor Cyan

    $MaxGate = 6

    # -------------------------------------------------------------
    # Gate 0: Workflow Single-Source Contract & Step Allowlist
    # -------------------------------------------------------------
    $Gate0Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 0 $MaxGate "Workflow Single-Source Contract"
    $targetWorkflows = if ($WorkflowsPath) { $WorkflowsPath } else { Join-Path $RootDir ".github/workflows" }
    Write-Host "Running: node --experimental-strip-types scripts/gates/workflow-contract.ts $targetWorkflows..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/workflow-contract.ts $targetWorkflows
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Workflow contract verification failed."
        throw "Gate 0 Failed: Workflow contract verification failed."
    }
    $GateResults["gate0_workflow_contract"] = "pass"
    Exit-GatePass "All workflows conform to workflow-contract.ts AST invariants" $Gate0Timer

    if ($Gate0Only) {
        $GateResults["gate1_action_pins_and_leaks"] = "not-applicable"
        $GateResults["gate2_pwsh_ast"] = "not-applicable"
        $GateResults["gate3_typecheck_contrast_and_unit"] = "not-applicable"
        $GateResults["gate4_prod_build_and_structural"] = "not-applicable"
        $GateResults["gate5_fixture_axe_and_budgets"] = "not-applicable"
        $GateResults["gate6_lints_errata_and_negative"] = "not-applicable"
        Write-GateSummary
        $totalElapsed = [math]::Round($TotalTimer.Elapsed.TotalSeconds, 2)
        Write-Host "`n====================================================" -ForegroundColor Green
        Write-Host " Gate 0 Workflow Contract Verification PASSED in ${totalElapsed}s" -ForegroundColor Green
        Write-Host "====================================================" -ForegroundColor Green
        exit 0
    }

    # -------------------------------------------------------------
    # Gate 1: Action Commit SHA Pinning & Agent File Leak Audit
    # -------------------------------------------------------------
    $Gate1Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 1 $MaxGate "Action Commit SHA Pinning & Agent File Leak Audit"
    $wfDir = if ($WorkflowsPath) { $WorkflowsPath } else { Join-Path $RootDir ".github/workflows" }
    if (Test-Path $wfDir) {
        $wfFiles = Get-ChildItem -Path $wfDir -File | Where-Object { $_.Extension -in @(".yml", ".yaml") }
        $unpinned = @()
        foreach ($wf in $wfFiles) {
            $lines = Get-Content $wf.FullName
            for ($i = 0; $i -lt $lines.Count; $i++) {
                $line = $lines[$i]
                if ($line -match '^\s*(?:-\s+)?uses:\s*[''"]?([^''"\s#]+)[''"]?') {
                    $target = $matches[1]
                    if ($target -notmatch '^(\./|\.\./|docker://)') {
                        if ($target -notmatch '@[0-9a-fA-F]{40}') {
                            $unpinned += "$($wf.Name) line $($i+1): $target"
                        }
                    }
                }
            }
        }
        if ($unpinned.Count -gt 0) {
            Write-Fail "Unpinned action(s) detected (must pin to 40-char commit SHA):`n$($unpinned -join "`n")"
            throw "Gate 1 Failed: Unpinned action(s) detected."
        }
    }

    $AgentFilePattern = '^(\.agents?/|\.gemini/|\.ai/|\.cursor/|\.claude/|scratch/|docs/learnings/|AGENTS\.md$|GEMINI\.md$|CLAUDE\.md$)'
    $TrackedFiles = & git -C $RootDir ls-files
    $TrackedLeaks = @($TrackedFiles | Where-Object { $_ -match $AgentFilePattern })
    $UntrackedFiles = & git -C $RootDir ls-files --others --exclude-standard
    $UntrackedLeaks = @($UntrackedFiles | Where-Object { $_ -match $AgentFilePattern })

    if ($TrackedLeaks.Count -gt 0 -or $UntrackedLeaks.Count -gt 0) {
        Write-Fail "Agent or scratch file leak detected."
        throw "Gate 1 Failed: Agent or scratch file leak detected."
    }
    $GateResults["gate1_action_pins_and_leaks"] = "pass"
    Exit-GatePass "Action commit SHA pins and agent leak audits passed" $Gate1Timer

    # -------------------------------------------------------------
    # Gate 2: PowerShell AST Parse Validation (*.ps1)
    # -------------------------------------------------------------
    $Gate2Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 2 $MaxGate "PowerShell AST Parse Validation (*.ps1)"
    $Ps1Files = Get-ChildItem -Path $RootDir -Recurse -Filter "*.ps1" | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules)[\\/]' }
    $ParseErrors = 0
    foreach ($ps in $Ps1Files) {
        $tokens = $null
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($ps.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count -gt 0) {
            Write-Fail "Parse error in $($ps.FullName): $($errors | Out-String)"
            $ParseErrors++
        }
    }
    if ($ParseErrors -gt 0) {
        throw "Gate 2 Failed: $ParseErrors PowerShell script(s) failed AST parse validation."
    }
    $GateResults["gate2_pwsh_ast"] = "pass"
    Exit-GatePass "PowerShell AST validation passed ($($Ps1Files.Count) script(s))" $Gate2Timer

    # -------------------------------------------------------------
    # Gate 3: Typecheck, Static Contrast Pairs & Unit Tests
    # -------------------------------------------------------------
    $Gate3Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 3 $MaxGate "Typecheck, Static Contrast Pairs & Unit Tests"
    if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
    if (Test-Path (Join-Path $RootDir "node_modules/.astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir "node_modules/.astro") }

    Write-Host "Running: npm run check..." -ForegroundColor Yellow
    & npm run check
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "astro check returned exit code $LASTEXITCODE"
        throw "CI Step Failed: astro check returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/contrast-pairs.ts..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/contrast-pairs.ts
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Contrast pairs gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Contrast pairs gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: npm test..." -ForegroundColor Yellow
    $statusBeforeTest = (& git -C $RootDir status --porcelain 2>$null | Out-String).Trim()
    & npm test
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "npm test returned exit code $LASTEXITCODE"
        throw "CI Step Failed: npm test returned exit code $LASTEXITCODE"
    }

    # Enforce post-npm test working-tree cleanliness
    $statusAfterTest = (& git -C $RootDir status --porcelain 2>$null | Out-String).Trim()
    if ($IsCI -and (-not [string]::IsNullOrWhiteSpace($statusAfterTest))) {
        Write-Fail "Working tree must be completely clean in -CI mode, but detected changes:`n$statusAfterTest"
        throw "CI Step Failed: Working tree dirtied in -CI mode."
    }
    if ($statusBeforeTest -ne $statusAfterTest) {
        Write-Fail "Working tree was modified by npm test:`n$statusAfterTest"
        throw "CI Step Failed: Working tree was dirtied by npm test."
    }

    $GateResults["gate3_typecheck_contrast_and_unit"] = "pass"
    Exit-GatePass "Typecheck, contrast pairs, and unit tests passed with clean working tree" $Gate3Timer

    # -------------------------------------------------------------
    # Gate 4: Production Build & Structural Output Gates
    # -------------------------------------------------------------
    $Gate4Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 4 $MaxGate "Production Build & Structural Output Gates"
    if ($env:SITE_FIXTURES) {
        Write-Fail "Production build cannot run with SITE_FIXTURES set."
        throw "CI Step Failed: Production build cannot run with SITE_FIXTURES set."
    }
    if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
    if (Test-Path (Join-Path $RootDir "node_modules/.astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir "node_modules/.astro") }
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }

    Write-Host "Running: npm run build..." -ForegroundColor Yellow
    $prodOutput = & npm run build 2>&1 | Out-String
    $prodExitCode = $LASTEXITCODE
    Write-Host $prodOutput
    Set-Content -Path $prodLogFile -Value $prodOutput -Encoding UTF8
    if ($prodExitCode -ne 0) {
        Write-Fail "astro build returned exit code $prodExitCode"
        throw "CI Step Failed: astro build returned exit code $prodExitCode"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/zero-js.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/zero-js.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Zero-JS gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Zero-JS gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/origins.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/origins.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Origin gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Origin gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/links.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/links.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Internal Links & Anchors gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Internal Links & Anchors gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/canonical-sitemap.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/canonical-sitemap.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Canonical & Sitemap gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Canonical & Sitemap gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json (Production dist)..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Production Weight Budgets gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Production Weight Budgets gate returned exit code $LASTEXITCODE"
    }

    # Stage Production dist/ to Temporary Cache
    if (Test-Path $prodDistBackup) { Remove-Item -Recurse -Force $prodDistBackup }
    Copy-Item -Recurse -Force (Join-Path $RootDir "dist") $prodDistBackup
    $GateResults["gate4_prod_build_and_structural"] = "pass"
    Exit-GatePass "Production build, structural gates, and production weight budgets passed" $Gate4Timer

    # -------------------------------------------------------------
    # Gate 5: Fixture Build, Accessibility Audit & Budgets
    # -------------------------------------------------------------
    $Gate5Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 5 $MaxGate "Fixture Build, Accessibility Audit & Budgets"
    if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
    if (Test-Path (Join-Path $RootDir "node_modules/.astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir "node_modules/.astro") }
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }

    Write-Host "Running: astro build with SITE_FIXTURES=1..." -ForegroundColor Yellow
    $env:SITE_FIXTURES = "1"
    $env:WORDS_FIXTURE_PATH = ""
    $env:WORKS_FIXTURE_PATH = ""
    try {
        $fixtureOutput = & npx astro build 2>&1 | Out-String
        $fixtureExitCode = $LASTEXITCODE
        Write-Host $fixtureOutput
        Set-Content -Path $fixtureLogFile -Value $fixtureOutput -Encoding UTF8
        if ($fixtureExitCode -ne 0) {
            Write-Fail "Fixture build returned exit code $fixtureExitCode"
            throw "CI Step Failed: Fixture build returned exit code $fixtureExitCode"
        }
    } finally {
        $env:SITE_FIXTURES = ""
        $env:WORDS_FIXTURE_PATH = ""
        $env:WORKS_FIXTURE_PATH = ""
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/diagnostics.ts..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/diagnostics.ts --log $prodLogFile --log $fixtureLogFile
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Diagnostics gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Diagnostics gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/axe.ts dist (single-pass accessibility & reports)..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/axe.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Accessibility gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Accessibility gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json (Fixture dist)..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Fixture Weight Budgets gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Fixture Weight Budgets gate returned exit code $LASTEXITCODE"
    }
    $GateResults["gate5_fixture_axe_and_budgets"] = "pass"
    Exit-GatePass "Fixture build, diagnostics, single-pass axe audit, and fixture weight budgets passed" $Gate5Timer

    # -------------------------------------------------------------
    # Gate 6: Lints, Errata Guard, Negative Scenarios & Restore
    # -------------------------------------------------------------
    $Gate6Timer = [System.Diagnostics.Stopwatch]::StartNew()
    Enter-Gate 6 $MaxGate "Lints, Errata Guard, Negative Scenarios & Restore"

    Write-Host "Running: node --experimental-strip-types scripts/gates/css-lint.ts src/styles..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/css-lint.ts src/styles
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "CSS Lints gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: CSS Lints gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/integrity-lint.ts ...." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/integrity-lint.ts .
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Integrity Lints gate returned exit code $LASTEXITCODE"
        throw "CI Step Failed: Integrity Lints gate returned exit code $LASTEXITCODE"
    }

    Write-Host "Running: node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "errata-guard returned exit code $LASTEXITCODE"
        throw "CI Step Failed: errata-guard returned exit code $LASTEXITCODE"
    }

    # 2 representative E2E negative build smoke checks (1 words [N1], 1 works [N10], skipped under -Quick)
    if ($Quick) {
        Write-Host "  -> Skipping E2E negative build smoke checks under -Quick mode." -ForegroundColor Yellow
    } else {
        $scenarios = @(
            @{ Id = "N1"; Dir = "n1-essay-missing-description"; Pattern = "description"; EnvVar = "WORDS_FIXTURE_PATH" },
            @{ Id = "N10"; Dir = "n10-retired-without-note"; Pattern = "Retired works require retirement_note"; EnvVar = "WORKS_FIXTURE_PATH" }
        )

        foreach ($sc in $scenarios) {
            Write-Host "Testing E2E negative scenario $($sc.Id) ($($sc.Dir))..." -ForegroundColor Yellow
            if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
            if (Test-Path (Join-Path $RootDir "node_modules/.astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir "node_modules/.astro") }
            $env:SITE_FIXTURES = "1"
            $env:WORDS_FIXTURE_PATH = ""
            $env:WORKS_FIXTURE_PATH = ""
            if ($sc.EnvVar) {
                Set-Item -Path "env:$($sc.EnvVar)" -Value "tests/fixtures/invalid/$($sc.Dir)"
            } else {
                $env:WORDS_FIXTURE_PATH = "tests/fixtures/invalid/$($sc.Dir)"
            }
            try {
                $output = & npx astro build 2>&1 | Out-String
                if ($LASTEXITCODE -eq 0) {
                    Write-Fail "Negative scenario $($sc.Id) unexpectedly passed"
                    throw "Negative scenario $($sc.Id) unexpectedly passed (expected failure matching '$($sc.Pattern)')"
                }
                if ($output -notmatch $sc.Pattern) {
                    Write-Fail "Negative scenario $($sc.Id) failed with unexpected output"
                    throw "Negative scenario $($sc.Id) failed with unexpected error. Expected match for '$($sc.Pattern)'. Output:`n$output"
                }
                Write-Host "  Scenario $($sc.Id) failed as expected matching pattern '$($sc.Pattern)'" -ForegroundColor Green
            } finally {
                $env:SITE_FIXTURES = ""
                $env:WORDS_FIXTURE_PATH = ""
                $env:WORKS_FIXTURE_PATH = ""
                if ($sc.EnvVar) {
                    Set-Item -Path "env:$($sc.EnvVar)" -Value ""
                }
                $global:LASTEXITCODE = 0
            }
        }
    }

    # Restore Production Build Output
    Write-Host "Restoring Production Build Output..." -ForegroundColor Yellow
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }
    Copy-Item -Recurse -Force $prodDistBackup (Join-Path $RootDir "dist")
    if (-not (Test-Path (Join-Path $RootDir "dist/index.html"))) {
        Write-Fail "Production dist/index.html does not exist after restore."
        throw "CI Step Failed: Production dist/index.html does not exist after restore."
    }
    $GateResults["gate6_lints_errata_and_negative"] = "pass"
    Exit-GatePass "Lints, errata guard, negative build smoke checks, and prod dist restore passed" $Gate6Timer

    $totalElapsed = [math]::Round($TotalTimer.Elapsed.TotalSeconds, 2)

    # Emit structured gate summary lines for seldon ci run and human operator visibility
    Write-GateSummary

    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host " All CI Gates PASSED in ${totalElapsed}s" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Cyan

    $global:LASTEXITCODE = 0
    exit 0
} catch {
    if ($IsCI -and $script:InGroup) {
        Write-Host "::endgroup::"
        $script:InGroup = $false
    }
    Write-GateSummary
    Write-Host "`n====================================================" -ForegroundColor Red
    Write-Host " CI FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "====================================================" -ForegroundColor Red
    exit 1
} finally {
    if (Test-Path $prodLogFile) { Remove-Item $prodLogFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $fixtureLogFile) { Remove-Item $fixtureLogFile -Force -ErrorAction SilentlyContinue }
    if ($prodDistBackup -and (Test-Path $prodDistBackup)) { Remove-Item $prodDistBackup -Recurse -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
