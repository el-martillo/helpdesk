param(
    [Parameter(Mandatory=$true)][string]$SbUrl,
    [Parameter(Mandatory=$true)][string]$AnonKey,
    [Parameter(Mandatory=$true)][string]$ServiceKey
)

$ErrorActionPreference = 'Stop'

function Get-AppVersion {
    param($SbUrl, $AnonKey)
    $uri = "$SbUrl/rest/v1/app_settings?key=eq.app_version&select=value"
    $headers = @{ apikey = $AnonKey; Authorization = "Bearer $AnonKey" }
    $resp = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    if ($resp -and $resp.Count -gt 0) {
        return $resp[0].value
    }
    return $null
}

function Set-AppVersion {
    param($SbUrl, $ServiceKey, $NewVersion)
    $uri = "$SbUrl/rest/v1/app_settings"
    $headers = @{
        apikey        = $ServiceKey
        Authorization = "Bearer $ServiceKey"
        'Content-Type' = 'application/json'
        Prefer        = 'resolution=merge-duplicates'
    }
    $body = @{ key = 'app_version'; value = $NewVersion } | ConvertTo-Json -Compress
    Invoke-RestMethod -Uri $uri -Headers $headers -Method Post -Body $body | Out-Null
}

function Bump-LastSegment {
    param([string]$Version)
    $parts = $Version -split '\.'
    $lastIndex = $parts.Length - 1
    $lastNum = 0
    if ([int]::TryParse($parts[$lastIndex], [ref]$lastNum)) {
        $parts[$lastIndex] = ($lastNum + 1).ToString()
    } else {
        $parts += '1'
    }
    return ($parts -join '.')
}

try {
    Write-Host ""
    $current = Get-AppVersion -SbUrl $SbUrl -AnonKey $AnonKey

    if ([string]::IsNullOrWhiteSpace($current)) {
        Write-Host "No app_version row found in app_settings - skipping version bump."
        Write-Host "(If this is unexpected, check that the app_settings table has a row with key='app_version'.)"
        exit 0
    }

    $proposed = Bump-LastSegment -Version $current
    Write-Host "Current app version: $current"
    Write-Host "Proposed new version: $proposed"
    Write-Host ""
    Write-Host "[A] Accept proposed version"
    Write-Host "[C] Enter a custom version"
    Write-Host "[S] Skip - keep current version unchanged"
    $choice = Read-Host "Choice (A/C/S)"
    $choiceUpper = $choice.ToUpper()

    if ($choiceUpper -eq 'A') {
        Set-AppVersion -SbUrl $SbUrl -ServiceKey $ServiceKey -NewVersion $proposed
        Write-Host "Version updated: $current -> $proposed"
    } elseif ($choiceUpper -eq 'C') {
        $custom = Read-Host "Enter version"
        if ([string]::IsNullOrWhiteSpace($custom)) {
            Write-Host "No version entered - skipping."
        } else {
            Set-AppVersion -SbUrl $SbUrl -ServiceKey $ServiceKey -NewVersion $custom
            Write-Host "Version updated: $current -> $custom"
        }
    } else {
        Write-Host "Skipped - version remains $current"
    }

    exit 0
} catch {
    Write-Host "Version bump failed: $($_.Exception.Message)"
    exit 1
}
