// ========== 聊天功能纯逻辑 ==========
function getConversation(contactId) {
    if (!APP_DATA.conversations[contactId]) {
        APP_DATA.conversations[contactId] = [];
    }
    return APP_DATA.conversations[contactId];
}

async function addMessage(contactId, role, content) {
    const conversation = getConversation(contactId);
    conversation.push({ role, content, timestamp: Date.now() });
    
    if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
    const d = new Date();
    const todayStr = d.toLocaleDateString('zh-CN').replace(/\//g, '-');
    const hourKey = todayStr + '_' + d.getHours();

    if (role === 'user') {
        APP_DATA.activityStats[todayStr] = (APP_DATA.activityStats[todayStr] || 0) + 1;
        APP_DATA.activityStats[hourKey] = (APP_DATA.activityStats[hourKey] || 0) + 1;
        await saveActivityStats(APP_DATA.activityStats);
    }
    saveToLocal();
}

function clearConversation(contactId) {
    APP_DATA.conversations[contactId] = [];
    DB.removeItem(`CONV_${contactId}`).catch(() => {});
    saveToLocal();
}

async function sendMessageToAPI(contactId, userMessage, onChunk, onComplete, onError) {
    if (!CHAT_API_CONFIGS.currentId) {
        if (onError) onError(new Error('请先在"我"→"API配置"中选择一个配置'));
        return;
    }
    
    const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
    const currentUiModel = document.getElementById('chat-current-model').value;
    if (currentUiModel) config.model = currentUiModel;
    if (!config) {
        if (onError) onError(new Error('当前配置不存在，请重新选择'));
        return;
    }
    
    if (!config.url || !config.key) {
        if (onError) onError(new Error('当前配置不完整，请检查API URL和API Key'));
        return;
    }
    
    const contact = mockContacts.find(c => c.id === contactId);
    const systemPrompt = getSystemPromptWithMode(contact);
    const conversation = getConversation(contactId);
    const messages = [];
    
    let injectedMemoryText = "";
    if (contact.longMemories && contact.longMemories.length > 0) {
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

    let finalPrompt = (systemPrompt || "") + (injectedMemoryText || "");
    
    let presetSystemContent = "";
    let presetJailbreakContent = "";
    if (window.ADVANCED_PRESET_FILES) {
        const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
        enabledFiles.forEach(file => {
            if (file.prompts) {
                file.prompts.forEach(p => {
                    if (p.enabled !== false && p.content) {
                        if (p.identifier === "jailbreak" || p.name === "Jailbreak" || p.name === "3.5 Main prompt suffix" || p.name === "Important explanation") {
                            presetJailbreakContent += '\n\n' + p.content;
                        } else {
                            presetSystemContent += '\n\n' + p.content;
                        }
                    }
                });
            }
        });
    }

    let finalSystemString = "";
    if (presetSystemContent) finalSystemString += "【预设背景设定参考】\n" + presetSystemContent + "\n\n";
    if (finalPrompt) finalSystemString += "【！！！最高优先级：必须严格执行以下排版与输出法则！！！】\n" + finalPrompt;
    
    if (finalSystemString) {
        messages.unshift({ role: 'system', content: finalSystemString });
    }

    let mergedChat = JSON.parse(JSON.stringify(conversation));
    if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
        mergedChat.forEach(msg => {
            if (msg.role === 'user') msg.content = applyRegexRules(msg.content);
        });
    }

    if (presetJailbreakContent) {
        let lastUserMsgIndex = -1;
        for (let i = mergedChat.length - 1; i >= 0; i--) {
            if (mergedChat[i].role === 'user') { lastUserMsgIndex = i; break; }
        }
        if (lastUserMsgIndex !== -1) {
            mergedChat[lastUserMsgIndex].content += `\n\n【系统越狱强制指令，绝对服从】：${presetJailbreakContent}`;
        }
    }
    messages.push(...mergedChat);
    
    try {
        let apiUrl = getStandardApiUrl(config.url, '/chat/completions');
        const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customEndpoint: apiUrl,
                customApiKey: config.key,
                model: config.model || 'gpt-3.5-turbo',
                messages: messages,
                stream: PARAM_CONFIG.stream,
                temperature: PARAM_CONFIG.temperature,
                max_tokens: PARAM_CONFIG.maxTokens,
                frequency_penalty: PARAM_CONFIG.frequencyPenalty,
                presence_penalty: PARAM_CONFIG.presencePenalty
            })
        });
        
        if (!response.ok) throw new Error(`API请求失败 (${response.status})`);
        
        if (PARAM_CONFIG.stream) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullMessage = '';
            let buffer = '';
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, {stream: true});
                const lines = buffer.split('\n');
                buffer = lines.pop();
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine.startsWith('data: ')) {
                        const data = trimmedLine.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const json = JSON.parse(data);
                            const delta = json.choices?.[0]?.delta;
                            let content = delta?.content || '';
                            if (content) {
                                fullMessage += content;
                                if (onChunk) onChunk(content, fullMessage);
                            }
                        } catch (e) {}
                    }
                }
            }
            if (fullMessage) addMessage(contactId, 'assistant', fullMessage);
            if (onComplete) onComplete(fullMessage);
        } else {
            const data = await response.json();
            const aiReply = data.choices?.[0]?.message?.content || data.result || '抱歉，我没有收到回复';
            const breathingDiv = document.getElementById('active-stream-container');
            if (breathingDiv) breathingDiv.remove();
            if (typeof backgroundAIReply !== 'undefined') { backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null; }
            if (aiReply) addMessage(contactId, 'assistant', aiReply);
            if (onComplete) onComplete(aiReply);
        }
    } catch (error) {
        if (typeof sendPushNotification === 'function') sendPushNotification(`⚠️ API 报错了：${error.message}`);
        if (onError) onError(error);
    }
}

async function regenerateResponse(contactId, onChunk, onComplete, onError) {
    if (!currentChatContactId) return;
    const conversation = getConversation(currentChatContactId);
    let lastUserMsg = null;
    let lastUserIndex = -1;
    for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].role === 'user') {
            lastUserMsg = conversation[i].content;
            lastUserIndex = i;
            break;
        }
    }
    if (!lastUserMsg) return;
    conversation.splice(lastUserIndex + 1);
    saveToLocal();
    renderChatMessages(currentChatContactId);
    window._regenerateTempMsg = lastUserMsg;
    await sendChatMessage(true);
    delete window._regenerateTempMsg;
}

// ========== 上下文压缩 ==========
function compressConversation(messages, maxTokens) {
    let totalTokens = countTokens(messages);
    if (totalTokens <= maxTokens) return messages;
    const compressed = [...messages];
    while (totalTokens > maxTokens && compressed.length > 2) {
        if (compressed[0].role === 'system') compressed.splice(1, 1);
        else compressed.shift();
        totalTokens = countTokens(compressed);
    }
    return compressed;
}

function manageMemory(contactId, systemPrompt) {
    if (typeof MEMORY_CONFIG !== 'undefined' && !MEMORY_CONFIG.enableMemory) return [];
    const conversation = getConversation(contactId);
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...conversation);
    if (typeof MEMORY_CONFIG !== 'undefined') {
        const availableTokens = MEMORY_CONFIG.maxTokens - MEMORY_CONFIG.reserveTokens;
        return compressConversation(messages, availableTokens);
    }
    return messages;
}

// ========== 聊天详情界面 ==========
function openChatDetail() {
    if (!currentChatContactId) return;
    updateMemoryStats();
    updateChatModeUI();
    updateRealityModeUI();
    document.getElementById('chat-detail-panel').classList.add('show');
}

function toggleRealityModeCard() {
    if (!currentChatContactId) return;
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (contact) {
        contact.realityMode = !contact.realityMode;
        saveToLocal();
        updateRealityModeUI();
    }
}

function updateRealityModeUI() {
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (!contact) return;
    const realitySwitch = document.getElementById('reality-mode-switch');
    if (realitySwitch) {
        if (contact.realityMode) realitySwitch.classList.add('active');
        else realitySwitch.classList.remove('active');
    }
}

function updateChatModeUI() {
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (!contact) return;
    const mode = contact.chatMode || 'none';
    const onlineSwitch = document.getElementById('online-mode-switch');
    const offlineSwitch = document.getElementById('offline-mode-switch');
    if (onlineSwitch) onlineSwitch.classList.toggle('active', mode === 'online');
    if (offlineSwitch) offlineSwitch.classList.toggle('active', mode === 'offline');
}

