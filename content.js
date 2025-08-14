// ========== SOLTHRON AUTO MODE - MAGIC PILL FEATURE ==========

// Global variables
let shadowRoot;
let button;
let solthronContainer;
let outputText;
let autoModeEnabled = false;
let magicPillIcon = null;
let currentInputField = null;
let lastMagicPillClick = 0;
const MAGIC_PILL_COOLDOWN = 2000; // 2 seconds cooldown

// ========== PLATFORM DETECTION ==========
function detectAIPlatform() {
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    if (hostname.includes('chatgpt.com') || hostname.includes('chat.openai.com')) {
        return 'chatgpt';
    } else if (hostname.includes('claude.ai')) {
        return 'claude';
    } else if (hostname.includes('gemini.google.com') || hostname.includes('bard.google.com')) {
        return 'gemini';
    } else if (hostname.includes('chat.deepseek.com')) {
        return 'deepseek';
    } else if (hostname.includes('grok.com') || hostname.includes('groq.com')) {
        return 'grok';
    }
    return 'unknown';
}

// ========== CURSOR POSITION UTILITIES ==========
function getCursorPosition(element) {
    try {
        if (element.tagName === 'TEXTAREA') {
            return getCursorPositionTextarea(element);
        } else {
            return getCursorPositionContentEditable(element);
        }
    } catch (error) {
        console.warn('Error getting cursor position:', error);
        return null;
    }
}

function getCursorPositionContentEditable(element) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return null;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // If range has no width/height, it's probably collapsed at cursor
    if (rect.width === 0 && rect.height === 0) {
        return {
            x: rect.left,
            y: rect.top,
            height: rect.height || 20 // fallback height
        };
    }
    
    // For text selection, use the end of the range
    const endRange = range.cloneRange();
    endRange.collapse(false);
    const endRect = endRange.getBoundingClientRect();
    
    return {
        x: endRect.left,
        y: endRect.top,
        height: endRect.height || 20
    };
}

function getCursorPositionTextarea(element) {
    const selectionStart = element.selectionStart;
    const text = element.value.substring(0, selectionStart);
    
    // Create a temporary element to measure text
    const measurer = createTextMeasurer(element);
    const position = measureTextPosition(measurer, text, element);
    
    // Clean up
    document.body.removeChild(measurer);
    
    return position;
}

function createTextMeasurer(textarea) {
    const measurer = document.createElement('div');
    const style = window.getComputedStyle(textarea);
    const platform = detectAIPlatform();
    
    // Base styling that works for all platforms
    let measurerCSS = `
        position: absolute;
        visibility: hidden;
        height: auto;
        width: ${textarea.offsetWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)}px;
        font: ${style.font};
        font-family: ${style.fontFamily};
        font-size: ${style.fontSize};
        font-weight: ${style.fontWeight};
        line-height: ${style.lineHeight};
        letter-spacing: ${style.letterSpacing};
        white-space: pre-wrap;
        word-wrap: break-word;
        padding: ${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft};
        border: ${style.border};
        box-sizing: ${style.boxSizing};
        z-index: -1;
    `;
    
    // Platform-specific positioning
    if (platform === 'deepseek' || platform === 'grok') {
        // For DeepSeek and Grok, position the measurer element exactly over the textarea
        const rect = textarea.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        measurerCSS += `
            top: ${rect.top + scrollTop}px;
            left: ${rect.left + scrollLeft}px;
        `;
        
        console.log(`🔍 ${platform} measurer positioned at:`, {
            top: rect.top + scrollTop,
            left: rect.left + scrollLeft,
            textareaRect: rect
        });
    } else {
        // For other platforms, use the original positioning (off-screen)
        measurerCSS += `
            top: -9999px;
            left: -9999px;
        `;
    }
    
    measurer.style.cssText = measurerCSS;
    document.body.appendChild(measurer);
    return measurer;
}

function measureTextPosition(measurer, text, textarea) {
    // Add text up to cursor position
    measurer.textContent = text;
    
    // Add a marker span at the end to get cursor position
    const marker = document.createElement('span');
    marker.textContent = '|';
    measurer.appendChild(marker);
    
    const textareaRect = textarea.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const measurerRect = measurer.getBoundingClientRect();
    
    // Platform-specific coordinate calculation
    const platform = detectAIPlatform();
    
    if (platform === 'deepseek' || platform === 'grok') {
        // DeepSeek and Grok need special coordinate handling
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
        
        // Calculate relative position within measurer, then translate to textarea coordinates
        const relativeX = markerRect.left - measurerRect.left;
        const relativeY = markerRect.top - measurerRect.top;
        
        console.log(`🔍 ${platform} marker debug:`, {
            markerRect: { left: markerRect.left, top: markerRect.top },
            measurerRect: { left: measurerRect.left, top: measurerRect.top },
            textareaRect: { left: textareaRect.left, top: textareaRect.top },
            relative: { x: relativeX, y: relativeY }
        });
        
        return {
            x: textareaRect.left + relativeX,
            y: textareaRect.top + relativeY,
            height: markerRect.height || 20
        };
    } else {
        // Original logic for other platforms (ChatGPT, Claude, Gemini)
        return {
            x: markerRect.left,
            y: markerRect.top,
            height: markerRect.height || 20
        };
    }
}

