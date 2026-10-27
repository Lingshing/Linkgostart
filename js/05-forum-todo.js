// ========== 发现页与论坛 ==========
let forumPostsData = [];
async function loadForumPosts() { const s = await DB.getItem('FORUM_POSTS'); if(s) forumPostsData = JSON.parse(s); else forumPostsData = [{ id: Date.now(), title: "欢迎来到八卦论坛", content: "下拉生成专属八卦。", author: "系统", comments: [], time: "刚刚", likes: 10, commentCount: 0 }]; renderForumPosts(); updateHotSearch(); }
async function saveForumPosts() { await DB.setItem('FORUM_POSTS', JSON.stringify(forumPostsData)); }
function renderForumPosts() { const c = document.getElementById('forum-feed-container'); if(!c) return; c.innerHTML = forumPostsData.map(p => `<div class="forum-post"><div class="post-title">${p.title}</div><div class="post-content">${p.content}</div></div>`).join(''); }
function updateHotSearch() { const l = document.getElementById('forum-hot-list'); if(!l) return; l.innerHTML = ['娱乐圈新恋情', '顶流大瓜', '综艺内幕'].map(t => `<span class="hot-tag"># ${t}</span>`).join(''); }
async function generateNewGossipPost() { alert('八卦生成引擎已就绪，等待 API 接入'); }
function openForumRoleFilter() { alert('角色筛选'); }
function toggleLikePost(id, btn) { btn.classList.toggle('active'); }

// ========== 任务站 (ToDo) ==========
let todoList = JSON.parse(localStorage.getItem('LINKGO_TODO_DATA')) || [];
let todoCurrentIndex = 1;
function saveTodoData() { localStorage.setItem('LINKGO_TODO_DATA', JSON.stringify(todoList)); }
function switchTodoTab(index) {
    todoCurrentIndex = index;
    document.querySelectorAll('#todo-tabs-container .todo-tab').forEach((t, i) => t.classList.toggle('active', i === index));
    document.getElementById('todo-main-track').style.transform = `translateX(-${index * 33.3333}%)`;
}
function renderTodoList() {
    const pages = [document.getElementById('todo-page-0'), document.getElementById('todo-page-1'), document.getElementById('todo-page-2')];
    pages.forEach(p => { if(p) p.innerHTML = ''; });
    todoList.forEach(t => {
        const p = pages[t.status || 0]; if(!p) return;
        p.innerHTML += `<div class="todo-list-item"><div class="todo-header"><div class="todo-checkbox ${t.status===2?'checked':''}" onclick="toggleTodoStatus(${t.id})"></div><div class="todo-title" style="${t.status===2?'text-decoration:line-through;opacity:0.5;':''}">${t.title}</div></div></div>`;
    });
    pages.forEach((p, i) => { if(p && !p.innerHTML) p.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-sub);">暂无任务</div>'; });
}
function toggleTodoStatus(id) { const t = todoList.find(x => x.id === id); if(t) { t.status = t.status === 2 ? 0 : 2; saveTodoData(); renderTodoList(); } }
function openTodoSheet() { document.getElementById('todo-sheet-overlay').classList.add('active'); document.getElementById('todo-bottom-sheet').classList.add('active'); }
function closeTodoSheet() { document.getElementById('todo-sheet-overlay').classList.remove('active'); document.getElementById('todo-bottom-sheet').classList.remove('active'); }
function cancelTodoSheet() { closeTodoSheet(); }
function submitNewTodo() {
    const title = document.getElementById('todo-input-title').value.trim(); if(!title) return alert('请输入任务');
    todoList.unshift({ id: Date.now(), title, status: 0 }); saveTodoData(); renderTodoList(); closeTodoSheet(); document.getElementById('todo-input-title').value = '';
}
function addTodoSubtaskRow() {}
function updateTodoDDL() {}
