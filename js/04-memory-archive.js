        // ==========================================
        // 🌟 终极使命：全知史官与动态图谱更新引擎
        // ==========================================
        const SYSTEM_ARCHIVE_PROMPT = `【终极使命：群像世界观记录者与绝对客观事实提取器】
        当前分析对话中，AI 扮演角色：【{{AI_NAME}}】。
        角色初始设定：【{{AI_PERSONA}}】。

        你是一个运行在系统后台的【绝对客观全知史官】。你的核心任务是：在多人物、第三人称的复杂群像演绎中，精准提取人物、事件、设定和羁绊变化，严格以 JSON 格式输出。

        【最高禁令：全分类与关系零冗余铁则】
        1. 绝对不重复记录：生成任何记忆或关系前，必须先仔细比对【已有记忆库】。若某事实（身份、关系、偏好、能力、世界观、事件、物品）已存在或高度相似，绝对不要再次输出！此禁令对所有分类和 relations 一视同仁。
        2. 增量更新法则：对同一实体有了更详细/更正确的新了解，只输出新增部分，keywords 必须沿用该实体的主名称（严禁添加“更新：”或其他前缀）。你可以在 content 中自然描述这是新发现，或者可选地增加一个 previousName 字段（当本段对话中出现了该实体的新代称时使用），但不要改变 keywords 的第一个元素。
            · 例：旧记忆库有"林深，男"，新发现他为Alpha且爱吃西瓜 → keywords: ["林深"]，content: "确认林深为Alpha。嗜甜，爱吃西瓜。"，绝不重复"林深，男"。如果本段中用户用“深哥”称呼他，可同时设置 previousName: "深哥" 供前端合并，但 keywords 仍为 ["林深"]。
        3. 批次内差分与时间线切割：
            a) 通读本段对话，提取【已有记忆库】中完全不存在的全新属性/事件/偏好。
            b) 按"属性粒度"拆分：比如嗜甜和体能优异是两种属性，必须分别记录为两条独立记忆，严禁合并。
            c) 同一属性在本段多次出现，只保留一条，其 roundRange 标记为首次和末次的大致区间（如 "2-9"），内容不赘述次数。
        4. 人物实体防污染：严禁将属性、物品、身体部位、组织名等当作独立人物建档。所有已知人物的新增信息，必须用"角色名"附着到本体档案中。
        5. 人物内容格式：category 为"人物"的记忆中，content 内写人名和新属性/特征。
            - 正确：旧有"林深，男，慕辞的同学"，新发现他爱吃西瓜 → content: "林深近期表现出对西瓜的极度偏好。"
            - 错误：content 为"男，爱吃西瓜。"
        6. 实体代称归一：遇到已知人物的新称呼（如"慕辞的哥哥"），必须识别为原有实体"慕辞哥哥"的变体，keywords 沿用主词条，并用 previousName 指明本次出现的代称。严禁新建独立实体。
        7. 禁止联想：只记录明确发生的事实，语言自然简洁但不过度扁平。
        8. 拆分逻辑：复杂事件/设定须拆成多条 memory，每条只讲一个极简事实。
        9. NSFW 医学级记录：抛弃文学渲染，保留体位、癖好、敏感带等临床术语，禁用"亲密交流"等模糊词。

        【全局去重铁律】任何记忆或关系，如果与已有记忆库中的任何条目在语义上重复（即使轮次、措辞不同），都绝对禁止输出。只有当出现了全新的事实或关系标签变化时，才能新增。这是本系统的最高优先级规则，违反此规则的输出将被视为无效。

        【五大分类与示例】
        每一条记忆必须归入人物、世界、事件、偏好、异闻之一。

        1. 人物 (Character)：独立身份的个体及其核心属性。
        例：keywords: ["慕辞"], content: "慕辞，男，夏以昼的同学。体能优异，帝国军事学院在读。" (4分)

        2. 世界 (World)：时代背景、法则、势力阵营等。
        例：keywords: ["ABO设定"], content: "这是一个ABO世界观，Alpha稀缺且居于统治地位，Omega的成年期需服用抑制剂。" (5分)
        ※ 任何世界基础法则、社会架构、性别机制（ABO六性、信息素规则、发情期规律）的论述，必须无条件归入"世界"。
        【世界档案强制记录】只要背景不是"默认现代普通社会"，就必须生成至少一条"世界"记忆。涵盖ABO、哨向、修仙、星际、古代、魔法、异能、末日废土等所有非现实世界观。

        3. 事件 (Event)：纯剧情推进、角色交互、冲突转折。
        例：keywords: ["黑龙帮","林深"], content: "林深在暗巷中遭到黑龙帮成员袭击，重伤昏迷。" (4分)

        4. 偏好 (Preference)：生活习惯、战斗策略、亲密癖好、饮食禁忌等。
        例：keywords: ["饮食偏好"], content: "林深极度厌恶香菜，偏爱重度嗜甜的糕点。" (3分)
        ※ 偏好的 keywords 必须是具体行为/癖好名，禁止用人名。

        5. 异闻 (Lore)：特殊物品、神秘地点、传说、怪异现象等独立事物。
        例：keywords: ["渊冥剑"], content: "渊冥剑，上古神器，剑身漆黑，可斩断灵力连接，下落不明。" (4分)
        ※ 所有角色身体特征的新发现，一律用"更新：角色名"归入人物档案，不得单独创建异闻条目。

        【关系称谓适配】
        关系 label 必须基于角色社会性别及世界观。ABO世界中男性Omega生育，只能用"父子"或"父（Omega）"，严禁"母子"。

        【羁绊关系（Relations）增量原则 - 严格去重版】

        1. 输出条件（必须同时满足以下所有条件）：
           a) 关系的 label（标签）发生了实质变化（例如从“初识”变为“知己”），或者
           b) 出现了全新的、足以改变关系性质的事件，且该事件在已有关系记录的 detail 中从未出现过（语义级别）。
        
        2. 绝对禁止输出的情况（无论轮次范围如何）：
           - 已有相同 label 的关系记录，且 detail 描述的实质内容相同（即使措辞略有变化，如“介绍私密社交圈” vs “介绍社交资源”视为相同）。
           - 已有相同 label 的关系记录，即使轮次范围不同（例如已有 5-14 轮记录，又要在 21-40 轮输出同样的 label 和细节），也严禁重复输出。
           - 任何语义重复的描述，即使换了几个字。
        
        3. 输出格式：
           - label：2-5 个汉字。
           - detail：必须控制在 50 字以内，只写本区间内关系发生的**最新、最独特**的变化。如果没有任何新变化，则完全不要输出该 relation。
           - updatedAt：必须使用关系发生变化的实际轮次范围（例如本次修史是 21-40 轮，但关系改变事件发生在 22-28 轮，则写成 "22-28"）。但请注意：即使 updatedAt 不同，只要 label 和 detail 语义重复，也不允许输出。
        
        4. 去重检查流程（AI 必须在输出前执行）：
           ① 检查已有记忆库中是否存在相同 label 且 detail 意思相同的关系。
           ② 如果存在，无论 updatedAt 是多少，都跳过本次输出。
           ③ 如果关系有进展，必须写出与之前 detail 不同的新事实，且新事实不能是对旧事实的换种说法。
        
        5. 错误示例（严厉禁止）：
           已有关系：{"source":"陈应","target":"夏以昼","label":"发小","detail":"从小一起长大的朋友，陈应了解夏以昼的私密偏好，并为他介绍了高端的私密社交圈。","updatedAt":"5-14"}
           再次输出：{"source":"陈应","target":"夏以昼","label":"发小","detail":"从小一起长大的朋友，关系密切，陈应了解夏以昼的私人偏好并为其介绍社交资源。","updatedAt":"5-12"}
           → 此为严重错误！两条关系 label 相同，detail 描述的是同一件事（介绍社交圈/资源），只是更换了措辞，轮次略有不同。必须禁止输出第二条！只有在关系标签变化（如变为“挚友”）或出现全新重大事件（如“陈应救了夏以昼的命”）时，才能新增。
        
        6. 正确示例：
           - 首次记录（第 5-14 轮）：{"source":"陈应","target":"夏以昼","label":"发小","detail":"从小一起长大的朋友，陈应了解夏以昼的私密偏好，并为他介绍了高端的私密社交圈。","updatedAt":"5-14"}
           - 后续（第 21-40 轮）关系无实质变化 → 不输出任何 relation。
           - 后续（第 50-60 轮）陈应帮助夏以昼度过破产危机 → 输出：{"source":"陈应","target":"夏以昼","label":"挚友","detail":"陈应资助夏以昼度过破产危机，两人关系更紧密。","updatedAt":"50-60"}        
                
        【字数限制 - 绝对红线】
        - 每一条记忆（memory）的 content 字段，不得超过 50 个汉字。
        - 每一条关系（relation）的 detail 字段，不得超过 50 个汉字。
        - 超过字数限制的输出将被系统直接丢弃。请务必精炼表达，只保留最核心的事实，删除冗余修饰。
        
        【记忆分级 (Score 1-5)】
            - 5分：人生重大转折，isMilestone: true。
            - 4分：重要身份/能力补充，isMilestone: false。
            - 3分：具体偏好、日常支线。
            - 1-2分：琐碎细节。

        【分类原则】
            - 个人核心信息、时间线里程碑 → 人物。
            - 纯剧情推进 → 事件。

        【严格输出 JSON】
        仅输出合法 JSON，禁止包裹 markdown 代码块。格式如下：
        {
        "memories": [
            { "category": "...", "keywords": [...], "content": "...", "score": N, "isMilestone": bool, "roundRange": "N-M" }
        ],
        "relations": [
            { "source": "人物A", "target": "人物B", "label": "关系标签（≤5字）", "detail": "...", "updatedAt": "本次修史轮次范围" }
        ]
        }

        【重要示例（严格模仿）】
        1. 首次记录，记忆库空，1-13轮：
        - 第2轮知林深为男，慕辞同学；第7轮知为Alpha，爱吃西瓜；第12轮知体能优异。
        正确输出：
        {
            "memories": [
            {"category":"人物","keywords":["林深"],"content":"林深，男性，Alpha。慕辞的同学。","score":5,"isMilestone":true,"roundRange":"2-7"},
            {"category":"偏好","keywords":["林深"],"content":"林深嗜甜，特别爱吃西瓜。","score":4,"isMilestone":false,"roundRange":"7-12"},
            {"category":"人物","keywords":["林深"],"content":"林深体能优异，在训练中表现突出。","score":3,"isMilestone":false,"roundRange":"12-12"}
            ],
            "relations":[]
        }

        2. 后续修史，已有林深档案。第15-19轮发现他喜欢熬夜。
        正确输出：
        {
            "memories":[
            {"category":"偏好","keywords":["林深"],"content":"林深近期开始喜欢熬夜，常在凌晨两点后入睡。","score":3,"isMilestone":false,"roundRange":"15-19"}
            ]
        }

        3. 实体防污染：已有慕辞档案，对话提及其性器尺寸。
        错误：{"category":"人物","keywords":["慕辞的性器尺寸"],"content":"尺寸为20cm。"}
        正确：{"category":"人物","keywords":["慕辞"],"content":"私密档案：慕辞的性器尺寸巨大，长度约20cm。"}

        4. 实体代称归一：记忆库已有"慕辞哥哥"，对话出现"慕辞的哥哥"。
        错误输出：keywords:["慕辞的哥哥"]
        正确输出：{"category":"人物","keywords":["慕辞哥哥"],"previousName":"慕辞的哥哥","content":"...","roundRange":"..."}

        5. 关系输出示例：
        - 本次修史 1-15 轮，发现林深与慕辞是发小。
        正确：{"source":"林深","target":"慕辞","label":"发小","detail":"从小一起长大的朋友。","updatedAt":"1-15"}
        错误：updatedAt 写成 "1-153" 或 label 写 "从小一起长大的发小"；label 应只用"发小"二字。
        
        6. 错误示例（禁止输出重复关系）：
       - 已有关系 {"source":"夏以昼","target":"慕辞","label":"初识","detail":"在私密社交活动中因孕期偏好相识，夏以昼照顾微醺的慕辞并送其回家。","updatedAt":"1-15"}
       - 同一区间再次输出 {"source":"夏以昼","target":"慕辞","label":"相识","detail":"在私密社交活动中因相同孕期偏好标识而相识，夏以昼主动搭讪并照顾微醺的慕辞，开车送他回家。","updatedAt":"1-15"}
       → 这是严重错误！两者事件几乎相同，不得重复输出。只有当关系标签变化（例如从“初识”变为“恋人”）或出现全新重大事件时才能输出新的 relation。
        `;


        
        // --- 自动生成长期记忆（日常后台静默触发版）---
        async function simulateMemorySummary(contact) {
            console.log("🧠 尝试触发长期记忆生成逻辑...");
            const interval = GENERAL_CONFIG.memory.diaryInterval || 10;
            const conversation = getConversation(contact.id);
            const userMessagesCount = conversation.filter(m => m.role === 'user').length;
            
            let lastSummarizedRound = 0;
            if (contact.longMemories && contact.longMemories.length > 0) {
                contact.longMemories.forEach(m => {
                    if (m.roundRange) {
                        const match = String(m.roundRange).match(/第?(\d+)-(\d+)轮?/);
                        if (match && match[2]) {
                            const endNum = parseInt(match[2]);
                            if (endNum > lastSummarizedRound) lastSummarizedRound = endNum;
                        }
                    }
                });
            }
            
            const nextTriggerRound = lastSummarizedRound + interval;
            if (userMessagesCount === 0 || userMessagesCount < nextTriggerRound) return;
            
            const startRound = lastSummarizedRound + 1;
            const endRound = nextTriggerRound;
            
            const blockMessages = [];
            let userCount = 0;
            let isInBlock = false;
            for (const msg of conversation) {
                if (msg.role === 'user') {
                    userCount++;
                    if (userCount === startRound) isInBlock = true;
                }
                if (isInBlock) blockMessages.push(msg);
                if (userCount > endRound) {
                    blockMessages.pop();
                    break;
                }
            }
            
            // ✨ 给发给史官的每一句话都打上绝对的物理轮数印记
            let roundCount = startRound;
            const recentChat = blockMessages.map((m) => {
                if (m.role === 'user') {
                    const line = `[第${roundCount}轮] 用户：${m.content}`;
                    roundCount++;
                    return line;
                } else {
                    return `AI：${m.content}`;
                }
            }).join('\n');
            const allExistingMemories = contact.longMemories ? contact.longMemories.map(m => m.content).join('\n') : "暂无记忆";
            
            const memoryConfig = OTHER_API_CONFIGS.memory;
            let apiConfig = null;
            if (memoryConfig && memoryConfig.configId) apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === memoryConfig.configId);
            if (!apiConfig) apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            if (!apiConfig) return;
            const modelToUse = (memoryConfig && memoryConfig.model) ? memoryConfig.model : apiConfig.model;

            // 动态替换 AI 当前的身份和设定
            const dynamicPrompt = SYSTEM_ARCHIVE_PROMPT
                .replace(/\{\{AI_NAME\}\}/g, contact.name || '未命名角色')
                .replace(/\{\{AI_PERSONA\}\}/g, contact.prompt || '暂无设定');

            const summaryMessages = [
                { role: "system", content: dynamicPrompt },
                { 
                    role: "user", 
                    content: `【已有记忆库】(若有完全相同的事件请勿重复记录；若是新细节请补充)\n${allExistingMemories}\n\n【需要提取的对话区块：第${startRound}-${endRound}轮】\n${recentChat}\n\n请严格以大纲作者的视角，按要求返回 JSON。` 
                }
            ];

            try {
                let apiUrl = getStandardApiUrl(apiConfig.url, '/chat/completions');
                const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: summaryMessages,
                        temperature: 0.1,
                        max_tokens: 2000
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    let jsonStr = data.choices && data.choices[0] ? data.choices[0].message.content : data.result;
                    jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
                    const result = JSON.parse(jsonStr);

                    let addedCount = 0;
                    const isRealityMode = document.getElementById('reality-mode-switch')?.classList.contains('active');
                    let realDateStr = null;
                    if (isRealityMode) {
                        const now = new Date();
                        realDateStr = `${now.getMonth()+1}月${now.getDate()}日`;
                    }

                    if (result.memories) {
                        result.memories.forEach(m => {
                            m.id = 'mem_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                            if (!m.roundRange) m.roundRange = `${startRound}-${endRound}`;
                            if (isRealityMode && !m.worldTime) m.date = realDateStr;
                            
                            // 🌟 实体合并引擎：真名覆盖旧代号
                            if (m.previousName && m.keywords && m.keywords.length > 0) {
                                let oldAlias = m.previousName;
                                let realName = m.keywords[0];
                                addLogToConsole('info', 'ARCHIVE', `触发实体合并：[${oldAlias}] 真名揭晓为 [${realName}]`);
                                if (contact.longMemories) {
                                    contact.longMemories.forEach(oldMem => {
                                        if (oldMem.keywords && oldMem.keywords.includes(oldAlias)) {
                                            oldMem.keywords = oldMem.keywords.map(k => k === oldAlias ? realName : k);
                                            oldMem.content = oldMem.content.replace(new RegExp(oldAlias, 'g'), realName);
                                        }
                                    });
                                }
                                if (contact.relations) {
                                    contact.relations.forEach(r => {
                                        if (r.source === oldAlias) r.source = realName;
                                        if (r.target === oldAlias) r.target = realName;
                                    });
                                }
                            }
                            
                            contact.longMemories.push(m);
                            addedCount++;
                        });
                    }

                    // 存储羁绊关系！
                    if (result.relations) {
                        if (!contact.relations) contact.relations = [];
                        result.relations.forEach(r => {
                            const existingRelIndex = contact.relations.findIndex(ex => 
                                (ex.source === r.source && ex.target === r.target) || 
                                (ex.source === r.target && ex.target === r.source)
                            );
                            
                            const timeMark = r.updatedAt || (isRealityMode ? realDateStr : `第 ${startRound}-${endRound} 轮`);
                            
                            if (existingRelIndex !== -1) {
                                const existingRel = contact.relations[existingRelIndex];
                                if (!existingRel.history) existingRel.history = [{ label: existingRel.label, time: '往昔', detail: existingRel.detail || '初始状态' }];
                                existingRel.label = r.label;
                                existingRel.detail = r.detail || '关系产生了新的转变。';
                                existingRel.updatedAt = timeMark;
                                existingRel.history.push({ label: r.label, time: timeMark, detail: existingRel.detail });
                            } else {
                                r.history = [{ label: r.label, time: timeMark, detail: r.detail || '建立了初始羁绊。' }];
                                r.updatedAt = timeMark;
                                contact.relations.push(r);
                            }
                        });
                    }
                    if (addedCount > 0) saveToLocal();
                }
            } catch (e) {
                let rawError = e.stack || e.toString();
                addLogToConsole('error', '生成长期记忆失败', rawError);
                console.error("生成长期记忆失败:", e);
            }
        }

        // ==========================================
        // 🌟 长期记忆修史功能 (多选勾选补全版)
        // ==========================================

        // --- 点击魔法棒：呼出自由修史面板 ---
        function backfillAllMemories() {
            if (!currentChatContactId) {
                alert('⚠️ 请先打开一个聊天窗口');
                return;
            }
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;
            
            const interval = GENERAL_CONFIG.memory.diaryInterval || 10;
            const conversation = getConversation(contact.id);
            const userMessagesCount = conversation.filter(m => m.role === 'user').length;
            
            if (userMessagesCount === 0) {
                alert("暂无用户对话记录，无法修史！");
                return;
            }

            // 1. 扫描旧记忆，精确提取出已经生成过的所有独立区间
            const existingRangesMap = new Map();
            if (contact.longMemories) {
                contact.longMemories.forEach(m => {
                    if (m.roundRange) {
                        const match = String(m.roundRange).match(/第?(\d+)-(\d+)轮?/);
                        if (match) {
                            const s = parseInt(match[1]);
                            const e = parseInt(match[2]);
                            existingRangesMap.set(`${s}-${e}`, { start: s, end: e });
                        }
                    }
                });
            }
            const existingRanges = Array.from(existingRangesMap.values()).sort((a, b) => a.start - b.start);

            // 2. 构建混合区块队列 (已生成的旧档案绝对保持原状)
            const chunks = [];
            existingRanges.forEach(r => {
                chunks.push({ start: r.start, end: r.end, isCovered: true });
            });

            // 计算剩下的缺失部分，按新步长排列
            let lastEnd = existingRanges.length > 0 ? Math.max(...existingRanges.map(r => r.end)) : 0;
            let currentStart = lastEnd + 1;
            while (currentStart <= userMessagesCount) {
                let currentEnd = currentStart + interval - 1;
                if (currentEnd > userMessagesCount) currentEnd = userMessagesCount; // 保证不超出总轮数
                chunks.push({ start: currentStart, end: currentEnd, isCovered: false });
                currentStart = currentEnd + 1;
            }
            chunks.sort((a, b) => a.start - b.start);
        
            let modal = document.getElementById('round-selector-modal');
            if (modal) modal.remove();

            // 🌟 终极护眼玻璃版：超强模糊 + 88% 不透明底色，防透字无死角
            let html = `
            <div class="config-modal-overlay" id="round-selector-modal" style="z-index: 5000; background: rgba(0,0,0,0.25);" onclick="closeRoundSelectorModalByOverlay(event)">
                
                <div class="config-modal-content" style="max-height: 70vh; display:flex; flex-direction:column; width: 90%; max-width: 360px; padding: 0; 
                    background: color-mix(in srgb, var(--card-bg) 88%, transparent); 
                    backdrop-filter: blur(40px) saturate(180%); 
                    -webkit-backdrop-filter: blur(40px) saturate(180%);
                    border: 0.5px solid color-mix(in srgb, var(--text-main) 12%, transparent); 
                    box-shadow: 0 20px 40px rgba(0,0,0,0.2), inset 0 1px 1px color-mix(in srgb, var(--text-main) 6%, transparent); 
                    border-radius: 20px; overflow: hidden; color-scheme: light dark;" 
                    onclick="event.stopPropagation()">
                    
                    <div class="config-modal-header" style="padding: 16px 20px 10px; display: flex; justify-content: space-between; align-items: center; background: transparent;">
                        <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: var(--text-main); letter-spacing: -0.5px; text-shadow: 0 1px 4px color-mix(in srgb, var(--bg-color) 50%, transparent);">自由修史</h3>
                        <div onclick="closeRoundSelectorModal()" style="width: 28px; height: 28px; border-radius: 50%; background: color-mix(in srgb, var(--text-main) 8%, transparent); display: flex; align-items: center; justify-content: center; cursor: pointer; backdrop-filter: blur(10px);">
                            <i class="fas fa-times" style="color: var(--text-sub); font-size: 13px;"></i>
                        </div>
                    </div>

                    <div class="config-modal-body" style="padding: 0 20px 16px; overflow-y: auto; flex: 1; background: transparent;">
                        
                        <div style="background: color-mix(in srgb, var(--text-main) 5%, transparent); border: 0.5px solid color-mix(in srgb, var(--text-main) 5%, transparent); border-radius: 14px; padding: 12px; margin-bottom: 16px;">
                            <div style="font-size: 11px; font-weight: 700; color: #D47A43; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px; display: flex; align-items: center; gap: 6px;">
                                <i class="fas fa-magic" style="font-size: 10px;"></i> 手动补录
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <div style="flex: 1; display: flex; align-items: center; background: color-mix(in srgb, var(--bg-color) 40%, transparent); border: 0.5px solid color-mix(in srgb, var(--text-main) 8%, transparent); border-radius: 10px; padding: 0 8px; height: 38px;">
                                    <input type="number" id="custom-round-start" placeholder="起始" style="width: 100%; border: none; background: transparent; color: var(--text-main); font-size: 13px; outline: none; text-align: center;">
                                    <span style="color: var(--text-sub); margin: 0 2px;">|</span>
                                    <input type="number" id="custom-round-end" placeholder="结束" style="width: 100%; border: none; background: transparent; color: var(--text-main); font-size: 13px; outline: none; text-align: center;">
                                </div>
                                <button onclick="addCustomRoundBlock()" style="height: 38px; padding: 0 14px; background: rgba(212,122,67, 0.9); backdrop-filter: blur(10px); color: white; border-radius: 10px; border: 0.5px solid rgba(255,255,255,0.2); font-weight: 600; font-size: 13px; cursor: pointer; transition: 0.3s; box-shadow: 0 4px 12px rgba(212,122,67,0.2);">添加</button>
                            </div>
                        </div>

                        <div style="padding-left: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                            <p style="font-size: 12px; font-weight: 500; color: var(--text-sub); margin: 0;">
                                <input type="checkbox" id="select-all-rounds" style="margin-right: 8px; transform: translateY(1px); accent-color: #D47A43;"> 选择提取区间 
                                <span style="opacity: 0.5; font-weight: 400;">(共 ${userMessagesCount} 轮)</span>
                            </p>
                        </div>

                        <div style="display:flex; flex-direction:column;">
            `;

            chunks.forEach((c) => {
                const statusTag = c.isCovered 
                    ? `<div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 10px; color: var(--text-sub); background: color-mix(in srgb, var(--text-main) 6%, transparent); border: 0.5px solid color-mix(in srgb, var(--text-main) 8%, transparent); padding: 2px 6px; border-radius: 4px;">已存</span>
                        <i class="fa-solid fa-trash-can" onclick="event.stopPropagation(); deleteArchiveBlock(${c.start}, ${c.end})" style="color: #ff5e5e; font-size: 12px; cursor: pointer; opacity: 0.7;"></i>
                    </div>` 
                    : `<span style="font-size: 11px; color: #D47A43; font-weight: 700;">待提取</span>`;
                
                html += `
                    <label style="display:flex; align-items:center; justify-content:space-between; padding: 10px 4px; cursor: pointer; border-bottom: 0.5px solid color-mix(in srgb, var(--text-main) 8%, transparent);">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="position: relative; width: 18px; height: 18px;">
                                <input type="checkbox" class="round-chunk-cb" value="${c.start}-${c.end}" ${c.isCovered ? '' : 'checked'} 
                                    style="cursor: pointer; width: 18px; height: 18px; accent-color: #D47A43; margin: 0;">
                            </div>
                            <span style="font-size: 14px; font-weight: 500; color: var(--text-main);">第 ${c.start} - ${c.end} 轮</span>
                        </div>
                        ${statusTag}
                    </label>
                `;
            });

            html += `
                        </div>
                    </div>
                    
                    <div style="padding: 16px 20px; background: transparent; display: flex; gap: 12px;">
                        <button onclick="executeBackfillSelected()" style="flex: 1; background: color-mix(in srgb, var(--text-main) 90%, transparent); color: var(--card-bg); height: 44px; border-radius: 12px; border: 0.5px solid color-mix(in srgb, var(--card-bg) 20%, transparent); font-weight: 700; font-size: 15px; cursor: pointer; transition: 0.3s; box-shadow: 0 6px 16px rgba(0,0,0,0.15);" 
                                onmousedown="this.style.transform='scale(0.96)'" onmouseup="this.style.transform='scale(1)'">
                            开始提取档案
                        </button>
                    </div>
                </div>
            </div>
            <style>
                #round-selector-modal .config-modal-content {
                    transform: translateY(20px) scale(0.95);
                    opacity: 0;
                    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
                #round-selector-modal.show .config-modal-content {
                    transform: translateY(0) scale(1);
                    opacity: 1;
                }
                .config-modal-body::-webkit-scrollbar { width: 4px; }
                .config-modal-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--text-main) 15%, transparent); border-radius: 10px; }
            </style>
            `;
            document.body.insertAdjacentHTML('beforeend', html);

            const newModal = document.getElementById('round-selector-modal');
            if (newModal) {
                newModal.classList.add('show');

                // 全选复选框绑定
                const selectAllCheckbox = newModal.querySelector('#select-all-rounds');
                if (selectAllCheckbox) {
                    selectAllCheckbox.addEventListener('change', (e) => {
                        const isChecked = e.target.checked;
                        const allCbs = newModal.querySelectorAll('.round-chunk-cb');
                        allCbs.forEach(cb => {
                            cb.checked = isChecked;
                            // 触发 change 事件，以便其他逻辑（如已有监听器）同步
                            cb.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                    });
                }
                const scrollContainer = newModal.querySelector('.config-modal-body');
                if (!scrollContainer) return;

                let startY = 0;
                let startValid = false;
                let isSelecting = false;
                let autoScrollRaf = null;
                let lastClientX = 0, lastClientY = 0;
                let lastZoneId = null;
                let lastToggleTime = 0;

                const ENTER_THRESHOLD = 4;           // 移动4px进入选择模式
                const SCROLL_ZONE = 45;
                const SCROLL_SPEED = 8;
                const DEBOUNCE_MS = 30;              // 极短防抖，保证灵敏

                function getZoneElement(x, y) {
                    const elem = document.elementsFromPoint(x, y);
                    for (let el of elem) {
                        const zone = el.closest('label, .config-list-item');
                        if (zone && zone.querySelector('.round-chunk-cb')) return zone;
                    }
                    return null;
                }

                function isValidStart(x, y) {
                    const zone = getZoneElement(x, y);
                    if (!zone) return false;
                    const cb = zone.querySelector('.round-chunk-cb');
                    if (!cb) return false;
                    const zoneRect = zone.getBoundingClientRect();
                    const cbRect = cb.getBoundingClientRect();
                    return x >= zoneRect.left && x <= cbRect.right;
                }

                function toggleZone(zone) {
                    if (!zone) return false;
                    const now = Date.now();
                    if (now - lastToggleTime < DEBOUNCE_MS) return false;
                    const zoneId = zone;
                    if (zoneId === lastZoneId) return false;
                    const cb = zone.querySelector('.round-chunk-cb');
                    if (!cb) return false;
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change', { bubbles: true }));
                    lastZoneId = zoneId;
                    lastToggleTime = now;
                    return true;
                }

                // 获取所有可见区间（在视口内）
                function getVisibleZones() {
                    if (!scrollContainer) return [];
                    const rect = scrollContainer.getBoundingClientRect();
                    return Array.from(scrollContainer.querySelectorAll('label, .config-list-item'))
                        .filter(z => z.querySelector('.round-chunk-cb'))
                        .filter(z => {
                            const zRect = z.getBoundingClientRect();
                            return zRect.top < rect.bottom && zRect.bottom > rect.top;
                        });
                }

                function getAdjacentZone(currentZone, direction) {
                    const allZones = Array.from(scrollContainer.querySelectorAll('label, .config-list-item'))
                        .filter(z => z.querySelector('.round-chunk-cb'));
                    const index = allZones.indexOf(currentZone);
                    if (direction === 'up' && index > 0) return allZones[index - 1];
                    if (direction === 'down' && index < allZones.length - 1) return allZones[index + 1];
                    return null;
                }

                function startAutoScroll(direction) {
                    if (autoScrollRaf) cancelAnimationFrame(autoScrollRaf);
                    let lastTimestamp = 0;
                    let lastProcessedZone = null;

                    function step(now) {
                        if (!isSelecting) {
                            cancelAnimationFrame(autoScrollRaf);
                            autoScrollRaf = null;
                            return;
                        }
                        if (!lastTimestamp) lastTimestamp = now;
                        const delta = now - lastTimestamp;
                        if (delta >= 16) {
                            // 执行滚动
                            if (direction === 'up') {
                                scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_SPEED);
                            } else {
                                scrollContainer.scrollTop = Math.min(scrollContainer.scrollHeight - scrollContainer.clientHeight, scrollContainer.scrollTop + SCROLL_SPEED);
                            }
                            lastTimestamp = now;

                            // 优先处理手指下方的区间
                            const fingerZone = getZoneElement(lastClientX, lastClientY);
                            if (fingerZone) {
                                toggleZone(fingerZone);
                                if (lastProcessedZone === fingerZone) {
                                    const nextZone = getAdjacentZone(fingerZone, direction);
                                    if (nextZone) toggleZone(nextZone);
                                }
                                lastProcessedZone = fingerZone;
                            } else {
                                // 如果手指下方没有区间（例如在边缘空白），则主动处理可见区间中滚动方向上的第一个
                                const visibleZones = getVisibleZones();
                                if (visibleZones.length) {
                                    const targetZone = direction === 'up' ? visibleZones[0] : visibleZones[visibleZones.length - 1];
                                    if (targetZone) toggleZone(targetZone);
                                }
                                lastProcessedZone = null;
                            }

                            // 额外处理：当滚动到边界时，如果还有未切换的边界区间，再尝试切换一次
                            const isAtTop = scrollContainer.scrollTop === 0;
                            const isAtBottom = scrollContainer.scrollTop >= scrollContainer.scrollHeight - scrollContainer.clientHeight;
                            if (isAtTop || isAtBottom) {
                                const boundaryZone = direction === 'up' ? getVisibleZones()[0] : getVisibleZones().slice(-1)[0];
                                if (boundaryZone && boundaryZone !== lastZoneId) toggleZone(boundaryZone);
                            }
                        }
                        autoScrollRaf = requestAnimationFrame(step);
                    }
                    autoScrollRaf = requestAnimationFrame(step);
                }

                function stopAutoScroll() {
                    if (autoScrollRaf) {
                        cancelAnimationFrame(autoScrollRaf);
                        autoScrollRaf = null;
                    }
                }

                function onTouchStart(e) {
                    startY = e.touches[0].clientY;
                    const touchX = e.touches[0].clientX;
                    const touchY = e.touches[0].clientY;
                    startValid = isValidStart(touchX, touchY);
                    isSelecting = false;
                    lastZoneId = null;
                    lastToggleTime = 0;
                    stopAutoScroll();
                }

                function onTouchMove(e) {
                    if (!startValid) return;

                    const currentY = e.touches[0].clientY;
                    const deltaY = currentY - startY;

                    if (!isSelecting && Math.abs(deltaY) > ENTER_THRESHOLD) {
                        isSelecting = true;
                        e.preventDefault();
                        lastClientX = e.touches[0].clientX;
                        lastClientY = currentY;
                        const firstZone = getZoneElement(lastClientX, lastClientY);
                        if (firstZone) toggleZone(firstZone);
                        return;
                    }

                    if (!isSelecting) return;

                    e.preventDefault();
                    lastClientX = e.touches[0].clientX;
                    lastClientY = currentY;

                    const rect = scrollContainer.getBoundingClientRect();
                    const relativeY = lastClientY - rect.top;
                    const isTopZone = relativeY < SCROLL_ZONE && scrollContainer.scrollTop > 0;
                    const isBottomZone = relativeY > rect.height - SCROLL_ZONE && scrollContainer.scrollTop < scrollContainer.scrollHeight - rect.height;

                    if (isTopZone) {
                        startAutoScroll('up');
                    } else if (isBottomZone) {
                        startAutoScroll('down');
                    } else {
                        stopAutoScroll();
                    }

                    const zone = getZoneElement(lastClientX, lastClientY);
                    if (zone) toggleZone(zone);
                }

                function onTouchEnd(e) {
                    if (isSelecting) e.preventDefault();
                    // 结束时，确保最后手指下的区间被切换（如果之前漏掉）
                    if (isSelecting) {
                        const finalZone = getZoneElement(lastClientX, lastClientY);
                        if (finalZone && finalZone !== lastZoneId) toggleZone(finalZone);
                    }
                    isSelecting = false;
                    lastZoneId = null;
                    stopAutoScroll();
                }

                scrollContainer.addEventListener('touchstart', onTouchStart, { passive: true });
                scrollContainer.addEventListener('touchmove', onTouchMove, { passive: false });
                scrollContainer.addEventListener('touchend', onTouchEnd);
                scrollContainer.addEventListener('touchcancel', onTouchEnd);

                const originalClose = window.closeRoundSelectorModal;
                window.closeRoundSelectorModal = function() {
                    if (originalClose) originalClose();
                    scrollContainer.removeEventListener('touchstart', onTouchStart);
                    scrollContainer.removeEventListener('touchmove', onTouchMove);
                    scrollContainer.removeEventListener('touchend', onTouchEnd);
                    scrollContainer.removeEventListener('touchcancel', onTouchEnd);
                    stopAutoScroll();
                };
            }
        }

        // 🌟 全局关闭修史面板函数（带退出动画）
        window.closeRoundSelectorModal = function() {
            const modal = document.getElementById('round-selector-modal');
            if (modal) {
                modal.classList.remove('show');
                setTimeout(() => modal.remove(), 300);
            }
        };

        window.closeRoundSelectorModalByOverlay = function(event) {
            if (event.target === event.currentTarget) {
                closeRoundSelectorModal();
            }
        };

        window.addCustomRoundBlock = function() {
            const start = parseInt(document.getElementById('custom-round-start').value);
            const end = parseInt(document.getElementById('custom-round-end').value);
            if (isNaN(start) || isNaN(end) || start <= 0 || end < start) {
                alert('请输入有效的轮数区间');
                return;
            }
            // 检查是否已存在
            const allCheckboxes = document.querySelectorAll('.round-chunk-cb');
            for (const cb of allCheckboxes) {
                    if (cb.value === `${start}-${end}`) {
                    alert('该区间已存在');
                    return;
                }
            }
            const list = document.querySelector('#round-selector-modal .config-modal-body div[style*="flex-direction:column"]');
            if (!list) return;
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding: 14px 16px; background: var(--card-bg); border-radius: 12px; border: 0.5px solid var(--border); cursor: pointer; transition: background 0.2s;';
            label.innerHTML = '<span style="font-size:15px; font-weight:600; color: var(--text-main); display:flex; align-items:center;">第 ' + start + '-' + end + ' 轮 <span style="color:var(--accent); font-size:12px; margin-left:8px;">(手动补充)</span></span><input type="checkbox" class="round-chunk-cb" value="' + start + '-' + end + '" checked style="width:20px; height:20px; accent-color: var(--accent);">';
            list.appendChild(label);
            document.getElementById('custom-round-start').value = '';
            document.getElementById('custom-round-end').value = '';
        };     

        // --- 自由修史：销毁特定区间的旧档案 ---
        window.deleteArchiveBlock = function(start, end) {
            if(!confirm(`确定要销毁 第 ${start}-${end} 轮 的历史档案吗？销毁后可作为【缺失】重新生成。`)) return;
            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact || !contact.longMemories) return;
            
            // 找出范围内所有的档案并精准抹杀
            contact.longMemories = contact.longMemories.filter(m => {
                if (!m.roundRange) return true;
                const match = String(m.roundRange).match(/第?(\d+)-(\d+)轮?/);
                if (match && parseInt(match[1]) === start && parseInt(match[2]) === end) {
                    return false; // 命中目标区间，删掉！
                }
                return true;
            });
            saveToLocal();
            // 原地销毁弹窗并秒刷新
            const modal = document.getElementById('round-selector-modal');
            if(modal) modal.remove();
            backfillAllMemories(); 
        };
        // --- 执行勾选片段的合并且发送 API ---
        window.executeBackfillSelected = async function() {
            // 找出所有被打钩的复选框
            const checkboxes = document.querySelectorAll('.round-chunk-cb:checked');
            const selectedBlocks = Array.from(checkboxes).map(cb => {
                const [start, end] = cb.value.split('-').map(Number);
                return { startRound: start, endRound: end };
            });

            if (selectedBlocks.length === 0) {
                alert("请至少选择一个区间！");
                return;
            }

            // 销毁弹窗
            document.getElementById('round-selector-modal').remove();

            const contact = mockContacts.find(c => c.id === currentChatContactId);
            if (!contact) return;

            // 清理即将重写的区块的旧记忆（防止数据重复）
            if (contact.longMemories) {
                selectedBlocks.forEach(b => {
                    contact.longMemories = contact.longMemories.filter(m => {
                        if (!m.roundRange) return true;
                        const match = String(m.roundRange).match(/第?(\d+)-(\d+)轮?/);
                        if (!match) return true;
                        const mStart = parseInt(match[1]);
                        const mEnd = parseInt(match[2]);
                        const mid = (mStart + mEnd) / 2;
                        // 如果旧记忆的中心点落在我们即将重写的区间内，直接删掉旧的
                        if (mid >= b.startRound && mid <= b.endRound) {
                            return false;
                        }
                        return true;
                    });
                });
            } else {
                contact.longMemories = [];
            }

            // 获取 API 权限
            const memoryConfig = OTHER_API_CONFIGS.memory;
            let apiConfig = null;
            if (memoryConfig && memoryConfig.configId) {
                apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === memoryConfig.configId);
            }
            if (!apiConfig) {
                apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            }
            if (!apiConfig) {
                alert('⚠️ 没有可用的 API 配置');
                return;
            }

            // 精准把勾选的区块抽离出来，合并在一起发给大模型
            const conversation = getConversation(contact.id);
            let allMissingChats = "";
            
            // 1. 先将整个对话分组为轮次（每次用户消息开启一轮，包含后续AI消息）
            const rounds = [];
            let currentRound = [];
            conversation.forEach(msg => {
                if (msg.role === 'user' && currentRound.length > 0) {
                    rounds.push([...currentRound]);
                    currentRound = [];
                }
                currentRound.push(msg);
            });
            if (currentRound.length > 0) rounds.push(currentRound);
            // rounds 下标0对应第1轮

            allMissingChats = "";
            selectedBlocks.forEach(block => {
                const startIdx = block.startRound - 1;
                const endIdx = block.endRound - 1;
                if (startIdx >= 0 && endIdx < rounds.length) {
                    const blockMessages = rounds.slice(startIdx, endIdx + 1).flat();
                    let roundLabel = block.startRound;
                    const chatContent = blockMessages.map(m => {
                        if (m.role === 'user') {
                            const line = `[第${roundLabel}轮] 用户：${m.content}`;
                            roundLabel++;
                            return line;
                        } else {
                            return `AI：${m.content}`;
                        }
                    }).join('\n');
                    allMissingChats += `\n\n【需要提取的对话区块：第${block.startRound}-${block.endRound}轮】\n${chatContent}`;
                }
            });

            const allExistingMemories = contact.longMemories.length > 0 ? contact.longMemories.map(m => m.content).join('\n') : "暂无记忆";

            // 动态替换 AI 当前的身份和设定
            const dynamicPrompt = SYSTEM_ARCHIVE_PROMPT
                .replace(/\{\{AI_NAME\}\}/g, contact.name || '未命名角色')
                .replace(/\{\{AI_PERSONA\}\}/g, contact.prompt || '暂无设定');

            const summaryMessages = [
                { role: "system", content: dynamicPrompt }, 
                { 
                    role: "user", 
                    content: `请根据以下对话区块提取档案和关系变化，不要参考其他记忆。请勿重复记录已有事件；若是新细节请补充。\n${allMissingChats}\n\n请严格以大纲作者的视角，按格式要求返回 JSON。` 
                }
            ];

            try {
                const modelToUse = (memoryConfig && memoryConfig.model) ? memoryConfig.model : apiConfig.model;
                let apiUrl = getStandardApiUrl(apiConfig.url, '/chat/completions');
                
                addLogToConsole('info', 'ARCHIVE', `正在提取 ${selectedBlocks.length} 个区块的档案...`);
                
                // 呼出顶部进度条
                const progressBar = document.getElementById('backfill-progress-bar');
                if (progressBar) {
                    progressBar.style.opacity = '1';
                    progressBar.classList.add('active');
                    progressBar.style.transition = 'transform 1.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease';
                    progressBar.style.transform = 'scaleX(0.5)';
                }

                const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'chat',
                        customEndpoint: apiUrl,
                        customApiKey: apiConfig.key,
                        model: modelToUse,
                        messages: summaryMessages,
                        temperature: 0.1,
                        max_tokens: 3000
                    })
                });

                if (!response.ok) throw new Error(`API 报错: ${response.status}`);
                const data = await response.json();
                
                // JSON 安全脱壳术
                let jsonStr = data.choices && data.choices[0] ? data.choices[0].message.content : data.result;
                jsonStr = jsonStr.replace(/```json/gi, '').replace(/```/g, '').trim();
                const result = JSON.parse(jsonStr);

                let addedCount = 0;
                // 🌟 剥离现实时间！只有开启现实感知时，才调用当前现实时间
                const isRealityMode = document.getElementById('reality-mode-switch')?.classList.contains('active');
                let realDateStr = null;
                if (isRealityMode) {
                    const now = new Date();
                    realDateStr = `${now.getMonth()+1}月${now.getDate()}日`;
                }

                // 注入新记忆
                if (result.memories && Array.isArray(result.memories)) {
                    result.memories.forEach(m => {
                        m.id = 'mem_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                        if (!m.roundRange) m.roundRange = `${startRound}-${endRound}`;
                        if (isRealityMode && !m.worldTime) m.date = realDateStr;
                        
                        // 🌟 实体合并引擎：真名覆盖旧代号
                        if (m.previousName && m.keywords && m.keywords.length > 0) {
                            let oldAlias = m.previousName;
                            let realName = m.keywords[0];
                            addLogToConsole('info', 'ARCHIVE', `触发实体合并：[${oldAlias}] 真名揭晓为 [${realName}]`);
                            if (contact.longMemories) {
                                contact.longMemories.forEach(oldMem => {
                                    if (oldMem.keywords && oldMem.keywords.includes(oldAlias)) {
                                        oldMem.keywords = oldMem.keywords.map(k => k === oldAlias ? realName : k);
                                        oldMem.content = oldMem.content.replace(new RegExp(oldAlias, 'g'), realName);
                                    }
                                });
                            }
                            if (contact.relations) {
                                contact.relations.forEach(r => {
                                    if (r.source === oldAlias) r.source = realName;
                                    if (r.target === oldAlias) r.target = realName;
                                });
                            }
                        }
                        
                        contact.longMemories.push(m);
                        addedCount++;
                    });
                }

                // 注入人物关系星图连线数据！
                if (result.relations && Array.isArray(result.relations)) {
                    if (!contact.relations) contact.relations = [];
                    result.relations.forEach(r => {
                        const existingRelIndex = contact.relations.findIndex(ex => 
                            (ex.source === r.source && ex.target === r.target) || 
                            (ex.source === r.target && ex.target === r.source)
                        );
                        
                        // 羁绊的时间戳使用世界时间或轮数
                        const timeMark = r.updatedAt || (isRealityMode ? realDateStr : `第 ${selectedBlocks[0].startRound}-${selectedBlocks[selectedBlocks.length-1].endRound} 轮`); 

                        if (existingRelIndex !== -1) {
                            const existingRel = contact.relations[existingRelIndex];
                            if (!existingRel.history) existingRel.history = [{ label: existingRel.label, time: '往昔', detail: existingRel.detail || '初始状态' }];
                            existingRel.label = r.label;
                            existingRel.detail = r.detail || '关系产生了新的转变。';
                            existingRel.updatedAt = timeMark;
                            existingRel.history.push({ label: r.label, time: timeMark, detail: existingRel.detail });
                        } else {
                            r.history = [{ label: r.label, time: timeMark, detail: r.detail || '建立了初始羁绊。' }];
                            r.updatedAt = timeMark;
                            contact.relations.push(r);
                        }
                    });
                }

                // 时间轴重排
                if (contact.longMemories && contact.longMemories.length > 0) {
                    contact.longMemories.sort((a, b) => {
                        const getStart = (range) => {
                            if (!range) return 0;
                            const match = String(range).match(/第?(\d+)-/);
                            return match ? parseInt(match[1], 10) : 0;
                        };
                        return getStart(a.roundRange) - getStart(b.roundRange);
                    });
                }

                saveToLocal();
                
                if (progressBar) progressBar.style.transform = `scaleX(1)`;
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const searchInput = document.getElementById('archive-search-input');
                renderArchiveContent(searchInput ? searchInput.value : '');
                updateMemoryStats();
                
                alert(`✅ 记忆融合完成！\n\n成功萃取了 ${addedCount} 条设定档案，及 ${result.relations ? result.relations.length : 0} 组人物羁绊。`);

            } catch (error) {
                let rawError = error.stack || error.toString();
                addLogToConsole('error', '修史提取出错', rawError);
                console.error("提取出错:", error);
                alert(`⚠️ 提取出错: ${error.message}\n请查看控制台获取原始错误信息。`);

            } finally {
                const progressBar = document.getElementById('backfill-progress-bar');
                if (progressBar) {
                    progressBar.style.transition = 'opacity 0.5s ease, transform 0.3s ease';
                    progressBar.style.opacity = '0';
                    setTimeout(() => {
                        progressBar.classList.remove('active');
                        progressBar.style.transform = 'scaleX(0)';
                    }, 500);
                }
            }
        }

        function switchTab(tabName) {
            // 切换页面时，强制隐藏论坛的加载圈，防止它跑到聊天界面去
            if(document.getElementById('explore-refresh-indicator')) {
                document.getElementById('explore-refresh-indicator').style.opacity = '0';
            }
            document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
            document.getElementById('tab-' + tabName).classList.add('active');
            const tabs = ['apps', 'explore', 'chat', 'me'];
            const index = tabs.indexOf(tabName);
            if(index >= 0) document.querySelectorAll('.tab-btn')[index].classList.add('active');
            
            // 🎯 新增：记录当前所在的 Tab，让下拉刷新后能回到这里
            sessionStorage.setItem('CURRENT_MAIN_TAB', tabName);
        }
        function switchExplore(index) {
            const glider = document.getElementById('seg-glider');
            glider.style.transform = `translateX(${index * 100}%)`;
            document.querySelectorAll('.seg-item').forEach((el, i) => { el.classList.toggle('active', i === index); });
            document.querySelectorAll('.explore-section').forEach(el => el.classList.remove('active'));
            document.getElementById('exp-sec-' + index).classList.add('active');
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
