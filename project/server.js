const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3100;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to get JSON data
app.get('/api/schedule', (req, res) => {
    const dataPath = path.join(__dirname, 'SENACT_INFO_SCHEDULE_202401311618.json');
    fs.readFile(dataPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading JSON file:', err);
            res.status(500).send('Internal Server Error');
        } else {
            res.json(JSON.parse(data));
        }
    });
});

// Endpoint to get presets
app.get('/api/presets', (req, res) => {
    const presetPath = path.join(__dirname, 'preset.json');
    fs.readFile(presetPath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading presets file:', err);
            res.status(500).send('Internal Server Error');
        } else {
            res.json(JSON.parse(data));
        }
    });
});

// Endpoint to save presets
app.post('/api/presets', (req, res) => {
    const presetPath = path.join(__dirname, 'preset.json');
    const presets = req.body;
    fs.writeFile(presetPath, JSON.stringify(presets, null, 2), 'utf8', (err) => {
        if (err) {
            console.error('Error writing presets file:', err);
            res.status(500).send('Internal Server Error');
        } else {
            res.status(200).send('Presets saved successfully');
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});