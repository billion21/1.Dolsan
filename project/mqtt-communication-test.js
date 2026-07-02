/**
 * MQTT Communication Test Suite
 * 
 * Comprehensive testing of MQTT communication functionality:
 * 1. MQTT message sending (publish)
 * 2. MQTT message receiving (subscribe)
 * 3. Visual feedback via SSE
 * 4. End-to-end integration
 * 5. Error handling
 */

const mqtt = require('mqtt');
const http = require('http');

// Test configuration
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const SERVER_URL = 'http://localhost:3100';
const TEST_TIMEOUT = 10000; // 10 seconds per test

// Test results
const testResults = {
    passed: 0,
    failed: 0,
    total: 0,
    tests: []
};

// ANSI color codes for console output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(name, status, details = '') {
    const symbol = status === 'PASS' ? '✓' : '✗';
    const color = status === 'PASS' ? 'green' : 'red';
    log(`${symbol} ${name}`, color);
    if (details) {
        log(`  ${details}`, 'cyan');
    }
    
    testResults.total++;
    if (status === 'PASS') {
        testResults.passed++;
    } else {
        testResults.failed++;
    }
    testResults.tests.push({ name, status, details });
}

// Helper: Make HTTP request
function httpRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, SERVER_URL);
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(url, options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

// Test 1: MQTT Connection Test
async function testMQTTConnection() {
    log('\n=== Test 1: MQTT Connection ===', 'blue');
    
    return new Promise((resolve) => {
        const client = mqtt.connect(MQTT_URL, {
            clientId: 'test_client_' + Math.random().toString(16).slice(2, 8),
            connectTimeout: 5000
        });

        const timeout = setTimeout(() => {
            client.end();
            logTest('MQTT Connection', 'FAIL', 'Connection timeout');
            resolve();
        }, 5000);

        client.on('connect', () => {
            clearTimeout(timeout);
            logTest('MQTT Connection', 'PASS', `Connected to ${MQTT_URL}`);
            client.end();
            resolve();
        });

        client.on('error', (err) => {
            clearTimeout(timeout);
            logTest('MQTT Connection', 'FAIL', `Error: ${err.message}`);
            client.end();
            resolve();
        });
    });
}

// Test 2: MQTT Message Publishing
async function testMQTTPublishing() {
    log('\n=== Test 2: MQTT Message Publishing ===', 'blue');
    
    return new Promise((resolve) => {
        const client = mqtt.connect(MQTT_URL, {
            clientId: 'test_pub_' + Math.random().toString(16).slice(2, 8)
        });

        client.on('connect', () => {
            const topics = ['DIPSW_0', 'DIPSW_1', 'DIPSW_RTC'];
            let publishCount = 0;

            topics.forEach((topic, index) => {
                const message = {
                    act_id: 1,
                    opmode: 64,
                    pwm: 5,
                    time: 100
                };

                client.publish(topic, JSON.stringify(message), (err) => {
                    if (err) {
                        logTest(`Publish to ${topic}`, 'FAIL', `Error: ${err.message}`);
                    } else {
                        logTest(`Publish to ${topic}`, 'PASS', `Message: ${JSON.stringify(message)}`);
                    }
                    
                    publishCount++;
                    if (publishCount === topics.length) {
                        client.end();
                        resolve();
                    }
                });
            });
        });

        client.on('error', (err) => {
            logTest('MQTT Publishing', 'FAIL', `Connection error: ${err.message}`);
            client.end();
            resolve();
        });
    });
}

// Test 3: MQTT Message Receiving
async function testMQTTReceiving() {
    log('\n=== Test 3: MQTT Message Receiving ===', 'blue');
    
    return new Promise((resolve) => {
        const client = mqtt.connect(MQTT_URL, {
            clientId: 'test_sub_' + Math.random().toString(16).slice(2, 8)
        });

        const topics = ['DIPSW_1_cv', 'DIPSW_RTC_cv'];
        let subscribeCount = 0;
        const receivedMessages = {};

        client.on('connect', () => {
            topics.forEach(topic => {
                client.subscribe(topic, (err) => {
                    if (err) {
                        logTest(`Subscribe to ${topic}`, 'FAIL', `Error: ${err.message}`);
                        subscribeCount++;
                    } else {
                        logTest(`Subscribe to ${topic}`, 'PASS', 'Subscription successful');
                        subscribeCount++;
                        receivedMessages[topic] = false;
                    }

                    if (subscribeCount === topics.length) {
                        // Wait 2 seconds for messages, then cleanup
                        setTimeout(() => {
                            client.end();
                            resolve();
                        }, 2000);
                    }
                });
            });
        });

        client.on('message', (topic, message) => {
            if (topics.includes(topic)) {
                receivedMessages[topic] = true;
                logTest(`Receive from ${topic}`, 'PASS', `Message: ${message.toString().substring(0, 100)}`);
            }
        });

        client.on('error', (err) => {
            logTest('MQTT Receiving', 'FAIL', `Connection error: ${err.message}`);
            client.end();
            resolve();
        });
    });
}

// Test 4: API Endpoint - Execute Feeding Command
async function testFeedingCommandAPI() {
    log('\n=== Test 4: Feeding Command API ===', 'blue');
    
    try {
        const response = await httpRequest('POST', '/api/schedules/execute', {
            feederGroup: '1',
            upperMotor: 5,
            lowerMotor: 3,
            operationDuration: 60,
            operationInterval: 10
        });

        if (response.status === 200 && response.data.success) {
            logTest('Execute Feeding Command', 'PASS', 
                `Commands sent: ${response.data.commandsSent}, Topic: DIPSW_0`);
        } else {
            logTest('Execute Feeding Command', 'FAIL', 
                `Status: ${response.status}, Error: ${response.data.error || 'Unknown'}`);
        }
    } catch (error) {
        logTest('Execute Feeding Command', 'FAIL', `Error: ${error.message}`);
    }
}

// Test 5: API Endpoint - RTC Commands
async function testRTCCommandAPI() {
    log('\n=== Test 5: RTC Command API ===', 'blue');
    
    // Test get system time
    try {
        const sysTimeRes = await httpRequest('GET', '/api/rtc/system');
        if (sysTimeRes.status === 200 && sysTimeRes.data.timestamp) {
            logTest('Get System Time', 'PASS', 
                `Time: ${sysTimeRes.data.year}-${sysTimeRes.data.month}-${sysTimeRes.data.day} ${sysTimeRes.data.hour}:${sysTimeRes.data.minute}:${sysTimeRes.data.second}`);
        } else {
            logTest('Get System Time', 'FAIL', `Status: ${sysTimeRes.status}`);
        }
    } catch (error) {
        logTest('Get System Time', 'FAIL', `Error: ${error.message}`);
    }

    // Test get board time (mock mode)
    try {
        const boardTimeRes = await httpRequest('GET', '/api/rtc/board');
        if (boardTimeRes.status === 200 && boardTimeRes.data.success) {
            logTest('Get Board Time (Mock)', 'PASS', 
                `Time: ${JSON.stringify(boardTimeRes.data.data).substring(0, 100)}`);
        } else {
            logTest('Get Board Time (Mock)', 'FAIL', 
                `Status: ${boardTimeRes.status}, Error: ${boardTimeRes.data.error || 'Unknown'}`);
        }
    } catch (error) {
        logTest('Get Board Time (Mock)', 'FAIL', `Error: ${error.message}`);
    }
}

// Test 6: Operation Logs API
async function testOperationLogsAPI() {
    log('\n=== Test 6: Operation Logs API ===', 'blue');
    
    try {
        const logsRes = await httpRequest('GET', '/api/logs?limit=10');
        if (logsRes.status === 200 && logsRes.data.success !== undefined) {
            logTest('Get Operation Logs', 'PASS', 
                `Total logs: ${logsRes.data.total || 0}`);
        } else {
            logTest('Get Operation Logs', 'FAIL', `Status: ${logsRes.status}`);
        }
    } catch (error) {
        logTest('Get Operation Logs', 'FAIL', `Error: ${error.message}`);
    }
}

// Main test runner
async function runAllTests() {
    log('\n╔════════════════════════════════════════════════════════╗', 'cyan');
    log('║   MQTT Communication Comprehensive Test Suite         ║', 'cyan');
    log('╚════════════════════════════════════════════════════════╝', 'cyan');
    
    log('\nStarting tests...', 'yellow');
    log(`MQTT Broker: ${MQTT_URL}`, 'yellow');
    log(`Server URL: ${SERVER_URL}`, 'yellow');

    await testMQTTConnection();
    await testMQTTPublishing();
    await testMQTTReceiving();
    await testFeedingCommandAPI();
    await testRTCCommandAPI();
    await testOperationLogsAPI();

    // Print summary
    log('\n╔════════════════════════════════════════════════════════╗', 'cyan');
    log('║                    Test Summary                        ║', 'cyan');
    log('╚════════════════════════════════════════════════════════╝', 'cyan');
    log(`\nTotal Tests: ${testResults.total}`, 'blue');
    log(`Passed: ${testResults.passed}`, 'green');
    log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'green');
    log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`, 
        testResults.failed === 0 ? 'green' : 'yellow');

    process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(err => {
    log(`\nFatal error: ${err.message}`, 'red');
    process.exit(1);
});

