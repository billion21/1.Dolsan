/**
 * Simple MQTT Connection Test
 * 
 * This script tests basic connectivity to the MQTT broker.
 * Run this before running the full MQTT testing tool to verify connectivity.
 * 
 * Usage:
 *   node test-mqtt-connection.js
 * 
 * Or with custom broker:
 *   MQTT_URL=mqtt://YOUR_IP:1883 node test-mqtt-connection.js
 */

const mqtt = require('mqtt');

// MQTT Configuration - same as server.js
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const TEST_TOPIC = 'test/connection';
const TIMEOUT_MS = 10000; // 10 seconds

console.log('═'.repeat(80));
console.log('🔌 MQTT Connection Test');
console.log('═'.repeat(80));
console.log(`📡 Broker URL: ${MQTT_URL}`);
console.log(`⏱️  Timeout: ${TIMEOUT_MS / 1000} seconds`);
console.log('');

let testPassed = false;

// Create MQTT client
const client = mqtt.connect(MQTT_URL, {
    clientId: 'connection_test_' + Math.random().toString(16).slice(2, 8),
    reconnectPeriod: 1000,
    keepalive: 60
});

// Connection timeout
const timeout = setTimeout(() => {
    if (!testPassed) {
        console.error('❌ Connection timeout after', TIMEOUT_MS / 1000, 'seconds');
        console.error('');
        console.error('Troubleshooting:');
        console.error('  1. Verify broker is running: ping', MQTT_URL.replace('mqtt://', '').split(':')[0]);
        console.error('  2. Check firewall settings');
        console.error('  3. Verify broker address is correct');
        console.error('  4. See MQTT_CONNECTION_TROUBLESHOOTING.md for detailed help');
        console.error('');
        process.exit(1);
    }
}, TIMEOUT_MS);

// Connection successful
client.on('connect', () => {
    console.log('✅ Connected to MQTT broker successfully!');
    console.log('');
    
    // Try to subscribe to test topic
    console.log(`📋 Testing subscription to topic: ${TEST_TOPIC}`);
    client.subscribe(TEST_TOPIC, (err) => {
        if (err) {
            console.error('❌ Failed to subscribe:', err.message);
            cleanup(1);
        } else {
            console.log('✅ Subscribed successfully!');
            console.log('');
            
            // Try to publish a test message
            console.log('📤 Publishing test message...');
            client.publish(TEST_TOPIC, 'Connection test message', (err) => {
                if (err) {
                    console.error('❌ Failed to publish:', err.message);
                    cleanup(1);
                } else {
                    console.log('✅ Published successfully!');
                    // Message will be received via 'message' event
                }
            });
        }
    });
});

// Message received
client.on('message', (topic, message) => {
    if (topic === TEST_TOPIC) {
        console.log('✅ Received test message:', message.toString());
        console.log('');
        console.log('═'.repeat(80));
        console.log('🎉 All tests passed! MQTT connection is working correctly.');
        console.log('═'.repeat(80));
        console.log('');
        console.log('You can now run:');
        console.log('  node test-mqtt-schedule-format.js');
        console.log('');
        testPassed = true;
        cleanup(0);
    }
});

// Connection error
client.on('error', (err) => {
    console.error('❌ MQTT Error:', err.message);
    console.error('');
    
    // Provide specific troubleshooting based on error type
    if (err.message.includes('ECONNREFUSED')) {
        console.error('Connection refused. Possible causes:');
        console.error('  1. MQTT broker is not running');
        console.error('  2. Broker is on a different address/port');
        console.error('  3. Firewall is blocking the connection');
        console.error('');
        console.error('Try:');
        console.error('  ping', MQTT_URL.replace('mqtt://', '').split(':')[0]);
    } else if (err.message.includes('ETIMEDOUT')) {
        console.error('Connection timed out. Possible causes:');
        console.error('  1. Broker is not reachable on network');
        console.error('  2. Firewall is blocking the connection');
        console.error('  3. Wrong IP address');
    } else if (err.message.includes('EHOSTUNREACH')) {
        console.error('Host unreachable. Possible causes:');
        console.error('  1. Broker machine is offline');
        console.error('  2. Network configuration issue');
        console.error('  3. Wrong IP address');
    }
    
    console.error('');
    console.error('See MQTT_CONNECTION_TROUBLESHOOTING.md for detailed help');
    console.error('');
    
    cleanup(1);
});

// Cleanup and exit
function cleanup(exitCode) {
    clearTimeout(timeout);
    if (client) {
        client.end(false, () => {
            process.exit(exitCode);
        });
    } else {
        process.exit(exitCode);
    }
}

// Handle Ctrl+C
process.on('SIGINT', () => {
    console.log('');
    console.log('⚠️  Test interrupted by user');
    cleanup(1);
});

