// ==========================================
// API配置系统初始化
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

// ==========================================
// Chat API 配置管理
// ==========================================
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
    try {
        localStorage.setItem('CHAT_API_CONFIGS', JSON.stringify(CHAT_API_CONFIGS));
    } catch(e) { console.error('保存Chat API配置失败:', e); }
}

function updateChatConfigDisplay() {
    const configNameInput = document.getElementById('chat-config-name');
    const modelInput = document.getElementById('chat-current-model');
    if (!configNameInput || !modelInput) return;
    
    if (CHAT_API_CONFIGS.currentId) {
        const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
        configNameInput.value = config ? config.name : '点击选择配置';
    } else {
        configNameInput.value = '点击选择配置';
    }
    modelInput.value = CHAT_API_CONFIGS.currentModel || '';
}

let modalProxyTempState = true; 

function toggleModalProxySwitch() {
    modalProxyTempState = !modalProxyTempState;
    const indicator = document.getElementById('modal-proxy-switch');
    if (indicator) {
        if (modalProxyTempState) indicator.classList.add('active');
        else indicator.classList.remove('active');
    }
}

function setModalProxySwitchState(state) {
    modalProxyTempState = state;
    const indicator = document.getElementById('modal-proxy-switch');
    if (indicator) {
        if (modalProxyTempState) indicator.classList.add('active');
        else indicator.classList.remove('active');
    }
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
            const timeA = a.lastUsed || 0;
            const timeB = b.lastUsed || 0;
            if (timeA !== timeB) return timeB - timeA;
            return b.id - a.id;
        });

        listContainer.innerHTML = '';
        sortedConfigs.forEach(config => {
            const wrapper = document.createElement('div');
            wrapper.className = 'config-item-wrapper';
            const actions = `<div class="config-item-actions"><div class="config-action-btn config-action-edit" onclick="event.stopPropagation(); editChatConfig(${config.id});"><i class="fa-solid fa-pen-to-square"></i></div><div class="config-action-btn config-action-delete" onclick="event.stopPropagation(); deleteChatConfig(${config.id});"><i class="fa-solid fa-trash-can"></i></div></div>`;
            const isActive = config.id === activeId;
            const itemHtml = `<div class="config-list-item config-list-item-swipeable">
                <div class="config-item-info">
                    <div class="config-item-name" style="color: ${isActive ? 'var(--accent)' : 'var(--text-main)'}; font-weight: ${isActive ? '600' : '500'};">${config.name}</div>
                    <div class="config-item-model">${config.model || '未选择模型'}</div>
                </div>
                ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
            </div>`;
            
            wrapper.innerHTML = actions + itemHtml;
            const itemNode = wrapper.querySelector('.config-list-item-swipeable');
            itemNode.onclick = (e) => {
                if (itemNode.style.transform === 'translateX(-110px)') {
                    resetConfigSwipe(itemNode); e.stopPropagation();
                } else {
                    selectUnifiedConfig(config.id);
                }
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
        saveChatApiConfigs();
        updateChatConfigDisplay();
    } else if (ctx === 'other') {
        const type = window.currentOtherApiType;
        OTHER_API_CONFIGS[type].configId = configId;
        OTHER_API_CONFIGS[type].model = config.model || '';
        saveOtherApiConfigs();
        updateOtherConfigDisplay();
    }
    openUnifiedConfigSelector(ctx, window.currentOtherApiType);
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
            config.name = name; config.url = url; config.key = key; config.model = model;
            config.useProxy = modalProxyTempState;
            if (CHAT_API_CONFIGS.currentId === config.id) CHAT_API_CONFIGS.currentModel = model;
            alert('配置已更新！');
        }
    } else {
        const newConfig = { id: Date.now(), name, url, key, model, useProxy: modalProxyTempState, createdAt: new Date().toISOString() };
        CHAT_API_CONFIGS.list.push(newConfig);
        if (!isOther) { CHAT_API_CONFIGS.currentId = newConfig.id; CHAT_API_CONFIGS.currentModel = model; }
        alert('配置已保存！');
    }
    
    saveChatApiConfigs();
    updateChatConfigDisplay();
    updateOtherConfigDisplay();
    closeNewConfigForm();
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
    Object.keys(OTHER_API_CONFIGS).forEach(key => {
        if (OTHER_API_CONFIGS[key].configId === configId) { OTHER_API_CONFIGS[key].configId = null; OTHER_API_CONFIGS[key].model = ''; }
    });

    CHAT_API_CONFIGS.list = CHAT_API_CONFIGS.list.filter(c => c.id !== configId);
    saveChatApiConfigs(); saveOtherApiConfigs();
    updateChatConfigDisplay(); updateOtherConfigDisplay();
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
        useProxy = true;
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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list_models', customEndpoint: targetUrl, customApiKey: key })
            });
        } else {
            response = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept': 'application/json' }
            });
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
        } else {
            throw new Error('返回格式错误（缺少 data.data）');
        }
    } catch (e) {
        alert('拉取模型失败: ' + e.message);
    } finally {
        if (context === 'new') modelInput.placeholder = originalPlaceholder;
    }
}

