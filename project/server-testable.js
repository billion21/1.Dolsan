const express = require('express');
const path = require('path');
const fs = require('fs');
const mqtt = require('mqtt');

const app = express();
const PORT = 3100;
const presetFilePath = path.join(__dirname, 'presets.json');

// For testing, allow MQTT client to be mocked
let client;
if (process.env.NODE_ENV === 'test') {
    // In test environment, mqtt.connect will be mocked
    client = mqtt.connect('ws://192.168.2.55:9001', {
        clientId: 'server_mqtt_client',
    });
} else {
    client = mqtt.connect('ws://192.168.2.55:9001', {
        clientId: 'server_mqtt_client',
    });
}

client.on('packetsend', (packet) => {
    // console.log('Packet sent:', packet);
});

client.on('packetreceive', (packet) => {
    // console.log('Packet received:', packet);
});

let stopRequested = false; // Flag to control stopping
let processRunning = false; // Flag to indicate if the process is running
let mqttConnected = false; // Flag to indicate MQTT connection status

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
});

// MQTT connection event
client.on('connect', () => {
    console.log('MQTT client connected');
    mqttConnected = true;
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
    if (!mqttConnected && process.env.NODE_ENV !== 'test') {
        return res.status(500).json({ message: 'MQTT client not connected' });
    }

    const settings = req.body;
    console.log('Received start command with settings:', settings);
    stopRequested = false; // Reset stop flag
    processRunning = true; // Set process as running
    await processCommands(settings);
    processRunning = false; // Set process as not running
    res.status(200).json({ message: 'Process completed or halted' });
});

// Endpoint to stop the process - UPDATED FOR BATCH APPROACH
app.post('/api/stop', (req, res) => {
    console.log('Received stop command');
    stopRequested = true;
    
    // Generate immediate stop commands for all devices
    const stopCommands = generateStopAllBatch();
    sendBatchMQTTCommands(stopCommands);
    
    res.status(200).json({ message: 'Stop commands sent with timing information' });
});

// Endpoint to check process status
app.get('/api/check-status', (req, res) => {
    res.status(200).json({ halted: !processRunning });
});

// Endpoint to handle MQTT commands - UPDATED FOR NEW FORMAT
app.post('/api/mqtt-command', (req, res) => {
    let { topic, act_id, opmode, pwm, timing } = req.body;
    if (!mqttConnected && process.env.NODE_ENV !== 'test') {
        return res.status(500).json({ message: 'MQTT client not connected' });
    }
    act_id = parseInt(act_id, 10);

    // If timing information is provided, use new format; otherwise use legacy format
    if (timing) {
        const message = JSON.stringify({
            act_id,
            opmode,
            pwm,
            timing,
            batch_id: `manual_${Date.now()}`,
            command_index: 0
        });
        console.log('Publishing MQTT command with timing:', message);
        client.publish(topic, message);
    } else {
        // Legacy support for backward compatibility
        sendMQTTCommand(topic, act_id, opmode, pwm);
    }
    
    res.status(200).json({ message: 'MQTT command sent' });
});

// Endpoint to start an individual item - UPDATED FOR BATCH APPROACH
app.post('/api/start-item', (req, res) => {
    let { actId, duration } = req.body;
    if (!mqttConnected && process.env.NODE_ENV !== 'test') {
        return res.status(500).json({ message: 'MQTT client not connected' });
    }

    actId = parseInt(actId, 10);
    duration = parseInt(duration, 10);

    if (actId === 0) {
        // Tank number command - send immediately with new format
        const tankCommand = {
            act_id: 1,
            opmode: 93,
            pwm: duration,
            timing: {
                delay: 0,
                timestamp: Math.floor(Date.now() / 1000),
                duration: 0
            }
        };
        
        const message = JSON.stringify(tankCommand);
        console.log('Publishing tank command with timing:', message);
        client.publish('DIPSW_0', message);
    } else {
        console.log(`Received start command for act_id: ${actId} with duration: ${duration}`);
        
        // Generate batch commands for start and stop
        const batchCommands = generateIndividualItemBatch(actId, duration);
        sendBatchMQTTCommands(batchCommands);
    }

    res.status(200).json({ message: 'Item command processed with timing information' });
});

// Function to process commands - NEW BATCH APPROACH
async function processCommands(settings) {
    console.log('Processing commands with batch approach');
    
    const batchCommands = generateBatchCommands(settings);
    
    // Send all commands in a single batch
    sendBatchMQTTCommands(batchCommands);
    
    console.log('All commands sent in batch. IoT devices will handle timing.');
}

