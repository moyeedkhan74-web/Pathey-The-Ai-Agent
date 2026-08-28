const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateEdgeTTS(text, voice = 'en-IN-PrabhatNeural', rate = '+10%', pitch = '+5Hz') {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomBytes(16).toString('hex');
    const ws = new WebSocket(
      'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EA5D4FA899E07862204F2D9E',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
          'Origin': 'chrome-extension://jdiccldimpdaibmpobgmgff visualizer'
        }
      }
    );

    const audioBuffers = [];

    ws.on('open', () => {
      // 1. Send speech config
      const configMsg =
        `X-Timestamp:${new Date().toISOString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      
      ws.send(configMsg);

      // 2. Send SSML request
      const ssmlMsg =
        `X-RequestId:${requestId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `Path:ssml\r\n\r\n` +
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate}' pitch='${pitch}'>` +
        `${text}` +
        `</prosody></voice></speak>`;

      ws.send(ssmlMsg);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Audio frame header is separated by double newline or 'Path:audio\r\n'
        const str = data.toString('binary');
        const headerEnd = str.indexOf('Path:audio\r\n');
        if (headerEnd !== -1) {
          const bodyStart = str.indexOf('\r\n\r\n', headerEnd) + 4;
          if (bodyStart !== -1 && bodyStart < data.length) {
            audioBuffers.push(data.subarray(bodyStart));
          }
        }
      } else {
        const textMsg = data.toString();
        if (textMsg.includes('Path:turn.end')) {
          ws.close();
        }
      }
    });

    ws.on('close', () => {
      if (audioBuffers.length > 0) {
        resolve(Buffer.concat(audioBuffers));
      } else {
        reject(new Error('No audio received from Edge TTS'));
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

// Test script execution
const testText = "Hello! I am Pathey, your AI companion. My voice is now powered by Edge Neural Speech at 1.2x speed.";
const outFile = path.join(__dirname, 'test_voice.mp3');

generateEdgeTTS(testText, 'en-IN-PrabhatNeural', '+10%', '+5Hz')
  .then(audioBuf => {
    fs.writeFileSync(outFile, audioBuf);
    console.log(`SUCCESS! Generated ${audioBuf.length} bytes of human neural audio -> ${outFile}`);
    process.exit(0);
  })
  .catch(err => {
    console.error('Edge TTS Test Error:', err);
    process.exit(1);
  });