function parseBubbles(text) {
    if (!text) return [];
    text = text.replace(/[（\(]([^）\)]+)[）\)]/g, function(match, innerContent) {
        let cleanInner = innerContent.replace(/[。\.]/g, '');
        return match.charAt(0) + cleanInner + match.charAt(match.length - 1);
    });
    text = text.replace(/\\+([）\)])/g, '$1\\');
    text = text.replace(/([^\\])([（\(])/g, '$1\x00$2');
    text = text.replace(/([）\)])([^\\])/g, '$1\x00$2');
    let bubbles = text.split(/\\|\x00/g);
    return bubbles.map(b => b.trim()).filter(b => b !== '');
}

function getSystemPromptWithMode(contact) {
    let finalPrompt = contact.prompt || '';
    const now = new Date();
    const absoluteTimeStr = `\n\n【系统最高指令 - 绝对时间线】当前绝对时间为：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}。你严禁自行推算“三天后”、“几个月后”等相对时间！所有设定与记忆反馈必须以当前这个时刻为绝对基准。`;
    finalPrompt += absoluteTimeStr;
    
    if (contact.realityMode) {
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        const pad = n => n.toString().padStart(2, '0');
        const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        finalPrompt += `\n\n【系统特别提示：现实感知已开启】当前真实世界的时间是：${timeStr}。请严格符合当前时间点进行对话。`;
    }
    
    const currentMode = contact?.chatMode || 'none';
    if (currentMode === 'online') {
        finalPrompt += `\n\n【聊天模式设定：线上网络聊天】\n你现在处于线上聊天模式，极度碎片化，严格限制标点，拒绝话题终结，纯文字交流。`;
    } else if (currentMode === 'offline') {
        finalPrompt += `\n\n【核心定位与绝对规则】\n你是${contact.name}，正在与用户进行深度沉浸式的角色扮演。每个行为语言块严格遵循 \`(动作描写)对话内容\` 的结构。必须使用反斜线 \`\\\` 来平滑分隔不同的块。`;
    }
    
    if (typeof isClaudeMimicEnabled !== 'undefined' && isClaudeMimicEnabled) {
        finalPrompt += "\n\n" + CLAUDE_MIMIC_PATCH;
    }
    return finalPrompt;
}

function toggleChatMode(clickedMode) {
    if (!currentChatContactId) return;
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (!contact) return;
    const currentMode = contact.chatMode || 'none';
    contact.chatMode = (clickedMode === currentMode) ? 'none' : clickedMode;
    saveToLocal();
    updateChatModeUI();
}

function closeChatDetail() {
    const panel = document.getElementById('chat-detail-panel');
    panel.style.transform = '';
    panel.classList.remove('show');
}

function updateMemoryStats() {
    if (!currentChatContactId) return;
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (!contact) return;
    const conversation = getConversation(currentChatContactId);
    const shortCount = conversation.length;
    let longCount = contact.longMemories ? contact.longMemories.length : 0;
    document.getElementById('short-memory-badge').textContent = `${shortCount}条`;
    document.getElementById('long-memory-badge').textContent = `${longCount}条`;
    document.getElementById('all-memory-badge').textContent = `${shortCount + longCount}条`;
}

function openPromptEditModal() {
    if (!currentChatContactId) return;
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (!contact) return;
    document.getElementById('promptText').value = contact.prompt || '';
    document.getElementById('promptModalOverlay').classList.add('show');
}

function closePromptModal() {
    if (currentChatContactId) {
        const contact = mockContacts.find(c => c.id === currentChatContactId);
        if (contact) {
            contact.prompt = document.getElementById('promptText').value;
            saveToLocal();
        }
    }
    document.getElementById('promptModalOverlay').classList.remove('show');
}

function closePromptModalOverlay(event) { if (event.target === event.currentTarget) closePromptModal(); }

function copyPrompt() {
    const text = document.getElementById('promptText').value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showCopySuccess()).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function showCopySuccess() {
    const btn = document.querySelector('.prompt-copy-btn');
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    const originalBg = btn.style.background;
    btn.style.transition = 'all 0.2s'; btn.style.opacity = '0'; btn.style.transform = 'scale(0.8)';
    setTimeout(() => {
        btn.innerHTML = '<i class="fas fa-check"></i>'; btn.style.background = '#34C759'; btn.style.opacity = '1'; btn.style.transform = 'scale(1.1)';
        setTimeout(() => {
            btn.style.transform = 'scale(1)';
            setTimeout(() => {
                btn.style.opacity = '0'; btn.style.transform = 'scale(0.8)';
                setTimeout(() => {
                    btn.innerHTML = originalHTML; btn.style.background = originalBg; btn.style.opacity = '1'; btn.style.transform = 'scale(1)';
                }, 200);
            }, 1200);
        }, 100);
    }, 200);
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0';
    document.body.appendChild(textarea); textarea.select();
    try { if (document.execCommand('copy')) showCopySuccess(); } catch (err) {}
    document.body.removeChild(textarea);
}

let originalShortMemoryData = null;
function cancelShortMemoryEdit() {
    if (!currentChatContactId || !originalShortMemoryData) return;
    if (!confirm('确定要取消所有未保存的修改吗？')) return;
    const btn = document.querySelector('.config-modal-header .fa-rotate-left');
    if (btn) {
        btn.style.transition = 'opacity 0.2s'; btn.style.opacity = '0';
        setTimeout(() => { btn.className = 'fas fa-check'; btn.style.color = '#34C759'; btn.style.opacity = '1';
            setTimeout(() => { btn.style.opacity = '0';
                setTimeout(() => { btn.className = 'fas fa-rotate-left'; btn.style.color = '#8e8e93'; btn.style.opacity = '1'; }, 200);
            }, 800);
        }, 200);
    }
    APP_DATA.conversations[currentChatContactId] = JSON.parse(originalShortMemoryData);
    saveToLocal(); renderShortMemoryContent();
    if (document.getElementById('scene-chat').classList.contains('show')) renderChatMessages(currentChatContactId);
}

let currentShortMemorySearchTerm = '';
function openShortMemoryModal() {
    if (!currentChatContactId) return;
    originalShortMemoryData = JSON.stringify(getConversation(currentChatContactId));
    renderShortMemoryContent();
    requestAnimationFrame(() => document.getElementById('shortMemoryModal').classList.add('show'));
}

function renderShortMemoryContent(autoScroll = true) {
    const container = document.getElementById('short-memory-content');
    if (!container) return;
    container.innerHTML = '';
    const conversation = getConversation(currentChatContactId);
    if (conversation.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-sub);">暂无对话记忆</div>';
        return;
    }
    const rounds = []; let currentRound = [];
    conversation.forEach((msg, index) => {
        if ((msg.role === 'user') && currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; }
        currentRound.push(msg);
        const nextMsg = conversation[index + 1];
        if (!nextMsg || nextMsg.role === 'user') { if (currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; } }
    });
    rounds.forEach((round, roundIndex) => {
        const roundDiv = document.createElement('div'); roundDiv.className = 'short-memory-round'; roundDiv.style.margin = '12px 20px';
        roundDiv.innerHTML = `<div class="short-memory-round-header"><div class="short-memory-round-title">第 ${roundIndex + 1} 轮对话</div><button class="short-memory-round-delete" onclick="deleteShortMemoryRound(${roundIndex})">×</button></div>`;
        round.forEach((msg, msgIndex) => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `short-memory-message ${msg.role === 'user' ? 'user' : 'ai'}`;
            msgDiv.textContent = msg.content; msgDiv.style.cursor = 'pointer';
            msgDiv.onclick = () => editShortMemoryMessage(roundIndex, msgIndex);
            roundDiv.appendChild(msgDiv);
        });
        const clearDiv = document.createElement('div'); clearDiv.style.clear = 'both'; roundDiv.appendChild(clearDiv);
        container.appendChild(roundDiv);
    });
    if (autoScroll) setTimeout(() => container.scrollTop = container.scrollHeight, 0);
}