// ========== MAGIC PILL FUNCTIONS ==========
function initializeMagicPill() {
    const platform = detectAIPlatform();
    console.log('🔍 Platform detected:', platform);
    
    if (platform === 'unknown') {
        console.log('❌ Not on a supported AI platform');
        return;
    }
    
    if (!autoModeEnabled) {
        console.log('❌ Auto mode not enabled');
        removeMagicPill();
        return;
    }
    
    console.log('✅ Initializing magic pill for', platform);
    monitorInputField(platform);
}

function monitorInputField(platform) {
    const findAndMonitorInput = () => {
        let inputField = null;
        
        // Platform-specific selectors
        const selectors = {
            chatgpt: [
                '#prompt-textarea',
                'textarea[data-id="root"]',
                'textarea[placeholder*="Send"]',
                'textarea[placeholder*="Message"]',
                'div[contenteditable="true"]'
            ],
            claude: [
                'div.ProseMirror[contenteditable="true"]',
                'div[contenteditable="true"][data-placeholder]',
                'div[contenteditable="true"]'
            ],
            gemini: [
                '.ql-editor[contenteditable="true"]',
                'div[contenteditable="true"][aria-label*="message"]',
                'div[contenteditable="true"]',
                'rich-textarea .ql-editor'
            ],
            deepseek: [
                'textarea[placeholder*="Message"]',
                'textarea.chat-input',
                'div[contenteditable="true"]',
                'textarea'
            ],
            grok: [
                'textarea[placeholder*="Enter"]',
                'textarea[placeholder*="Message"]',
                'textarea[placeholder*="Type"]',
                'div[contenteditable="true"]',
                'textarea.input',
                'textarea',
                '#chat-input',
                '.chat-input'
            ]
        };
        
        const platformSelectors = selectors[platform] || [];
        
        for (const selector of platformSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                // Check if this is likely the main input field
                const rect = el.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 20) {
                    inputField = el;
                    console.log('✅ Found input field:', selector);
                    break;
                }
            }
            if (inputField) break;
        }
        
        if (inputField && inputField !== currentInputField) {
            currentInputField = inputField;
            attachMagicPillToInput(inputField);
        }
    };
    
    // Initial check
    findAndMonitorInput();
    
    // Set up observer for dynamic content
    const observer = new MutationObserver(() => {
        if (autoModeEnabled) {
            findAndMonitorInput();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function attachMagicPillToInput(inputField) {
    console.log('📎 Attaching magic pill to input field');
    
    // Remove any existing listeners
    if (currentInputField) {
        currentInputField.removeEventListener('input', handleInputChange);
        currentInputField.removeEventListener('focus', handleInputFocus);
        currentInputField.removeEventListener('blur', handleInputBlur);
        currentInputField.removeEventListener('keyup', handleCursorMove);
        currentInputField.removeEventListener('click', handleCursorMove);
        currentInputField.removeEventListener('keydown', handleKeyboardShortcut);
    }
    
    // Add new listeners
    inputField.addEventListener('input', handleInputChange);
    inputField.addEventListener('focus', handleInputFocus);
    inputField.addEventListener('blur', handleInputBlur);
    inputField.addEventListener('keyup', handleCursorMove);
    inputField.addEventListener('click', handleCursorMove);
    inputField.addEventListener('keydown', handleKeyboardShortcut);
}

let inputDebounceTimer = null;
let cursorMoveTimer = null;

function handleInputChange(e) {
    if (!autoModeEnabled) return;
    
    // Clear previous timer
    if (inputDebounceTimer) {
        clearTimeout(inputDebounceTimer);
    }
    
    // Debounce input changes
    inputDebounceTimer = setTimeout(() => {
        const text = getInputText(e.target);
        
        if (text.trim().length > 0) {
            showMagicPill(e.target);
        } else {
            hideMagicPill();
        }
    }, 300);
}

function handleKeyboardShortcut(e) {
    if (!autoModeEnabled) return;
    
    // Check for Ctrl+Shift+Enter
    if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        
        // Only trigger if magic pill is visible and there's text
        const text = getInputText(e.target);
        if (text.trim().length > 0 && magicPillIcon && magicPillIcon.style.display !== 'none') {
            console.log('⌨️ Keyboard shortcut triggered (Ctrl+Shift+Enter)');
            
            // Create a synthetic event object for handleMagicPillClick
            const syntheticEvent = {
                preventDefault: () => {},
                stopPropagation: () => {}
            };
            
            // Trigger the same logic as clicking the magic pill
            handleMagicPillClick(syntheticEvent);
        }
    }
}

function handleCursorMove(e) {
    if (!autoModeEnabled) return;
    
    // Clear previous timer
    if (cursorMoveTimer) {
        clearTimeout(cursorMoveTimer);
    }
    
    // Debounce cursor movements
    cursorMoveTimer = setTimeout(() => {
        const text = getInputText(e.target);
        if (text.trim().length > 0 && magicPillIcon && magicPillIcon.style.display !== 'none') {
            positionMagicPillAtCursor(e.target);
        }
    }, 100);
}

function handleInputFocus(e) {
    if (!autoModeEnabled) return;
    
    const text = getInputText(e.target);
    if (text.trim().length > 0) {
        showMagicPill(e.target);
    }
}

function handleInputBlur(e) {
    setTimeout(() => {
        if (!magicPillIcon?.matches(':hover')) {
            hideMagicPill();
        }
    }, 200);
}

function getInputText(element) {
    // Handle both textarea and contenteditable
    if (element.tagName === 'TEXTAREA') {
        return element.value || '';
    } else {
        return element.innerText || element.textContent || '';
    }
}

function setInputText(element, text) {
    const platform = detectAIPlatform();
    
    if (element.tagName === 'TEXTAREA') {
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        // For contenteditable
        element.innerText = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Platform-specific event triggers
        if (platform === 'claude') {
            // Claude uses ProseMirror
            element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true }));
            element.dispatchEvent(new InputEvent('input', { bubbles: true }));
        } else if (platform === 'gemini') {
            // Gemini might use Quill editor
            element.dispatchEvent(new Event('textInput', { bubbles: true }));
        }
    }
    
    // Set focus and move cursor to end
    element.focus();
    
    if (element.tagName !== 'TEXTAREA') {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
}

