// ==========================================
// 页面切换与导航
// ==========================================
function switchTab(tabName) {
    if(document.getElementById('explore-refresh-indicator')) {
        document.getElementById('explore-refresh-indicator').style.opacity = '0';
    }
    document.querySelectorAll('.tab-page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tabName).classList.add('active');
    const tabs = ['apps', 'explore', 'chat', 'me'];
    const index = tabs.indexOf(tabName);
    if(index >= 0) document.querySelectorAll('.tab-btn')[index].classList.add('active');
    sessionStorage.setItem('CURRENT_MAIN_TAB', tabName);
}

function switchExplore(index) {
    const glider = document.getElementById('seg-glider');
    if(glider) glider.style.transform = `translateX(${index * 100}%)`;
    document.querySelectorAll('.seg-item').forEach((el, i) => { el.classList.toggle('active', i === index); });
    document.querySelectorAll('.explore-section').forEach(el => el.classList.remove('active'));
    document.getElementById('exp-sec-' + index).classList.add('active');
}

function openSubPage(id) { document.getElementById(id).classList.add('show'); }

function closeSubPage(id) { 
    const el = document.getElementById(id);
    el.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.classList.remove('show');
    }, 350);
}

function showChatWindow() { document.getElementById('scene-chat').classList.add('show'); }

function hideChatWindow() { 
    const el = document.getElementById('scene-chat');
    void el.offsetWidth;
    el.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
    el.style.transform = 'translateX(100%)';
    setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.classList.remove('show');
    }, 350);
}

function showOptionsWindow() { openChatDetail(); }
function hideOptionsWindow() { 
    const el = document.getElementById('scene-options');
    el.style.transform = ''; 
    el.classList.remove('show'); 
}

// ==========================================
// iOS 原生手势：右滑返回
// ==========================================
let touchStartX = 0, touchStartY = 0, activePage = null, isActivePageModal = false, isActuallySwiping = false;

document.addEventListener('touchstart', (e) => {
    const swipeableLayers = Array.from(document.querySelectorAll('.sub-page-scene.show, #chat-detail-panel.show, .modal-overlay.show, .config-modal-overlay.show, .prompt-modal-overlay.show'));
    if (swipeableLayers.length === 0) return;
    
    activePage = swipeableLayers[swipeableLayers.length - 1]; 
    isActivePageModal = activePage.classList.contains('modal-overlay') || activePage.classList.contains('config-modal-overlay') || activePage.classList.contains('prompt-modal-overlay');
    
    const touch = e.touches[0];
    if (touch.clientX < 30) {
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        isActuallySwiping = false;
    } else { activePage = null; }
});

document.addEventListener('touchmove', (e) => {
    if (!activePage) return;
    const touch = e.touches[0];
    let deltaX = touch.clientX - touchStartX;
    
    if (deltaX > 0) {
        if (deltaX > 10) {
            if (!isActuallySwiping) {
                isActuallySwiping = true;
                if (!isActivePageModal) activePage.classList.add('swiping');
            }
            if (!isActivePageModal) activePage.style.transform = `translateX(${deltaX}px)`;
            e.preventDefault(); 
        }
    }
}, { passive: false });

document.addEventListener('touchend', (e) => {
    if (!activePage) return;
    if (!isActivePageModal) activePage.classList.remove('swiping');
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartX;
    
    if (!isActuallySwiping || Math.abs(deltaX) < 10) {
        if (!isActivePageModal) activePage.style.transform = '';
        activePage = null;
        return;
    }
    
    const threshold = isActivePageModal ? 40 : window.innerWidth * 0.25;
    if (deltaX > threshold) {
        const pageId = activePage.id;
        const targetPage = activePage; 
        const isModal = isActivePageModal;
        if (!isModal) {
            void targetPage.offsetWidth;
            targetPage.style.transition = 'transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)';
            targetPage.style.transform = 'translateX(100%)';
            setTimeout(() => {
                targetPage.style.transition = '';
                targetPage.style.transform = '';
                targetPage.classList.remove('show');
                if (pageId === 'sub-preset-detail' && typeof openPresetManagementModal === 'function') openPresetManagementModal();
                if (pageId === 'sub-regex-detail' && typeof openRegexManagementModal === 'function') openRegexManagementModal();
                document.querySelectorAll('.modal-overlay.show, .config-modal-overlay.show, .prompt-modal-overlay.show').forEach(m => {
                    m.style.transform = '';
                    m.classList.remove('show');
                });
            }, 350);
        } else {
            targetPage.style.transform = '';
            targetPage.classList.remove('show');
        }
    } else {
        if (!isActivePageModal) {
            activePage.style.transform = 'translateX(0)';
            setTimeout(() => { if(activePage) activePage.style.transform = ''; }, 400);
        }
    }
    activePage = null;
});

