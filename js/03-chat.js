// ==========================================
        // 第3批移植：聊天功能（纯逻辑）
        // ==========================================
        
        // --- 对话历史管理 ---
        function getConversation(contactId) {
            // 获取指定联系人的对话历史
            if (!APP_DATA.conversations[contactId]) {
                APP_DATA.conversations[contactId] = [];
            }
            return APP_DATA.conversations[contactId];
        }
        
        async function addMessage(contactId, role, content) {
            // 添加一条消息到对话历史
            const conversation = getConversation(contactId);
            conversation.push({ role, content, timestamp: Date.now() });
            
            // 🌟 互动视图：不仅记录天，还记录“小时”粒度的数据
            if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
            const d = new Date();
            const todayStr = d.toLocaleDateString('zh-CN').replace(/\//g, '-');
            const hourKey = todayStr + '_' + d.getHours();

            // 只在用户发言时统计（记为1轮）
            if (role === 'user') {
                APP_DATA.activityStats[todayStr] = (APP_DATA.activityStats[todayStr] || 0) + 1;
                APP_DATA.activityStats[hourKey] = (APP_DATA.activityStats[hourKey] || 0) + 1;
                // 同时同步到独立键 ACTIVITY_STATS
                await saveActivityStats(APP_DATA.activityStats);
            }

            saveToLocal();
        }
        

        function clearConversation(contactId) {
            APP_DATA.conversations[contactId] = [];
            // 异步清理存储（不阻塞）
            DB.removeItem(`CONV_${contactId}`).catch(() => {});
            saveToLocal();
        }
        
        // --- 发送消息到API (代码.html版本) ---
        async function sendMessageToAPI(contactId, userMessage, onChunk, onComplete, onError) {
            // 验证API配置
            if (!CHAT_API_CONFIGS.currentId) {
                if (onError) onError(new Error('请先在"我"→"API配置"中选择一个配置'));
                return;
            }
            
            const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            // --- 修复：强制读取界面上选择的模型 ---
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
            
            // 获取当前联系人信息
            const contact = mockContacts.find(c => c.id === contactId);
            const systemPrompt = getSystemPromptWithMode(contact);
            
            // 构建消息数组
            const conversation = getConversation(contactId);
            const messages = [];
            
            // --- 🧠 核心RAG魔法：记忆检索引擎 ---
            let injectedMemoryText = "";
            if (contact.longMemories && contact.longMemories.length > 0) {
                // 1. 提取当前用户消息的关键词
                const queryKeywords = extractKeywords(userMessage);
                
                // 2. 提取"核心记忆" (5分及以上，比如终极设定，永远携带)
                const coreMemories = contact.longMemories.filter(m => (m.score || 0) >= 5);
                
                // 3. 提取"相关记忆" (3-4分，事件和偏好，关键词模糊匹配)
                const contextualMemories = contact.longMemories.filter(m => {
                    if ((m.score || 0) >= 5) return false; // 排除已包含的核心记忆
                    if (!m.keywords) return false;
                    
                    const keywords = Array.isArray(m.keywords) ? m.keywords : [m.keywords];
                    return keywords.some(kw => userMessage.includes(kw)) || m.content.includes(userMessage);
                });
                
                // 4. 合并并格式化 (最多取5条相关，防止模型上下文过长导致幻觉)
                const relevantMemories = [...coreMemories, ...contextualMemories.slice(0, 5)];
                
                if (relevantMemories.length > 0) {
                    injectedMemoryText = "\n\n【系统提示：与当前对话相关的历史档案】\n" + relevantMemories.map(m => `[${m.category || '记录'}] ${m.content}`).join('\n');
                    console.log("🧠 [RAG引擎] 触发记忆检索，向系统提示词注入了", relevantMemories.length, "条记忆档案");
                }
            }

            // --- 🧠 核心RAG魔法：记忆检索引擎 ---
            if (injectedMemoryText) {
                systemPrompt = (systemPrompt || "") + "\n\n" + injectedMemoryText;
            }
            
            // 添加历史对话
            // =========================================================================
            // ---------- 【修改开始：智能酒馆预设拆分与排版保卫引擎】 ----------
            // 1. 准备两个篮子：一个装世界观设定，一个装防复读越狱词
            let presetSystemContent = "";
            let presetJailbreakContent = "";

            // 2. 遍历预设文件，按 identifier 拆分
            if (window.ADVANCED_PRESET_FILES) {
                const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
                enabledFiles.forEach(file => {
                    if (file.prompts) {
                        file.prompts.forEach(p => {
                            if (p.enabled !== false && p.content) {
                                // 识别越狱和后缀指令
                                if (p.identifier === "jailbreak" || p.name === "Jailbreak" || p.name === "3.5 Main prompt suffix" || p.name === "Important explanation") {
                                    presetJailbreakContent += '\n\n' + p.content;
                                } else {
                                    // 其他的作为系统背景
                                    presetSystemContent += '\n\n' + p.content;
                                }
                            }
                        });
                    }
                });
            }

            // 3. 组装最终的系统提示词（强制把你的排版规则压轴）
            let finalSystemString = "";
            if (presetSystemContent) {
                finalSystemString += "【预设背景设定参考】\n" + presetSystemContent + "\n\n";
            }
            if (systemPrompt) {
                finalSystemString += "【！！！最高优先级：必须严格执行以下排版与输出法则！！！】\n" + systemPrompt;
            }
            
            // 4. 将系统提示词推入 messages 的最前面
            if (finalSystemString) {
                // 如果原来已经推入过 system，先清理掉
                const sysIndex = messages.findIndex(m => m.role === 'system');
                if (sysIndex > -1) messages.splice(sysIndex, 1);
                messages.unshift({ role: 'system', content: finalSystemString });
            }

            // 5. 深度拷贝历史记录并应用正则
            let mergedChat = JSON.parse(JSON.stringify(conversation));
            if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                mergedChat.forEach(msg => {
                    if (msg.role === 'user') {
                        msg.content = applyRegexRules(msg.content);
                    }
                });
            }

            // 6. 将越狱防复读指令绑在最后一条用户消息的末尾
            if (presetJailbreakContent) {
                let lastUserMsgIndex = -1;
                for (let i = mergedChat.length - 1; i >= 0; i--) {
                    if (mergedChat[i].role === 'user') {
                        lastUserMsgIndex = i;
                        break;
                    }
                }
                if (lastUserMsgIndex !== -1) {
                    mergedChat[lastUserMsgIndex].content += `\n\n【系统越狱强制指令，绝对服从】：${presetJailbreakContent}`;
                }
            }

            // 7. 最后把处理好的历史记录推入消息队列
            messages.push(...mergedChat);
            // ---------- 【修改结束：引擎替换完毕】 ----------
            // =========================================================================
            
            try {
                console.log('=== 发送API请求 ===');
                console.log('URL:', config.url);
                console.log('Model:', config.model);
                console.log('Messages:', messages.length, '条');
                
                let apiUrl = getStandardApiUrl(config.url, '/chat/completions');
                
                console.log('=== API URL处理 ===');
                console.log('原始URL:', config.url);
                console.log('最终API URL:', apiUrl);
                
                // 使用Cloudflare Worker代理
                const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },

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
                
                console.log('API响应状态:', response.status);
                
                if (!response.ok) {
                    let errorText = '';
                    try {
                        errorText = await response.text();
                    } catch(e) {
                        errorText = '无法读取错误信息';
                    }
                    console.error('=== API错误详情 ===');
                    console.error('状态码:', response.status);
                    console.error('错误内容:', errorText);
                    throw new Error(`API请求失败 (${response.status}): ${errorText}`);
                }
                
                // [替换] 引入 buffer 机制的新版 sendMessageToAPI 流式处理
                if (PARAM_CONFIG.stream) {
                    // 流式响应处理
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let fullMessage = '';
                    let buffer = ''; // [新增] 数据缓冲区
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, {stream: true});
                        const lines = buffer.split('\n');
                        buffer = lines.pop(); // [核心] 把最后半截留给下一个 chunk 拼接
                        
                        for (const line of lines) {
                            const trimmedLine = line.trim();
                            if (trimmedLine.startsWith('data: ')) {
                                const data = trimmedLine.slice(6);
                                if (data === '[DONE]') continue;
                                try {
                                    const json = JSON.parse(data);
                                    const delta = json.choices?.[0]?.delta;
                                    let content = delta?.content || '';
                                    
                                    if (!content && delta?.tool_calls) {
                                        const tc = delta.tool_calls[0];
                                        // 如果AI传回了工具的名字，就作为系统提示显示出来
                                        if (tc?.function?.name) {
                                            content += `[系统提示：AI调用了工具 ${tc.function.name}]\n`;
                                        }
                                        // 拼接可能存在的参数
                                        if (tc?.function?.arguments) {
                                            content += tc.function.arguments;
                                        }
                                    }
                                    
                                    if (content) {
                                        fullMessage += content;
                                        if (onChunk) onChunk(content, fullMessage);
                                    }
                                } catch (e) {
                                    // [修复] 解析失败静默跳过，等待残缺块补齐
                                }
                            }
                        }
                    }
                   
                    
                    // 保存完整的助手消息
                    if (fullMessage) {
                        addMessage(contactId, 'assistant', fullMessage);
                    }
                    
                    if (onComplete) onComplete(fullMessage);
                    
                    } else {
                        // 非流式响应处理
                        const data = await response.json();
                        // 增加了一层兼容，防止有些模型返回的是 data.result
                        const aiReply = data.choices?.[0]?.message?.content || data.result || '抱歉，我没有收到回复';

                        // 清除呼吸灯容器（流式专用）
                        const breathingDiv = document.getElementById('active-stream-container');
                        if (breathingDiv) breathingDiv.remove();

                        // 修复 1：加上安全判断，防止 backgroundAIReply 未定义导致代码崩溃
                        if (typeof backgroundAIReply !== 'undefined') {
                            backgroundAIReply.inProgress = false;
                            backgroundAIReply.contactId = null;
                        }

                        // 修复 2：像流式一样，主动把收到的消息保存到你的对话历史记录中
                        if (aiReply) {
                            addMessage(contactId, 'assistant', aiReply);
                        }

                        // 触发上层完成回调，把消息显示在界面上
                        if (onComplete) onComplete(aiReply);
                    }

                
            } catch (error) {
            console.error('=== 发送消息失败 ===');
            console.error('错误类型:', error.name);
            console.error('错误消息:', error.message);
            
            // ---------- 【修改开始：发消息报错后台通知】 ----------
            if (typeof sendPushNotification === 'function') {
                sendPushNotification(`⚠️ API 报错了：${error.message}`);
            }
            // ---------- 【修改结束】 ----------
            
            if (onError) onError(error);
        }
        }
        
        // --- 重新生成回复 (底层统一引擎版) ---
        let isTyping = false;
        
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
            
            // 删除这条用户消息之后的所有AI回复
            conversation.splice(lastUserIndex + 1);
            saveToLocal();
            renderChatMessages(currentChatContactId);
            
            // 保存要重新生成的消息到临时变量
            window._regenerateTempMsg = lastUserMsg;
            
            // 调用发送消息函数，跳过用户消息添加
            await sendChatMessage(true);
            
            // 清理临时变量
            delete window._regenerateTempMsg;
        }

 // --- 模拟数据 (您可以替换为您原来的 APP_DATA.contacts) ---
        const mockContacts = [
            { 
                id: 1, 
                name: '心理导师', 
                avatar: '', 
                lastMsg: '今天感觉怎么样？有没有开心一点？', 
                time: '14:20', 
                color: '#FF9F0A',
                prompt: '你是一位专业的心理导师，以温暖、同情和专业的态度回复用户的问题。',
                longMemories: [], // 长期记忆数组
                summaryCount: 0,
                summaryThreshold: 10
            },
            { 
                id: 2, 
                name: '英语陪练', 
                avatar: '', 
                lastMsg: 'Don\'t forget to practice your pronunciation today!', 
                time: '昨天', 
                color: '#30D158',
                prompt: '你是一位只说英语的口语陪练，每句话都必须是英语。',
                longMemories: [],
                summaryCount: 0,
                summaryThreshold: 10
            },
            { 
                id: 3, 
                name: '产品经理', 
                avatar: '', 
                lastMsg: '那个需求文档你看一下，明天开会要用。', 
                time: '星期一', 
                color: '#0A84FF',
                prompt: '你是一位经验丰富的产品经理。',
                longMemories: [],
                summaryCount: 0,
                summaryThreshold: 10
            },
            { 
                id: 4, 
                name: '旅行助手', 
                avatar: '', 
                lastMsg: '为您推荐了几个京都的赏樱景点，请查收。', 
                time: '2023/12/10', 
                color: '#BF5AF2',
                prompt: '你是一位专业的旅行顾问。',
                longMemories: [],
                summaryCount: 0,
                summaryThreshold: 10
            }
        ];

        // --- 渲染聊天列表函数 ---
        function renderChatList() {
            const container = document.getElementById('chat-list-container');
            if (!container) return;
            
            container.innerHTML = ''; // 清空现有内容

            // 如果没有数据
            if (mockContacts.length === 0) {
                container.innerHTML = `
                    <div style="text-align:center; padding-top:100px; color:#ccc;">
                        <i class="fa-regular fa-comments" style="font-size:48px; margin-bottom:10px;"></i>
                        <p style="font-size:14px;">暂无消息</p>
                    </div>`;
                return;
            }

            // 遍历渲染
            mockContacts.forEach((contact, index) => {
                // 创建滑动容器
                const wrapper = document.createElement('div');
                wrapper.className = 'chat-item-wrapper';
                
                // 创建操作按钮层（背景）
                const actions = document.createElement('div');
                actions.className = 'chat-item-actions';
                actions.innerHTML = `
                    <div class="chat-action-btn chat-action-edit" onclick="event.stopPropagation(); editChatRole(${index});">编辑</div>
                    <div class="chat-action-btn chat-action-delete" onclick="event.stopPropagation(); deleteChatRole(${index});">删除</div>
                `;
                
                // 创建聊天项内容层（前景，可滑动）
                const item = document.createElement('div');
                item.className = 'chat-item';
                
                // 点击进入聊天
                item.onclick = (e) => {
                    // 🎯 修复 Bug：如果刚刚的操作是为了收回卡片，底层会打上拦截标记，这里直接跳过
                    if (item.dataset.ignoreClick === 'true') {
                        item.dataset.ignoreClick = 'false';
                        e.stopPropagation();
                        return;
                    }
                    
                    console.log('打开聊天:', contact.name);
                    openChatWindow(contact.id);
                };

                // 头像逻辑：如果有图片显示图片，没图片显示首字背景
                let avatarHtml = '';
                if (contact.avatar) {
                    avatarHtml = `<img src="${contact.avatar}">`;
                } else {
                    const firstChar = contact.name.charAt(0);
                    const bg = contact.color || '#ccc'; 
                    avatarHtml = `<div style="background:${bg}; width:100%; height:100%; display:flex; align-items:center; justify-content:center;">${firstChar}</div>`;
                }

                item.innerHTML = `
                    <div class="chat-item-avatar">
                        ${avatarHtml}
                    </div>
                    
                    <div class="chat-item-content">
                        <div class="chat-item-name">${contact.name}</div>
                        <div class="chat-item-preview">${contact.lastMsg}</div>
                    </div>
                    
                    <div class="chat-item-meta">
                        <div class="chat-item-time">${formatMessageTime(contact.time)}</div>
                    </div>
                `;

                // 添加滑动事件
                addChatSwipeHandler(item);
                
                wrapper.appendChild(actions);
                wrapper.appendChild(item);
                container.appendChild(wrapper);
            });
        }
        
        // --- 添加聊天项滑动事件处理 ---
        function addChatSwipeHandler(element) {
            let startX = 0;
            let currentX = 0;
            let isDragging = false;
            let startTime = 0;

            element.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                currentX = 0;
                isDragging = true;
                startTime = Date.now();
                element.classList.add('swiping');
                
                // 🎯 修复2：声明全局锁，只要开始侧滑，就屏蔽页面下拉刷新
                window.isItemSwiping = true;
                
                // 重置其他所有滑动项
                document.querySelectorAll('.chat-item').forEach(item => {
                    if (item !== element && item.style.transform) {
                        resetChatSwipe(item);
                    }
                });
            });

            element.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                
                const touchX = e.touches[0].clientX;
                const diffX = touchX - startX;
                
                // 只允许向左滑动
                if (diffX < 0) {
                    currentX = Math.max(diffX, -140);
                    element.style.transform = `translateX(${currentX}px)`;
                    e.preventDefault();
                }
            });

            element.addEventListener('touchend', (e) => {
                if (!isDragging) return;
                isDragging = false;
                element.classList.remove('swiping');
                
                // 🎯 修复2：侧滑结束，稍微延迟100毫秒解除锁定，防止结束瞬间误触下拉
                setTimeout(() => { window.isItemSwiping = false; }, 100);
                
                const duration = Date.now() - startTime;
                const velocity = Math.abs(currentX) / duration;
                
                // 🎯 修复 Bug：如果是点按操作，且当前卡片处于滑开状态，则标记拦截接下来的 click 事件
                if (Math.abs(currentX) < 10 && element.style.transform.includes('-140px')) {
                    element.dataset.ignoreClick = 'true';
                    setTimeout(() => { element.dataset.ignoreClick = 'false'; }, 300);
                }
                
                if (Math.abs(currentX) > 70 || velocity > 0.3) {
                    element.style.transform = 'translateX(-140px)';
                } else {
                    resetChatSwipe(element);
                }
            });
        }
        
        // --- 重置聊天项滑动状态 ---
        function resetChatSwipe(element) {
            element.style.transform = 'translateX(0)';
        }
        
        // --- 编辑角色名 ---
        function editChatRole(index) {
            const contact = mockContacts[index];
            if (!contact) return;
            
            const newName = prompt('修改角色名称:', contact.name);
            if (!newName || newName.trim() === '') return;
            
            contact.name = newName.trim();
            
            // 保存到localStorage
            saveToLocal();
            
            renderChatList();
        }
        
        // --- 删除聊天 ---
        function deleteChatRole(index) {
            const contact = mockContacts[index];
            if (!contact) return;
            
            if (!confirm(`确定要删除"${contact.name}"的聊天吗？\n\n此操作将删除所有聊天记录，且不可恢复！`)) {
                return;
            }
            
            // 删除聊天记录
            mockContacts.splice(index, 1);
            // 删除角色时，同时清理对应的对话存储
            DB.removeItem(`CONV_${contact.id}`).catch(() => {});
            // 同时删除对话历史（如果有的话）
            if (APP_DATA.conversations && APP_DATA.conversations[contact.id]) {
                delete APP_DATA.conversations[contact.id];
            }
            
            renderChatList();
            
            // 保存到localStorage
            saveToLocal();
        }
        
        // --- 全局点击事件：收回所有展开的聊天项 ---
        document.addEventListener('click', (e) => {
            const isChatItem = e.target.closest('.chat-item');
            const isActionBtn = e.target.closest('.chat-action-btn');
            
            if (!isChatItem && !isActionBtn) {
                document.querySelectorAll('.chat-item').forEach(item => {
                    if (item.style.transform === 'translateX(-140px)') {
                        resetChatSwipe(item);
                    }
                });
            }
        });

        (async function startApp() {
            await DB.init();
            loadFromLocal();
            renderChatList();
        })();
        
        // ==========================================
        // 🎯 后台AI回复 - 页面可见性监听
        // ==========================================
        
        // 监听页面可见性变化
        document.addEventListener('visibilitychange', () => {
            // 当页面变为可见时
            if (document.visibilityState === 'visible') {
                // 检查是否有正在进行的AI回复
                if (backgroundAIReply.inProgress && backgroundAIReply.contactId) {
                    console.log('🔄 页面重新可见，检查AI回复状态...');
                    
                    // 如果在聊天页面且是当前联系人，刷新消息
                    const chatScene = document.getElementById('scene-chat');
                    if (chatScene && chatScene.classList.contains('show') && 
                        currentChatContactId === backgroundAIReply.contactId) {
                        
                        console.log('🔄 刷新聊天消息显示');
                        renderChatMessages(currentChatContactId);
                    }
                }
            }
        });
        
        // 监听聊天场景的显示状态
        let wasChatSceneShown = false; // 🌟 新增：记住上一次的状态
        const chatSceneObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    const isShown = target.classList.contains('show');
                    
                    // 🌟 核心修复：只有从“隐藏”真正变成“显示”时才刷新！
                    // 彻底切断触摸屏幕边缘（添加/移除 swiping 类）引发的疯狂重绘死循环！
                    if (isShown && !wasChatSceneShown) {
                        if (backgroundAIReply.inProgress && currentChatContactId === backgroundAIReply.contactId) {
                            console.log('🔄 返回聊天页面，刷新消息');
                            renderChatMessages(currentChatContactId);
                        }
                    }
                    // 更新记录的状态
                    wasChatSceneShown = isShown; 
                }
            });
        });
        
        const chatScene = document.getElementById('scene-chat');
        if (chatScene) {
            chatSceneObserver.observe(chatScene, { attributes: true });
        }
        
        // ==========================================
        // 聊天列表时间自动更新功能
        // ==========================================
        
        // 每分钟自动更新一次时间显示
        setInterval(() => {
            // 只更新时间元素，不重新渲染整个列表
            const timeElements = document.querySelectorAll('.chat-item-time');
            
            timeElements.forEach((el, index) => {
                if (mockContacts[index] && mockContacts[index].time) {
                    const formattedTime = formatMessageTime(mockContacts[index].time);
                    if (el.textContent !== formattedTime) {
                        el.textContent = formattedTime;
                    }
                }
            });
        }, 60000); // 每60秒（1分钟）更新一次
        
        // ==========================================
        // 聊天界面功能
        // ==========================================
        
        let currentChatContactId = null;
        let chatExtensionsPanelOpen = false;
        
        // 🎯 后台AI回复状态跟踪
        let backgroundAIReply = {
            inProgress: false,      // 是否正在回复中
            contactId: null,        // 当前回复的联系人ID
            fullMessage: '',        // 完整消息缓存
            lastUpdate: 0           // 最后更新时间戳
        };

        // --- 核心流式DOM同步器：替代不稳定的打字机，确保切屏进度100%一致 ---
        function syncActiveStreamToDOM() {
            const activeStreamContainer = document.getElementById('active-stream-container');
            if (!activeStreamContainer || !backgroundAIReply.inProgress) return;
            
            const sentences = splitTextIntoSentences(backgroundAIReply.fullMessage);
            if (sentences.length === 0) return;
            
            const existingBubbles = activeStreamContainer.querySelectorAll('.chat-message.ai');
            
            // 发现切出了新气泡，重构气泡列表
            if (existingBubbles.length !== sentences.length) {
                activeStreamContainer.innerHTML = '';
                sentences.forEach((sentence, idx) => {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = 'chat-message ai';
                    const avatarHtml = generateAvatarHtml(false, backgroundAIReply.contactId);
                    const isLast = idx === sentences.length - 1;
                    // 最后一个气泡带光标和动画
                    msgDiv.innerHTML = `${avatarHtml}<div class="chat-bubble" ${isLast ? 'id="active-typing-bubble"' : ''} onclick="toggleRegenerate(this.closest('.chat-message'))">${escapeHtml(sentence)}</div><div class="regenerate-btn" onclick="regenerateMessage(event, this)"><i class="fas fa-rotate-right"></i></div>`;
                    activeStreamContainer.appendChild(msgDiv);
                });
                scrollToBottom();
            } else {
                // 气泡数量没变，只更新最后一个气泡的内容
                const activeBubble = document.getElementById('active-typing-bubble');
                if (activeBubble) {
                    activeBubble.classList.remove('breathing-mode');
                    activeBubble.textContent = sentences[sentences.length - 1];
                    scrollToBottom();
                }
            }
        }
        
        // --- 打开聊天窗口 ---
        function openChatWindow(contactId) {
            const contact = mockContacts.find(c => c.id === contactId);
            if (!contact) return;
            
            currentChatContactId = contactId;
            window.chatMessageLoadCount = 50; // 每次进入聊天重置为50条
            
            // 更新标题
            document.getElementById('chat-title').textContent = contact.name;
            
            // 渲染聊天消息
            renderChatMessages(contactId);
            
            // 显示聊天窗口
            showChatWindow();
            
            // 重置输入框和扩展面板
            document.getElementById('chat-message-input').value = '';
            chatExtensionsPanelOpen = false;
            document.getElementById('chat-extensions-panel').classList.remove('show');
        }
        
        // --- 渲染聊天消息 ---
        function renderChatMessages(contactId, isLoadingMore = false) {
                const container = document.getElementById('chat-messages-container');
                if (!container) return;
                
                // 记录老高度，防止加载历史记录时画面乱跳
                const oldScrollHeight = container.scrollHeight;
                
                container.innerHTML = '';
                
                // 动态计算该拿多少条数据
                if (!window.chatMessageLoadCount) window.chatMessageLoadCount = 50;
                const fullConversation = getConversation(contactId);
                const conversation = fullConversation.slice(-window.chatMessageLoadCount);

                // 如果上面还有历史记录没加载完，显示一个小提示
                if (window.chatMessageLoadCount < fullConversation.length) {
                    const loadingDiv = document.createElement('div');
                    loadingDiv.style.cssText = 'text-align: center; padding: 10px 0; color: var(--text-sub); font-size: 12px;';
                    loadingDiv.innerHTML = '<i class="fas fa-spinner"></i> 向上滑动加载更多...';
                    container.appendChild(loadingDiv);
                }

                if (conversation.length === 0) {
                // 显示欢迎消息
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-sub);">
                        <i class="fas fa-comments" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;"></i>
                        <p style="font-size: 15px; margin-bottom: 8px;">开始对话</p>
                        <p style="font-size: 13px; opacity: 0.7;">发送消息开始聊天</p>
                    </div>
                `;
                return;
            }
            
            // 获取联系人信息
            const contact = mockContacts.find(c => c.id === contactId);
            
            // 🎯 关键修复：先设置滚动位置到底部，避免闪现
            scrollToBottomInstant();
            
            // 🔥 核心修复：检测连续的AI消息并分隔显示（每个气泡都带头像）
            let i = 0;
            let lastMsgTime = 0; // 🎯 记录上一条消息的时间
            while (i < conversation.length) {
                const msg = conversation[i];
                
                // 🎯 插入微信同款时间戳 (相隔5分钟即300000毫秒则显示)
                const msgTime = msg.timestamp; 
                if (msgTime && msgTime - lastMsgTime > 300000) {
                    const d = new Date(msgTime);
                    const days = ['日', '一', '二', '三', '四', '五', '六'];
                    const pad = n => n.toString().padStart(2, '0');
                    const shortTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    const fullTime = `${d.getMonth() + 1}月${d.getDate()}日 星期${days[d.getDay()]} ${shortTime}`;
                    
                    const timeDiv = document.createElement('div');
                    timeDiv.className = 'chat-timestamp';
                    timeDiv.innerText = shortTime;
                    // 🌟 物理级零延迟：完全切断 CSS 重绘检测，纯内存瞬间替换
                    timeDiv.onclick = function() {
                        this.textContent = this.textContent === shortTime ? fullTime : shortTime;
                    };
                    container.appendChild(timeDiv);
                    lastMsgTime = msgTime;
                    container.setAttribute('data-last-time', msgTime); // 🎯 为实时感知存下时间依据
                } else if (msgTime) {
                    lastMsgTime = msgTime;
                    container.setAttribute('data-last-time', msgTime); // 🎯 为实时感知存下时间依据
                }
                const isUser = msg.role === 'user';
                
                if (isUser) {
                    // 用户消息：正常显示
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'chat-message user';
                    const avatarHtml = generateAvatarHtml(true);
                    
                    // 🌟 核心拦截：如果是隐藏格式的论坛分享文本，我们在UI上将其渲染为卡片
                    if (msg.content && msg.content.startsWith('【论坛分享】')) {
                        const titleMatch = msg.content.match(/标题：(.*?)(?=\n|$)/);
                        const contentMatch = msg.content.match(/内容：(.*?)(?=\n|$)/);
                        const authorMatch = msg.content.match(/发帖人：(.*?)(?=\n|$)/);
                        
                        const title = titleMatch ? titleMatch[1] : '分享帖子';
                        const content = contentMatch ? contentMatch[1] : '';
                        const author = authorMatch ? authorMatch[1] : '论坛网友';
                        
                        messageDiv.innerHTML = `
                            ${avatarHtml}
                            <div class="chat-forward-card">
                                <div class="chat-forward-header">
                                    <div class="chat-forward-icon"><i class="fas fa-fire"></i></div>
                                    <span>论坛热门帖子</span>
                                </div>
                                <div class="chat-forward-title">${escapeHtml(title)}</div>
                                <div class="chat-forward-content">${escapeHtml(content)}</div>
                                <div class="chat-forward-footer">
                                    <span>${escapeHtml(author)}</span>
                                    <i class="fas fa-chevron-right" style="color: #ccc;"></i>
                                </div>
                            </div>
                        `;
                    } else {
                        // ---------- 【修改开始：用户气泡显示端正则美化引擎】 ----------
                        let displayUserContent = msg.content;
                        if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                            displayUserContent = applyRegexRules(displayUserContent);
                        } else {
                            displayUserContent = escapeHtml(displayUserContent);
                        }
                        
                        messageDiv.innerHTML = `
                            ${avatarHtml}
                            <div class="chat-bubble">${displayUserContent}</div>
                        `;
                        // ---------- 【修改结束】 ----------
                    }
                    
                    container.appendChild(messageDiv);
                    i++;
                
                } else {
                    // AI消息：收集连续的AI消息
                    const aiMessages = [];
                    while (i < conversation.length && (conversation[i].role === 'assistant' || conversation[i].role === 'ai')) {
                        aiMessages.push(conversation[i]);
                        i++;
                    }
                    
                    aiMessages.forEach((aiMsg, idx) => {
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'chat-message ai';
                        const avatarHtml = generateAvatarHtml(false, contactId);
                        
                        let displayContent = aiMsg.content;
                        if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                            displayContent = applyRegexRules(displayContent);
                        } else {
                            displayContent = escapeHtml(displayContent);
                        }
                        // 空消息保护：如果处理后内容为空，显示占位符
                        if (!displayContent || displayContent.trim() === '') {
                            displayContent = '（空消息）';
                        }
                        
                        messageDiv.innerHTML = `
                            ${avatarHtml}
                            <div class="chat-bubble" onclick="toggleRegenerate(this.closest('.chat-message'))">${displayContent}</div>
                            <div class="regenerate-btn" onclick="regenerateMessage(event, this)">
                                <i class="fas fa-rotate-right"></i>
                            </div>
                        `;
                        container.appendChild(messageDiv);
                    });
                }
            }
            
           // 🎯 【全局队列呼吸光晕】如果是打字中途退出再进，或者正在排队弹气泡
            const isQueueProcessing = window.AI_BUBBLE_QUEUE && window.AI_BUBBLE_QUEUE[contactId] && window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0;
            const isStreaming = backgroundAIReply.inProgress && backgroundAIReply.contactId === contactId;

            if (isQueueProcessing || isStreaming) {
                const streamContainer = document.createElement('div');
                streamContainer.id = 'active-stream-container';
                streamContainer.style.display = 'flex';
                streamContainer.style.flexDirection = 'column';
                streamContainer.style.gap = '16px';
                streamContainer.style.width = '100%';
                
                const msgDiv = document.createElement('div');
                msgDiv.className = 'chat-message ai';
                const avatarHtml = generateAvatarHtml(false, contactId);
                msgDiv.innerHTML = `${avatarHtml}<div class="chat-bubble breathing-mode" id="active-typing-bubble"></div>`;
                streamContainer.appendChild(msgDiv);
                
                container.appendChild(streamContainer);
            }
            
            // 决定滚动位置
            if (isLoadingMore) {
                // 如果是往上滑加载更多，通过高度差让画面维持在刚才看的位置
                const newScrollHeight = container.scrollHeight;
                container.scrollTop = newScrollHeight - oldScrollHeight;
            } else {
                // 正常发消息或刚进聊天，正常滚到底部
                scrollToBottomInstant(true); 
            }
        }
        
        // --- 判断是否应该显示头像 ---
        function shouldShowAvatar(isUser) {
            const mode = AVATAR_CONFIG.mode;
            
            if (mode === 'both') return true;
            if (mode === 'none') return false;
            if (mode === 'ai-only') return !isUser;
            if (mode === 'user-only') return isUser;
            
            return true; // 默认显示
        }
        
        // --- 生成头像HTML的万能辅助函数 ---
        function generateAvatarHtml(isUser, contactId = null) {
            if (!shouldShowAvatar(isUser)) return ''; // 如果不显示，直接返回空
            
            if (isUser) {
                return AVATAR_CONFIG.user 
                    ? `<div class="chat-avatar"><img src="${AVATAR_CONFIG.user}"></div>` 
                    : `<div class="chat-avatar"><i class="fas fa-user"></i></div>`;
            } else {
                const targetId = contactId || currentChatContactId;
                const contact = mockContacts.find(c => c.id === targetId);
                if (contact && contact.avatar) return `<div class="chat-avatar"><img src="${contact.avatar}"></div>`;
                if (AVATAR_CONFIG.ai) return `<div class="chat-avatar"><img src="${AVATAR_CONFIG.ai}"></div>`;
                return `<div class="chat-avatar"><i class="fas fa-robot"></i></div>`;
            }
        }

        // --- 切换扩展功能面板 ---
        function toggleChatExtensions() {
            chatExtensionsPanelOpen = !chatExtensionsPanelOpen;
            const panel = document.getElementById('chat-extensions-panel');
            const container = document.getElementById('chat-messages-container');

            // 判断用户当前是否在底部（距离底部20px以内就算在底部）
            const wasAtBottom = container && container.scrollTop + container.clientHeight >= container.scrollHeight - 20;

            if (chatExtensionsPanelOpen) {
                // 展开面板
                panel.classList.add('show');
                
                // 🎯 核心修改：面板展开的同时立刻同步上滚，不再等350ms
                if (wasAtBottom && container) {
                    // 先瞬间跳到底部
                    container.scrollTop = container.scrollHeight;
                    // 在面板展开动画期间（约400ms），持续把滚动位置钉在底部
                    const startTime = Date.now();
                    function keepAtBottom() {
                        if (Date.now() - startTime < 400) {
                            container.scrollTop = container.scrollHeight;
                            requestAnimationFrame(keepAtBottom);
                        }
                    }
                    requestAnimationFrame(keepAtBottom);
                }
            } else {
                // 收起面板
                panel.classList.remove('show');
                
                // 收起后，如果之前在底部，把消息容器滚到底
                if (wasAtBottom && container) {
                    setTimeout(() => {
                        container.scrollTop = container.scrollHeight;
                    }, 50);
                }
            }
        }

        document.addEventListener('click', function(e) {
            // 只在面板处于打开状态时才处理
            if (!chatExtensionsPanelOpen) return;

            const panel = document.getElementById('chat-extensions-panel');
            if (!panel) return;

            // 如果点击的是加号按钮本身（或其内部子元素），则忽略，让按钮自己的 onclick 处理开关
            if (e.target.closest('.chat-plus-btn')) return;

            // 如果点击的是面板内部区域，也不关闭
            if (panel.contains(e.target)) return;

            // 其他情况：点击了面板和加号之外的区域 → 关闭面板
            toggleChatExtensions();
        });
        
        
        // --- 添加消息到聊天界面 ---
        function addChatMessageToUI(role, content) {
            const container = document.getElementById('chat-messages-container');
            if (!container) return;
            
            // 移除欢迎消息（如果有）
            const welcome = container.querySelector('div[style*="text-align: center"]');
            if (welcome) welcome.remove();
            
            const isUser = role === 'user';
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${isUser ? 'user' : 'ai'}`;
            
            const avatarHtml = generateAvatarHtml(isUser, currentChatContactId);
            
            messageDiv.innerHTML = `
                ${avatarHtml}
                <div class="chat-bubble">${escapeHtml(content)}</div>
            `;
            
            container.appendChild(messageDiv);
            
            // 滚动到底部
            scrollToBottom();
        }
        
        // --- 格式化时间显示 ---
        function formatMessageTime(timestamp) {
            // 如果时间戳为空、无效或为"刚刚"（新建角色的情况），返回空字符串
            if (!timestamp || timestamp === '刚刚') return '';
            
            const now = new Date();
            const msgTime = new Date(timestamp);
            
            // 检查时间戳是否有效
            if (isNaN(msgTime.getTime())) return '';
            
            const diffMs = now - msgTime;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);
            
            // 1分钟内显示"刚刚"
            if (diffMins < 1) return '刚刚';
            
            // 1小时内显示"X分钟前"
            if (diffMins < 60) return `${diffMins}分钟前`;
            
            // 今天显示时间
            if (now.toDateString() === msgTime.toDateString()) {
                const hours = msgTime.getHours().toString().padStart(2, '0');
                const mins = msgTime.getMinutes().toString().padStart(2, '0');
                return `${hours}:${mins}`;
            }
            
            // 昨天显示"昨天"
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            if (yesterday.toDateString() === msgTime.toDateString()) {
                return '昨天';
            }
            
            // 一周内显示星期
            if (diffDays < 7) {
                const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
                return weekdays[msgTime.getDay()];
            }
            
            // 更早显示日期
            const year = msgTime.getFullYear();
            const month = (msgTime.getMonth() + 1).toString().padStart(2, '0');
            const day = msgTime.getDate().toString().padStart(2, '0');
            
            // 今年的消息不显示年份
            if (year === now.getFullYear()) {
                return `${month}/${day}`;
            }
            
            return `${year}/${month}/${day}`;
        }
        
        // ==========================================
        // 论坛相关测试函数 (用于展示UI，后期加入AI生成逻辑)
        // ==========================================
        function openForumRoleFilter() {
            alert("即将开发：在这里将弹出一个面板，让你勾选允许上论坛被八卦的角色哦！");
        }

       // 测试发送独立转发卡片到聊天界面
        function testForwardCard(title, content, author) {
            if (!currentChatContactId) {
                alert("请先去 Chat 页面点开一个角色，然后再回来点击转发体验效果！");
                return;
            }
            
            // 核心魔法：构造带特殊标记的纯文本消息。
            // AI 在历史记录中看到的是这段文本，但上面的代码在渲染 UI 时会将其变成绝美卡片！
            const aiMessageText = `【论坛分享】\n标题：${title}\n内容：${content}\n发帖人：${author}\n(我向你分享了这个论坛八卦帖子)`;
            
            // 写入对话历史记录 (此时没有调用 API，只是存下来)
            addMessage(currentChatContactId, 'user', aiMessageText);
            
            // 同步更新外部列表的预览消息
            updateChatListLastMessage(currentChatContactId, `[转发了帖子] ${title}`);
            
            alert("已成功将卡片转发至当前聊天窗口，快去 Chat 界面看看吧！");
            
            // 自动跳转到聊天页面看效果
            switchTab('chat');
            showChatWindow();
            // 刷新聊天UI，此时你的头像和卡片就会完美呈现出来
            renderChatMessages(currentChatContactId);
            setTimeout(scrollToBottom, 100);
        }

        // --- 更新聊天列表的最后一条消息 ---
        function updateChatListLastMessage(contactId, message) {
            const contact = mockContacts.find(c => c.id === contactId);
            if (contact) {
                // 🎯 如果消息为空，清空显示；否则截取前50个字符
                contact.lastMsg = message ? message.substring(0, 50) : '';
                
                // 🎯 只有在有消息时才更新时间，清空时保持原时间或清空
                if (message) {
                    contact.time = new Date().toISOString();
                } else {
                    contact.time = ''; // 清空时间显示
                }
                
                // 🎯 只有在有新消息时才移到顶部，清空时不移动
                if (message) {
                    const index = mockContacts.findIndex(c => c.id === contactId);
                    if (index > 0) {
                        const [movedContact] = mockContacts.splice(index, 1);
                        mockContacts.unshift(movedContact);
                    }
                }
                
                // 保存到localStorage
                saveToLocal();
                
                renderChatList();
            }
        }
        
        // --- 扩展功能操作 ---
        function chatExtAction(action) {
            console.log('扩展功能:', action);
            
            const actionNames = {
                'transfer': '转账',
                'location': '位置',
                'album': '相册',
                'camera': '拍摄',
                'voice': '语音',
                'file': '文件',
                'card': '名片',
                'video': '视频'
            };
            
            alert(`${actionNames[action] || action}功能开发中...`);
            
            // 关闭扩展面板
            toggleChatExtensions();
        }
        
        // ==========================================
        // 分隔气泡功能 - 核心函数（完整版）
        // ==========================================
        
        // --- 智能分割AI回复为多个句子 ---
        function splitByBackslash(text) {
            if (!text) return [];
            return text.split('\\').map(item => item.trim()).filter(item => item !== "");
        }
        
        // 【修改】按中文标点分割，防止切断中文省略号
        function splitByChinesePunctuation(text) {
            const sentences = [];
            let currentSentence = '';
            
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                currentSentence += char;
                
                // 如果是中文标点
                if (/[。！？；]/.test(char)) {
                    sentences.push(currentSentence);
                    currentSentence = '';
                }
            }
            
            if (currentSentence.trim()) {
                sentences.push(currentSentence.trim());
            }
            
            return sentences;
        }
        
        // 【修改】按英文标点分割，但智能识别省略号
        function splitByEnglishPunctuation(text) {
            const sentences = [];
            let currentSentence = '';
            
            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                currentSentence += char;
                
                // 检查是否是英文标点
                if (/[.!?;]/.test(char)) {
                    // 特殊处理：如果是点号 '.'
                    if (char === '.') {
                        // 向后看：如果后面还有一个点，说明是省略号的一部分，暂不分割
                        if (i + 1 < text.length && text[i+1] === '.') {
                            continue;
                        }
                    }

                    // 只有不是省略号的一部分时，才结束当前句子
                    sentences.push(currentSentence);
                    currentSentence = '';
                }
            }
            
            // 添加最后剩余的部分
            if (currentSentence.trim()) {
                sentences.push(currentSentence.trim());
            }
            
            return sentences;
        }
        
        function splitByComma(text) {
            // 按逗号分割，但避免分割太短的句子
            const sentences = [];
            const parts = text.split(/[,，]/).map(s => s.trim()).filter(s => s.length > 0);
            
            // 如果逗号分割后句子太短，合并相邻的短句
            let combined = '';
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                
                if (combined.length + part.length < 20) {
                    // 合并短句
                    combined += (combined ? '，' : '') + part;
                } else {
                    // 保存当前合并的句子
                    if (combined) {
                        sentences.push(combined);
                    }
                    // 开始新的合并
                    combined = part;
                }
            }
            
            // 添加最后一个合并的句子
            if (combined) {
                sentences.push(combined);
            }
            
            return sentences;
        }
        
        function splitByLength(text) {
            // 按长度分割长文本（每20-40字为一个句子）
            const sentences = [];
            const maxLength = 40;
            const minLength = 20;
            
            let currentSentence = '';
            const words = text.split('');
            
            for (let i = 0; i < words.length; i++) {
                currentSentence += words[i];
                
                // 如果当前句子达到最大长度，或者遇到自然断点
                if (currentSentence.length >= maxLength || 
                    (currentSentence.length >= minLength && /[。！？.!?，,]/.test(words[i]))) {
                    sentences.push(currentSentence.trim());
                    currentSentence = '';
                }
            }
            
            // 添加最后一句
            if (currentSentence.trim()) {
                sentences.push(currentSentence.trim());
            }
            
            return sentences;
        }
        
        // --- 同步纯函数：实时切割文本为句子数组 ---
        function splitTextIntoSentences(fullText) {
            if (!fullText) return [];
            let text = fullText.replace(/([!?！？])\1+/g, '$1');
            text = text.replace(/[\/／∕⧸⁄]/g, '');

            if (text.includes('\\') || text.includes('（') || text.includes('(')) {
                const sentences = parseBubbles(text);
                if (sentences.length > 0) return sentences;
            }
            if (text.includes('\n')) {
                const lines = text.split('\n').filter(line => line.trim().length > 0);
                if (lines.length > 1) return lines;
            }
            const chinesePunctuation = /[。！？；]/;
            if (chinesePunctuation.test(text)) {
                return splitByChinesePunctuation(text);
            }
            const englishPunctuation = /[.!?;]/;
            if (englishPunctuation.test(text)) {
                return splitByEnglishPunctuation(text);
            }
            const commaSemicolon = /[,，]/;
            if (commaSemicolon.test(text)) {
                return splitByComma(text);
            }
            if (text.length > 30) {
                return splitByLength(text);
            }
            return [text];
        }

        // --- 🌟 全局AI气泡队列系统（完美复刻微信切屏不丢进度） ---
        window.AI_BUBBLE_QUEUE = window.AI_BUBBLE_QUEUE || {};

        function startGlobalBubbleQueue(contactId, fullText) {
            let sentences = splitTextIntoSentences(fullText);
            sentences = sentences.map(s => s.replace(/\\/g, '').trim()).filter(s => s.length > 0);
            // 空消息保护
            if (sentences.length === 0) {
                if (!fullText || fullText.trim() === '') {
                    sentences = ['（AI 未返回任何内容）'];
                } else {
                    sentences = [fullText];
                }
            }
            
            if (!window.AI_BUBBLE_QUEUE[contactId]) {
                window.AI_BUBBLE_QUEUE[contactId] = { sentences: [], isProcessing: false };
            }
            
            window.AI_BUBBLE_QUEUE[contactId].sentences.push(...sentences);
            
            if (!window.AI_BUBBLE_QUEUE[contactId].isProcessing) {
                processGlobalBubbleQueue(contactId);
            }
        }

        async function processGlobalBubbleQueue(contactId) {
            window.AI_BUBBLE_QUEUE[contactId].isProcessing = true;
            
            while (window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0) {
                // 模拟正在输入的延迟 (1~2秒)
                const delay = 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                
                const sentence = window.AI_BUBBLE_QUEUE[contactId].sentences.shift();
                
                // 🎯 1. 最核心修复：真正在此时、立刻保存到历史记录！这样切出页面也不会丢！
                addMessage(contactId, 'assistant', sentence);
                updateChatListLastMessage(contactId, sentence);
                
                // ✨ 新增：气泡级逐条推送通知！
                // 因为 sendPushNotification 内部自带判定，前台会拦截，后台才会真发，所以直接扔给它就行
                if (typeof sendPushNotification === 'function') {
                    sendPushNotification(sentence);
                }
                
                // 🎯 2. 如果用户就在这个聊天页面，追加气泡到屏幕上
                const isCurrentPage = document.getElementById('scene-chat') && document.getElementById('scene-chat').classList.contains('show') && currentChatContactId === contactId;
                
                if (isCurrentPage) {
                    const container = document.getElementById('chat-messages-container');
                    
                    // 移除旧的呼吸气泡
                    const typingBubble = document.getElementById('active-stream-container');
                    if (typingBubble) typingBubble.remove();
                    
                    // 创建真实气泡追加
                    const messageDiv = createChatBubble('ai', sentence, false);
                    container.appendChild(messageDiv);
                    
                    // 如果队列还有剩下的，继续补上呼吸气泡
                    if (window.AI_BUBBLE_QUEUE[contactId].sentences.length > 0) {
                        const streamContainer = document.createElement('div');
                        streamContainer.id = 'active-stream-container';
                        streamContainer.style.display = 'flex';
                        streamContainer.style.flexDirection = 'column';
                        streamContainer.style.gap = '16px';
                        streamContainer.style.width = '100%';
                        const aiMessageDiv = document.createElement('div');
                        aiMessageDiv.className = 'chat-message ai';
                        aiMessageDiv.innerHTML = `${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()" title="点击中止生成"></div>`;                        streamContainer.appendChild(aiMessageDiv);
                        container.appendChild(streamContainer);
                    }
                    scrollToBottom();
                }
            }
            
            window.AI_BUBBLE_QUEUE[contactId].isProcessing = false;
            
            // 队列彻底结束，触发记忆总结
            const contactObj = mockContacts.find(c => c.id === contactId);
            if (contactObj) simulateMemorySummary(contactObj).catch(e => console.error(e));
        }

        function handleFinalAIResponse(contactId, finalFullMessage) {
            if (!finalFullMessage || finalFullMessage.trim() === '') {
                finalFullMessage = '（AI 未返回任何内容，请检查 API 配置或稍后重试）';
                console.warn('handleFinalAIResponse 收到空消息，已自动替换为提示文本');
            }
            if (typeof applyRegexRules === 'function') {
                finalFullMessage = applyRegexRules(finalFullMessage);
            }
            // 空消息保护：如果最终消息为空或仅空白字符，替换为友好提示
            if (!finalFullMessage || finalFullMessage.trim() === '') {
                finalFullMessage = '（AI 未返回任何内容，请检查 API 配置或稍后重试）';
                console.warn('handleFinalAIResponse 收到空消息，已自动替换为提示文本');
            }
            // 清理界面上的呼吸灯容器
            const streamCont = document.getElementById('active-stream-container');
            if (streamCont) streamCont.remove();

            // 交给后台队列逐条显示
            startGlobalBubbleQueue(contactId, finalFullMessage);
            
            // 如果用户在当前聊天页面，立即显示一个呼吸占位符（队列会在背后逐条显示）
            const isCurrentPage = document.getElementById('scene-chat') && document.getElementById('scene-chat').classList.contains('show') && currentChatContactId === contactId;
            if (isCurrentPage) {
                const container = document.getElementById('chat-messages-container');
                // 避免重复添加多个呼吸灯
                if (!document.getElementById('active-stream-container')) {
                    const streamContainer = document.createElement('div');
                    streamContainer.id = 'active-stream-container';
                    streamContainer.style.display = 'flex';
                    streamContainer.style.flexDirection = 'column';
                    streamContainer.style.gap = '16px';
                    streamContainer.style.width = '100%';
                    const aiMessageDiv = document.createElement('div');
                    aiMessageDiv.className = 'chat-message ai';
                    aiMessageDiv.innerHTML = `${generateAvatarHtml(false, contactId)}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()" title="点击中止生成"></div>`;
                    streamContainer.appendChild(aiMessageDiv);
                    container.appendChild(streamContainer);
                    scrollToBottom();
                }
            }
        }
        
        // --- 创建聊天气泡 (修改为无内联动画版) ---
        function createChatBubble(role, content, addTopMargin = false) {
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            const isUser = role === 'user';
            const messageDiv = document.createElement('div');
            messageDiv.className = `chat-message ${isUser ? 'user' : 'ai'}`;
        
            const avatarHtml = generateAvatarHtml(isUser, currentChatContactId);

            if (!isUser) {
                const bubbleDiv = document.createElement('div');
                bubbleDiv.className = 'chat-bubble';
                bubbleDiv.textContent = content;
                
                const regenBtn = document.createElement('div');
                regenBtn.className = 'regenerate-btn';
                regenBtn.innerHTML = '<i class="fas fa-rotate-right"></i>';
                
                messageDiv.innerHTML = avatarHtml;
                messageDiv.appendChild(bubbleDiv);
                messageDiv.appendChild(regenBtn);
                
                bubbleDiv.addEventListener('click', function(e) {
                    e.stopPropagation();
                    toggleRegenerate(messageDiv);
                });
                
                regenBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    regenerateMessage(e, regenBtn);
                });
            } else {
                messageDiv.innerHTML = `
                    ${avatarHtml}
                    <div class="chat-bubble">${escapeHtml(content)}</div>
                `;
            }
            
            /* 核心修改：移除所有的内联 opacity 和 transform 动画，保持纯净 */
            
            return messageDiv;
        }
        
        // --- 终止当前AI回复 ---
        function abortCurrentAiReply() {
            if (window.currentChatController) {
                window.currentChatController.abort(); // 杀掉底层的 fetch 请求
                window.currentChatController = null;
                console.log('🛑 用户手动中断了API请求');
            }
            
            // 强制结算当前UI和数据状态
            if (backgroundAIReply.inProgress) {
                // 如果已经流式输出了一部分文字，加个省略号；如果连一个字都没出，显示已中断
                const finalMsg = backgroundAIReply.fullMessage 
                    ? backgroundAIReply.fullMessage + '...' 
                    : '（已中断生成）';
                
                backgroundAIReply.inProgress = false;
                const targetId = backgroundAIReply.contactId || currentChatContactId;
                backgroundAIReply.contactId = null;
                
                // 走正常的结算流程，清除呼吸光晕，把半截文本固化成真实气泡保存
                handleFinalAIResponse(targetId, finalMsg);
            }
        }

        async function sendChatMessage(skipAddUser = false) {
            let message;
            if (skipAddUser) {
                message = window._regenerateTempMsg;
                if (!message) return;
            } else {
                const input = document.getElementById('chat-message-input');
                if (!input) return;
                message = input.value.trim();
                if (!message) return;
            }

            // 取消之前的请求
            if (window.currentChatController) {
                window.currentChatController.abort();
            }
            window.currentChatController = new AbortController();

            // 重置后台状态
            backgroundAIReply.inProgress = true;
            backgroundAIReply.contactId = currentChatContactId;
            backgroundAIReply.fullMessage = '';

            if (!CHAT_API_CONFIGS.currentId) {
                alert('请先在"我"→"API配置"中选择一个配置');
                backgroundAIReply.inProgress = false;
                return;
            }
            
            const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            if (!config || !config.url || !config.key) {
                alert('当前配置不存在或不完整，请检查API设置');
                backgroundAIReply.inProgress = false;
                return;
            }
            
            // 如果不是重新生成模式，才清空输入框、添加用户消息到UI和历史
            if (!skipAddUser) {
                const input = document.getElementById('chat-message-input');
                input.value = '';
                input.style.height = '40px'; 
                if (chatExtensionsPanelOpen) toggleChatExtensions();
                
                addChatMessageToUI('user', message);
                addMessage(currentChatContactId, 'user', message);
                
                const contact = mockContacts.find(c => c.id === currentChatContactId);
                if (contact) {
                    contact.lastMsg = message.substring(0, 50);
                    contact.time = new Date().toISOString();
                }
            }
            
            const container = document.getElementById('chat-messages-container');
            const welcome = container.querySelector('div[style*="text-align: center"]');
            if (welcome) welcome.remove();
            
            // 创建呼吸灯容器
            const streamContainer = document.createElement('div');
            streamContainer.id = 'active-stream-container';
            streamContainer.style.display = 'flex';
            streamContainer.style.flexDirection = 'column';
            streamContainer.style.gap = '16px';
            streamContainer.style.width = '100%';
            
            const aiMessageDiv = document.createElement('div');
            aiMessageDiv.className = 'chat-message ai';
            const avatarHtml = generateAvatarHtml(false, currentChatContactId);
            aiMessageDiv.innerHTML = `${avatarHtml}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()" title="点击中止生成"></div>`;
            streamContainer.appendChild(aiMessageDiv);
            
            streamContainer.style.opacity = '0';
            streamContainer.style.transform = 'translateY(20px)';
            container.appendChild(streamContainer);
            
            requestAnimationFrame(() => {
                streamContainer.style.transition = 'opacity 0.4s cubic-bezier(0.25, 1, 0.5, 1), transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)';
                streamContainer.style.opacity = '1';
                streamContainer.style.transform = 'translateY(0)';
            });
            
            scrollToBottom();

            // 构建消息数组（保持不变）
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            const systemPrompt = getSystemPromptWithMode(contact);
            const conversation = getConversation(currentChatContactId);
            const messages = [];

            let injectedMemoryText = "";
            try {
                const ragResponse = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'query_memory', text: message })
                });
                const ragData = await ragResponse.json();
                if (ragData.matches && ragData.matches.length > 0) {
                    const relevantMemories = ragData.matches.filter(m => m.score > 0.3).map(m => m.metadata.text);
                    if (relevantMemories.length > 0) {
                        injectedMemoryText = "\n\n【系统提示：潜意识唤醒的深度记忆】\n" + relevantMemories.map(text => `· ${text}`).join('\n');
                    }
                }
            } catch (e) { console.error("RAG 唤醒失败:", e); }

            let finalUserPrompt = systemPrompt || "";
            if (injectedMemoryText) finalUserPrompt += injectedMemoryText;

            const roundLimit = GENERAL_CONFIG.memory.contextLimit || 10;
            let startIndex = 0;
            let userMsgCount = 0;
            for (let i = conversation.length - 1; i >= 0; i--) {
                if (conversation[i].role === 'user') {
                    userMsgCount++;
                    if (userMsgCount > roundLimit) { startIndex = i + 1; break; }
                }
            }
            const limitedConversation = conversation.slice(startIndex);
            let rawConversation = JSON.parse(JSON.stringify(limitedConversation));
            let presetSystemContent = "", presetJailbreakContent = "";
            if (window.ADVANCED_PRESET_FILES) {
                const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
                enabledFiles.forEach(file => {
                    if (file.prompts) file.prompts.forEach(p => {
                        if (p.enabled !== false && p.content) {
                            if (p.identifier === "jailbreak" || p.name === "Jailbreak" || p.name === "3.5 Main prompt suffix" || p.name === "Important explanation") {
                                presetJailbreakContent += '\n\n' + p.content;
                            } else {
                                presetSystemContent += '\n\n' + p.content;
                            }
                        }
                    });
                });
            }
            let finalSystemString = "";
            if (presetSystemContent) finalSystemString += "【预设背景设定参考】\n" + presetSystemContent + "\n\n";
            if (finalUserPrompt) finalSystemString += "【！！！最高优先级：必须严格执行以下排版与输出法则！！！】\n" + finalUserPrompt;
            if (finalSystemString) messages.push({ role: 'system', content: finalSystemString });

            let mergedChat = [];
            for (const msg of rawConversation) {
                if (mergedChat.length > 0 && mergedChat[mergedChat.length - 1].role === msg.role) {
                    mergedChat[mergedChat.length - 1].content += '\n\n' + msg.content;
                } else {
                    mergedChat.push({ ...msg });
                }
            }
            if (typeof REGEX_RULES !== 'undefined' && REGEX_RULES.enabled && typeof applyRegexRules === 'function') {
                mergedChat.forEach(msg => { if (msg.role === 'user') msg.content = applyRegexRules(msg.content); });
            }
            if (presetJailbreakContent) {
                let lastUserMsgIndex = -1;
                for (let i = mergedChat.length - 1; i >= 0; i--) {
                    if (mergedChat[i].role === 'user') { lastUserMsgIndex = i; break; }
                }
                if (lastUserMsgIndex !== -1) {
                    mergedChat[lastUserMsgIndex].content += `\n\n【系统越狱强制指令，绝对服从】：${presetJailbreakContent}`;
                } else {
                    mergedChat.push({ role: 'user', content: `【系统越狱强制指令，绝对服从】：${presetJailbreakContent}` });
                }
            }
            messages.push(...mergedChat);

            let hasMemory = false;
            let memoryPrompt = "【系统最高指令：当前世界观与潜意识状态】\n";
            if (contact.relations && contact.relations.length > 0) {
                memoryPrompt += "=> 当前核心人物羁绊网络：\n";
                contact.relations.forEach(r => memoryPrompt += `- ${r.source} 与 ${r.target} 当前关系为：[${r.label}] (${r.detail || '暂无明细'})\n`);
                hasMemory = true;
            }
            if (contact.longMemories && contact.longMemories.length > 0) {
                const coreMemories = contact.longMemories.filter(m => m.score === undefined || m.score >= 4);
                if (coreMemories.length > 0) {
                    memoryPrompt += "\n=> 世界观核心事实与事件设定：\n";
                    coreMemories.forEach(m => memoryPrompt += `- ${m.worldTime ? `(${m.worldTime}) ` : ''}${m.content}\n`);
                    hasMemory = true;
                }
            }
            if (hasMemory) {
                if (messages.length > 0 && messages[0].role === 'system') {
                    messages[0].content = memoryPrompt + "\n\n" + messages[0].content;
                } else {
                    messages.unshift({ role: 'system', content: memoryPrompt });
                }
            }

            try {
                let apiUrl = getStandardApiUrl(config.url, '/chat/completions');
                const randomOffset = (Math.random() - 0.5) * 0.4;
                const adjustedTemp = Math.max(0.1, Math.min(2.0, PARAM_CONFIG.temperature + randomOffset));
                const useProxy = config.useProxy !== false;
                const isIOSNative = window.Capacitor && window.Capacitor.isNativePlatform();
                let response;

                if (useProxy) {
                    response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                        method: 'POST',
                        signal: window.currentChatController?.signal,
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            customEndpoint: apiUrl,
                            customApiKey: config.key,
                            model: config.model || 'gpt-3.5-turbo',
                            messages: messages,
                            stream: PARAM_CONFIG.stream,
                            temperature: adjustedTemp,
                            max_tokens: PARAM_CONFIG.maxTokens,
                            frequency_penalty: PARAM_CONFIG.frequencyPenalty,
                            presence_penalty: PARAM_CONFIG.presencePenalty,
                            tool_choice: "none"
                        })
                    });
                } else {
                    const directUrl = getStandardApiUrl(config.url, '/chat/completions');
                    if (isIOSNative) {
                        const nativeResponse = await window.Capacitor.Plugins.CapacitorHttp.post({
                            url: directUrl,
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
                            data: {
                                model: config.model || 'gpt-3.5-turbo',
                                messages: messages,
                                stream: PARAM_CONFIG.stream,
                                temperature: adjustedTemp,
                                max_tokens: PARAM_CONFIG.maxTokens,
                                frequency_penalty: PARAM_CONFIG.frequencyPenalty,
                                presence_penalty: PARAM_CONFIG.presencePenalty,
                                tool_choice: "none"
                            }
                        });
                        response = {
                            ok: nativeResponse.status >= 200 && nativeResponse.status < 300,
                            status: nativeResponse.status,
                            text: async () => JSON.stringify(nativeResponse.data),
                            json: async () => nativeResponse.data
                        };
                        if (PARAM_CONFIG.stream) {
                            response.body = {
                                getReader: () => {
                                    let done = false;
                                    return {
                                        read: async () => {
                                            if (done) return { done: true };
                                            done = true;
                                            const content = nativeResponse.data.choices?.[0]?.message?.content || "（无内容）";
                                            const mockSse = `data: ${JSON.stringify({choices: [{delta: {content: content}}]})}\n\ndata: [DONE]\n`;
                                            return { done: false, value: new TextEncoder().encode(mockSse) };
                                        }
                                    };
                                }
                            };
                        }
                    } else {
                        response = await fetch(directUrl, {
                            method: 'POST',
                            signal: window.currentChatController.signal,
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.key}` },
                            body: JSON.stringify({
                                model: config.model || 'gpt-3.5-turbo',
                                messages: messages,
                                stream: PARAM_CONFIG.stream,
                                temperature: adjustedTemp,
                                max_tokens: PARAM_CONFIG.maxTokens,
                                frequency_penalty: PARAM_CONFIG.frequencyPenalty,
                                presence_penalty: PARAM_CONFIG.presencePenalty,
                                tool_choice: "none"
                            })
                        });
                    }
                }

                if (!response.ok) {
                    let errorText = await response.text().catch(e => '无法读取错误信息');
                    throw new Error(`API请求失败 (${response.status}): ${errorText}`);
                }

                if (PARAM_CONFIG.stream) {
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    let buffer = "";
                    let fullMessage = "";
                    let pending = "";          // 未完成句子的累积缓冲区
                    let hasAnyContent = false;

                    // ---------- 队列管理器（保持原有随机间隔 1~2 秒） ----------
                    let sentenceQueue = [];
                    let isProcessingQueue = false;

                    const processQueue = async () => {
                        if (isProcessingQueue) return;
                        isProcessingQueue = true;
                        while (sentenceQueue.length > 0) {
                            const sentence = sentenceQueue.shift();
                            // 1. 保存到历史
                            addMessage(currentChatContactId, 'assistant', sentence);
                            updateChatListLastMessage(currentChatContactId, sentence);
                            // 2. 如果聊天窗口可见，立即显示气泡
                            const isVisible = document.getElementById('scene-chat')?.classList.contains('show');
                            if (isVisible) {
                                // 移除当前的呼吸灯容器（如果有）
                                const oldStream = document.getElementById('active-stream-container');
                                if (oldStream) oldStream.remove();
                                // 创建真实气泡
                                const bubbleDiv = createChatBubble('ai', sentence, false);
                                const container = document.getElementById('chat-messages-container');
                                container.appendChild(bubbleDiv);
                                // 🌟 修复：智能判断是否还需要显示呼吸灯
                                // 只有当队列里还有等待发送的句子，或者API还在后台接收数据时，才显示呼吸灯
                                if (sentenceQueue.length > 0 || backgroundAIReply.inProgress) {
                                    const newStream = document.createElement('div');
                                    newStream.id = 'active-stream-container';
                                    newStream.style.display = 'flex';
                                    newStream.style.flexDirection = 'column';
                                    newStream.style.gap = '16px';
                                    newStream.style.width = '100%';
                                    const aiMsg = document.createElement('div');
                                    aiMsg.className = 'chat-message ai';
                                    const avatarHtml = generateAvatarHtml(false, currentChatContactId);
                                    aiMsg.innerHTML = `${avatarHtml}<div class="chat-bubble breathing-mode" id="active-typing-bubble" onclick="abortCurrentAiReply()" title="点击中止生成"></div>`;
                                    newStream.appendChild(aiMsg);
                                    container.appendChild(newStream);
                                }
                                scrollToBottom();
                            }
                                // 随机延迟 1~2 秒（与原来完全一致）
                                const delayMs = 1000 + Math.random() * 1000;
                                await new Promise(resolve => setTimeout(resolve, delayMs));
                                }
                                // 立即移除呼吸灯（因为队列已经空了）
                                const finalStream = document.getElementById('active-stream-container');
                                if (finalStream) finalStream.remove();
                                isProcessingQueue = false;
                            };

                    const pushSentence = (sentence) => {
                        if (!sentence.trim()) return;
                        
                        // 🌟 核心：判断页面是否可见
                        if (document.visibilityState === 'hidden') {
                            // 后台模式：立即处理，不进入队列
                            addMessage(currentChatContactId, 'assistant', sentence);
                            updateChatListLastMessage(currentChatContactId, sentence);
                            sendPushNotification(sentence);  // 发送通知
                            // 注意：后台时不操作 DOM，不显示气泡
                        } else {
                            // 前台模式：进入队列，延迟显示
                            sentenceQueue.push(sentence);
                            if (!isProcessingQueue) processQueue();
                        }
                    };
                    // ----------------------------------------------------

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || "";

                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (trimmed === "") continue;

                            let jsonStr = trimmed;
                            if (trimmed.startsWith('data:')) jsonStr = trimmed.slice(5).trim();
                            if (jsonStr === '[DONE]') continue;

                            try {
                                const json = JSON.parse(jsonStr);
                                const delta = json.choices?.[0]?.delta;
                                let content = delta?.content || delta?.text || '';
                                if (!content && delta?.tool_calls) {
                                    const tc = delta.tool_calls[0];
                                    if (tc?.function?.name) content = `🔧 调用工具：${tc.function.name}\n`;
                                    if (tc?.function?.arguments) content += tc.function.arguments;
                                }
                                if (content) {
                                    hasAnyContent = true;
                                    fullMessage += content;
                                    backgroundAIReply.fullMessage = fullMessage;
                                    backgroundAIReply.lastUpdate = Date.now();

                                    pending += content;
                                    const segments = splitTextIntoSentences(pending);
                                    if (segments.length > 1) {
                                        const complete = segments.slice(0, -1);
                                        const lastPart = segments[segments.length - 1];
                                        for (const s of complete) pushSentence(s);
                                        pending = lastPart;
                                    }
                                }
                            } catch (e) {
                                const contentMatch = trimmed.match(/["']content["']\s*:\s*["']([^"']*)/i);
                                if (contentMatch && contentMatch[1]) {
                                    let content = contentMatch[1];
                                    content = content.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
                                    if (content) {
                                        hasAnyContent = true;
                                        fullMessage += content;
                                        backgroundAIReply.fullMessage = fullMessage;
                                        pending += content;
                                        const segments = splitTextIntoSentences(pending);
                                        if (segments.length > 1) {
                                            const complete = segments.slice(0, -1);
                                            const lastPart = segments[segments.length - 1];
                                            for (const s of complete) pushSentence(s);
                                            pending = lastPart;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 处理最后残留的句子（立即处理）
                    if (pending.trim()) pushSentence(pending);

                    backgroundAIReply.inProgress = false;
                    backgroundAIReply.contactId = null;

                    // 如果没有收到任何内容，显示错误
                    if (!hasAnyContent) {
                        const errorMsg = '【流式响应未收到任何内容】';
                        pushSentence(errorMsg);
                    }

                    // 等待队列处理完成
                    while (sentenceQueue.length > 0 || isProcessingQueue) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    scrollToBottom();
                } else {
                    // 🌟 修复：补充缺失的非流式响应处理分支
                    const data = await response.json();
                    
                    // 安全提取大模型返回的文本
                    const aiContent = data.choices?.[0]?.message?.content || data.result || '（空消息）';
                    
                    // 重置后台回复状态，防止卡死
                    backgroundAIReply.inProgress = false;
                    backgroundAIReply.contactId = null;

                    // 核心：交给统一引擎去处理打字机动画、气泡分割和历史保存
                    handleFinalAIResponse(currentChatContactId, aiContent);
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.log('请求被智能取消');
                    return;
                }
                let rawError = error.stack || error.toString();
                addLogToConsole('error', '发送消息失败', rawError);
                console.error('发送消息失败:', error);
                backgroundAIReply.inProgress = false;
                backgroundAIReply.contactId = null;
                const streamCont = document.getElementById('active-stream-container');
                if (streamCont) streamCont.remove();
                const errorMsg = '⚠️ 发送失败：' + error.message;
                const errorMsgDiv = createChatBubble('ai', errorMsg, false);
                container.appendChild(errorMsgDiv);
                addMessage(currentChatContactId, 'assistant', errorMsg);
                updateChatListLastMessage(currentChatContactId, errorMsg);
                scrollToBottom();
            }
        }
        
        // --- 输入框回车发送 + 自动调整高度 ---
        document.addEventListener('DOMContentLoaded', function() {
            const input = document.getElementById('chat-message-input');
            if (input) {
                // 回车发送
                input.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendChatMessage();
                    }
                });
                
                // 自动调整高度
                input.addEventListener('input', function() {
                    this.style.height = 'auto';
                    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
                });
            }
        });
        
        // 初始化API配置
        initApiConfig();
        
        // 初始化主题
        initTheme();
        
        // 初始化模型参数
        initModelParams();
        
        // 初始化预设系统
        initPresets();
        
        // 初始化正则系统
        initRegexSystem();
        
        // 初始化推送系统
        initPushSystem();
        
        // 初始化保活系统
        initKeepAliveSystem();
        
        // ==========================================
        // 页面加载后检查是否需要自动跳转到指定页面
        // ==========================================
        (function() {
            const targetPage = localStorage.getItem('RELOAD_TARGET_PAGE');
            
            if (targetPage) {
                // 立即隐藏body，避免闪烁
                document.body.style.opacity = '0';
                
                window.addEventListener('DOMContentLoaded', function() {
                    // 清除标记
                    localStorage.removeItem('RELOAD_TARGET_PAGE');
                    
                    // 立即切换标签页
                    switchTab('me');
                    
                    // 🔥 关键优化：直接跳过动画，瞬间显示子页面
                    const subPage = document.getElementById(targetPage);
                    if (subPage) {
                        // 禁用过渡动画
                        subPage.style.transition = 'none';
                        // 直接显示（无动画）
                        subPage.classList.add('show');
                        
                        // 强制重排，确保样式生效
                        subPage.offsetHeight;
                        
                        // 立即显示body（因为已经没有动画了）
                        document.body.style.opacity = '1';
                        
                        // 延迟恢复过渡动画（供后续正常使用）
                        setTimeout(() => {
                            subPage.style.transition = '';
                        }, 100);
                    }
                });
            }
        })();

        // ==========================================
        // 新建角色弹窗功能
        // ==========================================
        
        // 打开新建角色弹窗（带渐入动画）
        function createNewRole() {
            const modal = document.getElementById('new-role-modal');
            
            // 直接添加 show 类，触发背景和内容同步渐入
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }

        // 关闭新建角色弹窗（带渐出动画）
        function closeNewRoleModal() {
            const modal = document.getElementById('new-role-modal');
            
            // 移除 show 类，触发背景和内容同步渐出
            modal.classList.remove('show');
            
            // 等待动画完成后清空输入框
            setTimeout(() => {
                document.getElementById('role-name-input').value = '';
                document.getElementById('role-prompt-input').value = '';
            }, 300);
        }

        // 确认新建角色
        function confirmNewRole() {
            const nameInput = document.getElementById('role-name-input');
            const promptInput = document.getElementById('role-prompt-input');
            
            const name = nameInput.value.trim();
            const prompt = promptInput.value.trim();
            
            if (!name) {
                alert('请输入角色名称');
                return;
            }
            
            if (!prompt) {
                alert('请输入角色Prompt');
                return;
            }
            
            // 生成随机颜色
            const colors = ['#FF9F0A', '#30D158', '#0A84FF', '#BF5AF2', '#FF453A', '#FFD60A'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            // 🎯 修复：添加新角色时，自动使用外观中上传的AI头像
            const newContact = {
                id: Date.now(),
                name: name,
                avatar: AVATAR_CONFIG.ai || '', // 使用外观中的AI头像
                lastMsg: '',
                time: '',
                color: randomColor,
                prompt: prompt
            };
            
            mockContacts.unshift(newContact); // 添加到列表开头
            
            // 保存到localStorage
            saveToLocal();
            
            renderChatList(); // 重新渲染列表
            closeNewRoleModal(); // 关闭弹窗
            
            console.log('新建角色:', newContact);
        }

        // 点击弹窗外部关闭弹窗
        document.getElementById('new-role-modal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeNewRoleModal();
            }
        });

        // ==========================================
        // Chat API配置系统 - 配置管理功能
        // ==========================================
        
        // --- Chat API配置数据结构 ---
        const CHAT_API_CONFIGS = {
            list: [], // 配置列表
            currentId: null, // 当前使用的配置ID
            currentModel: '' // 当前选择的模型
        };
        
        // 全局变量存储拉取到的模型列表
        let availableModels = [];
        
        // --- 加载Chat API配置 ---
        function loadChatApiConfigs() {
            try {
                const saved = localStorage.getItem('CHAT_API_CONFIGS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(CHAT_API_CONFIGS, parsed);
                    updateChatConfigDisplay();
                }
            } catch(e) {
                console.error('加载Chat API配置失败:', e);
            }
        }
        
        // --- 保存Chat API配置 ---
        function saveChatApiConfigs() {
            try {
                localStorage.setItem('CHAT_API_CONFIGS', JSON.stringify(CHAT_API_CONFIGS));
            } catch(e) {
                console.error('保存Chat API配置失败:', e);
            }
        }
        
        // --- 更新显示当前配置 ---
        function updateChatConfigDisplay() {
            const configNameInput = document.getElementById('chat-config-name');
            const modelInput = document.getElementById('chat-current-model');
            
            if (CHAT_API_CONFIGS.currentId) {
                const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
                if (config) {
                    configNameInput.value = config.name;
                } else {
                    configNameInput.value = '点击选择配置';
                }
            } else {
                configNameInput.value = '点击选择配置';
            }
            
            if (CHAT_API_CONFIGS.currentModel) {
                modelInput.value = CHAT_API_CONFIGS.currentModel;
            } else {
                modelInput.value = '';
            }
        }
        
        // ==========================================
        // 🌟 统一配置与模型引擎 (重构极简版)
        // ==========================================

        // --- 统一打开配置选择器 ---
        function openUnifiedConfigSelector(context, type = null) {
            window.currentConfigSelectorContext = context;
            window.currentOtherApiType = type;
            
            const modal = document.getElementById('chat-config-modal');
            modal.querySelector('.config-modal-title').textContent = '选择配置';
            
            // 动态绑定新建按钮
            const newBtn = modal.querySelector('.config-new-btn');
            if (newBtn) {
                newBtn.onclick = () => {
                    modal.classList.remove('show');
                    const newModal = document.getElementById('new-config-modal');
                    document.getElementById('config-form-title').textContent = context === 'other' ? '新建Other API配置' : '新建配置';
                    ['name', 'url', 'key', 'model'].forEach(id => document.getElementById(`new-config-${id}`).value = '');
                    // ⭐ 新增：重置代理开关为默认开启
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
                
                // 🌟 Fix 3：修改排序逻辑
                // 规则：当前选中的始终置顶(模拟最新)，其他的按 lastUsed 时间倒序，没有时间的按 ID 倒序
                const sortedConfigs = [...CHAT_API_CONFIGS.list].sort((a, b) => {
                    // 1. 当前选中的强制排第一
                    if (a.id === activeId) return -1;
                    if (b.id === activeId) return 1;
                    
                    // 2. 按最后使用时间倒序 (最新使用的在上面)
                    const timeA = a.lastUsed || 0;
                    const timeB = b.lastUsed || 0;
                    if (timeA !== timeB) {
                        return timeB - timeA;
                    }
                    
                    // 3. 如果都没用过，按创建时间(ID)倒序
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
                    
                    addConfigSwipeHandler(itemNode);
                    listContainer.appendChild(wrapper);
                });
            }
            requestAnimationFrame(() => {
                modal.classList.add('show');
                // 强制配置列表滚动回顶部
                const listContainer = document.getElementById('chat-config-list');
                if (listContainer) listContainer.scrollTop = 0;
            });
        }

        function selectUnifiedConfig(configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
            if (!config) return;

            // 🌟 Fix 2：记录最后使用时间 (核心排序依据)
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

        // 切换弹窗内代理开关的 UI 状态（不保存到配置，只切换视觉）
        let modalProxyTempState = true; // 临时状态，新建时默认 true

        function toggleModalProxySwitch() {
            modalProxyTempState = !modalProxyTempState;
            const indicator = document.getElementById('modal-proxy-switch');
            if (indicator) {
                if (modalProxyTempState) indicator.classList.add('active');
                else indicator.classList.remove('active');
            }
        }

        // 设置弹窗内的开关状态（用于编辑时加载）
        function setModalProxySwitchState(state) {
            modalProxyTempState = state;
            const indicator = document.getElementById('modal-proxy-switch');
            if (indicator) {
                if (modalProxyTempState) indicator.classList.add('active');
                else indicator.classList.remove('active');
            }
        }
        // --- 保存新配置 (修复了交叉覆写 Bug) ---
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
                    config.name = name;
                    config.url = url;
                    config.key = key;
                    config.model = model;
                    config.useProxy = modalProxyTempState;   // ⭐ 保存开关状态
                    if (CHAT_API_CONFIGS.currentId === config.id) CHAT_API_CONFIGS.currentModel = model;
                    alert('配置已更新！');
                }
            } else {
                const newConfig = {
                    id: Date.now(),
                    name, url, key, model,
                    useProxy: modalProxyTempState,           // ⭐ 保存开关状态
                    createdAt: new Date().toISOString()
                };
                CHAT_API_CONFIGS.list.push(newConfig);
                if (!isOther) {
                    CHAT_API_CONFIGS.currentId = newConfig.id;
                    CHAT_API_CONFIGS.currentModel = model;
                }
                alert('配置已保存！');
            }
            
            saveChatApiConfigs();
            updateChatConfigDisplay();
            updateOtherConfigDisplay();
            closeNewConfigForm();
        }

        function closeNewConfigForm() { document.getElementById('new-config-modal').classList.remove('show'); }

        // --- 编辑与删除配置 ---
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
                // ⭐ 新增：同步当前配置的代理开关状态
                setModalProxySwitchState(config.useProxy !== false);
                const modal = document.getElementById('new-config-modal');
                modal.dataset.editingId = configId;
                requestAnimationFrame(() => modal.classList.add('show'));
            }, 300);
        }

        function deleteChatConfig(configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
            if (!config) return;
            if (!confirm(`确定要删除配置"${config.name}"吗？`)) return;
            
            if (CHAT_API_CONFIGS.currentId === configId) {
                CHAT_API_CONFIGS.currentId = null; CHAT_API_CONFIGS.currentModel = '';
            }
            Object.keys(OTHER_API_CONFIGS).forEach(key => {
                if (OTHER_API_CONFIGS[key].configId === configId) {
                    OTHER_API_CONFIGS[key].configId = null; OTHER_API_CONFIGS[key].model = '';
                }
            });

            CHAT_API_CONFIGS.list = CHAT_API_CONFIGS.list.filter(c => c.id !== configId);
            saveChatApiConfigs(); saveOtherApiConfigs();
            updateChatConfigDisplay(); updateOtherConfigDisplay();
            openUnifiedConfigSelector(window.currentConfigSelectorContext, window.currentOtherApiType);
        }

        // --- 统一模型选择器引擎 ---
        async function openUnifiedModelSelector(context, type = null) {
            window.currentModelSelectorContext = context;
            window.currentOtherApiType = type;
            let url, key, targetUrl;
            let useProxy = true;  // 默认走代理

            // 1. 根据 context 获取中转站的 URL 和 API Key
            if (context === 'new') {
                url = document.getElementById('new-config-url').value.trim();
                key = document.getElementById('new-config-key').value.trim();
                if (!url || !key) return alert('请先输入API URL和API Key');
                // 新建配置时默认走 Worker，用户可在保存后修改开关
                useProxy = true;
            } else if (context === 'main') {
                if (!CHAT_API_CONFIGS.currentId) return alert('请先选择一个配置');
                const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
                if (!config) return alert('配置不存在');
                url = config.url;
                key = config.key;
                useProxy = config.useProxy !== false; // 如果未定义则默认为 true
            } else if (context === 'other') {
                if (!OTHER_API_CONFIGS[type] || !OTHER_API_CONFIGS[type].configId) return alert('请先选择一个配置');
                const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS[type].configId);
                if (!config) return alert('配置不存在');
                url = config.url;
                key = config.key;
                useProxy = config.useProxy !== false;
            }

            targetUrl = getStandardApiUrl(url, '/models');

            const modelInput = document.getElementById('new-config-model');
            const originalPlaceholder = modelInput.placeholder;
            if (context === 'new') modelInput.placeholder = '正在拉取模型...';

            try {
                let response;
                if (useProxy) {
                    // 走 Worker 代理
                    response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'list_models',
                            customEndpoint: targetUrl,
                            customApiKey: key
                        })
                    });
                } else {
                    // 直接请求
                    response = await fetch(targetUrl, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${key}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    });
                }

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

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
                
                // 🌟 Fix 1：将新选择的模型同步回写到当前配置对象中
                const config = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
                if (config) config.model = modelId;
                
                saveChatApiConfigs();
                updateChatConfigDisplay();
            } else if (ctx === 'other') {
                const type = window.currentOtherApiType;
                OTHER_API_CONFIGS[type].model = modelId;
                
                // 🌟 Fix 1：将新选择的模型同步回写到Other API配置对象中
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
        
        // --- 初始化Chat API配置系统 ---
        function initChatApiConfigSystem() {
            loadChatApiConfigs();
            
            // 点击弹窗外部关闭
            document.getElementById('chat-config-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('show');
                }
            });
            
            document.getElementById('new-config-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    closeNewConfigForm();
                }
            });
            
            document.getElementById('model-selector-modal').addEventListener('click', function(e) {
                if (e.target === this) {
                    this.classList.remove('show');
                }
            });
        }
        
        // 在页面加载时初始化
        initChatApiConfigSystem();
        
        // ==========================================
        // 参数配置功能
        // ==========================================
        
        // --- 参数配置数据结构 ---
        const PARAM_CONFIG = {
            stream: true, // 流式输出
            temperature: 0.7, // 温度 (0.1 - 2.0)
            maxTokens: 2048, // 最大长度 (256 - 4096)
            frequencyPenalty: 0.0, // 频率惩罚
            presencePenalty: 0.0 // 存在惩罚
        };
        
        // --- 加载参数配置 ---
        function loadParamConfig() {
            try {
                const saved = localStorage.getItem('PARAM_CONFIG');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(PARAM_CONFIG, parsed);
                }
                
                // 更新UI显示
                updateStreamSwitchUI();
                updateTemperatureUI();
                updateMaxTokensUI();
                updateFrequencyUI();
                updatePresenceUI();

                
            } catch(e) {
                console.error('加载参数配置失败:', e);
            }
        }
        
        // --- 保存参数配置 ---
        function saveParamConfig() {
            try {
                localStorage.setItem('PARAM_CONFIG', JSON.stringify(PARAM_CONFIG));
            } catch(e) {
                console.error('保存参数配置失败:', e);
            }
        }
        
        // --- 切换流式输出 ---
        function toggleStreamOutput() {
            PARAM_CONFIG.stream = !PARAM_CONFIG.stream;
            updateStreamSwitchUI();
            saveParamConfig();
        }
        
        // --- 更新流式输出开关UI ---
        function updateStreamSwitchUI() {
            const switchEl = document.getElementById('stream-switch');
            if (!switchEl) return;
            
            if (PARAM_CONFIG.stream) {
                switchEl.classList.add('active');
            } else {
                switchEl.classList.remove('active');
            }
        }
        
        // --- 更新温度显示 ---
        function updateTemperatureUI() {
            const display = document.getElementById('temperature-display');
            const thumb = document.getElementById('temperature-thumb');
            
            if (display) {
                display.textContent = PARAM_CONFIG.temperature.toFixed(1);
            }
            
            if (thumb) {
                // 计算滑块位置 (0.1-2.0 映射到 0-100%)
                const min = 0.1;
                const max = 2.0;
                const percent = ((PARAM_CONFIG.temperature - min) / (max - min)) * 100;
                thumb.style.left = percent + '%';
            }
        }
        
        // --- 更新Max Tokens显示 ---
        function updateMaxTokensUI() {
            const display = document.getElementById('max-tokens-display');
            const thumb = document.getElementById('max-tokens-thumb');
            
            if (display) {
                display.textContent = PARAM_CONFIG.maxTokens;
            }
            
            if (thumb) {
                // 计算滑块位置 (256-4096 映射到 0-100%)
                const min = 256;
                const max = 4096;
                const percent = ((PARAM_CONFIG.maxTokens - min) / (max - min)) * 100;
                thumb.style.left = percent + '%';
            }
        }
        
        // --- 初始化温度滑块 ---
        function initTemperatureSlider() {
            const track = document.getElementById('temperature-track');
            const thumb = document.getElementById('temperature-thumb');
            
            if (!track || !thumb) return;
            
            let isDragging = false;
            const min = 0.1;
            const max = 2.0;
            
            const updateValue = (clientX) => {
                const rect = track.getBoundingClientRect();
                let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                let value = min + (percent / 100) * (max - min);
                value = Math.round(value * 10) / 10; // 保留一位小数
                
                PARAM_CONFIG.temperature = value;
                thumb.style.left = percent + '%';
                document.getElementById('temperature-display').textContent = value.toFixed(1);
                saveParamConfig();
            };
            
            // 鼠标事件
            track.addEventListener('mousedown', (e) => {
                isDragging = true;
                updateValue(e.clientX);
            });
            
            document.addEventListener('mousemove', (e) => {
                if (isDragging) updateValue(e.clientX);
            });
            
            document.addEventListener('mouseup', () => {
                isDragging = false;
            });
            
            // 触摸事件
            thumb.addEventListener('touchstart', (e) => {
                isDragging = true;
                e.preventDefault();
            });
            
            document.addEventListener('touchmove', (e) => {
                if (isDragging && e.touches[0]) {
                    updateValue(e.touches[0].clientX);
                }
            });
            
            document.addEventListener('touchend', () => {
                isDragging = false;
            });
        }
        
        // --- 更新频率惩罚显示 ---
        function updateFrequencyUI() {
            const display = document.getElementById('frequency-display');
            const thumb = document.getElementById('frequency-thumb');
            if (display) display.textContent = PARAM_CONFIG.frequencyPenalty.toFixed(1);
            if (thumb) {
                const percent = (PARAM_CONFIG.frequencyPenalty / 2.0) * 100;
                thumb.style.left = percent + '%';
            }
        }

        // --- 更新存在惩罚显示 ---
        function updatePresenceUI() {
            const display = document.getElementById('presence-display');
            const thumb = document.getElementById('presence-thumb');
            if (display) display.textContent = PARAM_CONFIG.presencePenalty.toFixed(1);
            if (thumb) {
                const percent = (PARAM_CONFIG.presencePenalty / 2.0) * 100;
                thumb.style.left = percent + '%';
            }
        }

        // --- 初始化频率惩罚滑块 ---
        function initFrequencySlider() {
            const track = document.getElementById('frequency-track');
            const thumb = document.getElementById('frequency-thumb');
            if (!track || !thumb) return;
            let isDragging = false;
            const updateValue = (clientX) => {
                const rect = track.getBoundingClientRect();
                let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                let value = (percent / 100) * 2.0;
                value = Math.round(value * 10) / 10;
                PARAM_CONFIG.frequencyPenalty = value;
                thumb.style.left = percent + '%';
                document.getElementById('frequency-display').textContent = value.toFixed(1);
                saveParamConfig();
            };
            track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
            document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
            document.addEventListener('mouseup', () => { isDragging = false; });
            thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
            document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
            document.addEventListener('touchend', () => { isDragging = false; });
        }

        // --- 初始化存在惩罚滑块 ---
        function initPresenceSlider() {
            const track = document.getElementById('presence-track');
            const thumb = document.getElementById('presence-thumb');
            if (!track || !thumb) return;
            let isDragging = false;
            const updateValue = (clientX) => {
                const rect = track.getBoundingClientRect();
                let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                let value = (percent / 100) * 2.0;
                value = Math.round(value * 10) / 10;
                PARAM_CONFIG.presencePenalty = value;
                thumb.style.left = percent + '%';
                document.getElementById('presence-display').textContent = value.toFixed(1);
                saveParamConfig();
            };
            track.addEventListener('mousedown', (e) => { isDragging = true; updateValue(e.clientX); });
            document.addEventListener('mousemove', (e) => { if (isDragging) updateValue(e.clientX); });
            document.addEventListener('mouseup', () => { isDragging = false; });
            thumb.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); });
            document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateValue(e.touches[0].clientX); });
            document.addEventListener('touchend', () => { isDragging = false; });
        }

        // --- 初始化Max Tokens滑块 ---
        function initMaxTokensSlider() {
            const track = document.getElementById('max-tokens-track');
            const thumb = document.getElementById('max-tokens-thumb');
            
            if (!track || !thumb) return;
            
            let isDragging = false;
            const min = 256;
            const max = 4096;
            
            const updateValue = (clientX) => {
                const rect = track.getBoundingClientRect();
                let percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
                let value = min + (percent / 100) * (max - min);
                
                // 以128为步进
                value = Math.round(value / 128) * 128;
                value = Math.max(min, Math.min(max, value));
                
                PARAM_CONFIG.maxTokens = value;
                thumb.style.left = ((value - min) / (max - min)) * 100 + '%';
                document.getElementById('max-tokens-display').textContent = value;
                saveParamConfig();
            };
            
            // 鼠标事件
            track.addEventListener('mousedown', (e) => {
                isDragging = true;
                updateValue(e.clientX);
            });
            
            document.addEventListener('mousemove', (e) => {
                if (isDragging) updateValue(e.clientX);
            });
            
            document.addEventListener('mouseup', () => {
                isDragging = false;
            });
            
            // 触摸事件
            thumb.addEventListener('touchstart', (e) => {
                isDragging = true;
                e.preventDefault();
            });
            
            document.addEventListener('touchmove', (e) => {
                if (isDragging && e.touches[0]) {
                    updateValue(e.touches[0].clientX);
                }
            });
            
            document.addEventListener('touchend', () => {
                isDragging = false;
            });
        }
        
        // --- 初始化参数配置系统 ---
        function initParamConfigSystem() {
            loadParamConfig();
            initTemperatureSlider();
            initMaxTokensSlider();
            initFrequencySlider();
            initPresenceSlider();
        }
        
        // 在页面加载时初始化参数配置
        initParamConfigSystem();
        
        // ==========================================
        // 头像管理功能
        // ==========================================
        
        // --- 头像配置数据结构 ---
        const AVATAR_CONFIG = {
            ai: null,      // AI头像（base64）
            user: null,    // 用户头像（base64）
            mode: 'both'   // 显示模式：both/none/ai-only/user-only
        };
        
        // --- 头像显示模式选项 ---
        const AVATAR_MODES = {
            'both': { name: 'AI和我都显示', icon: 'fa-eye' },
            'none': { name: 'AI和我都不显示', icon: 'fa-eye-slash' },
            'ai-only': { name: '只显示AI', icon: 'fa-robot' },
            'user-only': { name: '只显示我', icon: 'fa-user' }
        };
        
        // --- 加载头像配置 ---
        function loadAvatarConfig() {
            try {
                const saved = localStorage.getItem('AVATAR_CONFIG');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(AVATAR_CONFIG, parsed);
                }
                updateAvatarPreviews();
                updateAvatarModeDisplay();
            } catch(e) {
                console.error('加载头像配置失败:', e);
            }
        }
        
        // --- 保存头像配置 ---
        function saveAvatarConfig() {
            try {
                localStorage.setItem('AVATAR_CONFIG', JSON.stringify(AVATAR_CONFIG));
            } catch(e) {
                console.error('保存头像配置失败:', e);
            }
        }
        
        // --- 上传AI头像 ---
        function uploadAiAvatar() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    AVATAR_CONFIG.ai = event.target.result;
                    saveAvatarConfig();
                    updateAvatarPreviews();
                    
                    // 同步到所有聊天角色
                    syncAvatarToAllContacts();
                };
                reader.readAsDataURL(file);
            };
            
            input.click();
        }
        
        // --- 同步头像到所有角色 ---
        function syncAvatarToAllContacts() {
            if (!AVATAR_CONFIG.ai) return;
            
            // 更新所有角色的头像
            mockContacts.forEach(contact => {
                contact.avatar = AVATAR_CONFIG.ai;
            });
            
            // 保存到localStorage（如果需要持久化）
            saveToLocal();
            
            // 重新渲染聊天列表
            renderChatList();
            
            console.log('✅ 已同步头像到所有角色，共 ' + mockContacts.length + ' 个');
        }
        
        // --- 上传用户头像 ---
        function uploadUserAvatar() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    AVATAR_CONFIG.user = event.target.result;
                    saveAvatarConfig();
                    updateAvatarPreviews();
                };
                reader.readAsDataURL(file);
            };
            
            input.click();
        }
        
        // --- 更新头像预览 ---
        function updateAvatarPreviews() {
            const aiPreview = document.getElementById('ai-avatar-preview');
            const userPreview = document.getElementById('user-avatar-preview');
            
            if (aiPreview) {
                if (AVATAR_CONFIG.ai) {
                    aiPreview.innerHTML = `<img src="${AVATAR_CONFIG.ai}" style="width: 100%; height: 100%; object-fit: cover;">`;
                } else {
                    aiPreview.innerHTML = '<i class="fas fa-robot" style="font-size: 28px; color: #666;"></i>';
                }
            }
            
            if (userPreview) {
                if (AVATAR_CONFIG.user) {
                    userPreview.innerHTML = `<img src="${AVATAR_CONFIG.user}" style="width: 100%; height: 100%; object-fit: cover;">`;
                } else {
                    userPreview.innerHTML = '<i class="fas fa-user" style="font-size: 28px; color: #666;"></i>';
                }
            }
        }
        
        // --- 更新头像模式显示 ---
        function updateAvatarModeDisplay() {
            const display = document.getElementById('avatar-mode-display');
            const iconEl = document.getElementById('avatar-mode-icon');
            
            if (!display) return;
            
            const mode = AVATAR_MODES[AVATAR_CONFIG.mode];
            if (mode) {
                display.textContent = mode.name;
                
                // 更新主界面图标
                if (iconEl) {
                    iconEl.className = `fas ${mode.icon}`;
                }
            }
        }
        
        // --- 打开头像模式选择器 ---
        function openAvatarModeSelector() {
            const modal = document.createElement('div');
            modal.className = 'config-modal-overlay';
            modal.style.zIndex = '4000';
            
            modal.innerHTML = `
                <div class="config-modal-content" style="max-width: 85%; width: 360px;">
                    <div class="config-modal-header">
                        <h3 class="config-modal-title">头像显示模式</h3>
                    </div>
                    
                    <div class="config-modal-body" style="padding: 0;">
                        ${Object.keys(AVATAR_MODES).map(key => {
                            const mode = AVATAR_MODES[key];
                            const isActive = AVATAR_CONFIG.mode === key;
                            return `
                                <div class="config-list-item" onclick="selectAvatarMode('${key}')" style="cursor: pointer;">
                                    <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                                        <i class="fas ${mode.icon}" style="font-size: 18px; color: ${isActive ? 'var(--accent)' : '#666'};"></i>
                                        <div style="font-size: 15px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? 'var(--accent)' : 'var(--text-main)'};">${mode.name}</div>
                                    </div>
                                    ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
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
                    closeAvatarModeSelector();
                }
            });
            
            window.currentAvatarModal = modal;
        }
        
        // --- 选择头像模式 ---
        function selectAvatarMode(mode) {
            AVATAR_CONFIG.mode = mode;
            saveAvatarConfig();
            
            // 更新显示文本和主界面图标
            updateAvatarModeDisplay();
            
            closeAvatarModeSelector();
        }
        
        // --- 关闭头像模式选择器 ---
        function closeAvatarModeSelector() {
            if (window.currentAvatarModal) {
                window.currentAvatarModal.classList.remove('show');
                setTimeout(() => {
                    if (window.currentAvatarModal) {
                        window.currentAvatarModal.remove();
                        window.currentAvatarModal = null;
                    }
                }, 300);
            }
        }
        
        // --- 初始化头像管理系统 ---
        function initAvatarManagement() {
            loadAvatarConfig();
        }
        
        // 页面加载时初始化头像管理
        initAvatarManagement();
        
        // ==========================================
        // 重新生成功能 JavaScript
        // ==========================================
        
        let currentRegenerateBtn = null;
        
        // --- 切换重新生成按钮显示 ---
        function toggleRegenerate(messageEl) {
            const btn = messageEl.querySelector('.regenerate-btn');
            if (!btn) {
                console.log('⚠️ 未找到重新生成按钮');
                return;
            }
            
            // 隐藏其他所有按钮
            document.querySelectorAll('.regenerate-btn').forEach(b => {
                if (b !== btn) {
                    b.classList.remove('show');
                }
            });
            
            // 切换当前按钮（点击一次显示，再点击一次隐藏）
            if (btn.classList.contains('show')) {
                btn.classList.remove('show');
                currentRegenerateBtn = null;
            } else {
                // 🔥 关键修复：多重等待确保DOM和动画完全完成
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            // 计算按钮位置（与气泡同高）
                            const bubbleRect = messageEl.querySelector('.chat-bubble').getBoundingClientRect();
                            const newTop = bubbleRect.top + bubbleRect.height / 2 + 'px';
                            
                            // console.log('🎯 计算按钮位置:', newTop, '气泡高度:', bubbleRect.height);
                            
                            // 禁用transition，立即设置位置
                            btn.style.transition = 'none';
                            btn.style.top = newTop;
                            
                            // 强制重绘
                            btn.offsetHeight;
                            
                            // 恢复transition，显示按钮
                            requestAnimationFrame(() => {
                                btn.style.transition = '';
                                btn.classList.add('show');
                            });
                            
                            currentRegenerateBtn = btn;
                        });
                    });
                });
            }
        }
        
        // --- 重新生成响应 ---
        function regenerateMessage(event, btn) {
            event.stopPropagation();
            
            if (!currentChatContactId) return;
            
            // 隐藏按钮
            btn.classList.remove('show');
            currentRegenerateBtn = null;
            
            // 调用重新生成函数
            regenerateResponse(currentChatContactId, null, null, (error) => {
                console.error('重新生成失败:', error);
            });
        }
        
        // --- 点击其他地方隐藏按钮 ---
        document.addEventListener('click', (e) => {
            // 检查点击目标
            const isAiMessage = e.target.closest('.chat-message.ai');
            const isRegenerateBtn = e.target.closest('.regenerate-btn');
            
            // 如果点击的不是AI消息也不是按钮本身，隐藏所有按钮
            if (!isAiMessage && !isRegenerateBtn) {
                document.querySelectorAll('.regenerate-btn').forEach(btn => {
                    btn.classList.remove('show');
                });
                currentRegenerateBtn = null;
            }
        });
        
        // --- 滚动时隐藏按钮 ---
        let lastRegenerateScrollTop = 0;
        const chatMessagesContainer = document.getElementById('chat-messages-container');
        if (chatMessagesContainer) {
            chatMessagesContainer.addEventListener('scroll', () => {
                const scrollTop = chatMessagesContainer.scrollTop;
                if (Math.abs(scrollTop - lastRegenerateScrollTop) > 30) {
                    document.querySelectorAll('.regenerate-btn').forEach(btn => {
                        btn.classList.remove('show');
                    });
                    currentRegenerateBtn = null;
                }
                lastRegenerateScrollTop = scrollTop;
            }, { passive: true });
        }
        
        // --- 触摸滑动时隐藏按钮 ---
        let regenerateTouchStartX = 0;
        let regenerateTouchStartY = 0;
        document.addEventListener('touchstart', (e) => {
            regenerateTouchStartX = e.touches[0].clientX;
            regenerateTouchStartY = e.touches[0].clientY;
        });
        
        document.addEventListener('touchmove', (e) => {
            const touchX = e.touches[0].clientX;
            const touchY = e.touches[0].clientY;
            const deltaX = Math.abs(touchX - regenerateTouchStartX);
            const deltaY = Math.abs(touchY - regenerateTouchStartY);
            
            if (deltaX > 20 || deltaY > 20) {
                document.querySelectorAll('.regenerate-btn').forEach(btn => {
                    btn.classList.remove('show');
                });
                currentRegenerateBtn = null;
            }
        });
        
        // ==========================================
        // Other API配置功能（多功能版本）
        // ==========================================
        
        // --- Other API配置数据结构 ---
        const OTHER_API_CONFIGS = {
            memory: { // 长期记忆补全
                configId: null,
                model: ''
            },
            discover: { // 发现API（已从 image 修正为 discover）
                configId: null,
                model: ''
            },
            voice: { // AI语音
                configId: null,
                model: ''
            }
        };

        let currentOtherApiType = ''; // 当前正在配置的API类型

        // --- 控制 OTHER API 的折叠与展开 ---
        function toggleOtherAPI() {
            const container = document.getElementById('other-api-container');
            const icon = document.getElementById('other-api-toggle-icon');
            
            if (container.style.maxHeight === '0px' || container.style.maxHeight === '') {
                // 展开：给一个足够容纳三个模块的高度
                container.style.maxHeight = '800px'; 
                icon.style.transform = 'rotate(90deg)';
            } else {
                // 收起
                container.style.maxHeight = '0px';
                icon.style.transform = 'rotate(0deg)';
            }
        }
        // --- 加载Other API配置 ---
        function loadOtherApiConfigs() {
            try {
                const saved = localStorage.getItem('OTHER_API_CONFIGS');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // 兼容旧版本数据，把旧的 image 配置转移给 discover
                    if (parsed.image && !parsed.discover) {
                        parsed.discover = parsed.image;
                        delete parsed.image;
                    }
                    Object.assign(OTHER_API_CONFIGS, parsed);
                }
                updateOtherConfigDisplay();
            } catch(e) {
                console.error('加载Other API配置失败:', e);
            }
        }

        // --- 保存Other API配置 ---
        function saveOtherApiConfigs() {
            try {
                localStorage.setItem('OTHER_API_CONFIGS', JSON.stringify(OTHER_API_CONFIGS));
            } catch(e) {
                console.error('保存Other API配置失败:', e);
            }
        }

        // --- 更新显示Other API配置 ---
        function updateOtherConfigDisplay() {
            // 1. 更新长期记忆配置
            const memoryConfigInput = document.getElementById('memory-config-name');
            const memoryModelInput = document.getElementById('memory-current-model');
            if (memoryConfigInput && memoryModelInput) {
                if (OTHER_API_CONFIGS.memory.configId) {
                    const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.memory.configId);
                    memoryConfigInput.value = config ? config.name : '点击选择配置';
                } else {
                    memoryConfigInput.value = '点击选择配置';
                }
                memoryModelInput.value = OTHER_API_CONFIGS.memory.model || '';
            }

            // 2. 更新发现配置（修复：使用 discover 相关 ID）
            const discoverConfigInput = document.getElementById('discover-config-name');
            const discoverModelInput = document.getElementById('discover-current-model');
            if (discoverConfigInput && discoverModelInput) {
                if (OTHER_API_CONFIGS.discover.configId) {
                    const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.discover.configId);
                    discoverConfigInput.value = config ? config.name : '点击选择配置';
                } else {
                    discoverConfigInput.value = '点击选择配置';
                }
                discoverModelInput.value = OTHER_API_CONFIGS.discover.model || '';
            }

            // 3. 更新语音配置
            const voiceConfigInput = document.getElementById('voice-config-name');
            const voiceModelInput = document.getElementById('voice-current-model');
            if (voiceConfigInput && voiceModelInput) {
                if (OTHER_API_CONFIGS.voice.configId) {
                    const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS.voice.configId);
                    voiceConfigInput.value = config ? config.name : '点击选择配置';
                } else {
                    voiceConfigInput.value = '点击选择配置';
                }
                voiceModelInput.value = OTHER_API_CONFIGS.voice.model || '';
            }
        }
        
        // --- 打开Other API配置选择器 ---
        function openOtherConfigSelector(apiType) {
            currentOtherApiType = apiType; // 记录当前操作的API类型
            const modal = document.getElementById('chat-config-modal');
            const listContainer = document.getElementById('chat-config-list');
            
            // 修改弹窗标题
            const title = modal.querySelector('.config-modal-title');
            if (title) title.textContent = '选择配置';
            
            // 渲染配置列表（使用Chat API的配置列表）
            listContainer.innerHTML = '';
            
            if (CHAT_API_CONFIGS.list.length === 0) {
                listContainer.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 36px; margin-bottom: 12px; opacity: 0.5;"></i>
                        <p style="font-size: 14px;">暂无配置，请新建</p>
                    </div>
                `;
            } else {
                // 🎯 修复1：将当前选中的配置排在最上面
                const activeId = OTHER_API_CONFIGS[apiType]?.configId;
                const sortedConfigs = [...CHAT_API_CONFIGS.list].sort((a, b) => {
                    const isAActive = a.id === activeId;
                    const isBActive = b.id === activeId;
                    if (isAActive && !isBActive) return -1;
                    if (!isAActive && isBActive) return 1;
                    return b.id - a.id;
                });
                
                sortedConfigs.forEach(config => {
                    // 创建滑动容器
                    const wrapper = document.createElement('div');
                    wrapper.className = 'config-item-wrapper';
                    
                    // 创建操作按钮层（背景）
                    const actions = document.createElement('div');
                    actions.className = 'config-item-actions';
                    actions.innerHTML = `
                    <div class="config-action-btn config-action-edit" onclick="event.stopPropagation(); editChatConfig(${config.id});"><i class="fa-solid fa-pen-to-square"></i></div>
                    <div class="config-action-btn config-action-delete" onclick="event.stopPropagation(); deleteChatConfig(${config.id});"><i class="fa-solid fa-trash-can"></i></div>
                `;
                    
                    // 创建配置项内容层（前景，可滑动）
                    const item = document.createElement('div');
                    item.className = 'config-list-item config-list-item-swipeable';
                    
                const isActive = config.id === OTHER_API_CONFIGS[apiType]?.configId;
                
                item.innerHTML = `
                    <div class="config-item-info">
                        <div class="config-item-name" style="color: ${isActive ? '#0A84FF' : 'var(--text-main)'}; font-weight: ${isActive ? '600' : '500'};">${config.name}</div>
                        <div class="config-item-model">${config.model || '未选择模型'}</div>
                    </div>
                    ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
                `;
                    
                    item.onclick = (e) => {
                        // 如果已滑开，点击收回（不关闭弹窗）
                        if (item.style.transform === 'translateX(-110px)') {
                            resetConfigSwipe(item);
                            e.stopPropagation();
                        } else {
                            selectOtherConfig(config.id);
                        }
                    };
                    
                    // 添加滑动事件
                    addConfigSwipeHandler(item);
                    
                    wrapper.appendChild(actions);
                    wrapper.appendChild(item);
                    listContainer.appendChild(wrapper);
                });
            }
            
            // 修改"新建配置"按钮的点击事件
            const newBtn = modal.querySelector('.config-new-btn');
            if (newBtn) {
                newBtn.onclick = showNewOtherConfigForm;
            }
            
            // 显示弹窗
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }
        
        // --- 选择Other API配置 ---
        function selectOtherConfig(configId) {
            const config = CHAT_API_CONFIGS.list.find(c => c.id === configId);
            if (!config) return;
            
            // 根据当前操作的API类型，更新对应的配置
            if (currentOtherApiType && OTHER_API_CONFIGS[currentOtherApiType]) {
                OTHER_API_CONFIGS[currentOtherApiType].configId = configId;
                OTHER_API_CONFIGS[currentOtherApiType].model = config.model || '';
            }
            
            saveOtherApiConfigs();
            updateOtherConfigDisplay();
            
            // 重新渲染列表以更新选中状态，但不关闭弹窗
            openOtherConfigSelector(currentOtherApiType);
        }
        
        // --- 关闭Other API配置选择器 ---
        function closeOtherConfigSelector() {
            const modal = document.getElementById('chat-config-modal');
            modal.classList.remove('show');
            
            // 恢复弹窗标题
            const title = modal.querySelector('.config-modal-title');
            if (title) title.textContent = '选择配置';
        }
        
        // --- 显示新建Other API配置表单 ---
        function showNewOtherConfigForm() {
            const configModal = document.getElementById('chat-config-modal');
            const newConfigModal = document.getElementById('new-config-modal');
            
            // 准备新建配置弹窗
            document.getElementById('config-form-title').textContent = '新建Other API配置';
            document.getElementById('new-config-name').value = '';
            document.getElementById('new-config-url').value = '';
            document.getElementById('new-config-key').value = '';
            document.getElementById('new-config-model').value = '';
            
            // 标记这是Other API的新建表单
            newConfigModal.dataset.configType = 'other';
            
            // 关闭配置选择器 + 打开新建表单
            configModal.classList.remove('show');
            
            requestAnimationFrame(() => {
                newConfigModal.classList.add('show');
            });
        }
        
        // --- 打开Other API模型选择器 ---
        async function openOtherModelSelector(apiType) {
            currentOtherApiType = apiType; // 记录当前操作的API类型
            
            if (!OTHER_API_CONFIGS[apiType] || !OTHER_API_CONFIGS[apiType].configId) {
                alert('请先选择一个配置');
                return;
            }
            
            const config = CHAT_API_CONFIGS.list.find(c => c.id === OTHER_API_CONFIGS[apiType].configId);
            if (!config) {
                alert('配置不存在');
                return;
            }
            
            // 拉取模型列表
            try {
                let modelsUrl = getStandardApiUrl(config.url, '/models');
                
                console.log('=== Other API拉取模型 ===');
                console.log('API类型:', apiType);
                console.log('原始URL:', config.url);
                console.log('Models URL:', modelsUrl);
                
                // 🌟 核心修复：把请求发给安全的 Worker 桥梁
                const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                if (!response.ok) {
                    throw new Error(`拉取失败: ${response.status}`);
                }
                
                const data = await response.json();
                
                if (data.data && Array.isArray(data.data)) {
                    availableModels = data.data.map(m => m.id).sort();
                    
                    if (availableModels.length === 0) {
                        alert('未找到可用模型');
                        return;
                    }
                    
                    // 显示模型选择器（Other API版本）
                    showOtherModelSelector();
                } else {
                    throw new Error('API返回格式错误');
                }
                
            } catch (error) {
                console.error('拉取模型失败:', error);
                alert('拉取模型失败: ' + error.message);
            }
        }
        
        // --- 显示Other API模型选择器 ---
        function showOtherModelSelector() {
            window.currentModelSelectorContext = 'other';
            const modal = document.getElementById('model-selector-modal');
            const listContainer = document.getElementById('model-list-container');
            const searchInput = document.getElementById('model-search-input');
            
            searchInput.value = '';
            renderOtherModelList(availableModels);
            
            requestAnimationFrame(() => {
                modal.classList.add('show');
                // 强制模型列表滚动回顶部
                const listContainer = document.getElementById('model-list-container');
                if (listContainer) listContainer.scrollTop = 0;
            });
        }
        
        // --- 渲染Other API模型列表 ---
        function renderOtherModelList(models) {
            const listContainer = document.getElementById('model-list-container');
            listContainer.innerHTML = '';
            
            if (models.length === 0) {
                listContainer.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: var(--text-sub);">
                        <p style="font-size: 14px;">未找到匹配的模型</p>
                    </div>
                `;
                return;
            }
            
            // 获取当前API类型的模型
            const currentModel = currentOtherApiType && OTHER_API_CONFIGS[currentOtherApiType] 
                ? OTHER_API_CONFIGS[currentOtherApiType].model 
                : '';
            
            models.forEach(modelId => {
                const item = document.createElement('div');
                item.className = 'config-list-item';
                
                const isActive = modelId === currentModel;
                
                item.innerHTML = `
                    <div class="config-item-info">
                        <div class="config-item-name" style="font-size: 14px; font-weight: ${isActive ? '600' : '500'}; color: ${isActive ? '#0A84FF' : 'var(--text-main)'};">${modelId}</div>
                    </div>
                    ${isActive ? '<div class="config-item-check"><i class="fas fa-check"></i></div>' : ''}
                `;
                
                item.onclick = () => selectOtherModel(modelId);
                listContainer.appendChild(item);
            });
        }
        
        // --- 选择Other API模型 ---
        function selectOtherModel(modelId) {
            // 根据当前操作的API类型，更新对应的模型
            if (currentOtherApiType && OTHER_API_CONFIGS[currentOtherApiType]) {
                OTHER_API_CONFIGS[currentOtherApiType].model = modelId;
            }
            
            saveOtherApiConfigs();
            updateOtherConfigDisplay();
            closeModelSelector();
        }
        
        // --- 初始化Other API配置系统 ---
        function initOtherApiConfigSystem() {
            loadOtherApiConfigs();
        }
        
        // 在页面加载时初始化Other API配置
        initOtherApiConfigSystem();
        
        // ==========================================
        // API URL自动补全功能
        // ==========================================
        
        // --- API URL智能处理（移除/chat/completions，保留基础URL） ---
        function autoCompleteApiUrl(input) {
            let value = input.value.trim();
            
            // 如果输入为空，不处理
            if (!value) return;
            
            // 如果包含 /chat/completions，自动移除（因为Worker会自动添加）
            if (value.includes('/chat/completions')) {
                value = value.replace(/\/chat\/completions.*$/, '');
                input.value = value;
            }
            
            // 如果以 / 结尾，移除末尾的 /
            if (value.endsWith('/')) {
                value = value.slice(0, -1);
                input.value = value;
            }
        }
        
        // ==========================================
        // 通用页面功能函数
        // ==========================================
        
        // --- 通用页面配置数据结构 ---
        const GENERAL_CONFIG = {
            memory: {
                contextLimit: 10,
                diaryInterval: 10,
                maxTokens: 4000
            },
            notification: {
                pushEnabled: false,
                showContent: true,
                keepAlive: false
            },
            regexCount: 0,
            presetCount: 0
        };
        
        // --- 加载通用配置 ---
        function loadGeneralConfig() {
            try {
                const saved = localStorage.getItem('GENERAL_CONFIG');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(GENERAL_CONFIG, parsed);
                }
                updateGeneralUI();
            } catch(e) {
                console.error('加载通用配置失败:', e);
            }
        }
        
        // --- 保存通用配置 ---
        function saveGeneralConfig() {
            try {
                localStorage.setItem('GENERAL_CONFIG', JSON.stringify(GENERAL_CONFIG));
            } catch(e) {
                console.error('保存通用配置失败:', e);
            }
        }
        
        // --- 更新通用页面UI ---
        function updateGeneralUI() {
            // 更新记忆配置输入框
            const contextInput = document.getElementById('general-context-limit');
            const diaryInput = document.getElementById('general-diary-interval');
            const tokensInput = document.getElementById('general-max-tokens');
            
            if (contextInput) contextInput.value = GENERAL_CONFIG.memory.contextLimit;
            if (diaryInput) diaryInput.value = GENERAL_CONFIG.memory.diaryInterval;
            if (tokensInput) tokensInput.value = GENERAL_CONFIG.memory.maxTokens;
            
            // 更新通知开关状态
            updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled);
            updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent);
            updateGeneralSwitch('general-keepalive-switch', GENERAL_CONFIG.notification.keepAlive);
            
            // 更新缓存使用
            updateGeneralCacheSize();
            
            // 更新计数
            const regexCount = document.getElementById('general-regex-count');
            const presetCount = document.getElementById('general-preset-count');
            if (regexCount) regexCount.textContent = GENERAL_CONFIG.regexCount + ' 条';
            if (presetCount) presetCount.textContent = GENERAL_CONFIG.presetCount + ' 个';
        }
        
        // --- 更新开关状态 ---
        function updateGeneralSwitch(switchId, isActive) {
            const switchEl = document.getElementById(switchId);
            if (!switchEl) return;
            
            if (isActive) {
                switchEl.classList.add('active');
            } else {
                switchEl.classList.remove('active');
            }
        }
        
        // --- 更新记忆配置 ---
        function updateGeneralMemoryConfig(key, value) {
            const numValue = parseInt(value);
            if (isNaN(numValue) || numValue < 1) return;
            
            GENERAL_CONFIG.memory[key] = numValue;
            saveGeneralConfig();
            
            // 同步到APP_DATA（如果存在）
            if (window.APP_DATA && window.APP_DATA.settings) {
                if (key === 'contextLimit') window.APP_DATA.settings.contextLimit = numValue;
                if (key === 'diaryInterval') window.APP_DATA.settings.diaryInterval = numValue;
                if (key === 'maxTokens') MEMORY_CONFIG.maxTokens = numValue;
            }
        }
        
        // --- 切换推送通知 (纯净 Bark 接管版) ---
        async function toggleGeneralPush() {
            // 直接切换开关状态，无需再向浏览器磕头要权限，Bark 就是这么霸道！
            GENERAL_CONFIG.notification.pushEnabled = !GENERAL_CONFIG.notification.pushEnabled;
            
            updateGeneralSwitch('general-push-switch', GENERAL_CONFIG.notification.pushEnabled);
            saveGeneralConfig();
            
            // 如果打开了通知，顺便发一条测试通知验证一下！
            if (GENERAL_CONFIG.notification.pushEnabled) {
                // 强制发一条测试（无视前台状态）
                const barkKey = 'JanxutGCNrZgNBjEsuaeen';
                fetch(`https://api.day.app/${barkKey}/Linkgo/推送通知已开启，后台回复将通过 Bark 送达！?group=Linkgo`);
            }
        }
        
        // --- 切换显示内容 ---
        function toggleGeneralContent() {
            GENERAL_CONFIG.notification.showContent = !GENERAL_CONFIG.notification.showContent;
            updateGeneralSwitch('general-content-switch', GENERAL_CONFIG.notification.showContent);
            saveGeneralConfig();
        }
        
        function toggleGeneralKeepAlive() {
            // 切换真实状态 (开变关，关变开)
            GENERAL_CONFIG.notification.keepAlive = !GENERAL_CONFIG.notification.keepAlive;
            
            // 更新页面上的 UI 按钮显示
            updateGeneralSwitch('general-keepalive-switch', GENERAL_CONFIG.notification.keepAlive);
            saveGeneralConfig();

            // ✨ 核心修复：严格根据状态执行！开就播放，关就暂停！绝对不再反向！
            if (GENERAL_CONFIG.notification.keepAlive === true) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
        }
        
        // --- 计算并更新缓存大小 ---
        async function updateGeneralCacheSize() {
            try {
                // 1. 计算localStorage总大小
                let totalSize = 0;
                for (let key in localStorage) {
                    if (localStorage.hasOwnProperty(key)) {
                        totalSize += localStorage[key].length + key.length;
                    }
                }
                
                let displaySize, unit;
                if (totalSize < 1024) {
                    displaySize = totalSize;
                    unit = 'B';
                } else if (totalSize < 1024 * 1024) {
                    displaySize = (totalSize / 1024).toFixed(1);
                    unit = 'KB';
                } else {
                    displaySize = (totalSize / (1024 * 1024)).toFixed(2);
                    unit = 'MB';
                }
                
                const sizeEl = document.getElementById('general-cache-size');
                const barEl = document.getElementById('general-cache-bar');
                if (sizeEl) sizeEl.textContent = displaySize + ' ' + unit;
                const maxSize = 5 * 1024 * 1024; // localStorage 最大5MB
                const percent = Math.min(100, (totalSize / maxSize) * 100);
                if (barEl) barEl.style.width = percent + '%';

                // 2. 计算大仓库 (localforage) 的大小
                let forageTotal = 0;
                await localforage.iterate((value, key) => {
                    const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
                    forageTotal += (valueStr.length + key.length) * 2; // JS中字符串一字符约占2字节
                });
                
                const forageSizeMB = (forageTotal / (1024 * 1024)).toFixed(2);
                const forageSizeEl = document.getElementById('forage-cache-size');
                const forageBarEl = document.getElementById('forage-cache-bar');
                
                if (forageSizeEl) forageSizeEl.textContent = forageSizeMB + ' MB';
                // 大仓库以 500MB 作为视觉上限计算进度条
                const maxForageSize = 500 * 1024 * 1024;
                const foragePercent = Math.min(100, (forageTotal / maxForageSize) * 100);
                if (forageBarEl) forageBarEl.style.width = foragePercent + '%';
                
            } catch(e) {
                console.error('计算缓存大小失败:', e);
            }
        }
        
       // ==========================================
        // 🎯 模块化导出与导入引擎 (数据解耦·极致瘦身纯净版)
        // ==========================================

        const DATA_CATEGORIES = {
            api: ['CHAT_API_CONFIGS', 'OTHER_API_CONFIGS', 'PARAM_CONFIG', 'MODEL_PARAMS'],
            appearance: ['AVATAR_CONFIG', 'themeMode', 'theme'], // 头像专属存放地
            general: ['GENERAL_CONFIG', 'MEMORY_CONFIG', 'PUSH_ENABLED', 'PUSH_SHOW_CONTENT', 'KEEP_ALIVE_ENABLED'],
            advanced: ['PRESETS', 'REGEX_RULES', 'ADVANCED_PRESET_FILES', 'ADVANCED_REGEX_FILES'],
            chat: ['APP_DATA', 'CHAT_CONTACTS'], // 只存纯文本
            heatmap: ['APP_DATA'], 
            forum: ['FORUM_POSTS']
        };

        const CATEGORY_NAMES = ['api', 'appearance', 'general', 'advanced', 'chat', 'heatmap', 'forum'];

        function toggleDataCheckbox(id) {
            const cb = document.getElementById(id);
            if (cb && cb.parentElement.style.opacity !== '0.5') { 
                cb.classList.toggle('checked');
            }
        }

        // --- 分类字典与兜底规则 ---
        const EXPORT_DICTIONARY = {
            chat: ['CHAT_CONTACTS'],          // 只存角色列表，对话记录单独处理
            interaction: ['ACTIVITY_STATS'],   // 互动视图数据
            api: ['CHAT_API_CONFIGS', 'OTHER_API_CONFIGS', 'MODEL_PARAMS', 'PARAM_CONFIG', 'MEMORY_CONFIG'],
            appearance: ['AVATAR_CONFIG', 'theme', 'themeMode'],
            general: ['GENERAL_CONFIG', 'PUSH_ENABLED', 'PUSH_SHOW_CONTENT', 'KEEP_ALIVE_ENABLED', 'RELOAD_TARGET_PAGE'],
            presets: ['PRESETS', 'ADVANCED_PRESET_FILES'],
            regex: ['REGEX_RULES', 'ADVANCED_REGEX_FILES'],
            forum: ['FORUM_POSTS']
        };

        // 1. 打开导出弹窗 (修复透明度Bug版)
        function openExportSheet() {
            const sheet = document.getElementById('export-sheet');
            sheet.style.display = ''; // 第一步：强行清除阻碍动画的 display: none
            
            // 第二步：稍微延迟一点点，加上你原生的 .show 类名，触发优美的上滑渐入动画！
            setTimeout(() => sheet.classList.add('show'), 10); 
            
            // 下面全选/取消全选的联动逻辑保持不变
            const checkboxes = document.querySelectorAll('.export-item-cb');
            const selectAllBtn = document.getElementById('export-select-all');
            checkboxes.forEach(cb => {
                cb.onchange = () => {
                    const allChecked = Array.from(checkboxes).every(c => c.checked);
                    selectAllBtn.checked = allChecked;
                };
            });
        }

        // 2. 关闭导出弹窗
        function closeExportSheet() {
            // 移除 .show 触发平滑收回动画
            document.getElementById('export-sheet').classList.remove('show');
        }

        // 3. 全选/取消全选联动逻辑
        function toggleAllExportCheckboxes(selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.export-item-cb');
            checkboxes.forEach(cb => {
                cb.checked = selectAllCheckbox.checked;
            });
        }

        // 4. 执行分类导出
        async function executeCategorizedExport() {
            await saveQueue; // 等待所有写入完成
            try {
                // 保存最新内存数据
                if (typeof saveToLocal === 'function') await saveToLocal();
                if (typeof saveChatApiConfigs === 'function') saveChatApiConfigs();
                if (typeof saveOtherApiConfigs === 'function') saveOtherApiConfigs();
                if (typeof saveGeneralConfig === 'function') saveGeneralConfig();

                // 获取用户勾选的分类
                const checkedCategories = Array.from(document.querySelectorAll('.export-item-cb'))
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);

                if (checkedCategories.length === 0) {
                    alert('请至少选择一项要导出的数据！');
                    return;
                }

                const snapshot = {};

                // 1. 处理普通 localStorage 键（按字典）
                const allLocalKeys = Object.keys(localStorage);
                allLocalKeys.forEach(key => {
                    // 检查这个键属于哪个分类
                    let owned = false;
                    for (let cat of checkedCategories) {
                        if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) {
                            snapshot[key] = localStorage.getItem(key);
                            owned = true;
                            break;
                        }
                    }
                });

                                // 2. 特殊处理：chat 分类需要从 DB 导出 CHAT_CONTACTS、APP_SETTINGS 和所有 CONV_*
                if (checkedCategories.includes('chat')) {
                    // 导出角色列表
                    let chatContacts = await DB.getItem('CHAT_CONTACTS');
                    if (!chatContacts) {
                        chatContacts = localStorage.getItem('CHAT_CONTACTS');
                    }
                    if (chatContacts) {
                        snapshot['CHAT_CONTACTS'] = chatContacts;
                    }
                    // 导出 APP_SETTINGS（包含 currentChatId 等）
                    let appSettings = await DB.getItem('APP_SETTINGS');
                    if (appSettings) {
                        snapshot['APP_SETTINGS'] = appSettings;
                    }
                    // 解析角色 ID 列表
                    let contactIds = [];
                    if (chatContacts) {
                        try {
                            const contacts = JSON.parse(chatContacts);
                            contactIds = contacts.map(c => c.id);
                        } catch(e) {}
                    }
                    if (contactIds.length === 0 && typeof mockContacts !== 'undefined') {
                        contactIds = mockContacts.map(c => c.id);
                    }
                    for (const id of contactIds) {
                        const key = `CONV_${id}`;
                        const val = await DB.getItem(key);
                        if (val) {
                            snapshot[key] = val;
                        }
                    }
                }

                // 3. 特殊处理：forum 分类从 DB 导出 FORUM_POSTS
                if (checkedCategories.includes('forum')) {
                    let forumPosts = await DB.getItem('FORUM_POSTS');
                    if (!forumPosts) {
                        forumPosts = localStorage.getItem('FORUM_POSTS');
                    }
                    if (forumPosts) {
                        snapshot['FORUM_POSTS'] = forumPosts;
                    }
                }

                // 4. 特殊处理：互动视图数据 (ACTIVITY_STATS) — 如果尚未迁移，则从 APP_DATA 里提取
                if (checkedCategories.includes('interaction')) {
                    let activityStats = await DB.getItem('ACTIVITY_STATS');
                    if (!activityStats) {
                        const appDataStr = await DB.getItem('APP_DATA');
                        if (appDataStr) {
                            try {
                                const appData = JSON.parse(appDataStr);
                                if (appData.activityStats) {
                                    activityStats = JSON.stringify(appData.activityStats);
                                }
                            } catch(e) {}
                        }
                    }
                    if (activityStats) snapshot['ACTIVITY_STATS'] = activityStats;
                }

                // 4. 打包下载
                const exportData = {
                    _version: '7.1',  // 版本号增加，表示新格式
                    _time: new Date().toISOString(),
                    data: snapshot
                };
                const dataStr = JSON.stringify(exportData, null, 2);
                const blob = new Blob([dataStr], { type: 'application/json' });
                const dateStr = new Date().toISOString().split('T')[0];
                const fileName = `linkgo-backup-${dateStr}.json`;

                const file = new File([blob], fileName, { type: 'application/json' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    navigator.share({ files: [file] }).then(() => closeExportSheet()).catch(() => closeExportSheet());
                } else {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = fileName;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => {
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }, 2000);
                    closeExportSheet();
                    alert('✅ 导出成功！');
                }
            } catch(e) {
                console.error(e);
                alert('⚠️ 导出失败: ' + e.message);
            }
        }

        // 全局变量：用于临时存放在后台读取到的备份文件数据
        let pendingImportSnapshot = null; 

        // 1. 触发导入：选择文件 -> 读取 -> 智能识别 -> 呼出分类弹窗
        function importGeneralData() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.style.display = 'none';
            document.body.appendChild(input);
            
            input.onchange = function(e) {
                const file = e.target.files[0];
                if (!file) {
                    document.body.removeChild(input);
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = function(event) {
                    try {
                        const fileData = JSON.parse(event.target.result);
                        pendingImportSnapshot = fileData.data || fileData.localStorageData;
                        
                        if (!pendingImportSnapshot || typeof pendingImportSnapshot !== 'object') {
                            alert('⚠️ 文件格式错误，不是有效的备份文件！');
                            return;
                        }
                        
                        // 🌟 新增：像 X光一样透视备份文件内容
                        const backupKeys = Object.keys(pendingImportSnapshot);
                        let presentCategories = [];
                        let hasOther = false;

                        // 扫描文件里的所有键，判断属于哪些分类
                        backupKeys.forEach(key => {
                            let isKnown = false;
                            for (let cat in EXPORT_DICTIONARY) {
                                if (EXPORT_DICTIONARY[cat].includes(key)) {
                                    if (!presentCategories.includes(cat)) presentCategories.push(cat);
                                    isKnown = true;
                                }
                            }
                            // 新增：识别 CONV_* 为 chat 分类
                            if (key.startsWith('CONV_')) {
                                if (!presentCategories.includes('chat')) presentCategories.push('chat');
                                isKnown = true;
                            }
                            if (!isKnown) hasOther = true;
                        });
                        if (hasOther) presentCategories.push('other');

                        // 🌟 更新界面上的复选框状态
                        const checkboxes = document.querySelectorAll('.import-item-cb');
                        checkboxes.forEach(cb => {
                            if (presentCategories.includes(cb.value)) {
                                cb.checked = true; // 文件里有，默认勾选
                                cb.disabled = false; // 允许操作
                                cb.parentElement.style.opacity = '1'; // 恢复正常颜色
                            } else {
                                cb.checked = false; // 文件里没有，取消勾选
                                cb.disabled = true; // 禁止勾选，防止用户误操作
                                cb.parentElement.style.opacity = '0.4'; // 置灰显示，体验拉满
                            }
                        });

                        // 全选按钮默认设为勾选（因为现在可用的都被勾选了）
                        document.getElementById('import-select-all').checked = true;

                        // 呼出弹窗
                        const sheet = document.getElementById('import-sheet');
                        sheet.style.display = ''; 
                        setTimeout(() => sheet.classList.add('show'), 10);
                        
                    } catch(e) {
                        console.error(e);
                        alert('⚠️ 读取失败，备份文件可能已损坏');
                    }
                    if (document.body.contains(input)) document.body.removeChild(input);
                };
                reader.readAsText(file);
            };
            input.click();
        }

        // 2. 关闭导入弹窗并清空临时数据
        function closeImportSheet() {
            // 移除 .show 平滑收回
            document.getElementById('import-sheet').classList.remove('show');
            pendingImportSnapshot = null; // 用户取消导入，清空内存里的备份数据
        }

        // 3. 导入界面的全选/取消全选联动 (智能修复版)
        function toggleAllImportCheckboxes(selectAllCheckbox) {
            const checkboxes = document.querySelectorAll('.import-item-cb');
            checkboxes.forEach(cb => {
                // 核心修复：只操作那些没有被禁用的（文件里真实存在的）选项
                if (!cb.disabled) {
                    cb.checked = selectAllCheckbox.checked;
                }
            });
        }

        // 智能修复版：给子复选框绑定联动逻辑
        document.querySelectorAll('.import-item-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                // 检查是否所有【未被禁用】的复选框都被勾选了
                const enabledCheckboxes = Array.from(document.querySelectorAll('.import-item-cb')).filter(c => !c.disabled);
                const allChecked = enabledCheckboxes.every(c => c.checked);
                document.getElementById('import-select-all').checked = allChecked;
            });
        });

        async function executeCategorizedImport() {
            if (!pendingImportSnapshot) return;

            const checkedCategories = Array.from(document.querySelectorAll('.import-item-cb'))
                .filter(cb => cb.checked)
                .map(cb => cb.value);

            if (checkedCategories.length === 0) {
                alert('请至少选择一项要恢复的数据！');
                return;
            }

            if (!confirm('⚠️ 警告：这将使用备份文件【覆盖】您勾选的数据类别！\n未勾选的数据将不受影响。\n\n确定要继续吗？')) {
                return;
            }

            // 临时禁止自动保存，防止恢复过程中被覆盖
            window.saveToLocal = function() {};
            window.saveChatApiConfigs = function() {};
            window.saveOtherApiConfigs = function() {};
            window.saveGeneralConfig = function() {};
            window.saveAdvancedPresetFiles = function() {};
            window.saveAdvancedRegexFiles = function() {};

            const backupKeys = Object.keys(pendingImportSnapshot);
            for (const key of backupKeys) {
                let shouldImport = false;
                const valStr = String(pendingImportSnapshot[key]);

                // 1. 先判断是否属于勾选分类的静态键
                for (let cat of checkedCategories) {
                    if (EXPORT_DICTIONARY[cat] && EXPORT_DICTIONARY[cat].includes(key)) {
                        shouldImport = true;
                        break;
                    }
                }

                // 2. 特殊处理 CONV_* 动态键（仅当勾选了 chat 分类）
                if (checkedCategories.includes('chat') && key.startsWith('CONV_')) {
                    shouldImport = true;
                }

                // 3. 特殊处理 ACTIVITY_STATS（当勾选了 interaction 分类）
                if (checkedCategories.includes('interaction') && key === 'ACTIVITY_STATS') {
                    shouldImport = true;
                }

                // 4. 兼容旧备份：如果备份文件里还有 APP_DATA，且勾选了 interaction 或 chat，尝试拆分恢复
                if (key === 'APP_DATA' && (checkedCategories.includes('interaction') || checkedCategories.includes('chat'))) {
                    try {
                        const oldAppData = JSON.parse(valStr);
                        // 恢复互动视图数据
                        if (oldAppData.activityStats && checkedCategories.includes('interaction')) {
                            await DB.setItem('ACTIVITY_STATS', JSON.stringify(oldAppData.activityStats));
                        }
                        // 恢复聊天记录（如果备份里没有单独的 CONV_*，则从 conversations 恢复）
                        if (checkedCategories.includes('chat') && oldAppData.conversations) {
                            for (const [contactId, conv] of Object.entries(oldAppData.conversations)) {
                                if (conv && conv.length > 0) {
                                    await DB.setItem(`CONV_${contactId}`, JSON.stringify(conv));
                                }
                            }
                        }
                    } catch(e) { console.error('拆分旧 APP_DATA 失败', e); }
                    shouldImport = false; // 不直接导入 APP_DATA 整体
                }

                // 特殊处理 APP_SETTINGS：提取 activityStats，并根据勾选分类决定是否导入整体
                if (key === 'APP_SETTINGS') {
                    // 如果勾选了 interaction，提取 activityStats 到独立键
                    if (checkedCategories.includes('interaction')) {
                        try {
                            const settings = JSON.parse(valStr);
                            if (settings.activityStats) {
                                await DB.setItem('ACTIVITY_STATS', JSON.stringify(settings.activityStats));
                                console.log('✅ 已从 APP_SETTINGS 恢复 ACTIVITY_STATS');
                            }
                        } catch(e) {
                            console.error('拆分 APP_SETTINGS 失败', e);
                        }
                    }
                    // 仅当勾选 chat 或 general 时，才导入 APP_SETTINGS 整体到 DB
                    if (checkedCategories.includes('chat') || checkedCategories.includes('general')) {
                        shouldImport = true;
                    } else {
                        shouldImport = false;
                    }
                }

                if (shouldImport) {
                    const dbKeys = ['CHAT_CONTACTS', 'APP_SETTINGS', 'FORUM_POSTS', 'ACTIVITY_STATS'];
                    if (key.startsWith('CONV_') || dbKeys.includes(key)) {
                        await DB.setItem(key, valStr);
                    } else {
                        localStorage.setItem(key, valStr);
                    }
                }
            }

            alert('✅ 选择的数据已成功恢复！点击确定将重新加载页面。');
            window.location.href = window.location.href.split('#')[0];
        }

        
        // --- 清空所有数据 ---
        function clearAllGeneralData() {
            if (!confirm('确定要清空所有数据吗？\n\n此操作将删除：\n• 所有聊天记录\n• 所有API配置\n• 所有预设和正则规则\n\n此操作不可恢复！')) {
                return;
            }
            
            if (!confirm('再次确认：真的要清空所有数据吗？')) {
                return;
            }
            
            try {
                // 清空localStorage
                localStorage.clear();
                
                alert('所有数据已清空！页面将刷新。');
                location.reload();
                
            } catch(e) {
                console.error('清空数据失败:', e);
                alert('清空失败: ' + e.message);
            }
        }
        
        // --- 打开正则规则管理器 ---
        function openGeneralRegexManager() {
            alert('正则规则管理功能开发中...\n\n您可以在这里：\n• 查看所有正则规则\n• 添加/编辑规则\n• 启用/禁用规则');
            
        const el = document.getElementById('general-regex-count');
            if (el) el.textContent = GENERAL_CONFIG.regexCount + ' 条';
            saveGeneralConfig();
        }
        
        // --- 打开预设库管理器 ---
        function openGeneralPresetManager() {
            alert('预设库管理功能开发中...\n\n您可以在这里：\n• 查看所有预设\n• 导入/导出预设\n• 应用预设到角色');
            
            const el = document.getElementById('general-preset-count');
            if (el) el.textContent = GENERAL_CONFIG.presetCount + ' 个';
            saveGeneralConfig();
        }
        
        // --- 初始化通用页面 ---
        function initGeneralPage() {
            loadGeneralConfig();
            
            // 同步正则和预设计数
            GENERAL_CONFIG.regexCount = REGEX_RULES.list.length;
            GENERAL_CONFIG.presetCount = PRESETS.list.length;
            
            document.getElementById('general-regex-count').textContent = GENERAL_CONFIG.regexCount + ' 条';
            document.getElementById('general-preset-count').textContent = GENERAL_CONFIG.presetCount + ' 个';
        }
        
        // 页面加载时初始化通用页面
        document.addEventListener('DOMContentLoaded', function() {
            // 🌟 修复 Bug：必须在页面加载时就静默读取配置，否则魔法棒会变回默认的10轮
            loadGeneralConfig();
        });
        
        // ==========================================
        // 高级功能页面 - 预设和正则管理
        // ==========================================
        
        // --- 渲染预设列表 ---
        function renderPresetList() {
            const container = document.getElementById('preset-list-container');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (PRESETS.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 36px; opacity: 0.5; margin-bottom: 12px;"></i>
                        <p style="font-size: 14px;">暂无预设</p>
                    </div>
                `;
                return;
            }
            
            PRESETS.list.forEach(preset => {
                const card = document.createElement('div');
                card.style.cssText = 'background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); cursor: pointer; transition: all 0.2s;';
                card.ontouchstart = () => card.style.transform = 'scale(0.98)';
                card.ontouchend = () => card.style.transform = '';
                
                const isActive = PRESETS.current === preset.id;
                
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-size: 16px; font-weight: 600; color: var(--text-main);">${preset.name}</div>
                        <div style="display: flex; gap: 12px; align-items: center;">
                            ${isActive ? '<span style="font-size: 12px; color: var(--accent); background: var(--accent-light); padding: 4px 10px; border-radius: 8px; font-weight: 600;">使用中</span>' : ''}
                            <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px;" onclick="event.stopPropagation(); deleteAdvancedPreset(${preset.id})"></i>
                        </div>
                    </div>
                    <div style="font-size: 13px; color: var(--text-sub); margin-bottom: 8px;">
                        温度: ${preset.config.temperature} | Token: ${preset.config.maxTokens}
                    </div>
                    ${preset.config.systemPrompt ? `<div style="font-size: 12px; color: var(--text-sub); background: #f5f5f7; padding: 8px; border-radius: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${preset.config.systemPrompt}</div>` : ''}
                `;
                
                card.onclick = () => applyAdvancedPreset(preset.id);
                container.appendChild(card);
            });
            
            // 更新计数
            const countEl = document.getElementById('advanced-preset-count');
            if (countEl) countEl.textContent = PRESETS.list.length + ' 个预设';
        }
        
        // --- 渲染正则规则列表 ---
        function renderRegexList() {
            const container = document.getElementById('regex-list-container');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (REGEX_RULES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 36px; opacity: 0.5; margin-bottom: 12px;"></i>
                        <p style="font-size: 14px;">暂无规则</p>
                    </div>
                `;
                return;
            }
            
            REGEX_RULES.list.forEach(rule => {
                const card = document.createElement('div');
                card.style.cssText = 'background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.06);';
                
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-size: 16px; font-weight: 600; color: var(--text-main);">${rule.name}</div>
                        <div style="display: flex; gap: 12px; align-items: center;">
                            <div class="api-param-indicator ${rule.enabled ? 'active' : ''}" onclick="toggleAdvancedRegexRule(${rule.id})" style="margin: 0;"></div>
                            <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px; cursor: pointer;" onclick="deleteAdvancedRegex(${rule.id})"></i>
                        </div>
                    </div>
                    <div style="font-size: 12px; color: var(--text-sub); background: #f5f5f7; padding: 8px; border-radius: 6px; font-family: monospace; white-space: nowrap; overflow-x: auto;">${rule.pattern}</div>
                `;
                
                container.appendChild(card);
            });
            
            // 更新计数
            const countEl = document.getElementById('advanced-regex-count');
            if (countEl) countEl.textContent = REGEX_RULES.list.length + ' 条规则';
        }
        
        // --- 应用预设 ---
        function applyAdvancedPreset(presetId) {
            const preset = applyPreset(presetId);
            if (preset) {
                alert(`已应用预设：${preset.name}\n\n温度: ${preset.config.temperature}\nMax Tokens: ${preset.config.maxTokens}`);
                renderPresetList();
            }
        }
        
        // --- 删除预设 ---
        function deleteAdvancedPreset(presetId) {
            if (!confirm('确定要删除这个预设吗？')) return;
            
            if (deletePreset(presetId)) {
                alert('预设已删除');
                renderPresetList();
            }
        }
        
        // --- 创建新预设 ---
        function createNewPreset() {
            const name = prompt('请输入预设名称:');
            if (!name) return;
            
            const temperature = parseFloat(prompt('温度 (0.1-2.0):', '0.7'));
            if (isNaN(temperature) || temperature < 0.1 || temperature > 2.0) {
                alert('温度值无效');
                return;
            }
            
            const maxTokens = parseInt(prompt('最大Token数 (256-4096):', '2000'));
            if (isNaN(maxTokens) || maxTokens < 256 || maxTokens > 4096) {
                alert('Token数无效');
                return;
            }
            
            const systemPrompt = prompt('系统提示词 (可选):') || '';
            
            createPreset(name, {
                temperature,
                maxTokens,
                topP: 1.0,
                frequencyPenalty: 0,
                presencePenalty: 0,
                systemPrompt
            });
            
            alert('预设已创建！');
            renderPresetList();
        }
        
        // --- 切换正则规则状态 ---
        function toggleAdvancedRegexRule(ruleId) {
            const rule = REGEX_RULES.list.find(r => r.id === ruleId);
            if (rule) {
                updateRegexRule(ruleId, { enabled: !rule.enabled });
                renderRegexList();
            }
        }
        
        // --- 删除正则规则 ---
        function deleteAdvancedRegex(ruleId) {
            if (!confirm('确定要删除这条规则吗？')) return;
            
            if (deleteRegexRule(ruleId)) {
                alert('规则已删除');
                renderRegexList();
            }
        }
        
        // --- 创建新正则规则 ---
        function createNewRegexRule() {
            const name = prompt('请输入规则名称:');
            if (!name) return;
            
            const pattern = prompt('请输入正则表达式:\n例如: \\d{11} (匹配手机号)');
            if (!pattern) return;
            
            // 测试正则表达式
            try {
                new RegExp(pattern);
            } catch(e) {
                alert('正则表达式语法错误: ' + e.message);
                return;
            }
            
            const replacement = prompt('替换内容:', '[已隐藏]');
            if (replacement === null) return;
            
            createRegexRule(name, pattern, replacement, true);
            alert('规则已创建！');
            renderRegexList();
        }
        
        // --- 切换正则系统总开关 ---
        function toggleAdvancedRegexSystem() {
            toggleRegexSystem(!REGEX_RULES.enabled);
            
            const switchEl = document.getElementById('regex-system-switch');
            if (switchEl) {
                if (REGEX_RULES.enabled) {
                    switchEl.classList.add('active');
                } else {
                    switchEl.classList.remove('active');
                }
            }
        }
        
        // --- 初始化高级功能页面 ---
        function initAdvancedPage() {
            // 加载数据
            loadAdvancedPresetFiles();
            loadAdvancedRegexFiles();
            
            // 更新预设和正则状态显示
            updatePresetDisplay();
            updateRegexDisplay();
        }
        
        // 监听高级功能页面的打开事件
        const advancedPageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.id === 'sub-advanced' && target.classList.contains('show')) {
                        initAdvancedPage();
                    }
                }
            });
        });
        
        const advancedPage = document.getElementById('sub-advanced');
        if (advancedPage) {
            advancedPageObserver.observe(advancedPage, { attributes: true });
        }
        
        // 监听通用页面的打开事件
        const generalPageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.id === 'sub-general' && target.classList.contains('show')) {
                        initGeneralPage();
                        updateGeneralCacheSize();
                    }
                }
            });
        });
        
        const generalPage = document.getElementById('sub-general');
        if (generalPage) {
            generalPageObserver.observe(generalPage, { attributes: true });
        }
        
        // ==========================================
        // 高级功能 - 导入预设文件功能
        // ==========================================
        
        // --- 预设文件管理 ---
        const ADVANCED_PRESET_FILES = {
            list: [],
            currentId: null,
            enabled: false
        };
        
        // --- 导入预设文件 ---
        function importAdvancedPresetFile() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const json = JSON.parse(event.target.result);
                        const fileName = file.name.replace('.json', '');
                        
                        // 提取prompts数组
                        let rawPrompts = [];
                        if (Array.isArray(json.prompts)) {
                            rawPrompts = json.prompts;
                        } else if (json.entries) {
                            rawPrompts = json.entries;
                        } else {
                            alert('文件格式不正确：未找到prompts或entries字段');
                            return;
                        }
                        
                        // 提取prompt_order（支持多个character_id，优先使用100001）
                        let promptOrder = null;
                        if (Array.isArray(json.prompt_order)) {
                            // 优先查找character_id为100001的配置
                            promptOrder = json.prompt_order.find(po => po.character_id === 100001);
                            // 如果没有100001，使用第一个
                            if (!promptOrder && json.prompt_order.length > 0) {
                                promptOrder = json.prompt_order[0];
                            }
                        }
                        
                        // 根据prompt_order重新排序prompts
                        let orderedPrompts = [];
                        if (promptOrder && promptOrder.order) {
                            // 创建identifier到prompt的映射
                            const promptMap = {};
                            rawPrompts.forEach(p => {
                                if (p.identifier) {
                                    promptMap[p.identifier] = p;
                                }
                            });
                            
                            // 按照prompt_order的顺序重建prompts数组
                            promptOrder.order.forEach(orderItem => {
                                const prompt = promptMap[orderItem.identifier];
                                if (prompt) {
                                    // 保留原始的enabled状态（来自prompt_order）
                                    orderedPrompts.push({
                                        ...prompt,
                                        enabled: orderItem.enabled
                                    });
                                }
                            });
                            
                            console.log(`✅ 成功按照prompt_order重排序：${orderedPrompts.length} 条`);
                        } else {
                            // 如果没有prompt_order，使用原始顺序
                            orderedPrompts = rawPrompts;
                            console.warn('⚠️ 未找到prompt_order，使用原始顺序');
                        }
                        
                        // 创建预设文件
                        const newFile = {
                            id: Date.now(),
                            name: fileName,
                            prompts: orderedPrompts,
                            enabled: false,
                            hasOrder: !!promptOrder // 标记是否使用了prompt_order
                        };
                        
                        ADVANCED_PRESET_FILES.list.push(newFile);
                        saveAdvancedPresetFiles();
                        renderAdvancedPresetFiles();
                        updatePresetDisplay();
                        
                        const orderInfo = promptOrder ? '✅ 已按正确顺序排列' : '⚠️ 未检测到顺序信息';
                        alert(`✅ 成功导入预设文件: ${fileName}\n包含 ${orderedPrompts.length} 条内容\n${orderInfo}`);
                        
                    } catch(e) {
                        console.error('预设文件导入失败:', e);
                        alert('文件解析失败: ' + e.message);
                    }
                };
                reader.readAsText(file);
            };
            
            input.click();
        }
        
        // --- 渲染预设文件列表 ---
        function renderAdvancedPresetFiles() {
            const container = document.getElementById('preset-files-container');
            const displayEl = document.getElementById('advanced-preset-display');
            
            if (!container) return;
            
            container.innerHTML = '';
            
            // 更新顶部显示
            const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
            if (displayEl) {
                if (enabledFiles.length === 0) {
                    displayEl.textContent = '未选择';
                } else if (enabledFiles.length === 1) {
                    displayEl.textContent = enabledFiles[0].name;
                } else {
                    displayEl.textContent = `${enabledFiles.length} 个文件`;
                }
            }
            
            if (ADVANCED_PRESET_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;"></i>
                        <p style="font-size: 13px;">暂无预设文件</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_PRESET_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.style.cssText = 'background: white; border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; cursor: pointer;" onclick="toggleAdvancedPresetFile(${file.id})">
                        <div style="font-size: 15px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                        <div style="font-size: 12px; color: var(--text-sub);">${file.prompts ? file.prompts.length : 0} 条内容</div>
                    </div>
                    <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px; cursor: pointer;" onclick="deleteAdvancedPresetFile(${file.id})"></i>
                `;
                
                container.appendChild(item);
            });
        }
        
        // --- 切换预设文件启用状态 ---
        function toggleAdvancedPresetFile(fileId) {
            const file = ADVANCED_PRESET_FILES.list.find(f => f.id === fileId);
            if (!file) return;
            
            file.enabled = !file.enabled;
            saveAdvancedPresetFiles();
            renderAdvancedPresetFiles();
        }
        
        // --- 删除预设文件 ---
        function deleteAdvancedPresetFile(fileId) {
            if (!confirm('确定要删除这个预设文件吗？')) return;
            
            ADVANCED_PRESET_FILES.list = ADVANCED_PRESET_FILES.list.filter(f => f.id !== fileId);
            saveAdvancedPresetFiles();
            renderAdvancedPresetFiles();
            
            alert('预设文件已删除');
        }
        
        // --- 切换预设系统总开关 ---
        function toggleAdvancedPresetSystem() {
            ADVANCED_PRESET_FILES.enabled = !ADVANCED_PRESET_FILES.enabled;
            
            const switchEl = document.getElementById('preset-system-switch');
            if (switchEl) {
                if (ADVANCED_PRESET_FILES.enabled) {
                    switchEl.classList.add('active');
                } else {
                    switchEl.classList.remove('active');
                }
            }
            
            saveAdvancedPresetFiles();
        }
        
        // --- 保存预设文件 ---
        function saveAdvancedPresetFiles() {
            try {
                localStorage.setItem('ADVANCED_PRESET_FILES', JSON.stringify(ADVANCED_PRESET_FILES));
            } catch(e) {
                console.error('保存预设文件失败:', e);
            }
        }
        
        // --- 加载预设文件 ---
        function loadAdvancedPresetFiles() {
            try {
                const saved = localStorage.getItem('ADVANCED_PRESET_FILES');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(ADVANCED_PRESET_FILES, parsed);
                }
            } catch(e) {
                console.error('加载预设文件失败:', e);
            }
        }
        
        // ==========================================
        // 高级功能 - 导入正则文件功能
        // ==========================================
        
        // --- 正则文件管理 ---
        const ADVANCED_REGEX_FILES = {
            list: [],
            currentId: null,
            enabled: false
        };
        
        // --- 导入正则文件 ---
        function importAdvancedRegexFile() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const json = JSON.parse(event.target.result);
                        const fileName = file.name.replace('.json', '');
                        
                        // 提取脚本
                        let scripts = [];
                        if (Array.isArray(json)) {
                            scripts = json;
                        } else if (json.scripts && Array.isArray(json.scripts)) {
                            scripts = json.scripts;
                        } else if (json.regex_scripts) {
                            scripts = json.regex_scripts;
                        } else {
                            alert('文件格式不正确');
                            return;
                        }
                        
                        // 标准化脚本格式
                        const normalizedScripts = scripts.map((s, idx) => ({
                            id: Date.now() + idx,
                            name: s.scriptName || s.name || `脚本${idx + 1}`,
                            regex: s.findRegex || s.regex || s.pattern || '',
                            replace: s.replaceString || s.replace || '',
                            enabled: !s.disabled
                        })).filter(s => s.regex);
                        
                        // 创建正则文件
                        const newFile = {
                            id: Date.now(),
                            name: fileName,
                            scripts: normalizedScripts,
                            enabled: false
                        };
                        
                        ADVANCED_REGEX_FILES.list.push(newFile);
                        saveAdvancedRegexFiles();
                        renderAdvancedRegexFiles();
                        
                        alert(`✅ 成功导入正则文件: ${fileName}\n包含 ${normalizedScripts.length} 条脚本`);
                        
                    } catch(e) {
                        alert('文件解析失败: ' + e.message);
                    }
                };
                reader.readAsText(file);
            };
            
            input.click();
        }
        
        // --- 渲染正则文件列表 ---
        function renderAdvancedRegexFiles() {
            const container = document.getElementById('regex-files-container');
            const displayEl = document.getElementById('advanced-regex-display');
            
            if (!container) return;
            
            container.innerHTML = '';
            
            // 更新顶部显示
            const enabledFiles = ADVANCED_REGEX_FILES.list.filter(f => f.enabled);
            if (displayEl) {
                if (enabledFiles.length === 0) {
                    displayEl.textContent = '未选择';
                } else if (enabledFiles.length === 1) {
                    displayEl.textContent = enabledFiles[0].name;
                } else {
                    displayEl.textContent = `${enabledFiles.length} 个文件`;
                }
            }
            
            if (ADVANCED_REGEX_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;"></i>
                        <p style="font-size: 13px;">暂无正则文件</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_REGEX_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.style.cssText = 'background: white; border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; cursor: pointer;" onclick="toggleAdvancedRegexFile(${file.id})">
                        <div style="font-size: 15px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                        <div style="font-size: 12px; color: var(--text-sub);">${file.scripts ? file.scripts.length : 0} 条脚本</div>
                    </div>
                    <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px; cursor: pointer;" onclick="deleteAdvancedRegexFile(${file.id})"></i>
                `;
                
                container.appendChild(item);
            });
        }
        
        // --- 切换正则文件启用状态 ---
        function toggleAdvancedRegexFile(fileId) {
            const file = ADVANCED_REGEX_FILES.list.find(f => f.id === fileId);
            if (!file) return;
            
            file.enabled = !file.enabled;
            saveAdvancedRegexFiles();
            renderAdvancedRegexFiles();
        }
        
        // --- 删除正则文件 ---
        function deleteAdvancedRegexFile(fileId) {
            if (!confirm('确定要删除这个正则文件吗？')) return;
            
            ADVANCED_REGEX_FILES.list = ADVANCED_REGEX_FILES.list.filter(f => f.id !== fileId);
            saveAdvancedRegexFiles();
            renderAdvancedRegexFiles();
            
            alert('正则文件已删除');
        }
        
        // --- 切换正则系统总开关 ---
        function toggleAdvancedRegexSystem() {
            ADVANCED_REGEX_FILES.enabled = !ADVANCED_REGEX_FILES.enabled;
            
            const switchEl = document.getElementById('regex-system-switch');
            if (switchEl) {
                if (ADVANCED_REGEX_FILES.enabled) {
                    switchEl.classList.add('active');
                } else {
                    switchEl.classList.remove('active');
                }
            }
            
            saveAdvancedRegexFiles();
        }
        
        // --- 保存正则文件 ---
        function saveAdvancedRegexFiles() {
            try {
                localStorage.setItem('ADVANCED_REGEX_FILES', JSON.stringify(ADVANCED_REGEX_FILES));
            } catch(e) {
                console.error('保存正则文件失败:', e);
            }
        }
        
        // --- 加载正则文件 ---
        function loadAdvancedRegexFiles() {
            try {
                const saved = localStorage.getItem('ADVANCED_REGEX_FILES');
                if (saved) {
                    const parsed = JSON.parse(saved);
                    Object.assign(ADVANCED_REGEX_FILES, parsed);
                }
            } catch(e) {
                console.error('加载正则文件失败:', e);
            }
        }
        
        // --- 重新实现initAdvancedPage ---
        function initAdvancedPage() {
            // 加载数据
            loadAdvancedPresetFiles();
            loadAdvancedRegexFiles();
            
            // 更新开关状态
            const presetSwitch = document.getElementById('preset-system-switch');
            if (presetSwitch && ADVANCED_PRESET_FILES.enabled) {
                presetSwitch.classList.add('active');
            }
            
            const regexSwitch = document.getElementById('regex-system-switch');
            if (regexSwitch && ADVANCED_REGEX_FILES.enabled) {
                regexSwitch.classList.add('active');
            }
            
            // 渲染列表
            renderAdvancedPresetFiles();
            renderAdvancedRegexFiles();
        }
        
        // ==========================================
        // 预设详情页面功能（二级页面）
        // ==========================================
        
        let currentEditingPresetId = null;
        
        // --- 打开预设详情 ---
        function openPresetDetail(fileId) {
            const file = ADVANCED_PRESET_FILES.list.find(f => f.id === fileId);
            if (!file) return;
            
            currentEditingPresetId = fileId;
            
            // 更新标题
            document.getElementById('preset-detail-title').textContent = file.name;
            
            // 渲染预设小项
            renderPresetDetailItems(file);
            
            // 显示二级页面
            openSubPage('sub-preset-detail');
        }
        
        // --- HTML转义函数 ---
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // --- 渲染预设详情小项（原始顺序，分隔符显示为分隔线） ---
        function renderPresetDetailItems(file) {
            const container = document.getElementById('preset-detail-container');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (!file.prompts || file.prompts.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 40px; opacity: 0.5; margin-bottom: 15px;"></i>
                        <p style="font-size: 14px;">该预设文件暂无内容</p>
                    </div>
                `;
                return;
            }
            
            // 创建主列表容器
            const listGroup = document.createElement('div');
            listGroup.className = 'api-input-group';
            listGroup.style.margin = '0 20px';
            
            // 按照原始顺序渲染每一项
            file.prompts.forEach((prompt, idx) => {
                const name = prompt.name || '';
                
                // 判断是否是分隔标记（包含"----"的都是分隔）
                const isDivider = name.includes('----');
                
                if (isDivider) {
                    // 显示为分隔线（不需要开关）
                    const divider = document.createElement('div');
                    divider.style.cssText = 'padding: 12px 16px; border-bottom: 0.5px solid var(--border);';
                    divider.innerHTML = `
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-sub); text-align: center;">
                            ${escapeHtml(name)}
                        </div>
                    `;
                    listGroup.appendChild(divider);
                } else {
                    // 普通项目（带开关和详情按钮）
                    const item = document.createElement('div');
                    item.className = 'api-input-item';
                    item.style.padding = '14px 16px';
                    
                    const isEnabled = prompt.enabled !== false;
                    
                    // 智能显示名称：如果名称为空，使用identifier
                    let displayName = name;
                    if (!displayName || displayName.trim() === '') {
                        if (prompt.identifier) {
                            displayName = `[${prompt.identifier}]`;
                        } else {
                            displayName = `未命名项 #${idx + 1}`;
                        }
                    }
                    
                    // 根据开关状态设置文字颜色和透明度
                    const textColor = isEnabled ? 'var(--text-main)' : 'var(--text-sub)';
                    const textOpacity = isEnabled ? '1' : '0.5';
                    
                    item.innerHTML = `
                        <div style="flex: 1; margin-right: 12px;">
                            <div style="font-size: 15px; font-weight: 500; color: ${textColor}; opacity: ${textOpacity}; transition: all 0.3s ease;">${escapeHtml(displayName)}</div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-circle-info clickable" style="color: ${isEnabled ? 'var(--icon-color)' : 'var(--text-sub)'}; opacity: ${textOpacity}; font-size: 18px; padding: 8px; transition: all 0.3s ease;" onclick="editPresetPromptItem(${file.id}, ${idx})"></i>
                            <div class="api-param-indicator ${isEnabled ? 'active' : ''}" onclick="togglePresetPromptItem(${file.id}, ${idx})" style="margin: 0;"></div>
                        </div>
                    `;
                    
                    listGroup.appendChild(item);
                }
            });
            
            container.appendChild(listGroup);
        }
        
        // --- 切换预设小项状态 ---
        function togglePresetPromptItem(fileId, promptIdx) {
            const file = ADVANCED_PRESET_FILES.list.find(f => f.id === fileId);
            if (!file || !file.prompts[promptIdx]) return;
            
            file.prompts[promptIdx].enabled = !file.prompts[promptIdx].enabled;
            saveAdvancedPresetFiles();
            renderPresetDetailItems(file);
        }
        
        // --- 编辑预设小项（打开三级弹窗） ---
        function editPresetPromptItem(fileId, promptIdx) {
            const file = ADVANCED_PRESET_FILES.list.find(f => f.id === fileId);
            if (!file || !file.prompts[promptIdx]) return;
            
            const prompt = file.prompts[promptIdx];
            
            // 创建编辑弹窗
            const modal = document.createElement('div');
            modal.id = 'preset-prompt-edit-modal';
            modal.className = 'config-modal-overlay show';
            modal.style.zIndex = '5000';
            
            modal.innerHTML = `
                <div class="config-modal-content">
                    <div class="config-modal-header">
                        <h3 class="config-modal-title">${prompt.name || '编辑内容'}</h3>
                    </div>
                    
                    <div class="config-modal-body" style="padding: 16px 20px; max-height: 50vh; overflow-y: auto;">
                        <div class="config-form-group" style="margin-bottom: 16px;">
                            <label class="config-form-label">功能名称</label>
                            <input type="text" id="edit-prompt-name" class="config-form-input" value="${prompt.name || ''}" placeholder="输入功能名称">
                        </div>
                        
                        <div class="config-form-group" style="margin-bottom: 0;">
                            <label class="config-form-label">内容</label>
                            <textarea id="edit-prompt-content" class="config-form-input" style="min-height: 200px; resize: vertical; font-family: inherit;" placeholder="输入预设内容...">${prompt.content || ''}</textarea>
                        </div>
                    </div>
                    
                    <div class="config-form-buttons">
                        <button class="config-form-btn config-form-btn-cancel" onclick="closePresetPromptEdit()">取消</button>
                        <button class="config-form-btn config-form-btn-save" onclick="savePresetPromptEdit(${fileId}, ${promptIdx})">保存</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 点击外部关闭
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closePresetPromptEdit();
                }
            });
        }
        
        // --- 保存预设小项编辑 ---
        function savePresetPromptEdit(fileId, promptIdx) {
            const file = ADVANCED_PRESET_FILES.list.find(f => f.id === fileId);
            if (!file || !file.prompts[promptIdx]) return;
            
            const nameInput = document.getElementById('edit-prompt-name');
            const contentInput = document.getElementById('edit-prompt-content');
            
            const newName = nameInput.value.trim();
            const newContent = contentInput.value;
            
            if (!newName) {
                alert('功能名称不能为空');
                return;
            }
            
            file.prompts[promptIdx].name = newName;
            file.prompts[promptIdx].content = newContent;
            
            saveAdvancedPresetFiles();
            closePresetPromptEdit();
            renderPresetDetailItems(file);
            
            alert('✅ 修改已保存！');
        }
        
        // --- 关闭预设小项编辑弹窗 ---
        function closePresetPromptEdit() {
            const modal = document.getElementById('preset-prompt-edit-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 300);
            }
        }
        
        // ==========================================
        // 正则详情页面功能（二级页面）
        // ==========================================
        
        let currentEditingRegexId = null;
        
        // --- 打开正则详情 ---
        function openRegexDetail(fileId) {
            const file = ADVANCED_REGEX_FILES.list.find(f => f.id === fileId);
            if (!file) return;
            
            currentEditingRegexId = fileId;
            
            // 更新标题
            document.getElementById('regex-detail-title').textContent = file.name;
            
            // 渲染正则小项
            renderRegexDetailItems(file);
            
            // 显示二级页面
            openSubPage('sub-regex-detail');
        }
        
        // --- 渲染正则详情小项（简洁列表UI） ---
        function renderRegexDetailItems(file) {
            const container = document.getElementById('regex-detail-container');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (!file.scripts || file.scripts.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 40px; opacity: 0.5; margin-bottom: 15px;"></i>
                        <p style="font-size: 14px;">该正则文件暂无脚本</p>
                    </div>
                `;
                return;
            }
            
            // 创建列表容器
            const listGroup = document.createElement('div');
            listGroup.className = 'api-input-group';
            listGroup.style.margin = '0';
            
            file.scripts.forEach((script, idx) => {
                const item = document.createElement('div');
                item.className = 'api-input-item';
                item.style.padding = '14px 16px';
                
                const isEnabled = script.enabled !== false;
                
                // 根据开关状态设置文字颜色和透明度
                const textColor = isEnabled ? 'var(--text-main)' : 'var(--text-sub)';
                const textOpacity = isEnabled ? '1' : '0.5';
                
                item.innerHTML = `
                    <div style="flex: 1; margin-right: 12px;">
                        <div style="font-size: 15px; font-weight: 500; color: ${textColor}; opacity: ${textOpacity}; transition: all 0.3s ease;">${script.name || '未命名脚本 ' + (idx + 1)}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-circle-info clickable" style="color: ${isEnabled ? 'var(--icon-color)' : 'var(--text-sub)'}; opacity: ${textOpacity}; font-size: 18px; padding: 8px; transition: all 0.3s ease;" onclick="editRegexScriptItem(${file.id}, ${idx})"></i>
                        <div class="api-param-indicator ${isEnabled ? 'active' : ''}" onclick="toggleRegexScriptItem(${file.id}, ${idx})" style="margin: 0;"></div>
                    </div>
                `;
                
                listGroup.appendChild(item);
            });
            
            container.appendChild(listGroup);
        }
        
        // --- 切换正则小项状态 ---
        function toggleRegexScriptItem(fileId, scriptIdx) {
            const file = ADVANCED_REGEX_FILES.list.find(f => f.id === fileId);
            if (!file || !file.scripts[scriptIdx]) return;
            
            file.scripts[scriptIdx].enabled = !file.scripts[scriptIdx].enabled;
            saveAdvancedRegexFiles();
            renderRegexDetailItems(file);
        }
        
        // --- 编辑正则小项（打开三级弹窗） ---
        function editRegexScriptItem(fileId, scriptIdx) {
            const file = ADVANCED_REGEX_FILES.list.find(f => f.id === fileId);
            if (!file || !file.scripts[scriptIdx]) return;
            
            const script = file.scripts[scriptIdx];
            
            // 创建编辑弹窗
            const modal = document.createElement('div');
            modal.id = 'regex-script-edit-modal';
            modal.className = 'config-modal-overlay show';
            modal.style.zIndex = '5000';
            
            modal.innerHTML = `
                <div class="config-modal-content">
                    <div class="config-modal-header">
                        <h3 class="config-modal-title">${script.name || '编辑脚本'}</h3>
                    </div>
                    
                    <div class="config-modal-body" style="padding: 16px 20px; max-height: 50vh; overflow-y: auto;">
                        <div class="config-form-group" style="margin-bottom: 16px;">
                            <label class="config-form-label">功能名称</label>
                            <input type="text" id="edit-script-name" class="config-form-input" value="${script.name || ''}" placeholder="输入功能名称">
                        </div>
                        
                        <div class="config-form-group" style="margin-bottom: 16px;">
                            <label class="config-form-label">正则表达式 (Regex)</label>
                            <textarea id="edit-script-regex" class="config-form-input" style="min-height: 100px; font-family: monospace; font-size: 13px; resize: vertical;" placeholder="例如: /pattern/g">${script.regex || ''}</textarea>
                        </div>
                        
                        <div class="config-form-group" style="margin-bottom: 0;">
                            <label class="config-form-label">替换内容 (Replace)</label>
                            <textarea id="edit-script-replace" class="config-form-input" style="min-height: 100px; resize: vertical;" placeholder="替换为的内容...">${script.replace || ''}</textarea>
                        </div>
                    </div>
                    
                    <div class="config-form-buttons">
                        <button class="config-form-btn config-form-btn-cancel" onclick="closeRegexScriptEdit()">取消</button>
                        <button class="config-form-btn config-form-btn-save" onclick="saveRegexScriptEdit(${fileId}, ${scriptIdx})">保存</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // 点击外部关闭
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closeRegexScriptEdit();
                }
            });
        }
        
        // --- 保存正则小项编辑 ---
        function saveRegexScriptEdit(fileId, scriptIdx) {
            const file = ADVANCED_REGEX_FILES.list.find(f => f.id === fileId);
            if (!file || !file.scripts[scriptIdx]) return;
            
            const nameInput = document.getElementById('edit-script-name');
            const regexInput = document.getElementById('edit-script-regex');
            const replaceInput = document.getElementById('edit-script-replace');
            
            const newName = nameInput.value.trim();
            const newRegex = regexInput.value.trim();
            const newReplace = replaceInput.value;
            
            if (!newName) {
                alert('功能名称不能为空');
                return;
            }
            
            if (!newRegex) {
                alert('正则表达式不能为空');
                return;
            }
            
            file.scripts[scriptIdx].name = newName;
            file.scripts[scriptIdx].regex = newRegex;
            file.scripts[scriptIdx].replace = newReplace;
            
            saveAdvancedRegexFiles();
            closeRegexScriptEdit();
            renderRegexDetailItems(file);
            
            alert('✅ 修改已保存！');
        }
        
        // --- 关闭正则小项编辑弹窗 ---
        function closeRegexScriptEdit() {
            const modal = document.getElementById('regex-script-edit-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 300);
            }
        }
        
        // ==========================================
        // 预设管理弹窗功能
        // ==========================================
        
        // --- 打开预设管理弹窗 ---
        function openPresetManagementModal() {
            const modal = createManagementModal('preset');
            document.body.appendChild(modal);
            renderPresetManagementList();
            
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }
        
        // --- 打开正则管理弹窗 ---
        function openRegexManagementModal() {
            const modal = createManagementModal('regex');
            document.body.appendChild(modal);
            renderRegexManagementList();
            
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }
        
        // --- 创建管理弹窗 ---
        function createManagementModal(type) {
            const isPreset = type === 'preset';
            const title = isPreset ? '预设管理' : '正则管理';
            const buttonText = isPreset ? '导入预设文件' : '导入正则文件';
            const buttonIcon = 'fa-file-import';
            
            const modal = document.createElement('div');
            modal.id = `${type}-management-modal`;
            modal.className = 'config-modal-overlay';
            modal.style.zIndex = '4000';
            
            modal.innerHTML = `
                <div class="config-modal-content" style="max-width: 90%; width: 400px;">
                    <div class="config-modal-header">
                        <h3 class="config-modal-title">${title}</h3>
                    </div>
                    
                    <div class="config-modal-body" id="${type}-management-list" style="max-height: 60vh; overflow-y: auto; padding: 0;">
                        <!-- 列表将在这里动态生成 -->
                    </div>
                    
                    <div class="config-modal-footer">
                        <button class="config-new-btn" style="background: #000000; color: white; padding: 10px 20px; font-size: 14px;" onclick="${isPreset ? 'importAdvancedPresetFile' : 'importAdvancedRegexFile'}(); close${isPreset ? 'Preset' : 'Regex'}ManagementModal();">
                            <i class="fas ${buttonIcon}" style="font-size: 13px;"></i> ${buttonText}
                        </button>
                    </div>
                </div>
            `;
            
            // 点击外部关闭
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    if (isPreset) {
                        closePresetManagementModal();
                    } else {
                        closeRegexManagementModal();
                    }
                }
            });
            
            return modal;
        }
        
        // --- 关闭预设管理弹窗 ---
        function closePresetManagementModal() {
            const modal = document.getElementById('preset-management-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 300);
            }
        }
        
        // --- 关闭正则管理弹窗 ---
        function closeRegexManagementModal() {
            const modal = document.getElementById('regex-management-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 300);
            }
        }
        
        // --- 渲染预设管理列表 ---
        function renderPresetManagementList() {
            const container = document.getElementById('preset-management-list');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (ADVANCED_PRESET_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 50px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 40px; opacity: 0.5; margin-bottom: 12px;"></i>
                        <p style="font-size: 14px;">暂无预设文件</p>
                        <p style="font-size: 12px; margin-top: 8px;">点击下方按钮导入</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_PRESET_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.className = 'config-list-item';
                item.style.padding = '16px 20px';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <div style="flex: 1; cursor: pointer;" onclick="toggleAdvancedPresetFile(${file.id}); renderPresetManagementList(); updatePresetDisplay();">
                            <div style="font-size: 16px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                            <div style="font-size: 13px; color: var(--text-sub);">${file.prompts ? file.prompts.length : 0} 条内容</div>
                        </div>
                        <i class="fas fa-edit clickable" style="color: var(--icon-color); font-size: 18px; padding: 8px;" onclick="openPresetDetailFromModal(${file.id});"></i>
                        <i class="fas fa-trash-alt clickable" style="color: var(--text-sub); font-size: 16px; padding: 8px;" onclick="deleteAdvancedPresetFile(${file.id}); renderPresetManagementList(); updatePresetDisplay();"></i>
                    </div>
                `;
                
                container.appendChild(item);
            });
        }
        
        // --- 渲染正则管理列表 ---
        function renderRegexManagementList() {
            const container = document.getElementById('regex-management-list');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (ADVANCED_REGEX_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 50px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 40px; opacity: 0.5; margin-bottom: 12px;"></i>
                        <p style="font-size: 14px;">暂无正则文件</p>
                        <p style="font-size: 12px; margin-top: 8px;">点击下方按钮导入</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_REGEX_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.className = 'config-list-item';
                item.style.padding = '16px 20px';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; display: flex; align-items: center; gap: 12px;">
                        <div style="flex: 1; cursor: pointer;" onclick="toggleAdvancedRegexFile(${file.id}); renderRegexManagementList(); updateRegexDisplay();">
                            <div style="font-size: 16px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                            <div style="font-size: 13px; color: var(--text-sub);">${file.scripts ? file.scripts.length : 0} 条脚本</div>
                        </div>
                        <i class="fas fa-edit clickable" style="color: var(--icon-color); font-size: 18px; padding: 8px;" onclick="openRegexDetailFromModal(${file.id});"></i>
                        <i class="fas fa-trash-alt clickable" style="color: var(--text-sub); font-size: 16px; padding: 8px;" onclick="deleteAdvancedRegexFile(${file.id}); renderRegexManagementList(); updateRegexDisplay();"></i>
                    </div>
                `;
                
                container.appendChild(item);
            });
        }
        
        // --- 更新主页面预设状态显示 ---
        function updatePresetDisplay() {
            const displayEl = document.getElementById('preset-status-display');
            if (!displayEl) return;
            
            const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
            const totalPresets = enabledFiles.reduce((sum, f) => sum + (f.prompts ? f.prompts.length : 0), 0);
            
            if (enabledFiles.length === 0) {
                displayEl.textContent = '未启用';
            } else {
                displayEl.textContent = `已启用 ${totalPresets} 个预设`;
            }
        }
        
        // --- 更新主页面正则状态显示 ---
        function updateRegexDisplay() {
            const displayEl = document.getElementById('regex-status-display');
            if (!displayEl) return;
            
            const enabledFiles = ADVANCED_REGEX_FILES.list.filter(f => f.enabled);
            const totalScripts = enabledFiles.reduce((sum, f) => sum + (f.scripts ? f.scripts.length : 0), 0);
            
            if (enabledFiles.length === 0) {
                displayEl.textContent = '未启用';
            } else {
                displayEl.textContent = `已启用 ${totalScripts} 条正则`;
            }
        }
        
        // --- 从弹窗打开预设详情 ---
        function openPresetDetailFromModal(fileId) {
            closePresetManagementModal();
            setTimeout(() => {
                openPresetDetail(fileId);
            }, 300);
        }
        
        // --- 从弹窗打开正则详情 ---
        function openRegexDetailFromModal(fileId) {
            closeRegexManagementModal();
            setTimeout(() => {
                openRegexDetail(fileId);
            }, 300);
        }
        
        // --- 关闭预设详情并显示管理弹窗 ---
        function closePresetDetailAndShowModal() {
            // 同时进行：关闭详情页 + 打开管理弹窗
            openPresetManagementModal();
            closeSubPage('sub-preset-detail');
        }
        
        // --- 关闭正则详情并显示管理弹窗 ---
        function closeRegexDetailAndShowModal() {
            // 同时进行：关闭详情页 + 打开管理弹窗
            openRegexManagementModal();
            closeSubPage('sub-regex-detail');
        }
        
        // ==========================================
        // 修改预设和正则文件列表，添加编辑按钮
        // ==========================================
        
        // --- 重新渲染预设文件列表（带编辑按钮） ---
        function renderAdvancedPresetFiles() {
            const container = document.getElementById('preset-files-container');
            const displayEl = document.getElementById('advanced-preset-display');
            
            if (!container) return;
            
            container.innerHTML = '';
            
            // 更新顶部显示
            const enabledFiles = ADVANCED_PRESET_FILES.list.filter(f => f.enabled);
            if (displayEl) {
                if (enabledFiles.length === 0) {
                    displayEl.textContent = '未选择';
                } else if (enabledFiles.length === 1) {
                    displayEl.textContent = enabledFiles[0].name;
                } else {
                    displayEl.textContent = `${enabledFiles.length} 个文件`;
                }
            }
            
            if (ADVANCED_PRESET_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;"></i>
                        <p style="font-size: 13px;">暂无预设文件</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_PRESET_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.style.cssText = 'background: white; border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; display: flex; align-items: center; gap: 10px;">
                        <div style="cursor: pointer; flex: 1;" onclick="toggleAdvancedPresetFile(${file.id})">
                            <div style="font-size: 15px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                            <div style="font-size: 12px; color: var(--text-sub);">${file.prompts ? file.prompts.length : 0} 条内容</div>
                        </div>
                        <i class="fas fa-edit clickable" style="color: var(--accent); font-size: 16px; padding: 8px;" onclick="openPresetDetail(${file.id})"></i>
                    </div>
                    <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px; cursor: pointer;" onclick="deleteAdvancedPresetFile(${file.id})"></i>
                `;
                
                container.appendChild(item);
            });
        }
        
        // ==========================================
        // 配置项滑动删除和编辑功能
        // ==========================================

        // --- 添加配置项滑动事件处理 ---
        function addConfigSwipeHandler(element) {
            let startX = 0;
            let startY = 0; // 🌟 核心：记录起始Y轴坐标
            let currentX = 0;
            let isDragging = false;
            let isScrolling = false; // 🌟 核心：判断是否正在上下滚动
            let startTime = 0;

            element.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                currentX = 0;
                isDragging = false;
                startTime = Date.now();

                // 重置其他所有滑动项
                document.querySelectorAll('.config-list-item-swipeable').forEach(item => {
                    if (item !== element && item.style.transform && item.style.transform !== 'translateX(0px)') {
                        resetConfigSwipe(item);
                    }
                });
            }, { passive: true });

            element.addEventListener('touchmove', (e) => {
                if (!isDragging) {
                    const touchX = e.touches[0].clientX;
                    const touchY = e.touches[0].clientY;
                    const diffX = Math.abs(touchX - startX);
                    const diffY = Math.abs(touchY - startY);

                    if (diffX > 8 && diffX > diffY * 1.5) {
                        isDragging = true;
                        element.classList.add('swiping');
                        element.closest('.config-item-wrapper').classList.add('is-active');
                    } else if (diffY > 8) {
                        // 确定为竖滑，放弃手势
                        return;
                    } else {
                        return;
                    }
                }

                // 已确定为横滑，阻止页面上下滚动
                e.preventDefault();

                const touchX = e.touches[0].clientX;
                const deltaX = touchX - startX;
                if (deltaX > 0) deltaX = 0;
                currentX = Math.max(deltaX, -110);
                element.style.transform = `translateX(${currentX}px)`;
            }, { passive: false });

            element.addEventListener('touchend', (e) => {
                if (!element.classList.contains('swiping')) return;
                element.classList.remove('swiping');
                isDragging = false;

                const duration = Date.now() - startTime;
                const velocity = Math.abs(currentX) / duration;

                if (Math.abs(currentX) > 70 || velocity > 0.3) {
                    element.style.transform = 'translateX(-110px)';
                } else {
                    resetConfigSwipe(element);
                }
            });
        }
        
        // --- 全局点击事件：收回所有展开的配置项 ---
        document.addEventListener('click', (e) => {
            // 检查是否点击在配置项或操作按钮上
            const isConfigItem = e.target.closest('.config-list-item-swipeable');
            const isActionBtn = e.target.closest('.config-action-btn');
            
            // 如果点击的不是配置项内容区，也不是操作按钮，则收回所有展开项
            if (!isConfigItem && !isActionBtn) {
                document.querySelectorAll('.config-list-item-swipeable').forEach(item => {
                    if (item.style.transform === 'translateX(-140px)') {
                        resetConfigSwipe(item);
                    }
                });
            }
        });
        
        // --- 重置配置项滑动状态 ---
        function resetConfigSwipe(element) {
            element.style.transform = 'translateX(0)'; // 让卡片滑回去
            
            // 🌟 核心：同时立刻剥夺圆球的实体，让它在滑回去的过程中变回空气
            const wrapper = element.closest('.config-item-wrapper');
            if (wrapper) {
                wrapper.classList.remove('is-active');
            }
        }
        
        // --- 重新渲染正则文件列表（带编辑按钮） ---
        function renderAdvancedRegexFiles() {
            const container = document.getElementById('regex-files-container');
            const displayEl = document.getElementById('advanced-regex-display');
            
            if (!container) return;
            
            container.innerHTML = '';
            
            // 更新顶部显示
            const enabledFiles = ADVANCED_REGEX_FILES.list.filter(f => f.enabled);
            if (displayEl) {
                if (enabledFiles.length === 0) {
                    displayEl.textContent = '未选择';
                } else if (enabledFiles.length === 1) {
                    displayEl.textContent = enabledFiles[0].name;
                } else {
                    displayEl.textContent = `${enabledFiles.length} 个文件`;
                }
            }
            
            if (ADVANCED_REGEX_FILES.list.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 30px 20px; color: var(--text-sub);">
                        <i class="fas fa-inbox" style="font-size: 32px; opacity: 0.5; margin-bottom: 10px;"></i>
                        <p style="font-size: 13px;">暂无正则文件</p>
                    </div>
                `;
                return;
            }
            
            ADVANCED_REGEX_FILES.list.forEach(file => {
                const item = document.createElement('div');
                item.style.cssText = 'background: white; border-radius: 10px; padding: 12px; margin-bottom: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;';
                
                const nameColor = file.enabled ? 'var(--accent)' : 'var(--text-main)';
                
                item.innerHTML = `
                    <div style="flex: 1; display: flex; align-items: center; gap: 10px;">
                        <div style="cursor: pointer; flex: 1;" onclick="toggleAdvancedRegexFile(${file.id})">
                            <div style="font-size: 15px; font-weight: 600; color: ${nameColor}; margin-bottom: 4px;">${file.name}</div>
                            <div style="font-size: 12px; color: var(--text-sub);">${file.scripts ? file.scripts.length : 0} 条脚本</div>
                        </div>
                        <i class="fas fa-edit clickable" style="color: var(--accent); font-size: 16px; padding: 8px;" onclick="openRegexDetail(${file.id})"></i>
                    </div>
                    <i class="fas fa-trash-alt" style="color: var(--danger); font-size: 14px; padding: 8px; cursor: pointer;" onclick="deleteAdvancedRegexFile(${file.id})"></i>
                `;
                
                container.appendChild(item);
            });
        }

        // 全局变量，防止快速连续调用时动画冲突
        window.chatScrollAnimationId = null;
        window.userScrolledUp = false; // 用户浏览上滑标记

        // 监听用户的历史回看行为
        document.addEventListener('DOMContentLoaded', () => {
            const container = document.getElementById('chat-messages-container');
            if (container) {
                container.addEventListener('scroll', () => {
                    // 如果距离底部超过 40px，就认为用户在认真看历史记录，锁死置底
                    if (container.scrollHeight - container.scrollTop - container.clientHeight > 40) {
                        window.userScrolledUp = true;
                    } else {
                        // 滚到底部了就解锁
                        window.userScrolledUp = false;
                    }
                    // 🌟 核心：检测是否滑到了顶部
                    if (container.scrollTop <= 5) {
                        if (!currentChatContactId) return;
                        const fullConv = getConversation(currentChatContactId);
                        if (!window.chatMessageLoadCount) window.chatMessageLoadCount = 50;
                        
                        // 只有还没加载完所有记录时才触发
                        if (window.chatMessageLoadCount < fullConv.length) {
                            window.chatMessageLoadCount += 50; // 再往前多拿50条
                            renderChatMessages(currentChatContactId, true); // true代表无感加载，不跳底
                        }
                    }
                }, { passive: true });
            }
        });

        /* --- Cubic Ease-Out 丝滑阻尼滚动 --- */
        function scrollToBottom(force = false) {
            const container = document.getElementById('chat-messages-container');
            if (!container) return;

            // 拦截：如果你正在看上方的历史，且并非手动按了"发送"强制滚动，则不打扰你
            if (window.userScrolledUp && !force) return;

            // 1. 获取起点和终点
            const start = container.scrollTop;
            const target = container.scrollHeight - container.clientHeight;
            const distance = target - start;
            
            // 【调整时长】350ms 能让"减速"过程更明显，更有质感
            const duration = 350; 

            // 优化：如果距离很小，直接到位
            if (Math.abs(distance) < 5) {
                container.scrollTop = target;
                return;
            }

            // 2. 如果上一次动画还没跑完，立刻取消
            if (window.chatScrollAnimationId) {
                cancelAnimationFrame(window.chatScrollAnimationId);
            }

            let startTime = null;

            // 3. 定义丝滑动画过程
            function animation(currentTime) {
                if (!startTime) startTime = currentTime;
                const timeElapsed = currentTime - startTime;
                let progress = timeElapsed / duration;

                if (progress > 1) progress = 1;

                // 【核心魔法】Cubic Ease-Out 曲线
                const ease = 1 - Math.pow(1 - progress, 3);

                // 应用位置
                container.scrollTop = start + (distance * ease);

                if (timeElapsed < duration) {
                    window.chatScrollAnimationId = requestAnimationFrame(animation);
                } else {
                    container.scrollTop = target;
                    window.chatScrollAnimationId = null;
                }
            }

            window.chatScrollAnimationId = requestAnimationFrame(animation);
        }

        // 瞬间置底函数（用于初次打开聊天室或不需要动画的情况）
        function scrollToBottomInstant(force = false) {
            const container = document.getElementById('chat-messages-container');
            if (!container) return;
            
            if (window.userScrolledUp && !force) return;

            container.scrollTop = container.scrollHeight;
            setTimeout(() => {
                if (!window.userScrolledUp || force) {
                    container.scrollTop = container.scrollHeight;
                }
            }, 10);
        }
