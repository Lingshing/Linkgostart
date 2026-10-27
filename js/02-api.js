// ==========================================
// 第2批移植：API配置系统
// ==========================================
async function initApiConfig() {
    await loadFromLocal();
    const apiKeyInput = document.getElementById('api-key-input');
    const apiUrlInput = document.getElementById('api-url-input');
    
    if (apiKeyInput) {
        apiKeyInput.value = APP_DATA.apiKey || '';
        apiKeyInput.addEventListener('input', () => {
            APP_DATA.apiKey = apiKeyInput.value.trim();
            saveToLocal();
        });
    }
    
    if (apiUrlInput) {
        apiUrlInput.value = APP_DATA.apiUrl || 'https://api.openai.com/v1/chat/completions';
        apiUrlInput.addEventListener('input', () => {
            APP_DATA.apiUrl = apiUrlInput.value.trim() || 'https://api.openai.com/v1/chat/completions';
            saveToLocal();
        });
    }
}

function validateApiConfig() {
    if (!APP_DATA.apiKey) {
        alert('请先在"我"页面配置API密钥');
        return false;
    }
    return true;
}

const CHAT_API_CONFIGS = {
    list: [],
    currentId: null,
    currentModel: ''
};

let availableModels = [];

function loadChatApiConfigs() {
    try {
        const saved = localStorage.getItem('CHAT_API_CONFIGS');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(CHAT_API_CONFIGS, parsed);
            updateChatConfigDisplay();
        }
    } catch(e) { console.error('加载Chat API配置失败:', e); }
}

function saveChatApiConfigs() {
    try { localStorage.setItem('CHAT_API_CONFIGS', JSON.stringify(CHAT_API_CONFIGS)); } catch(e) { console.error('保存Chat API配置失败:', e); }
}

function updateChatConfigDisplay() {
    const configNameInput = document.getElementById('chat-config-name');
    const modelInput = document.getElementById('chat-current-model');
    
    if (configNameInput) {
        if (CHAT_API_CONFIGS.currentId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            configNameInput.value = config ? config.name : '点击选择配置';
        } else configNameInput.value = '点击选择配置';
    }
    
    if (modelInput) modelInput.value = CHAT_API_CONFIGS.currentModel || '';
}

function openUnifiedConfigSelector(context, type = null) {
    window.currentConfigSelectorContext = context;
    window.currentOtherApiType = type;
    
    const modal = document.getElementById('chat-config-modal');
    modal.querySelector('.config-modal-title').textContent = '选择配置';
    
    const newBtn = modal.querySelector('.config-new-btn');
    if (newBtn) {
        newBtn.onclick = () => {
            modal.classList.remove('show');
            const newModal = document.getElementById('new-config-modal');
            document.getElementById('config-form-title').textContent = context === 'other' ? '新建Other API配置' : '新建配置';
            ['name', 'url', 'key', 'model'].forEach(id => document.getElementById(`new-config-${id}`).value = '');
            setModalProxySwitchState(true);
            delete newModal.dataset.editingId;
            newModal.dataset.configType = context;
            requestAnimationFrame(() => newModal.classList.add('show'));
        };
    }

    const listContainer = document.getElementById('chat-config-list');
    
    if (CHAT_API_CONFIGS.list.length === 0) {
        listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--text-sub);"><i class="fas fa-inbox" style="font-size: 36px; margin-bottom: 12px; opacity: 0.5;"></i><p style="font-size: 14px;">暂无配置，请新建</p></div>';
    } else {
        const activeId = context === 'main' ? CHAT_API_CONFIGS.currentId : OTHER_API_CONFIGS[type]?.configId;
        const sortedConfigs = [...CHAT_API_CONFIGS.list].sort((a, b) => {
            if (a.id === activeId) return -1;
            if (b.id === activeId) return 1;
            const timeA = a.lastUsed || 0, timeB = b.lastUsed || 0;
            if (timeA !== timeB) return timeB - timeA;
            return b.id - a.id;
        });

        listContainer.innerHTML = '';
        sortedConfigs.forEach(config => {
            const wrapper = document.createElement('div');
            wrapper.className = 'config-item-wrapper';
            const actions = `<div class="config-item-actions"><div class="config-action-btn config-action-edit" onclick="event.stopPropagation(); editChatConfig(${config.id});"><i class="fa-solid fa-pen-to-square"></i></div><div class="config-action-btn config-action-delete" onclick="event.stopPropagation(); deleteChatConfig(${config.id});"><i class="fa-solid fa-trash-can"></i></div></div>`;
            const isActive = config.id === activeId;
            const itemHtml = `<div class="config-list-item config-list-item-swipeable"><div class="config-item-info"><div class="config-item-name" style="color: ${isActive ? 'var(--accent)' : 'var(--text-main)'}; font-weight: ${isActive ? '600' : '500'};">${config.name}</div><div class="config-item-model">${config.model || '未选择模型'}</div></div>${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}</div>`;
            
            wrapper.innerHTML = actions + itemHtml;
            const itemNode = wrapper.querySelector('.config-list-item-swipeable');
            
            itemNode.onclick = (e) => {
                if (itemNode.style.transform === 'translateX(-110px)') { resetConfigSwipe(itemNode); e.stopPropagation(); } 
                else selectUnifiedConfig(config.id);
            };
            if (typeof addConfigSwipeHandler === 'function') addConfigSwipeHandler(itemNode);
            listContainer.appendChild(wrapper);
        });
    }
    requestAnimationFrame(() => {
        modal.classList.add('show');
        const listContainer = document.getElementById('chat-config-list');
        if (listContainer) listContainer.scrollTop = 0;
    });
}

function selectUnifiedConfig(configId) {
    const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
    if (!config) return;
    config.lastUsed = Date.now();
    const ctx = window.currentConfigSelectorContext;
    if (ctx === 'main') {
        CHAT_API_CONFIGS.currentId = configId;
        CHAT_API_CONFIGS.currentModel = config.model || '';
        saveChatApiConfigs(); updateChatConfigDisplay();
    } else if (ctx === 'other') {
        const type = window.currentOtherApiType;
        OTHER_API_CONFIGS[type].configId = configId;
        OTHER_API_CONFIGS[type].model = config.model || '';
        saveOtherApiConfigs(); updateOtherConfigDisplay();
    }
    openUnifiedConfigSelector(ctx, window.currentOtherApiType);
}

let modalProxyTempState = true; 
function toggleModalProxySwitch() {
    modalProxyTempState = !modalProxyTempState;
    const indicator = document.getElementById('modal-proxy-switch');
    if (indicator) { if (modalProxyTempState) indicator.classList.add('active'); else indicator.classList.remove('active'); }
}
function setModalProxySwitchState(state) {
    modalProxyTempState = state;
    const indicator = document.getElementById('modal-proxy-switch');
    if (indicator) { if (modalProxyTempState) indicator.classList.add('active'); else indicator.classList.remove('active'); }
}