function deleteShortMemoryRound(roundIndex) {
    if (!confirm('确定要删除这一轮对话吗？')) return;
    const conversation = getConversation(currentChatContactId);
    const rounds = []; let currentRound = [];
    conversation.forEach((msg, index) => {
        if ((msg.role === 'user') && currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; }
        currentRound.push(msg);
        const nextMsg = conversation[index + 1];
        if (!nextMsg || nextMsg.role === 'user') { if (currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; } }
    });
    rounds.splice(roundIndex, 1);
    APP_DATA.conversations[currentChatContactId] = rounds.flat();
    saveToLocal();
    renderShortMemoryContent();
    if (document.getElementById('scene-chat').classList.contains('show')) renderChatMessages(currentChatContactId);
    updateMemoryStats();
}

function editShortMemoryMessage(roundIndex, msgIndex) {
    if (!currentChatContactId) return;
    const conversation = getConversation(currentChatContactId);
    const rounds = []; let currentRound = [];
    conversation.forEach((msg, index) => {
        if ((msg.role === 'user') && currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; }
        currentRound.push(msg);
        const nextMsg = conversation[index + 1];
        if (!nextMsg || nextMsg.role === 'user') { if (currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; } }
    });
    const round = rounds[roundIndex];
    if (!round || !round[msgIndex]) return;
    const msgDiv = document.getElementById('short-memory-content').querySelectorAll('.short-memory-round')[roundIndex].querySelectorAll('.short-memory-message')[msgIndex];
    const textarea = document.createElement('textarea');
    textarea.value = round[msgIndex].content; textarea.className = msgDiv.className;
    textarea.style.cssText = 'width:100%;min-height:60px;padding:10px;margin-bottom:10px;border-radius:8px;border:1px solid var(--border);background:var(--bg-color);color:var(--text-main);outline:none;resize:vertical;';
    msgDiv.replaceWith(textarea); textarea.focus();
    const saveEdit = () => {
        const newContent = textarea.value.trim();
        let flatIndex = 0; for (let r = 0; r < roundIndex; r++) flatIndex += rounds[r].length;
        flatIndex += msgIndex;
        if (newContent === '') { conversation.splice(flatIndex, 1); } else { conversation[flatIndex].content = newContent; }
        saveToLocal(); renderShortMemoryContent();
        if (document.getElementById('scene-chat').classList.contains('show')) renderChatMessages(currentChatContactId);
    };
    textarea.onblur = () => setTimeout(saveEdit, 100);
    textarea.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); } };
}

function filterShortMemory(searchText) {
    currentShortMemorySearchTerm = searchText;
    const container = document.getElementById('short-memory-content');
    if (!container) return;
    if (!searchText) { renderShortMemoryContent(); return; }
    const term = searchText.toLowerCase();
    const conversation = getConversation(currentChatContactId);
    const rounds = []; let currentRound = [];
    conversation.forEach((msg, index) => {
        if ((msg.role === 'user') && currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; }
        currentRound.push(msg);
        const nextMsg = conversation[index + 1];
        if (!nextMsg || nextMsg.role === 'user') { if (currentRound.length > 0) { rounds.push([...currentRound]); currentRound = []; } }
    });
    const matchedRounds = [];
    rounds.forEach((round, originalIndex) => { if (round.some(msg => msg.content.toLowerCase().includes(term))) matchedRounds.push({ round, originalIndex }); });
    if (matchedRounds.length === 0) { container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-sub);">没有找到匹配的对话</div>'; return; }
    container.innerHTML = '';
    matchedRounds.forEach((item, displayIndex) => {
        const roundDiv = document.createElement('div'); roundDiv.className = 'short-memory-round'; roundDiv.style.margin = '12px 20px';
        roundDiv.innerHTML = `<div class="short-memory-round-header"><div class="short-memory-round-title">第 ${item.originalIndex + 1} 轮对话</div></div>`;
        item.round.forEach((msg, msgIndex) => {
            const msgDiv = document.createElement('div');
            msgDiv.className = `short-memory-message ${msg.role === 'user' ? 'user' : 'ai'}`;
            const safeContent = escapeHtml(msg.content);
            const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            msgDiv.innerHTML = safeContent.replace(regex, '<span style="background-color:rgba(255,214,10,0.6);color:#000;border-radius:3px;padding:0 2px;">$1</span>');
            msgDiv.style.cursor = 'pointer'; msgDiv.onclick = () => editShortMemoryMessage(item.originalIndex, msgIndex);
            roundDiv.appendChild(msgDiv);
        });
        const clearDiv = document.createElement('div'); clearDiv.style.clear = 'both'; roundDiv.appendChild(clearDiv);
        container.appendChild(roundDiv);
    });
    setTimeout(() => container.scrollTop = container.scrollHeight, 0);
}

function closeShortMemoryModal() {
    currentShortMemorySearchTerm = '';
    document.getElementById('short-memory-search').value = '';
    document.getElementById('shortMemoryModal').classList.remove('show');
}

function closeShortMemoryModalByOverlay(event) { if (event.target === event.currentTarget) closeShortMemoryModal(); }

function clearShortMemory() {
    if (!currentChatContactId || getConversation(currentChatContactId).length === 0) return;
    if (!confirm('确定要清空所有对话记忆吗？')) return;
    clearConversation(currentChatContactId);
    renderChatMessages(currentChatContactId);
    updateChatListLastMessage(currentChatContactId, '');
    updateMemoryStats();
}

function clearLongMemory() {
    if (!currentChatContactId) return;
    if (!confirm('确定要清空长期记忆吗？')) return;
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (contact) { contact.longMemories = []; contact.relations = []; saveToLocal(); }
    updateMemoryStats();
}

function clearAllMemory() {
    if (!currentChatContactId) return;
    if (!confirm('确定要清空所有记忆吗？')) return;
    clearConversation(currentChatContactId);
    const contact = mockContacts.find(c => c.id === currentChatContactId);
    if (contact) { contact.longMemories = []; contact.relations = []; saveToLocal(); }
    renderChatMessages(currentChatContactId);
    updateChatListLastMessage(currentChatContactId, '');
    updateMemoryStats();
}

// ========== 聊天列表与发送消息 ==========
const mockContacts = [
    { id: 1, name: '心理导师', avatar: '', lastMsg: '今天感觉怎么样？', time: '14:20', color: '#FF9F0A', prompt: '你是一位专业的心理导师。', longMemories: [], summaryCount: 0, summaryThreshold: 10 },
    { id: 2, name: '英语陪练', avatar: '', lastMsg: 'Practice your pronunciation!', time: '昨天', color: '#30D158', prompt: '你只说英语。', longMemories: [], summaryCount: 0, summaryThreshold: 10 },
    { id: 3, name: '产品经理', avatar: '', lastMsg: '那个需求文档你看一下。', time: '星期一', color: '#0A84FF', prompt: '你是一位产品经理。', longMemories: [], summaryCount: 0, summaryThreshold: 10 },
    { id: 4, name: '旅行助手', avatar: '', lastMsg: '为您推荐了几个景点。', time: '2023/12/10', color: '#BF5AF2', prompt: '你是一位旅行顾问。', longMemories: [], summaryCount: 0, summaryThreshold: 10 }
];

function renderChatList() {
    const container = document.getElementById('chat-list-container');
    if (!container) return;
    container.innerHTML = '';
    if (mockContacts.length === 0) { container.innerHTML = '<div style="text-align:center;padding-top:100px;color:#ccc;">暂无消息</div>'; return; }
    mockContacts.forEach((contact, index) => {
        const wrapper = document.createElement('div'); wrapper.className = 'chat-item-wrapper';
        wrapper.innerHTML = `<div class="chat-item-actions"><div class="chat-action-btn chat-action-edit" onclick="event.stopPropagation(); editChatRole(${index});">编辑</div><div class="chat-action-btn chat-action-delete" onclick="event.stopPropagation(); deleteChatRole(${index});">删除</div></div>`;
        const item = document.createElement('div'); item.className = 'chat-item';
        item.onclick = (e) => { if (item.dataset.ignoreClick === 'true') { item.dataset.ignoreClick = 'false'; e.stopPropagation(); return; } openChatWindow(contact.id); };
        const avatarHtml = contact.avatar ? `<img src="${contact.avatar}">` : `<div style="background:${contact.color||'#ccc'};width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${contact.name[0]}</div>`;
        item.innerHTML = `<div class="chat-item-avatar">${avatarHtml}</div><div class="chat-item-content"><div class="chat-item-name">${contact.name}</div><div class="chat-item-preview">${contact.lastMsg}</div></div><div class="chat-item-meta"><div class="chat-item-time">${formatMessageTime(contact.time)}</div></div>`;
        if (typeof addChatSwipeHandler === 'function') addChatSwipeHandler(item);
        wrapper.appendChild(item); container.appendChild(wrapper);
    });
}

