// ========== 联系人管理 ==========
const mockContacts = [
    { id: 1, name: '心理导师', avatar: '', lastMsg: '今天感觉怎么样？', time: '14:20', color: '#FF9F0A', prompt: '你是一位专业的心理导师。', longMemories: [] },
    { id: 2, name: '英语陪练', avatar: '', lastMsg: 'Practice your pronunciation!', time: '昨天', color: '#30D158', prompt: '你是一位只说英语的陪练。', longMemories: [] }
];

function renderChatList() {
    const container = document.getElementById('chat-list-container'); if (!container) return;
    container.innerHTML = ''; if (mockContacts.length === 0) { container.innerHTML = '<div style="text-align:center; padding:50px; color:#ccc;">暂无消息</div>'; return; }
    mockContacts.forEach((contact, index) => {
        const wrapper = document.createElement('div'); wrapper.className = 'chat-item-wrapper';
        wrapper.innerHTML = `<div class="chat-item-actions"><div class="chat-action-btn chat-action-edit" onclick="event.stopPropagation(); editChatRole(${index});">编辑</div><div class="chat-action-btn chat-action-delete" onclick="event.stopPropagation(); deleteChatRole(${index});">删除</div></div>`;
        const item = document.createElement('div'); item.className = 'chat-item';
        item.onclick = (e) => { if (item.dataset.ignoreClick === 'true') { item.dataset.ignoreClick = 'false'; return; } openChatWindow(contact.id); };
        const avatarHtml = contact.avatar ? `<img src="${contact.avatar}">` : `<div style="background:${contact.color||'#ccc'}; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">${contact.name[0]}</div>`;
        item.innerHTML = `<div class="chat-item-avatar">${avatarHtml}</div><div class="chat-item-content"><div class="chat-item-name">${contact.name}</div><div class="chat-item-preview">${contact.lastMsg}</div></div><div class="chat-item-meta"><div class="chat-item-time">${formatMessageTime(contact.time)}</div></div>`;
        if (typeof addChatSwipeHandler === 'function') addChatSwipeHandler(item);
        wrapper.appendChild(item); container.appendChild(wrapper);
    });
}
function updateChatListLastMessage(contactId, message) {
    const contact = mockContacts.find(c => c.id === contactId);
    if (contact) {
        contact.lastMsg = message ? message.substring(0, 50) : ''; contact.time = message ? new Date().toISOString() : '';
        if (message) { const idx = mockContacts.findIndex(c => c.id === contactId); if (idx > 0) { const [m] = mockContacts.splice(idx, 1); mockContacts.unshift(m); } }
        saveToLocal(); renderChatList();
    }
}

// ========== 聊天界面 ==========
let currentChatContactId = null, chatExtensionsPanelOpen = false;
let backgroundAIReply = { inProgress: false, contactId: null, fullMessage: '', lastUpdate: 0 };

function openChatWindow(contactId) {
    const contact = mockContacts.find(c => c.id === contactId); if (!contact) return;
    currentChatContactId = contactId; window.chatMessageLoadCount = 50;
    document.getElementById('chat-title').textContent = contact.name;
    renderChatMessages(contactId); showChatWindow();
    document.getElementById('chat-message-input').value = ''; chatExtensionsPanelOpen = false;
    document.getElementById('chat-extensions-panel').classList.remove('show');
}

