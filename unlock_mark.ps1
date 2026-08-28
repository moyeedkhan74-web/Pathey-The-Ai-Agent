Add-Type -AssemblyName System.Speech

# Copy OneCore Mark to SAPI Voices in HKCU so no admin rights needed!
$srcPath = "HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_enUS_MarkM"
$dstPath = "HKCU:\SOFTWARE\Microsoft\Speech\Voices\Tokens\MSTTS_V110_enUS_MarkM"

if ((Test-Path $srcPath) -and -not (Test-Path $dstPath)) {
    try {
        New-Item -Path $dstPath -Force | Out-Null
        Copy-ItemProperty -Path $srcPath -Destination $dstPath -Name *
        if (Test-Path "$srcPath\Attributes") {
            New-Item -Path "$dstPath\Attributes" -Force | Out-Null
            Copy-ItemProperty -Path "$srcPath\Attributes" -Destination "$dstPath\Attributes" -Name *
        }
        Write-Host "UNLOCKED_MARK_SUCCESS"
    } catch {
        Write-Host "REG_ERROR: "$_.Exception.Message
    }
} else {
    Write-Host "ALREADY_EXISTS_OR_NOT_FOUND"
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
Write-Host "INSTALLED SAPI VOICES NOW:"
$synth.GetInstalledVoices() | ForEach-Object { Write-Host " - " $_.VoiceInfo.Name }
