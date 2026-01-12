// Web Push Service Worker
// 作用：当网页被杀后台时，接收空包唤醒手机，提示“有新消息”

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 处理推送事件
self.addEventListener('push', (event) => {
  console.log('🔔 收到后台唤醒信号');
  
  // 这里只显示通用的提示，作为“保底”
  // 如果你的网页在前台，网页自己会弹详细文字；
  // 如果网页被杀后台了，这里负责叫醒用户，提示有消息。
  const options = {
      body: '✨ 你有一条新消息', 
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      tag: 'chat-reply',
      renotify: true,
      requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification('Linkgo', options));
});

// 处理点击事件
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 点击通知，打开网页
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 如果已有窗口，聚焦它
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === self.registration.scope && 'focus' in client) {
            return client.focus();
          }
        }
        // 否则打开新窗口
        if (self.clients.openWindow) {
          return self.clients.openWindow(self.registration.scope);
        }
      })
  );
});
