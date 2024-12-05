const express = require('express');
const path = require('path');
const fs = require('fs');
const mqtt = require('mqtt');

const app = express();
const PORT = 3100;
const presetFilePath = path.join(__dirname, 'presets.json');
const client = mqtt.connect('ws://192.168.2.55:9001', {
    clientId: 'server_mqtt_client',
});

client.on('packetsend', (packet) => {
    console.log('Packet sent:', packet);
});

client.on('packetreceive', (packet) => {
    console.log('Packet received:', packet);
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
    if (!mqttConnected) {
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

// Endpoint to stop the process
app.post('/api/stop', (req, res) => {
    console.log('Received stop command');
    stopRequested = true;
    res.status(200).json({ message: 'Stop requested' });
});

// Endpoint to check process status
app.get('/api/check-status', (req, res) => {
    res.status(200).json({ halted: !processRunning });
});

// Function to process commands
async function processCommands(settings) {
    console.log('Processing commands');
    // Send tank number command
    sendMQTTCommand('DIPSW_0', 1, 93, settings.tankNumber);
    await new Promise(resolve => setTimeout(resolve, 25 * 1000));

    // Define devices and their act_id
    const devices = [
        { act_id: 1, value: settings.siloMotorRight },
        { act_id: 2, value: settings.siloMotorLeft },
        { act_id: 3, value: settings.rotaryValve },
        { act_id: 4, value: settings.blower }
    ];

    // Process each device sequentially
    for (const device of devices) {
        if (stopRequested) {
            console.log('Stop requested, halting commands');
            break;
        }
        console.log(`Sending ON command for act_id: ${device.act_id}`);
        sendMQTTCommand('DIPSW_1', device.act_id, 91, 3); // ON

        // Wait for the specified time before sending the OFF command
        await new Promise(resolve => setTimeout(resolve, device.value * 1000));

        if (stopRequested) {
            console.log('Stop requested, halting commands');
            break;
        }
        console.log(`Sending OFF command for act_id: ${device.act_id}`);
        sendMQTTCommand('DIPSW_1', device.act_id, 93, 3); // OFF
    }
}

function sendMQTTCommand(topic, act_id, opmode, pwm) {
    if (!mqttConnected) {
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

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});