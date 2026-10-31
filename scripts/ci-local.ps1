<#
.SYNOPSIS
    Runs continuous integration suite for kidthales.github.io.
.DESCRIPTION
    Single CI orchestrator for both local runs and GitHub Actions CI:
    - Gate 0: Workflow single-source-of-truth contract & exact step allowlist
    - Gate 1: Action commit SHA pin verification & agent file leak audit
    - Gate 2: PowerShell AST parse validation (*.ps1)
    - Typecheck (astro check)
    - Static contrast pairs gate (contrast-pairs.ts)
    - Unit tests (node --test)
    - Production build (clean-room .astro/ & dist/)
    - Output structural gates against Production dist/ (zero-js, origins, links, canonical-sitemap)
    - Fixture build & diagnostics gate (clean-room .astro/ & dist/)
    - Accessibility gate & reports (axe.ts)
    - Weight budgets gate (budgets.ts)
    - Content-integrity gates (css-lint, integrity-lint, errata-guard)
    - Negative scenarios (N1–N9)
    - Production dist/ restoration and verification
    - Verifiable local CI receipt generation (.ci-local/receipt.json)
.PARAMETER BaseRef
    Base git ref to compare against (defaults to merge-base with origin/next).
.PARAMETER CI
    Enforces strict fail-closed contract for CI runners: emits GitHub Actions log groups and annotations.
.PARAMETER Gate0Only
    Executes Gate 0 workflow contract verification and exits.
#>
[CmdletBinding()]
param(
    [string]$BaseRef = "",
    [switch]$CI,
    [switch]$Gate0Only
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$IsCI = $CI.IsPresent -or (-not [string]::IsNullOrWhiteSpace($env:GITHUB_ACTIONS))

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
    if ($IsCI) {
        Write-Host "::group::$Name"
    } else {
        Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    }
}

function Write-EndGroup {
    if ($IsCI) {
        Write-Host "::endgroup::"
    }
}

