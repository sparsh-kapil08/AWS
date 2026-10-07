/**
 * KhetVaani - Demo Notification Channels (SNS SMS & Telegram Voice-Note Bot)
 */

export class DemoNotificationService {
  /**
   * Dispatch notification across priority channels (Web Push -> SNS SMS -> Telegram)
   */
  static async dispatchNotification(alert, farmer, plot) {
    const logs = [];

    // 1. Live SSE Push (already handled via eventBus listener)
    logs.push({ channel: 'sse_live_push', status: 'sent', alert_id: alert.id });

    // 2. Web Push (VAPID)
    logs.push({ channel: 'web_push_vapid', status: 'delivered', icon: '🚨', alert_id: alert.id });

    // 3. Demo Channel: SNS SMS
    if (farmer && farmer.phone) {
      logs.push({ 
        channel: 'sns_sms_demo', 
        status: 'sent', 
        phone: farmer.phone, 
        message: `KhetVaani Alert: ${alert.level.toUpperCase()} - Please open app to listen to spoken advice.` 
      });
    }

    // 4. Demo Channel: Telegram Voice Bot Hook
    logs.push({
      channel: 'telegram_voice_bot_demo',
      status: 'sent',
      voice_note_key: alert.clip_sequence[0] || 'heavy_rain_coming'
    });

    return logs;
  }
}