function showMagicPill(inputField) {
    if (!magicPillIcon) {
        createMagicPillIcon();
    }
    
    positionMagicPillAtCursor(inputField);
    
    magicPillIcon.style.display = 'flex';
    setTimeout(() => {
        magicPillIcon.style.opacity = '1';
        magicPillIcon.style.transform = 'scale(1)';
    }, 10);
}

function hideMagicPill() {
    if (!magicPillIcon) return;
    
    magicPillIcon.style.opacity = '0';
    magicPillIcon.style.transform = 'scale(0.8)';
    
    setTimeout(() => {
        if (magicPillIcon) {
            magicPillIcon.style.display = 'none';
        }
    }, 200);
}

function positionMagicPillAtCursor(inputField) {
    if (!magicPillIcon) return;
    
    const cursorPos = getCursorPosition(inputField);
    
    if (!cursorPos) {
        console.log('❌ Could not get cursor position, using fallback');
        positionMagicPillFallback(inputField);
        return;
    }
    
    const platform = detectAIPlatform();
    
    // Debug logging for DeepSeek and Grok
    if (platform === 'deepseek' || platform === 'grok') {
        console.log(`🔍 ${platform} cursor position:`, cursorPos);
    }
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    // Calculate position relative to cursor
    let x = cursorPos.x + scrollLeft + 10; // 10px to the right of cursor
    let y = cursorPos.y + scrollTop - 40; // 40px above cursor
    
    // Viewport boundary checks
    const pillWidth = 32;
    const pillHeight = 32;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Adjust horizontal position if too close to right edge
    if (x + pillWidth > viewportWidth + scrollLeft - 10) {
        x = cursorPos.x + scrollLeft - pillWidth - 10; // Position to the left of cursor
    }
    
    // Adjust vertical position if too close to top edge
    if (y < scrollTop + 10) {
        y = cursorPos.y + scrollTop + (cursorPos.height || 20) + 10; // Position below cursor
    }
    
    // Final position debug for DeepSeek and Grok
    if (platform === 'deepseek' || platform === 'grok') {
        console.log(`🔍 ${platform} final position:`, { x, y });
    }
    
    // Apply position
    magicPillIcon.style.left = `${x}px`;
    magicPillIcon.style.top = `${y}px`;
}