function renderUnifiedModelList(models) {
    const listContainer = document.getElementById('model-list-container');
    if (models.length === 0) {
        listContainer.innerHTML = '<div style="padding: 40px 20px; text-align: center; color: var(--text-sub);"><p style="font-size: 14px;">未找到匹配的模型</p></div>';
        return;
    }
    let currentActiveModel = '';
    if (window.currentModelSelectorContext === 'main') currentActiveModel = CHAT_API_CONFIGS.currentModel;
    else if (window.currentModelSelectorContext === 'other') currentActiveModel = OTHER_API_CONFIGS[window.currentOtherApiType]?.model || '';

    listContainer.innerHTML = models.map(modelId => {
        const isActive = modelId === currentActiveModel;
        return `
            <div class="config-list-item" onclick="selectUnifiedModel('${modelId}')">
                <div class="config-item-info">
                    <div class="config-item-name" style="font-size: 14px; font-weight: ${isActive?'600':'500'}; color: ${isActive?'var(--accent)':'var(--text-main)'};">${modelId}</div>
                </div>
                ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
            </div>
        `;
    }).join('');
}

function selectUnifiedModel(modelId) {
    const ctx = window.currentModelSelectorContext;
    if (ctx === 'new') {
        document.getElementById('new-config-model').value = modelId;
    } else if (ctx === 'main') {
        CHAT_API_CONFIGS.currentModel = modelId;
        const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
        if (config) config.model = modelId;
        saveChatApiConfigs();
        updateChatConfigDisplay();
    } else if (ctx === 'other') {
        const type = window.currentOtherApiType;
        OTHER_API_CONFIGS[type].model = modelId;
        const configId = OTHER_API_CONFIGS[type].configId;
        const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
        if (config) config.model = modelId;
        saveOtherApiConfigs();
        updateOtherConfigDisplay();
    }
    document.getElementById('model-selector-modal').classList.remove('show');
}

function filterModels(searchText) {
    renderUnifiedModelList(availableModels.filter(m => m.toLowerCase().includes(searchText.toLowerCase())));
}

