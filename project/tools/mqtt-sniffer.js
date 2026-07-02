const mqtt = require('mqtt');

const BROKER_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const TOPICS = process.env.MQTT_TOPICS ? process.env.MQTT_TOPICS.split(',') : ['DIPSW_0', 'DIPSW_1', '#'];

const client = mqtt.connect(BROKER_URL, {
  clientId: 'sniffer_' + Math.random().toString(16).slice(2, 8),
  reconnectPeriod: 2000,
  keepalive: 60,
});

client.on('connect', () => {
  console.log(`[SNIFFER] Connected to ${BROKER_URL}`);
  TOPICS.forEach(topic => {
    client.subscribe(topic, (err) => {
      if (err) {
        console.error(`[SNIFFER] Failed to subscribe ${topic}:`, err.message);
      } else {
        console.log(`[SNIFFER] Subscribed to ${topic}`);
      }
    });
  });
});

client.on('message', (topic, payload) => {
  const text = payload.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch { }
  console.log(`[SNIFFER] ${new Date().toISOString()} topic=${topic} payload=${text}`);
  if (parsed) {
    const keys = Object.keys(parsed);
    console.log(`[SNIFFER] keys=${keys.join(',')}`);
  }
});

client.on('error', (err) => {
  console.error('[SNIFFER] Error:', err.message);
});

