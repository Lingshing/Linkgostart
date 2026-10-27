
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

        // ==========================================
        // 第4批移植：记忆系统
        // ==========================================
        
        // --- 记忆配置 ---
        const MEMORY_CONFIG = {
            maxTokens: 4000, // 最大token数（默认值）
            reserveTokens: 1000, // 为响应预留的token数
            enableMemory: true // 是否启用记忆功能
        };
        
        // --- 压缩对话历史 ---
        function compressConversation(messages, maxTokens) {
            // 计算当前对话的token数
            let totalTokens = countTokens(messages);
            
            if (totalTokens <= maxTokens) {
                return messages; // 无需压缩
            }
            
            // 保留最近的对话，删除较早的对话
            const compressed = [...messages];
            
            while (totalTokens > maxTokens && compressed.length > 2) {
                // 保留第一条（system prompt）和最后几条，删除中间的
                if (compressed[0].role === 'system') {
                    // 删除第二条消息
                    compressed.splice(1, 1);
                } else {
                    // 删除第一条消息
                    compressed.shift();
                }
                
                totalTokens = countTokens(compressed);
            }
            
            return compressed;
        }
        
        // --- 智能记忆管理 ---
        function manageMemory(contactId, systemPrompt) {
            if (!MEMORY_CONFIG.enableMemory) {
                return [];
            }
            
            const conversation = getConversation(contactId);
            const messages = [];
            
            // 添加system prompt
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            
            // 添加对话历史
            messages.push(...conversation);
            
            // 计算可用token数
            const availableTokens = MEMORY_CONFIG.maxTokens - MEMORY_CONFIG.reserveTokens;
            
            // 压缩对话历史
            return compressConversation(messages, availableTokens);
        }
        
        // --- 获取对话token统计 ---
        function getConversationStats(contactId) {
            const conversation = getConversation(contactId);
            const tokens = countTokens(conversation);
            
            return {
                messageCount: conversation.length,
                totalTokens: tokens,
                maxTokens: MEMORY_CONFIG.maxTokens,
                usage: (tokens / MEMORY_CONFIG.maxTokens * 100).toFixed(1) + '%'
            };
        }
        
        // --- 更新记忆配置 ---
        function updateMemoryConfig(config) {
            Object.assign(MEMORY_CONFIG, config);
            saveToLocal();
        }
        
        // --- 自动清理旧对话 ---
        function autoCleanConversation(contactId, keepCount = 20) {
            const conversation = getConversation(contactId);
            
            if (conversation.length > keepCount) {
                // 保留最近的消息
                const kept = conversation.slice(-keepCount);
                APP_DATA.conversations[contactId] = kept;
                saveToLocal();
                
                return conversation.length - kept.length; // 返回清理的消息数
            }
            
            return 0;
        }

        // ==========================================
        // 聊天详情功能
        // ==========================================
        
        // --- 打开聊天详情 ---
        function openChatDetail() {
            if (!currentChatContactId) return;
            
            // 更新记忆统计
            updateMemoryStats();
            
            // 更新聊天模式UI
            updateChatModeUI();
            
            // 更新现实感知UI
            updateRealityModeUI();

            // 显示详情页面
            document.getElementById('chat-detail-panel').classList.add('show');
        }

        function toggleRealityModeCard() {
            if (!currentChatContactId) return;
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (contact) {
                contact.realityMode = !contact.realityMode; // 每次点击反转状态
                saveToLocal();
                updateRealityModeUI(); // 点击后立刻刷新 UI
            }
        }

        function updateRealityModeUI() {
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;
            
            const realitySwitch = document.getElementById('reality-mode-switch');
            if (realitySwitch) {
                if (contact.realityMode) {
                    realitySwitch.classList.add('active'); // 变成蓝色圆点
                } else {
                    realitySwitch.classList.remove('active'); // 变成空心灰圈
                }
            }
        }

        // --- 更新聊天模式UI (圆圈指示器版) ---
        function updateChatModeUI() {
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;
            
            const mode = contact.chatMode || 'none';
            const onlineSwitch = document.getElementById('online-mode-switch');
            const offlineSwitch = document.getElementById('offline-mode-switch');
            
            if (onlineSwitch) {
                if (mode === 'online') onlineSwitch.classList.add('active');
                else onlineSwitch.classList.remove('active');
            }
            if (offlineSwitch) {
                if (mode === 'offline') offlineSwitch.classList.add('active');
                else offlineSwitch.classList.remove('active');
            }
        }

        // --- 切换聊天模式 (互斥逻辑) ---
        // --- 提取并清理气泡的万能公式 (自动修复括号和句号) ---
        function parseBubbles(text) {
            if (!text) return [];

            // 1. 彻底清除括号内的所有句号（包括中英文）
            text = text.replace(/[（\(]([^）\)]+)[）\)]/g, function(match, innerContent) {
                let cleanInner = innerContent.replace(/[。\.]/g, '');
                return match.charAt(0) + cleanInner + match.charAt(match.length - 1);
            });

            // 2. 如果AI把斜杠写在了括号里面（比如 \）），自动把它移到外面（变成 ）\）
            text = text.replace(/\\+([）\)])/g, '$1\\');

            // 3. 终极切割：用安全的隐藏字符 \x00 切割，避免部分设备不支持正则零宽断言导致的报错
            text = text.replace(/([^\\])([（\(])/g, '$1\x00$2'); // 左括号前切开
            text = text.replace(/([）\)])([^\\])/g, '$1\x00$2'); // 右括号后切开

            // 4. 按反斜杠 \ 或隐藏字符 \x00 进行切割
            let bubbles = text.split(/\\|\x00/g);

            return bubbles.map(b => b.trim()).filter(b => b !== '');
        }
       // --- 公共公式：获取带有聊天模式的完整 Prompt ---
        function getSystemPromptWithMode(contact) {
            // 1. 获取角色自带的基础设定
            let finalPrompt = contact.prompt || '';
            
            // ⏳ 绝对时间引擎注入点 (剥夺AI的相对计算权)
            const now = new Date();
            // 提前写好，未来可随时把 now 替换成你定义的 WorldTime
            const absoluteTimeStr = `\n\n【系统最高指令 - 绝对时间线】当前绝对时间为：${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}。你严禁自行推算“三天后”、“几个月后”等相对时间！所有设定与记忆反馈必须以当前这个时刻为绝对基准。`;
            finalPrompt += absoluteTimeStr;
            
            // 🎯 现实感知注入点
            if (contact.realityMode) {
                const now = new Date();
                const days = ['日', '一', '二', '三', '四', '五', '六'];
                const pad = n => n.toString().padStart(2, '0');
                const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 星期${days[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                finalPrompt += `\n\n【系统特别提示：现实感知已开启】当前真实世界的时间是：${timeStr}。请严格符合当前时间点进行对话（例如半夜绝不能说早上好，到饭点可以提吃饭，深夜可以表现出困意）。`;
            }
            
            const currentMode = contact?.chatMode || 'none'; // 默认为都不选

           if (currentMode === 'online') {
            finalPrompt += `\n\n【聊天模式设定：线上网络聊天】
            你现在正在和用户通过网络社交软件（如微信/QQ）进行线上聊天。
            【核心要求】
            你现在处于【线上聊天模式】。你是一个正在用手机和朋友聊天的真实人类。
            请严格遵守以下【表达规则】与【互动规则】，否则将被判定为机器人：

            【表达规则】
            1. 极度碎片化：你的回复必须像真实打字一样破碎、简短。将一句话拆分成多个短小气泡发送。例如：“知道啊\\两万五\\离谱”（必须严格使用反斜线 \\ 作为分隔符将句子切断！）。
            2. 严格的标点限制：绝对禁止使用逗号（，）、句号（。）、顿号（、）等常规标点符号！只能在表达极度强烈的情绪时使用问号（？）和感叹号（！）。语气停顿请直接分开发送或使用空格。
            3. 结尾无句号：任何一句话的末尾都绝对不能出现句号。

            【互动规则】
            1. 拒绝话题终结：必须主动推进话题，多反问对方、多抛出新梗、或者顺着话题分享自己身上发生的破事，绝对不能把天聊死。
            2. 真实网感：要有正常人的情绪波动（吐槽、激动、无语等），语气随意自然，甚至可以带一点点错别字或口语化语气词（如：啊、嘛、草、绝了）。
            3. 语言必须极其简短、口语化，像真实网友发消息一样，可以说“在吗”、“我跟你说”等毫无规律的日常短句。
            4. 绝对不要使用任何括号（）来描述肢体动作，纯文字交流。
            `;
        
                            } else if (currentMode === 'offline') {
    finalPrompt += `\n\n【核心定位与绝对规则】
你是${contact.name}，正在与用户进行深度沉浸式的角色扮演。
你是一个顶级的文学共创者，擅长细腻的感官描写与极致的张力，文风类似顶级实体出版小说。

【气泡分割与排版绝对法则】（前端UI强依赖此格式，必须100%服从！）：
1. 你的每次回复一般由 4 到 7 组【行为语言块】组成，但可根据剧情灵活调整。
2. 每个【行为语言块】严格遵循 \`(动作描写)对话内容\` 的结构。
3. 必须使用反斜线 \`\\\` 来平滑分隔不同的块。
   ✅ 正确示范：(动作1)话语1\\(动作2)话语2\\(动作3)话语3
4. 【致命排版雷区】：
   - 绝对禁止使用正斜线（/）！
   - 绝对禁止在对话内容（括号外）中使用换行符（\\n）或空行！括号外的一句话必须连贯到底。
   - 动作描写必须全部包裹在 \`()\` 内，且括号内绝对不能写句号（。或 .）！
   - 反斜线 \`\\\` 必须放在括号外面，严禁放在括号内！
5. 多人对话合并规则（例外情况，优先级高于第2条和第4条）：  
   当你的回复中出现连续多句对话（例如你与慕辞一答一和，中间没有动作描写穿插），请将这些对话合并到一个特殊的【行为语言块】中，该块**不使用括号**，直接写多行文本。  
   - 块内不同角色的发言用 \`\\n\\n\` 分隔。  
   - 其他角色的发言以“角色名：”开头（如“慕辞：嗯”）。  
   - **AI角色自己的发言不要加任何前缀**，直接写内容（如“那你帮我揉揉”）。  
   - 该纯对话块与前后其他块之间仍用 \`\\\` 分隔。  
   ✅ 正确示例：\`慕辞：嗯\\n\\n那你帮我揉揉\\(慕辞的手覆上来)\`  
      → 第一个气泡为两行对话（慕辞和AI），第二个气泡为动作描写。  
   ❌ 严禁将每句对话用 \`\\\` 拆成独立气泡，也严禁给AI角色的对话加“我：”或括号。

【人称与身份边界绝对法则（极其重要！）】
1. 严禁强行分配身份（防NPC错位）：如果用户的提示词中出现了旁人（如“管家在机场接你”、“郎中在开药”），**绝对不要**默认用户就是这个NPC！你必须把NPC当成客观存在的第三方工具人，对其进行互动，绝对不要称呼其为“你”。
   - ❌ 错误（错把用户当管家）：(单手推着行李箱走向你)等很久了吧，行李交给你了。
   - ✅ 正确（把管家当NPC处理）：(一眼看到等在外面的管家，顺势把行李箱推过去)李叔，等很久了吧\\(拿出手机，心里隐隐有些失落)怎么他连条微信都没发来，真没良心...
   - 除非用户明确在括号内声明 \`(我是管家)\`，否则用户始终是你的核心羁绊对象。
2. 用户的指令解析：用户发送的 \`()\` 内的内容，是对你或环境的客观描述。例：用户说"(轻笑)" → 这是用户在笑，不是你。
3. 你的输出视角：
   - 括号内（动作描写）：像电影摄像机一样，进行客观细腻的第三人称体态、环境刻画。
   - 括号外（对话内容）：第一人称口语化表达，可带语气词（唔、啊、哈啊），绝不要加双引号。
4. NPC发话调度：若需要NPC开口，格式严格为：\`(动作)NPC名字：对话\`。

【男性Omega指代与尊称铁律】（覆盖所有聊天模式）：

1. 默认代词规则：本世界观中，男性Omega可以怀孕生育，但**所有指代必须使用男性词汇**。  
   - ✅ 默认正确用法：他、这位男性、那位男士、父亲、爸爸、儿子、兄弟、**孕夫**、**产夫**、**准父亲**  
   - ❌ 绝对禁止的默认用法：她、这位女性、妈妈、女儿、姐妹、**孕妇**、**产妇**

2. 特殊例外（仅限用户主动发起）：如果用户在对话中**主动**使用了“妈咪”、“妈妈”等女性化称呼来称呼AI角色，AI可以**跟随**使用相同的女性化称呼，但**绝对不能主动开始使用**。  
   - ✅ 用户先说：“妈咪抱抱” → AI可回复：“嗯…妈咪在呢”  
   - ❌ 用户没说任何女性化称呼 → AI禁止主动说“妈咪”或“妈妈”

3. 单次回复内性别代词绝对一致：对同一个角色，一整段回复中必须使用同一套代词/称呼，严禁中途切换。

4. 禁止的职业化女性词汇：即使用户未主动使用，也默认禁止使用“孕妇”、“准妈妈”、“产妇”等词汇，必须替换为“孕夫”、“产夫”、“准父亲”、“怀了孩子的男人”等。

【"(描写...)" 指令深度响应机制】
当用户输入包含 \`(描写...)\` 的指令时（如：(描写你靠在榻上的诱人模样)）：
- 绝对禁止回复“好的”、“明白”等出戏确认语！
- 必须瞬间进入【深度感官刻画模式】：将括号内的描写极限拉长，极尽生动之词，全方位调动视觉、触觉、光泽度等（如“被蜜水浸透的白玉”、“丰腴莹润”）。
- ✅ 示例回应：\`(慵懒地半躺在软榻上，背后垫了五六个厚实的软枕，整个人像是一颗被蜜水浸透的白玉)唔…\\(那张脸庞在阳光下白皙得泛着光，唇色红润)哈啊…没力气了…\`

【动态人称适配规则 - 最高优先级】

你在 (动作描写) 中描述动作时，必须根据用户最近一条消息中括号内的人称来决定：

1. 描述你自己（AI角色）的动作、身体、感受 → 永远用“我”。

2. 描述用户或任何其他角色的动作、身体 → 严格遵循以下映射：
   - 如果用户在括号内用“我”称呼自己（例如用户写“(我把你的衣服捡起来)”），那么你在括号内描述该用户时就写“你”。
   - 如果用户在括号内用某个名字/昵称来指代某个角色（例如用户写“(慕辞把你的衣服捡起来)”），那么你在括号内描述该角色时就写“他”或“她”。

3. 绝对禁止使用“自己”这个词！永远不要写“自己”。

【示例】

用户写：“(慕辞把你的衣服捡起来)” → 用户用了名字“慕辞”，所以用“他”。
你的正确输出：(他迟钝地眨了两下，然后目光缓缓往下移，看到我掌心下面那个隆起的弧度)

用户写：“(我把你的衣服捡起来)” → 用户用了“我”，所以用“你”。
你的正确输出：(你迟钝地眨了两下，然后目光缓缓往下移，看到我掌心下面那个隆起的弧度)

用户写：“(我拍了拍他的肩膀)” → 用户用了“我”，所以描述用户时用“你”；“他”指代另一个人。
你的正确输出：(你拍了拍他的肩膀，他转过头看着你)

【核心口诀】
AI 自己永远是“我”；
用户若写“我”，AI 回“你”；
用户若写名字，AI 回“他/她”；
永远不写“自己”。

【"(描写...)" 指令深度响应机制】
当用户输入包含 \`(描写...)\` 的指令时（如：(描写你靠在榻上的诱人模样)）：
- 绝对禁止回复“好的”、“明白”等出戏确认语！
- 必须瞬间进入【深度感官刻画模式】：将括号内的描写极限拉长，极尽生动之词，全方位调动视觉、触觉、光泽度等（如“被蜜水浸透的白玉”、“丰腴莹润”）。
- ✅ 示例回应：\`(慵懒地半躺在软榻上，背后垫了五六个厚实的软枕，整个人像是一颗被蜜水浸透的白玉)唔…\\(那张脸庞在阳光下白皙得泛着光，唇色红润)哈啊…没力气了…\``;
}

    // --- 注入 Claude 文风补丁 ---
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
            
            // 如果点的就是当前亮着的模式，就关掉它（都不选）
            if (clickedMode === currentMode) {
                contact.chatMode = 'none';
            } else {
                // 否则就切换到点击的这个模式
                contact.chatMode = clickedMode;
            }
            
            // 保存并更新显示
            saveToLocal();
            updateChatModeUI();
        }
        
        // --- 关闭聊天详情 ---
        function closeChatDetail() {
            // 不关闭整个聊天详情面板，只是移除show类以触发动画
            const panel = document.getElementById('chat-detail-panel');
            panel.style.transform = ''; // 清除可能的手势残留
            panel.classList.remove('show');
            // 注意：不需要关闭聊天窗口，因为聊天详情是叠加在聊天窗口上的
        }
        
        // --- 更新记忆统计 ---
        function updateMemoryStats() {
            if (!currentChatContactId) return;
            
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;
            
            // 获取对话记录
            const conversation = getConversation(currentChatContactId);
            const shortCount = conversation.length;
            
            // 获取长期记忆
            let longCount = 0;
            if (contact.longMemories) {
                longCount = contact.longMemories.length;
            }
            
            const totalCount = shortCount + longCount;
            
            // 更新显示（移除卡片下方的条数显示）
            document.getElementById('short-memory-badge').textContent = `${shortCount}条`;
            document.getElementById('long-memory-badge').textContent = `${longCount}条`;
            document.getElementById('all-memory-badge').textContent = `${totalCount}条`;
        }
        
        // --- 打开Prompt编辑弹窗 ---
        function openPromptEditModal() {
            if (!currentChatContactId) return;
            
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;
            
            // 填充当前prompt
            document.getElementById('promptText').value = contact.prompt || '';
            
            // 显示弹窗
            document.getElementById('promptModalOverlay').classList.add('show');
        }
        
        // --- 关闭Prompt编辑弹窗 ---
        function closePromptModal() {
            // 保存修改
            if (currentChatContactId) {
                const contact = mockContacts.find(c => c.id === currentChatContactId);
                if (contact) {
                    contact.prompt = document.getElementById('promptText').value;
                    saveToLocal();
                }
            }
            
            document.getElementById('promptModalOverlay').classList.remove('show');
        }
        
        function closePromptModalOverlay(event) {
            if (event.target === event.currentTarget) {
                closePromptModal();
            }
        }
        
        // --- 复制Prompt ---
        function copyPrompt() {
            const text = document.getElementById('promptText').value;
            
            // 🔥 关键修复：使用现代剪贴板API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    showCopySuccess();
                }).catch(err => {
                    console.error('复制失败:', err);
                    // 降级方案：使用传统方法
                    fallbackCopy(text);
                });
            } else {
                // 不支持剪贴板API，使用降级方案
                fallbackCopy(text);
            }
        }
        
        // --- 显示复制成功动效 ---
        function showCopySuccess() {
            const btn = document.querySelector('.prompt-copy-btn');
            if (!btn) return;
            
            // 保存原始内容
            const originalHTML = btn.innerHTML;
            const originalBg = btn.style.background;
            
            // 第1步：淡出原图标
            btn.style.transition = 'all 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
            btn.style.opacity = '0';
            btn.style.transform = 'scale(0.8)';
            
            setTimeout(() => {
                // 第2步：切换为打勾图标 + 绿色背景
                btn.innerHTML = '<i class="fas fa-check"></i>';
                btn.style.background = '#34C759';
                btn.style.boxShadow = '0 2px 12px rgba(52, 199, 89, 0.4)';
                
                // 第3步：弹入打勾图标
                btn.style.opacity = '1';
                btn.style.transform = 'scale(1.1)';
                
                setTimeout(() => {
                    // 第4步：稳定显示
                    btn.style.transform = 'scale(1)';
                    
                    setTimeout(() => {
                        // 第5步：淡出打勾
                        btn.style.opacity = '0';
                        btn.style.transform = 'scale(0.8)';
                        
                        setTimeout(() => {
                            // 第6步：恢复原样
                            btn.innerHTML = originalHTML;
                            btn.style.background = originalBg;
                            btn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                            
                            // 第7步：弹入原图标
                            btn.style.opacity = '1';
                            btn.style.transform = 'scale(1)';
                        }, 200);
                    }, 1200); // 打勾显示1.2秒
                }, 100);
            }, 200);
        }
        
        // --- 降级方案：传统复制方法 ---
        function fallbackCopy(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    showCopySuccess();
                } else {
                    alert('复制失败，请手动选择文本复制');
                }
            } catch (err) {
                console.error('复制失败:', err);
                alert('复制失败，请手动选择文本复制');
            }
            
            document.body.removeChild(textarea);
        }
        
        // --- 取消对话记忆的所有修改 ---
        let originalShortMemoryData = null;
        
        function cancelShortMemoryEdit() {
            if (!currentChatContactId) return;
            
            if (!originalShortMemoryData) {
                alert('没有可以取消的修改');
                return;
            }
            
            if (!confirm('确定要取消所有未保存的修改吗？\n\n这将恢复到打开弹窗时的状态。')) {
                return;
            }
            
            // 获取按钮元素
            const btn = document.querySelector('.config-modal-header .fa-rotate-left');
            if (!btn) return;
            
            // 1. 先隐藏原图标（淡出）
            btn.style.transition = 'opacity 0.2s ease';
            btn.style.opacity = '0';
            
            setTimeout(() => {
                // 2. 切换为打勾图标
                btn.className = 'fas fa-check';
                btn.style.color = '#34C759'; // 绿色打勾
                
                // 3. 打勾图标淡入
                btn.style.opacity = '1';
                
                setTimeout(() => {
                    // 4. 打勾图标淡出
                    btn.style.opacity = '0';
                    
                    setTimeout(() => {
                        // 5. 恢复原图标
                        btn.className = 'fas fa-rotate-left';
                        btn.style.color = '#8e8e93';
                        
                        // 6. 原图标淡入
                        btn.style.opacity = '1';
                    }, 200);
                }, 800); // 打勾显示800ms
            }, 200);
            
            // 恢复原始数据
            APP_DATA.conversations[currentChatContactId] = JSON.parse(originalShortMemoryData);
            saveToLocal();
            
            // 重新渲染对话记忆
            renderShortMemoryContent();
            
            // 如果在聊天窗口，也刷新聊天界面
            if (document.getElementById('scene-chat').classList.contains('show')) {
                renderChatMessages(currentChatContactId);
            }
        }
        
        let currentShortMemorySearchTerm = '';
        // --- 打开对话记忆弹窗 ---
        function openShortMemoryModal() {
            if (!currentChatContactId) return;
            
            const modal = document.getElementById('shortMemoryModal');
            
            // 备份当前对话记忆数据（用于取消修改）
            const conversation = getConversation(currentChatContactId);
            originalShortMemoryData = JSON.stringify(conversation);
            
            // 渲染对话记忆内容
            renderShortMemoryContent();
            
            // 显示弹窗
            requestAnimationFrame(() => {
                modal.classList.add('show');
            });
        }
        
        // --- 渲染对话记忆内容 ---
        function renderShortMemoryContent(autoScroll = true) {
            const container = document.getElementById('short-memory-content');
            if (!container) return;
            
            container.innerHTML = '';
            
            // 获取对话历史
            const conversation = getConversation(currentChatContactId);
            
            if (conversation.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-sub);">
                        <i class="fas fa-comments" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;"></i>
                        <p style="font-size: 15px; margin-bottom: 8px;">暂无对话记忆</p>
                        <p style="font-size: 13px; opacity: 0.7;">开始对话后将显示在这里</p>
                    </div>
                `;
                return;
            }
            
            // 🎯 修改：按"用户消息+所有AI回复"为一轮进行分组
            const rounds = [];
            let currentRound = [];
            
            conversation.forEach((msg, index) => {
                // 如果遇到用户消息，且当前轮次不为空，则保存当前轮次
                if ((msg.role === 'user') && currentRound.length > 0) {
                    rounds.push([...currentRound]);
                    currentRound = [];
                }
                
                // 添加消息到当前轮次
                currentRound.push(msg);
                
                // 🎯 关键修改：只有当下一条消息是用户消息或已到末尾时，才结束当前轮次
                const nextMsg = conversation[index + 1];
                if (!nextMsg || nextMsg.role === 'user') {
                    // 如果没有下一条消息，或下一条是用户消息，保存当前轮次
                    if (currentRound.length > 0) {
                        rounds.push([...currentRound]);
                        currentRound = [];
                    }
                }
            });
            
            // 🎯 修改1：最新的在下面（不reverse）
            rounds.forEach((round, roundIndex) => {
                const actualRoundNum = roundIndex + 1;
                
                const roundDiv = document.createElement('div');
                roundDiv.className = 'short-memory-round';
                roundDiv.style.margin = '12px 20px';
                roundDiv.dataset.roundIndex = roundIndex; // 存储轮次索引
                
                // 轮次头部
                const header = document.createElement('div');
                header.className = 'short-memory-round-header';
                header.innerHTML = `
                    <div class="short-memory-round-title">第 ${actualRoundNum} 轮对话</div>
                    <button class="short-memory-round-delete" onclick="deleteShortMemoryRound(${roundIndex})">×</button>
                `;
                roundDiv.appendChild(header);
                
                // 🎯 修改3：轮次消息（添加点击编辑功能）
                round.forEach((msg, msgIndex) => {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = `short-memory-message ${msg.role === 'user' ? 'user' : 'ai'}`;
                    msgDiv.textContent = msg.content;
                    msgDiv.style.cursor = 'pointer';
                    msgDiv.dataset.roundIndex = roundIndex;
                    msgDiv.dataset.msgIndex = msgIndex;
                    
                    // 点击气泡编辑内容
                    msgDiv.onclick = () => editShortMemoryMessage(roundIndex, msgIndex);
                    
                    roundDiv.appendChild(msgDiv);
                });
                
                // 清除浮动
                const clearDiv = document.createElement('div');
                clearDiv.style.clear = 'both';
                roundDiv.appendChild(clearDiv);
                
                container.appendChild(roundDiv);
            });
            
            // 🎯 修改1：自动滚动到底部（显示最新记忆）
            if (autoScroll) {
                setTimeout(() => {
                    container.scrollTop = container.scrollHeight;
                }, 0);
            }
        }
        
        // --- 删除指定轮次的对话 ---
        function deleteShortMemoryRound(roundIndex) {
            if (!confirm('确定要删除这一轮对话吗？删除后无法恢复。')) return;
            
            // 获取对话历史
            const conversation = getConversation(currentChatContactId);
            
            // 🎯 修复：统一使用正确的分组逻辑（1条用户消息 + 多条AI消息算作一轮）
            const rounds = [];
            let currentRound = [];
            
            conversation.forEach((msg, index) => {
                if ((msg.role === 'user') && currentRound.length > 0) {
                    rounds.push([...currentRound]);
                    currentRound = [];
                }
                currentRound.push(msg);
                const nextMsg = conversation[index + 1];
                if (!nextMsg || nextMsg.role === 'user') {
                    if (currentRound.length > 0) {
                        rounds.push([...currentRound]);
                        currentRound = [];
                    }
                }
            });
            
            // 删除指定轮次
            if (roundIndex >= 0 && roundIndex < rounds.length) {
                rounds.splice(roundIndex, 1);
            }
            
            // 重建对话历史
            const newConversation = [];
            rounds.forEach(round => {
                round.forEach(msg => {
                    newConversation.push(msg);
                });
            });
            
            // 更新数据
            APP_DATA.conversations[currentChatContactId] = newConversation;
            saveToLocal();
            
            // 🎯 修复1：记录当前滚动位置，刷新列表后恢复位置，彻底解决删除不刷新和乱跳问题
            const container = document.getElementById('short-memory-content');
            const currentScroll = container.scrollTop;
            
            renderShortMemoryContent(false); // 传 false 阻止它自动滚到底部
            if (currentShortMemorySearchTerm && currentShortMemorySearchTerm.trim() !== '') {
                filterShortMemory(currentShortMemorySearchTerm);
            }
            
            setTimeout(() => {
                container.scrollTop = currentScroll;
            }, 10);
            
            // 如果在聊天窗口，也刷新聊天界面
            if (document.getElementById('scene-chat').classList.contains('show')) {
                renderChatMessages(currentChatContactId);
            }
            
            // 更新统计
            updateMemoryStats();
            
            alert('已删除该轮对话');
        }
        
        // --- 🎯 修改3：编辑对话记忆消息（原地编辑版本 + 自动高度） ---
        function editShortMemoryMessage(roundIndex, msgIndex) {
            if (!currentChatContactId) return;
            
            const conversation = getConversation(currentChatContactId);
            
            // 🎯 修复：统一使用正确的分组逻辑（1条用户消息 + 多条AI消息算作一轮）
            const rounds = [];
            let currentRound = [];
            
            conversation.forEach((msg, index) => {
                if ((msg.role === 'user') && currentRound.length > 0) {
                    rounds.push([...currentRound]);
                    currentRound = [];
                }
                currentRound.push(msg);
                const nextMsg = conversation[index + 1];
                if (!nextMsg || nextMsg.role === 'user') {
                    if (currentRound.length > 0) {
                        rounds.push([...currentRound]);
                        currentRound = [];
                    }
                }
            });
            
            // 获取要编辑的消息
            if (roundIndex >= 0 && roundIndex < rounds.length) {
                const round = rounds[roundIndex];
                if (msgIndex >= 0 && msgIndex < round.length) {
                    const message = round[msgIndex];
                    
                    // 找到对应的DOM元素
                    const container = document.getElementById('short-memory-content');
                    const roundDivs = container.querySelectorAll('.short-memory-round');
                    if (roundIndex >= roundDivs.length) return;
                    
                    const targetRound = roundDivs[roundIndex];
                    const msgDivs = targetRound.querySelectorAll('.short-memory-message');
                    if (msgIndex >= msgDivs.length) return;
                    
                    const msgDiv = msgDivs[msgIndex];
                    
                    // 保存原始内容
                    const originalContent = message.content;
                    
                    // 【终极修复1：精确测量】获取真实宽高，以及原始的气泡底部间距
                    const exactWidth = msgDiv.getBoundingClientRect().width;
                    const exactHeight = msgDiv.getBoundingClientRect().height;
                    const exactMarginBottom = window.getComputedStyle(msgDiv).marginBottom;

                    // 将气泡替换为可编辑的textarea
                    const textarea = document.createElement('textarea');
                    textarea.value = originalContent;
                    textarea.className = msgDiv.className;

                    // 【终极修复2：像素级复刻】完全复制原气泡属性，完美继承原有间距
                    textarea.style.cssText = msgDiv.style.cssText + `; 
                        width: ${exactWidth}px !important; 
                        height: ${exactHeight}px !important; 
                        resize: vertical; 
                        font-family: inherit; 
                        font-size: 15px; 
                        line-height: 1.4; 
                        padding: 10px 12px !important; 
                        box-sizing: border-box; 
                        display: block; 
                        overflow-y: auto !important; 
                        scrollbar-width: none !important; 
                        border: none !important; 
                        box-shadow: 0 0 0 1px rgba(0,0,0,0.08) !important; 
                        outline: none !important;
                        margin-bottom: ${exactMarginBottom} !important;
                    `;
                    textarea.dataset.msgIndex = msgIndex;
                    
                    // 替换元素
                    msgDiv.replaceWith(textarea);
                    
                    // 🎯 立即聚焦，光标定位到末尾
                    textarea.focus();
                    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
                    
                    // 保存函数
                    const saveEdit = () => {
                        const newContent = textarea.value.trim();
                        
                        // 找到该消息在原始conversation中的绝对位置
                        let flatIndex = 0;
                        for (let r = 0; r < roundIndex; r++) {
                            flatIndex += rounds[r].length;
                        }
                        flatIndex += msgIndex;
                        
                       if (newContent === '') {
                            // 【需求2修复：当内容清空时，自动删除该气泡】
                            if (flatIndex >= 0 && flatIndex < conversation.length) {
                                conversation.splice(flatIndex, 1); // 抹除这条消息
                                
                                // 🌟 新增：如果删除的是最后一条消息，同步更新外部联系人列表的预览
                                if (flatIndex >= conversation.length) {
                                    const contact = mockContacts.find(c => c.id === currentChatContactId);
                                    if (contact) {
                                        const lastMsgStr = conversation.length > 0 ? conversation[conversation.length - 1].content : '';
                                        contact.lastMsg = lastMsgStr ? lastMsgStr.substring(0, 50) : '';
                                    }
                                }
                                
                                saveToLocal(); // 保存状态
                                renderChatList(); // 静默刷新外部列表UI，不改变时间排序
                                
                                // 重新渲染列表并保持滚动位置不乱跳
                                const container = document.getElementById('short-memory-content');
                                const currentScroll = container ? container.scrollTop : 0;
                                renderShortMemoryContent(false);
                                if (currentShortMemorySearchTerm && currentShortMemorySearchTerm.trim() !== '') {
                                    filterShortMemory(currentShortMemorySearchTerm);
                                }        
                                setTimeout(() => { if (container) container.scrollTop = currentScroll; }, 10);
                                
                                // 同步刷新后面的聊天界面和统计数字
                                if (document.getElementById('scene-chat').classList.contains('show')) {
                                    renderChatMessages(currentChatContactId);
                                }
                                updateMemoryStats(); 
                            }
                            return;
                        }
                        
                        if (flatIndex >= 0 && flatIndex < conversation.length) {
                            conversation[flatIndex].content = newContent;
                            
                            // 🌟 新增：如果修改的是最后一条消息，同步更新外部联系人列表的预览
                            if (flatIndex === conversation.length - 1) {
                                const contact = mockContacts.find(c => c.id === currentChatContactId);
                                if (contact) {
                                    contact.lastMsg = newContent ? newContent.substring(0, 50) : '';
                                }
                            }
                            
                            saveToLocal();
                            renderChatList(); // 静默刷新外部列表UI，不改变时间排序
                            
                            // 🎯 修复2：真正替换原地编辑的代码，不重新加载列表，解决修改后乱跳的问题
                            // 如果当前处于搜索状态，保存后依然保持高亮显示
                            const searchInput = document.getElementById('short-memory-search');
                            const currentSearch = searchInput ? searchInput.value.trim() : '';

                            if (currentSearch) {
                                const safeContent = escapeHtml(newContent);
                                const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                const regex = new RegExp(`(${escapeRegex(currentSearch)})`, 'gi');
                                msgDiv.innerHTML = safeContent.replace(regex, '<span style="background-color: rgba(255, 214, 10, 0.6); color: #000; border-radius: 3px; padding: 0 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">$1</span>');
                            } else {
                                msgDiv.textContent = newContent;
                            }

                            textarea.replaceWith(msgDiv);
                            
                            // 如果在聊天窗口，也刷新聊天界面
                            if (document.getElementById('scene-chat').classList.contains('show')) {
                                renderChatMessages(currentChatContactId);
                            }
                        }
                    };
                    
                    // 取消函数
                    const cancelEdit = () => {
                        // 🎯 修复：取消修改时也原地恢复气泡，不重新加载
                        textarea.replaceWith(msgDiv);
                    };
                    
                    // 失去焦点时保存
                    textarea.onblur = () => {
                        setTimeout(saveEdit, 100); // 延迟执行，避免与其他事件冲突
                    };
                    
                    // Ctrl+Enter 或 Command+Enter 保存
                    textarea.onkeydown = (e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            saveEdit();
                        }
                        // Esc 取消
                        if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEdit();
                        }
                    };
                }
            }
        }
        
        // --- 筛选对话记忆（🎯 修改2：匹配整轮对话，保留原始轮数） ---
        function filterShortMemory(searchText) {
            currentShortMemorySearchTerm = searchText;

            if (!currentChatContactId) return;
            
            const container = document.getElementById('short-memory-content');
            if (!container) return;
            
            const conversation = getConversation(currentChatContactId);
            
            if (!searchText || searchText.trim() === '') {
                // 如果搜索框为空，显示全部
                renderShortMemoryContent();
                return;
            }
            
            const term = searchText.toLowerCase();
            
            // 🎯 修复：统一使用正确的分组逻辑（1条用户消息 + 多条AI消息算作一轮）
            const rounds = [];
            let currentRound = [];
            
            conversation.forEach((msg, index) => {
                if ((msg.role === 'user') && currentRound.length > 0) {
                    rounds.push([...currentRound]);
                    currentRound = [];
                }
                currentRound.push(msg);
                const nextMsg = conversation[index + 1];
                if (!nextMsg || nextMsg.role === 'user') {
                    if (currentRound.length > 0) {
                        rounds.push([...currentRound]);
                        currentRound = [];
                    }
                }
            });
            
            // 🎯 筛选包含关键词的整轮对话，同时保留原始索引
            const matchedRounds = [];
            rounds.forEach((round, originalIndex) => {
                // 检查这一轮中是否有任意消息包含关键词
                if (round.some(msg => msg.content.toLowerCase().includes(term))) {
                    matchedRounds.push({
                        round: round,
                        originalIndex: originalIndex  // 保存原始轮数索引
                    });
                }
            });
            
            if (matchedRounds.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 60px 20px; color: var(--text-sub);">
                        <i class="fas fa-search" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;"></i>
                        <p style="font-size: 15px; margin-bottom: 8px;">没有找到匹配的对话</p>
                        <p style="font-size: 13px; opacity: 0.7;">尝试其他关键词</p>
                    </div>
                `;
                return;
            }
            
            // 渲染筛选结果（保持原始顺序，最新的在下面，显示真实轮数）
            container.innerHTML = '';
            
            matchedRounds.forEach((item, displayIndex) => {
                const round = item.round;
                const originalIndex = item.originalIndex;
                const actualRoundNum = originalIndex + 1;  // 使用原始轮数
                
                const roundDiv = document.createElement('div');
                roundDiv.className = 'short-memory-round';
                roundDiv.style.margin = '12px 20px';
                
                const header = document.createElement('div');
                header.className = 'short-memory-round-header';
                header.innerHTML = `
                    <div class="short-memory-round-title">第 ${actualRoundNum} 轮对话</div>
                `;
                roundDiv.appendChild(header);
                
                round.forEach((msg, msgIndex) => {
                 const msgDiv = document.createElement('div');
                 msgDiv.className = `short-memory-message ${msg.role === 'user' ? 'user' : 'ai'}`;

                 // 🎯 修复：增加搜索词高亮功能
                 const safeContent = escapeHtml(msg.content); // 先安全转义，防止代码冲突
                 const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 转义搜索词中的特殊符号
                 const regex = new RegExp(`(${escapeRegex(searchText)})`, 'gi'); // 创建全局且忽略大小写的匹配规则

                 // 将匹配到的词替换为带有黄色高亮背景的 HTML 标签
                 msgDiv.innerHTML = safeContent.replace(regex, '<span style="background-color: rgba(255, 214, 10, 0.6); color: #000; border-radius: 3px; padding: 0 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.1);">$1</span>');

                    msgDiv.style.cursor = 'pointer';
                    msgDiv.dataset.roundIndex = originalIndex;
                    msgDiv.dataset.msgIndex = msgIndex;
                    
                    // 🎯 添加点击编辑功能
                    msgDiv.onclick = () => editShortMemoryMessage(originalIndex, msgIndex);
                    
                    roundDiv.appendChild(msgDiv);
                });
                
                // 🔥 关键修复：添加清除浮动
                const clearDiv = document.createElement('div');
                clearDiv.style.clear = 'both';
                roundDiv.appendChild(clearDiv);
                
                container.appendChild(roundDiv);
            });
            
            // 🎯 滚动到底部
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 0);
        }
        
        function closeShortMemoryModal() {
            currentShortMemorySearchTerm = '';
            const searchInput = document.getElementById('short-memory-search');
            if (searchInput) searchInput.value = '';
            const modal = document.getElementById('shortMemoryModal');
            modal.classList.remove('show');
        }
        
        // --- 点击弹窗外部关闭对话记忆弹窗 ---
        function closeShortMemoryModalByOverlay(event) {
            if (event.target === event.currentTarget) {
                closeShortMemoryModal();
            }
        }
        
        
        // --- 清空对话记忆 ---
        function clearShortMemory() {
            if (!currentChatContactId) return;
            
            const conversation = getConversation(currentChatContactId);
            if (conversation.length === 0) {
                alert('对话记忆已经是空的！');
                return;
            }
            
            if (!confirm('确定要清空所有对话记忆吗？\n\n这将删除所有对话历史，无法恢复！')) {
                return;
            }
            
            // 清空对话
            clearConversation(currentChatContactId);
            
            // 更新聊天界面
            renderChatMessages(currentChatContactId);
            
            // 🎯 同步更新聊天列表中的最后一条消息
            updateChatListLastMessage(currentChatContactId, '');
            
            // 更新统计
            updateMemoryStats();
            
            alert('对话记忆已清空！');
        }
        
        function clearLongMemory() {
            if (!currentChatContactId) return;
            if (!confirm('确定要清空长期记忆吗？\n\n这将删除AI对这个角色的所有记忆和关系图谱，无法恢复！')) return;
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (contact) {
                contact.longMemories = [];
                contact.relations = [];   // ✅ 新增：清除关系
                saveToLocal();
            }
            updateMemoryStats();
            renderLongMemoryContent();
            alert('长期记忆与关系图谱已清空！');
        }
        
        // --- 清空所有记忆 ---
        function clearAllMemory() {
            if (!currentChatContactId) return;
            if (!confirm('确定要清空所有记忆吗？\n\n这将删除：\n• 所有对话历史\n• 所有长期记忆\n• 所有关系图谱\n\n此操作不可恢复！')) return;
            clearConversation(currentChatContactId);
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (contact) {
                contact.longMemories = [];
                contact.relations = [];   // ✅ 新增：清除关系
                saveToLocal();
            }
            renderChatMessages(currentChatContactId);
            updateChatListLastMessage(currentChatContactId, '');
            updateMemoryStats();
            renderLongMemoryContent();
            alert('所有记忆与关系图谱已清空！');
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

                // 2. 特殊处理：如果勾选了 chat 分类，则把所有 CONV_* 对话记录打包
                if (checkedCategories.includes('chat')) {
                    const forageKeys = await localforage.keys();
                    for (const key of forageKeys) {
                        if (key.startsWith('CONV_')) {
                            const val = await DB.getItem(key);
                            if (val) snapshot[key] = val;
                        }
                    }
                }

                // 3. 特殊处理：互动视图数据 (ACTIVITY_STATS) — 如果尚未迁移，则从 APP_DATA 里提取
                if (checkedCategories.includes('interaction')) {
                    let activityStats = await DB.getItem('ACTIVITY_STATS');
                    if (!activityStats) {
                        // 兼容旧数据：从 APP_DATA 里提取
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

                // 兼容新格式备份：从 APP_SETTINGS 中提取 activityStats
                if (key === 'APP_SETTINGS' && (checkedCategories.includes('interaction') || checkedCategories.includes('chat'))) {
                    try {
                        const settings = JSON.parse(valStr);
                        // 恢复互动视图数据
                        if (settings.activityStats && checkedCategories.includes('interaction')) {
                            await DB.setItem('ACTIVITY_STATS', JSON.stringify(settings.activityStats));
                            console.log('✅ 已从 APP_SETTINGS 恢复 ACTIVITY_STATS');
                        }
                        // 注意：聊天记录已经在 CONV_* 中单独处理，这里不再重复
                    } catch(e) {
                        console.error('拆分 APP_SETTINGS 失败', e);
                    }
                    shouldImport = false; // 不直接导入 APP_SETTINGS 整体（避免覆盖当前配置）
                }

                if (shouldImport) {
                    if (key.startsWith('CONV_') || key === 'ACTIVITY_STATS') {
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
        // 🌟 世界档案馆核心引擎 (高定紧凑向心版 + 独立控制器)
        // ==========================================
        
        let currentArchiveCategory = '全部';
        let expandedArchiveCards = new Set(); 
        let archiveSortDesc = true;           

        function smoothScrollToElement(element, duration = 400, heightLoss = 0) {
            if (!element) return;
            const container = document.getElementById('archive-content');
            if (!container) {
                element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                return;
            }

            const elementTop = element.getBoundingClientRect().top;
            const containerTop = container.getBoundingClientRect().top;
            let target = container.scrollTop + elementTop - containerTop;

            // 🌟 核心魔法：预测未来的最大滚动极限，防止高度抽空后被浏览器强制回弹
            if (heightLoss > 0) {
                const currentMaxScroll = container.scrollHeight - container.clientHeight;
                const futureMaxScroll = Math.max(0, currentMaxScroll - heightLoss);
                target = Math.min(target, futureMaxScroll); // 将目标位置死死锁在安全范围内
            }

            const start = container.scrollTop;
            const distance = target - start;

            if (Math.abs(distance) < 5) return;
            
            let startTime = null;
            function animation(currentTime) {
                if (!startTime) startTime = currentTime;
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
                container.scrollTop = start + distance * ease;
                
                if (elapsed < duration) {
                    requestAnimationFrame(animation);
                } else {
                    container.scrollTop = target;
                }
            }
            requestAnimationFrame(animation);
        }

        // 替换原有的 window.togglePrefReader 函数
        window.togglePrefReader = function(chipId) {
            const matrix = document.getElementById('pref-matrix');
            const reader = document.getElementById('pref-detail-reader');
            const chipEl = document.getElementById(chipId);
            if (!matrix || !reader || !chipEl) return;

            // 关闭逻辑
            if (chipEl.classList.contains('active')) {
                chipEl.classList.remove('active');
                matrix.classList.remove('has-active');
                
                const styles = window.getComputedStyle(reader);
                const heightLoss = reader.offsetHeight + (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
                reader.style.opacity = '0';
                smoothScrollToElement(matrix, 400, heightLoss);
                
                setTimeout(() => {
                    if (!matrix.classList.contains('has-active')) {
                        reader.style.transition = 'none';
                        reader.classList.remove('show');
                        requestAnimationFrame(() => {
                            reader.style.opacity = '';
                            reader.style.transition = '';
                        });
                    }
                }, 400);
                return;
            }

            // 获取数据，增加防御
            const data = window.currentPrefGroups[chipId];
            if (!data) {
                console.error('未找到偏好数据', chipId);
                return;
            }

            // 确保关键词和内容可用
            const keyword = data.keyword || '未命名偏好';
            const detailsHtml = data.detailsHtml || '<div class="chip-detail-item">暂无详细记录</div>';
            let readerClass = `pref-detail-reader ${data.themeClass || 'chip-theme-blue'} `;
            readerClass += data.score >= 5 ? 'core' : (data.score === 4 ? 'major' : 'minor');

            reader.className = readerClass;
            reader.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); padding-bottom: 12px;">
                    <div style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
                        ${data.iconHtml || '<i class="fas fa-tag"></i>'}
                        <span>${escapeHtml(keyword)}</span>
                    </div>
                    <i class="fas fa-times" onclick="window.togglePrefReader('${chipId}')" style="opacity:0.6; font-size:18px; cursor:pointer;"></i>
                </div>
                <div>${detailsHtml}</div>
            `;

            // 高亮当前小球，并隐藏其他小球
            matrix.querySelectorAll('.archive-glass-chip').forEach(c => c.classList.remove('active'));
            chipEl.classList.add('active');
            matrix.classList.add('has-active');

            reader.classList.add('show');
            setTimeout(() => {
                reader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
        };

        window.toggleBioReader = function(chipId) {
            const matrix = document.getElementById('bio-board'); 
            const reader = document.getElementById('bio-detail-reader');
            const chipEl = document.getElementById(chipId);
            if (!matrix || !reader || !chipEl) return;

            // --- 关闭阅读器 ---
            if (chipEl.classList.contains('active')) {
                chipEl.classList.remove('active');
                matrix.classList.remove('has-active');
                dimRelationLines(false);
                
                // 清除打开时设置的动态负 margin，恢复到原始文档流位置
                reader.style.marginTop = '';
                
                const styles = window.getComputedStyle(reader);
                const heightLoss = reader.offsetHeight + (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
                
                reader.style.opacity = '0';
                smoothScrollToElement(matrix, 400, heightLoss);
                
                setTimeout(() => {
                    if (!matrix.classList.contains('has-active')) {
                        reader.style.transition = 'none';
                        reader.classList.remove('show');
                        requestAnimationFrame(() => {
                            reader.style.opacity = '';
                            reader.style.transition = '';
                        });
                    }
                }, 400);
                return;
            }

            // --- 打开阅读器 ---
            // 1. 获取数据
            const data = window.currentBioGroups[chipId];
            if (!data) return;

            // 2. 设置阅读器内容和样式
            let readerClass = `pref-detail-reader ${data.themeClass} `;
            readerClass += data.score >= 5 ? 'core' : (data.score === 4 ? 'major' : 'minor');
            reader.className = readerClass;
            reader.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); padding-bottom: 12px;">
                    <div style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px;">
                        ${data.iconHtml}
                        <span>${escapeHtml(data.characterName)}</span>
                        <i class="fas fa-pencil-alt" style="font-size:14px; opacity:0.6; cursor:pointer; margin-left:6px;" onclick="editBioCharacterName('${chipId}', '${escapeHtml(data.characterName)}')"></i>
                    </div>
                    <i class="fas fa-times" onclick="window.toggleBioReader('${chipId}')" style="opacity:0.6; font-size:18px; cursor:pointer;"></i>
                </div>
                <div>${data.detailsHtml}</div>
            `;

            // 3. 高亮小球，并标记星图为激活状态（让其他小球半透明）
            matrix.querySelectorAll('.archive-glass-chip').forEach(c => c.classList.remove('active'));
            chipEl.classList.add('active');
            matrix.classList.add('has-active');
            dimRelationLines(true);  // ← 新增

            // 4. 动态计算阅读器应该出现的理想位置（最下方小球的正下方 16px）
            const board = document.getElementById('bio-board');
            if (board) {
                const boardRect = board.getBoundingClientRect();
                const chips = board.querySelectorAll('.archive-glass-chip');
                let maxBottom = 0;
                chips.forEach(chip => {
                    const rect = chip.getBoundingClientRect();
                    const bottom = rect.bottom - boardRect.top;   // 相对于 board 顶部的距离
                    if (bottom > maxBottom) maxBottom = bottom;
                });
                
                const desiredTop = maxBottom + 16;                // 最底小球下方留 16px
                const naturalTop = boardRect.height;              // 阅读器原本在 board 底部
                const offset = naturalTop - desiredTop;           // 需要向上平移的距离
                
                // 5. 用负 margin-top 精确提升阅读器
                reader.style.marginTop = `-${offset}px`;
            }

            // 6. 显示阅读器（CSS 过渡动画开始）
            reader.classList.add('show');
            
            // 7. 打开后稍微延迟再滚动，让动画自然完成
            setTimeout(() => {
                reader.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
        };

        window.editBioCharacterName = function(chipId, oldName) {
            console.log("editBioCharacterName called", chipId, oldName);
            if (!currentChatContactId) {
                alert("请先打开一个聊天窗口再编辑");
                return;
            }
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;

            // 通过铅笔图标定位名称 span
            const pencilIcon = document.querySelector('#bio-detail-reader .fa-pencil-alt');
            if (!pencilIcon) {
                alert("未找到编辑按钮，请刷新页面重试");
                return;
            }
            const nameSpan = pencilIcon.parentElement.querySelector('span');
            if (!nameSpan) {
                alert("未找到名称元素，请刷新页面重试");
                return;
            }

            // 创建输入框
            const input = document.createElement('input');
            input.type = 'text';
            input.value = oldName;
            input.style.cssText = `
                font-size: inherit;
                font-weight: inherit;
                font-family: inherit;
                background: var(--input-bg);
                border: 1px solid var(--border);
                border-radius: 6px;
                padding: 2px 8px;
                margin: -2px 0;
                color: var(--text-main);
                outline: none;
                box-sizing: content-box;
            `;

            // 动态调整宽度的函数
            const adjustWidth = () => {
                // 创建一个临时 span 测量文本实际宽度
                const measureSpan = document.createElement('span');
                measureSpan.style.visibility = 'hidden';
                measureSpan.style.position = 'absolute';
                measureSpan.style.whiteSpace = 'pre';
                measureSpan.style.font = window.getComputedStyle(input).font;
                measureSpan.style.padding = window.getComputedStyle(input).padding;
                measureSpan.style.border = 'none';
                measureSpan.textContent = input.value || oldName;
                document.body.appendChild(measureSpan);
                const textWidth = measureSpan.offsetWidth;
                document.body.removeChild(measureSpan);
                // 设置宽度 = 文本宽度 + 左右内边距(16px) + 边框(2px) + 一个额外余量(4px)
                const newWidth = textWidth + 16 + 4;
                input.style.width = Math.min(newWidth, 300) + 'px'; // 最大宽度限制为300px
            };

            // 先调整一次宽度
            adjustWidth();

            nameSpan.style.display = 'none';
            nameSpan.parentNode.insertBefore(input, nameSpan.nextSibling);
            input.focus();
            input.select();

            // 键盘弹起后延迟滚动
            const onKeyboardShow = () => {
                input.scrollIntoView({ behavior: 'smooth', block: 'center' });
                window.removeEventListener('keyboardWillShow', onKeyboardShow);
            };
            window.addEventListener('keyboardWillShow', onKeyboardShow);

            // 输入时实时调整宽度
            input.addEventListener('input', adjustWidth);

            const saveEdit = () => {
                const newName = input.value.trim();
                if (newName && newName !== oldName) {
                    let updatedCount = 0;
                    contact.longMemories.forEach(mem => {
                        if (mem.keywords && Array.isArray(mem.keywords)) {
                            const index = mem.keywords.indexOf(oldName);
                            if (index !== -1) {
                                mem.keywords[index] = newName;
                                updatedCount++;
                            }
                        }
                        if (mem.content && mem.content.includes(oldName)) {
                            mem.content = mem.content.replace(new RegExp(oldName, 'g'), newName);
                        }
                    });
                    if (contact.relations) {
                        // 1. 先把所有关系中出现的旧名字改为新名字
                        contact.relations.forEach(rel => {
                            if (rel.source === oldName) rel.source = newName;
                            if (rel.target === oldName) rel.target = newName;
                            if (rel.history) {
                                rel.history.forEach(h => {
                                    if (h.detail) h.detail = h.detail.replace(new RegExp(oldName, 'g'), newName);
                                });
                            }
                        });

                        // 2. 合并相同人物对的关系（保留所有历史记录）
                        const mergedMap = new Map();
                        for (const rel of contact.relations) {
                            const key = `${rel.source}|${rel.target}`;
                            if (mergedMap.has(key)) {
                                const existing = mergedMap.get(key);
                                // 如果当前关系有 history 数组，就把它的所有条目合并到 existing.history 中
                                if (rel.history && rel.history.length) {
                                    if (!existing.history) existing.history = [];
                                    existing.history.push(...rel.history);
                                }
                                // 如果当前关系本身带有历史（直接存储在 label/detail/updatedAt 中），也当作一条历史记录合并
                                if (rel.label && rel.detail && rel.updatedAt) {
                                    if (!existing.history) existing.history = [];
                                    // 避免重复添加完全相同的历史条目
                                    const alreadyHas = existing.history.some(h => 
                                        h.label === rel.label && h.detail === rel.detail && h.time === rel.updatedAt
                                    );
                                    if (!alreadyHas) {
                                        existing.history.push({
                                            label: rel.label,
                                            detail: rel.detail,
                                            time: rel.updatedAt
                                        });
                                    }
                                }
                                // 保留更新 label 和 detail（取最新的）
                                existing.label = rel.label || existing.label;
                                existing.detail = rel.detail || existing.detail;
                                existing.updatedAt = rel.updatedAt || existing.updatedAt;
                            } else {
                                // 确保每条关系都有 history 数组（如果是老数据没有 history，则从自身构造）
                                if (!rel.history && rel.label && rel.detail && rel.updatedAt) {
                                    rel.history = [{
                                        label: rel.label,
                                        detail: rel.detail,
                                        time: rel.updatedAt
                                    }];
                                }
                                mergedMap.set(key, rel);
                            }
                        }
                        contact.relations = Array.from(mergedMap.values());
                    }
                    if (updatedCount > 0) {
                        saveToLocal();
                        const searchInput = document.getElementById('archive-search-input');
                        renderArchiveContent(searchInput ? searchInput.value : '');
                        showToast(`已将「${oldName}」合并为「${newName}」`);
                    } else {
                        showToast('未找到需要修改的记忆条目');
                    }
                }
                input.removeEventListener('input', adjustWidth);
                input.remove();
                nameSpan.style.display = '';
                if (newName) nameSpan.textContent = newName;
            };

            const cancelEdit = () => {
                input.removeEventListener('input', adjustWidth);
                input.remove();
                nameSpan.style.display = '';
            };

            input.addEventListener('blur', saveEdit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEdit();
                } else if (e.key === 'Escape') {
                    cancelEdit();
                }
            });
        };

        // --- 控制器结束 ---

        function openArchivePage() {
            if (!currentChatContactId) return;
            const searchInput = document.getElementById('archive-search-input');
            if (searchInput) searchInput.value = '';
            
            currentArchiveCategory = '全部';
            document.getElementById('current-cat-text').innerText = '全部';
            document.querySelectorAll('.cat-menu-item').forEach((el, index) => {
                el.classList.toggle('active', index === 0);
            });

            expandedArchiveCards.clear();
            const btn = document.getElementById('bio-reset-btn');
            if (btn) btn.style.display = 'none';
            renderArchiveContent();
            openSubPage('sub-archive');
        }

        // ✨ 悬浮菜单开关
        function toggleCategoryMenu() {
            document.getElementById('archive-cat-menu').classList.toggle('show');
        }

        // ✨ 切换分类
        function switchArchiveCategory(categoryName, shortName) {
            currentArchiveCategory = categoryName;
            document.getElementById('current-cat-text').innerText = shortName;
            
            document.querySelectorAll('.cat-menu-item').forEach(tab => {
                tab.classList.remove('active');
                if (tab.textContent.includes(shortName)) tab.classList.add('active');
            });
            
            document.getElementById('archive-cat-menu').classList.remove('show');
            
            // 提前获取搜索框
            const searchInput = document.getElementById('archive-search-input');
            const currentVal = searchInput ? searchInput.value : '';
            const cursorPos = searchInput ? searchInput.selectionStart : 0;
            
            // 显示/隐藏人物重置按钮
            const resetBtn = document.getElementById('bio-reset-btn');
            if (resetBtn) {
                resetBtn.style.display = (categoryName === '人物') ? 'flex' : 'none';
            }
            
            // 渲染内容
            renderArchiveContent(currentVal);
            // 如果输入框内有内容，保持光标位置记忆（下次点击搜索框时自然出现）
            if (searchInput && searchInput.value) {
                // 可以不用任何操作，或仅记录光标位置，但无需 focus
            }
        }

        function toggleArchiveSort() {
            archiveSortDesc = !archiveSortDesc;
            const icon = document.getElementById('archive-sort-icon');
            if (icon) icon.className = archiveSortDesc ? 'fas fa-sort-amount-down' : 'fas fa-sort-amount-up';
            const searchInput = document.getElementById('archive-search-input');
            renderArchiveContent(searchInput ? searchInput.value : '');
        }

        function highlightSearchTerm(text, term) {
            if (!term) return escapeHtml(text);
            const escapedText = escapeHtml(text);
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedTerm})`, 'gi');
            return escapedText.replace(regex, '<span class="search-highlight-text">$1</span>');
        }

        function filterArchive(val) {
            const input = document.getElementById('archive-search-input');
            if (!input) return;

            // 保存当前内容区的滚动位置（避免渲染后跳动）
            const archiveContent = document.getElementById('archive-content');
            const scrollTop = archiveContent ? archiveContent.scrollTop : 0;

            renderArchiveContent(val);

            // 恢复内容区滚动位置
            if (archiveContent) archiveContent.scrollTop = scrollTop;
        }
        function toggleArchiveCard(headerEl) {
            const card = headerEl.parentElement;
            const title = headerEl.querySelector('.archive-entity-title').textContent.trim();
            card.classList.toggle('expanded');
            if (card.classList.contains('expanded')) expandedArchiveCards.add(title);
            else expandedArchiveCards.delete(title);
        }

        function deleteArchiveItem(memoryId) {
            if (!currentChatContactId) return;
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.longMemories) return;
            if (!confirm('确定要彻底删除这条档案吗？')) return;

            contact.longMemories = contact.longMemories.filter(m => String(m.id) !== String(memoryId));
            saveToLocal();
            const searchInput = document.getElementById('archive-search-input');
            renderArchiveContent(searchInput ? searchInput.value : '');
            if (searchInput) {
                searchInput.focus();
            }
            updateMemoryStats();
        }
     
        function inplaceEditArchiveItem(memoryId) {
            if (!currentChatContactId) return;
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.longMemories) return;

            const memIndex = contact.longMemories.findIndex(m => String(m.id) === String(memoryId));
            if (memIndex === -1) {
                alert('未找到该记忆条目，可能已被删除');
                return;
            }

            const textDiv = document.getElementById(`archive-text-${memoryId}`);
            if (!textDiv) {
                alert('未找到编辑按钮对应的文本区域，请刷新页面重试');
                return;
            }

            const scrollContainer = document.getElementById('archive-content');
            const originalContent = contact.longMemories[memIndex].content;
            const originalScore = contact.longMemories[memIndex].score || 4;
            const originalDisplay = textDiv.style.display || 'block';

            const container = document.createElement('div');
            container.id = `edit-container-${memoryId}`;
            container.style.width = '100%';
            container.style.backgroundColor = 'var(--bg-color)';
            container.style.borderRadius = '8px';
            container.style.padding = '4px 0';

            const textarea = document.createElement('textarea');
            textarea.value = originalContent;
            textarea.style.cssText = `
                width: 100% !important;
                min-height: 60px;
                font-family: inherit;
                font-size: 14px;
                line-height: 1.5;
                color: var(--text-main);
                background: var(--input-bg);
                border: 1px solid var(--border);
                border-radius: 8px;
                padding: 8px;
                margin: 0;
                resize: vertical;
                box-sizing: border-box;
            `;

            const scoreSelect = document.createElement('select');
            scoreSelect.style.cssText = `
                display: block;
                margin: 8px 0 0 0;
                padding: 6px 10px;
                border-radius: 6px;
                border: 1px solid var(--border);
                background: var(--hover-bg);
                color: var(--text-main);
                font-size: 12px;
                outline: none;
                cursor: pointer;
                width: fit-content;
            `;

            const scoreOptions = [
                { v: 5, t: "5 分 (核心)" },
                { v: 4, t: "4 分 (重要)" },
                { v: 3, t: "3 分 (普通)" },
                { v: 2, t: "2 分 (琐碎)" },
                { v: 1, t: "1 分 (碎片)" }
            ];
            scoreOptions.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.v;
                o.textContent = opt.t;
                if (opt.v === originalScore) o.selected = true;
                scoreSelect.appendChild(o);
            });

            container.appendChild(textarea);
            container.appendChild(scoreSelect);
            textDiv.style.display = 'none';
            textDiv.parentNode.insertBefore(container, textDiv.nextSibling);

            // 自动调整高度
            const autoSize = () => {
                textarea.style.height = 'auto';
                textarea.style.height = textarea.scrollHeight + 'px';
            };
            textarea.addEventListener('input', autoSize);
            autoSize();

            textarea.focus();
            textarea.setSelectionRange(textarea.value.length, textarea.value.length);

            // ========== 全局点击保存逻辑 ==========
            let isEditing = true;
            const finishEdit = () => {
                if (!isEditing) return;
                isEditing = false;

                // 清理全局监听器
                document.removeEventListener('mousedown', handleOutsideClick);
                document.removeEventListener('touchstart', handleOutsideClick);

                const newContent = textarea.value.trim();
                const newScore = parseInt(scoreSelect.value);
                if (newContent === "") {
                    if (confirm('内容为空，要删除这条档案吗？')) {
                        contact.longMemories.splice(memIndex, 1);
                        saveToLocal();
                        const searchInput = document.getElementById('archive-search-input');
                        renderArchiveContent(searchInput ? searchInput.value : '');
                    } else {
                        container.remove();
                        textDiv.style.display = originalDisplay;
                    }
                } else {
                    contact.longMemories[memIndex].content = newContent;
                    contact.longMemories[memIndex].score = newScore;
                    saveToLocal();
                    textDiv.innerText = newContent;
                    container.remove();
                    textDiv.style.display = originalDisplay;
                    if (typeof addLogToConsole === 'function') {
                        addLogToConsole('success', 'EDIT', '档案已更新');
                    }
                }
            };

            const handleOutsideClick = (e) => {
                // 如果点击的目标在编辑容器内部，不处理
                if (container.contains(e.target)) return;
                // 否则保存退出
                finishEdit();
            };

            // 延迟添加监听器，避免当前点击触发
            setTimeout(() => {
                document.addEventListener('mousedown', handleOutsideClick);
                document.addEventListener('touchstart', handleOutsideClick, { passive: true });
            }, 100);

            // 保留原来的 blur 作为后备（但用户点击 select 时不会 blur，所以全局监听是主要的）
            textarea.addEventListener('blur', () => {
                // 延迟检查，确保 select 的点击不会立即触发
                setTimeout(() => {
                    if (isEditing && document.activeElement !== scoreSelect && !container.contains(document.activeElement)) {
                        finishEdit();
                    }
                }, 150);
            });

            // 按 Esc 取消编辑（恢复到原始内容）
            const cancelEdit = () => {
                if (!isEditing) return;
                isEditing = false;
                document.removeEventListener('mousedown', handleOutsideClick);
                document.removeEventListener('touchstart', handleOutsideClick);
                container.remove();
                textDiv.style.display = originalDisplay;
            };

            textarea.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit();
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelEdit();
                }
            });
        }
        
        function enableDragOnChips(nodesData, linksData, boardWidth, boardHeight) {
            const chips = document.querySelectorAll('#bio-board .archive-glass-chip');
            const svg = document.getElementById('links-layer');
            const labels = document.querySelectorAll('#bio-board .relation-label');

            chips.forEach(chip => {
                chip.addEventListener('touchstart', onDragStart, { passive: true });
                chip.addEventListener('mousedown', onDragStart);
            });

            function onDragStart(e) {
                const chipEl = e.currentTarget;
                const chipId = chipEl.id;
                const node = nodesData.find(n => n.chipId === chipId);
                if (!node) return;

                const startX = e.touches ? e.touches[0].clientX : e.clientX;
                const startY = e.touches ? e.touches[0].clientY : e.clientY;
                const startLeft = node.x;
                const startTop = node.y;
                let hasMoved = false;

                function onMove(e) {
                    const currentX = e.touches ? e.touches[0].clientX : e.clientX;
                    const currentY = e.touches ? e.touches[0].clientY : e.clientY;
                    const dx = Math.abs(currentX - startX);
                    const dy = Math.abs(currentY - startY);

                    if (!hasMoved && (dx > 5 || dy > 5)) {
                        hasMoved = true;
                        // 确认是拖拽，才进入拖拽模式
                        e.preventDefault();
                        chipEl.style.transition = 'none';
                        chipEl.style.zIndex = '20';
                    }

                    if (hasMoved) {
                        e.preventDefault();
                        let newX = startLeft + (currentX - startX);
                        let newY = startTop + (currentY - startY);
                        newX = Math.max(20, Math.min(boardWidth - 20, newX));
                        newY = Math.max(20, Math.min(boardHeight - 20, newY));
                        node.x = newX;
                        node.y = newY;
                        chipEl.style.left = newX + 'px';
                        chipEl.style.top = newY + 'px';
                        updateLinksAndLabels();
                    }
                }

                function onUp() {
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('touchend', onUp);
                    document.removeEventListener('mouseup', onUp);

                    if (hasMoved) {
                        chipEl.style.transition = '';
                        chipEl.style.zIndex = '';
                        if (currentChatContactId) saveNodePositions(currentChatContactId, nodesData);
                    }
                    // 如果没有移动过，说明是点击，让浏览器正常触发 click
                }

                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('mousemove', onMove);
                document.addEventListener('touchend', onUp);
                document.addEventListener('mouseup', onUp);
            }

            function updateLinksAndLabels() {
                const lines = svg.querySelectorAll('.link');
                lines.forEach((line, i) => {
                    const link = linksData[i];
                    if (link) {
                        line.setAttribute('x1', link.source.x);
                        line.setAttribute('y1', link.source.y);
                        line.setAttribute('x2', link.target.x);
                        line.setAttribute('y2', link.target.y);
                    }
                });
                labels.forEach((label, i) => {
                    const link = linksData[i];
                    if (link) {
                        label.style.left = ((link.source.x + link.target.x) / 2) + 'px';
                        label.style.top = ((link.source.y + link.target.y) / 2) + 'px';
                    }
                });
            }
        }

        function generateInnerTimelineItemHtml(item, searchText) {
            let displayContent = escapeHtml(item.content);
            if (searchText) {
                const regex = new RegExp(`(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                displayContent = displayContent.replace(regex, '<span style="background-color: rgba(255, 214, 10, 0.4); color: inherit; border-radius: 2px;">$1</span>');
            }
            return `
                <div class="timeline-item">
                    <div class="timeline-dot"></div>
                    <div class="timeline-text" id="archive-text-${item.id}">${displayContent}</div>
                    <div class="timeline-actions">
                        <i class="fas fa-pencil-alt" onclick="event.stopPropagation(); inplaceEditArchiveItem('${item.id}')"></i>
                        <i class="fas fa-trash-alt" onclick="event.stopPropagation(); deleteArchiveItem('${item.id}')"></i>
                    </div>
                </div>
            `;
        }

        function getSavedNodePositions(contactId) {
            try {
                const saved = localStorage.getItem(`bio_nodes_${contactId}`);
                return saved ? JSON.parse(saved) : null;
            } catch(e) { return null; }
        }

        function saveNodePositions(contactId, nodesData) {
            const pos = {};
            nodesData.forEach(n => {
                if (n.x != null && n.y != null) pos[n.id] = { x: n.x, y: n.y };
            });
            localStorage.setItem(`bio_nodes_${contactId}`, JSON.stringify(pos));
        }

        function resetBioLayout() {
            if (!currentChatContactId) return;
            localStorage.removeItem(`bio_nodes_${currentChatContactId}`);
            const searchInput = document.getElementById('archive-search-input');
            renderArchiveContent(searchInput ? searchInput.value : '');
        }

        function renderNodesAndLinks(nodesData, linksData, width, height, runSimulation) {
            if (runSimulation) {
                // 1. 设置暗箱力学模型
                const simulation = d3.forceSimulation(nodesData)
                    .force("link", d3.forceLink(linksData).id(d => d.id).distance(100))
                    .force("charge", d3.forceManyBody().strength(-300))
                    .force("center", d3.forceCenter(width / 2, height / 2))
                    .force("collide", d3.forceCollide().radius(d => 25 + d.id.length * 8).iterations(3))
                    .force("x", d3.forceX(width / 2).strength(0.05))
                    .force("y", d3.forceY(height / 2).strength(0.05))
                    .stop();

                for (let i = 0; i < 120; i++) {
                    simulation.tick();
                    nodesData.forEach(d => {
                        const estWidth = 40 + (d.id.length * 15);
                        const padX = estWidth / 2 + 10;
                        d.x = Math.max(padX, Math.min(width - padX, d.x));
                        d.y = Math.max(35, Math.min(height - 35, d.y));
                    });
                }
            }

            // 保存位置
            if (currentChatContactId) saveNodePositions(currentChatContactId, nodesData);

            // 2. 渲染静态 HTML 节点
            const htmlLayer = d3.select("#html-layer");
            let nodes = htmlLayer.selectAll(".archive-glass-chip")
                .data(nodesData).enter().append("div")
                .attr("class", d => d.className)
                .attr("id", d => d.chipId)
                .html(d => d.html)
                .on("click", (event, d) => window.toggleBioReader(d.chipId));

            if (runSimulation) {
                nodes.style("left", `${width / 2}px`).style("top", `${height / 2}px`)
                    .transition().duration(800).ease(d3.easeCubicOut)
                    .style("left", d => `${d.x}px`)
                    .style("top", d => `${d.y}px`);
            } else {
                nodes.style("left", d => `${d.x}px`).style("top", d => `${d.y}px`);
            }

            // 3. 渲染 SVG 连线 —— 直接显示，不加动画延迟
            const svg = d3.select("#links-layer");
            svg.selectAll(".link").data(linksData).enter().append("line")
                .attr("class", "link")
                .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x).attr("y2", d => d.target.y)
                .style("stroke", "rgba(255,255,255,0.2)").style("stroke-width", "1.5px")
                .style("opacity", 1);   // 去掉 transition 和 delay

            // 4. 渲染悬浮标签 —— 直接显示
            htmlLayer.selectAll(".relation-label").data(linksData).enter().append("div")
                .attr("class", "relation-label")
                .text(d => d.label)
                .style("left", d => `${(d.source.x + d.target.x) / 2}px`)
                .style("top", d => `${(d.source.y + d.target.y) / 2}px`)
                .on("click", (event, d) => {
                    event.stopPropagation();
                    showRelationHistory(d);
                })
                .style("opacity", 1);   // 去掉 transition 和 delay
            
            // 5. 启用拖拽
            enableDragOnChips(nodesData, linksData, width, height);
        }

        // 更新人物星图中的搜索高亮（现在会检查记忆内容）
        function updateBioSearchHighlight(searchText) {
            const board = document.getElementById('bio-board');
            if (!board) return;
            const chips = board.querySelectorAll('.archive-glass-chip');
            chips.forEach(chip => {
                const chipId = chip.id;
                const data = window.currentBioGroups[chipId];
                if (!data) return;
                const characterName = data.characterName;
                // 匹配人名，或者任意记忆的内容
                let isMatch = !searchText ||
                            characterName.toLowerCase().includes(searchText) ||
                            (data.items && data.items.some(item => item.content.toLowerCase().includes(searchText)))
                chip.classList.remove('search-highlight', 'search-dim');
                if (searchText) {
                    chip.classList.add(isMatch ? 'search-highlight' : 'search-dim');
                }
            });
            board.classList.toggle('archive-search-mode', !!searchText);
             dimRelationLines(!!searchText);
        }

        // 更新偏好矩阵中的搜索高亮（现在会检查记忆内容）
        function updatePrefSearchHighlight(searchText) {
            const matrix = document.getElementById('pref-matrix');
            if (!matrix) return;
            const chips = matrix.querySelectorAll('.archive-glass-chip');
            chips.forEach(chip => {
                const chipId = chip.id;
                const data = window.currentPrefGroups[chipId];
                if (!data) return;
                const keyword = data.keyword;
                // 匹配偏好名，或者任意记忆的内容
                let isMatch = !searchText ||
                            keyword.toLowerCase().includes(searchText) ||
                            (data.items && data.items.some(item => item.content.toLowerCase().includes(searchText)))
                chip.classList.remove('search-highlight', 'search-dim');
                if (searchText) {
                    chip.classList.add(isMatch ? 'search-highlight' : 'search-dim');
                }
            });
            matrix.classList.toggle('archive-search-mode', !!searchText);
        }

        function renderArchiveContent(searchText = '') {
            function formatRoundRange(rawRange) {
                if (!rawRange) return '初期设定';
                let cleaned = String(rawRange).replace(/第|轮/g, '').trim();
                if (cleaned === '初期设定' || cleaned === '') return '初期设定';
                if (cleaned.includes('-')) {
                    const parts = cleaned.split('-');
                    if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
                        cleaned = parts[0].trim();
                    }
                }
                return `第 ${cleaned} 轮`;
            }
            
            const container = document.getElementById('archive-content');

            const lastCategory = container.dataset.lastCategory || '';
            const lastSearch = container.dataset.lastSearch || '';

               // 偏好：只做局部高亮刷新
                if (currentArchiveCategory === '偏好' && lastCategory === currentArchiveCategory && lastSearch !== searchText && searchText !== '') {
                    container.dataset.lastSearch = searchText;
                    updatePrefSearchHighlight(searchText);
                    // 重新生成偏好小球的详情 HTML，让文字也高亮
                    for (const [chipId, group] of Object.entries(window.currentPrefGroups)) {
                        group.detailsHtml = '';
                        group.items.forEach(item => {
                            if (!item.id) {
                                item.id = 'tmp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                            }
                            const highlightedContent = highlightSearchTerm(item.content, searchText);
                            group.detailsHtml += `...`; // 使用与下面相同的 HTML 结构
                        });
                    }
                    return;
                }

                // 人物：只做局部高亮刷新
                if (currentArchiveCategory === '人物' && lastCategory === currentArchiveCategory && lastSearch !== searchText && searchText !== '') {
                    container.dataset.lastSearch = searchText;
                    updateBioSearchHighlight(searchText);
                    // 重新生成人物小球的详情 HTML
                    for (const [chipId, group] of Object.entries(window.currentBioGroups)) {
                        const groupedByTime = new Map();
                        group.items.forEach(item => {
                            let timeSource = item.worldTime || item.date || '日常纪元';
                            if (!groupedByTime.has(timeSource)) groupedByTime.set(timeSource, []);
                            groupedByTime.get(timeSource).push(item);
                        });
                        group.detailsHtml = '';
                        for (const [timeSource, items] of groupedByTime.entries()) {
                            group.detailsHtml += `<div style="display: flex; align-items: stretch; padding-top: 14px; border-top: 0.5px dashed color-mix(in srgb, currentColor 15%, transparent); margin-top: 10px;">
                                        <div class="timeline-left" style="width:65px; padding-right: 14px; color: currentColor; font-weight:700; opacity:0.8; font-size:12px; word-wrap: break-word;">${escapeHtml(timeSource)}</div>
                                        <div class="timeline-right-container" style="flex:1; border-left:1px solid color-mix(in srgb, currentColor 10%, transparent); padding-left: 12px;">`;
                            items.forEach(item => {
                                const highlightedContent = highlightSearchTerm(item.content, searchText);
                                group.detailsHtml += `<div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom: 8px;">
                                            <div class="archive-item-text" style="flex:1;">${highlightedContent}</div>
                                            <div class="chip-actions">
                                                <i class="fas fa-pencil-alt" onclick="inplaceEditArchiveItem('${item.id}')"></i>
                                                <i class="fas fa-trash-alt" onclick="deleteArchiveItem('${item.id}')"></i>
                                            </div>
                                        </div>
                                        <div style="font-size:11px; color:var(--text-sub); text-align:right; margin-bottom:8px;">记录于 ${escapeHtml(formatRoundRange(item.roundRange))}</div>`;
                            });
                            group.detailsHtml += `</div></div>`;
                        }
                    }
                    return;
                }
            // 否则：记录这次渲染的分类和搜索词，继续完整重绘
            container.dataset.lastCategory = currentArchiveCategory;
            container.dataset.lastSearch = searchText;

            if (!container || !currentChatContactId) return;
            
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.longMemories || contact.longMemories.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 80px 20px; color: var(--text-sub);">
                        <i class="fas fa-book-journal-whills" style="font-size: 48px; opacity: 0.3; margin-bottom: 16px;"></i>
                        <p style="font-size: 16px; font-weight: 600; color: var(--text-main); margin-bottom: 8px;">档案馆空空如也</p>
                        <p style="font-size: 13px; opacity: 0.7;">AI 正在默默记录你们的世界线...</p>
                    </div>`;
                return;
            }

            searchText = searchText.trim().toLowerCase();
            const catMap = {
                '全部': ['全部'],
                '人物': ['人物', '情报', '核心', '角色'],
                '世界': ['世界观', '设定', '法则', '背景', '世界'],
                '事件': ['事件', '剧情', '编年史'],
                '偏好': ['偏好', '习惯', '性格', '禁忌', '喜好', '爱好', '厌恶', '雷区'],
                '异闻': ['异闻', '物品', '地点', '道具']
            };

            let validMemories = contact.longMemories.filter(m => {
                let matchCat = true;
                if (currentArchiveCategory !== '全部') {
                    const allowedKeywords = catMap[currentArchiveCategory] || [];
                    matchCat = allowedKeywords.some(kw => (m.category || '').includes(kw));
                    if(!matchCat && currentArchiveCategory === '人物' && m.category === '核心') matchCat = true;
                }
                if (currentArchiveCategory === '事件') {
                    // 直接读取 AI 提供的 isMilestone 字段，不再依赖复杂规则
                    const isMilestone = m.isMilestone === true || m.isMilestone === 'true';
                    if (isMilestone) matchCat = true;
                }
                let matchText = true;
                if (searchText) {
                    matchText = m.content.toLowerCase().includes(searchText) || 
                                (m.keywords && m.keywords.join(',').toLowerCase().includes(searchText)) ||
                                (m.category || '').toLowerCase().includes(searchText);
                }
                return matchCat && matchText;
            });

            if (validMemories.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 80px 20px; color: var(--text-sub);">
                        <i class="fas fa-ghost" style="font-size: 40px; opacity: 0.2; margin-bottom: 16px;"></i>
                        <p style="font-size: 15px;">该分类下未找到档案</p>
                    </div>`;
                return;
            }

            container.innerHTML = '';

            const sortByTime = (a, b) => {
                const parseRange = (rangeStr) => {
                    if (!rangeStr) return [0, 0];
                    // 去掉 "第" 和 "轮" 等字样，拆分 "-"
                    const clean = rangeStr.replace(/第|轮/g, '').trim().split('-');
                    const start = parseInt(clean[0]) || 0;
                    const end = clean[1] ? parseInt(clean[1]) : start; // 单轮数如 "5" 视为 "5-5"
                    return [start, end];
                };
                const [startA, endA] = parseRange(a.roundRange);
                const [startB, endB] = parseRange(b.roundRange);
                
                // 先按起始数字排序，起始相同时按结束数字排序，再按 id 排序保稳定
                if (startA !== startB) return archiveSortDesc ? startB - startA : startA - startB;
                if (endA !== endB) return archiveSortDesc ? endB - endA : endA - endB;
                return archiveSortDesc ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0);
            };

            // 偏好矩阵渲染
            if (currentArchiveCategory === '偏好') {
                window.currentPrefGroups = {}; 
                // 如果存在搜索词，给矩阵添加搜索模式类
                let contentHtml = `<div class="archive-chip-matrix${searchText ? ' archive-search-mode' : ''}" id="pref-matrix">`;
                
                const prefGroups = {};
                contact.longMemories.forEach(m => {
                    // 只保留偏好分类
                    const allowedKeywords = catMap['偏好'] || [];
                    const matchCat = allowedKeywords.some(kw => (m.category || '').includes(kw));
                    if (!matchCat) return;
                    
                    let keyword = (m.keywords && m.keywords.length > 0) ? m.keywords[0] : '日常偏好';
                    if (!prefGroups[keyword]) prefGroups[keyword] = { items: [], maxScore: 0 };
                    prefGroups[keyword].items.push(m);
                    if ((m.score || 0) > prefGroups[keyword].maxScore) prefGroups[keyword].maxScore = m.score || 0;
                });
                
                const sortedGroups = Object.entries(prefGroups).sort((a, b) => b[1].maxScore - a[1].maxScore);
                const themeClasses = ['chip-theme-blue', 'chip-theme-green', 'chip-theme-sand', 'chip-theme-mauve', 'chip-theme-rose'];

                sortedGroups.forEach(([keyword, group], index) => {
                    let hash = 0; for(let i = 0; i < keyword.length; i++) hash += keyword.charCodeAt(i);
                    const themeClass = themeClasses[hash % themeClasses.length];

                    // 判断当前分组是否匹配搜索词
                    let isMatch = !searchText || 
                                keyword.toLowerCase().includes(searchText) ||
                                group.items.some(item => item.content.toLowerCase().includes(searchText));

                    let chipClass = `archive-glass-chip ${themeClass} `;
                    let iconHtml = '';
                    if (group.maxScore >= 5) { 
                        chipClass += 'archive-chip-core'; 
                        iconHtml = '<i class="fas fa-layer-group" style="margin-right:6px; opacity: 0.9;"></i>';
                    } else if (group.maxScore === 4) { 
                        chipClass += 'archive-chip-major'; 
                        iconHtml = '<i class="fas fa-id-card" style="margin-right:6px; opacity: 0.8;"></i>';
                    } else { 
                        chipClass += 'archive-chip-minor'; 
                        iconHtml = '<i class="fas fa-signature" style="margin-right:6px; opacity: 0.6;"></i>';
                    }

                    // 搜索高亮/变暗类
                    if (searchText) {
                        chipClass += isMatch ? ' search-highlight' : ' search-dim';
                    }

                    const sortedItems = group.items.sort((a, b) => {
                        const getStart = (r) => { if(!r) return 0; const match = r.match(/第?(\d+)-/); return match ? parseInt(match[1]) : 0; };
                        return archiveSortDesc ? getStart(b.roundRange) - getStart(a.roundRange) : getStart(a.roundRange) - getStart(b.roundRange);
                    });

                    // 生成详情 HTML，对每个 item 的 content 进行搜索高亮
                    let detailsHtml = '';
                    sortedItems.forEach(item => {
                        if (!item.id) {
                            item.id = 'tmp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
                        }
                        const highlightedContent = highlightSearchTerm(item.content, searchText);
                        detailsHtml += `
                            <div class="chip-detail-item">
                                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                    <div class="archive-item-text" style="flex:1;" id="archive-text-${item.id}">${highlightedContent}</div>
                                    <div class="chip-actions">
                                        <i class="fas fa-pencil-alt" onclick="inplaceEditArchiveItem('${item.id}')"></i>
                                        <i class="fas fa-trash-alt" onclick="deleteArchiveItem('${item.id}')"></i>
                                    </div>
                                </div>
                                <div class="chip-detail-time">记录于 ${escapeHtml(formatRoundRange(item.roundRange))}</div>
                            </div>
                        `;
                    });

                    const chipId = `pref-chip-${index}`;
                    window.currentPrefGroups[chipId] = { 
                        keyword: keyword, 
                        detailsHtml: detailsHtml, 
                        themeClass: themeClass, 
                        score: group.maxScore, 
                        iconHtml: iconHtml,
                        items: group.items   // ← 新增：把该偏好的所有记忆列表存起来
                    };

                    let countHtml = group.items.length > 1 ? `<span class="chip-count">${group.items.length}</span>` : '';

                    contentHtml += `<div class="${chipClass}" id="${chipId}" onclick="window.togglePrefReader('${chipId}')">
                        <div class="chip-short"><span>${escapeHtml(keyword)}</span> ${countHtml}</div>
                    </div>`;
                });
                
                contentHtml += `</div><div id="pref-detail-reader" class="pref-detail-reader"></div>`;
                container.innerHTML = contentHtml;
                if (searchText) updatePrefSearchHighlight(searchText);
                // 防止页面意外滚动
                window.scrollTo(0, 0);
                return;
            }

            // 全部/编年史渲染
            if (currentArchiveCategory === '全部' || currentArchiveCategory === '事件') {
                validMemories.sort(sortByTime);
                const groupedByTime = new Map();
                validMemories.forEach(item => {
                    let sourceText = item.roundRange || item.date || '初始设定';
                    // 1. 先统一清理“第”和“轮”字眼
                    sourceText = sourceText.replace('第', '').replace('轮', '').trim();

                    // 2. 智能合并显示：如果起始和结束是同一个数字（如“12-12”），只显示单个数字（如“12”）
                    if (sourceText.includes('-')) {
                        const parts = sourceText.split('-');
                        if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
                            sourceText = parts[0].trim(); // 只保留一个数字
                        }
                    }
                    if (!groupedByTime.has(sourceText)) groupedByTime.set(sourceText, []);
                    groupedByTime.get(sourceText).push(item);
                });

                let html = '';
                for (const [timeSource, items] of groupedByTime.entries()) {
                    let innerItemsHtml = items.map(item => generateInnerTimelineItemHtml(item, searchText)).join('');
                    html += `
                        <div class="archive-timeline-block archive-glass-panel">
                            <div class="timeline-left"><i class="fa-regular fa-clock" style="margin-bottom: 4px; opacity: 0.5;"></i>${escapeHtml(timeSource)}</div>
                            <div class="timeline-right-container">${innerItemsHtml}</div>
                        </div>`;
                }
                container.innerHTML = html;
                return;
            }

            // ==========================================
            // 🌟 核心修改：如果是“人物”，直接渲染 D3 高定星图 (支持羁绊演化史)
            // ==========================================
            if (currentArchiveCategory === '人物') {
                window.currentBioGroups = {}; 
                
                let contentHtml = `
                    <div class="archive-network-board${searchText ? ' archive-search-mode' : ''}" id="bio-board">
                        <svg id="links-layer"></svg>
                        <div id="html-layer"></div>
                    </div>
                    <div id="bio-detail-reader" class="pref-detail-reader"></div>
                    
                    <div class="modal-overlay" id="relation-modal-overlay" onclick="closeRelationModal()"></div>
                    <div class="relation-history-modal" id="relation-history-modal">
                        <div class="relation-modal-header" id="relation-modal-title">人物A ↔ 人物B</div>
                        <div class="relation-history-list" id="relation-history-list"></div>
                    </div>
                `;

                // 只用分类过滤，不过滤搜索词
                const bioGroups = {};
                contact.longMemories.forEach(m => {
                    // 分类匹配（只处理当前分类下的记忆）
                    const allowedKeywords = catMap[currentArchiveCategory] || [];
                    const matchCat = allowedKeywords.some(kw => (m.category || '').includes(kw));
                    // 事件分类特殊处理（保持不变）
                    if (!matchCat && currentArchiveCategory === '事件') {
                        const isMilestone = m.isMilestone === true || m.isMilestone === 'true';
                        if (!isMilestone) return; // 不显示
                    } else if (!matchCat) return;
                    
                    let characterName = (m.keywords && m.keywords.length > 0) ? m.keywords[0] : '佚名';
                    if (!bioGroups[characterName]) bioGroups[characterName] = { items: [], maxScore: 0 };
                    bioGroups[characterName].items.push(m);
                    if ((m.score || 0) > bioGroups[characterName].maxScore) bioGroups[characterName].maxScore = m.score || 0;
                });

                const themeClasses = ['chip-theme-mauve', 'chip-theme-blue', 'chip-theme-green', 'chip-theme-sand', 'chip-theme-rose'];
                const nodesData = [];

                let renderedCount = 0;
                for (const [characterName, group] of Object.entries(bioGroups)) {
                    let hash = 0; for(let i = 0; i < characterName.length; i++) hash += characterName.charCodeAt(i);
                    const themeClass = themeClasses[hash % themeClasses.length];

                    let isMatch = !searchText || 
                                characterName.toLowerCase().includes(searchText) ||
                                group.items.some(item => item.content.toLowerCase().includes(searchText));

                    let chipClass = `archive-glass-chip ${themeClass} `;
                    let iconHtml = '';
                    if (group.maxScore >= 5) { chipClass += 'archive-chip-core'; iconHtml = '<i class="fas fa-layer-group" style="margin-right:6px; opacity: 0.9;"></i>'; } 
                    else if (group.maxScore === 4) { chipClass += 'archive-chip-major'; iconHtml = '<i class="fas fa-id-card" style="margin-right:6px; opacity: 0.8;"></i>'; } 
                    else { chipClass += 'archive-chip-minor'; iconHtml = '<i class="fas fa-signature" style="margin-right:6px; opacity: 0.6;"></i>'; }
                    
                    if (searchText) {
                        chipClass += isMatch ? ' search-highlight' : ' search-dim';
                    }

                    const groupedByTime = new Map();
                    group.items.forEach(item => {
                        let sourceText = item.worldTime || item.date || '日常纪元';
                        if (!groupedByTime.has(sourceText)) groupedByTime.set(sourceText, []);
                        groupedByTime.get(sourceText).push(item);
                    });

                    let detailsHtml = '';
                    for (const [timeSource, items] of groupedByTime.entries()) {
                        let innerItemsHtml = items.map(item => {
                            const highlightedContent = highlightSearchTerm(item.content, searchText);
                            return `
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; padding-bottom: 8px;">
                                <div class="archive-item-text" id="archive-text-${item.id}" style="flex:1;">${highlightedContent}</div>
                                <div class="chip-actions">
                                    <i class="fas fa-pencil-alt" onclick="inplaceEditArchiveItem('${item.id}')"></i>
                                    <i class="fas fa-trash-alt" onclick="deleteArchiveItem('${item.id}')"></i>
                                </div>
                            </div>
                            <div style="font-size:11px; color:var(--text-sub); text-align:right; margin-bottom:8px;">记录于 ${escapeHtml(formatRoundRange(item.roundRange))}</div>
                        `}).join('');
                        
                        detailsHtml += `
                            <div style="display: flex; align-items: stretch; padding-top: 14px; border-top: 0.5px dashed color-mix(in srgb, currentColor 15%, transparent); margin-top: 10px;">
                                <div class="timeline-left" style="width:65px; padding-right: 14px; color: currentColor; font-weight:700; opacity:0.8; font-size:12px; word-wrap: break-word;">${escapeHtml(timeSource)}</div>
                                <div class="timeline-right-container" style="flex:1; border-left:1px solid color-mix(in srgb, currentColor 10%, transparent); padding-left: 12px;">${innerItemsHtml}</div>
                            </div>
                        `;
                    }

                    const chipId = `bio-chip-${renderedCount}`;
                    window.currentBioGroups[chipId] = { 
                        characterName: characterName, 
                        detailsHtml: detailsHtml, 
                        themeClass: themeClass, 
                        score: group.maxScore, 
                        iconHtml: iconHtml,
                        items: group.items   // ← 新增：把该人物的所有记忆列表存起来
                    };
                    let countHtml = group.items.length > 1 ? `<span class="chip-count">${group.items.length}</span>` : '';

                    nodesData.push({ id: characterName, chipId: chipId, html: `<div class="chip-short"><span>${escapeHtml(characterName)}</span> ${countHtml}</div>`, className: chipClass });
                    renderedCount++;
                }

                container.innerHTML = contentHtml;
                // ==========================================
                // 🚀 D3.js 暗箱预演算引力场 (绝不抖动，绝不出界)
                // ==========================================
                setTimeout(() => {
                    const board = document.getElementById('bio-board');
                    if (!board) return;
                    const width = board.clientWidth;
                    const height = board.clientHeight;

                    // 读取真实的连线数据
                    let linksData = [];
                    if (contact.relations && contact.relations.length > 0) {
                        linksData = contact.relations.map(r => {
                            const sourceNode = nodesData.find(n => n.id === r.source);
                            const targetNode = nodesData.find(n => n.id === r.target);
                            if (sourceNode && targetNode) {
                                return { source: sourceNode, target: targetNode, label: r.label, history: r.history || [] };
                            }
                            return null;
                        }).filter(l => l !== null);
                    }

                    const savedPos = getSavedNodePositions(contact.id);
                    let runSim = savedPos === null;  // 原本是否有模拟的标志
                    if (savedPos) {
                        nodesData.forEach(n => {
                            if (savedPos[n.id]) {
                                n.x = savedPos[n.id].x;
                                n.y = savedPos[n.id].y;
                            } else {
                                // 没有保存位置的节点，给一个临时默认位置（画布中心随机散布）
                                n.x = width / 2 + (Math.random() - 0.5) * 100;
                                n.y = height / 2 + (Math.random() - 0.5) * 100;
                                runSim = true;   // 标记需要运行模拟，以便重新计算稳定布局
                            }
                        });
                    }
                    // 只要 runSim 被设为 true，就会运行力导向模拟并保存新布局
                    renderNodesAndLinks(nodesData, linksData, width, height, runSim);
                    if (searchText) updateBioSearchHighlight(searchText);
                }, 50);
                
                return;
            }

            // 其他实体卡片...
            const entityGroups = {};
            validMemories.forEach(m => {
                let entityName = (m.keywords && m.keywords.length > 0) ? m.keywords[0] : '综合备忘录';
                if (!entityGroups[entityName]) entityGroups[entityName] = { items: [] };
                entityGroups[entityName].items.push(m);
            });

            const sortedEntities = Object.entries(entityGroups).sort((a, b) => {
                const maxIdA = Math.max(...a[1].items.map(i => i.id || 0));
                const maxIdB = Math.max(...b[1].items.map(i => i.id || 0));
                return archiveSortDesc ? maxIdB - maxIdA : maxIdA - maxIdB; 
            });

            for (const [entityName, group] of sortedEntities) {
                group.items.sort(sortByTime);
                const groupedByTime = new Map();
                group.items.forEach(item => {
                    let sourceText = item.roundRange || item.date || '设定';
                    // 1. 先统一清理“第”和“轮”字眼
                    sourceText = sourceText.replace('第', '').replace('轮', '').trim();

                    // 2. 智能合并显示：如果起始和结束是同一个数字（如“12-12”），只显示单个数字（如“12”）
                    if (sourceText.includes('-')) {
                        const parts = sourceText.split('-');
                        if (parts.length === 2 && parts[0].trim() === parts[1].trim()) {
                            sourceText = parts[0].trim(); // 只保留一个数字
                        }
                    }
                    if (!groupedByTime.has(sourceText)) groupedByTime.set(sourceText, []);
                    groupedByTime.get(sourceText).push(item);
                });

                let itemsHtml = '';
                for (const [timeSource, items] of groupedByTime.entries()) {
                    let innerItemsHtml = items.map(item => generateInnerTimelineItemHtml(item, searchText)).join('');
                    itemsHtml += `<div class="archive-timeline-row"><div class="timeline-left" style="padding-right: 20px; font-size: 11px;">${escapeHtml(timeSource)}</div><div class="timeline-right-container" style="padding-left: 12px;">${innerItemsHtml}</div></div>`;
                }

                const latestItem = group.items.reduce((prev, current) => (prev.id > current.id) ? prev : current);
                const previewText = escapeHtml(latestItem.content);
                const recordCount = group.items.length;
                const isExpanded = searchText !== '' || expandedArchiveCards.has(entityName) || sortedEntities.length <= 2;
                
                const cardHtml = `
                    <div class="archive-entity-card archive-glass-panel ${isExpanded ? 'expanded' : ''}">
                        <div class="archive-entity-header" onclick="toggleArchiveCard(this)">
                            <div class="archive-header-top"><div class="archive-entity-title">${escapeHtml(entityName)}</div><div class="archive-count-badge"><i class="fas fa-layer-group"></i> ${recordCount} 条</div></div>
                            <div class="archive-preview-text">${previewText}</div>
                        </div>
                        <div class="archive-entity-body-wrapper"><div class="archive-entity-body"><div class="archive-entity-body-inner">${itemsHtml}</div></div></div>
                    </div>`;
                container.insertAdjacentHTML('beforeend', cardHtml);
            }
        }

        // --- 羁绊演化史弹窗控制器 ---
        window.showRelationHistory = function(data) {
            const sourceName = data.source?.id || data.source;
            const targetName = data.target?.id || data.target;
            
            document.getElementById('relation-modal-title').innerHTML = 
                `${escapeHtml(sourceName)} <span style="color:#D47A43;">↔</span> ${escapeHtml(targetName)}`;
            
            let listHtml = '';
            if (data.history && data.history.length > 0) {
                // 倒序排列，最新的在最上面
                const reversedHistory = [...data.history].reverse();
                reversedHistory.forEach((h, index) => {
                    listHtml += `
                    <div class="history-node">
                        <div class="history-node-top" style="justify-content: flex-start;">
                            <span class="history-label">${escapeHtml(h.label)}</span>
                            <div style="margin-left: auto; display: flex; gap: 8px; align-items: center;">
                                <i class="fas fa-pencil-alt" onclick="editRelationHistory('${data.source.id}', '${data.target.id}', ${index})" style="cursor: pointer; opacity: 0.6; font-size: 12px;"></i>
                                <i class="fas fa-trash-alt" onclick="deleteRelationHistory('${data.source.id}', '${data.target.id}', ${index})" style="cursor: pointer; opacity: 0.6; font-size: 12px; color: var(--danger);"></i>
                            </div>
                        </div>
                        <div style="font-size:13px; color:var(--text-sub); line-height:1.5;">${escapeHtml(h.detail || '未记录详细事件')}</div>
                        <div style="text-align: right; font-size: 11px; color: var(--text-sub); margin-top: 4px;">${escapeHtml(h.time)}</div>
                    </div>
                `;
                });
            } else {
                listHtml = `<div style="text-align:center; padding:20px; color:var(--text-sub); font-size:13px;">暂无历史变迁记录，当前为初始状态。</div>`;
            }

            document.getElementById('relation-history-list').innerHTML = listHtml;
            document.getElementById('relation-modal-overlay').classList.add('show');
            document.getElementById('relation-history-modal').classList.add('show');
        };

        window.closeRelationModal = function() {
            document.getElementById('relation-modal-overlay').classList.remove('show');
            document.getElementById('relation-history-modal').classList.remove('show');
        };

        // ==========================================
        // 🌟 全局触控雷达：实现“点击空白处自动收起”
        // ==========================================
        document.addEventListener('click', (event) => {
            // -----------------------------------------
            // 1. 处理【悬浮分类菜单】的自动收起
            // -----------------------------------------
            const catMenu = document.getElementById('archive-cat-menu');
            // 智能识别触发下拉的那个胶囊按钮
            const catTrigger = event.target.closest('[onclick="toggleCategoryMenu()"]'); 
            
            if (catMenu && catMenu.classList.contains('show')) {
                // 如果点击的区域不在菜单内部，也不在触发按钮上，就果断收起菜单！
                if (!catMenu.contains(event.target) && !catTrigger) {
                    catMenu.classList.remove('show');
                }
            }

            // -----------------------------------------
            // 2. 处理【偏好小球】与【人物星图】的自动收起
            // -----------------------------------------
            // 判断点击是不是发生在“阅读面板”内部或者“琉璃小球”身上
            const isClickInsideReader = event.target.closest('.pref-detail-reader');
            const isClickOnChip = event.target.closest('.archive-glass-chip');
            
            // 如果点的既不是阅读面板，也不是任何小球（也就是点在了虚空背景上）
            if (!isClickInsideReader && !isClickOnChip) {
                // 偏好矩阵
                const prefReader = document.getElementById('pref-detail-reader');
                const prefMatrix = document.getElementById('pref-matrix');

                if (prefReader && prefReader.classList.contains('show')) {
                    prefMatrix.classList.remove('has-active');
                    prefMatrix.querySelectorAll('.archive-glass-chip').forEach(c => c.classList.remove('active'));
                    
                    const styles = window.getComputedStyle(prefReader);
                    const heightLoss = prefReader.offsetHeight + (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
                    
                    prefReader.style.opacity = '0';
                    smoothScrollToElement(prefMatrix, 400, heightLoss); 
                    
                    setTimeout(() => {
                        if (!prefMatrix.classList.contains('has-active')) {
                            prefReader.style.transition = 'none';
                            prefReader.classList.remove('show');
                            requestAnimationFrame(() => {
                                prefReader.style.opacity = '';
                                prefReader.style.transition = '';
                            });
                        }
                    }, 400);
                }

                // 人物星图
                const bioReader = document.getElementById('bio-detail-reader');
                const bioBoard = document.getElementById('bio-board');

                if (bioReader && bioReader.classList.contains('show')) {
                    bioBoard.classList.remove('has-active');
                    bioBoard.querySelectorAll('.archive-glass-chip').forEach(c => c.classList.remove('active'));
                    
                    const styles = window.getComputedStyle(bioReader);
                    const heightLoss = bioReader.offsetHeight + (parseFloat(styles.marginTop) || 0) + (parseFloat(styles.marginBottom) || 0);
                    
                    bioReader.style.opacity = '0';
                    smoothScrollToElement(bioBoard, 400, heightLoss);
                    
                    setTimeout(() => {
                        if (!bioBoard.classList.contains('has-active')) {
                            bioReader.style.transition = 'none';
                            bioReader.classList.remove('show');
                            requestAnimationFrame(() => {
                                bioReader.style.opacity = '';
                                bioReader.style.transition = '';
                                dimRelationLines(false);
                            });
                        }
                    });
                }
            }
        });

        // ==========================================
        // 🌍 Chronos 世界时间系统 (UI 交互层)
        // ==========================================

        // 初始化拨盘选项 (仅执行一次)
        let chronosDialsInitialized = false;
        function initChronosDials() {
            if (chronosDialsInitialized) return;
            const monthSelect = document.getElementById('chronos-input-month');
            const daySelect = document.getElementById('chronos-input-day');
            
            if(monthSelect) {
                for(let i=1; i<=12; i++) {
                    monthSelect.add(new Option(i + '月', i));
                }
            }
            if(daySelect) {
                for(let i=1; i<=31; i++) {
                    daySelect.add(new Option(i + '日', i));
                }
            }
            chronosDialsInitialized = true;
        }

        // 切换面板展开/收起
        function toggleChronosPanel() {
            initChronosDials(); 
            const panel = document.getElementById('chronos-dial-panel');
            panel.classList.toggle('show');
        }

        // 同步面板输入框的内容到顶部胶囊显示
        function syncChronosToDisplay() {
            const era = document.getElementById('chronos-input-era').value.trim();
            const month = document.getElementById('chronos-input-month').value;
            const day = document.getElementById('chronos-input-day').value;
            const time = document.getElementById('chronos-input-time').value;
            
            // 拼接格式，例如：星历1年 · 5月8日 14:30
            const textStr = `${era} · ${month}月${day}日 ${time}`;
            document.getElementById('chronos-display-text').textContent = textStr || '...';
        }

        function resetChronos() {
            document.getElementById('chronos-input-era').value = '';
            document.getElementById('chronos-input-month').value = '1';   // 或者默认值
            document.getElementById('chronos-input-day').value = '1';
            document.getElementById('chronos-input-time').value = '08:00';
            syncChronosToDisplay();
            document.getElementById('chronos-display-text').textContent = '...';
            // 如果需要关闭面板，再加： document.getElementById('chronos-dial-panel').classList.remove('show');
        }