function renderChatMessages(contactId, isLoadingMore = false) {
    const container = document.getElementById('chat-messages-container'); if (!container) return;
    const oldHeight = container.scrollHeight; container.innerHTML = '';
    const fullConv = getConversation(contactId); const conversation = fullConv.slice(-window.chatMessageLoadCount);
    if (window.chatMessageLoadCount < fullConv.length) { container.innerHTML = '<div style="text-align:center; padding:10px; color:var(--text-sub); font-size:12px;"><i class="fas fa-spinner"></i> 向上滑动加载更多...</div>'; }
    if (conversation.length === 0) { container.innerHTML = '<div style="text-align:center; padding:60px 20px; color:var(--text-sub);">开始对话</div>'; return; }
    scrollToBottomInstant();
    let i = 0, lastMsgTime = 0;
    while (i < conversation.length) {
        const msg = conversation[i]; const msgTime = msg.timestamp;
        if (msgTime && msgTime - lastMsgTime > 300000) {
            const d = new Date(msgTime); const p = n => n.toString().padStart(2,'0');
            const shortT = `${p(d.getHours())}:${p(d.getMinutes())}`;
            const timeDiv = document.createElement('div'); timeDiv.className = 'chat-timestamp'; timeDiv.innerText = shortT;
            timeDiv.onclick = function() { this.textContent = this.textContent === shortT ? `${d.getMonth()+1}月${d.getDate()}日 ${shortT}` : shortT; };
            container.appendChild(timeDiv); lastMsgTime = msgTime; container.setAttribute('data-last-time', msgTime);
        } else if (msgTime) { lastMsgTime = msgTime; container.setAttribute('data-last-time', msgTime); }
        
        if (msg.role === 'user') {
            const div = document.createElement('div'); div.className = 'chat-message user';
            let display = msg.content.startsWith('【论坛分享】') ? `<div class="chat-forward-card"><div class="chat-forward-header">论坛热门帖子</div><div class="chat-forward-title">${msg.content.match(/标题：(.*?)(?=\n|$)/)?.[1] || '分享'}</div><div class="chat-forward-content">${msg.content.match(/内容：(.*?)(?=\n|$)/)?.[1] || ''}</div></div>` : (typeof applyRegexRules === 'function' && REGEX_RULES.enabled ? applyRegexRules(msg.content) : escapeHtml(msg.content));
            div.innerHTML = `${generateAvatarHtml(true)}<div class="chat-bubble">${display}</div>`; container.appendChild(div); i++;
        } else {
            const aiMsgs = []; while (i < conversation.length && (conversation[i].role === 'assistant' || conversation[i].role === 'ai')) { aiMsgs.push(conversation[i]); i++; }
            aiMsgs.forEach(aiMsg => {
                const div = document.createElement('div'); div.className = 'chat-message ai';
                let display = typeof applyRegexRules === 'function' && REGEX_RULES.enabled ? applyRegexRules(aiMsg.content) : escapeHtml(aiMsg.content);
                div.innerHTML = `${generateAvatarHtml(false, contactId)}<div class="chat-bubble" onclick="toggleRegenerate(this.closest('.chat-message'))">${display || '（空）'}</div><div class="regenerate-btn" onclick="regenerateMessage(event, this)"><i class="fas fa-rotate-right"></i></div>`;
                container.appendChild(div);
            });
        }
    }
    const isQueue = window.AI_BUBBLE_QUEUE?.[contactId]?.sentences.length > 0;
    if (isQueue || (backgroundAIReply.inProgress && backgroundAIReply.contactId === contactId)) {
        const sc = document.createElement('div'); sc.id = 'active-stream-container'; sc.style.cssText = 'display:flex; flex-direction:column; gap:16px; width:100%;';
        sc.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble"></div></div>`;
        container.appendChild(sc);
    }
    if (isLoadingMore) container.scrollTop = container.scrollHeight - oldHeight; else scrollToBottomInstant(true);
}

function generateAvatarHtml(isUser, contactId = null) {
    if (typeof AVATAR_CONFIG === 'undefined') return '';
    if (isUser) return AVATAR_CONFIG.user ? `<div class="chat-avatar"><img src="${AVATAR_CONFIG.user}"></div>` : `<div class="chat-avatar"><i class="fas fa-user"></i></div>`;
    const c = mockContacts.find(x => x.id === (contactId || currentChatContactId));
    if (c?.avatar) return `<div class="chat-avatar"><img src="${c.avatar}"></div>`;
    if (AVATAR_CONFIG.ai) return `<div class="chat-avatar"><img src="${AVATAR_CONFIG.ai}"></div>`;
    return `<div class="chat-avatar"><i class="fas fa-robot"></i></div>`;
}

