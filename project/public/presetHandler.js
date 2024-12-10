document.addEventListener('DOMContentLoaded', () => {

    // const client = mqtt.connect('ws://192.168.2.55:9001'); // Use WebSocket connection
    const inputFields = document.querySelectorAll('#box input[type="number"]');
    const presets = ['preset1', 'preset2', 'preset3'];
    let currentSettings = [];

    const startButton = document.getElementById('sendbutton');
    const stopButton = document.getElementById('stopbutton');
    const saveButton = document.getElementById('savePreset');

    // Connect to the MQTT broker
    // client.on('connect', () => {
    //   console.log('Connected to MQTT broker');
    // });

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

    // Function to send MQTT command
    function sendMQTTCommand(topic, act_id, opmode, pwm) {
        fetch('/api/mqtt-command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ topic, act_id, opmode, pwm })
        })
        .then(response => response.json())
        .then(data => console.log('MQTT command sent:', data))
        .catch(error => console.error('Error sending MQTT command:', error));
    }

    // Add event listeners for individual item start/stop buttons
    document.querySelectorAll('.item').forEach(item => {
        const actId = item.getAttribute('data-act-id');
        const startButton = item.querySelector('.item-start');
        const stopButton = item.querySelector('.item-stop');
        const durationInput = item.querySelector('.timer-box');

        if (startButton) {
            startButton.addEventListener('click', () => {
                if (actId === "0") {
                    const tankNumberInput = item.querySelector('#tank-number');
                    const tankNumber = tankNumberInput.value;
                    if (tankNumber) {
                        console.log(`Starting tank with act_id: ${tankNumber}`);
                        sendMQTTCommand('DIPSW_0', tankNumber, 93, tankNumber); // Send start command for tank
                    } else {
                        console.error('Tank number is not specified');
                    }
                } else {
                    const duration = parseInt(durationInput.value, 10);
                    if (isNaN(duration) || duration <= 0) {
                        console.error('Invalid duration specified');
                        return;
                    }

                    console.log(`Starting item with act_id: ${actId} for ${duration} seconds`);
                    sendMQTTCommand('DIPSW_1', actId, 91, 3); // Send start command

                    // Automatically send stop command after the specified duration
                    setTimeout(() => {
                        console.log(`Automatically stopping item with act_id: ${actId}`);
                        sendMQTTCommand('DIPSW_1', actId, 93, 3); // Send stop command
                    }, duration * 1000);
                }
            });
        }

        if (stopButton) {
            stopButton.addEventListener('click', () => {
                console.log(`Stopping item with act_id: ${actId}`);
                sendMQTTCommand('DIPSW_1', actId, 93, 3); // Send stop command
            });
        }
    });
});