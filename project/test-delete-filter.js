/**
 * Test: Verify Active Schedules Filter After Delete Operation
 * 
 * This test verifies that after deleting a schedule, the MQTT message
 * still only contains active schedules (DEL_YN = "N").
 */

const mqtt = require('mqtt');
const http = require('http');

// Configuration
const MQTT_URL = 'mqtt://192.168.2.55:1883';
const SERVER_URL = 'http://localhost:3100';
const MQTT_TOPIC = 'dslab055_cv';

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('🧪 Active Schedules Filter Test (After Delete)');
console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('📡 MQTT Broker:', MQTT_URL);
console.log('🖥️  Server:', SERVER_URL);
console.log('');
console.log('🎯 Test Objective:');
console.log('   Verify that after deleting a schedule, MQTT messages only contain');
console.log('   active schedules (DEL_YN = "N") and deleted schedules are filtered out.');
console.log('');

// Connect to MQTT broker
const client = mqtt.connect(MQTT_URL);

let messageCount = 0;
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

        // Wait a moment, then trigger delete
        setTimeout(() => {
            console.log('🗑️  Deleting schedule NO: 10...');
            deleteSchedule(10);
        }, 1000);
    });
});

client.on('message', (topic, message) => {
    if (topic !== MQTT_TOPIC) return;

    messageCount++;

    // Skip the first message (retained message)
    if (messageCount === 1) {
        console.log('📨 Received retained message (skipping)...');
        console.log('');
        return;
    }

    console.log('════════════════════════════════════════════════════════════════════════════════');
    console.log('✅ MQTT MESSAGE RECEIVED ON', MQTT_TOPIC, '(After Delete)');
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

        // Verify that schedule NO: 10 is not in the list
        const hasDeletedSchedule = data.reservations.some(r => r.NO === 10);
        if (hasDeletedSchedule) {
            console.log('❌ FAIL: Deleted schedule NO: 10 is still in MQTT message');
            allTestsPassed = false;
        } else {
            console.log('✅ PASS: Deleted schedule NO: 10 is not in MQTT message');
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
            console.log('✅ Active schedules filter is working correctly after delete!');
            console.log('✅ Only active schedules (DEL_YN = "N") are transmitted via MQTT');
            testPassed = true;
        } else {
            console.log('❌ TEST FAILED');
            console.log('❌ Deleted schedules are being transmitted via MQTT');
            console.log('❌ Filter is not working correctly');
        }
        console.log('════════════════════════════════════════════════════════════════════════════════');

        // Cleanup
        setTimeout(() => {
            client.end();
            process.exit(testPassed ? 0 : 1);
        }, 500);

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

function deleteSchedule(no) {
    const options = {
        hostname: 'localhost',
        port: 3100,
        path: `/api/schedules/${no}`,
        method: 'DELETE'
    };

    const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
            data += chunk;
        });

        res.on('end', () => {
            console.log('✅ Schedule deleted successfully');
            console.log('⏳ Waiting for MQTT message...');
            console.log('');
        });
    });

    req.on('error', (error) => {
        console.error('❌ Error deleting schedule:', error);
        client.end();
        process.exit(1);
    });

    req.end();
}