// ========== 发送消息与流式处理 ==========
async function sendChatMessage(skipAddUser = false) {
    let message = skipAddUser ? window._regenerateTempMsg : document.getElementById('chat-message-input').value.trim();
    if (!message) return;
    if (window.currentChatController) window.currentChatController.abort();
    window.currentChatController = new AbortController();
    backgroundAIReply = { inProgress: true, contactId: currentChatContactId, fullMessage: '', lastUpdate: 0 };
    
    if (!CHAT_API_CONFIGS.currentId) { alert('请先配置API'); backgroundAIReply.inProgress = false; return; }
    const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
    
    if (!skipAddUser) {
        document.getElementById('chat-message-input').value = ''; document.getElementById('chat-message-input').style.height = '40px';
        if (chatExtensionsPanelOpen) toggleChatExtensions();
        addChatMessageToUI('user', message); addMessage(currentChatContactId, 'user', message);
        updateChatListLastMessage(currentChatContactId, message);
    }
    
    const container = document.getElementById('chat-messages-container'); const welcome = container.querySelector('div[style*="text-align: center"]'); if (welcome) welcome.remove();
    const streamC = document.createElement('div'); streamC.id = 'active-stream-container'; streamC.style.cssText = 'display:flex; flex-direction:column; gap:16px; width:100%; opacity:0; transform:translateY(20px);';
    streamC.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()"></div></div>`;
    container.appendChild(streamC);
    requestAnimationFrame(() => { streamC.style.transition = 'all 0.4s'; streamC.style.opacity = '1'; streamC.style.transform = 'translateY(0)'; });
    scrollToBottom();

    const contact = mockContacts.find(c => c.id === currentChatContactId);
    const messages = [];
    let sysStr = typeof getSystemPromptWithMode === 'function' ? getSystemPromptWithMode(contact) : '';
    if (sysStr) messages.push({ role: 'system', content: sysStr });
    const conv = getConversation(currentChatContactId); const roundLimit = GENERAL_CONFIG.memory.contextLimit || 10;
    let start = 0, cnt = 0; for (let i = conv.length - 1; i >= 0; i--) { if (conv[i].role === 'user') { cnt++; if (cnt > roundLimit) { start = i + 1; break; } } }
    messages.push(...JSON.parse(JSON.stringify(conv.slice(start))));

    try {
        let apiUrl = getStandardApiUrl(config.url, '/chat/completions');
        const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
            method: 'POST', signal: window.currentChatController?.signal, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customEndpoint: apiUrl, customApiKey: config.key, model: config.model, messages, stream: PARAM_CONFIG.stream, temperature: PARAM_CONFIG.temperature, max_tokens: PARAM_CONFIG.maxTokens })
        });
        if (!response.ok) throw new Error(`API Error ${response.status}`);
        
        if (PARAM_CONFIG.stream) {
            const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', fullMsg = '', pending = '';
            let queue = [], isProcessing = false;
            const processQueue = async () => {
                if (isProcessing) return; isProcessing = true;
                while (queue.length > 0) {
                    const s = queue.shift(); addMessage(currentChatContactId, 'assistant', s); updateChatListLastMessage(currentChatContactId, s);
                    if (document.getElementById('scene-chat')?.classList.contains('show')) {
                        const old = document.getElementById('active-stream-container'); if(old) old.remove();
                        const d = createChatBubble('ai', s); container.appendChild(d);
                        if (queue.length > 0 || backgroundAIReply.inProgress) {
                            const sc = document.createElement('div'); sc.id = 'active-stream-container'; sc.style.cssText = 'display:flex; flex-direction:column; gap:16px; width:100%;';
                            sc.innerHTML = `<div class="chat-message ai">${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble"></div></div>`; container.appendChild(sc);
                        }
                        scrollToBottom();
                    }
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
                }
                const finalSt = document.getElementById('active-stream-container'); if(finalSt) finalSt.remove(); isProcessing = false;
            };
            
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || "";
                for (const line of lines) {
                    const t = line.trim(); if (!t || t === '[DONE]') continue;
                    try {
                        const j = JSON.parse(t.startsWith('data:') ? t.slice(5).trim() : t); const c = j.choices?.[0]?.delta?.content || '';
                        if (c) {
                            fullMsg += c; backgroundAIReply.fullMessage = fullMsg; pending += c;
                            const segs = splitTextIntoSentences(pending);
                            if (segs.length > 1) { const cList = segs.slice(0, -1); const last = segs[segs.length-1]; cList.forEach(x => { queue.push(x); if(!isProcessing) processQueue(); }); pending = last; }
                        }
                    } catch(e) {}
                }
            }
            if (pending.trim()) { queue.push(pending); if (!isProcessing) processQueue(); }
            backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
            while (queue.length > 0 || isProcessing) await new Promise(r => setTimeout(r, 200));
            scrollToBottom();
        } else {
            const data = await response.json(); const aiContent = data.choices?.[0]?.message?.content || data.result || '（空消息）';
            backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
            if (typeof handleFinalAIResponse === 'function') handleFinalAIResponse(currentChatContactId, aiContent);
        }
    } catch (error) {
        if (error.name === 'AbortError') return;
        backgroundAIReply.inProgress = false; backgroundAIReply.contactId = null;
        const sc = document.getElementById('active-stream-container'); if(sc) sc.remove();
        const errMsg = '⚠️ 发送失败：' + error.message;
        container.appendChild(createChatBubble('ai', errMsg)); addMessage(currentChatContactId, 'assistant', errMsg);
        updateChatListLastMessage(currentChatContactId, errMsg); scrollToBottom();
    }
}

