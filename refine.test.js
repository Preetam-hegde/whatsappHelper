const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const prompts = fs.readFileSync(__dirname + '/prompts.js', 'utf8');
const context = {};
vm.runInNewContext(`${prompts}\nthis.buildRefinementPrompt = buildRefinementPrompt;`, context);

const prompt = context.buildRefinementPrompt('please send the report tomorrow');

assert.match(prompt, /please send the report tomorrow/);
assert.doesNotMatch(prompt, /conversation history|ACTIVE UNANSWERED THREAD|Person Study/i);
assert.match(prompt, /Return only the refined text/i);

console.log('refine prompt test passed');
