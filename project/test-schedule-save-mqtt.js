/**
 * Test if saving a schedule publishes any MQTT messages
 */

const http = require('http');

const testSchedule = {
    scheduleTime: '15:30',
    dayOfWeek: [1, 1, 1, 1, 1, 0, 0],
    feedSet: [{
        outlet: 0,
        feed_motor: 8,
        scatter_motor: 5,
        quantity: 800,
        time: 150,
        active: 1
    }]
};

console.log('🧪 Testing if /api/schedules/save publishes MQTT messages...\n');
console.log('📋 Test Schedule Data:');
console.log(JSON.stringify(testSchedule, null, 2));
console.log('\n⚠️  Make sure MQTT testing tool is running to capture any messages!\n');

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

const req = http.request(options, (res) => {
    let responseData = '';
    
    res.on('data', (chunk) => {
        responseData += chunk;
    });
    
    res.on('end', () => {
        console.log('✅ Schedule save response:');
        console.log(responseData);
        console.log('\n📊 Check MQTT testing tool for any messages received.');
        console.log('⏱️  Waiting 2 seconds for any delayed MQTT messages...\n');
        
        setTimeout(() => {
            console.log('✅ Test complete!');
            console.log('\nIf no MQTT messages were received, it confirms that');
            console.log('/api/schedules/save does NOT publish schedule data to MQTT.');
            process.exit(0);
        }, 2000);
    });
});

req.on('error', (err) => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});

req.write(postData);
req.end();

