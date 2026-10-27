// ==========================================
// 互动视图 (Heatmap) 功能逻辑 + 时长统计
// ==========================================
let currentHmRange = 'day';
let currentViewDate = new Date(); 

window.changeHmMonth = function(delta) {
    currentViewDate.setMonth(currentViewDate.getMonth() + delta);
    switchHmRange('month', 1); 
};

let lastTimeRecord = Date.now();
setInterval(() => {
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        lastTimeRecord = Date.now();
    } else {
        saveToLocal(); 
    }
});

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
    isTimeStatAverage = false; 
    
    const highlight = document.getElementById('hm-segment-highlight');
    const btns = document.querySelectorAll('.segment-btn');
    if (highlight) highlight.style.transform = `translateX(${index * 100}%)`;
    btns.forEach((btn, i) => {
        if(i === index) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const timeBox = document.getElementById('hm-val-time').parentElement;
    if (timeBox) {
        timeBox.onclick = toggleTimeStat;
        timeBox.style.cursor = range === 'day' ? 'default' : 'pointer'; 
    }

    if (!APP_DATA.activityStats) APP_DATA.activityStats = {};
    const stats = APP_DATA.activityStats;
    const today = new Date();
    
    function getDateKey(dateObj) {
        return dateObj.toLocaleDateString('zh-CN').replace(/\//g, '-');
    }

    const todayStr = getDateKey(today);
    const targetDateKey = getDateKey(currentViewDate);
    const viewMonthPrefix = targetDateKey.split('-').slice(0, 2).join('-') + '-'; 
    const currentYearPrefix = todayStr.split('-')[0]; 
    
    let msgs = 0, activeDaysCount = 0, timeSecs = 0;
    let activeStreak = 0;   
    let isStreakAlive = true; 
    let maxStreak = 0;      
    let tempStreak = 0;     

    for (let i = 0; i < 1000; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const ds = getDateKey(d);
        const count = stats[ds] || 0;

        if (i === 0) {
            if (count > 0) { activeStreak++; tempStreak++; }
        } else {
            if (count > 0) {
                if (isStreakAlive) activeStreak++;
                tempStreak++;
            } else {
                isStreakAlive = false; 
                tempStreak = 0;
            }
        }
        if (tempStreak > maxStreak) maxStreak = tempStreak;
    }

    document.getElementById('hm-val-3').className = "stat-value";

    if (range === 'day') {
        msgs = stats[todayStr] || 0;
        timeSecs = stats[todayStr + '_time'] || 0;
        
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
        
        msgs = 0; timeSecs = 0; activeDaysCount = 0; 
        Object.keys(stats).forEach(key => {
            if (key.startsWith(viewMonthPrefix)) {
                if (key.endsWith('_time')) {
                    timeSecs += stats[key];
                } else if (key.includes('_')) {
                    let hour = parseInt(key.split('_')[1]);
                    if (hour >= 0 && hour <= 4) nightMsgs += stats[key];
                } else if (stats[key] > 0) { 
                    msgs += stats[key];
                    activeDaysCount++; 
                    if (stats[key] > maxDailyMsgs) maxDailyMsgs = stats[key];
                }
            }
        });

        timeStatData = { total: timeSecs, days: activeDaysCount || 1 };

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
                if (key.endsWith('_time')) timeSecs += stats[key];
                else if (!key.includes('_') && stats[key] > 0) {
                    msgs += stats[key];
                    activeDaysCount++; 
                }
            }
        });
        timeStatData = { total: timeSecs, days: activeDaysCount || 1 };
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
    const currentYearPrefix = todayStr.substring(0, 4); 

    const wrapperEl = document.getElementById('hm-scroll-wrapper');
    const titleEl = document.getElementById('hm-card-title');
    const legendEl = document.getElementById('hm-legend');
    const currentYearEl = document.getElementById('hm-current-year');
    if (currentYearEl) {
        currentYearEl.textContent = today.getFullYear() + '年';
        currentYearEl.style.color = "var(--text-sub)"; 
    }
    if (!wrapperEl) return;
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

        const container = document.createElement('div');
        container.className = 'hourly-chart-container';
        const chart = document.createElement('div');
        chart.className = 'hourly-chart';
        const labelsRow = document.createElement('div');
        labelsRow.className = 'hourly-labels';
        
        let maxCount = 0;
        for (let i = 0; i < 24; i++) {
            const c = stats[`${todayStr}_${i}`] || 0;
            if (c > maxCount) maxCount = c;
        }

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

            barWrap.onclick = (e) => {
                e.stopPropagation();
                if (barWrap.classList.contains('active')) {
                    barWrap.classList.remove('active');
                    chart.classList.remove('has-active'); 
                    currentYearEl.textContent = "点击图表查看时段"; 
                    return; 
                }
                chart.querySelectorAll('.hour-bar-wrapper').forEach(w => w.classList.remove('active'));
                chart.classList.add('has-active');
                barWrap.classList.add('active');
            
                if (count > 0 && hourDetails[i]) {
                    const sm = hourDetails[i].start.toString().padStart(2, '0');
                    const em = hourDetails[i].end.toString().padStart(2, '0');
                    currentYearEl.textContent = `${i}:${sm}-${i}:${em}`;
                } else {
                    currentYearEl.textContent = "暂无互动";
                }
            };
            chart.appendChild(barWrap);

            const lbl = document.createElement('div');
            lbl.className = 'hour-label-item';
            if (i % 6 === 0) lbl.textContent = i;
            else if (i === 23) lbl.textContent = '24';
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
                
                cell.onclick = () => {
                    const isAlreadySelected = cell.dataset.selected === 'true';
                    document.querySelectorAll('.month-day-cell').forEach(c => {
                        c.style.boxShadow = 'none'; 
                        c.style.border = '0.5px solid var(--border)'; 
                        c.style.transform = 'scale(1)'; 
                        c.style.zIndex = '1';
                        c.dataset.selected = 'false';
                    });

                    if (isAlreadySelected) {
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
                        cell.dataset.selected = 'true';
                        cell.style.border = '2px solid var(--text-main)'; 
                        cell.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)'; 
                        cell.style.zIndex = '10';
                        
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

        const slide3 = document.createElement('div');
        slide3.className = 'carousel-slide';
        const yearHourChart = document.createElement('div');
        yearHourChart.className = 'hourly-chart';
        
        let yearlyHourCounts = new Array(24).fill(0);
        let maxYearHour = 0;
        let peakHourIndex = 0;

        Object.keys(stats).forEach(k => {
            if(k.startsWith(currentYearPrefix) && k.includes('_') && !k.endsWith('_time')) {
                let h = parseInt(k.split('_')[1]);
                if (h >= 0 && h <= 23) {
                    yearlyHourCounts[h] += stats[k];
                    if(yearlyHourCounts[h] > maxYearHour) {
                        maxYearHour = yearlyHourCounts[h];
                        peakHourIndex = h; 
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

            if (i % 6 === 0 || i === 23) {
                const lbl = document.createElement('div');
                lbl.className = 'hour-label';
                lbl.textContent = i;
                barWrap.appendChild(lbl);
            }
            yearHourChart.appendChild(barWrap);
        }
        slide3.appendChild(yearHourChart);

        carousel.appendChild(slide1);
        carousel.appendChild(slide2);
        carousel.appendChild(slide3); 
        wrapperEl.appendChild(carousel);

        const dotsWrap = document.createElement('div');
        dotsWrap.className = 'carousel-dots';
        const dot1 = document.createElement('div'); dot1.className = 'hm-dot active';
        const dot2 = document.createElement('div'); dot2.className = 'hm-dot';
        const dot3 = document.createElement('div'); dot3.className = 'hm-dot'; 
        dotsWrap.appendChild(dot1);
        dotsWrap.appendChild(dot2);
        dotsWrap.appendChild(dot3);
        wrapperEl.appendChild(dotsWrap);

        carousel.addEventListener('scroll', () => {
            let index = Math.round(carousel.scrollLeft / carousel.offsetWidth);
            dot1.className = index === 0 ? 'hm-dot active' : 'hm-dot';
            dot2.className = index === 1 ? 'hm-dot active' : 'hm-dot';
            dot3.className = index === 2 ? 'hm-dot active' : 'hm-dot';
            
            if (index === 0) titleEl.textContent = "近半年的足迹";
            else if (index === 1) titleEl.textContent = "年度活跃月份";
            else if (index === 2) titleEl.textContent = maxYearHour > 0 ? `${peakHourIndex}:00 是你们最常相聚的时刻` : "全年活跃时段";
        });
    }
}

function generateInsights() {
    if (!APP_DATA.activityStats) return;
    const stats = APP_DATA.activityStats;
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

function toggleTimeStat() {
    if (currentHmRange === 'day') return;
    const lbl1 = document.getElementById('hm-lbl-1').textContent;
    if (lbl1 === "当日轮数") return;
    isTimeStatAverage = !isTimeStatAverage;
    updateTimeStatDisplay();
}

function updateTimeStatDisplay() {
    const valEl = document.getElementById('hm-val-time');
    const lblEl = document.getElementById('hm-lbl-time');
    if (!valEl || !lblEl) return;

    if (currentHmRange === 'day') {
        valEl.textContent = formatOnlineTime(timeStatData.total);
        lblEl.textContent = "今日时长";
        valEl.style.color = "var(--text-main)";
        return;
    }

    if (isTimeStatAverage) {
        const avg = timeStatData.days > 0 ? timeStatData.total / timeStatData.days : 0;
        valEl.textContent = formatOnlineTime(avg);
        lblEl.textContent = "日均时长";
        valEl.style.color = "var(--accent)"; 
    } else {
        valEl.textContent = formatOnlineTime(timeStatData.total);
        lblEl.textContent = currentHmRange === 'month' ? "本月时长" : "本年时长";
        valEl.style.color = "var(--text-main)";
    }
}

// ==========================================
// 发现页 UI 交互逻辑 (角色筛选、转发、帖子详情)
// ==========================================
function openForumRoleFilter() {
    const listContainer = document.getElementById('role-filter-list');
    listContainer.innerHTML = '';
    mockContacts.forEach(contact => {
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
        saveToLocal(); 
        const checkbox = element.querySelector('.ios-checkbox');
        checkbox.classList.toggle('checked');
    }
}

function closeForumRoleFilter() { document.getElementById('role-filter-sheet').classList.remove('show'); }

let currentForwardData = null;
function openForwardSelector(postId) {
    const post = forumPostsData.find(p => p.id === postId); if (!post) return;
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
    const aiMessageText = `【论坛分享】\n标题：${currentForwardData.title}\n内容：${currentForwardData.content}\n发帖人：${currentForwardData.author}\n(我向你分享了这个论坛八卦帖子)`;
    addMessage(contactId, 'user', aiMessageText);
    updateChatListLastMessage(contactId, `[转发了帖子] ${currentForwardData.title}`);
    closeForwardSelector();
    alert('转发成功！');
    if (typeof currentChatContactId !== 'undefined' && currentChatContactId === contactId) {
        renderChatMessages(contactId);
        setTimeout(scrollToBottom, 100);
    }
}

function openPostDetail(postElement) {
    if (activeForumSwipeItem) {
        activeForumSwipeItem.style.transform = 'translateX(0)';
        activeForumSwipeItem = null;
        return; 
    }
    const container = postElement.closest('.forum-post') || postElement;
    const detailContainer = document.getElementById('detail-post-container');
    const clone = container.cloneNode(true);
    
    clone.onclick = null;
    const innerDiv = clone.querySelector('div[onclick]');
    if (innerDiv) innerDiv.onclick = null;
    
    clone.style.border = 'none';
    clone.style.margin = '0';
    clone.style.padding = '0';
    clone.style.boxShadow = 'none';
    
    const contentEl = clone.querySelector('.post-content');
    if (contentEl) {
        contentEl.style.webkitLineClamp = 'unset';
        contentEl.style.display = 'block';
        contentEl.style.fontSize = '15px';
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
        try { postComments = JSON.parse(decodeURIComponent(commentsData)); } catch(e) { console.error("解析评论失败", e); }
    }
    
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

async function generateNewGossipPost(forcedTopic = null) {
    const allowedContacts = mockContacts.filter(c => c.allowForum === true);
    let prompt = "";
    let rawCommentCount = Math.floor(Math.random() * 30) + 3;
    if (Math.random() < 0.15) rawCommentCount = Math.floor(Math.random() * 100) + 100;
    const displayCommentText = rawCommentCount > 99 ? "99+" : rawCommentCount;
    const generateCommentCount = Math.min(rawCommentCount, 20);
    
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
    if (discoverConfig && discoverConfig.configId) apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === discoverConfig.configId);
    if (!apiConfig) apiConfig = CHAT_API_CONFIGS.list.find(c => c.id === CHAT_API_CONFIGS.currentId);
    if (!apiConfig) { alert("⚠️ 触发失败：请先去 API 配置 中设置你的大模型！"); return; }

    try {
        let apiUrl = getStandardApiUrl(apiConfig.url, '/chat/completions');
        const modelToUse = (discoverConfig && discoverConfig.model) ? discoverConfig.model : apiConfig.model;
        const response = await fetch('https://linkgo-api.ginkgo-yinxing.workers.dev/', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelToUse, messages: [{role: 'user', content: prompt}], temperature: 0.9, max_tokens: 1500 })
        });
        if (response.ok) {
            const data = await response.json();
            const aiContent = data.choices[0].message.content;
            
            let title = "深夜爆大瓜！", content = "", author = "吃瓜路人", comments = [];
            let currentSection = "";
            const lines = aiContent.split('\n');
            
            lines.forEach(line => {
                let text = line.trim();
                if(text.startsWith("标题：")) { title = text.replace("标题：", "").trim(); currentSection = "title"; } 
                else if (text.startsWith("发帖人：")) { author = text.replace("发帖人：", "").trim(); currentSection = "author"; } 
                else if (text.startsWith("内容：")) { content += text.replace("内容：", "") + "\n"; currentSection = "content"; } 
                else if (text.startsWith("评论：") || text.match(/^评论\d*：/)) { let cmt = text.replace(/^评论\d*：/, "").trim(); if(cmt) comments.push(cmt); currentSection = "comments"; } 
                else if (text !== "") { if(currentSection === "content") content += text + "\n"; }
            });
            content = content.trim() || "系统似乎开小差了，但这瓜绝对保熟！";
            
            const fallbackComments = ["太牛了吧！", "前排吃瓜！", "蹲一个后续...", "啊啊啊土拨鼠尖叫！", "我不信，除非发图！"];
            while(comments.length < generateCommentCount) comments.push(fallbackComments[Math.floor(Math.random() * fallbackComments.length)]);
            comments = comments.slice(0, generateCommentCount);

            const newPost = { id: Date.now(), title, content, author, comments, time: "刚刚", likes: Math.floor(Math.random() * 200 + 10), commentCount: displayCommentText };
            forumPostsData.unshift(newPost);
            saveForumPosts(); 
            renderForumPosts(); 
            if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        }
    } catch (e) { console.error("生成八卦报错:", e); }
}

let forumPostsData = [];
async function loadForumPosts() {
    let saved = localStorage.getItem('FORUM_POSTS');
    if (saved) { await DB.setItem('FORUM_POSTS', saved); localStorage.removeItem('FORUM_POSTS'); } else { saved = await DB.getItem('FORUM_POSTS'); }
    
    if (saved) { forumPostsData = JSON.parse(saved); } 
    else {
        forumPostsData = [{ id: Date.now(), title: "欢迎来到专属八卦论坛！", content: "下拉刷新即可根据你的聊天记录生成专属八卦！也可以点击上方的实时热搜，直接生成你想看的瓜。向左滑动这条帖子可以删除它哦~", author: "系统管理员", comments: ["快去下拉刷新试试！", "小爪印里还可以勾选哪些角色能上热搜呢！"], time: "刚刚", likes: "99+", commentCount: 2 }];
    }
    renderForumPosts(); updateHotSearch(); 
}

async function saveForumPosts() { await DB.setItem('FORUM_POSTS', JSON.stringify(forumPostsData)); }

function renderForumPosts() {
    const container = document.getElementById('forum-feed-container'); if (!container) return;
    container.innerHTML = '';
    forumPostsData.forEach((post, index) => {
        const safeComments = encodeURIComponent(JSON.stringify(post.comments));
        const postHtml = `
        <div class="forum-item-wrapper" id="forum-post-${post.id}">
            <div class="forum-item-actions"><div class="forum-action-btn forum-action-delete" onclick="deleteForumPost(${index})">删除</div></div>
            <div class="forum-post forum-item-swipeable" data-comments="${safeComments}">
                <div onclick="openPostDetail(this)" style="cursor: pointer;">
                    <div class="post-header">
                        <div class="post-avatar" style="background: var(--hover-bg);"><img src="https://api.dicebear.com/7.x/bottts/svg?seed=${post.id}" style="width:100%; height:100%; border-radius:50%;"></div>
                        <div class="post-author"><div class="post-name">${post.author} ${index === 0 ? '<span style="font-size: 10px; background: var(--danger); color: white; padding: 2px 6px; border-radius: 4px; margin-left: 4px;">新</span>' : ''}</div><div class="post-time">${post.time}</div></div>
                    </div>
                    <div class="post-title">${post.title}</div>
                    <div class="post-content">${post.content}</div>
                </div>
                <div class="post-actions" style="justify-content: space-between; padding: 12px 15% 0 15%; margin-top: 12px; border-top: 0.5px solid var(--border);">
                    <div class="post-action-btn" onclick="event.stopPropagation(); openForwardSelector(${post.id})"><i class="fa-regular fa-share-from-square"></i> 转发</div>
                    <div class="post-action-btn" onclick="event.stopPropagation();"><i class="far fa-comment"></i> ${post.commentCount}</div>
                    <div class="post-action-btn" onclick="event.stopPropagation(); toggleLikePost(${post.id}, this)"><i class="${post.isLiked ? 'fas' : 'far'} fa-heart" style="color: ${post.isLiked ? 'var(--danger)' : 'inherit'}; transition: transform 0.2s cubic-bezier(0.17, 0.67, 0.83, 0.67);"></i> <span>${post.likes}</span></div>
                </div>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', postHtml);
    });
    initForumSwipeEvents(); 
}

function toggleLikePost(postId, btnElement) {
    const post = forumPostsData.find(p => p.id === postId); if (!post) return;
    const icon = btnElement.querySelector('i'), span = btnElement.querySelector('span');
    if (post.isLiked) {
        post.isLiked = false; post.likes = parseInt(post.likes) - 1; icon.className = 'far fa-heart'; icon.style.color = 'inherit';
    } else {
        post.isLiked = true; post.likes = parseInt(post.likes) + 1; icon.className = 'fas fa-heart'; icon.style.color = 'var(--danger)';
        icon.style.transform = 'scale(1.4)'; setTimeout(() => icon.style.transform = 'scale(1)', 200);
        if (navigator.vibrate) navigator.vibrate(20);
    }
    span.innerText = post.likes; saveForumPosts(); 
}

let forumSwipeStartX = 0, forumSwipeStartY = 0, forumSwipeCurrentX = 0, activeForumSwipeItem = null;
function initForumSwipeEvents() {
    const wrappers = document.querySelectorAll('.forum-item-wrapper');
    wrappers.forEach(wrapper => {
        const swipeable = wrapper.querySelector('.forum-item-swipeable'); if (!swipeable) return;
        let isScrolling = false;
        swipeable.addEventListener('touchstart', (e) => {
            if (activeForumSwipeItem && activeForumSwipeItem !== swipeable) { activeForumSwipeItem.style.transform = 'translateX(0)'; activeForumSwipeItem = null; }
            forumSwipeStartX = e.touches[0].clientX; forumSwipeStartY = e.touches[0].clientY; isForumSwipeDragging = false;
        }, { passive: true });
        swipeable.addEventListener('touchmove', (e) => {
            if (!isForumSwipeDragging) {
                const touchX = e.touches[0].clientX, touchY = e.touches[0].clientY;
                const diffX = Math.abs(touchX - forumSwipeStartX), diffY = Math.abs(touchY - forumSwipeStartY);
                if (diffX > 8 && diffX > diffY * 1.5) { isForumSwipeDragging = true; swipeable.classList.add('swiping'); window.isItemSwiping = true; } 
                else if (diffY > 8) return; else return;
            }
            e.preventDefault();
            const touchX = e.touches[0].clientX; let deltaX = touchX - forumSwipeStartX;
            if (deltaX > 0) deltaX = 0;
            if (deltaX < -90) deltaX = -90 - ((-deltaX - 90) * 0.2);
            swipeable.style.transform = `translateX(${deltaX}px)`;
        }, { passive: false });
        swipeable.addEventListener('touchend', (e) => {
            if (!swipeable.classList.contains('swiping')) return;
            swipeable.classList.remove('swiping'); window.isItemSwiping = false;
            const deltaX = parseFloat(swipeable.style.transform.replace('translateX(', '').replace('px)', '')) || 0;
            if (deltaX < -35) { swipeable.style.transform = 'translateX(-70px)'; activeForumSwipeItem = swipeable; } 
            else { swipeable.style.transform = 'translateX(0)'; if (activeForumSwipeItem === swipeable) activeForumSwipeItem = null; }
        });
    });
}

function deleteForumPost(index) { forumPostsData.splice(index, 1); saveForumPosts(); renderForumPosts(); }

function updateHotSearch() {
    const list = document.getElementById('forum-hot-list'); if(!list) return;
    list.innerHTML = '';
    const hotSearchTopics = ["娱乐圈新恋情曝光", "某顶流争番位大戏", "综艺节目黑幕大瓜", "史上最贵iPhone发布", "某明星生图美成BJD", "剧组深夜发严正声明", "高速免费最后半小时自救指南", "大热剧女二演技大赏"];
    const shuffled = hotSearchTopics.sort(() => 0.5 - Math.random()).slice(0, 4);
    shuffled.forEach(topic => { list.innerHTML += `<span class="hot-tag" style="cursor: pointer;" onclick="generateSpecificHotSearchPost('${topic}')"># ${topic}</span>`; });
}

async function generateSpecificHotSearchPost(topic) {
    const tabPage = document.getElementById('tab-explore'), indicator = document.getElementById('explore-refresh-indicator');
    if(tabPage) { tabPage.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)'; tabPage.style.transform = 'translateY(60px)'; }
    if(indicator) { indicator.style.opacity = '1'; indicator.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 正在深挖这个瓜...'; }
    await generateNewGossipPost(topic);
    setTimeout(() => {
        if(tabPage) tabPage.style.transform = 'translateY(0)';
        if(indicator) { indicator.style.opacity = '0'; setTimeout(() => { indicator.innerHTML = '<i class="fas fa-arrow-down"></i> 下拉刷新'; }, 300); }
    }, 800);
}

document.addEventListener('DOMContentLoaded', function() { loadForumPosts(); });

// ==========================================
// 任务站 (To-Do App) 全套核心引擎
// ==========================================
let todoCurrentIndex = 1; 
let activeFilterTag = null; 

function switchTodoTab(index) {
    todoCurrentIndex = index;
    const tabs = document.querySelectorAll('#todo-tabs-container .todo-tab');
    tabs.forEach((tab, i) => { if (i === index) tab.classList.add('active'); else tab.classList.remove('active'); });
    const track = document.getElementById('todo-main-track');
    if (track) { track.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)'; track.style.transform = `translateX(-${index * 33.3333}%)`; }
}

let todoStartX = 0, todoStartY = 0, todoCurrentX = 0, isTodoDragging = false;
document.addEventListener('DOMContentLoaded', () => {
    switchTodoTab(1); 
    const todoTrack = document.getElementById('todo-main-track'); if (!todoTrack) return;
    todoTrack.addEventListener('touchstart', (e) => {
        todoStartX = e.touches[0].clientX;
        if (todoStartX < 30) { isTodoDragging = false; return; }
        todoCurrentX = todoStartX; todoStartY = e.touches[0].clientY; isTodoDragging = true; todoTrack.style.transition = 'none';
    }, { passive: true });
    todoTrack.addEventListener('touchmove', (e) => {
        if (!isTodoDragging) return;
        todoCurrentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY, deltaX = todoCurrentX - todoStartX, deltaY = currentY - todoStartY;
        if (Math.abs(deltaY) > Math.abs(deltaX)) { isTodoDragging = false; return; }
        if (Math.abs(deltaX) > 10) {
            const percentMove = (deltaX / todoTrack.parentElement.clientWidth) * 33.3333;
            todoTrack.style.transform = `translateX(${-todoCurrentIndex * 33.3333 + percentMove}%)`;
        }
    }, { passive: true });
    todoTrack.addEventListener('touchend', (e) => {
        if (!isTodoDragging) return; isTodoDragging = false;
        const deltaX = todoCurrentX - todoStartX;
        if (Math.abs(deltaX) < 10) { todoTrack.style.transform = `translateX(${-todoCurrentIndex * 33.3333}%)`; return; }
        if (deltaX < -50 && todoCurrentIndex < 2) todoCurrentIndex++; else if (deltaX > 50 && todoCurrentIndex > 0) todoCurrentIndex--;
        switchTodoTab(todoCurrentIndex);
    });
});

let todoList = JSON.parse(localStorage.getItem('LINKGO_TODO_DATA')) || [];
function saveTodoData() { localStorage.setItem('LINKGO_TODO_DATA', JSON.stringify(todoList)); }
let todoTagPool = JSON.parse(localStorage.getItem('LINKGO_TODO_TAGS')) || ['日常', '论文', '游戏'];
function saveTodoTags() { localStorage.setItem('LINKGO_TODO_TAGS', JSON.stringify(todoTagPool)); }
let todoSelectedTags = new Set();

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
function closeTodoFilterSheet() { document.getElementById('todo-filter-overlay').classList.remove('active'); document.getElementById('todo-filter-sheet').style.transform = 'translateY(100%)'; }
function setTodoFilter(tag) { activeFilterTag = tag; closeTodoFilterSheet(); renderTodoList(); const icon = document.getElementById('todo-filter-icon'); if (icon) icon.style.color = tag ? 'var(--accent)' : 'var(--text-main)'; }

function renderTodoTags() {
    const container = document.getElementById('todo-tags-container');
    const inputWrapper = container.querySelector('.todo-tag-input-wrapper');
    if (!container || !inputWrapper) return;
    Array.from(container.children).forEach(child => { if (!child.classList.contains('todo-tag-input-wrapper')) child.remove(); });
    window.isTagDragging = false; 
    todoTagPool.forEach(tag => {
        const tagEl = document.createElement('div');
        tagEl.className = `todo-tag-pill ${todoSelectedTags.has(tag) ? 'selected' : ''}`;
        tagEl.dataset.tag = tag; 
        tagEl.innerHTML = `<i class="fa-solid fa-xmark todo-tag-delete" data-tag="${tag}"></i><span>${tag}</span>`;
        tagEl.onclick = (e) => {
            if (window.isTagDragging) return; 
            const deleteBtn = e.target.closest('.todo-tag-delete');
            if (deleteBtn) deleteTodoTag(deleteBtn.dataset.tag); else toggleTodoTag(tag);
        };
        container.insertBefore(tagEl, inputWrapper);
    });
    if (window.todoTagSortable) window.todoTagSortable.destroy(); 
    if (typeof Sortable !== 'undefined') {
        window.todoTagSortable = new Sortable(container, {
            animation: 350, easing: "cubic-bezier(0.25, 1, 0.5, 1)", delay: 200, fallbackTolerance: 5,
            filter: '.todo-tag-input-wrapper', preventOnFilter: false, direction: 'horizontal', swapThreshold: 1, invertSwap: true,
            forceFallback: true, fallbackClass: "todo-tag-chosen", ghostClass: 'todo-tag-ghost', chosenClass: 'todo-tag-chosen',    
            onStart: function () { window.isTagDragging = true; },
            onEnd: function () {
                setTimeout(() => { window.isTagDragging = false; }, 50);
                const newPool = []; container.querySelectorAll('.todo-tag-pill').forEach(el => { if (el.dataset.tag) newPool.push(el.dataset.tag); });
                todoTagPool = newPool; saveTodoTags(); 
            }
        });
    }
}

function deleteTodoTag(tag) { todoTagPool = todoTagPool.filter(t => t !== tag); todoSelectedTags.delete(tag); saveTodoTags(); renderTodoTags(); }
function toggleTodoTag(tag) { if (todoSelectedTags.has(tag)) todoSelectedTags.delete(tag); else todoSelectedTags.add(tag); renderTodoTags(); }
function processNewTag(newTag) { if (newTag && !todoTagPool.includes(newTag)) { todoTagPool.push(newTag); todoSelectedTags.add(newTag); document.getElementById('todo-new-tag-input').value = ''; saveTodoTags(); renderTodoTags(); } }
function handleNewTagKeyPress(e) { if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) { e.preventDefault(); processNewTag(e.target.value.trim()); } }
function handleNewTagBlur() { processNewTag(document.getElementById('todo-new-tag-input').value.trim()); }

function openTodoSheet() {
    todoSelectedTags.clear(); renderTodoTags(); 
    delete document.getElementById('todo-bottom-sheet').dataset.editingId;
    const titleInput = document.getElementById('todo-input-title');
    titleInput.value = ''; titleInput.style.height = 'auto'; 
    if (todoCurrentIndex === 1) {
        const today = new Date(), yyyy = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, '0'), dd = String(today.getDate()).padStart(2, '0');
        document.getElementById('todo-date-picker').value = `${yyyy}-${mm}-${dd}`;
    } else document.getElementById('todo-date-picker').value = '';
    const topDelete = document.getElementById('todo-sheet-top-delete'); if (topDelete) topDelete.style.visibility = 'hidden';
    document.getElementById('todo-subtasks-container').innerHTML = '';
    updateTodoDDL();
    const sheet = document.getElementById('todo-bottom-sheet'); sheet.offsetHeight; 
    document.getElementById('todo-sheet-overlay').classList.add('active'); sheet.classList.add('active');
}

function closeTodoSheet() { document.getElementById('todo-sheet-overlay').classList.remove('active'); document.getElementById('todo-bottom-sheet').classList.remove('active'); }
function cancelTodoSheet() { if (window.originalTagPool) todoTagPool = [...window.originalTagPool]; if (window.originalSelectedTags) todoSelectedTags = new Set(window.originalSelectedTags); saveTodoTags(); renderTodoTags(); closeTodoSheet(); }

function updateTodoDDL() {
    const dateVal = document.getElementById('todo-date-picker').value, timeVal = document.getElementById('todo-time-picker').value;
    const dateText = document.getElementById('todo-ddl-date-text'), timeText = document.getElementById('todo-ddl-time-text');
    if (dateVal) {
        const [y, m, d] = dateVal.split('-'), today = new Date(), selected = new Date(y, m - 1, d); 
        if (today.toDateString() === selected.toDateString()) dateText.textContent = "今天";
        else { const tom = new Date(today); tom.setDate(tom.getDate() + 1); dateText.textContent = tom.toDateString() === selected.toDateString() ? "明天" : `${m}月${d}日`; }
        dateText.parentElement.style.color = 'var(--accent)'; 
    } else { dateText.textContent = "日期"; dateText.parentElement.style.color = 'var(--text-main)'; }
    if (timeVal) { timeText.textContent = timeVal; timeText.parentElement.style.color = 'var(--accent)'; } else { timeText.textContent = "时间"; timeText.parentElement.style.color = 'var(--text-main)'; }
}

function addTodoSubtaskRow(text = '', completed = false, autoFocus = true) {
    const container = document.getElementById('todo-subtasks-container'); if(!container) return;
    const row = document.createElement('div');
    row.className = 'todo-subtask-item'; row.dataset.completed = completed;
    row.innerHTML = `<i class="${completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}" style="color:${completed ? 'var(--accent)' : 'var(--text-sub)'}; font-size:16px; margin-top:2px;" onclick="this.parentElement.dataset.completed = this.parentElement.dataset.completed === 'true' ? 'false' : 'true'; this.className = this.parentElement.dataset.completed === 'true' ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'; this.style.color = this.parentElement.dataset.completed === 'true' ? 'var(--accent)' : 'var(--text-sub)';"></i><input type="text" class="todo-subtask-input" placeholder="子任务内容..." value="${text}"><i class="fa-solid fa-xmark todo-subtask-delete" onclick="this.parentElement.remove()"></i>`;
    container.appendChild(row);
    const input = row.querySelector('.todo-subtask-input');
    if (input) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTodoSubtaskRow('', false, true); } });
        if (autoFocus) input.focus();
    }
}