function initChatApiConfigSystem() {
    loadChatApiConfigs();
    document.getElementById('chat-config-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });
    document.getElementById('new-config-modal').addEventListener('click', function(e) { if (e.target === this) closeNewConfigForm(); });
    document.getElementById('model-selector-modal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('show'); });
}

// ==========================================
// 参数配置 (温度、Tokens等)
// ==========================================
const PARAM_CONFIG = {
    stream: true, temperature: 0.7, maxTokens: 2048, frequencyPenalty: 0.0, presencePenalty: 0.0
};

function loadParamConfig() {
    try {
        const saved = localStorage.getItem('PARAM_CONFIG');
        if (saved) Object.assign(PARAM_CONFIG, JSON.parse(saved));
        updateStreamSwitchUI(); updateTemperatureUI(); updateMaxTokensUI(); updateFrequencyUI(); updatePresenceUI();
    } catch(e) {}
}

function saveParamConfig() {
    try { localStorage.setItem('PARAM_CONFIG', JSON.stringify(PARAM_CONFIG)); } catch(e) {}
}

function toggleStreamOutput() {
    PARAM_CONFIG.stream = !PARAM_CONFIG.stream;
    updateStreamSwitchUI(); saveParamConfig();
}

function updateStreamSwitchUI() {
    const switchEl = document.getElementById('stream-switch');
    if (switchEl) switchEl.classList.toggle('active', PARAM_CONFIG.stream);
}

function updateTemperatureUI() {
    const display = document.getElementById('temperature-display');
    const thumb = document.getElementById('temperature-thumb');
    if (display) display.textContent = PARAM_CONFIG.temperature.toFixed(1);
    if (thumb) thumb.style.left = ((PARAM_CONFIG.temperature - 0.1) / 1.9) * 100 + '%';
}

function updateMaxTokensUI() {
    const display = document.getElementById('max-tokens-display');
    const thumb = document.getElementById('max-tokens-thumb');
    if (display) display.textContent = PARAM_CONFIG.maxTokens;
    if (thumb) thumb.style.left = ((PARAM_CONFIG.maxTokens - 256) / (4096 - 256)) * 100 + '%';
}

function updateFrequencyUI() {
    const display = document.getElementById('frequency-display');
    const thumb = document.getElementById('frequency-thumb');
    if (display) display.textContent = PARAM_CONFIG.frequencyPenalty.toFixed(1);
    if (thumb) thumb.style.left = (PARAM_CONFIG.frequencyPenalty / 2.0) * 100 + '%';
}

function updatePresenceUI() {
    const display = document.getElementById('presence-display');
    const thumb = document.getElementById('presence-thumb');
    if (display) display.textContent = PARAM_CONFIG.presencePenalty.toFixed(1);
    if (thumb) thumb.style.left = (PARAM_CONFIG.presencePenalty / 2.0) * 100 + '%';
}

function initTemperatureSlider() {
    const track = document.getElementById('temperature-track'); const thumb = document.getElementById('temperature-thumb');
    if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => {
        let percent = Math.max(0, Math.min(100, ((clientX - track.getBoundingClientRect().left) / track.getBoundingClientRect().width) * 100));
        let value = Math.round((0.1 + (percent / 100) * 1.9) * 10) / 10;
        PARAM_CONFIG.temperature = value; thumb.style.left = percent + '%';
        document.getElementById('temperature-display').textContent = value.toFixed(1); saveParamConfig();
    };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
    document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
    document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
    document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
    document.addEventListener('touchend', () => { isDragging = false; });
}

function initFrequencySlider() {
    const track = document.getElementById('frequency-track'); const thumb = document.getElementById('frequency-thumb');
    if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => {
        let percent = Math.max(0, Math.min(100, ((clientX - track.getBoundingClientRect().left) / track.getBoundingClientRect().width) * 100));
        let value = Math.round((percent / 100) * 2.0 * 10) / 10;
        PARAM_CONFIG.frequencyPenalty = value; thumb.style.left = percent + '%';
        document.getElementById('frequency-display').textContent = value.toFixed(1); saveParamConfig();
    };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
    document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
    document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
    document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
    document.addEventListener('touchend', () => { isDragging = false; });
}

function initPresenceSlider() {
    const track = document.getElementById('presence-track'); const thumb = document.getElementById('presence-thumb');
    if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => {
        let percent = Math.max(0, Math.min(100, ((clientX - track.getBoundingClientRect().left) / track.getBoundingClientRect().width) * 100));
        let value = Math.round((percent / 100) * 2.0 * 10) / 10;
        PARAM_CONFIG.presencePenalty = value; thumb.style.left = percent + '%';
        document.getElementById('presence-display').textContent = value.toFixed(1); saveParamConfig();
    };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
    document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
    document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
    document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
    document.addEventListener('touchend', () => { isDragging = false; });
}

function initMaxTokensSlider() {
    const track = document.getElementById('max-tokens-track'); const thumb = document.getElementById('max-tokens-thumb');
    if (!track || !thumb) return;
    let isDragging = false;
    const updateValue = (clientX) => {
        let percent = Math.max(0, Math.min(100, ((clientX - track.getBoundingClientRect().left) / track.getBoundingClientRect().width) * 100));
        let value = Math.round((256 + (percent / 100) * (4096 - 256)) / 128) * 128;
        value = Math.max(256, Math.min(4096, value));
        PARAM_CONFIG.maxTokens = value; thumb.style.left = ((value - 256) / (4096 - 256)) * 100 + '%';
        document.getElementById('max-tokens-display').textContent = value; saveParamConfig();
    };
    track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
    document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
    document.addEventListener('mouseup', () => { isDragging = false; });
    thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
    document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
    document.addEventListener('touchend', () => { isDragging = false; });
}

function initParamConfigSystem() {
    loadParamConfig(); initTemperatureSlider(); initMaxTokensSlider(); initFrequencySlider(); initPresenceSlider();
}

// ==========================================
// Other API (记忆、发现、语音)
// ==========================================
const OTHER_API_CONFIGS = {
    memory: { configId: null, model: '' },
    discover: { configId: null, model: '' },
    voice: { configId: null, model: '' }
};
let currentOtherApiType = '';

function toggleOtherAPI() {
    const container = document.getElementById('other-api-container'); const icon = document.getElementById('other-api-toggle-icon');
    if (container.style.maxHeight === '0px' || container.style.maxHeight === '') {
        container.style.maxHeight = '800px'; icon.style.transform = 'rotate(90deg)';
    } else {
        container.style.maxHeight = '0px'; icon.style.transform = 'rotate(0deg)';
    }
}

function loadOtherApiConfigs() {
    try {
        const saved = localStorage.getItem('OTHER_API_CONFIGS');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed.image && !parsed.discover) { parsed.discover = parsed.image; delete parsed.image; }
            Object.assign(OTHER_API_CONFIGS, parsed);
        }
        updateOtherConfigDisplay();
    } catch(e) {}
}

