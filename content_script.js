// content_script.js - WhatsApp Web DOM Scraper, Person Study (Beta) & Conversational AI Toolbar

(function () {
  'use strict';

  console.log('[WhatsApp AI Assistant] Content script initialized with Person Study (Beta).');

  const TOOLBAR_ID = 'wa-ai-floating-toolbar';
  const PREVIEW_ID = 'wa-ai-preview-popover';
  const STUDY_MODAL_ID = 'wa-ai-person-study-modal';

  // Selector dictionary for WhatsApp Web DOM
  const SELECTORS = {
    chatInput: 'footer div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"], div[role="textbox"][contenteditable="true"]',
    footer: 'footer._ak1i, footer, div[role="region"] footer',
    messages: 'div[role="row"], div.message-in, div.message-out',
    messageText: 'span.selectable-text, span._ao3e, div.copyable-text span',
    quotedMessage: 'div[data-testid="quoted-message"], div[class*="quoted-mention"], span[class*="quoted-mention"]',
    prePlainText: '[data-pre-plain-text]',
    headerTitle: '#main header span[dir="auto"], #main header div[role="button"] span[title], #main header h2 span, header span[title]'
  };

  /**
   * Scrapes current active contact / chat name from WhatsApp Web header
   */
  function scrapeActiveContactName() {
    try {
      const headerEl = document.querySelector('#main header');
      if (headerEl) {
        const titleEl = headerEl.querySelector('span[dir="auto"][title]') ||
                        headerEl.querySelector('div[role="button"] span[title]') ||
                        headerEl.querySelector('span[dir="auto"]') ||
                        headerEl.querySelector('span[title]');
        if (titleEl) {
          const name = titleEl.getAttribute('title') || titleEl.innerText || '';
          if (name.trim()) return name.trim();
        }
      }
    } catch (e) {}
    return 'Contact';
  }

  /**
   * Scrapes conversation context, strictly resolving sender vs user without quote confusion.
   */
  function scrapeConversationDetails(limit = 15) {
    const contactName = scrapeActiveContactName();
    const messageElements = document.querySelectorAll(SELECTORS.messages);
    const messages = [];
    const userWritingSamples = [];

    const elementList = Array.from(messageElements);
    const slice = elementList.slice(-Math.max(limit, 5));

    slice.forEach(el => {
      // 1. Identify Outgoing vs Incoming accurately
      const dataId = el.getAttribute('data-id') || el.querySelector('[data-id]')?.getAttribute('data-id') || '';
      const prePlainEl = el.querySelector(SELECTORS.prePlainText) || el;
      const rawMeta = prePlainEl.getAttribute('data-pre-plain-text') || '';

      let isOutgoing = false;

      if (dataId.startsWith('true_')) {
        isOutgoing = true;
      } else if (dataId.startsWith('false_')) {
        isOutgoing = false;
      } else if (el.classList.contains('message-out') || (!el.classList.contains('message-in') && el.querySelector(':scope > div.message-out, :scope > div._amk4.message-out'))) {
        isOutgoing = true;
      } else if (rawMeta.includes('You:') || rawMeta.includes('Me:')) {
        isOutgoing = true;
      }

      let sender = isOutgoing ? 'Me' : contactName;
      let time = '';

      if (rawMeta) {
        const metaMatch = rawMeta.match(/\[(.*?)\]\s*(.*?):/);
        if (metaMatch) {
          time = metaMatch[1] || '';
          const extractedSender = metaMatch[2]?.trim();
          if (extractedSender && !isOutgoing && extractedSender.toLowerCase() !== 'you') {
            sender = extractedSender;
          }
        }
      }

      // 2. Extract message text cleanly (exclude quoted message preview text to avoid duplicate content)
      let text = '';
      const cloneEl = el.cloneNode(true);
      // Remove quoted reply snippets inside the clone
      cloneEl.querySelectorAll('div[data-testid="quoted-message"], div[class*="quoted-mention"], span[class*="quoted-mention"]').forEach(q => q.remove());

      const textNode = cloneEl.querySelector(SELECTORS.messageText) || cloneEl.querySelector('.selectable-text');
      if (textNode) {
        text = textNode.innerText.trim();
      }

      // Filter out system timestamp dividers or empty rows
      if (text && text.length > 0 && !text.includes('Messages and calls are end-to-end encrypted')) {
        messages.push({
          sender,
          time,
          text,
          isOutgoing
        });

        if (isOutgoing && userWritingSamples.length < 8) {
          userWritingSamples.push(text);
        }
      }
    });

    const lastMsg = messages[messages.length - 1];
    const isLastMessageFromMe = lastMsg ? lastMsg.isOutgoing : false;
    const lastMessageTime = lastMsg ? lastMsg.time : '';
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      contactName,
      messages,
      userWritingSamples,
      isLastMessageFromMe,
      lastMessageTime,
      currentTime
    };
  }

  /**
   * Scrapes outgoing messages across the DOM to build the user's style fingerprint.
   */
  async function getAccumulatedStyleSamples() {
    const allMessageEls = document.querySelectorAll(SELECTORS.messages);
    const freshSamples = [];

    Array.from(allMessageEls).forEach(el => {
      const dataId = el.getAttribute('data-id') || el.querySelector('[data-id]')?.getAttribute('data-id') || '';
      const isOutgoing = dataId.startsWith('true_') || el.classList.contains('message-out');
      if (!isOutgoing) return;

      const textNode = el.querySelector(SELECTORS.messageText) || el.querySelector('.selectable-text');
      const text = textNode ? textNode.innerText.trim() : '';

      if (text && text.length > 4 && text.length < 400 && !text.includes('Messages and calls')) {
        freshSamples.push(text);
      }
    });

    let accumulated = [];
    try {
      const storage = await chrome.storage.local.get('userStyleSamples');
      accumulated = Array.isArray(storage.userStyleSamples) ? storage.userStyleSamples : [];
    } catch (e) {}

    const seen = new Set();
    const merged = [];
    for (const s of [...freshSamples, ...accumulated]) {
      const key = s.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(s);
      }
      if (merged.length >= 60) break;
    }

    try {
      await chrome.storage.local.set({ userStyleSamples: merged });
    } catch (e) {}

    return merged;
  }

  /**
   * Loads cached Person Study for the active contact if one exists
   */
  async function getCachedPersonStudy(contactName) {
    if (!contactName || contactName === 'Contact') return null;
    try {
      const key = `wa_study_${encodeURIComponent(contactName)}`;
      const data = await chrome.storage.local.get(key);
      return data[key] || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Saves Person Study to storage
   */
  async function savePersonStudy(contactName, studyObj) {
    if (!contactName || contactName === 'Contact' || !studyObj) return;
    try {
      const key = `wa_study_${encodeURIComponent(contactName)}`;
      await chrome.storage.local.set({ [key]: studyObj });
    } catch (e) {}
  }

  /**
   * Inserts text into WhatsApp Web's contenteditable input field properly.
   */
  function insertTextIntoInput(text, replaceAll = false) {
    const inputEl = document.querySelector(SELECTORS.chatInput);
    if (!inputEl) {
      showErrorToast('Could not locate WhatsApp chat input field.');
      return false;
    }

    inputEl.focus();

    if (replaceAll) {
      inputEl.innerHTML = '';
      inputEl.appendChild(document.createTextNode(text));
      inputEl.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      }));
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);

        inputEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: text
        }));
      } else {
        const inserted = document.execCommand('insertText', false, text);
        if (!inserted) {
          inputEl.innerText = text;
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }

    const range = document.createRange();
    const selFinal = window.getSelection();
    range.selectNodeContents(inputEl);
    range.collapse(false);
    selFinal.removeAllRanges();
    selFinal.addRange(range);

    return true;
  }

  /**
   * Triggers AI Suggestion Generation
   */
  async function triggerAIGeneration(tone = null, customPrompt = '', intent = null) {
    setLoadingState(true, 'Generating human replies...');

    let historyDepth = 15;
    try {
      const storage = await chrome.storage.local.get('historyDepth');
      if (storage.historyDepth) historyDepth = parseInt(storage.historyDepth, 10);
    } catch (e) {}

    const details = scrapeConversationDetails(historyDepth);
    const styleSamples = await getAccumulatedStyleSamples();
    const personStudy = await getCachedPersonStudy(details.contactName);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'GENERATE_SUGGESTIONS',
        data: {
          context: details.messages,
          userWritingSamples: styleSamples,
          isLastMessageFromMe: details.isLastMessageFromMe,
          lastMessageTime: details.lastMessageTime,
          currentTime: details.currentTime,
          contactName: details.contactName,
          personStudy,
          tone,
          intent,
          customPrompt
        }
      });

      setLoadingState(false);

      if (response && response.success) {
        showSuggestionsModal(
          response.suggestions,
          response.modelUsed,
          tone,
          details.isLastMessageFromMe,
          details.contactName,
          personStudy,
          customPrompt,
          intent
        );
        renderQuickPillSuggestions(response.suggestions);
      } else {
        showErrorToast(response?.error || 'Failed to generate replies.');
      }
    } catch (err) {
      setLoadingState(false);
      showErrorToast(`Error: ${err.message}`);
    }
  }

  async function triggerTextRefinement(sourceText) {
    const text = (sourceText || '').trim();
    if (!text) {
      showErrorToast('Enter text in the Refine field or WhatsApp message box first.');
      return;
    }

    setLoadingState(true, 'Refining text...');
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'REFINE_TEXT',
        data: { text }
      });
      setLoadingState(false);

      if (response?.success) {
        insertTextIntoInput(response.refinedText, true);
        const vagueInput = document.querySelector('.wa-ai-vague-input');
        if (vagueInput) vagueInput.value = '';
      } else {
        showErrorToast(response?.error || 'Text refinement failed.');
      }
    } catch (err) {
      setLoadingState(false);
      showErrorToast(`Error: ${err.message}`);
    }
  }

  /**
   * Triggers Person Study (Beta) Analysis — checks cache first unless forced
   */
  async function triggerPersonStudyAnalysis(forceRefresh = false) {
    const contactName = scrapeActiveContactName();

    // 1. If not forcing refresh, check if we already have a cached study for this contact
    if (!forceRefresh) {
      const cached = await getCachedPersonStudy(contactName);
      if (cached) {
        showPersonStudyModal(contactName, cached, 'Loaded from cache');
        return;
      }
    }

    setLoadingState(true, `Analyzing ${contactName}'s Persona...`);

    const details = scrapeConversationDetails(30); // Deep context for persona study

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'ANALYZE_PERSON_STUDY',
        data: {
          context: details.messages,
          contactName: details.contactName
        }
      });

      setLoadingState(false);

      if (response && response.success && response.personStudy) {
        await savePersonStudy(details.contactName, response.personStudy);
        showPersonStudyModal(details.contactName, response.personStudy, response.modelUsed);
      } else {
        showErrorToast(response?.error || 'Person study analysis failed.');
      }
    } catch (err) {
      setLoadingState(false);
      showErrorToast(`Error: ${err.message}`);
    }
  }

  function setLoadingState(isLoading, message = 'Generating...') {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    let statusText = toolbar.querySelector('.wa-ai-status');
    toolbar.setAttribute('aria-busy', String(isLoading));
    const refineButton = toolbar.querySelector('.wa-ai-vague-send');
    if (refineButton) refineButton.disabled = isLoading;

    if (isLoading) {
      toolbar.classList.add('wa-ai-loading');
      if (statusText) statusText.innerText = message;
    } else {
      toolbar.classList.remove('wa-ai-loading');
    }
  }

  /**
   * Renders quick suggestion pills in the toolbar
   */
  function renderQuickPillSuggestions(suggestions) {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    let pillsContainer = toolbar.querySelector('.wa-ai-quick-pills');
    if (!pillsContainer) {
      pillsContainer = document.createElement('div');
      pillsContainer.className = 'wa-ai-quick-pills';
      const inner = toolbar.querySelector('.wa-ai-bar-inner');
      inner.appendChild(pillsContainer);
    }

    const items = [
      { tone: 'casual', badge: '💬 Casual', text: suggestions.casual },
      { tone: 'witty', badge: '😂 Witty', text: suggestions.witty },
      { tone: 'direct', badge: '🎯 Direct', text: suggestions.direct },
      { tone: 'hinglish', badge: '🇮🇳 Hinglish', text: suggestions.hinglish }
    ].filter(item => !!item.text);

    pillsContainer.innerHTML = items.map(item => `
      <button class="wa-ai-pill-btn" data-text="${escapeHTML(item.text || '')}" title="${escapeHTML(item.badge + ': ' + item.text)}">
        <span class="wa-ai-pill-badge">${item.badge}</span>
        <span class="wa-ai-pill-text">${escapeHTML(item.text || '')}</span>
      </button>
    `).join('');

    pillsContainer.querySelectorAll('.wa-ai-pill-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const text = btn.getAttribute('data-text');
        if (text) insertTextIntoInput(text);
      });
    });
  }

  /**
   * Displays full 6-tone human suggestions modal
   */
  function showSuggestionsModal(suggestions, modelUsed = '', activeTone = null, isFollowUp = false, contactName = 'Contact', personStudy = null, customPrompt = '', intent = null) {
    removePreviewPopover();

    const popover = document.createElement('div');
    popover.id = PREVIEW_ID;
    popover.className = 'wa-ai-preview';

    const tonesList = [
      { key: 'casual', title: '💬 Casual & Natural', text: suggestions.casual },
      { key: 'witty', title: '😂 Witty & Playful', text: suggestions.witty },
      { key: 'direct', title: '🎯 Direct & Crisp', text: suggestions.direct },
      { key: 'polite', title: '💼 Polite & Human', text: suggestions.polite },
      { key: 'hinglish', title: '🇮🇳 Desi / Hinglish', text: suggestions.hinglish },
      { key: 'quick_ack', title: '⚡ Quick Acknowledgment', text: suggestions.quick_ack }
    ].filter(t => !!t.text);

    let headerTitle = isFollowUp ? `💬 Follow-up to ${escapeHTML(contactName)}` : `✨ Human Replies for ${escapeHTML(contactName)}`;
    if (intent) {
      headerTitle = `🎯 ${escapeHTML(intent)} → ${escapeHTML(contactName)}`;
    } else if (customPrompt) {
      headerTitle = `✏️ Refined Thought for ${escapeHTML(contactName)}`;
    }

    popover.innerHTML = `
      <div class="wa-ai-preview-header">
        <div class="wa-ai-header-info">
          <div class="wa-ai-title-row">
            <span class="wa-ai-preview-title">${headerTitle}</span>
            ${personStudy ? `<span class="wa-ai-study-chip" title="Tailored with Person Study (Beta)">🧠 Study Applied (${escapeHTML(personStudy.relationship || 'Analyzed')})</span>` : ''}
          </div>
          ${customPrompt ? `<div class="wa-ai-draft-badge" title="Refining vague draft">✏️ "${escapeHTML(customPrompt)}"</div>` : ''}
        </div>
        <div class="wa-ai-header-controls">
          <span class="wa-ai-preview-model">${escapeHTML(modelUsed || 'OpenRouter')}</span>
          <button class="wa-ai-preview-close" title="Close">✕</button>
        </div>
      </div>
      <div class="wa-ai-suggestions-list">
        ${tonesList.map(t => `
          <div class="wa-ai-suggestion-card ${activeTone === t.key ? 'active' : ''}">
            <div class="wa-ai-card-header">
              <span class="wa-ai-card-title">${t.title}</span>
              <div class="wa-ai-card-actions">
                <button class="wa-ai-card-copy-btn" data-text="${escapeHTML(t.text || '')}" title="Copy to clipboard">📋</button>
                <button class="wa-ai-card-use-btn" data-text="${escapeHTML(t.text || '')}">🚀 Use This</button>
              </div>
            </div>
            <div class="wa-ai-card-body">${escapeHTML(t.text || 'No suggestion')}</div>
          </div>
        `).join('')}
      </div>
      <div class="wa-ai-preview-footer">
        <button class="wa-ai-btn wa-ai-study-btn" id="wa-ai-open-study-btn">🧠 Person Study (Beta)</button>
        <button class="wa-ai-btn wa-ai-btn-copy" id="wa-ai-refresh-btn">🔄 Refresh All</button>
      </div>
    `;

    const footer = document.querySelector(SELECTORS.footer) || document.body;
    footer.appendChild(popover);

    popover.querySelector('.wa-ai-preview-close').onclick = removePreviewPopover;

    popover.querySelectorAll('.wa-ai-card-use-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-text');
        if (text && insertTextIntoInput(text)) {
          removePreviewPopover();
        }
      });
    });

    popover.querySelectorAll('.wa-ai-card-copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const text = btn.getAttribute('data-text');
        if (text) {
          await navigator.clipboard.writeText(text);
          btn.innerText = '✅';
          setTimeout(() => { btn.innerText = '📋'; }, 1500);
        }
      });
    });

    popover.querySelector('#wa-ai-refresh-btn').onclick = () => {
      triggerAIGeneration(activeTone, customPrompt, intent);
    };

    popover.querySelector('#wa-ai-open-study-btn').onclick = () => {
      removePreviewPopover();
      triggerPersonStudyAnalysis();
    };
  }

  /**
   * Displays interactive Person Study (Beta) Review Card Modal
   */
  function showPersonStudyModal(contactName, study, modelUsed = '') {
    removeStudyModal();

    const modal = document.createElement('div');
    modal.id = STUDY_MODAL_ID;
    modal.className = 'wa-ai-study-modal';

    const tags = Array.isArray(study.vibeTags) ? study.vibeTags : [];
    const tips = Array.isArray(study.replyStrategy) ? study.replyStrategy : [];
    const relationships = ['Close Friend', 'Colleague', 'Boss / Lead', 'Client / Work', 'Romantic / Dating', 'Family', 'Acquaintance', 'Group Member'];
    const currentRel = study.relationship || 'Close Friend';

    modal.innerHTML = `
      <div class="wa-ai-study-dialog">
        <div class="wa-ai-study-header">
          <div class="wa-ai-study-title-group">
            <span class="wa-ai-study-badge-beta">BETA</span>
            <h2 class="wa-ai-study-headline">🧠 Contact Persona Card: <span class="wa-ai-contact-hl">${escapeHTML(contactName)}</span></h2>
          </div>
          <button class="wa-ai-study-close" title="Close">✕</button>
        </div>

        <div class="wa-ai-study-body">
          <div class="wa-ai-study-meta-banner">
            <span>📊 Analyzed <strong>30 recent messages</strong></span>
            <span class="wa-ai-study-source-badge">${escapeHTML(modelUsed || 'AI Analyzed')}</span>
          </div>

          <!-- Relationship & Tags (Editable) -->
          <div class="wa-ai-study-section">
            <div class="wa-ai-study-rel-row">
              <label class="wa-ai-rel-label" for="wa-ai-rel-select">Relationship Dynamic:</label>
              <select id="wa-ai-rel-select" class="wa-ai-rel-dropdown">
                ${relationships.map(r => `<option value="${escapeHTML(r)}" ${r.toLowerCase() === currentRel.toLowerCase() ? 'selected' : ''}>${escapeHTML(r)}</option>`).join('')}
              </select>
            </div>
            <div class="wa-ai-study-tags">
              ${tags.map(t => `<span class="wa-ai-tag">${escapeHTML(t)}</span>`).join('')}
            </div>
          </div>

          <!-- Communication Style Profile -->
          <div class="wa-ai-study-section">
            <div class="wa-ai-sec-title">📱 Texting Profile & Vibe</div>
            <p class="wa-ai-sec-desc">${escapeHTML(study.contactProfile || 'Natural messaging style.')}</p>
          </div>

          <!-- Current Sentiment / Mood -->
          <div class="wa-ai-study-section">
            <div class="wa-ai-sec-title">💭 Active Intent & Mood</div>
            <p class="wa-ai-sec-desc">${escapeHTML(study.currentMoodIntent || 'Awaiting natural response.')}</p>
          </div>

          <!-- Reply Strategy Tips -->
          <div class="wa-ai-study-section">
            <div class="wa-ai-sec-title">🎯 Reply Strategy & Rules</div>
            <ul class="wa-ai-strategy-list">
              ${tips.map(tip => `<li>${escapeHTML(tip)}</li>`).join('')}
            </ul>
            <div class="wa-ai-golden-rule-group">
              <label class="wa-ai-golden-label" for="wa-ai-golden-input">💡 Golden Rule / Custom Persona Notes:</label>
              <textarea id="wa-ai-golden-input" class="wa-ai-golden-textarea" rows="2" placeholder="e.g. Likes short punchy replies, don't call">${escapeHTML(study.quickReplyAdvice || '')}</textarea>
            </div>
          </div>
        </div>

        <div class="wa-ai-study-footer">
          <div class="wa-ai-footer-left">
            <button class="wa-ai-btn wa-ai-study-reanalyze" id="wa-ai-study-refresh" title="Run fresh AI analysis on latest messages">🔄 Re-Analyze</button>
            <button class="wa-ai-btn wa-ai-study-save-card" id="wa-ai-study-save" title="Save custom edits to local cache">💾 Save Card</button>
          </div>
          <button class="wa-ai-btn wa-ai-study-generate-btn" id="wa-ai-study-gen-btn">✨ Generate Tailored Replies</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const relSelect = modal.querySelector('#wa-ai-rel-select');
    const goldenInput = modal.querySelector('#wa-ai-golden-input');
    const saveBtn = modal.querySelector('#wa-ai-study-save');

    // Save edited card data back to storage
    const handleSaveCard = async () => {
      const updatedStudy = {
        ...study,
        relationship: relSelect.value,
        quickReplyAdvice: goldenInput.value.trim()
      };
      await savePersonStudy(contactName, updatedStudy);
      saveBtn.innerText = '✅ Saved!';
      setTimeout(() => { saveBtn.innerText = '💾 Save Card'; }, 1500);
      return updatedStudy;
    };

    saveBtn.onclick = handleSaveCard;

    modal.querySelector('.wa-ai-study-close').onclick = removeStudyModal;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) removeStudyModal();
    });

    modal.querySelector('#wa-ai-study-refresh').onclick = () => {
      removeStudyModal();
      triggerPersonStudyAnalysis(true);
    };

    modal.querySelector('#wa-ai-study-gen-btn').onclick = async () => {
      await handleSaveCard();
      removeStudyModal();
      triggerAIGeneration();
    };
  }

  function removePreviewPopover() {
    const existing = document.getElementById(PREVIEW_ID);
    if (existing) existing.remove();
  }

  function removeStudyModal() {
    const existing = document.getElementById(STUDY_MODAL_ID);
    if (existing) existing.remove();
  }

  function showErrorToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'wa-ai-toast wa-ai-toast-error';
    toast.innerHTML = `⚠️ ${escapeHTML(msg)}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  /**
   * Injects Floating Bar above WhatsApp Web text input
   */
  function injectToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;

    const chatInput = document.querySelector(SELECTORS.chatInput);
    if (!chatInput) return;

    const inputContainer = chatInput.closest('footer') || chatInput.parentElement;
    if (!inputContainer) return;

    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;
    toolbar.className = 'wa-ai-bar';

    toolbar.innerHTML = `
      <div class="wa-ai-bar-inner">
        <div class="wa-ai-logo" title="WhatsApp AI Reply Assistant (Alt+A shortcut)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          <span>AI Reply</span>
        </div>

        <button class="wa-ai-tone-btn wa-ai-auto-btn" title="Generate Natural Human Replies (Alt+A)">⚡ Auto</button>
        <button class="wa-ai-tone-btn wa-ai-study-launch-btn" title="Analyze Contact Persona & Relationship Dynamics">🧠 Person Study (Beta)</button>

        <!-- Quick Intent Chips -->
        <div class="wa-ai-intents-group">
          <button class="wa-ai-intent-btn" data-intent="Agree & confirm enthusiastically" title="Agree / Yes">👍 Agree</button>
          <button class="wa-ai-intent-btn" data-intent="Politely decline or say cannot do this right now" title="Polite Decline">🙅 Decline</button>
          <button class="wa-ai-intent-btn" data-intent="Say busy right now, will reply properly in some time" title="Busy / Reply Later">⏳ Later</button>
          <button class="wa-ai-intent-btn" data-intent="Ask for clarification or more details" title="Ask Clarification">❓ Clarify</button>
        </div>

        <!-- Tone Buttons -->
        <div class="wa-ai-tones">
          <button class="wa-ai-tone-btn" data-tone="casual" title="Casual & Natural">💬 Casual</button>
          <button class="wa-ai-tone-btn" data-tone="witty" title="Witty & Banter">😂 Witty</button>
          <button class="wa-ai-tone-btn" data-tone="direct" title="Short & Crisp">🎯 Direct</button>
          <button class="wa-ai-tone-btn" data-tone="hinglish" title="Natural Hinglish / Desi">🇮🇳 Hinglish</button>
        </div>

        <!-- Vague Thought Input -->
        <div class="wa-ai-vague-group" title="Type rough thought (e.g. late 10m traffic, shift call?) to refine into natural replies">
          <span class="wa-ai-vague-icon" aria-hidden="true">✏️</span>
          <input type="text" class="wa-ai-custom-input wa-ai-vague-input" aria-label="Optional text to refine" placeholder="Optional text to refine..." />
          <button type="button" class="wa-ai-tone-btn wa-ai-vague-send" title="Refine text">⚡ Refine</button>
        </div>

        <div class="wa-ai-status-container">
          <div class="wa-ai-spinner"></div>
          <span class="wa-ai-status" aria-live="polite">Generating...</span>
        </div>
      </div>
    `;

    inputContainer.parentNode.insertBefore(toolbar, inputContainer);

    const vagueInput = toolbar.querySelector('.wa-ai-vague-input');
    const getVagueDraft = () => (vagueInput ? vagueInput.value.trim() : '');

    toolbar.querySelector('.wa-ai-auto-btn').addEventListener('click', (e) => {
      e.preventDefault();
      triggerAIGeneration(null, getVagueDraft());
    });

    toolbar.querySelector('.wa-ai-study-launch-btn').addEventListener('click', (e) => {
      e.preventDefault();
      triggerPersonStudyAnalysis();
    });

    // Intent chip listeners
    toolbar.querySelectorAll('.wa-ai-intent-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const intent = btn.getAttribute('data-intent');
        triggerAIGeneration(null, getVagueDraft(), intent);
      });
    });

    // Tone button listeners
    toolbar.querySelectorAll('.wa-ai-tone-btn[data-tone]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tone = btn.getAttribute('data-tone');
        triggerAIGeneration(tone, getVagueDraft());
      });
    });

    const vagueSendBtn = toolbar.querySelector('.wa-ai-vague-send');
    const handleVagueSubmit = () => {
      const draftVal = getVagueDraft();
      const chatText = (document.querySelector(SELECTORS.chatInput)?.innerText || '').trim();
      triggerTextRefinement(draftVal || chatText);
    };

    vagueSendBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleVagueSubmit();
    });

    if (vagueInput) {
      vagueInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleVagueSubmit();
        }
      });
    }
  }

  // Alt + A shortcut listener
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'a') {
      const inputEl = document.querySelector(SELECTORS.chatInput);
      if (document.activeElement === inputEl || document.querySelector('#main')?.contains(document.activeElement)) {
        e.preventDefault();
        triggerAIGeneration();
      }
    }
  });

  function setupMutationObserver() {
    const observer = new MutationObserver(() => {
      if (!document.getElementById(TOOLBAR_ID)) {
        injectToolbar();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  setTimeout(() => {
    injectToolbar();
    setupMutationObserver();
  }, 1000);

})();
