/**
 * IoT Feeding System - Dashboard Controller
 * Main JavaScript for three-panel dashboard
 */

(function () {
    'use strict';

    // ===================================
    // RTC Configuration
    // ===================================
    // TODO: Confirm these settings with actual hardware
    const RTC_CONFIG = {
        topic: 'DIPSW_RTC',
        responseTopic: 'DIPSW_RTC_cv',
        timeout: 5000
    };

    // ===================================
    // Day-of-Week Constants
    // ===================================
    const DAY_NAMES_KR = ['월', '화', '수', '목', '금', '토', '일'];
    const DAY_NAMES_FULL_KR = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];

    // ===================================
    // Outlet Numbering Constants
    // ===================================
    // Offset to avoid MQTT topic conflicts
    // UI uses 0-3 (displayed as "1번 수조" to "4번 수조")
    // Storage/MQTT uses 10-13 (outlet 10, 11, 12, 13)
    const OUTLET_OFFSET = 10;

    // ===================================
    // State Management
    // ===================================
    const state = {
        currentTab: 'schedule',
        selectedTanks: [],          // Array of selected tank outlets (0-3)
        reservations: [],           // All schedules in DAY_OF_WEEK array format
        selectedDayOfWeek: [1, 1, 1, 1, 1, 1, 1], // Currently selected days for new schedule
        feedingTimes: [],           // Feeding times for current schedule being created
        sseConnected: false,        // SSE connection to server for real-time updates
        systemTime: null,
        boardTime: null,
        lastSyncTime: null,
        isManualTimeInput: false,   // Flag to prevent auto-update when user is manually setting time
        manualTimeTimeout: null,    // Timeout to reset manual input flag
        timeOffset: 0,              // Time offset in milliseconds for virtual clock (manual time - actual time)
        tankMotorValues: {}         // Per-tank motor values: { [uiOutlet]: { feedMotor, scatterMotor } }
    };

    // ===================================
    // LocalStorage Keys
    // ===================================
    const STORAGE_KEYS = {
        TIME_OFFSET: 'iot_feeding_system_time_offset',
        PANEL_COLLAPSE_STATE: 'iot_feeding_system_panel_collapse_state'
    };

    // ===================================
    // DOM Elements
    // ===================================
    const elements = {
        // Tab navigation
        tabButtons: document.querySelectorAll('.tab-btn'),
        tabContents: document.querySelectorAll('.tab-content'),

        // Day of week checkboxes
        dayCheckboxes: null, // Will be initialized after DOM loads

        // Time picker
        feedingHour: document.getElementById('feedingHour'),
        feedingMinute: document.getElementById('feedingMinute'),
        addTimeBtn: document.getElementById('addTimeBtn'),
        scheduleList: document.getElementById('scheduleList'),

        // Feed amount and duration
        operationDuration: document.getElementById('operationDuration'),

        // Action buttons
        saveScheduleBtn: document.getElementById('saveScheduleBtn'),

        // RTC controls
        timeHours: document.getElementById('timeHours'),
        timeMinutes: document.getElementById('timeMinutes'),
        timeSeconds: document.getElementById('timeSeconds'),
        setTimeBtn: document.getElementById('setTimeBtn'),
        saveTimeBtn: document.getElementById('saveTimeBtn'),
        resetTimeBtn: document.getElementById('resetTimeBtn'),

        // Sensor display
        sensorTemp: document.getElementById('sensor-temp'),
        sensorDO: document.getElementById('sensor-do'),
        sensorPH: document.getElementById('sensor-ph'),
        sensorTurbidity: document.getElementById('sensor-turbidity'),

        // Operation log
        logTableBody: document.getElementById('logTableBody'),

        // Schedule list display
        scheduleCards: document.getElementById('scheduleCards'),
        noSchedulesPlaceholder: document.getElementById('noSchedulesPlaceholder'),

        // Status indicators
        status1: document.getElementById('status-1'),
        status2: document.getElementById('status-2'),
        status3: document.getElementById('status-3'),
        status4: document.getElementById('status-4'),

        // Large feeder controls
        tankNumber: document.getElementById('tankNumber'),
        siloMotorRight: document.getElementById('siloMotorRight'),
        siloMotorRightTime: document.getElementById('siloMotorRightTime'),
        siloMotorLeft: document.getElementById('siloMotorLeft'),
        siloMotorLeftTime: document.getElementById('siloMotorLeftTime'),
        rotaryValve: document.getElementById('rotaryValve'),
        rotaryValveTime: document.getElementById('rotaryValveTime'),
        blower: document.getElementById('blower'),
        blowerTime: document.getElementById('blowerTime'),
        startLargeFeeder: document.getElementById('startLargeFeeder')
    };

    // ===================================
    // LocalStorage Helper Functions
    // ===================================

    /**
     * Save time offset to localStorage
     * @param {number} offset - Time offset in milliseconds
     */
    function saveTimeOffset(offset) {
        try {
            localStorage.setItem(STORAGE_KEYS.TIME_OFFSET, offset.toString());
            console.log('Time offset saved to localStorage:', offset, 'ms');
        } catch (error) {
            console.error('Failed to save time offset to localStorage:', error);
        }
    }

    /**
     * Load time offset from localStorage
     * @returns {number} - Time offset in milliseconds, or 0 if not found
     */
    function loadTimeOffset() {
        try {
            const savedOffset = localStorage.getItem(STORAGE_KEYS.TIME_OFFSET);
            if (savedOffset !== null) {
                const offset = parseInt(savedOffset, 10);
                if (!isNaN(offset)) {
                    console.log('Time offset loaded from localStorage:', offset, 'ms');
                    return offset;
                }
            }
        } catch (error) {
            console.error('Failed to load time offset from localStorage:', error);
        }
        return 0;
    }

    /**
     * Clear time offset from localStorage
     */
    function clearTimeOffset() {
        try {
            localStorage.removeItem(STORAGE_KEYS.TIME_OFFSET);
            console.log('Time offset cleared from localStorage');
        } catch (error) {
            console.error('Failed to clear time offset from localStorage:', error);
        }
    }

    /**
     * Save panel collapse state to localStorage
     * @param {string} panelId - Panel identifier
     * @param {boolean} isCollapsed - Collapse state
     */
    function savePanelCollapseState(panelId, isCollapsed) {
        try {
            const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.PANEL_COLLAPSE_STATE) || '{}');
            state[panelId] = isCollapsed;
            localStorage.setItem(STORAGE_KEYS.PANEL_COLLAPSE_STATE, JSON.stringify(state));
        } catch (error) {
            console.error('Failed to save panel collapse state:', error);
        }
    }

    /**
     * Load panel collapse state from localStorage
     * @param {string} panelId - Panel identifier
     * @returns {boolean} - Collapse state, or false if not found
     */
    function loadPanelCollapseState(panelId) {
        try {
            const state = JSON.parse(localStorage.getItem(STORAGE_KEYS.PANEL_COLLAPSE_STATE) || '{}');
            return state[panelId] === true;
        } catch (error) {
            console.error('Failed to load panel collapse state:', error);
            return false;
        }
    }

    // ===================================
    // Collapsible Panel Functions
    // ===================================

    // Mobile breakpoint (768px) - collapsible panels only work on mobile
    const MOBILE_BREAKPOINT = 768;

    /**
     * Check if current screen size is mobile
     * @returns {boolean} - True if mobile (<768px), false if desktop (≥768px)
     */
    function isMobileScreen() {
        return window.innerWidth < MOBILE_BREAKPOINT;
    }

    /**
     * Initialize collapsible panels
     * Only enables collapsible behavior on mobile screens (<768px)
     */
    function initCollapsiblePanels() {
        const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

        collapsibleHeaders.forEach(header => {
            const panelId = header.getAttribute('data-panel');
            if (!panelId) return;

            // Only restore collapse state on mobile
            if (isMobileScreen()) {
                const isCollapsed = loadPanelCollapseState(panelId);
                if (isCollapsed) {
                    togglePanelCollapse(header, true);
                }
            } else {
                // On desktop, ensure panels are always expanded
                ensurePanelExpanded(header);
            }

            // Add click event listener
            header.addEventListener('click', () => {
                // Only allow collapse/expand on mobile
                if (isMobileScreen()) {
                    togglePanelCollapse(header);
                }
            });
        });

        // Add resize event listener to handle screen size changes
        window.addEventListener('resize', handleScreenResize);
    }

    /**
     * Handle screen resize events
     * Ensures panels are expanded when switching from mobile to desktop
     */
    function handleScreenResize() {
        if (!isMobileScreen()) {
            // On desktop, ensure all panels are expanded
            const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
            collapsibleHeaders.forEach(header => {
                ensurePanelExpanded(header);
            });
        }
    }

    /**
     * Ensure panel is expanded (remove collapsed state)
     * @param {HTMLElement} header - Panel header element
     */
    function ensurePanelExpanded(header) {
        const panelId = header.getAttribute('data-panel');
        if (!panelId) return;

        // Remove collapsed class from header
        header.classList.remove('collapsed');

        // Remove collapsed class from all content elements
        const contentElements = document.querySelectorAll(`[data-panel-content="${panelId}"]`);
        contentElements.forEach(el => el.classList.remove('collapsed'));
    }

    /**
     * Toggle panel collapse state
     * @param {HTMLElement} header - Panel header element
     * @param {boolean} forceCollapse - Force collapse state (optional)
     */
    function togglePanelCollapse(header, forceCollapse) {
        const panelId = header.getAttribute('data-panel');
        if (!panelId) return;

        const isCurrentlyCollapsed = header.classList.contains('collapsed');
        const shouldCollapse = forceCollapse !== undefined ? forceCollapse : !isCurrentlyCollapsed;

        // Find all content elements for this panel
        const contentElements = document.querySelectorAll(`[data-panel-content="${panelId}"]`);

        if (shouldCollapse) {
            header.classList.add('collapsed');
            contentElements.forEach(el => el.classList.add('collapsed'));
        } else {
            header.classList.remove('collapsed');
            contentElements.forEach(el => el.classList.remove('collapsed'));
        }

        // Only save state to localStorage on mobile
        if (isMobileScreen()) {
            savePanelCollapseState(panelId, shouldCollapse);
        }
    }

    // ===================================
    // Initialization
    // ===================================
    function init() {
        console.log('Dashboard initializing...');

        // Populate time selectors
        populateTimeSelectors();

        // Set up event listeners
        setupEventListeners();

        // Initialize collapsible panels
        initCollapsiblePanels();

        // Restore saved time offset from localStorage
        const savedOffset = loadTimeOffset();
        if (savedOffset !== 0) {
            state.timeOffset = savedOffset;
            console.log('Restored time offset:', savedOffset, 'ms');
            showNotification('이전 설정 시간이 복원되었습니다', 'info');
        }

        // Initialize SSE connection for real-time status updates
        initSSE();

        // Update system time display (every second)
        updateSystemTime();
        setInterval(updateSystemTime, 1000);

        // Load and display schedules in right panel
        loadAndDisplaySchedules();

        // Load and display operation logs
        loadOperationLogs();

        console.log('Dashboard initialized');
    }

    // ===================================
    // Tab Navigation
    // ===================================
    function setupEventListeners() {
        // Tab navigation
        elements.tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tabName = btn.dataset.tab;
                switchTab(tabName);
            });
        });

        // Day of week checkboxes (will be initialized after UI is created)
        initializeDayCheckboxes();

        // Add time button
        if (elements.addTimeBtn) {
            elements.addTimeBtn.addEventListener('click', addFeedingTime);
        }

        // RTC controls
        if (elements.setTimeBtn) {
            elements.setTimeBtn.addEventListener('click', setManualTime);
        }
        // Sync button removed from UI - keeping function for potential future use
        // if (elements.saveTimeBtn) {
        //     elements.saveTimeBtn.addEventListener('click', syncTimeToBoard);
        // }
        if (elements.resetTimeBtn) {
            elements.resetTimeBtn.addEventListener('click', resetTimeOffset);
        }

        // Time input validation and formatting
        if (elements.timeHours) {
            elements.timeHours.addEventListener('focus', () => enableManualTimeInput());
            elements.timeHours.addEventListener('blur', () => formatTimeInput(elements.timeHours, 23));
            elements.timeHours.addEventListener('input', () => {
                validateTimeInput(elements.timeHours, 23);
                enableManualTimeInput();
            });
        }
        if (elements.timeMinutes) {
            elements.timeMinutes.addEventListener('focus', () => enableManualTimeInput());
            elements.timeMinutes.addEventListener('blur', () => formatTimeInput(elements.timeMinutes, 59));
            elements.timeMinutes.addEventListener('input', () => {
                validateTimeInput(elements.timeMinutes, 59);
                enableManualTimeInput();
            });
        }
        if (elements.timeSeconds) {
            elements.timeSeconds.addEventListener('focus', () => enableManualTimeInput());
            elements.timeSeconds.addEventListener('blur', () => formatTimeInput(elements.timeSeconds, 59));
            elements.timeSeconds.addEventListener('input', () => {
                validateTimeInput(elements.timeSeconds, 59);
                enableManualTimeInput();
            });
        }

        // Tank selection (multiple checkboxes)
        document.querySelectorAll('.tank-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const outlet = parseInt(e.target.value);
                if (e.target.checked) {
                    if (!state.selectedTanks.includes(outlet)) {
                        state.selectedTanks.push(outlet);
                    }
                } else {
                    state.selectedTanks = state.selectedTanks.filter(t => t !== outlet);
                }
                state.selectedTanks.sort(); // Keep sorted
                console.log('Selected tanks:', state.selectedTanks);
                renderMotorInputs();
            });
        });

        // Schedule save button
        if (elements.saveScheduleBtn) {
            elements.saveScheduleBtn.addEventListener('click', saveAndApplySchedule);
        }

        // Large feeder start button
        if (elements.startLargeFeeder) {
            elements.startLargeFeeder.addEventListener('click', startLargeFeeder);
        }

        // Large feeder emergency stop button
        const stopLargeFeederBtn = document.getElementById('stopLargeFeeder');
        if (stopLargeFeederBtn) {
            stopLargeFeederBtn.addEventListener('click', stopLargeFeeder);
        }
    }

    function switchTab(tabName) {
        // Update state
        state.currentTab = tabName;

        // Update tab buttons
        elements.tabButtons.forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update tab contents
        elements.tabContents.forEach(content => {
            if (content.id === `tab-${tabName}`) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });

        console.log('Switched to tab:', tabName);
    }

    // ===================================
    // Per-Tank Motor Inputs
    // ===================================

    /**
     * Read motor values for a specific UI outlet (0-3) from dynamic inputs
     */
    function getMotorValues(uiOutlet) {
        const feedMotor = parseInt(document.getElementById(`upperMotor-${uiOutlet}`)?.value || 5);
        const scatterMotor = parseInt(document.getElementById(`lowerMotor-${uiOutlet}`)?.value || 3);
        return { feedMotor, scatterMotor };
    }

    /**
     * Render per-tank motor input groups based on state.selectedTanks
     * Always resets to default values (상위 5, 하위 3)
     */
    function renderMotorInputs() {
        const container = document.getElementById('motorInputsContainer');
        if (!container) return;

        container.innerHTML = '';

        if (state.selectedTanks.length === 0) {
            container.innerHTML = '<p class="placeholder-text">수조를 선택하면 모터 설정이 표시됩니다</p>';
            return;
        }

        state.selectedTanks.forEach(uiOutlet => {
            const tankNum = uiOutlet + 1;
            const saved = state.tankMotorValues[uiOutlet] || { feedMotor: 5, scatterMotor: 3 };
            const row = document.createElement('div');
            row.className = 'control-row';
            row.dataset.tankOutlet = uiOutlet;
            row.innerHTML = `
                <div class="control-group">
                    <label class="control-label">${tankNum}번 수조 상위 모터</label>
                    <input type="number" class="input-field" id="upperMotor-${uiOutlet}" min="1" max="10" value="${saved.feedMotor}">
                    <span class="input-hint">1-10</span>
                </div>
                <div class="control-group">
                    <label class="control-label">${tankNum}번 수조 하위 모터</label>
                    <input type="number" class="input-field" id="lowerMotor-${uiOutlet}" min="1" max="10" value="${saved.scatterMotor}">
                    <span class="input-hint">1-10</span>
                </div>
            `;
            row.querySelector(`#upperMotor-${uiOutlet}`).addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value < 1 || value > 10) {
                    alert('상위 모터 회전수는 1-10 범위여야 합니다');
                    e.target.value = Math.max(1, Math.min(10, value));
                }
                if (!state.tankMotorValues[uiOutlet]) state.tankMotorValues[uiOutlet] = { feedMotor: 5, scatterMotor: 3 };
                state.tankMotorValues[uiOutlet].feedMotor = parseInt(e.target.value);
            });
            row.querySelector(`#lowerMotor-${uiOutlet}`).addEventListener('change', (e) => {
                const value = parseInt(e.target.value);
                if (value < 1 || value > 10) {
                    alert('하위 모터 회전수는 1-10 범위여야 합니다');
                    e.target.value = Math.max(1, Math.min(10, value));
                }
                if (!state.tankMotorValues[uiOutlet]) state.tankMotorValues[uiOutlet] = { feedMotor: 5, scatterMotor: 3 };
                state.tankMotorValues[uiOutlet].scatterMotor = parseInt(e.target.value);
            });
            container.appendChild(row);
        });
    }

    // ===================================
    // Time Picker
    // ===================================
    function populateTimeSelectors() {
        // Populate hours (0-23)
        if (elements.feedingHour) {
            for (let i = 0; i < 24; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = String(i).padStart(2, '0');
                elements.feedingHour.appendChild(option);
            }
        }

        // Populate minutes (0-59)
        if (elements.feedingMinute) {
            for (let i = 0; i < 60; i++) {
                const option = document.createElement('option');
                option.value = i;
                option.textContent = String(i).padStart(2, '0');
                elements.feedingMinute.appendChild(option);
            }
        }
    }

    function addFeedingTime() {
        const hour = elements.feedingHour.value;
        const minute = elements.feedingMinute.value;

        if (!hour || !minute) {
            alert('시간과 분을 선택하세요');
            return;
        }

        const timeString = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        // Check for duplicates
        if (state.feedingTimes.includes(timeString)) {
            alert('이미 추가된 시간입니다');
            return;
        }

        // Add to state
        state.feedingTimes.push(timeString);
        state.feedingTimes.sort();

        // Update display
        renderScheduleList();

        // Reset selectors
        elements.feedingHour.value = '';
        elements.feedingMinute.value = '';

        console.log('Added feeding time:', timeString);
    }

    function removeFeedingTime(timeString) {
        state.feedingTimes = state.feedingTimes.filter(t => t !== timeString);
        renderScheduleList();
        console.log('Removed feeding time:', timeString);
    }

    function renderScheduleList() {
        if (!elements.scheduleList) return;

        if (state.feedingTimes.length === 0) {
            elements.scheduleList.innerHTML = '<span class="placeholder-text">시간을 추가하세요</span>';
            return;
        }

        elements.scheduleList.innerHTML = state.feedingTimes.map(time => `
            <div class="schedule-item">
                <span class="schedule-item-time">${time}</span>
                <button class="schedule-item-remove" onclick="window.dashboardApp.removeFeedingTime('${time}')">×</button>
            </div>
        `).join('');
    }

    // ===================================
    // Interval & Next Execution Management
    // ===================================

    // ===================================
    // Day of Week Selection Functions
    // ===================================

    /**
     * Initialize day of week checkboxes
     */
    function initializeDayCheckboxes() {
        elements.dayCheckboxes = document.querySelectorAll('.day-checkbox');

        console.log('Initializing day checkboxes, found:', elements.dayCheckboxes.length);

        if (elements.dayCheckboxes && elements.dayCheckboxes.length > 0) {
            elements.dayCheckboxes.forEach((checkbox, index) => {
                checkbox.addEventListener('change', () => {
                    state.selectedDayOfWeek[index] = checkbox.checked ? 1 : 0;
                    console.log('Day of week updated:', state.selectedDayOfWeek);
                });

                // Initialize checkbox state from state
                checkbox.checked = state.selectedDayOfWeek[index] === 1;
            });
            console.log('Day checkboxes initialized successfully');
        } else {
            console.warn('No day checkboxes found! Make sure .day-checkbox elements exist in the DOM');
        }
    }

    /**
     * Get day names string from DAY_OF_WEEK array
     * Returns: "매일", "평일", "주말", or "월 수 금" etc.
     */
    function getDayNamesString(dayOfWeek) {
        if (!Array.isArray(dayOfWeek) || dayOfWeek.length !== 7) {
            return '';
        }

        // Check if all days are selected
        if (dayOfWeek.every(d => d === 1)) {
            return '매일';
        }

        // Check if weekdays only (Mon-Fri)
        if (dayOfWeek[0] === 1 && dayOfWeek[1] === 1 && dayOfWeek[2] === 1 &&
            dayOfWeek[3] === 1 && dayOfWeek[4] === 1 && dayOfWeek[5] === 0 && dayOfWeek[6] === 0) {
            return '평일';
        }

        // Check if weekends only (Sat-Sun)
        if (dayOfWeek[0] === 0 && dayOfWeek[1] === 0 && dayOfWeek[2] === 0 &&
            dayOfWeek[3] === 0 && dayOfWeek[4] === 0 && dayOfWeek[5] === 1 && dayOfWeek[6] === 1) {
            return '주말';
        }

        // Build custom day string (e.g., "월 수 금")
        const selectedDays = [];
        dayOfWeek.forEach((enabled, index) => {
            if (enabled === 1) {
                selectedDays.push(DAY_NAMES_KR[index]);
            }
        });

        return selectedDays.join(' ');
    }

    /**
     * Quick select all days
     */
    function selectAllDays() {
        state.selectedDayOfWeek = [1, 1, 1, 1, 1, 1, 1];
        updateDayCheckboxes();
    }

    /**
     * Quick select weekdays only
     */
    function selectWeekdays() {
        state.selectedDayOfWeek = [1, 1, 1, 1, 1, 0, 0];
        updateDayCheckboxes();
    }

    /**
     * Quick select weekends only
     */
    function selectWeekends() {
        state.selectedDayOfWeek = [0, 0, 0, 0, 0, 1, 1];
        updateDayCheckboxes();
    }

    /**
     * Update checkbox states from state
     */
    function updateDayCheckboxes() {
        if (elements.dayCheckboxes) {
            elements.dayCheckboxes.forEach((checkbox, index) => {
                checkbox.checked = state.selectedDayOfWeek[index] === 1;
            });
        }
    }

    // ===================================
    // RTC Time Management
    // ===================================

    /**
     * Update system time display (runs every second)
     * Populates the time input fields with current time
     * Skips update if user is manually editing the time
     * Applies time offset if virtual clock is active
     */
    function updateSystemTime() {
        const now = new Date();

        // Apply time offset if set (for virtual clock)
        const displayTime = state.timeOffset !== 0
            ? new Date(now.getTime() + state.timeOffset)
            : now;

        state.systemTime = displayTime;

        // Skip auto-update if user is manually editing time
        if (state.isManualTimeInput) {
            return;
        }

        // Update input fields with display time (current time + offset)
        if (elements.timeHours) {
            elements.timeHours.value = String(displayTime.getHours()).padStart(2, '0');
        }
        if (elements.timeMinutes) {
            elements.timeMinutes.value = String(displayTime.getMinutes()).padStart(2, '0');
        }
        if (elements.timeSeconds) {
            elements.timeSeconds.value = String(displayTime.getSeconds()).padStart(2, '0');
        }

        // Remove manual input styling when auto-updating
        removeManualTimeInputStyling();
    }

    /**
     * Enable manual time input mode
     * Prevents auto-update and adds visual indicator
     */
    function enableManualTimeInput() {
        state.isManualTimeInput = true;

        // Clear any existing timeout
        if (state.manualTimeTimeout) {
            clearTimeout(state.manualTimeTimeout);
        }

        // Add visual indicator to time inputs
        if (elements.timeHours) elements.timeHours.classList.add('manual-input');
        if (elements.timeMinutes) elements.timeMinutes.classList.add('manual-input');
        if (elements.timeSeconds) elements.timeSeconds.classList.add('manual-input');

        // Reset to auto-update after 60 seconds of inactivity
        state.manualTimeTimeout = setTimeout(() => {
            disableManualTimeInput();
        }, 60000); // 60 seconds
    }

    /**
     * Disable manual time input mode
     * Resumes auto-update
     */
    function disableManualTimeInput() {
        state.isManualTimeInput = false;

        // Clear timeout
        if (state.manualTimeTimeout) {
            clearTimeout(state.manualTimeTimeout);
            state.manualTimeTimeout = null;
        }

        // Remove visual indicator
        removeManualTimeInputStyling();
    }

    /**
     * Remove manual input styling from time inputs
     */
    function removeManualTimeInputStyling() {
        if (elements.timeHours) elements.timeHours.classList.remove('manual-input');
        if (elements.timeMinutes) elements.timeMinutes.classList.remove('manual-input');
        if (elements.timeSeconds) elements.timeSeconds.classList.remove('manual-input');
    }

    /**
     * Validate time input value
     */
    function validateTimeInput(input, max) {
        let value = parseInt(input.value);
        if (isNaN(value) || value < 0) {
            input.value = '';
        } else if (value > max) {
            input.value = max;
        }
    }

    /**
     * Format time input with leading zero
     */
    function formatTimeInput(input, max) {
        let value = parseInt(input.value);
        if (isNaN(value) || value < 0) {
            value = 0;
        } else if (value > max) {
            value = max;
        }
        input.value = String(value).padStart(2, '0');
    }

    /**
     * Set manual time from input fields
     * Creates a virtual clock that continues ticking from the manually set time
     * Also syncs time to server (Linux system time) and IoT device RTC via MQTT
     */
    async function setManualTime() {
        if (!elements.setTimeBtn) return;

        // Get values from input fields
        const hours = parseInt(elements.timeHours?.value || 0);
        const minutes = parseInt(elements.timeMinutes?.value || 0);
        const seconds = parseInt(elements.timeSeconds?.value || 0);

        // Validate values
        if (hours < 0 || hours > 23) {
            alert('시간은 0-23 사이의 값이어야 합니다');
            return;
        }
        if (minutes < 0 || minutes > 59) {
            alert('분은 0-59 사이의 값이어야 합니다');
            return;
        }
        if (seconds < 0 || seconds > 59) {
            alert('초는 0-59 사이의 값이어야 합니다');
            return;
        }

        // Create a new Date object with the manual time
        const now = new Date();
        const manualTime = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            hours,
            minutes,
            seconds
        );

        // Calculate time offset (manual time - actual current time)
        // This creates a "virtual clock" that ticks forward from the manual time
        state.timeOffset = manualTime.getTime() - now.getTime();

        // Save time offset to localStorage for persistence across page refreshes
        saveTimeOffset(state.timeOffset);

        // Update state
        state.systemTime = manualTime;

        // Disable manual input mode to allow the virtual clock to tick
        disableManualTimeInput();

        // Show confirmation
        const timeString = manualTime.toLocaleTimeString('ko-KR', { hour12: false });
        showNotification(`시간이 ${timeString}로 설정되었습니다 (서버 동기화 중...)`, 'success');

        // Provide visual feedback
        elements.setTimeBtn.textContent = '✓';
        elements.setTimeBtn.disabled = true;

        console.log('Manual time set:', manualTime, 'Offset:', state.timeOffset, 'ms');

        // Sync time to server (Linux system time) and IoT device RTC via MQTT
        try {
            const timeData = {
                timestamp: Math.floor(manualTime.getTime() / 1000),
                year: manualTime.getFullYear(),
                month: manualTime.getMonth() + 1,
                day: manualTime.getDate(),
                hour: manualTime.getHours(),
                minute: manualTime.getMinutes(),
                second: manualTime.getSeconds()
            };

            console.log('Syncing time to server and IoT device:', timeData);

            const response = await fetch('/api/rtc/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(timeData)
            });

            const result = await response.json();

            if (result.success) {
                console.log('✅ Time sync successful:', result);

                // Show detailed success message
                let successMsg = `시간 동기화 완료: ${timeString}`;
                if (result.systemTime) {
                    if (result.systemTime.success) {
                        successMsg += ' (Linux 시스템 시간 변경됨)';
                    } else if (result.systemTime.skipped) {
                        successMsg += ' (MQTT만 전송됨)';
                    }
                }
                showNotification(successMsg, 'success');

                // Update button state
                elements.setTimeBtn.textContent = '완료!';
                setTimeout(() => {
                    elements.setTimeBtn.textContent = '시간 설정';
                    elements.setTimeBtn.disabled = false;
                }, 2000);
            } else {
                throw new Error(result.error || 'Server sync failed');
            }
        } catch (err) {
            console.error('❌ Failed to sync time to server:', err);
            showNotification(`시간 설정됨 (서버 동기화 실패: ${err.message})`, 'warning');

            // Still enable button even if server sync failed
            setTimeout(() => {
                elements.setTimeBtn.textContent = '시간 설정';
                elements.setTimeBtn.disabled = false;
            }, 1500);
        }
    }

    /**
     * Reset time offset to show actual current time
     * Clears the virtual clock and returns to real-time display
     * Also syncs current actual time to server (Linux system time) and IoT device RTC via MQTT
     */
    async function resetTimeOffset() {
        if (!elements.resetTimeBtn) return;

        // Get current actual system time (not the virtual time with offset)
        const currentTime = new Date();

        // Clear time offset
        state.timeOffset = 0;
        clearTimeOffset(); // Clear from localStorage
        disableManualTimeInput();

        // Show confirmation
        const timeString = currentTime.toLocaleTimeString('ko-KR', { hour12: false });
        showNotification(`시간 초기화 중: ${timeString} (서버 동기화 중...)`, 'success');

        // Provide visual feedback
        elements.resetTimeBtn.textContent = '✓';
        elements.resetTimeBtn.disabled = true;

        console.log('Time offset reset to 0, syncing current time to server:', currentTime);

        // Sync current actual time to server (Linux system time) and IoT device RTC via MQTT
        try {
            const timeData = {
                timestamp: Math.floor(currentTime.getTime() / 1000),
                year: currentTime.getFullYear(),
                month: currentTime.getMonth() + 1,
                day: currentTime.getDate(),
                hour: currentTime.getHours(),
                minute: currentTime.getMinutes(),
                second: currentTime.getSeconds()
            };

            console.log('Syncing current actual time to server and IoT device:', timeData);

            const response = await fetch('/api/rtc/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(timeData)
            });

            const result = await response.json();

            if (result.success) {
                console.log('✅ Time reset and sync successful:', result);

                // Show detailed success message
                let successMsg = `시간 초기화 완료: ${timeString}`;
                if (result.systemTime) {
                    if (result.systemTime.success) {
                        successMsg += ' (Linux 시스템 시간 동기화됨)';
                    } else if (result.systemTime.skipped) {
                        successMsg += ' (MQTT만 전송됨)';
                    }
                }
                showNotification(successMsg, 'success');

                // Update button state
                elements.resetTimeBtn.textContent = '완료!';
                setTimeout(() => {
                    elements.resetTimeBtn.textContent = '↻';
                    elements.resetTimeBtn.disabled = false;
                }, 2000);
            } else {
                throw new Error(result.error || 'Server sync failed');
            }
        } catch (err) {
            console.error('❌ Failed to sync reset time to server:', err);
            showNotification(`시간 초기화됨 (서버 동기화 실패: ${err.message})`, 'warning');

            // Still enable button even if server sync failed
            setTimeout(() => {
                elements.resetTimeBtn.textContent = '↻';
                elements.resetTimeBtn.disabled = false;
            }, 1500);
        }
    }

    /**
     * Fetch board RTC time from server via MQTT
     * DISABLED - Not needed for simplified UI
     */
    /*
    async function fetchBoardTime() {
        if (!elements.fetchTimeBtn) return;

        // Update button state
        elements.fetchTimeBtn.disabled = true;
        elements.fetchTimeBtn.textContent = '확인 중...';

        try {
            const response = await fetch('/api/rtc/board');
            const result = await response.json();

            if (result.success) {
                console.log('Board time fetched:', result.data);
                updateBoardTimeDisplay(result.data);
                updateSyncStatus('success', '확인됨');
                showNotification('보드 시간을 확인했습니다', 'success');
            } else {
                throw new Error(result.error || 'Failed to fetch board time');
            }
        } catch (err) {
            console.error('Failed to fetch board time:', err);
            showNotification('보드 시간 확인 실패: ' + err.message, 'error');
            updateSyncStatus('error', '확인 실패');
        } finally {
            elements.fetchTimeBtn.disabled = false;
            elements.fetchTimeBtn.textContent = '보드 시간 확인';
        }
    }
    */

    /**
     * Sync system time to board RTC via MQTT
     * Shows confirmation dialog with the exact time that will be sent
     * Uses manual time from input fields if available, otherwise uses current system time
     */
    async function syncTimeToBoard() {
        if (!elements.saveTimeBtn) return;

        // Get time from input fields or use current time
        let timeToSync;
        const hours = parseInt(elements.timeHours?.value || -1);
        const minutes = parseInt(elements.timeMinutes?.value || -1);
        const seconds = parseInt(elements.timeSeconds?.value || -1);

        // Check if manual time is set (all fields have valid values)
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59) {
            // Use manual time from input fields
            const now = new Date();
            timeToSync = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate(),
                hours,
                minutes,
                seconds
            );
        } else {
            // Use current system time
            timeToSync = new Date();
        }

        // Format time for confirmation dialog
        const dateString = timeToSync.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
        const timeString = timeToSync.toLocaleTimeString('ko-KR', { hour12: false });

        // Show confirmation dialog with exact time
        const confirmMessage = `다음 시간으로 보드 RTC를 동기화하시겠습니까?\n\n` +
            `날짜: ${dateString}\n` +
            `시간: ${timeString}`;

        if (!confirm(confirmMessage)) {
            return; // User cancelled
        }

        // Update button state
        elements.saveTimeBtn.disabled = true;
        elements.saveTimeBtn.textContent = '동기화 중...';

        const timeData = {
            timestamp: Math.floor(timeToSync.getTime() / 1000),
            year: timeToSync.getFullYear(),
            month: timeToSync.getMonth() + 1,
            day: timeToSync.getDate(),
            hour: timeToSync.getHours(),
            minute: timeToSync.getMinutes(),
            second: timeToSync.getSeconds()
        };

        try {
            const response = await fetch('/api/rtc/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(timeData)
            });
            const result = await response.json();

            if (result.success) {
                console.log('Time synced to board:', result.data);
                state.lastSyncTime = timeToSync;
                showNotification('시간 동기화 완료', 'success');

                // Clear time offset and disable manual input mode
                state.timeOffset = 0;
                clearTimeOffset(); // Clear from localStorage
                disableManualTimeInput();

                // Briefly show success state
                elements.saveTimeBtn.textContent = '완료!';
                setTimeout(() => {
                    elements.saveTimeBtn.textContent = '시간 동기화';
                }, 2000);
            } else {
                throw new Error(result.error || 'Failed to sync time');
            }
        } catch (err) {
            console.error('Failed to sync time:', err);
            showNotification('시간 동기화 실패: ' + err.message, 'error');
        } finally {
            elements.saveTimeBtn.disabled = false;
        }
    }

    /**
     * Update board time display
     * DISABLED - Not needed for simplified UI
     */
    /*
    function updateBoardTimeDisplay(timeData) {
        if (!timeData) return;

        // Create Date object from time data
        const boardDate = new Date(
            timeData.year,
            timeData.month - 1,
            timeData.day,
            timeData.hour,
            timeData.minute,
            timeData.second
        );

        state.boardTime = boardDate;

        const timeString = boardDate.toLocaleTimeString('ko-KR', { hour12: false });
        if (elements.boardTime) {
            elements.boardTime.textContent = timeString;
        }
    }
    */

    /**
     * Update sync status indicator
     * DISABLED - Not needed for simplified UI
     */
    /*
    function updateSyncStatus(status = null, text = null) {
        if (!elements.syncIndicator || !elements.syncText) return;

        // Remove all status classes
        elements.syncIndicator.classList.remove('synced', 'minor-drift', 'major-drift');

        if (status === 'error') {
            elements.syncText.textContent = text || '오류';
            return;
        }

        if (status === 'success') {
            elements.syncIndicator.classList.add('synced');
            elements.syncText.textContent = text || '확인됨';
            return;
        }

        // Default state
        elements.syncText.textContent = text || '미확인';
    }
    */

    /**
     * Show notification to user
     */
    function showNotification(message, type = 'info') {
        // Simple alert for now - can be replaced with toast notification
        console.log(`[${type.toUpperCase()}] ${message}`);
        // TODO: Implement toast notification UI
    }

    // ===================================
    // Server-Sent Events (SSE) Connection
    // ===================================
    // NOTE: Browser does NOT connect to MQTT directly!
    // Architecture: Browser ↔ Server (HTTP/SSE) ↔ MQTT Broker (TCP)
    let sseEventSource = null;

    function initSSE() {
        console.log('Initializing SSE connection for real-time status updates');

        try {
            sseEventSource = new EventSource('/api/status-stream');

            sseEventSource.onopen = () => {
                console.log('✅ SSE connected to server');
                state.sseConnected = true;
            };

            sseEventSource.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    console.log('📨 SSE message received:', msg);

                    // Handle different message types
                    if (msg.type === 'log') {
                        // New log entry
                        addLogEntry(msg.log);
                    } else {
                        // Status update
                        updateFeederStatus(msg);
                    }
                } catch (err) {
                    console.error('❌ Failed to parse SSE message:', err);
                }
            };

            sseEventSource.onerror = (err) => {
                console.error('❌ SSE connection error:', err);
                state.sseConnected = false;

                // Attempt to reconnect after 5 seconds
                setTimeout(() => {
                    console.log('🔄 Attempting to reconnect SSE...');
                    if (sseEventSource) {
                        sseEventSource.close();
                    }
                    initSSE();
                }, 5000);
            };
        } catch (err) {
            console.error('❌ SSE initialization failed:', err);
        }
    }

    /**
     * Check if all large feeder devices have completed (all timeout 1 dots are active)
     * @returns {boolean} True if all 4 devices have their timeout 1 dots active
     */
    function areAllDevicesComplete() {
        for (let actId = 1; actId <= 4; actId++) {
            const completeDotId = `large-status-${actId}-1`;
            const completeDotEl = document.getElementById(completeDotId);
            if (!completeDotEl || !completeDotEl.classList.contains('active')) {
                return false; // At least one device is not complete
            }
        }
        return true; // All devices are complete
    }

    function updateFeederStatus(msg) {
        // Update status indicators based on cmd field to distinguish devices
        const cmd = msg.cmd;
        const timeout = parseInt(msg.timeout, 10);

        // CMD to device mapping
        // Selector: "0" (start only, timeout 0)
        // Silo Right: "q" (start), "w" (stop)
        // Silo Left: "a" (start), "s" (stop)
        // Rotary Valve: "n" (start), "m" (stop)
        // Blower: "g" (start), "f" (stop)
        const cmdMapping = {
            '0': { type: 'selector', actId: null, name: '셀렉터' },
            'q': { type: 'device', actId: 1, name: '사일로(우)', action: 'start' },
            'w': { type: 'device', actId: 1, name: '사일로(우)', action: 'stop' },
            'a': { type: 'device', actId: 2, name: '사일로(좌)', action: 'start' },
            's': { type: 'device', actId: 2, name: '사일로(좌)', action: 'stop' },
            'n': { type: 'device', actId: 3, name: '로터리 밸브', action: 'start' },
            'm': { type: 'device', actId: 3, name: '로터리 밸브', action: 'stop' },
            'g': { type: 'device', actId: 4, name: '블로워', action: 'start' },
            'f': { type: 'device', actId: 4, name: '블로워', action: 'stop' }
        };

        const deviceInfo = cmdMapping[cmd];
        if (!deviceInfo) {
            return; // Unknown cmd, ignore
        }

        // Handle selector (tank selection) notification and status dot
        if (deviceInfo.type === 'selector') {
            const tankNumberInput = document.getElementById('tankNumber');
            if (tankNumberInput) {
                const tankNumber = tankNumberInput.value || '?';
                showTankSelectionNotification(tankNumber);
            }

            // Only respond to timeout 0 (selector start)
            // Selector dot stays lit until all devices are complete
            if (timeout === 0) {
                const selectorDot = document.getElementById('large-status-selector-0');
                if (selectorDot) {
                    selectorDot.classList.add('active');
                }
            }
            // Ignore timeout 1 for selector - dot remains lit
            return;
        }

        // Handle device status updates (large feeder only)
        if (deviceInfo.type === 'device') {
            const deviceActId = deviceInfo.actId;

            // Update large feeder device status dots (left panel)
            // Small feeder status indicators are updated by schedule-based mechanism
            if (timeout === 0 || timeout === 1) {
                const dotId = `large-status-${deviceActId}-${timeout}`;
                const dotEl = document.getElementById(dotId);
                if (dotEl) {
                    dotEl.classList.add('active');

                    // If this is timeout 1 (complete), remove active from timeout 0 (running)
                    if (timeout === 1) {
                        const runningDotId = `large-status-${deviceActId}-0`;
                        const runningDotEl = document.getElementById(runningDotId);
                        if (runningDotEl) {
                            runningDotEl.classList.remove('active');
                        }

                        // Check if all devices are now complete
                        // If so, turn off the selector dot
                        if (areAllDevicesComplete()) {
                            const selectorDot = document.getElementById('large-status-selector-0');
                            if (selectorDot) {
                                selectorDot.classList.remove('active');
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Update the persistent tank status indicator
     * @param {number|string} tankNumber - Tank number (1-4) or '-' for no selection
     */
    function updateTankStatusIndicator(tankNumber) {
        const indicator = document.getElementById('current-tank-indicator');
        if (!indicator) return;

        const numberSpan = indicator.querySelector('.tank-status-number');
        if (numberSpan) {
            numberSpan.textContent = tankNumber;
        }
    }

    /**
     * Show tank selection notification with subtle animation
     * Also updates the persistent tank status indicator
     * @param {number|string} tankNumber - Tank number to display
     */
    function showTankSelectionNotification(tankNumber) {
        const notification = document.getElementById('tank-selection-notification');
        if (!notification) return;

        const tankNumberSpan = notification.querySelector('.tank-number');
        if (tankNumberSpan) {
            tankNumberSpan.textContent = tankNumber;
        }

        // Update persistent tank status indicator
        updateTankStatusIndicator(tankNumber);

        // Show notification with animation
        notification.classList.add('active');

        // Auto-hide after 3 seconds
        setTimeout(() => {
            notification.classList.remove('active');
        }, 3000);
    }

    // ===================================
    // Schedule-Based Status Updates (Small Feeders)
    // ===================================

    // Track active feeding operations for each tank
    const activeFeedingOperations = {
        1: null, // { startTime, duration, timeoutId }
        2: null,
        3: null,
        4: null
    };

    // Schedule cache for performance optimization
    let scheduleCache = {
        data: null,
        lastFetch: 0,
        CACHE_DURATION: 60000 // Refresh cache every 60 seconds
    };

    // Track triggered schedules to avoid duplicates (key: scheduleId-time)
    const triggeredSchedules = new Set();

    // Clean up triggered schedules older than 2 minutes
    setInterval(() => {
        const now = Date.now();
        const twoMinutesAgo = now - 120000;

        // Convert Set to Array, filter, and recreate Set
        const entries = Array.from(triggeredSchedules);
        triggeredSchedules.clear();
        entries.forEach(entry => {
            const [, timestamp] = entry.split('-');
            if (parseInt(timestamp) > twoMinutesAgo) {
                triggeredSchedules.add(entry);
            }
        });
    }, 120000); // Clean up every 2 minutes

    /**
     * Update small feeder status indicator
     * @param {number} tankNumber - Tank number (1-4)
     * @param {string} status - Status text ('대기', '작동 중', '완료')
     * @param {boolean} active - Whether to add active class
     */
    function updateSmallFeederStatus(tankNumber, status, active = false) {
        const statusEl = elements[`status${tankNumber}`];
        if (statusEl) {
            statusEl.textContent = status;
            statusEl.className = active ? 'status-indicator active' : 'status-indicator';
        }
    }

    /**
     * Start feeding operation for a tank (schedule-based)
     * @param {number} tankNumber - Tank number (1-4)
     * @param {number} duration - Feeding duration in seconds
     */
    function startScheduledFeeding(tankNumber, duration) {
        // Clear any existing operation for this tank
        if (activeFeedingOperations[tankNumber]) {
            clearTimeout(activeFeedingOperations[tankNumber].timeoutId);
        }

        // Update status to "작동 중"
        updateSmallFeederStatus(tankNumber, '작동 중', true);

        // Set timeout to update status to "완료" after duration
        const timeoutId = setTimeout(() => {
            updateSmallFeederStatus(tankNumber, '완료', false);
            activeFeedingOperations[tankNumber] = null;

            // Auto-reset to "대기" after 5 seconds
            setTimeout(() => {
                updateSmallFeederStatus(tankNumber, '대기', false);
            }, 5000);
        }, duration * 1000);

        // Track the operation
        activeFeedingOperations[tankNumber] = {
            startTime: Date.now(),
            duration: duration,
            timeoutId: timeoutId
        };
    }

    /**
     * Fetch and cache schedule data
     * Only fetches from server if cache is expired
     */
    async function fetchScheduleData() {
        const now = Date.now();

        // Return cached data if still valid
        if (scheduleCache.data && (now - scheduleCache.lastFetch) < scheduleCache.CACHE_DURATION) {
            return scheduleCache.data;
        }

        // Fetch fresh data
        try {
            const response = await fetch('/api/schedules');
            const result = await response.json();

            if (result.success && result.data && result.data.reservations) {
                scheduleCache.data = result.data.reservations;
                scheduleCache.lastFetch = now;
                return scheduleCache.data;
            }
        } catch (error) {
            console.error('Error fetching schedules:', error);
        }

        return scheduleCache.data || []; // Return cached data or empty array on error
    }

    /**
     * Check schedules and update status indicators
     * Optimized for 1-second interval with caching and duplicate prevention
     */
    async function checkSchedulesAndUpdateStatus() {
        try {
            // Get schedule data (from cache if available)
            const reservations = await fetchScheduleData();
            if (!reservations || reservations.length === 0) {
                return;
            }

            const now = new Date();
            const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

            // Use seconds-level precision for more accurate timing
            const currentHour = now.getHours();
            const currentMinute = now.getMinutes();
            const currentSecond = now.getSeconds();

            // Check each active reservation
            reservations.forEach(reservation => {
                // Skip if deleted or not scheduled for today
                if (reservation.DEL_YN === 'Y') return;
                if (!reservation.DAY_OF_WEEK || reservation.DAY_OF_WEEK[currentDay] !== 1) return;

                // Parse schedule time (ISO 8601 format)
                const scheduleDate = new Date(reservation.SCHEDULE_TIME);
                const scheduleHour = scheduleDate.getUTCHours();
                const scheduleMinute = scheduleDate.getUTCMinutes();

                // Check if current time matches schedule time (within 5-second window for reliability)
                // This allows for slight timing variations while preventing duplicate triggers
                const hourMatch = currentHour === scheduleHour;
                const minuteMatch = currentMinute === scheduleMinute;
                const secondMatch = currentSecond < 5; // Trigger within first 5 seconds of the minute

                if (hourMatch && minuteMatch && secondMatch) {
                    // Create unique key for this schedule trigger
                    const scheduleKey = `${reservation.SCHEDULE_ID}-${scheduleHour}:${scheduleMinute}`;

                    // Skip if already triggered
                    if (triggeredSchedules.has(scheduleKey)) {
                        return;
                    }

                    // Mark as triggered
                    triggeredSchedules.add(scheduleKey);

                    // Process feed_set to determine which tanks to activate
                    if (reservation.RESERVATION_DATA && reservation.RESERVATION_DATA.feed_set) {
                        reservation.RESERVATION_DATA.feed_set.forEach(feedConfig => {
                            if (feedConfig.active === 1) {
                                // Convert outlet (10-13) to tank number (1-4)
                                const tankNumber = feedConfig.outlet - 9; // 10→1, 11→2, 12→3, 13→4

                                if (tankNumber >= 1 && tankNumber <= 4) {
                                    // Convert time from 0.1s units to seconds
                                    const duration = feedConfig.time / 10;

                                    // Start feeding operation
                                    startScheduledFeeding(tankNumber, duration);
                                }
                            }
                        });
                    }
                }
            });
        } catch (error) {
            console.error('Error checking schedules:', error);
        }
    }

    // Start schedule checking interval (check every 1 second for precise timing)
    setInterval(checkSchedulesAndUpdateStatus, 1000);

    // Initial check on page load
    checkSchedulesAndUpdateStatus();

    // ===================================
    // Schedule Save/Load/Apply
    // ===================================

    /**
     * Convert UI values to reservation format with feed_motor and scatter_motor
     * Each selected tank gets its own feed_set entry
     */
    function convertToReservationFormat() {
        const operationDuration = parseInt(elements.operationDuration?.value || 60);

        // Validate that at least one tank is selected
        if (state.selectedTanks.length === 0) {
            throw new Error('최소 하나의 수조를 선택하세요');
        }

        // Create reservations array from feeding times
        const reservations = state.feedingTimes.map(timeString => {
            const feedSet = [];

            // Add feed_set entry for each selected tank with its own motor values
            // Convert UI outlet (0-3) to storage outlet (10-13) by adding OUTLET_OFFSET
            state.selectedTanks.forEach(uiOutlet => {
                const storageOutlet = uiOutlet + OUTLET_OFFSET; // 0→10, 1→11, 2→12, 3→13
                const { feedMotor, scatterMotor } = getMotorValues(uiOutlet);
                feedSet.push({
                    outlet: storageOutlet,  // Storage outlet number (10-13)
                    feed_motor: feedMotor,  // Upper motor PWM
                    scatter_motor: scatterMotor,  // Lower motor PWM
                    quantity: feedMotor * 100,  // PWM 5 → 500
                    time: operationDuration * 10,  // seconds → 0.1s units
                    active: 1
                });
            });

            return {
                scheduleTime: timeString,
                feedSet: feedSet
            };
        });

        return reservations;
    }

    /**
     * Convert UI values to feedSet format with feed_motor and scatter_motor
     * Each selected tank gets its own feed_set entry
     */
    function convertToFeedSetFormat() {
        const operationDuration = parseInt(elements.operationDuration?.value || 60);

        // Validate that at least one tank is selected
        if (state.selectedTanks.length === 0) {
            throw new Error('최소 하나의 수조를 선택하세요');
        }

        const feedSet = [];

        // Add feed_set entry for each selected tank with its own motor values
        // Convert UI outlet (0-3) to storage outlet (10-13) by adding OUTLET_OFFSET
        state.selectedTanks.forEach(uiOutlet => {
            const storageOutlet = uiOutlet + OUTLET_OFFSET; // 0→10, 1→11, 2→12, 3→13
            const { feedMotor, scatterMotor } = getMotorValues(uiOutlet);
            feedSet.push({
                outlet: storageOutlet,  // Storage outlet number (10-13)
                feed_motor: feedMotor,  // Upper motor PWM
                scatter_motor: scatterMotor,  // Lower motor PWM
                quantity: feedMotor * 100,  // PWM 5 → 500
                time: operationDuration * 10,  // seconds → 0.1s units
                active: 1
            });
        });

        return feedSet;
    }

    /**
     * Save and apply schedule with confirmation popup
     * Consolidates the old "데이터 저장" and "스케줄 적용" buttons
     */
    async function saveAndApplySchedule() {
        if (!elements.saveScheduleBtn) return;

        try {
            // Validate that we have feeding times
            if (state.feedingTimes.length === 0) {
                alert('급이 시간을 먼저 추가하세요');
                return;
            }

            // Validate that at least one tank is selected
            console.log('🔍 DEBUG: Selected tanks before save:', state.selectedTanks);
            if (state.selectedTanks.length === 0) {
                alert('최소 하나의 수조를 선택하세요');
                return;
            }

            // Validate dayOfWeek array
            if (!state.selectedDayOfWeek || !Array.isArray(state.selectedDayOfWeek) || state.selectedDayOfWeek.length !== 7) {
                alert('요일 선택 오류: 시스템을 새로고침하세요');
                console.error('Invalid selectedDayOfWeek:', state.selectedDayOfWeek);
                return;
            }

            // Get operation duration
            const operationDuration = parseInt(elements.operationDuration?.value || 60);

            // Build confirmation message with complete schedule list
            const tankNames = state.selectedTanks.map(t => `${t + 1}번 수조`).join(', ');
            const dayNames = getDayNamesString(state.selectedDayOfWeek);
            const timeList = state.feedingTimes.join(', ');
            const motorSummary = state.selectedTanks.map(t => {
                const { feedMotor, scatterMotor } = getMotorValues(t);
                return `${t + 1}번 수조(상위:${feedMotor}/하위:${scatterMotor})`;
            }).join(', ');

            const confirmMessage =
                `다음 스케줄을 저장하고 적용하시겠습니까?\n\n` +
                `📍 수조: ${tankNames}\n` +
                `📅 요일: ${dayNames}\n` +
                `⏰ 시간: ${timeList}\n` +
                `⚙️ 모터 설정: ${motorSummary}\n` +
                `⏱️ 작동 시간: ${operationDuration}초\n\n` +
                `총 ${state.feedingTimes.length}개의 스케줄이 저장됩니다.`;

            if (!confirm(confirmMessage)) {
                return;
            }

            // Update button state
            elements.saveScheduleBtn.disabled = true;
            elements.saveScheduleBtn.textContent = '저장 중...';

            // Save all schedules in batch
            const savePromises = state.feedingTimes.map(async (timeString) => {
                const feedSet = [];

                // Add feed_set entry for each selected tank with its own motor values
                // Convert UI outlet (0-3) to storage outlet (10-13) by adding OUTLET_OFFSET
                state.selectedTanks.forEach(uiOutlet => {
                    const storageOutlet = uiOutlet + OUTLET_OFFSET; // 0→10, 1→11, 2→12, 3→13
                    const { feedMotor, scatterMotor } = getMotorValues(uiOutlet);
                    feedSet.push({
                        outlet: storageOutlet,
                        feed_motor: feedMotor,
                        scatter_motor: scatterMotor,
                        quantity: feedMotor * 100,
                        time: operationDuration * 10,
                        active: 1
                    });
                });

                console.log('🔍 DEBUG: Sending feedSet for time', timeString, ':', feedSet);

                const requestData = {
                    scheduleTime: timeString,
                    dayOfWeek: state.selectedDayOfWeek,
                    feedSet: feedSet,
                    test: 0
                };

                console.log('🔍 DEBUG: Complete request data:', requestData);

                const response = await fetch('/api/schedules/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestData)
                });

                return response.json();
            });

            // Wait for all saves to complete
            const results = await Promise.all(savePromises);

            // Check if all saves were successful
            const allSuccess = results.every(r => r.success);

            if (allSuccess) {
                console.log('All schedules saved successfully');
                alert(`${state.feedingTimes.length}개의 스케줄이 저장되었습니다`);

                // Reload schedule display in right panel
                await loadAndDisplaySchedules();

                // Briefly show success state
                elements.saveScheduleBtn.textContent = '저장 완료!';
                setTimeout(() => {
                    elements.saveScheduleBtn.textContent = '스케줄 저장';
                }, 2000);
            } else {
                throw new Error('일부 스케줄 저장에 실패했습니다');
            }

        } catch (error) {
            console.error('Failed to save schedules:', error);
            alert('스케줄 저장 실패: ' + error.message);
            elements.saveScheduleBtn.textContent = '스케줄 저장';
        } finally {
            elements.saveScheduleBtn.disabled = false;
        }
    }

    /**
     * Save current schedule configuration to server (DAY_OF_WEEK array format)
     * @deprecated Use saveAndApplySchedule() instead
     */
    async function saveSchedule() {
        if (!elements.saveDataBtn) return;

        // Validate that we have feeding times
        if (state.feedingTimes.length === 0) {
            alert('급이 시간을 먼저 추가하세요');
            return;
        }

        // Validate dayOfWeek array
        if (!state.selectedDayOfWeek || !Array.isArray(state.selectedDayOfWeek) || state.selectedDayOfWeek.length !== 7) {
            alert('요일 선택 오류: 시스템을 새로고침하세요');
            console.error('Invalid selectedDayOfWeek:', state.selectedDayOfWeek);
            return;
        }

        // Get feed configuration (deprecated path: use first selected tank values as fallback)
        const firstTank = state.selectedTanks[0] ?? 0;
        const { feedMotor: upperMotor, scatterMotor: lowerMotor } = getMotorValues(firstTank);
        const operationDuration = parseInt(elements.operationDuration?.value || 60);

        // Build request data with DAY_OF_WEEK array format
        const requestData = {
            scheduleTime: state.feedingTimes[0], // Use first feeding time
            dayOfWeek: state.selectedDayOfWeek,
            upperMotor: upperMotor,
            lowerMotor: lowerMotor,
            operationDuration: operationDuration,
            test: 0 // Production mode by default
        };

        // Debug: Log request data
        console.log('Saving schedule with data:', requestData);
        console.log('Current state.selectedDayOfWeek:', state.selectedDayOfWeek);

        // Update button state
        elements.saveDataBtn.disabled = true;
        elements.saveDataBtn.textContent = '저장 중...';

        try {
            const response = await fetch('/api/schedules/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                console.log('Schedule saved successfully:', result.data);
                alert('스케줄이 저장되었습니다');

                // Reload schedule display in right panel
                await loadAndDisplaySchedules();

                // Briefly show success state
                elements.saveDataBtn.textContent = '저장 완료!';
                setTimeout(() => {
                    elements.saveDataBtn.textContent = '데이터 저장';
                }, 2000);
            } else {
                throw new Error(result.error || 'Failed to save schedule');
            }
        } catch (error) {
            console.error('Failed to save schedule:', error);
            alert('스케줄 저장 실패: ' + error.message);
        } finally {
            elements.saveDataBtn.disabled = false;
        }
    }

    /**
     * Apply schedule - Save and send test feeding command
     */
    async function applySchedule() {
        if (!elements.applyScheduleBtn) return;

        // Validate that we have feeding times
        if (state.feedingTimes.length === 0) {
            alert('급이 시간을 먼저 추가하세요');
            return;
        }

        // First, save the schedule
        console.log('Applying schedule...');

        // Update button state
        elements.applyScheduleBtn.disabled = true;
        elements.applyScheduleBtn.textContent = '적용 중...';

        try {
            // Save schedule first
            await saveScheduleInternal();

            // Ask user if they want to send a test feeding command
            const sendTest = confirm(
                '스케줄이 저장되었습니다.\n\n' +
                '테스트 급이 명령을 지금 전송하시겠습니까?\n' +
                '(실제 급이기가 작동합니다)'
            );

            if (sendTest) {
                // Send test feeding command using NEW feedSet format
                const reservations = convertToReservationFormat();

                // Use the first reservation's feedSet for testing
                const feedingData = {
                    feederGroup: state.selectedFeeder,
                    feedSet: reservations.length > 0 ? reservations[0].feedSet : []
                };

                const response = await fetch('/api/schedules/execute', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(feedingData)
                });

                const result = await response.json();

                if (result.success) {
                    console.log('Feeding command sent:', result);
                    alert('테스트 급이 명령이 전송되었습니다');
                } else {
                    throw new Error(result.error || 'Failed to send feeding command');
                }
            } else {
                alert('스케줄이 저장되었습니다');
            }
        } catch (error) {
            console.error('Failed to apply schedule:', error);
            alert('스케줄 적용 실패: ' + error.message);
        } finally {
            elements.applyScheduleBtn.disabled = false;
            elements.applyScheduleBtn.textContent = '스케줄 적용';
        }
    }

    /**
     * Internal save function (no UI updates)
     */
    async function saveScheduleInternal() {
        // Validate that we have at least one feeding time
        if (state.feedingTimes.length === 0) {
            throw new Error('급이 시간을 먼저 추가하세요');
        }

        // Get feed configuration (deprecated path: use first selected tank values as fallback)
        const firstTankInternal = state.selectedTanks[0] ?? 0;
        const { feedMotor: upperMotorInt, scatterMotor: lowerMotorInt } = getMotorValues(firstTankInternal);
        const operationDuration = parseInt(elements.operationDuration?.value || 60);

        // Use DAY_OF_WEEK array format
        const requestData = {
            scheduleTime: state.feedingTimes[0], // Use first feeding time
            dayOfWeek: state.selectedDayOfWeek,
            upperMotor: upperMotorInt,
            lowerMotor: lowerMotorInt,
            operationDuration: operationDuration,
            test: 0 // Production mode by default
        };

        const response = await fetch('/api/schedules/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestData)
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error || 'Failed to save schedule');
        }

        return result.data;
    }

    // ===================================
    // Schedule List Display (Phase 6)
    // ===================================

    /**
     * Load and display all schedules in right panel (day-of-week format)
     */
    async function loadAndDisplaySchedules() {
        if (!elements.scheduleCards) return;

        try {
            const response = await fetch('/api/schedules');
            const result = await response.json();

            if (result.success && result.data && result.data.reservations) {
                // Store ALL reservations in state (including inactive ones with DEL_YN='Y')
                // This allows users to see and reactivate paused schedules
                state.reservations = result.data.reservations;

                // Display all schedules (active and inactive)
                if (state.reservations.length > 0) {
                    displayScheduleCards(state.reservations);
                } else {
                    showNoSchedulesPlaceholder();
                }
            } else {
                showNoSchedulesPlaceholder();
            }
        } catch (error) {
            console.error('Failed to load schedules for display:', error);
            showNoSchedulesPlaceholder();
        }
    }

    /**
     * Display schedule cards in right panel
     */
    function displayScheduleCards(schedules) {
        if (!elements.scheduleCards) return;

        // Hide placeholder
        if (elements.noSchedulesPlaceholder) {
            elements.noSchedulesPlaceholder.style.display = 'none';
        }

        // Clear existing cards
        elements.scheduleCards.innerHTML = '';

        // Create card for each schedule
        schedules.forEach(schedule => {
            const card = createScheduleCard(schedule);
            elements.scheduleCards.appendChild(card);
        });
    }

    /**
     * Create a schedule card element (DAY_OF_WEEK array format)
     */
    function createScheduleCard(reservation) {
        const card = document.createElement('div');
        const isActive = reservation.DEL_YN === 'N';
        card.className = 'schedule-card schedule-card-compact' + (isActive ? '' : ' disabled');
        card.dataset.scheduleNo = reservation.NO;

        // Extract time from SCHEDULE_TIME (ISO 8601)
        const scheduleTime = extractTimeFromISO(reservation.SCHEDULE_TIME);

        // Get day names string (compact version)
        const dayNames = getDayNamesString(reservation.DAY_OF_WEEK);

        // Count active tanks
        let tankCount = 0;
        let feedSetDetailsHTML = '';
        if (reservation.RESERVATION_DATA && reservation.RESERVATION_DATA.feed_set &&
            Array.isArray(reservation.RESERVATION_DATA.feed_set)) {
            const activeFeedSet = reservation.RESERVATION_DATA.feed_set.filter(f => f.active === 1);
            tankCount = activeFeedSet.length;

            if (activeFeedSet.length > 0) {
                const feedSetDetails = activeFeedSet.map(feed => {
                    // Convert storage outlet (10-13) to UI display (1-4)
                    const storageOutlet = feed.outlet;
                    const uiOutlet = storageOutlet >= OUTLET_OFFSET ? storageOutlet - OUTLET_OFFSET : storageOutlet;
                    const tankName = `${uiOutlet + 1}번 수조`; // 0→1, 1→2, 2→3, 3→4
                    const feedMotor = feed.feed_motor || Math.ceil(feed.quantity / 100);
                    const scatterMotor = feed.scatter_motor || 0;
                    const duration = Math.ceil(feed.time / 10);
                    return `
                        <div class="feed-detail-row">
                            <span class="feed-detail-tank">${tankName}</span>
                            <span class="feed-detail-motors">급이: ${feedMotor} / 분산: ${scatterMotor}</span>
                            <span class="feed-detail-duration">${duration}초</span>
                        </div>
                    `;
                }).join('');

                feedSetDetailsHTML = `
                    <div class="schedule-card-details">
                        <div class="feed-details-list">
                            ${feedSetDetails}
                        </div>
                    </div>
                `;
            }
        }

        // Compact header with essential info only - buttons moved to header
        card.innerHTML = `
            <div class="schedule-card-header-compact" onclick="dashboardApp.loadScheduleToControlPanel(${reservation.NO})">
                <div class="schedule-info-compact">
                    <span class="schedule-time-text">${scheduleTime}</span>
                    <span class="schedule-days-badge">${dayNames}</span>
                </div>
                <div class="schedule-actions-compact">
                    <button class="schedule-card-btn btn-toggle ${isActive ? '' : 'disabled'}"
                            title="${isActive ? '스케줄 비활성화' : '스케줄 활성화'}"
                            onclick="event.stopPropagation(); dashboardApp.toggleSchedule(${reservation.NO}, ${!isActive})">
                        ${isActive ? '⏸' : '▶'}
                    </button>
                    <button class="schedule-card-btn btn-delete"
                            title="스케줄 삭제"
                            onclick="event.stopPropagation(); dashboardApp.deleteSchedule(${reservation.NO})">
                        🗑
                    </button>
                    <span class="expand-icon" onclick="event.stopPropagation(); dashboardApp.toggleCardExpand(${reservation.NO})">▼</span>
                </div>
            </div>
            ${feedSetDetailsHTML}
        `;

        return card;
    }

    /**
     * Toggle schedule card expand/collapse
     */
    function toggleCardExpand(scheduleNo) {
        const card = document.querySelector(`.schedule-card[data-schedule-no="${scheduleNo}"]`);
        if (card) {
            card.classList.toggle('expanded');
        }
    }

    /**
     * Extract time (HH:MM) from ISO 8601 datetime string
     * Uses UTC methods to preserve the time as stored without timezone conversion
     */
    function extractTimeFromISO(isoString) {
        try {
            const date = new Date(isoString);
            // Use UTC methods to match server-side storage format
            // This prevents timezone conversion issues (e.g., 17:00 UTC displaying as 02:00 in KST)
            const hours = String(date.getUTCHours()).padStart(2, '0');
            const minutes = String(date.getUTCMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch (e) {
            return '00:00';
        }
    }

    /**
     * Show placeholder when no schedules exist
     */
    function showNoSchedulesPlaceholder() {
        if (elements.scheduleCards) {
            elements.scheduleCards.innerHTML = '';
        }
        if (elements.noSchedulesPlaceholder) {
            elements.noSchedulesPlaceholder.style.display = 'block';
        }
    }

    /**
     * Load a schedule into the control panel for viewing/editing
     */
    function loadScheduleToControlPanel(scheduleNo) {
        try {
            // Find the schedule in state.reservations
            const schedule = state.reservations.find(r => r.NO === scheduleNo);

            if (!schedule) {
                console.error('Schedule not found:', scheduleNo);
                return;
            }

            console.log('Loading schedule to control panel:', schedule);

            // Switch to schedule tab
            switchTab('schedule');

            // Clear any existing selected schedule highlight
            document.querySelectorAll('.schedule-card').forEach(card => {
                card.classList.remove('selected');
            });

            // Highlight the selected schedule card
            const selectedCard = document.querySelector(`.schedule-card[data-schedule-no="${scheduleNo}"]`);
            if (selectedCard) {
                selectedCard.classList.add('selected');
            }

            // Extract time from SCHEDULE_TIME (ISO 8601)
            // Use UTC methods to match server-side storage format
            const scheduleDate = new Date(schedule.SCHEDULE_TIME);
            const hours = scheduleDate.getUTCHours();
            const minutes = scheduleDate.getUTCMinutes();

            // Set time fields
            if (elements.feedingHour) {
                elements.feedingHour.value = hours;
            }
            if (elements.feedingMinute) {
                elements.feedingMinute.value = minutes;
            }

            // Set day checkboxes based on DAY_OF_WEEK array
            const dayCheckboxes = document.querySelectorAll('.day-checkbox');
            if (schedule.DAY_OF_WEEK && Array.isArray(schedule.DAY_OF_WEEK)) {
                dayCheckboxes.forEach((checkbox, index) => {
                    checkbox.checked = schedule.DAY_OF_WEEK[index] === 1;
                });
            }

            // Get the first active feed set entry to populate motor values and duration
            if (schedule.RESERVATION_DATA && schedule.RESERVATION_DATA.feed_set &&
                Array.isArray(schedule.RESERVATION_DATA.feed_set)) {

                const activeFeedSet = schedule.RESERVATION_DATA.feed_set.filter(f => f.active === 1);

                if (activeFeedSet.length > 0) {
                    // Set operation duration from first entry (convert from 0.1 second units to seconds)
                    if (elements.operationDuration) {
                        elements.operationDuration.value = Math.ceil(activeFeedSet[0].time / 10);
                    }

                    // Set tank checkboxes and update state.selectedTanks
                    const tankCheckboxes = document.querySelectorAll('.tank-checkbox');
                    tankCheckboxes.forEach(checkbox => {
                        checkbox.checked = false; // Clear all first
                    });
                    state.selectedTanks = [];

                    // Check the tanks that are in the feed set
                    // Convert storage outlet (10-13) back to UI outlet (0-3)
                    activeFeedSet.forEach(feed => {
                        const storageOutlet = feed.outlet;
                        const uiOutlet = storageOutlet >= OUTLET_OFFSET ? storageOutlet - OUTLET_OFFSET : storageOutlet;
                        const tankCheckbox = document.querySelector(`.tank-checkbox[value="${uiOutlet}"]`);
                        if (tankCheckbox) {
                            tankCheckbox.checked = true;
                        }
                        if (!state.selectedTanks.includes(uiOutlet)) {
                            state.selectedTanks.push(uiOutlet);
                        }
                    });
                    state.selectedTanks.sort();

                    // Restore per-tank motor values into state then render
                    activeFeedSet.forEach(feed => {
                        const storageOutlet = feed.outlet;
                        const uiOutlet = storageOutlet >= OUTLET_OFFSET ? storageOutlet - OUTLET_OFFSET : storageOutlet;
                        state.tankMotorValues[uiOutlet] = {
                            feedMotor: feed.feed_motor || Math.ceil(feed.quantity / 100),
                            scatterMotor: feed.scatter_motor || 0
                        };
                    });
                    renderMotorInputs();
                }
            }

            // Scroll to the schedule control panel
            const scheduleTab = document.getElementById('tab-schedule');
            if (scheduleTab) {
                scheduleTab.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            console.log('Schedule loaded successfully to control panel');

        } catch (error) {
            console.error('Failed to load schedule to control panel:', error);
            alert('스케줄 불러오기 실패: ' + error.message);
        }
    }

    /**
     * Edit a schedule - load it into the UI
     */
    async function editSchedule(scheduleId) {
        try {
            const response = await fetch('/api/schedules');
            const result = await response.json();

            if (result.success) {
                const schedule = result.schedules.find(s => s.id === scheduleId);

                if (schedule) {
                    // Switch to schedule tab
                    switchTab('schedule');

                    // Select the feeder group
                    state.selectedFeeder = schedule.feederGroup;
                    const feederRadio = document.querySelector(`input[name="feeder-group"][value="${schedule.feederGroup}"]`);
                    if (feederRadio) {
                        feederRadio.checked = true;
                    }

                    // Load schedule data into UI (day-of-week format)
                    // Note: In day-of-week format, editing is simplified
                    // Users will delete and recreate schedules instead

                    console.log('Schedule loaded for editing:', schedule);
                    alert('현재 요일별 스케줄 형식에서는 편집 기능이 제한됩니다. 스케줄을 삭제하고 새로 만들어주세요.');
                }
            }
        } catch (error) {
            console.error('Failed to load schedule for editing:', error);
            alert('스케줄 불러오기 실패: ' + error.message);
        }
    }

    /**
     * Toggle schedule enabled/disabled status (DAY_OF_WEEK array format)
     */
    async function toggleSchedule(no, enabled) {
        try {
            const response = await fetch(`/api/schedules/${no}/toggle`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });

            const result = await response.json();

            if (result.success) {
                console.log('Schedule toggled:', no, 'enabled:', enabled);
                // Reload schedule display
                await loadAndDisplaySchedules();
            } else {
                throw new Error(result.error || 'Failed to toggle schedule');
            }
        } catch (error) {
            console.error('Failed to toggle schedule:', error);
            alert('스케줄 상태 변경 실패: ' + error.message);
        }
    }

    /**
     * Delete a schedule (DAY_OF_WEEK array format)
     */
    async function deleteSchedule(no) {
        if (!confirm('이 스케줄을 삭제하시겠습니까?')) {
            return;
        }

        try {
            const response = await fetch(`/api/schedules/${no}`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                console.log('Schedule deleted:', no);
                alert('스케줄이 삭제되었습니다');
                // Reload schedule display
                await loadAndDisplaySchedules();
            } else {
                throw new Error(result.error || 'Failed to delete schedule');
            }
        } catch (error) {
            console.error('Failed to delete schedule:', error);
            alert('스케줄 삭제 실패: ' + error.message);
        }
    }

    // ===================================
    // Operation Logging (Phase 7)
    // ===================================

    /**
     * Load and display operation logs
     */
    async function loadOperationLogs() {
        if (!elements.logTableBody) return;

        try {
            const response = await fetch('/api/logs?limit=50');
            const result = await response.json();

            if (result.success && result.logs.length > 0) {
                displayOperationLogs(result.logs);
            } else {
                showNoLogsPlaceholder();
            }
        } catch (error) {
            console.error('Failed to load operation logs:', error);
            showNoLogsPlaceholder();
        }
    }

    /**
     * Display operation logs in table
     */
    function displayOperationLogs(logs) {
        if (!elements.logTableBody) return;

        // Clear existing rows
        elements.logTableBody.innerHTML = '';

        // Add row for each log
        logs.forEach(log => {
            const row = createLogRow(log);
            elements.logTableBody.appendChild(row);
        });
    }

    /**
     * Create a log table row
     */
    function createLogRow(log) {
        const row = document.createElement('tr');

        // Format timestamp
        const timestamp = new Date(log.timestamp);
        const timeStr = timestamp.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        // Determine status class
        const statusClass = log.status === 'success' ? 'log-success' :
            log.status === 'error' ? 'log-error' :
                'log-info';

        // Convert feederGroup to tank number (수조)
        // feederGroup can be a number (1, 2, 3, 4) or a string
        let tankLabel = `수조 ${log.feederGroup}`;

        // If feederGroup is 0, it's tank 1 (1번 수조)
        if (log.feederGroup === 0 || log.feederGroup === '0') {
            tankLabel = '수조 1';
        } else if (log.feederGroup === 1 || log.feederGroup === '1') {
            tankLabel = '수조 2';
        } else if (log.feederGroup === 2 || log.feederGroup === '2') {
            tankLabel = '수조 3';
        } else if (log.feederGroup === 3 || log.feederGroup === '3') {
            tankLabel = '수조 4';
        }

        row.innerHTML = `
            <td>${timeStr}</td>
            <td>${tankLabel}</td>
            <td class="${statusClass}">${log.action}</td>
            <td class="log-details">${log.details || '-'}</td>
        `;

        return row;
    }

    /**
     * Show placeholder when no logs exist
     */
    function showNoLogsPlaceholder() {
        if (elements.logTableBody) {
            elements.logTableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-secondary);">
                        동작 로그가 없습니다
                    </td>
                </tr>
            `;
        }
    }

    /**
     * Add a new log entry (called when receiving SSE log event)
     */
    function addLogEntry(log) {
        if (!elements.logTableBody) return;

        // Create new row
        const row = createLogRow(log);

        // Insert at the top (newest first)
        if (elements.logTableBody.firstChild) {
            elements.logTableBody.insertBefore(row, elements.logTableBody.firstChild);
        } else {
            elements.logTableBody.appendChild(row);
        }

        // Keep only last 50 rows
        while (elements.logTableBody.children.length > 50) {
            elements.logTableBody.removeChild(elements.logTableBody.lastChild);
        }
    }

    // ===================================
    // Large Feeder Control
    // ===================================

    /**
     * Clear all large feeder device status dots
     * Called when starting a new operation
     */
    function clearLargeFeederStatusDots() {
        // Clear selector status dots
        for (let timeout = 0; timeout <= 1; timeout++) {
            const dotId = `large-status-selector-${timeout}`;
            const dotEl = document.getElementById(dotId);
            if (dotEl) {
                dotEl.classList.remove('active');
            }
        }

        // Clear all status dots for all 4 devices (act_id 1-4)
        // Each device has 2 dots: timeout 0 (running) and timeout 1 (complete)
        for (let actId = 1; actId <= 4; actId++) {
            for (let timeout = 0; timeout <= 1; timeout++) {
                const dotId = `large-status-${actId}-${timeout}`;
                const dotEl = document.getElementById(dotId);
                if (dotEl) {
                    dotEl.classList.remove('active');
                }
            }
        }
        console.log('Large feeder status dots cleared (including selector)');
    }

    async function startLargeFeeder() {
        try {
            // Validate required fields
            const tankNumber = elements.tankNumber.value;
            const siloMotorRight = elements.siloMotorRight.value;
            const siloMotorLeft = elements.siloMotorLeft.value;
            const rotaryValve = elements.rotaryValve.value;
            const blower = elements.blower.value;

            if (!tankNumber || !siloMotorRight || !siloMotorLeft || !rotaryValve || !blower) {
                alert('모든 필수 필드를 입력하세요 (수조 번호, 사일로 모터, 로터리 밸브, 블로워)');
                return;
            }

            // Validate ranges
            const tankNum = parseInt(tankNumber);
            const siloRight = parseInt(siloMotorRight);
            const siloLeft = parseInt(siloMotorLeft);
            const rotary = parseInt(rotaryValve);
            const blowerVal = parseInt(blower);

            if (tankNum < 0 || tankNum > 99) {
                alert('수조 번호는 0-99 범위여야 합니다');
                return;
            }

            // Validate PWM values (only check non-negative, no upper limit)
            if (siloRight < 0 || siloLeft < 0 || rotary < 0 || blowerVal < 0) {
                alert('PWM 값은 0 이상이어야 합니다');
                return;
            }

            // Get time values (optional, default to 0)
            const siloMotorRightTime = parseInt(elements.siloMotorRightTime.value || 0);
            const siloMotorLeftTime = parseInt(elements.siloMotorLeftTime.value || 0);
            const rotaryValveTime = parseInt(elements.rotaryValveTime.value || 0);
            const blowerTime = parseInt(elements.blowerTime.value || 0);

            // Validate time ranges
            if (siloMotorRightTime < 0 || siloMotorRightTime > 999 ||
                siloMotorLeftTime < 0 || siloMotorLeftTime > 999 ||
                rotaryValveTime < 0 || rotaryValveTime > 999 ||
                blowerTime < 0 || blowerTime > 999) {
                alert('시간 값은 0-999 범위여야 합니다');
                return;
            }

            // Clear all device status dots before starting
            clearLargeFeederStatusDots();

            // Update tank status indicator
            updateTankStatusIndicator(tankNum);

            // Disable button during operation
            elements.startLargeFeeder.disabled = true;
            elements.startLargeFeeder.textContent = '실행 중...';

            // Prepare settings object
            // Time values converted to 0.1 second units as expected by firmware
            const settings = {
                tankNumber: tankNum,
                siloMotorRight: siloRight * 10,
                siloMotorRightTime: siloMotorRightTime * 10, // Convert to 0.1s units
                siloMotorLeft: siloLeft * 10,
                siloMotorLeftTime: siloMotorLeftTime * 10,
                rotaryValve: rotary * 10,
                rotaryValveTime: rotaryValveTime * 10,
                blower: blowerVal * 10,
                blowerTime: blowerTime * 10
            };

            console.log('Starting large feeder with settings:', settings);

            // Send command to server
            const response = await fetch('/api/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            const result = await response.json();

            if (response.ok) {
                alert('대형 급이기 명령이 성공적으로 전송되었습니다');
                console.log('Large feeder command sent successfully:', result);
            } else {
                alert('명령 전송 실패: ' + (result.message || '알 수 없는 오류'));
                console.error('Failed to send large feeder command:', result);
            }

        } catch (error) {
            console.error('Error starting large feeder:', error);
            alert('대형 급이기 시작 중 오류 발생: ' + error.message);
        } finally {
            // Re-enable button
            elements.startLargeFeeder.disabled = false;
            elements.startLargeFeeder.textContent = '시작';
        }
    }

    /**
     * Emergency stop for large feeder
     * Sends emergency stop command to server (same as ui.html stopbutton)
     * MQTT message: { act_id: 5, opmode: 64, pwm: 0, time: 0 } to topic DIPSW_1
     */
    async function stopLargeFeeder() {
        const stopBtn = document.getElementById('stopLargeFeeder');
        if (!stopBtn) return;

        try {
            console.log('Emergency stop button clicked (Large Feeder)');

            // Disable button during operation
            stopBtn.disabled = true;
            stopBtn.textContent = '정지 중...';

            // Send emergency stop command to server
            const response = await fetch('/api/stop', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Emergency stop command sent:', data);

            // Clear all status dots for large feeder
            clearLargeFeederStatusDots();

            // Show success feedback
            alert('긴급 정지 명령이 전송되었습니다.');

        } catch (error) {
            console.error('Error sending emergency stop:', error);
            alert('긴급 정지 중 오류 발생: ' + error.message);
        } finally {
            // Re-enable button
            if (stopBtn) {
                stopBtn.disabled = false;
                stopBtn.textContent = '긴급 정지';
            }
        }
    }

    // ===================================
    // Public API (expose to window for inline event handlers)
    // ===================================
    window.dashboardApp = {
        removeFeedingTime,
        switchTab,
        toggleSchedule,
        deleteSchedule,
        selectAllDays,
        selectWeekdays,
        selectWeekends,
        toggleCardExpand,
        loadScheduleToControlPanel
    };

    // ===================================
    // Start Application
    // ===================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