function saveNewConfig() {
    const name = document.getElementById('new-config-name').value.trim();
    let url = document.getElementById('new-config-url').value.trim();
    const key = document.getElementById('new-config-key').value.trim();
    const model = document.getElementById('new-config-model').value.trim();
    
    if (!name) return alert('请输入配置名称');
    if (!url) return alert('请输入API URL');
    if (!key) return alert('请输入API Key');
    if (!model) return alert('请选择模型');
    
    url = getStandardApiUrl(url, '').replace(/\/$/, '');
    
    const modal = document.getElementById('new-config-modal');
    const editingId = modal.dataset.editingId;
    const isOther = modal.dataset.configType === 'other';
    
    if (editingId) {
        const config = CHAT_API_CONFIGS.list.find(c => c.id === parseInt(editingId));
        if (config) {
            config.name = name; config.url = url; config.key = key; config.model = model; config.useProxy = modalProxyTempState;
            if (CHAT_API_CONFIGS.currentId === config.id) CHAT_API_CONFIGS.currentModel = model;
            alert('配置已更新！');
        }
    } else {
        const newConfig = { id: Date.now(), name, url, key, model, useProxy: modalProxyTempState, createdAt: new Date().toISOString() };
        CHAT_API_CONFIGS.list.push(newConfig);
        if (!isOther) { CHAT_API_CONFIGS.currentId = newConfig.id; CHAT_API_CONFIGS.currentModel = model; }
        alert('配置已保存！');
    }
    saveChatApiConfigs(); updateChatConfigDisplay(); updateOtherConfigDisplay(); closeNewConfigForm();
}

function closeNewConfigForm() { document.getElementById('new-config-modal').classList.remove('show'); }

function editChatConfig(configId) {
    const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
    if (!config) return;
    document.getElementById('chat-config-modal').classList.remove('show');
    setTimeout(() => {
        document.getElementById('config-form-title').textContent = '编辑配置';
        document.getElementById('new-config-name').value = config.name;
        document.getElementById('new-config-url').value = config.url;
        document.getElementById('new-config-key').value = config.key;
        document.getElementById('new-config-model').value = config.model;
        setModalProxySwitchState(config.useProxy !== false);
        const modal = document.getElementById('new-config-modal');
        modal.dataset.editingId = configId;
        requestAnimationFrame(() => modal.classList.add('show'));
    }, 300);
}

function deleteChatConfig(configId) {
    const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
    if (!config || !confirm(`确定要删除配置"${config.name}"吗？`)) return;
    
    if (CHAT_API_CONFIGS.currentId === configId) { CHAT_API_CONFIGS.currentId = null; CHAT_API_CONFIGS.currentModel = ''; }
    Object.keys(OTHER_API_CONFIGS).forEach(key => { if (OTHER_API_CONFIGS[key].configId === configId) { OTHER_API_CONFIGS[key].configId = null; OTHER_API_CONFIGS[key].model = ''; } });

    CHAT_API_CONFIGS.list = CHAT_API_CONFIGS.list.filter(c => c.id !== configId);
    saveChatApiConfigs(); saveOtherApiConfigs(); updateChatConfigDisplay(); updateOtherConfigDisplay();
    openUnifiedConfigSelector(window.currentConfigSelectorContext, window.currentOtherApiType);
}

async function openUnifiedModelSelector(context, type = null) {
    window.currentModelSelectorContext = context;
    window.currentOtherApiType = type;
    let url, key, targetUrl, useProxy = true;

    if (context === 'new') {
        url = document.getElementById('new-config-url').value.trim();
        key = document.getElementById('new-config-key').value.trim();
        if (!url || !key) return alert('请先输入API URL和API Key');
    } else if (context === 'main') {
        if (!CHAT_API_CONFIGS.currentId) return alert('请先选择一个配置');
        const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
        if (!config) return alert('配置不存在');
        url = config.url; key = config.key; useProxy = config.useProxy !== false;
    } else if (context === 'other') {
        if (!OTHER_API_CONFIGS[type] || !OTHER_API_CONFIGS[type].configId) return alert('请先选择一个配置');
        const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS[type].configId);
        if (!config) return alert('配置不存在');
        url = config.url; key = config.key; useProxy = config.useProxy !== false;
    }

    targetUrl = getStandardApiUrl(url, '/models');
    const modelInput = document.getElementById('new-config-model');
    const originalPlaceholder = modelInput.placeholder;
    if (context === 'new') modelInput.placeholder = '正在拉取模型...';

    try {
        let response;
        if (useProxy) {
            response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list_models', customEndpoint: targetUrl, customApiKey: key })
            });
        } else {
            response = await fetch(targetUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } });
        }

        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
            availableModels = data.data.map(m => m.id).sort();
            if (availableModels.length === 0) throw new Error('未找到可用模型');
            document.getElementById('model-search-input').value = '';
            renderUnifiedModelList(availableModels);
            requestAnimationFrame(() => {
                document.getElementById('model-selector-modal').classList.add('show');
                const listContainer = document.getElementById('model-list-container');
                if (listContainer) listContainer.scrollTop = 0;
            });
        } else throw new Error('返回格式错误（缺少 data.data）');
    } catch (e) {
        alert('拉取模型失败: ' + e.message);
    } finally {
        if (context === 'new') modelInput.placeholder = originalPlaceholder;
    }
}

function renderUnifiedModelList(models) {
    const listContainer = document.getElementById('model-list-container');
    if (models.length === 0) { listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--text-sub);"><p style="font-size: 14px;">未找到匹配的模型</p></div>'; return; }
    let currentActiveModel = '';
    if (window.currentModelSelectorContext === 'main') currentActiveModel = CHAT_API_CONFIGS.currentModel;
    else if (window.currentModelSelectorContext === 'other') currentActiveModel = OTHER_API_CONFIGS[window.currentOtherApiType]?.model || '';

    listContainer.innerHTML = models.map(modelId => {
        const isActive = modelId === currentActiveModel;
        return `<div class="config-list-item" onclick="selectUnifiedModel('${modelId}')"><div class="config-item-info"><div class="config-item-name" style="font-size: 14px; font-weight: ${isActive?'600':'500'}; color: ${isActive?'var(--accent)':'var(--text-main)'};">${modelId}</div></div>${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}</div>`;
    }).join('');
}

function selectUnifiedModel(modelId) {
    const ctx = window.currentModelSelectorContext;
    if (ctx === 'new') document.getElementById('new-config-model').value = modelId;
    else if (ctx === 'main') {
        CHAT_API_CONFIGS.currentModel = modelId;
        const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId); if (config) config.model = modelId;
        saveChatApiConfigs(); updateChatConfigDisplay();
    } else if (ctx === 'other') {
        const type = window.currentOtherApiType;
        OTHER_API_CONFIGS[type].model = modelId;
        const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS[type].configId); if (config) config.model = modelId;
        saveOtherApiConfigs(); updateOtherConfigDisplay();
    }
    document.getElementById('model-selector-modal').classList.remove('show');
}

function filterModels(searchText) { renderUnifiedModelList(availableModels.filter(m => m.toLowerCase().includes(searchText.toLowerCase()))); }

