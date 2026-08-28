"""
Pathey Voice Test Script
Run: python test_voice.py
Plays a sample sentence with the current voice configuration.
"""
import asyncio
import edge_tts
import os
import sys

VOICE = "en-IN-PrabhatNeural"
RATE = "+10%"
PITCH = "+5Hz"
FALLBACK_VOICE = "en-US-ChristopherNeural"

SAMPLE = (
    "Hey there! I'm Pathey, your AI agent. "
    "I'm a young tech guy from Mumbai, and I'm here to help you out. "
    "Got any files to check? Or maybe a quick search? "
    "Oh, and don't worry, I've got your back. Let's do this!"
)

OUTPUT = os.path.join(os.path.dirname(__file__), "test_voice_output.mp3")

async def generate(voice, rate, pitch, text, output):
    print(f"Voice: {voice} | Rate: {rate} | Pitch: {pitch}")
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    await communicate.save(output)
    size = os.path.getsize(output)
    print(f"Generated: {output} ({size} bytes)")

async def main():
    try:
        await generate(VOICE, RATE, PITCH, SAMPLE, OUTPUT)
        print("SUCCESS — primary voice works!")
    except Exception as e:
        print(f"Primary voice failed: {e}")
        print("Trying fallback...")
        try:
            await generate(FALLBACK_VOICE, "+5%", "+0Hz", SAMPLE, OUTPUT)
            print("SUCCESS — fallback voice works!")
        except Exception as e2:
            print(f"Fallback also failed: {e2}")
            sys.exit(1)

    # Try to play the audio
    try:
        if sys.platform == "win32":
            os.startfile(OUTPUT)
            print("Playing audio...")
        else:
            print(f"Play manually: {OUTPUT}")
    except:
        print(f"Play manually: {OUTPUT}")

asyncio.run(main())
