const express = require('express');
const path = require('path');
const fs = require('fs');
const mqtt = require('mqtt');
const { exec } = require('child_process');

const app = express();
const PORT = 3100;
const presetFilePath = path.join(__dirname, 'presets.json');
const schedulesFilePath = path.join(__dirname, 'schedules.json');
const logsFilePath = path.join(__dirname, 'operation_logs.json');
const MQTT_URL = process.env.MQTT_URL || 'mqtt://192.168.2.55:1883';
const client = mqtt.connect(MQTT_URL, {
    clientId: 'server_mqtt_client_' + Math.random().toString(16).slice(2, 8),
    reconnectPeriod: 2000,
    keepalive: 60,
});

client.on('packetsend', (packet) => {
    // console.log('Packet sent:', packet);
});

client.on('packetreceive', (packet) => {
    // console.log('Packet received:', packet);
});

let stopRequested = false; // Flag to control stopping
let processRunning = false; // Flag to indicate if the process is running
let mqttConnected = false; // Flag to indicate MQTT connection status
// SSE clients: IP별로 1개만 유지 (Chrome은 새로고침 시 close 이벤트 미발생)
const statusSSEClients = new Map(); // ip -> res

// ===================================
// RTC Configuration
// ===================================
// TODO: Confirm these settings with actual hardware
const RTC_CONFIG = {
    topic: 'DIPSW_RTC',           // Command topic (Server → Board)
    responseTopic: 'DIPSW_RTC_cv', // Response topic (Board → Server)
    timeout: 5000,                 // Response timeout (ms)
    retryAttempts: 3,              // Number of retry attempts
    retryDelay: 2000,              // Delay between retries (ms)
    mockMode: true,                // Enable mock responses for testing (set to false when hardware is ready)
    mockDelay: [500, 1500],        // Mock response delay range [min, max] in ms
    mockSuccessRate: 0.95          // Mock success rate (0.95 = 95% success, 5% error)
};

// RTC pending requests (for tracking timeouts and responses)
const rtcPendingRequests = new Map(); // requestId -> {resolve, reject, timeout}

// ===================================
// Linux System Time Synchronization
// ===================================

/**
 * Change Linux system time using the `date` command
 * This function is only executed on Linux platforms
 * @param {object} timeData - Time data with year, month, day, hour, minute, second
 * @returns {Promise} - Resolves on success, rejects on error
 */
function setLinuxSystemTime(timeData) {
    return new Promise((resolve, reject) => {
        // Only execute on Linux
        if (process.platform !== 'linux') {
            console.log(`[System Time] Skipping system time change (platform: ${process.platform})`);
            return resolve({ skipped: true, platform: process.platform });
        }

        // Validate time data
        if (!timeData || typeof timeData.hour === 'undefined' ||
            typeof timeData.minute === 'undefined' || typeof timeData.second === 'undefined') {
            return reject(new Error('Invalid time data: hour, minute, second are required'));
        }

        // Validate time ranges
        if (timeData.hour < 0 || timeData.hour > 23 ||
            timeData.minute < 0 || timeData.minute > 59 ||
            timeData.second < 0 || timeData.second > 59) {
            return reject(new Error('Invalid time values: hour (0-23), minute (0-59), second (0-59)'));
        }

        // Format time string: "HH:MM:SS"
        const timeString = `${String(timeData.hour).padStart(2, '0')}:${String(timeData.minute).padStart(2, '0')}:${String(timeData.second).padStart(2, '0')}`;

        // Build date command
        const dateCommand = `date -s "${timeString}"`;

        console.log(`[System Time] Executing: ${dateCommand}`);

        // Execute date command
        exec(dateCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`[System Time] Failed to set system time: ${error.message}`);
                console.error(`[System Time] stderr: ${stderr}`);

                // Check if it's a permission error
                if (error.message.includes('Operation not permitted') ||
                    stderr.includes('Operation not permitted')) {
                    return reject(new Error('Permission denied: Run with sudo or as root to change system time'));
                }

                return reject(new Error(`Failed to set system time: ${error.message}`));
            }

            console.log(`[System Time] System time set successfully: ${stdout.trim()}`);

            // Sync to hardware clock to persist across reboots
            const hwclockCommand = 'hwclock --systohc';
            console.log(`[System Time] Executing: ${hwclockCommand}`);

            exec(hwclockCommand, (hwError, hwStdout, hwStderr) => {
                if (hwError) {
                    console.warn(`[System Time] Warning: Failed to sync to hardware clock: ${hwError.message}`);
                    console.warn(`[System Time] System time was set but may not persist across reboots`);
                    // Don't reject - system time was still set successfully
                    return resolve({
                        success: true,
                        systemTime: stdout.trim(),
                        hwclockWarning: hwError.message
                    });
                }

                console.log(`[System Time] Hardware clock synced successfully`);
                resolve({
                    success: true,
                    systemTime: stdout.trim(),
                    hwclock: 'synced'
                });
            });
        });
    });
}