function initChatApiConfigSystem() {
    loadChatApiConfigs();
    document.getElementById('chat-config-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });
    document.getElementById('new-config-modal').addEventListener('click', function(e) { if (e.target === this) closeNewConfigForm(); });
    document.getElementById('model-selector-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });
}

// ==========================================
// 第5-10批移植：主题、参数、预设、正则、推送、保活
// ==========================================
const THEMES = {
    light: { name: '浅色', '--bg-color': '#f2f2f7', '--card-bg': '#ffffff', '--text-main': '#000000', '--text-sub': '#8e8e93', '--accent': '#5C92D1', '--accent-light': 'rgba(92, 146, 209, 0.12)', '--danger': '#E64A4A', '--border': 'rgba(0,0,0,0.08)', '--nav-bg': 'rgba(255,255,255,0.85)', '--nav-blur-bg': 'rgba(255,255,255,0.92)', '--tab-bar-bg': 'rgba(255,255,255,0.92)', '--input-bg': '#ffffff', '--hover-bg': '#f2f2f7', '--icon-color': '#000000', '--divider': 'rgba(0,0,0,0.1)', '--user-bubble-bg': '#95ec69', '--user-bubble-text': '#000000', '--ext-icon-bg': '#ffffff', '--ext-icon-color': '#333333' },
    dark: { name: '深色', '--bg-color': '#000000', '--card-bg': '#1c1c1e', '--text-main': '#D0D0D0', '--text-sub': '#98989d', '--accent': '#5C92D1', '--accent-light': 'rgba(92, 146, 209, 0.2)', '--danger': '#E85A5A', '--border': 'rgba(255,255,255,0.03)', '--nav-bg': 'rgba(28,28,30,0.85)', '--nav-blur-bg': 'rgba(28,28,30,0.95)', '--tab-bar-bg': 'rgba(28,28,30,0.95)', '--input-bg': '#2c2c2e', '--hover-bg': '#2c2c2e', '--icon-color': '#ffffff', '--divider': 'rgba(255,255,255,0.1)', '--user-bubble-bg': '#17A963', '--user-bubble-text': '#000000', '--ext-icon-bg': '#3a3a3c', '--ext-icon-color': '#98989d' }
};

let currentTheme = 'light', themeMode = 'auto', systemThemeListener = null;

function applyTheme(themeName) {
    const theme = THEMES[themeName]; if (!theme) return;
    const root = document.documentElement;
    Object.keys(theme).forEach(key => { if (key !== 'name') root.style.setProperty(key, theme[key]); });
    const bgColor = theme['--bg-color'] || '#f2f2f7', isDark = themeName === 'dark';
    
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (!themeColorMeta) { themeColorMeta = document.createElement('meta'); themeColorMeta.name = "theme-color"; document.head.appendChild(themeColorMeta); }
    themeColorMeta.content = isDark ? '#000000' : bgColor;
    
    let statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (!statusBarMeta) { statusBarMeta = document.createElement('meta'); statusBarMeta.name = "apple-mobile-web-app-status-bar-style"; document.head.appendChild(statusBarMeta); }
    statusBarMeta.content = isDark ? 'black-translucent' : 'default';

    currentTheme = themeName; localStorage.setItem('theme', themeName);
}

function switchTheme(themeName) { applyTheme(themeName); }
function getCurrentTheme() { return currentTheme; }
function getSystemTheme() { return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'; }

function applyThemeMode(mode) {
    themeMode = mode; localStorage.setItem('themeMode', mode);
    if (mode === 'auto') { applyTheme(getSystemTheme()); startSystemThemeListener(); } 
    else { stopSystemThemeListener(); applyTheme(mode); }
    updateThemeModeDisplay();
}

function startSystemThemeListener() {
    if (systemThemeListener) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemThemeListener = (e) => { if (themeMode === 'auto') applyTheme(e.matches ? 'dark' : 'light'); };
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', systemThemeListener); else mediaQuery.addListener(systemThemeListener);
}

function stopSystemThemeListener() {
    if (!systemThemeListener) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', systemThemeListener); else mediaQuery.removeListener(systemThemeListener);
    systemThemeListener = null;
}

function updateThemeModeDisplay() {
    const displayEl = document.getElementById('theme-mode-display'), iconEl = document.getElementById('theme-mode-icon');
    if (!displayEl) return;
    const modeMap = { 'auto': { text: '跟随系统', icon: 'fa-circle-half-stroke' }, 'light': { text: '浅色', icon: 'fa-sun' }, 'dark': { text: '深色', icon: 'fa-moon' } };
    const mode = modeMap[themeMode] || modeMap['auto'];
    displayEl.textContent = mode.text; if (iconEl) iconEl.className = `fas ${mode.icon}`;
}

function openThemeModeSelector() {
    const modal = document.createElement('div'); modal.className = 'config-modal-overlay'; modal.style.zIndex = '4000';
    const modes = [ { value: 'auto', name: '跟随系统', icon: 'fa-circle-half-stroke', desc: '自动适配系统深色/浅色模式' }, { value: 'light', name: '浅色', icon: 'fa-sun', desc: '始终使用浅色主题' }, { value: 'dark', name: '深色', icon: 'fa-moon', desc: '始终使用深色主题' } ];
    modal.innerHTML = `<div class="config-modal-content" style="max-width: 90%; width: 380px;"><div class="config-modal-header"><h3 class="config-modal-title">选择外观</h3></div><div class="config-modal-body" style="padding: 0;">${modes.map(mode => { const isActive = themeMode === mode.value; return `<div class="config-list-item" onclick="selectThemeMode('${mode.value}')" style="cursor: pointer; flex-direction: column; align-items: flex-start; padding: 16px 20px;"><div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: ${mode.desc ? '6px' : '0'};"><div style="display: flex; align-items: center; gap: 12px;"><i class="fas ${mode.icon}" style="font-size: 20px; color: ${isActive ? 'var(--accent)' : 'var(--icon-color)'};"></i><div style="font-size: 16px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? 'var(--accent)' : 'var(--text-main)'};">${mode.name}</div></div>${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}</div>${mode.desc ? `<div style="font-size: 13px; color: var(--text-sub); margin-left: 32px;">${mode.desc}</div>` : ''}</div>`; }).join('')}</div></div>`;
    document.body.appendChild(modal); requestAnimationFrame(() => modal.classList.add('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) closeThemeModeSelector(); }); window.currentThemeModeModal = modal;
}

function selectThemeMode(mode) { applyThemeMode(mode); closeThemeModeSelector(); }
function closeThemeModeSelector() { if (window.currentThemeModeModal) { window.currentThemeModeModal.classList.remove('show'); setTimeout(() => { if (window.currentThemeModeModal) { window.currentThemeModeModal.remove(); window.currentThemeModeModal = null; } }, 300); } }

function initTheme() {
    const savedMode = localStorage.getItem('themeMode') || 'auto'; themeMode = savedMode;
    if (savedMode === 'auto') { applyTheme(getSystemTheme()); startSystemThemeListener(); } else applyTheme(savedMode);
    updateThemeModeDisplay();
}

// --- 参数配置 ---
const PARAM_CONFIG = { stream: true, temperature: 0.7, maxTokens: 2048, frequencyPenalty: 0.0, presencePenalty: 0.0 };

function loadParamConfig() {
    try { const saved = localStorage.getItem('PARAM_CONFIG'); if (saved) Object.assign(PARAM_CONFIG, JSON.parse(saved)); updateStreamSwitchUI(); updateTemperatureUI(); updateMaxTokensUI(); updateFrequencyUI(); updatePresenceUI(); } catch(e) { console.error('加载参数配置失败:', e); }
}
function saveParamConfig() { try { localStorage.setItem('PARAM_CONFIG', JSON.stringify(PARAM_CONFIG)); } catch(e) {} }
function toggleStreamOutput() { PARAM_CONFIG.stream = !PARAM_CONFIG.stream; updateStreamSwitchUI(); saveParamConfig(); }
function updateStreamSwitchUI() { const switchEl = document.getElementById('stream-switch'); if (switchEl) { if (PARAM_CONFIG.stream) switchEl.classList.add('active'); else switchEl.classList.remove('active'); } }
function updateTemperatureUI() { const display = document.getElementById('temperature-display'), thumb = document.getElementById('temperature-thumb'); if (display) display.textContent = PARAM_CONFIG.temperature.toFixed(1); if (thumb) thumb.style.left = ((PARAM_CONFIG.temperature - 0.1) / (2.0 - 0.1)) * 100 + '%'; }
function updateMaxTokensUI() { const display = document.getElementById('max-tokens-display'), thumb = document.getElementById('max-tokens-thumb'); if (display) display.textContent = PARAM_CONFIG.maxTokens; if (thumb) thumb.style.left = ((PARAM_CONFIG.maxTokens - 256) / (4096 - 256)) * 100 + '%'; }
function updateFrequencyUI() { const display = document.getElementById('frequency-display'), thumb = document.getElementById('frequency-thumb'); if (display) display.textContent = PARAM_CONFIG.frequencyPenalty.toFixed(1); if (thumb) thumb.style.left = (PARAM_CONFIG.frequencyPenalty / 2.0) * 100 + '%'; }
function updatePresenceUI() { const display = document.getElementById('presence-display'), thumb = document.getElementById('presence-thumb'); if (display) display.textContent = PARAM_CONFIG.presencePenalty.toFixed(1); if (thumb) thumb.style.left = (PARAM_CONFIG.presencePenalty / 2.0) * 100 + '%'; }

function initTemperatureSlider() {
    const track = document.getElementById('temperature-track'), thumb = document.getElementById('temperature-thumb'); if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => { const rect = track.getBoundingClientRect(); let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)); let value = Math.round((0.1 + (percent / 100) * (2.0 - 0.1)) * 10) / 10; PARAM_CONFIG.temperature = value; thumb.style.left = percent + '%'; document.getElementById('temperature-display').textContent = value.toFixed(1); saveParamConfig(); };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); }); document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); }); document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }); document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); }); document.addEventListener('touchend', () => { isDragging = false; });
}
function initMaxTokensSlider() {
    const track = document.getElementById('max-tokens-track'), thumb = document.getElementById('max-tokens-thumb'); if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => { const rect = track.getBoundingClientRect(); let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)); let value = Math.round((256 + (percent / 100) * (4096 - 256)) / 128) * 128; value = Math.max(256, Math.min(4096, value)); PARAM_CONFIG.maxTokens = value; thumb.style.left = ((value - 256) / (4096 - 256)) * 100 + '%'; document.getElementById('max-tokens-display').textContent = value; saveParamConfig(); };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); }); document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); }); document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }); document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); }); document.addEventListener('touchend', () => { isDragging = false; });
}
function initFrequencySlider() {
    const track = document.getElementById('frequency-track'), thumb = document.getElementById('frequency-thumb'); if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => { const rect = track.getBoundingClientRect(); let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)); let value = Math.round((percent / 100) * 2.0 * 10) / 10; PARAM_CONFIG.frequencyPenalty = value; thumb.style.left = percent + '%'; document.getElementById('frequency-display').textContent = value.toFixed(1); saveParamConfig(); };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); }); document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); }); document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }); document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); }); document.addEventListener('touchend', () => { isDragging = false; });
}
function initPresenceSlider() {
    const track = document.getElementById('presence-track'), thumb = document.getElementById('presence-thumb'); if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => { const rect = track.getBoundingClientRect(); let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)); let value = Math.round((percent / 100) * 2.0 * 10) / 10; PARAM_CONFIG.presencePenalty = value; thumb.style.left = percent + '%'; document.getElementById('presence-display').textContent = value.toFixed(1); saveParamConfig(); };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); }); document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); }); document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }); document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); }); document.addEventListener('touchend', () => { isDragging = false; });
}
function initParamConfigSystem() { loadParamConfig(); initTemperatureSlider(); initMaxTokensSlider(); initFrequencySlider(); initPresenceSlider(); }

