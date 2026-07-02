/**
 * Schedule Execution Test Script
 * 
 * This script simulates saving and executing a schedule to verify MQTT message format.
 * It sends the same data that the dashboard would send when saving and executing a schedule.
 * 
 * Usage:
 *   node test-schedule-execution.js
 */

const http = require('http');

// Test configuration
const SERVER_HOST = 'localhost';
const SERVER_PORT = 3100;

// Test schedule data
const testSchedule = {
    scheduleTime: '14:30',
    dayOfWeek: [0, 1, 1, 1, 1, 1, 0], // Mon-Fri
    feedSet: [
        {
            outlet: 0,           // Tank 0 (1번 수조)
            feed_motor: 5,       // Feed motor PWM
            scatter_motor: 3,    // Scatter motor PWM
            quantity: 500,       // 5 * 100
            time: 100,           // 10 seconds * 10
            active: 1
        },
        {
            outlet: 1,           // Tank 1 (2번 수조)
            feed_motor: 7,       // Feed motor PWM
            scatter_motor: 4,    // Scatter motor PWM
            quantity: 700,       // 7 * 100
            time: 100,           // 10 seconds * 10
            active: 1
        },
        {
            outlet: 2,           // Tank 2 (3번 수조)
            feed_motor: 3,       // Feed motor PWM
            scatter_motor: 2,    // Scatter motor PWM
            quantity: 300,       // 3 * 100
            time: 100,           // 10 seconds * 10
            active: 1
        }
    ]
};

// Test execution data
const testExecution = {
    feederGroup: '2',  // DIPSW_1 topic
    feedSet: testSchedule.feedSet
};

console.log('═'.repeat(80));
console.log('🧪 Schedule Execution Test');
console.log('═'.repeat(80));
console.log('');
console.log('This test will:');
console.log('  1. Save a test schedule to the server');
console.log('  2. Execute the schedule to trigger MQTT messages');
console.log('  3. Display the expected MQTT message format');
console.log('');
console.log('⚠️  Make sure:');
console.log('  - Server is running on port 3100');
console.log('  - MQTT broker is accessible at 192.168.2.55:1883');
console.log('  - MQTT testing tool is running: node test-mqtt-schedule-format.js');
console.log('');
console.log('═'.repeat(80));
console.log('');

// Helper function to make HTTP POST request
function makeRequest(path, data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: SERVER_HOST,
            port: SERVER_PORT,
            path: path,
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
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({ statusCode: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: responseData });
                }
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.write(postData);
        req.end();
    });
}

// Display expected MQTT messages
function displayExpectedMessages() {
    console.log('📋 Expected MQTT Messages:');
    console.log('');
    
    testSchedule.feedSet.forEach((config, idx) => {
        const pwm = Math.max(1, Math.min(10, Math.ceil(config.quantity / 100)));
        const act_id = config.outlet + 1;
        
        console.log(`Message ${idx + 1}:`);
        console.log(`  Topic: DIPSW_1`);
        console.log(`  Payload: {`);
        console.log(`    "act_id": ${act_id},`);
        console.log(`    "opmode": 64,`);
        console.log(`    "pwm": ${pwm},`);
        console.log(`    "time": ${config.time}`);
        console.log(`  }`);
        console.log('');
        console.log(`  Interpretation:`);
        console.log(`    - Tank: ${config.outlet} (outlet) → act_id ${act_id}`);
        console.log(`    - Feed Motor: ${config.feed_motor} → quantity ${config.quantity} → PWM ${pwm}`);
        console.log(`    - Duration: ${config.time / 10} seconds (${config.time} × 0.1s)`);
        console.log(`    - Operation Mode: 64 (Immediate Execution)`);
        console.log('');
    });
}

// Main test function
async function runTest() {
    try {
        // Step 1: Display expected messages
        displayExpectedMessages();
        
        console.log('═'.repeat(80));
        console.log('');
        
        // Step 2: Save schedule
        console.log('📝 Step 1: Saving test schedule...');
        console.log('');
        console.log('Schedule Data:');
        console.log(`  Time: ${testSchedule.scheduleTime}`);
        console.log(`  Days: Mon-Fri`);
        console.log(`  Tanks: ${testSchedule.feedSet.length}`);
        testSchedule.feedSet.forEach((config, idx) => {
            console.log(`    Tank ${config.outlet}: feed_motor=${config.feed_motor}, scatter_motor=${config.scatter_motor}, duration=${config.time / 10}s`);
        });
        console.log('');
        
        const saveResult = await makeRequest('/api/schedules/save', testSchedule);
        
        if (saveResult.statusCode === 200) {
            console.log('✅ Schedule saved successfully!');
            console.log(`   Schedule ID: ${saveResult.data.scheduleId || 'N/A'}`);
        } else {
            console.error('❌ Failed to save schedule:', saveResult.data);
            process.exit(1);
        }
        
        console.log('');
        console.log('═'.repeat(80));
        console.log('');
        
        // Step 3: Execute schedule
        console.log('🚀 Step 2: Executing schedule (triggering MQTT messages)...');
        console.log('');
        console.log('Execution Parameters:');
        console.log(`  Feeder Group: ${testExecution.feederGroup} (DIPSW_1 topic)`);
        console.log(`  Feed Set Entries: ${testExecution.feedSet.length}`);
        console.log('');
        
        const executeResult = await makeRequest('/api/schedules/execute', testExecution);
        
        if (executeResult.statusCode === 200) {
            console.log('✅ Schedule executed successfully!');
            console.log(`   Commands sent: ${executeResult.data.commandsSent || 0}`);
            console.log('');
            
            if (executeResult.data.commands) {
                console.log('📤 MQTT Commands Sent:');
                console.log('');
                executeResult.data.commands.forEach((cmd, idx) => {
                    console.log(`Command ${idx + 1}:`);
                    console.log(`  Topic: ${cmd.topic}`);
                    console.log(`  Message: ${JSON.stringify({ act_id: cmd.act_id, opmode: cmd.opmode, pwm: cmd.pwm, time: cmd.time }, null, 2)}`);
                    console.log('');
                });
            }
        } else {
            console.error('❌ Failed to execute schedule:', executeResult.data);
            process.exit(1);
        }
        
        console.log('═'.repeat(80));
        console.log('');
        console.log('✅ Test completed successfully!');
        console.log('');
        console.log('📊 Verification Steps:');
        console.log('  1. Check the MQTT testing tool output for received messages');
        console.log('  2. Verify each message has exactly 4 fields: act_id, opmode, pwm, time');
        console.log('  3. Verify act_id values: Tank 0→1, Tank 1→2, Tank 2→3');
        console.log('  4. Verify opmode is 64 for all messages');
        console.log('  5. Verify PWM values match expected: Tank 0→5, Tank 1→7, Tank 2→3');
        console.log('  6. Verify time is 100 (10 seconds) for all messages');
        console.log('');
        console.log('═'.repeat(80));
        
    } catch (error) {
        console.error('');
        console.error('❌ Test failed with error:', error.message);
        console.error('');
        console.error('Troubleshooting:');
        console.error('  1. Is the server running? Start with: node server.js');
        console.error('  2. Is the server on port 3100?');
        console.error('  3. Is MQTT broker accessible?');
        console.error('');
        process.exit(1);
    }
}

// Run the test
runTest();

