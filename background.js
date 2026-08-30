// background.js - Service worker for WhatsApp Web AI Assistant

importScripts('prompts.js');

const DEFAULT_MODEL = 'gemini-3.6-flash';
const FALLBACK_MODELS = [
  'qwen/qwen3.7-flash',
  'meta-llama/llama-3.3-70b-instruct',
  'openai/gpt-4o-mini'
];

const GOOGLE_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

function isGoogleStudioKey(key) {
  if (!key) return false;
  const k = key.trim();
  return k.startsWith('AQ') || k.startsWith('AIza');
}

function isOllamaProvider(provider) {
  return provider === 'ollama';
}

function parseWriteCommand(rawCommand) {
  const match = typeof rawCommand === 'string' && rawCommand.trim().match(/^\/(sorry|poem|story|write)\s+(.+)/i);
  if (!match) return null;

  const kind = match[1].toLowerCase();
  return {
    kind,
    request: match[2].trim(),
    title: { sorry: 'Sorry message', poem: 'Poem', story: 'Story', write: 'Message' }[kind]
  };
}

function getModelsToTry(apiKey, rawModel) {
  if (isGoogleStudioKey(apiKey)) {
    let model = rawModel;
    if (model.startsWith('google/')) model = model.replace('google/', '');
    if (model.includes('/')) model = 'gemini-3.6-flash';
    return [model, ...GOOGLE_FALLBACK_MODELS.filter(candidate => candidate !== model)];
  }
  return [rawModel, ...FALLBACK_MODELS.filter(candidate => candidate !== rawModel)];
}

