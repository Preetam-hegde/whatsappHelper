// popup.js - Extension Settings Logic

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const providerSelect = document.getElementById('provider');
  const ollamaModelGroup = document.getElementById('ollama-model-group');
  const ollamaModelInput = document.getElementById('ollama-model');
  const toggleKeyBtn = document.getElementById('toggle-key');
  const modelSelect = document.getElementById('model-preset');
  const customModelContainer = document.getElementById('custom-model-container');
  const customModelInput = document.getElementById('custom-model');
  const historyDepthSelect = document.getElementById('history-depth');
  const systemPromptInput = document.getElementById('system-prompt');
  const btnSave = document.getElementById('btn-save');
  const btnTest = document.getElementById('btn-test');
  const alertBox = document.getElementById('alert-box');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');

  const defaultSysPrompt = (typeof globalThis !== 'undefined' && globalThis.DEFAULT_SETTINGS_SYSTEM_PROMPT)
    ? globalThis.DEFAULT_SETTINGS_SYSTEM_PROMPT
    : `You are a smart, context-aware AI assistant helping the user draft quick WhatsApp replies.`;

  // Load saved configuration from storage
  const storage = await chrome.storage.local.get([
    'openrouterApiKey',
    'openrouterModel',
    'historyDepth',
    'systemPrompt',
    'provider',
    'ollamaModel'
  ]);
  providerSelect.value = storage.provider || 'auto';
  ollamaModelInput.value = storage.ollamaModel || 'qwen3';

  const keyTypeIndicator = document.getElementById('key-type-indicator');

  function updateProviderUi() {
    const local = providerSelect.value === 'ollama';
    apiKeyInput.closest('.form-group').classList.toggle('hidden', local);
    ollamaModelGroup.classList.toggle('hidden', !local);
  }
  providerSelect.addEventListener('change', updateProviderUi);
  updateProviderUi();

  function checkKeyType(key) {
    const trimmed = key ? key.trim() : '';
    if (!trimmed) {
      if (keyTypeIndicator) keyTypeIndicator.classList.add('hidden');
      return 'unknown';
    }
    if (trimmed.startsWith('AQ') || trimmed.startsWith('AIza')) {
      if (keyTypeIndicator) {
        keyTypeIndicator.className = 'key-type-badge google-badge';
        keyTypeIndicator.innerText = '✨ Google AI Studio Key Detected';
        keyTypeIndicator.classList.remove('hidden');
      }
      return 'google';
    } else if (trimmed.startsWith('sk-or')) {
      if (keyTypeIndicator) {
        keyTypeIndicator.className = 'key-type-badge openrouter-badge';
        keyTypeIndicator.innerText = '🌐 OpenRouter Key Detected';
        keyTypeIndicator.classList.remove('hidden');
      }
      return 'openrouter';
    } else {
      if (keyTypeIndicator) keyTypeIndicator.classList.add('hidden');
      return 'custom';
    }
  }

  if (storage.openrouterApiKey) {
    apiKeyInput.value = storage.openrouterApiKey;
    checkKeyType(storage.openrouterApiKey);
    updateStatusBadge(true, 'Configured');
  } else {
    updateStatusBadge(false, 'Key Missing');
  }

  apiKeyInput.addEventListener('input', () => {
    const type = checkKeyType(apiKeyInput.value);
    if (type === 'google' && modelSelect.value.includes('/')) {
      // Auto-switch to gemini-3.6-flash if user had an OpenRouter model selected
      modelSelect.value = 'gemini-3.6-flash';
    }
  });

  // Model logic
  const savedModel = storage.openrouterModel || 'qwen/qwen3.7-flash';
  let isPreset = false;
  for (let option of modelSelect.options) {
    if (option.value === savedModel) {
      modelSelect.value = savedModel;
      isPreset = true;
      break;
    }
  }

  if (!isPreset) {
    modelSelect.value = 'custom';
    customModelContainer.classList.remove('hidden');
    customModelInput.value = savedModel;
  }

  // History Depth logic
  if (storage.historyDepth) {
    historyDepthSelect.value = String(storage.historyDepth);
  }

  systemPromptInput.value = storage.systemPrompt || defaultSysPrompt;

  // Listeners
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customModelContainer.classList.remove('hidden');
      customModelInput.focus();
    } else {
      customModelContainer.classList.add('hidden');
    }
  });

  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.innerText = '🙈';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.innerText = '👁️';
    }
  });

  btnSave.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    const selectedModel = getSelectedModel();
    const historyDepth = parseInt(historyDepthSelect.value, 10) || 15;
    const systemPrompt = systemPromptInput.value.trim();

    if (!apiKey && provider !== 'ollama') {
      showAlert('Enter a cloud API key or choose Ollama (local).', 'error');
      return;
    }

    await chrome.storage.local.set({
      openrouterApiKey: apiKey,
      openrouterModel: selectedModel,
      historyDepth: historyDepth,
      systemPrompt,
      provider,
      ollamaModel: ollamaModelInput.value.trim() || 'qwen3'
    });

    updateStatusBadge(true, 'Saved');
    showAlert(`Saved! Model: ${selectedModel} | Context Depth: Last ${historyDepth} msgs`, 'success');
  });

  btnTest.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const modelName = getSelectedModel();
    const provider = providerSelect.value;

    if (!apiKey && provider !== 'ollama') {
      showAlert('Enter a cloud API key or choose Ollama (local).', 'error');
      return;
    }

    btnTest.disabled = true;
    btnTest.innerText = '⏳ Testing...';
    showAlert(`Testing connection with ${modelName}...`, 'info');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'VALIDATE_KEY',
        data: { apiKey, modelName, provider, ollamaModel: ollamaModelInput.value.trim() || 'qwen3' }
      });

      if (response && response.valid) {
        updateStatusBadge(true, 'Connected');
        showAlert(`✅ Connection successful! Model ${modelName} responded.`, 'success');
      } else {
        updateStatusBadge(false, 'Invalid');
        showAlert(`❌ Test failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      updateStatusBadge(false, 'Error');
      showAlert(`❌ Error: ${err.message}`, 'error');
    } finally {
      btnTest.disabled = false;
      btnTest.innerText = '⚡ Test Key';
    }
  });

  function getSelectedModel() {
    if (modelSelect.value === 'custom') {
      return customModelInput.value.trim() || 'qwen/qwen3.7-flash';
    }
    return modelSelect.value;
  }

  function updateStatusBadge(isOk, text) {
    statusBadge.className = `status-badge ${isOk ? 'ok' : 'err'}`;
    statusText.innerText = text;
  }

  function showAlert(msg, type = 'info') {
    alertBox.className = `alert alert-${type}`;
    alertBox.innerText = msg;
    alertBox.classList.remove('hidden');
  }
});
