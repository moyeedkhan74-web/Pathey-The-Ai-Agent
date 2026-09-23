const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
scripts.forEach((s, i) => {
  try {
    new vm.Script(s[1], { filename: `inline-script-${i}.js` });
    console.log(`script ${i}: OK`);
  } catch (e) {
    console.log(`script ${i}: FAIL -> ${e.message}`);
    if (e.stack) {
      const lines = e.stack.split('\n').slice(0, 6);
      lines.forEach(l => console.log('   ' + l));
    }
  }
});
