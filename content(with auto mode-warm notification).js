// ========== SOLTHRON EXTENSION - SHADOW DOM ISOLATED ==========

// Global variables
let shadowRoot;
let button;
let outputText;
let selectedMode;
let solthronContainer;
let currentCategory = null;
let activeNoteId = null;
let isStarActive = false;
let isButtonVisible = true;
let pageCredits = null;
let isAutoModeActive = false;
let hasProcessedFirstInput = false;
let autoModeStartTime = null;
// 🆕 CONVERSATION MEMORY VARIABLES
let conversationMemory = null;
let currentSessionId = null;
let lastProcessedUrl = null;

// ✨ Double-click animation function
function triggerDoubleClickAnimation() {
    const solthronButton = shadowRoot.querySelector('.solthron-button');
    
    if (!solthronButton) return;
    
    solthronButton.classList.remove('double-click-activated');
    solthronButton.offsetHeight; // Force reflow
    solthronButton.classList.add('double-click-activated');
    
    setTimeout(() => {
        solthronButton.classList.remove('double-click-activated');
    }, 600);
}

// 🆕 SESSION MANAGEMENT FUNCTIONS
function getCurrentSessionId() {
    const platform = detectAIPlatform();
    const url = window.location.href;
    
    if (platform === 'chatgpt') {
        const match = url.match(/\/c\/([a-zA-Z0-9-]+)/);
        return match ? `chatgpt_${match[1]}` : `chatgpt_${Date.now()}`;
    } else if (platform === 'claude') {
        const match = url.match(/\/chat\/([a-zA-Z0-9-]+)/);
        return match ? `claude_${match[1]}` : `claude_${Date.now()}`;
    } else if (platform === 'gemini') {
        const match = url.match(/\/app\/([a-zA-Z0-9-]+)/);
        return match ? `gemini_${match[1]}` : `gemini_${Date.now()}`;
    }
    
    return `${platform}_${Date.now()}`;
}

function initializeConversationMemory() {
    const sessionId = getCurrentSessionId();
    
    if (currentSessionId !== sessionId) {
        console.log('🆕 New session detected:', sessionId);
        currentSessionId = sessionId;
        conversationMemory = {
            sessionId: sessionId,
            platform: detectAIPlatform(),
            startTime: Date.now(),
            inputs: [],
            consolidatedContext: '',
            interventionCount: 0
        };
        lastProcessedUrl = window.location.href;
    }
}

function checkSessionChange() {
    const currentUrl = window.location.href;
    if (lastProcessedUrl !== currentUrl) {
        console.log('🔄 URL changed, checking for new session');
        initializeConversationMemory();
    }
}