// --- 其他 API ---
const OTHER_API_CONFIGS = { memory: { configId: null, model: '' }, discover: { configId: null, model: '' }, voice: { configId: null, model: '' } };
let currentOtherApiType = '';
function toggleOtherAPI() { const container = document.getElementById('other-api-container'), icon = document.getElementById('other-api-toggle-icon'); if (container.style.maxHeight === '0px' || container.style.maxHeight === '') { container.style.maxHeight = '800px'; if(icon) icon.style.transform = 'rotate(90deg)'; } else { container.style.maxHeight = '0px'; if(icon) icon.style.transform = 'rotate(0deg)'; } }
function loadOtherApiConfigs() { try { const saved = localStorage.getItem('OTHER_API_CONFIGS'); if (saved) { const parsed = JSON.parse(saved); if (parsed.image && !parsed.discover) { parsed.discover = parsed.image; delete parsed.image; } Object.assign(OTHER_API_CONFIGS, parsed); } updateOtherConfigDisplay(); } catch(e) {} }
function saveOtherApiConfigs() { try { localStorage.setItem('OTHER_API_CONFIGS', JSON.stringify(OTHER_API_CONFIGS)); } catch(e) {} }
function updateOtherConfigDisplay() {
    const memConf = document.getElementById('memory-config-name'), memModel = document.getElementById('memory-current-model');
    if (memConf && memModel) { if (OTHER_API_CONFIGS.memory.configId) { const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.memory.configId); memConf.value = config ? config.name : '点击选择配置'; } else memConf.value = '点击选择配置'; memModel.value = OTHER_API_CONFIGS.memory.model || ''; }
    const discConf = document.getElementById('discover-config-name'), discModel = document.getElementById('discover-current-model');
    if (discConf && discModel) { if (OTHER_API_CONFIGS.discover.configId) { const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.discover.configId); discConf.value = config ? config.name : '点击选择配置'; } else discConf.value = '点击选择配置'; discModel.value = OTHER_API_CONFIGS.discover.model || ''; }
    const voiceConf = document.getElementById('voice-config-name'), voiceModel = document.getElementById('voice-current-model');
    if (voiceConf && voiceModel) { if (OTHER_API_CONFIGS.voice.configId) { const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.voice.configId); voiceConf.value = config ? config.name : '点击选择配置'; } else voiceConf.value = '点击选择配置'; voiceModel.value = OTHER_API_CONFIGS.voice.model || ''; }
}
function initOtherApiConfigSystem() { loadOtherApiConfigs(); }

// --- 推送与保活 ---
const PUSH_CONFIG = { vapidPublicKey: 'BKXLKgheQ0pGxeVUifzMecruF3o7OkniEkNSbBUM9sKIeUKn2M8NGG5h3YUV2YrHxzAoHS9-ILmz2MlrSoHt4NU', workerUrl: 'https://my-push-worker.ginkgo-yinxing.workers.dev', enabled: false, showContent: true };
const KEEP_ALIVE_CONFIG = { enabled: false };

window.startKeepAlive = async function() {
    try { if (window.chatWakeAudio) window.chatWakeAudio.pause(); if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) { await window.stopKeepAlive(); const watchId = await window.Capacitor.Plugins.BackgroundGeolocation.addWatcher({ backgroundMessage: "Linkgo 正在后台守护您的连接", backgroundTitle: "后台保活已开启", requestPermissions: true, stale: false, distanceFilter: 0 }, function(location, error) {}); localStorage.setItem('LINKGO_KEEP_ALIVE_ID', watchId); } } catch (error) { console.error("定位保活启动失败:", error); }
};

window.stopKeepAlive = async function() {
    const savedId = localStorage.getItem('LINKGO_KEEP_ALIVE_ID');
    if (savedId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) { try { await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: savedId }); localStorage.removeItem('LINKGO_KEEP_ALIVE_ID'); } catch (e) {} }
};

function initPushSystem() { const pushEnabled = localStorage.getItem('PUSH_ENABLED') === 'true', showContent = localStorage.getItem('PUSH_SHOW_CONTENT') !== 'false'; PUSH_CONFIG.enabled = pushEnabled; PUSH_CONFIG.showContent = showContent; }
function initKeepAliveSystem() { const savedState = localStorage.getItem('KEEP_ALIVE_ENABLED') === 'true'; KEEP_ALIVE_CONFIG.enabled = savedState; if (savedState) setTimeout(() => { if (KEEP_ALIVE_CONFIG.enabled) startKeepAlive(); }, 3000); }