async function callOpenRouter(apiKey, model, systemPrompt, userPrompt, temperature, maxTokens) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://web.whatsapp.com',
      'X-Title': 'WhatsApp Web AI Assistant'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    let message = errorText;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.error?.message || parsed.message || errorText;
    } catch (_) {}
    throw new Error(`[${model}] API Error (${response.status}): ${message}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(`[${model}] API Error: ${data.error.message || JSON.stringify(data.error)}`);
  const choice = data.choices?.[0];
  return choice?.message?.content || choice?.text || '';
}

async function callOllama(model, systemPrompt, userPrompt, temperature) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model || 'qwen3',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: userPrompt }
      ],
      stream: false,
      options: { temperature }
    })
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const data = await response.json();
  return data.message?.content || '';
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GENERATE_REPLY' || request.action === 'GENERATE_SUGGESTIONS') {
    handleGenerateSuggestions(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message || 'Unknown error occurred' }));
    return true; // Keep message channel open for async response
  }

  if (request.action === 'REFINE_TEXT') {
    handleRefineText(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message || 'Text refinement failed' }));
    return true;
  }

  if (request.action === 'GENERATE_COMMAND') {
    handleGenerateCommand(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message || 'Message generation failed' }));
    return true;
  }

  if (request.action === 'ANALYZE_PERSON_STUDY') {
    handleAnalyzePersonStudy(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message || 'Person study analysis failed' }));
    return true;
  }

  if (request.action === 'VALIDATE_KEY') {
    handleValidateKey(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ valid: false, error: error.message || 'Validation failed' }));
    return true;
  }
});

async function handleRefineText(data) {
  const sourceText = typeof data?.text === 'string' ? data.text.trim() : '';
  if (!sourceText) return { success: false, error: 'Enter some text to refine first.' };

  const storage = await chrome.storage.local.get(['openrouterApiKey', 'openrouterModel', 'provider', 'ollamaModel']);
  const apiKey = storage.openrouterApiKey?.trim();
  const provider = storage.provider || 'auto';
  const rawModel = provider === 'ollama' ? (storage.ollamaModel?.trim() || 'qwen3') : (storage.openrouterModel?.trim() || DEFAULT_MODEL);

  if (!apiKey && !isOllamaProvider(provider)) {
    return { success: false, error: 'API Key is missing. Click the extension icon in Chrome toolbar to set your key.' };
  }

  const prompt = buildRefinementPrompt(sourceText);
  const isGoogle = !isOllamaProvider(provider) && isGoogleStudioKey(apiKey);
  const model = isGoogle && rawModel.includes('/') ? 'gemini-3.6-flash' : rawModel.replace(/^google\//, '');
  let refinedText = '';

  refinedText = isOllamaProvider(provider)
    ? await callOllama(model, 'You refine text only. Return only the refined text.', prompt, 0.4)
    : isGoogle
    ? await callGoogleAIStudio(apiKey, model, 'You refine text only. Return only the refined text.', prompt)
    : await callOpenRouter(apiKey, model, 'You refine text only. Return only the refined text.', prompt, 0.4, 300);

  refinedText = typeof refinedText === 'string' ? refinedText.replace(/^```(?:text)?\s*|\s*```$/gi, '').trim() : '';
  return refinedText ? { success: true, refinedText, modelUsed: model } : { success: false, error: 'The model returned no refined text.' };
}

async function handleGenerateCommand(data) {
  const command = parseWriteCommand(data?.command);
  if (!command) return { success: false, error: 'Use /sorry, /poem, /story, or /write followed by what you need.' };

  const storage = await chrome.storage.local.get(['openrouterApiKey', 'openrouterModel', 'provider', 'ollamaModel']);
  const apiKey = storage.openrouterApiKey?.trim();
  const provider = storage.provider || 'auto';
  const rawModel = provider === 'ollama' ? (storage.ollamaModel?.trim() || 'qwen3') : (storage.openrouterModel?.trim() || DEFAULT_MODEL);
  if (!apiKey && !isOllamaProvider(provider)) {
    return { success: false, error: 'API Key is missing. Click the extension icon in Chrome toolbar to set your key.' };
  }

  const instructions = {
    sorry: 'Write one sincere, concise WhatsApp apology.',
    poem: 'Write one short, warm poem suitable to paste into WhatsApp.',
    story: 'Write one short, engaging story suitable to send in WhatsApp.',
    write: 'Write one concise, natural WhatsApp-ready message.'
  };
  const systemPrompt = `${instructions[command.kind]} Return only the requested text, with no title, explanation, or markdown fence.`;
  const userPrompt = `Request: ${command.request}`;
  const isGoogle = !isOllamaProvider(provider) && isGoogleStudioKey(apiKey);
  const model = isGoogle && rawModel.includes('/') ? 'gemini-3.6-flash' : rawModel.replace(/^google\//, '');

  let text = isOllamaProvider(provider)
    ? await callOllama(model, systemPrompt, userPrompt, 0.75)
    : isGoogle
    ? await callGoogleAIStudio(apiKey, model, systemPrompt, userPrompt, 'text/plain')
    : await callOpenRouter(apiKey, model, systemPrompt, userPrompt, 0.75, 500);

  text = typeof text === 'string' ? text.replace(/^```(?:text|markdown)?\s*|\s*```$/gi, '').trim() : '';
  return text ? { success: true, text, title: command.title, modelUsed: model } : { success: false, error: 'The model returned no text.' };
}

/**
 * Generates humanized WhatsApp reply suggestions
 */
async function handleGenerateSuggestions(data) {
  const {
    context,
    userWritingSamples,
    isLastMessageFromMe,
    lastMessageTime,
    currentTime,
    contactName = 'Contact',
    personStudy = null,
    tone = null,
    intent = null,
    customPrompt = '',
    overrideModel
  } = data;

  const storage = await chrome.storage.local.get([
    'openrouterApiKey',
    'openrouterModel',
    'provider',
    'ollamaModel',
    'systemPrompt'
  ]);

  const apiKey = storage.openrouterApiKey?.trim();
  const provider = storage.provider || 'auto';
  let rawModel = provider === 'ollama' ? (overrideModel || storage.ollamaModel?.trim() || 'qwen3') : (overrideModel || storage.openrouterModel?.trim() || DEFAULT_MODEL);

  if (!apiKey && !isOllamaProvider(provider)) {
    return {
      success: false,
      error: 'API Key is missing. Click the extension icon in Chrome toolbar to set your OpenRouter or Google AI Studio key.'
    };
  }

  const isGoogle = !isOllamaProvider(provider) && isGoogleStudioKey(apiKey);
  const modelsToTry = isOllamaProvider(provider) ? [rawModel] : getModelsToTry(apiKey, rawModel);

  // Analyze writing style into a structured fingerprint
  const writingStyleBlock = analyzeWritingStyle(userWritingSamples);
  const isFollowUp = !!isLastMessageFromMe;

  // Separate Active Unanswered Thread from Background Context
  let activeMessages = [];
  let backgroundMessages = [];

  if (Array.isArray(context) && context.length > 0) {
    if (isFollowUp) {
      // User sent last message: active thread is user's last message(s)
      let splitIdx = context.length - 1;
      while (splitIdx > 0 && context[splitIdx - 1].isOutgoing) {
        splitIdx--;
      }
      backgroundMessages = context.slice(0, splitIdx);
      activeMessages = context.slice(splitIdx);
    } else {
      // Contact sent last message: active thread is all recent unreplied messages from contact
      let splitIdx = context.length - 1;
      while (splitIdx > 0 && !context[splitIdx - 1].isOutgoing) {
        splitIdx--;
      }
      backgroundMessages = context.slice(0, splitIdx);
      activeMessages = context.slice(splitIdx);
    }
  }

  const activeThreadText = activeMessages.map((m, i) => {
    const sender = m.isOutgoing ? 'Me' : (m.sender || contactName);
    const timeStr = m.time ? ` [${m.time}]` : '';
    return `${i + 1}. ${sender}${timeStr}: "${m.text}"`;
  }).join('\n');

  const backgroundContextText = backgroundMessages.map((m, i) => {
    const sender = m.isOutgoing ? 'Me' : (m.sender || contactName);
    const timeStr = m.time ? ` [${m.time}]` : '';
    return `${i + 1}. ${sender}${timeStr}: "${m.text}"`;
  }).join('\n');

  // Build person study block if available
  let personStudyBlock = '';
  if (personStudy) {
    personStudyBlock = `• Relationship: ${personStudy.relationship || 'Unspecified'}
• Communication Profile: ${personStudy.contactProfile || 'Natural'}
• Current Sentiment & Expectation: ${personStudy.currentMoodIntent || 'Awaiting natural response'}
• Key Advice: ${personStudy.quickReplyAdvice || 'Reply naturally and promptly'}`;
  }

  const systemPrompt = buildSystemPrompt({
    currentTime,
    lastMessageTime,
    isFollowUp,
    contactName,
    tone,
    intent
  });

  const userPrompt = buildUserPrompt({
    writingStyleBlock,
    personStudyBlock,
    contactName,
    activeThreadText,
    backgroundContextText,
    currentTime,
    lastMessageTime,
    isFollowUp,
    customPrompt,
    intent
  });

  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      console.log(`[WhatsApp AI] Generating replies with model: ${currentModel} (GoogleKey: ${isGoogle})`);
      let rawContent = '';

      if (isOllamaProvider(provider)) {
        rawContent = await callOllama(currentModel, systemPrompt, userPrompt, 0.75);
      } else if (isGoogle) {
        rawContent = await callGoogleAIStudio(apiKey, currentModel, systemPrompt, userPrompt);
      } else {
        rawContent = await callOpenRouter(apiKey, currentModel, systemPrompt, userPrompt, 0.75, 700);
      }

      if (Array.isArray(rawContent)) {
        rawContent = rawContent.map(part => typeof part === 'string' ? part : part.text || '').join('\n');
      }

      rawContent = (typeof rawContent === 'string') ? rawContent.trim() : '';
      rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      const parsedSuggestions = parseCleanJSON(rawContent);

      if (!parsedSuggestions) {
        console.warn(`[WhatsApp AI] Model ${currentModel} returned invalid JSON. Trying fallback...`);
        throw new Error(`Model ${currentModel} did not return valid JSON.`);
      }

      return {
        success: true,
        suggestions: parsedSuggestions,
        modelUsed: currentModel,
        isFollowUp,
        activeCount: activeMessages.length,
        contactName
      };

    } catch (err) {
      console.warn(`[WhatsApp AI] Model ${currentModel} failed:`, err.message);
      lastError = err;
    }
  }

  return {
    success: false,
    error: lastError ? lastError.message : 'All model attempts failed. Please check your API Key.'
  };
}

/**
 * Analyzes contact persona, relationship dynamic & generates Person Study (Beta)
 */
async function handleAnalyzePersonStudy(data) {
  const { context, contactName = 'Contact', overrideModel } = data;

  const storage = await chrome.storage.local.get([
    'openrouterApiKey',
    'openrouterModel',
    'provider',
    'ollamaModel'
  ]);

  const apiKey = storage.openrouterApiKey?.trim();
  const provider = storage.provider || 'auto';
  let rawModel = provider === 'ollama' ? (overrideModel || storage.ollamaModel?.trim() || 'qwen3') : (overrideModel || storage.openrouterModel?.trim() || DEFAULT_MODEL);

  if (!apiKey && !isOllamaProvider(provider)) {
    return {
      success: false,
      error: 'API Key is missing. Please set your key in the extension settings.'
    };
  }

  const isGoogle = !isOllamaProvider(provider) && isGoogleStudioKey(apiKey);
  const modelsToTry = isOllamaProvider(provider) ? [rawModel] : getModelsToTry(apiKey, rawModel);

  const fullContextText = (Array.isArray(context) && context.length > 0)
    ? context.map((m, i) => `${i + 1}. ${m.isOutgoing ? 'Me' : (m.sender || contactName)}${m.time ? ' [' + m.time + ']' : ''}: "${m.text}"`).join('\n')
    : 'No recent messages.';

  const systemPrompt = buildPersonStudySystemPrompt();
  const userPrompt = buildPersonStudyUserPrompt({ contactName, fullContextText });

  let lastError = null;

  for (const currentModel of modelsToTry) {
    try {
      console.log(`[WhatsApp AI] Analyzing Person Study with model: ${currentModel}`);
      let rawContent = '';

      if (isOllamaProvider(provider)) {
        rawContent = await callOllama(currentModel, systemPrompt, userPrompt, 0.6);
      } else if (isGoogle) {
        rawContent = await callGoogleAIStudio(apiKey, currentModel, systemPrompt, userPrompt);
      } else {
        rawContent = await callOpenRouter(apiKey, currentModel, systemPrompt, userPrompt, 0.6, 800);
      }

      if (Array.isArray(rawContent)) {
        rawContent = rawContent.map(p => typeof p === 'string' ? p : p.text || '').join('\n');
      }

      rawContent = (typeof rawContent === 'string') ? rawContent.trim() : '';
      rawContent = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      const parsedStudy = parseStudyJSON(rawContent);

      if (!parsedStudy) {
        throw new Error(`Failed to parse Person Study JSON from model ${currentModel}`);
      }

      return {
        success: true,
        personStudy: parsedStudy,
        contactName,
        modelUsed: currentModel
      };

    } catch (err) {
      console.warn(`[WhatsApp AI] Person Study attempt with ${currentModel} failed:`, err.message);
      lastError = err;
    }
  }

  return {
    success: false,
    error: lastError ? lastError.message : 'Person study analysis failed.'
  };
}

/**
 * Bulletproof JSON parser for multi-tone suggestions
 */
function parseCleanJSON(text) {
  if (!text) return null;

  const firstIdx = text.indexOf('{');
  const lastIdx = text.lastIndexOf('}');

  if (firstIdx !== -1 && lastIdx > firstIdx) {
    const jsonSub = text.substring(firstIdx, lastIdx + 1);
    try {
      const obj = JSON.parse(jsonSub);
      if (obj && (obj.casual || obj.friendly || obj.direct || obj.witty || obj.quick_ack)) {
        return normalizeTones(obj);
      }
    } catch (e) {
      try {
        const sanitized = jsonSub.replace(/[\r\n]+/g, ' ');
        const obj = JSON.parse(sanitized);
        if (obj && (obj.casual || obj.friendly || obj.direct || obj.witty || obj.quick_ack)) {
          return normalizeTones(obj);
        }
      } catch (e2) {}
    }
  }

  // Regex fallback matching keys specifically
  const tones = ['casual', 'friendly', 'witty', 'funny', 'direct', 'polite', 'professional', 'hinglish', 'quick_ack'];
  const result = {};
  let found = 0;

  tones.forEach(t => {
    const reg = new RegExp(`"${t}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i');
    const match = text.match(reg);
    if (match && match[1]) {
      try {
        result[t] = JSON.parse(`"${match[1]}"`).trim();
      } catch (e) {
        result[t] = match[1].trim();
      }
      found++;
    }
  });

  if (found >= 2) {
    return normalizeTones(result);
  }

  return null;
}

