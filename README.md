# WhatsApp Web AI Assistant

Chrome Manifest V3 extension that adds AI quick-reply actions to WhatsApp Web.

## Writing commands

- **Rewrite (default):** type text in the assistant field and click **Rewrite**, or start with `/rewrite`. This preserves the meaning while fixing grammar and making the message sound natural and human.
- **AI:** start with `/ai` for a context-aware custom request, such as `/ai write a poem to ask sorry` or `/ai write a movie script`. AI requests use recent chat history and the user's writing style, with moderate creativity (3/5).

The assistant field grows downward as you type. Press **Enter** to run the action and **Shift+Enter** to add a new line.

## Privacy and API keys

The extension does not include a developer API key or a telemetry service. Choose OpenRouter or Google AI Studio for cloud requests, or Ollama for local requests. Recent WhatsApp message context, prompts, and generated requests are sent directly from the browser to the provider selected in Settings. See [PRIVACY.md](PRIVACY.md).

### Ollama

Install Ollama, then run:

```bash
OLLAMA_ORIGINS=chrome-extension://* ollama serve
ollama pull qwen3
```

Choose **Ollama (local)** in the popup and use model `qwen3`.

## Load locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Open WhatsApp Web, select a chat, and configure the extension from its toolbar icon.

## Release checklist

- Test with a throwaway API key and remove it before packaging.
- Confirm every manifest path exists.
- Zip the repository contents without `.git`, `.DS_Store`, or secrets.
- Upload the ZIP in the Chrome Web Store Developer Dashboard.
