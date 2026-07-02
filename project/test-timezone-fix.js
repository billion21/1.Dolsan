/**
 * Test: Verify Time Zone Fix - Schedule Time Preservation
 * 
 * This test verifies that when a user enters "00:00" in the web UI,
 * it is saved as "00:00" in the SCHEDULE_TIME field without unwanted
 * timezone conversion.
 */

const http = require('http');
const fs = require('fs');

console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('🧪 Time Zone Fix Test');
console.log('════════════════════════════════════════════════════════════════════════════════');
console.log('');
console.log('🎯 Test Objective:');
console.log('   Verify that schedule times are saved exactly as entered');
console.log('   without unwanted timezone conversion.');
console.log('');

// Test cases with different times
const testCases = [
    { time: '00:00', description: 'Midnight (00:00)' },
    { time: '06:00', description: 'Morning (06:00)' },
    { time: '12:00', description: 'Noon (12:00)' },
    { time: '18:00', description: 'Evening (18:00)' },
    { time: '23:59', description: 'Late night (23:59)' }
];

let testIndex = 0;
let allTestsPassed = true;

async function runTest(testCase) {
    return new Promise((resolve, reject) => {
        console.log('─'.repeat(80));
        console.log(`📝 Test ${testIndex + 1}/${testCases.length}: ${testCase.description}`);
        console.log(`   Input time: ${testCase.time}`);
        console.log('');

        const testSchedule = {
            scheduleTime: testCase.time,
            dayOfWeek: [1, 1, 1, 1, 1, 1, 1],
            feedSet: [
                {
                    outlet: 0,
                    feed_motor: 5,
                    scatter_motor: 3,
                    quantity: 500,
                    time: 600,
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
                try {
                    const result = JSON.parse(data);

                    if (result.success) {
                        console.log(`✅ Schedule saved successfully (NO: ${result.data.NO})`);

                        // Wait a moment for file to be written
                        setTimeout(() => {
                            // Read schedules.json to verify
                            const schedulesData = JSON.parse(fs.readFileSync('project/schedules.json', 'utf8'));
                            const savedSchedule = schedulesData.reservations.find(r => r.NO === result.data.NO);

                            if (savedSchedule) {
                                const savedTime = savedSchedule.SCHEDULE_TIME;
                                console.log(`📄 Saved SCHEDULE_TIME: ${savedTime}`);

                                // Extract hour and minute from saved time
                                const savedDate = new Date(savedTime);
                                const savedHour = savedDate.getUTCHours().toString().padStart(2, '0');
                                const savedMinute = savedDate.getUTCMinutes().toString().padStart(2, '0');
                                const savedTimeString = `${savedHour}:${savedMinute}`;

                                console.log(`🔍 Extracted time: ${savedTimeString}`);

                                if (savedTimeString === testCase.time) {
                                    console.log(`✅ PASS: Time preserved correctly!`);
                                    console.log(`   Expected: ${testCase.time}`);
                                    console.log(`   Got:      ${savedTimeString}`);
                                } else {
                                    console.log(`❌ FAIL: Time not preserved!`);
                                    console.log(`   Expected: ${testCase.time}`);
                                    console.log(`   Got:      ${savedTimeString}`);
                                    allTestsPassed = false;
                                }
                            } else {
                                console.log(`❌ FAIL: Could not find saved schedule in file`);
                                allTestsPassed = false;
                            }

                            console.log('');
                            resolve();
                        }, 500);
                    } else {
                        console.log(`❌ FAIL: ${result.error}`);
                        allTestsPassed = false;
                        resolve();
                    }
                } catch (error) {
                    console.error('❌ Error parsing response:', error);
                    allTestsPassed = false;
                    reject(error);
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ Request error:', error);
            allTestsPassed = false;
            reject(error);
        });

        req.write(postData);
        req.end();
    });
}

async function runAllTests() {
    console.log('🚀 Starting tests...');
    console.log('');

    for (const testCase of testCases) {
        await runTest(testCase);
        testIndex++;
    }

    console.log('═'.repeat(80));
    console.log('📊 Test Summary');
    console.log('═'.repeat(80));
    console.log(`Total tests: ${testCases.length}`);
    console.log('');

    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED');
        console.log('✅ Time zone fix is working correctly!');
        console.log('✅ Schedule times are preserved exactly as entered');
        console.log('');
        console.log('🎉 The fix successfully resolves the timezone conversion issue!');
        process.exit(0);
    } else {
        console.log('❌ SOME TESTS FAILED');
        console.log('❌ Time zone fix is not working correctly');
        console.log('');
        console.log('Please review the test results above for details.');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

