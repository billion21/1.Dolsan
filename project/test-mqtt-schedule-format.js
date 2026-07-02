/**
 * MQTT Schedule Format Testing Tool
 * 
 * This script subscribes to MQTT topics and logs all messages to verify
 * that saved schedules are being published in the correct JSON format.
 * 
 * Usage:
 *   node test-mqtt-schedule-format.js
 * 
 * Expected Message Format:
 * {
 *   "act_id": 1-4,      // Tank number + 1 (outlet 0 → act_id 1)
 *   "opmode": 64,       // Immediate execution
 *   "pwm": 1-10,        // Motor rotation count
 *   "time": 0-9999      // Duration in 0.1 second units
 * }
 */

const mqtt = require('mqtt');
const chalk = require('chalk');

// MQTT Configuration
// Use environment variable or default to the same broker as server.js
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const TOPICS = ['DIPSW_0', 'DIPSW_1', 'DIPSW_RTC', 'DIPSW_1_cv', 'DIPSW_RTC_cv', 'dslab055_cv'];

console.log(chalk.cyan('🚀 MQTT Schedule Format Testing Tool'));
console.log(chalk.cyan(`📡 Connecting to MQTT broker: ${MQTT_URL}`));
console.log(chalk.cyan(`📋 Subscribing to topics: ${TOPICS.join(', ')}`));
console.log('');

// Statistics
const stats = {
    totalMessages: 0,
    validMessages: 0,
    invalidMessages: 0,
    messagesByTopic: {},
    startTime: new Date()
};

// Initialize topic stats
TOPICS.forEach(topic => {
    stats.messagesByTopic[topic] = 0;
});

// Color helpers
const colors = {
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.cyan,
    topic: chalk.magenta,
    field: chalk.blue,
    value: chalk.white.bold
};

/**
 * Validate MQTT message format
 */
function validateMessage(topic, message) {
    const validation = {
        valid: true,
        errors: [],
        warnings: []
    };

    // Check if message is valid JSON
    let parsed;
    try {
        parsed = JSON.parse(message);
    } catch (e) {
        validation.valid = false;
        validation.errors.push('Invalid JSON format');
        return validation;
    }

    // For feeding topics (DIPSW_0, DIPSW_1)
    if (topic === 'DIPSW_0' || topic === 'DIPSW_1') {
        // Check required fields
        if (!parsed.hasOwnProperty('act_id')) {
            validation.errors.push('Missing required field: act_id');
            validation.valid = false;
        } else if (typeof parsed.act_id !== 'number' || parsed.act_id < 1 || parsed.act_id > 4) {
            validation.errors.push(`Invalid act_id: ${parsed.act_id} (expected 1-4)`);
            validation.valid = false;
        }

        if (!parsed.hasOwnProperty('opmode')) {
            validation.errors.push('Missing required field: opmode');
            validation.valid = false;
        } else if (typeof parsed.opmode !== 'number') {
            validation.errors.push(`Invalid opmode type: ${typeof parsed.opmode} (expected number)`);
            validation.valid = false;
        }

        if (!parsed.hasOwnProperty('pwm')) {
            validation.errors.push('Missing required field: pwm');
            validation.valid = false;
        } else if (typeof parsed.pwm !== 'number' || parsed.pwm < 1 || parsed.pwm > 10) {
            validation.errors.push(`Invalid pwm: ${parsed.pwm} (expected 1-10)`);
            validation.valid = false;
        }

        if (!parsed.hasOwnProperty('time')) {
            validation.errors.push('Missing required field: time');
            validation.valid = false;
        } else if (typeof parsed.time !== 'number' || parsed.time < 0) {
            validation.errors.push(`Invalid time: ${parsed.time} (expected >= 0)`);
            validation.valid = false;
        }

        // Check for extra fields
        const allowedFields = ['act_id', 'opmode', 'pwm', 'time'];
        const extraFields = Object.keys(parsed).filter(key => !allowedFields.includes(key));
        if (extraFields.length > 0) {
            validation.warnings.push(`Extra fields found: ${extraFields.join(', ')}`);
        }
    }
    // For schedule synchronization topic
    else if (topic === 'dslab055_cv') {
        // Check required fields for schedule data structure
        if (!parsed.hasOwnProperty('mtype')) {
            validation.errors.push('Missing required field: mtype');
            validation.valid = false;
        } else if (parsed.mtype !== 'tef_fed') {
            validation.warnings.push(`Unexpected mtype: ${parsed.mtype} (expected 'tef_fed')`);
        }

        if (!parsed.hasOwnProperty('test')) {
            validation.errors.push('Missing required field: test');
            validation.valid = false;
        } else if (typeof parsed.test !== 'number') {
            validation.errors.push(`Invalid test type: ${typeof parsed.test} (expected number)`);
            validation.valid = false;
        }

        if (!parsed.hasOwnProperty('reservations')) {
            validation.errors.push('Missing required field: reservations');
            validation.valid = false;
        } else if (!Array.isArray(parsed.reservations)) {
            validation.errors.push(`Invalid reservations type: ${typeof parsed.reservations} (expected array)`);
            validation.valid = false;
        } else {
            // Validate each reservation
            parsed.reservations.forEach((reservation, index) => {
                if (!reservation.SCHEDULE_TIME) {
                    validation.warnings.push(`Reservation ${index}: Missing SCHEDULE_TIME`);
                }
                if (!reservation.DAY_OF_WEEK || !Array.isArray(reservation.DAY_OF_WEEK) || reservation.DAY_OF_WEEK.length !== 7) {
                    validation.warnings.push(`Reservation ${index}: Invalid DAY_OF_WEEK (expected array of 7)`);
                }
                if (!reservation.RESERVATION_DATA || !reservation.RESERVATION_DATA.feed_set) {
                    validation.warnings.push(`Reservation ${index}: Missing RESERVATION_DATA.feed_set`);
                }
                if (!reservation.NO) {
                    validation.warnings.push(`Reservation ${index}: Missing NO`);
                }
            });
        }
    }
    // For RTC topics
    else if (topic === 'DIPSW_RTC') {
        if (!parsed.hasOwnProperty('cmd')) {
            validation.errors.push('Missing required field: cmd');
            validation.valid = false;
        }
    }

    return validation;
}

