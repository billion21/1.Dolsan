const request = require('supertest');
const mqtt = require('mqtt');

// Mock MQTT client for integration tests
jest.mock('mqtt');

const app = require('../server-testable');

describe('Integration Tests - Message Format and Timing', () => {
    let mockMqttClient;
    let publishedMessages = [];

    beforeEach(() => {
        jest.clearAllMocks();
        publishedMessages = [];
        
        mockMqttClient = {
            connect: jest.fn(),
            publish: jest.fn((topic, message, callback) => {
                publishedMessages.push({ topic, message: JSON.parse(message) });
                if (callback) callback(null);
            }),
            on: jest.fn()
        };
        
        mqtt.connect.mockReturnValue(mockMqttClient);
    });

    describe('Complete Process Flow', () => {
        test('should generate correct sequence for full automation process', async () => {
            const settings = {
                tankNumber: '3',
                siloMotorRight: '20',
                siloMotorLeft: '15',
                rotaryValve: '18',
                blower: '12'
            };

            await request(app)
                .post('/api/start')
                .send(settings)
                .expect(200);

            // Verify we have the correct number of commands
            // 1 tank command + 4 devices * 2 commands (ON/OFF) = 9 total
            expect(publishedMessages).toHaveLength(9);

            // Verify tank command
            const tankMsg = publishedMessages.find(msg => 
                msg.topic === 'DIPSW_0' && msg.message.act_id === 1
            );
            expect(tankMsg).toBeDefined();
            expect(tankMsg.message.opmode).toBe(93);
            expect(tankMsg.message.pwm).toBe(3);
            expect(tankMsg.message.timing.delay).toBe(0);

            // Verify device sequence timing
            const deviceCommands = publishedMessages.filter(msg => msg.topic === 'DIPSW_1');
            expect(deviceCommands).toHaveLength(8); // 4 devices * 2 commands each

            // Check timing progression
            let expectedDelay = 25; // Initial delay after tank command
            const devices = [
                { act_id: 1, duration: 20 },
                { act_id: 2, duration: 15 },
                { act_id: 3, duration: 18 },
                { act_id: 4, duration: 12 }
            ];

            devices.forEach(device => {
                // Find ON command
                const onCmd = deviceCommands.find(cmd => 
                    cmd.message.act_id === device.act_id && cmd.message.opmode === 91
                );
                expect(onCmd.message.timing.delay).toBe(expectedDelay);
                expect(onCmd.message.timing.duration).toBe(device.duration);

                expectedDelay += device.duration;

                // Find OFF command
                const offCmd = deviceCommands.find(cmd => 
                    cmd.message.act_id === device.act_id && cmd.message.opmode === 93
                );
                expect(offCmd.message.timing.delay).toBe(expectedDelay);
                expect(offCmd.message.timing.duration).toBe(0);
            });
        });

        test('should include valid timestamps in all commands', async () => {
            const settings = {
                tankNumber: '1',
                siloMotorRight: '10',
                siloMotorLeft: '10',
                rotaryValve: '10',
                blower: '10'
            };

            const startTime = Math.floor(Date.now() / 1000);

            await request(app)
                .post('/api/start')
                .send(settings);

            const endTime = Math.floor(Date.now() / 1000);

            publishedMessages.forEach(msg => {
                const timestamp = msg.message.timing.timestamp;
                
                // Timestamp should be reasonable (between start and end + max duration)
                expect(timestamp).toBeGreaterThanOrEqual(startTime);
                expect(timestamp).toBeLessThanOrEqual(endTime + 100); // Allow for processing time
                
                // Timestamp should equal base timestamp + delay
                const baseTimestamp = publishedMessages[0].message.timing.timestamp;
                const expectedTimestamp = baseTimestamp + msg.message.timing.delay;
                expect(timestamp).toBe(expectedTimestamp);
            });
        });

        test('should include batch information in all commands', async () => {
            const settings = {
                tankNumber: '2',
                siloMotorRight: '5',
                siloMotorLeft: '5',
                rotaryValve: '5',
                blower: '5'
            };

            await request(app)
                .post('/api/start')
                .send(settings);

            const batchId = publishedMessages[0].message.batch_id;
            expect(batchId).toMatch(/^batch_\d+$/);

            publishedMessages.forEach((msg, index) => {
                expect(msg.message.batch_id).toBe(batchId);
                expect(msg.message.command_index).toBe(index);
            });
        });
    });

    describe('Individual Item Control', () => {
        test('should generate correct timing for individual item', async () => {
            const itemData = {
                actId: '3',
                duration: '25'
            };

            await request(app)
                .post('/api/start-item')
                .send(itemData);

            expect(publishedMessages).toHaveLength(2);

            const onCommand = publishedMessages.find(msg => msg.message.opmode === 91);
            const offCommand = publishedMessages.find(msg => msg.message.opmode === 93);

            expect(onCommand.message.act_id).toBe(3);
            expect(onCommand.message.timing.delay).toBe(0);
            expect(onCommand.message.timing.duration).toBe(25);

            expect(offCommand.message.act_id).toBe(3);
            expect(offCommand.message.timing.delay).toBe(25);
            expect(offCommand.message.timing.duration).toBe(0);

            // Verify timestamps
            const baseTime = onCommand.message.timing.timestamp;
            expect(offCommand.message.timing.timestamp).toBe(baseTime + 25);
        });
    });

    describe('Stop Commands', () => {
        test('should generate immediate stop commands with correct format', async () => {
            await request(app)
                .post('/api/stop')
                .expect(200);

            expect(publishedMessages).toHaveLength(4);

            publishedMessages.forEach((msg, index) => {
                expect(msg.topic).toBe('DIPSW_1');
                expect(msg.message.act_id).toBe(index + 1);
                expect(msg.message.opmode).toBe(93);
                expect(msg.message.timing.delay).toBe(0);
                expect(msg.message.timing.duration).toBe(0);
                expect(msg.message.batch_id).toMatch(/^stop_all_\d+$/);
            });
        });
    });

    describe('Message Format Validation', () => {
        test('should have consistent message structure across all commands', async () => {
            const settings = {
                tankNumber: '1',
                siloMotorRight: '8',
                siloMotorLeft: '8',
                rotaryValve: '8',
                blower: '8'
            };

            await request(app)
                .post('/api/start')
                .send(settings);

            const requiredFields = ['act_id', 'opmode', 'pwm', 'timing', 'batch_id', 'command_index'];
            const timingFields = ['delay', 'timestamp', 'duration'];

            publishedMessages.forEach(msg => {
                // Check main message structure
                requiredFields.forEach(field => {
                    expect(msg.message).toHaveProperty(field);
                });

                // Check timing structure
                timingFields.forEach(field => {
                    expect(msg.message.timing).toHaveProperty(field);
                    expect(typeof msg.message.timing[field]).toBe('number');
                });

                // Validate field types
                expect(typeof msg.message.act_id).toBe('number');
                expect(typeof msg.message.opmode).toBe('number');
                expect(typeof msg.message.pwm).toBe('number');
                expect(typeof msg.message.batch_id).toBe('string');
                expect(typeof msg.message.command_index).toBe('number');
            });
        });

        test('should maintain timing consistency across batch', async () => {
            const settings = {
                tankNumber: '1',
                siloMotorRight: '12',
                siloMotorLeft: '8',
                rotaryValve: '15',
                blower: '6'
            };

            await request(app)
                .post('/api/start')
                .send(settings);

            // Sort messages by delay to verify sequence
            const sortedMessages = publishedMessages.sort((a, b) => 
                a.message.timing.delay - b.message.timing.delay
            );

            // Verify delays are in ascending order
            for (let i = 1; i < sortedMessages.length; i++) {
                expect(sortedMessages[i].message.timing.delay)
                    .toBeGreaterThanOrEqual(sortedMessages[i-1].message.timing.delay);
            }

            // Verify no gaps in command sequence
            let currentDelay = 0;
            sortedMessages.forEach(msg => {
                expect(msg.message.timing.delay).toBeGreaterThanOrEqual(currentDelay);
                currentDelay = msg.message.timing.delay;
            });
        });
    });

    describe('Error Handling', () => {
        test('should handle invalid input gracefully', async () => {
            const invalidSettings = {
                tankNumber: 'invalid',
                siloMotorRight: 'not_a_number',
                siloMotorLeft: '',
                rotaryValve: null,
                blower: undefined
            };

            // The server should still process the request but with parsed values
            await request(app)
                .post('/api/start')
                .send(invalidSettings)
                .expect(200);

            // Verify that NaN values are handled appropriately
            publishedMessages.forEach(msg => {
                expect(typeof msg.message.act_id).toBe('number');
                expect(typeof msg.message.opmode).toBe('number');
                expect(typeof msg.message.pwm).toBe('number');
                expect(typeof msg.message.timing.delay).toBe('number');
                expect(typeof msg.message.timing.timestamp).toBe('number');
                expect(typeof msg.message.timing.duration).toBe('number');
            });
        });
    });
});
