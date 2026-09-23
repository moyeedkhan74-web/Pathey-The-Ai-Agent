// Proper JS tokenizer-based brace checker using V8's own error positions
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
const src = m[1];
const lines = src.split('\n');

// Try compiling progressively longer prefixes wrapped to auto-close N braces.
// The line where needed closers jump tells us where a brace was consumed wrongly.
let prevNeeded = null;
for (let end = 1; end <= lines.length; end++) {
  const chunk = lines.slice(0, end).join('\n');
  let needed = -1;
  for (let extra = 0; extra <= 60; extra++) {
    try {
      new Function(chunk + '\n' + '}'.repeat(extra));
      needed = extra;
      break;
    } catch (e) {
      if (e.message === 'Unexpected end of input') continue;
      // A hard error (like Unexpected token ')') means this prefix is bad regardless
      needed = -2;
      break;
    }
  }
  if (needed === -2) {
    console.log(`Hard error first appears at script line ${end}:`);
    for (let i = Math.max(1, end - 8); i <= Math.min(lines.length, end + 2); i++) {
      console.log(`${i}: ${lines[i - 1]}`);
    }
    process.exit(0);
  }
  prevNeeded = needed;
}
console.log('No hard error found in any prefix — file may have been fixed?');
