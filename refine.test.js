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

const contentScript = fs.readFileSync(__dirname + '/content_script.js', 'utf8');
assert.match(contentScript, /insertTextIntoInput\(response\.refinedText, true\)/);
assert.match(contentScript, /aria-label="Optional text to refine"/);

console.log('refine prompt test passed');