// ==========================================
// 应用初始化启动
// ==========================================
(async function startApp() {
    await DB.init();
    await loadFromLocal();
    
    // 初始化各模块
    if (typeof initApiConfig === 'function') initApiConfig();
    if (typeof initTheme === 'function') initTheme();
    if (typeof initModelParams === 'function') initModelParams();
    if (typeof initPresets === 'function') initPresets();
    if (typeof initRegexSystem === 'function') initRegexSystem();
    if (typeof initPushSystem === 'function') initPushSystem();
    if (typeof initKeepAliveSystem === 'function') initKeepAliveSystem();
    if (typeof initChatApiConfigSystem === 'function') initChatApiConfigSystem();
    if (typeof initParamConfigSystem === 'function') initParamConfigSystem();
    if (typeof initAvatarManagement === 'function') initAvatarManagement();
    if (typeof initOtherApiConfigSystem === 'function') initOtherApiConfigSystem();
    if (typeof loadGeneralConfig === 'function') loadGeneralConfig();
    
    if (typeof renderChatList === 'function') renderChatList();
})();

document.addEventListener('DOMContentLoaded', function() {
    const savedTab = sessionStorage.getItem('CURRENT_MAIN_TAB') || 'chat';
    switchTab(savedTab);
    if (typeof initGlobalPullRefresh === 'function') initGlobalPullRefresh();
});

// ==========================================
// 下拉刷新引擎 (由于被分出来，放在这里最安全)
// ==========================================
function initGlobalPullRefresh() {
    const tabPages = document.querySelectorAll('.tab-page');
    let startY = 0, currentY = 0, isPulling = false, pullDistance = 0;
    const pullThreshold = 60;
    let activePullContainer = null;
    
    let globalIndicator = document.getElementById('global-pull-indicator');
    if (!globalIndicator) {
        globalIndicator = document.createElement('div');
        globalIndicator.id = 'global-pull-indicator';
        globalIndicator.className = 'pull-refresh-indicator';
        globalIndicator.innerHTML = '<div class="pull-refresh-spinner"></div>';
        document.body.appendChild(globalIndicator);
    }

    tabPages.forEach(tabPage => {
        const oldIndicator = tabPage.querySelector('.pull-refresh-indicator');
        if (oldIndicator) oldIndicator.remove();

        tabPage.addEventListener('touchstart', (e) => {
            const scrollContainer = e.target.closest('.forum-feed') || tabPage;
            if (scrollContainer.scrollTop > 5) return;
            if (e.target.closest('.app-grid')) return;
            
            isPulling = true;
            startY = e.touches[0].clientY;
            activePullContainer = tabPage;
            tabPage.style.transition = 'none'; 
            globalIndicator.style.transition = 'none';
        }, { passive: true });

        tabPage.addEventListener('touchmove', (e) => {
            if (!isPulling || activePullContainer !== tabPage) return;
            currentY = e.touches[0].clientY;
            let deltaY = currentY - startY;

            if (deltaY > 15) {
                const scrollContainer = e.target.closest('.forum-feed') || tabPage;
                if (scrollContainer.scrollTop > 5) { isPulling = false; return; }
                if (e.cancelable) e.preventDefault(); 
                pullDistance = (deltaY - 15) * 0.4;
                tabPage.style.transform = `translateY(${pullDistance}px)`;
                globalIndicator.style.transform = `translate(-50%, ${-40 + pullDistance}px)`;
                globalIndicator.style.opacity = Math.min(pullDistance / pullThreshold, 1);
                globalIndicator.innerHTML = '<div class="pull-refresh-spinner"></div>';
            } else if (deltaY < 0) isPulling = false;
        }, { passive: false });

        tabPage.addEventListener('touchend', (e) => {
            if (!isPulling || activePullContainer !== tabPage) return;
            isPulling = false;

            if (pullDistance >= pullThreshold) {
                tabPage.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)';
                tabPage.style.transform = 'translateY(60px)';
                globalIndicator.style.transition = 'transform 0.4s cubic-bezier(0.17, 0.67, 0.83, 0.67)';
                globalIndicator.style.transform = `translate(-50%, 20px)`;
                globalIndicator.innerHTML = '<div class="pull-refresh-spinner" style="animation-duration: 0.6s;"></div>';
                
                const isForum = (tabPage.id === 'tab-explore' && document.getElementById('exp-sec-1').classList.contains('active'));
                if (isForum && typeof generateNewGossipPost === 'function') {
                    generateNewGossipPost().then(() => resetPull(tabPage, globalIndicator)).catch(() => resetPull(tabPage, globalIndicator));
                } else if (typeof repairAppCache === 'function') repairAppCache();
                else resetPull(tabPage, globalIndicator);
            } else resetPull(tabPage, globalIndicator);
            
            pullDistance = 0;
            activePullContainer = null;
        });

        function resetPull(page, ind) {
            page.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
            page.style.transform = 'translateY(0)';
            ind.style.transition = 'transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease';
            ind.style.transform = 'translate(-50%, -40px)';
            ind.style.opacity = '0';
            setTimeout(() => { ind.innerHTML = ''; page.style.transition = 'none'; ind.style.transition = 'none'; }, 300);
        }
    });
}