function saveOtherApiConfigs() {
    try { localStorage.setItem('OTHER_API_CONFIGS', JSON.stringify(OTHER_API_CONFIGS)); } catch(e) {}
}

function updateOtherConfigDisplay() {
    const memConf = document.getElementById('memory-config-name'); const memModel = document.getElementById('memory-current-model');
    if (memConf && memModel) {
        if (OTHER_API_CONFIGS.memory.configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.memory.configId);
            memConf.value = config ? config.name : '点击选择配置';
        } else memConf.value = '点击选择配置';
        memModel.value = OTHER_API_CONFIGS.memory.model || '';
    }
    const discConf = document.getElementById('discover-config-name'); const discModel = document.getElementById('discover-current-model');
    if (discConf && discModel) {
        if (OTHER_API_CONFIGS.discover.configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.discover.configId);
            discConf.value = config ? config.name : '点击选择配置';
        } else discConf.value = '点击选择配置';
        discModel.value = OTHER_API_CONFIGS.discover.model || '';
    }
    const voiceConf = document.getElementById('voice-config-name'); const voiceModel = document.getElementById('voice-current-model');
    if (voiceConf && voiceModel) {
        if (OTHER_API_CONFIGS.voice.configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.voice.configId);
            voiceConf.value = config ? config.name : '点击选择配置';
        } else voiceConf.value = '点击选择配置';
        voiceModel.value = OTHER_API_CONFIGS.voice.model || '';
    }
}

function initOtherApiConfigSystem() { loadOtherApiConfigs(); }

// ==========================================
// Push通知 & 保活系统
// ==========================================
const PUSH_CONFIG = {
    vapidPublicKey: 'BKXLKgheQ0pGxeVUifzMecruF3o7OkniEkNSbBUM9sKIeUKn2M8NGG5h3YUV2YrHxzAoHS9-ILmz2MlrSoHt4NU',
    workerUrl: 'https://my-push-worker.ginkgo-yinxing.workers.dev',
    enabled: false, showContent: true 
};

const KEEP_ALIVE_CONFIG = { enabled: false };

window.startKeepAlive = async function() {
    try {
        if (window.chatWakeAudio) window.chatWakeAudio.pause();
        if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
            await window.stopKeepAlive();
            const watchId = await window.Capacitor.Plugins.BackgroundGeolocation.addWatcher({
                backgroundMessage: "Linkgo 正在后台守护您的连接", backgroundTitle: "后台保活已开启",
                requestPermissions: true, stale: false, distanceFilter: 0 
            }, function(location, error) {});
            localStorage.setItem('LINKGO_KEEP_ALIVE_ID', watchId);
        }
    } catch (error) { console.error("定位保活启动失败:", error); }
};