function normalizeTones(obj) {
  return {
    casual: obj.casual || obj.friendly || '',
    witty: obj.witty || obj.funny || '',
    direct: obj.direct || '',
    polite: obj.polite || obj.professional || '',
    hinglish: obj.hinglish || '',
    quick_ack: obj.quick_ack || ''
  };
}

/**
 * JSON parser for Person Study object
 */
function parseStudyJSON(text) {
  if (!text) return null;
  const firstIdx = text.indexOf('{');
  const lastIdx = text.lastIndexOf('}');

  if (firstIdx !== -1 && lastIdx > firstIdx) {
    const jsonSub = text.substring(firstIdx, lastIdx + 1);
    try {
      const obj = JSON.parse(jsonSub);
      if (obj && (obj.relationship || obj.contactProfile || obj.quickReplyAdvice)) {
        return obj;
      }
    } catch (e) {
      try {
        const sanitized = jsonSub.replace(/[\r\n]+/g, ' ');
        const obj = JSON.parse(sanitized);
        if (obj && (obj.relationship || obj.contactProfile || obj.quickReplyAdvice)) {
          return obj;
        }
      } catch (e2) {}
    }
  }
  return null;
}

/**
 * Sends API requests directly to Google AI Studio v1beta API endpoints.
 */
async function callGoogleAIStudio(apiKey, model, systemPrompt, userPrompt, responseMimeType = 'application/json') {
  let cleanModel = model;
  if (cleanModel.startsWith('google/')) cleanModel = cleanModel.replace('google/', '');

  // Attempt 1: OpenAI-compatible Google API endpoint
  const openAiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  try {
    const res = await fetch(openAiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: cleanModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.75,
        max_tokens: 800
      })
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
      if (content) return content;
    }
  } catch (e) {
    console.warn(`[Google AI Studio] OpenAI compat endpoint failed for ${cleanModel}:`, e.message);
  }

  // Attempt 2: Native Google Gemini v1beta REST API
  const nativeUrl = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;
  const nativeRes = await fetch(nativeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.75, responseMimeType }
    })
  });

  if (!nativeRes.ok) {
    const errText = await nativeRes.text();
    let parsedErr = errText;
    try {
      const json = JSON.parse(errText);
      parsedErr = json.error?.message || errText;
    } catch (e) {}
    throw new Error(`[${cleanModel}] Google API Error (${nativeRes.status}): ${parsedErr}`);
  }

  const nativeData = await nativeRes.json();
  const rawText = nativeData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error(`[${cleanModel}] Google API returned empty content.`);
  return rawText;
}