function positionMagicPillFallback(inputField) {
    // Fallback to original positioning method
    const rect = inputField.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    // Position at the right edge, vertically centered
    magicPillIcon.style.top = `${rect.top + scrollTop + (rect.height / 2) - 16}px`;
    magicPillIcon.style.left = `${rect.right + scrollLeft - 45}px`;
}

function createMagicPillIcon() {
    removeMagicPill();
    
    magicPillIcon = document.createElement('div');
    magicPillIcon.id = 'solthron-magic-pill';
    magicPillIcon.style.cssText = `
        position: absolute;
        width: 32px;
        height: 32px;
        background: #ffff00;
        border-radius: 50%;
        display: none;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 999999;
        opacity: 0;
        transform: scale(0.8);
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15), 0 0 20px rgba(255, 255, 0, 0.3);
        pointer-events: auto;
    `;
    
    magicPillIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2v6m0 4v6m0 4v-2"></path>
            <path d="M2 12h6m4 0h6m4 0h-2"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
    `;
    
    magicPillIcon.addEventListener('mouseenter', () => {
        magicPillIcon.style.transform = 'scale(1.1)';
        magicPillIcon.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2), 0 0 25px rgba(255, 255, 0, 0.4)';
    });
    
    magicPillIcon.addEventListener('mouseleave', () => {
        magicPillIcon.style.transform = 'scale(1)';
        magicPillIcon.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15), 0 0 20px rgba(255, 255, 0, 0.3)';
    });
    
    magicPillIcon.addEventListener('click', handleMagicPillClick);
    
    document.body.appendChild(magicPillIcon);
}

async function handleMagicPillClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Rate limiting
    const now = Date.now();
    if (now - lastMagicPillClick < MAGIC_PILL_COOLDOWN) {
        showMagicPillError('Please wait a moment...');
        return;
    }
    lastMagicPillClick = now;
    
    if (!currentInputField) return;
    
    const text = getInputText(currentInputField);
    if (!text.trim()) return;
    
    console.log('🚀 Processing text:', text.substring(0, 50) + '...');
    
    // Animation
    const originalHTML = magicPillIcon.innerHTML;
    magicPillIcon.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" class="spinning">
            <path d="M21 12a9 9 0 11-6.219-8.56"></path>
        </svg>
    `;
    
    try {
        // Send request to backend via background script
        const requestData = {
            type: 'enhance_text',
            data: {
                topic: text,
                mode: 'convert_balanced',
                tone: 'professional',
                length: 'balanced'
            }
        };
        
        console.log('🔍 Sending request to background script:', requestData);
        
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(requestData, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    console.log('🔍 Raw response from background script:', response);
                    console.log('🔍 Response keys:', Object.keys(response || {}));
                    console.log('🔍 Response.success:', response?.success);
                    console.log('🔍 Response.data:', response?.data);
                    console.log('🔍 Response.error:', response?.error);
                    console.log('🔍 Full response JSON:', JSON.stringify(response, null, 2));
                    resolve(response);
                }
            });
        });
        
        if (response && response.success && response.data) {
            const enhancedText = response.data.prompt;
            console.log('✅ Enhanced text received');
            
            // Replace the text in the input field
            setInputText(currentInputField, enhancedText);
            
            // Success animation
            magicPillIcon.style.background = '#00ff00';
            magicPillIcon.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            `;
            
            setTimeout(() => {
                magicPillIcon.style.background = '#ffff00';
                magicPillIcon.innerHTML = originalHTML;
                hideMagicPill();
            }, 1500);
            
        } else {
            throw new Error('Failed to convert text');
        }
        
    } catch (error) {
        console.error('❌ Magic pill error:', error);
        showMagicPillError('Conversion failed');
        magicPillIcon.innerHTML = originalHTML;
    }
}

function showMagicPillError(message) {
    console.log('⚠️', message);
    magicPillIcon.style.background = '#ff6b6b';
    setTimeout(() => {
        magicPillIcon.style.background = '#ffff00';
    }, 1000);
}

function removeMagicPill() {
    if (magicPillIcon) {
        magicPillIcon.remove();
        magicPillIcon = null;
    }
    
    if (currentInputField) {
        currentInputField.removeEventListener('input', handleInputChange);
        currentInputField.removeEventListener('focus', handleInputFocus);
        currentInputField.removeEventListener('blur', handleInputBlur);
        currentInputField.removeEventListener('keyup', handleCursorMove);
        currentInputField.removeEventListener('click', handleCursorMove);
        currentInputField.removeEventListener('keydown', handleKeyboardShortcut);
        currentInputField = null;
    }
}

// ========== SIMPLE UI CREATION ==========
function createUI() {
    // Create shadow host
    const shadowHost = document.createElement('div');
    shadowHost.id = 'solthron-shadow-host';
    shadowHost.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 0 !important;
        height: 0 !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
    `;
    
    document.body.appendChild(shadowHost);
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    
    // Simple styles for testing
    const styles = `
        <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        #solthron-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 50px;
            height: 50px;
            background: #ffff00;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 10000;
            pointer-events: auto;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        
        #solthron-container {
            position: fixed;
            bottom: 80px;
            right: 20px;
            width: 300px;
            background: #1a1a1a;
            border-radius: 10px;
            padding: 15px;
            z-index: 10000;
            pointer-events: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        
        .mode-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(255,255,255,0.1);
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 10px;
        }
        
        .mode-label {
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 14px;
        }
        
        .toggle-switch {
            position: relative;
            width: 50px;
            height: 25px;
            background: #555;
            border-radius: 25px;
            cursor: pointer;
            transition: background 0.3s;
        }
        
        .toggle-switch.active {
            background: #ffff00;
        }
        
        .toggle-slider {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 21px;
            height: 21px;
            background: #fff;
            border-radius: 50%;
            transition: transform 0.3s;
        }
        
        .toggle-switch.active .toggle-slider {
            transform: translateX(25px);
        }
        
        .status-text {
            color: rgba(255,255,255,0.7);
            font-family: Arial, sans-serif;
            font-size: 12px;
            text-align: center;
        }
        
        .keyboard-hint {
            color: rgba(255,255,0,0.8);
            font-family: Arial, sans-serif;
            font-size: 11px;
            text-align: center;
            margin-top: 8px;
            padding: 4px 8px;
            background: rgba(255,255,0,0.1);
            border-radius: 4px;
            border: 1px solid rgba(255,255,0,0.2);
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .spinning {
            animation: spin 1s linear infinite;
        }
        </style>
    `;
    
    const html = `
        <div id="solthron-button">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2">
                <path d="M12 2v6m0 4v6m0 4v-2"></path>
                <path d="M2 12h6m4 0h6m4 0h-2"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
        </div>
        
        <div id="solthron-container" style="display: none;">
            <div class="mode-toggle">
                <span class="mode-label">🪄 Auto Mode</span>
                <div class="toggle-switch" id="auto-mode-toggle">
                    <div class="toggle-slider"></div>
                </div>
            </div>
            <div class="status-text" id="status-text">
                Auto Mode: OFF
            </div>
            <div class="keyboard-hint">
                💡 Tip: Use Ctrl+Shift+Enter
            </div>
        </div>
    `;
    
    shadowRoot.innerHTML = styles + html;
    
    // Get references
    button = shadowRoot.querySelector('#solthron-button');
    solthronContainer = shadowRoot.querySelector('#solthron-container');
    outputText = shadowRoot.querySelector('#status-text');
    
    // Initialize handlers
    initializeHandlers();
}

