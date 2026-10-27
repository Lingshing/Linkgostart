// ========== 页面切换与导航 ==========
function switchTab(tabName) {
    if(document.getElementById('explore-refresh-indicator')) document.getElementById('explore-refresh-indicator').style.opacity = '0';
    document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    const tabs = ['apps', 'explore', 'chat', 'me'];
    const index = tabs.indexOf(tabName); if(index >= 0) document.querySelectorAll('.tab-btn')[index].classList.add('active');
    sessionStorage.setItem('CURRENT_MAIN_TAB', tabName);
}
function switchExplore(index) {
    document.getElementById('seg-glider').style.transform = `translateX(${index * 100}%)`;
    document.querySelectorAll('.seg-item').forEach((el, i) => el.classList.toggle('active', i === index));
    document.querySelectorAll('.explore-section').forEach(el => el.classList.remove('active'));
    document.getElementById('exp-sec-' + index).classList.add('active');
}
function openSubPage(id) { document.getElementById(id).classList.add('show'); }
function closeSubPage(id) {
    const el = document.getElementById(id); el.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)'; el.style.transform = 'translateX(100%)';
    setTimeout(() => { el.style.transition = ''; el.style.transform = ''; el.classList.remove('show'); }, 350);
}
function showChatWindow() { document.getElementById('scene-chat').classList.add('show'); }
function hideChatWindow() {
    const el = document.getElementById('scene-chat'); void el.offsetWidth; el.style.transition = 'transform 0.35s'; el.style.transform = 'translateX(100%)';
    setTimeout(() => { el.style.transition = ''; el.style.transform = ''; el.classList.remove('show'); }, 350);
}

// ========== 初始化应用 ==========
document.addEventListener('DOMContentLoaded', async () => {
    await DB.init();
    await loadFromLocal();
    
    // 初始化各种配置
    if(typeof initApiConfig === 'function') initApiConfig();
    if(typeof loadParamConfig === 'function') loadParamConfig();
    if(typeof loadOtherApiConfigs === 'function') loadOtherApiConfigs();
    if(typeof loadGeneralConfig === 'function') loadGeneralConfig();
    if(typeof loadForumPosts === 'function') loadForumPosts();
    if(typeof renderTodoList === 'function') renderTodoList();
    
    // 恢复上一次的 Tab
    const savedTab = sessionStorage.getItem('CURRENT_MAIN_TAB') || 'chat';
    switchTab(savedTab);

    // 输入框回车发送
    const input = document.getElementById('chat-message-input');
    if (input) {
        input.addEventListener('keypress', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } });
        input.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = Math.min(this.scrollHeight, 100) + 'px'; });
    }

    // 全局侧滑返回 (省略复杂逻辑，保留基础框架)
    let startX = 0, activePage = null;
    document.addEventListener('touchstart', e => {
        const layers = Array.from(document.querySelectorAll('.sub-page-scene.show'));
        if(layers.length > 0 && e.touches[0].clientX < 30) { activePage = layers[layers.length - 1]; startX = e.touches[0].clientX; }
    });
    document.addEventListener('touchmove', e => { if(activePage) { const dx = e.touches[0].clientX - startX; if(dx > 0) { activePage.style.transform = `translateX(${dx}px)`; e.preventDefault(); } } }, { passive: false });
    document.addEventListener('touchend', e => {
        if(!activePage) return; const dx = e.changedTouches[0].clientX - startX;
        if (dx > window.innerWidth * 0.25) closeSubPage(activePage.id); else activePage.style.transform = 'translateX(0)';
        setTimeout(() => { if(activePage) activePage.style.transform = ''; activePage = null; }, 400);
    });

    // 启动聊天轮询监控
    setInterval(() => { document.querySelectorAll('.chat-item-time').forEach((el, i) => { if(mockContacts[i]) el.textContent = formatMessageTime(mockContacts[i].time); }); }, 60000);
});

// 控制台拦截器
window.addEventListener('load', () => {
    const devConsole = document.getElementById('dev-console-logs');
    window.addLogToConsole = function(type, title, detail) {
        if(!devConsole) return; const div = document.createElement('div'); div.style.marginBottom = '10px';
        div.innerHTML = `<span style="color:${type==='error'?'var(--danger)':'var(--text-sub)'}">[${title}] ${detail}</span>`;
        devConsole.prepend(div);
    };
    window.clearDevConsole = function() { if(devConsole) devConsole.innerHTML = '<div style="text-align:center;color:var(--text-sub);">拦截器已就绪</div>'; };
    
    const input = document.getElementById('console-cmd-input'); const btn = document.getElementById('console-cmd-btn');
    if(btn) btn.addEventListener('click', () => {
        const cmd = input.value.trim(); if(!cmd) return; input.value = '';
        addLogToConsole('info', '输入', cmd);
        try { const r = eval(cmd); addLogToConsole('success', '结果', r === undefined ? 'undefined' : r); } catch(e) { addLogToConsole('error', '报错', e.stack || e.toString()); }
    });
});
