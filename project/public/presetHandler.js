const client = mqtt.connect('mqtt://192.168.2.55:9001');

const inputFields = document.querySelectorAll('#box input[type="number"]');
const presets = ['preset1', 'preset2', 'preset3'];
let currentSettings = [];

// Connect to the MQTT broker
client.on('connect', () => {
  console.log('Connected to MQTT broker');
});

// Save current settings to a selected preset
document.getElementById('savePreset').addEventListener('click', () => {
  console.log('Save button clicked');
  const selectedPreset = document.querySelector('input[name="preset"]:checked');
  if (selectedPreset) {
    console.log('Preset selected:', selectedPreset.value);
    const presetName = `${selectedPreset.value}`;
    const settings = Array.from(inputFields).map(input => input.value);
    console.log('Settings to save:', settings);

    // Fetch existing presets, update, and save
    fetch('/api/presets')
      .then(response => response.json())
      .then(data => {
        data[presetName] = settings;
        return fetch('/api/presets', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        });
      })
      .then(() => alert(`Settings saved to ${presetName}`))
      .catch(error => console.error('Error saving presets:', error));
  } else {
    console.log('No preset selected');
    alert('Please select a preset to save.');
  }
});

// Load settings from a preset
presets.forEach(preset => {
  document.getElementById(preset).addEventListener('click', () => {
    console.log(`Loading settings for ${preset}`);
    fetch('/api/presets')
      .then(response => response.json())
      .then(data => {
        const settings = data[preset];
        if (settings) {
          console.log('Loaded settings:', settings);
          settings.forEach((value, index) => {
            inputFields[index].value = value;
          });
          currentSettings = settings; // Store the loaded settings
        } else {
          console.log('No settings found for this preset');
          alert('No settings saved for this preset');
        }
      })
      .catch(error => console.error('Error loading presets:', error));
  });
});

// Send MQTT command when the "Start" button is clicked
document.getElementById('sendbutton').addEventListener('click', () => {
  console.log('Start button clicked');
  if (currentSettings.length > 0) {
    console.log('Current settings:', currentSettings);
    sendMQTTCommands(currentSettings);
  } else {
    console.log('No settings loaded');
    alert('No settings loaded. Please select a preset first.');
  }
});

// Function to send MQTT commands
async function sendMQTTCommands(settings) {
  console.log('Sending MQTT commands');
  // Send tank number command
  sendMQTTCommand('DIPSW_0', 1, 93, settings[0]);

  // Define devices and their act_id
  const devices = [
    { act_id: 1, value: settings[1] },
    { act_id: 2, value: settings[2] },
    { act_id: 3, value: settings[3] },
    { act_id: 4, value: settings[4] }
  ];

  // Process each device sequentially
  for (const device of devices) {
    console.log(`Sending ON command for act_id: ${device.act_id}`);
    sendMQTTCommand('DIPSW_1', device.act_id, 91, 3); // ON

    // Wait for the specified time before sending the OFF command
    await new Promise(resolve => setTimeout(resolve, device.value * 1000));

    console.log(`Sending OFF command for act_id: ${device.act_id}`);
    sendMQTTCommand('DIPSW_1', device.act_id, 93, 3); // OFF
  }
}

function sendMQTTCommand(topic, act_id, opmode, pwm) {
  const message = JSON.stringify({ act_id, opmode, pwm });
  console.log('Publishing MQTT message:', message);
  client.publish(topic, message, (err) => {
    if (err) {
      console.error('Error publishing MQTT message:', err);
    } else {
      console.log('MQTT message sent:', message);
    }
  });
}