// 🆕 INTERVENTION POPUP FUNCTIONS
function showInterventionPopup(consolidatedContext) {
    const button = shadowRoot.querySelector('.solthron-button');
    
    const existingPopup = button.querySelector('.intervention-popup');
    if (existingPopup) {
        existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.className = 'intervention-popup';
    popup.style.cssText = `
        position: absolute;
        bottom: 55px;
        right: -20px;
        background: #2c2c2c;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 13px;
        width: 280px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,0,0.3);
        z-index: 10003;
        animation: interventionSlide 0.3s ease-out;
    `;
    
    popup.innerHTML = `
        <div style="margin-bottom: 8px; line-height: 1.4;">
            I see you're refining your request. Let me craft a better prompt combining everything!
        </div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button class="intervention-no" style="
                background: none;
                border: 1px solid rgba(255,255,255,0.3);
                color: white;
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
            ">No</button>
            <button class="intervention-yes" style="
                background: #ffff00;
                border: none;
                color: black;
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                font-weight: 500;
            ">Yes</button>
        </div>
    `;
    
    popup.querySelector('.intervention-no').addEventListener('click', () => {
        popup.remove();
    });
    
    popup.querySelector('.intervention-yes').addEventListener('click', async () => {
        popup.remove();
        await handleInterventionAccepted();
    });
    
    button.appendChild(popup);
    
    setTimeout(() => {
        if (popup.parentNode) {
            popup.remove();
        }
    }, 10000);
}

async function handleInterventionAccepted() {
    try {
        showShimmerLoading('Crafting better prompt...');
        
        const buttonRect = button.getBoundingClientRect();
        solthronContainer.style.display = 'block';
        solthronContainer.style.pointerEvents = 'auto';
        positionContainer(buttonRect);
        
        const response = await fetch('https://afaque.pythonanywhere.com/synthesize-conversation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await BackendAuth.getAuthToken()}`
            },
            body: JSON.stringify({
                inputs: conversationMemory.inputs,
                platform: conversationMemory.platform,
                sessionId: conversationMemory.sessionId
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.synthesized_prompt) {
                updateOutput(data.synthesized_prompt);
                conversationMemory.interventionCount++;
            } else {
                showError('Failed to generate synthesized prompt');
            }
        } else {
            showError('Network error while synthesizing prompt');
        }
    } catch (error) {
        console.error('Intervention error:', error);
        showError('Error generating better prompt');
    }
}

// Loading Bar Helper Functions
function showShimmerLoading(message) {
    outputText.classList.remove('placeholder', 'error');
    outputText.classList.add('shimmer-loading');
    outputText.textContent = message;
}

function hideShimmerLoading() {
    outputText.classList.remove('shimmer-loading');
}

// Auto mode popup notification
function showAutoModePopup(message, duration = 3000) {
    const button = shadowRoot.querySelector('.solthron-button');
    
    // Create popup element
    const popup = document.createElement('div');
    popup.style.cssText = `
        position: absolute;
        bottom: 55px;
        right: -10px;
        background: #1a1a1a;
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,0,0.3);
        z-index: 10002;
        animation: autoPopupSlide 0.3s ease-out;
    `;
    
    popup.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 6px; height: 6px; background: #00ff00; border-radius: 50%; animation: pulse 1.5s infinite;"></div>
            <span>${message}</span>
        </div>
    `;
    
    // Add CSS animation
    if (!shadowRoot.querySelector('#auto-popup-styles')) {
        const style = document.createElement('style');
        style.id = 'auto-popup-styles';
        style.textContent = `
            @keyframes autoPopupSlide {
                from { transform: translateY(10px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            @keyframes interventionSlide {
                from { transform: translateX(20px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }    
        `;
        shadowRoot.appendChild(style);
    }
    
    button.appendChild(popup);
    
    // Remove popup after duration
    setTimeout(() => {
        if (popup.parentNode) {
            popup.remove();
        }
    }, duration);
}

// Feature-to-credit mapping function
function getFeatureCredits(mode) {
    const textProcessingModes = [
        'reframe_casual', 'reframe_technical', 'reframe_professional', 
        'reframe_eli5', 'reframe_short', 'reframe_long'
    ];
    const convertPromptModes = [
        'convert_concise', 'convert_balanced', 'convert_detailed'
    ];
    const personaModes = ['persona_generator'];
    const imageModes = ['image_prompt', 'image_caption'];
    const explainModes = ['explain_meaning', 'explain_story', 'explain_eli5'];
    const aiAssistantModes = ['smart_followups', 'smart_actions', 'smart_enhancements'];
    const freeModes = ['save_note', 'save_prompt', 'save_persona'];
    
    if (textProcessingModes.includes(mode)) return 6;
    if (convertPromptModes.includes(mode)) return 8;
    if (personaModes.includes(mode)) return 10;
    if (imageModes.includes(mode)) return 12;
    if (explainModes.includes(mode)) return 5;
    if (aiAssistantModes.includes(mode)) return 15;
    if (freeModes.includes(mode)) return 0;
    
    return 6;
}

// BACKEND AUTH SYSTEM
const BackendAuth = {
    async getAuthToken() {
        try {
            const result = await chrome.storage.local.get(['authToken']);
            return result.authToken || null;
        } catch (error) {
            console.error('Error getting auth token:', error);
            return null;
        }
    },

    async setAuthToken(token) {
        try {
            await chrome.storage.local.set({ 
                authToken: token,
                authTimestamp: Date.now()
            });
            return true;
        } catch (error) {
            console.error('Error setting auth token:', error);
            return false;
        }
    },

    async isLoggedIn() {
        try {
            const token = await this.getAuthToken();
            if (!token) return false;

            const response = await fetch('https://afaque.pythonanywhere.com/user-credits', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.ok;
        } catch (error) {
            console.error('Error checking login status:', error);
            return false;
        }
    },

    async login(email, password) {
        try {
            const response = await fetch('https://afaque.pythonanywhere.com/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                await this.setAuthToken(data.token);
                return { success: true, user: data.user };
            } else {
                return { success: false, error: data.error || 'Login failed' };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Network error' };
        }
    },

    async logout() {
        try {
            await chrome.storage.local.remove(['authToken', 'authTimestamp']);
            pageCredits = null;
            return true;
        } catch (error) {
            console.error('Logout error:', error);
            return false;
        }
    },

    async getUserCredits() {
        try {
            const token = await this.getAuthToken();
            if (!token) return 0;

            const response = await fetch('https://afaque.pythonanywhere.com/user-credits', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.credits || 0;
            }
            return 0;
        } catch (error) {
            console.error('Error getting user credits:', error);
            return 0;
        }
    },

    async deductCredits(feature) {
        try {
            const token = await this.getAuthToken();
            if (!token) {
                return { success: false, message: "Not logged in" };
            }

            const response = await fetch('https://afaque.pythonanywhere.com/deduct-credits', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ feature })
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Error deducting credits:', error);
            return { success: false, message: error.message };
        }
    }
};

// Storage functions
async function savePrompt(promptText) {
    const promptId = Date.now().toString();
    const prompt = {
        id: promptId,
        text: promptText,
        timestamp: new Date().toISOString()
    };
    try {
        const data = await chrome.storage.sync.get('savedPrompts');
        const savedPrompts = data.savedPrompts || [];
        savedPrompts.push(prompt);
        await chrome.storage.sync.set({ savedPrompts });
        return true;
    } catch (error) {
        console.error('Error saving prompt:', error);
        return false;
    }
}

async function saveNote(text) {
    if (isStarActive && activeNoteId) {
        try {
            const data = await chrome.storage.local.get('savedNotes');
            const savedNotes = data.savedNotes || [];
            const noteIndex = savedNotes.findIndex(note => note.id === activeNoteId);
            
            if (noteIndex !== -1) {
                savedNotes[noteIndex].text += '\n\n' + text;
                savedNotes[noteIndex].lastModified = new Date().toISOString();
                await chrome.storage.local.set({ savedNotes });
                return true;
            }
        } catch (error) {
            console.error('Error appending to note:', error);
            return false;
        }
    } else {
        const noteId = Date.now().toString();
        const note = {
            id: noteId,
            text: text,
            timestamp: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
        
        try {
            const data = await chrome.storage.local.get('savedNotes');
            const savedNotes = data.savedNotes || [];
            savedNotes.push(note);
            
            if (savedNotes.length > 3) {
                const galleryList = shadowRoot.querySelector('.gallery-list');
                if (galleryList) {
                    galleryList.style.overflowY = 'auto';
                }
            }
            
            await chrome.storage.local.set({ savedNotes });
            return true;
        } catch (error) {
            console.error('Error saving note:', error);
            return false;
        }
    }
}

async function savePersona(text) {
    const personaId = Date.now().toString();
    const lines = text.split('\n');
    let title = 'Custom Persona';
    
    for (let line of lines) {
        line = line.trim();
        if (line.includes('You are') && line.length > 10 && line.length < 100) {
            title = line.replace('You are', '').replace(/[^\w\s]/g, '').trim();
            title = title.charAt(0).toUpperCase() + title.slice(1);
            if (title.length > 50) title = title.substring(0, 50) + '...';
            break;
        }
        if (line.includes('specialist') || line.includes('expert') || line.includes('consultant')) {
            title = line.replace(/[^\w\s]/g, '').trim();
            if (title.length > 50) title = title.substring(0, 50) + '...';
            break;
        }
    }
    
    const persona = {
        id: personaId,
        title: title,
        prompt: text,
        example: 'Acting with this custom persona',
        response: 'I\'m ready to help with my specialized expertise.',
        timestamp: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        source: 'user_saved'
    };
    
    try {
        const data = await chrome.storage.local.get('personaTemplates');
        const savedPersonas = data.personaTemplates || [];
        savedPersonas.push(persona);
        await chrome.storage.local.set({ personaTemplates: savedPersonas });
        return true;
    } catch (error) {
        console.error('Error saving persona:', error);
        return false;
    }
}

async function loadPrompts() {
    try {
        const data = await chrome.storage.sync.get('savedPrompts');
        return data.savedPrompts || [];
    } catch (error) {
        console.error('Error loading prompts:', error);
        return [];
    }
}

async function loadNotes() {
    try {
        const data = await chrome.storage.local.get('savedNotes');
        return data.savedNotes || [];
    } catch (error) {
        console.error('Error loading notes:', error);
        return [];
    }
}

async function loadPersonaTemplates() {
    const builtInTemplates = [
        {
            id: 'ceo-exec',
            title: 'CEO / Executive Persona',
            prompt: 'You are a visionary CEO known for making bold decisions and leading organizations to success. Your communication is concise, strategic, and focuses on high-level outcomes. Use business terminology like "market expansion," "revenue growth," and "operational efficiency." Prioritize actionable insights over theory. Avoid unnecessary small talk. Always conclude your responses with a summary and key takeaways.',
            example: 'Our company is facing declining user engagement. What should we do?',
            response: 'Declining engagement suggests issues in product-market fit, value proposition, or competitive positioning. Three key areas to address:\n1. User Feedback Loop – Conduct targeted surveys and analyze churn data.\n2. Product Enhancement – Invest in AI-driven personalization and UX optimization.\n3. Marketing Strategy – Shift focus to retention campaigns rather than pure acquisition.\n\nKey Takeaway: Addressing engagement decline requires a data-backed approach to customer experience and value delivery.',
            timestamp: new Date().toISOString(),
            source: 'built_in'
        }
    ];
    
    try {
        const storageData = await chrome.storage.local.get('personaTemplates');
        const savedPersonas = storageData.personaTemplates || [];
        return [...builtInTemplates, ...savedPersonas];
    } catch (error) {
        console.error('Error loading persona templates:', error);
        return builtInTemplates;
    }
}

async function deletePrompt(promptId) {
    try {
        const data = await chrome.storage.sync.get('savedPrompts');
        const savedPrompts = (data.savedPrompts || []).filter(p => p.id !== promptId);
        await chrome.storage.sync.set({ savedPrompts });
        return true;
    } catch (error) {
        console.error('Error deleting prompt:', error);
        return false;
    }
}

async function deleteNote(noteId) {
    try {
        const data = await chrome.storage.local.get('savedNotes');
        const savedNotes = (data.savedNotes || []).filter(n => n.id !== noteId);
        await chrome.storage.local.set({ savedNotes });
        return true;
    } catch (error) {
        console.error('Error deleting note:', error);
        return false;
    }
}

async function deletePersona(personaId) {
    try {
        const data = await chrome.storage.local.get('personaTemplates');
        const personas = (data.personaTemplates || []).filter(p => p.id !== personaId);
        await chrome.storage.local.set({ personaTemplates: personas });
        return true;
    } catch (error) {
        console.error('Error deleting persona:', error);
        return false;
    }
}

function detectTone(text) {
    const tonePatterns = {
        technical: {
            pattern: /\b(api|function|code|data|algorithm|software|debug|variable|parameter|method|class|object|array|interface|module|system|database|query|framework|library|documentation|compile|runtime|server|client|architecture|deployment)\b/i,
            weight: 1.2
        },
        academic: {
            pattern: /\b(research|study|analysis|theory|hypothesis|methodology|findings|conclusion|literature|evidence|abstract|thesis|dissertation|empirical|experiment|investigation|journal|publication|review|scholarly)\b/i,
            weight: 1.0
        },
        business: {
            pattern: /\b(business|client|project|deadline|meeting|report|strategy|objective|goals|timeline|stakeholder|budget|proposal|contract|partnership|revenue|market|opportunity|initiative|performance|deliverable)\b/i,
            weight: 1.0
        },
        casual: {
            pattern: /\b(hey|hi|hello|thanks|awesome|cool|great|wow|yeah|ok|okay|stuff|thing|like|maybe|probably|basically|actually|pretty|super|totally)\b/i,
            weight: 0.8
        },
        creative: {
            pattern: /\b(story|write|creative|imagine|describe|narrative|character|scene|setting|plot|theme|style|voice|emotion|feeling|expression|artistic|visual|design|concept)\b/i,
            weight: 1.0
        }
    };

    const scores = {};
    const lowercaseText = text.toLowerCase();
    let maxScore = 0;
    let detectedTone = 'professional';

    for (const [tone, config] of Object.entries(tonePatterns)) {
        const matches = (lowercaseText.match(config.pattern) || []).length;
        scores[tone] = matches * config.weight;
        
        if (scores[tone] > maxScore) {
            maxScore = scores[tone];
            detectedTone = tone;
        }
    }

    return maxScore === 0 ? 'professional' : detectedTone;
}

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
    } else if (hostname.includes('grok.x.com') || (hostname.includes('x.com') && pathname.includes('grok'))) {
        return 'grok';
    } else if (hostname.includes('perplexity.ai')) {
        return 'perplexity';
    }
    return 'unknown';
}

// Auto mode input detection
function setupAutoModeDetection() {
    if (!isAutoModeActive) return;
    
    const platform = detectAIPlatform();
    if (platform === 'unknown') return;
    
    console.log('🤖 Setting up auto mode detection for:', platform);
    
    // Platform-specific input detection
    switch(platform) {
        case 'chatgpt':
            detectChatGPTInput();
            break;
        case 'claude':
            detectClaudeInput();
            break;
        case 'gemini':
            detectGeminiInput();
            break;
        default:
            detectGenericInput();
    }
}

function detectChatGPTInput() {
    console.log('🎯 Setting up ChatGPT input detection...');
    
    let hasSetupListeners = false;
    let lastInputText = '';
    
    const observer = new MutationObserver((mutations) => {
        if (hasSetupListeners) return;
        
        const sendButton = document.querySelector([
            '[data-testid="send-button"]',
            'button[aria-label*="Send"]', 
            'button[type="submit"]',
            'button[class*="send"]',
            'form button[type="submit"]'
        ].join(', '));
        
        const inputElement = document.querySelector([
            '#prompt-textarea',
            'textarea[placeholder*="Message"]',
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"]',
            'textarea[data-id="root"]',
            'div[data-id="root"]'
        ].join(', '));
        
        if (sendButton && inputElement) {
            console.log('✅ Found ChatGPT elements');
            hasSetupListeners = true;
            
            inputElement.addEventListener('input', (e) => {
                const currentText = getInputText(inputElement);
                if (currentText && currentText.length > 5) {
                    lastInputText = currentText;
                }
            });
            
            inputElement.addEventListener('paste', (e) => {
                setTimeout(() => {
                    const pastedText = getInputText(inputElement);
                    if (pastedText && pastedText.length > 5) {
                        lastInputText = pastedText;
                    }
                }, 100);
            });
            
            sendButton.addEventListener('click', (e) => {
                if (lastInputText && lastInputText.length > 5) {
                    console.log('🎯 TRIGGERING handleFirstInput with stored text');
                    handleFirstInput(lastInputText, 'chatgpt');
                    lastInputText = '';
                }
            });
            
            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    if (lastInputText && lastInputText.length > 5) {
                        console.log('🎯 TRIGGERING handleFirstInput with stored text');
                        handleFirstInput(lastInputText, 'chatgpt');
                        lastInputText = '';
                    }
                }
            });
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 60000);
}

function detectClaudeInput() {
    console.log('🎯 Setting up Claude input detection...');
    
    let hasSetupListeners = false;
    let lastInputText = '';
    
    const observer = new MutationObserver((mutations) => {
        if (hasSetupListeners) return;
        
        const sendButton = document.querySelector('button[aria-label*="Send"], [data-testid*="send"], button[type="submit"]');
        const inputElement = document.querySelector('div[contenteditable="true"], textarea, div[role="textbox"]');
        
        if (sendButton && inputElement) {
            console.log('✅ Found Claude elements, setting up listeners');
            hasSetupListeners = true;
            
            inputElement.addEventListener('input', (e) => {
                const currentText = getInputText(inputElement);
                if (currentText && currentText.length > 5) {
                    lastInputText = currentText;
                }
            });
            
            sendButton.addEventListener('click', () => {
                if (lastInputText && lastInputText.length > 5) {
                    handleFirstInput(lastInputText, 'claude');
                    lastInputText = '';
                }
            });
            
            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    if (lastInputText && lastInputText.length > 5) {
                        handleFirstInput(lastInputText, 'claude');
                        lastInputText = '';
                    }
                }
            });
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
}

function detectGeminiInput() {
    console.log('🎯 Setting up Gemini input detection...');
    
    let hasSetupListeners = false;
    let lastInputText = '';
    
    const observer = new MutationObserver((mutations) => {
        if (hasSetupListeners) return;
        
        const sendButton = document.querySelector('button[aria-label*="Send"], [title*="Send"], button[type="submit"]');
        const inputElement = document.querySelector('textarea, div[contenteditable="true"], div[role="textbox"]');
        
        if (sendButton && inputElement) {
            console.log('✅ Found Gemini elements, setting up listeners');
            hasSetupListeners = true;
            
            inputElement.addEventListener('input', (e) => {
                const currentText = getInputText(inputElement);
                if (currentText && currentText.length > 5) {
                    lastInputText = currentText;
                }
            });
            
            sendButton.addEventListener('click', () => {
                if (lastInputText && lastInputText.length > 5) {
                    handleFirstInput(lastInputText, 'gemini');
                    lastInputText = '';
                }
            });
            
            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    if (lastInputText && lastInputText.length > 5) {
                        handleFirstInput(lastInputText, 'gemini');
                        lastInputText = '';
                    }
                }
            });
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
}
// Helper function to safely extract text from input elements
// Helper function to safely extract text from input elements
function getInputText(element) {
    if (!element) {
        return '';
    }
    
    try {
        let text = '';
        
        // Special handling for ProseMirror (ChatGPT's editor)
        if (element.className && element.className.includes('ProseMirror')) {
            // Method 1: Get text from paragraphs
            const paragraphs = element.querySelectorAll('p');
            if (paragraphs.length > 0) {
                text = Array.from(paragraphs).map(p => p.textContent || '').join('\n').trim();
            }
            
            // Method 2: Direct text content if no paragraphs
            if (!text) {
                text = (element.textContent || element.innerText || '').trim();
            }
            
            // Method 3: Manual text node extraction
            if (!text) {
                const textNodes = [];
                const walker = document.createTreeWalker(
                    element,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                
                let node;
                while (node = walker.nextNode()) {
                    const nodeText = node.textContent.trim();
                    if (nodeText && nodeText !== '\n') {
                        textNodes.push(nodeText);
                    }
                }
                text = textNodes.join(' ').trim();
            }
        }
        // For regular contenteditable divs
        else if (element.contentEditable === 'true') {
            text = (element.textContent || element.innerText || '').trim();
        }
        // For regular textareas and inputs
        else if (element.value !== undefined) {
            text = element.value.trim();
        }
        // Fallback
        else {
            text = (element.textContent || element.innerText || '').trim();
        }
        
        return text;
        
    } catch (error) {
        console.error('❌ Error extracting input text:', error);
        return '';
    }
}

function detectGenericInput() {
    // Generic input detection for other platforms
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !hasProcessedFirstInput) {
            const target = e.target;
            if (target.tagName === 'TEXTAREA' || target.contentEditable === 'true') {
                const text = target.value || target.textContent;
                if (text.trim()) handleFirstInput(text, 'generic');
            }
        }
    });
}

async function handleFirstInput(inputText, platform) {
    // Check for session changes first
    checkSessionChange();
    initializeConversationMemory();
    
    if (!inputText || typeof inputText !== 'string' || inputText.trim().length < 5) {
        console.log('❌ Invalid input text, skipping');
        return;
    }
    
    // 🆕 CONVERSATION MEMORY LOGIC
    const inputData = {
        text: inputText.trim(),
        timestamp: Date.now(),
        analyzedContext: null
    };
    
    conversationMemory.inputs.push(inputData);
    console.log(`📝 Input #${conversationMemory.inputs.length} saved:`, inputText.substring(0, 50) + '...');
    
    // First input - show warm notification (existing logic)
    if (conversationMemory.inputs.length === 1 && !hasProcessedFirstInput) {
        hasProcessedFirstInput = true;
        console.log('🎯 First input detected:', inputText.substring(0, 50) + '...');
        console.log('🔍 Platform:', platform);
        
        console.log('📢 Showing "Analyzing..." popup');
        showAutoModePopup('Analyzing your input...', 2000);
        
        try {
            const authToken = await BackendAuth.getAuthToken();
            
            const response = await fetch('https://afaque.pythonanywhere.com/analyze-context', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    input_text: inputText,
                    platform: platform,
                    timestamp: Date.now()
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.warm_message) {
                    showAutoModePopup(data.warm_message, 5000);
                    // Store analyzed context
                    inputData.analyzedContext = {
                        topic: data.detected_topic || 'general',
                        intent: data.detected_context || 'general',
                        confidence: data.confidence || 0.5
                    };
                }
            }
        } catch (error) {
            console.error('Auto mode analysis error:', error);
            showAutoModePopup('Auto mode active - watching your conversation!', 3000);
        }
    }
    
    // 🆕 INTERVENTION TRIGGER LOGIC
    // Trigger after every 2 inputs (starting from input 2)
    if (conversationMemory.inputs.length >= 2 && conversationMemory.inputs.length % 2 === 0) {
        console.log(`🎯 Intervention trigger: ${conversationMemory.inputs.length} inputs detected`);
        
        // Build consolidated context
        const contexts = conversationMemory.inputs
            .map(input => input.text)
            .join(' + ');
        conversationMemory.consolidatedContext = contexts;
        
        // Show intervention popup
        setTimeout(() => {
            showInterventionPopup(conversationMemory.consolidatedContext);
        }, 1000); // Small delay so user sees their message sent first
    }
}

// Test popup function
window.testPopup = function() {
    console.log('🧪 Testing popup...');
    showAutoModePopup('Test popup message!', 3000);
};

function extractConversation() {
    const platform = detectAIPlatform();
    let conversation = '';
    
    try {
        switch(platform) {
            case 'chatgpt':
                const chatMessages = document.querySelectorAll('[data-message-author-role]');
                if (chatMessages.length >= 2) {
                    const lastTwo = Array.from(chatMessages).slice(-2);
                    conversation = lastTwo.map(msg => {
                        const role = msg.getAttribute('data-message-author-role');
                        const text = msg.textContent.trim();
                        return `${role === 'user' ? 'User' : 'AI'}: ${text}`;
                    }).join('\n\n');
                }
                break;
                
            case 'claude':
                const claudeMessages = document.querySelectorAll('.prose, [data-testid*="message"]');
                if (claudeMessages.length >= 2) {
                    const lastTwo = Array.from(claudeMessages).slice(-2);
                    conversation = lastTwo.map((msg, idx) => {
                        const role = idx === 0 ? 'User' : 'AI';
                        return `${role}: ${msg.textContent.trim()}`;
                    }).join('\n\n');
                }
                break;
                
            case 'gemini':
                let geminiMessages = [];
                
                const messageElements = document.querySelectorAll(
                    'message-content[id*="message-content"], ' +
                    '[id*="model-response-message-content"], ' + 
                    '.model-response-text, ' +
                    '.markdown.markdown-main-panel, ' +
                    '.conversation-container .response-content'
                );
                
                if (messageElements.length > 0) {
                    geminiMessages = Array.from(messageElements).filter(el => {
                        const text = el.textContent.trim();
                        const isSubstantial = text.length > 30 && text.length < 5000;
                        const isNotSidebar = !el.closest('.side-navigation, .recent-chats, nav');
                        return isSubstantial && isNotSidebar;
                    });
                }
                
                if (geminiMessages.length < 2) {
                    const chatHistory = document.querySelector('#chat-history, .chat-history, .conversation-container');
                    if (chatHistory) {
                        const possibleMessages = chatHistory.querySelectorAll(
                            'div[class*="response"], div[class*="message"], p, .markdown'
                        );
                        geminiMessages = Array.from(possibleMessages).filter(el => {
                            const text = el.textContent.trim();
                            return text.length > 50 && text.length < 3000 && 
                                   !el.closest('button, input') &&
                                   !text.includes('Recent') &&
                                   !text.includes('New chat') &&
                                   !text.includes('Search for');
                        });
                    }
                }
                
                if (geminiMessages.length < 2) {
                    const userMessages = document.querySelectorAll('[class*="user"], .user-message, [role="user"]');
                    const aiMessages = document.querySelectorAll('[class*="model"], [class*="response"], .ai-message');
                    
                    if (userMessages.length > 0 && aiMessages.length > 0) {
                        geminiMessages = [
                            ...Array.from(userMessages).slice(-1),
                            ...Array.from(aiMessages).slice(-1)
                        ];
                    }
                }
                
                if (geminiMessages.length >= 2) {
                    const lastTwo = Array.from(geminiMessages).slice(-2);
                    conversation = lastTwo.map((msg, idx) => {
                        let text = msg.textContent.trim();
                        
                        text = text.replace(/^\s*[\d\w\-]+\s*/, '');
                        text = text.replace(/\s+/g, ' ');
                        
                        const isLikelyUser = text.length < 100 || 
                                           text.includes('?') ||
                                           idx === 0 ||
                                           msg.classList.contains('user') ||
                                           msg.closest('[class*="user"]');
                                           
                        const role = isLikelyUser ? 'User' : 'AI';
                        
                        return `${role}: ${text}`;
                    }).join('\n\n');
                }
                break;
                
            default:
                const allTextBlocks = document.querySelectorAll('p, div[class*="message"], div[class*="chat"], div[role="presentation"], [role="article"]');
                if (allTextBlocks.length > 0) {
                    const recent = Array.from(allTextBlocks)
                        .filter(block => {
                            const text = block.textContent.trim();
                            return text.length > 20 && text.length < 3000 && 
                                   !block.querySelector('input, button');
                        })
                        .slice(-4);
                    conversation = recent.map(block => block.textContent.trim()).join('\n\n');
                }
        }
    } catch (error) {
        console.error('Error extracting conversation:', error);
    }
    
    return conversation || 'Unable to extract conversation from this page.';
}

async function checkCredits(mode) {
    try {
        const requiredCredits = getFeatureCredits(mode);
        
        if (requiredCredits === 0) {
            return { success: true, requiredCredits: 0 };
        }
        
        const isLoggedIn = await BackendAuth.isLoggedIn();
        if (!isLoggedIn) {
            return { success: false, message: "Please login to use this feature" };
        }
        
        if (pageCredits === null) {
            pageCredits = await BackendAuth.getUserCredits();
        }
        
        if (pageCredits < requiredCredits) {
            return { 
                success: false, 
                message: `Insufficient credits. This feature requires ${requiredCredits} credits, but you have ${pageCredits}.` 
            };
        }
        
        return { 
            success: true, 
            requiredCredits: requiredCredits,
            availableCredits: pageCredits
        };
        
    } catch (error) {
        console.error('Credit check error:', error);
        return { success: true };
    }
}

// Display functions
function displaySmartFollowups(data) {
    hideShimmerLoading();
    outputText.classList.remove('placeholder', 'error');
    
    const platform = detectAIPlatform();
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    
    let html = '<div class="smart-followups-container">';
    
    if (platform !== 'unknown') {
        html += `
            <div class="platform-indicator">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 6v6l4 2"></path>
                </svg>
                <span>Analyzing ${platformName} conversation</span>
            </div>
        `;
    }
    
    if (data.analysis) {
        html += `<div class="analysis-insight">${data.analysis}</div>`;
    }
    
    data.questions.forEach((question, index) => {
        html += `
            <div class="followup-card">
                <div class="followup-question">${question.text}</div>
                <button class="followup-copy-btn" data-question="${question.text.replace(/"/g, '&quot;')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                </button>
            </div>
        `;
    });
    
    html += '</div>';
    outputText.innerHTML = html;
    
    shadowRoot.querySelectorAll('.followup-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const question = btn.dataset.question;
            try {
                await navigator.clipboard.writeText(question);
                btn.classList.add('copied');
                
                btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;
                
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                    `;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
    });
}

function displaySmartActions(data) {
    hideShimmerLoading();
    outputText.classList.remove('placeholder', 'error');
    
    const platform = detectAIPlatform();
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    
    let html = '<div class="smart-actions-container">';
    
    if (platform !== 'unknown') {
        html += `
            <div class="platform-indicator">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="1" r="1"></circle>
                    <circle cx="12" cy="23" r="1"></circle>
                </svg>
                <span>Generating ${platformName} action prompts</span>
            </div>
        `;
    }
    
    if (data.analysis) {
        html += `<div class="analysis-insight">${data.analysis}</div>`;
    }
    
    const prompts = data.action_prompts || data.actions || [];
    
    prompts.forEach((item, index) => {
        const promptText = item.prompt || item.action || '';
        
        html += `
            <div class="action-card">
                <div class="action-prompt">${promptText}</div>
                <button class="action-copy-btn" data-prompt="${promptText.replace(/"/g, '&quot;')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                </button>
            </div>
        `;
    });
    
    html += '</div>';
    outputText.innerHTML = html;
    
    shadowRoot.querySelectorAll('.action-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const prompt = btn.dataset.prompt;
            try {
                await navigator.clipboard.writeText(prompt);
                btn.classList.add('copied');
                
                btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;
                
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                    `;
                }, 2000);
            } catch (err) {
                console.error('Failed to copy:', err);
            }
        });
    });
}

