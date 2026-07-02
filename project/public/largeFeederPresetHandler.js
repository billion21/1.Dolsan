// Large Feeder Preset Handler
// This file replicates the exact same preset functionality from presetHandler.js
// for the large feeder control panel

document.addEventListener('DOMContentLoaded', () => {
    const presets = ['largePreset1', 'largePreset2', 'largePreset3', 'largePreset4'];
    const saveButton = document.getElementById('saveLargePreset');

    // Save current settings to a selected preset
    saveButton.addEventListener('click', () => {
        console.log('Large feeder save button clicked');
        const selectedPreset = document.querySelector('input[name="largePreset"]:checked');
        if (selectedPreset) {
            console.log('Preset selected:', selectedPreset.value);
            const presetName = `${selectedPreset.value}`;

            // Collect both duration and time values
            const settings = {
                tankNumber: document.getElementById('tankNumber').value,
                siloMotorRight: document.getElementById('siloMotorRight').value,
                siloMotorRightTime: document.getElementById('siloMotorRightTime').value,
                siloMotorLeft: document.getElementById('siloMotorLeft').value,
                siloMotorLeftTime: document.getElementById('siloMotorLeftTime').value,
                rotaryValve: document.getElementById('rotaryValve').value,
                rotaryValveTime: document.getElementById('rotaryValveTime').value,
                blower: document.getElementById('blower').value,
                blowerTime: document.getElementById('blowerTime').value
            };

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

                        // Handle both old array format and new object format
                        if (Array.isArray(settings)) {
                            // Legacy format - convert to new format
                            document.getElementById('tankNumber').value = settings[0] || '';
                            document.getElementById('siloMotorRight').value = settings[1] || '';
                            document.getElementById('siloMotorRightTime').value = 0;
                            document.getElementById('siloMotorLeft').value = settings[2] || '';
                            document.getElementById('siloMotorLeftTime').value = 0;
                            document.getElementById('rotaryValve').value = settings[3] || '';
                            document.getElementById('rotaryValveTime').value = 0;
                            document.getElementById('blower').value = settings[4] || '';
                            document.getElementById('blowerTime').value = 0;
                        } else {
                            // New object format
                            document.getElementById('tankNumber').value = settings.tankNumber || '';
                            document.getElementById('siloMotorRight').value = settings.siloMotorRight || '';
                            document.getElementById('siloMotorRightTime').value = settings.siloMotorRightTime || 0;
                            document.getElementById('siloMotorLeft').value = settings.siloMotorLeft || '';
                            document.getElementById('siloMotorLeftTime').value = settings.siloMotorLeftTime || 0;
                            document.getElementById('rotaryValve').value = settings.rotaryValve || '';
                            document.getElementById('rotaryValveTime').value = settings.rotaryValveTime || 0;
                            document.getElementById('blower').value = settings.blower || '';
                            document.getElementById('blowerTime').value = settings.blowerTime || 0;
                        }
                    } else {
                        console.log('No settings found for this preset');
                        alert('No settings saved for this preset');
                    }
                })
                .catch(error => console.error('Error loading presets:', error));
        });
    });
});

