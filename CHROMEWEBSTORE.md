# Chrome Web Store Metadata & Development Guide

## Listing Metadata

- **Extension Name**: WhatsApp Web AI Assistant
- **Short Description**: AI reply toolbar for WhatsApp Web using your own OpenRouter or Google AI Studio key.
- **Detailed Description**:
  WhatsApp Web AI Assistant brings fast, privacy-first AI quick-replies directly into your WhatsApp Web chat box. Powered by OpenRouter API, it lets you pick your favorite AI model (Gemini 2.0, Claude 3.5, Llama 3.3, GPT-4o) and draft context-aware messages with a single click.

  Key Features:
  - ⚡ **Floating AI Action Bar**: Injected right above the WhatsApp Web message box.
  - ✨ **Tone Quick-Actions**: Instantly generate Friendly, Direct, Formal, or Brief replies based on the last 5-10 chat messages.
  - 🎨 **Custom Prompts**: Type custom prompt instructions on the fly.
  - 🔒 **Transparent data flow**: Cloud keys and settings stay in local browser storage; requested chat context is sent directly to your selected AI provider, or stays local when using Ollama.
  - 🚀 **Multi-Model Support**: Use any model supported by OpenRouter (Gemini, Claude, Llama, GPT-4o, DeepSeek).

---

## Permissions Justification

| Permission / Host Permission | Justification |
| :--- | :--- |
| `storage` | Required to securely store user API Key, selected model preference, and persona instructions in local browser storage (`chrome.storage.local`). |
| `https://web.whatsapp.com/*` | Required to inject the floating AI action bar into WhatsApp Web and read recent chat messages for context awareness. |
| `https://openrouter.ai/*` | Required to send chat completion API requests directly to OpenRouter's API endpoints. |
| `http://localhost:11434/*` | Required only when the user selects local Ollama; requests go to the user's local Ollama server. |

---

## Privacy & Data Use

- **Data Collection**: No personal data, telemetry, or message history is collected or stored on external servers by this extension.
- **Storage**: All credentials and settings are persisted locally in Chrome's `storage.local`.
- **API Traffic**: Message context is sent directly from your browser to OpenRouter's secure API endpoint (`https://openrouter.ai/api/v1/chat/completions`) using your own API key.

---

## How to Load and Test the Extension

1. Open Chrome browser and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top right corner.
3. Click **Load unpacked** button.
4. Select the workspace folder: `/Users/prhehegd/Documents/Workspace/GITHUB/extension`.
5. Click the extension puzzle icon in Chrome toolbar and pin **WhatsApp Web AI Assistant**.
6. Click the extension icon to enter your OpenRouter API Key (from `openrouter.ai/keys`) and click **Save Settings**.
7. Open [web.whatsapp.com](https://web.whatsapp.com) and select any chat thread. The AI toolbar will appear right above the input box!
