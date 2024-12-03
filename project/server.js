const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3100;

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve ui.html as the default page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
});

// Endpoint to start the process
app.post('/api/start', (req, res) => {
    const data = req.body;
    // Save data to a file or database for the daemon to process
    fs.writeFileSync('commandQueue.json', JSON.stringify(data));
    res.status(200).json({ message: 'Command received' });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});