function displaySmartEnhancements(data) {
    hideShimmerLoading();
    outputText.classList.remove('placeholder', 'error');
    
    let html = '<div class="enhancement-container">';
    
    if (data.content_analysis) {
        const analysis = data.content_analysis;
        html += '<div class="content-analysis">';
        html += '<div class="analysis-header">📋 Content Analysis</div>';
        html += '<div class="analysis-details">';
        if (analysis.type) {
            html += '<strong>Type:</strong> ' + escapeHtml(analysis.type) + '<br>';
        }
        if (analysis.purpose) {
            html += '<strong>Purpose:</strong> ' + escapeHtml(analysis.purpose) + '<br>';
        }
        if (analysis.current_quality) {
            html += '<strong>Assessment:</strong> ' + escapeHtml(analysis.current_quality);
        }
        html += '</div></div>';
    }
    
    if (data.enhancement_prompts && data.enhancement_prompts.length > 0) {
        html += '<div class="enhancements-header">✨ Enhancement Prompts</div>';
        
        data.enhancement_prompts.forEach((enhancement, index) => {
            const priorityIcon = enhancement.priority === 'high' ? '🔥' : 
                                enhancement.priority === 'medium' ? '⭐' : '💡';
            
            html += '<div class="enhancement-card">';
            html += '<div class="enhancement-header">';
            html += '<span class="priority-icon">' + priorityIcon + '</span>';
            html += '<span class="focus-area">' + escapeHtml(enhancement.focus_area || 'Enhancement') + '</span>';
            html += '<span class="priority-badge priority-' + (enhancement.priority || 'medium') + '">' + (enhancement.priority || 'medium') + '</span>';
            html += '</div>';
            html += '<div class="enhancement-prompt">' + escapeHtml(enhancement.prompt || '') + '</div>';
            html += '<div class="enhancement-impact">' + escapeHtml(enhancement.expected_impact || '') + '</div>';
            html += '<button class="enhancement-copy-btn" data-prompt="' + escapeHtml(enhancement.prompt || '') + '">';
            html += 'Copy Prompt';
            html += '</button>';
            html += '</div>';
        });
    }
    
    html += '</div>';
    outputText.innerHTML = html;
    
    shadowRoot.querySelectorAll('.enhancement-copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const prompt = btn.dataset.prompt;
            try {
                await navigator.clipboard.writeText(prompt);
                btn.classList.add('copied');
                btn.textContent = 'Copied!';
                
                setTimeout(() => {
                    btn.classList.remove('copied');
                    btn.textContent = 'Copy Prompt';
                }, 2000);
            } catch (err) {
                console.error('Failed to copy enhancement prompt:', err);
                btn.textContent = 'Copy Failed';
                setTimeout(() => {
                    btn.textContent = 'Copy Prompt';
                }, 1000);
            }
        });
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function handleSmartEnhancements(text) {
    const creditCheck = await checkCredits('smart_enhancements');
    if (!creditCheck.success) {
        showError(creditCheck.message || "Please check your account status.");
        return;
    }

    try {
        console.log('=== SMART ENHANCEMENTS DEBUG ===');
        console.log('Input text:', text);
        
        showShimmerLoading('Analyzing content...');
        
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'smart_enhancements',
                data: {
                    text: text
                }
            }, response => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    console.log('Raw response received:', response);
                    resolve(response);
                }
            });
        });

        console.log('Response success:', response?.success);
        console.log('Response data available:', !!response?.data);

        if (!response) {
            throw new Error('No response received from background script');
        }

        if (!response.success) {
            const errorMsg = response.error || 'Unknown error occurred';
            console.error('Background script reported failure:', errorMsg);
            throw new Error(errorMsg);
        }

        if (!response.data) {
            console.error('Response successful but no data provided');
            throw new Error('No data received in response');
        }

        if (!response.data.enhancement_prompts) {
            console.error('Response data missing enhancement_prompts field');
            console.log('Available data fields:', Object.keys(response.data));
            throw new Error('No enhancement prompts found in response');
        }

        console.log('SUCCESS: Smart enhancements generated successfully');
        console.log('Model used:', response.data.model_used);
        console.log('GPT-4.1 used:', response.data.gpt_4_1_used);
        
        displaySmartEnhancements(response.data);
        
        if (response.data.gpt_4_1_used) {
            console.log('✅ GPT-4.1 analysis completed');
        } else {
            console.log('⚡ GPT-4o analysis completed');
        }
        
    } catch (error) {
        console.error('Smart enhancements error:', error);
        
        let userErrorMessage = 'Failed to generate enhancement suggestions';
        
        if (error.message.includes('timeout')) {
            userErrorMessage = 'Enhancement analysis timed out. Please try with shorter text.';
        } else if (error.message.includes('Network error')) {
            userErrorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('No response')) {
            userErrorMessage = 'Connection issue. Please try again.';
        } else if (error.message.length > 0) {
            userErrorMessage = `Failed to generate enhancements: ${error.message}`;
        }
        
        showError(userErrorMessage);
    }
}

