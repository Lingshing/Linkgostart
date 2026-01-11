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
self.addEventListener('push', (event) => {
    console.log('🔔 收到push事件！', event);
    console.log('收到推送消息:', event);
  
  let notificationData = {
    title: '新消息',
    body: '您有一条新消息',
    icon: 'https://raw.githubusercontent.com/Lingshing/Linkgostart/refs/heads/main/linkgo-icon.jpg',
    tag: 'notification-tag',
    requireInteraction: false,
    data: {
      url: self.registration.scope
    }
  };

  // 如果推送包含数据，解析它
  if (event.data) {
    try {
      const data = event.data.json();
      notificationData = {
        ...notificationData,
        ...data
      };
    } catch (e) {
      console.log('推送数据不是 JSON 格式，使用文本:', event.data.text());
      notificationData.body = event.data.text();
    }
  }

  const promiseChain = self.registration.showNotification(
    notificationData.title,
    {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
      data: notificationData.data
    }
  );

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

// 处理推送订阅变化
self.addEventListener('pushsubscriptionchange', (event) => {
  console.log('推送订阅发生变化');
  
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey())
    })
    .then((subscription) => {
      console.log('重新订阅成功:', subscription);
      // 这里应该将新的订阅信息发送到服务器
      return fetch('/api/update-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });
    })
  );
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
  return 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEoN_DV2L5hDeE8BIOIzY-cIQFDt3EtCvbGKazuNn6JTsnQhfgAEkeLeePgKYhxsgx2rbg7ifZjRRJUciup3yOAw';
}



