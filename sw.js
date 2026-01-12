// Web Push Service Worker
// 用于处理推送通知和后台同步

self.addEventListener('install', (event) => {
  console.log('Service Worker 安装中...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker 激活中...');
  event.waitUntil(self.clients.claim());
});

// 处理推送事件
// 处理推送事件
self.addEventListener('push', (event) => {
    console.log('🔔 收到后端发来的信号 (空包)');
    
    // 因为后端发来的是空包，所以我们在前端“写死”提示文案
    const title = 'Linkgo';
    const options = {
        body: '✨ 你有一条新消息', // 这里是可以修改的提示语
        icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
        tag: 'chat-reply',    // 标签：多条消息会折叠或覆盖
        renotify: true,       // 即使标签一样，新消息到了也要震动/响铃
        requireInteraction: false // 不需要用户手动关闭，几秒后自动消失
    };

    // 强制显示通知
    const promiseChain = self.registration.showNotification(title, options);

    event.waitUntil(promiseChain);
});

// 处理通知点击事件
self.addEventListener('notificationclick', (event) => {
  console.log('通知被点击:', event);
  
  event.notification.close();

  // 获取要打开的 URL
  const urlToOpen = event.notification.data?.url || self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // 检查是否已有窗口打开
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        // 如果没有窗口打开，则打开新窗口
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

// 处理推送事件
self.addEventListener('push', (event) => {
  console.log('🔔 收到加密推送！');
  
  let bodyText = '收到新消息'; // 默认值

  if (event.data) {
    // 因为后端加密了，所以这里可以直接用 .text() 拿到解密后的明文！
    // 没错，浏览器会自动帮你解密 AES-GCM
    bodyText = event.data.text(); 
  }

  const title = 'Linkgo'; // 或者 '新回复'
  const options = {
      body: bodyText, // 【重点】这里显示的就是 AI 真实说的话了
      icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
      tag: 'chat-reply',
      renotify: true,
      requireInteraction: false
  };

  const promiseChain = self.registration.showNotification(title, options);
  event.waitUntil(promiseChain);
});

// 辅助函数：将 VAPID 公钥从 Base64 转换为 Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// 获取 VAPID 公钥（需要替换为您自己的公钥）
function getVapidPublicKey() {
  return 'BKXLKgheQ0pGxeVUifzMecruF3o7OkniEkNSbBUM9sKIeUKn2M8NGG5h3YUV2YrHxzAoHS9-ILmz2MlrSoHt4NU';
}
