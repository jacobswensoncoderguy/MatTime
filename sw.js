/* Mat Time: shows GO NOW and other alerts when the app is closed */
self.addEventListener('push', function(ev){
  var d={title:'Mat Time', body:''};
  try{ d=ev.data.json(); }catch(e){ try{ d.body=ev.data.text(); }catch(e2){} }
  ev.waitUntil(self.registration.showNotification(d.title||'Mat Time',{
    body:d.body||'', tag:d.tag||'mt', renotify:true,
    icon:'icon-192.png', badge:'icon-192.png', vibrate:[200,80,200,80,400]
  }));
});
self.addEventListener('notificationclick', function(ev){
  ev.notification.close();
  ev.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(ws){
    for(var i=0;i<ws.length;i++){ if('focus' in ws[i]) return ws[i].focus(); }
    if(clients.openWindow) return clients.openWindow('./');
  }));
});
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(ev){ ev.waitUntil(self.clients.claim()); });
