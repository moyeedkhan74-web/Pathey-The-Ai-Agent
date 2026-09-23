const { readFile, writeFile } = require('../tools/filesystem');
const { withTimeout } = require('../tools/safety');

const plugin = {
  name: 'Knowledge Search',
  description: 'Search through knowledge base files using FTS5-backed semantic search.',
  version: '1.0.0',
  tools: {
    knowledge_search: {
      name: 'knowledge_search',
      description: 'Search the knowledge base for relevant chunks. Args: { query: string, limit?: number }',
      parameters: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' }
      },
      risk: 'low',
      execute: async (args = {}) => {
        const query = args.query || '';
        const limit = args.limit || 5;
        if (!query) return 'No query provided.';
        const { searchKnowledgeChunks } = require('../memory');
        const results = await searchKnowledgeChunks(query, limit);
        if (!results || results.length === 0) return 'No results found.';
        return JSON.stringify(results, null, 2);
      }
    },
    knowledge_add: {
      name: 'knowledge_add',
      description: 'Add a note to the knowledge base. Args: { title: string, content: string }',
      parameters: {
        title: { type: 'string', description: 'Note title' },
        content: { type: 'string', description: 'Note content' }
      },
      risk: 'low',
      execute: async (args = {}) => {
        const title = args.title || 'Untitled';
        const content = args.content || '';
        const { addKnowledgeNote } = require('../memory');
        await addKnowledgeNote(title, content);
        return `Added knowledge note: ${title}`;
      }
    }
  }
};

module.exports = plugin;
