param(
    [string]$TranscriptFile
)

Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$rec.SetInputToDefaultAudioDevice()

$dictation = New-Object System.Speech.Recognition.DictationGrammar
$rec.LoadGrammar($dictation)

$rec.InitialSilenceTimeout = [TimeSpan]::FromSeconds(999)
$rec.BabbleTimeout = [TimeSpan]::FromSeconds(0)
$rec.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(2.5)

if (Test-Path $TranscriptFile) {
    Remove-Item $TranscriptFile -Force -ErrorAction SilentlyContinue
}

while ($true) {
    try {
        $result = $rec.Recognize([TimeSpan]::FromSeconds(60))
        if ($result -and $result.Text -and $result.RecognitionResult -ne 'NoMatch') {
            $line = $result.Text.Trim()
            if ($line) {
                Add-Content -Path $TranscriptFile -Value $line -Encoding UTF8
            }
        }
    } catch {
        Start-Sleep -Milliseconds 200
    }
}
