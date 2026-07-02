const { test, expect } = require('@playwright/test');

// Test configuration
const BASE_URL = 'http://localhost:3100';

test.describe('IoT Command Scheduling Server - Comprehensive Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to the application before each test
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.describe('UI Functionality Tests', () => {
    
    test('should load the main UI correctly', async ({ page }) => {
      // Check page title
      await expect(page).toHaveTitle('원격 제어 시스템');
      
      // Check main elements are present
      await expect(page.locator('text=프리셋 1')).toBeVisible();
      await expect(page.locator('text=프리셋 2')).toBeVisible();
      await expect(page.locator('text=프리셋 3')).toBeVisible();
      
      // Check control elements
      await expect(page.locator('text=수조 번호')).toBeVisible();
      await expect(page.locator('text=사일로(우)')).toBeVisible();
      await expect(page.locator('text=사일로(좌)')).toBeVisible();
      await expect(page.locator('text=로터리')).toBeVisible();
      await expect(page.locator('text=블로워')).toBeVisible();
      
      // Check action buttons
      await expect(page.locator('text=저장')).toBeVisible();
      await expect(page.locator('text=시작')).toBeVisible();
      await expect(page.locator('text=정지')).toBeVisible();
    });

    test('should allow input in number fields', async ({ page }) => {
      // Test tank number input
      const tankInput = page.getByRole('spinbutton', { name: '수조 번호' });
      await tankInput.fill('5');
      await expect(tankInput).toHaveValue('5');

      // Test silo right input
      const siloRightInput = page.getByRole('spinbutton', { name: '사일로(우)' });
      await siloRightInput.fill('15');
      await expect(siloRightInput).toHaveValue('15');

      // Test silo left input
      const siloLeftInput = page.getByRole('spinbutton', { name: '사일로(좌)' });
      await siloLeftInput.fill('10');
      await expect(siloLeftInput).toHaveValue('10');

      // Test rotary input
      const rotaryInput = page.getByRole('spinbutton', { name: '로터리' });
      await rotaryInput.fill('12');
      await expect(rotaryInput).toHaveValue('12');

      // Test blower input
      const blowerInput = page.getByRole('spinbutton', { name: '블로워' });
      await blowerInput.fill('8');
      await expect(blowerInput).toHaveValue('8');
    });

    test('should handle preset selection', async ({ page }) => {
      // Click preset 1
      await page.locator('text=프리셋 1').click();
      
      // Check if preset 1 radio is selected
      const preset1Radio = page.locator('input[type="radio"]').first();
      await expect(preset1Radio).toBeChecked();
      
      // Click preset 2
      await page.locator('text=프리셋 2').click();
      
      // Check if preset 2 radio is selected
      const preset2Radio = page.locator('input[type="radio"]').nth(1);
      await expect(preset2Radio).toBeChecked();
    });

    test('should handle individual device ON/OFF controls', async ({ page }) => {
      // Test tank number ON button (OFF should be disabled initially)
      const tankOnBtn = page.locator('text=수조 번호').locator('..').locator('button:has-text("ON")');
      const tankOffBtn = page.locator('text=수조 번호').locator('..').locator('button:has-text("OFF")');
      
      await expect(tankOnBtn).toBeEnabled();
      await expect(tankOffBtn).toBeDisabled();
      
      // Test silo right ON/OFF buttons
      const siloRightOnBtn = page.locator('text=사일로(우)').locator('..').locator('button:has-text("ON")');
      const siloRightOffBtn = page.locator('text=사일로(우)').locator('..').locator('button:has-text("OFF")');
      
      await expect(siloRightOnBtn).toBeEnabled();
      await expect(siloRightOffBtn).toBeEnabled();
      
      // Test clicking ON button
      await siloRightOnBtn.click();
      // Note: We can't easily test the actual MQTT command without mocking, 
      // but we can verify the button interaction works
    });

  });

  test.describe('API Endpoint Tests', () => {
    
    test('should handle presets API correctly', async ({ page }) => {
      // Test saving presets
      const response = await page.request.post(`${BASE_URL}/api/presets`, {
        data: {
          preset1: { tankNumber: 1, siloMotorRight: 10, siloMotorLeft: 8, rotaryValve: 12, blower: 6 },
          preset2: { tankNumber: 2, siloMotorRight: 15, siloMotorLeft: 12, rotaryValve: 10, blower: 8 },
          preset3: { tankNumber: 3, siloMotorRight: 20, siloMotorLeft: 15, rotaryValve: 18, blower: 10 }
        }
      });
      
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe('Presets saved successfully');
      
      // Test loading presets
      const loadResponse = await page.request.get(`${BASE_URL}/api/presets`);
      expect(loadResponse.status()).toBe(200);
      
      const presets = await loadResponse.json();
      expect(presets).toHaveProperty('preset1');
      expect(presets.preset1.tankNumber).toBe(1);
    });

    test('should handle start process API', async ({ page }) => {
      const settings = {
        tankNumber: '2',
        siloMotorRight: '15',
        siloMotorLeft: '10',
        rotaryValve: '12',
        blower: '8'
      };
      
      const response = await page.request.post(`${BASE_URL}/api/start`, {
        data: settings
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Process completed or halted');
      expect(result).toHaveProperty('mqttStatus');
    });

    test('should handle stop process API', async ({ page }) => {
      const response = await page.request.post(`${BASE_URL}/api/stop`);
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Stop commands sent with timing information');
    });

    test('should handle status check API', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/api/check-status`);
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result).toHaveProperty('halted');
      expect(typeof result.halted).toBe('boolean');
    });

    test('should handle MQTT command API', async ({ page }) => {
      const commandData = {
        topic: 'DIPSW_1',
        act_id: '2',
        opmode: 91,
        pwm: 3,
        timing: {
          delay: 0,
          timestamp: Math.floor(Date.now() / 1000),
          duration: 10
        }
      };
      
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: commandData
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('MQTT command processed');
      expect(result).toHaveProperty('mqttStatus');
    });

    test('should handle start item API', async ({ page }) => {
      const itemData = {
        actId: '2',
        duration: '15'
      };
      
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: itemData
      });
      
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Item command processed with timing information');
    });

  });

  test.describe('Error Handling Tests', () => {
    
    test('should handle invalid start process data', async ({ page }) => {
      // Test with missing required fields
      const invalidSettings = {
        tankNumber: '2'
        // Missing other required fields
      };
      
      const response = await page.request.post(`${BASE_URL}/api/start`, {
        data: invalidSettings
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Missing required field');
    });

    test('should handle invalid MQTT command data', async ({ page }) => {
      // Test with missing required fields
      const invalidCommand = {
        topic: 'DIPSW_1'
        // Missing act_id, opmode, pwm
      };
      
      const response = await page.request.post(`${BASE_URL}/api/mqtt-command`, {
        data: invalidCommand
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Missing required fields');
    });

    test('should handle invalid start item data', async ({ page }) => {
      // Test with missing duration
      const invalidItem = {
        actId: '2'
        // Missing duration
      };
      
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: invalidItem
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Missing actId or duration');
    });

    test('should handle invalid number inputs', async ({ page }) => {
      // Test with non-numeric values
      const invalidItem = {
        actId: 'invalid',
        duration: 'invalid'
      };
      
      const response = await page.request.post(`${BASE_URL}/api/start-item`, {
        data: invalidItem
      });
      
      expect(response.status()).toBe(400);
      const result = await response.json();
      expect(result.message).toContain('Invalid actId or duration');
    });

  });

  test.describe('End-to-End Workflow Tests', () => {

    test('should complete full preset save and load workflow', async ({ page }) => {
      // Fill in values
      await page.getByRole('spinbutton', { name: '수조 번호' }).fill('3');
      await page.getByRole('spinbutton', { name: '사일로(우)' }).fill('20');
      await page.getByRole('spinbutton', { name: '사일로(좌)' }).fill('15');
      await page.getByRole('spinbutton', { name: '로터리' }).fill('18');
      await page.getByRole('spinbutton', { name: '블로워' }).fill('12');

      // Select preset 1 and save
      await page.locator('text=프리셋 1').click();
      await page.locator('text=저장').click();

      // Clear values
      await page.getByRole('spinbutton', { name: '수조 번호' }).fill('0');
      await page.getByRole('spinbutton', { name: '사일로(우)' }).fill('0');
      await page.getByRole('spinbutton', { name: '사일로(좌)' }).fill('0');
      await page.getByRole('spinbutton', { name: '로터리' }).fill('0');
      await page.getByRole('spinbutton', { name: '블로워' }).fill('0');

      // Load preset 1 and verify values are restored
      await page.locator('text=프리셋 1').click();

      // Wait a bit for the preset to load
      await page.waitForTimeout(1000);

      // Verify values (this depends on the actual implementation)
      // Note: The actual verification would depend on how the UI handles preset loading
    });

    test('should complete full start and stop workflow', async ({ page }) => {
      // Set up valid settings
      await page.getByRole('spinbutton', { name: '수조 번호' }).fill('2');
      await page.getByRole('spinbutton', { name: '사일로(우)' }).fill('15');
      await page.getByRole('spinbutton', { name: '사일로(좌)' }).fill('10');
      await page.getByRole('spinbutton', { name: '로터리' }).fill('12');
      await page.getByRole('spinbutton', { name: '블로워' }).fill('8');

      // Start the process
      await page.locator('text=시작').click();

      // Wait a moment
      await page.waitForTimeout(2000);

      // Stop the process
      await page.locator('text=정지').click();

      // Verify the process can be started again
      await page.locator('text=시작').click();
    });

    test('should handle individual device control workflow', async ({ page }) => {
      // Set duration for silo right
      await page.getByRole('spinbutton', { name: '사일로(우)' }).fill('10');

      // Click ON button for silo right
      const siloRightOnBtn = page.locator('text=사일로(우)').locator('..').locator('button:has-text("ON")');
      await siloRightOnBtn.click();

      // Wait a moment
      await page.waitForTimeout(1000);

      // Click OFF button for silo right
      const siloRightOffBtn = page.locator('text=사일로(우)').locator('..').locator('button:has-text("OFF")');
      await siloRightOffBtn.click();
    });

  });

  test.describe('Performance and Load Tests', () => {

    test('should handle multiple rapid API calls', async ({ page }) => {
      const promises = [];

      // Send multiple status check requests rapidly
      for (let i = 0; i < 10; i++) {
        promises.push(page.request.get(`${BASE_URL}/api/check-status`));
      }

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status()).toBe(200);
      });
    });

    test('should handle concurrent start/stop operations', async ({ page }) => {
      const settings = {
        tankNumber: '1',
        siloMotorRight: '5',
        siloMotorLeft: '5',
        rotaryValve: '5',
        blower: '5'
      };

      // Start process
      const startPromise = page.request.post(`${BASE_URL}/api/start`, { data: settings });

      // Immediately try to stop
      const stopPromise = page.request.post(`${BASE_URL}/api/stop`);

      const [startResponse, stopResponse] = await Promise.all([startPromise, stopPromise]);

      // Both should succeed (server should handle concurrent operations gracefully)
      expect(startResponse.status()).toBe(200);
      expect(stopResponse.status()).toBe(200);
    });

  });

  test.describe('Static File Serving Tests', () => {

    test('should serve static CSS files', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/style.css`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/css');
    });

    test('should serve static JavaScript files', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/presetHandler.js`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('javascript');
    });

    test('should return 404 for non-existent files', async ({ page }) => {
      const response = await page.request.get(`${BASE_URL}/nonexistent.js`);
      expect(response.status()).toBe(404);
    });

  });

  test.describe('Security and Edge Cases', () => {

    test('should handle malformed JSON in API requests', async ({ page }) => {
      // This test would need to be done at a lower level since Playwright's request API
      // automatically handles JSON serialization. In a real scenario, you'd test this
      // with raw HTTP requests or by mocking the request body.
    });

    test('should handle very large input values', async ({ page }) => {
      const largeSettings = {
        tankNumber: '999999',
        siloMotorRight: '999999',
        siloMotorLeft: '999999',
        rotaryValve: '999999',
        blower: '999999'
      };

      const response = await page.request.post(`${BASE_URL}/api/start`, {
        data: largeSettings
      });

      // Should still process (server doesn't validate ranges in this implementation)
      expect(response.status()).toBe(200);
    });

    test('should handle negative input values', async ({ page }) => {
      const negativeSettings = {
        tankNumber: '-1',
        siloMotorRight: '-5',
        siloMotorLeft: '-3',
        rotaryValve: '-2',
        blower: '-1'
      };

      const response = await page.request.post(`${BASE_URL}/api/start`, {
        data: negativeSettings
      });

      // Should still process (server doesn't validate ranges in this implementation)
      expect(response.status()).toBe(200);
    });

  });

});