function addChatSwipeHandler(element) {
    let startX = 0, currentX = 0, isDragging = false, startTime = 0;
    element.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX; currentX = 0; isDragging = true; startTime = Date.now();
        element.classList.add('swiping'); window.isItemSwiping = true;
        document.querySelectorAll('.chat-item').forEach(item => { if (item !== element && item.style.transform) resetChatSwipe(item); });
    });
    element.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const diffX = e.touches[0].clientX - startX;
        if (diffX < 0) { currentX = Math.max(diffX, -140); element.style.transform = `translateX(${currentX}px)`; e.preventDefault(); }
    });
    element.addEventListener('touchend', () => {
        if (!isDragging) return; isDragging = false; element.classList.remove('swiping');
        setTimeout(() => { window.isItemSwiping = false; }, 100);
        const velocity = Math.abs(currentX) / (Date.now() - startTime);
        if (Math.abs(currentX) < 10 && element.style.transform.includes('-140px')) { element.dataset.ignoreClick = 'true'; setTimeout(() => { element.dataset.ignoreClick = 'false'; }, 300); }
        if (Math.abs(currentX) > 70 || velocity > 0.3) element.style.transform = 'translateX(-140px)';
        else resetChatSwipe(element);
    });
}

function resetChatSwipe(element) { element.style.transform = 'translateX(0)'; }
function editChatRole(index) { const newName = prompt('修改角色名称:', mockContacts[index].name); if (newName) { mockContacts[index].name = newName.trim(); saveToLocal(); renderChatList(); } }
function deleteChatRole(index) { if (confirm(`确定要删除"${mockContacts[index].name}"吗？`)) { DB.removeItem(`CONV_${mockContacts[index].id}`); mockContacts.splice(index, 1); renderChatList(); saveToLocal(); } }

let currentChatContactId = null;
let chatExtensionsPanelOpen = false;
let backgroundAIReply = { inProgress: false, contactId: null, fullMessage: '', lastUpdate: 0 };

function openChatWindow(contactId) {
    const contact = mockContacts.find(c => c.id === contactId);
    if (!contact) return;
    currentChatContactId = contactId;
    window.chatMessageLoadCount = 50;
    document.getElementById('chat-title').textContent = contact.name;
    renderChatMessages(contactId);
    showChatWindow();
    document.getElementById('chat-message-input').value = '';
    chatExtensionsPanelOpen = false;
    document.getElementById('chat-extensions-panel').classList.remove('show');
}

function renderChatMessages(contactId, isLoadingMore = false) {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    const oldScrollHeight = container.scrollHeight;
    container.innerHTML = '';
    if (!window.chatMessageLoadCount) window.chatMessageLoadCount = 50;
    const fullConversation = getConversation(contactId);
    const conversation = fullConversation.slice(-window.chatMessageLoadCount);
    if (window.chatMessageLoadCount < fullConversation.length) { container.innerHTML = '<div style="text-align:center;padding:10px;color:var(--text-sub);font-size:12px;">向上滑动加载更多...</div>'; }
    if (conversation.length === 0) { container.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text-sub);">开始对话</div>'; return; }
    scrollToBottomInstant();
    let i = 0, lastMsgTime = 0;
    while (i < conversation.length) {
        const msg = conversation[i]; const msgTime = msg.timestamp;
        if (msgTime && msgTime - lastMsgTime > 300000) {
            const d = new Date(msgTime); const pad = n => n.toString().padStart(2, '0');
            const shortTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
            const timeDiv = document.createElement('div'); timeDiv.className = 'chat-timestamp'; timeDiv.innerText = shortTime;
            timeDiv.onclick = function() { this.textContent = this.textContent === shortTime ? `${d.getMonth() + 1}月${d.getDate()}日 ${shortTime}` : shortTime; };
            container.appendChild(timeDiv); lastMsgTime = msgTime;
        } else if (msgTime) lastMsgTime = msgTime;
        
        if (msg.role === 'user') {
            const div = document.createElement('div'); div.className = 'chat-message user';
            let display = msg.content.startsWith('【论坛分享】') ? `<div class="chat-forward-card"><div class="chat-forward-header">论坛热门帖子</div><div class="chat-forward-title">${msg.content.match(/标题：(.*?)(?=\n|$)/)?.[1] || ''}</div></div>` : (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled ? applyRegexRules(msg.content) : escapeHtml(msg.content));
            div.innerHTML = `${generateAvatarHtml(true)}<div class="chat-bubble">${display}</div>`;
            container.appendChild(div); i++;
        } else {
            const aiMessages = []; while (i < conversation.length && (conversation[i].role === 'assistant' || conversation[i].role === 'ai')) { aiMessages.push(conversation[i]); i++; }
            aiMessages.forEach(aiMsg => {
                const div = document.createElement('div'); div.className = 'chat-message ai';
                let display = typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled ? applyRegexRules(aiMsg.content) : escapeHtml(aiMsg.content);
                div.innerHTML = `${generateAvatarHtml(false, contactId)}<div class="chat-bubble" onclick="toggleRegenerate(this.closest('.chat-message'))">${display || '（空消息）'}</div><div class="regenerate-btn" onclick="regenerateMessage(event, this)"><i class="fas fa-rotate-right"></i></div>`;
                container.appendChild(div);
            });
        }
    }
    const isQueueProcessing = window.AI_BUBBLE_QUEUE && window.AI_BUBBLE_QUEUE[contactId] && window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0;
    if (isQueueProcessing || (backgroundAIReply.inProgress && backgroundAIReply.contactId === contactId)) {
        const streamContainer = document.createElement('div'); streamContainer.id = 'active-stream-container'; streamContainer.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;';
        streamContainer.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble"></div></div>`;
        container.appendChild(streamContainer);
    }
    if (isLoadingMore) container.scrollTop = container.scrollHeight - oldScrollHeight; else scrollToBottomInstant(true);
}

function generateAvatarHtml(isUser, contactId = null) {
    if (!AVATAR_CONFIG) return '';
    if (isUser) return AVATAR_CONFIG.user ? `<div class="chat-avatar"><img src="${AVATAR_CONFIG.user}"></div>` : `<div class="chat-avatar"><i class="fas fa-user"></i></div>`;
    const c = mockContacts.find(x => x.id === (contactId || currentChatContactId));
    if (c && c.avatar) return `<div class="chat-avatar"><img src="${c.avatar}"></div>`;
    if (AVATAR_CONFIG.ai) return `<div class="chat-avatar"><img src="${AVATAR_CONFIG.ai}"></div>`;
    return `<div class="chat-avatar"><i class="fas fa-robot"></i></div>`;
}

function toggleChatExtensions() {
    chatExtensionsPanelOpen = !chatExtensionsPanelOpen;
    const panel = document.getElementById('chat-extensions-panel'); const container = document.getElementById('chat-messages-container');
    const wasAtBottom = container && container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
    if (chatExtensionsPanelOpen) {
        panel.classList.add('show');
        if (wasAtBottom) { const st = Date.now(); function keepAtBottom() { if (Date.now() - st < 400) { container.scrollTop = container.scrollHeight; requestAnimationFrame(keepAtBottom); } } requestAnimationFrame(keepAtBottom); }
    } else {
        panel.classList.remove('show');
        if (wasAtBottom) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
    }
}

function formatMessageTime(timestamp) {
    if (!timestamp || timestamp === '刚刚') return '';
    const now = new Date(), msgTime = new Date(timestamp);
    if (isNaN(msgTime.getTime())) return '';
    const diffMins = Math.floor((now - msgTime) / 60000);
    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;
    if (now.toDateString() === msgTime.toDateString()) return `${msgTime.getHours().toString().padStart(2, '0')}:${msgTime.getMinutes().toString().padStart(2, '0')}`;
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    if (yesterday.toDateString() === msgTime.toDateString()) return '昨天';
    const diffDays = Math.floor((now - msgTime) / 86400000);
    if (diffDays < 7) return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][msgTime.getDay()];
    return `${msgTime.getFullYear() === now.getFullYear() ? (msgTime.getMonth() + 1) + '/' + msgTime.getDate() : msgTime.getFullYear() + '/' + (msgTime.getMonth() + 1) + '/' + msgTime.getDate()}`;
}

