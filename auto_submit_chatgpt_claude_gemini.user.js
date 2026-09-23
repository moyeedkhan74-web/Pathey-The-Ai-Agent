// ==UserScript==
// @name         Auto-Submit AI Prompts (ChatGPT, Claude, Gemini)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Auto-submit prompts after paste on ChatGPT, Claude, and Gemini
// @author       Pathey
// @match        *://chat.openai.com/*
// @match        *://chatgpt.com/*
// @match        *://claude.ai/*
// @match        *://gemini.google.com/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  let autoSendTimeout = null;
  const DELAY = 500;

  function clickSendButton(platform) {
    console.log('[Auto-Submit] Attempting to click send button for ' + platform);
    
    let sendBtn = null;
    
    if (platform === 'chatgpt') {
      sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                document.querySelector('button[aria-label="Send message"]') ||
                document.querySelector('button[aria-label="Send"]') ||
                Array.from(document.querySelectorAll('button')).find(b => {
                  const label = b.getAttribute('aria-label') || '';
                  return label.toLowerCase().includes('send');
                });
    } else if (platform === 'claude') {
      sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const label = b.getAttribute('aria-label') || '';
        const text = b.textContent || '';
        return label.toLowerCase().includes('send') || text.toLowerCase().includes('send');
      });
    } else if (platform === 'gemini') {
      sendBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const label = b.getAttribute('aria-label') || '';
        return label.toLowerCase().includes('send') || label.toLowerCase().includes('submit');
      });
    }
    
    if (sendBtn && !sendBtn.disabled) {
      console.log('[Auto-Submit] Found send button, clicking...');
      sendBtn.click();
      return true;
    } else {
      console.log('[Auto-Submit] Send button not found or disabled');
      return false;
    }
  }

  function setupChatGPT() {
    console.log('[Auto-Submit] Setting up ChatGPT...');
    
    const observer = new MutationObserver(() => {
      const textarea = document.querySelector('#prompt-textarea') ||
                       document.querySelector('textarea[data-id]') ||
                       document.querySelector('textarea');
      
      if (textarea && !textarea._autoSubmitSetup) {
        textarea._autoSubmitSetup = true;
        console.log('[Auto-Submit] ChatGPT textarea found');
        
        const triggerSubmit = () => {
          clearTimeout(autoSendTimeout);
          autoSendTimeout = setTimeout(() => {
            const text = textarea.value.trim();
            if (text.length > 0) {
              clickSendButton('chatgpt');
            }
          }, DELAY);
        };
        
        textarea.addEventListener('paste', () => setTimeout(triggerSubmit, 100));
        textarea.addEventListener('input', () => {
          clearTimeout(autoSendTimeout);
        });
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupClaude() {
    console.log('[Auto-Submit] Setting up Claude...');
    
    const observer = new MutationObserver(() => {
      const textarea = document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('textarea');
      
      if (textarea && !textarea._autoSubmitSetup) {
        textarea._autoSubmitSetup = true;
        console.log('[Auto-Submit] Claude input found');
        
        const triggerSubmit = () => {
          clearTimeout(autoSendTimeout);
          autoSendTimeout = setTimeout(() => {
            const text = (textarea.textContent || textarea.value || '').trim();
            if (text.length > 0) {
              clickSendButton('claude');
            }
          }, DELAY);
        };
        
        textarea.addEventListener('paste', () => setTimeout(triggerSubmit, 100));
        textarea.addEventListener('input', () => {
          clearTimeout(autoSendTimeout);
        });
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function setupGemini() {
    console.log('[Auto-Submit] Setting up Gemini...');
    
    const observer = new MutationObserver(() => {
      const input = document.querySelector('textarea[aria-label="Enter a prompt here"]') ||
                    document.querySelector('textarea') ||
                    document.querySelector('[contenteditable="true"]') ||
                    document.querySelector('[role="textbox"]');
      
      if (input && !input._autoSubmitSetup) {
        input._autoSubmitSetup = true;
        console.log('[Auto-Submit] Gemini input found');
        
        const triggerSubmit = () => {
          clearTimeout(autoSendTimeout);
          autoSendTimeout = setTimeout(() => {
            const text = (input.value || input.textContent || '').trim();
            if (text.length > 0) {
              clickSendButton('gemini');
            }
          }, DELAY);
        };
        
        input.addEventListener('paste', () => setTimeout(triggerSubmit, 100));
        input.addEventListener('input', () => {
          clearTimeout(autoSendTimeout);
        });
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function detectAndSetup() {
    const host = window.location.hostname;
    
    if (host.includes('openai.com') || host.includes('chatgpt.com')) {
      setupChatGPT();
    } else if (host.includes('claude.ai')) {
      setupClaude();
    } else if (host.includes('gemini.google.com')) {
      setupGemini();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectAndSetup);
  } else {
    detectAndSetup();
  }

  console.log('[Auto-Submit] Script loaded');
})();