// Function to generate batch commands with timing information
function generateBatchCommands(settings) {
    const commands = [];
    const baseTimestamp = Math.floor(Date.now() / 1000); // Current Unix timestamp
    let currentDelay = 0;

    // Tank number command (immediate execution)
    commands.push({
        topic: 'DIPSW_0',
        act_id: 1,
        opmode: 93,
        pwm: parseInt(settings.tankNumber),
        timing: {
            delay: currentDelay,
            timestamp: baseTimestamp + currentDelay,
            duration: 0
        }
    });

    // Wait 25 seconds before starting device commands
    currentDelay += 25;

    // Define devices and their act_id
    const devices = [
        { act_id: 1, value: parseInt(settings.siloMotorRight), name: 'siloMotorRight' },
        { act_id: 2, value: parseInt(settings.siloMotorLeft), name: 'siloMotorLeft' },
        { act_id: 3, value: parseInt(settings.rotaryValve), name: 'rotaryValve' },
        { act_id: 4, value: parseInt(settings.blower), name: 'blower' }
    ];

    // Generate ON and OFF commands for each device
    for (const device of devices) {
        // ON command
        commands.push({
            topic: 'DIPSW_1',
            act_id: device.act_id,
            opmode: 91,
            pwm: 3,
            timing: {
                delay: currentDelay,
                timestamp: baseTimestamp + currentDelay,
                duration: device.value
            }
        });

        // OFF command (scheduled after device duration)
        currentDelay += device.value;
        commands.push({
            topic: 'DIPSW_1',
            act_id: device.act_id,
            opmode: 93,
            pwm: 3,
            timing: {
                delay: currentDelay,
                timestamp: baseTimestamp + currentDelay,
                duration: 0
            }
        });
    }

    return {
        batch_id: `batch_${Date.now()}`,
        total_commands: commands.length,
        total_duration: currentDelay,
        commands: commands
    };
}

// Function to generate batch commands for individual item control
function generateIndividualItemBatch(actId, duration) {
    const commands = [];
    const baseTimestamp = Math.floor(Date.now() / 1000);

    // Start command (immediate)
    commands.push({
        topic: 'DIPSW_1',
        act_id: actId,
        opmode: 91,
        pwm: 1,
        timing: {
            delay: 0,
            timestamp: baseTimestamp,
            duration: duration
        }
    });

    // Stop command (after duration)
    commands.push({
        topic: 'DIPSW_1',
        act_id: actId,
        opmode: 93,
        pwm: 1,
        timing: {
            delay: duration,
            timestamp: baseTimestamp + duration,
            duration: 0
        }
    });

    return {
        batch_id: `individual_${actId}_${Date.now()}`,
        total_commands: commands.length,
        total_duration: duration,
        commands: commands
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

// Legacy function for individual commands (kept for backward compatibility)
function sendMQTTCommand(topic, act_id, opmode, pwm) {
    if (!mqttConnected && process.env.NODE_ENV !== 'test') {
        console.error('Cannot send MQTT command, client not connected');
        return;
    }

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

// New function to send batch commands with timing information
function sendBatchMQTTCommands(batchData) {
    if (!mqttConnected && process.env.NODE_ENV !== 'test') {
        console.error('Cannot send batch MQTT commands, client not connected');
        return;
    }

    console.log(`Sending batch of ${batchData.total_commands} commands with batch_id: ${batchData.batch_id}`);
    console.log(`Total estimated duration: ${batchData.total_duration} seconds`);

    // Send each command to its respective topic with timing information
    batchData.commands.forEach((command, index) => {
        const message = JSON.stringify({
            act_id: command.act_id,
            opmode: command.opmode,
            pwm: command.pwm,
            timing: command.timing,
            batch_id: batchData.batch_id,
            command_index: index
        });

        console.log(`Publishing batch command ${index + 1}/${batchData.total_commands} to ${command.topic}:`, message);
        
        client.publish(command.topic, message, (err) => {
            if (err) {
                console.error(`Error publishing batch command ${index + 1}:`, err);
            } else {
                console.log(`Batch command ${index + 1} sent successfully`);
            }
        });
    });

    console.log('All batch commands sent. IoT devices will handle scheduling.');
}

// Only start the server if not in test mode
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Server is running at http://localhost:${PORT}`);
    });
}

module.exports = app;