async function handlePersonaGeneration(text) {
    try {
        console.log('=== PERSONA GENERATION DEBUG ===');
        console.log('Input text:', text);
        
        showShimmerLoading('Creating persona...');
        
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'enhance_text',
                data: {
                    topic: text,
                    mode: 'persona_generator'
                }
            }, response => {
                if (chrome.runtime.lastError) {
                    console.error('Chrome runtime error:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    console.log('Raw response received:', response);
                    resolve(response);
                }
            });
        });

        console.log('Response success:', response?.success);
        console.log('Response data available:', !!response?.data);

        if (!response) {
            throw new Error('No response received from background script');
        }

        if (!response.success) {
            const errorMsg = response.error || 'Unknown error occurred';
            console.error('Background script reported failure:', errorMsg);
            throw new Error(errorMsg);
        }

        if (!response.data) {
            console.error('Response successful but no data provided');
            throw new Error('No data received in response');
        }

        if (!response.data.prompt) {
            console.error('Response data missing prompt field');
            console.log('Available data fields:', Object.keys(response.data));
            throw new Error('No persona prompt found in response');
        }

        console.log('SUCCESS: Persona generated successfully');
        console.log('AI analyzed:', response.data.metadata?.ai_analyzed);
        console.log('Fallback used:', response.data.metadata?.fallback_used);
        
        updateOutput(response.data.prompt);
        
        if (response.data.metadata?.ai_analyzed) {
            console.log('✅ AI-powered analysis completed');
        } else if (response.data.metadata?.fallback_used) {
            console.log('⚠️ Fallback analysis used (AI analysis failed)');
        }
        
    } catch (error) {
        console.error('Persona generation error:', error);
        
        let userErrorMessage = 'Failed to generate persona';
        
        if (error.message.includes('timeout')) {
            userErrorMessage = 'Persona generation timed out. Please try a simpler role name.';
        } else if (error.message.includes('Network error')) {
            userErrorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('No response')) {
            userErrorMessage = 'Connection issue. Please try again.';
        } else if (error.message.length > 0) {
            userErrorMessage = `Failed to generate persona: ${error.message}`;
        }
        
        showError(userErrorMessage);
    }
}

function showError(message) {
    hideShimmerLoading();
    outputText.classList.add('error');
    outputText.textContent = message;
}

function updateOutput(text) {
    hideShimmerLoading();
    outputText.classList.remove('placeholder');
    outputText.textContent = text;
}

function isImage(element) {
    return element.tagName === 'IMG' && element.src;
}

async function processSelectedText(text) {
    if (!text.trim()) return;
    
    const buttonRect = button.getBoundingClientRect();
    solthronContainer.style.display = 'block';
    solthronContainer.style.pointerEvents = 'auto';
    positionContainer(buttonRect);
    
    // ✅ FIXED: Handle save features WITHOUT loading animation
    if (selectedMode.startsWith('save_')) {
        // Show button animation only, no loading bar
        button.querySelector('.solthron-button').textContent = '...';
        
        // Clear any existing output states
        outputText.classList.remove('placeholder', 'shimmer-loading', 'error');
        outputText.textContent = 'Saving...';
        
        let saveFunction;
        
        if (selectedMode === 'save_note') {
            saveFunction = saveNote;
        } else if (selectedMode === 'save_prompt') {
            saveFunction = savePrompt;
        } else if (selectedMode === 'save_persona') {
            saveFunction = savePersona;
        }
        
        if (await saveFunction(text)) {
            button.querySelector('.solthron-button').textContent = '✓';
            outputText.textContent = 'Saved successfully!';
            
            setTimeout(() => {
                button.querySelector('.solthron-button').textContent = '➤';
                // Open gallery after saving
                closeAllSections();
                const galleryView = shadowRoot.getElementById('gallery-view');
                const galleryBtn = shadowRoot.getElementById('gallery-btn');
                galleryView.style.display = 'block';
                shadowRoot.querySelector('.output-container').style.display = 'none';
                galleryBtn.querySelector('svg').style.stroke = '#00ff00';
            }, 1000);
        } else {
            button.querySelector('.solthron-button').textContent = '✗';
            outputText.textContent = 'Failed to save';
            setTimeout(() => {
                button.querySelector('.solthron-button').textContent = '➤';
            }, 1000);
        }
        return;
    }

    // ✅ Show loading animation only for processing features
    showShimmerLoading('Processing...');

    if (selectedMode.startsWith('image_')) return;

    if (selectedMode === 'smart_enhancements') {
        await handleSmartEnhancements(text);
        return;
    }

    const creditCheck = await checkCredits(selectedMode);
    if (!creditCheck.success) {
        showError(creditCheck.message || "Please check your account status.");
        return;
    }

    handleTextProcessing(text);
}

async function handleTextProcessing(text) {
    // ✅ FIXED: Ensure proper view state when processing
    const galleryView = shadowRoot.getElementById('gallery-view');
    const outputContainer = shadowRoot.querySelector('.output-container');
    
    if (galleryView.style.display === 'block') {
        closeAllSections(); // This will show output container
    }

    showShimmerLoading('Processing...');

    if (selectedMode === 'persona_generator') {
        await handlePersonaGeneration(text);
        return;
    }

    if (selectedMode.startsWith('convert_')) {
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'enhance_text',
                    data: {
                        topic: text,
                        mode: selectedMode,
                        tone: 'professional',
                        length: selectedMode === 'convert_concise' ? 'concise' :
                               selectedMode === 'convert_detailed' ? 'detailed' : 'balanced'
                    }
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                updateOutput(response.data.prompt);
            } else {
                throw new Error(response?.error || 'Failed to convert text');
            }
            return;
        } catch (error) {
            console.error('Convert error:', error);
            showError(error.message || 'Failed to convert text');
            return;
        }
    }

    if (selectedMode.startsWith('explain_')) {
        showShimmerLoading('Processing...');
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'enhance_text',
                    data: {
                        topic: text,
                        mode: selectedMode,
                        tone: 'professional',
                        length: 'balanced'
                    }
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });

            if (response && response.success) {
                updateOutput(response.data.prompt || response.data.explanation);
            } else {
                throw new Error(response?.error || 'Failed to process text');
            }
            return;
        } catch (error) {
            console.error('Explain error:', error);
            showError(error.message || 'Failed to process text');
            return;
        }
    }

    try {
        const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'enhance_text',
                data: {
                    topic: text,
                    tone: selectedMode.includes('technical') ? 'technical' : 
                          selectedMode.includes('casual') ? 'casual' : 
                          selectedMode.includes('professional') ? 'professional' : 
                          detectTone(text),
                    length: selectedMode.includes('concise') ? 'concise' :
                           selectedMode.includes('detailed') ? 'detailed' : 
                           selectedMode.includes('balanced') ? 'balanced' : 'balanced',
                    mode: selectedMode.startsWith('convert_') ? 'convert_prompt' : selectedMode
                }
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });

        if (response && response.success) {
            let formattedOutput = response.data.prompt;
            updateOutput(formattedOutput);
            solthronContainer.style.display = 'block';
        } else {
            showError('Failed to process text');
        }
    } catch (error) {
        showError('Error processing text');
    } finally {
        button.querySelector('.solthron-button').textContent = '➤';
    }
}

