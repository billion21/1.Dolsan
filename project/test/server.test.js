const request = require('supertest');
const express = require('express');
const mqtt = require('mqtt');

// Mock MQTT client
jest.mock('mqtt');

// Import the server module (we'll need to refactor server.js to export the app)
const app = require('../server-testable');

describe('IoT Command Scheduling Server', () => {
    let mockMqttClient;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Mock MQTT client
        mockMqttClient = {
            connect: jest.fn(),
            publish: jest.fn((topic, message, callback) => {
                if (callback) callback(null);
            }),
            on: jest.fn()
        };
        
        mqtt.connect.mockReturnValue(mockMqttClient);
    });

    describe('Batch Command Generation', () => {
        test('should generate correct batch commands for full process', async () => {
            const settings = {
                tankNumber: '2',
                siloMotorRight: '15',
                siloMotorLeft: '10',
                rotaryValve: '12',
                blower: '8'
            };

            const response = await request(app)
                .post('/api/start')
                .send(settings)
                .expect(200);

            expect(response.body.message).toBe('Process completed or halted');
            
            // Verify MQTT publish was called with batch commands
            expect(mockMqttClient.publish).toHaveBeenCalled();
            
            // Check that commands include timing information
            const publishCalls = mockMqttClient.publish.mock.calls;
            publishCalls.forEach(call => {
                const [topic, messageStr] = call;
                const message = JSON.parse(messageStr);
                
                expect(message).toHaveProperty('act_id');
                expect(message).toHaveProperty('opmode');
                expect(message).toHaveProperty('pwm');
                expect(message).toHaveProperty('timing');
                expect(message.timing).toHaveProperty('delay');
                expect(message.timing).toHaveProperty('timestamp');
                expect(message.timing).toHaveProperty('duration');
                expect(message).toHaveProperty('batch_id');
                expect(message).toHaveProperty('command_index');
            });
        });

        test('should generate correct timing sequence', async () => {
            const settings = {
                tankNumber: '2',
                siloMotorRight: '15',
                siloMotorLeft: '10',
                rotaryValve: '12',
                blower: '8'
            };

            await request(app)
                .post('/api/start')
                .send(settings);

            const publishCalls = mockMqttClient.publish.mock.calls;
            const commands = publishCalls.map(call => JSON.parse(call[1]));

            // Tank command should be first with delay 0
            const tankCommand = commands.find(cmd => cmd.act_id === 1 && cmd.opmode === 93);
            expect(tankCommand.timing.delay).toBe(0);

            // First device ON command should have delay 25 (after tank command)
            const firstDeviceOn = commands.find(cmd => cmd.act_id === 1 && cmd.opmode === 91);
            expect(firstDeviceOn.timing.delay).toBe(25);

            // Verify sequential timing
            let expectedDelay = 25;
            const deviceSequence = [
                { act_id: 1, duration: 15 },
                { act_id: 2, duration: 10 },
                { act_id: 3, duration: 12 },
                { act_id: 4, duration: 8 }
            ];

            deviceSequence.forEach(device => {
                const onCommand = commands.find(cmd => 
                    cmd.act_id === device.act_id && cmd.opmode === 91
                );
                expect(onCommand.timing.delay).toBe(expectedDelay);
                expect(onCommand.timing.duration).toBe(device.duration);

                expectedDelay += device.duration;
                
                const offCommand = commands.find(cmd => 
                    cmd.act_id === device.act_id && cmd.opmode === 93
                );
                expect(offCommand.timing.delay).toBe(expectedDelay);
            });
        });
    });

    describe('Individual Item Control', () => {
        test('should generate batch commands for individual item', async () => {
            const itemData = {
                actId: '2',
                duration: '20'
            };

            const response = await request(app)
                .post('/api/start-item')
                .send(itemData)
                .expect(200);

            expect(response.body.message).toBe('Item command processed with timing information');

            const publishCalls = mockMqttClient.publish.mock.calls;
            expect(publishCalls).toHaveLength(2); // ON and OFF commands

            const commands = publishCalls.map(call => JSON.parse(call[1]));
            
            // ON command
            const onCommand = commands.find(cmd => cmd.opmode === 91);
            expect(onCommand.act_id).toBe(2);
            expect(onCommand.timing.delay).toBe(0);
            expect(onCommand.timing.duration).toBe(20);

            // OFF command
            const offCommand = commands.find(cmd => cmd.opmode === 93);
            expect(offCommand.act_id).toBe(2);
            expect(offCommand.timing.delay).toBe(20);
            expect(offCommand.timing.duration).toBe(0);
        });

        test('should handle tank number command correctly', async () => {
            const tankData = {
                actId: '0',
                duration: '3'
            };

            await request(app)
                .post('/api/start-item')
                .send(tankData)
                .expect(200);

            expect(mockMqttClient.publish).toHaveBeenCalledWith(
                'DIPSW_0',
                expect.stringContaining('"act_id":1')
            );

            const publishCall = mockMqttClient.publish.mock.calls[0];
            const message = JSON.parse(publishCall[1]);
            
            expect(message.act_id).toBe(1);
            expect(message.opmode).toBe(93);
            expect(message.pwm).toBe(3);
            expect(message.timing.delay).toBe(0);
        });
    });

    describe('Stop Commands', () => {
        test('should generate immediate stop commands for all devices', async () => {
            const response = await request(app)
                .post('/api/stop')
                .expect(200);

            expect(response.body.message).toBe('Stop commands sent with timing information');

            const publishCalls = mockMqttClient.publish.mock.calls;
            expect(publishCalls).toHaveLength(4); // Stop commands for devices 1-4

            publishCalls.forEach((call, index) => {
                const [topic, messageStr] = call;
                const message = JSON.parse(messageStr);
                
                expect(topic).toBe('DIPSW_1');
                expect(message.act_id).toBe(index + 1);
                expect(message.opmode).toBe(93); // Stop command
                expect(message.timing.delay).toBe(0); // Immediate
            });
        });
    });

    describe('MQTT Command Endpoint', () => {
        test('should support new format with timing', async () => {
            const commandData = {
                topic: 'DIPSW_1',
                act_id: '3',
                opmode: 91,
                pwm: 2,
                timing: {
                    delay: 10,
                    timestamp: Math.floor(Date.now() / 1000) + 10,
                    duration: 15
                }
            };

            const response = await request(app)
                .post('/api/mqtt-command')
                .send(commandData)
                .expect(200);

            expect(response.body.message).toBe('MQTT command sent');

            const publishCall = mockMqttClient.publish.mock.calls[0];
            const [topic, messageStr] = publishCall;
            const message = JSON.parse(messageStr);

            expect(topic).toBe('DIPSW_1');
            expect(message.act_id).toBe(3);
            expect(message.timing).toEqual(commandData.timing);
            expect(message).toHaveProperty('batch_id');
        });

        test('should support legacy format without timing', async () => {
            const commandData = {
                topic: 'DIPSW_1',
                act_id: '3',
                opmode: 91,
                pwm: 2
            };

            await request(app)
                .post('/api/mqtt-command')
                .send(commandData)
                .expect(200);

            const publishCall = mockMqttClient.publish.mock.calls[0];
            const [topic, messageStr] = publishCall;
            const message = JSON.parse(messageStr);

            expect(topic).toBe('DIPSW_1');
            expect(message.act_id).toBe(3);
            expect(message).not.toHaveProperty('timing');
        });
    });

    describe('Message Format Validation', () => {
        test('should include all required timing fields', async () => {
            const settings = {
                tankNumber: '1',
                siloMotorRight: '5',
                siloMotorLeft: '5',
                rotaryValve: '5',
                blower: '5'
            };

            await request(app)
                .post('/api/start')
                .send(settings);

            const publishCalls = mockMqttClient.publish.mock.calls;
            
            publishCalls.forEach(call => {
                const message = JSON.parse(call[1]);
                
                // Verify timing object structure
                expect(message.timing).toBeDefined();
                expect(typeof message.timing.delay).toBe('number');
                expect(typeof message.timing.timestamp).toBe('number');
                expect(typeof message.timing.duration).toBe('number');
                
                // Verify timestamp is reasonable (within 1 minute of now)
                const now = Math.floor(Date.now() / 1000);
                expect(message.timing.timestamp).toBeGreaterThanOrEqual(now - 60);
                expect(message.timing.timestamp).toBeLessThanOrEqual(now + 3600);
                
                // Verify batch information
                expect(message.batch_id).toBeDefined();
                expect(typeof message.command_index).toBe('number');
            });
        });
    });
});
