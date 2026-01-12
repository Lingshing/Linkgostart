// Web Push Service Worker - 解密版

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  console.log('🔔 收到推送');
  
  let msgBody = '✨ 你有一条新消息'; // 默认值

  // 尝试读取后端发来的加密文字
  if (event.data) {
    try {
      // 这一步会自动解密，拿到我们在 Worker 里发的 textToSend
      msgBody = event.data.text(); 
    } catch (e) {
      console.error('解密失败:', e);
    }
  }

  // 弹窗
  const options = {
      body: msgBody, // 这里显示的就是真实文字！
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      tag: 'chat-reply',
      renotify: true,
      requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification('Linkgo', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        if (list.length > 0) return list[0].focus();
        return self.clients.openWindow(self.registration.scope);
      })
  );
});
