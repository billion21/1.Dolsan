const inputFields = document.querySelectorAll('#box input[type="number"]');
const presets = ['preset1', 'preset2', 'preset3'];
let currentSettings = [];

// Save current settings to a selected preset
document.getElementById('savePreset').addEventListener('click', () => {
  const presetName = prompt('Enter preset number (1, 2, or 3):');
  if (presets.includes(`preset${presetName}`)) {
    const settings = Array.from(inputFields).map(input => input.value);
    localStorage.setItem(`preset${presetName}`, JSON.stringify(settings));
    alert(`Settings saved to Preset ${presetName}`);
  } else {
    alert('Invalid preset number');
  }
});

// Load settings from a preset and send as MQTT command
presets.forEach(preset => {
  document.getElementById(preset).addEventListener('click', () => {
    const settings = JSON.parse(localStorage.getItem(preset));
    if (settings) {
      settings.forEach((value, index) => {
        inputFields[index].value = value;
      });
      currentSettings = settings; // Store the loaded settings
    } else {
      alert('No settings saved for this preset');
    }
  });
});

// Send MQTT command when the "Start" button is clicked
document.getElementById('sendbutton').addEventListener('click', () => {
  if (currentSettings.length > 0) {
    sendMQTTCommand(currentSettings);
  } else {
    alert('No settings loaded. Please select a preset first.');
  }
});

// Function to send MQTT command
function sendMQTTCommand(settings) {
  const mqttCommand = {
    command: 'setSettings',
    data: settings
  };
  console.log('Sending MQTT command:', JSON.stringify(mqttCommand));
}