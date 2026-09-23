const fs = require('fs');
const path = require('path');

function validatePluginSchema(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('Plugin must export an object');
  }
  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new Error('Plugin must have a string "name" field');
  }
  if (!plugin.description || typeof plugin.description !== 'string') {
    throw new Error('Plugin must have a string "description" field');
  }
  if (!plugin.tools || typeof plugin.tools !== 'object') {
    throw new Error('Plugin must have a "tools" object');
  }
  const validRisks = new Set(['low', 'medium', 'high']);
  for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
    if (!toolDef.execute || typeof toolDef.execute !== 'function') {
      throw new Error(`Tool "${toolName}" must have an "execute" function`);
    }
    if (toolDef.risk && !validRisks.has(toolDef.risk)) {
      throw new Error(`Tool "${toolName}" has invalid risk level: ${toolDef.risk}`);
    }
  }
  return true;
}

function loadPlugins(pluginsDir = path.join(__dirname, '..', 'plugins')) {
  const loaded = [];
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    return loaded;
  }
  const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js') && !f.startsWith('.'));
  for (const file of files) {
    const filePath = path.join(pluginsDir, file);
    try {
      const plugin = require(filePath);
      validatePluginSchema(plugin);
      loaded.push({
        name: plugin.name,
        description: plugin.description,
        tools: plugin.tools,
        file: file
      });
      console.log(`[Plugins] Loaded plugin: ${plugin.name} (${Object.keys(plugin.tools).length} tools)`);
    } catch (err) {
      console.warn(`[Plugins] Failed to load ${file}:`, err.message);
    }
  }
  return loaded;
}

function getPluginToolsAsRegistry() {
  const plugins = loadPlugins();
  const registry = {};
  for (const plugin of plugins) {
    for (const [toolName, toolDef] of Object.entries(plugin.tools)) {
      registry[toolName] = {
        name: toolDef.name || toolName,
        description: toolDef.description || '',
        parameters: toolDef.parameters || {},
        risk: toolDef.risk || 'medium',
        execute: toolDef.execute
      };
    }
  }
  return registry;
}

module.exports = {
  loadPlugins,
  getPluginToolsAsRegistry,
  validatePluginSchema
};