function updateChatListLastMessage(contactId, message) {
    const contact = mockContacts.find(c => c.id === contactId);
    if (contact) {
        contact.lastMsg = message ? message.substring(0, 50) : '';
        contact.time = message ? new Date().toISOString() : '';
        if (message) { const idx = mockContacts.findIndex(c => c.id === contactId); if (idx > 0) { const [moved] = mockContacts.splice(idx, 1); mockContacts.unshift(moved); } }
        saveToLocal(); renderChatList();
    }
}

function splitByChinesePunctuation(text) { return text.split(/(?<=[。！？；])/).map(s => s.trim()).filter(s => s); }
function splitByEnglishPunctuation(text) { return text.split(/(?<=[.!?;])/).map(s => s.trim()).filter(s => s); }
function splitByComma(text) {
    const parts = text.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0);
    let combined = '', sentences = [];
    for (let part of parts) { if (combined.length + part.length < 20) combined += (combined ? '，' : '') + part; else { if (combined) sentences.push(combined); combined = part; } }
    if (combined) sentences.push(combined); return sentences;
}
function splitByLength(text) {
    let sentences = [], current = '';
    for (let char of text) { current += char; if (current.length >= 40 || (current.length >= 20 && /[。！？.!?，,]/.test(char))) { sentences.push(current.trim()); current = ''; } }
    if (current.trim()) sentences.push(current.trim()); return sentences;
}

function splitTextIntoSentences(fullText) {
    if (!fullText) return [];
    let text = fullText.replace(/([!?！？])\1+/g, '$1').replace(/[\/／∕⧸⁄]/g, '');
    if (text.includes('\\') || text.includes('（') || text.includes('(')) { const sentences = parseBubbles(text); if (sentences.length > 0) return sentences; }
    if (text.includes('\n')) { const lines = text.split('\n').filter(line => line.trim().length > 0); if (lines.length > 1) return lines; }
    if (/[。！？；]/.test(text)) return splitByChinesePunctuation(text);
    if (/[.!?;]/.test(text)) return splitByEnglishPunctuation(text);
    if (/[,，]/.test(text)) return splitByComma(text);
    if (text.length > 30) return splitByLength(text);
    return [text];
}

window.AI_BUBBLE_QUEUE = window.AI_BUBBLE_QUEUE || {};
function startGlobalBubbleQueue(contactId, fullText) {
    let sentences = splitTextIntoSentences(fullText).map(s => s.replace(/\\/g, '').trim()).filter(s => s.length > 0);
    if (sentences.length === 0) sentences = [!fullText || !fullText.trim() ? '（AI 未返回任何内容）' : fullText];
    if (!window.AI_BUBBLE_QUEUE[contactId]) window.AI_BUBBLE_QUEUE[contactId] = { sentences: [], isProcessing: false };
    window.AI_BUBBLE_QUEUE[contactId].sentences.push(...sentences);
    if (!window.AI_BUBBLE_QUEUE[contactId].isProcessing) processGlobalBubbleQueue(contactId);
}

async function processGlobalBubbleQueue(contactId) {
    window.AI_BUBBLE_QUEUE[contactId].isProcessing = true;
    while (window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
        const sentence = window.AI_BUBBLE_QUEUE[contactId].sentences.shift();
        addMessage(contactId, 'assistant', sentence); updateChatListLastMessage(contactId, sentence);
        if (typeof sendPushNotification === 'function') sendPushNotification(sentence);
        const isCurrentPage = document.getElementById('scene-chat') && document.getElementById('scene-chat').classList.contains('show') && currentChatContactId === contactId;
        if (isCurrentPage) {
            const container = document.getElementById('chat-messages-container');
            const typingBubble = document.getElementById('active-stream-container'); if (typingBubble) typingBubble.remove();
            container.appendChild(createChatBubble('ai', sentence));
            if (window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0) {
                const sc = document.createElement('div'); sc.id = 'active-stream-container'; sc.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;';
                sc.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()"></div></div>`;
                container.appendChild(sc);
            }
            scrollToBottom();
        }
    }
    window.AI_BUBBLE_QUEUE[contactId].isProcessing = false;
    const contactObj = mockContacts.find(c => c.id === contactId);
    if (contactObj && typeof simulateMemorySummary === 'function') simulateMemorySummary(contactObj).catch(e => console.error(e));
}

function handleFinalAIResponse(contactId, finalFullMessage) {
    if (!finalFullMessage || finalFullMessage.trim() === '') finalFullMessage = '（AI 未返回任何内容）';
    if (typeof applyRegexRules === 'function') finalFullMessage = applyRegexRules(finalFullMessage);
    const sc = document.getElementById('active-stream-container'); if (sc) sc.remove();
    startGlobalBubbleQueue(contactId, finalFullMessage);
    if (document.getElementById('scene-chat')?.classList.contains('show') && currentChatContactId === contactId) {
        const container = document.getElementById('chat-messages-container');
        if (!document.getElementById('active-stream-container')) {
            const streamC = document.createElement('div'); streamC.id = 'active-stream-container'; streamC.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;';
            streamC.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()"></div></div>`;
            container.appendChild(streamC); scrollToBottom();
        }
    }
}

function createChatBubble(role, content) {
    const div = document.createElement('div'); div.className = `chat-message ${role === 'user' ? 'user' : 'ai'}`;
    if (role === 'ai') {
        div.innerHTML = `${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble">${content}</div><div class="regenerate-btn" onclick="regenerateMessage(event, this)"><i class="fas fa-rotate-right"></i></div>`;
        div.querySelector('.chat-bubble').addEventListener('click', (e) => { e.stopPropagation(); toggleRegenerate(div); });
    } else {
        div.innerHTML = `${generateAvatarHtml(true)}<div class="chat-bubble">${escapeHtml(content)}</div>`;
    }
    return div;
}

function abortCurrentAiReply() {
    if (window.currentChatController) { window.currentChatController.abort(); window.currentChatController = null; }
    if (backgroundAIReply.inProgress) {
        const finalMsg = backgroundAIReply.fullMessage ? backgroundAIReply.fullMessage + '...' : '（已中断生成）';
        backgroundAIReply.inProgress = false;
        const targetId = backgroundAIReply.contactId || currentChatContactId;
        backgroundAIReply.contactId = null;
        handleFinalAIResponse(targetId, finalMsg);
    }
}

