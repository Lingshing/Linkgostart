// ========== 统一存储层 (SQLite + IndexedDB 回退) ==========
        const DB = {
            db: null,
            ready: false,
            async init() {
                if (!window.sqliteReady) await new Promise(r => { let t = setInterval(() => { if (window.sqliteReady) { clearInterval(t); r(); } }, 50); });
                if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
                    const sqlitePlugin = window.CapacitorSQLite || window.capacitorSQLite;
                    if (!sqlitePlugin || !sqlitePlugin.CapacitorSQLite) {
                        console.warn('SQLite 插件未加载，回退 IndexedDB');
                        this.ready = true;
                        return;
                    }
                    try {
                        const { CapacitorSQLite, SQLiteConnection } = sqlitePlugin;
                        this.sqliteConnection = new SQLiteConnection(CapacitorSQLite);
                        this.db = await this.sqliteConnection.createConnection('linkgo_db', false, 'no-encryption', 1, false);
                        await this.db.open();
                        await this.db.execute(`
                            CREATE TABLE IF NOT EXISTS storage (
                                key TEXT PRIMARY KEY,
                                value TEXT
                            );
                        `);
                        console.log('SQLite 数据库已就绪');
                        await this.migrateFromIndexedDB();
                        this.ready = true;
                    } catch(e) {
                        console.error('SQLite 初始化失败，回退 IndexedDB:', e);
                        this.db = null;
                        this.ready = true;
                    }
                } else {
                    this.ready = true;
                }
            },
            async migrateFromIndexedDB() {
                try {
                    const keys = await localforage.keys();
                    let movedCount = 0;
                    for (const key of keys) {
                        // 直接读旧仓库
                        const value = await localforage.getItem(key);
                        if (value !== null) {
                            // 存入 SQLite
                            await this.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                            movedCount++;
                        }
                    }
                    // 迁移完成后才清空旧仓库（可选，保留一份 as 备份更好，但你的设计是清空）
                    if (movedCount > 0) {
                        await localforage.clear();
                        console.log(`✅ 已成功迁移 ${movedCount} 条数据至 SQLite，旧仓库已清空`);
                    }
                } catch(e) {
                    console.error('迁移失败:', e);
                }
            },
            async setItem(key, value) {
                if (this.db) {
                    try {
                        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
                        await this.db.execute(`
                            INSERT INTO storage (key, value) VALUES (?, ?)
                            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
                        `, [key, valStr]);
                        return;
                    } catch(e) {
                        console.error('SQLite setItem 失败, 回退 localforage:', e);
                    }
                }
                return localforage.setItem(key, value);
            },
            async getItem(key) {
                if (this.db) {
                    try {
                        const res = await this.db.query(`SELECT value FROM storage WHERE key = ?`, [key]);
                        if (res.values && res.values.length > 0) {
                            return res.values[0].value;  // 注意：这里返回字符串，原代码自行 JSON.parse
                        }
                        return null;
                    } catch(e) {
                        console.error('SQLite getItem 失败:', e);
                    }
                }
                return localforage.getItem(key);
            },
            async removeItem(key) {
                if (this.db) {
                    try {
                        await this.db.execute(`DELETE FROM storage WHERE key = ?`, [key]);
                        return;
                    } catch(e) {
                        console.error('SQLite removeItem 失败:', e);
                    }
                }
                return localforage.removeItem(key);
            },
            async clear() {
                if (this.db) {
                    await this.db.execute(`DELETE FROM storage`);
                    return;
                }
                return localforage.clear();
            }
        };

        // ==========================================
        // 🌟 全局统一：高级胶囊通知引擎 (粒子渐变版 - 修复消失生硬)
        // ==========================================
        function showToast(message) {
            let oldToast = document.getElementById('ginkgo-global-toast');
            if (oldToast) oldToast.remove();

            let toast = document.createElement('div');
            toast.id = 'ginkgo-global-toast';
            toast.className = 'ginkgo-toast';
            toast.innerText = message;
            document.body.appendChild(toast);

            void toast.offsetWidth; 

            toast.classList.add('show');

            // 1.5秒后开始“粒子消散”特效
            setTimeout(() => {
                toast.classList.remove('show'); 
                
                // 【核心修改3】把等待销毁的时间从 500 改成 700 毫秒！
                // 因为我们在 CSS 里把消失动画变成了 0.6秒，如果 500 毫秒就把元素删了，动画还没播完就会卡断
                setTimeout(() => toast.remove(), 700);
            }, 1500);
        }

        // 🔥 魔法接管：把你代码里所有的原生 alert 弹窗全部强制升级为半透明胶囊！
        window.alert = function(msg) {
            showToast(msg);
        };
        // ==========================================
        // 第1批移植：核心数据结构 + 分词器 + 长期记忆
        // ==========================================
        
        // --- 初始化中文分词器（用于关键词提取）---
        const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
        
        // --- 简单的停用词表（用于过滤无意义词汇）---
        const stopWords = new Set(['的', '了', '是', '我', '你', '他', '在', '不', '有', '个', '也', '就']);
        
        // --- 关键词提取函数 ---
        function extractKeywords(text) {
            const segments = segmenter.segment(text);
            const keywords = [];

            for (const segment of segments) {
                if (segment.isWordLike && segment.segment.length > 1 && !stopWords.has(segment.segment)) {
                    keywords.push(segment.segment);
                }
            }
            return keywords;
        }
        
        // --- 记忆评分函数 ---
        function calculateMemoryScore(queryKeywords, memoryKeywords) {
            let score = 0;
            queryKeywords.forEach(qKey => {
                if (memoryKeywords.includes(qKey)) {
                    score += qKey.length;
                }
            });
            return score;
        }
        
        // --- 核心数据存储结构 ---
        const APP_DATA = {
            contacts: [], // 联系人列表（原代码中的角色列表）
            apiKey: '',
            apiUrl: 'https://api.openai.com/v1/chat/completions',
            currentChatId: null,
            conversations: {}, // 对话历史记录 { contactId: [{role, content}, ...] }
            settings: {
                contextLimit: 10,
                diaryInterval: 10,
                backfillApiUrl: '',
                backfillApiKey: '',
                backfillModel: ''
            }
        };

        // ========== 互动视图独立存储辅助函数 ==========
        async function loadActivityStats() {
            const stats = await DB.getItem('ACTIVITY_STATS');
            return stats ? JSON.parse(stats) : {};
        }
        async function saveActivityStats(stats) {
            await DB.setItem('ACTIVITY_STATS', JSON.stringify(stats));
        }

        function getStandardApiUrl(rawUrl, endpoint = '/chat/completions') {
            let url = rawUrl.trim();
            // 1. 先把末尾可能存在的 /chat/completions 或 /models 和斜杠切掉
            url = url.replace(/\/chat\/completions\/?$/i, '');
            url = url.replace(/\/models\/?$/i, '');
            url = url.replace(/\/$/, ''); 
            
            // 2. 如果网址结尾不是 /v1，且中间也不包含 /v1/，就自动补全 /v1
            if (!url.endsWith('/v1') && !url.includes('/v1/')) {
                url = url + '/v1';
            }
            
            // 3. 拼接目标后缀（默认是 /chat/completions，获取模型列表时是 /models）
            return url + endpoint;
        }
        // --- 分词器功能（tiktoken-lite，用于计算token数） ---
        const TIKTOKEN_RANKS = {}; // 简化版，实际使用时需要完整的编码表
        
        function encodeTiktoken(text) {
            // 简化版分词器实现
            // 实际项目中应使用完整的tiktoken库或API
            // 这里用近似算法：英文单词约1.3 token，中文字符约1.5 token
            const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
            const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
            const otherChars = text.length - chineseChars - englishWords;
            
            return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + otherChars * 0.5);
        }
        
        function countTokens(messages) {
            // 计算消息数组的总token数
            let total = 0;
            messages.forEach(msg => {
                total += encodeTiktoken(msg.content || '');
                total += 4; // 每条消息的格式开销
            });
            return total + 2; // 对话的固定开销
        }

        let saveQueue = Promise.resolve();
        let saveDebounceTimer = null;
        const SAVE_DEBOUNCE_MS = 1500;

        async function saveToLocal() {
            if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
            saveDebounceTimer = setTimeout(async () => {
                saveQueue = saveQueue.then(async () => {
                    await performSave();
                }).catch(error => {
                    console.error('保存队列异常，但队列继续运行:', error);
                });
            }, SAVE_DEBOUNCE_MS);
        }

        async function performSave() {
            const contactsStr = JSON.stringify(mockContacts);
        
            const settings = {
                apiKey: APP_DATA.apiKey,
                apiUrl: APP_DATA.apiUrl,
                currentChatId: APP_DATA.currentChatId,
                settings: APP_DATA.settings,
                activityStats: APP_DATA.activityStats
            };
            const settingsStr = JSON.stringify(settings);
        
            const writes = [
                DB.setItem('CHAT_CONTACTS', contactsStr),
                DB.setItem('APP_SETTINGS', settingsStr)
                // ⚠️ 不写 APP_DATA，避免重复
            ];
        
            const validIds = new Set(mockContacts.map(c => c.id));
            for (const contactId of Object.keys(APP_DATA.conversations)) {
                const id = Number(contactId);
                if (!validIds.has(id)) continue;
                const conv = APP_DATA.conversations[id];
                if (conv && conv.length > 0) {
                    writes.push(DB.setItem(`CONV_${id}`, JSON.stringify(conv)));
                } else {
                    writes.push(DB.removeItem(`CONV_${id}`));
                }
            }
        
            try {
                await Promise.all(writes);
            } catch(e) {
                console.error('保存数据失败：', e);
                await new Promise(r => setTimeout(r, 200));
                try {
                    await Promise.all(writes);
                } catch(retryError) {
                    alert('⚠️ 保存数据失败，请立即手动导出聊天记录！');
                }
            }
        }
                
        async function loadFromLocal() {
            try {
                // ========== 1. 自动搬家：旧 localStorage → IndexedDB（原有逻辑保留） ==========
                const oldContacts = localStorage.getItem('CHAT_CONTACTS');
                if (oldContacts) {
                    await DB.setItem('CHAT_CONTACTS', oldContacts);
                    localStorage.removeItem('CHAT_CONTACTS');
                }
                const oldData = localStorage.getItem('APP_DATA');
                if (oldData) {
                    await DB.setItem('APP_DATA', oldData);
                    localStorage.removeItem('APP_DATA');
                }

                // ========== 2. 尝试读取新格式键（拆分后的轻量设置） ==========
                const settingsStr = await DB.getItem('APP_SETTINGS');
                let hasNewFormat = !!settingsStr; // 如果存在 APP_SETTINGS 则视为新格式

                let contactsStr = null;
                if (hasNewFormat) {
                    // 新格式加载
                    contactsStr = await DB.getItem('CHAT_CONTACTS');
                    if (contactsStr) {
                        const parsed = JSON.parse(contactsStr);
                        mockContacts.length = 0;
                        mockContacts.push(...parsed);
                        sortChatListByTime();
                    }

                    // 加载设置（不含对话）
                    if (settingsStr) {
                        const settings = JSON.parse(settingsStr);
                        APP_DATA.conversations = {}; // 清空准备重载
                        Object.assign(APP_DATA, settings);
                    }

                    // 加载每个角色的对话
                    if (mockContacts.length > 0) {
                        const convKeys = mockContacts.map(c => `CONV_${c.id}`);
                        const results = await Promise.all(
                            convKeys.map(key => DB.getItem(key).catch(() => null))
                        );
                        results.forEach((convStr, index) => {
                            const contactId = mockContacts[index].id;
                            if (convStr) {
                                APP_DATA.conversations[contactId] = JSON.parse(convStr);
                            } else {
                                APP_DATA.conversations[contactId] = [];
                            }
                        });
                    }
                } else {
                    // ========== 3. 旧格式加载（第一次使用拆分功能，或还没迁移） ==========
                    await saveQueue; // 等待可能未完成的写操作

                    // 读取旧键
                    contactsStr = await DB.getItem('CHAT_CONTACTS');
                    if (contactsStr) {
                        const parsed = JSON.parse(contactsStr);
                        mockContacts.length = 0;
                        mockContacts.push(...parsed);
                        sortChatListByTime();
                    }

                    const appDataStr = await DB.getItem('APP_DATA');
                    if (appDataStr) {
                        const parsed = JSON.parse(appDataStr);
                        Object.assign(APP_DATA, parsed);
                    }

                    // ========== 4. 后台执行一次安全迁移（不删除旧数据） ==========
                    // 仅在成功加载旧数据后，悄悄把对话拆分成 CONV_ 键，方便以后加载
                    setTimeout(async () => {
                        try {
                            // 写入新设置键
                            const settings = {
                                apiKey: APP_DATA.apiKey,
                                apiUrl: APP_DATA.apiUrl,
                                currentChatId: APP_DATA.currentChatId,
                                settings: APP_DATA.settings,
                                activityStats: APP_DATA.activityStats
                            };
                            await DB.setItem('APP_SETTINGS', JSON.stringify(settings));
                            // 写入每个角色的对话
                            for (const contact of mockContacts) {
                                const conv = APP_DATA.conversations[contact.id];
                                if (conv && conv.length > 0) {
                                    await DB.setItem(`CONV_${contact.id}`, JSON.stringify(conv));
                                }
                            }
                            console.log('✅ 数据已顺利拆分，下次启动将直接使用新格式，旧 APP_DATA 依然保留作为备份');
                        } catch(e) {
                            console.error('后台迁移失败（不影响使用）:', e);
                        }
                    }, 500);
                }

                // ========== 5. 渲染界面 ==========
                if (typeof renderChatList === 'function') {
                    renderChatList();
                }
            } catch(e) {
                console.error('加载数据失败:', e);
            }
            // 迁移：将旧的 activityStats 从 APP_DATA 移到独立键 ACTIVITY_STATS
            try {
                let hasNew = await DB.getItem('ACTIVITY_STATS');
                if (!hasNew) {
                    const appDataStr = await DB.getItem('APP_DATA');
                    if (appDataStr) {
                        const appData = JSON.parse(appDataStr);
                        if (appData.activityStats && Object.keys(appData.activityStats).length > 0) {
                            await DB.setItem('ACTIVITY_STATS', JSON.stringify(appData.activityStats));
                            console.log('✅ 已将活动统计数据迁移到 ACTIVITY_STATS');
                        }
                    }
                }
            } catch(e) { console.error('迁移 activityStats 失败', e); }
                
            // 确保 APP_DATA.activityStats 有值（优先从独立键读取）
            const independentStats = await DB.getItem('ACTIVITY_STATS');
            if (independentStats) {
                APP_DATA.activityStats = JSON.parse(independentStats);
            } else if (!APP_DATA.activityStats) {
                APP_DATA.activityStats = {};
            }

            // ===== 强制同步：从 APP_SETTINGS 中更新 ACTIVITY_STATS（确保 5.19-5.31 数据恢复）=====
            try {
                const settingsStr = await DB.getItem('APP_SETTINGS');
                if (settingsStr) {
                    const settings = JSON.parse(settingsStr);
                    if (settings.activityStats && Object.keys(settings.activityStats).length > 0) {
                        // 读取当前独立键中的旧数据（如果存在）
                        let existingStats = {};
                        const existingStatsStr = await DB.getItem('ACTIVITY_STATS');
                        if (existingStatsStr) existingStats = JSON.parse(existingStatsStr);
                        
                        // 将 APP_SETTINGS 中的 activityStats 合并到独立键（以后者为准，覆盖冲突）
                        const newStats = { ...existingStats, ...settings.activityStats };
                        await DB.setItem('ACTIVITY_STATS', JSON.stringify(newStats));
                        console.log('✅ 已从 APP_SETTINGS 同步 activityStats 到 ACTIVITY_STATS');
                        
                        // 同时更新内存中的 APP_DATA.activityStats
                        APP_DATA.activityStats = newStats;
                    }
                }
            } catch(e) {
                console.error('从 APP_SETTINGS 同步 activityStats 失败', e);
            }
        }
        
        // --- 按时间排序聊天列表 ---
        function sortChatListByTime() {
            mockContacts.sort((a, b) => {
                // 将时间转换为时间戳进行比较
                const timeA = new Date(a.time || 0).getTime();
                const timeB = new Date(b.time || 0).getTime();
                
                // 降序排序（最新的在前面）
                return timeB - timeA;
            });
        }
