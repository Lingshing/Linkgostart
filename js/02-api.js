        // ==========================================
        // 第2批移植：API配置系统
        // ==========================================
        
        async function initApiConfig() {
            // 从本地存储加载API配置
            await loadFromLocal();
            
            // 同步到输入框
            const apiKeyInput = document.getElementById('api-key-input');
            const apiUrlInput = document.getElementById('api-url-input');
            
            if (apiKeyInput) {
                apiKeyInput.value = APP_DATA.apiKey || '';
                // 监听输入变化，自动保存
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
        
        // --- 验证API配置 ---
        function validateApiConfig() {
            if (!APP_DATA.apiKey) {
                alert('请先在"我"页面配置API密钥');
                return false;
            }
            return true;
        }

        // ==========================================
        // 第5批移植：主题切换功能
        // ==========================================
        
        // --- 主题配置 ---
        const THEMES = {
            light: {
                name: '浅色',
                '--bg-color': '#f2f2f7',
                '--card-bg': '#ffffff',
                '--text-main': '#000000',
                '--text-sub': '#8e8e93',
                '--accent': '#5C92D1',
                '--accent-light': 'rgba(92, 146, 209, 0.12)',
                '--danger': '#E64A4A',
                '--border': 'rgba(0,0,0,0.08)',
                '--nav-bg': 'rgba(255,255,255,0.85)',
                '--nav-blur-bg': 'rgba(255,255,255,0.92)',
                '--tab-bar-bg': 'rgba(255,255,255,0.92)',
                '--input-bg': '#ffffff',
                '--hover-bg': '#f2f2f7',
                '--icon-color': '#000000',
                '--divider': 'rgba(0,0,0,0.1)',
                '--user-bubble-bg': '#95ec69',
                '--user-bubble-text': '#000000',
                '--ext-icon-bg': '#ffffff',   // 白色背景
                '--ext-icon-color': '#333333' // 深灰色图标
            },
            dark: {
                name: '深色',
                '--bg-color': '#000000',
                '--card-bg': '#1c1c1e',
                '--text-main': '#D0D0D0', /* 柔和浅灰，不刺眼 */
                '--text-sub': '#98989d',
                '--accent': '#5C92D1', 
                '--accent-light': 'rgba(92, 146, 209, 0.2)',
                '--danger': '#E85A5A', /* 暗色模式下的珊瑚红，温润清晰 */
                '--border': 'rgba(255,255,255,0.03)',
                '--nav-bg': 'rgba(28,28,30,0.85)',
                '--nav-blur-bg': 'rgba(28,28,30,0.95)',
                '--tab-bar-bg': 'rgba(28,28,30,0.95)',
                '--input-bg': '#2c2c2e',
                '--hover-bg': '#2c2c2e',
                '--icon-color': '#ffffff',
                '--divider': 'rgba(255,255,255,0.1)',
                '--user-bubble-bg': '#17A963', /* 你选的深绿色 */
                '--user-bubble-text': '#000000', /* 解决深色模式气泡文字看不清的问题 */
                '--ext-icon-bg': '#3a3a3c',
                '--ext-icon-color': '#98989d'
            }
        };
        
        let currentTheme = 'light';
        let themeMode = 'auto'; // 'auto', 'light', 'dark'
        let systemThemeListener = null;
        
        // --- 应用主题 (修复加强版) ---
        function applyTheme(themeName) {
            const theme = THEMES[themeName];
            if (!theme) return;
            
            // 1. 应用 CSS 变量
            const root = document.documentElement;
            Object.keys(theme).forEach(key => {
                if (key !== 'name') {
                    root.style.setProperty(key, theme[key]);
                }
            });
            
            // 2. 准备颜色数据
            const bgColor = theme['--bg-color'] || '#f2f2f7';
            const isDark = themeName === 'dark';
            
            // 3. 更新 Android/iOS 15+ 状态栏颜色 (theme-color)
            let themeColorMeta = document.querySelector('meta[name="theme-color"]');
            if (!themeColorMeta) {
                themeColorMeta = document.createElement('meta');
                themeColorMeta.name = "theme-color";
                document.head.appendChild(themeColorMeta);
            }
            // 【关键修复】直接修改属性，而不是使用 setAttribute
            themeColorMeta.content = isDark ? '#000000' : bgColor;
            
            // 4. 更新 iOS PWA 状态栏样式
            let statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
            if (!statusBarMeta) {
                statusBarMeta = document.createElement('meta');
                statusBarMeta.name = "apple-mobile-web-app-status-bar-style";
                document.head.appendChild(statusBarMeta);
            }
            // 【关键修复】直接修改属性
            // 注意：iOS有时候在切换 black-translucent 和 default 时会卡顿
            statusBarMeta.content = isDark ? 'black-translucent' : 'default';

            // 5. 保存状态
            currentTheme = themeName;
            localStorage.setItem('theme', themeName);
        }
        
        // --- 切换主题 ---
        function switchTheme(themeName) {
            applyTheme(themeName);
        }
        
        // --- 获取当前主题 ---
        function getCurrentTheme() {
            return currentTheme;
        }
        
        // --- 检测系统主题 ---
        function getSystemTheme() {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                return 'dark';
            }
            return 'light';
        }
        
        // --- 应用主题模式 ---
        function applyThemeMode(mode) {
            themeMode = mode;
            localStorage.setItem('themeMode', mode);
            
            if (mode === 'auto') {
                // 跟随系统
                const systemTheme = getSystemTheme();
                applyTheme(systemTheme);
                startSystemThemeListener();
            } else {
                // 手动模式
                stopSystemThemeListener();
                applyTheme(mode);
            }
            
            updateThemeModeDisplay();
        }
        
        // --- 启动系统主题监听 ---
        function startSystemThemeListener() {
            if (systemThemeListener) return; // 已经在监听了
            
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            systemThemeListener = (e) => {
                if (themeMode === 'auto') {
                    applyTheme(e.matches ? 'dark' : 'light');
                }
            };
            
            // 现代浏览器使用 addEventListener
            if (mediaQuery.addEventListener) {
                mediaQuery.addEventListener('change', systemThemeListener);
            } else {
                // 兼容旧版浏览器
                mediaQuery.addListener(systemThemeListener);
            }
        }
        
        // --- 停止系统主题监听 ---
        function stopSystemThemeListener() {
            if (!systemThemeListener) return;
            
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener('change', systemThemeListener);
            } else {
                mediaQuery.removeListener(systemThemeListener);
            }
            
            systemThemeListener = null;
        }
        
        // --- 更新主题模式显示 ---
        function updateThemeModeDisplay() {
            const displayEl = document.getElementById('theme-mode-display');
            const iconEl = document.getElementById('theme-mode-icon');
            
            if (!displayEl) return;
            
            const modeMap = {
                'auto': { text: '跟随系统', icon: 'fa-circle-half-stroke' },
                'light': { text: '浅色', icon: 'fa-sun' },
                'dark': { text: '深色', icon: 'fa-moon' }
            };
            
            const mode = modeMap[themeMode] || modeMap['auto'];
            displayEl.textContent = mode.text;
            
            if (iconEl) {
                iconEl.className = `fas ${mode.icon}`;
            }
        }
        
        // --- 打开主题模式选择器 ---
        function openThemeModeSelector() {
            const modal = document.createElement('div');
            modal.className = 'config-modal-overlay';
            modal.style.zIndex = '4000';
            
            const modes = [
                { value: 'auto', name: '跟随系统', icon: 'fa-circle-half-stroke', desc: '自动适配系统深色/浅色模式' },
                { value: 'light', name: '浅色', icon: 'fa-sun', desc: '始终使用浅色主题' },
                { value: 'dark', name: '深色', icon: 'fa-moon', desc: '始终使用深色主题' }
            ];
            
            modal.innerHTML = `
                <div class="config-modal-content" style="max-width: 90%; width: 380px;">
                    <div class="config-modal-header">
                        <h3 class="config-modal-title">选择外观</h3>
                    </div>
                    
                    <div class="config-modal-body" style="padding: 0;">
                        ${modes.map(mode => {
                            const isActive = themeMode === mode.value;
                            return `
                                <div class="config-list-item" onclick="selectThemeMode('${mode.value}')" style="cursor: pointer; flex-direction: column; align-items: flex-start; padding: 16px 20px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: ${mode.desc ? '6px' : '0'};">
                                        <div style="display: flex; align-items: center; gap: 12px;">
                                            <i class="fas ${mode.icon}" style="font-size: 20px; color: ${isActive ? 'var(--accent)' : 'var(--icon-color)'};"></i>
                                            <div style="font-size: 16px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? 'var(--accent)' : 'var(--text-main)'};">${mode.name}</div>
                                        </div>
                                        ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
                                    </div>
                                    ${mode.desc ? `<div style="font-size: 13px; color: var(--text-sub); margin-left: 32px;">${mode.desc}</div>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
            
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeThemeModeSelector();
                }
            });
            
            window.currentThemeModeModal = modal;
        }
        
        function selectThemeMode(mode) {
            // 1. 核心魔法：直接调用内置引擎，它会瞬间自动改写 CSS 变量和顶部的状态栏颜色！
            applyThemeMode(mode);
            
            // 2. 平滑地把底部选择弹窗收回去
            closeThemeModeSelector();
            
            // ⚠️ 彻底抛弃那一套重新加载逻辑，告别白屏闪烁！
        }
        
        // --- 关闭主题模式选择器 ---
        function closeThemeModeSelector() {
            if (window.currentThemeModeModal) {
                window.currentThemeModeModal.classList.remove('show');
                setTimeout(() => {
                    if (window.currentThemeModeModal) {
                        window.currentThemeModeModal.remove();
                        window.currentThemeModeModal = null;
                    }
                }, 300);
            }
        }
        
        // --- 初始化主题 ---
        function initTheme() {
            const savedMode = localStorage.getItem('themeMode') || 'auto';
            themeMode = savedMode;
            
            if (savedMode === 'auto') {
                const systemTheme = getSystemTheme();
                applyTheme(systemTheme);
                startSystemThemeListener();
            } else {
                applyTheme(savedMode);
            }
            
            updateThemeModeDisplay();
        }

        // ==========================================
        // 第6批移植：温度和MaxTokens参数配置
        // ==========================================
        
        // --- 模型参数配置 ---
        const MODEL_PARAMS = {
            temperature: 0.7,  // 温度（0-2）
            maxTokens: 2000,   // 最大生成token数
            topP: 1.0,         // 核采样参数
            frequencyPenalty: 0,  // 频率惩罚
            presencePenalty: 0    // 存在惩罚
        };
        
        // --- 更新模型参数 ---
        function updateModelParams(params) {
            Object.assign(MODEL_PARAMS, params);
            localStorage.setItem('MODEL_PARAMS', JSON.stringify(MODEL_PARAMS));
        }
        
        // --- 获取模型参数 ---
        function getModelParams() {
            return { ...MODEL_PARAMS };
        }
        
        // --- 初始化模型参数 ---
        function initModelParams() {
            const saved = localStorage.getItem('MODEL_PARAMS');
            if (saved) {
                try {
                    Object.assign(MODEL_PARAMS, JSON.parse(saved));
                } catch(e) {
                    console.error('加载模型参数失败:', e);
                }
            }
        }

        // ==========================================
        // 第7批移植：预设系统（preset，原deep-preset）
        // ==========================================
        
        // --- 预设数据结构 ---
        const PRESETS = {
            list: [], // 预设列表
            current: null // 当前使用的预设ID
        };
        
        // --- 创建预设 ---
        function createPreset(name, config) {
            const preset = {
                id: Date.now(),
                name: name,
                createdAt: new Date().toISOString(),
                config: {
                    temperature: config.temperature || 0.7,
                    maxTokens: config.maxTokens || 2000,
                    topP: config.topP || 1.0,
                    frequencyPenalty: config.frequencyPenalty || 0,
                    presencePenalty: config.presencePenalty || 0,
                    systemPrompt: config.systemPrompt || ''
                }
            };
            
            PRESETS.list.push(preset);
            savePresets();
            return preset;
        }
        
        // --- 删除预设 ---
        function deletePreset(presetId) {
            const index = PRESETS.list.findIndex(p => p.id === presetId);
            if (index > -1) {
                PRESETS.list.splice(index, 1);
                if (PRESETS.current === presetId) {
                    PRESETS.current = null;
                }
                savePresets();
                return true;
            }
            return false;
        }
        
        // --- 更新预设 ---
        function updatePreset(presetId, updates) {
            const preset = PRESETS.list.find(p => p.id === presetId);
            if (preset) {
                if (updates.name) preset.name = updates.name;
                if (updates.config) Object.assign(preset.config, updates.config);
                savePresets();
                return true;
            }
            return false;
        }
        
        // --- 应用预设 ---
        function applyPreset(presetId) {
            const preset = PRESETS.list.find(p => p.id === presetId);
            if (preset) {
                // 应用模型参数
                updateModelParams({
                    temperature: preset.config.temperature,
                    maxTokens: preset.config.maxTokens,
                    topP: preset.config.topP,
                    frequencyPenalty: preset.config.frequencyPenalty,
                    presencePenalty: preset.config.presencePenalty
                });
                
                PRESETS.current = presetId;
                savePresets();
                return preset;
            }
            return null;
        }
        
        // --- 获取所有预设 ---
        function getAllPresets() {
            return [...PRESETS.list];
        }
        
        // --- 获取当前预设 ---
        function getCurrentPreset() {
            if (PRESETS.current) {
                return PRESETS.list.find(p => p.id === PRESETS.current);
            }
            return null;
        }
        
        // --- 保存预设到本地 ---
        function savePresets() {
            try {
                localStorage.setItem('PRESETS', JSON.stringify(PRESETS));
            } catch(e) {
                console.error('保存预设失败:', e);
            }
        }
        
        // --- 加载预设 ---
        function loadPresets() {
            try {
                const saved = localStorage.getItem('PRESETS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(PRESETS, parsed);
                }
            } catch(e) {
                console.error('加载预设失败:', e);
            }
        }
        
        // --- 初始化预设系统 ---
        function initPresets() {
            loadPresets();
            
            // 如果没有预设，创建默认预设
            if (PRESETS.list.length === 0) {
                createPreset('默认', {
                    temperature: 0.7,
                    maxTokens: 2000,
                    topP: 1.0,
                    frequencyPenalty: 0,
                    presencePenalty: 0,
                    systemPrompt: ''
                });
                
                createPreset('创意写作', {
                    temperature: 0.9,
                    maxTokens: 3000,
                    topP: 0.95,
                    frequencyPenalty: 0.5,
                    presencePenalty: 0.5,
                    systemPrompt: '你是一位富有创造力的作家，擅长创作引人入胜的故事。'
                });
                
                createPreset('代码助手', {
                    temperature: 0.3,
                    maxTokens: 2000,
                    topP: 1.0,
                    frequencyPenalty: 0,
                    presencePenalty: 0,
                    systemPrompt: '你是一位专业的程序员，擅长编写高质量的代码并提供技术建议。'
                });
            }
        }

        // ==========================================
        // 第8批移植：正则系统（文本处理和过滤）
        // ==========================================
        
        // --- 正则规则数据结构 ---
        const REGEX_RULES = {
            list: [], // 正则规则列表
            enabled: true // 是否启用正则过滤
        };
        
        // --- 创建正则规则 ---
        function createRegexRule(name, pattern, replacement, enabled = true) {
            const rule = {
                id: Date.now(),
                name: name,
                pattern: pattern, // 正则表达式字符串
                replacement: replacement, // 替换内容
                enabled: enabled,
                createdAt: new Date().toISOString()
            };
            
            REGEX_RULES.list.push(rule);
            saveRegexRules();
            return rule;
        }
        
        // --- 删除正则规则 ---
        function deleteRegexRule(ruleId) {
            const index = REGEX_RULES.list.findIndex(r => r.id === ruleId);
            if (index > -1) {
                REGEX_RULES.list.splice(index, 1);
                saveRegexRules();
                return true;
            }
            return false;
        }
        
        // --- 更新正则规则 ---
        function updateRegexRule(ruleId, updates) {
            const rule = REGEX_RULES.list.find(r => r.id === ruleId);
            if (rule) {
                if (updates.name !== undefined) rule.name = updates.name;
                if (updates.pattern !== undefined) rule.pattern = updates.pattern;
                if (updates.replacement !== undefined) rule.replacement = updates.replacement;
                if (updates.enabled !== undefined) rule.enabled = updates.enabled;
                saveRegexRules();
                return true;
            }
            return false;
        }
        
        // --- 应用正则规则到文本 ---
        function applyRegexRules(text) {
            if (!REGEX_RULES.enabled) return text;
            
            let result = text;
            
            // 遍历所有启用的规则
            REGEX_RULES.list.forEach(rule => {
                if (rule.enabled) {
                    try {
                        const regex = new RegExp(rule.pattern, 'g');
                        result = result.replace(regex, rule.replacement);
                    } catch (e) {
                        console.error(`正则规则"${rule.name}"执行失败:`, e);
                    }
                }
            });
            
            return result;
        }
        
        // --- 测试正则规则 ---
        function testRegexRule(pattern, text) {
            try {
                const regex = new RegExp(pattern, 'g');
                const matches = text.match(regex);
                return {
                    success: true,
                    matches: matches || [],
                    count: matches ? matches.length : 0
                };
            } catch (e) {
                return {
                    success: false,
                    error: e.message
                };
            }
        }
        
        // --- 获取所有正则规则 ---
        function getAllRegexRules() {
            return [...REGEX_RULES.list];
        }
        
        // --- 切换正则系统开关 ---
        function toggleRegexSystem(enabled) {
            REGEX_RULES.enabled = enabled;
            saveRegexRules();
        }
        
        // --- 保存正则规则 ---
        function saveRegexRules() {
            try {
                localStorage.setItem('REGEX_RULES', JSON.stringify(REGEX_RULES));
            } catch(e) {
                console.error('保存正则规则失败:', e);
            }
        }
        
        // --- 加载正则规则 ---
        function loadRegexRules() {
            try {
                const saved = localStorage.getItem('REGEX_RULES');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(REGEX_RULES, parsed);
                }
            } catch(e) {
                console.error('加载正则规则失败:', e);
            }
        }
        
        // --- 初始化正则系统 ---
        function initRegexSystem() {
            loadRegexRules();
            
            // 如果没有规则，创建一些示例规则
            if (REGEX_RULES.list.length === 0) {
                createRegexRule('移除邮箱', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[邮箱已隐藏]', false);
                createRegexRule('移除手机号', /1[3-9]\d{9}/g, '[手机号已隐藏]', false);
                createRegexRule('移除网址', /https?:\/\/[^\s]+/g, '[链接已隐藏]', false);
            }
        }

        // ==========================================
        // 第9批移植：Web Push通知功能
        // ==========================================
        
        // --- Web Push配置 ---
        const PUSH_CONFIG = {
            vapidPublicKey: 'BKXLKgheQ0pGxeVUifzMecruF3o7OkniEkNSbBUM9sKIeUKn2M8NGG5h3YUV2YrHxzAoHS9-ILmz2MlrSoHt4NU',
            workerUrl: 'https://my-push-worker.ginkgo-yinxing.workers.dev',
            enabled: false,
            showContent: true // 是否在通知中显示内容
        };
        
        // --- Base64转换工具 ---
        function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding)
                .replace(/\-/g, '+')
                .replace(/_/g, '/');
            const rawData = atob(base64);
            const outputArray = new Uint8Array(rawData.length);
            for (let i = 0; i < rawData.length; ++i) {
                outputArray[i] = rawData.charCodeAt(i);
            }
            return outputArray;
        }
        
        // --- 请求推送权限 ---
        async function requestPushPermission() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                alert('您的浏览器不支持推送通知');
                return false;
            }
            
            try {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    // 注册Service Worker
                    const registration = await navigator.serviceWorker.register('./sw.js');
                    await navigator.serviceWorker.ready;
                    
                    // 订阅推送
                    const subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(PUSH_CONFIG.vapidPublicKey)
                    });
                    
                    // 发送订阅信息到服务器
                    const sent = await sendSubscriptionToServer(subscription);
                    if (sent) {
                        PUSH_CONFIG.enabled = true;
                        localStorage.setItem('PUSH_ENABLED', 'true');
                        alert('通知已开启！');
                        return true;
                    } else {
                        alert('通知开启失败：无法连接服务器');
                        return false;
                    }
                } else {
                    alert('您拒绝了通知权限');
                    return false;
                }
            } catch (error) {
                console.error('推送权限请求失败:', error);
                alert('出错: ' + error.message);
                return false;
            }
        }
        
        // --- 发送订阅信息到服务器 ---
        async function sendSubscriptionToServer(subscription) {
            try {
                const response = await fetch(PUSH_CONFIG.workerUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subscription: subscription.toJSON(),
                        action: 'subscribe'
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`服务器拒绝: ${response.status}`);
                }
                
                return true;
            } catch (error) {
                console.error('发送订阅失败:', error);
                return false;
            }
        }
        
        // --- ✨ 全局严格状态追踪 (究极敏感雷达版) ---
        function updateAppActiveState() {
            window.appRealActive = (document.visibilityState === 'visible' && document.hasFocus());
        }

        updateAppActiveState();

        ['visibilitychange', 'focus', 'blur', 'pageshow', 'pagehide'].forEach(evt => {
            document.addEventListener(evt, updateAppActiveState, { capture: true, passive: true });
        });

        if (window.Capacitor && window.Capacitor.Plugins.App) {
            window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
                window.appRealActive = isActive;
            });
        }

        // ==========================================
        // 🌟 修改开始：原生通知极速队列（微信秒顶版）
        // ==========================================
        window.pushNotificationQueue = Promise.resolve(); 

        async function sendPushNotification(messageText) {
            if (!GENERAL_CONFIG.notification.pushEnabled) return;
            // 只有页面完全不可见时才发送通知（包括被其它 App 覆盖或锁屏）
            if (document.visibilityState === 'visible') {
                console.log('📱 App 在前台，不发送通知');
                return;
            }
            if (!messageText || typeof messageText !== 'string' || messageText.trim() === '') return;

            window.pushNotificationQueue = window.pushNotificationQueue.then(async () => {
                if (document.visibilityState === 'visible' || window.appRealActive) return;

                try {
                    let finalMessage = messageText;
                    if (!GENERAL_CONFIG.notification.showContent) {
                        finalMessage = '收到一条新消息';
                    }
                    
                    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
                        const { LocalNotifications } = window.Capacitor.Plugins;
                        await LocalNotifications.requestPermissions();
                        await LocalNotifications.schedule({
                            notifications: [
                                {
                                    title: "Linkgo",
                                    body: finalMessage.substring(0, 100),
                                    
                                    // 🌟 核心魔法：使用固定的 ID（比如 8888）！
                                    // 弃用随机 ID。当系统收到相同的 ID，会瞬间用新文字覆盖旧横幅，
                                    // 无需等待 3 秒，直接产生“顶出来”的视觉效果！
                                    id: 8888, 
                                    
                                    sound: null
                                }
                            ]
                        });
                    } else {
                        console.log("网页端模拟收到通知:", finalMessage);
                    }
                    
                    await new Promise(r => setTimeout(r, 150));
                    
                } catch (error) {
                    console.error('原生通知推送失败:', error);
                }
            });
        }
        // ==========================================
        // 🌟 修改结束
        // ==========================================
        
        // --- 检查并重新激活订阅 ---
        async function checkAndReactivateSubscription() {
            if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
                return;
            }
            
            try {
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.getSubscription();
                
                if (subscription) {
                    await sendSubscriptionToServer(subscription);
                    PUSH_CONFIG.enabled = true;
                }
            } catch (error) {
                console.error('检查订阅状态失败:', error);
            }
        }
        
        // --- 初始化推送系统 ---
        function initPushSystem() {
            // 加载推送配置
            const pushEnabled = localStorage.getItem('PUSH_ENABLED') === 'true';
            const showContent = localStorage.getItem('PUSH_SHOW_CONTENT') !== 'false';
            
            PUSH_CONFIG.enabled = pushEnabled;
            PUSH_CONFIG.showContent = showContent;
            
            // 检查并重新激活订阅
            if (pushEnabled) {
                setTimeout(checkAndReactivateSubscription, 2000);
            }
        }

        // ==========================================
        // 第10批移植：保活功能（Keep Alive）
        // ==========================================
        
        // --- 保活配置 ---
        const KEEP_ALIVE_CONFIG = {
            enabled: false,
            audioUrl: 'https://raw.githubusercontent.com/anars/blank-audio/master/10-seconds-of-silence.mp3',
            audioElement: null
        };
        
        // --- 切换保活功能 ---
        function toggleKeepAlive() {
            KEEP_ALIVE_CONFIG.enabled = !KEEP_ALIVE_CONFIG.enabled;
            
            if (KEEP_ALIVE_CONFIG.enabled) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
            
            // 保存状态
            localStorage.setItem('KEEP_ALIVE_ENABLED', KEEP_ALIVE_CONFIG.enabled ? 'true' : 'false');
        }
        
        // ==========================================
        // 🌟 终极防失忆定位保活引擎
        // ==========================================
        
        window.startKeepAlive = async function() {
            try {
                if (window.chatWakeAudio) window.chatWakeAudio.pause();
                
                if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                    // 1. 启动前先尝试清理一下旧的，防止重复开启
                    await window.stopKeepAlive();

                    // 2. 开启强力定位
                    const watchId = await window.Capacitor.Plugins.BackgroundGeolocation.addWatcher({
                        backgroundMessage: "Linkgo 正在后台守护您的连接",
                        backgroundTitle: "后台保活已开启",
                        requestPermissions: true,
                        stale: false,
                        distanceFilter: 0 
                    }, function(location, error) {
                        if (location) { /* console.log("📍 定位保活中..."); */ }
                    });

                    // 3. ✨ 核心修复：把 ID 存入永久记忆，防止刷新后失控
                    localStorage.setItem('LINKGO_KEEP_ALIVE_ID', watchId);
                }
            } catch (error) {
                console.error("定位保活启动失败:", error);
            }
        };

        window.stopKeepAlive = async function() {
            // ✨ 核心修复：从记忆中找回 ID
            const savedId = localStorage.getItem('LINKGO_KEEP_ALIVE_ID');
            
            if (savedId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                try {
                    // 彻底关掉底层的定位任务
                    await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: savedId });
                    // 清除记忆
                    localStorage.removeItem('LINKGO_KEEP_ALIVE_ID');
                    console.log("🚫 保活任务已彻底关闭并清除记忆");
                } catch (e) {
                    console.error("停止保活失败:", e);
                }
            }
        };
        
        // --- 检查保活状态 ---
        function isKeepAliveEnabled() {
            return KEEP_ALIVE_CONFIG.enabled;
        }
        
        // --- 初始化保活系统 ---
        function initKeepAliveSystem() {
            const savedState = localStorage.getItem('KEEP_ALIVE_ENABLED') === 'true';
            KEEP_ALIVE_CONFIG.enabled = savedState;
            
            if (savedState) {
                // 延迟启动，等待用户交互
                setTimeout(() => {
                    if (KEEP_ALIVE_CONFIG.enabled) {
                        startKeepAlive();
                    }
                }, 3000);
            }
        }