async function handleValidateKey(data) {
  const { apiKey, modelName, provider = 'auto', ollamaModel = 'qwen3' } = data;
  if (!apiKey && !isOllamaProvider(provider)) {
    return { valid: false, error: 'API key cannot be empty.' };
  }

  const isGoogle = !isOllamaProvider(provider) && isGoogleStudioKey(apiKey);
  let testModel = isOllamaProvider(provider) ? ollamaModel : (modelName || (isGoogle ? 'gemini-3.6-flash' : DEFAULT_MODEL));
  if (isGoogle && testModel.startsWith('google/')) testModel = testModel.replace('google/', '');

  try {
    if (isOllamaProvider(provider)) {
      const res = await callOllama(testModel, '', 'Hi', 0);
      return res ? { valid: true } : { valid: false, error: 'Empty response from Ollama' };
    } else if (isGoogle) {
      const res = await callGoogleAIStudio(apiKey, testModel, 'Respond Hi', 'Hi');
      if (res) return { valid: true };
      return { valid: false, error: 'Empty response from Google API' };
    } else {
      await callOpenRouter(apiKey, testModel, '', 'Hi', 0, 5);
      return { valid: true };
    }
  } catch (err) {
    return { valid: false, error: err.message || 'Connection test failed.' };
  }
}