function toggleSubTaskStatus(taskId, subIdx) { const task = todoList.find(t => t.id === taskId); if (!task || !task.subTasks) return; task.subTasks[subIdx].completed = !task.subTasks[subIdx].completed; saveTodoData(); renderTodoList(); }
function toggleSubtasks(taskId) {
    const task = todoList.find(t => t.id === taskId); if (!task) return;
    task.isExpanded = !task.isExpanded; saveTodoData();
    const wrapper = document.getElementById(`subtasks-wrapper-${taskId}`), arrow = document.getElementById(`subtasks-arrow-${taskId}`);
    if (wrapper) wrapper.classList.toggle('expanded', task.isExpanded);
    if (arrow) arrow.style.transform = task.isExpanded ? 'rotate(180deg) translateZ(0)' : 'rotate(0deg) translateZ(0)';
}

function renderTodoList() {
    const pages = [document.getElementById('todo-page-0'), document.getElementById('todo-page-1'), document.getElementById('todo-page-2')];
    if (!pages[0]) return;
    pages.forEach(p => p.innerHTML = '');
    const filteredTasks = todoList.filter(task => { if (!activeFilterTag) return true; return task.tags && task.tags.includes(activeFilterTag); });

    filteredTasks.forEach(task => {
        let tagsHtml = task.tags.map(t => `<span class="todo-tag">${t}</span>`).join('');
        if (task.ddl_date || task.ddl_time) {
            let ddlDisplay = '';
            if (task.ddl_date) {
                const [y, m, d] = task.ddl_date.split('-'), today = new Date(), selected = new Date(y, m - 1, d);
                if (today.toDateString() === selected.toDateString()) ddlDisplay = "今天";
                else { const tom = new Date(today); tom.setDate(tom.getDate() + 1); ddlDisplay = tom.toDateString() === selected.toDateString() ? "明天" : `${m}月${d}日`; }
            }
            if (task.ddl_time) ddlDisplay += (ddlDisplay ? ' ' : '') + task.ddl_time;
            tagsHtml = `<span class="todo-tag highlight"><i class="fa-regular fa-calendar"></i> ${ddlDisplay}</span>` + tagsHtml;
        }
        const titleStyle = task.status === 2 ? 'text-decoration: line-through; opacity: 0.5;' : '';
        const checkClass = task.status === 2 ? 'checked' : '';
        let subtasksHtml = '', expandBtnHtml = '';
        
        if (task.subTasks && task.subTasks.length > 0) {
            const completedCount = task.subTasks.filter(st => st.completed).length, totalCount = task.subTasks.length;
            expandBtnHtml = `<span class="todo-tag" style="cursor: pointer; background: transparent; border: 0.5px solid var(--border); color: var(--text-main);" onclick="event.stopPropagation(); toggleSubtasks(${task.id})" ontouchstart="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) p.style.setProperty('transform', 'none', 'important');" ontouchend="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) setTimeout(() => p.style.removeProperty('transform'), 150);" ontouchcancel="event.stopPropagation(); const p = this.closest('.todo-list-item'); if(p) p.style.removeProperty('transform');" onmousedown="event.stopPropagation()" onpointerdown="event.stopPropagation()"><i id="subtasks-arrow-${task.id}" class="fa-solid fa-chevron-down" style="transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1); transform-origin: center; backface-visibility: hidden; transform: ${task.isExpanded ? 'rotate(180deg) translateZ(0)' : 'translateZ(0)'};"></i>${completedCount}/${totalCount}</span>`;
            let subListHtml = task.subTasks.map((st, idx) => `<div style="display:flex; align-items:flex-start; gap:8px; padding: 4px 0;" onclick="event.stopPropagation(); toggleSubTaskStatus(${task.id}, ${idx})" ontouchstart="event.stopPropagation()"><i class="${st.completed ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle'}" style="color: ${st.completed ? 'var(--accent)' : 'var(--text-sub)'}; font-size:15px; margin-top:2px;"></i><span style="flex:1; font-size:14px; color: ${st.completed ? 'var(--text-sub)' : 'var(--text-main)'}; text-decoration: ${st.completed ? 'line-through' : 'none'}; line-height:1.3;">${st.title}</span></div>`).join('');
            subtasksHtml = `<div id="subtasks-wrapper-${task.id}" class="subtasks-grid-wrapper ${task.isExpanded ? 'expanded' : ''}"><div class="subtasks-inner"><div style="margin-top: ${(tagsHtml || expandBtnHtml) ? '6px' : '2px'}; margin-left: 30px; padding-top: 4px;">${subListHtml}</div></div></div>`;
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
                    <div class="todo-checkbox-hitbox" onclick="event.stopPropagation(); toggleTodoStatus(${task.id})" ontouchstart="event.stopPropagation()"><div class="todo-checkbox ${checkClass}"><i class="fa-solid fa-check" style="font-size: 11px;"></i></div></div>
                    <div style="flex:1; padding-top: 1px;"><div class="todo-title" style="${titleStyle}">${task.title}</div>${tagsContainerHtml}</div>
                </div>${subtasksHtml}
            </div>`;
        if (pages[targetPage]) pages[targetPage].insertAdjacentHTML('beforeend', cardHtml);
    });
    if (!pages[0].innerHTML) pages[0].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">没有待办任务，享受休息吧</div>';
    if (!pages[1].innerHTML) pages[1].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">今天很清闲，或者你可以从待办挑几个</div>';
    if (!pages[2].innerHTML) pages[2].innerHTML = '<div style="text-align:center; color:var(--text-sub); margin-top:60px; font-size:13px;">完成的任务会沉淀在这里</div>';
}

function toggleTodoStatus(id) {
    const task = todoList.find(t => t.id === id); if (!task) return;
    const listItem = document.getElementById(`todo-item-${id}`);
    if (listItem) {
        const checkbox = listItem.querySelector('.todo-checkbox'); if (checkbox) checkbox.classList.toggle('checked');
        listItem.style.borderColor = 'transparent'; 
        if (!listItem.nextElementSibling && listItem.previousElementSibling) listItem.previousElementSibling.style.borderColor = 'transparent';
        listItem.style.transition = 'opacity 0.2s ease, transform 0.2s ease'; listItem.style.opacity = '0'; listItem.style.transform = 'scale(0.95)';
        setTimeout(() => {
            listItem.style.height = listItem.offsetHeight + 'px'; listItem.style.overflow = 'hidden'; listItem.offsetHeight; 
            listItem.style.transition = 'all 0.25s cubic-bezier(0.25, 1, 0.5, 1)'; listItem.style.height = '0px'; listItem.style.paddingTop = '0px'; listItem.style.paddingBottom = '0px'; listItem.style.marginTop = '0px'; listItem.style.marginBottom = '0px';
        }, 200);
        setTimeout(() => { task.status = (task.status === 2) ? 0 : 2; saveTodoData(); renderTodoList(); }, 450);
    } else { task.status = (task.status === 2) ? 0 : 2; saveTodoData(); renderTodoList(); }
}

function submitNewTodo() {
    const title = document.getElementById('todo-input-title').value.trim();
    if (!title) { alert("任务内容不能为空哦！"); return; }
    const subTasks = Array.from(document.querySelectorAll('.todo-subtask-item')).map(row => { return { title: row.querySelector('.todo-subtask-input').value.trim(), completed: row.dataset.completed === 'true' }; }).filter(st => st.title !== '');
    const editingId = document.getElementById('todo-bottom-sheet').dataset.editingId;
    if (editingId) {
        const task = todoList.find(t => t.id === parseInt(editingId));
        if (task) { task.title = title; task.tags = Array.from(todoSelectedTags); task.ddl_date = document.getElementById('todo-date-picker').value; task.ddl_time = document.getElementById('todo-time-picker').value; task.subTasks = subTasks; }
        delete document.getElementById('todo-bottom-sheet').dataset.editingId;
    } else {
        todoList.unshift({ id: Date.now(), title, tags: Array.from(todoSelectedTags), ddl_date: document.getElementById('todo-date-picker').value, ddl_time: document.getElementById('todo-time-picker').value, subTasks, status: 0 }); 
    }
    saveTodoData(); renderTodoList(); 
    if (document.activeElement) document.activeElement.blur();
    setTimeout(() => { closeTodoSheet(); }, 250);
}

function openTodoAction(taskId) {
    window.originalTagPool = [...todoTagPool]; window.originalSelectedTags = new Set(todoSelectedTags);
    activeTodoId = taskId;
    document.getElementById('todo-action-overlay').classList.add('active'); document.getElementById('todo-action-sheet').style.transform = 'translateY(0)';
}
function closeTodoAction() { activeTodoId = null; document.getElementById('todo-action-overlay').classList.remove('active'); document.getElementById('todo-action-sheet').style.transform = 'translateY(100%)'; }

document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { renderTodoList(); }, 200); });
document.addEventListener('DOMContentLoaded', () => {
    const todoSheet = document.getElementById('todo-bottom-sheet'); if (!todoSheet) return;
    todoSheet.addEventListener('focusin', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') setTimeout(() => { e.target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); });
});

document.addEventListener('DOMContentLoaded', () => {
    const bottomSheet = document.getElementById('todo-bottom-sheet'), dragHandle = document.querySelector('.todo-sheet-handle');
    if (!bottomSheet || !dragHandle) return;
    let dragStartY = 0, sheetStartHeight = 0;
    dragHandle.addEventListener('touchstart', (e) => { dragStartY = e.touches[0].clientY; window.dragStartTime = Date.now(); sheetStartHeight = bottomSheet.clientHeight; bottomSheet.style.transition = 'none'; }, { passive: true });
    dragHandle.addEventListener('touchmove', (e) => {
        const currentY = e.touches[0].clientY, deltaY = dragStartY - currentY; 
        let newHeight = sheetStartHeight + deltaY;
        const maxHeight = window.innerHeight - 100; if (newHeight > maxHeight) newHeight = maxHeight;
        bottomSheet.style.height = newHeight + 'px';
    }, { passive: true });
    dragHandle.addEventListener('touchend', (e) => {
        const currentY = e.changedTouches ? e.changedTouches[0].clientY : dragStartY, deltaY = dragStartY - currentY, dragTime = Date.now() - window.dragStartTime, velocity = deltaY / dragTime;
        if (velocity < -0.8 || deltaY < -150) {
            bottomSheet.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), height 0.3s cubic-bezier(0.25, 1, 0.5, 1)'; cancelTodoSheet(); 
            setTimeout(() => { bottomSheet.style.transition = 'none'; bottomSheet.style.height = '65vh'; }, 350); return;
        }
        bottomSheet.style.transition = 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1), transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
        if (deltaY > 20 || bottomSheet.clientHeight > window.innerHeight * 0.75) bottomSheet.style.height = 'calc(100vh - 100px)';
        else bottomSheet.style.height = '65vh';
    });
});

// ==========================================
// 主页 Apps 拖拽排序功能
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const appGrid = document.querySelector('.app-grid'); if (!appGrid) return;
    const savedOrder = JSON.parse(localStorage.getItem('LINKGO_APPS_ORDER'));
    if (savedOrder && savedOrder.length > 0) {
        savedOrder.forEach(id => { const appEl = appGrid.querySelector(`[data-id="${id}"]`); if (appEl) appGrid.appendChild(appEl); });
    }
    if (typeof Sortable !== 'undefined') {
        new Sortable(appGrid, {
            animation: 350, easing: "cubic-bezier(0.25, 1, 0.5, 1)", delay: 200, delayOnTouchOnly: true, touchStartThreshold: 5, 
            forceFallback: true, fallbackClass: "app-item-chosen", ghostClass: 'app-item-ghost', chosenClass: 'app-item-chosen', fallbackOnBody: true, 
            onEnd: function () {
                const newOrder = []; appGrid.querySelectorAll('.clickable').forEach(el => { if (el.dataset.id) newOrder.push(el.dataset.id); });
                localStorage.setItem('LINKGO_APPS_ORDER', JSON.stringify(newOrder));
                if (navigator.vibrate) navigator.vibrate(15);
            }
        });
    }
});
