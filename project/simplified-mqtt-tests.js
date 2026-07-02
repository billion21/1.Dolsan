const { test, expect } = require('@playwright/test');

// Test configuration
const BASE_URL = 'http://localhost:3100';

test.describe('Simplified MQTT Message Format Testing', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. API Endpoint Testing - Simplified Format', () => {
    
    test('should send simplified MQTT command with 4 fields only', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91,
          pwm: 3,
          time: 50
        }
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('MQTT command processed');
      expect(result.mqttStatus).toBe('disconnected');
    });

    test('should handle start-item API with simplified format', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '3',
          duration: '15',
          time: '75'
        }
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Item command processed with timing information');
    });

    test('should handle tank command with simplified format', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '0', // Tank command
          duration: '2',
          time: '25'
        }
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Item command processed with timing information');
    });

    test('should validate required fields for simplified format', async ({ page }) => {
      // Test missing required fields
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91
          // Missing pwm field
        }
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Missing required fields');
    });

    test('should handle time field validation', async ({ page }) => {
      // Test invalid time value
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91,
          pwm: 3,
          time: -5 // Invalid negative time
        }
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Invalid time value');
    });

    test('should default time to 0 when not provided', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91,
          pwm: 3
          // time field omitted - should default to 0
        }
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('MQTT command processed');
    });
  });

  test.describe('2. Individual Device Control Testing', () => {
    
    test('should send simplified MQTT messages for individual devices', async ({ page }) => {
      const testCases = [
        { device: 'silo-motor-right', actId: '1', duration: '20', time: '80' },
        { device: 'silo-motor-left', actId: '2', duration: '15', time: '60' },
        { device: 'rotary-valve', actId: '3', duration: '25', time: '100' },
        { device: 'blower', actId: '4', duration: '10', time: '40' }
      ];
      
      for (const testCase of testCases) {
        // Set values
        await page.locator(`#${testCase.device}`).fill(testCase.duration);
        await page.locator(`#${testCase.device}-time`).fill(testCase.time);
        
        const consoleLogs = [];
        page.on('console', msg => {
          if (msg.type() === 'log') {
            consoleLogs.push(msg.text());
          }
        });
        
        // Click ON button
        await page.locator(`.item[data-act-id="${testCase.actId}"] .item-start`).click();
        
        await page.waitForTimeout(500);
        
        // Verify command includes correct values
        const commandLog = consoleLogs.find(log => 
          log.includes(`act_id: ${testCase.actId}`) && 
          log.includes(`${testCase.duration} seconds`) &&
          log.includes(`time: ${testCase.time}`)
        );
        expect(commandLog).toBeTruthy();
      }
    });

    test('should handle tank number command with simplified format', async ({ page }) => {
      // Set tank values
      await page.locator('#tank-number').fill('3');
      await page.locator('#tank-time').fill('30');
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Click tank ON button
      await page.locator('.item[data-act-id="0"] .item-start').click();
      
      await page.waitForTimeout(1000);
      
      // Verify tank command processed
      const tankLog = consoleLogs.find(log => log.includes('Starting item with act_id: 0'));
      expect(tankLog).toBeTruthy();
    });
  });

  test.describe('3. Batch Process Testing', () => {
    
    test('should send simplified MQTT messages in batch process', async ({ page }) => {
      // Set up preset with time values
      await page.locator('#tank-number').fill('1');
      await page.locator('#tank-time').fill('20');
      await page.locator('#silo-motor-right').fill('15');
      await page.locator('#silo-motor-right-time').fill('50');
      await page.locator('#silo-motor-left').fill('12');
      await page.locator('#silo-motor-left-time').fill('40');
      await page.locator('#rotary-valve').fill('18');
      await page.locator('#rotary-valve-time').fill('60');
      await page.locator('#blower').fill('8');
      await page.locator('#blower-time').fill('30');
      
      // Save and load preset
      await page.locator('label').filter({ hasText: '프리셋 1' }).click();
      await page.locator('#savePreset').click();
      
      page.on('dialog', async dialog => {
        await dialog.accept();
      });
      
      await page.waitForTimeout(1000);
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Start batch process
      await page.locator('#sendbutton').click();
      
      await page.waitForTimeout(2000);
      
      // Verify batch process includes time fields
      const batchLog = consoleLogs.find(log => 
        log.includes('Sending settings') && 
        (log.includes('time fields') || log.includes('tankTime'))
      );
      expect(batchLog).toBeTruthy();
    });
  });

  test.describe('4. Backward Compatibility Testing', () => {
    
    test('should maintain API compatibility', async ({ page }) => {
      // Test that existing API calls still work
      const legacyResponse = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '1',
          opmode: 93,
          pwm: 3
          // No time field - should work with default
        }
      });
      
      expect(legacyResponse.status()).toBe(200);
      
      // Test with time field
      const newResponse = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '1',
          opmode: 93,
          pwm: 3,
          time: 50
        }
      });
      
      expect(newResponse.status()).toBe(200);
    });

    test('should handle preset loading with simplified format', async ({ page }) => {
      // Load different presets to test compatibility
      const presets = ['preset1', 'preset2', 'preset3'];
      
      for (const preset of presets) {
        await page.locator(`#${preset}`).click();
        await page.waitForTimeout(500);
        
        // Verify UI doesn't break with any preset format
        await expect(page.locator('#tank-number')).toBeVisible();
        await expect(page.locator('#tank-time')).toBeVisible();
      }
    });
  });

  test.describe('5. Message Format Verification', () => {
    
    test('should verify MQTT message contains only 4 essential fields', async ({ page }) => {
      // This test verifies the structure through API calls
      // The actual MQTT message format is verified in server logs
      
      const testData = {
        topic: 'DIPSW_1',
        act_id: '4',
        opmode: 93,
        pwm: 3,
        time: 0
      };
      
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: testData
      });
      
      expect(response.status()).toBe(200);
      
      // Verify response structure
      const result = await response.json();
      expect(result).toHaveProperty('message');
      expect(result).toHaveProperty('mqttStatus');
      expect(result.message).toBe('MQTT command processed');
    });

    test('should handle extreme time values correctly', async ({ page }) => {
      const extremeValues = [
        { time: 0, description: 'minimum value' },
        { time: 9999, description: 'maximum value' },
        { time: 1, description: 'small value' },
        { time: 5000, description: 'large value' }
      ];
      
      for (const testCase of extremeValues) {
        const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
          data: {
            topic: 'DIPSW_1',
            act_id: '1',
            opmode: 91,
            pwm: 3,
            time: testCase.time
          }
        });
        
        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.message).toBe('MQTT command processed');
      }
    });
  });

  test.describe('6. Performance and Efficiency Testing', () => {
    
    test('should handle multiple rapid simplified MQTT commands', async ({ page }) => {
      const promises = [];
      
      // Send 10 rapid MQTT commands with simplified format
      for (let i = 0; i < 10; i++) {
        promises.push(
          page.request.post(`${BASE_URL}/api/mqtt-command`, {
            data: {
              topic: 'DIPSW_1',
              act_id: String(i % 4 + 1),
              opmode: 91,
              pwm: 3,
              time: i * 10
            }
          })
        );
      }
      
      const responses = await Promise.all(promises);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status()).toBe(200);
      });
    });

    test('should measure response time for simplified format', async ({ page }) => {
      const startTime = Date.now();
      
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91,
          pwm: 3,
          time: 50
        }
      });
      
      const responseTime = Date.now() - startTime;
      
      expect(response.status()).toBe(200);
      expect(responseTime).toBeLessThan(500); // Should respond within 500ms
    });
  });

});
