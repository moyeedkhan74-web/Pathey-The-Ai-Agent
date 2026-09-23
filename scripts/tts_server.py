import sys
import os
import time
import asyncio
import urllib.parse
import edge_tts

VOICE = "en-IN-PrabhatNeural"
RATE = "+15%"
PITCH = "+5Hz"

# Warm up SSL / Communicate instance at startup
async def init_edge():
    print("[TTS Server] Initializing Edge TTS engine...")

async def handle_client(reader, writer):
    try:
        data = await reader.read(4096)
        if not data:
            writer.close()
            return
        
        request_line = data.decode('utf-8', errors='ignore').split('\r\n')[0]
        
        # Simple HTTP parse
        body = ""
        if '\r\n\r\n' in data.decode('utf-8', errors='ignore'):
            body = data.decode('utf-8', errors='ignore').split('\r\n\r\n')[1]
            
        params = urllib.parse.parse_qs(body)
        text = params.get('text', [''])[0]
        outfile = params.get('outfile', [''])[0]

        if not text or not outfile:
            response = "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n{\"error\":\"missing param\"}"
            writer.write(response.encode('utf-8'))
            await writer.drain()
            writer.close()
            return

        t0 = time.time()
        comm = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
        await comm.save(outfile)
        elapsed = round((time.time() - t0) * 1000, 2)
        print(f"[TTS Server] Generated {outfile} in {elapsed}ms")

        res_body = f'{{"ok":true,"ms":{elapsed}}}'
        response = f"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(res_body)}\r\n\r\n{res_body}"
        writer.write(response.encode('utf-8'))
        await writer.drain()
    except Exception as e:
        print(f"[TTS Server] Error handling request: {e}")
        err_body = f'{{"error":"{str(e)}"}}'
        response = f"HTTP/1.1 500 Error\r\nContent-Type: application/json\r\nContent-Length: {len(err_body)}\r\n\r\n{err_body}"
        try:
            writer.write(response.encode('utf-8'))
            await writer.drain()
        except:
            pass
    finally:
        writer.close()

async def main():
    port = int(os.environ.get('TTS_PORT', 5006))
    server = await asyncio.start_server(handle_client, '127.0.0.1', port)
    print(f"TTS_READY_PORT={port}")
    sys.stdout.flush()
    async with server:
        await server.serve_forever()

if __name__ == '__main__':
    asyncio.run(main())
