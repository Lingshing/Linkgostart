// Web Push Service Worker
// 最终版：只保留一个监听器，处理加密文字

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 【唯一的】推送事件处理
self.addEventListener('push', (event) => {
  console.log('🔔 收到推送信号');
  
  // 1. 设置默认文案（万一解密失败，至少显示这个）
  let msgBody = '✨ 你有一条新消息'; 
  
  // 2. 尝试提取加密内容
  if (event.data) {
    try {
      // 这一步会自动解密 AES-GCM 数据
      msgBody = event.data.text();
      console.log('✅ 解密成功:', msgBody);
    } catch (e) {
      console.error('❌ 解密失败 (可能是密钥不匹配):', e);
      // 解密失败时不覆盖 msgBody，保持默认文案，确保至少能弹窗
    }
  } else {
    console.log('⚠️ 收到空包 (无数据)');
  }

  // 3. 弹窗配置
  const title = 'Linkgo'; 
  const options = {
      body: msgBody, 
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      badge: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      tag: 'chat-reply', // 相同的 tag 会覆盖旧通知
      renotify: true,    // 强制震动/响铃
      requireInteraction: false
  };

  // 4. 显示通知
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知的点击事件
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // 点击后打开主页
  const urlToOpen = self.registration.scope; 

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 如果已有窗口，聚焦它
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // 否则打开新窗口
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});
