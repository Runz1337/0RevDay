export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('This browser does not support desktop notification');
    return false;
  }
  
  if (Notification.permission === 'granted') {
    return true;
  }
  
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  
  return false;
}

export function playReminderSound() {
  try {
    const audio = new Audio('/mixkit-message-pop-alert-2354.mp3');
    audio.play().catch(e => console.error("Audio play failed", e));
  } catch (e) {
    console.log("Audio play failed", e);
  }
}

export function showNotification(title: string, options?: NotificationOptions) {
  if (!('Notification' in window)) {
    return;
  }
  
  if (Notification.permission === 'granted') {
    const notification = new Notification(title, {
      icon: '/IMG_20260516_153733.png',
      ...options
    });
    
    // Play sound when notification is shown
    playReminderSound();
    
    notification.onclick = function() {
      window.focus();
      this.close();
    };
  }
}

const scheduledNotifications: Map<string, number> = new Map();

export function scheduleNotification(id: string, title: string, triggerTimeUtc: number, body?: string) {
  // Clear any existing notification for this ID
  cancelScheduledNotification(id);
  
  const timeToTrigger = triggerTimeUtc - Date.now();
  if (timeToTrigger <= 0) {
    // If time is past, trigger immediately? Or maybe not. Let's not trigger past notifications.
    return;
  }
  
  const timeoutId = window.setTimeout(() => {
    showNotification(title, { body });
    scheduledNotifications.delete(id);
  }, timeToTrigger);
  
  scheduledNotifications.set(id, timeoutId);
}

export function cancelScheduledNotification(id: string) {
  if (scheduledNotifications.has(id)) {
    window.clearTimeout(scheduledNotifications.get(id));
    scheduledNotifications.delete(id);
  }
}
