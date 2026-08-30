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
const styles = fs.readFileSync(__dirname + '/styles.css', 'utf8');
assert.match(contentScript, /insertTextIntoInput\(response\.refinedText, true\)/);
assert.match(contentScript, /aria-label="Optional text to refine"/);
assert.match(contentScript, /class="wa-ai-more-btn"/);
assert.match(contentScript, /class="wa-ai-controls"/);
assert.match(contentScript, /aria-expanded="false"/);
assert.match(contentScript, /class="wa-ai-more-label"/);
assert.doesNotMatch(contentScript, /renderQuickPillSuggestions\(response\.suggestions\)/);
assert.match(contentScript, /action: 'GENERATE_COMMAND'/);
assert.match(contentScript, /\/\(sorry\|poem\|story\|write\)\\b/i);
assert.match(styles, /\.wa-ai-bar\.wa-ai-expanded \.wa-ai-controls/);
assert.match(styles, /\.wa-ai-more-btn/);
assert.match(styles, /#wa-ai-floating-toolbar\.wa-ai-bar\s*\{[\s\S]*?width: fit-content;/);
assert.match(styles, /#wa-ai-floating-toolbar\.wa-ai-bar\.wa-ai-expanded\s*\{[\s\S]*?width: min\(620px, calc\(100% - 24px\)\);/);

console.log('refine prompt test passed');
