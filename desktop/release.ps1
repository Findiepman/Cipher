# Cut and ship a desktop release in one command, on Windows.
#
# Same job as release.sh, written in PowerShell so it needs no bash. It:
#   1. removes the hand-made V1.0.0 release and tag, if still there
#   2. dispatches the desktop workflow, which builds and signs the installers
#      for Windows, macOS and Linux and drafts a release with them and
#      latest.json attached
#   3. waits for that build, and stops if it fails so nothing broken ships
#   4. publishes the draft, which is the moment installed apps can update
#
# Run it from a PowerShell window:
#   powershell -ExecutionPolicy Bypass -File .\desktop\release.ps1
#
# The only thing it cannot do for you is prove to GitHub that you are you. If
# the GitHub CLI is not signed in, it runs `gh auth login` once and you follow
# the browser prompt; every run after that is hands-off.

$ErrorActionPreference = 'Stop'

# Work from the repo root so gh reads the right remote and the paths resolve.
$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root

$conf = Get-Content 'desktop/src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
$version = $conf.version
$tag = "desktop-v$version"
$staleTag = 'V1.0.0'

if ([string]::IsNullOrWhiteSpace($version)) {
  Write-Host 'Could not read the version from desktop/src-tauri/tauri.conf.json'
  exit 1
}

Write-Host "==> desktop release v$version  (tag $tag)"

# The changelog entry is the release body and what the app shows beside the
# update banner, so a version without one does not ship. The workflow checks
# this too; checking here saves a twenty-minute build to find out.
$notes = @()
$inSection = $false
foreach ($line in Get-Content 'desktop/CHANGELOG.md') {
  if ($line -match '^## ') {
    $inSection = ($line -split ' ')[1] -eq $version
    continue
  }
  if ($inSection) { $notes += $line }
}
$notesText = ($notes -join "`n").Trim()
if ([string]::IsNullOrWhiteSpace($notesText)) {
  Write-Host "desktop/CHANGELOG.md has no '## $version' section. Write one, commit it, then run this again."
  exit 1
}
Write-Host '==> release notes:'
$notesText -split "`n" | ForEach-Object { Write-Host "    $_" }

# The GitHub CLI does the GitHub half. Everything below is one of its commands.
# It installs to a fixed place that a window opened before the install does not
# have on PATH, so add it here rather than making you reopen anything.
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  foreach ($dir in @("$env:ProgramFiles\GitHub CLI", "${env:ProgramFiles(x86)}\GitHub CLI", "$env:LOCALAPPDATA\Programs\GitHub CLI")) {
    if (Test-Path (Join-Path $dir 'gh.exe')) { $env:PATH = "$dir;$env:PATH"; break }
  }
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host 'The GitHub CLI is not installed. Install it once, then re-run this:'
  Write-Host '    winget install --id GitHub.cli'
  exit 1
}


# Windows PowerShell 5.1 wraps a native command's stderr in an ErrorRecord, and
# with $ErrorActionPreference = 'Stop' above that becomes a terminating error.
# Every probe below expects a non-zero exit and a line on stderr as its normal
# answer: "not logged in" and "release not found" are the questions being
# asked, not failures. So they run with the preference relaxed and are judged
# on the exit code alone, which is what was intended.
#
# PowerShell 7 does not do this, which is why the script ran there and stopped
# here: `powershell -ExecutionPolicy Bypass` launches 5.1.
function Invoke-GhProbe {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GhArgs)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & gh @GhArgs 1>$null 2>$null
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
}

# A one-time browser sign-in. Skipped on every run after the first.
if ((Invoke-GhProbe auth status) -ne 0) {
  Write-Host '==> signing in to GitHub (one time)'
  gh auth login
}

# 1. The empty hand-made release, if it is still around. It has no installers
#    and no latest.json, so leaving it keeps the updater pointed at a 404.
if ((Invoke-GhProbe release view $staleTag) -eq 0) {
  Write-Host "==> removing the empty $staleTag release and its tag"
  gh release delete $staleTag --yes --cleanup-tag
}

# 2. Build and draft-release, all platforms. The only thing that makes
#    installers; a release made by hand never will.
Write-Host '==> dispatching the build (three OSes, this takes a while)'
gh workflow run desktop.yml --ref main
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not dispatch the workflow.'; exit 1 }

# 3. Find the run that just started and wait it out. gh run watch exits
#    non-zero if the build fails, so we never reach the publish below.
Write-Host '==> waiting for the build to register'
$runId = ''
for ($i = 0; $i -lt 20; $i++) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $runId = (gh run list --workflow=desktop.yml --event=workflow_dispatch -L 1 --json databaseId -q '.[0].databaseId' 2>$null)
  } finally {
    $ErrorActionPreference = $previous
  }
  if (-not [string]::IsNullOrWhiteSpace($runId)) { break }
  Start-Sleep -Seconds 3
}

if ([string]::IsNullOrWhiteSpace($runId)) {
  Write-Host 'The run did not appear. Check the Actions tab and, once it is green,'
  Write-Host "publish the $tag draft yourself, or re-run this script."
  exit 1
}

Write-Host "==> watching build $runId (installers for all three OSes, ~15 to 25 min)"
gh run watch $runId --exit-status
if ($LASTEXITCODE -ne 0) { Write-Host 'The build failed. Nothing was published.'; exit 1 }

# 4. Publish the draft the build left behind. This is the moment it ships.
Write-Host "==> publishing $tag"
gh release edit $tag --draft=false --latest

Write-Host ''
Write-Host "Shipped. v$version is live, installers and updater feed attached."
Write-Host 'Installed apps will find it at their next check and offer the update.'
