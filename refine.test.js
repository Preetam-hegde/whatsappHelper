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
assert.match(contentScript, /<textarea class="wa-ai-custom-input wa-ai-vague-input"/);
assert.match(contentScript, /aria-label="Text to rewrite or AI instruction"/);
assert.match(contentScript, /class="wa-ai-more-btn"/);
assert.match(contentScript, /class="wa-ai-controls"/);
assert.match(contentScript, /aria-expanded="false"/);
assert.match(contentScript, /class="wa-ai-more-label"/);
assert.doesNotMatch(contentScript, /renderQuickPillSuggestions\(response\.suggestions\)/);
assert.match(contentScript, /action: 'GENERATE_COMMAND'/);
assert.match(contentScript, /\/ai\\b/i);
assert.match(contentScript, /if \(!e\.shiftKey\)/);
assert.match(contentScript, /replace\(\/\^\\\/rewrite/);
assert.match(contentScript, /dispatchEvent\(new Event\('input'\)\)/);
assert.match(styles, /\.wa-ai-vague-input\s*\{/);
assert.match(styles, /\.wa-ai-bar\.wa-ai-expanded \.wa-ai-controls/);
assert.match(styles, /\.wa-ai-more-btn/);
assert.match(styles, /#wa-ai-floating-toolbar\.wa-ai-bar\s*\{[\s\S]*?width: fit-content;/);
assert.match(styles, /#wa-ai-floating-toolbar\.wa-ai-bar\.wa-ai-expanded\s*\{[\s\S]*?width: min\(620px, calc\(100% - 24px\)\);/);

console.log('refine prompt test passed');
