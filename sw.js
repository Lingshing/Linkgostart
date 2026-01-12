// ==========================================
// 唯一的 Service Worker 逻辑 - 适配加密推送
// ==========================================

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 核心：处理推送事件
self.addEventListener('push', (event) => {
  console.log('🔔 收到推送信号');
  
  let bodyText = '✨ 你有一条新消息'; // 默认保底文字

  // 尝试解密后端传来的真实文字
  if (event.data) {
    try {
      bodyText = event.data.text(); 
      console.log('解密后的文字:', bodyText);
    } catch (e) {
      console.error('解密失败:', e);
    }
  }

  const title = 'Linkgo'; 
  const options = {
      body: bodyText,
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      badge: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      tag: 'chat-reply',
      renotify: true,
      requireInteraction: false,
      data: {
        url: self.registration.scope
      }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 处理通知点击
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
      })
  );
});
