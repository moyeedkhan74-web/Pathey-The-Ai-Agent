// mcp.js — Model Context Protocol Client for Pathey
// Supports stdio and SSE transport for standard MCP servers

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MCP_CONFIG_FILE = path.join(os.homedir(), '.pathey', 'mcp_servers.json');
const MCP_BASE_DIR = path.join(os.homedir(), '.pathey', 'mcp');

function ensureMcpDirs() {
  try {
    fs.mkdirSync(MCP_BASE_DIR, { recursive: true });
    const configDir = path.dirname(MCP_CONFIG_FILE);
    fs.mkdirSync(configDir, { recursive: true });
  } catch (_) {}
}

function loadMcpConfig() {
  ensureMcpDirs();
  try {
    if (fs.existsSync(MCP_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, 'utf8'));
    }
  } catch (_) {}
  return { servers: [] };
}

function saveMcpConfig(config) {
  ensureMcpDirs();
  try {
    fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.warn('[MCP] Failed to save config:', err.message);
  }
}

class McpClient {
  constructor(serverConfig) {
    this.config = serverConfig;
    this.transport = serverConfig.transport || 'stdio';
    this.process = null;
    this.sseConnection = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.tools = [];
    this.connected = false;
    this.connecting = false;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
  }

  async connect() {
    if (this.connected || this.connecting) return { ok: true };
    this.connecting = true;

    try {
      if (this.transport === 'stdio') {
        await this.connectStdio();
      } else if (this.transport === 'sse') {
        await this.connectSse();
      } else {
        throw new Error(`Unknown transport: ${this.transport}`);
      }

      // Initialize MCP session
      const initResult = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'pathey', version: '1.0.0' }
      });

      // List available tools
      const toolsResult = await this.sendRequest('tools/list', {});
      this.tools = toolsResult.tools || [];
      this.connected = true;
      this.connecting = false;
      console.log(`[MCP] Connected to ${this.config.name} with ${this.tools.length} tools`);
      return { ok: true, tools: this.tools };
    } catch (err) {
      this.connecting = false;
      console.error(`[MCP] Connection failed for ${this.config.name}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  async connectStdio() {
    const { command, args = [], env = {}, cwd } = this.config;
    const resolvedCwd = cwd || MCP_BASE_DIR;

    this.process = spawn(command, args, {
      cwd: resolvedCwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stdout.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      this.processStdoutBuffer();
    });

    this.process.stderr.on('data', (data) => {
      this.stderrBuffer += data.toString();
      console.log(`[MCP:${this.config.name}] stderr:`, data.toString().trim());
    });

    this.process.on('exit', (code) => {
      console.log(`[MCP:${this.config.name}] Process exited with code ${code}`);
      this.connected = false;
      this.process = null;
    });

    this.process.on('error', (err) => {
      console.error(`[MCP:${this.config.name}] Process error:`, err.message);
      this.connected = false;
    });

    // Wait for process to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Stdio connection timeout')), 10000);
      const checkReady = () => {
        if (this.process && !this.process.killed) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    });
  }

  processStdoutBuffer() {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch (_) {
        // Ignore non-JSON lines
      }
    }
  }

  async connectSse() {
    const { url, headers = {} } = this.config;
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;
      const req = client.request(url, { method: 'GET', headers: { ...headers, 'Accept': 'text/event-stream' } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE connection failed: ${res.statusCode}`));
          return;
        }
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk;
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const event of events) {
            this.parseSseEvent(event);
          }
        });
        res.on('end', () => {
          this.connected = false;
        });
      });
      req.on('error', (err) => reject(err));
      req.end();

      // Wait for connection
      const timeout = setTimeout(() => reject(new Error('SSE connection timeout')), 10000);
      const checkReady = () => {
        if (this.sseConnection) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkReady, 50);
        }
      };
      checkReady();
    });
  }

  parseSseEvent(event) {
    const lines = event.split('\n');
    let data = '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        data += line.slice(5).trim() + '\n';
      }
    }
    if (data.trim()) {
      try {
        const msg = JSON.parse(data.trim());
        this.handleMessage(msg);
      } catch (_) {}
    }
  }

  handleMessage(msg) {
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id);
      this.pendingRequests.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'notifications/tools/list_changed') {
      // Tools list changed, could refresh
      console.log(`[MCP:${this.config.name}] Tools list changed notification`);
    }
  }

  sendRequest(method, params) {
    if (!this.connected && this.transport === 'stdio') {
      return Promise.reject(new Error('Not connected'));
    }
    const id = ++this.requestId;
    const request = { jsonrpc: '2.0', id, method, params };
    const payload = JSON.stringify(request) + '\n';

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP request timeout'));
        }
      }, 30000);

      const originalResolve = resolve;
      const originalReject = reject;
      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timeout); originalResolve(val); },
        reject: (err) => { clearTimeout(timeout); originalReject(err); }
      });

      if (this.transport === 'stdio' && this.process) {
        this.process.stdin.write(payload, (err) => {
          if (err) {
            this.pendingRequests.delete(id);
            reject(err);
          }
        });
      } else if (this.transport === 'sse' && this.sseConnection) {
        // For SSE, we'd POST to an endpoint
        this.postSseRequest(payload).then(originalResolve).catch(originalReject);
      }
    });
  }

  async postSseRequest(payload) {
    // SSE typically uses a separate POST endpoint for requests
    const { url, headers = {} } = this.config;
    const requestUrl = url.replace(/\/sse\/?$/, '/message');
    return new Promise((resolve, reject) => {
      const client = requestUrl.startsWith('https:') ? https : http;
      const req = client.request(requestUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid SSE response')); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async disconnect() {
    this.connected = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    if (this.sseConnection) {
      this.sseConnection.destroy();
      this.sseConnection = null;
    }
    this.pendingRequests.clear();
    this.tools = [];
  }

  getTools() {
    return this.tools.map(t => ({
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || {},
      risk: 'medium',
      execute: async (args) => {
        const result = await this.sendRequest('tools/call', { name: t.name, arguments: args });
        return result.content?.[0]?.text || JSON.stringify(result);
      }
    }));
  }

  getStatus() {
    return {
      name: this.config.name,
      transport: this.transport,
      connected: this.connected,
      connecting: this.connecting,
      toolsCount: this.tools.length
    };
  }
}

// Global MCP client instances
const mcpClients = new Map();

async function connectMcpServer(serverConfig) {
  if (mcpClients.has(serverConfig.name)) {
    return { ok: false, error: 'Server already connected' };
  }
  const client = new McpClient(serverConfig);
  mcpClients.set(serverConfig.name, client);
  const result = await client.connect();
  if (result.ok) {
    // Register tools with main registry
    const { registerPluginTools } = require('./tools/registry');
    const tools = client.getTools();
    registerPluginTools(Object.fromEntries(tools.map(t => [t.name, t])));
  }
  return result;
}

async function disconnectMcpServer(name) {
  const client = mcpClients.get(name);
  if (!client) return { ok: false, error: 'Server not found' };
  await client.disconnect();
  // Unregister tools
  const { unregisterPluginTools } = require('./tools/registry');
  unregisterPluginTools(Object.fromEntries(client.getTools().map(t => [t.name, t])));
  mcpClients.delete(name);
  return { ok: true };
}

function getMcpServers() {
  const config = loadMcpConfig();
  return config.servers.map(s => ({
    ...s,
    status: mcpClients.has(s.name) ? mcpClients.get(s.name).getStatus() : { ...s, connected: false }
  }));
}

function getMcpStatus() {
  const servers = [];
  for (const [name, client] of mcpClients) {
    servers.push(client.getStatus());
  }
  return { connected: servers.filter(s => s.connected).length, total: servers.length, servers };
}

function addMcpServer(serverConfig) {
  const config = loadMcpConfig();
  if (config.servers.some(s => s.name === serverConfig.name)) {
    return { ok: false, error: 'Server name already exists' };
  }
  config.servers.push(serverConfig);
  saveMcpConfig(config);
  return { ok: true };
}

function removeMcpServer(name) {
  const config = loadMcpConfig();
  config.servers = config.servers.filter(s => s.name !== name);
  saveMcpConfig(config);
  return { ok: true };
}

async function initializeMcpServers() {
  const config = loadMcpConfig();
  for (const server of config.servers) {
    if (server.enabled !== false) {
      await connectMcpServer(server);
    }
  }
}

module.exports = {
  connectMcpServer,
  disconnectMcpServer,
  getMcpServers,
  getMcpStatus,
  addMcpServer,
  removeMcpServer,
  initializeMcpServers,
  McpClient
};