async function sendChatMessage(skipAddUser = false) {
    let message = skipAddUser ? window._regenerateTempMsg : document.getElementById('chat-message-input').value.trim();
    if (!message) return;
    if (window.currentChatController) window.currentChatController.abort();
    window.currentChatController = new AbortController();
    backgroundAIReply = { inProgress: true, contactId: currentChatContactId, fullMessage: '', lastUpdate: 0 };
    
    if (!CHAT_API_CONFIGS.currentId) { alert('请先在"我"→"API配置"中选择一个配置'); backgroundAIReply.inProgress = false; return; }
    const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
    if (!config || !config.url || !config.key) { alert('当前配置不存在或不完整，请检查API设置'); backgroundAIReply.inProgress = false; return; }
    
    if (!skipAddUser) {
        const input = document.getElementById('chat-message-input'); input.value = ''; input.style.height = '40px';
        if (chatExtensionsPanelOpen) toggleChatExtensions();
        addChatMessageToUI('user', message); addMessage(currentChatContactId, 'user', message);
        const contact = mockContacts.find(c => c.id === currentChatContactId);
        if (contact) { contact.lastMsg = message.substring(0, 50); contact.time = new Date().toISOString(); }
    }
    
    const container = document.getElementById('chat-messages-container');
    const welcome = container.querySelector('div[style*="text-align: center"]'); if (welcome) welcome.remove();
    const streamContainer = document.createElement('div'); streamContainer.id = 'active-stream-container'; streamContainer.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;opacity:0;transform:translateY(20px);';
    streamContainer.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()"></div></div>`;
    container.appendChild(streamContainer);
    requestAnimationFrame(() => { streamContainer.style.transition = 'all 0.4s'; streamContainer.style.opacity = '1'; streamContainer.style.transform = 'translateY(0)'; });
    scrollToBottom();

    const contact = mockContacts.find(c => c.id === currentChatContactId);
    const systemPrompt = getSystemPromptWithMode(contact);
    const conversation = getConversation(currentChatContactId);
    const messages = [];
    let injectedMemoryText = "";
    try {
        const ragResponse = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'query_memory', text: message }) });
        const ragData = await ragResponse.json();
        if (ragData.matches && ragData.matches.length > 0) {
            const relevantMemories = ragData.matches.filter(m => m.score > 0.3).map(m => m.metadata.text);
            if (relevantMemories.length > 0) injectedMemoryText = "\n\n【系统提示：潜意识唤醒的深度记忆】\n" + relevantMemories.map(text => `· ${text}`).join('\n');
        }
    } catch (e) {}
    
    let finalUserPrompt = (systemPrompt || "") + (injectedMemoryText || "");
    const roundLimit = (typeof GENERAL_CONFIG !== 'undefined' && GENERAL_CONFIG.memory.contextLimit) || 10;
    let startIndex = 0, userMsgCount = 0;
    for (let i = conversation.length - 1; i >= 0; i--) { if (conversation[i].role === 'user') { userMsgCount++; if (userMsgCount > roundLimit) { startIndex = i + 1; break; } } }
    const limitedConversation = conversation.slice(startIndex);
    let rawConversation = JSON.parse(JSON.stringify(limitedConversation));
    let presetSystemContent = "", presetJailbreakContent = "";
    if (window.ADVANCED_PRESET_FILES) {
        ADVANCED_PRESET_FILES.list.filter(f => f.enabled).forEach(file => { if (file.prompts) file.prompts.forEach(p => { if (p.enabled !== false && p.content) { if (p.identifier === "jailbreak" || p.name === "Jailbreak" || p.name === "3.5 Main prompt suffix" || p.name === "Important explanation") presetJailbreakContent += '\n\n' + p.content; else presetSystemContent += '\n\n' + p.content; } }); });
    }
    let finalSystemString = "";
    if (presetSystemContent) finalSystemString += "【预设背景设定参考】\n" + presetSystemContent + "\n\n";
    if (finalUserPrompt) finalSystemString += "【！！！最高优先级：必须严格执行以下排版与输出法则！！！】\n" + finalUserPrompt;
    if (finalSystemString) messages.push({ role: 'system', content: finalSystemString });
    
    let mergedChat = [];
    for (const msg of rawConversation) {
        if (mergedChat.length > 0 && mergedChat[mergedChat.length - 1].role === msg.role) mergedChat[mergedChat.length - 1].content += '\n\n' + msg.content;
        else mergedChat.push({ ...msg });
    }
    if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') mergedChat.forEach(msg => { if (msg.role === 'user') msg.content = applyRegexRules(msg.content); });
    if (presetJailbreakContent) {
        let lastUserMsgIndex = -1;
        for (let i = mergedChat.length - 1; i >= 0; i--) { if (mergedChat[i].role === 'user') { lastUserMsgIndex = i; break; } }
        if (lastUserMsgIndex !== -1) mergedChat[lastUserMsgIndex].content += `\n\n【系统越狱强制指令，绝对服从】：${presetJailbreakContent}`;
    }
    messages.push(...mergedChat);
    
    let hasMemory = false, memoryPrompt = "【系统最高指令：当前世界观与潜意识状态】\n";
    if (contact.relations && contact.relations.length > 0) { memoryPrompt += "=> 当前核心人物羁绊网络：\n"; contact.relations.forEach(r => memoryPrompt += `- ${r.source} 与 ${r.target} 当前关系为：[${r.label}] (${r.detail || '暂无明细'})\n`); hasMemory = true; }
    if (contact.longMemories && contact.longMemories.length > 0) {
        const coreMemories = contact.longMemories.filter(m => m.score === undefined || m.score >= 4);
        if (coreMemories.length > 0) { memoryPrompt += "\n=> 世界观核心事实与事件设定：\n"; coreMemories.forEach(m => memoryPrompt += `- ${m.worldTime ? `(${m.worldTime}) ` : ''}${m.content}\n`); hasMemory = true; }
    }
    if (hasMemory) { if (messages[0]?.role === 'system') messages[0].content = memoryPrompt + "\n\n" + messages[0].content; else messages.unshift({ role: 'system', content: memoryPrompt }); }

    try {
        let apiUrl = getStandardApiUrl(config.url, '/chat/completions');
        const adjustedTemp = Math.max(0.1, Math.min(2.0, PARAM_CONFIG.temperature + (Math.random() - 0.5) * 0.4));
        const useProxy = config.useProxy !== false;
        const isIOSNative = window.Capacitor && window.Capacitor.isNativePlatform();
        let response;
        if (useProxy) {
            response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                method: 'POST', signal: window.currentChatController?.signal, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customEndpoint: apiUrl, customApiKey: config.key, model: config.model || 'gpt-3.5-turbo', messages, stream: PARAM_CONFIG.stream, temperature: adjustedTemp, max_tokens: PARAM_CONFIG.maxTokens, frequency_penalty: PARAM_CONFIG.frequencyPenalty, presence_penalty: PARAM_CONFIG.presencePenalty, tool_choice: "none" })
            });
        } else {
            const directUrl = getStandardApiUrl(config.url, '/chat/completions');
            if (isIOSNative) {
                const nativeResponse = await window.Capacitor.Plugins.CapacitorHttp.post({ url: directUrl, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` }, data: { model: config.model || 'gpt-3.5-turbo', messages, stream: PARAM_CONFIG.stream, temperature: adjustedTemp, max_tokens: PARAM_CONFIG.maxTokens, frequency_penalty: PARAM_CONFIG.frequencyPenalty, presence_penalty: PARAM_CONFIG.presencePenalty, tool_choice: "none" } });
                response = { ok: nativeResponse.status >= 200 && nativeResponse.status < 300, status: nativeResponse.status, text: async () => JSON.stringify(nativeResponse.data), json: async () => nativeResponse.data };
                if (PARAM_CONFIG.stream) {
                    response.body = { getReader: () => { let done = false; return { read: async () => { if (done) return { done: true }; done = true; const content = nativeResponse.data.choices?.[0]?.message?.content || "（无内容）"; return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({choices: [{delta: {content: content}}]})}\n\ndata: [DONE]\n`) }; } }; } };
                }
            } else {
                response = await fetch(directUrl, { method: 'POST', signal: window.currentChatController.signal, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` }, body: JSON.stringify({ model: config.model || 'gpt-3.5-turbo', messages, stream: PARAM_CONFIG.stream, temperature: adjustedTemp, max_tokens: PARAM_CONFIG.maxTokens, frequency_penalty: PARAM_CONFIG.frequencyPenalty, presence_penalty: PARAM_CONFIG.presencePenalty, tool_choice: "none" }) });
            }
        }
        if (!response.ok) throw new Error(`API请求失败 (${response.status})`);
        
        if (PARAM_CONFIG.stream) {
            const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8");
            let buffer = "", fullMessage = "", pending = "", hasAnyContent = false;
            let sentenceQueue = [], isProcessingQueue = false;
            const processQueue = async () => {
                if (isProcessingQueue) return; isProcessingQueue = true;
                while (sentenceQueue.length > 0) {
                    const sentence = sentenceQueue.shift();
                    addMessage(currentChatContactId, 'assistant', sentence); updateChatListLastMessage(currentChatContactId, sentence);
                    const isVisible = document.getElementById('scene-chat')?.classList.contains('show');
                    if (isVisible) {
                        const oldStream = document.getElementById('active-stream-container'); if (oldStream) oldStream.remove();
                        container.appendChild(createChatBubble('ai', sentence));
                        if (sentenceQueue.length > 0 || backgroundAIReply.inProgress) {
                            const newStream = document.createElement('div'); newStream.id = 'active-stream-container'; newStream.style.cssText = 'display:flex;flex-direction:column;gap:16px;width:100%;';
                            newStream.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()"></div></div>`;
                            container.appendChild(newStream);
                        }
                        scrollToBottom();
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));
                }
                const finalStream = document.getElementById('active-stream-container'); if (finalStream) finalStream.remove();
                isProcessingQueue = false;
            };
            const pushSentence = (sentence) => {
                if (!sentence.trim()) return;
                if (document.visibilityState === 'hidden') { addMessage(currentChatContactId, 'assistant', sentence); updateChatListLastMessage(currentChatContactId, sentence); if (typeof sendPushNotification === 'function') sendPushNotification(sentence); }
                else { sentenceQueue.push(sentence); if (!isProcessingQueue) processQueue(); }
            };
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || "";
                for (const line of lines) {
                    const trimmed = line.trim(); if (trimmed === "") continue;
                    let jsonStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed; if (jsonStr === '[DONE]') continue;
                    try {
                        const json = JSON.parse(jsonStr); let content = json.choices?.[0]?.delta?.content || '';
                        if (content) {
                            hasAnyContent = true; fullMessage += content; backgroundAIReply.fullMessage = fullMessage; backgroundAIReply.lastUpdate = Date.now();
                            pending += content; const segments = splitTextIntoSentences(pending);
                            if (segments.length > 1) { const complete = segments.slice(0, -1); const lastPart = segments[segments.length - 1]; for (const s of complete) pushSentence(s); pending = lastPart; }
                        }
                    } catch (e) {}
                }
            }
            if (pending.trim()) pushSentence(pending);
            backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
            if (!hasAnyContent) pushSentence('【流式响应未收到任何内容】');
            while (sentenceQueue.length > 0 || isProcessingQueue) await new Promise(resolve => setTimeout(resolve, 200));
            scrollToBottom();
        } else {
            const data = await response.json(); const aiContent = data.choices?.[0]?.message?.content || data.result || '（空消息）';
            backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
            handleFinalAIResponse(currentChatContactId, aiContent);
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
        const streamCont = document.getElementById('active-stream-container'); if (streamCont) streamCont.remove();
        const errorMsg = '⚠️ 发送失败：' + error.message;
        container.appendChild(createChatBubble('ai', errorMsg)); addMessage(currentChatContactId, 'assistant', errorMsg); updateChatListLastMessage(currentChatContactId, errorMsg); scrollToBottom();
    }
}

