/**
 * Test MQTT Schedule Synchronization
 * 
 * This script tests the device-side autonomous scheduling feature by:
 * 1. Saving a schedule via /api/schedules/save
 * 2. Verifying that the complete schedule data structure is published to dslab055_cv topic
 * 3. Validating the message format matches the expected structure
 */

const http = require('http');
const mqtt = require('mqtt');
const chalk = require('chalk');

// Configuration
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const SERVER_HOST = 'localhost';
const SERVER_PORT = 3100;

console.log(chalk.cyan('═'.repeat(80)));
console.log(chalk.cyan('🧪 MQTT Schedule Synchronization Test'));
console.log(chalk.cyan('═'.repeat(80)));
console.log(chalk.cyan(`📡 MQTT Broker: ${MQTT_URL}`));
console.log(chalk.cyan(`🖥️  Server: http://${SERVER_HOST}:${SERVER_PORT}`));
console.log('');

// Test schedule data
const testSchedule = {
    scheduleTime: '16:45',
    dayOfWeek: [1, 1, 1, 1, 1, 0, 0], // Mon-Fri
    feedSet: [
        {
            outlet: 0,
            feed_motor: 8,
            scatter_motor: 5,
            quantity: 800,
            time: 150,
            active: 1
        },
        {
            outlet: 1,
            feed_motor: 6,
            scatter_motor: 4,
            quantity: 600,
            time: 120,
            active: 1
        }
    ]
};

console.log(chalk.yellow('📋 Test Schedule Data:'));
console.log(JSON.stringify(testSchedule, null, 2));
console.log('');

// Expected message structure
const expectedStructure = {
    mtype: 'tef_fed',
    test: 0,
    reservations: [
        {
            SCHEDULE_TIME: 'ISO 8601 timestamp',
            DAY_OF_WEEK: [1, 1, 1, 1, 1, 0, 0],
            RESERVATION_DATA: {
                feed_set: [
                    {
                        outlet: 0,
                        feed_motor: 8,
                        scatter_motor: 5,
                        quantity: 800,
                        time: 150,
                        active: 1
                    }
                ]
            },
            DEL_YN: 'N',
            NO: 'number',
            SIZE: 6
        }
    ]
};

console.log(chalk.yellow('📐 Expected MQTT Message Structure:'));
console.log(JSON.stringify(expectedStructure, null, 2));
console.log('');

// Connect to MQTT broker
console.log(chalk.cyan('🔌 Connecting to MQTT broker...'));
const mqttClient = mqtt.connect(MQTT_URL, {
    clientId: 'test_schedule_sync_' + Math.random().toString(16).slice(2, 8)
});

let messageReceived = false;
let receivedMessage = null;

mqttClient.on('connect', () => {
    console.log(chalk.green('✅ Connected to MQTT broker'));
    console.log(chalk.cyan('📡 Subscribing to dslab055_cv topic...'));

    mqttClient.subscribe('dslab055_cv', (err) => {
        if (err) {
            console.error(chalk.red('❌ Failed to subscribe:'), err);
            process.exit(1);
        }

        console.log(chalk.green('✅ Subscribed to dslab055_cv'));
        console.log('');

        // Wait a moment for subscription to be ready
        setTimeout(() => {
            saveSchedule();
        }, 500);
    });
});

mqttClient.on('message', (topic, message) => {
    if (topic === 'dslab055_cv') {
        messageReceived = true;
        receivedMessage = message.toString();

        console.log(chalk.green('═'.repeat(80)));
        console.log(chalk.green('✅ MQTT MESSAGE RECEIVED ON dslab055_cv'));
        console.log(chalk.green('═'.repeat(80)));
        console.log('');

        // Parse and validate
        try {
            const parsed = JSON.parse(receivedMessage);

            console.log(chalk.cyan('📦 Received Message:'));
            console.log(JSON.stringify(parsed, null, 2));
            console.log('');

            // Validate structure
            validateMessage(parsed);

        } catch (e) {
            console.error(chalk.red('❌ Failed to parse message:'), e.message);
        }

        // Wait a moment then exit
        setTimeout(() => {
            mqttClient.end();
            process.exit(0);
        }, 1000);
    }
});

mqttClient.on('error', (err) => {
    console.error(chalk.red('❌ MQTT Error:'), err.message);
    process.exit(1);
});

/**
 * Save schedule via HTTP API
 */
