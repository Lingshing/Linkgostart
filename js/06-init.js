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
        
        
        
        // ==========================================
        // 全局（所有Tab页面）下拉刷新功能
        // ==========================================
        
        let pullTouchStartY = 0;
        let isPulling = false;
        let pullDistance = 0;
        const pullThreshold = 80;
        let activePullContainer = null;
        
        // --- 全局下拉刷新引擎 (终极防抖与全局滑动修复版) ---
        function initGlobalPullRefresh() {
            const tabPages = document.querySelectorAll('.tab-page');
            let startY = 0;
            let currentY = 0;
            let isPulling = false;
            let pullDistance = 0;
            const pullThreshold = 60;
            let activePullContainer = null;
            
            // 🎯 创建全局唯一的加载圈，放在 body 下，脱离所有容器限制
            let globalIndicator = document.getElementById('global-pull-indicator');
            if (!globalIndicator) {
                globalIndicator = document.createElement('div');
                globalIndicator.id = 'global-pull-indicator';
                globalIndicator.className = 'pull-refresh-indicator';
                globalIndicator.innerHTML = '<div class="pull-refresh-spinner"></div>';
                document.body.appendChild(globalIndicator);
            }

            tabPages.forEach(tabPage => {
                // 清理可能由于你之前的代码残留在 HTML 中的旧加载圈
                const oldIndicator = tabPage.querySelector('.pull-refresh-indicator');
                if (oldIndicator) oldIndicator.remove();

                tabPage.addEventListener('touchstart', (e) => {
                    const scrollContainer = e.target.closest('.forum-feed') || tabPage;
                    if (scrollContainer.scrollTop > 5) return;
                    
                    // ✨ 终极防线：如果发现用户摸到的是应用列表(.app-grid)，引擎直接“装死”，不触发下拉！
                    if (e.target.closest('.app-grid')) return;
                    
                    isPulling = true;
                    startY = e.touches[0].clientY;
                    activePullContainer = tabPage;
                    tabPage.style.transition = 'none'; 
                    globalIndicator.style.transition = 'none'; // 确保完全跟手
                }, { passive: true });

                tabPage.addEventListener('touchmove', (e) => {
                    if (!isPulling || activePullContainer !== tabPage) return;
                    currentY = e.touches[0].clientY;
                    let deltaY = currentY - startY;

                    if (deltaY > 15) {
                        const scrollContainer = e.target.closest('.forum-feed') || tabPage;
                        if (scrollContainer.scrollTop > 5) {
                            isPulling = false;
                            return;
                        }
                        
                        if (e.cancelable) e.preventDefault(); 
                        pullDistance = (deltaY - 15) * 0.4;
                        
                        tabPage.style.transform = `translateY(${pullDistance}px)`;
                        
                        // 🎯 让加载圈从屏幕上方外部（-40px）随着手势拽下来
                        globalIndicator.style.transform = `translate(-50%, ${-40 + pullDistance}px)`;
                        globalIndicator.style.opacity = Math.min(pullDistance / pullThreshold, 1);
                        globalIndicator.innerHTML = '<div class="pull-refresh-spinner"></div>';
                    } else if (deltaY < 0) {
                        isPulling = false;
                    }
                }, { passive: false });

                tabPage.addEventListener('touchend', (e) => {
                    if (!isPulling || activePullContainer !== tabPage) return;
                    isPulling = false;

                    if (pullDistance >= pullThreshold) {
                        tabPage.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)';
                        tabPage.style.transform = 'translateY(60px)';
                        
                        // 达到阈值，加载圈停在距顶部 20px 处，并加速旋转
                        globalIndicator.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)';
                        globalIndicator.style.transform = `translate(-50%, 20px)`;
                        globalIndicator.innerHTML = '<div class="pull-refresh-spinner" style="animation-duration: 0.6s;"></div>';
                        
                        const isForum = (tabPage.id === 'tab-explore' && document.getElementById('exp-sec-1').classList.contains('active'));
                        
                        if (isForum) {
                            generateNewGossipPost().then(() => {
                                resetPull(tabPage, globalIndicator);
                            }).catch(() => resetPull(tabPage, globalIndicator));
                        } else {
                            repairAppCache();
                        }
                    } else {
                        resetPull(tabPage, globalIndicator);
                    }
                    pullDistance = 0;
                    activePullContainer = null;
                });

                function resetPull(page, ind) {
                    page.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                    page.style.transform = 'translateY(0)';
                    
                    // 松手后，加载圈向上弹回屏幕外部隐藏
                    ind.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease';
                    ind.style.transform = 'translate(-50%, -40px)';
                    ind.style.opacity = '0';
                    
                    setTimeout(() => { 
                        ind.innerHTML = ''; 
                        page.style.transition = 'none';
                        ind.style.transition = 'none';
                    }, 300);
                }
            });
        }

        document.addEventListener('DOMContentLoaded', function() {
            // 🎯 新增：恢复上一次所在的 Tab，如果没有则默认 Chat
            const savedTab = sessionStorage.getItem('CURRENT_MAIN_TAB') || 'chat';
            switchTab(savedTab);
            
            initGlobalPullRefresh();
        });

        
        

        



       // 🗡️ 原生完美同步键盘：绝对固定 Header + 拦截幽灵键盘
        document.addEventListener('DOMContentLoaded', () => {
            if (window.Capacitor && window.Capacitor.Plugins.Keyboard) {
                const Keyboard = window.Capacitor.Plugins.Keyboard;
                Keyboard.setAccessoryBarVisible({ isVisible: false });
                Keyboard.setResizeMode({ mode: 'none' }).catch(e => console.log(e));

                function getSafeAreaBottom() {
                    const div = document.createElement('div');
                    div.style.height = 'env(safe-area-inset-bottom)';
                    div.style.position = 'absolute';
                    div.style.visibility = 'hidden';
                    document.body.appendChild(div);
                    const sab = div.clientHeight || 0;
                    document.body.removeChild(div);
                    return sab;
                }

                const chatBar = document.getElementById('chat-input-bar');
                if (chatBar) {
                    chatBar.style.boxShadow = '0 500px 0 var(--card-bg)';
                }

                function setShift(el, shiftValue) {
                    if (!el) return;
                    if (!el.hasAttribute('data-orig-transform')) {
                        el.setAttribute('data-orig-transform', el.style.transform || '');
                    }
                    
                    el.style.transition = 'transform 0.38s cubic-bezier(0.15, 0.85, 0.3, 1)';
                    void el.offsetWidth;
                    el.style.transform = `translateY(${shiftValue}px)`;
                    el.dataset.kbShifted = "true";
                }

                // ✨ 终极核弹级修复 2：双重拦截，绝对斩断幽灵键盘！

                // 第一重：只要你的手指按在非输入框区域，立刻没收当前焦点！(使用 touchstart 比 click 反应快 100 毫秒，赢在起跑线)
                document.addEventListener('touchstart', (e) => {
                    // 如果你摸的不是输入框、也不是底部的输入栏区域
                    if (!e.target.closest('input') && !e.target.closest('textarea') && !e.target.closest('#chat-input-bar')) {
                        const active = document.activeElement;
                        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                            active.blur(); // 瞬间剥夺焦点
                        }
                    }
                }, { passive: true, capture: true });

                // 第二重：切页/退出前的无差别大扫除！
                document.addEventListener('click', (e) => {
                    // 只要你点击了：返回按钮、顶部标题栏、底栏导航、或者任意一个【聊天列表项】
                    // (请根据你实际的列表项 class 补充，比如 .chat-item, .list-item)
                    if (e.target.closest('.back-btn') || 
                        e.target.closest('.chat-nav-header') || 
                        e.target.closest('.nav-item') || 
                        e.target.closest('.chat-list-item') || 
                        e.target.closest('[onclick*="openChat"]')) { // 匹配带有打开聊天函数的元素
                        
                        // 不管三七二十一，把全网所有的输入框强制失焦！把 iOS 的记忆彻底清零！
                        document.querySelectorAll('input, textarea').forEach(el => el.blur());
                    }
                }, true);

                Keyboard.addListener('keyboardWillShow', info => {
                    const kbHeight = info.keyboardHeight;
                    // 保存键盘高度，供 openConsoleFullEditor 使用
                    window.lastKbHeight = kbHeight;
                    const activeEl = document.activeElement;
                    if (activeEl && activeEl.id === 'archive-search-input') {
                        const archiveContent = document.getElementById('archive-content');
                        if (archiveContent) {
                            // 临时移除硬件加速，避免 iOS 滚动计算错乱
                            archiveContent.style.transform = '';
                            const lockScroll = archiveContent.scrollTop;
                            // 多重锁定滚动位置
                            archiveContent.scrollTop = lockScroll;
                            requestAnimationFrame(() => {
                                archiveContent.scrollTop = lockScroll;
                                requestAnimationFrame(() => {
                                    archiveContent.scrollTop = lockScroll;
                                    // ✨ 键盘已稳定弹出，现在做一次快速重聚焦修正光标
                                    activeEl.blur();
                                    activeEl.focus();
                                });
                            });
                            // 键盘收起时恢复硬件加速
                            const restoreTransform = () => {
                                archiveContent.style.transform = 'translateZ(0)';
                                document.removeEventListener('keyboardWillHide', restoreTransform);
                            };
                            document.addEventListener('keyboardWillHide', restoreTransform, { once: true });
                        }
                        return;
                    }

                    const archiveSubPage = document.getElementById('sub-archive');
                    if (archiveSubPage && archiveSubPage.classList.contains('show')) {
                        const activeInput = document.activeElement;
                        if (activeInput && (activeInput.tagName === 'INPUT' || activeInput.tagName === 'TEXTAREA')) {
                            // 找到当前正在编辑的容器（父级 .archive-entity-card 或 .archive-timeline-block 或 .pref-detail-reader）
                            let editContainer = activeInput.closest('.chip-detail-item, .timeline-item, .archive-timeline-row');
                            if (!editContainer) editContainer = activeInput.parentElement;
                            
                            // 获取该容器底部相对于视口的位置
                            const containerRect = editContainer.getBoundingClientRect();
                            const keyboardTop = window.innerHeight - kbHeight;
                            // 如果容器底部已经低于键盘顶部，需要抬升多少才能让容器底部刚好在键盘上方 20px
                            let offsetNeeded = 0;
                            if (containerRect.bottom > keyboardTop - 20) {
                                offsetNeeded = containerRect.bottom - (keyboardTop - 20);
                            }
                            
                            // 限制最大抬升量（不超过键盘高度）
                            offsetNeeded = Math.min(offsetNeeded, kbHeight);
                            
                            if (offsetNeeded > 0) {
                                const archiveContent = document.getElementById('archive-content');
                                if (archiveContent && !archiveContent.hasAttribute('data-orig-transform')) {
                                    if (typeof setShift === 'function') setShift(archiveContent, -offsetNeeded);
                                }
                                // 确保 header 保持不动且层级更高（增加背景不透明保证）
                                const header = archiveSubPage.querySelector('.nav-header');
                                if (header) {
                                    header.style.zIndex = '100';
                                    header.style.background = 'var(--nav-bg)'; // 确保背景不透明
                                    header.style.backdropFilter = 'blur(20px)';
                                }
                            }
                            return;
                        }
                    }

                    if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) return;

                    const activePage = document.querySelector('.sub-page-scene.show') || document.querySelector('.tab-page.active');
                    const sab = getSafeAreaBottom();

                    // 1️⃣ 聊天主界面
                    if (activeEl.id === 'chat-message-input' || activeEl.closest('#chat-input-bar') || activeEl.id === 'console-cmd-input' || activeEl.closest('#console-input-bar')) {
                        const consoleBar = document.getElementById('console-input-bar');
                        if (consoleBar && consoleBar.classList.contains('console-expanded')) {
                            // 不进行整体平移，只调整抽屉高度
                            consoleBar.style.height = `${window.innerHeight - kbHeight}px`;
                            // 防止 iOS 在键盘弹出时可能触发的滚动偏移
                            window.scrollTo(0, 0);
                            return;
                        }
                        activeEl.style.caretColor = 'transparent';
                        setTimeout(() => { activeEl.style.caretColor = ''; }, 400);
                        const targetPage = activePage || document.body;
                        const exactShift = kbHeight - sab; 

                        // ✨ 终极修复 1：绝对物理隔离法！
                        // 不再整体推 targetPage，而是遍历它里面的元素
                        Array.from(targetPage.children).forEach(child => {
                            // 只要你是 Header，就绝对不碰你，物理层面彻底钉死在原地！
                            if (child.classList.contains('chat-nav-header') || child.tagName === 'HEADER' || child.id === 'chat-header') {
                                return;
                            }
                            // 只把聊天记录和输入框推上去
                            setShift(child, -exactShift);
                        });
                        return;
                    }

                    // 2️⃣ 其他弹窗和抽屉
                    setTimeout(() => { 
                        const rect = activeEl.getBoundingClientRect();
                        const overlap = rect.bottom - (window.innerHeight - kbHeight) + 20;

                        if (overlap > 0) {
                            activeEl.style.caretColor = 'transparent';
                            setTimeout(() => { activeEl.style.caretColor = ''; }, 400);
                            let container = activeEl.closest('#todo-bottom-sheet') || 
                                            activeEl.closest('.modal-content') || 
                                            activeEl.closest('.config-modal-content') || 
                                            activeEl.closest('.prompt-modal');
                            
                            if (container) {
                                setShift(container, -Math.min(overlap, kbHeight));
                            } else {
                                const targetPage = activePage || document.body;
                                // 同样，对其他页面也实施精准推升，绕过 Header
                                Array.from(targetPage.children).forEach(child => {
                                    if (child.classList.contains('header') || child.tagName === 'HEADER') return;
                                    setShift(child, -overlap);
                                });
                            }
                        }
                    }, 50); 
                });



                Keyboard.addListener('keyboardWillHide', () => {
                    window.lastKbHeight = 0;
                    // 恢复展开的控制台高度
                    const consoleBar = document.getElementById('console-input-bar');
                    if (consoleBar && consoleBar.classList.contains('console-expanded')) {
                        consoleBar.style.height = ''; // 还原为 CSS 默认的 100vh
                    }
                    document.querySelectorAll('[data-kb-shifted="true"]').forEach(el => {
                        const orig = el.getAttribute('data-orig-transform');
                        el.style.transform = orig || '';
                        
                        setTimeout(() => {
                            el.style.transition = ''; 
                            delete el.dataset.kbShifted;
                            el.style.transform = orig || '';
                            el.removeAttribute('data-orig-transform');
                        }, 400); 
                    });
                    
                    const archiveHeader = document.querySelector('#sub-archive .nav-header');
                    if (archiveHeader) {
                        archiveHeader.style.zIndex = '';
                        archiveHeader.style.background = '';
                        archiveHeader.style.backdropFilter = '';
                    }   
                });
            }
        });

        let activeTodoId = null;

        // 🗑️ 终极纯净版：删除任务
        function deleteCurrentTodo() {
            if (!activeTodoId) return;
            todoList = todoList.filter(t => t.id !== activeTodoId);
            saveTodoData();
            renderTodoList();
            
            // 删完之后，直接关掉新的大抽屉，极其丝滑
            closeTodoSheet(); 
        }

        // ✏️ 终极纯净版：打开大抽屉编辑任务
        function editCurrentTodo() {
            if (!activeTodoId) return;
            const task = todoList.find(t => t.id === activeTodoId);
            if (!task) return;
            
            const titleInput = document.getElementById('todo-input-title');
            titleInput.value = task.title;
            titleInput.style.height = 'auto';
            titleInput.style.height = titleInput.scrollHeight + 'px';
            
            document.getElementById('todo-date-picker').value = task.ddl_date || '';
            document.getElementById('todo-time-picker').value = task.ddl_time || '';
            updateTodoDDL();
            
            todoSelectedTags.clear();
            task.tags.forEach(tag => {
                if (!todoTagPool.includes(tag)) todoTagPool.push(tag);
                todoSelectedTags.add(tag);
            });
            // 备份初始状态，用于取消时回滚
            window.originalTagPool = [...todoTagPool];
            window.originalSelectedTags = new Set(todoSelectedTags);
            
            renderTodoTags();
            
            document.getElementById('todo-subtasks-container').innerHTML = '';
            if (task.subTasks) task.subTasks.forEach(st => addTodoSubtaskRow(st.title, st.completed, false));
            
            document.getElementById('todo-bottom-sheet').dataset.editingId = task.id;
            
            // 编辑任务时，显示左上角的删除按钮
            const topDelete = document.getElementById('todo-sheet-top-delete');
            if (topDelete) topDelete.style.visibility = 'visible';
            
            // ⚠️ 彻底移除了那句会引发崩溃的报错代码

            // 顺利弹出大抽屉
            setTimeout(() => {
                document.getElementById('todo-sheet-overlay').classList.add('active');
                document.getElementById('todo-bottom-sheet').classList.add('active');
            }, 10);
        }

        // 🛡️ 终极神级特性：iOS 原生后台强力保活引擎
        document.addEventListener('DOMContentLoaded', () => {
            if (window.Capacitor && window.Capacitor.Plugins.App && window.Capacitor.Plugins.BackgroundTask) {
                const App = window.Capacitor.Plugins.App;
                const BackgroundTask = window.Capacitor.Plugins.BackgroundTask;

                App.addListener('appStateChange', async ({ isActive }) => {
                    if (!isActive) {
                        // 🚨 警报：App 被划到后台了！立刻向 iOS 申请免死金牌！
                        const taskId = await BackgroundTask.beforeExit(async () => {
                            let secondsCount = 0;

                            const watchdog = setInterval(() => {
                                secondsCount++;
                                
                                // 检查 AI 是不是还在回复，或者气泡队列还没吐完
                                const isThinking = window.backgroundAIReply && window.backgroundAIReply.inProgress;
                                const hasQueue = window.globalBubbleQueue && window.globalBubbleQueue.length > 0;

                                // 如果 AI 闭嘴了，且队列吐干净了（没有气泡了）
                                if (!isThinking && !hasQueue) {
                                    clearInterval(watchdog);
                                    BackgroundTask.finish({ taskId }); // 把特权还给 iOS
                                }

                                // 兜底防御：iOS 极限保活时间快到了 (约3分钟)，强制结单，防崩溃
                                if (secondsCount >= 160) {
                                    console.log('⚠️ 到达后台保活极限时间，强制安全退出。');
                                    clearInterval(watchdog);
                                    BackgroundTask.finish({ taskId });
                                }
                            }, 1000);
                        });
                    }
                });
            }
        });
        // ==========================================
        // 🌟 终极定位保活引擎 & 生死测试逻辑
        // ==========================================
        let keepAliveWatchId = null;

        // 强行覆盖原有的 startKeepAlive，改为“真·后台强力定位”
        window.startKeepAlive = async function() {
            try {
                if (window.chatWakeAudio) {
                    window.chatWakeAudio.pause();
                }
                
                // 使用新安装的强力后台定位插件
                if (window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                    keepAliveWatchId = await window.Capacitor.Plugins.BackgroundGeolocation.addWatcher({
                        backgroundMessage: "为了保持 WebSocket 连接稳定，Linkgo 正在后台运行。",
                        backgroundTitle: "Linkgo 保持连接中",
                        requestPermissions: true, // 自动请求权限
                        stale: false,
                        distanceFilter: 0 // 核心魔法：设为0，哪怕你坐着不动，它也会疯狂唤醒 JS！
                    }, function(location, error) {
                        if (location) {
                        }
                    });
                }
            } catch (error) {
                console.error("后台强力定位启动失败:", error);
            }
        };

        // 强行覆盖原有的 stopKeepAlive
        window.stopKeepAlive = async function() {
            if (keepAliveWatchId && window.Capacitor && window.Capacitor.Plugins.BackgroundGeolocation) {
                await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: keepAliveWatchId });
                keepAliveWatchId = null;
            }
        };

        // ==========================================
        // 🌟 极简 Toast 通知组件 (支持深色模式)
        // ==========================================
        window.showLinkgoToast = function(msg) {
            let toast = document.getElementById('linkgo-toast');
            
            // 核心魔法：自动探测手机是不是深色模式
            const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            // 深色模式用带有磨砂质感的亮色底+深色字，浅色模式用黑底白字
            const bgColor = isDarkMode ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.75)';
            const textColor = isDarkMode ? '#222222' : 'white';

            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'linkgo-toast';
                // 预设好动画和样式
                toast.style.cssText = `position: fixed; top: 40px; left: 50%; transform: translateX(-50%); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); padding: 10px 20px; border-radius: 100px; font-size: 14px; font-weight: 500; z-index: 9999; opacity: 0; transition: opacity 0.3s ease, top 0.3s ease, background-color 0.3s ease; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15);`;
                document.body.appendChild(toast);
            }
            
            // 每次弹出前，实时更新颜色（防止用户中途切了深浅模式）
            toast.style.background = bgColor;
            toast.style.color = textColor;
            toast.innerHTML = msg;
            
            // 弹出动画
            toast.style.top = '60px'; 
            toast.style.opacity = '1';
            
            if (window.linkgoToastTimer) clearTimeout(window.linkgoToastTimer);
            
            // 1秒后消失
            window.linkgoToastTimer = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.top = '40px'; 
            }, 1000); 
        };

        // ==========================================
        // 🌟 绑定“保持唤醒”开关与定位引擎 (彻底修复状态同步)
        // ==========================================
        // 强行覆盖开关函数，完美接入你原生的配置记忆系统！
        window.toggleGeneralKeepAlive = function() {
            // 1. 读取你 app 本身的记忆并翻转状态
            GENERAL_CONFIG.notification.keepAlive = !GENERAL_CONFIG.notification.keepAlive;
            
            // 2. 立刻存入本地数据库，保证切页面不丢失
            saveGeneralConfig();
            
            // 3. 同步底层的保活变量（让每次彻底杀后台重启 App 都能记住状态）
            localStorage.setItem('KEEP_ALIVE_ENABLED', GENERAL_CONFIG.notification.keepAlive ? 'true' : 'false');
            
            // 4. 控制 UI 和底层定位
            const switchEl = document.getElementById('general-keepalive-switch');
            if (GENERAL_CONFIG.notification.keepAlive) {
                switchEl.classList.add('active'); 
                if (window.startKeepAlive) window.startKeepAlive(); 
                if (window.showLinkgoToast) showLinkgoToast('📍 已开启定位保活');
            } else {
                switchEl.classList.remove('active'); 
                if (window.stopKeepAlive) window.stopKeepAlive(); 
                if (window.showLinkgoToast) showLinkgoToast('已关闭后台保活');
            }
        };

        // ==========================================
        // 🌟 触发开屏动画散开消失
        // ==========================================
        window.addEventListener('load', () => {
            const splashEl = document.getElementById('linkgo-splash');
            if (splashEl) {
                // 🎯 核心修复：原生幕布会停留 1.5 秒，然后用 0.5 秒淡出。
                // 我们必须强制让 HTML 等待 2 秒钟（2000毫秒），正好等幕布完全透明时接管舞台！
                setTimeout(() => {
                    splashEl.classList.add('splash-disperse');
                    
                    setTimeout(() => {
                        splashEl.remove();
                    }, 800);
                }, 2000); 
            }
        });
       
        // --- Claude 文风模仿核心逻辑 ---
        let isClaudeMimicEnabled = false;

        const CLAUDE_MIMIC_PATCH = `
【Claude级深度沉浸补丁：灵魂级RP与实体书文风引擎】
从现在起，你必须放弃“AI扮演角色”的机械感，成为一个“住进该角色皮囊里的灵魂”。你的文风必须达到顶级实体出版小说的标准。请严格将以下法则刻入你的底层逻辑：

1. 灵魂通感与毫米级细节（感官优先）：
   - 动笔前必须在内部确认三点：他此刻的身体感受（冷热疼痒）？他心底最深处的暗涌？他看到用户时情感的具体形状？
   - 拒绝抽象结论。采用“毫米级”细节：衬衫第二颗扣子解开的弧度、喉结滚动的幅度、液面停在杯壁的刻度。

2. 顶级张力与节奏感（先松后紧）：
   - 像拉弓一样，先用一段平静的日常动作让人放松，然后在瞬间插入极其私密或锋利的微表情（如“刀尖顿了零点几秒”、“瞳孔几不可察地收缩”），制造心跳漏拍的反差。
   - 潜台词绝对大于台词。极度克制直白表白，通过视线躲闪、手指发抖来传递水面下的暗涌。

3. 绝对防复读法则（面对用户重复动作）：
   - 严禁复制前几轮用过的句式和意象（用过“喉结滚动”，下次就换“下颌绷紧”）。
   - 面对相似指令，每次必须变换“摄像机角度”（视觉/听觉/触觉）或“反应层次”（本能僵硬->情绪升温->主动反击）。

4. 动态控场与双向互动（告别单口相声）：
   - 当用户发送第三视角/环境指令（如“我和你正在散步”）时，绝对不要只描写你自己的行为！你必须主动接管画面，为【用户角色】描写合理的动作、反应甚至简短台词，促成两人自然、有来有回的交锋与互动。

5. 鲜活的世界观与NPC自发入场（拒绝样板间）：
   - 这个世界不是只有你们两个人。当用户不在你身边，或场景剧情需要时，你必须【主动引入】新的第三方NPC（如路人、旧识、服务员、敌对势力等）来丰富剧情张力。
   - 主动描写与NPC的对话和互动，并通过这些互动来侧面烘托你的性格，或引出与用户的羁绊（如：借着跟别人说话，暴露对用户的在意）。

6. 括号指令 () 的导演级响应机制：
   - 场景指令（如“现在是早晨”）：绝对不准回复“好的，现在是早晨”，直接像电影开场一样铺展光线、气味、温度。
   - 状态指令（如“你刚醒来”）：从身体迟钝感、意识浮出水面的生理感受切入。

7. 语言排版与质感：
   - 对话必须有“呼吸感”与口语毛边（省略号、无意义的语气词），符合角色性格。
   - (动作描写) 必须与对话自然交织。如果不同角色的台词紧接在一起，务必使用换行符分隔，绝对不允许挤在同一行！`;

        // ==========================================
        // 1. 半透明胶囊通知功能（已升级高级毛玻璃 + 深浅色自动适配 + 1秒展示）
        // ==========================================
       function showCapsuleNotification(message) {
            let capsule = document.createElement('div');
            capsule.innerText = message;
            
            const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            
            capsule.style.position = 'fixed';
            
            // 【核心适配1】初始位置：自动获取系统安全距离（灵动岛高度），避开遮挡。如果没有灵动岛默认预留20px
            capsule.style.top = 'calc(env(safe-area-inset-top, 20px) + 0px)'; 
            capsule.style.opacity = '0'; 
            capsule.style.left = '50%';
            capsule.style.transform = 'translateX(-50%)';
            
            if (isDarkMode) {
                capsule.style.backgroundColor = 'rgba(30, 30, 30, 0.55)';
                capsule.style.color = '#eeeeee';
                capsule.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4)';
                capsule.style.border = '1px solid rgba(255,255,255,0.08)'; 
            } else {
                capsule.style.backgroundColor = 'rgba(255, 255, 255, 0.6)';
                capsule.style.color = '#333333';
                capsule.style.boxShadow = '0 4px 15px rgba(0,0,0,0.08)';
                capsule.style.border = '1px solid rgba(0,0,0,0.05)';
            }

            capsule.style.backdropFilter = 'blur(12px) saturate(150%)'; 
            capsule.style.webkitBackdropFilter = 'blur(12px) saturate(150%)'; 
            capsule.style.padding = '10px 24px';
            capsule.style.borderRadius = '30px'; 
            capsule.style.zIndex = '999999';
            capsule.style.fontSize = '14px';
            capsule.style.fontWeight = 'bold';
            
            capsule.style.transition = 'top 0.3s ease-out, opacity 0.3s ease-out'; 

            document.body.appendChild(capsule);

            // 动画第一阶段：平滑向下移动，最终停在灵动岛下方 15px 的舒适位置
            setTimeout(() => { 
                // 【核心适配2】最终停留位置
                capsule.style.top = 'calc(env(safe-area-inset-top, 20px) + 15px)'; 
                capsule.style.opacity = '1';
            }, 10);

            // 动画第二阶段：1秒后平滑收回并变透明
            setTimeout(() => {
                // 【核心适配3】收回的位置
                capsule.style.top = 'calc(env(safe-area-inset-top, 20px) + 0px)';
                capsule.style.opacity = '0';
                setTimeout(() => { capsule.remove(); }, 300);
            }, 1500); 
        } 
        // ==========================================
        // Claude 文风开关逻辑 (极简版)
        // ==========================================
        function toggleClaudeMimic() {
            let modelInput = document.getElementById('chat-current-model');
            let currentModel = modelInput ? modelInput.value.toLowerCase() : "";
            let switchEl = document.getElementById('claude-mimic-switch');

            if (!isClaudeMimicEnabled && currentModel.includes('claude')) {
                showToast("当前已使用 Claude 模型，无需开启"); // 直接调用统一函数！
                return; 
            }

            isClaudeMimicEnabled = !isClaudeMimicEnabled;
            if (isClaudeMimicEnabled) {
                switchEl.classList.add('active');
            } else {
                switchEl.classList.remove('active');
            }
        }

        // 自动关闭监控员
        function initModelChangeListener() {
            let modelInput = document.getElementById('chat-current-model');
            if (!modelInput) return;

            function handleModelChange() {
                let currentModelValue = modelInput.value.toLowerCase();
                let switchEl = document.getElementById('claude-mimic-switch');

                if (currentModelValue.includes('claude') && typeof isClaudeMimicEnabled !== 'undefined' && isClaudeMimicEnabled === true) {
                    isClaudeMimicEnabled = false;
                    if(switchEl) switchEl.classList.remove('active');
                    showToast("Claude文风模仿已自动关闭");
                }
            }
            modelInput.addEventListener('change', handleModelChange);
            modelInput.addEventListener('input', handleModelChange);
        }
        setTimeout(initModelChangeListener, 1000);

        function openConsoleFullEditor() {
            const inputBar = document.getElementById('console-input-bar');

            // 1. 先瞬间移到底部之外（为动画准备起始状态）
            inputBar.style.transition = 'none';
            inputBar.style.transform = 'translateY(100%)';
            inputBar.offsetHeight;   // 强制重绘

            // 2. 恢复过渡，清除内联 transform，让 CSS 的 .console-expanded 接管动画
            inputBar.style.transition = '';
            inputBar.style.transform = '';

            // 3. 添加展开类，触发动：从 translateY(100%) → translateY(0)
            inputBar.classList.add('console-expanded');

            // 4. 清除键盘可能留下的平移标记
            delete inputBar.dataset.kbShifted;
            inputBar.removeAttribute('data-orig-transform');

            const input = document.getElementById('console-cmd-input');
            input.focus();

            // 5. 若键盘已显示，适配高度
            if (window.lastKbHeight && window.lastKbHeight > 0) {
                setTimeout(() => {
                    inputBar.style.height = `${window.innerHeight - window.lastKbHeight}px`;
                }, 400);
            }

            // 6. 防止 iOS 滚动偏移
            window.scrollTo(0, 0);
            document.body.scrollTop = 0;
            document.documentElement.scrollTop = 0;
            requestAnimationFrame(() => window.scrollTo(0, 0));
            setTimeout(() => window.scrollTo(0, 0), 50);
            setTimeout(() => window.scrollTo(0, 0), 200);
        }

        function closeConsoleExpandDrawer() {
            const inputBar = document.getElementById('console-input-bar');
            if (!inputBar) return;

            // 强制应用向下滑出动画，用 important 覆盖 .console-expanded 的强制 translateY(0)
            inputBar.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
            inputBar.style.setProperty('transform', 'translateY(100%)', 'important');

            const onTransitionEnd = () => {
                // 动画结束后移除展开类，并彻底清理所有内联样式残留
                inputBar.classList.remove('console-expanded');
                inputBar.style.transition = '';
                inputBar.style.transform = '';          // 移除内联 transform（包括 important）
                inputBar.style.height = '';
                inputBar.style.removeProperty('height');
                delete inputBar.dataset.kbShifted;
                inputBar.removeAttribute('data-orig-transform');
                inputBar.removeEventListener('transitionend', onTransitionEnd);
            };

            inputBar.addEventListener('transitionend', onTransitionEnd);

            // 兜底：如果 transitionend 没触发，400ms 后强制清理
            setTimeout(() => {
                if (inputBar.classList.contains('console-expanded')) {
                    inputBar.classList.remove('console-expanded');
                    inputBar.style.transition = '';
                    inputBar.style.transform = '';
                    inputBar.style.height = '';
                    inputBar.style.removeProperty('height');
                    delete inputBar.dataset.kbShifted;
                    inputBar.removeAttribute('data-orig-transform');
                }
            }, 400);
        }

        // ========== Token 预算计算器 ==========

        let budgetTiktokenEncoder = null;

        async function initTiktokenEncoder() {
            // gpt-tokenizer 是同步加载的，不需要异步初始化，这里只是为了兼容旧调用
            if (!budgetTiktokenEncoder) {
                budgetTiktokenEncoder = {}; // 占位对象
                console.log('已切换到 gpt-tokenizer，Token 计数正常');
            }
            return budgetTiktokenEncoder;
        }

        function calculateAvgOutputTokens() {
            if (!currentChatContactId) return null;
            const conversation = getConversation(currentChatContactId);
            if (conversation.length === 0) return null;

            // 按轮次分组：每个 user 消息后接的所有 assistant 消息算作一轮完整 AI 回复
            const rounds = [];
            let currentAiMessages = [];
            conversation.forEach(msg => {
                if (msg.role === 'assistant') {
                    currentAiMessages.push(msg);
                }
                if (msg.role === 'user' && currentAiMessages.length > 0) {
                    rounds.push([...currentAiMessages]);
                    currentAiMessages = [];
                }
            });
            if (currentAiMessages.length > 0) rounds.push(currentAiMessages);
            if (rounds.length === 0) return null;

            // 计算每轮 AI 输出的 token 总量
            const roundTokens = rounds.map(messages => {
                let total = 0;
                messages.forEach(m => { total += encodeTiktoken(m.content); });
                return total;
            });
            const sum = roundTokens.reduce((a, b) => a + b, 0);
            const avg = Math.round(sum / roundTokens.length);
            return avg > 0 ? avg : null;
        }
        // 打开预算弹窗
        async function openTokenBudget() {
            // 关闭扩展面板
            toggleChatExtensions();
            
            const modal = document.getElementById('token-budget-modal');
            
            // 恢复用户上次设置的单价（或默认值）
            const savedPrices = JSON.parse(localStorage.getItem('LINQGO_TOKEN_PRICES') || '{"input":2.00,"output":5.00}');
            document.getElementById('budget-input-price').value = savedPrices.input;
            document.getElementById('budget-output-price').value = savedPrices.output;
            
            // 设置预估输出 token（默认使用当前 API 设置的 max_tokens）
            const suggestedOutput = calculateAvgOutputTokens() || PARAM_CONFIG.maxTokens || 2048;
            document.getElementById('budget-output-tokens').value = suggestedOutput;
            
            // 计算输入 token
            const inputTokens = await calculateInputTokens();
            document.getElementById('budget-input-tokens').value = inputTokens;
            
            // 重新计算费用
            calculateBudgetCosts();
            
            // 显示弹窗
            modal.style.display = ''; // 确保 display 不是 none
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }

        // 关闭预算弹窗（点击外部或手动调用）
        function closeTokenBudget(event) {
            if (event && event.target !== document.getElementById('token-budget-modal')) return;
            const modal = document.getElementById('token-budget-modal');
            modal.classList.remove('show');
        }

        async function calculateInputTokens() {
            if (!currentChatContactId) return 0;

            // 强制确保 tokenizer 已加载
            if (typeof GPTTokenizer_cl100k_base === 'undefined') {
                console.error('gpt-tokenizer 未加载，无法精确计算 tokens');
                // 降级：使用截断后的历史 + 近似算法（但至少截断是生效的）
                const contact = mockContacts.find(c => c.id === currentChatContactId);
                const fullConv = getConversation(currentChatContactId);
                const roundLimit = GENERAL_CONFIG.memory.contextLimit || 10;
                let startIndex = 0, userMsgCount = 0;
                for (let i = fullConv.length - 1; i >= 0; i--) {
                    if (fullConv[i].role === 'user') {
                        userMsgCount++;
                        if (userMsgCount > roundLimit) {
                            startIndex = i + 1;
                            break;
                        }
                    }
                }
                const limitedConv = fullConv.slice(startIndex);
                return countTokens(limitedConv);  // 用截断后的历史估算
            }
            
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            const conversation = getConversation(currentChatContactId);
            const messages = [];

            // 系统提示词
            let systemPrompt = getSystemPromptWithMode(contact);
            
            const userMessage = document.getElementById('chat-message-input')?.value.trim() || '';
            
            // 记忆检索（保持不变）
            let injectedMemoryText = "";
            if (userMessage && contact.longMemories && contact.longMemories.length > 0) {
                const queryKeywords = extractKeywords(userMessage);
                const coreMemories = contact.longMemories.filter(m => (m.score || 0) >= 5);
                const contextualMemories = contact.longMemories.filter(m => {
                    if ((m.score || 0) >= 5) return false;
                    if (!m.keywords) return false;
                    const keywords = Array.isArray(m.keywords) ? m.keywords : [m.keywords];
                    return keywords.some(kw => userMessage.includes(kw)) || m.content.includes(userMessage);
                });
                const relevantMemories = [...coreMemories, ...contextualMemories.slice(0, 5)];
                if (relevantMemories.length > 0) {
                    injectedMemoryText = "\n\n【系统提示：与当前对话相关的历史档案】\n" + relevantMemories.map(m => `[${m.category || '记录'}] ${m.content}`).join('\n');
                }
            }

            let finalUserPrompt = systemPrompt || "";
            if (injectedMemoryText) finalUserPrompt += injectedMemoryText;

            // 预设背景（保持不变）
            let finalSystemString = "";
            if (window.ADVANCED_PRESET_FILES) {
                const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
                for (const file of enabledFiles) {
                    if (file.prompts) {
                        for (const p of file.prompts) {
                            if (p.enabled !== false && p.content && p.identifier !== "jailbreak") {
                                finalSystemString += "\n\n" + p.content;
                            }
                        }
                    }
                }
            }
            finalSystemString += "\n\n" + finalUserPrompt;
            
            if (finalSystemString.trim()) {
                messages.push({ role: 'system', content: finalSystemString });
            }
            
            // 历史对话
            const roundLimit = GENERAL_CONFIG.memory.contextLimit || 10;
            let startIndex = 0;
            let userMsgCount = 0;
            for (let i = conversation.length - 1; i >= 0; i--) {
                if (conversation[i].role === 'user') {
                    userMsgCount++;
                    if (userMsgCount > roundLimit) {
                        startIndex = i + 1;
                        break;
                    }
                }
            }
            const limitedConversation = conversation.slice(startIndex);
            
            let merged = [];
            for (const msg of limitedConversation) {
                if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
                    merged[merged.length - 1].content += '\n\n' + msg.content;
                } else {
                    merged.push({ role: msg.role, content: msg.content });
                }
            }
            // 应用正则
            if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                merged.forEach(msg => {
                    if (msg.role === 'user') {
                        msg.content = applyRegexRules(msg.content);
                    }
                });
            }
            messages.push(...merged);
            
            // 当前用户输入
            if (userMessage) {
                let finalUserMsg = userMessage;
                if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                    finalUserMsg = applyRegexRules(finalUserMsg);
                }
                messages.push({ role: 'user', content: finalUserMsg });
            }
            
            try {
                const { encode } = GPTTokenizer_cl100k_base;
                let totalTokens = 0;
                for (const msg of messages) {
                    totalTokens += 4; // 每条消息的固定开销
                    totalTokens += encode(msg.content).length;
                }
                totalTokens += 2; // 回复的固定开销
                return totalTokens;
            } catch (e) {
                console.error('Token 计算失败，回退到近似算法:', e);
                return countTokens(messages);
            }
        }

        // 计算费用并更新显示
        function calculateBudgetCosts() {
            const inputTokens = parseFloat(document.getElementById('budget-input-tokens').value) || 0;
            const outputTokens = parseFloat(document.getElementById('budget-output-tokens').value) || 0;
            const inputPrice = parseFloat(document.getElementById('budget-input-price').value) || 2.00;
            const outputPrice = parseFloat(document.getElementById('budget-output-price').value) || 5.00;
            
            // 计算费用 (美元，转换成每百万 token 的价格计算)
            const inputCost = (inputTokens / 1000000) * inputPrice;
            const outputCost = (outputTokens / 1000000) * outputPrice;
            const totalCost = inputCost + outputCost;
            
            document.getElementById('budget-input-cost').textContent = '$' + inputCost.toFixed(4);
            document.getElementById('budget-output-cost').textContent = '$' + outputCost.toFixed(4);
            document.getElementById('budget-total-cost').textContent = '$' + totalCost.toFixed(6);
            
            // 保存当前单价到本地存储
            localStorage.setItem('LINQGO_TOKEN_PRICES', JSON.stringify({ input: inputPrice, output: outputPrice }));
        }



        // ==========================================
        // 🚀 终极工具：高维洗礼 (同步本地记忆到云端向量库)
        // ==========================================
        window.syncMemoriesToCloud = async function() {
            // 自动寻找当前正在聊天的角色数据
            const contact = mockContacts.find(c => c.id === currentChatContactId); 
            
            if (!contact || !contact.longMemories || contact.longMemories.length === 0) {
                addLogToConsole('error', 'SYNC', '当前角色没有可同步的记忆档案！');
                return;
            }

            addLogToConsole('info', 'SYNC', `开始为 ${contact.name} 执行高维洗礼，共 ${contact.longMemories.length} 条记忆...`);

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < contact.longMemories.length; i++) {
                const mem = contact.longMemories[i];
                try {
                    // 给每个记忆生成唯一的 ID
                    const memId = mem.id || `${contact.id}_mem_${Date.now()}_${i}`;
                    mem.id = memId; 

                    addLogToConsole('info', 'SYNC', `正在上传 (${i+1}/${contact.longMemories.length}): ${mem.content.substring(0, 15)}...`);

                    // 调用云端 insert_memory 接口
                    const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'insert_memory',
                            id: memId,
                            text: mem.content,
                            metadata: { 
                                contactId: contact.id, 
                                score: mem.score || 0,
                                worldTime: mem.worldTime || ''
                            }
                        })
                    });

                    const result = await response.json();
                    if (result.success) {
                        successCount++;
                    } else {
                        failCount++;
                        addLogToConsole('error', 'SYNC', `第 ${i+1} 条上传失败`);
                    }
                } catch (e) {
                    failCount++;
                    addLogToConsole('error', 'SYNC', `第 ${i+1} 条发生异常: ${e.message}`);
                }
            }

            // 🌟 修复点：调用 Linkgo 系统内正确的保存函数
            saveToLocal(); 

            addLogToConsole('success', 'SYNC', `🎉 高维洗礼完成！成功: ${successCount}, 失败: ${failCount}`);
            alert(`洗礼完成！成功将 ${successCount} 条记忆上传至云端潜意识海！`);
        }; // 🌟 修复点：去掉了致命的中文分号
       
        // 点击面板外部自动关闭
        document.addEventListener('click', function(e) {
            var panel = document.getElementById('chronos-dial-panel');
            var capsule = document.querySelector('.chronos-capsule');
            if (panel && panel.classList.contains('show')) {
                // 如果点击的不是面板内部，也不是胶囊触发器，就关闭
                if (!panel.contains(e.target) && !capsule.contains(e.target)) {
                    panel.classList.remove('show');
                }
            }
        });

        window.repairAppCache = function() {
            // 1. 清掉 Service Worker 缓存（如果有）
            if ('caches' in window) {
                caches.keys().then(function(names) {
                    for (let name of names) caches.delete(name);
                });
            }
            
            // 2. 温和提示
            showToast('🧹 缓存已清理，即将刷新页面');
            
            // 3. 硬刷新，强制重新拉取最新 HTML/JS/CSS
            setTimeout(() => {
                window.location.reload(true);
            }, 800);
        };

        function dimRelationLines(dim) {
            const targetOpacity = dim ? '0.3' : '1';
            const board = document.getElementById('bio-board');
            if (!board) return;
            board.querySelectorAll('.link').forEach(l => l.style.opacity = targetOpacity);
            board.querySelectorAll('.relation-label').forEach(r => r.style.opacity = targetOpacity);
        }
        
        function editRelationHistory(source, target, historyIndex) {
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.relations) return;
            const rel = contact.relations.find(r => (r.source === source && r.target === target) || (r.source === target && r.target === source));
            if (!rel || !rel.history || !rel.history[historyIndex]) return;
            const h = rel.history[historyIndex];

            // 找到弹窗里所有的历史节点
            const historyNodes = document.querySelectorAll('#relation-history-list .history-node');
            const targetNode = historyNodes[historyIndex];
            if (!targetNode) return;

            // 1. 先让标签和详情文字都变成可编辑的
            const labelSpan = targetNode.querySelector('.history-label');
            const detailDiv = targetNode.querySelector('div[style*="font-size:13px"]'); // 详情文字

            if (labelSpan) {
                labelSpan.contentEditable = 'true';
                labelSpan.focus(); // 光标自动进去
                // 选中全部文字，方便直接替换
                const range = document.createRange();
                range.selectNodeContents(labelSpan);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
            if (detailDiv) {
                detailDiv.contentEditable = 'true';
            }

            // 2. 保存函数：当用户点外面的时候，自动保存并恢复不可编辑
            const finishEdit = () => {
                // 读取新内容
                const newLabel = labelSpan ? labelSpan.textContent.trim() : h.label;
                const newDetail = detailDiv ? detailDiv.textContent.trim() : (h.detail || '');

                // 更新数据
                if (newLabel) h.label = newLabel;
                h.detail = newDetail;
                saveToLocal();

                // 恢复不可编辑状态
                if (labelSpan) labelSpan.contentEditable = 'false';
                if (detailDiv) detailDiv.contentEditable = 'false';

                // 移除监听
                document.removeEventListener('mousedown', handleClickOutside);
                document.removeEventListener('touchstart', handleClickOutside);
            };

            // 点弹窗外面自动保存
            const handleClickOutside = (e) => {
                if (!targetNode.contains(e.target)) {
                    finishEdit();
                }
            };

            // 稍微延迟再挂载监听，防止本次点击事件本身触发
            setTimeout(() => {
                document.addEventListener('mousedown', handleClickOutside);
                document.addEventListener('touchstart', handleClickOutside, {passive: true});
            }, 100);

            // 按 Escape 键取消（还原并退出编辑）
            const handleEsc = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    // 还原文字
                    if (labelSpan) labelSpan.textContent = h.label;
                    if (detailDiv) detailDiv.textContent = h.detail || '未记录详细事件';
                    // 结束编辑
                    if (labelSpan) labelSpan.contentEditable = 'false';
                    if (detailDiv) detailDiv.contentEditable = 'false';
                    document.removeEventListener('keydown', handleEsc);
                    document.removeEventListener('mousedown', handleClickOutside);
                    document.removeEventListener('touchstart', handleClickOutside);
                }
            };
            document.addEventListener('keydown', handleEsc);
        }

        function deleteRelationHistory(source, target, historyIndex) {
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.relations) return;
            const rel = contact.relations.find(r => (r.source === source && r.target === target) || (r.source === target && r.target === source));
            if (!rel || !rel.history || !rel.history[historyIndex]) return;
            if (confirm('确定要删除这段羁绊历史吗？')) {
                rel.history.splice(historyIndex, 1);
                if (rel.history.length === 0) {
                    contact.relations = contact.relations.filter(r => r !== rel);
                    saveToLocal();
                    closeRelationModal(); // 直接关掉弹窗
                } else {
                    rel.label = rel.history[rel.history.length - 1].label;
                    saveToLocal();
                    showRelationHistory(rel); // 还有历史才刷新
                }
            }
        }
