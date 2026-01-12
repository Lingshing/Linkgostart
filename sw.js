// Service Worker - 接收推送通知
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  console.log('🔔 收到推送信号');
  
  let msgBody = '收到一条新消息'; // 默认内容

  if (event.data) {
    try {
      // 尝试把加密数据转成文字
      const text = event.data.text();
      console.log('解密内容:', text);
      if (text) {
        msgBody = text; // 如果有字，就用解密出来的字
      }
    } catch (e) {
      console.error('解密出错了:', e);
      msgBody = '收到一条新消息 (内容解密失败)';
    }
  }

  // 手机通知的配置
  const options = {
      body: msgBody, 
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg', // 你的图标
      tag: 'chat-msg', // 相同的tag会覆盖上一条
      renotify: true,  // 强制震动
      requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification('Linkgo', options));
});

// 点击通知时的操作
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 点击后打开或回到聊天页面
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('Linkgo') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});