window.stopKeepAlive = async function() {
    const savedId = localStorage.getItem('LINKGO_KEEP_ALIVE_ID');
    if (savedId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
        try {
            await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: savedId });
            localStorage.removeItem('LINKGO_KEEP_ALIVE_ID');
        } catch (e) {}
    }
};

function initPushSystem() {
    const pushEnabled = localStorage.getItem('PUSH_ENABLED') === 'true';
    const showContent = localStorage.getItem('PUSH_SHOW_CONTENT') !== 'false';
    PUSH_CONFIG.enabled = pushEnabled; PUSH_CONFIG.showContent = showContent;
}

function initKeepAliveSystem() {
    const savedState = localStorage.getItem('KEEP_ALIVE_ENABLED') === 'true';
    KEEP_ALIVE_CONFIG.enabled = savedState;
    if (savedState) setTimeout(() => { if (KEEP_ALIVE_CONFIG.enabled) startKeepAlive(); }, 3000);
}

window.pushNotificationQueue = Promise.resolve(); 
async function sendPushNotification(messageText) {
    if (!GENERAL_CONFIG.notification.pushEnabled) return;
    if (document.visibilityState === 'visible') return;
    if (!messageText || typeof messageText !== 'string' || messageText.trim() === '') return;

    window.pushNotificationQueue = window.pushNotificationQueue.then(async () => {
        if (document.visibilityState === 'visible' || window.appRealActive) return;
        try {
            let finalMessage = messageText;
            if (!GENERAL_CONFIG.notification.showContent) finalMessage = '收到一条新消息';
            if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                const { LocalNotifications } = window.Capacitor.Plugins;
                await LocalNotifications.requestPermissions();
                await LocalNotifications.schedule({ notifications: [{ title: "Linkgo", body: finalMessage.substring(0, 100), id: 8888, sound: null }] });
            }
            await new Promise(r => setTimeout(r, 150));
        } catch (error) { console.error('原生通知推送失败:', error); }
    });
}

// ==========================================
// 通用设置及导入导出 (必须放在API模块里，因为很多依赖)
// ==========================================
const GENERAL_CONFIG = {
    memory: { contextLimit: 10, diaryInterval: 10, maxTokens: 4000 },
    notification: { pushEnabled: false, showContent: true, keepAlive: false },
    regexCount: 0, presetCount: 0
};

function loadGeneralConfig() {
    try {
        const saved = localStorage.getItem('GENERAL_CONFIG');
        if (saved) Object.assign(GENERAL_CONFIG, JSON.parse(saved));
        updateGeneralUI();
    } catch(e) {}
}

function saveGeneralConfig() {
    try { localStorage.setItem('GENERAL_CONFIG', JSON.stringify(GENERAL_CONFIG)); } catch(e) {}
}

function updateGeneralUI() {
    const contextInput = document.getElementById('general-context-limit');
    const diaryInput = document.getElementById('general-diary-interval');
    const tokensInput = document.getElementById('general-max-tokens');
    if (contextInput) contextInput.value = GENERAL_CONFIG.memory.contextLimit;
    if (diaryInput) diaryInput.value = GENERAL_CONFIG.memory.diaryInterval;
    if (tokensInput) tokensInput.value = GENERAL_CONFIG.memory.maxTokens;
    updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled);
    updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent);
    updateGeneralSwitch('general-keepalive-switch', GENERAL_CONFIG.notification.keepAlive);
    if (typeof updateGeneralCacheSize === 'function') updateGeneralCacheSize();
    const regexCount = document.getElementById('general-regex-count'); const presetCount = document.getElementById('general-preset-count');
    if (regexCount) regexCount.textContent = GENERAL_CONFIG.regexCount + ' 条';
    if (presetCount) presetCount.textContent = GENERAL_CONFIG.presetCount + ' 个';
}

function updateGeneralSwitch(switchId, isActive) {
    const switchEl = document.getElementById(switchId);
    if (switchEl) switchEl.classList.toggle('active', isActive);
}

