const express = require('express');
const path = require('path');
const fs = require('fs');
const mqtt = require('mqtt');

const app = express();
const PORT = 3100;
const presetFilePath = path.join(__dirname, 'presets.json');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const client = mqtt.connect(MQTT_URL, {
    clientId: 'server_mqtt_client_' + Math.random().toString(16).slice(2, 8),
    reconnectPeriod: 2000,
    keepalive: 60,
});

client.on('packetsend', (packet) => {
    // console.log('Packet sent:', packet);
});

client.on('packetreceive', (packet) => {
    // console.log('Packet received:', packet);
});

let stopRequested = false; // Flag to control stopping
let processRunning = false; // Flag to indicate if the process is running
let mqttConnected = false; // Flag to indicate MQTT connection status
// SSE clients for status relay to browsers
const statusSSEClients = new Set();


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
});
// SSE endpoint: relay DIPSW_1_cv status to browsers
app.get('/api/status-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
    res.write(': connected\n\n');

    statusSSEClients.add(res);
    console.log('SSE client connected. Total:', statusSSEClients.size);

    req.on('close', () => {
        statusSSEClients.delete(res);
        console.log('SSE client disconnected. Total:', statusSSEClients.size);
    });
});

function broadcastStatus(obj) {
    const data = JSON.stringify(obj);
    for (const clientRes of statusSSEClients) {
        try { clientRes.write(`data: ${data}\n\n`); }
        catch (e) { /* ignore write errors, cleanup on close */ }
    }
}


// MQTT connection event
client.on('connect', () => {
    console.log('MQTT client connected');
    mqttConnected = true;
    try {
        client.subscribe('DIPSW_1_cv', (err) => {
            if (err) {
                console.error('Subscribe error for DIPSW_1_cv:', err);
            } else {
                console.log('Subscribed to DIPSW_1_cv for status monitoring');
            }
        });
    } catch (e) {
        console.error('Subscribe exception for DIPSW_1_cv:', e);
    }
});
// Helper: parse JSON or JSON-like (JS object literal) payloads safely
function parseStatusPayload(raw) {
    // Attempt standard JSON first
    try {
        const obj = JSON.parse(raw);
        return { obj, usedFallback: false, error: null };
    } catch (e1) {
        // Fallback: quote unquoted keys, normalize single quotes, strip trailing commas
        try {
            let normalized = String(raw).trim();
            // Add quotes around unquoted property names (simple identifier keys)
            normalized = normalized.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
            // Convert single-quoted strings to double-quoted strings
            normalized = normalized.replace(/'([^']*)'/g, '"$1"');
            // Remove trailing commas before closing braces/brackets
            normalized = normalized.replace(/,\s*([}\]])/g, '$1');
            const obj = JSON.parse(normalized);
            return { obj, usedFallback: true, error: null };
        } catch (e2) {
            return { obj: null, usedFallback: true, error: e2 };
        }
    }
}

// Server-side status monitoring: log all DIPSW_1_cv messages
client.on('message', (topic, message) => {
    if (topic !== 'DIPSW_1_cv') return;
    const ts = new Date().toISOString().replace('T',' ').replace('Z','');
    const raw = message ? message.toString() : '';
    console.log(`[${ts}] DIPSW_1_cv received: ${raw}`);
    const parsed = parseStatusPayload(raw);
    if (!parsed.obj) {
        console.error(' → Malformed DIPSW_1_cv message (parse failed):', parsed.error && parsed.error.message);
        return;
    }
    const obj = parsed.obj;
    const actId = obj && obj.act_id !== undefined ? obj.act_id : undefined;
    const cmd = obj && obj.cmd !== undefined ? obj.cmd : undefined;
    const timeout = obj && obj.timeout !== undefined ? obj.timeout : undefined;
    console.log(` → Parsed${parsed.usedFallback ? ' (fallback)' : ''}: act_id=${actId}, cmd=${JSON.stringify(cmd)}, timeout=${timeout}`);
    // Relay to browsers via SSE (non-blocking best-effort)
    try { broadcastStatus({ act_id: actId, cmd, timeout }); } catch (_) {}
    // Optional validation logging
    if (![1,2,3,4].includes(parseInt(actId))) {
        console.warn('   ! act_id out of expected range:', actId);
    }
    if (!(timeout === 0 || timeout === 1)) {
        console.warn('   ! timeout not 0/1:', timeout);
    }
});


// MQTT error event
client.on('error', (err) => {
    console.error('MQTT connection error:', err);
    mqttConnected = false;
});

// Endpoint to save presets
app.post('/api/presets', (req, res) => {
    const presets = req.body;
    fs.writeFile(presetFilePath, JSON.stringify(presets, null, 2), 'utf8', (err) => {
        if (err) {
            console.error('Error writing presets file:', err);
            res.status(500).send('Internal Server Error');
        } else {
            res.status(200).send('Presets saved successfully');
        }
    });
});

