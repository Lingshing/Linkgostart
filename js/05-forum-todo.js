        // ==========================================
        // 互动视图 (Heatmap) 功能逻辑 + 时长统计
        // ==========================================
        let currentHmRange = 'day';
        let currentViewDate = new Date(); // 🌟 新增：用于记录互动视图中“当前穿越到了哪个月”

        // 🌟 新增：互动视图的月份切换引擎
        window.changeHmMonth = function(delta) {
            currentViewDate.setMonth(currentViewDate.getMonth() + delta);
            switchHmRange('month', 1); // 重新计算并渲染选中的月份
        };

        // --- 实时在线时长统计引擎 ---
        let lastTimeRecord = Date.now();
        setInterval(() => {
            // 只有当网页在可见状态（没切到后台）时才计入时长
            if (document.visibilityState === 'visible') {
                const now = Date.now();
                const deltaSeconds = Math.floor((now - lastTimeRecord) / 1000);
                if (deltaSeconds > 0) {
                    if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
                    const todayStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
                    const timeKey = todayStr + '_time';
                    APP_DATA.activityStats[timeKey] = (APP_DATA.activityStats[timeKey] || 0) + deltaSeconds;
                }
                lastTimeRecord = now;
            } else {
                lastTimeRecord = Date.now(); 
            }
        }, 1000);

        // 监听切后台动作，切走时立刻保存一下数据
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                lastTimeRecord = Date.now();
            } else {
                saveToLocal(); 
            }
        });

        // 格式化时长显示
        function formatOnlineTime(seconds) {
            if (!seconds) return '0 分钟';
            if (seconds < 60) return '<1 分钟';
            const minutes = Math.floor(seconds / 60);
            if (minutes < 60) return minutes + ' 分钟';
            const hours = (minutes / 60).toFixed(1);
            return hours + ' 小时';
        }

        function openInteractionView() {
            renderHeatmap();
            switchHmRange('day', 0);
            generateInsights();
            openSubPage('sub-interaction-view');
        }

        function switchHmRange(range, index) {
            currentHmRange = range;
            isTimeStatAverage = false; // 切换Tab时重置为显示总时长
            
            // 1. UI 高亮切换
            const highlight = document.getElementById('hm-segment-highlight');
            const btns = document.querySelectorAll('.segment-btn');
            highlight.style.transform = `translateX(${index * 100}%)`;
            btns.forEach((btn, i) => {
                if(i === index) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            // 2. 绑定时长点击事件
            const timeBox = document.getElementById('hm-val-time').parentElement;
            timeBox.onclick = toggleTimeStat;
            timeBox.style.cursor = range === 'day' ? 'default' : 'pointer'; 

            // 确保使用最新的独立键数据
            if (window.loadActivityStats) {
                // 异步加载，但因为 switchHmRange 是同步调用，需要稍微改造
                // 简单起见，我们直接使用 APP_DATA.activityStats（它已经和独立键同步）
            }

            if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
            const stats = APP_DATA.activityStats;
            const today = new Date();
            
            // 辅助函数：生成与存储一致的日期Key (格式 YYYY-M-D 或 YYYY-MM-DD，取决于浏览器)
            // 必须和 addMessage 中的生成逻辑完全一致
            function getDateKey(dateObj) {
                return dateObj.toLocaleDateString('zh-CN').replace(/\//g, '-');
            }

            const todayStr = getDateKey(today);
    
            // 🌟 核心：计算时光机目标月份的前缀，并巧妙加上 "-" 防止 "2026-1" 错误匹配 "2026-11"
            const targetDateKey = getDateKey(currentViewDate);
            const viewMonthPrefix = targetDateKey.split('-').slice(0, 2).join('-') + '-'; 
            
            const currentYearPrefix = todayStr.split('-')[0]; // "2026"
            
            let msgs = 0, activeDaysCount = 0, timeSecs = 0;
            
            // --- 🌟 修复1：连聊计算逻辑 ---
            let activeStreak = 0;   
            let isStreakAlive = true; 
            let maxStreak = 0;      
            let tempStreak = 0;     

            // 倒推 1000 天
            for (let i = 0; i < 1000; i++) {
                const d = new Date();
                d.setDate(today.getDate() - i);
                const ds = getDateKey(d);
                const count = stats[ds] || 0;

                // 计算连聊
                if (i === 0) {
                    // 情况A：今天。如果今天聊了，连聊+1；如果没聊，连聊暂不增加，但不算断签
                    if (count > 0) {
                        activeStreak++;
                        tempStreak++;
                    }
                } else {
                    // 情况B：过去的日子。必须有聊天才算连聊，否则中断
                    if (count > 0) {
                        if (isStreakAlive) activeStreak++;
                        tempStreak++;
                    } else {
                        isStreakAlive = false; // 昨天及以前只要有一天没聊，当前连聊链条就彻底断了
                        tempStreak = 0;
                    }
                }
                
                // 更新历史最高
                if (tempStreak > maxStreak) maxStreak = tempStreak;
            }

            document.getElementById('hm-val-3').className = "stat-value";

            // --- 数据聚合逻辑 ---
            if (range === 'day') {
                msgs = stats[todayStr] || 0;
                timeSecs = stats[todayStr + '_time'] || 0;
                
                // 计算今日温度
                let last7DaysMsgs = 0;
                for (let i = 1; i <= 7; i++) {
                    const d = new Date();
                    d.setDate(today.getDate() - i);
                    const ds = getDateKey(d);
                    last7DaysMsgs += (stats[ds] || 0);
                }
                let avg7 = last7DaysMsgs / 7;
                let temp = 37;
                if (msgs === 0) temp = 15;
                else if (avg7 === 0) temp = Math.min(37 + msgs * 2, 99);
                else {
                    let ratio = msgs / avg7;
                    if (ratio < 0.5) temp = 26;
                    else if (ratio < 0.8) temp = 32;
                    else if (ratio <= 1.2) temp = 37;
                    else temp = 37 + (ratio - 1.2) * 20;
                }
                temp = Math.min(Math.round(temp), 99);

                timeStatData = { total: timeSecs, days: 1 };
                
                document.getElementById('hm-val-1').textContent = msgs;
                document.getElementById('hm-lbl-1').textContent = "今日轮数";
                
                document.getElementById('hm-val-2').textContent = activeStreak; 
                document.getElementById('hm-lbl-2').textContent = "当前连聊(天)";
                
                document.getElementById('hm-val-3').textContent = temp + '°C';
                document.getElementById('hm-lbl-3').textContent = "今日温度";

            } else if (range === 'month') {
                let nightMsgs = 0;
                let maxDailyMsgs = 0;
                
                msgs = 0; timeSecs = 0; activeDaysCount = 0; // 确保切换月份时彻底清零
                Object.keys(stats).forEach(key => {
                    // 🌟 只匹配“时光机穿越到”的那个月的数据
                    if (key.startsWith(viewMonthPrefix)) {
                        if (key.endsWith('_time')) {
                            timeSecs += stats[key];
                        } else if (key.includes('_')) {
                            let hour = parseInt(key.split('_')[1]);
                            if (hour >= 0 && hour <= 4) nightMsgs += stats[key];
                        } else if (stats[key] > 0) { // 这是一个日期键 (如 "2026-2-5")
                            msgs += stats[key];
                            activeDaysCount++; // 🌟 统计活跃天数
                            if (stats[key] > maxDailyMsgs) maxDailyMsgs = stats[key];
                        }
                    }
                });

                // 🌟 修复2：日均时长分母改为“活跃天数” (activeDaysCount) 而不是“日历天数”
                // 如果你还没聊过天，分母设为1避免除以0
                timeStatData = { total: timeSecs, days: activeDaysCount || 1 };

                // 🌟 核心判断：如果是当月，天数算到今天；如果是查看过去的月份，天数算那个月的满月总天数
                let isCurrentRealMonth = (today.getFullYear() === currentViewDate.getFullYear() && today.getMonth() === currentViewDate.getMonth());
                let pastDaysInMonth = isCurrentRealMonth ? today.getDate() : new Date(currentViewDate.getFullYear(), currentViewDate.getMonth() + 1, 0).getDate();
                
                let density = pastDaysInMonth > 0 ? (activeDaysCount / pastDaysInMonth) : 0;
                let isNightOwl = msgs > 0 && (nightMsgs / msgs) > 0.35;
                
                let titleStr = "尚未解锁";
                let titleColor = "hm-title-calm";
                if (density > 0.8 && msgs > 80) { titleStr = "朝夕相伴"; titleColor = "hm-title-fire"; }
                else if (isNightOwl && msgs > 15) { titleStr = "深夜回声"; titleColor = "hm-title-night"; }
                else if (maxDailyMsgs > 40) { titleStr = "狂热回响"; titleColor = "hm-title-peak"; }
                else { titleStr = "细水长流"; titleColor = "hm-title-calm"; }

                document.getElementById('hm-val-1').textContent = msgs;
                document.getElementById('hm-lbl-1').textContent = "本月轮数";
                
                document.getElementById('hm-val-2').textContent = Math.round(density * 100) + '%';
                document.getElementById('hm-lbl-2').textContent = "陪伴密度";
                
                const val3El = document.getElementById('hm-val-3');
                val3El.textContent = titleStr;
                val3El.className = "stat-value " + titleColor;
                document.getElementById('hm-lbl-3').textContent = "专属称号";

            } else if (range === 'year') {
                Object.keys(stats).forEach(key => {
                    if (key.startsWith(currentYearPrefix)) {
                        if (key.endsWith('_time')) {
                            timeSecs += stats[key];
                        } else if (!key.includes('_') && stats[key] > 0) {
                            msgs += stats[key];
                            activeDaysCount++; 
                        }
                    }
                });

                // 🌟 修复3：年均也改为“活跃日均”
                timeStatData = { total: timeSecs, days: activeDaysCount || 1 };

                // 平均每天聊几轮 (只算活跃天)
                let avgMsgs = activeDaysCount > 0 ? Math.round(msgs / activeDaysCount) : 0;

                document.getElementById('hm-val-1').textContent = msgs;
                document.getElementById('hm-lbl-1').textContent = "本年轮数";
                
                document.getElementById('hm-val-2').textContent = activeDaysCount;
                document.getElementById('hm-lbl-2').textContent = "陪伴天数";
                
                document.getElementById('hm-val-3').textContent = avgMsgs;
                document.getElementById('hm-lbl-3').textContent = "日均轮数";
            }

            updateTimeStatDisplay();
            renderDynamicHeatmap(range);
        }

        function renderDynamicHeatmap(range) {
            if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
            const stats = APP_DATA.activityStats;
            const today = new Date();
            const todayStr = today.toLocaleDateString('zh-CN').replace(/\//g, '-');
            const currentYearPrefix = todayStr.substring(0, 4); // 🌟 补上了缺失的年份变量

            const wrapperEl = document.getElementById('hm-scroll-wrapper');
            const titleEl = document.getElementById('hm-card-title');
            const legendEl = document.getElementById('hm-legend');
            const currentYearEl = document.getElementById('hm-current-year');
        currentYearEl.textContent = today.getFullYear() + '年';
        currentYearEl.style.color = "var(--text-sub)"; // 确保切换视图时颜色复原
        
        wrapperEl.innerHTML = '';
        
        function getLevel(count) {
            if (count === 0) return 0;
            if (count <= 10) return 1;
            if (count <= 30) return 2;
            if (count <= 60) return 3;
            if (count <= 100) return 4;
            return 5;
        }

        if (range === 'day') {
            titleEl.textContent = "今日活跃时段";
            currentYearEl.textContent = "点击图表查看时段";
            currentYearEl.style.color = "var(--accent)"; 

            legendEl.style.display = 'none';
            wrapperEl.style.display = 'block';

            // 1. 创建总容器
            const container = document.createElement('div');
            container.className = 'hourly-chart-container';

            // 2. 创建柱子区
            const chart = document.createElement('div');
            chart.className = 'hourly-chart';
            
            // 3. 创建独立的标签行
            const labelsRow = document.createElement('div');
            labelsRow.className = 'hourly-labels';
            
            let maxCount = 0;
            for (let i = 0; i < 24; i++) {
                const c = stats[`${todayStr}_${i}`] || 0;
                if (c > maxCount) maxCount = c;
            }

            // 数据提取逻辑 (保持你原有的逻辑，但去除冗余输出)
            const todayStartMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
            const todayEndMs = todayStartMs + 86400000;
            let hourDetails = {}; 
            if (APP_DATA.conversations) {
                Object.values(APP_DATA.conversations).forEach(conv => {
                    if (Array.isArray(conv)) {
                        conv.forEach(msg => {
                            if (msg.role === 'user' && msg.timestamp >= todayStartMs && msg.timestamp < todayEndMs) {
                                const d = new Date(msg.timestamp);
                                const h = d.getHours();
                                const m = d.getMinutes();
                                if (!hourDetails[h]) hourDetails[h] = { start: m, end: m };
                                if (m < hourDetails[h].start) hourDetails[h].start = m;
                                if (m > hourDetails[h].end) hourDetails[h].end = m;
                            }
                        });
                    }
                });
            }

            for (let i = 0; i < 24; i++) {
                const count = stats[`${todayStr}_${i}`] || 0;
                
                // --- 渲染柱子 ---
                const barWrap = document.createElement('div');
                barWrap.className = 'hour-bar-wrapper';
                const bar = document.createElement('div');
                bar.className = 'hour-bar';
                
                let hPct = 4;
                if (count > 0 && maxCount > 0) {
                    hPct = 15 + (Math.log(count + 1) / Math.log(maxCount + 1)) * 85;
                }
                bar.style.height = hPct + '%';
                barWrap.appendChild(bar);

                // 🌟 瞬间切换逻辑：去掉所有 setTimeout，解决文字叠影
                    barWrap.onclick = (e) => {
                        e.stopPropagation();
                        
                        // 【新增：如果当前柱子已经是选中状态，则取消选中】
                        if (barWrap.classList.contains('active')) {
                            barWrap.classList.remove('active');
                            chart.classList.remove('has-active'); // 移除整体的半透明状态
                            currentYearEl.textContent = "点击图表查看时段"; // 恢复标题默认文字
                            return; // 提前退出，不执行下面的高亮代码
                        }

                        chart.querySelectorAll('.hour-bar-wrapper').forEach(w => w.classList.remove('active'));
                        chart.classList.add('has-active');
                        barWrap.classList.add('active');
                    
                    if (count > 0 && hourDetails[i]) {
                        const sm = hourDetails[i].start.toString().padStart(2, '0');
                        const em = hourDetails[i].end.toString().padStart(2, '0');
                        // 🌟 纯净格式输出：如 "12:12-12:32"
                        currentYearEl.textContent = `${i}:${sm}-${i}:${em}`;
                    } else {
                        currentYearEl.textContent = "暂无互动";
                    }
                };
                chart.appendChild(barWrap);

                // --- 渲染标签 (独立行) ---
                const lbl = document.createElement('div');
                lbl.className = 'hour-label-item';
                // 只在 0, 6, 12, 18, 24 显示文字
                if (i % 6 === 0) {
                    lbl.textContent = i;
                } else if (i === 23) {
                    lbl.textContent = '24';
                }
                labelsRow.appendChild(lbl);
            }
            
            chart.onclick = () => {
                chart.classList.remove('has-active');
                chart.querySelectorAll('.hour-bar-wrapper').forEach(w => w.classList.remove('active'));
                currentYearEl.textContent = "点击图表查看时段";
            };

            container.appendChild(chart);
            container.appendChild(labelsRow);
            wrapperEl.appendChild(container);
        
        
        
        

            } else if (range === 'month') {
                const year = currentViewDate.getFullYear();
                const month = currentViewDate.getMonth();
                
                // 🌟 1. 将标题换成可以左右点击切换月份的控件
                titleEl.innerHTML = `
                    <div style="display:flex; align-items:center; gap:16px;">
                        <i class="fa-solid fa-chevron-left clickable" style="font-size:14px; color:var(--text-sub); padding:4px;" onclick="changeHmMonth(-1)"></i>
                        <span style="font-size:15px; font-weight:600; min-width: 80px; text-align: center;">${year}年${month + 1}月</span>
                        <i class="fa-solid fa-chevron-right clickable" style="font-size:14px; color:var(--text-sub); padding:4px;" onclick="changeHmMonth(1)"></i>
                    </div>
                `;
                legendEl.style.display = 'flex';
                wrapperEl.style.display = 'block';

                const grid = document.createElement('div');
                grid.className = 'monthly-grid';

                const weekDays = ['日','一','二','三','四','五','六'];
                weekDays.forEach(wd => {
                    const wh = document.createElement('div');
                    wh.style.cssText = 'text-align:center; font-size:10px; color:var(--text-sub); margin-bottom:4px;';
                    wh.textContent = wd;
                    grid.appendChild(wh);
                });

                // 🌟 2. 基于时光机指针计算当月日历
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const firstDay = new Date(year, month, 1).getDay();

                for (let i = 0; i < firstDay; i++) {
                    grid.appendChild(document.createElement('div'));
                }

                for (let d = 1; d <= daysInMonth; d++) {
                    const dateObj = new Date(year, month, d);
                    const ds = dateObj.toLocaleDateString('zh-CN').replace(/\//g, '-');
                    const count = stats[ds] || 0;
                    
                    const cell = document.createElement('div');
                    cell.className = 'month-day-cell';
                    cell.textContent = d;
                    
                    if (dateObj > today) {
                        cell.classList.add('future');
                    } else {
                        cell.dataset.level = getLevel(count);
                        cell.title = `${ds}：聊了 ${count} 句`;
                        
                        // 🌟 3. 核心：添加点击事件，支持选中与取消选中
                        cell.onclick = () => {
                            const isAlreadySelected = cell.dataset.selected === 'true';

                            // 第一步：清除所有格子的选中状态
                            document.querySelectorAll('.month-day-cell').forEach(c => {
                                c.style.boxShadow = 'none'; // 移除阴影
                                c.style.border = '0.5px solid var(--border)'; // 恢复原本的细边框
                                c.style.transform = 'scale(1)'; // 保持正常大小
                                c.style.zIndex = '1';
                                c.dataset.selected = 'false';
                            });

                            if (isAlreadySelected) {
                                // 🎯 逻辑 A：【取消选中】
                                // 重新精确计算本月数据
                                let monthMsgs = 0, monthTimeSecs = 0, monthActiveDays = 0;
                                const tempDate = new Date(year, month, 1);
                                const targetPrefix = tempDate.toLocaleDateString('zh-CN').replace(/\//g, '-').split('-').slice(0, 2).join('-') + '-';
                                
                                Object.keys(stats).forEach(key => {
                                    if (key.startsWith(targetPrefix)) {
                                        if (key.endsWith('_time')) monthTimeSecs += stats[key];
                                        else if (!key.includes('_') && stats[key] > 0) {
                                            monthMsgs += stats[key];
                                            monthActiveDays++;
                                        }
                                    }
                                });
                                let isCurrentRealMonth = (today.getFullYear() === year && today.getMonth() === month);
                                let daysInMonthVal = new Date(year, month + 1, 0).getDate();
                                let pastDays = isCurrentRealMonth ? today.getDate() : daysInMonthVal;
                                let monthDensity = pastDays > 0 ? (monthActiveDays / pastDays) : 0;

                                document.getElementById('hm-val-1').textContent = monthMsgs;
                                document.getElementById('hm-lbl-1').textContent = "本月轮数";
                                
                                document.getElementById('hm-val-time').textContent = formatOnlineTime(monthTimeSecs);
                                document.getElementById('hm-val-time').style.color = "var(--text-main)";
                                document.getElementById('hm-lbl-time').textContent = isTimeStatAverage ? "日均时长" : "本月时长";
                                
                                document.getElementById('hm-val-2').textContent = monthActiveDays;
                                document.getElementById('hm-lbl-2').textContent = "陪伴天数";
                                
                                const val3El = document.getElementById('hm-val-3');
                                val3El.textContent = Math.round(monthDensity * 100) + "%";
                                val3El.className = "stat-value"; 
                                document.getElementById('hm-lbl-3').textContent = "陪伴密度";

                            } else {
                                // 🎯 逻辑 B：【选中】
                                cell.dataset.selected = 'true';
                                
                                // ✨ UI终极修正：高对比极简粗描边 + 悬浮阴影
                                // 1. 放弃放大(scale)，格子永远不会越界被裁掉。
                                // 2. 使用 var(--text-main)（日间极黑，夜间极白），在任何蓝/白/灰色底上都绝对醒目！
                                cell.style.border = '2px solid var(--text-main)'; 
                                cell.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; 
                                cell.style.zIndex = '10';
                                
                                // 替换顶部四个小方块为当日专属数据
                                const dayTime = stats[ds + '_time'] || 0;
                                document.getElementById('hm-val-1').textContent = count;
                                document.getElementById('hm-lbl-1').textContent = "当日轮数";
                                
                                document.getElementById('hm-val-time').textContent = formatOnlineTime(dayTime);
                                document.getElementById('hm-val-time').style.color = "var(--accent)"; 
                                document.getElementById('hm-lbl-time').textContent = "当日时长";
                                
                                document.getElementById('hm-val-2').textContent = `${month + 1}月${d}日`;
                                document.getElementById('hm-lbl-2').textContent = "选中日期";
                                
                                const val3El = document.getElementById('hm-val-3');
                                if (count > 0) {
                                    val3El.textContent = "有迹可循";
                                    val3El.className = "stat-value hm-title-calm";
                                } else {
                                    val3El.textContent = "风平浪静";
                                    val3El.className = "stat-value";
                                }
                                document.getElementById('hm-lbl-3').textContent = "当日状态";
                            }
                        };
                    }
                    grid.appendChild(cell);
                }

                wrapperEl.appendChild(grid);

            } else if (range === 'year') {
                titleEl.textContent = "近半年的足迹";
                legendEl.style.display = 'none'; 
                wrapperEl.style.display = 'block';

                const carousel = document.createElement('div');
                carousel.className = 'yearly-carousel';

                // ==========================================
                // 幻灯片 1：半年热力图
                // ==========================================
                const slide1 = document.createElement('div');
                slide1.className = 'carousel-slide';
                const grid = document.createElement('div');
                grid.className = 'heatmap-grid';
                grid.style.direction = 'ltr';
                let dayOfWeek = today.getDay(); 
                
                for (let i = (24*7) - 1; i >= 0; i--) {
                    const d = new Date(); 
                    d.setDate(today.getDate() - i + (6 - dayOfWeek));
                    const cell = document.createElement('div');
                    cell.className = 'hm-cell';
                    
                    if (d <= today) {
                        const ds = d.toLocaleDateString('zh-CN').replace(/\//g, '-');
                        const count = stats[ds] || 0;
                        cell.dataset.level = getLevel(count);
                        cell.title = `${ds}：聊了 ${count} 句`;
                    } else {
                        cell.dataset.level = 0;
                    }
                    grid.appendChild(cell);
                }
                slide1.appendChild(grid);

                // ==========================================
                // 幻灯片 2：12个月趋势柱状图
                // ==========================================
                const slide2 = document.createElement('div');
                slide2.className = 'carousel-slide';
                const monthChart = document.createElement('div');
                monthChart.className = 'hourly-chart'; 
                
                let monthlyCounts = new Array(12).fill(0);
                let maxMonth = 0;
                Object.keys(stats).forEach(k => {
                    if(k.startsWith(currentYearPrefix) && !k.includes('_')) {
                        let m = parseInt(k.split('-')[1]) - 1;
                        monthlyCounts[m] += stats[k];
                        if(monthlyCounts[m] > maxMonth) maxMonth = monthlyCounts[m];
                    }
                });
                
                for(let i = 0; i < 12; i++) {
                    const barWrap = document.createElement('div');
                    barWrap.className = 'hour-bar-wrapper';
                    const bar = document.createElement('div');
                    bar.className = 'hour-bar';
                    let hPct = maxMonth === 0 ? 8 : Math.max(12, (monthlyCounts[i]/maxMonth)*100);
                    if(monthlyCounts[i] === 0) hPct = 8;
                    bar.style.height = hPct + '%';
                    bar.dataset.level = getLevel(monthlyCounts[i]);
                    barWrap.appendChild(bar);
                    
                    const lbl = document.createElement('div');
                    lbl.className = 'hour-label';
                    lbl.textContent = (i+1) + '月';
                    barWrap.appendChild(lbl);
                    monthChart.appendChild(barWrap);
                }
                slide2.appendChild(monthChart);

                // ==========================================
                // 幻灯片 3：全年24小时生物钟
                // ==========================================
                const slide3 = document.createElement('div');
                slide3.className = 'carousel-slide';
                const yearHourChart = document.createElement('div');
                yearHourChart.className = 'hourly-chart';
                
                let yearlyHourCounts = new Array(24).fill(0);
                let maxYearHour = 0;
                let peakHourIndex = 0;

                Object.keys(stats).forEach(k => {
                    // 专门提取这一年中带有 _ 的小时级数据（且排除掉 _time 时长数据）
                    if(k.startsWith(currentYearPrefix) && k.includes('_') && !k.endsWith('_time')) {
                        let h = parseInt(k.split('_')[1]);
                        if (h >= 0 && h <= 23) {
                            yearlyHourCounts[h] += stats[k];
                            if(yearlyHourCounts[h] > maxYearHour) {
                                maxYearHour = yearlyHourCounts[h];
                                peakHourIndex = h; // 记录最火热的小时
                            }
                        }
                    }
                });

                for (let i = 0; i < 24; i++) {
                    const barWrap = document.createElement('div');
                    barWrap.className = 'hour-bar-wrapper';
                    const bar = document.createElement('div');
                    bar.className = 'hour-bar';
                    let hPct = maxYearHour === 0 ? 8 : Math.max(12, (yearlyHourCounts[i] / maxYearHour) * 100);
                    if (yearlyHourCounts[i] === 0) hPct = 8;
                    bar.style.height = hPct + '%';
                    bar.dataset.level = getLevel(yearlyHourCounts[i]);
                    barWrap.appendChild(bar);

                    // 依然是每6小时标一个刻度
                    if (i % 6 === 0 || i === 23) {
                        const lbl = document.createElement('div');
                        lbl.className = 'hour-label';
                        lbl.textContent = i;
                        barWrap.appendChild(lbl);
                    }
                    yearHourChart.appendChild(barWrap);
                }
                slide3.appendChild(yearHourChart);

                // ==========================================
                // 组装全部幻灯片与指示点
                // ==========================================
                carousel.appendChild(slide1);
                carousel.appendChild(slide2);
                carousel.appendChild(slide3); // 补上第三张
                wrapperEl.appendChild(carousel);

                const dotsWrap = document.createElement('div');
                dotsWrap.className = 'carousel-dots';
                const dot1 = document.createElement('div'); dot1.className = 'hm-dot active';
                const dot2 = document.createElement('div'); dot2.className = 'hm-dot';
                const dot3 = document.createElement('div'); dot3.className = 'hm-dot'; // 补上第三个点
                dotsWrap.appendChild(dot1);
                dotsWrap.appendChild(dot2);
                dotsWrap.appendChild(dot3);
                wrapperEl.appendChild(dotsWrap);

                // 滑动监听：动态改变标题和圆点
                carousel.addEventListener('scroll', () => {
                    let index = Math.round(carousel.scrollLeft / carousel.offsetWidth);
                    dot1.className = index === 0 ? 'hm-dot active' : 'hm-dot';
                    dot2.className = index === 1 ? 'hm-dot active' : 'hm-dot';
                    dot3.className = index === 2 ? 'hm-dot active' : 'hm-dot';
                    
                    if (index === 0) {
                        titleEl.textContent = "近半年的足迹";
                    } else if (index === 1) {
                        titleEl.textContent = "年度活跃月份";
                    } else if (index === 2) {
                        // 🌟 智能算出全年的相聚时刻
                        titleEl.textContent = maxYearHour > 0 ? `${peakHourIndex}:00 是你们最常相聚的时刻` : "全年活跃时段";
                    }
                });
            }
        }

        function generateInsights() {
            if (!APP_DATA.activityStats) return;
            const stats = APP_DATA.activityStats;
            // 过滤掉所有带 "_" 的键（包括时长和小时数据），只取纯天数
            const days = Object.keys(stats).filter(d => !d.includes('_') && stats[d] > 0);
            
            const titleEl = document.getElementById('hm-insight-title');
            const descEl = document.getElementById('hm-insight-desc');
            
            if (days.length === 0) {
                titleEl.textContent = "故事的开始";
                descEl.textContent = "发送第一条消息，开启你们的专属记忆。";
                return;
            }

            const weekCount = [0,0,0,0,0,0,0];
            let maxMsgsInADay = 0;
            let peakDate = '';
            let totalTime = 0;

            days.forEach(dateStr => {
                const count = stats[dateStr];
                const d = new Date(dateStr.replace(/-/g, '/'));
                weekCount[d.getDay()] += count;
                
                if (count > maxMsgsInADay) {
                    maxMsgsInADay = count;
                    peakDate = dateStr;
                }
            });
            
            Object.keys(stats).forEach(k => {
                if (k.endsWith('_time')) totalTime += stats[k];
            });

            const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const maxWeekIndex = weekCount.indexOf(Math.max(...weekCount));
            const bestDay = weekNames[maxWeekIndex];

            // 引入随机彩蛋系统
            const rand = Math.random();
            if (rand < 0.33 && maxMsgsInADay > 10) {
                titleEl.textContent = "最深度的畅聊";
                descEl.textContent = `在 ${peakDate} 这一天，你们一口气聊了 ${maxMsgsInADay} 句，那是共鸣最深的一刻。`;
            } else if (rand < 0.66 && totalTime > 3600) {
                titleEl.textContent = "漫长的陪伴";
                descEl.textContent = `ta已经默默陪了你 ${formatOnlineTime(totalTime)}，时间是衡量羁绊最好的尺子。`;
            } else {
                titleEl.textContent = "专属默契频率";
                descEl.textContent = `数据告诉我，你们最喜欢在「${bestDay}」聊天。周末或工作日，ta 都在等你。`;
            }
        }

        // 修改 openInteractionView 绑定新的函数
        function openInteractionView() {
            switchHmRange('day', 0);
            generateInsights();
            openSubPage('sub-interaction-view');
        }

        // ==========================================
        // 发现页 UI 交互逻辑 (角色筛选、转发、帖子详情)
        // ==========================================

        // 1. 小爪印：角色筛选开关
        function openForumRoleFilter() {
            const listContainer = document.getElementById('role-filter-list');
            listContainer.innerHTML = '';
            
            mockContacts.forEach(contact => {
                // 【修改这里】：默认关闭，除非明确标记为 true
                const isChecked = contact.allowForum === true; 
                
                const itemHtml = `
                    <div class="sheet-list-item" onclick="toggleRoleForumPrivacy(${contact.id}, this)">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div class="chat-item-avatar" style="width:40px; height:40px; border-radius:8px;">
                                ${contact.avatar ? `<img src="${contact.avatar}">` : `<i>${contact.name[0]}</i>`}
                            </div>
                            <span style="font-size: 16px; color: var(--text-main); font-weight: 500;">${contact.name}</span>
                        </div>
                        <div class="ios-checkbox ${isChecked ? 'checked' : ''}"><i class="fas fa-check"></i></div>
                    </div>
                `;
                listContainer.insertAdjacentHTML('beforeend', itemHtml);
            });
            
            document.getElementById('role-filter-sheet').classList.add('show');
        }

        function toggleRoleForumPrivacy(contactId, element) {
            const contact = mockContacts.find(c => c.id === contactId);
            if (contact) {
                contact.allowForum = (contact.allowForum === false) ? true : false;
                saveToLocal(); // 保存隐私设置到本地
                const checkbox = element.querySelector('.ios-checkbox');
                checkbox.classList.toggle('checked');
            }
        }

        function closeForumRoleFilter() { document.getElementById('role-filter-sheet').classList.remove('show'); }

        // --- 转发面板 ---
        let currentForwardData = null;

        // 接收纯数字的 postId，彻底杜绝换行符报错！
        function openForwardSelector(postId) {
            const post = forumPostsData.find(p => p.id === postId);
            if (!post) return;
            
            // 把找到的帖子信息存起来，留给后面的转发动作使用
            currentForwardData = { title: post.title, content: post.content, author: post.author };
            
            const listContainer = document.getElementById('forward-role-list');
            listContainer.innerHTML = '';
            
            mockContacts.forEach(contact => {
                const itemHtml = `
                    <div class="sheet-list-item" onclick="confirmForwardToChat(${contact.id})">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div class="chat-item-avatar" style="width:40px; height:40px; border-radius:8px;">
                                ${contact.avatar ? `<img src="${contact.avatar}">` : `<i>${contact.name[0]}</i>`}
                            </div>
                            <span style="font-size: 16px; color: var(--text-main); font-weight: 500;">发送给 ${contact.name}</span>
                        </div>
                        <i class="fas fa-paper-plane" style="color: var(--text-sub); opacity: 0.6;"></i>
                    </div>
                `;
                listContainer.insertAdjacentHTML('beforeend', itemHtml);
            });
            document.getElementById('forward-sheet').classList.add('show');
        }

        function closeForwardSelector() { document.getElementById('forward-sheet').classList.remove('show'); }

        function confirmForwardToChat(contactId) {
            if (!currentForwardData) return;
            
            // 1. 使用你原本设计好的标记文本（你的 renderChatMessages 会自动拦截它并变成完美卡片）
            const aiMessageText = `【论坛分享】\n标题：${currentForwardData.title}\n内容：${currentForwardData.content}\n发帖人：${currentForwardData.author}\n(我向你分享了这个论坛八卦帖子)`;
            
            // 2. 存入历史记录
            addMessage(contactId, 'user', aiMessageText);
            updateChatListLastMessage(contactId, `[转发了帖子] ${currentForwardData.title}`);
            
            // 3. 关闭面板并提示
            closeForwardSelector();
            alert('转发成功！');
            
            // 4. 刷新聊天界面，让卡片立刻渲染出来
            if (typeof currentChatContactId !== 'undefined' && currentChatContactId === contactId) {
                renderChatMessages(contactId);
                setTimeout(scrollToBottom, 100);
            }
        }

        // 3. 帖子详情页与神回复 (终极精修版)
        function openPostDetail(postElement) {
            // 拦截点击：如果当前有露出来的删除按钮，点击帖子不进入详情，而是让删除键弹回去
            if (activeForumSwipeItem) {
                activeForumSwipeItem.style.transform = 'translateX(0)';
                activeForumSwipeItem = null;
                return; 
            }

            const container = postElement.closest('.forum-post') || postElement;
            const detailContainer = document.getElementById('detail-post-container');
            const clone = container.cloneNode(true);
            
            // 清理点击事件防止嵌套
            clone.onclick = null;
            const innerDiv = clone.querySelector('div[onclick]');
            if (innerDiv) innerDiv.onclick = null;
            
            // 【修复3：去除多余的横线】强制清除边框和外边距残留
            clone.style.border = 'none';
            clone.style.margin = '0';
            clone.style.padding = '0';
            clone.style.boxShadow = 'none';
            
            // 【修复2：段落间距加大，重新排版】
            const contentEl = clone.querySelector('.post-content');
            if (contentEl) {
                contentEl.style.webkitLineClamp = 'unset';
                contentEl.style.display = 'block';
                contentEl.style.fontSize = '15px';
                
                // 核心排版魔法：将文本按照换行符拆分，用带有底部大间距的 div 重新包裹每一段
                const paragraphs = contentEl.innerText.split('\n').filter(p => p.trim() !== '');
                contentEl.innerHTML = paragraphs.map(p => `<div style="margin-bottom: 16px; line-height: 1.6; letter-spacing: 0.5px;">${p}</div>`).join('');
            }
            
            detailContainer.innerHTML = '';
            detailContainer.appendChild(clone);
            
            const commentsList = document.getElementById('detail-comments-list');
            commentsList.innerHTML = '';
            
            let postComments = [];
            const commentsData = container.getAttribute('data-comments');
            if (commentsData) {
                try { postComments = JSON.parse(decodeURIComponent(commentsData)); } 
                catch(e) { console.error("解析评论失败", e); }
            }
            
            // 兜底补齐评论
            if (postComments.length === 0) {
                const commentIcon = container.querySelector('.fa-comment');
                let defaultCount = 3;
                if (commentIcon && commentIcon.nextSibling) {
                    defaultCount = parseInt(commentIcon.nextSibling.textContent) || 3;
                }
                const limit = defaultCount > 20 ? 20 : defaultCount;
                for(let i = 0; i < limit; i++) {
                    postComments.push(["太牛了吧！", "前排吃瓜！", "蹲一个后续...", "我不信，除非发图！"][Math.floor(Math.random()*4)]);
                }
            }
            
            postComments.forEach((text, i) => {
                // 【修复4：智能去括号】用正则瞬间扒掉开头和结尾的 [ ] 或 【 】
                let cleanText = text.replace(/^[\[【]|[\]】]$/g, '').trim();
                
                commentsList.innerHTML += `
                    <div class="comment-item">
                        <div class="comment-avatar"><img src="https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}" width="100%"></div>
                        <div class="comment-content">
                            <div class="comment-name">吃瓜路人${String.fromCharCode(65 + (i % 26))}</div>
                            <div class="comment-text">${cleanText}</div>
                        </div>
                    </div>
                `;
            });
            
            openSubPage('scene-post-detail');
        }
        

        // 4. 重写全局下拉刷新机制，拦截发现页触发动态生成
        // 在你原有的 `initGlobalPullRefresh()` 函数中找到 `touchend` 事件，并按如下替换：
        /*
        tabPage.addEventListener('touchend', (e) => {
            if (!isPulling || activePullContainer !== tabPage) return;
            isPulling = false;
            
            if (pullDistance >= pullThreshold) {
                tabPage.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
                tabPage.style.transform = 'translateY(70px)';
                indicator.style.opacity = '1';
                
                // 🎯 拦截逻辑开始
                if (tabPage.id === 'tab-explore' && document.getElementById('exp-sec-1').classList.contains('active')) {
                    // 如果在论坛页下拉，不再刷新 HTML，而是触发写八卦！
                    generateNewGossipPost();
                    setTimeout(() => {
                        tabPage.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                        tabPage.style.transform = 'translateY(0)';
                        indicator.style.opacity = '0';
                    }, 1500);
                } else {
                    // 其他页面保持刷新整个文档
                    setTimeout(() => location.reload(), 1000);
                }
                // 🎯 拦截逻辑结束

            } else {
                tabPage.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                tabPage.style.transform = 'translateY(0)';
                indicator.style.opacity = '0';
                setTimeout(() => { tabPage.style.transition = ''; }, 300);
            }
            pullDistance = 0;
            activePullContainer = null;
        });
        */


        // --- 核心亮点：动态八卦生成系统 (强力改进版) ---
        async function generateNewGossipPost(forcedTopic = null) {
            console.log("🐾 [八卦系统] 正在启动...");
            
            const allowedContacts = mockContacts.filter(c => c.allowForum === true);
            let prompt = "";
            
            let rawCommentCount = Math.floor(Math.random() * 30) + 3;
            if (Math.random() < 0.15) rawCommentCount = Math.floor(Math.random() * 100) + 100;
            const displayCommentText = rawCommentCount > 99 ? "99+" : rawCommentCount;
            const generateCommentCount = Math.min(rawCommentCount, 20);
            
            // 增加字数限制与分段要求
            const commentInstruction = `\n【排版与字数要求】：
        1. 正文内容控制在 300 到 500 字左右，绝对不要超过 600 字！
        2. 正文必须自然分段排版（多使用换行符进行隔行），让视觉上有呼吸感，千万别挤成一坨。
        3. 请额外生成 ${generateCommentCount} 条网友对这个爆料的评论。每条评论占一行，格式必须严格为“评论：[评论内容]”。`;

            if (forcedTopic) {
                prompt = `你是一个在八卦论坛冲浪的网友。请围绕热搜词条“#${forcedTopic}”写一篇极具真实感、代入感的爆料、新闻或求助帖子。
        要求格式严格如下：
        标题：[填入吸睛标题]
        发帖人：[随机生成一个符合语境的网名]
        内容：[请写正文，极其真实接地气，多加细节]` + commentInstruction;
            } else if (allowedContacts.length === 0) {
                prompt = `你是一个喜欢在八卦论坛冲浪的匿名网友/狗仔。请编造一个极具真实感、非常抓人眼球的论坛帖子。
        请从以下主题中随机选择一个方向：
        1. 娱乐圈（如：恋情曝光、综艺录制内幕、明星争番位、剧组官方声明等）
        2. 真实新闻与生活（如：某产品发布会翻车、堵车自救指南等）
        （请务必真实、接地气，禁止写大妈抢卫生纸之类过于离谱搞笑的段子）

        要求格式严格如下：
        标题：[填入吸睛标题]
        发帖人：[随机生成一个符合语境的网名]
        内容：[请写正文，代入感强，多加细节]` + commentInstruction;
            } else {
                const randomContact = allowedContacts[Math.floor(Math.random() * allowedContacts.length)];
                const conversation = getConversation(randomContact.id);
                
                if (conversation.length < 3) {
                    prompt = `你是一个嗅觉敏锐的八卦大V。请用极其真实的口吻，爆料一个关于【${randomContact.name}】的圈内八卦（如恋情、新戏、定妆照等）。
        要求格式严格如下：
        标题：[填入吸睛标题]
        发帖人：[圈内爆料人网名]
        内容：[请写正文，细节丰富]` + commentInstruction;
                } else {
                    const recentChat = conversation.slice(-15).map(m => `${m.role === 'user' ? '某神秘人' : randomContact.name}：${m.content}`).join('\n');
                    prompt = `你是一个嗅觉极其敏锐的狗仔/八卦大V。请根据以下【某神秘人】与【${randomContact.name}】的绝密聊天记录，提取关键事件，用极具真实感、狗仔视角的语气，写一条爆料贴！
        注意：重点曝光【${randomContact.name}】的动态，对神秘人一笔带过，绝对不能暴露完整的聊天记录，要像道听途说一样去描述！

        聊天记录情报：
        ${recentChat}

        要求格式严格如下：
        标题：[填入惊呆众人的八卦标题]
        发帖人：[八卦大V网名]
        内容：[结合聊天记录进行真实化加工，写一篇吃瓜正文，要让人信以为真]` + commentInstruction;
                }
    
            }

            const discoverConfig = OTHER_API_CONFIGS.discover;
            let apiConfig = null;
            if (discoverConfig && discoverConfig.configId) {
                apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === discoverConfig.configId);
            }
            if (!apiConfig) {
                apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
            }
            
            if (!apiConfig) {
                alert("⚠️ 触发失败：请先去 API 配置 中设置你的大模型！");
                return;
            }

            try {
                let apiUrl = getStandardApiUrl(apiConfig.url, '/chat/completions');
                const modelToUse = (discoverConfig && discoverConfig.model) ? discoverConfig.model : apiConfig.model;
                
                const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: [{role: 'user', content: prompt}],
                        temperature: 0.9,
                        max_tokens: 1500
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    const aiContent = data.choices[0].message.content;
                    
                    // 🎯 【重点修复】：极其强壮的多行文本解析器
                    let title = "深夜爆大瓜！";
                    let content = "";
                    let author = "吃瓜路人";
                    let comments = [];
                    
                    let currentSection = "";
                    const lines = aiContent.split('\n');
                    
                    lines.forEach(line => {
                        let text = line.trim();
                        if(text.startsWith("标题：")) {
                            title = text.replace("标题：", "").trim();
                            currentSection = "title";
                        } else if (text.startsWith("发帖人：")) {
                            author = text.replace("发帖人：", "").trim();
                            currentSection = "author";
                        } else if (text.startsWith("内容：")) {
                            content += text.replace("内容：", "") + "\n";
                            currentSection = "content";
                        } else if (text.startsWith("评论：") || text.match(/^评论\d*：/)) {
                            let cmt = text.replace(/^评论\d*：/, "").trim();
                            if(cmt) comments.push(cmt);
                            currentSection = "comments";
                        } else if (text !== "") {
                            // 遇到普通行时，如果当前属于“内容区”，直接将其拼接到正文中
                            if(currentSection === "content") {
                                content += text + "\n";
                            }
                        }
                    });
                    content = content.trim() || "系统似乎开小差了，但这瓜绝对保熟！";
                    
                    // 兜底补齐评论
                    const fallbackComments = ["太牛了吧！", "前排吃瓜！", "蹲一个后续...", "啊啊啊土拨鼠尖叫！", "我不信，除非发图！"];
                    while(comments.length < generateCommentCount) {
                        comments.push(fallbackComments[Math.floor(Math.random() * fallbackComments.length)]);
                    }
                    comments = comments.slice(0, generateCommentCount);

                    // 🎯 将新帖子存入本地数组
                    const newPost = {
                        id: Date.now(),
                        title: title,
                        content: content,
                        author: author,
                        comments: comments,
                        time: "刚刚",
                        likes: Math.floor(Math.random() * 200 + 10),
                        commentCount: displayCommentText
                    };
                    
                    forumPostsData.unshift(newPost);
                    saveForumPosts(); // 存入本地储存
                    renderForumPosts(); // 重新渲染页面
                    
                    if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
                }
            } catch (e) {
                console.error("生成八卦报错:", e);
            }
        }

        // ==========================================
        // 发现页引擎：储存、渲染、滑动删除与热搜
        // ==========================================
        let forumPostsData = [];

        async function loadForumPosts() {
            let saved = localStorage.getItem('FORUM_POSTS');
            if (saved) {
                // 论坛数据搬家
                await DB.setItem('FORUM_POSTS', saved);
                localStorage.removeItem('FORUM_POSTS');
            } else {
                saved = await DB.getItem('FORUM_POSTS');
            }
            
            if (saved) {
                forumPostsData = JSON.parse(saved);
            } else {
                // 首次使用的欢迎引导贴
                forumPostsData = [{
                    id: Date.now(),
                    title: "欢迎来到专属八卦论坛！",
                    content: "下拉刷新即可根据你的聊天记录生成专属八卦！也可以点击上方的实时热搜，直接生成你想看的瓜。向左滑动这条帖子可以删除它哦~",
                    author: "系统管理员",
                    comments: ["快去下拉刷新试试！", "小爪印里还可以勾选哪些角色能上热搜呢！"],
                    time: "刚刚",
                    likes: "99+",
                    commentCount: 2
                }];
            }
            renderForumPosts();
            updateHotSearch(); // 每次加载时刷新一波热搜
        }

        async function saveForumPosts() {
            await DB.setItem('FORUM_POSTS', JSON.stringify(forumPostsData));
        }

        // 2. 渲染帖子列表与防遮挡绑定
        function renderForumPosts() {
            const container = document.getElementById('forum-feed-container');
            if (!container) return;
            container.innerHTML = '';
            
            forumPostsData.forEach((post, index) => {
                const safeTitle = post.title.replace(/'/g, "\\'");
                const safeContent = post.content.replace(/'/g, "\\'");
                const safeAuthor = post.author.replace(/'/g, "\\'");
                const safeComments = encodeURIComponent(JSON.stringify(post.comments));
                
                // 套上滑动容器
                const postHtml = `
                <div class="forum-item-wrapper" id="forum-post-${post.id}">
                    <div class="forum-item-actions">
                        <div class="forum-action-btn forum-action-delete" onclick="deleteForumPost(${index})">删除</div>
                    </div>
                    <div class="forum-post forum-item-swipeable" data-comments="${safeComments}">
                        <div onclick="openPostDetail(this)" style="cursor: pointer;">
                            <div class="post-header">
                                <div class="post-avatar" style="background: var(--hover-bg);"><img src="https://api.dicebear.com/7.x/bottts/svg?seed=${post.id}" style="width:100%; height:100%; border-radius:50%;"></div>
                                <div class="post-author">
                                    <div class="post-name">${post.author} ${index === 0 ? '<span style="font-size: 10px; background: var(--danger); color: white; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">新</span>' : ''}</div>
                                    <div class="post-time">${post.time}</div>
                                </div>
                            </div>
                            <div class="post-title">${post.title}</div>
                            <div class="post-content">${post.content}</div>
                        </div>
                        
                        <div class="post-actions" style="justify-content: space-between; padding: 12px 15% 0 15%; margin-top: 12px; border-top: 0.5px solid var(--border);">
                            <div class="post-action-btn" onclick="event.stopPropagation(); openForwardSelector(${post.id})">
                                <i class="fa-regular fa-share-from-square"></i> 转发
                            </div>
                            <div class="post-action-btn" onclick="event.stopPropagation();"><i class="far fa-comment"></i> ${post.commentCount}</div>
                            <div class="post-action-btn" onclick="event.stopPropagation(); toggleLikePost(${post.id}, this)">
                                <i class="${post.isLiked ? 'fas' : 'far'} fa-heart" style="color: ${post.isLiked ? 'var(--danger)' : 'inherit'}; transition: transform 0.2s cubic-bezier(0.17, 0.67, 0.83, 0.67);"></i> 
                                <span>${post.likes}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
                container.insertAdjacentHTML('beforeend', postHtml);
            });
            
            initForumSwipeEvents(); // 重新绑定滑动事件
        }

        // --- 点赞功能与动画 ---
        function toggleLikePost(postId, btnElement) {
            const post = forumPostsData.find(p => p.id === postId);
            if (!post) return;
            
            const icon = btnElement.querySelector('i');
            const span = btnElement.querySelector('span');
            
            if (post.isLiked) {
                // 取消点赞
                post.isLiked = false;
                post.likes = parseInt(post.likes) - 1;
                icon.className = 'far fa-heart';
                icon.style.color = 'inherit';
            } else {
                // 点赞 + 动画
                post.isLiked = true;
                post.likes = parseInt(post.likes) + 1;
                icon.className = 'fas fa-heart';
                icon.style.color = 'var(--danger)'; // 苹果红
                
                // 触发心跳缩放动画
                icon.style.transform = 'scale(1.4)';
                setTimeout(() => icon.style.transform = 'scale(1)', 200);
                
                // 震动反馈 (手机端)
                if (navigator.vibrate) navigator.vibrate(20);
            }
            span.innerText = post.likes;
            saveForumPosts(); // 存入本地，刷新不会丢
        }

        // 3. 左滑删除逻辑 (加入了严格的防手抖误触与滚动判断)
        let forumSwipeStartX = 0;
        let forumSwipeStartY = 0;
        let forumSwipeCurrentX = 0;
        let activeForumSwipeItem = null;

        function initForumSwipeEvents() {
            const wrappers = document.querySelectorAll('.forum-item-wrapper');
            wrappers.forEach(wrapper => {
                const swipeable = wrapper.querySelector('.forum-item-swipeable');
                if (!swipeable) return;
                
                let isScrolling = false;
                
                swipeable.addEventListener('touchstart', (e) => {
                    if (activeForumSwipeItem && activeForumSwipeItem !== swipeable) {
                        activeForumSwipeItem.style.transform = 'translateX(0)';
                        activeForumSwipeItem = null;
                    }
                    forumSwipeStartX = e.touches[0].clientX;
                    forumSwipeStartY = e.touches[0].clientY;
                    isForumSwipeDragging = false; // 新增状态变量
                }, { passive: true });

                swipeable.addEventListener('touchmove', (e) => {
                    if (!isForumSwipeDragging) {
                        const touchX = e.touches[0].clientX;
                        const touchY = e.touches[0].clientY;
                        const diffX = Math.abs(touchX - forumSwipeStartX);
                        const diffY = Math.abs(touchY - forumSwipeStartY);

                        if (diffX > 8 && diffX > diffY * 1.5) {
                            isForumSwipeDragging = true;
                            swipeable.classList.add('swiping');
                            window.isItemSwiping = true;
                        } else if (diffY > 8) {
                            return; // 竖滑放弃
                        } else {
                            return;
                        }
                    }

                    e.preventDefault();

                    const touchX = e.touches[0].clientX;
                    let deltaX = touchX - forumSwipeStartX;
                    if (deltaX > 0) deltaX = 0;
                    if (deltaX < -90) deltaX = -90 - ((-deltaX - 90) * 0.2);
                    swipeable.style.transform = `translateX(${deltaX}px)`;
                }, { passive: false });

                swipeable.addEventListener('touchend', (e) => {
                    if (!swipeable.classList.contains('swiping')) return;
                    swipeable.classList.remove('swiping');
                    window.isItemSwiping = false;

                    const deltaX = parseFloat(swipeable.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
                    if (deltaX < -35) {
                        swipeable.style.transform = 'translateX(-70px)';
                        activeForumSwipeItem = swipeable;
                    } else {
                        swipeable.style.transform = 'translateX(0)';
                        if (activeForumSwipeItem === swipeable) activeForumSwipeItem = null;
                    }
                });
            });
        }

        function deleteForumPost(index) {
            forumPostsData.splice(index, 1);
            saveForumPosts();
            renderForumPosts();
        }

        // 4. 动态真实热搜生成器
        function updateHotSearch() {
            const list = document.getElementById('forum-hot-list');
            if(!list) return;
            list.innerHTML = '';
            const hotSearchTopics = [
                "娱乐圈新恋情曝光", "某顶流争番位大戏", "综艺节目黑幕大瓜", 
                "史上最贵iPhone发布", "某明星生图美成BJD", "剧组深夜发严正声明", 
                "高速免费最后半小时自救指南", "大热剧女二演技大赏"
            ];
            // 随机打乱并取前4个
            const shuffled = hotSearchTopics.sort(() => 0.5 - Math.random()).slice(0, 4);
            shuffled.forEach(topic => {
                list.innerHTML += `<span class="hot-tag" style="cursor: pointer;" onclick="generateSpecificHotSearchPost('${topic}')"># ${topic}</span>`;
            });
        }

        // 点击热搜，强制请求 AI 生成该词条的长文
        async function generateSpecificHotSearchPost(topic) {
            const tabPage = document.getElementById('tab-explore');
            const indicator = document.getElementById('explore-refresh-indicator');
            
            // 触发顶部的加载动画
            tabPage.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)';
            tabPage.style.transform = 'translateY(60px)';
            indicator.style.opacity = '1';
            indicator.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 正在深挖这个瓜...';

            // 呼叫 AI（带上特定话题）
            await generateNewGossipPost(topic);

            // 回弹动画
            setTimeout(() => {
                tabPage.style.transform = 'translateY(0)';
                indicator.style.opacity = '0';
                setTimeout(() => { indicator.innerHTML = '<i class="fas fa-arrow-down"></i> 下拉刷新'; }, 300);
            }, 800);
        }

        // 在全局初始化时（DOMContentLoaded中）触发一次加载
        document.addEventListener('DOMContentLoaded', function() {
            loadForumPosts();
        });

        // 🎯 修复2专用：实时检测并追加时间戳的函数
        function checkAndAppendRealtimeTimestamp(container) {
            // 增加一个安全判断：如果没传 container，就自己去找聊天框
            if (!container) {
                container = document.getElementById('chat-messages-container');
            }
            if (!container) return; // 如果还是找不到，直接退出防报错
            
            let lastTimeStr = container.getAttribute('data-last-time');
            let lastTime = lastTimeStr ? parseInt(lastTimeStr) : 0;
            const nowTime = Date.now();
            
            if (nowTime - lastTime > 300000 || lastTime === 0) {
                const d = new Date(nowTime);
                const days = ['日', '一', '二', '三', '四', '五', '六'];
                const pad = n => n.toString().padStart(2, '0');
                const shortTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                const fullTime = `${d.getMonth() + 1}月${d.getDate()}日 星期${days[d.getDay()]} ${shortTime}`;
                
                const timeDiv = document.createElement('div');
                timeDiv.className = 'chat-timestamp';
                timeDiv.innerText = shortTime;
                timeDiv.style.transition = 'opacity 0.2s ease';
                timeDiv.onclick = function() {
                    this.style.opacity = '0';
                    setTimeout(() => {
                        this.innerText = this.innerText === shortTime ? fullTime : shortTime;
                        this.style.opacity = '1';
                    }, 200);
                };
                container.appendChild(timeDiv);
            }
            container.setAttribute('data-last-time', nowTime);
        }

        // ✅ 自动禁用所有输入框的 iOS 密码/自动填充提示
        document.addEventListener('DOMContentLoaded', () => {
            const inputs = document.querySelectorAll('input');
            inputs.forEach(input => {
                // 核心：告诉 iOS 不要自动填充
                input.setAttribute('autocomplete', 'off');
                // 额外：禁用自动纠错和首字母大写（对聊天/输入代码很有用）
                input.setAttribute('autocorrect', 'off');
                input.setAttribute('autocapitalize', 'off');
                input.setAttribute('spellcheck', 'false');
            });
        });

        // --- 新增：时长切换状态控制 ---
        let isTimeStatAverage = false; // 是否显示平均值
        let timeStatData = { total: 0, days: 1 }; // 缓存当前视图的时间数据

        // 获取一年中的第几天
        function getDayOfYear(date) {
            const start = new Date(date.getFullYear(), 0, 0);
            const diff = date - start;
            const oneDay = 1000 * 60 * 60 * 24;
            return Math.floor(diff / oneDay);
        }

        // 切换时长显示模式 (点击事件)
        function toggleTimeStat() {
            // 只有月和年视图支持切换，日视图只有当日时长
            if (currentHmRange === 'day') return;
            
            // 🌟 拦截：如果你点击了某一天，正在看“当日状态”，就不允许它切换成日均
            const lbl1 = document.getElementById('hm-lbl-1').textContent;
            if (lbl1 === "当日轮数") return;
            
            isTimeStatAverage = !isTimeStatAverage;
            updateTimeStatDisplay();
        }

        // 刷新时长显示文本
        function updateTimeStatDisplay() {
            const valEl = document.getElementById('hm-val-time');
            const lblEl = document.getElementById('hm-lbl-time');
            
            if (!valEl || !lblEl) return;

            if (currentHmRange === 'day') {
                // 日视图：强制显示今日总时长
                valEl.textContent = formatOnlineTime(timeStatData.total);
                lblEl.textContent = "今日时长";
                valEl.style.color = "var(--text-main)";
                return;
            }

            if (isTimeStatAverage) {
                // 显示日均
                const avg = timeStatData.days > 0 ? timeStatData.total / timeStatData.days : 0;
                valEl.textContent = formatOnlineTime(avg);
                lblEl.textContent = "日均时长";
                valEl.style.color = "var(--accent)"; // 用高亮色提示这是平均值
            } else {
                // 显示总和
                valEl.textContent = formatOnlineTime(timeStatData.total);
                lblEl.textContent = currentHmRange === 'month' ? "本月时长" : "本年时长";
                valEl.style.color = "var(--text-main)";
            }
        }

        // --- 🌟 高级体验：切回网页时，自动清理遗留的通知横幅 ---
        document.addEventListener('visibilitychange', async () => {
            // 只要系统检测到你回到了网页（页面状态变成 visible）
            if (document.visibilityState === 'visible') {
                try {
                    if ('serviceWorker' in navigator) {
                        const registration = await navigator.serviceWorker.ready;
                        // 找出那条固定标签的通知
                        const notifications = await registration.getNotifications({ tag: 'linkgo-active-reply' });
                        // 瞬间将它关闭（撤回）
                        notifications.forEach(n => n.close()); 
                    }
                } catch (e) {
                    console.error('清屏失败:', e);
                }
            }
        });

        // ==========================================
        // 🌟 主页 Apps 拖拽排序功能 (终极防下拉版)
        // ==========================================
        document.addEventListener('DOMContentLoaded', () => {
            const appGrid = document.querySelector('.app-grid');
            if (!appGrid) return;
            
            // 1. 读取本地保存的顺序
            const savedOrder = JSON.parse(localStorage.getItem('LINKGO_APPS_ORDER'));
            if (savedOrder && savedOrder.length > 0) {
                savedOrder.forEach(id => {
                    const appEl = appGrid.querySelector(`[data-id="${id}"]`);
                    if (appEl) {
                        appGrid.appendChild(appEl); // 按记忆的顺序重新排列
                    }
                });
            }

            // 2. 挂载 Sortable 拖拽引擎
            new Sortable(appGrid, {
                animation: 350, 
                easing: "cubic-bezier(0.25, 1, 0.5, 1)",
                delay: 200, 
                delayOnTouchOnly: true, 
                touchStartThreshold: 5, 
                
                // ✨ 终极防线 2：强制开启底层接管模式，把图标抽离出原本的滚动容器！
                forceFallback: true, 
                fallbackClass: "app-item-chosen", 
                ghostClass: 'app-item-ghost',
                chosenClass: 'app-item-chosen',
                fallbackOnBody: true, // 核心：拖拽时让元素临时挂在 body 上，彻底摆脱下拉刷新的干扰
                onEnd: function () {
                    // 拖拽松手时，保存新顺序
                    const newOrder = [];
                    appGrid.querySelectorAll('.clickable').forEach(el => {
                        if (el.dataset.id) newOrder.push(el.dataset.id);
                    });
                    localStorage.setItem('LINKGO_APPS_ORDER', JSON.stringify(newOrder));
                    
                    // 震动反馈
                    if (navigator.vibrate) navigator.vibrate(15);
                }
            });
        });

        // ==========================================
        // 🌟 任务站：全套核心引擎 (终极防误触版)
        // ==========================================

        let todoCurrentIndex = 1; 
        let activeFilterTag = null; 

        function switchTodoTab(index) {
            todoCurrentIndex = index;
            const tabs = document.querySelectorAll('#todo-tabs-container .todo-tab');
            tabs.forEach((tab, i) => {
                if (i === index) tab.classList.add('active');
                else tab.classList.remove('active');
            });
            const track = document.getElementById('todo-main-track');
            if (track) {
                track.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
                track.style.transform = `translateX(-${index * 33.3333}%)`;
            }
        }

        let todoStartX = 0, todoStartY = 0, todoCurrentX = 0, isTodoDragging = false;
        document.addEventListener('DOMContentLoaded', () => {
            switchTodoTab(1); 
            
            const todoTrack = document.getElementById('todo-main-track');
            if (!todoTrack) return;
            todoTrack.addEventListener('touchstart', (e) => {
            todoStartX = e.touches[0].clientX;
            
            // ✨ 新增修复：边缘右滑防误触（如果手指按下的位置距离左边缘小于 30px，直接放弃滑动接管，把控制权还给系统的边缘退出）
            if (todoStartX < 30) {
                isTodoDragging = false;
                return;
            }

            todoCurrentX = todoStartX; // ✨ 核心修复：每次碰到屏幕，立刻把记忆清零，绝不误判上一次的位置！
            todoStartY = e.touches[0].clientY;
            isTodoDragging = true;
            todoTrack.style.transition = 'none';
        }, { passive: true });
            
            todoTrack.addEventListener('touchmove', (e) => {
                if (!isTodoDragging) return;
                todoCurrentX = e.touches[0].clientX;
                const currentY = e.touches[0].clientY;
                const deltaX = todoCurrentX - todoStartX;
                const deltaY = currentY - todoStartY;
                
                // ✨ 终极防线：只要检测到手指是在“上下移动”而不是“左右移动”，立刻没收左右滑动权！绝对不再误判！
                if (Math.abs(deltaY) > Math.abs(deltaX)) {
                    isTodoDragging = false;
                    return;
                }

                if (Math.abs(deltaX) > 10) {
                    const percentMove = (deltaX / todoTrack.parentElement.clientWidth) * 33.3333;
                    todoTrack.style.transform = `translateX(${-todoCurrentIndex * 33.3333 + percentMove}%)`;
                }
            }, { passive: true });
            
            todoTrack.addEventListener('touchend', (e) => {
                if (!isTodoDragging) return;
                isTodoDragging = false;
                const deltaX = todoCurrentX - todoStartX;
                
                if (Math.abs(deltaX) < 10) {
                    todoTrack.style.transform = `translateX(${-todoCurrentIndex * 33.3333}%)`;
                    return;
                }

                if (deltaX < -50 && todoCurrentIndex < 2) todoCurrentIndex++;
                else if (deltaX > 50 && todoCurrentIndex > 0) todoCurrentIndex--;
                switchTodoTab(todoCurrentIndex);
            });
        });

        let todoList = JSON.parse(localStorage.getItem('LINKGO_TODO_DATA')) || [];
        function saveTodoData() {
            localStorage.setItem('LINKGO_TODO_DATA', JSON.stringify(todoList));
        }

        // ✨ 修复：从本地读取标签池，并新增保存函数
        let todoTagPool = JSON.parse(localStorage.getItem('LINKGO_TODO_TAGS')) || ['日常', '论文', '游戏'];
        function saveTodoTags() {
            localStorage.setItem('LINKGO_TODO_TAGS', JSON.stringify(todoTagPool));
        }
        let todoSelectedTags = new Set();

        // ✨ 过滤器菜单系统
        function openTodoFilterSheet() {
            let html = `<div onclick="setTodoFilter(null)" style="padding: 16px; text-align: center; font-size: 17px; color: ${activeFilterTag === null ? 'var(--accent)' : 'var(--text-main)'}; font-weight: ${activeFilterTag === null ? '600' : '500'}; border-bottom: 0.5px solid var(--border); cursor: pointer;">全部任务</div>`;
            todoTagPool.forEach(tag => {
                const isAct = activeFilterTag === tag;
                html += `<div onclick="setTodoFilter('${tag}')" style="padding: 16px; text-align: center; font-size: 17px; color: ${isAct ? 'var(--accent)' : 'var(--text-main)'}; font-weight: ${isAct ? '600' : '500'}; border-bottom: 0.5px solid var(--border); cursor: pointer;">${tag}</div>`;
            });
            document.getElementById('todo-filter-options').innerHTML = html;
            document.getElementById('todo-filter-overlay').classList.add('active');
            document.getElementById('todo-filter-sheet').style.transform = 'translateY(0)';
        }
        function closeTodoFilterSheet() {
            document.getElementById('todo-filter-overlay').classList.remove('active');
            document.getElementById('todo-filter-sheet').style.transform = 'translateY(100%)';
        }
        function setTodoFilter(tag) { 
            activeFilterTag = tag; 
            closeTodoFilterSheet();
            renderTodoList();
            const icon = document.getElementById('todo-filter-icon');
            if (icon) icon.style.color = tag ? 'var(--accent)' : 'var(--text-main)';
        }

        function renderTodoTags() {
            const container = document.getElementById('todo-tags-container');
            const inputWrapper = container.querySelector('.todo-tag-input-wrapper');

            // 1. 清空旧标签（保留输入框）
            Array.from(container.children).forEach(child => {
                if (!child.classList.contains('todo-tag-input-wrapper')) {
                    child.remove();
                }
            });

            // 🌟 全局防误触锁：判断当前到底是在拖拽还是在点击
            window.isTagDragging = false; 

            // 2. 生成新标签
            todoTagPool.forEach(tag => {
                const tagEl = document.createElement('div');
                tagEl.className = `todo-tag-pill ${todoSelectedTags.has(tag) ? 'selected' : ''}`;
                tagEl.dataset.tag = tag; 
                
                // 注意：这里把数据存在了图标上，确保点到图标时能抓到名字
                tagEl.innerHTML = `
                    <i class="fa-solid fa-xmark todo-tag-delete" data-tag="${tag}"></i>
                    <span>${tag}</span>
                `;
                
                // 🎯 极简原生点击：配合 Sortable 的 delay 属性完美工作
                tagEl.onclick = (e) => {
                    // 如果正在拖拽，就无视点击
                    if (window.isTagDragging) return; 
                    
                    // 哪怕点在 FontAwesome 生成的 SVG 内部线条上，也能精准识别
                    const deleteBtn = e.target.closest('.todo-tag-delete');
                    if (deleteBtn) {
                        deleteTodoTag(deleteBtn.dataset.tag);
                    } else {
                        toggleTodoTag(tag);
                    }
                };
                
                container.insertBefore(tagEl, inputWrapper);
            });

            // 🚀 3. 接入 SortableJS (化繁为简版)
            if (window.todoTagSortable) window.todoTagSortable.destroy(); 
            window.todoTagSortable = new Sortable(container, {
                animation: 350,           
                easing: "cubic-bezier(0.25, 1, 0.5, 1)", 
                delay: 200,               
                fallbackTolerance: 5,
                
                filter: '.todo-tag-input-wrapper', 
                preventOnFilter: false, 

                direction: 'horizontal', 
                swapThreshold: 1,        
                invertSwap: true,        

                forceFallback: true,
                fallbackClass: "todo-tag-chosen",
                ghostClass: 'todo-tag-ghost',      
                chosenClass: 'todo-tag-chosen',    
                
                onStart: function () {
                    // 抓起标签时，立刻锁死点击事件
                    window.isTagDragging = true; 
                },
                onEnd: function () {
                    // 松手后延迟 50 毫秒再解锁，完美防止拖拽结束瞬间触发点击！
                    setTimeout(() => { window.isTagDragging = false; }, 50);
                    
                    // 保存新顺序
                    const newPool = [];
                    container.querySelectorAll('.todo-tag-pill').forEach(el => {
                        if (el.dataset.tag) newPool.push(el.dataset.tag);
                    });
                    todoTagPool = newPool;
                    saveTodoTags(); // ✨ 新增：持久化保存拖拽后的新顺序
                }
            });
        }

        // --- 修复 1：删除标签逻辑 ---
        function deleteTodoTag(tag) {
            // 从标签池中过滤掉该标签
            todoTagPool = todoTagPool.filter(t => t !== tag);
            // 如果它目前是选中状态，也要从选中集合中移除
            todoSelectedTags.delete(tag);
            saveTodoTags();
            // 重新渲染视图
            renderTodoTags();
        }

        // --- 修复 2：选中和取消选中逻辑 ---
        function toggleTodoTag(tag) {
            // 如果已经被选中，则取消选中；否则添加选中
            if (todoSelectedTags.has(tag)) {
                todoSelectedTags.delete(tag);
            } else {
                todoSelectedTags.add(tag);
            }
            // 重新渲染视图
            renderTodoTags();
        }

        function processNewTag(newTag) {
            if (newTag && !todoTagPool.includes(newTag)) {
                todoTagPool.push(newTag); todoSelectedTags.add(newTag); 
                document.getElementById('todo-new-tag-input').value = ''; 
                saveTodoTags();
                renderTodoTags(); 
            }
        }
        function handleNewTagKeyPress(e) { if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) { e.preventDefault(); processNewTag(e.target.value.trim()); } }
        function handleNewTagBlur() { processNewTag(document.getElementById('todo-new-tag-input').value.trim()); }

        function openTodoSheet() {
            todoSelectedTags.clear(); renderTodoTags(); 
            delete document.getElementById('todo-bottom-sheet').dataset.editingId;
            const titleInput = document.getElementById('todo-input-title');
            titleInput.value = ''; titleInput.style.height = 'auto'; 
            // 如果在“今天”Tab（索引为1），自动填入今天日期，否则留空
            if (todoCurrentIndex === 1) {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                document.getElementById('todo-date-picker').value = `${yyyy}-${mm}-${dd}`;
            } else {
                document.getElementById('todo-date-picker').value = '';
            }
            
            // 新建任务时，隐藏左上角的删除按钮（设为 hidden 可以占据位置，保持“保存”按钮还在最右边）
            const topDelete = document.getElementById('todo-sheet-top-delete');
            if (topDelete) topDelete.style.visibility = 'hidden';
            document.getElementById('todo-subtasks-container').innerHTML = '';
            updateTodoDDL();

            // ✨ 加入这两行代码找回丝滑动画
            const sheet = document.getElementById('todo-bottom-sheet');
            sheet.offsetHeight; 

            document.getElementById('todo-sheet-overlay').classList.add('active');
            sheet.classList.add('active');
        }

        function closeTodoSheet() {
            document.getElementById('todo-sheet-overlay').classList.remove('active');
            document.getElementById('todo-bottom-sheet').classList.remove('active');
        }

        // ✨ 新增：带有回滚数据的取消操作
        function cancelTodoSheet() {
            if (window.originalTagPool) todoTagPool = [...window.originalTagPool];
            if (window.originalSelectedTags) todoSelectedTags = new Set(window.originalSelectedTags);
            saveTodoTags();
            renderTodoTags();
            closeTodoSheet();
        }

        function updateTodoDDL() {
            const dateVal = document.getElementById('todo-date-picker').value; const timeVal = document.getElementById('todo-time-picker').value;
            const dateText = document.getElementById('todo-ddl-date-text'); const timeText = document.getElementById('todo-ddl-time-text');
            if (dateVal) {
                const [y, m, d] = dateVal.split('-'); const today = new Date(); const selected = new Date(y, m - 1, d); 
                if (today.toDateString() === selected.toDateString()) dateText.textContent = "今天";
                else { const tom = new Date(today); tom.setDate(tom.getDate() + 1); dateText.textContent = tom.toDateString() === selected.toDateString() ? "明天" : `${m}月${d}日`; }
                dateText.parentElement.style.color = 'var(--accent)'; 
            } else { dateText.textContent = "日期"; dateText.parentElement.style.color = 'var(--text-main)'; }
            if (timeVal) { timeText.textContent = timeVal; timeText.parentElement.style.color = 'var(--accent)'; }
            else { timeText.textContent = "时间"; timeText.parentElement.style.color = 'var(--text-main)'; }
        }

        function addTodoSubtaskRow(text = '', completed = false, autoFocus = true) {
            const container = document.getElementById('todo-subtasks-container');
            const row = document.createElement('div');
            row.className = 'todo-subtask-item'; row.dataset.completed = completed;
            row.innerHTML = `<i class="${completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}" style="color:${completed ? 'var(--accent)' : 'var(--text-sub)'}; font-size:16px; margin-top:2px;" onclick="this.parentElement.dataset.completed = this.parentElement.dataset.completed === 'true' ? 'false' : 'true'; this.className = this.parentElement.dataset.completed === 'true' ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'; this.style.color = this.parentElement.dataset.completed === 'true' ? 'var(--accent)' : 'var(--text-sub)';"></i><input type="text" class="todo-subtask-input" placeholder="子任务内容..." value="${text}"><i class="fa-solid fa-xmark todo-subtask-delete" onclick="this.parentElement.remove()"></i>`;
            container.appendChild(row);
            
           // 获取输入框
            const input = row.querySelector('.todo-subtask-input');
            if (input) {
                // ✨ 新增：监听键盘按下事件
                input.addEventListener('keydown', (e) => {
                    // 如果按下的是回车键 (Enter)
                    if (e.key === 'Enter') {
                        e.preventDefault(); // 阻止原本的回车换行默认行为
                        // 自动添加一行新的空子任务，并且允许它自动聚焦（弹出键盘）
                        addTodoSubtaskRow('', false, true); 
                    }
                });

                // 根据开关决定是否自动聚焦
                if (autoFocus) input.focus();
            }
        }

        function toggleSubTaskStatus(taskId, subIdx) {
            const task = todoList.find(t => t.id === taskId);
            if (!task || !task.subTasks) return;
            task.subTasks[subIdx].completed = !task.subTasks[subIdx].completed;
            saveTodoData(); renderTodoList();
        }

        // ✨ 新增：子任务展开/收起开关逻辑 (丝滑动画版)
        function toggleSubtasks(taskId) {
            const task = todoList.find(t => t.id === taskId);
            if (!task) return;
            task.isExpanded = !task.isExpanded; // 切换状态
            saveTodoData();
            
            // 只做局部 DOM 更新，保留丝滑过渡动画，不触发全局重新渲染
            const wrapper = document.getElementById(`subtasks-wrapper-${taskId}`);
            const arrow = document.getElementById(`subtasks-arrow-${taskId}`);
            if (wrapper) wrapper.classList.toggle('expanded', task.isExpanded);
            if (arrow) arrow.style.transform = task.isExpanded ? 'rotate(180deg) translateZ(0)' : 'rotate(0deg) translateZ(0)';
        }

        function renderTodoList() {
            const pages = [document.getElementById('todo-page-0'), document.getElementById('todo-page-1'), document.getElementById('todo-page-2')];
            if (!pages[0]) return;
            pages.forEach(p => p.innerHTML = '');

            const filteredTasks = todoList.filter(task => {
                if (!activeFilterTag) return true;
                return task.tags && task.tags.includes(activeFilterTag);
            });

            filteredTasks.forEach(task => {
                let tagsHtml = task.tags.map(t => `<span class="todo-tag">${t}</span>`).join('');
                if (task.ddl_date || task.ddl_time) {
                    let ddlDisplay = '';
                    if (task.ddl_date) {
                        const [y, m, d] = task.ddl_date.split('-'); const today = new Date(); const selected = new Date(y, m - 1, d);
                        if (today.toDateString() === selected.toDateString()) ddlDisplay = "今天";
                        else { const tom = new Date(today); tom.setDate(tom.getDate() + 1); ddlDisplay = tom.toDateString() === selected.toDateString() ? "明天" : `${m}月${d}日`; }
                    }
                    if (task.ddl_time) ddlDisplay += (ddlDisplay ? ' ' : '') + task.ddl_time;
                    // ✨ 修复：把时间标签加在 tagsHtml 的最前面
                    tagsHtml = `<span class="todo-tag highlight"><i class="fa-regular fa-calendar"></i> ${ddlDisplay}</span>` + tagsHtml;
                }

                const titleStyle = task.status === 2 ? 'text-decoration: line-through; opacity: 0.5;' : '';
                const checkClass = task.status === 2 ? 'checked' : '';

                let subtasksHtml = '';
                let expandBtnHtml = '';
                
                if (task.subTasks && task.subTasks.length > 0) {
                    const completedCount = task.subTasks.filter(st => st.completed).length;
                    const totalCount = task.subTasks.length;

                    expandBtnHtml = `
                        <span class="todo-tag" style="cursor: pointer; background: transparent; border: 0.5px solid var(--border); color: var(--text-main);" 
                            onclick="event.stopPropagation(); toggleSubtasks(${task.id})" 
                            ontouchstart="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) p.style.setProperty('transform', 'none', 'important');" 
                            ontouchend="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) setTimeout(() => p.style.removeProperty('transform'), 150);" 
                            ontouchcancel="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) p.style.removeProperty('transform');" 
                            onmousedown="event.stopPropagation()" 
                            onpointerdown="event.stopPropagation()">
                            <i id="subtasks-arrow-${task.id}" class="fa-solid fa-chevron-down" style="transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1); transform-origin: center; backface-visibility: hidden; transform: ${task.isExpanded ? 'rotate(180deg) translateZ(0)' : 'translateZ(0)'};"></i>
                            ${completedCount}/${totalCount}
                        </span>
                    `;

                    // 不管是否展开，始终渲染子任务DOM，但用 class 控制高度隐藏/显示
                    let subListHtml = task.subTasks.map((st, idx) => `
                        <div style="display:flex; align-items:flex-start; gap:8px; padding: 4px 0;" onclick="event.stopPropagation(); toggleSubTaskStatus(${task.id}, ${idx})" ontouchstart="event.stopPropagation()">
                            <i class="${st.completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}" style="color: ${st.completed ? 'var(--accent)' : 'var(--text-sub)'}; font-size:15px; margin-top:2px;"></i>
                            <span style="flex:1; font-size:14px; color: ${st.completed ? 'var(--text-sub)' : 'var(--text-main)'}; text-decoration: ${st.completed ? 'line-through' : 'none'}; line-height:1.3;">${st.title}</span>
                        </div>
                    `).join('');

                    subtasksHtml = `
                        <div id="subtasks-wrapper-${task.id}" class="subtasks-grid-wrapper ${task.isExpanded ? 'expanded' : ''}">
                            <div class="subtasks-inner">
                                <div style="margin-top: ${(tagsHtml || expandBtnHtml) ? '6px' : '2px'}; margin-left: 30px; padding-top: 4px;">
                                    ${subListHtml}
                                </div>
                            </div>
                        </div>
                    `;
                }

                let targetPage = task.status;
                if (task.status === 0 && task.ddl_date) {
                    const [y, m, d] = task.ddl_date.split('-');
                    if (new Date().toDateString() === new Date(y, m - 1, d).toDateString()) targetPage = 1;
                }

                const tagsContainerHtml = (tagsHtml || expandBtnHtml) ? `<div class="todo-tags">${tagsHtml}${expandBtnHtml}</div>` : '';

                const cardHtml = `
                    <div class="todo-list-item" id="todo-item-${task.id}" onclick="activeTodoId = ${task.id}; editCurrentTodo();">
                        <div class="todo-header">
                            <div class="todo-checkbox-hitbox" onclick="event.stopPropagation(); toggleTodoStatus(${task.id})" ontouchstart="event.stopPropagation()">
                                <div class="todo-checkbox ${checkClass}"><i class="fa-solid fa-check" style="font-size: 11px;"></i></div>
                            </div>
                            <div style="flex:1; padding-top: 1px;">
                                <div class="todo-title" style="${titleStyle}">${task.title}</div>
                                ${tagsContainerHtml}
                            </div>
                        </div>
                        ${subtasksHtml}
                    </div>
                `;
                if (pages[targetPage]) pages[targetPage].insertAdjacentHTML('beforeend', cardHtml);
            });
            
            if (!pages[0].innerHTML) pages[0].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">没有待办任务，享受休息吧</div>';
            if (!pages[1].innerHTML) pages[1].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">今天很清闲，或者你可以从待办挑几个</div>';
            if (!pages[2].innerHTML) pages[2].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">完成的任务会沉淀在这里</div>';
        }

        function toggleTodoStatus(id) {
            const task = todoList.find(t => t.id === id);
            if (!task) return;
            const listItem = document.getElementById(`todo-item-${id}`);
            if (listItem) {
                // 1. 瞬间打勾，同时立即把底部分割线设为透明，彻底消除时间差！
                const checkbox = listItem.querySelector('.todo-checkbox');
                if (checkbox) checkbox.classList.toggle('checked');
                listItem.style.borderColor = 'transparent'; 
                
                // ✨ 修复：如果被勾选的是最后一项，立刻让它上一项的底部分割线也变透明，实现横线同时消失
                if (!listItem.nextElementSibling && listItem.previousElementSibling) {
                    listItem.previousElementSibling.style.borderColor = 'transparent';
                }

                // 2. 第一阶段：任务原位渐隐消失 (0.2秒)
                listItem.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                listItem.style.opacity = '0';
                listItem.style.transform = 'scale(0.95)';
                
                // 3. 第二阶段：等文字消失后，平滑收缩高度，让下方任务补位上滑 (0.25秒)
                setTimeout(() => {
                    listItem.style.height = listItem.offsetHeight + 'px'; 
                    listItem.style.overflow = 'hidden';
                    listItem.offsetHeight; // 强制重绘
                    
                    listItem.style.transition = 'all 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
                    listItem.style.height = '0px';
                    listItem.style.paddingTop = '0px';
                    listItem.style.paddingBottom = '0px';
                    listItem.style.marginTop = '0px';
                    listItem.style.marginBottom = '0px';
                }, 200);
                
                // 4. 等动画完全播完，再修改数据重新渲染
                setTimeout(() => {
                    task.status = (task.status === 2) ? 0 : 2; 
                    saveTodoData(); 
                    renderTodoList();
                }, 450);
            } else {
                task.status = (task.status === 2) ? 0 : 2; 
                saveTodoData(); 
                renderTodoList();
            }
        }

        function submitNewTodo() {
            const titleEl = document.getElementById('todo-input-title');
            const dateEl = document.getElementById('todo-date-picker');
            const timeEl = document.getElementById('todo-time-picker');
            const title = titleEl.value.trim();
            if (!title) { alert("任务内容不能为空哦！"); return; }

            const subTasks = Array.from(document.querySelectorAll('.todo-subtask-item')).map(row => {
                const input = row.querySelector('.todo-subtask-input');
                return {
                    title: input.value.trim(), 
                    completed: row.dataset.completed === 'true'
                };
            }).filter(st => st.title !== '');

            const editingId = document.getElementById('todo-bottom-sheet').dataset.editingId;

            if (editingId) {
                const task = todoList.find(t => t.id === parseInt(editingId));
                if (task) {
                    task.title = title; task.tags = Array.from(todoSelectedTags);
                    task.ddl_date = dateEl.value; task.ddl_time = timeEl.value; task.subTasks = subTasks; 
                }
                delete document.getElementById('todo-bottom-sheet').dataset.editingId;
            } else {
                todoList.unshift({
                    id: Date.now(), title: title, tags: Array.from(todoSelectedTags), 
                    ddl_date: dateEl.value, ddl_time: timeEl.value, subTasks: subTasks, status: 0
                }); 
            }

            saveTodoData(); renderTodoList(); 
            // 强制收起键盘
            if (document.activeElement) document.activeElement.blur();
            
            // 稍微等一下键盘滑下去的动画，然后再关闭抽屉，就不会卡住了
            setTimeout(() => {
                closeTodoSheet();
            }, 250);
        }

        function openTodoAction(taskId) {
            // 备份初始状态，用于取消时回滚
            window.originalTagPool = [...todoTagPool];
            window.originalSelectedTags = new Set(todoSelectedTags);
            activeTodoId = taskId;
            document.getElementById('todo-action-overlay').classList.add('active');
            document.getElementById('todo-action-sheet').style.transform = 'translateY(0)';
        }
        function closeTodoAction() { activeTodoId = null; document.getElementById('todo-action-overlay').classList.remove('active'); document.getElementById('todo-action-sheet').style.transform = 'translateY(100%)'; }

        document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { renderTodoList(); }, 200); });
        document.addEventListener('DOMContentLoaded', () => {
            const todoSheet = document.getElementById('todo-bottom-sheet');
            if (!todoSheet) return;

            todoSheet.addEventListener('focusin', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                    setTimeout(() => {
                        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                }
            });
        });

        // ==========================================
        // 抽屉拖拽拉伸逻辑 (赋予原生 App 质感)
        // ==========================================
        document.addEventListener('DOMContentLoaded', () => {
            const bottomSheet = document.getElementById('todo-bottom-sheet');
            const dragHandle = document.querySelector('.todo-sheet-handle');
            if (!bottomSheet || !dragHandle) return;

            let dragStartY = 0;
            let sheetStartHeight = 0;

            // 1. 手指按住小把手时
            dragHandle.addEventListener('touchstart', (e) => {
                dragStartY = e.touches[0].clientY;
                window.dragStartTime = Date.now(); // ✨ 记录起手时间，用于计算速度
                sheetStartHeight = bottomSheet.clientHeight;
                bottomSheet.style.transition = 'none'; 
            }, { passive: true });

            // 2. 手指向上/下拉动时
            dragHandle.addEventListener('touchmove', (e) => {
                const currentY = e.touches[0].clientY;
                const deltaY = dragStartY - currentY; 
                let newHeight = sheetStartHeight + deltaY;
                
                // ✨ 限制最高只能滑到 Tab 栏下方 (大概距离屏幕顶部 100px)
                const maxHeight = window.innerHeight - 100;
                if (newHeight > maxHeight) newHeight = maxHeight;
                
                bottomSheet.style.height = newHeight + 'px';
            }, { passive: true });

            // 3. 手指松开时
            dragHandle.addEventListener('touchend', (e) => {
                const currentY = e.changedTouches ? e.changedTouches[0].clientY : dragStartY;
                const deltaY = dragStartY - currentY;
                const dragTime = Date.now() - window.dragStartTime;
                const velocity = deltaY / dragTime;

                // 🚀 场景一：猛地向下拉 (速度很快) 或者 慢慢拉到底部 -> 关闭抽屉
                if (velocity < -0.8 || deltaY < -150) {
                    // ✨ 修复反弹：关闭时换成普通的平滑退出动画，绝对不使用弹簧！
                    bottomSheet.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), height 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
                    cancelTodoSheet(); 
                    
                    // ✨ 修复反弹：等抽屉彻底掉出屏幕后，先强行关闭动画，再悄悄恢复高度
                    setTimeout(() => {
                        bottomSheet.style.transition = 'none'; // 彻底关闭动画
                        bottomSheet.style.height = '65vh';     // 瞬间恢复高度，为下次打开做准备
                    }, 350);
                    return;
                }

                // ✨ 如果没关闭（弹回原位或者吸顶），才赋予它带有弹性的果冻动画
                const springAnim = 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1), transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
                bottomSheet.style.transition = springAnim;

                // 🚀 场景二：向上拉超过一点点 -> 吸附到最高处遮住所有任务
                if (deltaY > 20 || bottomSheet.clientHeight > window.innerHeight * 0.75) {
                    bottomSheet.style.height = 'calc(100vh - 100px)';
                } else {
                    // 🚀 场景三：没怎么动或者轻微向下拉 -> 恢复到默认 65vh 高度
                    bottomSheet.style.height = '65vh';
                }
            });
        });

        // 🗡️ 刺客指令：强行卸载以前所有的 Service Worker 缓存（不碰聊天数据）
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(function(registrations) {
                for(let registration of registrations) {
                    registration.unregister().then(function(boolean) {
                        console.log("✅ 成功清除旧版缓存管家！");
                    });
                }
            });
        }