// ✨ CREATE SHADOW DOM AND UI
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
    
    // Create shadow root
    shadowRoot = shadowHost.attachShadow({ mode: 'open' });
    
    // CSS styles (completely isolated in shadow DOM)
    const styles = `
        <style>
        /* ✅ ISOLATED CSS - Won't affect the host page */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: Arial, sans-serif !important;
            line-height: normal;
            letter-spacing: normal;
            text-transform: none;
            text-shadow: none !important;
        }

        #solthron-floating-button {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 10000;
            pointer-events: auto;
        }

        .solthron-button {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: #ffff00;
            border: none;
            cursor: move;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2), 0 0 20px rgba(255, 255, 0, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 26px;
            font-weight: 900;
            color: #000000;
            line-height: 1;
            padding: 0;
            transform: translateY(-1px);
        }

        .solthron-button:hover {
            box-shadow: 0 2px 5px rgba(0,0,0,0.2), 0 0 25px rgba(255, 255, 0, 0.4);
        }

        .solthron-container {
            position: fixed;
            width: 320px;
            background: #1a1a1a;
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            z-index: 10000;
            pointer-events: auto;
            display: none;
        }

        .solthron-content {
            padding: 12px;
            position: relative;
        }

        .solthron-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }

        .mode-dropdown {
            position: relative;
            flex: 1;
            margin-right: 12px;
        }

        .mode-select {
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px !important;
            padding: 6px 8px;
            cursor: pointer;
            -webkit-appearance: none;
            padding-right: 24px;
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
            background-repeat: no-repeat;
            background-position: right 8px center;
            background-size: 12px;
            max-height: 100px;
            overflow-y: auto;
        }

        .mode-select::-webkit-scrollbar {
            width: 6px;
        }

        .mode-select::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .mode-select::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .mode-select::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        .mode-select:hover {
            background-color: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.3);
        }

        .mode-select:focus {
            outline: none;
            border-color: rgba(255, 255, 0, 0.5);
            box-shadow: 0 0 0 2px rgba(255, 255, 0, 0.2);
        }

        .mode-select option {
            background-color: #2a2a2a !important;
            color: rgba(255, 255, 255, 0.9);
            padding: 8px;
            font-size: 13px !important;
        }

        .mode-select optgroup {
            background: #2a2a2a;
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px !important;
            font-weight: 500;
            padding: 8px 4px;
        }

        .mode-select optgroup option {
            background: #2a2a2a;
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px !important;
            padding: 8px 12px;
            margin-left: 8px;
        }

        .header-icons {
            display: flex;
            gap: 4px;
        }

        .icon-button {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: #fff;
            opacity: 0.7;
            transition: opacity 0.2s;
        }

        .icon-button:hover {
            opacity: 1;
        }

        .output-container {
            position: relative;
        }

        .output-text {
            background: #2a2a2a;
            color: #fff !important;
            padding: 12px;
            border-radius: 6px;
            min-height: 60px;
            max-height: 150px;
            line-height: 1.4 !important;
            font-size: 13px !important;
            overflow-y: auto;
            white-space: pre-wrap;
        }

        .output-text.placeholder {
            color: rgba(255, 255, 255, 0.4) !important;
            font-style: italic;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
        }

        .output-text.error {
            color: #ff6b6b;
            border: 1px solid rgba(255, 107, 107, 0.3);
        }

        .output-text::-webkit-scrollbar {
            width: 6px;
        }

        .output-text::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .output-text::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .output-text::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        /* Loading Bar Effect */
        .output-text.shimmer-loading {
            background: #2a2a2a !important;
            color: rgba(255, 255, 255, 0.8) !important;
            position: relative;
            padding-bottom: 20px !important;
        }

        .output-text.shimmer-loading::after {
            content: '';
            position: absolute;
            bottom: 8px;
            left: 12px;
            right: 12px;
            height: 3px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 2px;
            overflow: hidden;
        }

        .output-text.shimmer-loading::before {
            content: '';
            position: absolute;
            bottom: 8px;
            left: 12px;
            height: 3px;
            width: 30%;
            background: linear-gradient(
                90deg,
                transparent 0%,
                #ffff00 30%,
                #fff700 70%,
                transparent 100%
            );
            border-radius: 2px;
            animation: loading-sweep 1.5s infinite linear;
            z-index: 1;
            will-change: transform;
        }

        @keyframes loading-sweep {
            0% {
                transform: translateX(-100%);
            }
            100% {
                transform: translateX(300%);
            }
        }

        /* Double-Click Animation */
        .solthron-button.double-click-activated {
            animation: 
                solthronBounce 0.6s ease-out,
                solthronGlow 0.6s ease-out;
        }

        @keyframes solthronBounce {
            0% { transform: scale(1) translateY(-1px); }
            15% { transform: scale(0.85) translateY(-1px); }
            35% { transform: scale(1.25) translateY(-1px); }
            55% { transform: scale(0.95) translateY(-1px); }
            75% { transform: scale(1.05) translateY(-1px); }
            100% { transform: scale(1) translateY(-1px); }
        }

        @keyframes solthronGlow {
            0% { 
                box-shadow: 
                    0 2px 5px rgba(0,0,0,0.2), 
                    0 0 20px rgba(255, 255, 0, 0.3),
                    0 0 0 0 rgba(255, 255, 0, 0.3);
            }
            40% {
                box-shadow: 
                    0 2px 5px rgba(0,0,0,0.2), 
                    0 0 25px rgba(255, 255, 0, 0.4),
                    0 0 0 8px rgba(255, 255, 0, 0.2);
            }
            70% { 
                box-shadow: 
                    0 2px 5px rgba(0,0,0,0.2), 
                    0 0 30px rgba(255, 255, 0, 0.5),
                    0 0 0 15px rgba(255, 255, 0, 0);
            }
            100% { 
                box-shadow: 
                    0 2px 5px rgba(0,0,0,0.2), 
                    0 0 20px rgba(255, 255, 0, 0.3),
                    0 0 0 0 rgba(255, 255, 0, 0);
            }
        }

        /* Gallery Styles */
        .gallery-view {
            background: #2a2a2a;
            border-radius: 6px;
            margin-top: 12px;
        }

        .gallery-header {
            padding: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .gallery-header h3 {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px !important;
            font-weight: 500;
            margin-bottom: 8px;
        }

        .gallery-search input {
            width: 100%;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            padding: 6px 8px;
            color: white;
            font-size: 12px !important;
        }

        .gallery-search input:focus {
            outline: none;
            border-color: rgba(255, 255, 0, 0.5);
            box-shadow: 0 0 0 2px rgba(255, 255, 0, 0.2);
        }

        .gallery-list {
            max-height: 153px;
            overflow-y: auto;
            padding: 8px;
        }

        .gallery-item {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            padding: 6px 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            height: 45px;
            overflow: hidden;
        }

        .gallery-item:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }

        .gallery-item-text {
            color: rgba(255, 255, 255, 0.8);
            font-size: 11px !important;
            line-height: 1.2;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .gallery-item-actions {
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s ease;
        }

        .gallery-item:hover .gallery-item-actions {
            opacity: 1;
        }

        .gallery-copy-btn,
        .gallery-delete-btn,
        .gallery-star-btn {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.6);
            transition: all 0.2s ease;
        }

        .gallery-star-btn:hover {
            color: rgba(255, 255, 255, 0.9);
        }

        .gallery-star-btn.active {
            color: #ffff00;
        }

        .gallery-star-btn.active svg {
            filter: drop-shadow(0 0 2px rgba(255, 255, 0, 0.5));
        }

        .gallery-copy-btn:hover,
        .gallery-delete-btn:hover {
            color: rgba(255, 255, 255, 0.9);
        }

        .gallery-delete-btn:hover {
            color: #ff6b6b;
        }

        .gallery-copy-btn.copied {
            color: #00ff00;
        }

        .gallery-list::-webkit-scrollbar {
            width: 6px;
        }

        .gallery-list::-webkit-scrollbar-track {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 3px;
        }

        .gallery-list::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }

        .gallery-list::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        /* Category Selection */
        .category-selection {
            padding: 16px;
            margin-bottom: 8px;
        }

        .category-item {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .category-item:hover {
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
        }

        .category-title {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px !important;
            font-weight: 500;
            text-align: center;
        }

        .gallery-title-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .back-to-categories {
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.7);
            transition: color 0.2s ease;
        }

        .back-to-categories:hover {
            color: rgba(255, 255, 255, 0.9);
        }

        #gallery-content {
            transition: opacity 0.2s ease;
        }

        #gallery-content.hiding {
            opacity: 0;
        }

        #gallery-content.showing {
            opacity: 1;
        }

        #gallery-btn svg {
            transition: stroke 0.2s ease;
        }

        #gallery-btn.active svg {
            stroke: #00ff00;
        }

        /* Profile Styles */
        .profile-view {
            background: #2a2a2a;
            border-radius: 6px;
            margin-top: 12px;
            max-height: 350px;
            overflow-y: auto;
        }

        .profile-header {
            padding: 12px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .profile-header h3 {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px;
            font-weight: 500;
            margin: 0;
        }

        .close-profile {
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            cursor: pointer;
            padding: 4px;
        }

        .profile-details {
            padding: 16px;
        }

        .loading-profile {
            color: rgba(255, 255, 255, 0.6);
            text-align: center;
            padding: 20px 0;
            font-style: italic;
        }

        .profile-info {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .profile-field {
            display: flex;
            flex-direction: column;
            padding-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .field-label {
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            margin-bottom: 4px;
        }

        .field-value {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px;
        }

        .profile-field.credits {
            margin-top: 8px;
        }

        .credits .field-value {
            color: #ffff00;
            font-weight: 500;
            font-size: 16px;
        }

        .login-prompt {
            text-align: center;
            padding: 20px 0;
        }

        .login-button, .logout-button {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            color: rgba(255, 255, 255, 0.9);
            padding: 8px 16px;
            margin-top: 10px;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
        }

        .login-button:hover, .logout-button:hover {
            background: rgba(255, 255, 255, 0.15);
        }

        .logout-button {
            margin-top: 20px;
        }

        .login-form {
            padding: 10px;
        }

        .form-group {
            margin-bottom: 12px;
        }

        .form-group label {
            display: block;
            color: rgba(255, 255, 255, 0.8);
            font-size: 12px;
            margin-bottom: 4px;
        }

        .form-group input {
            width: 100%;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background: rgba(255, 255, 255, 0.1);
            color: white;
            font-size: 13px;
        }

        .form-group input:focus {
            outline: none;
            border-color: rgba(255, 255, 0, 0.5);
            box-shadow: 0 0 0 2px rgba(255, 255, 0, 0.2);
        }

        .form-actions {
            margin-top: 15px;
        }

        .login-button {
            background: #3c78d8;
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s ease;
            width: 100%;
        }

        .login-button:hover {
            background: #4285f4;
        }

        .error-message {
            color: #ff6b6b;
            font-size: 12px;
            margin-top: 8px;
            min-height: 16px;
        }

        .signup-link {
            margin-top: 15px;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            padding-top: 12px;
        }

        .signup-link p {
            color: rgba(255, 255, 255, 0.6);
            font-size: 12px;
            margin-bottom: 5px;
        }

        .signup-link a {
            color: #3c78d8;
            text-decoration: none;
            font-size: 12px;
            font-weight: 500;
        }

        .signup-link a:hover {
            text-decoration: underline;
        }

        /* Smart Followups & Actions */
        .smart-followups-container,
        .smart-actions-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 4px;
        }

        .followup-card,
        .action-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px;
            position: relative;
            transition: all 0.2s ease;
            min-height: 50px;
            display: flex;
            align-items: center;
        }

        .followup-card:hover,
        .action-card:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 0, 0.3);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .followup-question,
        .action-prompt {
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px !important;
            line-height: 1.4;
            padding-right: 36px;
            flex: 1;
        }

        .followup-copy-btn,
        .action-copy-btn {
            position: absolute;
            top: 50%;
            right: 12px;
            transform: translateY(-50%);
            background: none;
            border: none;
            padding: 4px;
            cursor: pointer;
            color: rgba(255, 255, 255, 0.5);
            transition: all 0.2s ease;
        }

        .followup-copy-btn:hover,
        .action-copy-btn:hover {
            color: rgba(255, 255, 255, 0.8);
        }

        .followup-copy-btn.copied,
        .action-copy-btn.copied {
            color: #00ff00;
        }

        .followup-copy-btn.copied svg,
        .action-copy-btn.copied svg {
            filter: drop-shadow(0 0 3px rgba(0, 255, 0, 0.5));
        }

        .analysis-insight {
            background: rgba(255, 255, 0, 0.1);
            border: 1px solid rgba(255, 255, 0, 0.2);
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
            color: rgba(255, 255, 255, 0.8);
            font-size: 12px !important;
            font-style: italic;
            line-height: 1.4;
        }

        .platform-indicator {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 8px;
            padding: 6px 10px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
            font-size: 11px !important;
            color: rgba(255, 255, 255, 0.6);
        }

        .platform-indicator svg {
            width: 14px;
            height: 14px;
        }

        /* Smart Enhancements */
        .enhancement-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 4px;
        }

        .content-analysis {
            background: rgba(255, 255, 0, 0.1);
            border: 1px solid rgba(255, 255, 0, 0.2);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 8px;
        }

        .analysis-header {
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px !important;
            font-weight: 500;
            margin-bottom: 6px;
        }

        .analysis-details {
            color: rgba(255, 255, 255, 0.8);
            font-size: 12px !important;
            line-height: 1.4;
        }

        .enhancements-header {
            color: rgba(255, 255, 255, 0.9);
            font-size: 14px !important;
            font-weight: 500;
            margin: 8px 0;
            text-align: center;
        }

        .enhancement-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 14px;
            position: relative;
            transition: all 0.2s ease;
            margin-bottom: 8px;
        }

        .enhancement-card:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 0, 0.3);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .enhancement-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }

        .priority-icon {
            font-size: 14px;
        }

        .focus-area {
            color: rgba(255, 255, 255, 0.7);
            font-size: 11px !important;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            flex: 1;
        }

        .priority-badge {
            font-size: 10px !important;
            padding: 2px 6px;
            border-radius: 3px;
            text-transform: uppercase;
            font-weight: 500;
        }

        .priority-high {
            background: rgba(255, 67, 54, 0.2);
            color: #ff6b6b;
            border: 1px solid rgba(255, 67, 54, 0.3);
        }

        .priority-medium {
            background: rgba(255, 193, 7, 0.2);
            color: #ffc107;
            border: 1px solid rgba(255, 193, 7, 0.3);
        }

        .priority-low {
            background: rgba(76, 175, 80, 0.2);
            color: #4caf50;
            border: 1px solid rgba(76, 175, 80, 0.3);
        }

        .enhancement-prompt {
            color: rgba(255, 255, 255, 0.9);
            font-size: 13px !important;
            line-height: 1.5;
            margin-bottom: 8px;
            padding: 8px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 4px;
            border-left: 3px solid rgba(255, 255, 0, 0.3);
        }

        .enhancement-impact {
            color: rgba(255, 255, 255, 0.6);
            font-size: 11px !important;
            font-style: italic;
            margin-bottom: 10px;
        }

        .enhancement-copy-btn {
            background: rgba(255, 255, 0, 0.1);
            border: 1px solid rgba(255, 255, 0, 0.3);
            border-radius: 4px;
            color: rgba(255, 255, 255, 0.9);
            padding: 6px 12px;
            font-size: 11px !important;
            cursor: pointer;
            transition: all 0.2s ease;
            text-transform: uppercase;
            font-weight: 500;
            letter-spacing: 0.5px;
        }

        .enhancement-copy-btn:hover {
            background: rgba(255, 255, 0, 0.2);
            border-color: rgba(255, 255, 0, 0.5);
            transform: translateY(-1px);
        }

        .enhancement-copy-btn.copied {
            background: rgba(76, 175, 80, 0.2);
            border-color: rgba(76, 175, 80, 0.5);
            color: #4caf50;
        }

        /* Responsive */
        @media screen and (max-width: 480px) {
            .solthron-container {
                width: 90vw;
                max-width: 320px;
            }
        }
        </style>
    `;
    
    // HTML content
    const htmlContent = `
        <div id="solthron-floating-button">
            <button class="solthron-button">➤</button>
        </div>
        
        <div id="solthron-container" class="solthron-container" style="display: none;">
            <div class="solthron-content">
                <div class="solthron-header">
                    <div class="mode-dropdown">
                        <select class="mode-select">
                            <optgroup label="Text Processing">
                                <option value="reframe_casual">Reframe as Casual</option>
                                <option value="reframe_technical">Reframe as Technical</option>
                                <option value="reframe_professional">Reframe as Professional</option>
                                <option value="reframe_eli5">Reframe for a 5 Year Old</option>
                                <option value="reframe_short">Reframe as Short</option>
                                <option value="reframe_long">Reframe as Long</option>
                            </optgroup>
                            <optgroup label="Convert into Prompt">
                                <option value="convert_concise">Convert to Concise Prompt</option>
                                <option value="convert_balanced">Convert to Balanced Prompt</option>
                                <option value="convert_detailed">Convert to Detailed Prompt</option>
                            </optgroup>
                            <optgroup label="Persona Generator">
                                <option value="persona_generator">Generate AI Persona</option>
                            </optgroup>
                            <optgroup label="Storage">
                                <option value="save_note">Save as Notes</option>
                                <option value="save_prompt">Save as Prompt</option>
                                <option value="save_persona">Save Persona</option>
                            </optgroup>
                            <optgroup label="Image">
                                <option value="image_prompt">Image to Prompt</option>
                                <option value="image_caption">Image to Caption</option>
                            </optgroup>
                            <optgroup label="Explain">
                                <option value="explain_meaning">Explain Meaning</option>
                                <option value="explain_story">Explain with a Story</option>
                                <option value="explain_eli5">Explain to a 5 Year Old</option>
                            </optgroup>
                            <optgroup label="AI Assistant">
                                <option value="smart_followups">Smart Follow-ups</option>
                                <option value="smart_actions">Smart Actions</option>
                                <option value="smart_enhancements">Smart Enhancements</option>
                                <option value="auto_suggestion">Auto Suggestion</option>
                            </optgroup>
                        </select>
                    </div>
                    <div class="header-icons">
                        <button id="profile-btn" class="icon-button">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </button>
                        <button id="gallery-btn" class="icon-button">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                        </button>
                        <button id="copy-btn" class="icon-button">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                        </button>
                        <button id="close-btn" class="icon-button">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="output-container">
                    <div id="output-text" class="output-text placeholder">
                        Please highlight text or right-click an image to begin...
                    </div>
                </div>
                <div id="gallery-view" class="gallery-view" style="display: none;">
                    <div id="category-selection" class="category-selection">
                        <div class="category-item" data-category="prompts">
                            <div class="category-title">Prompts</div>
                        </div>
                        <div class="category-item" data-category="notes">
                            <div class="category-title">Notes</div>
                        </div>
                        <div class="category-item" data-category="personas">
                            <div class="category-title">Personas</div>
                        </div>
                    </div>
                    <div id="gallery-content" style="display: none;">
                        <div class="gallery-header">
                            <div class="gallery-title-row">
                                <h3 id="gallery-title">Saved Items</h3>
                                <button class="back-to-categories">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M19 12H5"/>
                                        <path d="M12 19l-7-7 7-7"/>
                                    </svg>
                                </button>
                            </div>
                            <div class="gallery-search">
                                <input type="text" placeholder="Search..." id="gallery-search">
                            </div>
                        </div>
                        <div class="gallery-list" id="gallery-list"></div>
                    </div>
                </div>
                <div id="profile-view" class="profile-view" style="display: none;">
                    <div class="profile-header">
                        <h3>Account</h3>
                        <button class="close-profile">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div id="login-container" class="login-form">
                        <div class="login-prompt">
                            <p>Login to access premium features and credit management.</p>
                            <button id="login-button" class="login-button">Login via Solthron.com</button>
                        </div>
                        <div id="login-error" class="error-message"></div>
                        <div class="signup-link">
                            <p>Don't have an account?</p>
                            <a href="https://solthron.com/signup" target="_blank">Sign up</a>
                        </div>
                    </div>
                    <div id="profile-details" class="profile-details" style="display: none;">
                        <!-- Will show user details when logged in -->
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Inject styles and HTML into shadow root
    shadowRoot.innerHTML = styles + htmlContent;
    
    // Get references to elements within shadow DOM
    button = shadowRoot.querySelector('#solthron-floating-button');
    outputText = shadowRoot.querySelector('#output-text');
    solthronContainer = shadowRoot.querySelector('#solthron-container');
    
    // Initialize UI handlers and gallery
    initializeUIHandlers();
    initializeGallery();
}

function initializeGallery() {
    const galleryBtn = shadowRoot.getElementById('gallery-btn');
    const galleryView = shadowRoot.getElementById('gallery-view');
    const categorySelection = shadowRoot.getElementById('category-selection');
    const galleryContent = shadowRoot.getElementById('gallery-content');
    const searchInput = shadowRoot.getElementById('gallery-search');
    const outputContainer = shadowRoot.querySelector('.output-container');
 
    galleryBtn.addEventListener('click', () => {
        const isVisible = galleryView.style.display !== 'none';
        
        if (isVisible) {
            // Close gallery and show output
            closeAllSections();
        } else {
            // Close all other sections and show gallery
            closeAllSections();
            galleryView.style.display = 'block';
            outputContainer.style.display = 'none';
            galleryBtn.querySelector('svg').style.stroke = '#00ff00';
            
            // Reset to category selection
            categorySelection.style.display = 'block';
            galleryContent.style.display = 'none';
            currentCategory = null;
        }
    });
 
    shadowRoot.querySelectorAll('.category-item').forEach(item => {
        item.addEventListener('click', async () => {
            currentCategory = item.dataset.category;
            categorySelection.style.display = 'none';
            galleryContent.style.display = 'block';
            
            const galleryTitle = shadowRoot.getElementById('gallery-title');
            galleryTitle.textContent = currentCategory === 'prompts' ? 'Saved Prompts' : 
                                     currentCategory === 'notes' ? 'Saved Notes' : 
                                     'Persona Templates';
            
            const items = await (
                currentCategory === 'prompts' ? loadPrompts() :
                currentCategory === 'notes' ? loadNotes() :
                loadPersonaTemplates()
            );
            renderGalleryList(items, '');
        });
    });
 
    shadowRoot.querySelector('.back-to-categories').addEventListener('click', () => {
        categorySelection.style.display = 'block';
        galleryContent.style.display = 'none';
        currentCategory = null;
        // Keep gallery view open, just go back to categories
    });
 
    searchInput.addEventListener('input', async (e) => {
        if (!currentCategory) return;
        const items = await (
            currentCategory === 'prompts' ? loadPrompts() :
            currentCategory === 'notes' ? loadNotes() :
            loadPersonaTemplates()
        );
        renderGalleryList(items, e.target.value);
    });
}

function renderGalleryList(items, searchTerm = '') {
    const galleryList = shadowRoot.getElementById('gallery-list');
    const filteredItems = searchTerm ? 
        items.filter(item => {
            if (currentCategory === 'personas') {
                return item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       item.prompt.toLowerCase().includes(searchTerm.toLowerCase());
            }
            return item.text.toLowerCase().includes(searchTerm.toLowerCase());
        }) : items;
 
    galleryList.innerHTML = filteredItems.map(item => {
        if (currentCategory === 'personas') {
            return `
                <div class="gallery-item" data-id="${item.id}">
                    <div class="gallery-item-text">${item.title}</div>
                    <div class="gallery-item-actions">
                        <button class="gallery-copy-btn" data-id="${item.id}" data-type="persona">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                            </svg>
                        </button>
                        ${item.source !== 'built_in' ? `
                            <button class="gallery-delete-btn" data-id="${item.id}">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M3 6h18"></path>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }
 
        return `
            <div class="gallery-item" data-id="${item.id}">
                <div class="gallery-item-text">${item.text?.substring(0, 100)}${item.text?.length > 100 ? '...' : ''}</div>
                <div class="gallery-item-actions">
                    ${currentCategory === 'notes' ? `
                        <button class="gallery-star-btn ${activeNoteId === item.id ? 'active' : ''}" data-id="${item.id}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="${activeNoteId === item.id ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                            </svg>
                        </button>
                    ` : ''}
                    <button class="gallery-copy-btn" data-id="${item.id}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                        </svg>
                    </button>
                    <button class="gallery-delete-btn" data-id="${item.id}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18"></path>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    attachGalleryEventListeners(galleryList);
}

