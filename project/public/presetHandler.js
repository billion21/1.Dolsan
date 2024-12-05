const inputFields = document.querySelectorAll('#box input[type="number"]');
const presets = ['preset1', 'preset2', 'preset3'];
let currentSettings = [];

const startButton = document.getElementById('sendbutton');
const stopButton = document.getElementById('stopbutton');
const saveButton = document.getElementById('savePreset');

// Save current settings to a selected preset
saveButton.addEventListener('click', () => {
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

// Send start command to the server
startButton.addEventListener('click', () => {
    console.log('Start button clicked');
    if (currentSettings.length > 0) {
        const settings = {
            tankNumber: currentSettings[0],
            siloMotorRight: currentSettings[1],
            siloMotorLeft: currentSettings[2],
            rotaryValve: currentSettings[3],
            blower: currentSettings[4]
        };
        startButton.disabled = true; // Disable start button
        fetch('/api/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        })
        .then(response => response.json())
        .then(data => {
            console.log('Process completed or halted:', data);
            // Re-enable buttons after process completion or halt
            startButton.disabled = false;
            stopButton.disabled = false;
            saveButton.disabled = false;
        })
        .catch(error => {
            console.error('Error starting process:', error);
            startButton.disabled = false; // Re-enable start button on error
            stopButton.disabled = false; // Re-enable stop button on error
            saveButton.disabled = false; // Re-enable save button on error
        });
    } else {
        console.log('No settings loaded');
        alert('No settings loaded. Please select a preset first.');
    }
});

// Send stop command to the server
stopButton.addEventListener('click', () => {
    console.log('Stop button clicked');
    stopButton.disabled = true; // Disable stop button
    fetch('/api/stop', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        console.log('Stop requested:', data);
        // Wait for the server to confirm halting
        const checkHalting = setInterval(() => {
            fetch('/api/check-status')
                .then(response => response.json())
                .then(status => {
                    if (status.halted) {
                        console.log('Process halted');
                        clearInterval(checkHalting);
                        // Re-enable buttons after process is halted
                        startButton.disabled = false;
                        stopButton.disabled = false;
                        saveButton.disabled = false;
                    }
                })
                .catch(error => {
                    console.error('Error checking process status:', error);
                    clearInterval(checkHalting);
                    stopButton.disabled = false; // Re-enable stop button on error
                });
        }, 1000); // Check every second
    })
    .catch(error => {
        console.error('Error stopping process:', error);
        stopButton.disabled = false; // Re-enable stop button on error
    });
});