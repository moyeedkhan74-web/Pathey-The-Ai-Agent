const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { extractRememberText, extractProjectLink, appendProjectLink, getMemoryFilePath, findProjectLink } = require('../memory');

test('extractRememberText parses remember instructions', () => {
  assert.equal(extractRememberText('remember that I like tea'), 'I like tea');
  assert.equal(extractRememberText('yaad rakh meri pasand chai hai'), 'meri pasand chai hai');
  assert.equal(extractRememberText('what is the weather today'), null);
});

test('extractProjectLink parses project repo links', () => {
  assert.deepEqual(extractProjectLink('remember my SilenX repo is https://github.com/yourusername/SilenX'), {
    projectName: 'SilenX',
    url: 'https://github.com/yourusername/SilenX'
  });
  assert.deepEqual(extractProjectLink('remember my Baqala link is https://example.com'), {
    projectName: 'Baqala',
    url: 'https://example.com'
  });
});

test('appendProjectLink updates an existing project entry instead of duplicating it', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathey-memory-'));
  const originalEnv = process.env.PATHEY_DATA_DIR;
  process.env.PATHEY_DATA_DIR = tempDir;
  const originalCwd = process.cwd();
  process.chdir(tempDir);

  try {
    const filePath = getMemoryFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Pathey Memory\n\nThings I know about you:\n\n## Projects\n- SilenX: https://old.example.com\n', 'utf8');

    appendProjectLink('SilenX', 'https://github.com/yourusername/SilenX');

    const content = fs.readFileSync(filePath, 'utf8');
    const matches = content.match(/- SilenX: /g) || [];
    assert.equal(matches.length, 1);
    assert.match(content, /- SilenX: https:\/\/github\.com\/yourusername\/SilenX/);
    assert.equal(findProjectLink('SilenX'), 'https://github.com/yourusername/SilenX');
  } finally {
    process.chdir(originalCwd);
    if (originalEnv === undefined) delete process.env.PATHEY_DATA_DIR; else process.env.PATHEY_DATA_DIR = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