// ==========================================
// 键盘同步与幽灵键盘拦截
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    if (window.Capacitor && window.Capacitor.Plugins.Keyboard) {
        const Keyboard = window.Capacitor.Plugins.Keyboard;
        Keyboard.setAccessoryBarVisible({ isVisible: false });
        Keyboard.setResizeMode({ mode: 'none' }).catch(e => console.log(e));

        function getSafeAreaBottom() {
            const div = document.createElement('div');
            div.style.height = 'env(safe-area-inset-bottom)';
            div.style.position = 'absolute';
            div.style.visibility = 'hidden';
            document.body.appendChild(div);
            const sab = div.clientHeight || 0;
            document.body.removeChild(div);
            return sab;
        }

        const chatBar = document.getElementById('chat-input-bar');
        if (chatBar) chatBar.style.boxShadow = '0 500px 0 var(--card-bg)';

        function setShift(el, shiftValue) {
            if (!el) return;
            if (!el.hasAttribute('data-orig-transform')) el.setAttribute('data-orig-transform', el.style.transform || '');
            el.style.transition = 'transform 0.38s cubic-bezier(0.15, 0.85, 0.3, 1)';
            void el.offsetWidth;
            el.style.transform = `translateY(${shiftValue}px)`;
            el.dataset.kbShifted = "true";
        }

        document.addEventListener('touchstart', (e) => {
            if (!e.target.closest('input') && !e.target.closest('textarea') && !e.target.closest('#chat-input-bar')) {
                const active = document.activeElement;
                if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
            }
        }, { passive: true, capture: true });

        document.addEventListener('click', (e) => {
            if (e.target.closest('.back-btn') || e.target.closest('.chat-nav-header') || e.target.closest('.nav-item') || e.target.closest('.chat-list-item') || e.target.closest('[onclick*="openChat"]')) {
                document.querySelectorAll('input, textarea').forEach(el => el.blur());
            }
        }, true);

        Keyboard.addListener('keyboardWillShow', info => {
            const kbHeight = info.keyboardHeight;
            window.lastKbHeight = kbHeight;
            const activeEl = document.activeElement;
            
            if (activeEl && activeEl.id === 'archive-search-input') {
                const archiveContent = document.getElementById('archive-content');
                if (archiveContent) {
                    archiveContent.style.transform = '';
                    const lockScroll = archiveContent.scrollTop;
                    archiveContent.scrollTop = lockScroll;
                    requestAnimationFrame(() => {
                        archiveContent.scrollTop = lockScroll;
                        requestAnimationFrame(() => { archiveContent.scrollTop = lockScroll; activeEl.blur(); activeEl.focus(); });
                    });
                    const restoreTransform = () => { archiveContent.style.transform = 'translateZ(0)'; document.removeEventListener('keyboardWillHide', restoreTransform); };
                    document.addEventListener('keyboardWillHide', restoreTransform, { once: true });
                }
                return;
            }

            const archiveSubPage = document.getElementById('sub-archive');
            if (archiveSubPage && archiveSubPage.classList.contains('show')) {
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                    let editContainer = activeEl.closest('.chip-detail-item, .timeline-item, .archive-timeline-row') || activeEl.parentElement;
                    const containerRect = editContainer.getBoundingClientRect();
                    const keyboardTop = window.innerHeight - kbHeight;
                    let offsetNeeded = containerRect.bottom > keyboardTop - 20 ? containerRect.bottom - (keyboardTop - 20) : 0;
                    offsetNeeded = Math.min(offsetNeeded, kbHeight);
                    
                    if (offsetNeeded > 0) {
                        const archiveContent = document.getElementById('archive-content');
                        if (archiveContent && !archiveContent.hasAttribute('data-orig-transform')) setShift(archiveContent, -offsetNeeded);
                        const header = archiveSubPage.querySelector('.nav-header');
                        if (header) { header.style.zIndex = '100'; header.style.background = 'var(--nav-bg)'; header.style.backdropFilter = 'blur(20px)'; }
                    }
                    return;
                }
            }

            if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) return;
            const activePage = document.querySelector('.sub-page-scene.show') || document.querySelector('.tab-page.active');
            const sab = getSafeAreaBottom();

            if (activeEl.id === 'chat-message-input' || activeEl.closest('#chat-input-bar') || activeEl.id === 'console-cmd-input' || activeEl.closest('#console-input-bar')) {
                const consoleBar = document.getElementById('console-input-bar');
                if (consoleBar && consoleBar.classList.contains('console-expanded')) {
                    consoleBar.style.height = `${window.innerHeight - kbHeight}px`;
                    window.scrollTo(0, 0);
                    return;
                }
                activeEl.style.caretColor = 'transparent';
                setTimeout(() => { activeEl.style.caretColor = ''; }, 400);
                const targetPage = activePage || document.body;
                const exactShift = kbHeight - sab; 

                Array.from(targetPage.children).forEach(child => {
                    if (child.classList.contains('chat-nav-header') || child.tagName === 'HEADER' || child.id === 'chat-header') return;
                    setShift(child, -exactShift);
                });
                return;
            }

            setTimeout(() => { 
                const rect = activeEl.getBoundingClientRect();
                const overlap = rect.bottom - (window.innerHeight - kbHeight) + 20;
                if (overlap > 0) {
                    activeEl.style.caretColor = 'transparent';
                    setTimeout(() => { activeEl.style.caretColor = ''; }, 400);
                    let container = activeEl.closest('#todo-bottom-sheet') || activeEl.closest('.modal-content') || activeEl.closest('.config-modal-content') || activeEl.closest('.prompt-modal');
                    if (container) setShift(container, -Math.min(overlap, kbHeight));
                    else {
                        const targetPage = activePage || document.body;
                        Array.from(targetPage.children).forEach(child => { if (child.classList.contains('header') || child.tagName === 'HEADER') return; setShift(child, -overlap); });
                    }
                }
            }, 50); 
        });

        Keyboard.addListener('keyboardWillHide', () => {
            window.lastKbHeight = 0;
            const consoleBar = document.getElementById('console-input-bar');
            if (consoleBar && consoleBar.classList.contains('console-expanded')) consoleBar.style.height = '';
            
            document.querySelectorAll('[data-kb-shifted="true"]').forEach(el => {
                const orig = el.getAttribute('data-orig-transform');
                el.style.transform = orig || '';
                setTimeout(() => {
                    el.style.transition = ''; 
                    delete el.dataset.kbShifted;
                    el.style.transform = orig || '';
                    el.removeAttribute('data-orig-transform');
                }, 400); 
            });
            
            const archiveHeader = document.querySelector('#sub-archive .nav-header');
            if (archiveHeader) { archiveHeader.style.zIndex = ''; archiveHeader.style.background = ''; archiveHeader.style.backdropFilter = ''; }   
        });
    }
});