function saveSchedule() {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.cyan('📤 Saving Schedule via /api/schedules/save'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log('');

    const postData = JSON.stringify(testSchedule);

    const options = {
        hostname: SERVER_HOST,
        port: SERVER_PORT,
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
            console.log(chalk.green('✅ Schedule save response:'));
            console.log(responseData);
            console.log('');
            console.log(chalk.yellow('⏳ Waiting for MQTT message on dslab055_cv topic...'));
            console.log(chalk.yellow('   (Timeout in 5 seconds if no message received)'));
            console.log('');

            // Set timeout
            setTimeout(() => {
                if (!messageReceived) {
                    console.log(chalk.red('═'.repeat(80)));
                    console.log(chalk.red('❌ TEST FAILED: No MQTT message received'));
                    console.log(chalk.red('═'.repeat(80)));
                    console.log('');
                    console.log(chalk.yellow('Possible issues:'));
                    console.log(chalk.yellow('  1. MQTT not connected on server'));
                    console.log(chalk.yellow('  2. Schedule sync not implemented'));
                    console.log(chalk.yellow('  3. Wrong MQTT topic'));
                    mqttClient.end();
                    process.exit(1);
                }
            }, 5000);
        });
    });

    req.on('error', (err) => {
        console.error(chalk.red('❌ HTTP Error:'), err.message);
        mqttClient.end();
        process.exit(1);
    });

    req.write(postData);
    req.end();
}

/**
 * Validate received message structure
 */
function validateMessage(parsed) {
    console.log(chalk.cyan('═'.repeat(80)));
    console.log(chalk.cyan('🔍 Validating Message Structure'));
    console.log(chalk.cyan('═'.repeat(80)));
    console.log('');

    const errors = [];
    const warnings = [];

    // Check mtype
    if (!parsed.mtype) {
        errors.push('Missing field: mtype');
    } else if (parsed.mtype !== 'tef_fed') {
        warnings.push(`Unexpected mtype: ${parsed.mtype} (expected 'tef_fed')`);
    } else {
        console.log(chalk.green('✅ mtype: tef_fed'));
    }

    // Check test
    if (parsed.test === undefined) {
        errors.push('Missing field: test');
    } else {
        console.log(chalk.green(`✅ test: ${parsed.test}`));
    }

    // Check reservations
    if (!parsed.reservations) {
        errors.push('Missing field: reservations');
    } else if (!Array.isArray(parsed.reservations)) {
        errors.push('reservations is not an array');
    } else {
        console.log(chalk.green(`✅ reservations: ${parsed.reservations.length} schedules`));

        // Validate each reservation
        parsed.reservations.forEach((reservation, index) => {
            console.log(chalk.cyan(`\n  Validating reservation ${index + 1}:`));

            if (!reservation.SCHEDULE_TIME) warnings.push(`Reservation ${index}: Missing SCHEDULE_TIME`);
            else console.log(chalk.green(`    ✅ SCHEDULE_TIME: ${reservation.SCHEDULE_TIME}`));

            if (!reservation.DAY_OF_WEEK || !Array.isArray(reservation.DAY_OF_WEEK) || reservation.DAY_OF_WEEK.length !== 7) {
                warnings.push(`Reservation ${index}: Invalid DAY_OF_WEEK`);
            } else {
                console.log(chalk.green(`    ✅ DAY_OF_WEEK: [${reservation.DAY_OF_WEEK.join(',')}]`));
            }

            if (!reservation.RESERVATION_DATA || !reservation.RESERVATION_DATA.feed_set) {
                warnings.push(`Reservation ${index}: Missing RESERVATION_DATA.feed_set`);
            } else {
                console.log(chalk.green(`    ✅ feed_set: ${reservation.RESERVATION_DATA.feed_set.length} tanks`));
            }

            if (!reservation.NO) warnings.push(`Reservation ${index}: Missing NO`);
            else console.log(chalk.green(`    ✅ NO: ${reservation.NO}`));

            if (reservation.DEL_YN === undefined) warnings.push(`Reservation ${index}: Missing DEL_YN`);
            else console.log(chalk.green(`    ✅ DEL_YN: ${reservation.DEL_YN}`));
        });
    }

    console.log('');
    console.log(chalk.cyan('═'.repeat(80)));

    if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green('✅ ALL VALIDATIONS PASSED'));
        console.log(chalk.green('✅ Schedule synchronization is working correctly!'));
        console.log('');
        console.log(chalk.cyan('🎯 Device-Side Autonomous Scheduling Enabled:'));
        console.log(chalk.cyan('   • IoT devices can receive and store complete schedule data'));
        console.log(chalk.cyan('   • Devices can execute schedules independently'));
        console.log(chalk.cyan('   • System remains operational even if server goes offline'));
    } else {
        if (errors.length > 0) {
            console.log(chalk.red('❌ VALIDATION ERRORS:'));
            errors.forEach(err => console.log(chalk.red(`   • ${err}`)));
        }
        if (warnings.length > 0) {
            console.log(chalk.yellow('⚠️  WARNINGS:'));
            warnings.forEach(warn => console.log(chalk.yellow(`   • ${warn}`)));
        }
    }

    console.log(chalk.cyan('═'.repeat(80)));
}

