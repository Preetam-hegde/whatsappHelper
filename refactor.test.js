const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync(__dirname + '/background.js', 'utf8');
const context = {
  importScripts() {},
  chrome: { runtime: { onMessage: { addListener() {} } } },
  console,
  fetch() { throw new Error('network should not be called'); }
};
vm.runInNewContext(source, context);

assert.strictEqual(JSON.stringify(context.getModelsToTry('sk-test', 'qwen/qwen3.7-flash')), JSON.stringify([
  'qwen/qwen3.7-flash', 'meta-llama/llama-3.3-70b-instruct', 'openai/gpt-4o-mini'
]));
assert.strictEqual(JSON.stringify(context.getModelsToTry('AIza-test', 'google/gemini-3.5-flash')), JSON.stringify([
  'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.1-pro-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'
]));
assert.strictEqual(context.isOllamaProvider('ollama'), true);
assert.strictEqual(context.isOllamaProvider('openrouter'), false);

console.log('refactor helper test passed');