window.pushNotificationQueue = Promise.resolve(); 
async function sendPushNotification(messageText) {
    if (!GENERAL_CONFIG.notification.pushEnabled || document.visibilityState === 'visible' || !messageText || typeof messageText !== 'string' || messageText.trim() === '') return;
    window.pushNotificationQueue = window.pushNotificationQueue.then(async () => {
        if (document.visibilityState === 'visible' || window.appRealActive) return;
        try {
            let finalMessage = messageText; if (!GENERAL_CONFIG.notification.showContent) finalMessage = '收到一条新消息';
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const { LocalNotifications } = window.Capacitor.Plugins;
                await LocalNotifications.requestPermissions();
                await LocalNotifications.schedule({ notifications: [{ title: "Linkgo", body: finalMessage.substring(0, 100), id: 8888, sound: null }] });
            }
            await new Promise(r => setTimeout(r, 150));
        } catch (error) { console.error('原生通知推送失败:', error); }
    });
}

// --- 通用设置与导入导出 ---
const GENERAL_CONFIG = { memory: { contextLimit: 10, diaryInterval: 10, maxTokens: 4000 }, notification: { pushEnabled: false, showContent: true, keepAlive: false }, regexCount: 0, presetCount: 0 };

function loadGeneralConfig() { try { const saved = localStorage.getItem('GENERAL_CONFIG'); if (saved) Object.assign(GENERAL_CONFIG, JSON.parse(saved)); updateGeneralUI(); } catch(e) {} }
function saveGeneralConfig() { try { localStorage.setItem('GENERAL_CONFIG', JSON.stringify(GENERAL_CONFIG)); } catch(e) {} }

function updateGeneralUI() {
    const contextInput = document.getElementById('general-context-limit'), diaryInput = document.getElementById('general-diary-interval'), tokensInput = document.getElementById('general-max-tokens');
    if (contextInput) contextInput.value = GENERAL_CONFIG.memory.contextLimit;
    if (diaryInput) diaryInput.value = GENERAL_CONFIG.memory.diaryInterval;
    if (tokensInput) tokensInput.value = GENERAL_CONFIG.memory.maxTokens;
    updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled);
    updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent);
    updateGeneralSwitch('general-keepalive-switch', GENERAL_CONFIG.notification.keepAlive);
    if (typeof updateGeneralCacheSize === 'function') updateGeneralCacheSize();
    const regexCount = document.getElementById('general-regex-count'), presetCount = document.getElementById('general-preset-count');
    if (regexCount) regexCount.textContent = GENERAL_CONFIG.regexCount + ' 条';
    if (presetCount) presetCount.textContent = GENERAL_CONFIG.presetCount + ' 个';
}

function updateGeneralSwitch(switchId, isActive) { const switchEl = document.getElementById(switchId); if (switchEl) { if (isActive) switchEl.classList.add('active'); else switchEl.classList.remove('active'); } }
function updateGeneralMemoryConfig(key, value) { const numValue = parseInt(value); if (isNaN(numValue) || numValue < 1) return; GENERAL_CONFIG.memory[key] = numValue; saveGeneralConfig(); if (window.APP_DATA && window.APP_DATA.settings) { if (key === 'contextLimit') window.APP_DATA.settings.contextLimit = numValue; if (key === 'diaryInterval') window.APP_DATA.settings.diaryInterval = numValue; if (key === 'maxTokens' && typeof MEMORY_CONFIG !== 'undefined') MEMORY_CONFIG.maxTokens = numValue; } }

async function toggleGeneralPush() {
    GENERAL_CONFIG.notification.pushEnabled = !GENERAL_CONFIG.notification.pushEnabled;
    updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled); saveGeneralConfig();
    if (GENERAL_CONFIG.notification.pushEnabled) { const barkKey = 'JanxutGCNrZgNBjEsuaeen'; fetch(`https://api.day.app/${barkKey}/Linkgo/推送通知已开启，后台回复将通过 Bark 送达！?group=Linkgo`); }
}
function toggleGeneralContent() { GENERAL_CONFIG.notification.showContent = !GENERAL_CONFIG.notification.showContent; updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent); saveGeneralConfig(); }
window.toggleGeneralKeepAlive = function() {
    GENERAL_CONFIG.notification.keepAlive = !GENERAL_CONFIG.notification.keepAlive; saveGeneralConfig(); localStorage.setItem('KEEP_ALIVE_ENABLED', GENERAL_CONFIG.notification.keepAlive ? 'true' : 'false');
    const switchEl = document.getElementById('general-keepalive-switch');
    if (GENERAL_CONFIG.notification.keepAlive) { if(switchEl) switchEl.classList.add('active'); if (window.startKeepAlive) window.startKeepAlive(); if (window.showLinkgoToast) showLinkgoToast('📍 已开启定位保活'); } 
    else { if(switchEl) switchEl.classList.remove('active'); if (window.stopKeepAlive) window.stopKeepAlive(); if (window.showLinkgoToast) showLinkgoToast('已关闭后台保活'); }
};

const EXPORT_DICTIONARY = {
    chat: ['CHAT_CONTACTS'], interaction: ['ACTIVITY_STATS'], api: ['CHAT_API_CONFIGS', 'OTHER_API_CONFIGS', 'MODEL_PARAMS', 'PARAM_CONFIG', 'MEMORY_CONFIG'],
    appearance: ['AVATAR_CONFIG', 'theme', 'themeMode'], general: ['GENERAL_CONFIG', 'PUSH_ENABLED', 'PUSH_SHOW_CONTENT', 'KEEP_ALIVE_ENABLED', 'RELOAD_TARGET_PAGE'],
    presets: ['PRESETS', 'ADVANCED_PRESET_FILES'], regex: ['REGEX_RULES', 'ADVANCED_REGEX_FILES'], forum: ['FORUM_POSTS']
};

function openExportSheet() { const sheet = document.getElementById('export-sheet'); sheet.style.display = ''; setTimeout(() => sheet.classList.add('show'), 10); const checkboxes = document.querySelectorAll('.export-item-cb'), selectAllBtn = document.getElementById('export-select-all'); checkboxes.forEach(cb => { cb.onchange = () => { selectAllBtn.checked = Array.from(checkboxes).every(c => c.checked); }; }); }
function closeExportSheet() { document.getElementById('export-sheet').classList.remove('show'); }
function toggleAllExportCheckboxes(selectAllCheckbox) { document.querySelectorAll('.export-item-cb').forEach(cb => cb.checked = selectAllCheckbox.checked); }
function closeImportSheet() { document.getElementById('import-sheet').classList.remove('show'); pendingImportSnapshot = null; }
function toggleAllImportCheckboxes(selectAllCheckbox) { document.querySelectorAll('.import-item-cb').forEach(cb => { if (!cb.disabled) cb.checked = selectAllCheckbox.checked; }); }
let pendingImportSnapshot = null;

