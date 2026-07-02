const http = require('http');

const testSchedule = {
    scheduleTime: '16:00',
    dayOfWeek: [1, 1, 1, 1, 1, 0, 0],
    feedSet: [
        {
            outlet: 0,
            feed_motor: 6,
            scatter_motor: 4,
            quantity: 600,
            time: 150,
            active: 1
        }
    ]
};

const postData = JSON.stringify(testSchedule);

const options = {
    hostname: 'localhost',
    port: 3100,
    path: '/api/schedules/save',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log('Saving test schedule...');

const req = http.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('Response:', data);
        process.exit(0);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
    process.exit(1);
});

req.write(postData);
req.end();

