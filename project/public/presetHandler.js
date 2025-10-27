document.addEventListener('DOMContentLoaded', () => {
    // const client = mqtt.connect('ws://192.168.2.55:9001'); // Use WebSocket connection
    const inputFields = document.querySelectorAll('#box input[type="number"]');
    const presets = ['preset1', 'preset2', 'preset3', 'preset4'];
    let currentSettings = [];

    // Get all input fields for duration and time
    const durationFields = document.querySelectorAll('.timer-box');
    const timeFields = document.querySelectorAll('.time-box');

    const startButton = document.getElementById('sendbutton');
    const stopButton = document.getElementById('stopbutton');
    const saveButton = document.getElementById('savePreset');
    // Fallback status stream via SSE if WebSocket MQTT fails repeatedly
    let useSSEFallback = false;
    let sseEvtSrc = null;


    // Client-side MQTT via WebSocket for status monitoring
    let mqttClient;
    try {
        // Resolve WebSocket URL: allow ?mqtt_ws= override; fallback to LAN broker; else same host:9001
        const qp = new URLSearchParams(window.location.search);
        const overrideWS = qp.get('mqtt_ws') || (window.MQTT_WS_URL || '');
        const sameHost = `ws://${window.location.hostname}:9001`;
        const lanDefault = 'ws://192.168.2.55:9001';
        const wsUrl = overrideWS || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? lanDefault : sameHost);

        console.log('Status MQTT connecting to', wsUrl);
        mqttClient = mqtt.connect(wsUrl);
        // Helper: parse JSON or JSON-like (JS object literal) payloads
        function parseStatusPayload(raw) {
            try {
                return { obj: JSON.parse(raw), usedFallback: false, error: null };
            } catch (e1) {
                try {
                    let normalized = String(raw).trim();
                    normalized = normalized.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
                    normalized = normalized.replace(/'([^']*)'/g, '"$1"');
                    normalized = normalized.replace(/,\s*([}\]])/g, '$1');
                    return { obj: JSON.parse(normalized), usedFallback: true, error: null };
                } catch (e2) {
                    return { obj: null, usedFallback: true, error: e2 };
                }
            }
        }

        mqttClient.on('connect', () => {
            console.log('Status MQTT connected to', wsUrl);
            try {
                mqttClient.subscribe('DIPSW_1_cv', (err) => {
                    if (err) console.error('Subscribe error:', err);
                    else console.log('Subscribed to DIPSW_1_cv');
                });
            } catch (e) { console.error('Subscribe failed:', e); }
        });
        mqttClient.on('message', (topic, payload) => {
            if (topic !== 'DIPSW_1_cv') return;
            try {
                const raw = payload.toString();
                const parsed = parseStatusPayload(raw);
                if (!parsed.obj) { console.error('Status parse failed:', parsed.error && parsed.error.message, 'raw=', raw); return; }
                const msg = parsed.obj;
                const actId = parseInt(msg.act_id, 10);
                const timeout = parseInt(msg.timeout, 10);
                if (![1,2,3,4].includes(actId) || (timeout !== 0 && timeout !== 1)) return;
                // Map to status-dot element: #status-{actId}-{timeout}
                const dot = document.getElementById(`status-${actId}-${timeout}`);
                if (!dot) return;
                dot.classList.add('active');


            } catch (e) {
                console.error('Invalid status message:', e);
            }
        });
        let wsRetryCount = 0;
        mqttClient.on('error', (e) => console.error('Status MQTT error:', e));
        mqttClient.on('reconnect', () => {
            wsRetryCount++;
            console.log('Status MQTT reconnecting...', wsRetryCount);
            if (!useSSEFallback && wsRetryCount >= 5) {
                console.warn('Switching to SSE fallback for status stream');
                useSSEFallback = true;
                try {
                    if (mqttClient && mqttClient.end) mqttClient.end(true);
                } catch (_) {}
                // Start SSE fallback
                try {
                    sseEvtSrc = new EventSource('/api/status-stream');
                    sseEvtSrc.onmessage = (evt) => {
                        try {
                            const msg = JSON.parse(evt.data);
                            const actId = parseInt(msg.act_id, 10);
                            const timeout = parseInt(msg.timeout, 10);
                            if (![1,2,3,4].includes(actId) || (timeout !== 0 && timeout !== 1)) return;
                            const dot = document.getElementById(`status-${actId}-${timeout}`);
                            if (!dot) return;
                            dot.classList.add('active');

                        } catch (e) { console.error('SSE parse fail:', e); }
                    };
                    sseEvtSrc.onerror = (e) => console.error('SSE error:', e);
                    console.log('SSE fallback connected');
                } catch (e) {
                    console.error('Failed to init SSE fallback:', e);
                }
            }
        });
    } catch (e) {
        console.error('Status MQTT init failed:', e);
        // try SSE right away as a last resort
        try {
            sseEvtSrc = new EventSource('/api/status-stream');
            console.log('SSE fallback connected (WS init failed)');
        } catch (e2) { console.error('SSE fallback also failed:', e2); }
    }

    // Helper: clear status indicators on Start
    function clearStatusDots() {
        document.querySelectorAll('.status-dot.active').forEach(el => el.classList.remove('active'));
    }

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

            // Collect both duration and time values
            const settings = {
                tankNumber: document.getElementById('tank-number').value,
                siloMotorRight: document.getElementById('silo-motor-right').value,
                siloMotorRightTime: document.getElementById('silo-motor-right-time').value,
                siloMotorLeft: document.getElementById('silo-motor-left').value,
                siloMotorLeftTime: document.getElementById('silo-motor-left-time').value,
                rotaryValve: document.getElementById('rotary-valve').value,
                rotaryValveTime: document.getElementById('rotary-valve-time').value,
                blower: document.getElementById('blower').value,
                blowerTime: document.getElementById('blower-time').value
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
                            document.getElementById('tank-number').value = settings[0] || '';
                            document.getElementById('silo-motor-right').value = settings[1] || '';
                            document.getElementById('silo-motor-right-time').value = 0;
                            document.getElementById('silo-motor-left').value = settings[2] || '';
                            document.getElementById('silo-motor-left-time').value = 0;
                            document.getElementById('rotary-valve').value = settings[3] || '';
                            document.getElementById('rotary-valve-time').value = 0;
                            document.getElementById('blower').value = settings[4] || '';
                            document.getElementById('blower-time').value = 0;
                        } else {
                            // New object format
                            document.getElementById('tank-number').value = settings.tankNumber || '';
                            document.getElementById('silo-motor-right').value = settings.siloMotorRight || '';
                            document.getElementById('silo-motor-right-time').value = settings.siloMotorRightTime || 0;
                            document.getElementById('silo-motor-left').value = settings.siloMotorLeft || '';
                            document.getElementById('silo-motor-left-time').value = settings.siloMotorLeftTime || 0;
                            document.getElementById('rotary-valve').value = settings.rotaryValve || '';
                            document.getElementById('rotary-valve-time').value = settings.rotaryValveTime || 0;
                            document.getElementById('blower').value = settings.blower || '';
                            document.getElementById('blower-time').value = settings.blowerTime || 0;
                        }

                        currentSettings = settings; // Store the loaded settings
                    } else {
                        console.log('No settings found for this preset');
                        alert('No settings saved for this preset');
                    }
                })
                .catch(error => console.error('Error loading presets:', error));
        });
    });

    // Send start command to the server (collect directly from UI)
    startButton.addEventListener('click', () => {
        console.log('Start button clicked');
        try {
            const settings = {
                tankNumber: parseInt(document.getElementById('tank-number').value, 10),

                siloMotorRight: parseInt(document.getElementById('silo-motor-right').value, 10),
                siloMotorRightTime: parseInt(document.getElementById('silo-motor-right-time').value, 10) || 0,

                siloMotorLeft: parseInt(document.getElementById('silo-motor-left').value, 10),
                siloMotorLeftTime: parseInt(document.getElementById('silo-motor-left-time').value, 10) || 0,

                rotaryValve: parseInt(document.getElementById('rotary-valve').value, 10),
                rotaryValveTime: parseInt(document.getElementById('rotary-valve-time').value, 10) || 0,

                blower: parseInt(document.getElementById('blower').value, 10),
                blowerTime: parseInt(document.getElementById('blower-time').value, 10) || 0
            };

            // Basic validation
            if (isNaN(settings.tankNumber)) throw new Error('Invalid tank number');
            ['siloMotorRight','siloMotorLeft','rotaryValve','blower'].forEach(k => {
                if (isNaN(settings[k]) || settings[k] < 0) throw new Error('Invalid value for ' + k);
            });

            console.log('Sending settings with time fields:', settings);
            clearStatusDots();
            startButton.disabled = true; // Disable start button
            fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            })
            .then(response => response.json())
            .then(data => {
                console.log('Process completed or halted:', data);
                startButton.disabled = false;
                stopButton.disabled = false;
                saveButton.disabled = false;
            })
            .catch(error => {
                console.error('Error starting process:', error);
                startButton.disabled = false;
                stopButton.disabled = false;
                saveButton.disabled = false;
            });
        } catch (e) {
            console.error('Validation error:', e);
            alert('입력값을 확인하세요.');
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

    // Function to send MQTT command with time field
    function sendMQTTCommand(topic, act_id, opmode, pwm, time = 0) {
        fetch('/api/mqtt-command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ topic, act_id, opmode, pwm, time })
        })
        .then(response => response.json())
        .then(data => console.log('MQTT command sent:', data))
        .catch(error => console.error('Error sending MQTT command:', error));
    }

    // Per-item start/stop buttons have been removed from UI; no per-item listeners are needed.
    // Timing and emergency stop are handled via main Start/Stop buttons and embedded firmware.
});