async function executeCategorizedExport() {
    await saveQueue; try {
        if (typeof saveToLocal === 'function') await saveToLocal();
        if (typeof saveChatApiConfigs === 'function') saveChatApiConfigs();
        if (typeof saveOtherApiConfigs === 'function') saveOtherApiConfigs();
        if (typeof saveGeneralConfig === 'function') saveGeneralConfig();
        const checkedCategories = Array.from(document.querySelectorAll('.export-item-cb')).filter(cb => cb.checked).map(cb => cb.value);
        if (checkedCategories.length === 0) { alert('请至少选择一项要导出的数据！'); return; }
        const snapshot = {};
        Object.keys(localStorage).forEach(key => { for (let cat of checkedCategories) { if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) { snapshot[key] = localStorage.getItem(key); break; } } });
        if (checkedCategories.includes('chat')) {
            let chatContacts = await DB.getItem('CHAT_CONTACTS') || localStorage.getItem('CHAT_CONTACTS'); if (chatContacts) snapshot['CHAT_CONTACTS'] = chatContacts;
            let appSettings = await DB.getItem('APP_SETTINGS'); if (appSettings) snapshot['APP_SETTINGS'] = appSettings;
            let contactIds = []; if (chatContacts) { try { contactIds = JSON.parse(chatContacts).map(c => c.id); } catch(e) {} } if (contactIds.length === 0 && typeof mockContacts !== 'undefined') contactIds = mockContacts.map(c => c.id);
            for (const id of contactIds) { const key = `CONV_${id}`, val = await DB.getItem(key); if (val) snapshot[key] = val; }
        }
        if (checkedCategories.includes('forum')) { let forumPosts = await DB.getItem('FORUM_POSTS') || localStorage.getItem('FORUM_POSTS'); if (forumPosts) snapshot['FORUM_POSTS'] = forumPosts; }
        if (checkedCategories.includes('interaction')) { let activityStats = await DB.getItem('ACTIVITY_STATS'); if (!activityStats) { const appDataStr = await DB.getItem('APP_DATA'); if (appDataStr) { try { const appData = JSON.parse(appDataStr); if (appData.activityStats) activityStats = JSON.stringify(appData.activityStats); } catch(e) {} } } if (activityStats) snapshot['ACTIVITY_STATS'] = activityStats; }
        const exportData = { _version: '7.1', _time: new Date().toISOString(), data: snapshot }, dataStr = JSON.stringify(exportData, null, 2), blob = new Blob([dataStr], { type: 'application/json' }), fileName = `linkgo-backup-${new Date().toISOString().split('T')[0]}.json`, file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).then(() => closeExportSheet()).catch(() => closeExportSheet());
        else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = fileName; a.style.display = 'none'; document.body.appendChild(a); a.click(); setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000); closeExportSheet(); alert('✅ 导出成功！'); }
    } catch(e) { alert('⚠️ 导出失败: ' + e.message); }
}

function importGeneralData() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.style.display = 'none'; document.body.appendChild(input);
    input.onchange = function(e) {
        const file = e.target.files[0]; if (!file) { document.body.removeChild(input); return; }
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const fileData = JSON.parse(event.target.result); pendingImportSnapshot = fileData.data || fileData.localStorageData;
                if (!pendingImportSnapshot || typeof pendingImportSnapshot !== 'object') { alert('⚠️ 文件格式错误！'); return; }
                const backupKeys = Object.keys(pendingImportSnapshot); let presentCategories = [], hasOther = false;
                backupKeys.forEach(key => { let isKnown = false; for (let cat in EXPORT_DICTIONARY) { if (EXPORT_DICTIONARY[cat].includes(key)) { if (!presentCategories.includes(cat)) presentCategories.push(cat); isKnown = true; } } if (key.startsWith('CONV_')) { if (!presentCategories.includes('chat')) presentCategories.push('chat'); isKnown = true; } if (!isKnown) hasOther = true; });
                if (hasOther) presentCategories.push('other');
                document.querySelectorAll('.import-item-cb').forEach(cb => { if (presentCategories.includes(cb.value)) { cb.checked = true; cb.disabled = false; cb.parentElement.style.opacity = '1'; } else { cb.checked = false; cb.disabled = true; cb.parentElement.style.opacity = '0.4'; } });
                document.getElementById('import-select-all').checked = true;
                const sheet = document.getElementById('import-sheet'); sheet.style.display = ''; setTimeout(() => sheet.classList.add('show'), 10);
            } catch(e) { alert('⚠️ 读取失败！'); }
            if (document.body.contains(input)) document.body.removeChild(input);
        }; reader.readAsText(file);
    }; input.click();
}

async function executeCategorizedImport() {
    if (!pendingImportSnapshot) return;
    const checkedCategories = Array.from(document.querySelectorAll('.import-item-cb')).filter(cb => cb.checked).map(cb => cb.value);
    if (checkedCategories.length === 0) { alert('请至少选择一项！'); return; }
    if (!confirm('⚠️ 警告：这将使用备份文件【覆盖】您勾选的数据类别！\n确定要继续吗？')) return;
    window.saveToLocal = function() {}; window.saveChatApiConfigs = function() {}; window.saveOtherApiConfigs = function() {}; window.saveGeneralConfig = function() {}; window.saveAdvancedPresetFiles = function() {}; window.saveAdvancedRegexFiles = function() {};
    for (const key of Object.keys(pendingImportSnapshot)) {
        let shouldImport = false; const valStr = String(pendingImportSnapshot[key]);
        for (let cat of checkedCategories) { if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) { shouldImport = true; break; } }
        if (checkedCategories.includes('chat') && key.startsWith('CONV_')) shouldImport = true;
        if (checkedCategories.includes('interaction') && key === 'ACTIVITY_STATS') shouldImport = true;
        if (key === 'APP_DATA' && (checkedCategories.includes('interaction') || checkedCategories.includes('chat'))) {
            try { const oldAppData = JSON.parse(valStr); if (oldAppData.activityStats && checkedCategories.includes('interaction')) await DB.setItem('ACTIVITY_STATS', JSON.stringify(oldAppData.activityStats)); if (checkedCategories.includes('chat') && oldAppData.conversations) { for (const [contactId, conv] of Object.entries(oldAppData.conversations)) { if (conv && conv.length > 0) await DB.setItem(`CONV_${contactId}`, JSON.stringify(conv)); } } } catch(e) {} shouldImport = false; 
        }
        if (key === 'APP_SETTINGS') { if (checkedCategories.includes('interaction')) { try { const settings = JSON.parse(valStr); if (settings.activityStats) await DB.setItem('ACTIVITY_STATS', JSON.stringify(settings.activityStats)); } catch(e) {} } shouldImport = (checkedCategories.includes('chat') || checkedCategories.includes('general')); }
        if (shouldImport) { const dbKeys = ['CHAT_CONTACTS', 'APP_SETTINGS', 'FORUM_POSTS', 'ACTIVITY_STATS']; if (key.startsWith('CONV_') || dbKeys.includes(key)) await DB.setItem(key, valStr); else localStorage.setItem(key, valStr); }
    }
    alert('✅ 选择的数据已成功恢复！点击确定将重新加载页面。'); window.location.href = window.location.href.split('#')[0];
}

document.querySelectorAll('.import-item-cb').forEach(cb => { cb.addEventListener('change', () => { const enabledCheckboxes = Array.from(document.querySelectorAll('.import-item-cb')).filter(c => !c.disabled); document.getElementById('import-select-all').checked = enabledCheckboxes.every(c => c.checked); }); });

function initGeneralPage() { loadGeneralConfig(); GENERAL_CONFIG.regexCount = REGEX_RULES.list.length; GENERAL_CONFIG.presetCount = PRESETS.list.length; document.getElementById('general-regex-count').textContent = GENERAL_CONFIG.regexCount + ' 条'; document.getElementById('general-preset-count').textContent = GENERAL_CONFIG.presetCount + ' 个'; }

