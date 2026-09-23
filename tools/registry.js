const { listDirectory, readFile, writeFile, gitStatus } = require('./filesystem');
const { runCommand } = require('./shell');
const { openUrl, openApp } = require('./browser');
const { withTimeout, requiresConfirmation } = require('./safety');
const { logActivity } = require('../memory');

const TOOLS = {
  list_directory: {
    name: 'list_directory',
    description: 'List files and directories at a given path. Args: { path: string }',
    parameters: { path: { type: 'string', description: 'Directory path to list' } },
    risk: 'low',
    execute: (args = {}) => withTimeout(listDirectory(args), 10000)
  },
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file. Args: { path: string }',
    parameters: { path: { type: 'string', description: 'File path to read' } },
    risk: 'low',
    execute: (args = {}) => withTimeout(readFile(args), 10000)
  },
  git_status: {
    name: 'git_status',
    description: 'Get git status for a repository. Args: { path: string }',
    parameters: { path: { type: 'string', description: 'Repository path' } },
    risk: 'low',
    execute: (args = {}) => withTimeout(gitStatus(args), 10000)
  },
  run_command: {
    name: 'run_command',
    description: 'Run a shell command. Args: { cmd: string }',
    parameters: { cmd: { type: 'string', description: 'Command to execute' } },
    risk: 'high',
    execute: (args = {}) => withTimeout(runCommand(args), 10000)
  },
  write_file: {
    name: 'write_file',
    description: 'Write content to a file. Args: { path: string, content: string }',
    parameters: { path: { type: 'string', description: 'File path' }, content: { type: 'string', description: 'File content' } },
    risk: 'high',
    execute: (args = {}) => withTimeout(writeFile(args), 10000)
  },
  open_url: {
    name: 'open_url',
    description: 'Open a URL in the browser. Args: { url: string, browser?: string, clipboard?: string, searchQuery?: string, channelFilter?: string }',
    parameters: {
      url: { type: 'string', description: 'URL to open' },
      browser: { type: 'string', description: 'Optional browser name (chrome, firefox, msedge, brave, opera)' },
      clipboard: { type: 'string', description: 'Optional text to set clipboard before opening' },
      searchQuery: { type: 'string', description: 'Search query for YouTube/search engines' },
      channelFilter: { type: 'string', description: 'YouTube channel filter (use quoted channel name)' }
    },
    risk: 'medium',
    execute: (args = {}) => withTimeout(openUrl(args), 10000)
  },
  open_app: {
    name: 'open_app',
    description: 'Open a Windows application. Args: { name: string }',
    parameters: { name: { type: 'string', description: 'App executable name (e.g., notepad.exe, calc.exe)' } },
    risk: 'medium',
    execute: (args = {}) => withTimeout(openApp(args), 10000)
  }
};

function getToolSchema(toolName) {
  const tool = TOOLS[toolName];
  if (!tool) return null;
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    risk: tool.risk
  };
}

function getAllToolSchemas() {
  const schemas = {};
  for (const [key, tool] of Object.entries(TOOLS)) {
    schemas[key] = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      risk: tool.risk
    };
  }
  return schemas;
}

function getAvailableToolsList() {
  return Object.keys(TOOLS);
}

async function executeTool(toolName, args = {}) {
  const tool = TOOLS[toolName];
  if (!tool) {
    return `Unknown tool: ${toolName}`;
  }
  logActivity('execute_tool', { tool: toolName, args });
  return tool.execute(args);
}

function registerPluginTools(pluginTools) {
  for (const [name, def] of Object.entries(pluginTools)) {
    if (TOOLS[name]) {
      console.warn(`[Tools] Plugin tool "${name}" conflicts with built-in tool, skipping.`);
      continue;
    }
    TOOLS[name] = {
      name: def.name || name,
      description: def.description || '',
      parameters: def.parameters || {},
      risk: def.risk || 'medium',
      execute: (args = {}) => withTimeout(def.execute(args), 10000)
    };
  }
}

function isDangerous(toolName) {
  const tool = TOOLS[toolName];
  return tool ? requiresConfirmation(tool.name) : true;
}

module.exports = {
  TOOLS,
  getToolSchema,
  getAllToolSchemas,
  getAvailableToolsList,
  executeTool,
  registerPluginTools,
  isDangerous
};
