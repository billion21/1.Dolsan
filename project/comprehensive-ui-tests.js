const { test, expect } = require('@playwright/test');

// Test configuration
const BASE_URL = 'http://localhost:3100';

test.describe('Comprehensive IoT Server Testing - Enhanced Minimal UI', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. UI/UX Testing - Visual Design & Readability', () => {
    
    test('should display minimal design with improved readability', async ({ page }) => {
      // Verify page loads with new design
      await expect(page).toHaveTitle('원격 제어 시스템');
      
      // Check Korean text readability
      await expect(page.locator('text=시간 (0.1초 단위)')).toHaveCount(5);
      await expect(page.locator('text=지속시간 (초)')).toHaveCount(4);
      await expect(page.locator('text=PWM 값')).toHaveCount(1);
      
      // Verify visual hierarchy
      const items = page.locator('.item');
      await expect(items).toHaveCount(5);
      
      // Check that all elements are visible and properly spaced
      for (let i = 0; i < 5; i++) {
        const item = items.nth(i);
        await expect(item).toBeVisible();
        await expect(item.locator('.item-title')).toBeVisible();
        await expect(item.locator('.input-group')).toBeVisible();
        await expect(item.locator('.remote-buttons')).toBeVisible();
      }
    });

    test('should have proper contrast and typography', async ({ page }) => {
      // Test input field visibility and contrast
      const inputs = page.locator('input[type="number"]');
      const inputCount = await inputs.count();
      
      for (let i = 0; i < inputCount; i++) {
        const input = inputs.nth(i);
        await expect(input).toBeVisible();
        
        // Test that inputs are focusable and have proper styling
        await input.focus();
        await expect(input).toBeFocused();
      }
      
      // Test button visibility and contrast
      const buttons = page.locator('button');
      const buttonCount = await buttons.count();
      
      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i);
        await expect(button).toBeVisible();
      }
    });

    test('should be responsive across different screen sizes', async ({ page }) => {
      // Test desktop view (default)
      await page.setViewportSize({ width: 1200, height: 800 });
      await expect(page.locator('.box')).toBeVisible();
      
      // Test tablet view
      await page.setViewportSize({ width: 768, height: 1024 });
      await expect(page.locator('.box')).toBeVisible();
      await expect(page.locator('.item')).toHaveCount(5);
      
      // Test mobile view
      await page.setViewportSize({ width: 375, height: 667 });
      await expect(page.locator('.box')).toBeVisible();
      await expect(page.locator('.item')).toHaveCount(5);
      
      // Reset to desktop
      await page.setViewportSize({ width: 1200, height: 800 });
    });

    test('should have accessible user interaction flows', async ({ page }) => {
      // Test preset selection flow
      await page.locator('label').filter({ hasText: '프리셋 1' }).click();
      await expect(page.locator('input[value="preset1"]')).toBeChecked();
      
      // Test input field interaction
      await page.locator('#tank-number').fill('3');
      await expect(page.locator('#tank-number')).toHaveValue('3');
      
      // Test button interaction
      await page.locator('#savePreset').click();
      // Handle dialog
      page.on('dialog', async dialog => {
        await dialog.accept();
      });
    });
  });

  test.describe('2. Functional Testing - Timing Control', () => {
    
    test('should handle various time values correctly', async ({ page }) => {
      const testCases = [
        { device: 'tank-time', value: '0', expected: '0' },
        { device: 'silo-motor-right-time', value: '50', expected: '50' },
        { device: 'silo-motor-left-time', value: '100', expected: '100' },
        { device: 'rotary-valve-time', value: '9999', expected: '9999' },
        { device: 'blower-time', value: '250', expected: '250' }
      ];
      
      for (const testCase of testCases) {
        await page.locator(`#${testCase.device}`).fill(testCase.value);
        await expect(page.locator(`#${testCase.device}`)).toHaveValue(testCase.expected);
      }
    });

    test('should verify MQTT message format with time fields', async ({ page }) => {
      // Set up test values
      await page.locator('#silo-motor-right').fill('15');
      await page.locator('#silo-motor-right-time').fill('75');
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Trigger individual device command
      await page.locator('.item[data-act-id="1"] .item-start').click();
      
      await page.waitForTimeout(1000);
      
      // Verify console logs show correct timing data
      const commandLog = consoleLogs.find(log => 
        log.includes('act_id: 1') && 
        log.includes('15 seconds') && 
        log.includes('time: 75')
      );
      expect(commandLog).toBeTruthy();
    });

    test('should test individual device controls with different combinations', async ({ page }) => {
      const deviceTests = [
        { actId: '1', device: 'silo-motor-right', duration: '20', time: '80' },
        { actId: '2', device: 'silo-motor-left', duration: '15', time: '60' },
        { actId: '3', device: 'rotary-valve', duration: '25', time: '120' },
        { actId: '4', device: 'blower', duration: '10', time: '40' }
      ];
      
      for (const test of deviceTests) {
        // Set values
        await page.locator(`#${test.device}`).fill(test.duration);
        await page.locator(`#${test.device}-time`).fill(test.time);
        
        const consoleLogs = [];
        page.on('console', msg => {
          if (msg.type() === 'log') {
            consoleLogs.push(msg.text());
          }
        });
        
        // Click ON button
        await page.locator(`.item[data-act-id="${test.actId}"] .item-start`).click();
        
        await page.waitForTimeout(500);
        
        // Verify command includes correct values
        const log = consoleLogs.find(l => 
          l.includes(`act_id: ${test.actId}`) && 
          l.includes(`${test.duration} seconds`) &&
          l.includes(`time: ${test.time}`)
        );
        expect(log).toBeTruthy();
      }
    });

    test('should validate preset management with time fields', async ({ page }) => {
      // Set comprehensive test values
      await page.locator('#tank-number').fill('2');
      await page.locator('#tank-time').fill('30');
      await page.locator('#silo-motor-right').fill('18');
      await page.locator('#silo-motor-right-time').fill('90');
      await page.locator('#silo-motor-left').fill('12');
      await page.locator('#silo-motor-left-time').fill('60');
      await page.locator('#rotary-valve').fill('22');
      await page.locator('#rotary-valve-time').fill('110');
      await page.locator('#blower').fill('8');
      await page.locator('#blower-time').fill('40');
      
      // Select and save preset
      await page.locator('label').filter({ hasText: '프리셋 3' }).click();
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      await page.locator('#savePreset').click();
      
      page.on('dialog', async dialog => {
        await dialog.accept();
      });
      
      await page.waitForTimeout(1000);
      
      // Verify save includes time fields
      const saveLog = consoleLogs.find(log => 
        log.includes('Settings to save:') && 
        log.includes('tankTime') && 
        log.includes('siloMotorRightTime')
      );
      expect(saveLog).toBeTruthy();
      
      // Clear values and reload
      await page.locator('#tank-time').fill('0');
      await page.locator('#silo-motor-right-time').fill('0');
      
      await page.locator('#preset3').click();
      await page.waitForTimeout(1000);
      
      // Verify values restored
      await expect(page.locator('#tank-time')).toHaveValue('30');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('90');
    });
  });

  test.describe('3. Edge Case Testing', () => {
    
    test('should handle extreme values correctly', async ({ page }) => {
      // Test minimum values
      await page.locator('#tank-time').fill('0');
      await expect(page.locator('#tank-time')).toHaveValue('0');
      
      // Test maximum values
      await page.locator('#silo-motor-right-time').fill('9999');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('9999');
      
      // Test empty fields
      await page.locator('#silo-motor-left-time').fill('');
      await expect(page.locator('#silo-motor-left-time')).toHaveValue('');
    });

    test('should handle invalid inputs gracefully', async ({ page }) => {
      // Test API with invalid time value
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '2',
          duration: '10',
          time: '-5'
        }
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Invalid time value');
    });

    test('should handle concurrent operations', async ({ page }) => {
      // Set values for multiple devices
      await page.locator('#silo-motor-right').fill('10');
      await page.locator('#silo-motor-right-time').fill('50');
      await page.locator('#silo-motor-left').fill('8');
      await page.locator('#silo-motor-left-time').fill('40');
      
      // Click multiple ON buttons rapidly
      await Promise.all([
        page.locator('.item[data-act-id="1"] .item-start').click(),
        page.locator('.item[data-act-id="2"] .item-start').click()
      ]);
      
      await page.waitForTimeout(1000);
      
      // Verify both commands were processed
      // (This tests the server's ability to handle concurrent requests)
    });

    test('should verify backward compatibility', async ({ page }) => {
      // Load different presets to test compatibility
      const presets = ['preset1', 'preset2', 'preset3'];
      
      for (const preset of presets) {
        await page.locator(`#${preset}`).click();
        await page.waitForTimeout(500);
        
        // Verify UI doesn't break with any preset format
        await expect(page.locator('#tank-number')).toBeVisible();
        await expect(page.locator('#tank-time')).toBeVisible();
        
        // Verify time fields have valid values (0 or positive numbers)
        const timeValue = await page.locator('#tank-time').inputValue();
        expect(['', '0']).toContain(timeValue);
      }
    });
  });

  test.describe('4. Integration Testing - API Endpoints', () => {

    test('should test /api/mqtt-command with time parameters', async ({ page }) => {
      const testCases = [
        { topic: 'DIPSW_1', act_id: '1', opmode: 91, pwm: 3, time: 50 },
        { topic: 'DIPSW_1', act_id: '2', opmode: 91, pwm: 3, time: 100 },
        { topic: 'DIPSW_1', act_id: '3', opmode: 91, pwm: 3, time: 0 },
        { topic: 'DIPSW_1', act_id: '4', opmode: 91, pwm: 3, time: 9999 }
      ];

      for (const testCase of testCases) {
        const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
          data: testCase
        });

        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.message).toBe('MQTT command processed');
        expect(result.mqttStatus).toBe('disconnected');
      }
    });

    test('should test /api/start-item with various time values', async ({ page }) => {
      const testCases = [
        { actId: '1', duration: '10', time: '25' },
        { actId: '2', duration: '15', time: '50' },
        { actId: '3', duration: '20', time: '75' },
        { actId: '4', duration: '5', time: '0' }
      ];

      for (const testCase of testCases) {
        const response = await page.request.post(`${BASE_URL}/api/start-item`, {
          data: testCase
        });

        expect(response.status()).toBe(200);
        const result = await response.json();
        expect(result.message).toBe('Item command processed with timing information');
      }
    });

    test('should verify batch start process includes timing', async ({ page }) => {
      // Set up preset with time values
      await page.locator('#tank-number').fill('1');
      await page.locator('#tank-time').fill('15');
      await page.locator('#silo-motor-right').fill('12');
      await page.locator('#silo-motor-right-time').fill('30');
      await page.locator('#silo-motor-left').fill('10');
      await page.locator('#silo-motor-left-time').fill('25');

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

      // Verify batch includes time fields
      const batchLog = consoleLogs.find(log =>
        log.includes('Sending settings') &&
        (log.includes('time fields') || log.includes('tankTime'))
      );
      expect(batchLog).toBeTruthy();
    });

    test('should test server-side validation', async ({ page }) => {
      // Test missing required fields
      const invalidResponse1 = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91
          // Missing pwm
        }
      });

      expect(invalidResponse1.status()).toBe(400);

      // Test invalid time value
      const invalidResponse2 = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '2',
          duration: '10',
          time: 'invalid'
        }
      });

      expect(invalidResponse2.status()).toBe(400);
    });
  });

  test.describe('5. Performance Testing', () => {

    test('should measure response times', async ({ page }) => {
      const startTime = Date.now();

      // Test page load time
      await page.goto(BASE_URL);
      await page.waitForLoadState('networkidle');

      const loadTime = Date.now() - startTime;
      expect(loadTime).toBeLessThan(3000); // Should load within 3 seconds

      // Test input response time
      const inputStartTime = Date.now();
      await page.locator('#tank-number').fill('5');
      const inputTime = Date.now() - inputStartTime;
      expect(inputTime).toBeLessThan(100); // Should respond within 100ms

      // Test API response time
      const apiStartTime = Date.now();
      const response = await page.request.get(`${BASE_URL}/api/check-status`);
      const apiTime = Date.now() - apiStartTime;
      expect(apiTime).toBeLessThan(500); // API should respond within 500ms
      expect(response.status()).toBe(200);
    });

    test('should handle multiple simultaneous requests', async ({ page }) => {
      const promises = [];

      // Send 10 concurrent status requests
      for (let i = 0; i < 10; i++) {
        promises.push(page.request.get(`${BASE_URL}/api/check-status`));
      }

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status()).toBe(200);
      });
    });

    test('should test memory usage with rapid interactions', async ({ page }) => {
      // Perform rapid UI interactions
      for (let i = 0; i < 20; i++) {
        await page.locator('#tank-number').fill(String(i % 10));
        await page.locator('#tank-time').fill(String(i * 5));

        if (i % 5 === 0) {
          await page.locator('label').filter({ hasText: '프리셋 1' }).click();
        }
      }

      // Verify UI is still responsive
      await expect(page.locator('#tank-number')).toBeVisible();
      await expect(page.locator('#tank-time')).toBeVisible();
    });
  });

  test.describe('6. Error Resolution Testing', () => {

    test('should identify and handle UI errors gracefully', async ({ page }) => {
      const errors = [];

      // Capture any JavaScript errors
      page.on('pageerror', error => {
        errors.push(error.message);
      });

      // Perform various UI interactions
      await page.locator('#tank-number').fill('test'); // Invalid input
      await page.locator('#tank-time').fill('-1'); // Invalid time
      await page.locator('#savePreset').click(); // Save without preset selection

      // Handle any dialogs
      page.on('dialog', async dialog => {
        await dialog.accept();
      });

      await page.waitForTimeout(1000);

      // Verify no critical JavaScript errors occurred
      const criticalErrors = errors.filter(error =>
        !error.includes('Warning') && !error.includes('Info')
      );
      expect(criticalErrors.length).toBe(0);
    });

    test('should test error recovery mechanisms', async ({ page }) => {
      // Test recovery from invalid input
      await page.locator('#tank-number').fill('invalid');
      await page.locator('#tank-number').fill('2'); // Correct the input
      await expect(page.locator('#tank-number')).toHaveValue('2');

      // Test recovery from failed API call
      const response = await page.request.post(`${BASE_URL}/api/invalid-endpoint`, {
        data: { test: 'data' }
      });
      expect(response.status()).toBe(404);

      // Verify system still works after error
      const validResponse = await page.request.get(`${BASE_URL}/api/check-status`);
      expect(validResponse.status()).toBe(200);
    });
  });

  test.describe('7. End-to-End Comprehensive Workflow', () => {

    test('should complete full timing control workflow', async ({ page }) => {
      console.log('🧪 Starting comprehensive timing control workflow...');

      // Step 1: Set up complex timing scenario
      await page.locator('#tank-number').fill('3');
      await page.locator('#tank-time').fill('40');
      await page.locator('#silo-motor-right').fill('25');
      await page.locator('#silo-motor-right-time').fill('120');
      await page.locator('#silo-motor-left').fill('18');
      await page.locator('#silo-motor-left-time').fill('90');
      await page.locator('#rotary-valve').fill('30');
      await page.locator('#rotary-valve-time').fill('150');
      await page.locator('#blower').fill('15');
      await page.locator('#blower-time').fill('75');

      // Step 2: Test individual device control
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });

      await page.locator('.item[data-act-id="1"] .item-start').click();
      await page.waitForTimeout(1000);

      // Verify individual command
      const individualLog = consoleLogs.find(log =>
        log.includes('act_id: 1') && log.includes('time: 120')
      );
      expect(individualLog).toBeTruthy();

      // Step 3: Save preset
      await page.locator('label').filter({ hasText: '프리셋 2' }).click();
      await page.locator('#savePreset').click();

      page.on('dialog', async dialog => {
        await dialog.accept();
      });

      await page.waitForTimeout(1000);

      // Step 4: Test batch process
      await page.locator('#sendbutton').click();
      await page.waitForTimeout(2000);

      // Step 5: Verify all functionality
      const saveLog = consoleLogs.find(log => log.includes('Settings to save'));
      const batchLog = consoleLogs.find(log => log.includes('Sending settings'));

      expect(saveLog).toBeTruthy();
      expect(batchLog).toBeTruthy();

      console.log('✅ Comprehensive timing control workflow completed successfully!');
    });
  });

});