/**
 * Format message for display
 */
function formatMessage(topic, message, validation) {
    const lines = [];
    const timestamp = new Date().toISOString();

    // Header
    lines.push('');
    lines.push(colors.info('═'.repeat(80)));
    lines.push(colors.topic(`📨 Message Received on Topic: ${topic}`));
    lines.push(colors.info(`⏰ Timestamp: ${timestamp}`));
    lines.push(colors.info('─'.repeat(80)));

    // Parse message
    let parsed;
    try {
        parsed = JSON.parse(message);
    } catch (e) {
        lines.push(colors.error('❌ Invalid JSON:'));
        lines.push(colors.error(message));
        lines.push(colors.info('═'.repeat(80)));
        return lines.join('\n');
    }

    // Display fields
    if (topic === 'dslab055_cv') {
        // Special formatting for schedule data
        lines.push(colors.info('📋 Schedule Data Structure:'));
        lines.push(`  ${colors.field('mtype'.padEnd(15))}: ${colors.value(parsed.mtype)}`);
        lines.push(`  ${colors.field('test'.padEnd(15))}: ${colors.value(parsed.test)}`);
        lines.push(`  ${colors.field('reservations'.padEnd(15))}: ${colors.value(parsed.reservations ? parsed.reservations.length + ' schedules' : 'none')}`);

        if (parsed.reservations && parsed.reservations.length > 0) {
            lines.push(colors.info('─'.repeat(80)));
            lines.push(colors.info('📅 Schedule Details:'));
            parsed.reservations.forEach((reservation, index) => {
                lines.push(colors.info(`  Schedule ${index + 1}:`));
                lines.push(`    ${colors.field('NO')}: ${colors.value(reservation.NO)}`);
                lines.push(`    ${colors.field('Time')}: ${colors.value(reservation.SCHEDULE_TIME)}`);
                lines.push(`    ${colors.field('Days')}: ${colors.value(reservation.DAY_OF_WEEK ? reservation.DAY_OF_WEEK.join(',') : 'N/A')}`);
                lines.push(`    ${colors.field('Status')}: ${colors.value(reservation.DEL_YN === 'N' ? 'Active' : 'Deleted')}`);
                if (reservation.RESERVATION_DATA && reservation.RESERVATION_DATA.feed_set) {
                    lines.push(`    ${colors.field('Tanks')}: ${colors.value(reservation.RESERVATION_DATA.feed_set.length + ' configured')}`);
                    reservation.RESERVATION_DATA.feed_set.forEach((feed, feedIndex) => {
                        lines.push(`      Tank ${feedIndex + 1}: outlet=${feed.outlet}, pwm=${feed.feed_motor || Math.ceil(feed.quantity / 100)}, time=${feed.time / 10}s`);
                    });
                }
            });
        }
    } else {
        // Standard field display for other topics
        lines.push(colors.info('📋 Message Fields:'));
        Object.keys(parsed).forEach(key => {
            const value = parsed[key];
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
            lines.push(`  ${colors.field(key.padEnd(15))}: ${colors.value(displayValue)}`);
        });
    }

    // Validation results
    lines.push(colors.info('─'.repeat(80)));
    if (validation.valid) {
        lines.push(colors.success('✅ Validation: PASSED'));
    } else {
        lines.push(colors.error('❌ Validation: FAILED'));
        validation.errors.forEach(err => {
            lines.push(colors.error(`   • ${err}`));
        });
    }

    if (validation.warnings.length > 0) {
        lines.push(colors.warning('⚠️  Warnings:'));
        validation.warnings.forEach(warn => {
            lines.push(colors.warning(`   • ${warn}`));
        });
    }

    // Interpretation (for feeding messages)
    if ((topic === 'DIPSW_0' || topic === 'DIPSW_1') && validation.valid) {
        lines.push(colors.info('─'.repeat(80)));
        lines.push(colors.info('🔍 Interpretation:'));
        lines.push(`  ${colors.field('Tank Number')}: ${colors.value(parsed.act_id - 1)} (outlet ${parsed.act_id - 1})`);
        lines.push(`  ${colors.field('Operation Mode')}: ${colors.value(parsed.opmode === 64 ? 'Immediate Execution' : parsed.opmode)}`);
        lines.push(`  ${colors.field('Motor Rotations')}: ${colors.value(parsed.pwm)} rotations`);
        lines.push(`  ${colors.field('Duration')}: ${colors.value(parsed.time / 10)} seconds (${parsed.time} × 0.1s)`);

        // Calculate quantity from PWM
        const estimatedQuantity = parsed.pwm * 100;
        lines.push(`  ${colors.field('Est. Quantity')}: ${colors.value(estimatedQuantity)} (${parsed.pwm} × 100)`);
    }

    // Interpretation (for schedule sync messages)
    if (topic === 'dslab055_cv' && validation.valid) {
        lines.push(colors.info('─'.repeat(80)));
        lines.push(colors.success('🎯 Schedule Synchronization Message'));
        lines.push(colors.info('   IoT devices can now store and execute schedules autonomously'));
        lines.push(colors.info('   Devices will continue operating even if server goes offline'));
    }

    lines.push(colors.info('═'.repeat(80)));

    return lines.join('\n');
}

