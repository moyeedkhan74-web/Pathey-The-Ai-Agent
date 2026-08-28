Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
foreach ($v in $synth.GetInstalledVoices()) {
    Write-Host "SAPI: "$v.VoiceInfo.Name " | " $v.VoiceInfo.Culture
}

try {
    $regPath = "HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
    if (Test-Path $regPath) {
        Get-ChildItem $regPath | ForEach-Object {
            Write-Host "ONECORE REG: "$_.PSChildName
        }
    }
} catch {}