// ========== 输入与自动高度 ==========
document.addEventListener('DOMContentLoaded', function() {
    const input = document.getElementById('chat-message-input');
    if (input) {
        input.addEventListener('keypress', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
        input.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; });
    }
});

document.addEventListener('click', function(e) {
    if (!chatExtensionsPanelOpen) return;
    const panel = document.getElementById('chat-extensions-panel'); if (!panel) return;
    if (e.target.closest('.chat-plus-btn') || panel.contains(e.target)) return;
    toggleChatExtensions();
});

function addChatMessageToUI(role, content) {
    const container = document.getElementById('chat-messages-container'); if (!container) return;
    const welcome = container.querySelector('div[style*="text-align: center"]'); if (welcome) welcome.remove();
    const isUser = role === 'user';
    const messageDiv = document.createElement('div'); messageDiv.className = `chat-message ${isUser ? 'user' : 'ai'}`;
    const avatarHtml = generateAvatarHtml(isUser, currentChatContactId);
    messageDiv.innerHTML = `${avatarHtml}<div class="chat-bubble">${escapeHtml(content)}</div>`;
    container.appendChild(messageDiv); scrollToBottom();
}

function chatExtAction(action) {
    const actionNames = { 'transfer': '转账', 'location': '位置', 'album': '相册', 'camera': '拍摄', 'voice': '语音', 'file': '文件', 'card': '名片', 'video': '视频' };
    alert(`${actionNames[action] || action}功能开发中...`); toggleChatExtensions();
}

let currentRegenerateBtn = null;
function toggleRegenerate(messageEl) {
    const btn = messageEl.querySelector('.regenerate-btn');
    if (!btn) return;
    document.querySelectorAll('.regenerate-btn').forEach(b => { if (b !== btn) b.classList.remove('show'); });
    if (btn.classList.contains('show')) { btn.classList.remove('show'); currentRegenerateBtn = null; }
    else {
        requestAnimationFrame(() => { requestAnimationFrame(() => { requestAnimationFrame(() => {
            const bubbleRect = messageEl.querySelector('.chat-bubble').getBoundingClientRect();
            btn.style.transition = 'none'; btn.style.top = bubbleRect.top + bubbleRect.height / 2 + 'px'; btn.offsetHeight;
            requestAnimationFrame(() => { btn.style.transition = ''; btn.classList.add('show'); });
            currentRegenerateBtn = btn;
        }); }); });
    }
}

function regenerateMessage(event, btn) {
    event.stopPropagation(); if (!currentChatContactId) return;
    btn.classList.remove('show'); currentRegenerateBtn = null;
    regenerateResponse(currentChatContactId, null, null, (error) => { console.error('重新生成失败:', error); });
}

document.addEventListener('click', (e) => {
    const isAiMessage = e.target.closest('.chat-message.ai'); const isRegenerateBtn = e.target.closest('.regenerate-btn');
    if (!isAiMessage && !isRegenerateBtn) { document.querySelectorAll('.regenerate-btn').forEach(btn => btn.classList.remove('show')); currentRegenerateBtn = null; }
});

let lastRegenerateScrollTop = 0;
const chatMessagesContainer = document.getElementById('chat-messages-container');
if (chatMessagesContainer) {
    chatMessagesContainer.addEventListener('scroll', () => {
        if (Math.abs(chatMessagesContainer.scrollTop - lastRegenerateScrollTop) > 30) { document.querySelectorAll('.regenerate-btn').forEach(btn => btn.classList.remove('show')); currentRegenerateBtn = null; }
        lastRegenerateScrollTop = chatMessagesContainer.scrollTop;
    }, { passive: true });
}

let regenerateTouchStartX = 0, regenerateTouchStartY = 0;
document.addEventListener('touchstart', (e) => { regenerateTouchStartX = e.touches[0].clientX; regenerateTouchStartY = e.touches[0].clientY; });
document.addEventListener('touchmove', (e) => {
    if (Math.abs(e.touches[0].clientX - regenerateTouchStartX) > 20 || Math.abs(e.touches[0].clientY - regenerateTouchStartY) > 20) {
        document.querySelectorAll('.regenerate-btn').forEach(btn => btn.classList.remove('show')); currentRegenerateBtn = null;
    }
});

window.chatScrollAnimationId = null;
window.userScrolledUp = false;
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('chat-messages-container');
    if (container) {
        container.addEventListener('scroll', () => {
            if (container.scrollHeight - container.scrollTop - container.clientHeight > 40) window.userScrolledUp = true;
            else window.userScrolledUp = false;
            if (container.scrollTop <= 5) {
                if (!currentChatContactId) return;
                const fullConv = getConversation(currentChatContactId); if (!window.chatMessageLoadCount) window.chatMessageLoadCount = 50;
                if (window.chatMessageLoadCount < fullConv.length) { window.chatMessageLoadCount += 50; renderChatMessages(currentChatContactId, true); }
            }
        }, { passive: true });
    }
});

function scrollToBottom(force = false) {
    const container = document.getElementById('chat-messages-container'); if (!container || (window.userScrolledUp && !force)) return;
    const start = container.scrollTop, target = container.scrollHeight - container.clientHeight, distance = target - start;
    if (Math.abs(distance) < 5) { container.scrollTop = target; return; }
    if (window.chatScrollAnimationId) cancelAnimationFrame(window.chatScrollAnimationId);
    let startTime = null;
    function animation(currentTime) {
        if (!startTime) startTime = currentTime; const timeElapsed = currentTime - startTime; let progress = timeElapsed / 350;
        if (progress > 1) progress = 1; const ease = 1 - Math.pow(1 - progress, 3);
        container.scrollTop = start + (distance * ease);
        if (timeElapsed < 350) window.chatScrollAnimationId = requestAnimationFrame(animation);
        else { container.scrollTop = target; window.chatScrollAnimationId = null; }
    }
    window.chatScrollAnimationId = requestAnimationFrame(animation);
}

function scrollToBottomInstant(force = false) {
    const container = document.getElementById('chat-messages-container'); if (!container || (window.userScrolledUp && !force)) return;
    container.scrollTop = container.scrollHeight; setTimeout(() => { if (!window.userScrolledUp || force) container.scrollTop = container.scrollHeight; }, 10);
}