function Test-Gate0Workflows {
    param([string]$TargetWorkflowsDir)

    if (-not (Test-Path $TargetWorkflowsDir)) {
        throw "Workflows directory not found: $TargetWorkflowsDir"
    }

    $ExactStepAllowlist = @(
        "verify/Install dependencies",
        "verify/Install Playwright browsers"
    )

    $CanonicalCiRuns = @(
        "./scripts/ci-local.ps1 -CI",
        "pwsh ./scripts/ci-local.ps1 -CI",
        "pwsh -File ./scripts/ci-local.ps1 -CI"
    )

    $wfFiles = @(Get-ChildItem -Path $TargetWorkflowsDir -File | Where-Object { $_.Extension -in @(".yml", ".yaml") })
    if ($wfFiles.Count -eq 0) {
        throw "Gate 0 failed: no workflow files (*.yml, *.yaml) found in $TargetWorkflowsDir"
    }

    $violations = @()

    foreach ($wf in $wfFiles) {
        $lines = @(Get-Content -Path $wf.FullName)
        $inJobs = $false
        $jobsIndent = -1
        $currentJob = ""
        $jobIndent = -1
        $inSteps = $false
        $stepsIndent = -1
        $inStepItem = $false
        $stepPropIndent = -1
        $currentStepName = ""
        $currentStepHasRun = $false
        $currentStepRunLines = @()
        $inRunBlock = $false
        $runBlockIndent = -1

        $jobHasSteps = $false
        $jobRunsCanonicalCi = $false

        for ($i = 0; $i -le $lines.Count; $i++) {
            $rawLine = if ($i -lt $lines.Count) { $lines[$i] } else { "" }
            $trimmed = $rawLine.Trim()

            if ($i -lt $lines.Count -and ($trimmed -eq "" -or $trimmed.StartsWith("#"))) {
                continue
            }

            $indent = $rawLine.Length - $rawLine.TrimStart().Length

            if ($inRunBlock) {
                if ($i -lt $lines.Count -and $indent -gt $runBlockIndent) {
                    $currentStepRunLines += $trimmed
                    continue
                } else {
                    $inRunBlock = $false
                }
            }

            $shouldFlushStep = $false
            if ($inStepItem) {
                if ($i -eq $lines.Count) {
                    $shouldFlushStep = $true
                } elseif ($indent -le $jobIndent) {
                    $shouldFlushStep = $true
                } elseif ($indent -le $stepsIndent -and -not $trimmed.StartsWith("-")) {
                    $shouldFlushStep = $true
                } elseif ($trimmed.StartsWith("- ") -or $trimmed -eq "-") {
                    if ($indent -le $stepPropIndent) {
                        $shouldFlushStep = $true
                    }
                }
            }

            if ($shouldFlushStep) {
                if ($currentStepHasRun) {
                    $runText = ($currentStepRunLines -join "`n").Trim()
                    $pairKey = "$currentJob/$currentStepName"
                    $isCanonicalCi = $CanonicalCiRuns -contains $runText
                    $isAllowlisted = $ExactStepAllowlist -contains $pairKey

                    if ($isCanonicalCi) {
                        $jobRunsCanonicalCi = $true
                    }

                    if (-not $isCanonicalCi -and -not $isAllowlisted) {
                        $violations += "$($wf.Name): job '$currentJob' step '$currentStepName' runs script ('$runText') instead of './scripts/ci-local.ps1 -CI' and pair '$pairKey' is not in the Gate 0 exact allowlist."
                    }
                }
                $inStepItem = $false
                $currentStepName = ""
                $currentStepHasRun = $false
                $currentStepRunLines = @()
            }

            $isEndingJob = $false
            if ($currentJob -ne "") {
                if ($i -eq $lines.Count) {
                    $isEndingJob = $true
                } elseif ($indent -eq 0 -and $trimmed.EndsWith(":")) {
                    $isEndingJob = $true
                } elseif ($jobIndent -ne -1 -and $indent -eq $jobIndent -and -not $trimmed.StartsWith("-") -and $trimmed.EndsWith(":")) {
                    $isEndingJob = $true
                }
            }

            if ($isEndingJob) {
                if ($currentJob -in @("verify", "test-and-build")) {
                    if ($jobHasSteps -and -not $jobRunsCanonicalCi) {
                        $violations += "$($wf.Name): verify job '$currentJob' defines steps but does not invoke './scripts/ci-local.ps1 -CI'."
                    }
                }
            }

            if ($i -eq $lines.Count) {
                break
            }

            if ($indent -eq 0 -and $trimmed.EndsWith(":")) {
                $sectionName = $trimmed.Substring(0, $trimmed.Length - 1).Trim()
                if ($sectionName -eq "jobs") {
                    $inJobs = $true
                    $jobsIndent = 0
                    $currentJob = ""
                    $inSteps = $false
                } else {
                    $inJobs = $false
                    $currentJob = ""
                    $inSteps = $false
                }
                continue
            }

            if (-not $inJobs) {
                continue
            }

            if (($jobIndent -eq -1 -or $indent -eq $jobIndent) -and $indent -gt $jobsIndent -and -not $trimmed.StartsWith("-") -and $trimmed.EndsWith(":")) {
                $jobCandidate = $trimmed.Substring(0, $trimmed.Length - 1).Trim()
                if ($jobIndent -eq -1) {
                    $jobIndent = $indent
                }
                if ($indent -eq $jobIndent) {
                    $currentJob = $jobCandidate
                    $inSteps = $false
                    $stepsIndent = -1
                    $jobHasSteps = $false
                    $jobRunsCanonicalCi = $false
                    continue
                }
            }

            if (-not $currentJob) {
                continue
            }

            if ($indent -gt $jobIndent -and $trimmed -eq "steps:") {
                $inSteps = $true
                $stepsIndent = $indent
                $jobHasSteps = $true
                continue
            }

            if ($inSteps -and $indent -le $stepsIndent -and -not $trimmed.StartsWith("-")) {
                $inSteps = $false
                continue
            }

            if ($inSteps) {
                $propText = $trimmed
                if ($trimmed.StartsWith("- ") -or $trimmed -eq "-") {
                    $inStepItem = $true
                    $currentStepName = ""
                    $currentStepHasRun = $false
                    $currentStepRunLines = @()
                    $dashIdx = $rawLine.IndexOf("-")
                    $propText = $trimmed.Substring(1).Trim()
                    $stepPropIndent = $dashIdx + 2
                }

                if ($inStepItem -and $propText -ne "") {
                    $colonIdx = $propText.IndexOf(":")
                    if ($colonIdx -gt 0) {
                        $propKey = $propText.Substring(0, $colonIdx).Trim()
                        $propVal = $propText.Substring($colonIdx + 1).Trim()
                        if (($propVal.StartsWith("'") -and $propVal.EndsWith("'")) -or ($propVal.StartsWith('"') -and $propVal.EndsWith('"'))) {
                            $propVal = $propVal.Substring(1, $propVal.Length - 2)
                        }

                        if ($propKey -eq "name") {
                            $currentStepName = $propVal
                        } elseif ($propKey -eq "run") {
                            $currentStepHasRun = $true
                            if ($propVal -eq "|" -or $propVal -eq ">" -or $propVal -eq "|-" -or $propVal -eq ">-" -or $propVal -eq "") {
                                $inRunBlock = $true
                                $runBlockIndent = $indent
                            } else {
                                $currentStepRunLines += $propVal
                            }
                        }
                    }
                }
            }
        }
    }

    if ($violations.Count -gt 0) {
        foreach ($v in $violations) {
            [Console]::Error.WriteLine("Gate 0 violation: $v")
        }
        throw "Gate 0 workflow single-source verification failed ($($violations.Count) violation(s))."
    }
}