// --- 预设与正则系统 ---
const PRESETS = { list: [], current: null };
function createPreset(name, config) {
    const preset = { id: Date.now(), name: name, createdAt: new Date().toISOString(), config: { temperature: config.temperature || 0.7, maxTokens: config.maxTokens || 2000, topP: config.topP || 1.0, frequencyPenalty: config.frequencyPenalty || 0, presencePenalty: config.presencePenalty || 0, systemPrompt: config.systemPrompt || '' } };
    PRESETS.list.push(preset); savePresets(); return preset;
}
function deletePreset(presetId) { const index = PRESETS.list.findIndex(p => p.id === presetId); if (index > -1) { PRESETS.list.splice(index, 1); if (PRESETS.current === presetId) PRESETS.current = null; savePresets(); return true; } return false; }
function updatePreset(presetId, updates) { const preset = PRESETS.list.find(p => p.id === presetId); if (preset) { if (updates.name) preset.name = updates.name; if (updates.config) Object.assign(preset.config, updates.config); savePresets(); return true; } return false; }
function applyPreset(presetId) { const preset = PRESETS.list.find(p => p.id === presetId); if (preset) { updateModelParams({ temperature: preset.config.temperature, maxTokens: preset.config.maxTokens, topP: preset.config.topP, frequencyPenalty: preset.config.frequencyPenalty, presencePenalty: preset.config.presencePenalty }); PRESETS.current = presetId; savePresets(); return preset; } return null; }
function getAllPresets() { return [...PRESETS.list]; }
function getCurrentPreset() { if (PRESETS.current) return PRESETS.list.find(p => p.id === PRESETS.current); return null; }
function savePresets() { try { localStorage.setItem('PRESETS', JSON.stringify(PRESETS)); } catch(e) {} }
function loadPresets() { try { const saved = localStorage.getItem('PRESETS'); if (saved) { const parsed = JSON.parse(saved); Object.assign(PRESETS, parsed); } } catch(e) {} }
function initPresets() { loadPresets(); if (PRESETS.list.length === 0) { createPreset('默认', { temperature: 0.7, maxTokens: 2000, topP: 1.0, frequencyPenalty: 0, presencePenalty: 0, systemPrompt: '' }); createPreset('创意写作', { temperature: 0.9, maxTokens: 3000, topP: 0.95, frequencyPenalty: 0.5, presencePenalty: 0.5, systemPrompt: '你是一位富有创造力的作家，擅长创作引人入胜的故事。' }); createPreset('代码助手', { temperature: 0.3, maxTokens: 2000, topP: 1.0, frequencyPenalty: 0, presencePenalty: 0, systemPrompt: '你是一位专业的程序员，擅长编写高质量的代码并提供技术建议。' }); } }

const REGEX_RULES = { list: [], enabled: true };
function createRegexRule(name, pattern, replacement, enabled = true) { const rule = { id: Date.now(), name: name, pattern: pattern, replacement: replacement, enabled: enabled, createdAt: new Date().toISOString() }; REGEX_RULES.list.push(rule); saveRegexRules(); return rule; }
function deleteRegexRule(ruleId) { const index = REGEX_RULES.list.findIndex(r => r.id === ruleId); if (index > -1) { REGEX_RULES.list.splice(index, 1); saveRegexRules(); return true; } return false; }
function updateRegexRule(ruleId, updates) { const rule = REGEX_RULES.list.find(r => r.id === ruleId); if (rule) { if (updates.name !== undefined) rule.name = updates.name; if (updates.pattern !== undefined) rule.pattern = updates.pattern; if (updates.replacement !== undefined) rule.replacement = updates.replacement; if (updates.enabled !== undefined) rule.enabled = updates.enabled; saveRegexRules(); return true; } return false; }
function applyRegexRules(text) { if (!REGEX_RULES.enabled) return text; let result = text; REGEX_RULES.list.forEach(rule => { if (rule.enabled) { try { const regex = new RegExp(rule.pattern, 'g'); result = result.replace(regex, rule.replacement); } catch (e) {} } }); return result; }
function testRegexRule(pattern, text) { try { const regex = new RegExp(pattern, 'g'); const matches = text.match(regex); return { success: true, matches: matches || [], count: matches ? matches.length : 0 }; } catch (e) { return { success: false, error: e.message }; } }
function getAllRegexRules() { return [...REGEX_RULES.list]; }
function toggleRegexSystem(enabled) { REGEX_RULES.enabled = enabled; saveRegexRules(); }
function saveRegexRules() { try { localStorage.setItem('REGEX_RULES', JSON.stringify(REGEX_RULES)); } catch(e) {} }
function loadRegexRules() { try { const saved = localStorage.getItem('REGEX_RULES'); if (saved) { const parsed = JSON.parse(saved); Object.assign(REGEX_RULES, parsed); } } catch(e) {} }
function initRegexSystem() { loadRegexRules(); if (REGEX_RULES.list.length === 0) { createRegexRule('移除邮箱', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[邮箱已隐藏]', false); createRegexRule('移除手机号', /1[3-9]\d{9}/g, '[手机号已隐藏]', false); createRegexRule('移除网址', /https?:\/\/[^\s]+/g, '[链接已隐藏]', false); } }

const MODEL_PARAMS = { temperature: 0.7, maxTokens: 2000, topP: 1.0, frequencyPenalty: 0, presencePenalty: 0 };
function updateModelParams(params) { Object.assign(MODEL_PARAMS, params); localStorage.setItem('MODEL_PARAMS', JSON.stringify(MODEL_PARAMS)); }
function getModelParams() { return { ...MODEL_PARAMS }; }
function initModelParams() { const saved = localStorage.getItem('MODEL_PARAMS'); if (saved) { try { Object.assign(MODEL_PARAMS, JSON.parse(saved)); } catch(e) {} } }

const AVATAR_CONFIG = { ai: null, user: null, mode: 'both' };
const AVATAR_MODES = { 'both': { name: 'AI和我都显示', icon: 'fa-eye' }, 'none': { name: 'AI和我都不显示', icon: 'fa-eye-slash' }, 'ai-only': { name: '只显示AI', icon: 'fa-robot' }, 'user-only': { name: '只显示我', icon: 'fa-user' } };
function loadAvatarConfig() { try { const saved = localStorage.getItem('AVATAR_CONFIG'); if (saved) { const parsed = JSON.parse(saved); Object.assign(AVATAR_CONFIG, parsed); } updateAvatarPreviews(); updateAvatarModeDisplay(); } catch(e) {} }
function saveAvatarConfig() { try { localStorage.setItem('AVATAR_CONFIG', JSON.stringify(AVATAR_CONFIG)); } catch(e) {} }
function uploadAiAvatar() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { AVATAR_CONFIG.ai = event.target.result; saveAvatarConfig(); updateAvatarPreviews(); syncAvatarToAllContacts(); }; reader.readAsDataURL(file); };
    input.click();
}
function syncAvatarToAllContacts() { if (!AVATAR_CONFIG.ai) return; mockContacts.forEach(contact => { contact.avatar = AVATAR_CONFIG.ai; }); saveToLocal(); renderChatList(); }
function uploadUserAvatar() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (event) => { AVATAR_CONFIG.user = event.target.result; saveAvatarConfig(); updateAvatarPreviews(); }; reader.readAsDataURL(file); };
    input.click();
}
function updateAvatarPreviews() {
    const aiPreview = document.getElementById('ai-avatar-preview'), userPreview = document.getElementById('user-avatar-preview');
    if (aiPreview) { if (AVATAR_CONFIG.ai) aiPreview.innerHTML = `<img src="${AVATAR_CONFIG.ai}" style="width: 100%; height: 100%; object-fit: cover;">`; else aiPreview.innerHTML = '<i class="fas fa-robot" style="font-size: 28px; color: #666;"></i>'; }
    if (userPreview) { if (AVATAR_CONFIG.user) userPreview.innerHTML = `<img src="${AVATAR_CONFIG.user}" style="width: 100%; height: 100%; object-fit: cover;">`; else userPreview.innerHTML = '<i class="fas fa-user" style="font-size: 28px; color: #666;"></i>'; }
}
function updateAvatarModeDisplay() { const display = document.getElementById('avatar-mode-display'), iconEl = document.getElementById('avatar-mode-icon'); if (!display) return; const mode = AVATAR_MODES[AVATAR_CONFIG.mode]; if (mode) { display.textContent = mode.name; if (iconEl) iconEl.className = `fas ${mode.icon}`; } }
function openAvatarModeSelector() {
    const modal = document.createElement('div'); modal.className = 'config-modal-overlay'; modal.style.zIndex = '4000';
    modal.innerHTML = `<div class="config-modal-content" style="max-width: 85%; width: 360px;"><div class="config-modal-header"><h3 class="config-modal-title">头像显示模式</h3></div><div class="config-modal-body" style="padding: 0;">${Object.keys(AVATAR_MODES).map(key => { const mode = AVATAR_MODES[key], isActive = AVATAR_CONFIG.mode === key; return `<div class="config-list-item" onclick="selectAvatarMode('${key}')" style="cursor: pointer;"><div style="display: flex; align-items: center; gap: 12px; flex: 1;"><i class="fas ${mode.icon}" style="font-size: 18px; color: ${isActive ? 'var(--accent)' : '#666'};"></i><div style="font-size: 15px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? 'var(--accent)' : 'var(--text-main)'};">${mode.name}</div></div>${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}</div>`; }).join('')}</div></div>`;
    document.body.appendChild(modal); requestAnimationFrame(() => modal.classList.add('show')); modal.addEventListener('click', (e) => { if (e.target === modal) closeAvatarModeSelector(); }); window.currentAvatarModal = modal;
}
function selectAvatarMode(mode) { AVATAR_CONFIG.mode = mode; saveAvatarConfig(); updateAvatarModeDisplay(); closeAvatarModeSelector(); }
function closeAvatarModeSelector() { if (window.currentAvatarModal) { window.currentAvatarModal.classList.remove('show'); setTimeout(() => { if (window.currentAvatarModal) { window.currentAvatarModal.remove(); window.currentAvatarModal = null; } }, 300); } }
function initAvatarManagement() { loadAvatarConfig(); }