function initializeHandlers() {
    // Toggle container visibility
    button.addEventListener('click', () => {
        const isVisible = solthronContainer.style.display !== 'none';
        solthronContainer.style.display = isVisible ? 'none' : 'block';
    });
    
    // Auto mode toggle
    const toggle = shadowRoot.querySelector('#auto-mode-toggle');
    toggle.addEventListener('click', () => {
        autoModeEnabled = !autoModeEnabled;
        toggle.classList.toggle('active');
        
        const platform = detectAIPlatform();
        
        if (autoModeEnabled) {
            outputText.textContent = `Auto Mode: ON (${platform})`;
            initializeMagicPill();
        } else {
            outputText.textContent = 'Auto Mode: OFF';
            removeMagicPill();
        }
        
        // Save preference
        localStorage.setItem('solthron-auto-mode', autoModeEnabled);
    });
    
    // Load saved preference
    const savedMode = localStorage.getItem('solthron-auto-mode') === 'true';
    if (savedMode) {
        autoModeEnabled = true;
        toggle.classList.add('active');
        const platform = detectAIPlatform();
        outputText.textContent = `Auto Mode: ON (${platform})`;
        
        // Initialize after a delay to ensure page is loaded
        setTimeout(() => {
            initializeMagicPill();
        }, 1000);
    }
}

// ========== INITIALIZE EXTENSION ==========
console.log('🚀 Solthron Auto Mode Extension loaded');
createUI();

// Check for platform changes
setInterval(() => {
    if (autoModeEnabled) {
        const platform = detectAIPlatform();
        if (platform !== 'unknown' && !currentInputField) {
            console.log('🔄 Rechecking for input field...');
            initializeMagicPill();
        }
    }
}, 3000);