app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// PWA: Serve manifest.json with correct MIME type
app.get('/manifest.json', (req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// PWA: Serve service worker with correct MIME type
app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve new dashboard as default
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Keep old UI accessible for reference
app.get('/old', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ui.html'));
});

// ===================================
// RTC API Endpoints
// ===================================

// Get server system time (for offline NTP alternative)
app.get('/api/rtc/system', (req, res) => {
    const now = new Date();
    res.json({
        timestamp: Math.floor(now.getTime() / 1000),
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        iso: now.toISOString()
    });
});

// Get current board RTC time via MQTT
app.get('/api/rtc/board', async (req, res) => {
    console.log('RTC board time request received');

    if (!mqttConnected) {
        return res.status(503).json({
            success: false,
            error: 'MQTT not connected'
        });
    }

    try {
        const boardTime = await sendRTCCommand('get_rtc');
        res.json({
            success: true,
            data: boardTime
        });
    } catch (error) {
        console.error('Failed to get board RTC time:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Set board RTC time via MQTT and Linux system time (if on Linux)
app.post('/api/rtc/set', async (req, res) => {
    const timeData = req.body;
    console.log('═'.repeat(80));
    console.log('⏰ Time Sync Request');
    console.log('─'.repeat(80));
    console.log('Time Data:', timeData);
    console.log('Platform:', process.platform);
    console.log('═'.repeat(80));

    if (!mqttConnected) {
        return res.status(503).json({
            success: false,
            error: 'MQTT not connected'
        });
    }

    try {
        // Step 1: Set Linux system time (if on Linux)
        let systemTimeResult = null;
        try {
            systemTimeResult = await setLinuxSystemTime(timeData);
            if (systemTimeResult.skipped) {
                console.log(`[Time Sync] System time change skipped (platform: ${systemTimeResult.platform})`);
            } else if (systemTimeResult.success) {
                console.log(`[Time Sync] ✅ Linux system time changed successfully`);
                if (systemTimeResult.hwclockWarning) {
                    console.warn(`[Time Sync] ⚠️ Hardware clock sync warning: ${systemTimeResult.hwclockWarning}`);
                }
            }
        } catch (sysTimeError) {
            console.error(`[Time Sync] ❌ Failed to set Linux system time: ${sysTimeError.message}`);
            // Don't fail the entire request - continue with MQTT sync
            systemTimeResult = { error: sysTimeError.message };
        }

        // Step 2: Send MQTT command to IoT device RTC
        const mqttResult = await sendRTCCommand('set_rtc', timeData);
        console.log(`[Time Sync] ✅ MQTT RTC command sent successfully`);

        // Build response
        const response = {
            success: true,
            message: 'Time synchronization completed',
            mqtt: mqttResult
        };

        // Add system time result if applicable
        if (systemTimeResult) {
            if (systemTimeResult.skipped) {
                response.systemTime = { skipped: true, reason: `Not on Linux (${systemTimeResult.platform})` };
            } else if (systemTimeResult.success) {
                response.systemTime = {
                    success: true,
                    time: systemTimeResult.systemTime,
                    hwclock: systemTimeResult.hwclock || systemTimeResult.hwclockWarning
                };
            } else if (systemTimeResult.error) {
                response.systemTime = {
                    success: false,
                    error: systemTimeResult.error
                };
            }
        }

        console.log('═'.repeat(80));
        console.log('⏰ Time Sync Complete');
        console.log('─'.repeat(80));
        console.log('Response:', JSON.stringify(response, null, 2));
        console.log('═'.repeat(80));

        res.json(response);
    } catch (error) {
        console.error('═'.repeat(80));
        console.error('❌ Time Sync Failed');
        console.error('─'.repeat(80));
        console.error('Error:', error.message);
        console.error('═'.repeat(80));

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===================================
// Schedule Management API Endpoints
// ===================================

// Get all schedules (DAY_OF_WEEK array format)
app.get('/api/schedules', (req, res) => {
    try {
        let data = JSON.parse(fs.readFileSync(schedulesFilePath, 'utf8'));

        // Check if data is in old format and migrate to DAY_OF_WEEK array format
        if (Array.isArray(data.schedules) || (data.schedules && typeof data.schedules === 'object' && !data.mtype)) {
            console.log('Migrating to DAY_OF_WEEK array format');
            data = migrateToDayOfWeekArrayFormat(data);
            // Save migrated data
            fs.writeFileSync(schedulesFilePath, JSON.stringify(data, null, 2));
        }

        // Ensure proper structure
        if (!data.mtype) {
            data = {
                mtype: 'tef_fed',
                test: 0,
                reservations: [],
                lastUpdated: new Date().toISOString()
            };
        }

        res.json({
            success: true,
            data: {
                mtype: data.mtype,
                test: data.test || 0,
                reservations: data.reservations || []
            },
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        console.error('Failed to read schedules:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            data: {
                mtype: 'tef_fed',
                test: 0,
                reservations: []
            }
        });
    }
});

// Helper function: Migrate to DAY_OF_WEEK array format
function migrateToDayOfWeekArrayFormat(oldData) {
    console.log('Starting migration to DAY_OF_WEEK array format');

    const newReservations = [];
    let nextNo = 1;

    // Case 1: Old interval-based format (array of schedules)
    if (Array.isArray(oldData.schedules)) {
        console.log('Migrating from interval-based format');

        oldData.schedules.forEach(oldSchedule => {
            // Migrate old feedingTimes format to reservations if needed
            let schedule = oldSchedule;
            if (schedule.feedingTimes && !schedule.reservations) {
                schedule = migrateReservationFormat(schedule);
            }

            // Get feeding interval (default to 1 = every day)
            const interval = schedule.feedingInterval || 1;

            // Calculate DAY_OF_WEEK array based on interval
            const dayOfWeek = calculateDayOfWeekFromInterval(interval);

            // Process each reservation
            if (schedule.reservations && Array.isArray(schedule.reservations)) {
                schedule.reservations.forEach(reservation => {
                    // Convert scheduleTime (HH:MM) to ISO 8601 format
                    const scheduleTime = convertToISO8601(reservation.scheduleTime);

                    const newReservation = {
                        SCHEDULE_TIME: scheduleTime,
                        DAY_OF_WEEK: dayOfWeek,
                        RESERVATION_DATA: {
                            feed_set: reservation.feedSet || []
                        },
                        DEL_YN: schedule.enabled === false ? 'Y' : 'N',
                        NO: nextNo++,
                        SIZE: 6 // Default placeholder
                    };

                    newReservations.push(newReservation);
                });
            }
        });
    }
    // Case 2: Day-separated format (object with day keys)
    else if (oldData.schedules && typeof oldData.schedules === 'object') {
        console.log('Migrating from day-separated format');

        const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

        dayKeys.forEach((dayKey, dayIndex) => {
            const daySchedules = oldData.schedules[dayKey] || [];

            daySchedules.forEach(schedule => {
                // Create DAY_OF_WEEK array with only this day enabled
                const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
                dayOfWeek[dayIndex] = 1;

                // Convert scheduleTime to ISO 8601
                const scheduleTime = convertToISO8601(schedule.scheduleTime);

                const newReservation = {
                    SCHEDULE_TIME: scheduleTime,
                    DAY_OF_WEEK: dayOfWeek,
                    RESERVATION_DATA: {
                        feed_set: schedule.feedSet || []
                    },
                    DEL_YN: schedule.enabled === false ? 'Y' : 'N',
                    NO: nextNo++,
                    SIZE: 6
                };

                newReservations.push(newReservation);
            });
        });
    }

    console.log(`Migration complete. Created ${newReservations.length} reservations.`);

    return {
        mtype: 'tef_fed',
        test: 0,
        reservations: newReservations,
        lastUpdated: new Date().toISOString()
    };
}

// Helper function: Calculate DAY_OF_WEEK array from feeding interval
function calculateDayOfWeekFromInterval(interval) {
    // interval 1 = every day
    // interval 2 = every other day
    // interval 3 = every 3 days
    // etc.

    if (interval === 1) {
        return [1, 1, 1, 1, 1, 1, 1]; // Every day
    }

    const dayOfWeek = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i += interval) {
        dayOfWeek[i] = 1;
    }
    return dayOfWeek;
}

// Helper function: Convert HH:MM time to ISO 8601 datetime string
function convertToISO8601(timeString) {
    // timeString format: "HH:MM" or "HH:MM:SS"
    const now = new Date();
    const [hours, minutes] = timeString.split(':').map(Number);

    // Use UTC methods to preserve the time as entered without timezone conversion
    // This ensures "00:00" is stored as "00:00" UTC, not converted to local timezone
    now.setUTCHours(hours || 0);
    now.setUTCMinutes(minutes || 0);
    now.setUTCSeconds(0);
    now.setUTCMilliseconds(0);

    return now.toISOString();
}

// Helper function: Extract HH:MM time from ISO 8601 datetime string
function extractTimeFromISO8601(isoString) {
    const date = new Date(isoString);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Helper function: Check if two reservations have the same time and overlapping outlets
function isDuplicateReservation(reservation1, reservation2) {
    // Extract time from both reservations
    const time1 = extractTimeFromISO8601(reservation1.SCHEDULE_TIME);
    const time2 = extractTimeFromISO8601(reservation2.SCHEDULE_TIME);

    // If times don't match, not a duplicate
    if (time1 !== time2) {
        return false;
    }

    // Check if they have overlapping outlets in feed_set
    const outlets1 = new Set();
    const outlets2 = new Set();

    if (reservation1.RESERVATION_DATA?.feed_set) {
        reservation1.RESERVATION_DATA.feed_set.forEach(fs => outlets1.add(fs.outlet));
    }

    if (reservation2.RESERVATION_DATA?.feed_set) {
        reservation2.RESERVATION_DATA.feed_set.forEach(fs => outlets2.add(fs.outlet));
    }

    // Check if there's any overlap in outlets
    for (const outlet of outlets1) {
        if (outlets2.has(outlet)) {
            return true; // Found overlapping outlet at same time
        }
    }

    return false;
}

// Helper function: Migrate old feedingTimes format to reservation format
function migrateReservationFormat(schedule) {
    if (schedule.reservations) {
        return schedule; // Already in reservation format
    }

    if (!schedule.feedingTimes || !Array.isArray(schedule.feedingTimes)) {
        return schedule; // No feedingTimes to migrate
    }

    console.log('Migrating feedingTimes to reservations for schedule:', schedule.id);

    const reservations = schedule.feedingTimes.map(timeString => {
        const feedSet = [];

        // Add outlet 0 (upper motor) if configured
        if (schedule.upperMotor !== undefined && schedule.upperMotor > 0) {
            feedSet.push({
                outlet: 0,
                quantity: schedule.upperMotor * 100,
                time: (schedule.operationDuration || 60), // Raw seconds - firmware converts
                active: 1
            });
        }

        // Add outlet 1 (lower motor) if configured
        if (schedule.lowerMotor !== undefined && schedule.lowerMotor > 0) {
            feedSet.push({
                outlet: 1,
                quantity: schedule.lowerMotor * 100,
                time: (schedule.operationDuration || 60), // Raw seconds - firmware converts
                active: 1
            });
        }

        return {
            scheduleTime: timeString,
            feedSet: feedSet
        };
    });

    return {
        ...schedule,
        reservations: reservations
    };
}

// Save a new schedule (DAY_OF_WEEK array format)
app.post('/api/schedules/save', (req, res) => {
    try {
        const { scheduleTime, dayOfWeek, feedSet, upperMotor, lowerMotor, operationDuration, test } = req.body;

        // Validate required fields
        if (!scheduleTime || !dayOfWeek || !Array.isArray(dayOfWeek) || dayOfWeek.length !== 7) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: scheduleTime and dayOfWeek (array of 7) are required'
            });
        }

        // Read existing schedules
        let data = { mtype: 'tef_fed', test: 0, reservations: [], lastUpdated: null };
        try {
            data = JSON.parse(fs.readFileSync(schedulesFilePath, 'utf8'));

            // Migrate old format if needed
            if (Array.isArray(data.schedules) || (data.schedules && typeof data.schedules === 'object' && !data.mtype)) {
                data = migrateToDayOfWeekArrayFormat(data);
            }
        } catch (e) {
            // File doesn't exist or is invalid, initialize with empty structure
            console.log('Initializing new schedules file');
        }

        // Ensure proper structure
        if (!data.mtype) {
            data.mtype = 'tef_fed';
        }
        if (!data.reservations) {
            data.reservations = [];
        }

        // Calculate next NO (sequence number)
        const maxNo = data.reservations.reduce((max, r) => Math.max(max, r.NO || 0), 0);
        const nextNo = maxNo + 1;

        // Build feed_set array
        let feed_set = [];

        // NEW FORMAT: Use feedSet if provided (multi-tank with feed_motor/scatter_motor)
        if (feedSet && Array.isArray(feedSet) && feedSet.length > 0) {
            feed_set = feedSet;
            console.log('Using new feedSet format with', feedSet.length, 'tanks');
        }
        // OLD FORMAT: Fallback to upperMotor/lowerMotor for backward compatibility
        else if (upperMotor || lowerMotor) {
            console.log('Using legacy upperMotor/lowerMotor format');
            if (upperMotor && upperMotor > 0) {
                feed_set.push({
                    outlet: 0,
                    quantity: upperMotor * 100,
                    time: (operationDuration || 60) * 10,
                    active: 1
                });
            }
            if (lowerMotor && lowerMotor > 0) {
                feed_set.push({
                    outlet: 1,
                    quantity: lowerMotor * 100,
                    time: (operationDuration || 60) * 10,
                    active: 1
                });
            }
        }

        // Validate that we have at least one feed_set entry
        if (feed_set.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request: feedSet must contain at least one tank configuration'
            });
        }

        // Convert scheduleTime to ISO 8601
        const scheduleTimeISO = convertToISO8601(scheduleTime);

        // Create new reservation object
        const newReservation = {
            SCHEDULE_TIME: scheduleTimeISO,
            DAY_OF_WEEK: dayOfWeek,
            RESERVATION_DATA: {
                feed_set: feed_set
            },
            DEL_YN: 'N',
            NO: nextNo,
            SIZE: 6 // Default placeholder
        };

        // ===================================
        // Duplicate Detection and Handling
        // ===================================
        // Check if a reservation with the same time and outlet already exists
        let duplicateIndex = -1;
        let duplicateReservation = null;

        for (let i = 0; i < data.reservations.length; i++) {
            if (isDuplicateReservation(data.reservations[i], newReservation)) {
                duplicateIndex = i;
                duplicateReservation = data.reservations[i];
                break;
            }
        }

        let savedNo;
        if (duplicateIndex !== -1) {
            // Duplicate found - Update existing reservation
            console.log(`Duplicate schedule found at index ${duplicateIndex} (NO: ${duplicateReservation.NO})`);
            console.log(`Updating existing reservation with new settings`);

            // Keep the original NO
            savedNo = duplicateReservation.NO;
            newReservation.NO = savedNo;

            // Replace the existing reservation
            data.reservations[duplicateIndex] = newReservation;

            console.log(`Updated reservation NO: ${savedNo} at time ${scheduleTime}`);
        } else {
            // No duplicate - Add as new reservation
            savedNo = nextNo;
            data.reservations.push(newReservation);
            console.log(`New schedule added with NO: ${savedNo}`);
        }

        data.lastUpdated = new Date().toISOString();

        // Save to file
        fs.writeFileSync(schedulesFilePath, JSON.stringify(data, null, 2));

        // ===================================
        // MQTT Schedule Synchronization
        // ===================================
        // Publish complete schedule data structure to IoT devices
        // This enables device-side autonomous scheduling
        if (mqttConnected) {
            // Filter to only include active schedules (DEL_YN = "N")
            // Deleted schedules should not be sent to IoT devices
            const activeReservations = data.reservations.filter(r => r.DEL_YN === 'N');

            const schedulePayload = {
                mtype: data.mtype,
                test: data.test || 0,
                reservations: activeReservations
            };

            const scheduleMessage = JSON.stringify(schedulePayload);

            console.log('═'.repeat(80));
            console.log('📡 MQTT SCHEDULE SYNCHRONIZATION');
            console.log('═'.repeat(80));
            console.log(`📤 Publishing active schedule data to dslab055_cv topic`);
            console.log(`📊 Total reservations: ${data.reservations.length} (Active: ${activeReservations.length}, Deleted: ${data.reservations.length - activeReservations.length})`);
            if (duplicateIndex !== -1) {
                console.log(`🔄 Updated reservation NO: ${savedNo} (duplicate found at time ${scheduleTime})`);
            } else {
                console.log(`🆕 New reservation NO: ${savedNo}`);
            }
            console.log(`📦 Payload size: ${scheduleMessage.length} bytes`);
            console.log('─'.repeat(80));
            console.log('📋 Active Schedule Data Structure:');
            console.log(JSON.stringify(schedulePayload, null, 2));
            console.log('═'.repeat(80));

            client.publish('dslab055_cv', scheduleMessage, { qos: 1, retain: true }, (err) => {
                if (err) {
                    console.error('❌ Error publishing schedule to MQTT:', err);
                    console.log('⚠️  Schedule saved to file but MQTT sync failed');
                } else {
                    console.log('✅ Active schedule data successfully published to MQTT');
                    console.log(`📡 IoT devices received ${activeReservations.length} active schedules`);
                }
            });
        } else {
            console.log('⚠️  MQTT not connected - schedule saved to file only');
            console.log('⚠️  IoT devices will not receive schedule update');
        }

        res.json({
            success: true,
            message: duplicateIndex !== -1 ? '기존 스케줄이 업데이트되었습니다' : '스케줄이 저장되었습니다',
            data: {
                NO: savedNo,
                updated: duplicateIndex !== -1
            }
        });
    } catch (error) {
        console.error('Failed to save schedule:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Delete a schedule (DAY_OF_WEEK array format)
app.delete('/api/schedules/:no', (req, res) => {
    try {
        const no = parseInt(req.params.no);

        if (isNaN(no)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid NO parameter'
            });
        }

        // Read existing schedules
        let data = JSON.parse(fs.readFileSync(schedulesFilePath, 'utf8'));

        // Migrate old format if needed
        if (Array.isArray(data.schedules) || (data.schedules && typeof data.schedules === 'object' && !data.mtype)) {
            data = migrateToDayOfWeekArrayFormat(data);
        }

        // Ensure proper structure
        if (!data.reservations || !Array.isArray(data.reservations)) {
            return res.status(404).json({
                success: false,
                error: 'No schedules found'
            });
        }

        // Find and remove the schedule with matching NO
        const originalLength = data.reservations.length;
        data.reservations = data.reservations.filter(r => r.NO !== no);

        if (data.reservations.length === originalLength) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }

        data.lastUpdated = new Date().toISOString();

        // Save to file
        fs.writeFileSync(schedulesFilePath, JSON.stringify(data, null, 2));

        console.log(`Schedule deleted with NO: ${no}`);

        // ===================================
        // MQTT Schedule Synchronization (Delete)
        // ===================================
        // Publish updated schedule data to IoT devices after deletion
        if (mqttConnected) {
            // Filter to only include active schedules (DEL_YN = "N")
            // Deleted schedules should not be sent to IoT devices
            const activeReservations = data.reservations.filter(r => r.DEL_YN === 'N');

            const schedulePayload = {
                mtype: data.mtype,
                test: data.test || 0,
                reservations: activeReservations
            };

            const scheduleMessage = JSON.stringify(schedulePayload);

            console.log('═'.repeat(80));
            console.log('📡 MQTT SCHEDULE SYNCHRONIZATION (DELETE)');
            console.log('═'.repeat(80));
            console.log(`📤 Publishing active schedule data to dslab055_cv topic`);
            console.log(`🗑️  Deleted reservation NO: ${no}`);
            console.log(`📊 Total reservations: ${data.reservations.length} (Active: ${activeReservations.length}, Deleted: ${data.reservations.length - activeReservations.length})`);
            console.log('═'.repeat(80));

            client.publish('dslab055_cv', scheduleMessage, { qos: 1, retain: true }, (err) => {
                if (err) {
                    console.error('❌ Error publishing schedule update to MQTT:', err);
                } else {
                    console.log('✅ Active schedule data successfully published to MQTT');
                    console.log(`📡 IoT devices received ${activeReservations.length} active schedules`);
                }
            });
        } else {
            console.log('⚠️  MQTT not connected - schedule deleted from file only');
        }

        res.json({
            success: true,
            message: '스케줄이 삭제되었습니다'
        });
    } catch (error) {
        console.error('Failed to delete schedule:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update schedule enabled/disabled status (DAY_OF_WEEK array format)
app.patch('/api/schedules/:no/toggle', (req, res) => {
    try {
        const no = parseInt(req.params.no);
        const { enabled } = req.body;

        if (isNaN(no)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid NO parameter'
            });
        }

        // Read existing schedules
        let data = JSON.parse(fs.readFileSync(schedulesFilePath, 'utf8'));

        // Migrate old format if needed
        if (Array.isArray(data.schedules) || (data.schedules && typeof data.schedules === 'object' && !data.mtype)) {
            data = migrateToDayOfWeekArrayFormat(data);
        }

        // Find and update schedule
        const reservation = data.reservations.find(r => r.NO === no);
        if (!reservation) {
            return res.status(404).json({
                success: false,
                error: 'Schedule not found'
            });
        }

        // Update DEL_YN based on enabled status
        reservation.DEL_YN = enabled ? 'N' : 'Y';
        data.lastUpdated = new Date().toISOString();

        // Save to file
        fs.writeFileSync(schedulesFilePath, JSON.stringify(data, null, 2));

        console.log('Schedule toggled:', no, 'enabled:', enabled);

        // ===================================
        // MQTT Schedule Synchronization (Toggle)
        // ===================================
        // Publish updated schedule data to IoT devices after toggle
        if (mqttConnected) {
            // Filter to only include active schedules (DEL_YN = "N")
            // Inactive schedules should not be sent to IoT devices
            const activeReservations = data.reservations.filter(r => r.DEL_YN === 'N');

            const schedulePayload = {
                mtype: data.mtype,
                test: data.test || 0,
                reservations: activeReservations
            };

            const scheduleMessage = JSON.stringify(schedulePayload);

            console.log('═'.repeat(80));
            console.log('📡 MQTT Schedule Sync (Toggle)');
            console.log(`📦 Payload size: ${scheduleMessage.length} bytes`);
            console.log('─'.repeat(80));
            console.log('📋 Active Schedule Data Structure:');
            console.log(JSON.stringify(schedulePayload, null, 2));
            console.log('═'.repeat(80));

            client.publish('dslab055_cv', scheduleMessage, { qos: 1, retain: true }, (err) => {
                if (err) {
                    console.error('❌ Error publishing schedule update to MQTT:', err);
                } else {
                    console.log('✅ Active schedule data successfully published to MQTT');
                    console.log(`📡 IoT devices received ${activeReservations.length} active schedules`);
                }
            });
        } else {
            console.log('⚠️  MQTT not connected - schedule toggled in file only');
        }

        res.json({
            success: true,
            message: '스케줄 상태가 업데이트되었습니다'
        });
    } catch (error) {
        console.error('Failed to toggle schedule:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Execute feeding command based on schedule configuration
// Supports both old format (upperMotor, lowerMotor) and new format (feedSet)
app.post('/api/schedules/execute', (req, res) => {
    try {
        const { feederGroup, feedSet, upperMotor, lowerMotor, operationDuration } = req.body;

        // Validate input
        if (!feederGroup) {
            return res.status(400).json({
                success: false,
                error: 'Missing required field: feederGroup'
            });
        }

        if (!mqttConnected) {
            return res.status(503).json({
                success: false,
                error: 'MQTT not connected'
            });
        }

        // Determine topic based on feeder group
        const topic = feederGroup === '1' ? 'DIPSW_0' : 'DIPSW_1';

        // Generate feeding commands
        const commands = [];

        // NEW FORMAT: Use feedSet if provided
        if (feedSet && Array.isArray(feedSet) && feedSet.length > 0) {
            console.log('');
            console.log('🔄 Using new feedSet format for execution');
            console.log(`📋 FeedSet contains ${feedSet.length} entries:`);
            feedSet.forEach((config, idx) => {
                console.log(`   [${idx + 1}] outlet: ${config.outlet}, quantity: ${config.quantity}, time: ${config.time}, active: ${config.active}`);
            });
            console.log('');

            for (const feedConfig of feedSet) {
                // Skip if not active
                if (feedConfig.active !== 1) {
                    console.log(`⏭️  Skipping inactive outlet ${feedConfig.outlet}`);
                    continue;
                }

                // Convert quantity to PWM (1-10 range)
                // quantity 0-100 → PWM 1, 101-200 → PWM 2, ..., 901-1000+ → PWM 10
                const pwm = Math.max(1, Math.min(10, Math.ceil(feedConfig.quantity / 100)));

                console.log(`✅ Processing outlet ${feedConfig.outlet}:`);
                console.log(`   - quantity ${feedConfig.quantity} → PWM ${pwm}`);
                console.log(`   - time ${feedConfig.time} seconds`);

                // Create MQTT command
                // Outlet numbering: 10-13 (storage) → act_id 10-13 (MQTT)
                // No conversion needed - use outlet number directly as act_id
                commands.push({
                    topic: topic,
                    act_id: feedConfig.outlet,  // outlet 10 → act_id 10, outlet 11 → act_id 11, etc.
                    opmode: 64,  // Immediate execution
                    pwm: pwm,
                    time: feedConfig.time  // Time in seconds - firmware converts if needed
                });
            }
        }
        // OLD FORMAT: Use upperMotor/lowerMotor if feedSet not provided
        else if (upperMotor !== undefined || lowerMotor !== undefined) {
            console.log('Using old upperMotor/lowerMotor format for execution');

            // Convert motor rotations to PWM values (1-10 range)
            const upperPWM = Math.max(1, Math.min(10, parseInt(upperMotor || 0)));
            const lowerPWM = Math.max(1, Math.min(10, parseInt(lowerMotor || 0)));

            // Duration in seconds - firmware handles conversion if needed
            const durationInSeconds = parseInt(operationDuration || 60);

            // Upper motor command (act_id 1 for upper motor)
            if (upperMotor > 0) {
                commands.push({
                    topic: topic,
                    act_id: 1,
                    opmode: 64,  // Immediate execution
                    pwm: upperPWM,
                    time: durationInSeconds
                });
            }

            // Lower motor command (act_id 2 for lower motor)
            if (lowerMotor > 0) {
                commands.push({
                    topic: topic,
                    act_id: 2,
                    opmode: 64,  // Immediate execution
                    pwm: lowerPWM,
                    time: durationInSeconds
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: either feedSet or upperMotor/lowerMotor'
            });
        }

        // Check if we have any commands to send
        if (commands.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No active feeding commands to execute'
            });
        }

        // Send commands sequentially
        let commandsSent = 0;
        const sendNextCommand = (index) => {
            if (index >= commands.length) {
                console.log(`All feeding commands sent for feeder ${feederGroup}`);

                // Log the feeding operation
                const details = feedSet
                    ? `FeedSet: ${JSON.stringify(feedSet.filter(f => f.active === 1))}`
                    : `상위 모터: ${upperMotor}, 하위 모터: ${lowerMotor}, 시간: ${operationDuration}초`;

                addOperationLog({
                    action: '급이 실행',
                    feederGroup: feederGroup,
                    status: 'success',
                    details: details,
                    timestamp: new Date().toISOString()
                });

                return res.json({
                    success: true,
                    message: 'Feeding commands sent successfully',
                    commandsSent: commandsSent,
                    commands: commands
                });
            }

            const cmd = commands[index];
            const message = JSON.stringify({
                act_id: cmd.act_id,
                opmode: cmd.opmode,
                pwm: cmd.pwm,
                time: cmd.time
            });

            console.log('═'.repeat(80));
            console.log(`📤 MQTT PUBLISH [${index + 1}/${commands.length}]`);
            console.log(`   Topic: ${cmd.topic}`);
            console.log(`   Message: ${message}`);
            console.log(`   Details:`);
            console.log(`     - Tank (outlet): ${cmd.act_id - 1} → act_id: ${cmd.act_id}`);
            console.log(`     - Operation Mode: ${cmd.opmode} (${cmd.opmode === 64 ? 'Immediate Execution' : 'Unknown'})`);
            console.log(`     - Motor Rotations (PWM): ${cmd.pwm}`);
            console.log(`     - Duration: ${cmd.time} seconds`);
            console.log('═'.repeat(80));

            client.publish(cmd.topic, message, (err) => {
                if (err) {
                    console.error('Error publishing feeding command:', err);
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to send feeding command: ' + err.message
                    });
                }

                commandsSent++;
                // Small delay between commands
                setTimeout(() => sendNextCommand(index + 1), 100);
            });
        };

        // Start sending commands
        sendNextCommand(0);

    } catch (error) {
        console.error('Failed to execute feeding command:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ===================================
// Operation Logging API Endpoints
// ===================================

// Get operation logs
app.get('/api/logs', (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(logsFilePath, 'utf8'));
        const limit = parseInt(req.query.limit) || 100;
        const logs = data.logs.slice(-limit).reverse(); // Get last N logs, newest first

        res.json({
            success: true,
            logs: logs,
            total: data.logs.length,
            lastUpdated: data.lastUpdated
        });
    } catch (error) {
        console.error('Failed to read logs:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            logs: []
        });
    }
});

// Add operation log entry
app.post('/api/logs/add', (req, res) => {
    try {
        const logEntry = req.body;

        // Validate log entry
        if (!logEntry.action || !logEntry.feederGroup) {
            return res.status(400).json({
                success: false,
                error: 'Invalid log entry: action and feederGroup are required'
            });
        }

        // Read existing logs
        let data = { logs: [], lastUpdated: null };
        try {
            data = JSON.parse(fs.readFileSync(logsFilePath, 'utf8'));
        } catch (e) {
            // File doesn't exist or is invalid, use default
        }

        // Add timestamp if not provided
        if (!logEntry.timestamp) {
            logEntry.timestamp = new Date().toISOString();
        }

        // Add log entry
        data.logs.push(logEntry);

        // Keep only last 1000 logs to prevent file from growing too large
        if (data.logs.length > 1000) {
            data.logs = data.logs.slice(-1000);
        }

        data.lastUpdated = new Date().toISOString();

        // Save to file
        fs.writeFileSync(logsFilePath, JSON.stringify(data, null, 2));

        // Broadcast log to SSE clients
        broadcastStatus({
            type: 'log',
            log: logEntry
        });

        console.log('Log entry added:', logEntry.action);
        res.json({
            success: true,
            log: logEntry
        });
    } catch (error) {
        console.error('Failed to add log entry:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear all logs
app.delete('/api/logs/clear', (req, res) => {
    try {
        const data = {
            logs: [],
            lastUpdated: new Date().toISOString()
        };

        fs.writeFileSync(logsFilePath, JSON.stringify(data, null, 2));

        console.log('All logs cleared');
        res.json({
            success: true,
            message: 'All logs cleared'
        });
    } catch (error) {
        console.error('Failed to clear logs:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// SSE endpoint: relay DIPSW_1_cv status to browsers
app.get('/api/status-stream', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress;

    // 같은 IP의 기존 연결이 있으면 강제 종료 (Chrome 새로고침 시 close 이벤트 미발생 대응)
    const existing = statusSSEClients.get(ip);
    if (existing) {
        try { existing.end(); } catch (e) { /* ignore */ }
        statusSSEClients.delete(ip);
        console.log('SSE: closed previous connection for', ip);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders && res.flushHeaders();
    res.write(': connected\n\n');

    statusSSEClients.set(ip, res);
    console.log('SSE client connected:', ip, 'Total:', statusSSEClients.size);

    const cleanup = () => {
        if (statusSSEClients.get(ip) === res) {
            statusSSEClients.delete(ip);
            console.log('SSE client disconnected:', ip, 'Total:', statusSSEClients.size);
        }
    };
    res.on('close', cleanup);
    req.on('close', cleanup);
});

function broadcastStatus(obj) {
    const data = JSON.stringify(obj);
    for (const [ip, clientRes] of statusSSEClients) {
        try { clientRes.write(`data: ${data}\n\n`); }
        catch (e) {
            statusSSEClients.delete(ip);
            console.log('SSE broadcastStatus: removed dead client', ip);
        }
    }
}


// MQTT connection event
client.on('connect', () => {
    console.log('MQTT client connected');
    mqttConnected = true;

    // Subscribe to status topic
    try {
        client.subscribe('DIPSW_1_cv', (err) => {
            if (err) {
                console.error('Subscribe error for DIPSW_1_cv:', err);
            } else {
                console.log('Subscribed to DIPSW_1_cv for status monitoring');
            }
        });
    } catch (e) {
        console.error('Subscribe exception for DIPSW_1_cv:', e);
    }

    // Subscribe to RTC response topic
    try {
        client.subscribe(RTC_CONFIG.responseTopic, (err) => {
            if (err) {
                console.error(`Subscribe error for ${RTC_CONFIG.responseTopic}:`, err);
            } else {
                console.log(`Subscribed to ${RTC_CONFIG.responseTopic} for RTC responses`);
            }
        });
    } catch (e) {
        console.error(`Subscribe exception for ${RTC_CONFIG.responseTopic}:`, e);
    }
});
// Helper: parse JSON or JSON-like (JS object literal) payloads safely
function parseStatusPayload(raw) {
    // Attempt standard JSON first
    try {
        const obj = JSON.parse(raw);
        return { obj, usedFallback: false, error: null };
    } catch (e1) {
        // Fallback: quote unquoted keys, normalize single quotes, strip trailing commas
        try {
            let normalized = String(raw).trim();
            // Add quotes around unquoted property names (simple identifier keys)
            normalized = normalized.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
            // Convert single-quoted strings to double-quoted strings
            normalized = normalized.replace(/'([^']*)'/g, '"$1"');
            // Remove trailing commas before closing braces/brackets
            normalized = normalized.replace(/,\s*([}\]])/g, '$1');
            const obj = JSON.parse(normalized);
            return { obj, usedFallback: true, error: null };
        } catch (e2) {
            return { obj: null, usedFallback: true, error: e2 };
        }
    }
}

// ===================================
// RTC MQTT Command Functions
// ===================================

/**
 * Send RTC command to board via MQTT and wait for response
 * @param {string} cmd - Command type ('get_rtc' or 'set_rtc')
 * @param {object} timeData - Time data for set_rtc command (optional)
 * @returns {Promise} - Resolves with board response or rejects on timeout/error
 */
function sendRTCCommand(cmd, timeData = null) {
    return new Promise((resolve, reject) => {
        const requestId = `rtc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Build MQTT message
        const message = {
            cmd: cmd,
            request_id: requestId
        };

        // Add time data for set_rtc command
        if (cmd === 'set_rtc' && timeData) {
            message.timestamp = timeData.timestamp;
            message.year = timeData.year;
            message.month = timeData.month;
            message.day = timeData.day;
            message.hour = timeData.hour;
            message.minute = timeData.minute;
            message.second = timeData.second;
        }

        console.log(`[RTC] Sending ${cmd} command:`, message);

        // Set up timeout
        const timeoutHandle = setTimeout(() => {
            rtcPendingRequests.delete(requestId);
            reject(new Error(`RTC command timeout after ${RTC_CONFIG.timeout}ms`));
        }, RTC_CONFIG.timeout);

        // Store pending request
        rtcPendingRequests.set(requestId, {
            resolve,
            reject,
            timeout: timeoutHandle,
            cmd: cmd
        });

        // Publish MQTT message
        const payload = JSON.stringify(message);
        client.publish(RTC_CONFIG.topic, payload, (err) => {
            if (err) {
                clearTimeout(timeoutHandle);
                rtcPendingRequests.delete(requestId);
                reject(new Error(`MQTT publish error: ${err.message}`));
            } else {
                console.log(`[RTC] Command published to ${RTC_CONFIG.topic}`);

                // If in mock mode, simulate board response
                if (RTC_CONFIG.mockMode) {
                    simulateBoardRTCResponse(requestId, cmd, timeData);
                }
            }
        });
    });
}

/**
 * Simulate board RTC response for testing (mock mode)
 */
function simulateBoardRTCResponse(requestId, cmd, timeData) {
    const delay = Math.random() * (RTC_CONFIG.mockDelay[1] - RTC_CONFIG.mockDelay[0]) + RTC_CONFIG.mockDelay[0];
    const success = Math.random() < RTC_CONFIG.mockSuccessRate;

    setTimeout(() => {
        const now = new Date();
        const response = {
            cmd: cmd,
            request_id: requestId,
            status: success ? 'success' : 'error'
        };

        if (success) {
            // Use provided time data for set_rtc, or current time for get_rtc
            const timeSource = (cmd === 'set_rtc' && timeData) ? timeData : {
                timestamp: Math.floor(now.getTime() / 1000),
                year: now.getFullYear(),
                month: now.getMonth() + 1,
                day: now.getDate(),
                hour: now.getHours(),
                minute: now.getMinutes(),
                second: now.getSeconds()
            };

            Object.assign(response, timeSource);
        } else {
            response.error = 'Mock RTC error (simulated failure)';
        }

        console.log(`[RTC Mock] Simulating board response after ${Math.round(delay)}ms:`, response);

        // Simulate receiving the response via MQTT
        handleRTCResponse(response);
    }, delay);
}

/**
 * Handle RTC response from board
 */
function handleRTCResponse(response) {
    const requestId = response.request_id;
    const pending = rtcPendingRequests.get(requestId);

    if (!pending) {
        console.warn('[RTC] Received response for unknown request:', requestId);
        return;
    }

    // Clear timeout
    clearTimeout(pending.timeout);
    rtcPendingRequests.delete(requestId);

    // Check status
    if (response.status === 'success') {
        console.log('[RTC] Command successful:', response);
        pending.resolve(response);
    } else {
        console.error('[RTC] Command failed:', response.error || 'Unknown error');
        pending.reject(new Error(response.error || 'RTC command failed'));
    }
}

// Server-side MQTT message handler
client.on('message', (topic, message) => {
    const raw = message ? message.toString() : '';

    // Handle RTC responses
    if (topic === RTC_CONFIG.responseTopic) {
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
        console.log(`[${ts}] ${RTC_CONFIG.responseTopic} received: ${raw}`);

        try {
            const response = JSON.parse(raw);
            handleRTCResponse(response);
        } catch (err) {
            console.error(' → Failed to parse RTC response:', err.message);
        }
        return;
    }

    // Handle status messages (DIPSW_1_cv)
    if (topic === 'DIPSW_1_cv') {
        const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
        console.log(`[${ts}] DIPSW_1_cv received: ${raw}`);
        const parsed = parseStatusPayload(raw);
        if (!parsed.obj) {
            console.error(' → Malformed DIPSW_1_cv message (parse failed):', parsed.error && parsed.error.message);
            return;
        }
        const obj = parsed.obj;
        const actId = obj && obj.act_id !== undefined ? obj.act_id : undefined;
        const cmd = obj && obj.cmd !== undefined ? obj.cmd : undefined;
        const timeout = obj && obj.timeout !== undefined ? obj.timeout : undefined;
        console.log(` → Parsed${parsed.usedFallback ? ' (fallback)' : ''}: act_id=${actId}, cmd=${JSON.stringify(cmd)}, timeout=${timeout}`);
        // Relay to browsers via SSE (non-blocking best-effort)
        try { broadcastStatus({ act_id: actId, cmd, timeout }); } catch (_) { }
        // Optional validation logging
        if (![1, 2, 3, 4].includes(parseInt(actId))) {
            console.warn('   ! act_id out of expected range:', actId);
        }
        if (!(timeout === 0 || timeout === 1)) {
            console.warn('   ! timeout not 0/1:', timeout);
        }
        return;
    }
});


// MQTT error event
client.on('error', (err) => {
    console.error('MQTT connection error:', err);
    mqttConnected = false;
});

// Endpoint to save presets
app.post('/api/presets', (req, res) => {
    const presets = req.body;
    fs.writeFile(presetFilePath, JSON.stringify(presets, null, 2), 'utf8', (err) => {
        if (err) {
            console.error('Error writing presets file:', err);
            res.status(500).send('Internal Server Error');
        } else {
            res.status(200).send('Presets saved successfully');
        }
    });
});

// Endpoint to load presets
app.get('/api/presets', (req, res) => {
    fs.readFile(presetFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading presets file:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        } else {
            res.json(JSON.parse(data));
        }
    });
});

// Endpoint to start the process
app.post('/api/start', async (req, res) => {
    try {
        const settings = req.body;
        console.log('Received start command with settings:', settings);

        // Validate input settings
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ message: 'Invalid settings provided' });
        }

        // Check for required fields
        const requiredFields = ['tankNumber', 'siloMotorRight', 'siloMotorLeft', 'rotaryValve', 'blower'];
        for (const field of requiredFields) {
            if (!(field in settings)) {
                return res.status(400).json({ message: `Missing required field: ${field}` });
            }
        }

        // Set default time values if not provided (excluding tank)
        settings.siloMotorRightTime = settings.siloMotorRightTime || 0;
        settings.siloMotorLeftTime = settings.siloMotorLeftTime || 0;
        settings.rotaryValveTime = settings.rotaryValveTime || 0;
        settings.blowerTime = settings.blowerTime || 0;

        stopRequested = false; // Reset stop flag
        processRunning = true; // Set process as running

        // Process commands (works with or without MQTT connection)
        await processCommands(settings);

        processRunning = false; // Set process as not running
        res.status(200).json({
            message: 'Process completed or halted',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected',
            note: mqttConnected ? 'Commands sent to MQTT broker' : 'Commands generated (MQTT broker not available)'
        });
    } catch (error) {
        console.error('Error in /api/start endpoint:', error);
        processRunning = false;
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Endpoint to stop the process - EMERGENCY STOP (opmode 64, act_id 5)
app.post('/api/stop', (req, res) => {
    console.log('Received EMERGENCY STOP');
    const msg = { act_id: 5, opmode: 64, pwm: 0, time: 0 };
    const payload = JSON.stringify(msg);
    console.log('TX EMERGENCY:', payload);
    client.publish('DIPSW_1', payload, (err) => {
        if (err) {
            console.error('ERR EMERGENCY publish:', err);
            return res.status(500).json({ message: 'Emergency stop publish failed' });
        }
        res.status(200).json({ message: 'Emergency stop sent', details: msg });
    });
});

// Endpoint to check process status
app.get('/api/check-status', (req, res) => {
    res.status(200).json({ halted: !processRunning });
});

// Endpoint to handle MQTT commands - UPDATED FOR NEW FORMAT WITH TIME FIELD
app.post('/api/mqtt-command', (req, res) => {
    try {
        let { topic, act_id, opmode, pwm, time } = req.body;

        // Validate input
        if (!topic || act_id === undefined || opmode === undefined || pwm === undefined) {
            return res.status(400).json({ message: 'Missing required fields: topic, act_id, opmode, pwm' });
        }

        act_id = parseInt(act_id, 10);
        pwm = parseInt(pwm, 10);

        // Parse and validate time field (seconds - firmware converts to internal units if needed)
        if (time !== undefined) {
            time = parseInt(time, 10);
            if (isNaN(time) || time < 0) {
                return res.status(400).json({ message: 'Invalid time value - must be a non-negative integer' });
            }
        }

        // Simplified MQTT message format - only essential 4 fields
        const simplifiedMessage = {
            act_id,
            opmode,
            pwm,
            time: time || 0 // Default to 0 if not provided
        };

        const messageStr = JSON.stringify(simplifiedMessage);
        console.log('Simplified MQTT command (4 fields only):', messageStr);

        if (mqttConnected) {
            client.publish(topic, messageStr, (err) => {
                if (err) {
                    console.error('Error publishing simplified MQTT message:', err);
                } else {
                    console.log('Simplified MQTT message sent successfully:', messageStr);
                }
            });
        } else {
            console.log('[SIMULATION] Simplified command ready for MQTT broker');
        }

        res.status(200).json({
            message: 'MQTT command processed',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('Error in /api/mqtt-command endpoint:', error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Endpoint to start an individual item - UPDATED FOR BATCH APPROACH WITH TIME FIELD
app.post('/api/start-item', (req, res) => {
    try {
        let { actId, duration, time } = req.body;

        // Validate input
        if (actId === undefined || duration === undefined) {
            return res.status(400).json({ message: 'Missing actId or duration' });
        }

        actId = parseInt(actId, 10);
        duration = parseInt(duration, 10);

        // Parse and validate time field (seconds - firmware converts to internal units if needed)
        if (time !== undefined) {
            time = parseInt(time, 10);
            if (isNaN(time) || time < 0) {
                return res.status(400).json({ message: 'Invalid time value - must be a non-negative integer' });
            }
        } else {
            time = 0; // Default time value
        }

        // Validate parsed values
        if (isNaN(actId) || isNaN(duration)) {
            return res.status(400).json({ message: 'Invalid actId or duration - must be numbers' });
        }

        if (actId === 0) {
            // Tank number command - send ONLY act_id, opmode, pwm (no time field for tank selection)
            const tankCommand = {
                act_id: 1,
                opmode: 93,
                pwm: duration
            };

            const message = JSON.stringify(tankCommand);
            console.log('Publishing tank selection command (3 fields: act_id,opmode,pwm):', message);

            client.publish('DIPSW_0', message, (err) => {
                if (err) {
                    console.error('Error publishing tank command:', err);
                } else {
                    console.log('Tank selection command sent successfully:', message);
                }
            });
        } else {
            console.log(`Received start command for act_id: ${actId} with duration: ${duration}, time: ${time}`);

            // Generate batch commands for start and stop
            const batchCommands = generateIndividualItemBatch(actId, duration, time);
            sendBatchMQTTCommands(batchCommands);
        }

        res.status(200).json({
            message: 'Item command processed with timing information',
            mqttStatus: mqttConnected ? 'connected' : 'disconnected'
        });
    } catch (error) {
        console.error('Error in /api/start-item endpoint:', error);
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Function to process commands - NEW BATCH APPROACH
async function processCommands(settings) {
    console.log('Processing commands with batch approach');

    const batchCommands = generateBatchCommands(settings);

    // Send all commands in a single batch
    sendBatchMQTTCommands(batchCommands);

    console.log('All commands sent in batch. IoT devices will handle timing.');
}

// ===================================
// Operation Logging Helper
// ===================================
function addOperationLog(logEntry) {
    try {
        // Read existing logs
        let data = { logs: [], lastUpdated: null };
        try {
            data = JSON.parse(fs.readFileSync(logsFilePath, 'utf8'));
        } catch (e) {
            // File doesn't exist or is invalid, use default
        }

        // Add timestamp if not provided
        if (!logEntry.timestamp) {
            logEntry.timestamp = new Date().toISOString();
        }

        // Add log entry
        data.logs.push(logEntry);

        // Keep only last 1000 logs
        if (data.logs.length > 1000) {
            data.logs = data.logs.slice(-1000);
        }

        data.lastUpdated = new Date().toISOString();

        // Save to file
        fs.writeFileSync(logsFilePath, JSON.stringify(data, null, 2));

        // Broadcast log to SSE clients
        broadcastStatus({
            type: 'log',
            log: logEntry
        });

        console.log('Log entry added:', logEntry.action);
    } catch (error) {
        console.error('Failed to add log entry:', error);
    }
}

// Function to generate batch commands (Immediate ON only; embedded handles timing)
function generateBatchCommands(settings) {
    const commands = [];

    // Tank selection command (immediate execution) - time omitted for tank
    commands.push({
        topic: 'DIPSW_0',
        act_id: 1,
        opmode: 93,
        pwm: parseInt(settings.tankNumber)
    });

    // Define devices and their act_id with time fields (seconds - firmware converts)
    const devices = [
        { act_id: 1, value: parseInt(settings.siloMotorRight), time: parseInt(settings.siloMotorRightTime) || 0, name: 'siloMotorRight' },
        { act_id: 2, value: parseInt(settings.siloMotorLeft), time: parseInt(settings.siloMotorLeftTime) || 0, name: 'siloMotorLeft' },
        { act_id: 3, value: parseInt(settings.rotaryValve), time: parseInt(settings.rotaryValveTime) || 0, name: 'rotaryValve' },
        { act_id: 4, value: parseInt(settings.blower), time: parseInt(settings.blowerTime) || 0, name: 'blower' }
    ];

    // Immediate ON using new opmode 64 for all devices, no OFF, no delay
    for (const device of devices) {
        commands.push({
            topic: 'DIPSW_1',
            act_id: device.act_id,
            opmode: 64,
            pwm: device.value,      // delay time (seconds) → pwm
            time: device.time || 0  // duration (seconds) - firmware converts to internal units
        });
    }

    return {
        batch_id: `batch_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands: commands
    };
}

// Function to generate individual item ON-only batch (embedded handles timing)
function generateIndividualItemBatch(actId, duration, time = 0) {
    const commands = [
        { topic: 'DIPSW_1', act_id: actId, opmode: 91, pwm: duration, time: time }
    ];
    return {
        batch_id: `individual_${actId}_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands
    };
}

// Function to generate stop commands for all devices
function generateStopAllBatch() {
    const commands = [];
    const baseTimestamp = Math.floor(Date.now() / 1000);

    // Stop commands for all devices (immediate execution)
    for (let act_id = 1; act_id <= 4; act_id++) {
        commands.push({
            topic: 'DIPSW_1',
            act_id: act_id,
            opmode: 93,
            pwm: 3,
            timing: {
                delay: 0,
                timestamp: baseTimestamp,
                duration: 0
            }
        });
    }

    return {
        batch_id: `stop_all_${Date.now()}`,
        total_commands: commands.length,
        total_duration: 0,
        commands: commands
    };
}

// Simplified MQTT command function - only 4 essential fields
function sendMQTTCommand(topic, act_id, opmode, pwm, time) {
    const simplifiedMessage = { act_id, opmode, pwm, time: time || 0 };
    const messageStr = JSON.stringify(simplifiedMessage);
    console.log('Simplified MQTT message (4 fields only):', messageStr);
    client.publish(topic, messageStr, (err) => {
        if (err) console.error('Error publishing simplified MQTT message:', err);
        else console.log('Simplified MQTT message sent successfully:', messageStr);
    });
}

// New function to send batch commands with timing information
function sendBatchMQTTCommands(batchData) {
    console.log(`Generating batch of ${batchData.total_commands} commands with batch_id: ${batchData.batch_id}`);
    console.log('Immediate ON-only batch; no delayed OFF commands.');

    // Immediate publish of all commands
    batchData.commands.forEach((command, index) => {
        const simplifiedMessage = {
            act_id: command.act_id,
            opmode: command.opmode,
            pwm: command.pwm,
            time: command.time || 0
        };
        const messageStr = JSON.stringify(simplifiedMessage);
        console.log(`TX ${index + 1}/${batchData.total_commands} ${command.topic} op=${command.opmode} act=${command.act_id} pwm=${command.pwm} time=${simplifiedMessage.time}`);
        client.publish(command.topic, messageStr, (err) => {
            if (err) console.error(`ERR publishing ${index + 1}:`, err);
            else console.log(`OK  ${index + 1}/${batchData.total_commands}`);
        });
    });

    console.log('Batch publish complete.');
}

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});