function updateGeneralMemoryConfig(key, value) {
    const numValue = parseInt(value);
    if (isNaN(numValue) || numValue < 1) return;
    GENERAL_CONFIG.memory[key] = numValue; saveGeneralConfig();
    if (window.APP_DATA && window.APP_DATA.settings) {
        if (key === 'contextLimit') window.APP_DATA.settings.contextLimit = numValue;
        if (key === 'diaryInterval') window.APP_DATA.settings.diaryInterval = numValue;
        if (key === 'maxTokens' && typeof MEMORY_CONFIG !== 'undefined') MEMORY_CONFIG.maxTokens = numValue;
    }
}

async function toggleGeneralPush() {
    GENERAL_CONFIG.notification.pushEnabled = !GENERAL_CONFIG.notification.pushEnabled;
    updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled); saveGeneralConfig();
    if (GENERAL_CONFIG.notification.pushEnabled) {
        const barkKey = 'JanxutGCNrZgNBjEsuaeen';
        fetch(`https://api.day.app/${barkKey}/Linkgo/推送通知已开启，后台回复将通过 Bark 送达！?group=Linkgo`);
    }
}

function toggleGeneralContent() {
    GENERAL_CONFIG.notification.showContent = !GENERAL_CONFIG.notification.showContent;
    updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent); saveGeneralConfig();
}

window.toggleGeneralKeepAlive = function() {
    GENERAL_CONFIG.notification.keepAlive = !GENERAL_CONFIG.notification.keepAlive;
    saveGeneralConfig();
    localStorage.setItem('KEEP_ALIVE_ENABLED', GENERAL_CONFIG.notification.keepAlive ? 'true' : 'false');
    const switchEl = document.getElementById('general-keepalive-switch');
    if (GENERAL_CONFIG.notification.keepAlive) {
        if(switchEl) switchEl.classList.add('active'); 
        if (window.startKeepAlive) window.startKeepAlive(); 
        if (window.showLinkgoToast) showLinkgoToast('📍 已开启定位保活');
    } else {
        if(switchEl) switchEl.classList.remove('active'); 
        if (window.stopKeepAlive) window.stopKeepAlive(); 
        if (window.showLinkgoToast) showLinkgoToast('已关闭后台保活');
    }
};

const EXPORT_DICTIONARY = {
    chat: ['CHAT_CONTACTS'], interaction: ['ACTIVITY_STATS'], api: ['CHAT_API_CONFIGS', 'OTHER_API_CONFIGS', 'MODEL_PARAMS', 'PARAM_CONFIG', 'MEMORY_CONFIG'],
    appearance: ['AVATAR_CONFIG', 'theme', 'themeMode'], general: ['GENERAL_CONFIG', 'PUSH_ENABLED', 'PUSH_SHOW_CONTENT', 'KEEP_ALIVE_ENABLED', 'RELOAD_TARGET_PAGE'],
    presets: ['PRESETS', 'ADVANCED_PRESET_FILES'], regex: ['REGEX_RULES', 'ADVANCED_REGEX_FILES'], forum: ['FORUM_POSTS']
};

function openExportSheet() {
    const sheet = document.getElementById('export-sheet'); sheet.style.display = ''; 
    setTimeout(() => sheet.classList.add('show'), 10); 
    const checkboxes = document.querySelectorAll('.export-item-cb'); const selectAllBtn = document.getElementById('export-select-all');
    checkboxes.forEach(cb => { cb.onchange = () => { selectAllBtn.checked = Array.from(checkboxes).every(c => c.checked); }; });
}

function closeExportSheet() { document.getElementById('export-sheet').classList.remove('show'); }
function toggleAllExportCheckboxes(selectAllCheckbox) { document.querySelectorAll('.export-item-cb').forEach(cb => cb.checked = selectAllCheckbox.checked); }
function closeImportSheet() { document.getElementById('import-sheet').classList.remove('show'); pendingImportSnapshot = null; }
function toggleAllImportCheckboxes(selectAllCheckbox) { document.querySelectorAll('.import-item-cb').forEach(cb => { if (!cb.disabled) cb.checked = selectAllCheckbox.checked; }); }

let pendingImportSnapshot = null;

