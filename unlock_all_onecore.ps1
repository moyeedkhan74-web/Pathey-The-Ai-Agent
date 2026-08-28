# Unlock OneCore voices into HKCU Speech Voices
$oneCorePath = "HKLM:\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens"
$userSpeechPath = "HKCU:\SOFTWARE\Microsoft\Speech\Voices\Tokens"

if (Test-Path $oneCorePath) {
    Get-ChildItem $oneCorePath | ForEach-Object {
        $voiceKey = $_.PSChildName
        $targetKey = "$userSpeechPath\$voiceKey"
        Write-Host "Unlocking $voiceKey..."
        
        # Copy main key and all subkeys recursively
        reg copy "HKLM\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\$voiceKey" "HKCU\SOFTWARE\Microsoft\Speech\Voices\Tokens\$voiceKey" /s /f | Out-Null
    }
}

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
Write-Host "--- ALL AVAILABLE SAPI VOICES NOW ---"
$synth.GetInstalledVoices() | ForEach-Object { Write-Host "FOUND VOICE: " $_.VoiceInfo.Name }