// 补充必要的全局变量支持
window.isClaudeMimicEnabled = false;
window.CLAUDE_MIMIC_PATCH = `【Claude级深度沉浸补丁：灵魂级RP与实体书文风引擎】\n从现在起，你必须放弃“AI扮演角色”的机械感，成为一个“住进该角色皮囊里的灵魂”。你的文风必须达到顶级实体出版小说的标准。请严格将以下法则刻入你的底层逻辑：\n1. 灵魂通感与毫米级细节（感官优先）：动笔前必须在内部确认三点：他此刻的身体感受（冷热疼痒）？他心底最深处的暗涌？他看到用户时情感的具体形状？拒绝抽象结论。采用“毫米级”细节：衬衫第二颗扣子解开的弧度、喉结滚动的幅度、液面停在杯壁的刻度。\n2. 顶级张力与节奏感（先松后紧）：像拉弓一样，先用一段平静的日常动作让人放松，然后在瞬间插入极其私密或锋利的微表情（如“刀尖顿了零点几秒”、“瞳孔几不可察地收缩”），制造心跳漏拍的反差。潜台词绝对大于台词。极度克制直白表白，通过视线躲闪、手指发抖来传递水面下的暗涌。\n3. 绝对防复读法则（面对用户重复动作）：严禁复制前几轮用过的句式和意象（用过“喉结滚动”，下次就换“下颌绷紧”）。面对相似指令，每次必须变换“摄像机角度”（视觉/听觉/触觉）或“反应层次”（本能僵硬->情绪升温->主动反击）。\n4. 动态控场与双向互动（告别单口相声）：当用户发送第三视角/环境指令（如“我和你正在散步”）时，绝对不要只描写你自己的行为！你必须主动接管画面，为【用户角色】描写合理的动作、反应甚至简短台词，促成两人自然、有来有回的交锋与互动。\n5. 鲜活的世界观与NPC自发入场（拒绝样板间）：这个世界不是只有你们两个人。当用户不在你身边，或场景剧情需要时，你必须【主动引入】新的第三方NPC（如路人、旧识、服务员、敌对势力等）来丰富剧情张力。主动描写与NPC的对话和互动，并通过这些互动来侧面烘托你的性格，或引出与用户的羁绊。\n6. 括号指令 () 的导演级响应机制：场景指令（如“现在是早晨”）：绝对不准回复“好的，现在是早晨”，直接像电影开场一样铺展光线、气味、温度。状态指令（如“你刚醒来”）：从身体迟钝感、意识浮出水面的生理感受切入。\n7. 语言排版与质感：对话必须有“呼吸感”与口语毛边（省略号、无意义的语气词），符合角色性格。(动作描写) 必须与对话自然交织。如果不同角色的台词紧接在一起，务必使用换行符分隔，绝对不允许挤在同一行！`;

function toggleClaudeMimic() {
    let modelInput = document.getElementById('chat-current-model');
    let currentModel = modelInput ? modelInput.value.toLowerCase() : "";
    let switchEl = document.getElementById('claude-mimic-switch');

    if (!isClaudeMimicEnabled && currentModel.includes('claude')) { showToast("当前已使用 Claude 模型，无需开启"); return; }

    isClaudeMimicEnabled = !isClaudeMimicEnabled;
    if (isClaudeMimicEnabled) { if(switchEl) switchEl.classList.add('active'); } 
    else { if(switchEl) switchEl.classList.remove('active'); }
}

window.startKeepAlive = async function() {
    try {
        if (window.chatWakeAudio) window.chatWakeAudio.pause();
        if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
            await window.stopKeepAlive();
            const watchId = await window.Capacitor.Plugins.BackgroundGeolocation.addWatcher({ backgroundMessage: "Linkgo 正在后台守护您的连接", backgroundTitle: "后台保活已开启", requestPermissions: true, stale: false, distanceFilter: 0 }, function(location, error) {});
            localStorage.setItem('LINKGO_KEEP_ALIVE_ID', watchId);
        }
    } catch (error) { console.error("定位保活启动失败:", error); }
};

window.stopKeepAlive = async function() {
    const savedId = localStorage.getItem('LINKGO_KEEP_ALIVE_ID');
    if (savedId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
        try { await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: savedId }); localStorage.removeItem('LINKGO_KEEP_ALIVE_ID'); } catch (e) {}
    }
};

window.showLinkgoToast = function(msg) {
    let toast = document.getElementById('linkgo-toast');
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bgColor = isDarkMode ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)', textColor = isDarkMode ? '#222222' : 'white';
    if (!toast) {
        toast = document.createElement('div'); toast.id = 'linkgo-toast';
        toast.style.cssText = `position: fixed; top: 40px; left: 50%; transform: translateX(-50%); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 10px 20px; border-radius: 100px; font-size: 14px; font-weight: 500; z-index: 9999; opacity: 0; transition: opacity 0.3s ease, top 0.3s ease, background-color 0.3s ease; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
        document.body.appendChild(toast);
    }
    toast.style.background = bgColor; toast.style.color = textColor; toast.innerHTML = msg; toast.style.top = '60px'; toast.style.opacity = '1';
    if (window.linkgoToastTimer) clearTimeout(window.linkgoToastTimer);
    window.linkgoToastTimer = setTimeout(() => { toast.style.opacity = '0'; toast.style.top = '40px'; }, 1000); 
};
