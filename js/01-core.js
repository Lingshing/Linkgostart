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
                const value = await localforage.getItem(key);
                if (value !== null) {
                    await this.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                    movedCount++;
                }
            }
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
                    return res.values[0].value;
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

    setTimeout(() => {
        toast.classList.remove('show'); 
        setTimeout(() => toast.remove(), 700);
    }, 1500);
}

window.alert = function(msg) {
    showToast(msg);
};

const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' });
const stopWords = new Set(['的', '了', '是', '我', '你', '他', '在', '不', '有', '个', '也', '就']);

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

function calculateMemoryScore(queryKeywords, memoryKeywords) {
    let score = 0;
    queryKeywords.forEach(qKey => {
        if (memoryKeywords.includes(qKey)) {
            score += qKey.length;
        }
    });
    return score;
}

const APP_DATA = {
    contacts: [],
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    currentChatId: null,
    conversations: {}, 
    settings: {
        contextLimit: 10,
        diaryInterval: 10,
        backfillApiUrl: '',
        backfillApiKey: '',
        backfillModel: ''
    }
};

async function loadActivityStats() {
    const stats = await DB.getItem('ACTIVITY_STATS');
    return stats ? JSON.parse(stats) : {};
}
async function saveActivityStats(stats) {
    await DB.setItem('ACTIVITY_STATS', JSON.stringify(stats));
}

function getStandardApiUrl(rawUrl, endpoint = '/chat/completions') {
    let url = rawUrl.trim();
    url = url.replace(/\/chat\/completions\/?$/i, '');
    url = url.replace(/\/models\/?$/i, '');
    url = url.replace(/\/$/, ''); 
    if (!url.endsWith('/v1') && !url.includes('/v1/')) {
        url = url + '/v1';
    }
    return url + endpoint;
}

const TIKTOKEN_RANKS = {}; 

function encodeTiktoken(text) {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    const otherChars = text.length - chineseChars - englishWords;
    return Math.ceil(chineseChars * 1.5 + englishWords * 1.3 + otherChars * 0.5);
}

function countTokens(messages) {
    let total = 0;
    messages.forEach(msg => {
        total += encodeTiktoken(msg.content || '');
        total += 4; 
    });
    return total + 2; 
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

        const settingsStr = await DB.getItem('APP_SETTINGS');
        let hasNewFormat = !!settingsStr;

        let contactsStr = null;
        if (hasNewFormat) {
            contactsStr = await DB.getItem('CHAT_CONTACTS');
            if (contactsStr) {
                const parsed = JSON.parse(contactsStr);
                mockContacts.length = 0;
                mockContacts.push(...parsed);
                sortChatListByTime();
            }

            if (settingsStr) {
                const settings = JSON.parse(settingsStr);
                APP_DATA.conversations = {}; 
                Object.assign(APP_DATA, settings);
            }

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
            await saveQueue; 

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

            setTimeout(async () => {
                try {
                    const settings = {
                        apiKey: APP_DATA.apiKey,
                        apiUrl: APP_DATA.apiUrl,
                        currentChatId: APP_DATA.currentChatId,
                        settings: APP_DATA.settings,
                        activityStats: APP_DATA.activityStats
                    };
                    await DB.setItem('APP_SETTINGS', JSON.stringify(settings));
                    for (const contact of mockContacts) {
                        const conv = APP_DATA.conversations[contact.id];
                        if (conv && conv.length > 0) {
                            await DB.setItem(`CONV_${contact.id}`, JSON.stringify(conv));
                        }
                    }
                    console.log('✅ 数据已顺利拆分，下次启动将直接使用新格式');
                } catch(e) {
                    console.error('后台迁移失败（不影响使用）:', e);
                }
            }, 500);
        }

        if (typeof renderChatList === 'function') {
            renderChatList();
        }
    } catch(e) {
        console.error('加载数据失败:', e);
    }
    
    try {
        let hasNew = await DB.getItem('ACTIVITY_STATS');
        if (!hasNew) {
            const appDataStr = await DB.getItem('APP_DATA');
            if (appDataStr) {
                const appData = JSON.parse(appDataStr);
                if (appData.activityStats && Object.keys(appData.activityStats).length > 0) {
                    await DB.setItem('ACTIVITY_STATS', JSON.stringify(appData.activityStats));
                }
            }
        }
    } catch(e) { console.error('迁移 activityStats 失败', e); }
        
    const independentStats = await DB.getItem('ACTIVITY_STATS');
    if (independentStats) {
        APP_DATA.activityStats = JSON.parse(independentStats);
    } else if (!APP_DATA.activityStats) {
        APP_DATA.activityStats = {};
    }

    try {
        const settingsStr = await DB.getItem('APP_SETTINGS');
        if (settingsStr) {
            const settings = JSON.parse(settingsStr);
            if (settings.activityStats && Object.keys(settings.activityStats).length > 0) {
                let existingStats = {};
                const existingStatsStr = await DB.getItem('ACTIVITY_STATS');
                if (existingStatsStr) existingStats = JSON.parse(existingStatsStr);
                const newStats = { ...existingStats, ...settings.activityStats };
                await DB.setItem('ACTIVITY_STATS', JSON.stringify(newStats));
                APP_DATA.activityStats = newStats;
            }
        }
    } catch(e) {
        console.error('从 APP_SETTINGS 同步 activityStats 失败', e);
    }
}

function sortChatListByTime() {
    mockContacts.sort((a, b) => {
        const timeA = new Date(a.time || 0).getTime();
        const timeB = new Date(b.time || 0).getTime();
        return timeB - timeA;
    });
}
