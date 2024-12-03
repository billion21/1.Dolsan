const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3100;
const presetFilePath = path.join(__dirname, 'presets.json');

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve ui.html as the default page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
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
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        try {
            const presets = JSON.parse(data);
            res.json(presets);
        } catch (parseError) {
            console.error('Error parsing presets file:', parseError);
            res.status(500).json({ error: 'Error parsing presets file' });
        }
    });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});