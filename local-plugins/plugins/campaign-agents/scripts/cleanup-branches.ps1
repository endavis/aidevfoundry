<#
.SYNOPSIS
    Git branch cleanup for completed campaign tasks
.DESCRIPTION
    Cleans up merged campaign branches after tasks are completed.
    Only deletes branches that have been merged into main.
.PARAMETER ProjectPath
    Path to the project repository
.PARAMETER CampaignId
    Optional campaign ID to filter branches
.EXAMPLE
    .\cleanup-branches.ps1 -ProjectPath "C:\Projects\MyApp"
.EXAMPLE
    .\cleanup-branches.ps1 -ProjectPath "C:\Projects\MyApp" -CampaignId "camp-001"
#>

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ProjectPath,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$CampaignId
)

$ErrorActionPreference = "Stop"

# Validate project path
if (-not (Test-Path $ProjectPath)) {
    Write-Error "Project path does not exist: $ProjectPath"
    exit 1
}

# Change to project directory
Push-Location $ProjectPath
try {
    Write-Host "=== Campaign Branch Cleanup ===" -ForegroundColor Cyan
    Write-Host "Project: $ProjectPath"
    Write-Host "Campaign: $(if ($CampaignId) { $CampaignId } else { 'all' })"
    Write-Host "===============================" -ForegroundColor Cyan

    # Build pattern for branch matching
    if ($CampaignId) {
        $Pattern = "campaign/$CampaignId/task-*"
    } else {
        $Pattern = "campaign/*/task-*"
    }

    # Get list of campaign branches
    $AllBranches = git branch --list $Pattern 2>$null

    if (-not $AllBranches) {
        Write-Host ""
        Write-Host "No campaign branches found matching pattern: $Pattern" -ForegroundColor Yellow
        exit 0
    }

    # Clean up branch names (remove leading spaces and asterisks)
    $AllBranches = $AllBranches | ForEach-Object { $_.Trim().TrimStart('* ') } | Where-Object { $_ }

    Write-Host ""
    Write-Host "Found campaign branches:" -ForegroundColor Green
    $AllBranches | ForEach-Object { Write-Host "  $_" }
    Write-Host ""

    # Check which branches are merged into main
    $MergedBranches = git branch --merged main --list $Pattern 2>$null

    if (-not $MergedBranches) {
        Write-Host "No merged branches to clean up." -ForegroundColor Yellow
        exit 0
    }

    # Clean up merged branch names
    $MergedBranches = $MergedBranches | ForEach-Object { $_.Trim().TrimStart('* ') } | Where-Object { $_ }

    Write-Host "Merged branches (safe to delete):" -ForegroundColor Green
    $MergedBranches | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host ""

    # Confirm deletion
    $Response = Read-Host "Delete these merged branches? [y/N]"

    if ($Response -match '^[Yy]$') {
        foreach ($Branch in $MergedBranches) {
            if ($Branch) {
                Write-Host "Deleting: $Branch" -ForegroundColor Yellow
                git branch -d $Branch
            }
        }
        Write-Host ""
        Write-Host "Cleanup complete." -ForegroundColor Green
    } else {
        Write-Host "Cleanup cancelled." -ForegroundColor Yellow
    }
}
finally {
    Pop-Location
}