function splitTextIntoSentences(fullText) {
    if (!fullText) return [];
    let text = fullText.replace(/([!?！？])\1+/g, '$1').replace(/[\/／∕⧸⁄]/g, '');
    if (text.includes('\\') || text.includes('（') || text.includes('(')) { const s = typeof parseBubbles==='function'?parseBubbles(text):[]; if(s.length>0) return s; }
    if (text.includes('\n')) { const l = text.split('\n').filter(x=>x.trim()); if(l.length>1) return l; }
    if (/[。！？；]/.test(text)) return text.split(/(?<=[。！？；])/).map(x=>x.trim()).filter(Boolean);
    return [text];
}

function createChatBubble(role, content) {
    const div = document.createElement('div'); div.className = `chat-message ${role === 'user' ? 'user' : 'ai'}`;
    if (role === 'ai') {
        div.innerHTML = `${generateAvatarHtml(false, currentChatContactId)}<div class="chat-bubble">${content}</div><div class="regenerate-btn" onclick="regenerateMessage(event, this)"><i class="fas fa-rotate-right"></i></div>`;
    } else { div.innerHTML = `${generateAvatarHtml(true)}<div class="chat-bubble">${escapeHtml(content)}</div>`; }
    return div;
}

function addChatMessageToUI(role, content) {
    const c = document.getElementById('chat-messages-container'); if(!c) return;
    const w = c.querySelector('div[style*="text-align: center"]'); if(w) w.remove();
    c.appendChild(createChatBubble(role, escapeHtml(content))); scrollToBottom();
}

function toggleChatExtensions() {
    chatExtensionsPanelOpen = !chatExtensionsPanelOpen;
    const p = document.getElementById('chat-extensions-panel'); const c = document.getElementById('chat-messages-container');
    const wasBottom = c && c.scrollTop + c.clientHeight >= c.scrollHeight - 20;
    if (chatExtensionsPanelOpen) { p.classList.add('show'); if(wasBottom) { const t = Date.now(); const keep = () => { if(Date.now()-t<400) { c.scrollTop = c.scrollHeight; requestAnimationFrame(keep); } }; requestAnimationFrame(keep); } }
    else { p.classList.remove('show'); if(wasBottom) setTimeout(() => c.scrollTop = c.scrollHeight, 50); }
}

function formatMessageTime(timestamp) {
    if (!timestamp || timestamp === '刚刚') return '';
    const now = new Date(), msgTime = new Date(timestamp); if (isNaN(msgTime)) return '';
    const diffM = Math.floor((now - msgTime) / 60000);
    if (diffM < 1) return '刚刚'; if (diffM < 60) return `${diffM}分钟前`;
    if (now.toDateString() === msgTime.toDateString()) return `${msgTime.getHours().toString().padStart(2,'0')}:${msgTime.getMinutes().toString().padStart(2,'0')}`;
    const y = new Date(now); y.setDate(y.getDate()-1); if (y.toDateString() === msgTime.toDateString()) return '昨天';
    return `${msgTime.getMonth()+1}/${msgTime.getDate()}`;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
function scrollToBottom(force = false) {
    const c = document.getElementById('chat-messages-container'); if (!c || (window.userScrolledUp && !force)) return;
    const start = c.scrollTop, target = c.scrollHeight - c.clientHeight;
    if (Math.abs(target - start) < 5) { c.scrollTop = target; return; }
    if (window.chatScrollAnimationId) cancelAnimationFrame(window.chatScrollAnimationId);
    let sT = null;
    function anim(ct) {
        if (!sT) sT = ct; const p = Math.min((ct - sT) / 350, 1);
        c.scrollTop = start + (target - start) * (1 - Math.pow(1 - p, 3));
        if (ct - sT < 350) window.chatScrollAnimationId = requestAnimationFrame(anim);
        else { c.scrollTop = target; window.chatScrollAnimationId = null; }
    }
    window.chatScrollAnimationId = requestAnimationFrame(anim);
}
function scrollToBottomInstant(force = false) { const c = document.getElementById('chat-messages-container'); if(c && (!window.userScrolledUp || force)) c.scrollTop = c.scrollHeight; }
