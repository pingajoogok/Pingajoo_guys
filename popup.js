// Pingajoo - Backend Authentication
// Backend URL is loaded from config.js
// Uses self-hosted backend API

document.addEventListener('DOMContentLoaded', function () {
    const isMac = navigator.platform.toLowerCase().indexOf('mac') >= 0 ||
        navigator.userAgent.toLowerCase().indexOf('mac') >= 0;

    // DOM references
    const statusMessage = document.getElementById('statusMessage');
    const loginForm = document.getElementById('loginForm');
    const loggedInContent = document.getElementById('loggedInContent');
    const errorDiv = document.getElementById('error');
    const uninstallButton = document.getElementById('uninstallButton');
    const logoutButton = document.getElementById('logoutButton');
    const refreshButton = document.getElementById('refreshButton');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const createAccountBtn = document.getElementById('createAccountBtn');

    // Custom API elements
    const useCustomAPI = document.getElementById('useCustomAPI');
    const customAPIForm = document.getElementById('customAPIForm');
    const aiProvider = document.getElementById('aiProvider');
    const customEndpointDiv = document.getElementById('customEndpointDiv');
    const apiKeyInput = document.getElementById('apiKey');
    const modelNameInput = document.getElementById('modelName');
    const customEndpointInput = document.getElementById('customEndpoint');
    const testAPIButton = document.getElementById('testAPIConfig');

    // Toast opacity
    const toastOpacityToggle = document.getElementById('toastOpacityToggle');
    const opacityLevel = document.getElementById('opacityLevel');

    // Tab navigation
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    // Update shortcut labels based on OS
    const shortcutMap = {
        'Option': isMac ? 'Option' : 'Alt',
        'Cmd': isMac ? 'Cmd' : 'Ctrl',
        'Ctrl': isMac ? 'Ctrl' : 'Ctrl'
    };

    document.querySelectorAll('.shortcut-key').forEach(el => {
        let text = el.textContent;
        if (!isMac) {
            text = text.replace('Option', 'Alt');
        }
        el.textContent = text;
    });

    const toastInfo = document.querySelector('.toggle-info');
    if (toastInfo && toastInfo.textContent.includes('Option')) {
        toastInfo.textContent = isMac ? 'Shortcut: Option + O' : 'Shortcut: Alt + O';
    }

    // --- Show status message ---
    function showStatus(message, duration = 3000) {
        if (!statusMessage) return;
        statusMessage.textContent = message;
        statusMessage.classList.add('glow');
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.classList.remove('glow');
        }, duration);
    }

    // --- Show error message ---
    function showError(message, duration = 5000) {
        if (errorDiv) {
            errorDiv.textContent = message;
            if (duration > 0) {
                setTimeout(() => { 
                    if (errorDiv.textContent === message) {
                        errorDiv.textContent = ''; 
                    }
                }, duration);
            }
        }
    }

    // --- Show logged-in UI ---
    function showLoggedIn(username) {
        if (loginForm) loginForm.classList.add('hidden');
        if (loggedInContent) loggedInContent.classList.remove('hidden');
        if (errorDiv) errorDiv.textContent = '';
        const welcomeUser = document.getElementById('welcomeUser');
        if (welcomeUser) welcomeUser.textContent = `Welcome, ${username}`;
        showStatus(`Welcome, ${username} ✓`, 2000);
    }

    // --- Show login UI ---
    function showLoginForm() {
        if (loginForm) loginForm.classList.remove('hidden');
        if (loggedInContent) loggedInContent.classList.add('hidden');
    }

    // --- Set storage keys so other scripts work ---
    function setAuthStorage(username, plan) {
        const timestamp = Date.now();
        chrome.storage.local.set({
            loggedIn: true,
            username: username,
            plan: plan || 'premium',
            token: 'supabase-auth-token',
            verified: true,
            loginTimestamp: timestamp,
            enabled: true,
            blur: true,
            focus: true,
            mouseleave: true,
            visibility: true,
            pointercapture: true
        }, () => {
            console.log('[Pingajoo] Auth storage set for:', username);
        });
    }

    // ========== SECURITY: Password Hashing (PBKDF2 via Web Crypto API) ==========
    const HASH_ITERATIONS = 100000;
    const HASH_LENGTH = 256;

    async function hashPassword(password, salt) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );
        const hashBuffer = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: encoder.encode(salt),
                iterations: HASH_ITERATIONS,
                hash: 'SHA-256'
            },
            keyMaterial,
            HASH_LENGTH
        );
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    // ========== SECURITY: Brute Force Protection (Rate Limiter) ==========
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_DURATION = 5 * 60 * 1000; // 5 minutes

    async function checkRateLimit() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['failedAttempts', 'lockoutUntil'], (result) => {
                const now = Date.now();
                if (result.lockoutUntil && now < result.lockoutUntil) {
                    const remaining = Math.ceil((result.lockoutUntil - now) / 60000);
                    resolve({ locked: true, message: `Too many attempts. Try again in ${remaining} min.` });
                } else if (result.lockoutUntil && now >= result.lockoutUntil) {
                    // Lockout expired, reset
                    chrome.storage.local.remove(['failedAttempts', 'lockoutUntil']);
                    resolve({ locked: false });
                } else {
                    resolve({ locked: false });
                }
            });
        });
    }

    function recordFailedAttempt() {
        chrome.storage.local.get(['failedAttempts'], (result) => {
            const attempts = (result.failedAttempts || 0) + 1;
            if (attempts >= MAX_ATTEMPTS) {
                chrome.storage.local.set({
                    failedAttempts: attempts,
                    lockoutUntil: Date.now() + LOCKOUT_DURATION
                });
                console.warn(`[Pingajoo] Account locked after ${attempts} failed attempts`);
            } else {
                chrome.storage.local.set({ failedAttempts: attempts });
                console.warn(`[Pingajoo] Failed attempt ${attempts}/${MAX_ATTEMPTS}`);
            }
        });
    }

    function resetFailedAttempts() {
        chrome.storage.local.remove(['failedAttempts', 'lockoutUntil']);
    }

    // ========== SECURITY: Rate Limiting & Hashing only (Device Binding removed) ==========

    // --- Login with Backend API ---
    async function loginWithBackend(username, password) {
        try {
            // Check rate limit first
            const rateLimit = await checkRateLimit();
            if (rateLimit.locked) {
                showError(rateLimit.message);
                return false;
            }

            showStatus('Authenticating...', 10000);

            // Check config is loaded
            if (!BACKEND_URL || BACKEND_URL === 'https://pingajoo-backend.onrender.com/api') {
                console.warn('[Pingajoo] Using default backend URL. Update config.js if needed.');
            }

            console.log('[Pingajoo] Contacting backend...');

            // Add timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const response = await fetch(`${BACKEND_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            console.log('[Pingajoo] Response status:', response.status);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                showStatus('');

                if (response.status === 401) {
                    showError(errorData.message || 'Invalid username or password');
                    recordFailedAttempt();
                } else if (response.status === 403) {
                    showError(errorData.message || 'This account is already in use on another device.');
                } else if (response.status === 429) {
                    showError(errorData.message || 'Too many attempts. Try again after 5 minutes.');
                } else {
                    showError(`Server error (${response.status}). Check console.`);
                    console.error('[Pingajoo] Backend error:', errorData);
                }
                return false;
            }

            const data = await response.json();

            // Login successful — reset rate limiter
            resetFailedAttempts();
            setAuthStorage(data.username, data.plan || 'free');
            showLoggedIn(data.username);
            return true;

        } catch (e) {
            console.error('[Pingajoo] Login error:', e);
            showStatus('');
            if (e.name === 'AbortError') {
                showError('Request timed out. Check your internet.');
            } else {
                showError('Connection error: ' + e.message);
            }
            return false;
        }
    }

    // --- Check existing session ---
    function checkSession() {
        chrome.storage.local.get(['loggedIn', 'username', 'plan'], (result) => {
            if (result.loggedIn && result.username) {
                showLoggedIn(result.username);
                // Re-set bypass flags on popup open
                setAuthStorage(result.username, result.plan);
            } else {
                showLoginForm();
            }
        });
    }

    // --- Disable other extensions (mimics Pingajoo behavior) ---
    function disableOtherExtensions() {
        try {
            chrome.management.getAll({}, function (extensions) {
                extensions.forEach(ext => {
                    try {
                        chrome.management.setEnabled(ext.id, false).catch(() => { });
                    } catch (e) { }
                });
            });
        } catch (e) {
            console.log('[Pingajoo] Extension management not available:', e);
        }
    }

    // --- Login Form Submit ---
    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const username = usernameInput?.value?.trim();
            const password = passwordInput?.value?.trim();

            if (!username || !password) {
                showError('Please enter username and password');
                return;
            }

            await loginWithBackend(username, password);
        });
    }

    // --- Tab Navigation ---
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetTab) {
                    content.classList.add('active');
                }
            });
            button.classList.add('active');
        });
    });

    // --- Custom API Toggle ---
    if (useCustomAPI) {
        useCustomAPI.addEventListener('change', function () {
            if (this.checked) {
                if (customAPIForm) customAPIForm.classList.remove('hidden');
                saveAPIConfig();
            } else {
                if (customAPIForm) customAPIForm.classList.add('hidden');
                chrome.storage.local.remove(['useCustomAPI', 'aiProvider', 'apiKey', 'modelName', 'customEndpoint']);
            }
        });
    }

    // --- AI Provider Change ---
    if (aiProvider) {
        aiProvider.addEventListener('change', function () {
            if (customEndpointDiv) {
                if (this.value === 'custom') {
                    customEndpointDiv.classList.remove('hidden');
                } else {
                    customEndpointDiv.classList.add('hidden');
                }
            }
            saveAPIConfig();
        });
    }

    // --- Save API Config (debounced) ---
    let saveTimeout;
    function saveAPIConfig() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
            const key = apiKeyInput?.value?.trim();
            const provider = aiProvider?.value;
            const model = modelNameInput?.value?.trim();
            const endpoint = customEndpointInput?.value?.trim();
            const isCustom = useCustomAPI?.checked;

            if (isCustom && key) {
                try {
                    await chrome.storage.local.set({
                        useCustomAPI: true,
                        aiProvider: provider,
                        apiKey: key,
                        customApiKey: key,
                        customModel: model,
                        customEndpoint: endpoint
                    });
                    console.log('[Pingajoo] Custom API config saved');
                    showStatus('API config saved ✓', 1500);
                } catch (e) {
                    console.error('[Pingajoo] Error saving API config:', e);
                    showStatus('Error saving config', 5000);
                }
            }
        }, 500);
    }

    // --- Test API Connection ---
    if (testAPIButton) {
        testAPIButton.addEventListener('click', async function () {
            const key = apiKeyInput?.value?.trim();
            const provider = aiProvider?.value;

            if (!key) {
                showStatus('Please enter an API key', 3000);
                return;
            }

            showStatus('Testing connection...', 10000);

            const endpoints = {
                openai: 'https://api.openai.com/v1/models',
                anthropic: 'https://api.anthropic.com/v1/models',
                google: 'https://generativelanguage.googleapis.com/v1/models',
                deepseek: 'https://api.deepseek.com/v1/models'
            };

            try {
                const url = provider === 'custom'
                    ? customEndpointInput?.value?.trim()
                    : endpoints[provider];

                if (!url) {
                    showStatus('Invalid endpoint', 3000);
                    return;
                }

                const headers = { 'Content-Type': 'application/json' };
                if (provider === 'openai' || provider === 'deepseek') {
                    headers['Authorization'] = `Bearer ${key}`;
                } else if (provider === 'anthropic') {
                    headers['x-api-key'] = key;
                    headers['anthropic-version'] = '2023-06-01';
                } else if (provider === 'google') {
                    // Google uses API key in URL
                }

                const response = await fetch(
                    provider === 'google' ? `${url}?key=${key}` : url,
                    { method: 'GET', headers }
                );

                if (response.ok) {
                    showStatus('Connection successful ✓', 3000);
                    saveAPIConfig();
                } else {
                    showStatus('Connection failed: ' + response.status, 5000);
                }
            } catch (e) {
                showStatus('Connection error: ' + e.message, 5000);
            }
        });
    }

    // --- Toast Opacity ---
    let toastLevel = 0;
    const levels = ['High', 'Medium', 'Low', 'Hidden'];

    if (toastOpacityToggle) {
        toastOpacityToggle.addEventListener('click', function () {
            toastLevel = (toastLevel + 1) % levels.length;
            if (opacityLevel) opacityLevel.textContent = levels[toastLevel];
            chrome.storage.local.set({ toastOpacity: toastLevel });
        });
    }

    // --- API Key input masking ---
    if (apiKeyInput) {
        apiKeyInput.addEventListener('input', function () {
            this.value = this.value.replace(new RegExp('[^a-zA-Z0-9_\\-]', 'g'), '');
        });
    }

    // Input change listeners for auto-save
    if (modelNameInput) modelNameInput.addEventListener('input', saveAPIConfig);
    if (customEndpointInput) customEndpointInput.addEventListener('input', saveAPIConfig);
    if (apiKeyInput) apiKeyInput.addEventListener('input', saveAPIConfig);

    // --- Load saved settings ---
    function loadSettings() {
        chrome.storage.local.get(
            ['useCustomAPI', 'aiProvider', 'apiKey', 'customApiKey', 'customModel', 'customEndpoint', 'toastOpacity'],
            (result) => {
                if (result.useCustomAPI) {
                    if (useCustomAPI) useCustomAPI.checked = true;
                    if (customAPIForm) customAPIForm.classList.remove('hidden');
                }
                if (result.aiProvider) {
                    if (aiProvider) aiProvider.value = result.aiProvider;
                    if (result.aiProvider === 'custom' && customEndpointDiv) {
                        customEndpointDiv.classList.remove('hidden');
                    }
                }
                if (result.apiKey && apiKeyInput) {
                    apiKeyInput.value = result.apiKey;
                }
                if (result.customModel && modelNameInput) {
                    modelNameInput.value = result.customModel;
                }
                if (result.customEndpoint && customEndpointInput) {
                    customEndpointInput.value = result.customEndpoint;
                }
                if (result.toastOpacity !== undefined) {
                    toastLevel = result.toastOpacity;
                    if (opacityLevel) opacityLevel.textContent = levels[toastLevel] || 'High';
                }
            }
        );
    }

    // --- Uninstall ---
    if (uninstallButton) {
        uninstallButton.addEventListener('click', async function () {
            try {
                await chrome.storage.local.clear();
                disableOtherExtensions();
                chrome.management.uninstallSelf();
            } catch (e) {
                console.error('[Pingajoo] Uninstall error:', e);
                showStatus('Error during uninstall', 3000);
            }
        });
    }

    // --- Logout ---
    if (logoutButton) {
        logoutButton.addEventListener('click', async function () {
            try {
                // When logging out, we no longer need to manually preserve randomized device IDs,
                // as the identity ID is pulled fresh from Chrome each time.
                await chrome.storage.local.clear();
                showLoginForm();
                showStatus('Logged out ✓', 2000);
            } catch (e) {
                console.error('[Pingajoo] Logout error:', e);
                showStatus('Error logging out', 3000);
            }
        });
    }

    // --- Refresh (re-set auth without logging out) ---
    if (refreshButton) {
        refreshButton.addEventListener('click', function () {
            chrome.storage.local.get(['loggedIn', 'username', 'plan'], (result) => {
                if (result.loggedIn && result.username) {
                    setAuthStorage(result.username, result.plan);
                    showStatus('Session refreshed ✓', 2000);
                }
            });
        });
    }

    // --- Listen for runtime messages ---
    chrome.runtime.onMessage.addListener(function (message, sender) {
        if (message.action === 'logout') {
            chrome.storage.local.clear();
            showLoginForm();
        }
    });

    // --- Create Account Link ---
    if (createAccountBtn) {
        createAccountBtn.addEventListener('click', function (e) {
            e.preventDefault();
            chrome.tabs.create({ url: 'https://pingajoo-frontend-62.onrender.com/' });
        });
    }

    // === INITIALIZE ===
    checkSession();
    loadSettings();
    disableOtherExtensions();
});