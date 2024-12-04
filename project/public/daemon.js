// const fs = require('fs');


client.on('connect', () => {
  console.log('Connected to MQTT broker');
  processCommands();
});

function processCommands() {
  try {
    const data = JSON.parse(fs.readFileSync('commandQueue.json', 'utf8'));

    // Process each device
    sendMQTTCommand('DIPSW_0', 1, 93, data.tankNumber);

    const devices = [
      { act_id: 1, value: data.siloMotorRight },
      { act_id: 2, value: data.siloMotorLeft },
      { act_id: 3, value: data.rotaryValve },
      { act_id: 4, value: data.blower }
    ];

    devices.forEach(device => {
      sendMQTTCommand('DIPSW_1', device.act_id, 91, 3);
      setTimeout(() => {
        sendMQTTCommand('DIPSW_1', device.act_id, 93, 3);
      }, device.value * 1000); // Convert seconds to milliseconds
    });

  } catch (err) {
    console.error('Error processing commands:', err);
  }
}

function sendMQTTCommand(topic, act_id, opmode, pwm) {
  const message = JSON.stringify({ act_id, opmode, pwm });
  client.publish(topic, message, (err) => {
    if (err) {
      console.error('Error publishing MQTT message:', err);
    } else {
      console.log('MQTT message sent:', message);
    }
  });
}