function attachGalleryEventListeners(galleryList) {
    galleryList.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (!e.target.closest('button')) {
                const itemId = item.dataset.id;
                const items = await (
                    currentCategory === 'prompts' ? loadPrompts() :
                    currentCategory === 'notes' ? loadNotes() :
                    loadPersonaTemplates()
                );
                const selectedItem = items.find(i => i.id === itemId);
                if (selectedItem) {
                    // ✅ FIXED: Display content instantly without loading animation
                    hideShimmerLoading(); // Remove any existing shimmer
                    
                    if (currentCategory === 'personas') {
                        outputText.textContent = `Title: ${selectedItem.title}\n\nPrompt: ${selectedItem.prompt}\n\nExample: ${selectedItem.example}\n\nResponse: ${selectedItem.response}`;
                    } else {
                        outputText.textContent = selectedItem.text;
                    }
                    
                    // Close gallery and show output
                    closeAllSections();
                    outputText.classList.remove('placeholder', 'shimmer-loading', 'error');
                }
            }
        });
    });

    galleryList.querySelectorAll('.gallery-copy-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.id;
            const items = await (
                currentCategory === 'prompts' ? loadPrompts() :
                currentCategory === 'notes' ? loadNotes() :
                loadPersonaTemplates()
            );
            const selectedItem = items.find(i => i.id === itemId);
            if (selectedItem) {
                const textToCopy = currentCategory === 'personas' ?
                    `${selectedItem.prompt}` :
                    selectedItem.text;
                    
                await navigator.clipboard.writeText(textToCopy);
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1000);
            }
        });
    });

    if (currentCategory === 'notes') {
        galleryList.querySelectorAll('.gallery-star-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const noteId = btn.dataset.id;
                
                if (activeNoteId === noteId) {
                    activeNoteId = null;
                    isStarActive = false;
                    btn.querySelector('svg').setAttribute('fill', 'none');
                    btn.classList.remove('active');
                } else {
                    const prevStar = galleryList.querySelector('.gallery-star-btn.active');
                    if (prevStar) {
                        prevStar.querySelector('svg').setAttribute('fill', 'none');
                        prevStar.classList.remove('active');
                    }
                    
                    activeNoteId = noteId;
                    isStarActive = true;
                    btn.querySelector('svg').setAttribute('fill', 'currentColor');
                    btn.classList.add('active');
                }
            });
        });
    }

    galleryList.querySelectorAll('.gallery-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.dataset.id;
            
            let deleteFunction;
            let reloadFunction;
            
            if (currentCategory === 'prompts') {
                deleteFunction = deletePrompt;
                reloadFunction = loadPrompts;
            } else if (currentCategory === 'notes') {
                deleteFunction = deleteNote;
                reloadFunction = loadNotes;
            } else if (currentCategory === 'personas') {
                deleteFunction = deletePersona;
                reloadFunction = loadPersonaTemplates;
            }
            
            if (await deleteFunction(itemId)) {
                const items = await reloadFunction();
                renderGalleryList(items, shadowRoot.getElementById('gallery-search').value);
            }
        });
    });
}