// ========== Token 预算计算器 ==========
let budgetTiktokenEncoder = null;
async function initTiktokenEncoder() { if (!budgetTiktokenEncoder) budgetTiktokenEncoder = {}; return budgetTiktokenEncoder; }
function calculateAvgOutputTokens() {
    if (!currentChatContactId) return null; const conversation = getConversation(currentChatContactId); if (conversation.length === 0) return null;
    const rounds = []; let currentAiMessages = [];
    conversation.forEach(msg => { if (msg.role === 'assistant') currentAiMessages.push(msg); if (msg.role === 'user' && currentAiMessages.length > 0) { rounds.push([...currentAiMessages]); currentAiMessages = []; } });
    if (currentAiMessages.length > 0) rounds.push(currentAiMessages); if (rounds.length === 0) return null;
    const roundTokens = rounds.map(messages => { let total = 0; messages.forEach(m => { total += encodeTiktoken(m.content); }); return total; });
    const avg = Math.round(roundTokens.reduce((a, b) => a + b, 0) / roundTokens.length); return avg > 0 ? avg : null;
}

async function openTokenBudget() {
    toggleChatExtensions(); const modal = document.getElementById('token-budget-modal');
    const savedPrices = JSON.parse(localStorage.getItem('LINQGO_TOKEN_PRICES') || '{"input":2.00,"output":5.00}');
    document.getElementById('budget-input-price').value = savedPrices.input; document.getElementById('budget-output-price').value = savedPrices.output;
    document.getElementById('budget-output-tokens').value = calculateAvgOutputTokens() || PARAM_CONFIG.maxTokens || 2048;
    document.getElementById('budget-input-tokens').value = await calculateInputTokens();
    calculateBudgetCosts(); modal.style.display = ''; requestAnimationFrame(() => modal.classList.add('show'));
}

function closeTokenBudget(event) { if (event && event.target !== document.getElementById('token-budget-modal')) return; document.getElementById('token-budget-modal').classList.remove('show'); }

async function calculateInputTokens() {
    if (!currentChatContactId) return 0;
    if (typeof GPTTokenizer_cl100k_base === 'undefined') {
        const contact = mockContacts.find(c => c.id === currentChatContactId), fullConv = getConversation(currentChatContactId), roundLimit = (typeof GENERAL_CONFIG !== 'undefined' && GENERAL_CONFIG.memory.contextLimit) || 10;
        let startIndex = 0, userMsgCount = 0; for (let i = fullConv.length - 1; i >= 0; i--) { if (fullConv[i].role === 'user') { userMsgCount++; if (userMsgCount > roundLimit) { startIndex = i + 1; break; } } }
        return countTokens(fullConv.slice(startIndex));
    }
    const contact = mockContacts.find(c => c.id === currentChatContactId), conversation = getConversation(currentChatContactId), messages = [];
    let systemPrompt = getSystemPromptWithMode(contact), userMessage = document.getElementById('chat-message-input')?.value.trim() || '';
    let injectedMemoryText = "";
    if (userMessage && contact.longMemories && contact.longMemories.length > 0) {
        const queryKeywords = extractKeywords(userMessage);
        const coreMemories = contact.longMemories.filter(m => (m.score || 0) >= 5);
        const contextualMemories = contact.longMemories.filter(m => { if ((m.score || 0) >= 5) return false; if (!m.keywords) return false; const keywords = Array.isArray(m.keywords) ? m.keywords : [m.keywords]; return keywords.some(kw => userMessage.includes(kw)) || m.content.includes(userMessage); });
        const relevantMemories = [...coreMemories, ...contextualMemories.slice(0, 5)];
        if (relevantMemories.length > 0) injectedMemoryText = "\n\n【系统提示：与当前对话相关的历史档案】\n" + relevantMemories.map(m => `[${m.category || '记录'}] ${m.content}`).join('\n');
    }
    let finalUserPrompt = (systemPrompt || "") + (injectedMemoryText || "");
    let finalSystemString = "";
    if (window.ADVANCED_PRESET_FILES) { ADVANCED_PRESET_FILES.list.filter(f => f.enabled).forEach(file => { if (file.prompts) file.prompts.forEach(p => { if (p.enabled !== false && p.content && p.identifier !== "jailbreak") finalSystemString += "\n\n" + p.content; }); }); }
    finalSystemString += "\n\n" + finalUserPrompt; if (finalSystemString.trim()) messages.push({ role: 'system', content: finalSystemString });
    const roundLimit = (typeof GENERAL_CONFIG !== 'undefined' && GENERAL_CONFIG.memory.contextLimit) || 10; let startIndex = 0, userMsgCount = 0;
    for (let i = conversation.length - 1; i >= 0; i--) { if (conversation[i].role === 'user') { userMsgCount++; if (userMsgCount > roundLimit) { startIndex = i + 1; break; } } }
    let merged = []; for (const msg of conversation.slice(startIndex)) { if (merged.length > 0 && merged[merged.length - 1].role === msg.role) merged[merged.length - 1].content += '\n\n' + msg.content; else merged.push({ role: msg.role, content: msg.content }); }
    if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') merged.forEach(msg => { if (msg.role === 'user') msg.content = applyRegexRules(msg.content); });
    messages.push(...merged);
    if (userMessage) { let finalUserMsg = userMessage; if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') finalUserMsg = applyRegexRules(finalUserMsg); messages.push({ role: 'user', content: finalUserMsg }); }
    try { const { encode } = GPTTokenizer_cl100k_base; let totalTokens = 0; for (const msg of messages) { totalTokens += 4; totalTokens += encode(msg.content).length; } return totalTokens + 2; }
    catch (e) { return countTokens(messages); }
}

function calculateBudgetCosts() {
    const inputTokens = parseFloat(document.getElementById('budget-input-tokens').value) || 0, outputTokens = parseFloat(document.getElementById('budget-output-tokens').value) || 0;
    const inputPrice = parseFloat(document.getElementById('budget-input-price').value) || 2.00, outputPrice = parseFloat(document.getElementById('budget-output-price').value) || 5.00;
    const inputCost = (inputTokens / 1000000) * inputPrice, outputCost = (outputTokens / 1000000) * outputPrice;
    document.getElementById('budget-input-cost').textContent = '$' + inputCost.toFixed(4); document.getElementById('budget-output-cost').textContent = '$' + outputCost.toFixed(4); document.getElementById('budget-total-cost').textContent = '$' + (inputCost + outputCost).toFixed(6);
    localStorage.setItem('LINQGO_TOKEN_PRICES', JSON.stringify({ input: inputPrice, output: outputPrice }));
}

// ========== 任务编辑 (从底层拉过来) ==========
let activeTodoId = null;
function deleteCurrentTodo() { if (!activeTodoId) return; todoList = todoList.filter(t => t.id !== activeTodoId); saveTodoData(); renderTodoList(); closeTodoSheet(); }
function editCurrentTodo() {
    if (!activeTodoId) return; const task = todoList.find(t => t.id === activeTodoId); if (!task) return;
    const titleInput = document.getElementById('todo-input-title'); titleInput.value = task.title; titleInput.style.height = 'auto'; titleInput.style.height = titleInput.scrollHeight + 'px';
    document.getElementById('todo-date-picker').value = task.ddl_date || ''; document.getElementById('todo-time-picker').value = task.ddl_time || ''; updateTodoDDL();
    todoSelectedTags.clear(); task.tags.forEach(tag => { if (!todoTagPool.includes(tag)) todoTagPool.push(tag); todoSelectedTags.add(tag); });
    window.originalTagPool = [...todoTagPool]; window.originalSelectedTags = new Set(todoSelectedTags);
    renderTodoTags(); document.getElementById('todo-subtasks-container').innerHTML = ''; if (task.subTasks) task.subTasks.forEach(st => addTodoSubtaskRow(st.title, st.completed, false));
    document.getElementById('todo-bottom-sheet').dataset.editingId = task.id;
    const topDelete = document.getElementById('todo-sheet-top-delete'); if (topDelete) topDelete.style.visibility = 'visible';
    setTimeout(() => { document.getElementById('todo-sheet-overlay').classList.add('active'); document.getElementById('todo-bottom-sheet').classList.add('active'); }, 10);
}
