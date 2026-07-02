/**
 * Test: Verify Active Schedules Filter in MQTT Schedule Sync
 * 
 * This test verifies that only active schedules (DEL_YN = "N") are transmitted
 * via MQTT, and deleted schedules (DEL_YN = "Y") are filtered out.
 */

const mqtt = require('mqtt');
const http = require('http');

// Configuration
const MQTT_URL = 'mqtt://192.168.2.55:1883';
const SERVER_URL = 'http://localhost:3100';
const MQTT_TOPIC = 'dslab055_cv';

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('🧪 Active Schedules Filter Test');
console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('📡 MQTT Broker:', MQTT_URL);
console.log('🖥️  Server:', SERVER_URL);
console.log('');
console.log('🎯 Test Objective:');
console.log('   Verify that MQTT messages only contain active schedules (DEL_YN = "N")');
console.log('   and deleted schedules (DEL_YN = "Y") are filtered out.');
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

        // Wait a moment for retained message, then trigger a new save
        setTimeout(() => {
            console.log('📤 Triggering schedule save to test filter...');
            saveTestSchedule();
        }, 1000);
    });
});

client.on('message', (topic, message) => {
    if (topic !== MQTT_TOPIC) return;

    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('✅ MQTT MESSAGE RECEIVED ON', MQTT_TOPIC);
    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('');

    try {
        const data = JSON.parse(message.toString());

        console.log('📦 Message Structure:');
        console.log('   mtype:', data.mtype);
        console.log('   test:', data.test);
        console.log('   reservations count:', data.reservations.length);
        console.log('');

        // Validate filter: Check if any deleted schedules are present
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log('🔍 Validating Active Schedules Filter');
        console.log('════════════════════════════════════════════════════════════════════════════════');
        console.log('');

        let activeCount = 0;
        let deletedCount = 0;
        let allTestsPassed = true;

        data.reservations.forEach((reservation, index) => {
            if (reservation.DEL_YN === 'N') {
                activeCount++;
            } else if (reservation.DEL_YN === 'Y') {
                deletedCount++;
                console.log(`❌ FAIL: Found deleted schedule in MQTT message!`);
                console.log(`   Schedule NO: ${reservation.NO}`);
                console.log(`   DEL_YN: ${reservation.DEL_YN}`);
                console.log('');
                allTestsPassed = false;
            }
        });

        console.log('📊 Schedule Statistics:');
        console.log(`   Total schedules in MQTT message: ${data.reservations.length}`);
        console.log(`   Active schedules (DEL_YN = "N"): ${activeCount}`);
        console.log(`   Deleted schedules (DEL_YN = "Y"): ${deletedCount}`);
        console.log('');

        if (deletedCount === 0) {
            console.log('✅ PASS: No deleted schedules found in MQTT message');
            console.log('✅ All schedules have DEL_YN = "N"');
        } else {
            console.log(`❌ FAIL: Found ${deletedCount} deleted schedule(s) in MQTT message`);
            allTestsPassed = false;
        }
        console.log('');

        // Show sample schedules
        console.log('📋 Sample Schedules (first 3):');
        data.reservations.slice(0, 3).forEach((reservation, index) => {
            console.log(`   ${index + 1}. NO: ${reservation.NO}, DEL_YN: ${reservation.DEL_YN}, Time: ${reservation.SCHEDULE_TIME}`);
        });
        if (data.reservations.length > 3) {
            console.log(`   ... and ${data.reservations.length - 3} more schedules`);
        }
        console.log('');

        // Final result
        console.log('════════════════════════════════════════════════════════════════════════════════');
        if (allTestsPassed && deletedCount === 0) {
            console.log('✅ TEST PASSED');
            console.log('✅ Active schedules filter is working correctly!');
            console.log('✅ Only active schedules (DEL_YN = "N") are transmitted via MQTT');
            testPassed = true;
        } else {
            console.log('❌ TEST FAILED');
            console.log('❌ Deleted schedules are being transmitted via MQTT');
            console.log('❌ Filter is not working correctly');
        }
        console.log('════════════════════════════════════════════════════════════════════════════════');

        if (!messageReceived) {
            messageReceived = true;

            // Cleanup
            setTimeout(() => {
                client.end();
                process.exit(testPassed ? 0 : 1);
            }, 500);
        }

    } catch (error) {
        console.error('❌ Error parsing MQTT message:', error);
        client.end();
        process.exit(1);
    }
});

client.on('error', (err) => {
    console.error('❌ MQTT Error:', err);
    process.exit(1);
});

function saveTestSchedule() {
    const testSchedule = {
        scheduleTime: '15:00',
        dayOfWeek: [1, 1, 1, 1, 1, 0, 0],
        feedSet: [
            {
                outlet: 0,
                feed_motor: 7,
                scatter_motor: 5,
                quantity: 700,
                time: 180,
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

    const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log('✅ Test schedule saved successfully');
            console.log('⏳ Waiting for MQTT message...');
            console.log('');
        });
    });

    req.on('error', (error) => {
        console.error('❌ Error saving test schedule:', error);
        client.end();
        process.exit(1);
    });

    req.write(postData);
    req.end();
}