function positionContainer(buttonRect) {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    solthronContainer.style.width = '320px';
    solthronContainer.style.maxHeight = '400px';
    
    let leftPosition = buttonRect.right - 320;
    let topPosition = buttonRect.top - 10;
    
    if (leftPosition < 10) {
        leftPosition = 10;
    } else if (leftPosition + 320 > windowWidth - 10) {
        leftPosition = windowWidth - 330;
    }
    
    const containerHeight = 400;
    if (topPosition + containerHeight > windowHeight - 10) {
        topPosition = windowHeight - containerHeight - 10;
    }
    
    if (topPosition < 10) {
        topPosition = 10;
    }
    
    solthronContainer.style.position = 'fixed';
    solthronContainer.style.left = `${leftPosition}px`;
    solthronContainer.style.top = `${topPosition}px`;
    solthronContainer.style.zIndex = '10001';
    
    solthronContainer.style.transform = 'none';
    solthronContainer.style.opacity = '0';
    
    solthronContainer.style.transition = 'opacity 0.2s ease';
    
    requestAnimationFrame(() => {
        solthronContainer.style.opacity = '1';
    });
}

function initializeUIHandlers() {
    let isDragging = false;
    let currentX;
    let currentY;
    let clickCount = 0;
    let clickTimer = null;
    let lastResult = localStorage.getItem('solthron-last-result');

    const copyBtn = shadowRoot.querySelector('#copy-btn');
    const closeBtn = shadowRoot.querySelector('#close-btn');
    const modeSelect = shadowRoot.querySelector('.mode-select');

    selectedMode = localStorage.getItem('solthron-mode') || 'reframe_casual';
    modeSelect.value = selectedMode;
    solthronContainer.style.display = 'none';
    solthronContainer.style.pointerEvents = 'none';

    if (lastResult) {
        outputText.classList.remove('placeholder');
        outputText.textContent = lastResult;
    }

    button.addEventListener('mousedown', (e) => {
        isDragging = true;
        currentX = e.clientX - button.offsetLeft;
        currentY = e.clientY - button.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            button.style.left = `${e.clientX - currentX}px`;
            button.style.top = `${e.clientY - currentY}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    button.addEventListener('click', async (e) => {
        e.stopPropagation();
        clickCount++;

        if (clickCount === 1) {
            clickTimer = setTimeout(() => {
                clickCount = 0;
            }, 300);
        } else if (clickCount === 2) {
            clearTimeout(clickTimer);
            clickCount = 0;
            
            triggerDoubleClickAnimation();
            
            if (!isDragging) {
                const selectedText = window.getSelection().toString().trim();

                if (!selectedText || selectedMode === 'image' || selectedMode === 'smart_followups' || selectedMode === 'smart_actions') {
                    if (lastResult && selectedMode !== 'smart_followups' && selectedMode !== 'smart_actions' && selectedMode !== 'smart_enhancements') {
                        outputText.classList.remove('placeholder');
                        outputText.textContent = lastResult;
                    } else {
                        outputText.classList.add('placeholder');
                        const placeholderMessages = {
                            image_prompt: 'Right-click an image to generate a prompt...',
                            image_caption: 'Right-click an image to generate a caption...',
                            save_note: 'Highlight text and double-click to save as note...',
                            save_prompt: 'Highlight text and double-click to save as prompt...',
                            save_persona: 'Highlight text and double-click to save as persona...',
                            smart_followups: 'Right-click on an AI chat page to generate follow-up questions...',
                            smart_actions: 'Right-click on an AI chat page to generate actionable steps...',
                            smart_enhancements: 'Highlight text and double-click to get enhancement suggestions...',
                            persona_generator: 'Highlight a keyword and double-click to generate an AI persona...',
                            default: 'Highlight text to begin...'
                        };
                        outputText.textContent = placeholderMessages[selectedMode] || placeholderMessages.default;
                    }
                    const buttonRect = button.getBoundingClientRect();
                    solthronContainer.style.display = 'block';
                    solthronContainer.style.pointerEvents = 'auto';
                    positionContainer(buttonRect);
                    return;
                }
                
                await processSelectedText(selectedText);
            }
        }
    });

    modeSelect.addEventListener('change', (e) => {
        selectedMode = e.target.value;
        localStorage.setItem('solthron-mode', selectedMode);
        outputText.classList.add('placeholder');
    
        // Handle auto suggestion mode
        if (selectedMode === 'auto_suggestion') {
            isAutoModeActive = true;
            hasProcessedFirstInput = false;
            autoModeStartTime = Date.now();
            
            showAutoModePopup('Auto mode activated', 2000);
            setTimeout(() => setupAutoModeDetection(), 1000);
            
            outputText.textContent = 'Auto mode active - I\'ll help you optimize your conversation!';
        } else {
            // Deactivate auto mode if switching to another mode
            isAutoModeActive = false;
            hasProcessedFirstInput = false;
            autoModeStartTime = null;
            
            const placeholderMessages = {
                image_prompt: 'Right-click an image to generate a prompt...',
                image_caption: 'Right-click an image to generate a caption...',
                save_note: 'Highlight text and double-click to save as note...',
                save_prompt: 'Highlight text and double-click to save as prompt...',
                save_persona: 'Highlight text and double-click to save as persona...',
                smart_followups: 'Right-click on an AI chat page to generate follow-up questions...',
                smart_actions: 'Right-click on an AI chat page to generate actionable steps...',
                smart_enhancements: 'Highlight text and double-click to get enhancement suggestions...',
                persona_generator: 'Highlight a keyword and double-click to generate an AI persona...',
                default: 'Highlight text to begin...'
            };
    
            outputText.textContent = placeholderMessages[selectedMode] || placeholderMessages.default;
        }
        
        lastResult = null;
        localStorage.removeItem('solthron-last-result');
    });

    copyBtn.addEventListener('click', async () => {
        if (outputText.classList.contains('placeholder')) return;
        
        try {
            if (selectedMode === 'smart_followups' && outputText.querySelector('.smart-followups-container')) {
                const questions = Array.from(outputText.querySelectorAll('.followup-question'))
                    .map(q => q.textContent)
                    .join('\n\n');
                await navigator.clipboard.writeText(questions);
            } else if (selectedMode === 'smart_actions' && outputText.querySelector('.smart-actions-container')) {
                const prompts = Array.from(outputText.querySelectorAll('.action-prompt'))
                    .map((prompt, index) => `${index + 1}. ${prompt.textContent}`)
                    .join('\n\n');
                await navigator.clipboard.writeText(prompts);
            } else if (selectedMode === 'smart_enhancements' && outputText.querySelector('.enhancement-container')) {
                const prompts = Array.from(outputText.querySelectorAll('.enhancement-prompt'))
                    .map(p => p.textContent)
                    .join('\n\n');
                await navigator.clipboard.writeText(prompts);
            } else {
                await navigator.clipboard.writeText(outputText.textContent);
            }
            
            const checkIcon = copyBtn.querySelector('svg');
            checkIcon.style.stroke = '#00ff00';
            copyBtn.classList.add('copied');
            
            setTimeout(() => {
                solthronContainer.style.display = 'none';
                solthronContainer.style.pointerEvents = 'none';
                checkIcon.style.stroke = 'currentColor';
                copyBtn.classList.remove('copied');
            }, 1000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });

    closeBtn.addEventListener('click', () => {
        solthronContainer.style.display = 'none';
        solthronContainer.style.pointerEvents = 'none';
        // Reset view state when closing
        closeAllSections();
    });

    // ✅ FIXED: Handle clicks inside shadow DOM properly
    solthronContainer.addEventListener('click', (e) => {
        // Stop clicks inside container from bubbling to document
        e.stopPropagation();
    });

    // Document click handler for closing container (outside clicks)
    document.addEventListener('click', (e) => {
        // In Shadow DOM, we need to check if click is outside the shadow host
        const shadowHost = shadowRoot.host;
        if (!shadowHost.contains(e.target) && 
            solthronContainer.style.display === 'block') {
            solthronContainer.style.display = 'none';
            solthronContainer.style.pointerEvents = 'none';
        }
    });
}

// ✅ FIXED: Add exclusive view management
function closeAllSections() {
    const profileView = shadowRoot.getElementById('profile-view');
    const galleryView = shadowRoot.getElementById('gallery-view');
    const outputContainer = shadowRoot.querySelector('.output-container');
    const profileBtn = shadowRoot.getElementById('profile-btn');
    const galleryBtn = shadowRoot.getElementById('gallery-btn');
    
    // Close all views
    profileView.style.display = 'none';
    galleryView.style.display = 'none';
    outputContainer.style.display = 'block';
    
    // Reset all icon colors
    profileBtn.querySelector('svg').style.stroke = 'currentColor';
    galleryBtn.querySelector('svg').style.stroke = 'currentColor';
}

function initializeProfileHandlers() {
    const profileBtn = shadowRoot.getElementById('profile-btn');
    const profileView = shadowRoot.getElementById('profile-view');
    const closeProfile = shadowRoot.querySelector('.close-profile');
    const loginContainer = shadowRoot.getElementById('login-container');
    const profileDetails = shadowRoot.getElementById('profile-details');
    const loginButton = shadowRoot.getElementById('login-button');
    const loginError = shadowRoot.getElementById('login-error');
    
    checkAuthState();
    
    async function checkAuthState() {
        const isLoggedIn = await BackendAuth.isLoggedIn();
        updateProfileView(isLoggedIn);
    }
    
    profileBtn.addEventListener('click', () => {
        const isVisible = profileView.style.display !== 'none';
        
        if (isVisible) {
            // Close profile and show output
            closeAllSections();
        } else {
            // Close all other sections and show profile
            closeAllSections();
            profileView.style.display = 'block';
            shadowRoot.querySelector('.output-container').style.display = 'none';
            profileBtn.querySelector('svg').style.stroke = '#00ff00';
            
            checkAuthState();
        }
    });
    
    closeProfile.addEventListener('click', () => {
        closeAllSections();
    });
    
    loginButton.addEventListener('click', async (e) => {
        e.preventDefault();
        
        try {
            const extensionId = chrome.runtime.id;
            const loginUrl = `https://solthron.com/login?extension=true&extensionId=${extensionId}`;
            window.open(loginUrl, '_blank');
            
        } catch (error) {
            console.error('Login redirect error:', error);
            showLoginError('Failed to open login page');
        }
    });
    
    async function updateProfileView(isLoggedIn = null) {
        if (isLoggedIn === null) {
            isLoggedIn = await BackendAuth.isLoggedIn();
        }
        
        if (isLoggedIn) {
            loginContainer.style.display = 'none';
            profileDetails.style.display = 'block';
            
            try {
                const credits = await BackendAuth.getUserCredits();
                
                profileDetails.innerHTML = `
                    <div class="profile-info">
                        <div class="profile-field">
                            <div class="field-label">Status</div>
                            <div class="field-value">Logged In</div>
                        </div>
                        <div class="profile-field">
                            <div class="field-label">Account</div>
                            <div class="field-value">Active</div>
                        </div>
                        <div class="profile-field credits">
                            <div class="field-label">Available Credits</div>
                            <div class="field-value">${credits}</div>
                        </div>
                    </div>
                    <button class="logout-button" id="logout-btn">Logout</button>
                `;
                
                shadowRoot.getElementById('logout-btn').addEventListener('click', async () => {
                    try {
                        await BackendAuth.logout();
                        updateProfileView(false);
                    } catch (error) {
                        console.error('Logout error:', error);
                    }
                });
                
            } catch (error) {
                console.error('Error loading profile:', error);
                profileDetails.innerHTML = `
                    <div class="profile-info">
                        <div class="profile-field">
                            <div class="field-label">Status</div>
                            <div class="field-value">Logged In</div>
                        </div>
                        <div class="profile-field">
                            <div class="field-label">Account</div>
                            <div class="field-value">Error loading profile data</div>
                        </div>
                    </div>
                    <button class="logout-button" id="logout-btn">Logout</button>
                `;
                
                shadowRoot.getElementById('logout-btn').addEventListener('click', async () => {
                    try {
                        await BackendAuth.logout();
                        updateProfileView(false);
                    } catch (error) {
                        console.error('Logout error:', error);
                    }
                });
            }
        } else {
            loginContainer.style.display = 'block';
            profileDetails.style.display = 'none';
            clearLoginError();
        }
    }
    
    function showLoginError(message) {
        const loginError = shadowRoot.getElementById('login-error');
        if (loginError) {
            loginError.textContent = message;
            loginError.style.display = 'block';
        }
    }
    
    function clearLoginError() {
        const loginError = shadowRoot.getElementById('login-error');
        if (loginError) {
            loginError.textContent = '';
            loginError.style.display = 'none';
        }
    }
}