// ==========================================
// 开屏动画与控制台拦截器
// ==========================================
window.addEventListener('load', () => {
    const splashEl = document.getElementById('linkgo-splash');
    if (splashEl) {
        setTimeout(() => {
            splashEl.classList.add('splash-disperse');
            setTimeout(() => { splashEl.remove(); }, 800);
        }, 2000); 
    }
});

const LOG_STORAGE = new Map();
const devConsoleLogs = document.getElementById('dev-console-logs');

window.clearDevConsole = function() {
    if(devConsoleLogs) devConsoleLogs.innerHTML = '<div id="console-ready-msg" style="color: var(--text-sub); text-align: center; padding: 20px 0; font-size: 13px;">拦截器已就绪</div>';
    LOG_STORAGE.clear();
};

window.copyLogContent = function(btn, logId) {
    const text = LOG_STORAGE.get(logId); if (!text) return;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(() => {
            const icon = btn.querySelector('i'); icon.className = 'fa-solid fa-check'; icon.style.color = '#34C759';
            setTimeout(() => { icon.className = 'fa-regular fa-copy'; icon.style.color = ''; }, 2000);
        }).catch(() => alert('复制失败，请长按文本手动复制'));
    } else alert('复制失败，请长按文本手动复制');
};

function addLogToConsole(type, title, detail) {
    const readyMsg = document.getElementById('console-ready-msg');
    if (readyMsg) readyMsg.remove();

    const time = new Date().toLocaleTimeString('en-US', {hour12: false});
    let dotColor = type === 'error' ? 'var(--danger)' : (type === 'warn' ? '#FF9F0A' : (type === 'info' ? '#8E8E93' : '#34C759'));
    const logItem = document.createElement('div');
    logItem.style.cssText = 'margin-bottom: 18px; padding-bottom: 12px; border-bottom: 0.5px solid var(--border);';
    
    const logId = 'log_' + Date.now() + Math.random().toString(36).substr(2, 5);
    let detailStr;
    if (detail === undefined) detailStr = 'undefined';
    else if (detail === null) detailStr = 'null';
    else if (typeof detail === 'object') {
        try {
            detailStr = detail.message || detail.stack || String(detail);
            detailStr = detailStr.replace(/[\[\]{}]/g, '');
        } catch(e) { detailStr = String(detail).replace(/[\[\]{}]/g, ''); }
    } else detailStr = String(detail);
    detailStr = detailStr.replace(/[\[\]{}]/g, '');
    if (detailStr === '') detailStr = '(空字符串)';
    LOG_STORAGE.set(logId, detailStr);

    logItem.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 7px; height: 7px; border-radius: 50%; background: ${dotColor};"></div>
                <div style="color: var(--text-sub); font-size: 10px;">${time}</div>
                <div style="color: var(--text-main); font-weight: 700; font-size: 13px;">${title}</div>
            </div>
            <div onclick="copyLogContent(this, '${logId}')" style="color: var(--text-sub); font-size: 14px; cursor: pointer; padding: 5px; opacity: 0.6;"><i class="fa-regular fa-copy"></i></div>
        </div>
        <pre style="color: var(--text-sub); margin: 0 0 0 15px; white-space: pre-wrap; word-break: break-all; font-size: 12px; line-height: 1.6; font-family: monospace;">${detailStr}</pre>
    `;
    if(devConsoleLogs) devConsoleLogs.prepend(logItem);
}

setTimeout(() => {
    const input = document.getElementById('console-cmd-input');
    const btn = document.getElementById('console-cmd-btn');
    if (!input || !btn) return;
    const run = () => {
        const cmd = input.value.trim(); if (!cmd) return;
        input.value = ''; addLogToConsole('info', '输入', cmd);
        try { const result = eval(cmd); addLogToConsole('success', '结果', result === undefined ? 'undefined' : result); } 
        catch (e) { addLogToConsole('error', '报错', e.stack ? e.stack : e.toString()); }
    };
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault(); btn.style.transform = 'scale(0.9)'; btn.style.background = '#34C759'; btn.querySelector('i').style.color = '#fff';
        run();
        setTimeout(() => { btn.style.transform = ''; btn.style.background = 'rgba(52, 199, 89, 0.15)'; btn.querySelector('i').style.color = '#34C759'; input.blur(); }, 200);
    }, { passive: false });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });
}, 500);

window.print = (...args) => addLogToConsole('success', 'PRINT', args.length > 1 ? args : args[0]);
console.log = (...args) => { const msg = String(args[0]); if (!msg.includes('滴答') && !msg.includes('还活着')) addLogToConsole('info', 'LOG', args); };
console.error = (...args) => { addLogToConsole('error', 'ERROR', args[0] instanceof Error ? (args[0].stack || args[0].toString()) : args); };
console.warn = (...args) => addLogToConsole('warn', 'WARN', args);
window.onerror = (msg, url, line) => addLogToConsole('error', '运行时崩溃', `${msg} (Line: ${line})`);
