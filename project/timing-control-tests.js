const { test, expect } = require('@playwright/test');

// Test configuration
const BASE_URL = 'http://localhost:3100';

test.describe('IoT Command Scheduling Server - Timing Control Comprehensive Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('1. UI Layout and Design Verification', () => {
    
    test('should display new timing control UI correctly', async ({ page }) => {
      // Verify page title and basic structure
      await expect(page).toHaveTitle('원격 제어 시스템');
      
      // Check Korean labels for time controls
      await expect(page.locator('text=시간 (0.1초 단위)')).toHaveCount(5); // All 5 devices
      await expect(page.locator('text=지속시간 (초)')).toHaveCount(4); // 4 devices (not tank)
      await expect(page.locator('text=PWM 값')).toHaveCount(1); // Tank only
      
      // Verify all time input controls are present
      await expect(page.locator('#tank-time')).toBeVisible();
      await expect(page.locator('#silo-motor-right-time')).toBeVisible();
      await expect(page.locator('#silo-motor-left-time')).toBeVisible();
      await expect(page.locator('#rotary-valve-time')).toBeVisible();
      await expect(page.locator('#blower-time')).toBeVisible();
      
      // Verify default values
      await expect(page.locator('#tank-number')).toHaveValue('1');
      await expect(page.locator('#tank-time')).toHaveValue('0');
      await expect(page.locator('#silo-motor-right')).toHaveValue('10');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('0');
    });

    test('should have improved visual design elements', async ({ page }) => {
      // Check that items have proper structure
      const items = page.locator('.item');
      await expect(items).toHaveCount(5);
      
      // Verify each item has header, input group, and buttons
      for (let i = 0; i < 5; i++) {
        const item = items.nth(i);
        await expect(item.locator('.item-header')).toBeVisible();
        await expect(item.locator('.input-group')).toBeVisible();
        await expect(item.locator('.remote-buttons')).toBeVisible();
      }
    });
  });

  test.describe('2. Time Input Controls Functionality', () => {
    
    test('should accept and validate time input values', async ({ page }) => {
      // Test valid time inputs
      await page.locator('#tank-time').fill('25');
      await expect(page.locator('#tank-time')).toHaveValue('25');
      
      await page.locator('#silo-motor-right-time').fill('150');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('150');
      
      await page.locator('#silo-motor-left-time').fill('75');
      await expect(page.locator('#silo-motor-left-time')).toHaveValue('75');
      
      await page.locator('#rotary-valve-time').fill('200');
      await expect(page.locator('#rotary-valve-time')).toHaveValue('200');
      
      await page.locator('#blower-time').fill('100');
      await expect(page.locator('#blower-time')).toHaveValue('100');
    });

    test('should handle edge case values correctly', async ({ page }) => {
      // Test minimum value (0)
      await page.locator('#tank-time').fill('0');
      await expect(page.locator('#tank-time')).toHaveValue('0');
      
      // Test maximum value (9999)
      await page.locator('#silo-motor-right-time').fill('9999');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('9999');
      
      // Test clearing field (should default to empty, which becomes 0 in processing)
      await page.locator('#silo-motor-left-time').fill('');
      await expect(page.locator('#silo-motor-left-time')).toHaveValue('');
    });
  });

  test.describe('3. Individual Device Control with Timing', () => {
    
    test('should send time values with individual device commands', async ({ page }) => {
      // Set up test values for Silo Right
      await page.locator('#silo-motor-right').fill('15'); // 15 seconds duration
      await page.locator('#silo-motor-right-time').fill('50'); // 50 * 0.1s = 5 seconds
      
      // Listen for console logs to verify command
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Click ON button for Silo Right
      await page.locator('.item[data-act-id="1"] .item-start').click();
      
      // Wait for command to be processed
      await page.waitForTimeout(1000);
      
      // Verify console logs show correct values
      const startLog = consoleLogs.find(log => log.includes('Starting item with act_id: 1'));
      expect(startLog).toBeTruthy();
      expect(startLog).toContain('for 15 seconds');
      expect(startLog).toContain('time: 50');
    });

    test('should handle tank number command with time field', async ({ page }) => {
      // Set tank values
      await page.locator('#tank-number').fill('3');
      await page.locator('#tank-time').fill('20');
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      // Click tank ON button
      await page.locator('.item[data-act-id="0"] .item-start').click();
      
      await page.waitForTimeout(1000);
      
      // Verify tank command includes time
      const tankLog = consoleLogs.find(log => log.includes('Starting item with act_id: 0'));
      expect(tankLog).toBeTruthy();
    });

    test('should test all devices with different time values', async ({ page }) => {
      const testCases = [
        { actId: '1', device: 'silo-motor-right', duration: '12', time: '30' },
        { actId: '2', device: 'silo-motor-left', duration: '8', time: '45' },
        { actId: '3', device: 'rotary-valve', duration: '20', time: '60' },
        { actId: '4', device: 'blower', duration: '5', time: '15' }
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
  });

  test.describe('4. Preset Management with Time Fields', () => {
    
    test('should save preset with time values', async ({ page }) => {
      // Set comprehensive test values
      await page.locator('#tank-number').fill('2');
      await page.locator('#tank-time').fill('10');
      await page.locator('#silo-motor-right').fill('15');
      await page.locator('#silo-motor-right-time').fill('25');
      await page.locator('#silo-motor-left').fill('12');
      await page.locator('#silo-motor-left-time').fill('35');
      await page.locator('#rotary-valve').fill('18');
      await page.locator('#rotary-valve-time').fill('40');
      await page.locator('#blower').fill('8');
      await page.locator('#blower-time').fill('20');
      
      // Select preset 3 and save
      await page.locator('input[value="preset3"]').click();
      
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });
      
      await page.locator('#savePreset').click();
      
      // Handle save confirmation dialog
      page.on('dialog', async dialog => {
        expect(dialog.message()).toContain('Settings saved to preset3');
        await dialog.accept();
      });
      
      await page.waitForTimeout(1000);
      
      // Verify save log includes time fields
      const saveLog = consoleLogs.find(log => log.includes('Settings to save:'));
      expect(saveLog).toBeTruthy();
      expect(saveLog).toContain('tankTime');
      expect(saveLog).toContain('siloMotorRightTime');
    });

    test('should load preset with time values', async ({ page }) => {
      // First save a preset with known values
      await page.locator('#tank-time').fill('15');
      await page.locator('#silo-motor-right-time').fill('30');
      await page.locator('#silo-motor-left-time').fill('45');
      
      await page.locator('input[value="preset2"]').click();
      await page.locator('#savePreset').click();
      
      // Handle save dialog
      page.on('dialog', async dialog => {
        await dialog.accept();
      });
      
      await page.waitForTimeout(1000);
      
      // Clear values
      await page.locator('#tank-time').fill('0');
      await page.locator('#silo-motor-right-time').fill('0');
      await page.locator('#silo-motor-left-time').fill('0');
      
      // Load preset 2
      await page.locator('#preset2').click();
      
      await page.waitForTimeout(1000);
      
      // Verify values were loaded correctly
      await expect(page.locator('#tank-time')).toHaveValue('15');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('30');
      await expect(page.locator('#silo-motor-left-time')).toHaveValue('45');
    });
  });

  test.describe('5. API Endpoint Testing with Time Fields', () => {

    test('should handle /api/mqtt-command with time field', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: {
          topic: 'DIPSW_1',
          act_id: '2',
          opmode: 91,
          pwm: 3,
          time: 75 // 7.5 seconds in 0.1s units
        }
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('MQTT command processed');
      expect(result.mqttStatus).toBe('disconnected'); // Expected in test environment
    });

    test('should handle /api/start-item with time field', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '3',
          duration: '25',
          time: '120' // 12 seconds in 0.1s units
        }
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Item command processed with timing information');
    });

    test('should validate time field in API requests', async ({ page }) => {
      // Test invalid time value (negative)
      const invalidResponse = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '2',
          duration: '10',
          time: '-5'
        }
      });

      expect(invalidResponse.status()).toBe(400);
      const errorResult = await invalidResponse.json();
      expect(errorResult.message).toContain('Invalid time value');
    });

    test('should handle missing time field gracefully', async ({ page }) => {
      // Test without time field (should default to 0)
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: {
          actId: '1',
          duration: '15'
          // time field omitted
        }
      });

      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Item command processed with timing information');
    });
  });

  test.describe('6. Batch Start Process with Time Fields', () => {

    test('should include time fields in batch start process', async ({ page }) => {
      // Set up preset with time values
      await page.locator('#tank-number').fill('1');
      await page.locator('#tank-time').fill('5');
      await page.locator('#silo-motor-right').fill('10');
      await page.locator('#silo-motor-right-time').fill('20');
      await page.locator('#silo-motor-left').fill('8');
      await page.locator('#silo-motor-left-time').fill('30');
      await page.locator('#rotary-valve').fill('12');
      await page.locator('#rotary-valve-time').fill('25');
      await page.locator('#blower').fill('6');
      await page.locator('#blower-time').fill('15');

      // Save as preset 1
      await page.locator('input[value="preset1"]').click();
      await page.locator('#savePreset').click();

      // Handle save dialog
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

      // Start the batch process
      await page.locator('#sendbutton').click();

      await page.waitForTimeout(2000);

      // Verify batch process includes time fields
      const batchLog = consoleLogs.find(log => log.includes('Sending settings with time fields'));
      expect(batchLog).toBeTruthy();
    });
  });

  test.describe('7. Backward Compatibility Testing', () => {

    test('should load legacy presets correctly', async ({ page }) => {
      // Load preset 1 (should be legacy format if exists)
      await page.locator('#preset1').click();

      await page.waitForTimeout(1000);

      // Verify that time fields default to 0 for legacy presets
      const timeFields = [
        '#tank-time',
        '#silo-motor-right-time',
        '#silo-motor-left-time',
        '#rotary-valve-time',
        '#blower-time'
      ];

      for (const field of timeFields) {
        const value = await page.locator(field).inputValue();
        // Legacy presets should have time fields as 0 or empty
        expect(['0', '']).toContain(value);
      }
    });

    test('should handle mixed preset formats', async ({ page }) => {
      // Load different presets and verify they work
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

  test.describe('8. End-to-End Timing Control Scenarios', () => {

    test('should demonstrate complete timing control workflow', async ({ page }) => {
      console.log('🧪 Starting comprehensive timing control workflow test...');

      // Step 1: Set up complex timing scenario
      await page.locator('#tank-number').fill('3');
      await page.locator('#tank-time').fill('50'); // 5 seconds
      await page.locator('#silo-motor-right').fill('20');
      await page.locator('#silo-motor-right-time').fill('100'); // 10 seconds
      await page.locator('#silo-motor-left').fill('15');
      await page.locator('#silo-motor-left-time').fill('75'); // 7.5 seconds
      await page.locator('#rotary-valve').fill('25');
      await page.locator('#rotary-valve-time').fill('150'); // 15 seconds
      await page.locator('#blower').fill('12');
      await page.locator('#blower-time').fill('80'); // 8 seconds

      // Step 2: Test individual device with timing
      const consoleLogs = [];
      page.on('console', msg => {
        if (msg.type() === 'log') {
          consoleLogs.push(msg.text());
        }
      });

      await page.locator('.item[data-act-id="1"] .item-start').click();
      await page.waitForTimeout(1000);

      // Verify individual command includes time
      const individualLog = consoleLogs.find(log =>
        log.includes('act_id: 1') && log.includes('time: 100')
      );
      expect(individualLog).toBeTruthy();

      // Step 3: Save preset with timing values
      await page.locator('input[value="preset3"]').click();
      await page.locator('#savePreset').click();

      page.on('dialog', async dialog => {
        await dialog.accept();
      });

      await page.waitForTimeout(1000);

      // Step 4: Clear and reload to verify persistence
      await page.locator('#tank-time').fill('0');
      await page.locator('#silo-motor-right-time').fill('0');

      await page.locator('#preset3').click();
      await page.waitForTimeout(1000);

      // Verify values restored correctly
      await expect(page.locator('#tank-time')).toHaveValue('50');
      await expect(page.locator('#silo-motor-right-time')).toHaveValue('100');

      // Step 5: Test batch start with timing
      await page.locator('#sendbutton').click();
      await page.waitForTimeout(2000);

      // Verify batch includes timing
      const batchLog = consoleLogs.find(log => log.includes('time fields'));
      expect(batchLog).toBeTruthy();

      console.log('✅ Complete timing control workflow test passed!');
    });
  });

});