async function executeCategorizedExport() {
    await saveQueue; 
    try {
        if (typeof saveToLocal === 'function') await saveToLocal();
        if (typeof saveChatApiConfigs === 'function') saveChatApiConfigs();
        if (typeof saveOtherApiConfigs === 'function') saveOtherApiConfigs();
        if (typeof saveGeneralConfig === 'function') saveGeneralConfig();

        const checkedCategories = Array.from(document.querySelectorAll('.export-item-cb')).filter(cb => cb.checked).map(cb => cb.value);
        if (checkedCategories.length === 0) { alert('请至少选择一项要导出的数据！'); return; }
        const snapshot = {};

        Object.keys(localStorage).forEach(key => {
            for (let cat of checkedCategories) {
                if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) { snapshot[key] = localStorage.getItem(key); break; }
            }
        });

        if (checkedCategories.includes('chat')) {
            let chatContacts = await DB.getItem('CHAT_CONTACTS') || localStorage.getItem('CHAT_CONTACTS');
            if (chatContacts) snapshot['CHAT_CONTACTS'] = chatContacts;
            let appSettings = await DB.getItem('APP_SETTINGS');
            if (appSettings) snapshot['APP_SETTINGS'] = appSettings;
            
            let contactIds = [];
            if (chatContacts) { try { contactIds = JSON.parse(chatContacts).map(c => c.id); } catch(e) {} }
            if (contactIds.length === 0 && typeof mockContacts !== 'undefined') contactIds = mockContacts.map(c => c.id);
            for (const id of contactIds) {
                const key = `CONV_${id}`; const val = await DB.getItem(key);
                if (val) snapshot[key] = val;
            }
        }

        if (checkedCategories.includes('forum')) {
            let forumPosts = await DB.getItem('FORUM_POSTS') || localStorage.getItem('FORUM_POSTS');
            if (forumPosts) snapshot['FORUM_POSTS'] = forumPosts;
        }

        if (checkedCategories.includes('interaction')) {
            let activityStats = await DB.getItem('ACTIVITY_STATS');
            if (!activityStats) {
                const appDataStr = await DB.getItem('APP_DATA');
                if (appDataStr) { try { const appData = JSON.parse(appDataStr); if (appData.activityStats) activityStats = JSON.stringify(appData.activityStats); } catch(e) {} }
            }
            if (activityStats) snapshot['ACTIVITY_STATS'] = activityStats;
        }

        const exportData = { _version: '7.1', _time: new Date().toISOString(), data: snapshot };
        const dataStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const fileName = `linkgo-backup-${new Date().toISOString().split('T')[0]}.json`;

        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file] }).then(() => closeExportSheet()).catch(() => closeExportSheet());
        } else {
            const url = URL.createObjectURL(blob); const a = document.createElement('a');
            a.href = url; a.download = fileName; a.style.display = 'none'; document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
            closeExportSheet(); alert('✅ 导出成功！');
        }
    } catch(e) { alert('⚠️ 导出失败: ' + e.message); }
}

function importGeneralData() {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.style.display = 'none'; document.body.appendChild(input);
    input.onchange = function(e) {
        const file = e.target.files[0]; if (!file) { document.body.removeChild(input); return; }
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const fileData = JSON.parse(event.target.result);
                pendingImportSnapshot = fileData.data || fileData.localStorageData;
                if (!pendingImportSnapshot || typeof pendingImportSnapshot !== 'object') { alert('⚠️ 文件格式错误！'); return; }
                
                const backupKeys = Object.keys(pendingImportSnapshot); let presentCategories = []; let hasOther = false;
                backupKeys.forEach(key => {
                    let isKnown = false;
                    for (let cat in EXPORT_DICTIONARY) {
                        if (EXPORT_DICTIONARY[cat].includes(key)) { if (!presentCategories.includes(cat)) presentCategories.push(cat); isKnown = true; }
                    }
                    if (key.startsWith('CONV_')) { if (!presentCategories.includes('chat')) presentCategories.push('chat'); isKnown = true; }
                    if (!isKnown) hasOther = true;
                });
                if (hasOther) presentCategories.push('other');

                document.querySelectorAll('.import-item-cb').forEach(cb => {
                    if (presentCategories.includes(cb.value)) { cb.checked = true; cb.disabled = false; cb.parentElement.style.opacity = '1'; }
                    else { cb.checked = false; cb.disabled = true; cb.parentElement.style.opacity = '0.4'; }
                });
                document.getElementById('import-select-all').checked = true;

                const sheet = document.getElementById('import-sheet'); sheet.style.display = ''; setTimeout(() => sheet.classList.add('show'), 10);
            } catch(e) { alert('⚠️ 读取失败！'); }
            if (document.body.contains(input)) document.body.removeChild(input);
        };
        reader.readAsText(file);
    };
    input.click();
}