/**
 * Display statistics
 */
function displayStats() {
    console.log('');
    console.log(colors.info('═'.repeat(80)));
    console.log(colors.info('📊 MQTT Message Statistics'));
    console.log(colors.info('═'.repeat(80)));

    const runtime = Math.floor((new Date() - stats.startTime) / 1000);
    console.log(`  ${colors.field('Runtime')}: ${colors.value(runtime)} seconds`);
    console.log(`  ${colors.field('Total Messages')}: ${colors.value(stats.totalMessages)}`);
    console.log(`  ${colors.field('Valid Messages')}: ${colors.success(stats.validMessages)}`);
    console.log(`  ${colors.field('Invalid Messages')}: ${colors.error(stats.invalidMessages)}`);

    console.log('');
    console.log(colors.info('  Messages by Topic:'));
    Object.keys(stats.messagesByTopic).forEach(topic => {
        const count = stats.messagesByTopic[topic];
        console.log(`    ${colors.topic(topic.padEnd(20))}: ${colors.value(count)}`);
    });

    console.log(colors.info('═'.repeat(80)));
}

/**
 * Main function
 */
function main() {
    const client = mqtt.connect(MQTT_URL, {
        clientId: 'mqtt_test_' + Math.random().toString(16).slice(2, 8),
        reconnectPeriod: 2000,
        keepalive: 60
    });

    client.on('connect', () => {
        console.log(colors.success('✅ Connected to MQTT broker'));

        // Subscribe to all topics
        TOPICS.forEach(topic => {
            client.subscribe(topic, (err) => {
                if (err) {
                    console.log(colors.error(`❌ Failed to subscribe to ${topic}: ${err.message}`));
                } else {
                    console.log(colors.success(`✅ Subscribed to ${topic}`));
                }
            });
        });

        console.log('');
        console.log(colors.info('👂 Listening for messages... (Press Ctrl+C to stop)'));
        console.log('');
    });

    client.on('message', (topic, message) => {
        const messageStr = message.toString();

        // Update statistics
        stats.totalMessages++;
        stats.messagesByTopic[topic]++;

        // Validate message
        const validation = validateMessage(topic, messageStr);
        if (validation.valid) {
            stats.validMessages++;
        } else {
            stats.invalidMessages++;
        }

        // Display message
        const formatted = formatMessage(topic, messageStr, validation);
        console.log(formatted);
    });

    client.on('error', (err) => {
        console.log(colors.error(`❌ MQTT Error: ${err.message}`));
    });

    client.on('close', () => {
        console.log(colors.warning('⚠️  Connection closed'));
    });

    // Display stats every 30 seconds
    setInterval(() => {
        if (stats.totalMessages > 0) {
            displayStats();
        }
    }, 30000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('');
        console.log(colors.warning('🛑 Shutting down...'));
        displayStats();
        client.end();
        process.exit(0);
    });
}

// Run the test
main();