Push-Location $RootDir
$prodLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-prod-$PID.log"
$fixtureLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "astro-build-fixture-$PID.log"
$prodDistBackup = Join-Path ([System.IO.Path]::GetTempPath()) "kidthales-dist-prod-$PID"

try {
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host " kidthales.github.io CI Orchestrator$(if ($IsCI) { ' [-CI Fail-Closed Mode]' } else { '' })" -ForegroundColor Cyan
    Write-Host " Root: $RootDir" -ForegroundColor Gray
    Write-Host " BaseRef: $BaseRef" -ForegroundColor Gray
    Write-Host "====================================================" -ForegroundColor Cyan

    # -------------------------------------------------------------
    # Gate 0: Workflow Single-Source Contract & Step Allowlist
    # -------------------------------------------------------------
    Write-Group "Gate 0: Workflow Single-Source Contract"
    $wfDir = Join-Path $RootDir ".github/workflows"
    Test-Gate0Workflows -TargetWorkflowsDir $wfDir
    Write-Host "  -> All workflows conform to ci-local.ps1 -CI or exact step allowlist." -ForegroundColor Green
    Write-EndGroup

    if ($Gate0Only) {
        exit 0
    }

    # -------------------------------------------------------------
    # Gate 1: Action Commit SHA Pinning & Agent File Leak Audit
    # -------------------------------------------------------------
    Write-Group "Gate 1: Action Commit SHA Pinning & Agent File Leak Audit"
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
            Write-EndGroup
            throw "Gate 1 Failed: Unpinned action(s) detected (must pin to 40-char commit SHA):`n$($unpinned -join "`n")"
        }
    }

    $AgentFilePattern = '^(\.agents?/|\.gemini/|\.ai/|\.cursor/|\.claude/|scratch/|docs/learnings/|AGENTS\.md$|GEMINI\.md$|CLAUDE\.md$)'
    $TrackedFiles = & git -C $RootDir ls-files
    $TrackedLeaks = @($TrackedFiles | Where-Object { $_ -match $AgentFilePattern })
    $UntrackedFiles = & git -C $RootDir ls-files --others --exclude-standard
    $UntrackedLeaks = @($UntrackedFiles | Where-Object { $_ -match $AgentFilePattern })

    if ($TrackedLeaks.Count -gt 0 -or $UntrackedLeaks.Count -gt 0) {
        Write-EndGroup
        throw "Gate 1 Failed: Agent or scratch file leak detected."
    }
    Write-Host "  -> Action commit SHA pins and agent leak audits passed." -ForegroundColor Green
    Write-EndGroup

    # -------------------------------------------------------------
    # Gate 2: PowerShell AST Parse Validation (*.ps1)
    # -------------------------------------------------------------
    Write-Group "Gate 2: PowerShell AST Parse Validation (*.ps1)"
    $Ps1Files = Get-ChildItem -Path $RootDir -Recurse -Filter "*.ps1" | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules)[\\/]' }
    $ParseErrors = 0
    foreach ($ps in $Ps1Files) {
        $tokens = $null
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($ps.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count -gt 0) {
            Write-Host "  -> Parse error in $($ps.FullName): $($errors | Out-String)" -ForegroundColor Red
            $ParseErrors++
        }
    }
    if ($ParseErrors -gt 0) {
        Write-EndGroup
        throw "Gate 2 Failed: $ParseErrors PowerShell script(s) failed AST parse validation."
    }
    Write-Host "  -> PowerShell AST validation passed ($($Ps1Files.Count) script(s))." -ForegroundColor Green
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 3: Typecheck (astro check)
    # -------------------------------------------------------------
    Write-Group "Typecheck (astro check)"
    Write-Host "Running: npm run check..." -ForegroundColor Yellow
    & npm run check
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: astro check returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 4: Static Contrast Pairs Gate
    # -------------------------------------------------------------
    Write-Group "Static Contrast Pairs Gate (scripts/gates/contrast-pairs.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/contrast-pairs.ts..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/contrast-pairs.ts
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Contrast pairs gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 5: Unit Tests (node --test)
    # -------------------------------------------------------------
    Write-Group "Unit Tests (node --test)"
    Write-Host "Running: npm test..." -ForegroundColor Yellow
    & npm test
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: npm test returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 6: Production Build (clean-room .astro/ & dist/)
    # -------------------------------------------------------------
    Write-Group "Production Build (clean-room astro build)"
    if ($env:SITE_FIXTURES) {
        Write-EndGroup
        throw "CI Step Failed: Production build cannot run with SITE_FIXTURES set."
    }
    if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }

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

    # -------------------------------------------------------------
    # Step 7: Structural Output Gates (against Production dist/)
    # -------------------------------------------------------------
    Write-Group "Zero-JS Gate (scripts/gates/zero-js.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/zero-js.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/zero-js.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Zero-JS gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Group "Origin Gate (scripts/gates/origins.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/origins.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/origins.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Origin gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Group "Internal Links & Anchors Gate (scripts/gates/links.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/links.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/links.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Internal Links & Anchors gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Group "Canonical & Sitemap Gate (scripts/gates/canonical-sitemap.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/canonical-sitemap.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/canonical-sitemap.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Canonical & Sitemap gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 8: Stage Production dist/ to Temporary Staging Directory
    # -------------------------------------------------------------
    Write-Group "Stage Production Build Output"
    if (Test-Path $prodDistBackup) { Remove-Item -Recurse -Force $prodDistBackup }
    Copy-Item -Recurse -Force (Join-Path $RootDir "dist") $prodDistBackup
    Write-Host "  -> Production dist/ staged to temporary cache." -ForegroundColor Green
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 9: Fixture Build (clean-room .astro/ & dist/)
    # -------------------------------------------------------------
    Write-Group "Fixture Build (clean-room SITE_FIXTURES=1)"
    if (Test-Path (Join-Path $RootDir ".astro")) { Remove-Item -Recurse -Force (Join-Path $RootDir ".astro") }
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }

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

    # -------------------------------------------------------------
    # Step 10: Diagnostics Gate (Production + Fixture Logs)
    # -------------------------------------------------------------
    Write-Group "Diagnostics Gate (scripts/gates/diagnostics.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/diagnostics.ts..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/diagnostics.ts --log $prodLogFile --log $fixtureLogFile
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Diagnostics gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 11: Accessibility Gate (WCAG 2.2 A/AA axe audit on fixtures)
    # -------------------------------------------------------------
    Write-Group "Accessibility Gate (scripts/gates/axe.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/axe.ts dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/axe.ts dist
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Accessibility gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Group "Accessibility & Performance Reports (scripts/gates/axe.ts --report)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/axe.ts --report dist..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/axe.ts --report dist
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 12: Weight Budgets Gate (against fixture dist/)
    # -------------------------------------------------------------
    Write-Group "Weight Budgets Gate (scripts/gates/budgets.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/budgets.ts dist budgets.json
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Weight Budgets gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 13: CSS & Integrity Lints
    # -------------------------------------------------------------
    Write-Group "CSS Lints (scripts/gates/css-lint.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/css-lint.ts src/styles..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/css-lint.ts src/styles
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: CSS Lints gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    Write-Group "Integrity Lints (scripts/gates/integrity-lint.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/integrity-lint.ts ...." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/integrity-lint.ts .
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: Integrity Lints gate returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 14: Errata Guard Gate
    # -------------------------------------------------------------
    Write-Group "Errata Guard Gate (scripts/gates/errata-guard.ts)"
    Write-Host "Running: node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef..." -ForegroundColor Yellow
    & node --experimental-strip-types scripts/gates/errata-guard.ts --base-ref $BaseRef
    if ($LASTEXITCODE -ne 0) {
        Write-EndGroup
        throw "CI Step Failed: errata-guard returned exit code $LASTEXITCODE"
    }
    Write-EndGroup

    # -------------------------------------------------------------
    # Step 15: Negative Scenarios Gate (invalid fixtures N1–N9)
    # -------------------------------------------------------------
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

    # -------------------------------------------------------------
    # Step 16: Restore Production Build Output
    # -------------------------------------------------------------
    Write-Group "Restore Production Build Output"
    if (Test-Path (Join-Path $RootDir "dist")) { Remove-Item -Recurse -Force (Join-Path $RootDir "dist") }
    Copy-Item -Recurse -Force $prodDistBackup (Join-Path $RootDir "dist")
    if (-not (Test-Path (Join-Path $RootDir "dist/index.html"))) {
        Write-EndGroup
        throw "CI Step Failed: Production dist/index.html does not exist after restore."
    }
    Write-Host "  -> Production dist/ successfully restored and verified (dist/index.html exists)." -ForegroundColor Green
    Write-EndGroup

    Write-Host "`n====================================================" -ForegroundColor Green
    Write-Host " All CI Gates PASSED" -ForegroundColor Green
    Write-Host "====================================================" -ForegroundColor Cyan

    # -------------------------------------------------------------
    # Step 17: Local CI Receipt Generation (.ci-local/receipt.json)
    # -------------------------------------------------------------
    if ($IsCI) {
        Write-Host "`n  -> Skipping local CI receipt generation under -CI mode." -ForegroundColor Gray
    } else {
        $SeldonBin = $null
        if ($env:SELDON_BIN -and $env:SELDON_BIN -ne "none" -and (Test-Path $env:SELDON_BIN)) {
            $SeldonBin = $env:SELDON_BIN
        } else {
            $PathCmd = Get-Command "seldon" -ErrorAction SilentlyContinue
            if ($PathCmd) {
                $SeldonBin = $PathCmd.Source
            }
        }

        if (-not $SeldonBin) {
            Write-Host "`n  -> Skipping local CI receipt generation (seldon binary not found)." -ForegroundColor Gray
        } else {
            Write-Host "`n[Receipt] Recording local CI receipt via seldon ci receipt..." -ForegroundColor Yellow
            $ReceiptArgs = @("ci", "receipt", "--dir", $RootDir, "--script-path", "scripts/ci-local.ps1")
            & $SeldonBin @ReceiptArgs
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  -> Note: seldon ci receipt skipped or returned non-zero (working tree may have uncommitted changes)." -ForegroundColor Yellow
            } else {
                Write-Host "  -> Local CI receipt written to .ci-local/receipt.json." -ForegroundColor Green
            }
        }
    }

    $global:LASTEXITCODE = 0
    exit 0
} finally {
    if (Test-Path $prodLogFile) { Remove-Item $prodLogFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $fixtureLogFile) { Remove-Item $fixtureLogFile -Force -ErrorAction SilentlyContinue }
    if ($prodDistBackup -and (Test-Path $prodDistBackup)) { Remove-Item $prodDistBackup -Recurse -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