async function executeCategorizedImport() {
    if (!pendingImportSnapshot) return;
    const checkedCategories = Array.from(document.querySelectorAll('.import-item-cb')).filter(cb => cb.checked).map(cb => cb.value);
    if (checkedCategories.length === 0) { alert('请至少选择一项！'); return; }
    if (!confirm('⚠️ 警告：这将使用备份文件【覆盖】您勾选的数据类别！\n确定要继续吗？')) return;

    window.saveToLocal = function() {}; window.saveChatApiConfigs = function() {}; window.saveOtherApiConfigs = function() {};
    window.saveGeneralConfig = function() {}; window.saveAdvancedPresetFiles = function() {}; window.saveAdvancedRegexFiles = function() {};

    for (const key of Object.keys(pendingImportSnapshot)) {
        let shouldImport = false; const valStr = String(pendingImportSnapshot[key]);
        for (let cat of checkedCategories) {
            if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) { shouldImport = true; break; }
        }
        if (checkedCategories.includes('chat') && key.startsWith('CONV_')) shouldImport = true;
        if (checkedCategories.includes('interaction') && key === 'ACTIVITY_STATS') shouldImport = true;

        if (key === 'APP_DATA' && (checkedCategories.includes('interaction') || checkedCategories.includes('chat'))) {
            try {
                const oldAppData = JSON.parse(valStr);
                if (oldAppData.activityStats && checkedCategories.includes('interaction')) await DB.setItem('ACTIVITY_STATS', JSON.stringify(oldAppData.activityStats));
                if (checkedCategories.includes('chat') && oldAppData.conversations) {
                    for (const [contactId, conv] of Object.entries(oldAppData.conversations)) {
                        if (conv && conv.length > 0) await DB.setItem(`CONV_${contactId}`, JSON.stringify(conv));
                    }
                }
            } catch(e) {}
            shouldImport = false; 
        }

        if (key === 'APP_SETTINGS') {
            if (checkedCategories.includes('interaction')) {
                try { const settings = JSON.parse(valStr); if (settings.activityStats) await DB.setItem('ACTIVITY_STATS', JSON.stringify(settings.activityStats)); } catch(e) {}
            }
            shouldImport = (checkedCategories.includes('chat') || checkedCategories.includes('general'));
        }

        if (shouldImport) {
            const dbKeys = ['CHAT_CONTACTS', 'APP_SETTINGS', 'FORUM_POSTS', 'ACTIVITY_STATS'];
            if (key.startsWith('CONV_') || dbKeys.includes(key)) await DB.setItem(key, valStr);
            else localStorage.setItem(key, valStr);
        }
    }
    alert('✅ 选择的数据已成功恢复！点击确定将重新加载页面。');
    window.location.href = window.location.href.split('#')[0];
}

document.querySelectorAll('.import-item-cb').forEach(cb => {
    cb.addEventListener('change', () => {
        const enabledCheckboxes = Array.from(document.querySelectorAll('.import-item-cb')).filter(c => !c.disabled);
        document.getElementById('import-select-all').checked = enabledCheckboxes.every(c => c.checked);
    });
});

function initGeneralPage() {
    loadGeneralConfig();
    GENERAL_CONFIG.regexCount = REGEX_RULES.list.length;
    GENERAL_CONFIG.presetCount = PRESETS.list.length;
    document.getElementById('general-regex-count').textContent = GENERAL_CONFIG.regexCount + ' 条';
    document.getElementById('general-preset-count').textContent = GENERAL_CONFIG.presetCount + ' 个';
}
