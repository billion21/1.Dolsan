/**
 * Test: Verify feed_motor and scatter_motor Preservation in MQTT Schedule Sync
 * 
 * This test verifies that when a schedule is saved with feed_motor and scatter_motor
 * values, those exact values are transmitted via MQTT without conversion.
 */

const mqtt = require('mqtt');
const http = require('http');

// Configuration
const MQTT_URL = 'mqtt://192.168.2.55:1883';
const SERVER_URL = 'http://localhost:3100';
const MQTT_TOPIC = 'dslab055_cv';

// Test data with specific feed_motor and scatter_motor values
const TEST_SCHEDULE = {
    scheduleTime: '14:30',
    dayOfWeek: [1, 1, 1, 1, 1, 0, 0],
    feedSet: [
        {
            outlet: 0,
            feed_motor: 9,      // Specific value to test
            scatter_motor: 7,   // Specific value to test
            quantity: 900,
            time: 200,
            active: 1
        },
        {
            outlet: 2,
            feed_motor: 4,      // Different value to test
            scatter_motor: 3,   // Different value to test
            quantity: 400,
            time: 180,
            active: 1
        }
    ]
};

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('🧪 Feed Motor & Scatter Motor Preservation Test');
console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('📡 MQTT Broker:', MQTT_URL);
console.log('🖥️  Server:', SERVER_URL);
console.log('');
console.log('📋 Test Schedule Data:');
console.log(JSON.stringify(TEST_SCHEDULE, null, 2));
console.log('');
console.log('🎯 Expected Values in MQTT Message:');
console.log('   Tank 1: feed_motor = 9, scatter_motor = 7');
console.log('   Tank 2: feed_motor = 4, scatter_motor = 3');
console.log('');

// Connect to MQTT broker
const client = mqtt.connect(MQTT_URL);

let messageReceived = false;
let testPassed = false;

client.on('connect', () => {
    console.log('🔌 Connecting to MQTT broker...');
    console.log('✅ Connected to MQTT broker');

    // Subscribe to schedule topic
    console.log('📡 Subscribing to', MQTT_TOPIC, 'topic...');
    client.subscribe(MQTT_TOPIC, { qos: 1 }, (err) => {
        if (err) {
            console.error('❌ Failed to subscribe:', err);
            process.exit(1);
        }
        console.log('✅ Subscribed to', MQTT_TOPIC);
        console.log('');

        // Save schedule via HTTP API
        saveSchedule();
    });
});

client.on('message', (topic, message) => {
    if (topic !== MQTT_TOPIC || messageReceived) return;

    messageReceived = true;

    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('✅ MQTT MESSAGE RECEIVED ON', MQTT_TOPIC);
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('');

    try {
        const data = JSON.parse(message.toString());

        // Find the most recent reservation (should be the one we just added)
        const latestReservation = data.reservations[data.reservations.length - 1];

        console.log('📦 Latest Reservation (NO: ' + latestReservation.NO + '):');
        console.log(JSON.stringify(latestReservation, null, 2));
        console.log('');

        // Validate feed_motor and scatter_motor preservation
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log('🔍 Validating feed_motor and scatter_motor Preservation');
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log('');

        const feedSet = latestReservation.RESERVATION_DATA.feed_set;
        let allTestsPassed = true;

        // Check Tank 1 (outlet 0)
        const tank1 = feedSet.find(f => f.outlet === 0);
        if (tank1) {
            console.log('Tank 1 (outlet 0):');
            console.log('  Expected: feed_motor = 9, scatter_motor = 7');
            console.log('  Actual:   feed_motor =', tank1.feed_motor + ', scatter_motor =', tank1.scatter_motor);

            if (tank1.feed_motor === 9 && tank1.scatter_motor === 7) {
                console.log('  ✅ PASS - Values preserved correctly');
            } else {
                console.log('  ❌ FAIL - Values not preserved');
                allTestsPassed = false;
            }
        } else {
            console.log('❌ Tank 1 not found in feed_set');
            allTestsPassed = false;
        }
        console.log('');

        // Check Tank 2 (outlet 2)
        const tank2 = feedSet.find(f => f.outlet === 2);
        if (tank2) {
            console.log('Tank 2 (outlet 2):');
            console.log('  Expected: feed_motor = 4, scatter_motor = 3');
            console.log('  Actual:   feed_motor =', tank2.feed_motor + ', scatter_motor =', tank2.scatter_motor);

            if (tank2.feed_motor === 4 && tank2.scatter_motor === 3) {
                console.log('  ✅ PASS - Values preserved correctly');
            } else {
                console.log('  ❌ FAIL - Values not preserved');
                allTestsPassed = false;
            }
        } else {
            console.log('❌ Tank 2 not found in feed_set');
            allTestsPassed = false;
        }
        console.log('');

        // Check that other fields are also preserved
        console.log('Additional Field Validation:');
        if (tank1) {
            console.log('  Tank 1: quantity =', tank1.quantity, '(expected 900)', tank1.quantity === 900 ? '✅' : '❌');
            console.log('  Tank 1: time =', tank1.time, '(expected 200)', tank1.time === 200 ? '✅' : '❌');
            console.log('  Tank 1: active =', tank1.active, '(expected 1)', tank1.active === 1 ? '✅' : '❌');
        }
        if (tank2) {
            console.log('  Tank 2: quantity =', tank2.quantity, '(expected 400)', tank2.quantity === 400 ? '✅' : '❌');
            console.log('  Tank 2: time =', tank2.time, '(expected 180)', tank2.time === 180 ? '✅' : '❌');
            console.log('  Tank 2: active =', tank2.active, '(expected 1)', tank2.active === 1 ? '✅' : '❌');
        }
        console.log('');

        // Final result
        console.log('════════════════════════════════════════════════════════════════════════════════');
        if (allTestsPassed) {
            console.log('✅ TEST PASSED');
            console.log('✅ feed_motor and scatter_motor values are preserved correctly!');
            console.log('✅ No conversion or modification detected');
            testPassed = true;
        } else {
            console.log('❌ TEST FAILED');
            console.log('❌ feed_motor and/or scatter_motor values were not preserved correctly');
        }
        console.log('════════════════════════════════════════════════════════════════════════════════');

    } catch (error) {
        console.error('❌ Error parsing MQTT message:', error);
    }

    // Cleanup
    setTimeout(() => {
        client.end();
        process.exit(testPassed ? 0 : 1);
    }, 500);
});

client.on('error', (err) => {
    console.error('❌ MQTT Error:', err);
    process.exit(1);
});

function saveSchedule() {
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('📤 Saving Schedule via /api/schedules/save');
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('');

    const postData = JSON.stringify(TEST_SCHEDULE);

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
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log('✅ Schedule save response:');
            console.log(data);
            console.log('');
            console.log('⏳ Waiting for MQTT message on', MQTT_TOPIC, 'topic...');
            console.log('   (Timeout in 5 seconds if no message received)');
            console.log('');

            // Set timeout
            setTimeout(() => {
                if (!messageReceived) {
                    console.log('════════════════════════════════════════════════════════════════════════════════');
                    console.log('❌ TEST FAILED: No MQTT message received');
                    console.log('════════════════════════════════════════════════════════════════════════════════');
                    client.end();
                    process.exit(1);
                }
            }, 5000);
        });
    });

    req.on('error', (error) => {
        console.error('❌ Error saving schedule:', error);
        client.end();
        process.exit(1);
    });

    req.write(postData);
    req.end();
}