// Context menu handlers (right-click functionality)
document.addEventListener('contextmenu', async (e) => {
    const target = e.target;
    
    if (isImage(target) && selectedMode.startsWith('image_')) {
        e.preventDefault();
        showShimmerLoading('Processing image...');
        solthronContainer.style.display = 'block';
        solthronContainer.style.pointerEvents = 'auto';
        const buttonRect = button.getBoundingClientRect();
        positionContainer(buttonRect);
        await processImage(target);
        return;
    }
    
    if (selectedMode === 'smart_followups') {
        const platform = detectAIPlatform();
        
        if (platform === 'unknown') {
            return;
        }
        
        e.preventDefault();
        
        const conversation = extractConversation();
        console.log("=== DEBUG: EXTRACTED CONVERSATION ===");
        console.log(conversation);
        console.log("=== END DEBUG ===");
        
        if (!conversation || conversation === 'Unable to extract conversation from this page.') {
            showError('Unable to extract conversation. Please ensure there is a conversation visible on the page.');
            solthronContainer.style.display = 'block';
            solthronContainer.style.pointerEvents = 'auto';
            const buttonRect = button.getBoundingClientRect();
            positionContainer(buttonRect);
            return;
        }
        
        showShimmerLoading('Generating followups...');
        solthronContainer.style.display = 'block';
        solthronContainer.style.pointerEvents = 'auto';
        const buttonRect = button.getBoundingClientRect();
        positionContainer(buttonRect);
        
        const creditCheck = await checkCredits('smart_followups');
        if (!creditCheck.success) {
            showError(creditCheck.message || "Please check your account status.");
            return;
        }
        
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'smart_followups',
                    data: {
                        conversation: conversation,
                        platform: platform
                    }
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
            
            if (response && response.success && response.data) {
                if (response.data.questions && Array.isArray(response.data.questions)) {
                    displaySmartFollowups(response.data);
                } else if (response.data.success && response.data.questions) {
                    displaySmartFollowups(response.data);
                } else {
                    showError('Invalid response format from smart followups service');
                }
            } else {
                const errorMsg = response?.error || response?.data?.error || 'Unknown error occurred';
                showError('Failed to generate follow-up questions: ' + errorMsg);
            }
        } catch (error) {
            console.error('Smart followups error:', error);
            showError('Error analyzing conversation: ' + error.message);
        }
    }

    if (selectedMode === 'smart_actions') {
        const platform = detectAIPlatform();
        
        if (platform === 'unknown') {
            return;
        }
        
        e.preventDefault();
        
        const conversation = extractConversation();
        console.log("=== DEBUG: SMART ACTIONS CONVERSATION ===");
        console.log(conversation);
        console.log("=== END DEBUG ===");
        
        if (!conversation || conversation === 'Unable to extract conversation from this page.') {
            showError('Unable to extract conversation. Please ensure there is a conversation visible on the page.');
            solthronContainer.style.display = 'block';
            solthronContainer.style.pointerEvents = 'auto';
            const buttonRect = button.getBoundingClientRect();
            positionContainer(buttonRect);
            return;
        }
        
        showShimmerLoading('Generating actions...');
        solthronContainer.style.display = 'block';
        solthronContainer.style.pointerEvents = 'auto';
        const buttonRect = button.getBoundingClientRect();
        positionContainer(buttonRect);
        
        const creditCheck = await checkCredits('smart_actions');
        if (!creditCheck.success) {
            showError(creditCheck.message || "Please check your account status.");
            return;
        }
        
        try {
            const response = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({
                    type: 'smart_actions',
                    data: {
                        conversation: conversation,
                        platform: platform
                    }
                }, response => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(response);
                    }
                });
            });
            
            if (response && response.success && response.data) {
                if (response.data.action_prompts && Array.isArray(response.data.action_prompts)) {
                    displaySmartActions(response.data);
                } else if (response.data.success && response.data.action_prompts) {
                    displaySmartActions(response.data);
                } else {
                    showError('Invalid response format from smart actions service');
                }
            } else {
                const errorMsg = response?.error || response?.data?.error || 'Unknown error occurred';
                showError('Failed to generate action prompts: ' + errorMsg);
            }
        } catch (error) {
            console.error('Smart actions error:', error);
            showError('Error analyzing conversation: ' + error.message);
        }
    }
});

async function processImage(img) {
    if (!img.src) return;

    const creditCheck = await checkCredits(selectedMode);
    if (!creditCheck.success) {
        showError(creditCheck.message || "Please check your account status.");
        return;
    }

    try {
        const response = await fetch(img.src);
        const blob = await response.blob();
        const reader = new FileReader();
        const base64Image = await new Promise((resolve) => {
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        const apiResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: 'process_image',
                data: {
                    imageUrl: base64Image,
                    mode: selectedMode
                }
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });

        if (apiResponse && apiResponse.success) {
            updateOutput(apiResponse.data.prompt);
        } else {
            throw new Error('Failed to process image');
        }
    } catch (error) {
        showError('Error processing image');
    }
}

// Chrome runtime message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "toggleExtension") {
        isButtonVisible = !isButtonVisible;
        
        button.style.display = isButtonVisible ? 'block' : 'none';
        
        if (!isButtonVisible && solthronContainer.style.display === 'block') {
            solthronContainer.style.display = 'none';
            solthronContainer.style.pointerEvents = 'none';
        }
        
        sendResponse({success: true});
        return true;
    }
    
    if (request.action === "setAuthToken" && request.token) {
        BackendAuth.setAuthToken(request.token).then(() => {
            pageCredits = null;
            sendResponse({success: true});
        }).catch((error) => {
            console.error('Error setting auth token:', error);
            sendResponse({success: false});
        });
        return true;
    }
    
    return false;
});

// Auth token receiver for website login
window.addEventListener('message', async (event) => {
    if (event.origin !== 'https://solthron.com' && 
        event.origin !== 'https://www.solthron.com') {
        return;
    }
    
    if (event.data.type === 'SOLTHRON_AUTH_SUCCESS' && event.data.token) {
        console.log('🔐 Received auth token from website');
        console.log('📍 Token source:', event.data.source);
        
        try {
            const success = await BackendAuth.setAuthToken(event.data.token);
            if (success) {
                console.log('✅ Auth token stored successfully');
                pageCredits = null;
                
                const profileView = shadowRoot.getElementById('profile-view');
                if (profileView && profileView.style.display !== 'none') {
                    console.log('🔄 Profile view is open, should refresh');
                }
                
            } else {
                console.error('❌ Failed to store auth token');
            }
        } catch (error) {
            console.error('💥 Auth token storage error:', error);
        }
    }
});

// Export for external access
window.solthronAuth = BackendAuth;

// Debug functions
window.solthronDebug = {
    checkAuth: async function() {
        const hasToken = await BackendAuth.getAuthToken();
        const isLoggedIn = await BackendAuth.isLoggedIn();
        const credits = await BackendAuth.getUserCredits();
        
        console.log('🔍 Auth Debug Info:');
        console.log('Has Token:', !!hasToken);
        console.log('Is Logged In:', isLoggedIn);
        console.log('Credits:', credits);
        
        return { hasToken: !!hasToken, isLoggedIn, credits };
    },
    
    clearAuth: async function() {
        await BackendAuth.logout();
        console.log('🧹 Auth cleared');
    }
};

// ✅ INITIALIZE THE EXTENSION
createUI();
initializeProfileHandlers();
initializeConversationMemory();