// Endpoint to load presets
app.get('/api/presets', (req, res) => {
    fs.readFile(presetFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading presets file:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        } else {
            res.json(JSON.parse(data));
        }
    });
});

// Endpoint to start the process
app.post('/api/start', async (req, res) => {
    try {
        const settings = req.body;
        console.log('Received start command with settings:', settings);

        // Validate input settings
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ message: 'Invalid settings provided' });
        }

        // Check for required fields
        const requiredFields = ['tankNumber', 'siloMotorRight', 'siloMotorLeft', 'rotaryValve', 'blower'];
        for (const field of requiredFields) {
            if (!(field in settings)) {
                return res.status(400).json({ message: `Missing required field: ${field}` });
            }
        }

        // Set default time values if not provided (excluding tank)
        settings.siloMotorRightTime = settings.siloMotorRightTime || 0;
        settings.siloMotorLeftTime = settings.siloMotorLeftTime || 0;
        settings.rotaryValveTime = settings.rotaryValveTime || 0;
        settings.blowerTime = settings.blowerTime || 0;

        stopRequested = false; // Reset stop flag
        processRunning = true; // Set process as running

        // Process commands (works with or without MQTT connection)
        await processCommands(settings);

        processRunning = false; // Set process as not running
        res.status(200).json({
            message: 'Process completed or halted',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected',
            note: mqttConnected ? 'Commands sent to MQTT broker' : 'Commands generated (MQTT broker not available)'
        });
    } catch (error) {
        console.error('Error in /api/start endpoint:', error);
        processRunning = false;
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Endpoint to stop the process - EMERGENCY STOP (opmode 64, act_id 5)
app.post('/api/stop', (req, res) => {
    console.log('Received EMERGENCY STOP');
    const msg = { act_id: 5, opmode: 64, pwm: 0, time: 0 };
    const payload = JSON.stringify(msg);
    console.log('TX EMERGENCY:', payload);
    client.publish('DIPSW_1', payload, (err) => {
        if (err) {
            console.error('ERR EMERGENCY publish:', err);
            return res.status(500).json({ message: 'Emergency stop publish failed' });
        }
        res.status(200).json({ message: 'Emergency stop sent', details: msg });
    });
});

// Endpoint to check process status
app.get('/api/check-status', (req, res) => {
    res.status(200).json({ halted: !processRunning });
});

// Endpoint to handle MQTT commands - UPDATED FOR NEW FORMAT WITH TIME FIELD
app.post('/api/mqtt-command', (req, res) => {
    try {
        let { topic, act_id, opmode, pwm, time } = req.body;

        // Validate input
        if (!topic || act_id === undefined || opmode === undefined || pwm === undefined) {
            return res.status(400).json({ message: 'Missing required fields: topic, act_id, opmode, pwm' });
        }

        act_id = parseInt(act_id, 10);
        pwm = parseInt(pwm, 10);

        // Parse and validate time field (0.1 second units)
        if (time !== undefined) {
            time = parseInt(time, 10);
            if (isNaN(time) || time < 0) {
                return res.status(400).json({ message: 'Invalid time value - must be a non-negative integer' });
            }
        }

        // Simplified MQTT message format - only essential 4 fields
        const simplifiedMessage = {
            act_id,
            opmode,
            pwm,
            time: time || 0 // Default to 0 if not provided
        };

        const messageStr = JSON.stringify(simplifiedMessage);
        console.log('Simplified MQTT command (4 fields only):', messageStr);

        if (mqttConnected) {
            client.publish(topic, messageStr, (err) => {
                if (err) {
                    console.error('Error publishing simplified MQTT message:', err);
                } else {
                    console.log('Simplified MQTT message sent successfully:', messageStr);
                }
            });
        } else {
            console.log('[SIMULATION] Simplified command ready for MQTT broker');
        }

        res.status(200).json({
            message: 'MQTT command processed',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('Error in /api/mqtt-command endpoint:', error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Endpoint to start an individual item - UPDATED FOR BATCH APPROACH WITH TIME FIELD
app.post('/api/start-item', (req, res) => {
    try {
        let { actId, duration, time } = req.body;

        // Validate input
        if (actId === undefined || duration === undefined) {
            return res.status(400).json({ message: 'Missing actId or duration' });
        }

        actId = parseInt(actId, 10);
        duration = parseInt(duration, 10);

        // Parse and validate time field (0.1 second units)
        if (time !== undefined) {
            time = parseInt(time, 10);
            if (isNaN(time) || time < 0) {
                return res.status(400).json({ message: 'Invalid time value - must be a non-negative integer' });
            }
        } else {
            time = 0; // Default time value
        }

        // Validate parsed values
        if (isNaN(actId) || isNaN(duration)) {
            return res.status(400).json({ message: 'Invalid actId or duration - must be numbers' });
        }

        if (actId === 0) {
            // Tank number command - send ONLY act_id, opmode, pwm (no time field for tank selection)
            const tankCommand = {
                act_id: 1,
                opmode: 93,
                pwm: duration
            };

            const message = JSON.stringify(tankCommand);
            console.log('Publishing tank selection command (3 fields: act_id,opmode,pwm):', message);

            client.publish('DIPSW_0', message, (err) => {
                if (err) {
                    console.error('Error publishing tank command:', err);
                } else {
                    console.log('Tank selection command sent successfully:', message);
                }
            });
        } else {
            console.log(`Received start command for act_id: ${actId} with duration: ${duration}, time: ${time}`);

            // Generate batch commands for start and stop
            const batchCommands = generateIndividualItemBatch(actId, duration, time);
            sendBatchMQTTCommands(batchCommands);
        }

        res.status(200).json({
            message: 'Item command processed with timing information',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('Error in /api/start-item endpoint:', error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Function to process commands - NEW BATCH APPROACH
async function processCommands(settings) {
    console.log('Processing commands with batch approach');

    const batchCommands = generateBatchCommands(settings);

    // Send all commands in a single batch
    sendBatchMQTTCommands(batchCommands);

    console.log('All commands sent in batch. IoT devices will handle timing.');
}

// Function to generate batch commands (Immediate ON only; embedded handles timing)
function generateBatchCommands(settings) {
    const commands = [];

    // Tank selection command (immediate execution) - time omitted for tank
    commands.push({
        topic: 'DIPSW_0',
        act_id: 1,
        opmode: 93,
        pwm: parseInt(settings.tankNumber)
    });

    // Define devices and their act_id with time fields (0.1s units)
    const devices = [
        { act_id: 1, value: parseInt(settings.siloMotorRight), time: parseInt(settings.siloMotorRightTime) || 0, name: 'siloMotorRight' },
        { act_id: 2, value: parseInt(settings.siloMotorLeft), time: parseInt(settings.siloMotorLeftTime) || 0, name: 'siloMotorLeft' },
        { act_id: 3, value: parseInt(settings.rotaryValve), time: parseInt(settings.rotaryValveTime) || 0, name: 'rotaryValve' },
        { act_id: 4, value: parseInt(settings.blower), time: parseInt(settings.blowerTime) || 0, name: 'blower' }
    ];

    // Immediate ON using new opmode 64 for all devices, no OFF, no delay
    for (const device of devices) {
        commands.push({
            topic: 'DIPSW_1',
            act_id: device.act_id,
            opmode: 64,
            pwm: device.value,      // delay time (seconds) → pwm
            time: device.time || 0  // duration (0.1s units) → time
        });
    }

    return {
        batch_id: `batch_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands: commands
    };
}

// Function to generate individual item ON-only batch (embedded handles timing)
function generateIndividualItemBatch(actId, duration, time = 0) {
    const commands = [
        { topic: 'DIPSW_1', act_id: actId, opmode: 91, pwm: duration, time: time }
    ];
    return {
        batch_id: `individual_${actId}_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands
    };
}

// Function to generate stop commands for all devices
function generateStopAllBatch() {
    const commands = [];
    const baseTimestamp = Math.floor(Date.now() / 1000);

    // Stop commands for all devices (immediate execution)
    for (let act_id = 1; act_id <= 4; act_id++) {
        commands.push({
            topic: 'DIPSW_1',
            act_id: act_id,
            opmode: 93,
            pwm: 3,
            timing: {
                delay: 0,
                timestamp: baseTimestamp,
                duration: 0
            }
        });
    }

    return {
        batch_id: `stop_all_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands: commands
    };
}

// Simplified MQTT command function - only 4 essential fields
function sendMQTTCommand(topic, act_id, opmode, pwm, time) {
    const simplifiedMessage = { act_id, opmode, pwm, time: time || 0 };
    const messageStr = JSON.stringify(simplifiedMessage);
    console.log('Simplified MQTT message (4 fields only):', messageStr);
    client.publish(topic, messageStr, (err) => {
        if (err) console.error('Error publishing simplified MQTT message:', err);
        else console.log('Simplified MQTT message sent successfully:', messageStr);
    });
}

// New function to send batch commands with timing information
function sendBatchMQTTCommands(batchData) {
    console.log(`Generating batch of ${batchData.total_commands} commands with batch_id: ${batchData.batch_id}`);
    console.log('Immediate ON-only batch; no delayed OFF commands.');

    // Immediate publish of all commands
    batchData.commands.forEach((command, index) => {
        const simplifiedMessage = {
            act_id: command.act_id,
            opmode: command.opmode,
            pwm: command.pwm,
            time: command.time || 0
        };
        const messageStr = JSON.stringify(simplifiedMessage);
        console.log(`TX ${index + 1}/${batchData.total_commands} ${command.topic} op=${command.opmode} act=${command.act_id} pwm=${command.pwm} time=${simplifiedMessage.time}`);
        client.publish(command.topic, messageStr, (err) => {
            if (err) console.error(`ERR publishing ${index + 1}:`, err);
            else console.log(`OK  ${index + 1}/${batchData.total_commands}`);
        });
    });

    console.log('Batch publish complete.');
}

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});